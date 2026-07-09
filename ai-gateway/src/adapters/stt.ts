/**
 * stt.ts — speech → text. The HF path uses Whisper large-v3, which covers 99 languages
 * INCLUDING Bengali. Token only, no card.
 *
 * Targets @huggingface/inference v4's InferenceClient. If a param errors after an SDK bump,
 * check the installed major (the doc warned these names drift between versions).
 */
import { InferenceClient } from "@huggingface/inference";
import { withTimeout } from "../timeout.js";

export interface SttAdapter {
  transcribe(input: { audioB64: string; lang?: string }): Promise<{ text: string }>;
}

export interface HfWhisperOptions {
  token: string;
  /**
   * default openai/whisper-large-v3 — with provider "auto" it routes to a provider that honors the
   * language hint and returns proper BENGALI script (fal-ai, ~2.7s). The free hf-inference `turbo`
   * ignores the language and mis-transcribes Bengali into Devanagari (Hindi) — so it's NOT the default.
   * (large-v3 via auto uses HF Inference credits; turbo is the free-but-wrong-script fallback.)
   */
  model?: string;
  /** "auto" lets HF route to whatever provider serves the model. */
  provider?: string;
  /**
   * Force the transcription language (Whisper name, e.g. "bengali") instead of auto-detect —
   * turbo mislabels Bengali as Hindi/English. Default "bengali" for this bn-BD app.
   * NOTE: the free hf-inference ASR may ignore this; whisper-large-v3 (paid providers) honors it.
   */
  language?: string;
  /** Per-call ceiling so a slow/failing provider fails fast instead of hanging the turn. */
  timeoutMs?: number;
}

// server.py sends lang="bn"; Whisper wants the full language name.
const WHISPER_LANG: Record<string, string> = { bn: "bengali", en: "english", hi: "hindi", ar: "arabic" };

export class HfWhisperAdapter implements SttAdapter {
  private readonly client: InferenceClient;
  private readonly model: string;
  private readonly provider: string;
  private readonly defaultLanguage: string;

  constructor(private readonly opts: HfWhisperOptions) {
    this.client = new InferenceClient(opts.token);
    this.model = opts.model || "openai/whisper-large-v3";
    this.provider = opts.provider || "auto";
    this.defaultLanguage = opts.language || "bengali";
  }

  async transcribe(input: { audioB64: string; lang?: string }): Promise<{ text: string }> {
    // 16 kHz mono WAV from the browser. v4 wants a Blob/ArrayBuffer (not a Node Buffer).
    const audio = new Blob([Buffer.from(input.audioB64, "base64")], { type: "audio/wav" });
    const language = WHISPER_LANG[(input.lang ?? "").toLowerCase()] ?? this.defaultLanguage;

    // Pass the language via the transformers ASR generate_kwargs (honored by providers that support it).
    const args: Record<string, unknown> = { data: audio, model: this.model, provider: this.provider };
    if (language) args.parameters = { generate_kwargs: { language, task: "transcribe" } };

    const res = await withTimeout(
      this.client.automaticSpeechRecognition(args as never),
      this.opts.timeoutMs ?? 45_000,
      "HF Whisper ASR",
    );
    return { text: (res.text ?? "").trim() };
  }
}
