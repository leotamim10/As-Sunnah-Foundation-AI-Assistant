#!/usr/bin/env bash
# Launch the Node gateway (internal :8787) and the Python web server (public :$PORT) in one
# container. If EITHER exits, the script exits too so Hugging Face Spaces restarts the container.
set -uo pipefail

echo "[start] gateway → :8787"
( cd /app/gateway && PORT=8787 exec node dist/server.js ) &
gw=$!

echo "[start] web → :${PORT:-7860}"
( cd /app/web && GATEWAY_URL="http://localhost:8787" PORT="${PORT:-7860}" exec python3 server.py ) &
web=$!

# Wait for whichever process exits first, then tear the other down (→ container restart).
wait -n "$gw" "$web"
code=$?
echo "[start] a process exited (code $code) — shutting down"
kill "$gw" "$web" 2>/dev/null || true
exit "$code"
