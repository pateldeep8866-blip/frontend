import { NextResponse } from "next/server";
import { insertTrade, getDbMeta } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker || "").toUpperCase().trim();
    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    const row = insertTrade(body);
    return NextResponse.json({ ok: true, trade: row, ...getDbMeta() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
