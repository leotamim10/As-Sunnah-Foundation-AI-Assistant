/**
 * llm.ts — text → reply. HF path hits a hosted, Bengali-capable open model through the
 * OpenAI-compatible router (one HF token, no card). Qwen3 instruct models handle Bengali well.
 * Optionally route through a fast provider by suffixing the model id, e.g. "Qwen/Qwen3-32B:cerebras".
 *
 * The `context` slot is a convenience RAG injector; this repo instead builds the grounded prompt
 * upstream (buildGroundedPrompt) so the HF path stays byte-for-byte aligned with the Gemini path.
 */
import { InferenceClient } from "@huggingface/inference";
import { withTimeout } from "../timeout.js";

export interface LlmAdapter {
  chat(input: { system: string; user: string; context?: string }): Promise<{ text: string }>;
}

export interface HfLlmOptions {
  token: string;
  /** default Qwen/Qwen3-32B (strong Bengali). Add ":cerebras" / ":groq" to pick a provider. */
  model?: string;
  /** Per-call ceiling so a slow provider fails fast instead of hanging the turn. */
  timeoutMs?: number;
}

export class HfLlmAdapter implements LlmAdapter {
  private readonly client: InferenceClient;
  private readonly model: string;

  constructor(private readonly opts: HfLlmOptions) {
    this.client = new InferenceClient(opts.token);
    this.model = opts.model || "Qwen/Qwen3-32B";
  }

  async chat(input: { system: string; user: string; context?: string }): Promise<{ text: string }> {
    const system = input.context
      ? `${input.system}\n\nAnswer ONLY from the context below. If it isn't there, say so politely in Bangla and point to the website.\n---\n${input.context}\n---`
      : input.system;

    // Qwen3 is a reasoning model: it emits a <think>…</think> chain-of-thought. `/no_think` turns that
    // off (so it doesn't leak into the reply/TTS or eat the token budget). max_tokens is generous so the
    // Bengali answer is never truncated.
    const noThink = /qwen3/i.test(this.model);
    const res = await withTimeout(
      this.client.chatCompletion({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: noThink ? `${input.user} /no_think` : input.user },
        ],
        max_tokens: 1024,
        temperature: 0.6,
      }),
      this.opts.timeoutMs ?? 60_000,
      "HF LLM chat",
    );

    let text = res.choices?.[0]?.message?.content ?? "";
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, ""); // strip any leaked reasoning block
    text = text.replace(/<think>[\s\S]*$/i, "");           // defensive: unclosed/truncated <think>
    return { text: text.trim() };
  }
}
