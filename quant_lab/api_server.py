#!/usr/bin/env python3
"""Lightweight research API for QUANT_LAB.

Run:
  python api_server.py

Env:
  RESEARCH_API_HOST=0.0.0.0
  RESEARCH_API_PORT=8001
  RESEARCH_API_ALLOWED_ORIGINS=http://localhost:3000,https://www.arthastraai.com
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import yfinance as yf


def _clean_ticker(raw: str) -> str:
    ticker = str(raw or "").upper().strip()
    ticker = re.sub(r"[^A-Z0-9.=\-]", "", ticker)
    return ticker[:12]


def _safe_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def _calc_news_sentiment(news_items: list[dict[str, Any]]) -> dict[str, Any]:
    positive_words = {
        "beat",
        "surge",
        "growth",
        "upgrade",
        "record",
        "strong",
        "profit",
        "bull",
        "outperform",
    }
    negative_words = {
        "miss",
        "drop",
        "slump",
        "downgrade",
        "risk",
        "lawsuit",
        "weak",
        "loss",
        "bear",
        "cut",
    }

    score = 0
    for item in news_items:
        text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
        score += sum(1 for w in positive_words if w in text)
        score -= sum(1 for w in negative_words if w in text)

    label = "neutral"
    if score >= 2:
        label = "positive"
    elif score <= -2:
        label = "negative"

    return {
        "label": label,
        "score": score,
        "sample_size": len(news_items),
    }


def _recommendation(price_change_pct: float | None, sentiment_score: int, pe_ratio: float | None) -> tuple[str, int]:
    score = 0
    if price_change_pct is not None:
        if price_change_pct >= 2:
            score += 1
        elif price_change_pct <= -2:
            score -= 1
    if sentiment_score >= 2:
        score += 1
    elif sentiment_score <= -2:
        score -= 1
    if pe_ratio is not None and pe_ratio > 45:
        score -= 1

    if score >= 2:
        return "BUY", 76
    if score <= -2:
        return "REDUCE", 74
    return "HOLD", 68


def build_research_payload(ticker: str, report_type: str) -> dict[str, Any]:
    tk = yf.Ticker(ticker)
    info = tk.info if isinstance(tk.info, dict) else {}

    hist = tk.history(period="6mo", auto_adjust=False)
    closes = hist.get("Close") if hasattr(hist, "get") else None
    volumes = hist.get("Volume") if hasattr(hist, "get") else None

    latest_close = _safe_float(closes.iloc[-1]) if closes is not None and len(closes) else None
    prev_close = _safe_float(closes.iloc[-2]) if closes is not None and len(closes) > 1 else None
    change_pct = None
    if latest_close is not None and prev_close and prev_close > 0:
        change_pct = ((latest_close - prev_close) / prev_close) * 100

    avg_volume_30 = None
    if volumes is not None and len(volumes):
        try:
            avg_volume_30 = _safe_float(volumes.tail(30).mean())
        except Exception:
            avg_volume_30 = None

    current_volume = _safe_float(info.get("volume")) or (_safe_float(volumes.iloc[-1]) if volumes is not None and len(volumes) else None)
    market_cap = _safe_float(info.get("marketCap"))
    pe_ratio = _safe_float(info.get("trailingPE"))
    week_high = _safe_float(info.get("fiftyTwoWeekHigh"))
    week_low = _safe_float(info.get("fiftyTwoWeekLow"))

    raw_news = tk.news if isinstance(getattr(tk, "news", None), list) else []
    news_items: list[dict[str, Any]] = []
    for n in raw_news[:8]:
        content = n.get("content") or {}
        title = str(content.get("title") or n.get("title") or "").strip()
        summary = str(content.get("summary") or "").strip()
        url = str(content.get("canonicalUrl", {}).get("url") or n.get("link") or "").strip()
        provider = str(content.get("provider", {}).get("displayName") or n.get("publisher") or "Unknown")
        if title:
            news_items.append(
                {
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "publisher": provider,
                }
            )

    sentiment = _calc_news_sentiment(news_items)
    reco, confidence = _recommendation(change_pct, int(sentiment["score"]), pe_ratio)

    company_name = str(info.get("shortName") or info.get("longName") or ticker)
    sector = str(info.get("sector") or "Unknown sector")

    quick_summary = (
        f"{company_name} ({ticker}) is trading around ${latest_close:.2f} with a "
        f"{change_pct:+.2f}% daily move. Sentiment is {sentiment['label']} based on recent headlines."
        if latest_close is not None and change_pct is not None
        else f"{company_name} ({ticker}) currently has limited intraday data; use headline and valuation context with caution."
    )

    full_summary = (
        f"{company_name} ({ticker}) operates in {sector}. Price action over the last six months shows "
        f"a 52-week range of ${week_low:.2f} to ${week_high:.2f} with current momentum at {change_pct:+.2f}% today. "
        f"News flow is {sentiment['label']} and volume context is "
        f"{('elevated' if current_volume and avg_volume_30 and current_volume > avg_volume_30 * 1.2 else 'normal')} "
        f"versus 30-day average."
        if latest_close is not None and week_low is not None and week_high is not None and change_pct is not None
        else quick_summary
    )

    summary = full_summary if report_type == "full" else quick_summary

    bull_case = [
        "Business quality and market position support longer-duration earnings growth.",
        "Headline sentiment is not net-negative, which can stabilize short-term positioning.",
        "If execution continues, valuation can be justified by forward cash-flow growth.",
    ]
    bear_case = [
        "Macro rate and liquidity shifts can compress valuation multiples quickly.",
        "Single-name concentration and crowded positioning increase drawdown risk.",
        "Negative guidance revisions can override recent technical momentum.",
    ]
    key_risks = [
        "Earnings miss or weaker forward guidance.",
        "Regulatory or legal overhang affecting sector multiples.",
        "Market-wide risk-off regime causing correlation spikes.",
    ]

    financial_highlights = {
        "price": latest_close,
        "daily_change_pct": change_pct,
        "market_cap": market_cap,
        "pe_ratio": pe_ratio,
        "volume": current_volume,
        "avg_volume_30d": avg_volume_30,
        "fifty_two_week_low": week_low,
        "fifty_two_week_high": week_high,
        "sector": sector,
    }

    sources = [
        {
            "name": "Yahoo Finance Quote",
            "url": f"https://finance.yahoo.com/quote/{ticker}",
        },
        {
            "name": "Yahoo Finance History",
            "url": f"https://finance.yahoo.com/quote/{ticker}/history",
        },
    ]
    for item in news_items[:5]:
        if item.get("url"):
            sources.append({"name": item.get("publisher") or "News", "url": item["url"]})

    return {
        "ticker": ticker,
        "summary": summary,
        "bull_case": bull_case,
        "bear_case": bear_case,
        "key_risks": key_risks,
        "financial_highlights": financial_highlights,
        "news_sentiment": sentiment,
        "recommendation": reco,
        "confidence": confidence,
        "sources": sources,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


class ResearchHandler(BaseHTTPRequestHandler):
    server_version = "QUANT_LAB-ResearchAPI/1.0"

    def _allowed_origin(self) -> str:
        configured = os.getenv("RESEARCH_API_ALLOWED_ORIGINS", "*")
        if configured.strip() == "*":
            return "*"

        allow = {x.strip() for x in configured.split(",") if x.strip()}
        req = self.headers.get("Origin", "")
        return req if req in allow else next(iter(allow), "")

    def _set_headers(self, status: int = 200, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", self._allowed_origin())
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._set_headers(status=204)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/research":
            self._set_headers(status=404)
            self.wfile.write(json.dumps({"error": "Not found"}).encode("utf-8"))
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self._set_headers(status=400)
            self.wfile.write(json.dumps({"error": "Invalid JSON payload"}).encode("utf-8"))
            return

        ticker = _clean_ticker(payload.get("ticker", ""))
        report_type = str(payload.get("type", "quick")).lower().strip()
        if report_type not in {"quick", "full"}:
            report_type = "quick"

        if not ticker:
            self._set_headers(status=400)
            self.wfile.write(json.dumps({"error": "ticker is required"}).encode("utf-8"))
            return

        try:
            result = build_research_payload(ticker, report_type)
            self._set_headers(status=200)
            self.wfile.write(json.dumps(result).encode("utf-8"))
        except Exception as exc:
            self._set_headers(status=500)
            self.wfile.write(
                json.dumps(
                    {
                        "ticker": ticker,
                        "error": "Research generation failed",
                        "detail": str(exc),
                    }
                ).encode("utf-8")
            )


def main() -> None:
    host = os.getenv("RESEARCH_API_HOST", "0.0.0.0")
    port = int(os.getenv("RESEARCH_API_PORT", "8001"))
    server = ThreadingHTTPServer((host, port), ResearchHandler)
    print(f"Research API listening on http://{host}:{port}/api/research")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
