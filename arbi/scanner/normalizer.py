# scanner/normalizer.py

def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().replace("-", "/")

def split_symbol(symbol: str) -> tuple:
    symbol = normalize_symbol(symbol)
    base, quote = symbol.split("/")
    return base, quote

def symbol_record(exchange: str, symbol: str) -> dict:
    base, quote = split_symbol(symbol)
    return {
        "exchange": exchange,
        "symbol":   normalize_symbol(symbol),
        "base":     base,
        "quote":    quote,
    }
