import { checkAdminAuth } from "../../_lib/admin-auth";
import { getWeightHistory, getLatestWeight } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 200);
  const rows = getWeightHistory(limit);
  return ok({ count: rows.length, current: getLatestWeight(), rows });
}

