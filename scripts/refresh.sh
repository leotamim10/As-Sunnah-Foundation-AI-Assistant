#!/usr/bin/env bash
# refresh.sh — refresh the As-Sunnah Foundation knowledge base and restart the gateway.
#
# Re-ingests the foundation's JSON API and re-embeds (the embedding model layer stays cached, so this
# is fast), then recreates the gateway container. The web service is left untouched.
#
#   ./scripts/refresh.sh
#
# Schedule weekly via host cron, e.g.:
#   0 3 * * 0  cd /path/to/ai-gateway && ./scripts/refresh.sh >> /var/log/asf-refresh.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[refresh] $(date -u +%FT%TZ) rebuilding gateway with a fresh knowledge base…"
# CACHEBUST busts only the KB-build layer (model layer stays cached → no model re-download).
docker compose build --build-arg CACHEBUST="$(date +%s)" gateway
docker compose up -d gateway
echo "[refresh] $(date -u +%FT%TZ) done — fresh KB baked, gateway restarted."
