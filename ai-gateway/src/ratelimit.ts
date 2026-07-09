/**
 * ratelimit.ts — detect provider quota exhaustion (HTTP 429 / RESOURCE_EXHAUSTED) across providers
 * (Gemini, Hugging Face, Groq, OpenRouter). Shared by the failover chain and the /respond handler.
 */
export function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; code?: number; httpResponse?: { status?: number }; message?: string };
  if (e?.status === 429 || e?.code === 429 || e?.httpResponse?.status === 429) return true;
  return /RESOURCE_EXHAUSTED|too many requests|rate.?limit|quota|insufficient_quota|"code"\s*:\s*429|\b429\b/i.test(
    String(e?.message ?? err ?? ""),
  );
}

/**
 * Retryable = worth failing over to the NEXT model: rate-limit (429), a provider 5xx, a timeout, an
 * empty/no-answer response, or a transient network error. Genuine client errors (e.g. 400/401/404)
 * are NOT retryable — they'd fail the same way everywhere and usually mean a config/code issue.
 */
export function isRetryable(err: unknown): boolean {
  if (isRateLimit(err)) return true;
  const e = err as { status?: number; httpResponse?: { status?: number }; message?: string };
  const status = e?.status ?? e?.httpResponse?.status;
  if (typeof status === "number" && status >= 500 && status < 600) return true; // provider server error
  return /no answer text|empty answer|timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up|\bHTTP 5\d\d\b/i.test(
    String(e?.message ?? err ?? ""),
  );
}
