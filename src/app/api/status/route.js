import { NextResponse } from "next/server";

export async function GET() {
  const hasStockApi = Boolean(process.env.FINNHUB_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  return NextResponse.json({
    ok: hasStockApi && (hasOpenAI || hasOpenRouter),
    env: {
      STOCK_API_KEY: hasStockApi,
      FINNHUB_API_KEY: Boolean(process.env.FINNHUB_API_KEY),
      OPENAI_API_KEY: hasOpenAI,
      OPENROUTER_API_KEY: hasOpenRouter,
      CRYPTO_API_KEY: false,
      CRYPTO_API_KEY_2: Boolean(process.env.CRYPTO_API_KEY_2),
    },
    runtime: process.env.NODE_ENV || "unknown",
  });
}
