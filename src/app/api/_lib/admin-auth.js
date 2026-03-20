export function getAdminSecret() {
  return String(process.env.ADMIN_SECRET || "");
}

export function checkAdminAuth(request) {
  try {
    const cookie = request.cookies.get("admin_auth")?.value;
    const secret = getAdminSecret();
    return Boolean(cookie && secret && cookie === secret);
  } catch {
    // During static export prerender, request.cookies throws StaticGenBailoutError.
    // Return false (unauthenticated) so the route can return a static response.
    return false;
  }
}
