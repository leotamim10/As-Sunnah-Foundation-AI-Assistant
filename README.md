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
| `POST /respond` | `{ audioB64?, imageB64?, text?, lang="bn" }` | `{ transcription, response }`                       |
| `POST /tts`     | `{ text, voice? }`                           | `{ audioB64, sampleRate }` (24 kHz 16-bit mono PCM) |
| `GET /health`   | —                                            | `{ ok: true }`                                      |

Schemas are enforced with zod in `ai-gateway/src/contracts.ts`.

## Run fully local (no Gemini, no rate limits)

Swap the cloud understanding step for local models — **generation via [Ollama](https://ollama.com)** and
**voice via a local Whisper server** — so nothing hits Gemini. Retrieval (e5) and TTS (Edge) are already
local. Enable with `UNDERSTANDING_PROVIDER=ollama`.

```bash
# 1) Ollama (generation)
ollama pull qwen2.5:7b        # ~4.7GB; multilingual incl. Bengali. Use qwen2.5:3b for speed.
ollama serve                  # http://localhost:11434

# 2) Whisper (voice STT) — any OpenAI-compatible server, e.g. faster-whisper-server / speaches
docker run -d -p 8001:8000 fedirz/faster-whisper-server:latest-cpu   # http://localhost:8001

# 3) point the gateway at them (in .env)
UNDERSTANDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434         # http://host.docker.internal:11434 from inside Docker
OLLAMA_MODEL=qwen2.5:7b
WHISPER_URL=http://localhost:8001         # omit to keep text-only (no voice)
```

Notes:
- **Text works with just Ollama**; voice additionally needs `WHISPER_URL`.
- From the Docker containers, `localhost` won't reach host servers — use `host.docker.internal`.
- Local models are weaker than Gemini at natural bn-BD; `qwen2.5:7b` / `gemma2:9b` are the best bets.
- Same `{transcription, response}` contract → `server.py`, the WS protocol, the frontend, and TTS are unchanged.

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
