import sys
import os
from pathlib import Path


# Ensure local packages are importable even if pytest uses importlib import mode.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# Operational default for tests: select a non-Yahoo provider explicitly.
os.environ.setdefault("QUANTLAB_DATA_PROVIDER", "alphavantage")
