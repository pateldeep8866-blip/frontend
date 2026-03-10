import { NextResponse } from "next/server";

export function middleware(request) {
  const path = request.nextUrl.pathname;

  // ── admin pages + admin API: cookie-based auth ────────────────────────────
  const isAdminPage = path.startsWith("/admin") && path !== "/admin/login";
  const isAdminApi  = path.startsWith("/api/admin");

  if (isAdminPage || isAdminApi) {
    const adminCookie = request.cookies.get("admin_auth")?.value;
    const adminSecret = process.env.ADMIN_SECRET;
    const isAuthed = !!adminCookie && !!adminSecret && adminCookie === adminSecret;

    if (!isAuthed) {
      if (isAdminApi) {
        return NextResponse.json(
          { ok: false, error: "Unauthorized", code: "ADMIN_AUTH_REQUIRED" },
          { status: 401 }
        );
      }
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("from", path);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── internal YUNI endpoints: token-based auth ─────────────────────────────
  if (path.startsWith("/api/internal")) {
    const token  = request.headers.get("x-yuni-token");
    const secret = process.env.YUNI_INTERNAL_TOKEN;
    if (!token || !secret || token !== secret) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", code: "YUNI_TOKEN_REQUIRED" },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/internal/:path*"],
};

