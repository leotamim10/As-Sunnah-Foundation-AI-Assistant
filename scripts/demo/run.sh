#!/usr/bin/env bash
# As-Sunnah Foundation AI Assistant — local demo launcher (needs Docker Desktop running).
cd "$(dirname "$0")"
echo "== As-Sunnah AI Assistant =="
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Please install & start Docker Desktop, then run this again:"
  echo "  https://www.docker.com/products/docker-desktop"
  read -r -p "Press Enter to close..." _ 2>/dev/null || true
  exit 1
fi
echo "Building & starting — the FIRST run downloads the AI model (~5-10 min, needs internet)..."
docker compose up --build -d || { echo "Build/start failed. Is Docker Desktop running?"; exit 1; }
echo "Waiting for the app to be ready..."
ready=0
for _ in $(seq 1 200); do
  if curl -fsS http://localhost:8000/ >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done
if [ "$ready" = "1" ]; then
  echo "Ready! Opening http://localhost:8000"
  (open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null || true)
else
  echo "Still starting — open http://localhost:8000 in your browser shortly."
fi
echo "To stop later: run stop.sh  (or:  docker compose down)"
