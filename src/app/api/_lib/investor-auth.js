import crypto from "node:crypto";

const COOKIE_NAME = "arthastra_investor_portal";

function getSecret() {
  return process.env.INVESTOR_PORTAL_SECRET || process.env.ARTHASTRA_INTERNAL_TOKEN || "arthastra-investor-secret";
}

function expectedCode() {
  return process.env.INVESTOR_ACCESS_CODE || "ARTHASTRA2025";
}

function signValue(value) {
  return crypto.createHmac("sha256", getSecret()).update(String(value)).digest("hex");
}

export function getInvestorCookieName() {
  return COOKIE_NAME;
}

export function isValidInvestorCode(input) {
  return String(input || "").trim() === expectedCode();
}

export function makeInvestorCookieValue() {
  return signValue("investor_portal_v1");
}

export function isInvestorAuthorizedFromCookies(cookies) {
  try {
    const raw = cookies?.get?.(COOKIE_NAME)?.value || "";
    if (!raw) return false;
    return crypto.timingSafeEqual(
      Buffer.from(raw),
      Buffer.from(makeInvestorCookieValue())
    );
  } catch {
    return false;
  }
}

