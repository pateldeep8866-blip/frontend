export const dynamic = "force-dynamic";
import { getTradeHistory, getDbMeta } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(req) {
  if (!checkAdminAuth(req)) return UNAUTHORIZED();
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || 500);
    const rows = getTradeHistory(limit);
    return ok({ count: rows.length, rows, ...getDbMeta() });
  } catch (error) {
    return fail(error);
  }
}
