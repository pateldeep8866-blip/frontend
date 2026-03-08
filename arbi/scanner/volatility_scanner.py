# scanner/volatility_scanner.py — Detects pairs waking up with volume/range expansion

from config import VOL_VOLUME_SPIKE_THRESHOLD


def scan_volatility(cache: dict) -> list:
    findings = []

    for ex_name, ex_data in cache.items():
        for symbol, row in ex_data.items():
            bid  = row.get("bid")
            ask  = row.get("ask")
            qvol = row.get("quote_volume")

            if not bid or not ask or not qvol or bid <= 0:
                continue

            spread_pct   = ((ask - bid) / bid) * 100
            volume_score = qvol / 1_000_000
            range_score  = spread_pct

            if volume_score >= VOL_VOLUME_SPIKE_THRESHOLD / 2 and range_score > 0.03:
                findings.append({
                    "type":         "vol_breakout",
                    "exchange":     ex_name,
                    "symbol":       symbol,
                    "volume_score": round(volume_score, 4),
                    "range_score":  round(range_score, 4),
                    "signal":       "BUY" if spread_pct > 0 else "HOLD",
                })

    return findings
