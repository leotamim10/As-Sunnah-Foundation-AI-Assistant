/**
 * hf-understanding.ts — the HF "chained pipeline" alternative to GeminiAdapter.
 *
 * Composes STT (Whisper) → LLM (hosted Bengali model) but implements the SAME UnderstandingAdapter
 * contract, so the gateway swaps it in with one env var (UNDERSTANDING_PROVIDER=hf).
 *
 * It performs the SAME RAG grounding as the Gemini path — retrieve() + RAG_SYSTEM_PROMPT_BN +
 * buildGroundedPrompt — so answers stay grounded in the As-Sunnah knowledge base and read identically.
 *
 * Trade-offs vs Gemini: two network hops instead of one, and TEXT-ONLY — the camera image is dropped
 * here (open text LLMs aren't multimodal). Use the Gemini path when a question needs vision.
 */
import type { RespondRequest, RespondResponse } from "../contracts.js";
import type { UnderstandingAdapter } from "./understanding.js";
import type { SttAdapter } from "./stt.js";
import type { LlmAdapter } from "./llm.js";
import { RAG_SYSTEM_PROMPT_BN, buildGroundedPrompt } from "../prompts.js";
import { retrieve } from "../rag/retrieve.js";

export interface HfUnderstandingOptions {
  /** How many knowledge-base chunks to inject as context (matches the Gemini path default). */
  topK?: number;
}

export class HfUnderstandingAdapter implements UnderstandingAdapter {
  constructor(
    private readonly stt: SttAdapter,
    private readonly llm: LlmAdapter,
    private readonly opts: HfUnderstandingOptions = {},
  ) {}

  async respond(input: RespondRequest): Promise<RespondResponse> {
    // 1) Question text: Whisper for audio, or the typed text turn.
    const transcription = input.audioB64
      ? (await this.stt.transcribe({ audioB64: input.audioB64, lang: input.lang })).text
      : "";
    const question = (input.audioB64 ? transcription : input.text ?? "").trim();
    if (!question) {
      return { transcription, response: "দুঃখিত, আপনার প্রশ্নটা ঠিকমতো বুঝতে পারিনি। আরেকবার একটু বলবেন?" };
    }

    // 2) Retrieve grounding passages (same knowledge base + prompt as the Gemini path).
    const { context } = await retrieve(question, this.opts.topK ?? 5);

    // 3) Generate a grounded Bengali answer via the hosted LLM.
    const { text } = await this.llm.chat({
      system: RAG_SYSTEM_PROMPT_BN,
      user: buildGroundedPrompt(question, context),
    });
    if (!text) throw new Error("HF LLM returned no answer text");

    return { transcription, response: text };
  }
}
