# Quant Trading Bot

A modular, multi-strategy crypto trading bot built in Python.  
Designed for MacBook-local development with paper trading first.

---

## Architecture

```
WebSocket Market Feed
        ↓
Market Cache  ←  REST ticker/orderbook refresh
        ↓
Scanner Engine
  ├── Spread Scanner       (cross-exchange arb)
  ├── Triangular Scanner   (intra-exchange arb)
  ├── Liquidity Scanner    (order book imbalance)
  └── Volatility Scanner   (breakout detection)
        ↓
Opportunity Ranker
        ↓
Execution Router
        ↓
Risk Governor  ←  Kill Switch
        ↓
Order Manager  →  Exchange Adapters (Kraken, Coinbase)
        ↓
Position Manager
        ↓
SQLite Event Store
        ↓
Health Monitor / Reconciler
```

---

## Project Structure

```
quant_bot/
├── main.py                  ← entry point
├── config.py                ← all tunable settings
├── requirements.txt
│
├── adapters/
│   ├── base.py              ← exchange interface contract
│   ├── kraken_adapter.py
│   └── coinbase_adapter.py
│
├── scanner/
│   ├── universe.py          ← which exchanges / symbols to watch
│   ├── normalizer.py        ← symbol format normalization
│   ├── cache.py             ← shared in-memory market data
│   ├── spread_scanner.py    ← cross-exchange arb
│   ├── triangular_scanner.py← intra-exchange triangular arb
│   ├── liquidity_scanner.py ← order book imbalance
│   ├── volatility_scanner.py← breakout candidates
│   └── ranker.py            ← score + sort opportunities
│
├── execution/
│   ├── order_manager.py     ← full order lifecycle
│   └── router.py            ← connects signals to orders
│
├── portfolio/
│   ├── positions.py         ← position + PnL tracking
│   └── allocator.py        ← dynamic capital allocation
│
├── risk/
│   ├── risk_manager.py      ← trade gates + capital protection
│   └── kill_switch.py       ← emergency halt
│
├── optimizer/
│   └── strategy_optimizer.py← parameter grid search
│
├── storage/
│   └── db.py                ← SQLite event + trade store
│
├── monitoring/
│   └── health.py            ← reconciliation + health checks
│
├── data/
│   └── ws_feed.py           ← WebSocket price feed (Kraken)
│
└── utils/
    └── logger.py            ← centralized logging
```

---

## Quickstart

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure

Open `config.py` and review:
- Leave `PAPER_TRADING = True` for all initial testing
- Leave API keys blank for scanner-only mode
- Adjust `START_SYMBOLS` and risk parameters if needed

### 3. Run scanner only (zero risk)

```bash
python main.py --scan-only
```

This fetches live market data and prints ranked opportunities with no orders placed.

### 4. Run paper trading

```bash
python main.py
```

Simulates trades against live prices. All orders are logged but nothing is sent to exchanges.

### 5. Go live (only after 30+ days of stable paper trading)

Add your API keys to `config.py`, set `PAPER_TRADING = False`, then:

```bash
python main.py --live
```

You must type `YES` to confirm.

---

## Risk Controls

| Control                  | Default  | Config key               |
|--------------------------|----------|--------------------------|
| Max trade size           | 2%       | `TRADE_RISK_PCT`         |
| Max daily loss           | 3%       | `MAX_DAILY_LOSS_PCT`     |
| Max total drawdown       | 5%       | `MAX_DRAWDOWN_PCT`       |
| Max open trades          | 3        | `MAX_OPEN_TRADES`        |
| Consecutive loss limit   | 5        | `MAX_CONSECUTIVE_LOSSES` |
| Stale data lockout       | 10s      | `MARKET_DATA_FRESHNESS_SEC` |

---

## Strategies

| Strategy            | Type              | Edge Source                    |
|---------------------|-------------------|-------------------------------|
| Cross-exchange arb  | Arbitrage         | Price differences across venues|
| Triangular arb      | Arbitrage         | Internal loop mispricing       |
| Liquidity signal    | Market pressure   | Order book imbalance           |
| Volatility breakout | Momentum          | Volume + range expansion       |

---

## Recommended Testing Progression

```
Week 1–2:  scan-only mode — validate scanner is finding real signals
Week 3–4:  paper trading — validate execution logic and PnL tracking
Month 2:   paper trading with tuned parameters from optimizer
Month 3+:  very small live capital ($500–$1k) if paper results are stable
```

---

## Adding a New Exchange

1. Copy `adapters/kraken_adapter.py` → `adapters/myexchange_adapter.py`
2. Implement all methods from `adapters/base.py`
3. Add credentials to `config.py`
4. Register in `main.py` adapters dict

---

## Logs and Data

- **Console logs**: `logs/quant_bot.log`
- **SQLite database**: `quant_bot.db`
- Tables: `events`, `orders`, `fills`, `positions`, `strategy_signals`, `risk_events`

---

## ⚠️ Important Warning

Automated trading can lose money quickly if misconfigured.  
Always run paper trading for at least 30 days before using real capital.  
This software is provided as-is with no guarantees of profit.
