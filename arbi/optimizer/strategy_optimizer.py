# optimizer/strategy_optimizer.py — Auto-tune strategy parameters via grid search

import itertools
import time
from utils.logger import get_logger

log = get_logger("optimizer")

# Parameter grid — add or narrow ranges as you learn what works
PARAM_GRID = {
    "breakout_window":          [10, 15, 20, 30],
    "spread_min_pct":           [0.10, 0.15, 0.20, 0.30],
    "liquidity_imbalance_threshold": [0.20, 0.25, 0.30, 0.40],
    "vol_volume_spike_threshold":    [1.5, 1.8, 2.0, 2.5],
}


def generate_configs() -> list:
    keys   = list(PARAM_GRID.keys())
    values = list(PARAM_GRID.values())
    return [dict(zip(keys, combo)) for combo in itertools.product(*values)]


def _score_config(config: dict, signal_log: list) -> float:
    """
    Score a config against historical signal records from the DB.
    signal_log: list of dicts with keys: signal_type, score, details, ts
    This is a simplified scorer — replace with real backtest engine later.
    """
    score = 0.0
    for sig in signal_log:
        details = sig.get("details") or {}
        edge    = details.get("net_edge_pct", 0) or 0

        # Breakout signals: favor longer lookback in trending markets
        if sig.get("signal_type") == "vol_breakout":
            if edge > config["vol_volume_spike_threshold"]:
                score += edge

        # Arb signals: favor tighter thresholds for frequent small profits
        elif sig.get("signal_type") in ("cross_exchange_arb", "triangular_arb"):
            if edge > config["spread_min_pct"]:
                score += edge

        # Liquidity signals: reward strong imbalance captures
        elif sig.get("signal_type") == "liquidity_signal":
            imbalance = abs(details.get("imbalance", 0) or 0)
            if imbalance > config["liquidity_imbalance_threshold"]:
                score += imbalance * 100

    return score


def optimize(signal_log: list) -> dict:
    """
    Run grid search over all parameter combinations.
    Returns the best-performing config dict.
    """
    if not signal_log:
        log.warning("No signal history available for optimization")
        return {}

    configs    = generate_configs()
    best_score  = -1e9
    best_config = configs[0]

    log.info("Running optimizer over %d configs on %d signals...",
             len(configs), len(signal_log))
    t0 = time.time()

    for config in configs:
        score = _score_config(config, signal_log)
        if score > best_score:
            best_score  = score
            best_config = config

    elapsed = time.time() - t0
    log.info("Optimization complete in %.2fs. Best score=%.4f, config=%s",
             elapsed, best_score, best_config)

    return best_config


def apply_config(config: dict) -> None:
    """
    Push optimized parameters back into config module at runtime.
    NOTE: This does not persist to disk — restart resets to config.py defaults.
    For persistence, write config back to config.py or a separate JSON file.
    """
    import config as cfg

    if "spread_min_pct" in config:
        cfg.SPREAD_MIN_PCT = config["spread_min_pct"]

    if "liquidity_imbalance_threshold" in config:
        cfg.LIQUIDITY_IMBALANCE_THRESHOLD = config["liquidity_imbalance_threshold"]

    if "vol_volume_spike_threshold" in config:
        cfg.VOL_VOLUME_SPIKE_THRESHOLD = config["vol_volume_spike_threshold"]

    log.info("Applied optimized config: %s", config)
