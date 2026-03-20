# assets/crypto_model.py — Crypto spot asset model
#
# Wraps the existing ARBI scanner signals (mean reversion, spread arb,
# triangular arb, liquidity, volatility) and produces TradeCandidateRecord
# objects for the universal pipeline.
#
# No business logic is duplicated here — scanner/*.py remains the source of
# truth for crypto-specific signal generation.

from __future__ import annotations
import time
from typing import Optional

from assets.base_asset import BaseAssetModel
from core.candidate import TradeCandidateRecord, AssetClass, OrderSide
from core.ev_model import EVModel
from core.features import FeatureCalculator
from core.signals import SignalEngine, SIGNAL_MEAN_REVERSION, SIGNAL_MOMENTUM
from utils.logger import get_logger

log = get_logger("assets.crypto")

# Default EV assumptions when we have no historical backtest data
_DEFAULT_P_WIN  = 0.52
_DEFAULT_AVG_WIN  = 0.006   # 0.6%
_DEFAULT_AVG_LOSS = 0.003   # 0.3%

# Per-venue fees (round-trip = 2 × taker fee, conservative)
_VENUE_FEES = {
    "kraken":     0.0052,   # 2 × 0.26%
    "binance_us": 0.000190, # 2 × 0.0095%
    "coinbase":   0.0120,   # 2 × 0.60%
    "bybit":      0.0014,   # 2 × 0.07%
}
_DEFAULT_FEE = 0.006

# Scalp parameters
_TP_PCT = 0.006   # 0.6%
_SL_PCT = 0.003   # 0.3%


class CryptoAssetModel(BaseAssetModel):

    @property
    def asset_class(self) -> str:
        return AssetClass.CRYPTO.value

    @property
    def supported_strategies(self) -> list[str]:
        return [
            SIGNAL_MEAN_REVERSION,
            SIGNAL_MOMENTUM,
            "cross_exchange_arb",
            "triangular_arb",
            "liquidity_imbalance",
            "volatility_breakout",
            "funding_rate_arb",
        ]

    # ── scan ─────────────────────────────────────────────────────────────────

    def scan(
        self,
        market_data: dict,
        regime:      dict,
        candles:     Optional[dict] = None,
    ) -> list[TradeCandidateRecord]:
        """
        Produce TradeCandidateRecord objects.

        Primary path: use existing scanners (spread, triangular, liquidity,
        volatility) and convert their output dicts to TradeCandidateRecord.

        Secondary path: if candles are provided, also run FeatureCalculator +
        SignalEngine for mean-reversion / momentum on each symbol.
        """
        candidates: list[TradeCandidateRecord] = []
        ev_model    = EVModel()
        regime_str  = regime.get("regime", "UNKNOWN")

        # ── Path 1: existing scanners ─────────────────────────────────────────
        try:
            candidates += self._from_spread_scanner(market_data, regime_str, ev_model)
        except Exception as exc:
            log.debug("spread scanner error: %s", exc)

        try:
            candidates += self._from_triangular_scanner(market_data, regime_str, ev_model)
        except Exception as exc:
            log.debug("triangular scanner error: %s", exc)

        try:
            candidates += self._from_liquidity_scanner(market_data, regime_str, ev_model)
        except Exception as exc:
            log.debug("liquidity scanner error: %s", exc)

        # ── Path 2: feature-based signals per symbol ──────────────────────────
        if candles:
            for symbol, candle_list in candles.items():
                if len(candle_list) < 15:
                    continue
                for ex_name, ex_data in market_data.items():
                    row = ex_data.get(symbol)
                    if not row:
                        continue
                    bid = row.get("bid") or row.get("last") or 0
                    ask = row.get("ask") or row.get("last") or 0
                    if not bid or not ask:
                        continue

                    features = FeatureCalculator.compute(candle_list, bid, ask)
                    signal   = SignalEngine.best(
                        features, regime_str,
                        [SIGNAL_MEAN_REVERSION, SIGNAL_MOMENTUM],
                    )
                    if signal:
                        c = self._make_candidate(
                            symbol, ex_name, signal["type"],
                            signal["side"], bid, ask,
                            signal["confidence"], features, regime_str,
                        )
                        ev_model.enrich(c)
                        candidates.append(c)

        return [c for c in candidates if c.is_viable]

    # ── Fee / slippage ────────────────────────────────────────────────────────

    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        return _VENUE_FEES.get(venue, _DEFAULT_FEE)

    def estimate_slippage(
        self, symbol: str, order_book: dict, size_usd: float, side: str
    ) -> float:
        slip = self._book_slippage(order_book, size_usd, side)
        return min(slip, 0.01)  # cap at 1% slippage

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_order(
        self, candidate: TradeCandidateRecord, balance: float
    ) -> tuple[bool, str]:
        if candidate.allocated_capital <= 0:
            return False, "zero_capital"
        if candidate.allocated_capital > balance * 0.50:
            return False, "exceeds_50pct_balance"
        if candidate.spread_pct > 0.005:
            return False, f"spread_too_wide ({candidate.spread_pct:.3%})"
        return True, "ok"

    # ── Exit rules ────────────────────────────────────────────────────────────

    def exit_rules(
        self,
        position:    dict,
        market_data: dict,
        regime:      dict,
    ) -> Optional[str]:
        symbol     = position["symbol"]
        entry      = position.get("avg_entry", 0)
        entry_ts   = position.get("entry_ts", 0)
        quantity   = position.get("quantity", 0)
        exchange   = position.get("exchange", "")

        if not entry or not quantity:
            return None

        # Current price
        row = market_data.get(exchange, {}).get(symbol) or market_data.get(symbol, {})
        bid = row.get("bid") or row.get("last") or 0
        if not bid:
            return None

        pnl_pct = (bid - entry) / entry

        regime_str = regime.get("regime", "UNKNOWN")
        tp_mult    = regime.get("tp_mult", 1.0)
        sl_mult    = regime.get("sl_mult", 1.0)

        if pnl_pct >= _TP_PCT * tp_mult:
            return "take_profit"
        if pnl_pct <= -(_SL_PCT * sl_mult):
            return "stop_loss"
        if entry_ts and (time.time() - entry_ts) > 600:   # 10 min max hold
            return "time_exit"
        return None

    # ── Private helpers ───────────────────────────────────────────────────────

    def _make_candidate(
        self,
        symbol:     str,
        venue:      str,
        strategy:   str,
        side:       OrderSide,
        bid:        float,
        ask:        float,
        confidence: float,
        features:   dict,
        regime_str: str,
    ) -> TradeCandidateRecord:
        fee      = self.estimate_fees(venue)
        spread   = FeatureCalculator.spread_pct(bid, ask)
        slip_est = spread * 0.5 + 0.0005  # rough: half spread + 5 bps base

        return TradeCandidateRecord(
            symbol      = symbol,
            asset_class = AssetClass.CRYPTO,
            venue       = venue,
            strategy    = strategy,
            side        = side,
            bid         = bid,
            ask         = ask,
            last        = (bid + ask) / 2,
            spread_pct  = spread,
            regime      = regime_str,
            p_win       = _DEFAULT_P_WIN,
            avg_win     = _DEFAULT_AVG_WIN,
            avg_loss    = _DEFAULT_AVG_LOSS,
            fees_pct    = fee,
            slippage_pct = slip_est,
            expected_hold_sec = 300.0,
            confidence  = confidence,
            features    = features,
        )

    def _from_spread_scanner(
        self, market_data: dict, regime_str: str, ev_model: EVModel
    ) -> list[TradeCandidateRecord]:
        from scanner.spread_scanner import scan_spreads
        opps = scan_spreads(market_data)
        candidates = []
        for opp in opps:
            sym  = opp.get("symbol", "")
            ex_a = opp.get("exchange_a", "")
            bid  = opp.get("price_a", 0)
            ask  = opp.get("price_b", 0)
            if not sym or not bid or not ask:
                continue
            spread_pct = opp.get("spread_pct", 0) / 100
            fee        = self.estimate_fees(ex_a)
            confidence = min((spread_pct - fee) / 0.005, 1.0)
            c = TradeCandidateRecord(
                symbol        = sym,
                asset_class   = AssetClass.CRYPTO,
                venue         = ex_a,
                strategy      = "cross_exchange_arb",
                side          = OrderSide.BUY,
                bid           = bid,
                ask           = ask,
                last          = bid,
                spread_pct    = FeatureCalculator.spread_pct(bid, ask),
                regime        = regime_str,
                p_win         = 0.70,
                avg_win       = spread_pct * 0.5,
                avg_loss      = fee,
                fees_pct      = fee,
                slippage_pct  = 0.0005,
                confidence    = max(confidence, 0.0),
                expected_hold_sec = 60.0,
                source_opp    = opp,
            )
            ev_model.enrich(c)
            candidates.append(c)
        return candidates

    def _from_triangular_scanner(
        self, market_data: dict, regime_str: str, ev_model: EVModel
    ) -> list[TradeCandidateRecord]:
        from scanner.triangular_scanner import scan_all_triangular
        opps = scan_all_triangular(market_data)
        candidates = []
        for opp in opps:
            sym  = opp.get("path", ["", "", ""])[0]
            ex   = opp.get("exchange", "")
            edge = opp.get("gross_edge_pct", 0) / 100
            fee  = self.estimate_fees(ex)
            row  = market_data.get(ex, {}).get(sym, {})
            bid  = row.get("bid") or row.get("last") or 0
            ask  = row.get("ask") or row.get("last") or 0
            if not bid:
                continue
            c = TradeCandidateRecord(
                symbol        = sym,
                asset_class   = AssetClass.CRYPTO,
                venue         = ex,
                strategy      = "triangular_arb",
                side          = OrderSide.BUY,
                bid           = bid,
                ask           = ask,
                last          = bid,
                spread_pct    = FeatureCalculator.spread_pct(bid, ask),
                regime        = regime_str,
                p_win         = 0.65,
                avg_win       = edge * 0.8,
                avg_loss      = fee,
                fees_pct      = fee,
                slippage_pct  = 0.001,
                confidence    = min(edge / 0.005, 1.0),
                expected_hold_sec = 30.0,
                source_opp    = opp,
            )
            ev_model.enrich(c)
            candidates.append(c)
        return candidates

    def _from_liquidity_scanner(
        self, market_data: dict, regime_str: str, ev_model: EVModel
    ) -> list[TradeCandidateRecord]:
        from scanner.liquidity_scanner import scan_liquidity
        opps = scan_liquidity(market_data)
        candidates = []
        for opp in opps:
            sym  = opp.get("symbol", "")
            ex   = opp.get("exchange", "")
            row  = market_data.get(ex, {}).get(sym, {})
            bid  = row.get("bid") or row.get("last") or 0
            ask  = row.get("ask") or row.get("last") or 0
            if not bid:
                continue
            fee  = self.estimate_fees(ex)
            c = TradeCandidateRecord(
                symbol        = sym,
                asset_class   = AssetClass.CRYPTO,
                venue         = ex,
                strategy      = "liquidity_imbalance",
                side          = OrderSide.BUY,
                bid           = bid,
                ask           = ask,
                last          = bid,
                spread_pct    = FeatureCalculator.spread_pct(bid, ask),
                regime        = regime_str,
                p_win         = _DEFAULT_P_WIN,
                avg_win       = _DEFAULT_AVG_WIN,
                avg_loss      = _DEFAULT_AVG_LOSS,
                fees_pct      = fee,
                slippage_pct  = 0.001,
                confidence    = opp.get("score", 50) / 100.0,
                expected_hold_sec = 120.0,
                source_opp    = opp,
            )
            ev_model.enrich(c)
            candidates.append(c)
        return candidates
