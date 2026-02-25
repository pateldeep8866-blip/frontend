import { NextResponse } from "next/server";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getTradeHistory } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 50);
  const rows = getTradeHistory(limit);
  return NextResponse.json({
    ok: true,
    count: rows.length,
    rows,
  });
}

