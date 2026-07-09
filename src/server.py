"""Parlor — real-time multimodal AI (voice + vision), served via the Node AI gateway."""

import asyncio
import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from dotenv import load_dotenv
load_dotenv()

# The Node AI gateway now does all the AI work: audio(+image) -> {transcription, response}
# (Gemini) and text -> speech (Azure bn-BD). Contract: NAVIGATION.md / ai-gateway/src/contracts.ts.
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8787")

# The gateway's Azure bn-BD voice emits 24 kHz 16-bit mono PCM (AzureBnBDAdapter.SAMPLE_RATE);
# the frontend's default streamSampleRate matches it, so no resampling is needed.
GATEWAY_TTS_SAMPLE_RATE = int(os.environ.get("GATEWAY_TTS_SAMPLE_RATE", "24000"))

SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?।])\s+')

# One shared HTTP client for the whole process, opened/closed with the app lifespan.
gateway: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app):
    global gateway
    async with httpx.AsyncClient(base_url=GATEWAY_URL, timeout=httpx.Timeout(60.0)) as client:
        gateway = client
        print(f"AI gateway: {GATEWAY_URL}")
        yield


app = FastAPI(lifespan=lifespan)


def split_sentences(text: str) -> list[str]:
    """Split text into sentences for streaming TTS."""
    parts = SENTENCE_SPLIT_RE.split(text.strip())
    return [s.strip() for s in parts if s.strip()]


@app.get("/")
async def root():
    return HTMLResponse(content=(Path(__file__).parent / "index.html").read_text())


@app.get("/suggestions")
async def suggestions():
    """Recommended questions (derived from the knowledge base by the gateway)."""
    try:
        r = await gateway.get("/suggestions")
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError:
        return {"questions": []}


@app.post("/lead")
async def lead(request: Request):
    """Free-usage lead capture: stamp the client IP (server-side) and forward to the gateway store."""
    body = await request.json()
    fwd = request.headers.get("x-forwarded-for", "")
    body["ip"] = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or ""
    try:
        r = await gateway.post("/lead", json=body)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        print(f"Gateway /lead failed: {e}")
        return {"ok": False}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    interrupted = asyncio.Event()
    msg_queue = asyncio.Queue()

    async def receiver():
        """Receive messages from WebSocket and route them."""
        try:
            while True:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "interrupt":
                    interrupted.set()
                    print("Client interrupted")
                else:
                    await msg_queue.put(msg)
        except WebSocketDisconnect:
            await msg_queue.put(None)

    recv_task = asyncio.create_task(receiver())

    try:
        while True:
            msg = await msg_queue.get()
            if msg is None:
                break

            interrupted.clear()

            # Per-turn instruction. These English meta-hints mirror the original per-turn text
            # blocks; the Bengali persona itself lives in the gateway's system prompt.
            if msg.get("audio") and msg.get("image"):
                hint = "The user just spoke to you (audio) while showing their camera (image). Respond to what they said, referencing what you see if relevant."
            elif msg.get("audio"):
                hint = "The user just spoke to you. Respond to what they said."
            elif msg.get("image"):
                hint = "The user is showing you their camera. Describe what you see."
            else:
                hint = msg.get("text", "Hello!")

            payload = {"lang": "bn", "text": hint}
            if msg.get("audio"):
                payload["audioB64"] = msg["audio"]
            if msg.get("image"):
                payload["imageB64"] = msg["image"]

            # Understanding: audio(+image) -> {transcription, response} via the gateway.
            t0 = time.time()
            try:
                resp = await gateway.post("/respond", json=payload)
                resp.raise_for_status()
            except httpx.HTTPError as e:
                # 429 from the gateway = Gemini free-tier quota exhausted → flag it so the UI can
                # show the "free usage ended" lead-capture form instead of a generic retry message.
                rate_limited = isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429
                print(f"Gateway /respond failed: {e}{' [rate_limited]' if rate_limited else ''}")
                err_msg = ("বিনামূল্যের ব্যবহারসীমা আপাতত শেষ হয়েছে।"
                           if rate_limited else "দুঃখিত, একটু সমস্যা হয়েছে। আরেকবার একটু বলবেন?")
                reply = {
                    "type": "text",
                    "text": err_msg,
                    "llm_time": round(time.time() - t0, 2),
                }
                if rate_limited:
                    reply["rate_limited"] = True
                await ws.send_text(json.dumps(reply))
                continue
            llm_time = time.time() - t0

            data = resp.json()
            transcription = (data.get("transcription") or "").strip() or None
            text_response = (data.get("response") or "").strip()
            print(f"LLM ({llm_time:.2f}s) heard: {transcription!r} → {text_response}")

            if interrupted.is_set():
                print("Interrupted after LLM, skipping response")
                continue

            reply = {"type": "text", "text": text_response, "llm_time": round(llm_time, 2)}
            if transcription:
                reply["transcription"] = transcription
            await ws.send_text(json.dumps(reply))

            if interrupted.is_set():
                print("Interrupted before TTS, skipping audio")
                continue

            # Streaming TTS: split into sentences and send chunks progressively
            sentences = split_sentences(text_response)
            if not sentences:
                sentences = [text_response]

            tts_start = time.time()

            # Signal start of audio stream
            await ws.send_text(json.dumps({
                "type": "audio_start",
                "sample_rate": GATEWAY_TTS_SAMPLE_RATE,
                "sentence_count": len(sentences),
            }))

            for i, sentence in enumerate(sentences):
                if interrupted.is_set():
                    print(f"Interrupted during TTS (sentence {i+1}/{len(sentences)})")
                    break

                # Synthesize this sentence via the gateway (Azure bn-BD -> base64 int16 PCM).
                try:
                    tts_resp = await gateway.post("/tts", json={"text": sentence})
                    tts_resp.raise_for_status()
                except httpx.HTTPError as e:
                    print(f"Gateway /tts failed (sentence {i+1}/{len(sentences)}): {e}")
                    continue

                if interrupted.is_set():
                    break

                # Already 16-bit little-endian PCM, base64-encoded — forward straight to the client.
                await ws.send_text(json.dumps({
                    "type": "audio_chunk",
                    "audio": tts_resp.json()["audioB64"],
                    "index": i,
                }))

            tts_time = time.time() - tts_start
            print(f"TTS ({tts_time:.2f}s): {len(sentences)} sentences")

            if not interrupted.is_set():
                await ws.send_text(json.dumps({
                    "type": "audio_end",
                    "tts_time": round(tts_time, 2),
                }))

    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        recv_task.cancel()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
