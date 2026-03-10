from __future__ import annotations

import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

from quantlab.morning.universe import (
    DEFAULT_UNIVERSE,
    MINIMUM_UNIVERSE,
    TIER_1_CORE,
    UNIVERSE_TIERS,
)
from quantlab.strategies.single_pick_engine import (
    compute_features,
    fetch_historical,
    score_universe,
)
from quantlab.strategies.strategy_router import StrategyRouter
from quantlab.research import HybridResearchPipeline
from learning.capital_allocator import compute_strategy_weights

app = Flask(__name__)
CORS(app)

CACHE_DIR = Path("/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/data/cache/finnhub")
router = StrategyRouter()
research_pipeline = HybridResearchPipeline()


def _to_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        num = float(value)
        if np.isfinite(num):
            return num
    except Exception:
        pass
    return default


def classify_signal(composite: float) -> str:
    if composite > 0.18:
        return "STRONG_BUY"
    if composite > 0.10:
        return "BUY"
    if composite > 0.0:
        return "NEUTRAL"
    if composite > -0.08:
        return "SELL"
    return "STRONG_SELL"


def detect_regime_from_macro(macro: Dict[str, Any]) -> str:
    vix = _to_float(macro.get("vix"))
    if vix is None:
        return "unknown"
    if vix < 15:
        return "risk_on"
    if vix < 20:
        return "neutral"
    if vix < 25:
        return "caution"
    return "risk_off"


def no_trade_response(reason: str, total_requested: int = 0, valid_count: int = 0):
    return {
        "status": "no_trade",
        "reason": reason,
        "single_pick": None,
        "all_scores": [],
        "active_universe": "minimum",
        "universe_size": 0,
        "universe_tier": "minimum",
        "total_requested": total_requested,
        "valid_count": valid_count,
        "no_trade": True,
        "strategy_router": {
            "top_signal": None,
            "regime": "unknown",
            "strategy_used": "none",
            "no_trade": True,
            "confidence": 0,
            "all_signals": [],
            "strategy_results": {},
        },
        "capital_allocation": {
            "momentum": 0.2,
            "mean_reversion": 0.2,
            "regime_rotation": 0.2,
            "pairs_trading": 0.2,
            "earnings_momentum": 0.2,
        },
    }


def inject_to_cache(ticker: str, ohlcv: list[dict], start: str, end: str, provider: str = "finnhub"):
    if not ohlcv:
        return
    provider_dir = CACHE_DIR.parent / provider
    provider_dir.mkdir(parents=True, exist_ok=True)
    csv_path = provider_dir / f"{ticker}__1d__{start}__{end}.csv"
    lines = ["Date,Open,High,Low,Close,Volume"]
    for row in ohlcv:
        ts = row.get("t")
        date_str = row.get("date")
        if ts is not None:
            try:
                date_str = datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d")
            except Exception:
                pass
        if not date_str:
            continue
        o = _to_float(row.get("open"), 0.0)
        h = _to_float(row.get("high"), 0.0)
        l = _to_float(row.get("low"), 0.0)
        c = _to_float(row.get("close"), 0.0)
        v = _to_float(row.get("volume"), 0.0)
        lines.append(f"{date_str},{o},{h},{l},{c},{int(v or 0)}")
    csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _build_scores_from_df(df: pd.DataFrame) -> pd.DataFrame:
    momentum = (df["ret_20d"] + df["ret_60d"]) / (1.0 + df["vol_20d"].clip(lower=0.0))
    mean_reversion = (-(df["ret_5d"])) / (1.0 + df["vol_5d"].clip(lower=0.0))
    composite = 0.6 * momentum + 0.4 * mean_reversion

    scores = pd.DataFrame(index=df.index)
    scores["composite"] = composite.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    scores["momentum_score"] = momentum.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    scores["mean_reversion_score"] = mean_reversion.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    scores = scores.sort_values("composite", ascending=False)
    return scores


def _scores_to_payload(scores: pd.DataFrame) -> List[Dict[str, Any]]:
    all_scores: List[Dict[str, Any]] = []
    for ticker in scores.index.tolist():
        row = scores.loc[ticker]
        comp = float(row.get("composite", 0.0))
        all_scores.append(
            {
                "ticker": str(ticker).upper(),
                "composite_score": comp,
                "momentum_score": float(row.get("momentum_score", 0.0)),
                "mean_reversion_score": float(row.get("mean_reversion_score", 0.0)),
                "signal": classify_signal(comp),
            }
        )
    return all_scores


def _build_router_payload(router_decision) -> Dict[str, Any]:
    strategy_signals = []
    for signal in router_decision.signals:
        strategy_signals.append(
            {
                "strategy": signal.strategy_name,
                "strategy_name": signal.strategy_name,
                "ticker": signal.ticker,
                "action": signal.action,
                "conviction": signal.conviction,
                "entry_price": signal.entry_price,
                "stop_loss": signal.stop_loss,
                "take_profit": signal.take_profit,
                "risk_reward": signal.risk_reward,
                "reasoning": signal.reasoning,
                "hold_days": signal.hold_days,
                "position_size_pct": signal.position_size_pct,
                "indicators": signal.indicators,
            }
        )

    top = router_decision.top_signal
    return {
        "top_signal": {
            "strategy": top.strategy_name if top else None,
            "strategy_name": top.strategy_name if top else None,
            "ticker": top.ticker if top else None,
            "action": top.action if top else None,
            "conviction": top.conviction if top else 0,
            "entry_price": top.entry_price if top else 0,
            "stop_loss": top.stop_loss if top else 0,
            "take_profit": top.take_profit if top else 0,
            "reasoning": top.reasoning if top else "",
            "hold_days": top.hold_days if top else 0,
            "position_size_pct": top.position_size_pct if top else 0,
        },
        "regime": router_decision.regime,
        "strategy_used": router_decision.strategy_used,
        "no_trade": router_decision.no_trade,
        "confidence": router_decision.confidence,
        "all_signals": strategy_signals,
        "strategy_results": {
            name: {
                "signal_count": r["count"],
                "reason": r["reason"],
            }
            for name, r in router_decision.all_strategy_results.items()
        },
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "online",
            "engine": "QUANT_LAB",
            "version": "1.1",
            "universe": {
                "full": len(DEFAULT_UNIVERSE),
                "core": len(TIER_1_CORE),
                "minimum": len(MINIMUM_UNIVERSE),
            },
            "generated_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    )


@app.route("/api/analyze", methods=["POST"])
def analyze():
    try:
        data = request.get_json(silent=True) or {}
        asof = data.get("asof") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        macro = data.get("macro") or {}
        risk_level = data.get("risk_level", "moderate")

        try:
            dynamic_weights = compute_strategy_weights(lookback_days=30)
        except Exception:
            dynamic_weights = {
                "momentum": 0.20,
                "mean_reversion": 0.20,
                "regime_rotation": 0.20,
                "pairs_trading": 0.20,
                "earnings_momentum": 0.20,
            }

        # Cached mode: score from cached historical files.
        if str(data.get("mode") or "").lower() == "cached":
            os.environ.setdefault("QUANTLAB_DATA_PROVIDER", "finnhub")
            os.environ.setdefault("QUANTLAB_NO_NETWORK", "1")
            scored = score_universe(DEFAULT_UNIVERSE, asof)
            if scored is None or scored.empty:
                return jsonify(no_trade_response("no cached universe scores"))

            all_scores = _scores_to_payload(scored)
            regime = detect_regime_from_macro(macro)
            research_pack = research_pipeline.run(
                universe=[str(t).upper() for t in DEFAULT_UNIVERSE],
                macro=macro,
                regime=regime,
                asof=asof,
            )
            all_scores, blend_weights = research_pipeline.blend_scores(
                all_scores=all_scores,
                macro=macro,
                regime=regime,
                research_pack=research_pack,
            )

            # Build a feature dataframe for strategy routing from cache.
            rows: List[Dict[str, Any]] = []
            asof_ts = pd.Timestamp(asof).normalize()
            start = (asof_ts - pd.DateOffset(years=3)).strftime("%Y-%m-%d")
            end = asof_ts.strftime("%Y-%m-%d")
            for ticker in DEFAULT_UNIVERSE:
                try:
                    hist = fetch_historical(ticker, start, end)
                    feats = compute_features(hist)
                    rows.append(
                        {
                            "ticker": ticker,
                            "price": float(hist["close"].iloc[-1]),
                            "volume": float(hist["volume"].iloc[-1]),
                            **feats,
                        }
                    )
                except Exception:
                    continue

            df = pd.DataFrame(rows).set_index("ticker") if rows else pd.DataFrame()
            router_decision = router.route(
                df=df,
                macro=macro,
                asof=asof,
                risk_level=risk_level,
                strategy_weights=dynamic_weights,
            ) if not df.empty else None

            top = all_scores[0] if all_scores else None
            single_pick = None
            if top and top.get("ticker"):
                top_comp = float(top.get("blended_score", top.get("composite_score", 0.0)))
                single_pick = {
                    "ticker": top["ticker"],
                    "signal": "BUY" if top_comp > 0 else "NEUTRAL",
                    "composite_score": top["composite_score"],
                    "blended_score": top_comp,
                    "event_score": float(top.get("event_score", 0.0)),
                    "macro_score": float(top.get("macro_score", 0.0)),
                    "momentum_score": top["momentum_score"],
                    "mean_reversion_score": top["mean_reversion_score"],
                    "entry_price": 0,
                    "stop_loss": 0,
                    "take_profit": 0,
                    "risk_reward_ratio": 2.5,
                    "separation": 0.0,
                    "confidence": min(max(int(abs(top_comp) * 500), 55), 95),
                    "why": str(top.get("why", "")),
                    "what_changed": str(top.get("what_changed", "")),
                    "could_invalidate": str(top.get("could_invalidate", "")),
                    "sources": top.get("sources", []),
                }

            return jsonify(
                {
                    "status": "success",
                    "asof": asof,
                    "regime": regime,
                    "macro_context": macro,
                    "single_pick": single_pick,
                    "all_scores": all_scores,
                    "active_universe": "full",
                    "universe_size": len(all_scores),
                    "universe_tier": "full",
                    "total_requested": len(DEFAULT_UNIVERSE),
                    "valid_count": len(all_scores),
                    "no_trade": single_pick is None,
                    "strategy_router": _build_router_payload(router_decision)
                    if router_decision
                    else no_trade_response("no strategy features")["strategy_router"],
                    "capital_allocation": dynamic_weights,
                    "research_hybrid": {
                        "blend_weights": blend_weights,
                        "source_stats": research_pack.get("source_stats", {}),
                        "event_count": len(research_pack.get("events", [])),
                        "memory": research_pack.get("memory", {}),
                        "structured_data": research_pack.get("structured_data", {}),
                        "documents": research_pack.get("web_research", {}).get("documents", []),
                    },
                }
            )

        if "tickers" not in data:
            return jsonify({"status": "error", "reason": "missing tickers field"}), 400

        tickers_data = data.get("tickers") or {}

        # Inject cache from Arthastra for all valid tickers when OHLCV exists.
        start = data.get("start") or (
            datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - 3).strftime("%Y-%m-%d")
        )
        end = data.get("end") or asof
        for ticker, tdata in tickers_data.items():
            if isinstance(tdata, dict) and tdata.get("valid") and isinstance(tdata.get("ohlcv"), list):
                inject_to_cache(
                    ticker=str(ticker).upper(),
                    ohlcv=tdata.get("ohlcv") or [],
                    start=start,
                    end=end,
                    provider="finnhub",
                )

        valid_tickers = {
            str(k).upper(): v
            for k, v in tickers_data.items()
            if isinstance(v, dict) and bool(v.get("valid", False))
        }

        if len(valid_tickers) >= 20:
            active_universe = "full"
        elif len(valid_tickers) >= 10:
            active_universe = "core"
        elif len(valid_tickers) >= 3:
            active_universe = "minimum"
        else:
            return jsonify(no_trade_response("insufficient valid tickers", len(tickers_data), len(valid_tickers)))

        scoring_tickers = {k: v for k, v in valid_tickers.items() if k in UNIVERSE_TIERS[active_universe]}

        if len(scoring_tickers) < 3:
            return jsonify(no_trade_response("insufficient tier tickers", len(tickers_data), len(valid_tickers)))

        rows: List[Dict[str, Any]] = []
        for ticker, f in scoring_tickers.items():
            rows.append(
                {
                    "ticker": ticker,
                    "ret_5d": _to_float(f.get("ret_5d"), 0.0),
                    "ret_20d": _to_float(f.get("ret_20d"), 0.0),
                    "ret_60d": _to_float(f.get("ret_60d"), 0.0),
                    "vol_5d": max(_to_float(f.get("vol_5d"), 0.0), 0.0),
                    "vol_20d": max(_to_float(f.get("vol_20d"), 0.0), 0.0),
                    "avg_volume_20d": _to_float(f.get("avg_volume_20d"), 0.0),
                    "price_range": _to_float(f.get("price_range"), 0.0),
                    "price": _to_float(f.get("price"), 0.0),
                    "volume": _to_float(f.get("volume"), 0.0),
                }
            )

        df = pd.DataFrame(rows).set_index("ticker")
        scores = _build_scores_from_df(df)
        all_scores = _scores_to_payload(scores)
        regime = detect_regime_from_macro(macro)
        research_pack = research_pipeline.run(
            universe=[str(t).upper() for t in scoring_tickers.keys()],
            macro=macro,
            regime=regime,
            asof=asof,
        )
        all_scores, blend_weights = research_pipeline.blend_scores(
            all_scores=all_scores,
            macro=macro,
            regime=regime,
            research_pack=research_pack,
        )

        router_decision = router.route(
            df=df,
            macro=macro,
            asof=asof,
            risk_level=risk_level,
            strategy_weights=dynamic_weights,
        )

        top = all_scores[0] if all_scores else None
        single_pick = None
        if top:
            top_ticker = top["ticker"]
            top_comp = float(top.get("blended_score", top.get("composite_score", 0.0)))
            top_price = _to_float(scoring_tickers.get(top_ticker, {}).get("price"), 0.0) or 0.0
            stop_pct = 0.05 if top_comp > 0.5 else 0.08
            target_pct = stop_pct * 2.5
            single_pick = {
                "ticker": top_ticker,
                "signal": "BUY" if top_comp > 0 else "NEUTRAL",
                "composite_score": top["composite_score"],
                "blended_score": top_comp,
                "event_score": float(top.get("event_score", 0.0)),
                "macro_score": float(top.get("macro_score", 0.0)),
                "momentum_score": top["momentum_score"],
                "mean_reversion_score": top["mean_reversion_score"],
                "entry_price": round(top_price, 4) if top_price else 0,
                "stop_loss": round(top_price * (1 - stop_pct), 4) if top_price else 0,
                "take_profit": round(top_price * (1 + target_pct), 4) if top_price else 0,
                "risk_reward_ratio": 2.5,
                "separation": float(top_comp - float(all_scores[1].get("blended_score", all_scores[1].get("composite_score", 0.0)))) if len(all_scores) > 1 else 0.0,
                "confidence": min(max(int(abs(top_comp) * 500), 55), 95),
                "why": str(top.get("why", "")),
                "what_changed": str(top.get("what_changed", "")),
                "could_invalidate": str(top.get("could_invalidate", "")),
                "sources": top.get("sources", []),
            }

        return jsonify(
            {
                "status": "success",
                "asof": asof,
                "regime": regime,
                "macro_context": macro,
                "single_pick": single_pick,
                "all_scores": all_scores,
                "active_universe": active_universe,
                "universe_size": len(scoring_tickers),
                "universe_tier": active_universe,
                "total_requested": len(tickers_data),
                "valid_count": len(valid_tickers),
                "no_trade": single_pick is None,
                "strategy_router": _build_router_payload(router_decision),
                "capital_allocation": dynamic_weights,
                "research_hybrid": {
                    "blend_weights": blend_weights,
                    "source_stats": research_pack.get("source_stats", {}),
                    "event_count": len(research_pack.get("events", [])),
                    "memory": research_pack.get("memory", {}),
                    "structured_data": research_pack.get("structured_data", {}),
                    "documents": research_pack.get("web_research", {}).get("documents", []),
                },
            }
        )
    except Exception as e:
        return jsonify(
            {
                "status": "error",
                "reason": str(e),
                "trace": traceback.format_exc(),
                "single_pick": None,
                "no_trade": True,
            }
        ), 500


if __name__ == "__main__":
    print("QUANT_LAB Analyzer API starting on port 3001")
    app.run(port=3001, debug=False)
