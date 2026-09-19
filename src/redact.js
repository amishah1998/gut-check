// Strips secret-shaped strings before anything leaves the machine.
// Deliberately over-eager: a redacted path in a step summary costs a little
// accuracy, a leaked token costs trust.

const PATTERNS = [
  // vendor-prefixed tokens: sk-..., ghp_..., xoxb-..., AKIA..., AIza...
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // bearer headers and key=value assignments
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /\b(api[_-]?key|token|secret|password|passwd|authorization)\s*[=:]\s*["']?[^\s"'&]{8,}/gi,
  // long hex and long base64-looking runs
  /\b[a-f0-9]{32,}\b/gi,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

export function redact(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m, g1) =>
      g1 && /^(Bearer|Basic|api[_-]?key|token|secret|password|passwd|authorization)$/i.test(g1)
        ? `${g1} [redacted]`
        : "[redacted]",
    );
  }
  return out;
}

export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
