import { NextResponse } from "next/server";
import { evaluatePendingTradeOutcomes, getDbMeta } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await evaluatePendingTradeOutcomes();
    return NextResponse.json({ ok: true, ...result, ...getDbMeta() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
