/**
 * hf-understanding.ts — the HF "chained pipeline" alternative to GeminiAdapter.
 *
 * Composes STT (Whisper) -> LLM (hosted Bengali model) but implements the SAME UnderstandingAdapter
 * contract, so the gateway swaps it in with one env var. This is the modular, HF-style path from the
 * speech-to-speech demo — with Bengali-capable models substituted at the stages that needed it.
 *
 * Trade-off vs Gemini: two network hops instead of one, and TEXT-ONLY — the camera image is ignored
 * here (open text LLMs aren't multimodal). Use the Gemini path when you need vision.
 */
import type { RespondRequest, RespondResponse } from "../contracts.js";
import type { UnderstandingAdapter } from "./understanding.js";
import type { SttAdapter } from "./stt.js";
import type { LlmAdapter } from "./llm.js";
import { SYSTEM_PROMPT_BN } from "../prompts.js";

export class HfUnderstandingAdapter implements UnderstandingAdapter {
  constructor(
    private readonly stt: SttAdapter,
    private readonly llm: LlmAdapter,
  ) {}

  async respond(input: RespondRequest): Promise<RespondResponse> {
    const transcription = input.audioB64
      ? (await this.stt.transcribe({ audioB64: input.audioB64, lang: input.lang })).text
      : (input.text ?? "");

    if (!transcription) throw new Error("Nothing to respond to (no audio or text)");

    // RAG-ready: once the knowledge module lands, retrieve chunks for `transcription`
    // and pass them as `context` here.
    const { text } = await this.llm.chat({ system: SYSTEM_PROMPT_BN, user: transcription });

    return { transcription, response: text };
  }
}
