/**
 * understanding.ts — turns a voice/text turn into { transcription, response }, grounded in the
 * As-Sunnah Foundation knowledge base (RAG).
 *
 * Flow (keeps the {transcription, response} contract, so server.py / WS / frontend are unchanged):
 *   1. Get the question text — transcribe the audio (Gemini STT), or use the typed text.
 *   2. Retrieve top-k knowledge-base passages for that question.
 *   3. Generate a grounded Bengali answer (Gemini) from the retrieved context.
 */
import { GoogleGenAI } from "@google/genai";
import type { RespondRequest, RespondResponse } from "../contracts.js";
import { TRANSCRIBE_INSTRUCTION, RAG_SYSTEM_PROMPT_BN, buildGroundedPrompt } from "../prompts.js";
import { retrieve } from "../rag/retrieve.js";
import { withTimeout } from "../timeout.js";

export interface UnderstandingAdapter {
  respond(input: RespondRequest): Promise<RespondResponse>;
}

export interface GeminiOptions {
  apiKey: string;
  /** e.g. "gemini-2.5-flash" — must support AUDIO input. Confirm current string. */
  model: string;
  /** Per-call ceiling; a hung request returns a clean 502 instead of stalling the WS turn. */
  timeoutMs?: number;
  /** How many knowledge-base chunks to inject as context. */
  topK?: number;
}

export class GeminiAdapter implements UnderstandingAdapter {
  private readonly client: GoogleGenAI;

  constructor(private readonly opts: GeminiOptions) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async respond(input: RespondRequest): Promise<RespondResponse> {
    // 1) Question text: transcribe audio, or use the typed text turn.
    const transcription = input.audioB64 ? await this.transcribe(input.audioB64) : "";
    const question = (input.audioB64 ? transcription : input.text ?? "").trim();
    if (!question) {
      return { transcription, response: "দুঃখিত, আপনার প্রশ্নটা ঠিকমতো বুঝতে পারিনি। আরেকবার একটু বলবেন?" };
    }

    // 2) Retrieve grounding passages from the knowledge base.
    const { context } = await retrieve(question, this.opts.topK ?? 5);

    // 3) Generate a grounded Bengali answer.
    const response = await this.generateGrounded(question, context, input.imageB64);
    return { transcription, response };
  }

  /** Gemini STT — audio in, verbatim text out. */
  private async transcribe(audioB64: string): Promise<string> {
    const res = await withTimeout(
      this.client.models.generateContent({
        model: this.opts.model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: audioB64 } },
              { text: TRANSCRIBE_INSTRUCTION },
            ],
          },
        ],
      }),
      this.opts.timeoutMs ?? 30_000,
      "Gemini transcribe",
    );
    return res.text?.trim() ?? "";
  }

  /** Gemini generation grounded in the retrieved context (+ optional camera image). */
  private async generateGrounded(question: string, context: string, imageB64?: string): Promise<string> {
    const parts: Array<Record<string, unknown>> = [];
    if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });
    parts.push({ text: buildGroundedPrompt(question, context) });

    const res = await withTimeout(
      this.client.models.generateContent({
        model: this.opts.model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: RAG_SYSTEM_PROMPT_BN },
      }),
      this.opts.timeoutMs ?? 30_000,
      "Gemini generateContent",
    );

    const text = res.text?.trim();
    if (!text) throw new Error("Gemini returned no answer text");
    return text;
  }
}
