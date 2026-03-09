import { NextResponse } from "next/server";
import {
  getInvestorCookieName,
  isValidInvestorCode,
  makeInvestorCookieValue,
} from "@/app/api/_lib/investor-auth";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "");
    if (!isValidInvestorCode(code)) {
      return NextResponse.json({ ok: false, error: "Invalid access code" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(getInvestorCookieName(), makeInvestorCookieValue(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getInvestorCookieName(), "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

