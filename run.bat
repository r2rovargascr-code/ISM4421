@echo off
rem Windows: creates a virtual environment on first run, then starts the app.
cd /d "%~dp0"
if not exist .venv (
    py -3 -m venv .venv || python -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt
)
start "" .venv\Scripts\pythonw -m spotdl_lava %*
