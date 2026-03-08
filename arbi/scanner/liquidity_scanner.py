# scanner/liquidity_scanner.py — Order book imbalance signals

from config import LIQUIDITY_IMBALANCE_THRESHOLD


def scan_liquidity(cache: dict) -> list:
    findings = []

    for ex_name, ex_data in cache.items():
        for symbol, row in ex_data.items():
            bids = row.get("bids") or []
            asks = row.get("asks") or []

            if not bids or not asks:
                continue

            bid_vol = sum(level[1] for level in bids if len(level) >= 2)
            ask_vol = sum(level[1] for level in asks if len(level) >= 2)
            total   = bid_vol + ask_vol

            if total <= 0:
                continue

            imbalance = (bid_vol - ask_vol) / total

            if imbalance >= LIQUIDITY_IMBALANCE_THRESHOLD:
                signal = "BUY"
            elif imbalance <= -LIQUIDITY_IMBALANCE_THRESHOLD:
                signal = "SELL"
            else:
                signal = "HOLD"

            if signal != "HOLD":
                findings.append({
                    "type":       "liquidity_signal",
                    "exchange":   ex_name,
                    "symbol":     symbol,
                    "bid_volume": round(bid_vol, 4),
                    "ask_volume": round(ask_vol, 4),
                    "imbalance":  round(imbalance, 4),
                    "signal":     signal,
                })

    return findings
