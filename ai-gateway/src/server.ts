/**
 * server.ts — the gateway HTTP surface parlor's Python server calls.
 * Wiring is complete; it will run once the two adapter TODOs are filled.
 */
import Fastify from "fastify";
import { RespondRequest, TtsRequest } from "./contracts.js";
import { GeminiAdapter, type UnderstandingAdapter } from "./adapters/understanding.js";
import { LocalUnderstandingAdapter } from "./adapters/local.js";
import { AzureBnBDAdapter, FallbackTtsAdapter, type TtsAdapter } from "./adapters/tts.js";
import { EdgeTtsAdapter } from "./adapters/edge.js";
import { retrieve, getSuggestions } from "./rag/retrieve.js";

/* ---------- config ---------- */
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PORT = Number(env("PORT", "8787"));

// Understanding backend: Gemini (default) or a fully-local Ollama+Whisper path (no rate limits).
// GEMINI_API_KEY is only required when actually using Gemini.
const understanding: UnderstandingAdapter =
  (process.env.UNDERSTANDING_PROVIDER ?? "gemini").toLowerCase() === "ollama"
    ? new LocalUnderstandingAdapter({
        ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
        model: env("OLLAMA_MODEL", "qwen2.5:7b"),
        whisperUrl: process.env.WHISPER_URL,
        whisperModel: process.env.WHISPER_MODEL,
      })
    : new GeminiAdapter({
        apiKey: env("GEMINI_API_KEY"),
        model: env("GEMINI_MODEL", "gemini-2.5-flash"),
      });
console.log(`understanding backend: ${(process.env.UNDERSTANDING_PROVIDER ?? "gemini").toLowerCase()}`);

// TTS chain: Edge (card-free demo path, same bn-BD voices) is primary; Azure (production path)
// is appended only when its keys are present, so the gateway boots with zero paid dependencies.
const ttsChain: TtsAdapter[] = [new EdgeTtsAdapter({ voice: process.env.TTS_VOICE })];
if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
  ttsChain.push(
    new AzureBnBDAdapter({
      key: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION,
      defaultVoice: process.env.TTS_VOICE,
    }),
  );
}
const tts: TtsAdapter = new FallbackTtsAdapter(ttsChain);

/* ---------- app ---------- */
const app = Fastify({ logger: true, bodyLimit: 16 * 1024 * 1024 }); // audio+image base64 can be large

app.get("/health", async () => ({ ok: true as const }));

// Recommended questions, derived from the knowledge base (for the UI's input suggestions).
app.get("/suggestions", async () => ({ questions: getSuggestions(8) }));

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

app.listen({ host: "0.0.0.0", port: PORT })
  .then(() => {
    // Warm the knowledge base + embedding model off the request path so the first user query is fast.
    void retrieve("warmup").catch(() => {});
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
