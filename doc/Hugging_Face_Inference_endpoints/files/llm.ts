/**
 * llm.ts — text -> reply. HF path hits a hosted, Bengali-capable open model through the
 * OpenAI-compatible router (one HF token, no card). Qwen3 instruct models handle Bengali well.
 * Optionally route through a fast provider by suffixing the model id, e.g. "Qwen/Qwen3-32B:cerebras".
 *
 * The `context` slot is your RAG injection point — pass retrieved As-Sunnah chunks here.
 */
import { InferenceClient } from "@huggingface/inference";

export interface LlmAdapter {
  chat(input: { system: string; user: string; context?: string }): Promise<{ text: string }>;
}

export interface HfLlmOptions {
  token: string;
  /** default Qwen/Qwen3-32B (strong Bengali). Add ":cerebras" / ":groq" to pick a provider. */
  model?: string;
}

export class HfLlmAdapter implements LlmAdapter {
  private readonly client: InferenceClient;
  private readonly model: string;

  constructor(opts: HfLlmOptions) {
    this.client = new InferenceClient(opts.token);
    this.model = opts.model ?? "Qwen/Qwen3-32B";
  }

  async chat(input: { system: string; user: string; context?: string }): Promise<{ text: string }> {
    const system = input.context
      ? `${input.system}\n\nAnswer ONLY from the context below. If it isn't there, say so politely in Bangla and point to the website.\n---\n${input.context}\n---`
      : input.system;

    const res = await this.client.chatCompletion({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input.user },
      ],
      max_tokens: 512,
      temperature: 0.6,
    });

    return { text: (res.choices?.[0]?.message?.content ?? "").trim() };
  }
}
