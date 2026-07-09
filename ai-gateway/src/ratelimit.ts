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
