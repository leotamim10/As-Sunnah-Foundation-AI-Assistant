# ── Python FastAPI WebSocket server (browser UI + WS /ws → gateway) ──
FROM python:3.12-slim
WORKDIR /app

# Deps mirror pyproject.toml [project.dependencies]. Installed explicitly (no build backend needed).
RUN pip install --no-cache-dir \
    "fastapi>=0.135.3" \
    "httpx>=0.27.0" \
    "uvicorn[standard]>=0.43.0" \
    "websockets>=16.0" \
    "python-dotenv>=1.0.0"

COPY server.py index.html ./
EXPOSE 8000
CMD ["python", "server.py"]
