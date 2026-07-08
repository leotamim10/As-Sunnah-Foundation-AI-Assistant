# CLAUDE.md — parlor → Bengali port

> Assessment: adapt an unfamiliar Python/FastAPI app to **fully support Bengali** and make it
> **run end-to-end**, swapping the on-device models for free-tier APIs. **New code = Node/JS.**
> Graded: (1) JS/Node quality first, (2) clean integration with the existing code second.
> Bar: _working, not flawless._ Bengali must read **natural, native Bangladeshi (bn-BD)** — not literal/robotic.

---

## 1. Existing app (read, don't rewrite)

Three files do everything, in `src/`:

| File                      | Role                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `index.html` (~877 lines) | Browser UI + inline JS: mic VAD, camera, WebSocket client, streamed audio playback, transcript |
| `server.py` (~236 lines)  | FastAPI WebSocket `/ws` loop + on-device inference orchestration                               |
| `tts.py` (~70 lines)      | Kokoro TTS (will be bypassed)                                                                  |

**Current pipeline:** Browser → WS `/ws` → **Gemma 4 E2B** (`litert_lm`, one model does STT+vision+reply via a
`respond_to_user(transcription, response)` tool call) → **Kokoro** TTS → audio streamed back sentence-by-sentence.

**WebSocket protocol — DO NOT CHANGE (browser contract):**

```
client → server : { "type":"interrupt" } | { "audio":b64, "image"?:b64, "text"?:str }
server → client : { "type":"text", "text", "llm_time", "transcription"? }
                  { "type":"audio_start", "sample_rate", "sentence_count" }
                  { "type":"audio_chunk", "audio":b64(int16 PCM), "index" }
                  { "type":"audio_end", "tts_time" }
```

---

## 2. Target architecture

Keep Python as the WS server; move all new AI glue into a **Node service**. Minimal Python diff = the "I understood the code" signal.

```
index.html   ── Bengali UI + i18n (your JS) ─────────────┐
   │ WS /ws  (protocol UNCHANGED)                         │
   ▼                                                      ▼
server.py    ── ~30-line diff: prompts→Bengali,      ai-gateway/ (Node — THE GRADED CORE)
   │            call gateway instead of litert/kokoro ─►  POST /respond {audioB64,imageB64?,lang}
   │  HTTP (internal)                                        → {transcription, response}
   │                                                      POST /tts     {text, voice}
   └──────────────────────────────────────────────────►     → {pcm|wav}
```

**Model swap strategy:** replace the single on-device multimodal model with **Gemini Flash** (natively takes
audio+image in one call, free tier; use function-calling to keep the exact `{transcription, response}` shape).
Fallback if audio-in is flaky: STT (Groq Whisper) → Gemini text.

**Providers (free tier):**

- Understanding+reply: **Gemini** `gemini-2.5-flash` _or newer — confirm current model string at build time._
- TTS: **Azure Neural bn-BD** → `bn-BD-NabanitaNeural` (F) / `bn-BD-PradeepNeural` (M). Dhaka register.
  ⚠️ Use **bn-BD, NOT bn-IN** (Kolkata) — bn-IN reads foreign to Bangladeshi users. Fallback: ElevenLabs multilingual.

**Env (`.env.example`, never commit real keys):**

```
GEMINI_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
GATEWAY_URL=http://localhost:8787
PORT=8000
```

---

## 3. Where "language" lives (no i18n framework exists — that's part of the task)

1. **AI reply language** → `server.py`: `SYSTEM_PROMPT` + the per-turn instruction strings
   (`"The user just spoke to you..."`). Rewrite in Bengali; instruct **natural conversational Bangladeshi Bangla**,
   avoid stiff/Sanskritized/Kolkata-literary register.
2. **UI chrome** → `index.html`, hardcoded ~12 strings: `labels` object (`Loading...`/`Listening`/`Thinking...`/`Speaking`),
   `setStatus(...)` (`Connected`/`Disconnected`/`Processing`), camera button (`Camera On/Off`), `model-label`, meta (`LLM {n}s`, `with camera`).
3. **Fonts** → add `Noto Sans Bengali` (current Instrument Sans/Syne don't render Bengali conjuncts/মাত্রা).

---

## 4. Directory layout to create

```
CLAUDE.md                 ← this file
NAVIGATION.md             ← 1-page: file map + WS contract + "single-model→API" decision record (comprehension evidence)
docker-compose.yml        ← runs python + node together
.env.example
src/                      ← EXISTING — adapt, keep diff small
  server.py               ← seams below
  index.html              ← Bengali UI + i18n
ai-gateway/               ← NEW Node service (TypeScript)
  package.json  tsconfig.json
  src/
    server.ts             ← Fastify: /respond, /tts, /health
    contracts.ts          ← zod schemas (mirror §2 shapes)
    adapters/gemini.ts    ← audio+image → {transcription, response}
    adapters/tts.ts       ← TtsAdapter iface; AzureBnBD impl (+ fallback)
  test/                   ← a couple of adapter/contract tests
```

**`server.py` seams to change (only these):**

- `SYSTEM_PROMPT` + per-turn text blocks → Bengali
- `conversation.send_message({...audio,image,text...})` → `await` HTTP `POST {GATEWAY_URL}/respond`
- `tts_backend.generate(sentence)` (inside the sentence loop — keep the loop for streaming/barge-in) → `POST {GATEWAY_URL}/tts`
- `load_models()` / `resolve_model_path()` / HF download → remove (no on-device model)
- Leave WS framing, interrupt handling, `audio_start/chunk/end` untouched.

**Frontend i18n:** simplest = inline a `const bn = {...}` string table + `t(key)` in `index.html` (keeps Python diff = 0).
Cleaner JS signal = `src/locale/bn.js` + one static route. Prefer inline unless time allows.

---

## 5. Task board (phase by phase — gate before moving on)

**Phase 0 — Recon** ▸ _START HERE_

- [ ] Write `NAVIGATION.md` (file map, WS contract, model-swap decision). Gate: Python seam is minimal, browser contract preserved.

**Phase 1 — Contracts** (blocks everything else)

- [ ] `ai-gateway/src/contracts.ts`: freeze `/respond` + `/tts` request/response schemas (zod). WS protocol stays as-is.

**Phase 2 — Build (parallel once contracts frozen)**

- [ ] **ai-gateway (highest care):** Fastify `server.ts` + `/health`; `GeminiAdapter` (audio+image+Bengali system prompt, function-calling); `TtsAdapter` → Azure bn-BD; timeouts, errors, provider fallback; TypeScript types; 1–2 tests.
- [ ] **server.py:** apply the 5 seams above; Bengali prompts.
- [ ] **index.html:** i18n module + all §3.2 strings in Bengali; Noto Sans Bengali; Bengali transcript rendering; update `model-label`.

**Phase 3 — Gates / done**

- [ ] **qa:** end-to-end — speak → Bengali transcript → Bengali reply → Bengali audio plays.
- [ ] **native review:** Bengali reads natural (bn-BD register); numbers/currency (৳, লাখ/কোটি) correct.
- [ ] **security:** no committed keys; only `.env.example`.
- [ ] **devops:** `docker-compose up` (or one script) runs both; README with setup + run steps.

---

## 6. Guardrails

- Keep the `server.py` diff small and obviously-correct (integration score).
- Put polish into `ai-gateway/` + frontend i18n (JS score).
- Never commit API keys. bn-BD not bn-IN. Bengali must sound native, not machine-translated.
- Don't touch the WS message shape.
