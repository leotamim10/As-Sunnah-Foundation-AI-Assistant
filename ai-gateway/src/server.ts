/**
 * server.ts — the gateway HTTP surface parlor's Python server calls.
 * Wiring is complete; it will run once the two adapter TODOs are filled.
 */
import Fastify from "fastify";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RespondRequest, TtsRequest, LeadRequest } from "./contracts.js";
import { GeminiAdapter, type UnderstandingAdapter } from "./adapters/understanding.js";
import { HfWhisperAdapter } from "./adapters/stt.js";
import { OpenAICompatLlmAdapter } from "./adapters/openai-compat-llm.js";
import { ComposedUnderstandingAdapter } from "./adapters/composed-understanding.js";
import { FailoverUnderstandingAdapter, AllModelsExhaustedError, type ChainEntry } from "./adapters/failover.js";
import { AzureBnBDAdapter, FallbackTtsAdapter, type TtsAdapter } from "./adapters/tts.js";
import { EdgeTtsAdapter } from "./adapters/edge.js";
import { retrieve, getSuggestions } from "./rag/retrieve.js";
import { isRateLimit } from "./ratelimit.js";
import { buildChain, publicModels, type ModelEntry } from "./models.js";

const LEADS_PATH = process.env.LEADS_PATH ?? "data/leads.jsonl";

/* ---------- config ---------- */
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PORT = Number(env("PORT", "8787"));

// ---------- multi-model failover chain ----------
// One shared Whisper STT (for the text-LLM providers; Gemini does its own STT). null if no HF_TOKEN,
// in which case text turns still work on those providers but voice fails over to Gemini.
const sharedStt = process.env.HF_TOKEN
  ? new HfWhisperAdapter({ token: process.env.HF_TOKEN, model: process.env.HF_STT_MODEL })
  : null;

function makeAdapter(entry: ModelEntry): UnderstandingAdapter {
  const apiKey = process.env[entry.apiKeyEnv] as string;
  if (entry.provider === "gemini") return new GeminiAdapter({ apiKey, model: entry.model });
  // hf / groq / openrouter — all OpenAI-compatible, sharing the Whisper STT.
  const llm = new OpenAICompatLlmAdapter({
    baseURL: entry.baseURL as string,
    apiKey,
    model: entry.model,
    headers:
      entry.provider === "openrouter"
        ? { "HTTP-Referer": "https://assunnahfoundation.org", "X-Title": "As-Sunnah Foundation AI" }
        : undefined,
  });
  return new ComposedUnderstandingAdapter(sharedStt, llm);
}

const chain: ModelEntry[] = buildChain();
if (chain.length === 0) {
  throw new Error(
    "No models available — set at least one provider key (GEMINI_API_KEY / HF_TOKEN / GROQ_API_KEY / OPENROUTER_API_KEY).",
  );
}
const chainEntries: ChainEntry[] = chain.map((e) => ({
  id: e.id,
  name: e.name,
  hasVision: e.hasVision,
  adapter: makeAdapter(e),
}));
const understanding = new FailoverUnderstandingAdapter(chainEntries);
console.log(`model chain: ${chain.map((e) => e.id).join(" → ")}`);

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

// The failover chain (names + limitations, no keys) for the UI's model selector.
app.get("/models", async () => ({ models: publicModels(chain), activeId: understanding.activeId() }));

app.post("/respond", async (req, reply) => {
  const parsed = RespondRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    return await understanding.respond(parsed.data);
  } catch (err) {
    req.log.error(err);
    // Every model rate-limited → free-usage-ended form. Exhausted by transient errors (5xx/empty/
    // network) → a plain retryable error, not the lead form.
    if (err instanceof AllModelsExhaustedError) {
      return err.rateLimited
        ? reply.code(429).send({ error: "rate_limited" })
        : reply.code(502).send({ error: "understanding_failed" });
    }
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
