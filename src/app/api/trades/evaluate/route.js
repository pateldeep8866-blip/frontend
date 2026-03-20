import { evaluatePendingTradeOutcomes } from "../../_lib/trade-service";
import { getDbMeta, logAdminEvent } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function POST(request) {
  if (!checkAdminAuth(request)) return UNAUTHORIZED();
  try {
    const result = await evaluatePendingTradeOutcomes();
    try { logAdminEvent("ADMIN_EVALUATE", "manual_evaluation", `Evaluated ${result.evaluated} of ${result.pending} pending trades`); } catch {}
    return ok({ ...result, ...getDbMeta() });
  } catch (error) {
    return fail(error);
  }
}
