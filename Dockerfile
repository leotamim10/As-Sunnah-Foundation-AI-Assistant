# ── Single-container image for Hugging Face Spaces (Docker) ──
# Combines the Python web server (browser UI + WS /ws) and the Node AI gateway (Gemini/HF/Groq/
# OpenRouter + Edge TTS + RAG) so the whole stack runs in ONE container on ONE port.
# The web server talks to the gateway over localhost. See doc/deployment/ for the Space setup.

# ---------- 1) Build the Node gateway (compile TS, warm the e5 model, bake the knowledge base) ----------
FROM node:20-slim AS gateway-build
WORKDIR /gw
ENV MODEL_CACHE_DIR=/gw/models
COPY ai-gateway/package.json ai-gateway/package-lock.json ./
RUN npm ci
COPY ai-gateway/tsconfig.json ./
COPY ai-gateway/src ./src
COPY ai-gateway/knowledge ./knowledge
RUN npm run build
# Warm the embedding model into /gw/models (cached layer; only re-runs if deps/model change).
RUN node --import tsx -e "import('./src/rag/embed.js').then(m => m.embed(['warm'], 'passage')).catch(e => { console.error(e); process.exit(1); })"
# Build the knowledge base (fetch API → chunk → embed; model already cached). Bump CACHEBUST to refresh.
ARG CACHEBUST=0
RUN echo "kb build ${CACHEBUST}" && node --import tsx knowledge/build.ts

# ---------- 2) Runtime: Node (gateway) + Python (web) in one image ----------
FROM node:20-slim
ENV NODE_ENV=production
# Python for the FastAPI web server.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages \
    "fastapi>=0.135.3" "httpx>=0.27.0" "uvicorn[standard]>=0.43.0" "websockets>=16.0" "python-dotenv>=1.0.0"

# Gateway: production deps + built artifacts + baked KB/model.
WORKDIR /app/gateway
ENV KNOWLEDGE_PATH=/app/gateway/knowledge/knowledge.json MODEL_CACHE_DIR=/app/gateway/models
COPY ai-gateway/package.json ai-gateway/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=gateway-build /gw/dist ./dist
COPY --from=gateway-build /gw/knowledge/knowledge.json ./knowledge/knowledge.json
COPY --from=gateway-build /gw/models ./models

# Web server (UI + WS).
WORKDIR /app/web
COPY src/server.py src/index.html ./

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# HF Spaces routes to this port (matches `app_port` in the Space README). Overridable via $PORT.
ENV PORT=7860
EXPOSE 7860
CMD ["/app/start.sh"]
