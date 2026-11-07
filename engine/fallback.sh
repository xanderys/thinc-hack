#!/bin/zsh
# Demo insurance: run the engine on this Mac (the MacBook) on port 8000 when the mini is unreachable.
# Then set ENGINE_URL to this Mac's Tailscale address, e.g. http://<macbook>.tail3f074b.ts.net:8000
set -e
cd "$(dirname "$0")"
REPO="$(git rev-parse --show-toplevel)"
for d in "$REPO/.handoff/data/Project Data" "$HOME/Projects/thinc-hack/.handoff/data/Project Data"; do
  [ -d "$d" ] && export REONIC_DATA_DIR="${REONIC_DATA_DIR:-$d}" && break
done
[ -n "$REONIC_DATA_DIR" ] || { echo "No data pack found: set REONIC_DATA_DIR to the 'Project Data' folder"; exit 1; }
[ -f "$HOME/.config/marquee/engine.env" ] && set -a && . "$HOME/.config/marquee/engine.env" && set +a
[ -f "$HOME/.config/marquee/intake.env" ] && set -a && . "$HOME/.config/marquee/intake.env" && set +a
mkdir -p .cache/roof2 && cp -n fallback/roof2/*.json .cache/roof2/ 2>/dev/null || true  # hero roof without the network
uv sync -q
echo "Engine on http://0.0.0.0:${PORT:-8000} (first start trains for about a minute; later starts load engine/.cache)"
exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
