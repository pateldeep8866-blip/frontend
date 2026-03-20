import { cleanupBadCryptoTrades, logAdminEvent } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function POST(req) {
  if (!checkAdminAuth(req)) return UNAUTHORIZED();
  try {
    const result = cleanupBadCryptoTrades();
    try { logAdminEvent("ADMIN_RESET", "cleanup_bad_crypto", `Deleted ${result.deletedTrades} trades, ${result.deletedOutcomes} outcomes`); } catch {}
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
