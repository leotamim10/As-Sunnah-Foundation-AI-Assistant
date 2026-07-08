/**
 * edge.ts — card-free Bengali TTS via Microsoft Edge's online neural voices.
 *
 * Same voices as Azure (bn-BD-NabanitaNeural / bn-BD-PradeepNeural) but NO key, NO subscription, NO card.
 * Edge returns MP3; parlor's audio_chunk stream wants raw PCM, so we decode MP3 -> 24 kHz s16le mono
 * with the bundled ffmpeg binary. Output plugs straight into parlor's pipeline (sampleRate 24000).
 *
 * deps:  npm i @travisvn/edge-tts ffmpeg-static
 *
 * Note: this uses an unofficial public endpoint — great for the demo ("working, not flawless"),
 * not for production. Keep the package updated; if it ever 403s, `npm update @travisvn/edge-tts`
 * (maintained forks handle Microsoft's rotating auth token for you).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EdgeTTS } from "@travisvn/edge-tts";
import ffmpegStatic from "ffmpeg-static";
import type { TtsRequest } from "../contracts.js";
import type { TtsAdapter, TtsResult } from "./tts.js";
import { withTimeout } from "../timeout.js";

// ffmpeg-static is CJS (module.exports = pathString); its .d.ts trips NodeNext default-import typing, so cast.
const ffmpegPath: string | null = ffmpegStatic as unknown as string | null;

export interface EdgeOptions {
  /** Default bn-BD voice. Never a bn-IN voice for this app. */
  voice?: string;
  /** Ceiling on the (WebSocket) synthesis call before it's treated as failed. */
  timeoutMs?: number;
}

export class EdgeTtsAdapter implements TtsAdapter {
  static readonly SAMPLE_RATE = 24_000;
  private readonly voice: string;
  private readonly timeoutMs: number;

  constructor(opts: EdgeOptions = {}) {
    this.voice = opts.voice ?? "bn-BD-NabanitaNeural";
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async synthesize(input: TtsRequest): Promise<TtsResult> {
    const voice = input.voice ?? this.voice;

    // 1) Edge -> MP3 buffer. The WS call can hang if the endpoint is blocked/unreachable, so bound it —
    //    a timeout throws cleanly and (in a FallbackTtsAdapter chain) falls through to the next provider.
    const tts = new EdgeTTS(input.text, voice);
    const result = await withTimeout(tts.synthesize(), this.timeoutMs, "Edge TTS synthesize");
    const mp3 = Buffer.from(await result.audio.arrayBuffer());
    if (mp3.length === 0) throw new Error("Edge TTS returned no audio");

    // 2) MP3 -> raw 24 kHz s16le mono PCM (what audio_chunk expects)
    const pcm = await decodeToPcm(mp3, EdgeTtsAdapter.SAMPLE_RATE);
    return { pcm, sampleRate: EdgeTtsAdapter.SAMPLE_RATE };
  }
}

function decodeToPcm(mp3: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static path not found"));
    const ff: ChildProcessWithoutNullStreams = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",                       // MP3 in via stdin
      "-f", "s16le", "-acodec", "pcm_s16le", // raw 16-bit LE PCM
      "-ac", "1", "-ar", String(sampleRate), // mono, 24 kHz
      "pipe:1",                             // PCM out via stdout
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => err.push(d));
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString()}`)),
    );
    ff.stdin.on("error", () => {}); // ignore EPIPE if ffmpeg dies early
    ff.stdin.end(mp3);
  });
}
