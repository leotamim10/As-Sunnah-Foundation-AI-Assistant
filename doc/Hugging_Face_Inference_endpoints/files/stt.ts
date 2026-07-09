/**
 * stt.ts — speech -> text. The HF path uses Whisper large-v3, which covers 99 languages
 * INCLUDING Bengali (unlike parakeet, which is English-only). Token only, no card.
 *
 * dep:  npm i @huggingface/inference
 * Note: SDK method/param names shift between majors — if a call errors, check the installed
 *       @huggingface/inference version. This targets the current InferenceClient API.
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

  async transcribe(input: { audioB64: string; lang?: string }): Promise<{ text: string }> {
    const audio = Buffer.from(input.audioB64, "base64"); // 16 kHz mono WAV from the browser
    const res = await this.client.automaticSpeechRecognition({
      data: audio,
      model: this.model,
      provider: this.provider as never,
    });
    // Whisper auto-detects language; Bengali audio -> Bengali text.
    return { text: (res.text ?? "").trim() };
  }
}
