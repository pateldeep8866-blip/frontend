from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple


EVENT_KEYWORDS: List[Tuple[str, List[str], int, str]] = [
    ("earnings", ["earnings", "eps", "guidance", "revenue beat", "missed estimates"], 4, "short"),
    ("guidance_cut", ["guidance cut", "lowered guidance", "warning", "profit warning"], -4, "short"),
    ("regulation", ["sec", "regulation", "antitrust", "fine", "approval", "ban"], -1, "medium"),
    ("lawsuit", ["lawsuit", "sued", "settlement", "class action"], -3, "medium"),
    ("macro_policy", ["fed", "ecb", "rate hike", "rate cut", "cpi", "inflation", "jobs report"], 0, "medium"),
    ("m_and_a", ["acquire", "acquisition", "merger", "buyout"], 3, "medium"),
    ("product", ["launch", "new product", "partnership", "contract"], 2, "short"),
]

POS_WORDS = {"beat", "surge", "strong", "upgrade", "record", "growth", "bullish", "rally", "outperform"}
NEG_WORDS = {"miss", "downgrade", "weak", "drop", "bearish", "risk", "decline", "lawsuit", "cut"}


@dataclass
class ExtractedEvent:
    ticker: str
    event_type: str
    sentiment: float
    severity: float
    time_horizon: str
    title: str
    source_url: str
    source_domain: str
    published_utc: str
    source_confidence: float
    stale: bool


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_title(title: str) -> str:
    x = re.sub(r"\s+", " ", str(title or "").strip().lower())
    return x


def title_fingerprint(title: str) -> str:
    return hashlib.sha1(normalize_title(title).encode("utf-8")).hexdigest()


def classify_event(text: str) -> Tuple[str, float, str]:
    low = text.lower()
    for etype, keys, sev, horizon in EVENT_KEYWORDS:
        if any(k in low for k in keys):
            return etype, float(abs(sev)) / 5.0, horizon
    return "general_news", 0.35, "short"


def infer_sentiment(text: str) -> float:
    toks = set(re.findall(r"[a-zA-Z]+", text.lower()))
    pos = len(toks & POS_WORDS)
    neg = len(toks & NEG_WORDS)
    if pos == 0 and neg == 0:
        return 0.0
    raw = (pos - neg) / max(1, pos + neg)
    return max(-1.0, min(1.0, raw))


def extract_tickers(text: str, known_tickers: List[str]) -> List[str]:
    known = {t.upper() for t in known_tickers}
    found = set()
    caps = re.findall(r"\b[A-Z]{1,5}\b", text)
    for c in caps:
        if c in known:
            found.add(c)
    return sorted(found)


def extract_events_from_documents(documents: List[Dict[str, str]], known_tickers: List[str], stale_hours: int = 72) -> List[ExtractedEvent]:
    events: List[ExtractedEvent] = []
    now = datetime.now(timezone.utc)

    for doc in documents:
        title = str(doc.get("title") or "").strip()
        if not title:
            continue
        url = str(doc.get("url") or "")
        domain = str(doc.get("source_domain") or "")
        published = str(doc.get("published_utc") or _iso_now())
        conf = float(doc.get("source_confidence") or 0.7)

        dt = None
        try:
            dt = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except Exception:
            dt = None
        is_stale = True
        if dt is not None:
            age_h = (now - dt).total_seconds() / 3600.0
            is_stale = age_h > stale_hours

        etype, severity, horizon = classify_event(title)
        sent = infer_sentiment(title)
        tickers = extract_tickers(title, known_tickers)
        if not tickers:
            tickers = ["MACRO"] if etype == "macro_policy" else []
        for t in tickers:
            events.append(
                ExtractedEvent(
                    ticker=t,
                    event_type=etype,
                    sentiment=sent,
                    severity=severity,
                    time_horizon=horizon,
                    title=title,
                    source_url=url,
                    source_domain=domain,
                    published_utc=published,
                    source_confidence=conf,
                    stale=is_stale,
                )
            )

    return events
