export const dynamic = "force-static";
import { getPerformanceStats, getDbMeta } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();
  try {
    const stats = getPerformanceStats();
    return ok({ stats, ...getDbMeta() });
  } catch (error) {
    return fail(error);
  }
}
