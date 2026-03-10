import { NextResponse } from "next/server";

export function ok(data = {}, meta = null) {
  return NextResponse.json({ ok: true, ...data, ...(meta ? { meta } : {}) });
}

export function fail(error, status = 500, code = "INTERNAL_ERROR") {
  return NextResponse.json(
    { ok: false, error: String(error?.message || error), code },
    { status }
  );
}

export const UNAUTHORIZED = () =>
  NextResponse.json(
    { ok: false, error: "Unauthorized", code: "ADMIN_AUTH_REQUIRED" },
    { status: 401 }
  );
