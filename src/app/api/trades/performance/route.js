import { NextResponse } from "next/server";
import { getPerformanceStats, getDbMeta } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getPerformanceStats();
    return NextResponse.json({ ok: true, stats, ...getDbMeta() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
