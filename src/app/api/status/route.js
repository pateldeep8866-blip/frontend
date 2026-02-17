import { NextResponse } from "next/server";

export async function GET() {
  const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  return NextResponse.json({
    ok: hasFinnhub && (hasOpenAI || hasOpenRouter),
    env: {
      FINNHUB_API_KEY: hasFinnhub,
      OPENAI_API_KEY: hasOpenAI,
      OPENROUTER_API_KEY: hasOpenRouter,
    },
    runtime: process.env.NODE_ENV || "unknown",
  });
}
