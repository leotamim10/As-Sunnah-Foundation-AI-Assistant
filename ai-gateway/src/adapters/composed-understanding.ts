/**
 * composed-understanding.ts — a chained UnderstandingAdapter: (optional Whisper STT) → RAG retrieve →
 * any LlmAdapter. Used for every text-LLM provider (HF, Groq, OpenRouter). Same RAG grounding + prompt
 * as the Gemini path, so answers stay grounded. Text-only: the camera image is ignored.
 *
 * STT is optional — text turns work without it; a voice turn with no STT throws (→ failover to a
 * provider that can transcribe, e.g. Gemini).
 */
import type { RespondRequest, RespondResponse } from "../contracts.js";
import type { UnderstandingAdapter } from "./understanding.js";
import type { SttAdapter } from "./stt.js";
import type { LlmAdapter } from "./llm.js";
import { RAG_SYSTEM_PROMPT_BN, buildGroundedPrompt } from "../prompts.js";
import { retrieve } from "../rag/retrieve.js";

export class ComposedUnderstandingAdapter implements UnderstandingAdapter {
  constructor(
    private readonly stt: SttAdapter | null,
    private readonly llm: LlmAdapter,
    private readonly opts: { topK?: number } = {},
  ) {}

  async respond(input: RespondRequest): Promise<RespondResponse> {
    let transcription = "";
    if (input.audioB64) {
      if (!this.stt) throw new Error("No speech-to-text configured for voice (set HF_TOKEN).");
      transcription = (await this.stt.transcribe({ audioB64: input.audioB64, lang: input.lang })).text;
    }
    const question = (input.audioB64 ? transcription : input.text ?? "").trim();
    if (!question) {
      return { transcription, response: "দুঃখিত, আপনার প্রশ্নটা ঠিকমতো বুঝতে পারিনি। আরেকবার একটু বলবেন?" };
    }

    const { context } = await retrieve(question, this.opts.topK ?? 5);
    const { text } = await this.llm.chat({ system: RAG_SYSTEM_PROMPT_BN, user: buildGroundedPrompt(question, context) });
    if (!text) throw new Error("LLM returned no answer text");
    return { transcription, response: text };
  }
}
