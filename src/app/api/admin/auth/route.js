import { NextResponse } from "next/server";
import { logAdminEvent } from "../../_lib/trade-db";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body?.password || "");
  const secret = String(process.env.ADMIN_SECRET || "");

  if (password && secret && password === secret) {
    try { logAdminEvent("LOGIN_SUCCESS", "admin_login", "Admin authenticated"); } catch {}
    const response = NextResponse.json({ ok: true });
    response.cookies.set("admin_auth", secret, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  }

  try { logAdminEvent("LOGIN_FAILURE", "auth_failed", "Invalid password attempt"); } catch {}
  return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
}

export async function DELETE() {
  try { logAdminEvent("LOGOUT", "admin_logout", "Admin session ended"); } catch {}
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("admin_auth");
  return response;
}

