# scanner/triangular_scanner.py — Intra-exchange triangular arbitrage

from itertools import permutations
from config import TRI_ARB_MIN_PCT, EXCHANGE_FEES


def _build_price_map(exchange_rows: dict) -> dict:
    prices = {}
    for symbol, row in exchange_rows.items():
        last = row.get("last")
        if last and last > 0:
            prices[symbol] = last
    return prices


def scan_triangular(exchange_name: str, exchange_rows: dict) -> list:
    findings = []
    prices   = _build_price_map(exchange_rows)
    fee_pct  = EXCHANGE_FEES.get(exchange_name, 0) * 100

    assets: set = set()
    for symbol in prices:
        try:
            base, quote = symbol.split("/")
            assets.add(base)
            assets.add(quote)
        except ValueError:
            continue

    for a, b, c in permutations(assets, 3):
        s1 = f"{a}/{b}"
        s2 = f"{b}/{c}"
        s3 = f"{c}/{a}"

        if s1 not in prices or s2 not in prices or s3 not in prices:
            continue

        p1, p2, p3 = prices[s1], prices[s2], prices[s3]
        if not (p1 and p2 and p3):
            continue

        final         = (1.0 / p1 / p2) * p3
        gross_edge    = (final - 1.0) * 100
        net_edge      = gross_edge - (fee_pct * 3)

        if net_edge >= TRI_ARB_MIN_PCT:
            findings.append({
                "type":          "triangular_arb",
                "exchange":      exchange_name,
                "path":          [a, b, c, a],
                "gross_edge_pct": round(gross_edge, 4),
                "net_edge_pct":   round(net_edge, 4),
            })

    return findings


def scan_all_triangular(cache: dict) -> list:
    findings = []
    for exchange_name, rows in cache.items():
        findings.extend(scan_triangular(exchange_name, rows))
    return findings
