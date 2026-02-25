import { NextResponse } from "next/server";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getLatestWeight } from "../../_lib/trade-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  let quant = { status: "offline" };
  try {
    const res = await fetch(`${quantUrl}/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    quant = res.ok ? data : { status: "offline", error: data };
  } catch (error) {
    quant = { status: "offline", error: String(error?.message || error) };
  }

  return NextResponse.json({
    ok: true,
    quant,
    latestWeight: getLatestWeight(),
    generated_utc: new Date().toISOString(),
  });
}

