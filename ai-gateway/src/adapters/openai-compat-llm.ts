/**
 * openai-compat-llm.ts — one LlmAdapter for every OpenAI-compatible provider (Hugging Face router,
 * Groq, OpenRouter). Same `/v1/chat/completions` shape; only baseURL + key + model differ.
 *
 * Strips Qwen3's <think> reasoning, forces /no_think, caps tokens, and surfaces a 429 as err.status
 * so the failover chain can switch providers on rate-limit.
 */
import { withTimeout } from "../timeout.js";
import type { LlmAdapter } from "./llm.js";

export interface OpenAICompatOptions {
  baseURL: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Extra headers (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
}

export class OpenAICompatLlmAdapter implements LlmAdapter {
  constructor(private readonly opts: OpenAICompatOptions) {}

  async chat(input: { system: string; user: string; context?: string }): Promise<{ text: string }> {
    const noThink = /qwen3/i.test(this.opts.model); // Qwen3 reasoning models: suppress <think>
    const res = await withTimeout(
      fetch(`${this.opts.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
          ...(this.opts.headers ?? {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: noThink ? `${input.user} /no_think` : input.user },
          ],
          max_tokens: 1024,
          temperature: 0.6,
        }),
      }),
      this.opts.timeoutMs ?? 60_000,
      `${this.opts.baseURL} chat`,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number };
      err.status = res.status; // lets isRateLimit() detect 429 → failover
      throw err;
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let text = json.choices?.[0]?.message?.content ?? "";
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
    return { text };
  }
}
