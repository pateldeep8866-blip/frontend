import { NextResponse } from "next/server";
import { cleanupBadCryptoTrades } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cleanup = cleanupBadCryptoTrades();
    return NextResponse.json({ ok: true, ...cleanup });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
