# ── Node AI gateway: Gemini (understanding) + Edge/Azure (TTS) + RAG over As-Sunnah Foundation ──
FROM node:20-slim AS build
WORKDIR /app
ENV MODEL_CACHE_DIR=/app/models
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY knowledge ./knowledge
RUN npm run build
# 1) Warm the embedding model into /app/models — cached layer, only re-runs if deps/model change.
RUN node --import tsx -e "import('./src/rag/embed.js').then(m => m.embed(['warm'], 'passage')).catch(e => { console.error(e); process.exit(1); })"
# 2) Build the knowledge base (fetch API → chunk → embed, model already cached).
#    Bump CACHEBUST (e.g. scripts/refresh.sh) to force a fresh ingest without re-downloading the model.
ARG CACHEBUST=0
RUN echo "kb build ${CACHEBUST}" && node --import tsx knowledge/build.ts

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV KNOWLEDGE_PATH=/app/knowledge/knowledge.json
ENV MODEL_CACHE_DIR=/app/models
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/knowledge/knowledge.json ./knowledge/knowledge.json
COPY --from=build /app/models ./models
EXPOSE 8787
CMD ["node", "dist/server.js"]
