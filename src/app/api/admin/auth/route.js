import { NextResponse } from "next/server";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body?.password || "");
  const secret = String(process.env.ADMIN_SECRET || "");

  if (password && secret && password === secret) {
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

  return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("admin_auth");
  return response;
}

