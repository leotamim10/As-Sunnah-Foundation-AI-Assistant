# NAVIGATION.md — parlor codebase map & port decisions

Phase 0 deliverable. This is the "I read the unfamiliar code" evidence + the decision record the rest of the
work builds on. Facts below were confirmed by reading `src/`, not assumed.

## File map (existing app)

| File | What it does | Touch? |
|---|---|---|
| `src/server.py` (~236 ln) | FastAPI, WebSocket `/ws` loop, on-device inference orchestration, streaming TTS | **adapt (small diff)** |
| `src/index.html` (~877 ln) | Single-file UI + inline JS: VAD, camera, WS client, audio playback, transcript | **adapt (Bengali + i18n)** |
| `src/tts.py` (~70 ln) | Kokoro TTS wrapper | **bypass** (replaced by gateway `/tts`) |
| `src/benchmarks/*` | perf scripts | ignore |

Key symbols in `server.py`: `SYSTEM_PROMPT`, `respond_to_user(transcription, response)` tool,
`conversation.send_message(...)`, `tts_backend.generate(sentence)`, `split_sentences()`, `load_models()`, `resolve_model_path()`.

## Confirmed facts (from reading the source)

- **Browser → server audio** = WAV, **16 kHz, mono, 16-bit PCM**, base64, in `payload.audio`
  (`float32ToWavBase64()` writes a RIFF header with sampleRate 16000). → Gemini mime = `audio/wav`.
- **Browser → server image** = base64 **JPEG** in `payload.image` (`captureFrame()`).
- **VAD** = `@ricky0123/vad-web@0.0.29` (CDN). Speech end → `handleSpeechEnd(audio)` sends the payload.
- **Playback** reads sample rate from `audio_start.sample_rate`; frontend default `streamSampleRate = 24000`.
  → TTS output at **24 kHz 16-bit mono PCM** plugs in with zero frontend math.
- **One model does it all today:** Gemma 4 E2B ingests audio+image and returns `{transcription, response}`
  via the `respond_to_user` tool call. Kokoro then speaks it, streamed per sentence.

## WebSocket protocol (KEEP UNCHANGED — this is the browser contract)

```
client → server : { "type":"interrupt" }
                  { "audio": b64(wav 16k mono), "image"?: b64(jpeg), "text"?: str }
server → client : { "type":"text", "text", "llm_time", "transcription"? }
                  { "type":"audio_start", "sample_rate", "sentence_count" }
                  { "type":"audio_chunk", "audio": b64(int16 PCM), "index" }
                  { "type":"audio_end", "tts_time" }
```

## Internal contract (new — Python ↔ Node gateway)

```
POST /respond  { audioB64?, imageB64?, text?, lang="bn" }  → { transcription, response }
POST /tts      { text, voice? }                            → { audioB64 (int16 LE mono PCM), sampleRate }
GET  /health   → { ok: true }
```
Source of truth: `ai-gateway/src/contracts.ts` (zod). Server calls `/tts` once per sentence (keeps streaming + barge-in).

## Decision record

1. **Replace the single on-device multimodal model with Gemini Flash** (natively accepts audio+image in one call,
   free tier). Preserves the original one-shot shape and the `{transcription, response}` tool contract via
   Gemini function-calling. *Fallback path if audio-in is flaky:* Groq Whisper (STT) → Gemini (text+image).
2. **TTS = Microsoft Edge neural voices, with Azure as an optional paid fallback.** Same `bn-BD` voices
   either way (`bn-BD-NabanitaNeural` / `bn-BD-PradeepNeural`), Bangladeshi/Dhaka register — **not `bn-IN`**
   (Kolkata), which reads foreign to the target users.
   - *Originally* Azure Neural (`Raw24Khz16BitMonoPcm`). **Revised** because Azure needs a card; Edge's
     read-aloud service exposes the *identical* Microsoft neural voices with **no key / subscription / card**,
     so the whole stack is card-free (Gemini free tier + Edge). Edge returns 24 kHz MP3 → decoded to
     24 kHz s16le mono PCM with a bundled `ffmpeg-static` binary, preserving the `/tts` PCM contract exactly.
   - Both sit behind `TtsAdapter`. `EdgeTtsAdapter` is primary; `FallbackTtsAdapter` appends `AzureBnBDAdapter`
     only when `AZURE_SPEECH_*` are set — Edge = free demo path, Azure = production path, no rewrite to switch.
   - Edge uses an **unofficial** endpoint (fine for "working, not flawless") and can **hang** on WS failure,
     so `EdgeTtsAdapter` bounds each call with a 15s timeout → clean failure that falls through the chain.
3. **Keep `server.py` as the WS server** (reading/adapting it is the stated point of the test); move all AI glue into
   Node. Python diff stays surgical.
4. **The Bengali persona/"reply in natural Bangladeshi Bangla" system prompt lives in the gateway**
   (`ai-gateway/src/prompts.ts` → `SYSTEM_PROMPT_BN`). `server.py` passes only per-turn context via `text`
   (the existing "user just spoke / showing camera" hints) — those are meta-instructions and can stay English.

## `server.py` seams to change (only these)

- `conversation.send_message({...audio,image,text...})` → `httpx.post(f"{GATEWAY_URL}/respond", json=...)`.
- `tts_backend.generate(sentence)` inside the sentence loop → `httpx.post(f"{GATEWAY_URL}/tts", json=...)`;
  set `audio_start.sample_rate` from the response's `sampleRate`.
- `load_models()` / `resolve_model_path()` / HF download / `litert_lm` import → remove.
- Leave WS framing, `interrupt` handling, and `audio_start/chunk/end` exactly as-is.

## Open questions / TODO
- [x] Frontend i18n → inline `bn` table + `t()` in `index.html` (Python diff = 0).
- [x] Voice gender default → `bn-BD-NabanitaNeural` (F); override via `TTS_VOICE`. Verify via `npm run tts:sample`.
- [ ] Confirm `GEMINI_MODEL` (`gemini-2.5-flash`) accepts `audio/wav` inline on the free tier at run time
      (fallback: Groq Whisper STT → Gemini text). Needs a live key — the sandbox has no `GEMINI_API_KEY`.
- [ ] Confirm bn-BD pronunciation of digits/currency (৳, লাখ, কোটি) by ear — the native-review gate.
- [ ] **Deploy note:** Edge (and Azure) TTS need outbound **WebSocket** egress to Microsoft's endpoint;
      HTTPS-only networks block it. The gateway's 15s timeout makes that a clean failure, not a hang.
