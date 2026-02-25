import { NextResponse } from "next/server";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getWeightHistory, getLatestWeight } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 200);
  const rows = getWeightHistory(limit);
  return NextResponse.json({
    ok: true,
    count: rows.length,
    current: getLatestWeight(),
    rows,
  });
}

