export const dynamic = "force-dynamic";
import { checkYuniAuth } from "../../_lib/yuni-auth";
import { getPerformanceStats } from "../../_lib/trade-db";
import { ok, fail, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";


export async function GET(request) {
  if (!checkYuniAuth(request)) return UNAUTHORIZED();
  try {
    const stats = getPerformanceStats();
    return ok({ stats });
  } catch (error) {
    return fail(error);
  }
}
