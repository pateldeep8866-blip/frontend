import { checkYuniAuth } from "../../_lib/yuni-auth";
import { getLatestWeight, getPerformanceStats } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkYuniAuth(request)) return UNAUTHORIZED();

  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  let quant = { status: "offline" };
  try {
    const res = await fetch(`${quantUrl}/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    quant = res.ok ? data : { status: "offline" };
  } catch {
    quant = { status: "offline" };
  }

  return ok({
    quant,
    latest_weight: getLatestWeight(),
    generated_utc: new Date().toISOString(),
  });
}
