import { checkYuniAuth } from "../../_lib/yuni-auth";
import { getDbMeta, ensureDb } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!checkYuniAuth(request)) return UNAUTHORIZED();

  let dbStatus = "ok";
  let tradeCount = 0;
  try {
    const db = ensureDb();
    tradeCount = Number(db.prepare("SELECT COUNT(*) AS c FROM trades").get()?.c || 0);
  } catch {
    dbStatus = "error";
  }

  return ok({
    status: "online",
    timestamp: new Date().toISOString(),
    db: { status: dbStatus, trade_count: tradeCount, ...getDbMeta() },
    env: {
      admin_secret_set: Boolean(process.env.ADMIN_SECRET),
      yuni_token_set: Boolean(process.env.YUNI_INTERNAL_TOKEN),
      quant_engine_url: process.env.QUANT_ENGINE_URL || "http://localhost:8001",
    },
  });
}
