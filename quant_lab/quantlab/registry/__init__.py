"""
SQLite experiment registry for QUANT_LAB.

Design goals:
- Append-only (no UPDATE/DELETE).
- Deterministic logging: uses run-pack manifest + metrics as source of truth.
- Research/paper-only: no live execution logic.
"""

from __future__ import annotations

from quantlab.registry.db import RegistryDB, registry_path
from quantlab.registry.writer import RegistryWriter

__all__ = [
    "RegistryDB",
    "RegistryWriter",
    "registry_path",
]

