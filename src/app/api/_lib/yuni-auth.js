/**
 * yuni-auth.js
 * Token-based auth for internal YUNI machine-to-machine endpoints.
 * These routes are called by the YUNI runtime, not a browser.
 * Set YUNI_INTERNAL_TOKEN in .env.local and Railway env vars.
 */

export function checkYuniAuth(request) {
  const token = request.headers.get("x-yuni-token");
  const secret = process.env.YUNI_INTERNAL_TOKEN;
  return Boolean(token && secret && token === secret);
}
