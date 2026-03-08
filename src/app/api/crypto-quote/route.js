import { NextResponse } from "next/server";
import { cgJson } from "../_lib/coingecko";

const SYMBOL_TO_ID = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOGE: "dogecoin",
  LINK: "chainlink",
  MATIC: "matic-network",
};

function sanitizeText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferUtility(category, description, name) {
  const cat = String(category || "").trim();
  if (cat) {
    return {
      label: cat,
      summary: `${name || "This asset"} is commonly classified under ${cat.toLowerCase()}. Validate whether adoption and usage are growing in that segment.`,
    };
  }

  const d = String(description || "").toLowerCase();
  if (d.includes("smart contract")) {
    return { label: "Smart Contract Platform", summary: "Focus on developer activity, on-chain apps, and fee demand." };
  }
  if (d.includes("decentralized finance") || d.includes("defi")) {
    return { label: "DeFi", summary: "Check protocol TVL, revenue quality, and security history." };
  }
  if (d.includes("oracle")) {
    return { label: "Oracle Network", summary: "Track real integrations, data request volume, and enterprise usage." };
  }
  if (d.includes("gaming") || d.includes("gamefi")) {
    return { label: "Gaming / GameFi", summary: "Look for active users, retention, and sustainable token sinks." };
  }
  if (d.includes("payment") || d.includes("remittance")) {
    return { label: "Payments", summary: "Measure transaction throughput, cost advantages, and merchant adoption." };
  }
  if (d.includes("storage")) {
    return { label: "Decentralized Storage", summary: "Review real storage demand, pricing competitiveness, and uptime." };
  }

  return {
    label: "Digital Asset Infrastructure",
    summary: "Validate real usage, recurring demand drivers, and whether token value accrues from activity.",
  };
}

async function resolveId(symbol) {
  const q = String(symbol || "").trim();
  if (!q) return "";
  const mapped = SYMBOL_TO_ID[q.toUpperCase()];
  if (mapped) return mapped;
  const { data: d } = await cgJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
    { revalidate: 12 }
  );
  const coins = Array.isArray(d?.coins) ? d.coins : [];
  const exact = coins.find(
    (c) => String(c?.symbol || "").toUpperCase() === q.toUpperCase()
  );
  const safe =
    exact ||
    coins.find((c) => String(c?.id || "").toLowerCase() === q.toLowerCase()) ||
    coins[0];
  return String(safe?.id || "");
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    let id = (searchParams.get("id") || "").trim().toLowerCase();
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    if (!id && symbol) id = await resolveId(symbol);

    if (!id) return NextResponse.json({ error: "Missing id or symbol" }, { status: 400 });

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&price_change_percentage=24h`;
    const { res, data } = await cgJson(url, { revalidate: 20 });
    if (!res.ok) {
      return NextResponse.json({ error: "Crypto quote fetch failed", status: res.status, details: data }, { status: res.status });
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return NextResponse.json({ error: "Crypto not found" }, { status: 404 });

    const detailUrl =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
      `?localization=false&tickers=false&market_data=false&community_data=true&developer_data=true&sparkline=false`;
    const { data: detail } = await cgJson(detailUrl, { revalidate: 120 });
    const categories = Array.isArray(detail?.categories) ? detail.categories : [];
    const primaryCategory = String(categories[0] || "").trim();
    const description = sanitizeText(detail?.description?.en);
    const homepage = Array.isArray(detail?.links?.homepage) ? String(detail.links.homepage[0] || "").trim() : "";
    const githubRepo = Array.isArray(detail?.links?.repos_url?.github) ? String(detail.links.repos_url.github[0] || "").trim() : "";
    const utility = inferUtility(primaryCategory, description, row.name);

    return NextResponse.json({
      id: row.id,
      symbol: String(row.symbol || "").toUpperCase(),
      name: row.name,
      logo: row.image || "",
      homepage,
      category: utility.label,
      utilitySummary: utility.summary,
      marketCapRank: row.market_cap_rank ?? null,
      price: row.current_price,
      change: row.price_change_24h,
      percentChange:
        row.price_change_percentage_24h ??
        row.price_change_percentage_24h_in_currency,
      high: row.high_24h,
      low: row.low_24h,
      volume: row.total_volume,
      marketCap: row.market_cap,
      fdv: row.fully_diluted_valuation ?? null,
      circulatingSupply: row.circulating_supply ?? null,
      totalSupply: row.total_supply ?? null,
      maxSupply: row.max_supply ?? null,
      ath: row.ath ?? null,
      athChangePct: row.ath_change_percentage ?? null,
      atl: row.atl ?? null,
      atlChangePct: row.atl_change_percentage ?? null,
      sentimentUpVotesPct: detail?.sentiment_votes_up_percentage ?? null,
      coingeckoScore: detail?.coingecko_score ?? null,
      developerScore: detail?.developer_score ?? null,
      communityScore: detail?.community_score ?? null,
      liquidityScore: detail?.liquidity_score ?? null,
      publicInterestScore: detail?.public_interest_score ?? null,
      twitterFollowers: detail?.community_data?.twitter_followers ?? null,
      redditSubscribers: detail?.community_data?.reddit_subscribers ?? null,
      telegramUsers: detail?.community_data?.telegram_channel_user_count ?? null,
      githubRepo,
      githubStars: detail?.developer_data?.stars ?? null,
      githubForks: detail?.developer_data?.forks ?? null,
      githubSubscribers: detail?.developer_data?.subscribers ?? null,
      githubTotalIssues: detail?.developer_data?.total_issues ?? null,
      githubClosedIssues: detail?.developer_data?.closed_issues ?? null,
      githubCommits4w: detail?.developer_data?.commit_count_4_weeks ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
