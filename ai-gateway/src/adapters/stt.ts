/**
 * stt.ts — speech → text. The HF path uses Whisper large-v3, which covers 99 languages
 * INCLUDING Bengali. Token only, no card.
 *
 * Targets @huggingface/inference v4's InferenceClient. If a param errors after an SDK bump,
 * check the installed major (the doc warned these names drift between versions).
 */
import { InferenceClient } from "@huggingface/inference";

export interface SttAdapter {
  transcribe(input: { audioB64: string; lang?: string }): Promise<{ text: string }>;
}

export interface HfWhisperOptions {
  token: string;
  /** default openai/whisper-large-v3 */
  model?: string;
  /** which HF Inference provider serves the model; hf-inference serves Whisper reliably */
  provider?: string;
}

export class HfWhisperAdapter implements SttAdapter {
  private readonly client: InferenceClient;
  private readonly model: string;
  private readonly provider: string;

  constructor(opts: HfWhisperOptions) {
    this.client = new InferenceClient(opts.token);
    this.model = opts.model ?? "openai/whisper-large-v3";
    this.provider = opts.provider ?? "hf-inference";
  }

  async transcribe(input: { audioB64: string }): Promise<{ text: string }> {
    // 16 kHz mono WAV from the browser. v4 wants a Blob/ArrayBuffer (not a Node Buffer).
    const audio = new Blob([Buffer.from(input.audioB64, "base64")], { type: "audio/wav" });
    const res = await this.client.automaticSpeechRecognition({
      data: audio,
      model: this.model,
      provider: this.provider as never,
    });
    // Whisper auto-detects language; Bengali audio → Bengali text.
    return { text: (res.text ?? "").trim() };
  }
}
