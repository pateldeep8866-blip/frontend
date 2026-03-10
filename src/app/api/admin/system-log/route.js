import { NextResponse } from "next/server";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getSystemLog } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(2000, Number(searchParams.get("limit") || 200)));
  const rows = getSystemLog(limit);
  return NextResponse.json({ rows });
}
