# Plan — Multi-model failover + selection

**Status:** Approved → implementing · **Scope:** `ai-gateway/`, `src/server.py`, `src/index.html`, `.env.example`

## Goal

Hold multiple LLM models (each with a name + its own API key), **auto-fail over to the next when one
hits its free-tier rate limit (429)**, show the **active model in the chat head**, and let the user
**pick a model** and see each model's **limitations** (so they understand a weak answer).

Decisions (from review): models+keys chain · auto-failover **and** manual pick · providers Gemini +
Hugging Face + Groq + OpenRouter · build after this plan.

## Key simplification

HF, Groq, and OpenRouter are all **OpenAI-compatible** (`/v1/chat/completions`) → **one
`OpenAICompatLlmAdapter`** (baseURL + key + model) serves all three. A **shared Whisper STT**
(large-v3 via fal-ai, already fixed for Bengali) feeds every text-LLM provider. **Gemini** keeps its
own multimodal adapter (STT + vision in one call).

## 1. Model registry — `ai-gateway/src/models.ts`

A code **catalog** of known models; the **active chain** = catalog entries whose key env is set,
ordered by env.

```ts
interface ModelEntry {
  id; name;                    // "gemini-1" · "Gemini 2.5 Flash"
  provider: 'gemini'|'hf'|'groq'|'openrouter';
  model;                       // provider model id
  apiKeyEnv;                   // e.g. GEMINI_API_KEY_2
  baseURL?;                    // openai-compat providers
  hasVision;                   // Gemini true, others false
  limitations: { en; bn };     // shown in the selector
}
```

- Entry included only if `apiKeyEnv` is set (missing key → skipped).
- Order via `MODEL_CHAIN=gemini-1,gemini-2,groq-llama,hf-qwen3,openrouter-qwen`; else default =
  `UNDERSTANDING_PROVIDER` first, then the rest → **no behavior change** for current setups.
- Default active = first in chain.

## 2. Multiple keys — `.env` (git-ignored)

```
GEMINI_API_KEY_1=   GEMINI_API_KEY_2=     # different Google projects → separate quota
HF_TOKEN=           GROQ_API_KEY=         OPENROUTER_API_KEY=
MODEL_CHAIN=gemini-1,gemini-2,groq-llama,hf-qwen3,openrouter-qwen
```
`GET /models` never exposes keys.

## 3. Gateway files

| File | Role |
|---|---|
| `models.ts` (new) | catalog + `buildChain()` from env |
| `ratelimit.ts` (new) | `isRateLimit()` (moved from server.ts; shared) |
| `adapters/openai-compat-llm.ts` (new) | one `LlmAdapter` for HF/Groq/OpenRouter (Qwen `<think>` strip, timeout) |
| `adapters/composed-understanding.ts` (new) | shared Whisper STT → retrieve → any `LlmAdapter` (generalizes `hf-understanding`) |
| `adapters/failover.ts` (new) | `FailoverUnderstandingAdapter` |
| `server.ts` | build chain, wrap in failover, `GET /models`, pass `modelId`; all-exhausted → `429 {rate_limited}` |
| `contracts.ts` | `RespondRequest.modelId?`, `RespondResponse.model/modelId`, `ModelsResponse` |

**Failover:** try preferred entry → on `isRateLimit`, advance → return `{...res, model, modelId}` from
the winner. All exhausted → throw `allExhausted` → server `429 {rate_limited}` → **existing lead form**.

## 4. `server.py` (small diff)

- Pass `modelId` (user's pick) to `/respond`.
- Add `model` to the WS `text` reply → head shows it, reflects auto-failover.
- Proxy `GET /models`.
- Browser WS message gains an optional `model` field (additive, like `rate_limited`).

## 5. Frontend — `src/index.html`

- **Head indicator**: the topbar `Gemini Flash · Edge bn-BD` becomes a live **`● {active model} ▾`** button.
- **Selector dropdown**: `GET /models` → the batch list; each row shows **name + vision/text badge +
  bilingual limitation caption**. Click pins it (`localStorage asf_model`), sent as `modelId`.
- **Live update**: each WS `text` reply sets the head to `msg.model` (auto-failover is visible).
- i18n for chrome; limitations come bilingual from `/models`.

## 6. STT for text providers

Shared **HF Whisper** (large-v3 via fal-ai, needs `HF_TOKEN`) transcribes voice for HF/Groq/OpenRouter
entries. Gemini does its own STT. (Groq-Whisper as a future STT fallback if no `HF_TOKEN`.)

## 7. Verification

- Unit: failover order, 429→next, all-exhausted→throw, non-429 doesn't fail over.
- Live: force a Gemini 429 (point `gemini-1` at `gemini-2.0-flash`) → confirm failover to the next
  entry, answer, and head shows the fallback model; check `/models`; check manual pin.

## Caveats (surfaced in the UI `limitations`)

- Text-only providers drop the camera image (no vision) — badge signals it.
- Extra Gemini keys add quota only if from different projects/accounts.
- A failover adds the latency of the failed 429 call before the next.
- Each provider's free tier has its own limits (encoded per model).

## Safety

Default-off in spirit: with only today's keys set, the chain is Gemini + HF as now. New providers
activate only when their key is added. No secrets committed (`.env` git-ignored; `/models` key-free).
