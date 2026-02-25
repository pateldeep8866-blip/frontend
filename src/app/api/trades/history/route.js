import { NextResponse } from "next/server";
import { getTradeHistory, getDbMeta } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || 500);
    const rows = getTradeHistory(limit);
    return NextResponse.json({ ok: true, count: rows.length, rows, ...getDbMeta() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
