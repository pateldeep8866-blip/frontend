from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Tuple
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from .event_extractor import extract_events_from_documents, normalize_title, title_fingerprint
from .instrument_registry import build_registry
from .memory import event_effectiveness, store_events
from .source_ranker import assess_source


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_pubdate(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return _iso_now()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return _iso_now()


def _fetch_rss(url: str, max_items: int = 8, timeout: float = 4.0) -> List[Dict[str, str]]:
    req = Request(url, headers={"User-Agent": "QUANT_LAB/1.0 (research)"})
    with urlopen(req, timeout=timeout) as resp:  # nosec B310
        raw = resp.read()
    root = ET.fromstring(raw)
    out: List[Dict[str, str]] = []

    for item in root.findall(".//item")[:max_items]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = _parse_pubdate(item.findtext("pubDate") or item.findtext("published") or "")
        if not title:
            continue
        out.append({"title": title, "url": link, "published_utc": pub})
    return out


def _yahoo_news_feed(symbol: str) -> str:
    return f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={quote_plus(symbol)}&region=US&lang=en-US"


def _curated_macro_feeds() -> List[str]:
    return [
        "https://www.federalreserve.gov/feeds/press_all.xml",
        "https://www.ecb.europa.eu/press/rss/press.xml",
        "https://www.sec.gov/news/pressreleases.rss",
    ]


class HybridResearchPipeline:
    """Structured-first + web-second hybrid research engine."""

    def run(
        self,
        universe: List[str],
        macro: Dict[str, Any],
        regime: str,
        asof: str,
        max_news_tickers: int = 8,
    ) -> Dict[str, Any]:
        registry = build_registry(universe)

        # 1) Structured data first.
        structured = {
            "instrument_registry": registry,
            "coverage": {
                "stocks": any(v["asset_class"] in {"stock", "etf"} for v in registry.values()),
                "crypto": any(v["asset_class"] == "crypto" for v in registry.values()),
                "bonds": any(v["asset_class"] == "bond_etf" for v in registry.values()),
                "metals": any(v["asset_class"] == "metal_etf" for v in registry.values()),
                "fx": any(v["asset_class"] in {"fx", "fx_index"} for v in registry.values()),
            },
            "macro_snapshot": {
                "vix": float(macro.get("vix", 0) or 0),
                "dxy": float(macro.get("dxy", 0) or 0),
                "tenYear": float(macro.get("tenYear", 0) or 0),
                "asof": asof,
                "regime": regime,
            },
        }

        # 2) Web research second (curated sources only).
        docs: List[Dict[str, Any]] = []
        tickers = [t for t in universe if str(t).upper() in registry][:max_news_tickers]

        for t in tickers:
            sym = str(t).upper()
            try:
                for d in _fetch_rss(_yahoo_news_feed(sym), max_items=4):
                    d["source_hint"] = "finance.yahoo.com"
                    d["ticker_hint"] = sym
                    docs.append(d)
            except Exception:
                continue

        for feed in _curated_macro_feeds():
            try:
                for d in _fetch_rss(feed, max_items=4):
                    d["source_hint"] = feed
                    d["ticker_hint"] = "MACRO"
                    docs.append(d)
            except Exception:
                continue

        # 7) Anti-noise controls: dedupe + stale suppression.
        dedup = {}
        for d in docs:
            title = normalize_title(d.get("title", ""))
            if not title:
                continue
            fp = title_fingerprint(title)
            if fp in dedup:
                continue
            dedup[fp] = d

        filtered_docs: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        for d in dedup.values():
            assess = assess_source(d.get("url") or d.get("source_hint", ""), d.get("published_utc"), now)
            entry = {
                "title": d.get("title", ""),
                "url": d.get("url", ""),
                "published_utc": d.get("published_utc", _iso_now()),
                "source_domain": assess.domain,
                "source_confidence": round(assess.confidence, 4),
                "source_base_confidence": round(assess.base_confidence, 4),
                "source_recency_score": round(assess.recency_score, 4),
            }
            # Remove stale low-confidence docs.
            if assess.recency_score < 0.5 and assess.confidence < 0.65:
                continue
            filtered_docs.append(entry)

        # 4) Entity/event extraction.
        events = extract_events_from_documents(filtered_docs, known_tickers=list(registry.keys()), stale_hours=72)

        # 5) Research memory persistence + effectiveness priors.
        stored_n = store_events(events, regime=regime, registry=registry)

        ticker_event_scores: Dict[str, float] = {}
        explainability: Dict[str, Dict[str, Any]] = {}
        for ev in events:
            if ev.stale:
                continue
            asset_class = registry.get(ev.ticker, {}).get("asset_class", "unknown")
            prior = event_effectiveness(ev.event_type, regime=regime, asset_class=asset_class)
            impact = ev.sentiment * ev.severity * ev.source_confidence * prior
            ticker_event_scores[ev.ticker] = ticker_event_scores.get(ev.ticker, 0.0) + impact
            explainability.setdefault(ev.ticker, {"top_events": []})
            explainability[ev.ticker]["top_events"].append(
                {
                    "event_type": ev.event_type,
                    "sentiment": ev.sentiment,
                    "severity": ev.severity,
                    "source": ev.source_domain,
                    "confidence": ev.source_confidence,
                    "impact": round(impact, 4),
                    "title": ev.title,
                    "url": ev.source_url,
                }
            )

        for t in list(explainability.keys()):
            explainability[t]["top_events"] = sorted(
                explainability[t]["top_events"], key=lambda x: abs(float(x.get("impact", 0))), reverse=True
            )[:3]

        source_stats: Dict[str, int] = {}
        for d in filtered_docs:
            dom = d["source_domain"]
            source_stats[dom] = source_stats.get(dom, 0) + 1

        return {
            "generated_utc": _iso_now(),
            "regime": regime,
            "structured_data": structured,
            "web_research": {
                "document_count": len(filtered_docs),
                "documents": filtered_docs[:30],
            },
            "events": [asdict(e) for e in events[:60]],
            "ticker_event_scores": {k: round(v, 4) for k, v in ticker_event_scores.items()},
            "source_stats": source_stats,
            "memory": {
                "stored_events": stored_n,
            },
            "explainability": explainability,
        }

    def blend_scores(self, all_scores: List[Dict[str, Any]], macro: Dict[str, Any], regime: str, research_pack: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """6) Regime-aware blending of quant + event + macro scores."""
        weights_map = {
            "risk_on": {"quant": 0.65, "event": 0.20, "macro": 0.15},
            "neutral": {"quant": 0.60, "event": 0.20, "macro": 0.20},
            "caution": {"quant": 0.52, "event": 0.28, "macro": 0.20},
            "risk_off": {"quant": 0.46, "event": 0.34, "macro": 0.20},
            "unknown": {"quant": 0.60, "event": 0.20, "macro": 0.20},
        }
        w = weights_map.get(regime, weights_map["unknown"])

        vix = float(macro.get("vix", 20) or 20)
        dxy = float(macro.get("dxy", 100) or 100)
        ten = float(macro.get("tenYear", 4.0) or 4.0)
        macro_score = ((20 - vix) / 20.0) + ((100 - dxy) / 100.0) + ((4.0 - ten) / 4.0)
        macro_score = max(-1.0, min(1.0, macro_score / 3.0))

        event_scores = research_pack.get("ticker_event_scores", {}) if isinstance(research_pack, dict) else {}
        explain = research_pack.get("explainability", {}) if isinstance(research_pack, dict) else {}

        enriched: List[Dict[str, Any]] = []
        for row in all_scores:
            ticker = str(row.get("ticker", "")).upper()
            quant = float(row.get("composite_score", 0.0) or 0.0)
            event = float(event_scores.get(ticker, 0.0) or 0.0)
            blended = w["quant"] * quant + w["event"] * event + w["macro"] * macro_score

            top_event = None
            inv = "No immediate invalidation trigger identified."
            top_events = explain.get(ticker, {}).get("top_events", []) if isinstance(explain.get(ticker, {}), dict) else []
            if top_events:
                top_event = top_events[0]
                if top_event.get("event_type") in {"guidance_cut", "lawsuit", "regulation"}:
                    inv = "Negative legal/regulatory or guidance shock can invalidate this signal quickly."
                elif top_event.get("event_type") == "macro_policy":
                    inv = "Policy-rate and inflation surprises can invalidate this setup."

            out = dict(row)
            out.update(
                {
                    "quant_score": round(quant, 6),
                    "event_score": round(event, 6),
                    "macro_score": round(macro_score, 6),
                    "blended_score": round(blended, 6),
                    "why": (
                        f"Blended score = quant({w['quant']:.2f}) + event({w['event']:.2f}) + macro({w['macro']:.2f})."
                        + (f" Top event: {top_event.get('event_type')} from {top_event.get('source')}" if top_event else "")
                    ),
                    "what_changed": "Event and macro overlays are now included on top of quant factors.",
                    "could_invalidate": inv,
                    "sources": [
                        {
                            "url": e.get("url"),
                            "source": e.get("source"),
                            "confidence": e.get("confidence"),
                        }
                        for e in top_events[:3]
                    ],
                }
            )
            enriched.append(out)

        enriched.sort(key=lambda x: float(x.get("blended_score", x.get("composite_score", 0.0))), reverse=True)
        return enriched, w
