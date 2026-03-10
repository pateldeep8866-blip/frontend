"""Hybrid research pipeline for QUANT_LAB.

Research-only utilities to combine structured market data with curated web signals,
score source quality, extract events, and blend scores with regime-aware weights.
"""

from .hybrid_pipeline import HybridResearchPipeline

__all__ = ["HybridResearchPipeline"]
