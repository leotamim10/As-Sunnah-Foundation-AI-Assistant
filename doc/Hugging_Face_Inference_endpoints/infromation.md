Architecting HuggingFace integration into existing scaffold
Architecting HuggingFace integration into existing scaffold
Before I write the adapters, let me confirm the current Hugging Face Inference endpoints — they migrated to the "Inference Providers" router recently, and I don't want to hand you a stale URL.

Architected HuggingFace adapters for speech and language integration
Architected HuggingFace adapters for speech and language integration
Endpoints confirmed: HF's OpenAI-compatible router (https://router.huggingface.co/v1) for chat, and the @huggingface/inference client for Whisper ASR — one token, no card, and you can even route the LLM through Cerebras/Groq with a :provider suffix. Adding the HF path now as swappable adapters behind your existing interfaces.

Orchestrated adapter configuration and provider integration updates
Orchestrated adapter configuration and provider integration updates
Now the three HF adapters:

Architected provider-switching infrastructure for model adapters
Architected provider-switching infrastructure for model adapters
Now wiring the switch into server.ts — pick the understanding path by env, and default TTS to your card-free Edge adapter:

Add provider switch for understanding (gemini|hf) and default TTS to Edge
Add provider switch for understanding (gemini|hf) and default TTS to Edge
Now the .env.example — add the HF path config:

Viewed a file, created a file, ran a command
Viewed a file, created a file, ran a command
Added. The HF path now slots in behind your existing interfaces as a swappable alternative — no restructuring.

What landed:

adapters/stt.ts — SttAdapter + HfWhisperAdapter (Whisper large-v3, Bengali-capable, the fix for parakeet's English-only gap).
adapters/llm.ts — LlmAdapter + HfLlmAdapter (hosted Bengali LLM via HF's OpenAI-compatible router; has a context slot that's your RAG injection point for the As-Sunnah chunks).
adapters/hf-understanding.ts — HfUnderstandingAdapter composes STT→LLM but implements the same UnderstandingAdapter contract as Gemini, so it's a true drop-in. This is the HF demo's chained pipeline, with Bengali-capable models swapped in at the two stages that needed it.
server.ts — makeUnderstanding() picks gemini or hf from one env var; TTS now defaults to your card-free Edge adapter.
.env.example — the switch plus HF vars; Azure demoted to optional/commented.
To use it:

bash
cd ai-gateway && npm i @huggingface/inference

# get a free token (no card) at https://huggingface.co/settings/tokens

# in .env:

UNDERSTANDING*PROVIDER=hf
HF_TOKEN=hf*...
Flip back to gemini anytime; nothing else changes.

Two honest caveats baked into the comments:

The HF path is text-only — Whisper→text→LLM drops the camera image. If a question needs vision, use the Gemini path (its one multimodal call keeps the image). For your As-Sunnah Q&A bot that's fine, since it's voice/text about the site, not visual.
SDK signatures drift. If automaticSpeechRecognition or chatCompletion errors on param names, check the installed @huggingface/inference major — the calls target the current InferenceClient API.
This also sets up the RAG work cleanly: when the knowledge/ module lands, you retrieve chunks for the transcription and pass them into HfLlmAdapter.chat({ context }) (or the Gemini equivalent) — the seam's already there.

Want me to build the knowledge/ module next (Playwright crawler + chunker + local embed/retrieve) and wire its output into that context slot?
