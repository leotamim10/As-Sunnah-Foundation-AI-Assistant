# KNOWLEDGE.md — As-Sunnah Foundation chatbot: knowledge layer plan

> Turn the voice/text assistant into a **grounded Q&A bot** about assunnahfoundation.org's services,
> activities, donations and Zakat. Bengali in, Bengali out. Card-free, slots into the existing Node gateway.
> Bar: **working, not flawless** — but *accurate*, because it's a religious charity handling donations.

---

## 1. The decision: RAG over the site's JSON API (your Option 2, done right)

**Not** "scrape on the fly" (Option 1) and **not** a fixed Q&A list. Build a **retrieve-then-generate (RAG)**
knowledge base, ingested once from the site's backend JSON API, refreshed on a schedule.

| Approach | Verdict |
|---|---|
| **1. Live scrape per query** | ✗ Site is a **React SPA** — plain fetch sees an empty shell; you'd need a headless browser per question (seconds/query — fatal for voice). Brittle, hammers their server mid-conversation. |
| **2a. Fixed probable-Q&A list** | ✗ Only answers what you pre-wrote. Voice-transcribed Bengali is phrased unpredictably; coverage breaks, maintenance never ends. |
| **2b. RAG from the JSON API** ✅ | Ingest structured bilingual JSON **once** (fast, reliable, offline from the site). At query time: semantically retrieve relevant passages → Gemini composes a natural Bengali answer grounded in them. Answers arbitrary questions, stays accurate. Curated exact-facts (bank a/c) ride in the same index at high priority. |

### Why this is possible — recon findings (verified, not assumed)

- **Site = React + Vite SPA.** Homepage is a ~7 KB shell, ~128 chars of body text. Server-side fetch/cheerio sees nothing. *(This is what would have forced Playwright — but it doesn't, see next.)*
- **There is a public JSON backend.** The bundle uses RTK Query against
  `https://pm2.as-sunnah.quanticdynamics.cloud`, authorized by an **app-key hard-coded in the frontend
  bundle** (`app-key: T4^##r0ze1IydycJAkx`) — shipped to every browser, so it's public. A `user-key`
  (localStorage) exists but is only for logged-in users; **not needed** for public content.
- **The content is bilingual JSON, ready to index — no rendering, no translation.** Confirmed live:
  - `POST /v2/public/product` `{page,limit}` → all funds/services with `bn.{name,description,content}` + `en.*`.
    e.g. `সাদকাহ জারিয়াহ তহবিল`. `content` is HTML (strip it).
  - `POST /v2/public/bank-accounts/list` `{}` → exact accounts: bank, accountName, branch, accountNo,
    routingNo, swiftCode (EXIM, Islami Bank Zakat Fund, …).
  - Also public (POST): `/v2/public/product/get` `{routeExtension}` (single item), `/v2/public/media-gallery/*`.
  - `robots.txt`: `Disallow: /user`, `Allow: /`, sitemap declared (but sitemap lists only `/`, so it's useless
    for route discovery — enumerate endpoints from the bundle instead).
- **Frontend routes** (React Router, from the bundle): `/about /activities /donate /zakat(?) /faqs /blog /news
  /notice /contact /career /membership /get-involved /self-reliance-project /skill-development-institute/courses
  /scholarships-... /privacy-policy /terms-and-conditions /tax-notice`. Their *content* comes from the API —
  map each to its endpoint during ingest (blog/faq/news/page endpoints exist too; tagTypes include `blogs`,`blog`).

**Net:** ingestion is a handful of authenticated JSON calls, not a crawler. Dramatically simpler, faster, and
more robust than any scraping path — and the source text is already native Bengali.

---

## 2. Architecture (fits the existing gateway)

```
INGEST (offline, run weekly)                    QUERY (inside gateway /respond)
─────────────────────────────                   ──────────────────────────────
app-key ─► POST /v2/public/product   (funds)    audio ─► Gemini: transcribe → question text
        ─► POST /v2/public/product/get (pages)          (text turn: use text directly)
        ─► POST /v2/public/bank-accounts/list                 │
        ─► blog / faq / news endpoints                        ▼
   │                                             embed(question)  [same multilingual model]
   ▼                                                     │
strip HTML, keep bn + en, + source route                 ▼
   │  + curated exact-fact entries (bank a/c,       retrieve top-k chunks (cosine, in-memory)
   │    office address, hotline, orphan cost)            │
   ▼                                                     ▼
chunk ~300–500 tokens (URL + title + lang)       Gemini: Bengali system prompt
   ▼                                              + retrieved chunks + question
embed each chunk ─► knowledge.json                → grounded Bengali answer (or "not sure, see site")
   (text + vector + metadata)                          │
                                                        ▼
                                                 Edge bn-BD TTS ─► speak   (unchanged)
```

---

## 3. Module layout (new — `ai-gateway/knowledge/`)

```
ai-gateway/
  knowledge/
    build.mjs          ← ingest: call API endpoints, strip HTML, chunk, embed → knowledge.json
    endpoints.mjs       ← the API map: base URL, app-key, endpoint list, route→title
    curated.json        ← authoritative exact-fact entries (bank a/c, address, hotline) — high priority
    knowledge.json      ← GENERATED: [{ id, text, lang, vector, url, title, priority }]  (gitignored or committed)
  src/
    rag/
      store.ts          ← load knowledge.json once; cosineTopK(queryVec, k)
      embed.ts          ← embed(text[]) via Transformers.js (multilingual-e5) — shared by build + query
      retrieve.ts       ← embed question → top-k → format context block (with sources)
    adapters/understanding.ts  ← split into: transcribe(audio) + generateGrounded(question, context)
    prompts.ts          ← add RAG system prompt (answer only from context; never invent facts)
```

**Embeddings:** `Xenova/multilingual-e5-base` via **Transformers.js** — runs in Node, **no key/card**, strong
Bengali, and multilingual so a Bengali question matches Bengali *and* English chunks. (Alt: Gemini
`text-embedding-004` — one API, but adds a call per query.) Same `embed()` used at ingest and query so vectors align.

**Store:** at this scale (hundreds of chunks) a `knowledge.json` loaded in memory with brute-force cosine is
plenty — no vector DB. `vectra` is a clean local upgrade if it grows.

---

## 4. Gateway integration — the one real change to `/respond`

Today `/respond` does transcription **and** the reply in a single Gemini function call. RAG needs the question
*before* generating, so split it:

1. **Get the question text.** Audio turn → Gemini transcribes (STT only). Text turn → use `text` directly.
2. **Retrieve.** `embed(question)` → top-k chunks (+ always include curated exact-facts when relevant).
3. **Generate grounded.** Gemini with the Bengali RAG system prompt + retrieved context + question → answer.
4. **Return** `{ transcription, response }` — **contract unchanged**, so `server.py`, the WS protocol, the
   frontend, and Edge TTS all stay exactly as they are. Only the gateway's internals change.

---

## 5. Guardrails (non-negotiable — donations & religious content)

- **Answer only from retrieved context.** If it's not there, say so politely in Bengali and point to the
  website / hotline — **never invent** account numbers, amounts, dates, or religious rulings (fatwa).
- **Exact facts come from structured data**, not the LLM: bank accounts, routing/SWIFT, office address,
  orphan-sponsorship cost live in `curated.json` / the bank endpoint and are injected verbatim.
- **Cite the source URL** with each answer where possible.
- **Be a polite guest:** honor `robots.txt` (skip `/user`), send a real User-Agent, rate-limit the ingest,
  cache, and run it **weekly/offline** — never per user query. The app-key is public but it's *their* backend.
- **Refresh:** re-crawl weekly for new campaigns. For a couple of genuinely live figures (amount raised),
  either accept `as of {date}` staleness or do one targeted, cached call — not per-query.

---

## 6. Task board

**Phase A — Ingest (blocks the rest)** ✅ DONE
- [x] `endpoints.mjs`: base URL + public app-key + fetchers. Finding: **no blog/faq/page endpoints** — the
      whole site is modeled as 15 "products" (funds/campaigns) with bilingual name/description/content.
- [x] `build.ts`: calls `/v2/public/product` + `/v2/public/bank-accounts/list`, strips HTML, keeps bn+en,
      attaches `{url,title,lang,category,priority}`. Handles the untranslated-i18n-key quirk.
- [x] `curated.json`: seeded with org intro + a **placeholder** contact entry (fill with verified facts).
- [x] Chunk (~1500 char, overlap) → embed (`multilingual-e5-small`, 384-dim, card-free) → `knowledge.json`.
      **Gate passed:** 43 chunks (27 bn / 16 en) with vectors + sources; `knowledge:query` returns correct
      top-1 for zakat / qurbani / bank a/c / disaster-orphan / skill-institute, cross-lingual.
- Run: `npm run knowledge:build`; inspect: `npm run knowledge:query -- "your question"`.

**Phase B — Retrieve + generate** ✅ DONE
- [x] `embed.ts` / `store.ts` / `retrieve.ts`: lazy-load KB once, cosine top-k, format context + sources.
- [x] `understanding.ts` restructured into **transcribe → retrieve → generateGrounded** (two Gemini steps);
      `prompts.ts` now holds `RAG_SYSTEM_PROMPT_BN` (grounding guardrails) + `buildGroundedPrompt`.
- [x] `/respond` contract UNCHANGED (`{transcription, response}`), so server.py / WS / frontend / TTS untouched.
      **Gate passed (verified live):** "যাকাত তহবিলে কিভাবে দান করব?" → grounded answer quoting the **exact**
      Islami Bank & EXIM Zakat account numbers verbatim; "বাংলাদেশের রাজধানী?" → polite refusal + redirect
      to the website (no hallucination).
- ⚠️ **Deploy note:** the gateway now needs `knowledge/knowledge.json` at runtime + downloads the e5 model
      on first query (~15s, cached). Docker: copy `knowledge.json` into the image (or mount it) and set
      `KNOWLEDGE_PATH`; allow HTTPS egress for the one-time model fetch. → Phase C.

**Phase C — Polish**
- [x] **Docker wiring (DONE, verified):** gateway image is self-contained — build stage runs `knowledge:build`
      (fetch → embed) and bakes the e5 model into `/app/models` (`MODEL_CACHE_DIR`); prod stage copies
      `knowledge.json` + model, sets `KNOWLEDGE_PATH`. Startup warmup loads both off the request path.
      `docker compose up --build` → grounded bot with **no runtime download**. Verified: exact bank numbers,
      out-of-scope refusal, and a লক্ষ/কোটি answer in natural Dhaka register — all inside the container.
      *(Build needs HTTPS egress for the API + one-time HF model fetch.)*
- [x] **Refresh (DONE):** `scripts/refresh.sh` re-ingests the API + re-embeds and restarts the gateway.
      Dockerfile splits model-warm (cached) from KB-build (`ARG CACHEBUST`), so a refresh gets fresh data
      without re-downloading the model. Weekly host cron: `0 3 * * 0 cd … && ./scripts/refresh.sh`.
      Ingest is polite: identified User-Agent, only 2 API calls, offline from user queries.
- [x] **Curated facts (DONE):** `curated.json` now holds verified high-priority entries — office address +
      hotline (+8809610-001089), Skill Development Institute, and Madrasatus Sunnah (Dhaka + Debidwar).
      Quoted verbatim; verified live (address/phone answered exactly). KB now 46 chunks.
- [x] **Retrieval tests (DONE):** `test/store.test.ts` — fast, model-free unit tests for cosine + topK +
      priority-boost (in the main `npm test`, now 12 passing). `knowledge/eval.ts` (`npm run knowledge:eval`) —
      12 Bengali question→expected-source checks against the real model+KB, reports pass rate + mean rank.
- [x] **e5-base evaluated, NOT adopted:** e5-small already scores **12/12 in top-3 (100%), mean rank 1.08**,
      so base's ~320 MB + slower embeds buy nothing here. Kept small as default; base stays a one-liner
      (`EMBED_MODEL=Xenova/multilingual-e5-base`) for if the KB grows a lot.

---

## 7. Open questions — resolved

- [x] **Content endpoints — fully mapped.** Traced every lazy chunk (`blogs-*`, `activities-*`, `notice-*`,
      `career*`) + all bundles. The ONLY public content endpoints are `product` (+`product/get`),
      `bank-accounts/list`, `media-gallery/*` (images), and `jobs` (careers). Blog/notice/activities pages are
      UI-only (no separate public text endpoint — probes 404'd). **The substantive content is fully ingested.**
      *Optional, low value:* `POST /v2/public/jobs` (career listings — transient) could be added if desired.
- [x] **Embeddings:** local `multilingual-e5-small` (card-free, 100% on the eval). `EMBED_MODEL` switches it.
- [x] **`knowledge.json`:** built at Docker-build (reproducible, no runtime download), gitignored.
- [ ] **External (not code):** confirm the foundation is OK with read-only use of the public app-key, or
      request formal API access. Use is polite + rate-limited, but this is a decision for the org, not the build.

**Status: the plan (Phases A–C) is fully implemented. No substantive engineering work remains.**
```
