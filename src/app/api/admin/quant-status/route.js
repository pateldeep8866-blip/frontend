export const dynamic = "force-dynamic";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getLatestWeight } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();

  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  let quant = { status: "offline" };
  try {
    const res = await fetch(`${quantUrl}/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    quant = res.ok ? data : { status: "offline", error: data };
  } catch (error) {
    quant = { status: "offline", error: String(error?.message || error) };
  }

  return ok({ quant, latestWeight: getLatestWeight(), generated_utc: new Date().toISOString() });
}

