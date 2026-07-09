# Decision Record — Hugging Face understanding backend

**Status:** Accepted & implemented (default off) · **Scope:** `ai-gateway/` (+ `.env.example`)

## Context

We needed a **card-free alternative to the Gemini free tier** (whose daily quota we exhausted during
testing). The `doc/Hugging_Face_Inference_endpoints/` package proposed a Hugging Face path:

- **Whisper `large-v3`** for STT (Bengali-capable, token-only) via `@huggingface/inference`
- **Qwen3-32B** for generation via HF's OpenAI-compatible router (`:cerebras`/`:groq` optional)
- An `HfUnderstandingAdapter` that chains STT → LLM behind the existing `UnderstandingAdapter` contract

## Decision

### 1. Adapt it **in this repo** — do **not** create a separate repo.

The gateway already hides the provider behind an `UnderstandingAdapter` interface selected by an env
var (the same seam `GeminiAdapter` uses, and the same pattern the earlier Ollama backend used). Adding
HF is **one more implementation of that interface + a switch** — not a restructuring.

| Considered | Verdict |
| ---------- | ------- |
| **Same repo (chosen)** | Reuses contracts, RAG `retrieve()`, prompts, Edge TTS, `server.py`, WS protocol, frontend, lead-capture, and rate-limit signal — all unchanged. It is the *same product* (the As-Sunnah bot) with a different brain. |
| Separate repo | Rejected — would duplicate the entire gateway + KB + frontend + Python server and immediately diverge; huge upkeep for what is ~3 small files + a switch. Only justified if this were a *different* product (e.g. a generic multi-tenant inference gateway). |

### 2. The doc's files were a **stale snapshot** — adapted, not pasted verbatim.

They predated the RAG + lead-capture work. Three breakages were fixed on the way in:

1. `hf-understanding.ts` imported `SYSTEM_PROMPT_BN`, which **no longer exists** (prompts.ts now exports
   `RAG_SYSTEM_PROMPT_BN` + `buildGroundedPrompt`). → rewritten.
2. The doc's HF path did **no RAG** — it would have answered *ungrounded* (a regression vs the grounded
   Gemini path). → `HfUnderstandingAdapter` now calls `retrieve()` and builds the **same grounded prompt**
   as `GeminiAdapter`, so answers read identically.
3. The doc's `server.ts` would have **overwritten** the current one (losing `/suggestions`, `/lead`, the
   `isRateLimit` 429 signal, the `FallbackTtsAdapter` chain, retrieve-warmup; and it hardcoded a bogus
   `gemini-3.5-flash`). → only the `makeUnderstanding()` switch was grafted in.

## What was implemented

| File | Change |
| ---- | ------ |
| `ai-gateway/package.json` | add `@huggingface/inference` (v4) |
| `src/adapters/stt.ts` | `SttAdapter` + `HfWhisperAdapter` (Whisper large-v3). **v4 fix:** pass a `Blob`, not a `Buffer`. |
| `src/adapters/llm.ts` | `LlmAdapter` + `HfLlmAdapter` (Qwen3-32B via HF router) |
| `src/adapters/hf-understanding.ts` | chains STT → `retrieve()` → grounded LLM; same `{transcription,response}` contract, same empty-question fallback |
| `src/server.ts` | `makeUnderstanding()` env switch (`gemini`\|`hf`); the provider's key is required only when selected; `isRateLimit` broadened to catch HF 429s too |
| `.env.example` | `UNDERSTANDING_PROVIDER`, `HF_TOKEN`, `HF_STT_MODEL`, `HF_LLM_MODEL` |

Default stays **gemini** — zero behavior change until `UNDERSTANDING_PROVIDER=hf` is set.

## How to use

```bash
cd ai-gateway && npm i        # @huggingface/inference already in package.json
# free token (no card): https://huggingface.co/settings/tokens
# in .env:
UNDERSTANDING_PROVIDER=hf
HF_TOKEN=hf_...
# optional overrides: HF_STT_MODEL, HF_LLM_MODEL (e.g. Qwen/Qwen3-32B:cerebras)
```

Flip back to `gemini` anytime — nothing else changes. Both paths keep the free-usage lead form (429).

## Caveats

- **Not unlimited** — HF Inference free tier has its own monthly credits/limits; a *different, card-free*
  pool, not infinite. The lead-capture-on-429 flow applies to both providers.
- **Text-only** — the HF path drops the camera image (open LLMs aren't multimodal). Use `gemini` for vision.
- **Two hops + cold starts** — STT then LLM is slower than Gemini's single call; serverless models can
  cold-start. `:cerebras`/`:groq` suffixes route to faster providers (may need enabling on the account).
- **SDK drift** — `@huggingface/inference` param names shift between majors. Pinned to **v4**; the ASR
  input is a `Blob` in v4 (fixed above). Re-verify on any major bump.
- **Bengali quality** — Whisper large-v3 STT is strong; Qwen3-32B generation is decent but worth an
  A/B against Gemini's bn-BD register before promoting HF to default.

## Verification

typecheck ✓ · build ✓ · 12/12 tests ✓ · boots in `hf` mode with **no** `GEMINI_API_KEY` (only `HF_TOKEN`).
A live `/respond` needs a real `HF_TOKEN` (not run here).
