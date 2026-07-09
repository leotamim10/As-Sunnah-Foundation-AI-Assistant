/**
 * server.ts — the gateway HTTP surface parlor's Python server calls.
 * Wiring is complete; it will run once the two adapter TODOs are filled.
 */
import Fastify from "fastify";
import { RespondRequest, TtsRequest } from "./contracts.js";
import { GeminiAdapter, type UnderstandingAdapter } from "./adapters/understanding.js";
import { HfUnderstandingAdapter } from "./adapters/hf-understanding.js";
import { HfWhisperAdapter } from "./adapters/stt.js";
import { HfLlmAdapter } from "./adapters/llm.js";
import { EdgeTtsAdapter } from "./adapters/edge.js";
import type { TtsAdapter } from "./adapters/tts.js";

/* ---------- config ---------- */
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PORT = Number(env("PORT", "8787"));

// Understanding path is swappable via env:
//   gemini → one multimodal call (audio+image+reply), best Bengali, has vision
//   hf     → Whisper STT → hosted Bengali LLM (the HF chained pipeline; text-only, no vision)
function makeUnderstanding(): UnderstandingAdapter {
  if (env("UNDERSTANDING_PROVIDER", "gemini") === "hf") {
    const token = env("HF_TOKEN");
    return new HfUnderstandingAdapter(
      new HfWhisperAdapter({ token, model: process.env.HF_STT_MODEL }),
      new HfLlmAdapter({ token, model: process.env.HF_LLM_MODEL }),
    );
  }
  return new GeminiAdapter({
    apiKey: env("GEMINI_API_KEY"),
    model: env("GEMINI_MODEL", "gemini-3.5-flash"),
  });
}

const understanding: UnderstandingAdapter = makeUnderstanding();

// TTS: Edge bn-BD — card-free, native Bangladeshi voices.
const tts: TtsAdapter = new EdgeTtsAdapter({ voice: process.env.TTS_VOICE });

/* ---------- app ---------- */
const app = Fastify({ logger: true, bodyLimit: 16 * 1024 * 1024 }); // audio+image base64 can be large

app.get("/health", async () => ({ ok: true as const }));

app.post("/respond", async (req, reply) => {
  const parsed = RespondRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    return await understanding.respond(parsed.data);
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: "understanding_failed" });
  }
});

app.post("/tts", async (req, reply) => {
  const parsed = TtsRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    const { pcm, sampleRate } = await tts.synthesize(parsed.data);
    return { audioB64: pcm.toString("base64"), sampleRate };
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: "tts_failed" });
  }
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
