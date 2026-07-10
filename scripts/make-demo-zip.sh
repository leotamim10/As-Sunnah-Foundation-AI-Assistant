#!/usr/bin/env bash
# Build a small, emailable demo zip: source + your .env keys + one-click run scripts.
# The receiver needs Docker Desktop; `docker compose up` builds everything on first run.
#
# Usage:  scripts/make-demo-zip.sh [output.zip]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

OUT="${1:-as-sunnah-ai-demo.zip}"
OUTPATH="$PWD/$OUT"
NAME="as-sunnah-ai-demo"
TMP="$(mktemp -d)"
STAGE="$TMP/$NAME"
mkdir -p "$STAGE"

# 1) Tracked source only (git respects .gitignore → no node_modules / dist / models / data / .env).
git archive --format=tar HEAD | tar -x -C "$STAGE"

# 2) Bundle your live .env (the "bundle my keys" choice). MUST exist.
[ -f .env ] || { echo "ERROR: .env not found — needed to bundle the demo keys."; exit 1; }
cp .env "$STAGE/.env"

# 3) Receiver-facing launchers at the zip root (run.command = Mac double-click copy of run.sh).
cp scripts/demo/run.sh scripts/demo/run.bat scripts/demo/stop.sh scripts/demo/stop.bat \
   scripts/demo/INSTRUCTIONS.txt "$STAGE/"
cp scripts/demo/run.sh "$STAGE/run.command"
chmod +x "$STAGE/run.sh" "$STAGE/run.command" "$STAGE/stop.sh"

# 4) Zip it (fall back to python if `zip` is missing).
rm -f "$OUTPATH"
if command -v zip >/dev/null 2>&1; then
  ( cd "$TMP" && zip -rq "$OUTPATH" "$NAME" )
else
  ( cd "$TMP" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', '.', sys.argv[2])" "${OUTPATH%.zip}" "$NAME" )
fi
rm -rf "$TMP"

echo "Created: $OUT  ($(du -h "$OUTPATH" | cut -f1))"
echo "⚠  It bundles your .env keys — don't share it publicly."
