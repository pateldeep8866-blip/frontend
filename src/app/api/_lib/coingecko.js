export function getCoinGeckoHeaders() {
  const key = process.env.CRYPTO_API_KEY_2 || "";

  const headers = { Accept: "application/json" };
  if (!key) return headers;

  // Support both demo and pro key styles.
  headers["x-cg-demo-api-key"] = key;
  headers["x-cg-pro-api-key"] = key;
  return headers;
}

export async function cgFetch(url, { revalidate = 20 } = {}) {
  const withKeyHeaders = getCoinGeckoHeaders();
  const hasKey = Boolean(process.env.CRYPTO_API_KEY_2);

  const first = await fetch(url, {
    headers: withKeyHeaders,
    next: { revalidate },
  });

  if (first.ok || !hasKey) return first;

  // Some tiers/keys reject specific headers; fallback to public request.
  if ([400, 401, 403, 429].includes(first.status)) {
    return fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate },
    });
  }

  return first;
}

export async function cgJson(url, { revalidate = 20 } = {}) {
  const res = await cgFetch(url, { revalidate });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
