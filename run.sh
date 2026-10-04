#!/usr/bin/env sh
# macOS / Linux: creates a virtual environment on first run, then starts the app.
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
    python3 -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt
fi
exec .venv/bin/python -m spotdl_lava "$@"
