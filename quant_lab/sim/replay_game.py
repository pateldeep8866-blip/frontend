"""
Paper Market Replay Game + Copilot (research-only).

Offline-first behavior:
- Uses cached historical bars via quantlab.data_cache.get_prices_cached().
- If the cache is missing and network access is unavailable, the run will fail
  (pre-cache data first).

Example:
  python sim/replay_game.py --ticker SPY --start 2024-01-01 --end 2024-06-01 --cash 10000 --autopilot
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from quantlab.data_cache import get_prices_cached  # noqa: E402
from quantlab.index import update_run_index  # noqa: E402
from quantlab.reporting.run_manifest import write_run_manifest  # noqa: E402
from quantlab.sim.account import PaperAccount  # noqa: E402
from quantlab.sim.copilot import Copilot, Recommendation  # noqa: E402
from quantlab.sim.execution import FillModel, PendingOrder  # noqa: E402


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _placeholder_png_bytes() -> bytes:
    # Minimal valid 1x1 PNG (transparent) for environments without matplotlib.
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01\xe2!\xbc3"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def plot_equity_curve(dates: List[datetime], equity: List[float], outpath: Path, *, title: str) -> bool:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        outpath.write_bytes(_placeholder_png_bytes())
        return False

    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.plot(dates, equity, lw=2)
    ax.set_title(title)
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(outpath, dpi=140)
    plt.close(fig)
    return True


def compute_summary_metrics(dates: List[datetime], equity: List[float]) -> Dict[str, float]:
    if not equity:
        raise ValueError("empty equity curve")

    start = float(equity[0])
    end = float(equity[-1])
    total_return = (end / start) - 1.0 if start > 0 else float("nan")

    peak = float("-inf")
    max_dd = 0.0
    for e in equity:
        e = float(e)
        peak = max(peak, e)
        if peak > 0:
            dd = (e / peak) - 1.0
            max_dd = min(max_dd, dd)

    # Hit rate: pct positive equity changes.
    wins = 0
    n = 0
    for i in range(1, len(equity)):
        d = float(equity[i]) - float(equity[i - 1])
        wins += 1 if d > 0 else 0
        n += 1
    hit_rate = float(wins) / float(n) if n > 0 else float("nan")

    # CAGR + Sharpe (simple; rf=0).
    days = (dates[-1] - dates[0]).days if len(dates) >= 2 else 0
    years = days / 365.25 if days > 0 else 0.0
    cagr = (end / start) ** (1.0 / years) - 1.0 if years > 0 and start > 0 and end > 0 else float("nan")

    rets = []
    for i in range(1, len(equity)):
        prev = float(equity[i - 1])
        cur = float(equity[i])
        if prev > 0:
            rets.append((cur / prev) - 1.0)
    if len(rets) >= 2:
        mu = sum(rets) / float(len(rets))
        var = sum((x - mu) ** 2 for x in rets) / float(len(rets) - 1)
        sd = math.sqrt(var)
        sharpe = math.sqrt(252.0) * (mu / sd) if sd > 0 else float("nan")
    else:
        sharpe = float("nan")

    return {
        "final_equity": float(end),
        "total_return": float(total_return),
        "max_drawdown": float(max_dd),
        "hit_rate": float(hit_rate),
        "cagr": float(cagr),
        "sharpe": float(sharpe),
    }


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Paper Market Replay Game + Copilot (research only).")
    p.add_argument("--ticker", default="SPY", help="Ticker to replay (default: SPY)")
    p.add_argument("--start", required=True, help="Start date YYYY-MM-DD (required)")
    p.add_argument("--end", required=True, help="End date YYYY-MM-DD (required)")
    p.add_argument("--cash", type=float, default=10_000.0, help="Starting cash (default: 10000)")
    p.add_argument("--speed", type=int, default=10, help="Print update every N bars in autopilot mode (default: 10)")
    p.add_argument("--commission", type=float, default=0.0, help="Commission fraction per trade (default: 0.0)")
    p.add_argument("--slippage_bps", type=float, default=0.0, help="Slippage in bps against user (default: 0)")
    p.add_argument("--next_bar", action="store_true", help="Execute trades on the next bar open instead of current close")
    p.add_argument("--short", type=int, default=20, help="Copilot short MA window (default: 20)")
    p.add_argument("--long", type=int, default=50, help="Copilot long MA window (default: 50)")
    p.add_argument("--max_position_pct", type=float, default=0.25, help="Max position as pct of equity (default: 0.25)")
    p.add_argument("--max_daily_loss_pct", type=float, default=0.02, help="Daily loss halt threshold (default: 0.02)")
    p.add_argument("--autopilot", action="store_true", help="Automatically follow copilot recommendations")
    p.add_argument("--save", action="store_true", help="No-op; artifacts are always written into reports/runs/<run_id>/")
    args = p.parse_args(argv)

    ticker = str(args.ticker).upper().strip()
    if not ticker:
        raise SystemExit("ticker must be non-empty")

    # Load cached data via quantlab.data_cache.get_prices_cached().
    try:
        df, data_path, data_sha256, cache_hit = get_prices_cached(
            ticker,
            start=args.start,
            end=args.end,
            interval="1d",
        )
    except Exception as e:
        raise SystemExit(f"Failed to load cached data for {ticker}: {e}") from e

    if df is None or getattr(df, "empty", True):
        raise SystemExit("No data returned.")

    # Normalize index to datetime (pandas is expected in real use; this is defensive).
    try:
        import pandas as pd  # type: ignore

        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        df = df.sort_index()
    except Exception:
        pass

    # Slice to requested dates if present.
    try:
        df = df.loc[args.start : args.end]
    except Exception:
        pass
    if df is None or getattr(df, "empty", True):
        raise SystemExit("No rows in requested date range after slicing.")

    # Data provenance (captured by the data layer via df.attrs when available).
    meta = {}
    try:
        meta = dict(getattr(df, "attrs", {}).get("quantlab_data") or {})
    except Exception:
        meta = {}

    prov_name = str(meta.get("provider_name") or "unknown")
    prov_ver = str(meta.get("provider_version") or "unknown")
    data_provenance = {
        "provider_name": prov_name,
        "provider_version": prov_ver,
        "files": {
            str(ticker).upper(): {
                "data_path": str(data_path),
                "data_sha256": str(data_sha256),
                "file_sha256": str(meta.get("file_sha256") or str(data_sha256)),
                "cache_hit": bool(cache_hit),
                "retrieval_timestamp": str(meta.get("retrieval_timestamp") or ""),
                "row_count": int(meta.get("row_count") or getattr(df, "shape", [0])[0] or 0),
                "first_timestamp": str(meta.get("first_timestamp") or (df.index.min().isoformat() if not df.empty else "")),
                "last_timestamp": str(meta.get("last_timestamp") or (df.index.max().isoformat() if not df.empty else "")),
            }
        },
    }

    # Build manifest + run dir (Run Pack style).
    created_utc = _utc_now_iso()
    config = {
        "mode": "replay_game",
        "ticker": ticker,
        "start": args.start,
        "end": args.end,
        "interval": "1d",
        "cash": float(args.cash),
        "commission": float(args.commission),
        "slippage_bps": float(args.slippage_bps),
        "next_bar": bool(args.next_bar),
        "short": int(args.short),
        "long": int(args.long),
        "max_position_pct": float(args.max_position_pct),
        "max_daily_loss_pct": float(args.max_daily_loss_pct),
        "autopilot": bool(args.autopilot),
        "speed": int(args.speed),
    }

    # Composite hash covers entrypoint + sim modules + run-pack plumbing.
    import quantlab.data_cache as _qdc  # noqa: E402
    import quantlab.index as _qindex  # noqa: E402
    import quantlab.reporting.run_manifest as _qrm  # noqa: E402
    import quantlab.sim.account as _qacc  # noqa: E402
    import quantlab.sim.copilot as _qcop  # noqa: E402
    import quantlab.sim.execution as _qexec  # noqa: E402
    import quantlab.utils.hashing as _qhash  # noqa: E402

    code_paths = [
        Path(__file__).resolve(),
        Path(_qdc.__file__).resolve(),
        Path(_qindex.__file__).resolve(),
        Path(_qrm.__file__).resolve(),
        Path(_qacc.__file__).resolve(),
        Path(_qcop.__file__).resolve(),
        Path(_qexec.__file__).resolve(),
        Path(_qhash.__file__).resolve(),
    ]
    code_paths.append((_ROOT / "quantlab" / "data" / "__init__.py").resolve())
    code_paths.extend(sorted((_ROOT / "quantlab" / "data" / "providers").glob("*.py")))

    run_root = _ROOT / "reports" / "runs"
    run_dir, manifest = write_run_manifest(
        strategy_name="replay_game",
        parameters=config,
        data_path=Path(data_path),
        data_sha256=str(data_sha256),
        cache_hit=bool(cache_hit),
        data_source=str(prov_name),
        data_provenance=data_provenance,
        code_path=Path(__file__).resolve(),
        code_paths=code_paths,
        run_root=run_root,
        project_root=_ROOT,
        created_utc=created_utc,
    )

    account = PaperAccount(cash=float(args.cash))
    fill = FillModel(slippage_bps=float(args.slippage_bps), fill_at_close=True)
    copilot = Copilot(
        short_window=int(args.short),
        long_window=int(args.long),
        max_position_pct=float(args.max_position_pct),
        max_daily_loss_pct=float(args.max_daily_loss_pct),
    )

    closes: List[float] = []
    dates: List[datetime] = []
    equity_curve: List[float] = []

    equity_rows: List[Dict[str, Any]] = []
    rec_rows: List[Dict[str, Any]] = []
    episode_rows: List[Dict[str, Any]] = []

    pending: Optional[PendingOrder] = None
    prev_equity: Optional[float] = None

    def _print_status(i: int, dt: datetime, close: float, eq: float, pnl: float) -> None:
        pos = account.shares(ticker)
        print(
            f"[{i+1}/{len(df)}] {dt.date()} close={close:.2f} cash={account.cash:.2f} shares={pos:.0f} equity={eq:.2f} pnl={pnl:.2f}"
        )

    for i, (ts, row) in enumerate(df.iterrows()):
        # Convert timestamp to python datetime (UTC-naive is fine for daily bars).
        dt = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts  # type: ignore
        if isinstance(dt, datetime):
            dt_py = dt
        else:
            dt_py = datetime.fromisoformat(str(dt))

        # If next_bar execution is enabled, fill pending order at bar open.
        bar = {
            "Open": float(row["Open"]) if "Open" in row and row["Open"] == row["Open"] else None,
            "Close": float(row["Close"]) if "Close" in row and row["Close"] == row["Close"] else float(row.get("Adj Close", 0.0)),
        }

        account.set_time(dt_py)
        if pending is not None:
            try:
                px_open = fill.fill_price(pending.action, bar, use_open=True)
                if pending.action.upper() == "BUY":
                    account.buy(ticker, float(pending.shares), px_open, commission=float(args.commission))
                elif pending.action.upper() == "SELL":
                    account.sell(ticker, float(pending.shares), px_open, commission=float(args.commission))
            except Exception:
                # If a pending order can't be filled (e.g., no cash), drop it.
                pass
            pending = None

        close = float(bar["Close"])
        closes.append(close)
        dates.append(dt_py)

        # Mark-to-market equity at close.
        eq = account.equity({ticker: close})
        if prev_equity is None:
            pnl = 0.0
            pnl_pct = 0.0
        else:
            pnl = float(eq - prev_equity)
            pnl_pct = pnl / float(prev_equity) if float(prev_equity) != 0.0 else 0.0

        halted = bool(prev_equity is not None and pnl_pct <= -float(args.max_daily_loss_pct))

        rec = copilot.recommend(
            close=close,
            history_closes=closes,
            cash=account.cash,
            current_shares=account.shares(ticker),
            equity=eq,
            daily_pnl_pct=pnl_pct,
            halted=halted,
        )

        user_action = "HOLD"
        copilot_action = rec.action

        def _execute_action(action: str, shares: int, reason: str) -> str:
            nonlocal pending
            a = str(action).upper()
            if shares <= 0 or a not in {"BUY", "SELL"}:
                return "HOLD"
            if bool(args.next_bar):
                pending = PendingOrder(action=a, shares=int(shares), reason=reason)
                return f"{a}_PENDING"
            # Fill at close.
            px_close = fill.fill_price(a, bar, use_open=False)
            if a == "BUY":
                account.buy(ticker, float(shares), px_close, commission=float(args.commission))
            else:
                account.sell(ticker, float(shares), px_close, commission=float(args.commission))
            return a

        stop_early = False

        if bool(args.autopilot):
            if not halted and rec.action in {"BUY", "SELL"} and rec.suggested_shares > 0:
                try:
                    user_action = _execute_action(rec.action, int(rec.suggested_shares), reason="COPILOT")
                except Exception:
                    user_action = "HOLD"
            else:
                user_action = "HOLD"
        else:
            # Interactive prompt
            _print_status(i, dt_py, close, eq, pnl)
            if halted:
                print("Daily loss limit reached. Trading halted for this bar (HOLD/rec/status/quit allowed).")
            print(f"Copilot: {rec.action} {rec.suggested_shares}  conf={rec.confidence:.2f}  reason={rec.reason}")
            while True:
                cmd = input("cmd> ").strip()
                if cmd == "":
                    continue
                if cmd.lower() in {"hold", "h"}:
                    user_action = "HOLD"
                    break
                if cmd.lower() in {"quit", "q"}:
                    # End episode early; still write artifacts.
                    stop_early = True
                    break
                if cmd.lower() in {"rec"}:
                    print(f"Copilot: {rec.action} {rec.suggested_shares}  conf={rec.confidence:.2f}")
                    print(rec.reason)
                    if rec.risk_notes:
                        print("risk:", ", ".join(rec.risk_notes))
                    continue
                if cmd.lower() in {"status", "s"}:
                    _print_status(i, dt_py, close, eq, pnl)
                    continue
                parts = cmd.split()
                if len(parts) == 2 and parts[0].lower() in {"buy", "sell"}:
                    if halted:
                        print("Trading is halted for this bar due to daily loss limit.")
                        continue
                    try:
                        sh = int(parts[1])
                    except Exception:
                        print("shares must be an integer")
                        continue
                    try:
                        user_action = _execute_action(parts[0].upper(), sh, reason="USER")
                        break
                    except Exception as e:
                        print(f"trade rejected: {e}")
                        continue
                print("commands: buy <shares>, sell <shares>, hold, rec, status, quit")

            if stop_early:
                break

        # Recompute equity after any close-fill trade.
        eq_end = account.equity({ticker: close})
        equity_curve.append(eq_end)

        shares_now = account.shares(ticker)
        equity_rows.append(
            {
                "date": dt_py.date().isoformat(),
                "close": f"{close:.10f}",
                "cash": f"{account.cash:.10f}",
                "shares": f"{shares_now:.10f}",
                "equity": f"{eq_end:.10f}",
                "pnl": f"{(eq_end - (prev_equity if prev_equity is not None else eq_end)):.10f}",
            }
        )
        rec_rows.append(
            {
                "date": dt_py.date().isoformat(),
                "action": rec.action,
                "suggested_shares": int(rec.suggested_shares),
                "confidence": f"{rec.confidence:.6f}",
                "reason": rec.reason,
            }
        )

        state = {
            "close": float(close),
            "cash": float(account.cash),
            "shares": float(shares_now),
            "equity": float(eq_end),
            "daily_pnl": float(pnl),
            "daily_pnl_pct": float(pnl_pct),
            "halted": bool(halted),
            "copilot_action": rec.action,
            "copilot_suggested_shares": int(rec.suggested_shares),
            "copilot_confidence": float(rec.confidence),
        }
        episode_rows.append(
            {
                "date": dt_py.date().isoformat(),
                "state_features_json": _stable_json(state),
                "user_action": user_action,
                "copilot_action": copilot_action,
                "reward": "",  # filled after loop (next-bar equity change)
            }
        )

        prev_equity = float(eq_end)

        if bool(args.autopilot):
            n = max(1, int(args.speed))
            if i % n == 0 or i == len(df) - 1:
                _print_status(i, dt_py, close, eq_end, pnl)

    if not dates or not equity_curve:
        raise SystemExit("No replay steps executed; nothing to write.")

    # Rewards: next-bar equity change.
    rewards = []
    for i in range(len(equity_curve)):
        if i + 1 < len(equity_curve):
            rewards.append(float(equity_curve[i + 1] - equity_curve[i]))
        else:
            rewards.append(0.0)
    for r, ep in zip(rewards, episode_rows):
        ep["reward"] = f"{float(r):.10f}"

    # Write artifacts.
    trade_rows = []
    for t in account.trade_log:
        trade_rows.append(
            {
                "datetime": t.dt.isoformat() if t.dt else "",
                "action": t.action,
                "ticker": t.ticker,
                "shares": f"{t.shares:.10f}",
                "price": f"{t.price:.10f}",
                "commission": f"{t.commission:.10f}",
                "cash_after": f"{t.cash_after:.10f}",
                "shares_after": f"{t.shares_after:.10f}",
            }
        )

    write_csv(
        run_dir / "trades.csv",
        trade_rows,
        fieldnames=["datetime", "action", "ticker", "shares", "price", "commission", "cash_after", "shares_after"],
    )
    write_csv(
        run_dir / "equity.csv",
        equity_rows,
        fieldnames=["date", "close", "cash", "shares", "equity", "pnl"],
    )
    write_csv(
        run_dir / "recommendations.csv",
        rec_rows,
        fieldnames=["date", "action", "suggested_shares", "confidence", "reason"],
    )
    write_csv(
        run_dir / "episodes.csv",
        episode_rows,
        fieldnames=["date", "state_features_json", "user_action", "copilot_action", "reward"],
    )

    # Metrics.
    strat_metrics = compute_summary_metrics(dates, equity_curve)
    num_trades = int(len(account.trade_log))
    metrics_out = {
        "mode": "replay_game",
        "final_equity": strat_metrics["final_equity"],
        "total_return": strat_metrics["total_return"],
        "max_drawdown": strat_metrics["max_drawdown"],
        "num_trades": int(num_trades),
        "strategy": {
            "final_equity": strat_metrics["final_equity"],
            "total_return": strat_metrics["total_return"],
            "max_drawdown": strat_metrics["max_drawdown"],
            "hit_rate": strat_metrics["hit_rate"],
            "cagr": strat_metrics["cagr"],
            "sharpe": strat_metrics["sharpe"],
            "num_trades": int(num_trades),
        },
    }

    # Benchmark (buy-and-hold of the same ticker for the same period).
    bench_equity = [float(args.cash) * (float(c) / float(closes[0])) for c in closes]
    bench_metrics = compute_summary_metrics(dates, bench_equity)
    metrics_out["benchmark"] = {
        "ticker": ticker,
        "total_return": bench_metrics["total_return"],
        "max_drawdown": bench_metrics["max_drawdown"],
        "hit_rate": bench_metrics["hit_rate"],
        "cagr": bench_metrics["cagr"],
        "sharpe": bench_metrics["sharpe"],
    }

    (run_dir / "metrics.json").write_text(json.dumps(metrics_out, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    # Report.
    plot_ok = plot_equity_curve(dates, equity_curve, run_dir / "equity_curve.png", title=f"{ticker} Replay Equity")
    report_lines = [
        f"# Paper Market Replay Game: {manifest['run_id']}",
        "",
        f"- Created (UTC): `{manifest['created_utc']}`",
        f"- Ticker: `{ticker}`  Period: `{args.start}` -> `{args.end}`",
        f"- Starting cash: `{float(args.cash):.2f}`  Commission: `{float(args.commission)}`  Slippage bps: `{float(args.slippage_bps)}`",
        f"- Next-bar execution: `{bool(args.next_bar)}`  Autopilot: `{bool(args.autopilot)}`",
        f"- Copilot MA: short=`{int(args.short)}` long=`{int(args.long)}`",
        f"- Risk: max_position_pct=`{float(args.max_position_pct)}` max_daily_loss_pct=`{float(args.max_daily_loss_pct)}`",
        "",
        "## Summary",
        "",
        f"- Final equity: `{strat_metrics['final_equity']:.2f}`",
        f"- Total return: `{strat_metrics['total_return'] * 100:.2f}%`",
        f"- Max drawdown: `{strat_metrics['max_drawdown'] * 100:.2f}%`",
        f"- Hit rate: `{strat_metrics['hit_rate'] * 100:.2f}%`",
        f"- Num trades: `{num_trades}`",
        "",
        "## Determinism Inputs",
        "",
        f"- Data source: `{manifest.get('data_source')}`  Cache hit: `{manifest.get('cache_hit')}`",
        f"- Data path: `{manifest['data_path']}`",
        f"- Data sha256: `{manifest['data_sha256']}`",
        f"- Code sha256: `{manifest['code_hash']}`",
        f"- Composite code sha256: `{manifest.get('composite_code_hash')}`",
        f"- Config sha256: `{manifest['config_hash']}`",
        "",
        "## Files",
        "",
        "- `run_manifest.json`",
        "- `metrics.json`",
        "- `report.md`",
        "- `equity_curve.png`",
        "- `equity.csv`",
        "- `trades.csv`",
        "- `recommendations.csv`",
        "- `episodes.csv`",
        "",
        f"Plot generated with matplotlib: `{plot_ok}`",
        "",
    ]
    (run_dir / "report.md").write_text("\n".join(report_lines), encoding="utf-8")

    # Update run index.
    update_run_index(run_dir, metrics_out, manifest)

    print(f"Run directory: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
