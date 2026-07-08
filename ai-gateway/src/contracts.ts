/**
 * contracts.ts — the internal API between parlor's Python WS server and this Node gateway.
 * Single source of truth. Validate every request body against these; infer TS types from them.
 *
 * The browser WebSocket protocol is separate and unchanged — see NAVIGATION.md.
 */
import { z } from "zod";

/* ---------- POST /respond : audio(+image) -> transcription + reply ---------- */

export const RespondRequest = z
  .object({
    /** base64 WAV, 16 kHz mono 16-bit PCM (exactly what the browser sends). */
    audioB64: z.string().min(1).optional(),
    /** base64 JPEG from the camera frame. */
    imageB64: z.string().min(1).optional(),
    /** Optional per-turn instruction/context passed through from server.py, or a text-only turn. */
    text: z.string().optional(),
    /** BCP-47-ish language hint. Bengali by default. */
    lang: z.string().default("bn"),
  })
  .refine((v) => Boolean(v.audioB64 || v.text), {
    message: "Provide at least `audioB64` or `text`.",
  });
export type RespondRequest = z.infer<typeof RespondRequest>;

export const RespondResponse = z.object({
  /** Exact transcription of the user's speech (empty for text-only turns). */
  transcription: z.string(),
  /** The assistant's reply, in natural Bangladeshi Bangla. */
  response: z.string(),
});
export type RespondResponse = z.infer<typeof RespondResponse>;

/* ---------- POST /tts : text -> speech ---------- */

export const TtsRequest = z.object({
  text: z.string().min(1),
  /** Override the default bn-BD voice. Never pass a bn-IN voice for this app. */
  voice: z.string().optional(),
});
export type TtsRequest = z.infer<typeof TtsRequest>;

export const TtsResponse = z.object({
  /** base64 of raw 16-bit little-endian mono PCM — forwarded straight into `audio_chunk`. */
  audioB64: z.string(),
  /** Sample rate of the PCM above; server.py copies this into `audio_start.sample_rate`. */
  sampleRate: z.number().int().positive(),
});
export type TtsResponse = z.infer<typeof TtsResponse>;

/* ---------- GET /health ---------- */

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;
