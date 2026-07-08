/**
 * tts.ts — turns text into raw PCM the frontend can play as-is.
 *
 * TtsAdapter + FallbackTtsAdapter are complete. AzureBnBDAdapter is a skeleton with the exact output
 * format nailed down (24 kHz 16-bit mono PCM) so it drops straight into parlor's audio_chunk stream.
 */
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { TtsRequest } from "../contracts.js";
import { withTimeout } from "../timeout.js";

/** Raw audio ready for base64 -> audio_chunk. sampleRate flows into audio_start.sample_rate. */
export interface TtsResult {
  pcm: Buffer; // 16-bit little-endian mono PCM
  sampleRate: number;
}

export interface TtsAdapter {
  synthesize(input: TtsRequest): Promise<TtsResult>;
}

export interface AzureOptions {
  key: string;
  region: string;
  /** Default bn-BD voice. Never a bn-IN voice for this app. */
  defaultVoice?: string;
  /** Per-sentence synthesis ceiling. */
  timeoutMs?: number;
}

/**
 * Azure Neural TTS, Bangladeshi register.
 * Voices: bn-BD-NabanitaNeural (F), bn-BD-PradeepNeural (M).
 * Output: Raw24Khz16BitMonoPcm  ->  sampleRate 24000, which matches the frontend's default.
 */
export class AzureBnBDAdapter implements TtsAdapter {
  static readonly SAMPLE_RATE = 24_000;
  private readonly defaultVoice: string;

  constructor(private readonly opts: AzureOptions) {
    this.defaultVoice = opts.defaultVoice ?? "bn-BD-NabanitaNeural";
  }

  async synthesize(input: TtsRequest): Promise<TtsResult> {
    const voice = input.voice ?? this.defaultVoice;

    const cfg = sdk.SpeechConfig.fromSubscription(this.opts.key, this.opts.region);
    // 24 kHz 16-bit mono PCM — matches the frontend's default streamSampleRate, no resampling.
    cfg.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
    cfg.speechSynthesisVoiceName = voice;

    // No AudioConfig → the SDK collects audio into the result instead of a speaker device.
    const synth = new sdk.SpeechSynthesizer(cfg, undefined);
    try {
      const result = await withTimeout(
        new Promise<sdk.SpeechSynthesisResult>((resolve, reject) =>
          synth.speakTextAsync(input.text, resolve, reject),
        ),
        this.opts.timeoutMs ?? 15_000,
        "Azure speakTextAsync",
      );

      if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
        throw new Error(`Azure TTS failed: ${result.errorDetails || sdk.ResultReason[result.reason]}`);
      }
      if (!result.audioData || result.audioData.byteLength === 0) {
        throw new Error("Azure TTS returned empty audio");
      }
      return { pcm: Buffer.from(result.audioData), sampleRate: AzureBnBDAdapter.SAMPLE_RATE };
    } finally {
      synth.close();
    }
  }
}

/**
 * Tries adapters in order; returns the first success. Lets you set Azure primary + ElevenLabs/Google fallback
 * without changing the server. Throws an aggregate error only if all fail.
 */
export class FallbackTtsAdapter implements TtsAdapter {
  constructor(private readonly chain: TtsAdapter[]) {
    if (chain.length === 0) throw new Error("FallbackTtsAdapter needs at least one adapter");
  }

  async synthesize(input: TtsRequest): Promise<TtsResult> {
    const errors: unknown[] = [];
    for (const adapter of this.chain) {
      try {
        return await adapter.synthesize(input);
      } catch (err) {
        errors.push(err);
      }
    }
    throw new AggregateError(errors, "All TTS adapters failed");
  }
}
