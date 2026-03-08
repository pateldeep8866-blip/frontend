import { NextResponse } from "next/server";

let tickerIndexCache = null;
let tickerIndexFetchedAt = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cik10(v) {
  const n = String(v ?? "").replace(/\D/g, "");
  if (!n) return "";
  return n.padStart(10, "0");
}

function secHeaders() {
  const ua =
    process.env.SEC_API_USER_AGENT ||
    "ArthastraAI/1.0 (support@arthastraai.com)";
  return {
    "User-Agent": ua,
    Accept: "application/json",
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store", headers: secHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`SEC fetch failed (${res.status})`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function getTickerIndex() {
  const now = Date.now();
  if (tickerIndexCache && now - tickerIndexFetchedAt < ONE_DAY_MS) {
    return tickerIndexCache;
  }

  const data = await fetchJson("https://www.sec.gov/files/company_tickers.json");
  const values = Object.values(data || {});
  const rows = values
    .map((item) => {
      const ticker = String(item?.ticker || "").trim().toUpperCase();
      const title = String(item?.title || "").trim();
      const cik = cik10(item?.cik_str);
      if (!ticker || !title || !cik) return null;
      return {
        ticker,
        title,
        titleLc: title.toLowerCase(),
        cik,
      };
    })
    .filter(Boolean);

  tickerIndexCache = rows;
  tickerIndexFetchedAt = now;
  return rows;
}

function pickTickerEntry(rows, query) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return null;

  const exactTicker = rows.find((r) => r.ticker === q);
  if (exactTicker) return exactTicker;

  const qLc = q.toLowerCase();
  const exactTitle = rows.find((r) => r.titleLc === qLc);
  if (exactTitle) return exactTitle;

  const startsTicker = rows.find((r) => r.ticker.startsWith(q));
  if (startsTicker) return startsTicker;

  const containsTitle = rows.find((r) => r.titleLc.includes(qLc));
  if (containsTitle) return containsTitle;

  return null;
}

function collectSeries(facts, tags = []) {
  if (!facts || typeof facts !== "object") return [];
  for (const key of tags) {
    const unitsObj = facts?.[key]?.units || {};
    const units = Object.values(unitsObj || {});
    const points = units.flat().filter(Boolean);
    if (points.length) {
      return points
        .map((p) => ({
          val: num(p?.val),
          end: p?.end ? Date.parse(String(p.end)) : 0,
          filed: p?.filed ? Date.parse(String(p.filed)) : 0,
          form: String(p?.form || ""),
          fy: p?.fy ?? null,
          fp: p?.fp ?? null,
        }))
        .filter((p) => p.val != null)
        .sort((a, b) => (b.end || b.filed || 0) - (a.end || a.filed || 0));
    }
  }
  return [];
}

function latestValue(facts, tags) {
  const points = collectSeries(facts, tags);
  return points.length ? points[0].val : null;
}

function latestTwoValues(facts, tags) {
  const points = collectSeries(facts, tags);
  if (!points.length) return [null, null];
  const latest = points[0];
  const previous =
    points.find(
      (p, idx) =>
        idx > 0 &&
        ((p.fy != null && latest.fy != null && p.fy !== latest.fy) ||
          (p.end && latest.end && p.end !== latest.end))
    ) || null;
  return [latest?.val ?? null, previous?.val ?? null];
}

function yoyGrowth(facts, tags) {
  const [latest, previous] = latestTwoValues(facts, tags);
  if (latest == null || previous == null || previous === 0) return null;
  return (latest - previous) / Math.abs(previous);
}

function parseRecentFilings(submissions) {
  const recent = submissions?.filings?.recent || {};
  const forms = Array.isArray(recent?.form) ? recent.form : [];
  const filingDate = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
  const accessionNumber = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
  const reportDate = Array.isArray(recent?.reportDate) ? recent.reportDate : [];
  const primaryDocument = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];
  const items = [];

  for (let i = 0; i < forms.length; i += 1) {
    const form = String(forms[i] || "").trim();
    if (!form) continue;
    const accession = String(accessionNumber[i] || "").trim();
    const filing = String(filingDate[i] || "").trim();
    const report = String(reportDate[i] || "").trim();
    const doc = String(primaryDocument[i] || "").trim();
    const cikRaw = String(submissions?.cik || "").trim();
    const cik = cik10(cikRaw);
    const accessionNoDash = accession.replace(/-/g, "");
    const base = cik && accessionNoDash ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDash}` : "";
    const link = base && doc ? `${base}/${doc}` : "";
    items.push({
      form,
      filingDate: filing,
      reportDate: report,
      accession,
      link,
    });
  }

  return items.slice(0, 10);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = String(searchParams.get("symbol") || searchParams.get("q") || "")
      .trim()
      .toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const tickerRows = await getTickerIndex();
    const entry = pickTickerEntry(tickerRows, symbol);
    if (!entry) {
      return NextResponse.json({ error: "Ticker not found in SEC index", symbol }, { status: 404 });
    }

    const [submissions, companyFacts] = await Promise.all([
      fetchJson(`https://data.sec.gov/submissions/CIK${entry.cik}.json`),
      fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${entry.cik}.json`),
    ]);

    const usGaapFacts = companyFacts?.facts?.["us-gaap"] || {};

    const revenue = latestValue(usGaapFacts, [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "SalesRevenueNet",
    ]);
    const grossProfit = latestValue(usGaapFacts, ["GrossProfit"]);
    const operatingIncome = latestValue(usGaapFacts, ["OperatingIncomeLoss"]);
    const netIncome = latestValue(usGaapFacts, ["NetIncomeLoss"]);
    const assets = latestValue(usGaapFacts, ["Assets"]);
    const liabilities = latestValue(usGaapFacts, ["Liabilities"]);
    const equity = latestValue(usGaapFacts, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]);
    const cash = latestValue(usGaapFacts, ["CashAndCashEquivalentsAtCarryingValue"]);
    const currentAssets = latestValue(usGaapFacts, ["AssetsCurrent"]);
    const currentLiabilities = latestValue(usGaapFacts, ["LiabilitiesCurrent"]);
    const operatingCashFlow = latestValue(usGaapFacts, ["NetCashProvidedByUsedInOperatingActivities"]);
    const capex = latestValue(usGaapFacts, ["PaymentsToAcquirePropertyPlantAndEquipment"]);
    const interestExpense = latestValue(usGaapFacts, ["InterestExpense", "InterestAndDebtExpense"]);
    const depreciationAmortization = latestValue(usGaapFacts, [
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
    ]);
    let ebitda = latestValue(usGaapFacts, [
      "OperatingIncomeLossDepreciationDepletionAndAmortization",
      "EarningsBeforeInterestTaxesDepreciationAndAmortization",
    ]);
    if (ebitda == null && operatingIncome != null && depreciationAmortization != null) {
      ebitda = operatingIncome + Math.abs(depreciationAmortization);
    }
    const epsDiluted = latestValue(usGaapFacts, ["EarningsPerShareDiluted"]);
    const epsBasic = latestValue(usGaapFacts, ["EarningsPerShareBasic"]);
    const sharesOutstanding = latestValue(usGaapFacts, [
      "CommonStockSharesOutstanding",
      "EntityCommonStockSharesOutstanding",
    ]);
    const longTermDebt = latestValue(usGaapFacts, ["LongTermDebtNoncurrent", "LongTermDebt"]);
    const shortTermDebt = latestValue(usGaapFacts, ["DebtCurrent", "ShortTermBorrowings"]);

    const totalDebt =
      longTermDebt != null || shortTermDebt != null
        ? (longTermDebt || 0) + (shortTermDebt || 0)
        : null;
    const freeCashFlow =
      operatingCashFlow != null && capex != null
        ? operatingCashFlow - Math.abs(capex)
        : null;
    const currentRatio =
      currentAssets != null && currentLiabilities && currentLiabilities !== 0
        ? currentAssets / currentLiabilities
        : null;
    const debtToEquity =
      totalDebt != null && equity && equity !== 0 ? totalDebt / equity : null;
    const netMargin =
      netIncome != null && revenue && revenue !== 0 ? netIncome / revenue : null;
    const returnOnAssets =
      netIncome != null && assets && assets !== 0 ? netIncome / assets : null;
    const returnOnEquity =
      netIncome != null && equity && equity !== 0 ? netIncome / equity : null;
    const freeCashFlowMargin =
      freeCashFlow != null && revenue && revenue !== 0 ? freeCashFlow / revenue : null;
    const operatingMargin =
      operatingIncome != null && revenue && revenue !== 0 ? operatingIncome / revenue : null;
    const interestCoverage =
      operatingIncome != null && interestExpense && interestExpense !== 0
        ? operatingIncome / Math.abs(interestExpense)
        : null;
    const revenueGrowthYoY = yoyGrowth(usGaapFacts, [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "SalesRevenueNet",
    ]);
    const netIncomeGrowthYoY = yoyGrowth(usGaapFacts, ["NetIncomeLoss"]);

    const filings = parseRecentFilings(submissions);

    return NextResponse.json({
      symbol: entry.ticker,
      companyName: entry.title,
      cik: entry.cik,
      source: "SEC EDGAR",
      fundamentals: {
        revenue,
        grossProfit,
        operatingIncome,
        netIncome,
        assets,
        liabilities,
        equity,
        cash,
        currentAssets,
        currentLiabilities,
        operatingCashFlow,
        capex,
        interestExpense,
        depreciationAmortization,
        ebitda,
        freeCashFlow,
        epsDiluted,
        epsBasic,
        sharesOutstanding,
        longTermDebt,
        shortTermDebt,
        totalDebt,
      },
      highlights: {
        currentRatio,
        debtToEquity,
        netMargin,
        returnOnAssets,
        returnOnEquity,
        freeCashFlowMargin,
        operatingMargin,
        interestCoverage,
        revenueGrowthYoY,
        netIncomeGrowthYoY,
      },
      filings,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      {
        error: "SEC fundamentals fetch failed",
        details: String(error?.message || error),
      },
      { status }
    );
  }
}
