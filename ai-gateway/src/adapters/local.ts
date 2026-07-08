/**
 * local.ts — a fully local UnderstandingAdapter: no Gemini, no rate limits.
 *
 *   STT  : an OpenAI-compatible Whisper server (faster-whisper-server / speaches / whisper.cpp).
 *   Gen  : an Ollama server running a multilingual model (e.g. qwen2.5:7b).
 *   RAG  : the same retrieve() + prompts as the Gemini path, so answers stay grounded + Bengali.
 *
 * Enable via UNDERSTANDING_PROVIDER=ollama. Runs the same {transcription, response} contract, so
 * server.py / WS / frontend / TTS are unchanged. Bengali quality depends on the local model.
 */
import type { RespondRequest, RespondResponse } from "../contracts.js";
import { RAG_SYSTEM_PROMPT_BN, buildGroundedPrompt } from "../prompts.js";
import { retrieve } from "../rag/retrieve.js";
import { withTimeout } from "../timeout.js";
import type { UnderstandingAdapter } from "./understanding.js";

export interface LocalOptions {
  /** Ollama base URL, e.g. http://host.docker.internal:11434 */
  ollamaUrl: string;
  /** Ollama model tag, e.g. qwen2.5:7b */
  model: string;
  /** OpenAI-compatible Whisper base URL; if unset, audio turns are rejected (text still works). */
  whisperUrl?: string;
  /** Whisper model id the server expects (e.g. "Systran/faster-whisper-small" or "whisper-1"). */
  whisperModel?: string;
  /** Per-call ceiling — local generation can be slow, so this is generous by default. */
  timeoutMs?: number;
  /** How many knowledge-base chunks to inject as context. */
  topK?: number;
}

export class LocalUnderstandingAdapter implements UnderstandingAdapter {
  constructor(private readonly opts: LocalOptions) {}

  async respond(input: RespondRequest): Promise<RespondResponse> {
    // 1) Question text: local Whisper for audio, or the typed text.
    const transcription = input.audioB64 ? await this.transcribe(input.audioB64) : "";
    const question = (input.audioB64 ? transcription : input.text ?? "").trim();
    if (!question) {
      return { transcription, response: "দুঃখিত, আপনার প্রশ্নটা বুঝতে পারিনি। আরেকবার একটু বলবেন?" };
    }

    // 2) Retrieve grounding passages (shared with the Gemini path).
    const { context } = await retrieve(question, this.opts.topK ?? 5);

    // 3) Generate a grounded answer with the local model.
    const response = await this.generate(question, context);
    return { transcription, response };
  }

  /** Local Whisper (OpenAI-compatible /v1/audio/transcriptions) — WAV in, verbatim text out. */
  private async transcribe(audioB64: string): Promise<string> {
    if (!this.opts.whisperUrl) {
      throw new Error("Voice needs a local Whisper server — set WHISPER_URL (or use text input).");
    }
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audioB64, "base64")], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.opts.whisperModel ?? "Systran/faster-whisper-small");
    form.append("response_format", "json");

    const res = await withTimeout(
      fetch(`${this.opts.whisperUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, { method: "POST", body: form }),
      this.opts.timeoutMs ?? 120_000,
      "Whisper transcribe",
    );
    if (!res.ok) throw new Error(`Whisper HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  }

  /** Ollama chat — grounded answer from the RAG system prompt + retrieved context. */
  private async generate(question: string, context: string): Promise<string> {
    const res = await withTimeout(
      fetch(`${this.opts.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.opts.model,
          stream: false,
          options: { temperature: 0.4 },
          messages: [
            { role: "system", content: RAG_SYSTEM_PROMPT_BN },
            { role: "user", content: buildGroundedPrompt(question, context) },
          ],
        }),
      }),
      this.opts.timeoutMs ?? 120_000,
      "Ollama chat",
    );
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content?.trim();
    if (!text) throw new Error("Ollama returned no answer text");
    return text;
  }
}
