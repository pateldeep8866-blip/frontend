const VALID_ACTIONS = new Set(["BUY", "SELL", "HOLD"]);

/**
 * Validate a trade payload from the request body.
 * Returns an array of error strings — empty means valid.
 */
export function validateTrade(body) {
  const errors = [];

  const ticker = String(body?.ticker || "").trim();
  if (!ticker) errors.push("ticker: required");
  else if (ticker.length > 12) errors.push("ticker: max 12 characters");

  const action = String(body?.action || "").toUpperCase();
  if (body?.action != null && !VALID_ACTIONS.has(action))
    errors.push("action: must be BUY, SELL, or HOLD");

  if (body?.confidence != null) {
    const c = Number(body.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 100)
      errors.push("confidence: must be a number between 0 and 100");
  }

  if (body?.entry_price != null) {
    const p = Number(body.entry_price);
    if (!Number.isFinite(p) || p < 0)
      errors.push("entry_price: must be a non-negative number");
  }

  if (body?.shares != null) {
    const s = Number(body.shares);
    if (!Number.isFinite(s) || s < 0)
      errors.push("shares: must be a non-negative number");
  }

  return errors;
}
