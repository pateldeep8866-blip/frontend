export const dynamic = "force-static";

import { NextResponse } from "next/server";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readFmt(v) {
  if (v && typeof v === "object" && "raw" in v) return v.raw;
  return v;
}

function pick(...vals) {
  for (const v of vals) {
    const n = toNum(readFmt(v));
    if (n != null) return n;
  }
  return null;
}

function pct(v) {
  const n = toNum(v);
  if (n == null) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function getHoldings(topHoldings) {
  const rows = Array.isArray(topHoldings?.holdings) ? topHoldings.holdings : [];
  return rows
    .map((h) => ({
      symbol: String(readFmt(h?.symbol) || "").toUpperCase(),
      name: String(readFmt(h?.holdingName) || ""),
      weightPct: pct(readFmt(h?.holdingPercent)),
    }))
    .filter((h) => h.symbol || h.name)
    .slice(0, 10);
}

function getAllocations(topHoldings, key) {
  const rows = Array.isArray(topHoldings?.[key]) ? topHoldings[key] : [];
  return rows
    .map((x) => ({
      name: String(readFmt(x?.name) || readFmt(x?.type) || ""),
      weightPct: pct(readFmt(x?.y) ?? readFmt(x?.value)),
    }))
    .filter((x) => x.name)
    .slice(0, 12);
}

function yahooHeaders() {
  return {
    "user-agent": "ArthastraAI/1.0 (support@arthastraai.com)",
    accept: "application/json,text/plain,*/*",
  };
}

function looksLikeFundSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  return /^[A-Z]{5}X$/.test(s) || s.endsWith(".MF");
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = String(searchParams.get("symbol") || "")
      .trim()
      .toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const modules = [
      "quoteType",
      "price",
      "summaryDetail",
      "defaultKeyStatistics",
      "fundProfile",
      "topHoldings",
      "fundPerformance",
      "assetProfile",
    ].join(",");

    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${encodeURIComponent(modules)}`;
    const res = await fetch(url, { cache: "no-store", headers: yahooHeaders() });
    const data = await res.json().catch(() => ({}));
    const result = data?.quoteSummary?.result?.[0] || {};

    const quoteFallbackUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const quoteFallbackRes = await fetch(quoteFallbackUrl, { cache: "no-store", headers: yahooHeaders() });
    const quoteFallbackData = await quoteFallbackRes.json().catch(() => ({}));
    const quoteFallback = quoteFallbackData?.quoteResponse?.result?.[0] || {};

    if (!res.ok || !result || Object.keys(result).length === 0) {
      const fallbackType = String(quoteFallback?.quoteType || "").toUpperCase();
      const fallbackIsFund =
        fallbackType.includes("ETF") ||
        fallbackType.includes("MUTUALFUND") ||
        fallbackType.includes("MONEYMARKET") ||
        looksLikeFundSymbol(symbol);

      if (!fallbackIsFund) {
        return NextResponse.json({ symbol, isFund: false }, { status: 200 });
      }

      return NextResponse.json(
        {
          symbol,
          isFund: true,
          source: "Yahoo Finance",
          overview: {
            quoteType: fallbackType || "FUND",
            name: String(quoteFallback?.longName || quoteFallback?.shortName || symbol),
            category: "",
            fundFamily: "",
            legalType: "",
            benchmark: "",
            inceptionDate: null,
            totalAssets: null,
            expenseRatio: null,
            netExpenseRatio: null,
            turnoverRatio: null,
            beta3Y: null,
            alpha3Y: null,
            sharpe3Y: null,
            ytdReturnPct: null,
            oneYearReturnPct: null,
            threeYearReturnPct: null,
            fiveYearReturnPct: null,
            tenYearReturnPct: null,
            yieldPct: null,
            secYieldPct: null,
            avgDailyVolume: toNum(quoteFallback?.averageDailyVolume3Month),
            navPrice: toNum(quoteFallback?.navPrice),
            premiumToNavPct:
              (() => {
                const nav = toNum(quoteFallback?.navPrice);
                const mkt = toNum(quoteFallback?.regularMarketPrice);
                if (nav == null || nav === 0 || mkt == null) return null;
                return ((mkt - nav) / nav) * 100;
              })(),
            numberOfHoldings: null,
            avgMaturityYears: null,
            durationYears: null,
          },
          topHoldings: [],
          sectorAllocation: [],
          countryAllocation: [],
          bondRatings: [],
        },
        { status: 200 }
      );
    }

    const quoteType = String(readFmt(result?.quoteType?.quoteType) || quoteFallback?.quoteType || "").toUpperCase();
    const shortName = String(readFmt(result?.price?.shortName) || readFmt(result?.price?.longName) || symbol);
    const category = String(readFmt(result?.fundProfile?.categoryName) || "");
    const family = String(readFmt(result?.fundProfile?.family) || "");
    const legalType = String(readFmt(result?.fundProfile?.legalType) || "");

    const hasFundSignals =
      quoteType.includes("ETF") ||
      quoteType.includes("MUTUALFUND") ||
      quoteType.includes("MONEYMARKET") ||
      Boolean(category) ||
      Boolean(family) ||
      Boolean(result?.topHoldings?.holdings) ||
      looksLikeFundSymbol(symbol);

    if (!hasFundSignals) {
      return NextResponse.json({ symbol, isFund: false }, { status: 200 });
    }

    const summaryDetail = result?.summaryDetail || {};
    const stats = result?.defaultKeyStatistics || {};
    const perf = result?.fundPerformance || {};
    const topHoldings = result?.topHoldings || {};

    const overview = {
      quoteType,
      name: shortName,
      category,
      fundFamily: family,
      legalType,
      benchmark: String(
        readFmt(result?.fundProfile?.benchmark) ||
          readFmt(perf?.benchmark) ||
          ""
      ),
      inceptionDate: readFmt(result?.fundProfile?.inceptionDate) || null,
      totalAssets: pick(summaryDetail?.totalAssets, stats?.totalAssets),
      expenseRatio: pick(summaryDetail?.annualReportExpenseRatio, stats?.annualReportExpenseRatio),
      netExpenseRatio: pick(stats?.netExpenseRatio),
      turnoverRatio: pick(stats?.annualHoldingsTurnover, summaryDetail?.annualHoldingsTurnover),
      beta3Y: pick(stats?.beta3Year),
      alpha3Y: pick(stats?.alpha3Year),
      sharpe3Y: pick(stats?.threeYearAverageReturn ? null : stats?.sharpeRatio), // reserved if present
      ytdReturnPct: pct(pick(perf?.ytdReturn)),
      oneYearReturnPct: pct(pick(perf?.oneYearTotalReturn, perf?.returns?.oneYear)),
      threeYearReturnPct: pct(pick(perf?.threeYearTotalReturn, perf?.returns?.threeYear)),
      fiveYearReturnPct: pct(pick(perf?.fiveYearTotalReturn, perf?.returns?.fiveYear)),
      tenYearReturnPct: pct(pick(perf?.tenYearTotalReturn, perf?.returns?.tenYear)),
      yieldPct: pct(pick(summaryDetail?.yield, summaryDetail?.trailingAnnualDividendYield, stats?.yield)),
      secYieldPct: pct(pick(stats?.yield, result?.fundProfile?.yield)),
      avgDailyVolume: pick(summaryDetail?.averageDailyVolume10Day, summaryDetail?.averageVolume),
      navPrice: pick(summaryDetail?.navPrice),
      navChangePct: pct(pick(summaryDetail?.navPrice ? null : null)),
      premiumToNavPct:
        (() => {
          const nav = pick(summaryDetail?.navPrice);
          const mkt = pick(result?.price?.regularMarketPrice);
          if (nav == null || nav === 0 || mkt == null) return null;
          return ((mkt - nav) / nav) * 100;
        })(),
      numberOfHoldings: pick(topHoldings?.holdingsCount, stats?.holdingsCount),
      avgMaturityYears: pick(topHoldings?.bondRatings?.averageMaturity, stats?.averageMaturity),
      durationYears: pick(topHoldings?.bondRatings?.effectiveDuration, stats?.duration),
    };

    return NextResponse.json({
      symbol,
      isFund: true,
      source: "Yahoo Finance",
      overview,
      topHoldings: getHoldings(topHoldings),
      sectorAllocation: getAllocations(topHoldings, "sectorWeightings"),
      countryAllocation: getAllocations(topHoldings, "countryWeightings"),
      bondRatings: getAllocations(topHoldings, "bondRatings"),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Fund insights fetch failed", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
