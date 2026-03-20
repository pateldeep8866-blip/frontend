export const dynamic = "force-static";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { getStrategyPerformance } from "../../_lib/trade-db";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();
  try {
    const rows = getStrategyPerformance();
    return ok({ rows, count: rows.length });
  } catch (error) {
    return fail(error);
  }
}
