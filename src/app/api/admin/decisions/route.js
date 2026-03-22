export const dynamic = "force-dynamic";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getTradeHistory } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 50);
  const rows = getTradeHistory(limit);
  return ok({ count: rows.length, rows });
}

