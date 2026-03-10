import { checkYuniAuth } from "../../_lib/yuni-auth";
import { getSystemLog } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkYuniAuth(request)) return UNAUTHORIZED();
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit") || 100)));
  const rows = getSystemLog(limit);

  const summary = {
    total: rows.length,
    login_failures: rows.filter(r => r.event_type === "LOGIN_FAILURE").length,
    login_success: rows.filter(r => r.event_type === "LOGIN_SUCCESS").length,
    picks_accepted: rows.filter(r => r.event_type === "PICK_ACCEPTED").length,
    picks_rejected: rows.filter(r => r.event_type === "PICK_REJECTED").length,
    admin_actions: rows.filter(r => ["ADMIN_EVALUATE","ADMIN_RESET","LOGOUT"].includes(r.event_type)).length,
  };

  return ok({ summary, rows });
}
