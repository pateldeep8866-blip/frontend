import sqlite3
import pandas as pd
import numpy as np
from pathlib import Path

DB_PATH = Path('/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db')
DEFAULT_STRATEGIES = [
    'momentum',
    'mean_reversion',
    'regime_rotation',
    'pairs_trading',
    'earnings_momentum',
]


def get_strategy_trade_counts():
    conn = sqlite3.connect(DB_PATH)
    query = '''
    SELECT strategy_name, COUNT(*) as n
    FROM trades
    WHERE strategy_name IS NOT NULL
      AND action = 'BUY'
    GROUP BY strategy_name
    '''
    df = pd.read_sql_query(query, conn)
    conn.close()
    out = {s: 0 for s in DEFAULT_STRATEGIES}
    for _, row in df.iterrows():
        out[str(row['strategy_name'])] = int(row['n'])
    return out


def compute_strategy_weights(lookback_days=30):
    '''
    Compute capital allocation weights
    for each strategy based on recent
    risk-adjusted performance.

    Uses Sharpe-like scoring:
    Weight = max(0, avg_return / std_return)
    Strategies are then normalized to sum to 1.
    '''
    conn = sqlite3.connect(DB_PATH)

    query = '''
    SELECT
        t.strategy_name,
        o.return_5d,
        o.outcome,
        t.created_utc
    FROM trades t
    INNER JOIN trade_outcomes o
        ON t.trade_id = o.trade_id
    WHERE t.action = 'BUY'
        AND o.return_5d IS NOT NULL
        AND t.created_utc >= datetime('now', ? || ' days')
    ORDER BY t.created_utc
    '''

    df = pd.read_sql_query(query, conn, params=[f'-{lookback_days}'])
    conn.close()

    if df.empty:
        return {s: 0.20 for s in DEFAULT_STRATEGIES}

    weights = {s: 0.10 for s in DEFAULT_STRATEGIES}
    strategy_groups = df.groupby('strategy_name')

    for name, group in strategy_groups:
        returns = group['return_5d'].values

        if len(returns) < 5:
            weights[name] = 0.10
            continue

        avg_ret = np.mean(returns)
        std_ret = np.std(returns)

        if std_ret > 0:
            sharpe = avg_ret / std_ret
        else:
            sharpe = avg_ret

        weights[name] = max(0, sharpe)

    total = sum(weights.values())
    if total > 0:
        weights = {k: v / total for k, v in weights.items()}
    else:
        for k in weights:
            weights[k] = 1.0 / len(weights)

    for k in weights:
        weights[k] = max(0.05, min(0.50, weights[k]))

    total = sum(weights.values())
    weights = {k: v / total for k, v in weights.items()}

    return weights


def get_allocation_report():
    weights_30d = compute_strategy_weights(30)
    weights_7d = compute_strategy_weights(7)

    report = {
        'weights_30d': weights_30d,
        'weights_7d': weights_7d,
        'recommendation': weights_30d,
        'generated_utc': __import__('datetime').datetime.utcnow().isoformat()
    }

    print('=== Capital Allocation Report ===')
    print('30-day performance weights:')
    for name, weight in sorted(weights_30d.items(), key=lambda x: x[1], reverse=True):
        bar = '█' * int(weight * 20)
        print(f'  {name:<25} {weight*100:5.1f}% {bar}')

    return report


if __name__ == '__main__':
    get_allocation_report()
