import { NextResponse } from "next/server";
import { evaluatePendingTradeOutcomes, getDbMeta } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await evaluatePendingTradeOutcomes();
    return NextResponse.json({ ok: true, ...result, ...getDbMeta() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
