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
    /** Preferred model id (from the UI selector); the failover chain tries it first. */
    modelId: z.string().max(64).optional(),
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
  /** Human name of the model that actually answered (after any failover). */
  model: z.string().optional(),
  /** Registry id of that model. */
  modelId: z.string().optional(),
});
export type RespondResponse = z.infer<typeof RespondResponse>;

/* ---------- GET /models : the failover chain (names + limitations, no keys) ---------- */

export const ModelPublic = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  hasVision: z.boolean(),
  limitations: z.object({ en: z.string(), bn: z.string() }),
});
export type ModelPublic = z.infer<typeof ModelPublic>;

export const ModelsResponse = z.object({
  models: z.array(ModelPublic),
  activeId: z.string().optional(),
});
export type ModelsResponse = z.infer<typeof ModelsResponse>;

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

/* ---------- POST /lead : capture a contact when free usage ends ---------- */

export const LeadRequest = z.object({
  /** Client-generated UUID (also kept in the browser's localStorage for returning-visitor greeting). */
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  phone: z.string().min(3).max(40),
  /** Which feature the visitor is interested in (free text or a preset key). */
  interest: z.string().max(200).default(""),
  lang: z.string().max(10).default("bn"),
  /** Filled server-side by server.py from the request; never trusted from the client. */
  ip: z.string().max(64).default(""),
});
export type LeadRequest = z.infer<typeof LeadRequest>;

export const LeadResponse = z.object({ ok: z.literal(true), returning: z.boolean() });
export type LeadResponse = z.infer<typeof LeadResponse>;

/* ---------- GET /health ---------- */

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;
