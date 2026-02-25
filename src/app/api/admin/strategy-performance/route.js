import { NextResponse } from "next/server";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getStrategyPerformance } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = getStrategyPerformance();
    return NextResponse.json({ ok: true, rows, count: rows.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
