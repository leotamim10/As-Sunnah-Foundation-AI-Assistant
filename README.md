# As-Sunnah Foundation AI Assistant

[![Repository](https://img.shields.io/badge/GitHub-As--Sunnah--Foundation--AI--Assistant-181717?logo=github&logoColor=white)](https://github.com/leotamim10/As-Sunnah-Foundation-AI-Assistant)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-%E2%89%A53.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

Real-time, multimodal AI you talk to: speak into the mic (optionally showing your camera) and it
replies in **natural, spoken Bangladeshi Bangla (Dhaka register)** — both as on-screen text and streamed voice.

Originally an on-device demo (Gemma + Kokoro), ported to run **end-to-end on free-tier cloud APIs**:

- **Understanding** — Google **Gemini** (`gemini-2.5-flash`): audio (+ optional image) → `{transcription, response}` in one multimodal call.
- **Speech** — Microsoft **Edge** neural voices (`bn-BD-NabanitaNeural`, Bangladeshi — **not** Kolkata `bn-IN`).
  Same voices as Azure but **no key / subscription / card**. Azure is wired as an optional paid fallback.

Result: **zero paid dependencies** — Gemini free tier + Edge for voice.

## Features

Everything below is enabled and live in the app.

### 🗣️ Conversation & AI

| Feature | What it does |
| ------- | ------------ |
| **Multimodal understanding** | Gemini takes **audio (+ optional camera image)** and returns `{transcription, response}` in one call. |
| **Grounded answers (RAG)** | Replies are grounded in the foundation's own data — the model is instructed never to invent facts. |
| **Streaming voice reply** | The answer is split into sentences and TTS-streamed back sentence-by-sentence for low latency. |
| **Barge-in / interrupt** | Speaking or sending again interrupts the in-flight reply. |
| **Text chat** | Type a question — same pipeline, no mic required. |
| **Typewriter replies** | Assistant text types out grapheme-by-grapheme (Bengali-conjunct-safe), with a blinking caret. |
| **Multi-model failover** | An ordered chain of models/keys (Gemini ×2 · HF Qwen3 · Groq · OpenRouter). On a **429 or a transient error** (5xx/empty/timeout/network) it auto-switches to the next model; only an all-rate-limited chain shows the lead form. |
| **Graceful rate-limit** | On free-tier exhaustion across the whole chain the app degrades cleanly and surfaces a lead form (below) instead of erroring. |

### 📚 Knowledge base (RAG)

| Feature | What it does |
| ------- | ------------ |
| **Local embeddings** | `Xenova/multilingual-e5-small` embeds questions + KB **locally** (no API, no key). |
| **Retrieval grounding** | Top-k knowledge passages injected as context on every turn. |
| **KB-derived suggestions** | Recommended questions generated from the KB — shown as input chips **and** voice commands. |
| **Weekly refresh** | `scripts/refresh.sh` re-ingests the foundation API and restarts the gateway. |

### 🎙️ Voice & vision

| Feature | What it does |
| ------- | ------------ |
| **Voice input (VAD)** | Browser mic with voice-activity detection; autoplay-safe start. |
| **Camera / vision** | Show the camera and ask about what's on screen. |
| **bn-BD neural TTS** | Edge `bn-BD-NabanitaNeural` / `PradeepNeural` (Dhaka register, **card-free**); Azure paid fallback. |
| **Permission indicators** | Live mic/camera permission dots + a one-click **Allow** button that opens the browser prompt. |
| **Opt-in by default** | Nothing is acquired on load — no permission prompt until you click a button. |

### 🎨 UI / UX

| Feature | What it does |
| ------- | ------------ |
| **Feature-promotion panel** | Skill Development / Donation cards; suggestion chips switch the panel. |
| **Course flowchart** | Interactive course tree; the **first course opens by default**; per-course deep links. |
| **Voice-command flip card** | Focusing **Listen** flips the card to sample voice commands, with an animated right-angle **beam** that cycles the active command. |
| **Animated backdrop** | Slow, drifting ambient glow behind the panels. |
| **Glass theme** | Light shadcn-style theme — translucent cards, gradients, subtle borders. |
| **Model selector** | A picker in the controls row shows the active model and lets you pin one; each entry carries a vision/text badge and its bilingual limitation note. The head updates to whichever model actually answered after a failover. |
| **Hidden scrollbars** | Clean left/right panes (scrolling preserved). |

### 🚀 Onboarding & growth

| Feature | What it does |
| ------- | ------------ |
| **Guided tour** | After-landing coach-marks spotlight each control (connection, status, Listen, Camera, input, cards). A **Help (?)** button reopens it anytime. |
| **Free-usage lead form** | When free usage ends, a professional modal collects **name / email / phone / interest** (with consent). |
| **Lead store** | Submissions append to a **git-ignored** `data/leads.jsonl` with a client `id`, **server-captured IP**, and timestamp. |
| **Returning-visitor greeting** | Recognizes returning visitors (localStorage id) with a welcome-back toast. |
| **User profile** | A topbar profile shows the visitor's locally-stored details (name/email/phone/interest) with **Edit** (reopens the form prefilled) and **Clear**; a guest chip opens the form to add them. |

### 🌐 Localization

| Feature | What it does |
| ------- | ------------ |
| **EN / বাং toggle** | Full UI i18n; content (KB answers, suggestions) stays Bengali. |
| **Natural bn-BD** | Prompts tuned for spoken Bangladeshi Bangla; currency ৳ and লাখ/কোটি. |

### 🛠️ Ops & infra

| Feature | What it does |
| ------- | ------------ |
| **Docker Compose** | One-command stack (web + gateway; optional Caddy HTTPS). |
| **Local HTTPS** | Opt-in Caddy TLS proxy for camera/mic secure context. |
| **Health + tests** | `/health`, zod contract tests, `npm run smoke`, TTS sample preview. |
| **Zero paid deps** | Runs on the Gemini free tier + Edge TTS out of the box. |

## Architecture

```
Browser (index.html)  ──WS /ws──►  server.py (FastAPI)  ──HTTP──►  ai-gateway (Node/TS)  ──►  Gemini + Azure
   Bengali UI + i18n                 WS loop, streaming TTS          /respond  /tts  /health
```

The **WebSocket protocol between browser and `server.py` is unchanged**. All AI work lives in the
Node gateway (`ai-gateway/`) — that's the graded core. See [`NAVIGATION.md`](NAVIGATION.md) for the
file map, the frozen contracts, and the model-swap decision record.

| Path             | Role                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `src/server.py`  | FastAPI WS server; calls the gateway's `/respond` + `/tts`. Bengali sentence-streaming. |
| `src/index.html` | Single-file UI + inline JS: mic VAD, camera, playback, and a `bn` i18n table.           |
| `ai-gateway/`    | Node/TS gateway: Gemini + Azure adapters, zod contracts, Fastify server, tests.         |

## Prerequisites

- A **Gemini API key** — https://aistudio.google.com/apikey (free tier). _(only paid-tier-free requirement)_
- **TTS needs nothing** — Edge voices are card-free. _(Optional: Azure Speech key + region for a paid fallback.)_
- Either **Docker** (recommended) or **Node ≥ 20** + **Python ≥ 3.12** for local dev.

## Setup

```bash
cp .env.example .env
# then edit .env and fill in GEMINI_API_KEY, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION
```

`.env` is git-ignored — never commit real keys.

## Run with Docker (recommended)

```bash
docker compose up --build
```

Open **http://localhost:8000** and start talking (or type). The gateway stays internal to the compose
network; only the web server is published.

> **Camera & mic need a secure context.** Browsers only expose `getUserMedia` over **HTTPS** or
> `localhost`. On `http://localhost:8000` the mic/camera buttons work; on any other host they won't —
> use the Local HTTPS setup below. (Text chat works anywhere.)

## Local HTTPS (for camera & mic)

A Caddy reverse-proxy terminates TLS with a self-signed cert and proxies to the web server (WebSockets
included), so camera/mic get a secure context:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

Open **https://localhost:8443** and accept the self-signed-cert warning once. Then click **শুনুন**
(Listen) → allow the mic, or the camera toggle → allow the camera. Plain HTTP on `:8000` still works
alongside it.

## Run locally (two terminals)

```bash
# 1) the Node gateway
cd ai-gateway
npm install
npm run dev            # http://localhost:8787  (GET /health → { ok: true })

# 2) the Python web server (from the repo root)
pip install fastapi httpx "uvicorn[standard]" websockets python-dotenv
python src/server.py   # http://localhost:8000
```

With both up, open http://localhost:8000.

## Gateway API (internal)

| Endpoint        | Request                                      | Response                                            |
| --------------- | -------------------------------------------- | --------------------------------------------------- |
| `POST /respond` | `{ audioB64?, imageB64?, text?, lang="bn" }` | `{ transcription, response }` — `429 {rate_limited}` on quota exhaustion |
| `POST /tts`     | `{ text, voice? }`                           | `{ audioB64, sampleRate }` (24 kHz 16-bit mono PCM) |
| `POST /lead`    | `{ id, name, email, phone, interest, lang, ip }` | `{ ok, returning }` — appends to git-ignored `data/leads.jsonl` |
| `GET /models`   | —                                            | `{ models: [{ id, name, provider, hasVision, limitations }], activeId }` (no keys) |
| `GET /health`   | —                                            | `{ ok: true }`                                      |

Schemas are enforced with zod in `ai-gateway/src/contracts.ts`.

## Tests & dev tools

All from `ai-gateway/`:

```bash
npm test          # contract + TTS-fallback tests (no keys needed)
npm run typecheck # tsc --noEmit
```

**Smoke-test a running gateway** — validates `/health`, `/respond` (Gemini), and `/tts` (Azure) in
isolation, no browser or mic. Exits non-zero on failure, so it works in CI:

```bash
npm run smoke                    # hits http://localhost:8787
GATEWAY_URL=... npm run smoke    # or point elsewhere
```

**Preview the Bengali voice** — synthesizes bn-BD verification samples to `scripts/samples/*.wav`
(natural Dhaka register, digits, currency ৳/টাকা, লাখ/কোটি) using the real Edge TTS adapter. Play them
to judge the register. **No keys needed** — but requires outbound WebSocket to Bing's endpoint:

```bash
npm run tts:sample                                # default female voice (Nabanita)
TTS_VOICE=bn-BD-PradeepNeural npm run tts:sample  # male voice (Mohammad Ahmed)
```

## Knowledge base (As-Sunnah Foundation RAG)

Answers are grounded in the foundation's own data (funds, services, donation accounts), retrieved from a
local knowledge base — the gateway never invents facts. See [`KNOWLEDGE.md`](KNOWLEDGE.md) for the design.

```bash
cd ai-gateway
npm run knowledge:build                     # ingest the JSON API → embed → knowledge/knowledge.json
npm run knowledge:query -- "যাকাত কিভাবে দেব?"  # eyeball retrieval (no LLM)
npm run knowledge:eval                       # retrieval quality: Q→expected-source, pass rate + mean rank
```

Embeddings default to `Xenova/multilingual-e5-small` (100% top-3 on the eval set). For a much larger KB,
`EMBED_MODEL=Xenova/multilingual-e5-base` swaps in a bigger model — rebuild the KB with the same value.

- **Docker** bakes the KB + embedding model into the gateway image at build time (no runtime download);
  `docker compose up --build` just works. _(Build needs HTTPS egress for the foundation API + a one-time
  Hugging Face model fetch.)_
- **Refresh** weekly to pick up new campaigns — re-ingests and restarts the gateway (model stays cached):

  ```bash
  ./scripts/refresh.sh
  # cron:  0 3 * * 0  cd /path/to/ai-gateway && ./scripts/refresh.sh >> /var/log/asf-refresh.log 2>&1
  ```

## Notes

- **bn-BD, not bn-IN.** The TTS voice and the Gemini system prompt both target Dhaka register;
  Kolkata/West-Bengal phrasing reads foreign to Bangladeshi users.
- The gateway `/respond` call is **stateless** per turn (no multi-turn memory) — a deliberate
  simplification of the original in-process conversation, matching the frozen contract.
- Providers are behind adapters (`UnderstandingAdapter`, `TtsAdapter`) so swapping Gemini→Groq or
  Edge→ElevenLabs is a one-class change. `FallbackTtsAdapter` chains **Edge (free demo path) →
  Azure (production path, added only when `AZURE_SPEECH_*` are set)**, so the same code runs card-free
  or paid without a rewrite.
- Edge TTS uses an **unofficial** public endpoint (fine for the "working, not flawless" bar). If it
  ever 403s, `npm update @travisvn/edge-tts`. The adapter bounds each call with a 15s timeout, so a
  blocked/hung endpoint fails cleanly and falls through to Azure when configured.
