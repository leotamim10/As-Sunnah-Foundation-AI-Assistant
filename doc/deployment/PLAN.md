# Deployment plan — free cloud demo

**Status:** Artifacts built & validated · **Target:** Hugging Face Spaces (Docker, free)

## Stack constraints

- **Two services**: Python web (`server.py`, FastAPI + **WebSocket `/ws`**, public) → internal Node
  gateway (Fastify, `:8787`). They talk over `localhost` via `GATEWAY_URL`.
- **~400–600 MB RAM** — the gateway loads the `multilingual-e5` ONNX embedding model (RAG). This is
  the main free-tier filter (256–512 MB tiers are tight).
- **WebSockets** — browser `/ws` **and** Edge TTS's outbound WS to Bing.
- **HTTPS** — required for camera/mic (secure context). Every real platform provides it.
- **Outbound HTTPS** — Gemini / HF / Groq / OpenRouter.
- **Secrets** — the API keys (never committed).
- **Persistence** — `data/leads.jsonl` (nice-to-have; ephemeral is fine for a demo).

## Free-tier comparison

| Platform | Free? | RAM | WS | Card | Fit |
| --- | --- | --- | --- | --- | --- |
| **HF Spaces (Docker)** | ✅ perpetual | **16 GB** | ✅ | ❌ none | **Chosen** — roomy, no card, single container; ephemeral disk; sleeps on inactivity |
| Google Cloud Run | ✅ free tier (2M req/mo) | configurable | ✅ | ✅ req'd | Scales to zero; 2 services or combined; needs billing |
| Render | ✅ free web service | 512 MB | ✅ | ~ | Simplest; **512 MB tight** for e5; sleeps after 15 min |
| Fly.io | small free / PAYG | 256 MB free | ✅ | ✅ req'd | 256 MB too small → 512 (cheap, not free) |
| Railway | ❌ trial only | — | ✅ | ✅ | No perpetual free |
| Vercel / Netlify | — | — | ❌ | — | Serverless — can't hold the WS server/gateway |

Sources: [HF Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview),
[Docker Spaces](https://huggingface.co/docs/hub/en/spaces-sdks-docker).

## Decision — Hugging Face Spaces (Docker)

Free **2 vCPU / 16 GB RAM / 50 GB ephemeral disk**, no card, Docker + WebSockets. The 16 GB RAM
trivially handles the e5 model, and we already use HF for LLM/STT.

Spaces run **one container on one port**, so the stack is combined into a single image.

## Artifacts (built + validated)

| File | Role |
| --- | --- |
| `Dockerfile` (root) | Multi-stage: build the gateway (compile TS, warm e5, bake KB) → runtime adds Python and both apps. |
| `start.sh` | Runs the gateway (`:8787`, internal) and the web server (`:$PORT`, default **7860**); exits if either dies so the Space restarts. |
| `.dockerignore` | Keeps the build context small/reproducible. |
| `README.md` frontmatter | `sdk: docker`, `app_port: 7860` — how the Space runs the image. |

Validated locally end-to-end in one container: `GET /` (200), `GET /models` (5 models), and a live
WS turn (`/ws` → gateway → HF Qwen3 → grounded Bengali). No conflict with `docker-compose` (which
still uses the per-service `src/Dockerfile` + `ai-gateway/Dockerfile`).

## Deploy steps

1. **Frontmatter** — already in `README.md` (title/emoji/`sdk: docker`/`app_port: 7860`).
2. **Create a Docker Space** on Hugging Face.
3. **Add Secrets** (Space → Settings → Variables and secrets):
   `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `HF_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`
   (+ optional `GEMINI_MODEL`, `MODEL_CHAIN`). **Do not set `PORT`** — the image defaults to 7860.
4. **Push**:
   ```bash
   git remote add space https://huggingface.co/spaces/<user>/<name>
   git push space main
   ```
5. It builds and serves at `https://<user>-<name>.hf.space` (HTTPS → camera/mic work).

## Caveats (free demo)

- **Ephemeral disk** → `leads.jsonl` resets on restart. Fine for a demo, or persist to a HF Dataset repo.
- **Sleeps on inactivity** → ~30–60 s cold start (reloads the e5 model).
- **Public Space = public API usage** → visitors spend your free-tier quotas. Mitigated by the 5-model
  failover + the lead form on exhaustion; set the Space **private** to gate it.
- **Model auto-download at build** — the build fetches the e5 model + the foundation KB API (needs
  egress at build time); both are then baked into the image (no runtime download).
