/**
 * server.ts — the gateway HTTP surface parlor's Python server calls.
 * Wiring is complete; it will run once the two adapter TODOs are filled.
 */
import Fastify from "fastify";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RespondRequest, TtsRequest, LeadRequest } from "./contracts.js";
import { GeminiAdapter, type UnderstandingAdapter } from "./adapters/understanding.js";
import { HfUnderstandingAdapter } from "./adapters/hf-understanding.js";
import { HfWhisperAdapter } from "./adapters/stt.js";
import { HfLlmAdapter } from "./adapters/llm.js";
import { AzureBnBDAdapter, FallbackTtsAdapter, type TtsAdapter } from "./adapters/tts.js";
import { EdgeTtsAdapter } from "./adapters/edge.js";
import { retrieve, getSuggestions } from "./rag/retrieve.js";

/** True when an error is a provider rate-limit / quota exhaustion (Gemini 429 / RESOURCE_EXHAUSTED). */
function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; code?: number; httpResponse?: { status?: number }; message?: string };
  if (e?.status === 429 || e?.code === 429 || e?.httpResponse?.status === 429) return true; // Gemini + HF
  return /RESOURCE_EXHAUSTED|too many requests|rate.?limit|"code"\s*:\s*429|\b429\b/i.test(String(e?.message ?? err ?? ""));
}

const LEADS_PATH = process.env.LEADS_PATH ?? "data/leads.jsonl";

/* ---------- config ---------- */
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PORT = Number(env("PORT", "8787"));

// Understanding path is swappable via env (default gemini). The relevant key is required only for
// the chosen provider, so the gateway boots with just one of GEMINI_API_KEY / HF_TOKEN.
//   gemini → one multimodal call (audio+image+grounded reply); has vision.
//   hf     → Whisper STT → hosted Bengali LLM, same RAG grounding; text-only (drops the image).
function makeUnderstanding(): UnderstandingAdapter {
  if ((process.env.UNDERSTANDING_PROVIDER ?? "gemini").toLowerCase() === "hf") {
    const token = env("HF_TOKEN");
    return new HfUnderstandingAdapter(
      new HfWhisperAdapter({ token, model: process.env.HF_STT_MODEL }),
      new HfLlmAdapter({ token, model: process.env.HF_LLM_MODEL }),
    );
  }
  return new GeminiAdapter({
    apiKey: env("GEMINI_API_KEY"),
    model: env("GEMINI_MODEL", "gemini-2.5-flash"),
  });
}
const understanding: UnderstandingAdapter = makeUnderstanding();
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
    // Surface quota exhaustion distinctly so server.py can flag it to the UI (free-usage-ended form).
    if (isRateLimit(err)) return reply.code(429).send({ error: "rate_limited" });
    return reply.code(502).send({ error: "understanding_failed" });
  }
});

// Lead capture — appended to a git-ignored JSONL store when a visitor submits the free-usage form.
// `returning` = we've already seen this client id (used by the UI's returning-visitor greeting).
app.post("/lead", async (req, reply) => {
  const parsed = LeadRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const lead = parsed.data;
  try {
    let returning = false;
    try {
      const existing = await readFile(LEADS_PATH, "utf8");
      returning = existing.split("\n").some((l) => l.includes(`"id":"${lead.id}"`));
    } catch {
      /* no file yet */
    }
    await mkdir(dirname(LEADS_PATH), { recursive: true });
    await appendFile(LEADS_PATH, JSON.stringify({ ...lead, ts: new Date().toISOString() }) + "\n", "utf8");
    return { ok: true as const, returning };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: "lead_store_failed" });
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
