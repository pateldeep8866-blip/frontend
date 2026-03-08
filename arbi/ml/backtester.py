# ml/backtester.py
#
# REAL BACKTEST ENGINE
#
# Runs strategies against historical OHLCV data with realistic
# fee and slippage modeling. This is what tells you if a strategy
# actually works before risking real capital.

import time
import numpy as np
from utils.logger import get_logger

log = get_logger("ml.backtester")

# Realistic execution assumptions
DEFAULT_FEE_PCT      = 0.0026   # Kraken taker fee
DEFAULT_SLIPPAGE_PCT = 0.0005   # 0.05% average slippage


class BacktestResult:
    def __init__(self):
        self.trades        = []
        self.equity_curve  = []
        self.final_balance = 0.0
        self.total_return  = 0.0
        self.win_rate      = 0.0
        self.max_drawdown  = 0.0
        self.sharpe        = 0.0
        self.profit_factor = 0.0
        self.total_trades  = 0

    def summary(self) -> dict:
        return {
            "total_return_pct":  round(self.total_return * 100, 2),
            "win_rate_pct":      round(self.win_rate * 100, 1),
            "max_drawdown_pct":  round(self.max_drawdown * 100, 2),
            "sharpe_ratio":      round(self.sharpe, 3),
            "profit_factor":     round(self.profit_factor, 3),
            "total_trades":      self.total_trades,
            "final_balance":     round(self.final_balance, 2),
        }


def fetch_historical(client, symbol: str, timeframe: str = "1h",
                     limit: int = 1000) -> list:
    """Fetch OHLCV candles via ccxt."""
    try:
        bars = client.fetch_ohlcv(symbol, timeframe, limit=limit)
        return [
            {
                "ts":     b[0],
                "open":   b[1],
                "high":   b[2],
                "low":    b[3],
                "close":  b[4],
                "volume": b[5],
            }
            for b in bars
        ]
    except Exception as exc:
        log.error("fetch_historical error: %s", exc)
        return []


def run_backtest(candles: list, strategy_fn,
                 starting_balance: float = 10_000.0,
                 risk_per_trade:   float = 0.02,
                 fee_pct:          float = DEFAULT_FEE_PCT,
                 slippage_pct:     float = DEFAULT_SLIPPAGE_PCT,
                 stop_loss_pct:    float = 0.015,
                 take_profit_pct:  float = 0.030) -> BacktestResult:
    """
    Walk-forward backtest engine.

    strategy_fn: callable(candles_up_to_i) → {"action": BUY/SELL/HOLD, ...}
    Simulates one trade at a time with realistic fills.
    """
    result  = BacktestResult()
    balance = starting_balance
    peak    = starting_balance
    position = None    # {"entry_price": float, "qty": float, "side": str}

    equity_curve = [balance]
    trades = []

    for i in range(50, len(candles)):
        candles_so_far = candles[:i]
        current        = candles[i]
        price          = current["close"]

        # ── Check stop-loss / take-profit on open position ────────────────
        if position:
            entry = position["entry_price"]
            pnl_pct = (price - entry) / entry

            hit_stop   = pnl_pct <= -stop_loss_pct
            hit_target = pnl_pct >= take_profit_pct

            if hit_stop or hit_target:
                # Apply slippage on exit
                exit_price = price * (1 - slippage_pct)
                gross_pnl  = (exit_price - entry) * position["qty"]
                fee        = exit_price * position["qty"] * fee_pct
                net_pnl    = gross_pnl - fee

                balance += net_pnl
                peak     = max(peak, balance)
                drawdown = (peak - balance) / peak

                trades.append({
                    "entry":    entry,
                    "exit":     exit_price,
                    "pnl":      net_pnl,
                    "pnl_pct":  pnl_pct,
                    "reason":   "stop_loss" if hit_stop else "take_profit",
                })
                position = None
                equity_curve.append(balance)
                continue

        # ── Get strategy signal ───────────────────────────────────────────
        signal = strategy_fn(candles_so_far)
        action = signal.get("action", "HOLD")

        # ── Entry ─────────────────────────────────────────────────────────
        if action == "BUY" and position is None:
            trade_dollar = balance * risk_per_trade
            fill_price   = price * (1 + slippage_pct)
            fee          = fill_price * (trade_dollar / fill_price) * fee_pct
            qty          = (trade_dollar - fee) / fill_price

            if trade_dollar > 0 and qty > 0:
                position = {"entry_price": fill_price, "qty": qty, "side": "long"}

        # ── Exit on SELL signal ───────────────────────────────────────────
        elif action in ("SELL", "EXIT") and position:
            exit_price = price * (1 - slippage_pct)
            gross_pnl  = (exit_price - position["entry_price"]) * position["qty"]
            fee        = exit_price * position["qty"] * fee_pct
            net_pnl    = gross_pnl - fee

            balance += net_pnl
            peak     = max(peak, balance)

            trades.append({
                "entry":   position["entry_price"],
                "exit":    exit_price,
                "pnl":     net_pnl,
                "pnl_pct": (exit_price - position["entry_price"]) / position["entry_price"],
                "reason":  "signal",
            })
            position = None
            equity_curve.append(balance)

    # ── Compute metrics ───────────────────────────────────────────────────
    result.trades       = trades
    result.equity_curve = equity_curve
    result.final_balance = balance
    result.total_trades = len(trades)

    if starting_balance > 0:
        result.total_return = (balance - starting_balance) / starting_balance

    if trades:
        winning = [t for t in trades if t["pnl"] > 0]
        losing  = [t for t in trades if t["pnl"] <= 0]
        result.win_rate = len(winning) / len(trades)

        gross_profit = sum(t["pnl"] for t in winning)
        gross_loss   = abs(sum(t["pnl"] for t in losing))
        result.profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

    # Max drawdown from equity curve
    if equity_curve:
        peak_eq = equity_curve[0]
        max_dd  = 0.0
        for eq in equity_curve:
            peak_eq = max(peak_eq, eq)
            dd = (peak_eq - eq) / peak_eq if peak_eq > 0 else 0
            max_dd = max(max_dd, dd)
        result.max_drawdown = max_dd

    # Sharpe ratio (annualized, assuming hourly candles)
    if len(equity_curve) > 1:
        returns = np.diff(equity_curve) / np.array(equity_curve[:-1])
        if returns.std() > 0:
            result.sharpe = (returns.mean() / returns.std()) * np.sqrt(8760)

    return result


def run_strategy_comparison(candles: list, strategies: dict,
                             starting_balance: float = 10_000.0) -> dict:
    """
    Compare multiple strategies on the same candle data.
    strategies: { "strategy_name": strategy_fn }
    Returns ranked results.
    """
    results = {}
    for name, fn in strategies.items():
        log.info("Backtesting: %s", name)
        r = run_backtest(candles, fn, starting_balance=starting_balance)
        results[name] = r.summary()
        log.info("%s results: %s", name, r.summary())

    # Rank by Sharpe ratio
    ranked = sorted(results.items(), key=lambda x: x[1]["sharpe_ratio"], reverse=True)
    return {"ranked": ranked, "details": results}
