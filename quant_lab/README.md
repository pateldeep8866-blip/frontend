# QUANT_LAB

Purpose:
- QUANT_LAB is an isolated financial research environment.
- It has NO execution authority and NO runtime connection to YUNI.
- Default mode is paper-only research and deterministic reporting.

Non-negotiables:
- QUANT_LAB must never import from YUNI.
- YUNI may call QUANT_LAB later via a narrow interface (promotion gate required).
- No live trading. No unattended actions. Audit-first.

Promotion Gate (into YUNI):
- Deterministic backtests (data hash + config hash)
- Walk-forward / out-of-sample validation
- Risk controls + kill-switch semantics
- Reproducible reports + immutable paper ledger
