# assets/base_asset.py — Abstract base for all asset-class models
#
# Every asset class (crypto, equities, fx, futures) implements this interface.
# The engine orchestrates via this ABC; it never calls asset-specific code directly.

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from core.candidate import TradeCandidateRecord


class BaseAssetModel(ABC):
    """
    Contract for an asset-class model.

    Responsibilities:
      - scan(): produce TradeCandidateRecord list from market data
      - estimate_fees(): venue + asset-class specific round-trip fee
      - estimate_slippage(): slippage from order book depth + size
      - validate_order(): pre-trade rule check (e.g. PDT, tick size)
      - exit_rules(): determine whether an open position should exit
    """

    @property
    @abstractmethod
    def asset_class(self) -> str:
        """Return the asset class string, e.g. 'crypto', 'equities'."""
        ...

    @property
    @abstractmethod
    def supported_strategies(self) -> list[str]:
        """List of strategy names this asset class supports."""
        ...

    @abstractmethod
    def scan(
        self,
        market_data: dict,          # {symbol: {bid, ask, last, bids, asks, ...}}
        regime:      dict,          # output of RegimeDetector.detect()
        candles:     Optional[dict] = None,   # {symbol: [candle, ...]}
    ) -> list[TradeCandidateRecord]:
        """
        Scan market_data and return a list of trade candidates.
        Each candidate must have ev, p_win, avg_win, avg_loss stamped.
        """
        ...

    @abstractmethod
    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        """
        Return estimated round-trip fee fraction for this asset/venue/order_type.
        e.g. 0.0052 = 0.52% round-trip
        """
        ...

    @abstractmethod
    def estimate_slippage(
        self,
        symbol:    str,
        order_book: dict,   # {"bids": [[p,q],...], "asks": [[p,q],...]}
        size_usd:  float,
        side:      str,     # "buy" | "sell"
    ) -> float:
        """
        Return estimated slippage fraction for this order size.
        """
        ...

    @abstractmethod
    def validate_order(
        self,
        candidate: TradeCandidateRecord,
        balance:   float,
    ) -> tuple[bool, str]:
        """
        Final pre-trade validation.
        Returns (approved: bool, reason: str).
        """
        ...

    @abstractmethod
    def exit_rules(
        self,
        position:    dict,       # open position dict from PositionManager
        market_data: dict,       # current market snapshot for this symbol
        regime:      dict,
    ) -> Optional[str]:
        """
        Check whether an open position should exit.
        Returns exit_reason string, or None if no exit triggered.
        """
        ...

    # ── Default helpers available to all subclasses ───────────────────────────

    @staticmethod
    def _book_slippage(order_book: dict, size_usd: float, side: str) -> float:
        """
        Walk the order book to estimate slippage for a given USD notional.
        Returns slippage as a fraction of mid price.
        """
        bids = order_book.get("bids", [])
        asks = order_book.get("asks", [])
        levels = asks if side == "buy" else bids

        if not levels:
            return 0.005  # default 50 bps if no book

        # Mid price
        best_bid = bids[0][0] if bids else 0
        best_ask = asks[0][0] if asks else 0
        mid = (best_bid + best_ask) / 2 if best_bid and best_ask else levels[0][0]

        # Walk the book
        filled_usd   = 0.0
        weighted_px  = 0.0
        for price, qty in levels:
            level_usd = price * qty
            take_usd  = min(level_usd, size_usd - filled_usd)
            weighted_px += price * (take_usd / size_usd) if size_usd > 0 else 0
            filled_usd += take_usd
            if filled_usd >= size_usd:
                break

        if mid == 0 or weighted_px == 0:
            return 0.001
        return abs(weighted_px - mid) / mid
