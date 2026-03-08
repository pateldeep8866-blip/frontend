# scanner/spread_scanner.py — Cross-exchange arbitrage detection

from config import EXCHANGE_FEES, SPREAD_MIN_PCT


def scan_spreads(cache: dict) -> list:
    opportunities = []

    all_symbols: set = set()
    for ex_data in cache.values():
        all_symbols.update(ex_data.keys())

    for symbol in all_symbols:
        price_points = []
        for ex_name, ex_data in cache.items():
            row = ex_data.get(symbol, {})
            ask = row.get("ask")
            bid = row.get("bid")
            if ask and bid and ask > 0 and bid > 0:
                price_points.append((ex_name, ask, bid))

        for buy_ex, buy_ask, _ in price_points:
            for sell_ex, _, sell_bid in price_points:
                if buy_ex == sell_ex:
                    continue

                raw_edge_pct = ((sell_bid - buy_ask) / buy_ask) * 100
                fee_pct = (EXCHANGE_FEES.get(buy_ex, 0) + EXCHANGE_FEES.get(sell_ex, 0)) * 100
                net_edge_pct = raw_edge_pct - fee_pct

                if net_edge_pct >= SPREAD_MIN_PCT:
                    opportunities.append({
                        "type":          "cross_exchange_arb",
                        "symbol":        symbol,
                        "buy_exchange":  buy_ex,
                        "sell_exchange": sell_ex,
                        "buy_price":     buy_ask,
                        "sell_price":    sell_bid,
                        "raw_edge_pct":  round(raw_edge_pct, 4),
                        "net_edge_pct":  round(net_edge_pct, 4),
                    })

    return opportunities
