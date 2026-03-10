from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse


DOMAIN_BASE_CONFIDENCE = {
    "sec.gov": 0.98,
    "fred.stlouisfed.org": 0.97,
    "federalreserve.gov": 0.97,
    "ecb.europa.eu": 0.96,
    "bls.gov": 0.96,
    "treasury.gov": 0.95,
    "stooq.com": 0.92,
    "finance.yahoo.com": 0.83,
    "reuters.com": 0.9,
    "wsj.com": 0.88,
    "bloomberg.com": 0.9,
    "marketwatch.com": 0.8,
}


@dataclass
class SourceAssessment:
    domain: str
    base_confidence: float
    recency_score: float
    confidence: float


def _parse_dt(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def assess_source(url: str, published_utc: Optional[str], now_utc: Optional[datetime] = None) -> SourceAssessment:
    now = now_utc or datetime.now(timezone.utc)
    domain = (urlparse(url).netloc or "").lower().replace("www.", "")
    base = DOMAIN_BASE_CONFIDENCE.get(domain, 0.72)

    recency = 0.55
    dt = _parse_dt(published_utc)
    if dt is not None:
        age_hours = max(0.0, (now - dt).total_seconds() / 3600.0)
        if age_hours <= 6:
            recency = 1.0
        elif age_hours <= 24:
            recency = 0.9
        elif age_hours <= 72:
            recency = 0.75
        elif age_hours <= 168:
            recency = 0.6
        else:
            recency = 0.45

    conf = max(0.0, min(1.0, 0.65 * base + 0.35 * recency))
    return SourceAssessment(domain=domain, base_confidence=base, recency_score=recency, confidence=conf)
