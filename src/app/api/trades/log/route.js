import { insertTrade, getDbMeta } from "../../_lib/trade-db";
import { checkAdminAuth } from "../../_lib/admin-auth";
import { validateTrade } from "../../_lib/validate";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function POST(req) {
  if (!checkAdminAuth(req)) return UNAUTHORIZED();
  try {
    const body = await req.json().catch(() => ({}));
    const errors = validateTrade(body);
    if (errors.length) {
      return fail(errors.join("; "), 400, "VALIDATION_ERROR");
    }
    const row = insertTrade(body);
    return ok({ trade: row, ...getDbMeta() });
  } catch (error) {
    return fail(error);
  }
}
