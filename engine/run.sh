#!/bin/zsh
# Keeps the engine up on port 8000; restarts in 2 s if it exits.
cd "$(dirname "$0")"
# RECOMMENDER=rules|ml and other switches; one file, outside git
[ -f "$HOME/.config/marquee/engine.env" ] && set -a && . "$HOME/.config/marquee/engine.env" && set +a
export REONIC_DATA_DIR="${REONIC_DATA_DIR:-/Users/xanderlim/Projects/thinc-hack/.handoff/data/Project Data}"
while true; do
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
  echo "engine exited, restarting"
  sleep 2
done
