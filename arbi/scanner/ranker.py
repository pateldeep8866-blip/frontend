# scanner/ranker.py — Score and rank all scanner opportunities

def rank_opportunities(items: list) -> list:
    ranked = []

    for item in items:
        score = 0.0
        t = item.get("type", "")

        if t == "cross_exchange_arb":
            score += item.get("net_edge_pct", 0) * 3.0

        elif t == "triangular_arb":
            score += item.get("net_edge_pct", 0) * 2.5

        elif t == "liquidity_signal":
            score += abs(item.get("imbalance", 0)) * 100

        elif t == "vol_breakout":
            score += item.get("volume_score", 0) * 10
            score += item.get("range_score",  0) * 20

        entry = dict(item)
        entry["score"] = round(score, 4)
        ranked.append(entry)

    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked
