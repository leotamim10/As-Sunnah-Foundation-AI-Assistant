/**
 * smoke.ts — validate a running gateway end-to-end, without a browser or mic.
 *
 *   npm run smoke                 # hits http://localhost:8787
 *   GATEWAY_URL=... npm run smoke # or point somewhere else
 *
 * Checks, in order:
 *   1. GET  /health            → { ok: true }              (no keys needed)
 *   2. POST /respond (text)    → Bengali { response }      (needs GEMINI_API_KEY)
 *   3. POST /tts     (Bengali) → non-empty 24 kHz PCM      (needs AZURE_SPEECH_* )
 *
 * Exit code is non-zero if any check fails, so it drops into CI as-is.
 */
const BASE = (process.env.GATEWAY_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TIMEOUT_MS = 45_000;

let failures = 0;

function pass(msg: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function fail(msg: string, detail?: unknown): void {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  if (detail !== undefined) console.log(`      ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function checkHealth(): Promise<void> {
  console.log("health:");
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5_000) });
    const json = (await res.json()) as { ok?: boolean };
    if (res.ok && json.ok === true) pass("GET /health → { ok: true }");
    else fail(`GET /health returned ${res.status}`, JSON.stringify(json));
  } catch (err) {
    fail("GET /health unreachable — is the gateway running?", err);
  }
}

async function checkRespond(): Promise<void> {
  console.log("respond (Gemini):");
  try {
    const res = await post("/respond", { text: "তুমি কে? এক লাইনে বলো।", lang: "bn" });
    if (!res.ok) return fail(`POST /respond returned ${res.status}`, await res.text());
    const json = (await res.json()) as { transcription?: string; response?: string };
    if (json.response && json.response.trim().length > 0) {
      pass("POST /respond returned a reply");
      console.log(`      reply: ${json.response}`);
    } else {
      fail("POST /respond returned an empty response", JSON.stringify(json));
    }
  } catch (err) {
    fail("POST /respond failed", err);
  }
}

async function checkTts(): Promise<void> {
  console.log("tts (Azure bn-BD):");
  try {
    const res = await post("/tts", { text: "আসসালামু আলাইকুম, আপনি কেমন আছেন?" });
    if (!res.ok) return fail(`POST /tts returned ${res.status}`, await res.text());
    const json = (await res.json()) as { audioB64?: string; sampleRate?: number };
    const bytes = json.audioB64 ? Buffer.from(json.audioB64, "base64").length : 0;
    if (bytes > 0 && json.sampleRate === 24_000) {
      pass(`POST /tts → ${bytes.toLocaleString()} bytes PCM @ ${json.sampleRate} Hz`);
    } else {
      fail("POST /tts returned no/short audio or unexpected sampleRate", JSON.stringify({ bytes, sampleRate: json.sampleRate }));
    }
  } catch (err) {
    fail("POST /tts failed", err);
  }
}

async function main(): Promise<void> {
  console.log(`\nGateway smoke test → ${BASE}\n`);
  await checkHealth();
  await checkRespond();
  await checkTts();

  console.log("");
  if (failures === 0) {
    console.log("\x1b[32mAll checks passed.\x1b[0m\n");
  } else {
    console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m\n`);
    process.exitCode = 1;
  }
}

main();
