/**
 * timeout.ts — bound an async call so a slow/hung provider can't stall the WS turn.
 *
 * Rejects with a labelled error after `ms`. The underlying request is not cancelled (the SDKs
 * don't all expose an AbortSignal), but the gateway stops waiting and returns a clean 502.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
