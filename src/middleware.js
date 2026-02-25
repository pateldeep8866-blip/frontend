import { NextResponse } from "next/server";

export function middleware(request) {
  const path = request.nextUrl.pathname;

  if (path.startsWith("/admin") && path !== "/admin/login") {
    const adminCookie = request.cookies.get("admin_auth")?.value;
    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminCookie || !adminSecret || adminCookie !== adminSecret) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

