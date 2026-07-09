/**
 * failover.ts — tries the model chain in order, advancing to the next model when one hits its
 * rate-limit (429). Returns which model actually answered (so the UI can show it), and throws
 * AllModelsExhaustedError when every model is spent (→ the free-usage lead form).
 *
 * A user-pinned model (input.modelId) is tried first; failover then continues through the rest.
 */
import type { RespondRequest, RespondResponse } from "../contracts.js";
import type { UnderstandingAdapter } from "./understanding.js";
import { isRateLimit } from "../ratelimit.js";

export interface ChainEntry {
  id: string;
  name: string;
  hasVision: boolean;
  adapter: UnderstandingAdapter;
}

export class AllModelsExhaustedError extends Error {
  readonly allExhausted = true;
  constructor() {
    super("all_models_exhausted");
    this.name = "AllModelsExhaustedError";
  }
}

export class FailoverUnderstandingAdapter implements UnderstandingAdapter {
  constructor(private readonly chain: ChainEntry[]) {}

  /** The default active model (first in the chain). */
  activeId(): string | undefined {
    return this.chain[0]?.id;
  }

  async respond(input: RespondRequest): Promise<RespondResponse> {
    const order = this.order(input.modelId);
    if (!order.length) throw new AllModelsExhaustedError();

    let lastErr: unknown;
    for (const entry of order) {
      try {
        const res = await entry.adapter.respond(input);
        return { ...res, model: entry.name, modelId: entry.id };
      } catch (err) {
        if (isRateLimit(err)) {
          lastErr = err; // rate-limited → try the next model
          continue;
        }
        throw err; // non-retryable → surface as a normal error
      }
    }
    const e = new AllModelsExhaustedError();
    (e as { cause?: unknown }).cause = lastErr;
    throw e;
  }

  /** Pinned model first (if valid), otherwise the chain as configured. */
  private order(preferId?: string): ChainEntry[] {
    if (!preferId) return this.chain;
    const idx = this.chain.findIndex((e) => e.id === preferId);
    const pinned = idx > 0 ? this.chain[idx] : undefined;
    if (!pinned) return this.chain; // not found, or already first
    return [pinned, ...this.chain.slice(0, idx), ...this.chain.slice(idx + 1)];
  }
}
