export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const PRICE_PER_MTOK = 0.042;

export class JevError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function askJev({ state, questions, apiKey, model = "jev-latest", timeoutMs = 30000, retries = 3, fetchImpl = fetch }) {
  const body = JSON.stringify({ model, state, questions });
  let attempt = 0;
  for (;;) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt > retries) throw new JevError(`network error after ${attempt} attempts: ${err.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    clearTimeout(timer);
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt <= retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? ra * 1000 : 500 * 2 ** attempt);
      continue;
    }
    throw new JevError(`Jev returned ${res.status}: ${text.slice(0, 300)}`, { status: res.status, body: text });
  }
}

export async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
