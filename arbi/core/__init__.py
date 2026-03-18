# core/__init__.py — Universal quantitative engine
# Import key types for convenience
from core.candidate import TradeCandidateRecord, AssetClass, OrderSide
from core.ev_model import EVModel
from core.features import FeatureCalculator
from core.signals import SignalEngine
from core.sizer import TradeSizer
from core.regime import RegimeDetector
from core.allocator import PortfolioAllocator
from core.performance import PerformanceTracker

__all__ = [
    "TradeCandidateRecord",
    "AssetClass",
    "OrderSide",
    "EVModel",
    "FeatureCalculator",
    "SignalEngine",
    "TradeSizer",
    "RegimeDetector",
    "PortfolioAllocator",
    "PerformanceTracker",
]
