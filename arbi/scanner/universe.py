# scanner/universe.py

from config import EXCHANGES, START_SYMBOLS

def get_exchange_names() -> list:
    return EXCHANGES[:]

def get_symbols() -> list:
    return START_SYMBOLS[:]

def build_universe() -> dict:
    return {"exchanges": get_exchange_names(), "symbols": get_symbols()}
