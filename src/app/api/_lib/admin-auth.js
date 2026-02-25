export function getAdminSecret() {
  return String(process.env.ADMIN_SECRET || "");
}

export function checkAdminAuth(request) {
  const cookie = request.cookies.get("admin_auth")?.value;
  const secret = getAdminSecret();
  return Boolean(cookie && secret && cookie === secret);
}

