import sqlite3
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

DB_PATH = Path('/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db')


def get_strategy_training_data(strategy_name, min_samples=50):
    '''
    Fetch labeled training data for a
    specific strategy from the database.
    Returns features and outcomes.
    '''
    conn = sqlite3.connect(DB_PATH)

    query = '''
    SELECT
        t.ticker,
        t.strategy_name,
        t.strategy_conviction,
        t.quant_composite_score,
        t.market_regime,
        t.vix_at_entry,
        t.dxy_at_entry,
        t.confidence,
        o.return_1d,
        o.return_5d,
        o.return_21d,
        o.outcome,
        o.hit_stop_loss,
        o.hit_take_profit
    FROM trades t
    INNER JOIN trade_outcomes o
        ON t.trade_id = o.trade_id
    WHERE t.strategy_name = ?
        AND t.action = 'BUY'
        AND o.return_5d IS NOT NULL
    ORDER BY t.created_utc
    '''

    df = pd.read_sql_query(query, conn, params=[strategy_name])
    conn.close()

    if len(df) < min_samples:
        return None, f'Insufficient data: {len(df)}/{min_samples} samples'

    return df, 'ok'


def check_training_readiness():
    '''
    Check which strategies have enough
    data for ML training.
    Report readiness status.
    '''
    conn = sqlite3.connect(DB_PATH)

    query = '''
    SELECT
        t.strategy_name,
        COUNT(DISTINCT t.trade_id) as trades,
        COUNT(o.outcome) as evaluated,
        AVG(CASE WHEN o.return_5d > 0
            THEN 1.0 ELSE 0.0 END) as win_rate
    FROM trades t
    LEFT JOIN trade_outcomes o
        ON t.trade_id = o.trade_id
    WHERE t.strategy_name IS NOT NULL
        AND t.action = 'BUY'
    GROUP BY t.strategy_name
    '''

    df = pd.read_sql_query(query, conn)
    conn.close()

    MIN_FOR_TRAINING = 200

    report = {
        'generated_utc': datetime.utcnow().isoformat(),
        'strategies': {}
    }

    for _, row in df.iterrows():
        name = row['strategy_name']
        trades = int(row['trades'])
        evaluated = int(row['evaluated'])
        win_rate = float(row['win_rate'] or 0)

        report['strategies'][name] = {
            'total_trades': trades,
            'evaluated_trades': evaluated,
            'win_rate': win_rate,
            'ready_for_ml': evaluated >= MIN_FOR_TRAINING,
            'progress': f'{evaluated}/{MIN_FOR_TRAINING}',
            'pct_complete': min(evaluated / MIN_FOR_TRAINING, 1.0)
        }

    return report


def train_strategy_model(strategy_name):
    '''
    Train an XGBoost model for a specific
    strategy once enough data exists.

    NOTE: Requires xgboost package.
    Install with: pip install xgboost

    This function is the seed of the ML
    training pipeline. It will be called
    automatically when a strategy reaches
    200+ evaluated trades.
    '''
    try:
        import xgboost as xgb
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import accuracy_score, roc_auc_score
    except ImportError:
        return None, 'xgboost not installed. Run: pip install xgboost scikit-learn'

    df, msg = get_strategy_training_data(strategy_name, min_samples=200)
    if df is None:
        return None, msg

    features = [
        'strategy_conviction',
        'quant_composite_score',
        'vix_at_entry',
        'dxy_at_entry',
        'confidence'
    ]

    regime_map = {'risk_on': 1, 'neutral': 0, 'caution': -1, 'risk_off': -2}
    df['regime_encoded'] = df['market_regime'].map(regime_map).fillna(0)
    features.append('regime_encoded')

    X = df[features].fillna(0)
    y = (df['return_5d'] > 0).astype(int)

    tscv = TimeSeriesSplit(n_splits=5)

    scores = []
    for train_idx, test_idx in tscv.split(X):
        X_train = X.iloc[train_idx]
        X_test = X.iloc[test_idx]
        y_train = y.iloc[train_idx]
        y_test = y.iloc[test_idx]

        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42,
            eval_metric='logloss',
            verbosity=0
        )

        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        score = accuracy_score(y_test, preds)
        scores.append(score)

    avg_score = np.mean(scores)

    final_model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        random_state=42,
        eval_metric='logloss',
        verbosity=0
    )
    final_model.fit(X, y)

    import pickle
    model_path = Path(f'/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/models/{strategy_name}_v1.pkl')
    model_path.parent.mkdir(parents=True, exist_ok=True)
    with open(model_path, 'wb') as f:
        pickle.dump(final_model, f)

    print(f'Model trained for {strategy_name}')
    print(f'Cross-val accuracy: {avg_score:.3f}')
    print(f'Saved to: {model_path}')

    return {
        'strategy': strategy_name,
        'accuracy': avg_score,
        'cv_scores': scores,
        'samples_trained': len(df),
        'features': features,
        'model_path': str(model_path),
        'trained_utc': datetime.utcnow().isoformat()
    }, 'ok'


if __name__ == '__main__':
    print('=== Strategy ML Readiness ===')
    report = check_training_readiness()
    for name, stats in report['strategies'].items():
        print(f'{name}: {stats["progress"]} trades | Win rate: {stats["win_rate"]*100:.1f}% | Ready: {stats["ready_for_ml"]}')
