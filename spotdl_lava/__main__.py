"""Start the spotDL lava UI.

    python -m spotdl_lava              desktop window (needs pywebview)
    python -m spotdl_lava --browser    open in your web browser instead
    python -m spotdl_lava --demo       fake downloads, to try the UI
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .backend import DemoEngine, Manager, SpotdlEngine

WEB_DIR = Path(__file__).resolve().parent / "web"


def data_dir() -> Path:
    """Per-user folder for the log file and saved preferences."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    path = base / "spotDL Lava"
    path.mkdir(parents=True, exist_ok=True)
    return path


def setup_logging(debug: bool) -> None:
    log_file = data_dir() / "spotdl-lava.log"
    # A windowed build (no console) has no stdout/stderr; spotDL still prints, so send it to the log.
    if sys.stdout is None or sys.stderr is None:
        stream = open(log_file, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream
    handlers = [logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler()]
    logging.basicConfig(level=logging.DEBUG if debug else logging.INFO, handlers=handlers,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class Prefs:
    """Small JSON store, e.g. where the bubbles were left."""

    def __init__(self, path: Path):
        self._path = path
        try:
            self._data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._data = {}

    def get(self) -> dict:
        return dict(self._data)

    def set(self, key: str, value) -> None:
        self._data[key] = value
        try:
            self._path.write_text(json.dumps(self._data), encoding="utf-8")
        except OSError:
            logging.getLogger(__name__).warning("could not save preferences to %s", self._path)


class Api:
    """Methods callable from the page as `window.pywebview.api.<name>()`."""

    def __init__(self, manager: Manager, prefs: Prefs):
        self._manager = manager
        self._prefs = prefs
        self._window = None

    def get_prefs(self) -> dict:
        return self._prefs.get()

    def set_pref(self, key: str, value) -> None:
        self._prefs.set(key, value)

    def state(self) -> dict:
        return self._manager.state()

    def add(self, link: str) -> dict:
        return self._manager.add(link)

    def refresh_location(self) -> None:
        self._manager.refresh_location()

    def minimize(self) -> None:
        if self._window:
            self._window.minimize()

    def close(self) -> None:
        if self._window:
            self._window.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(prog="spotdl_lava", description="Lava lamp UI for spotDL")
    parser.add_argument("--output", type=Path, default=Path.home() / "Music" / "spotDL",
                        help="folder to save songs in (default: %(default)s)")
    parser.add_argument("--format", default="mp3", help="audio format, e.g. mp3, m4a, flac, opus")
    parser.add_argument("--browser", action="store_true", help="open in the web browser instead of a window")
    parser.add_argument("--port", type=int, default=8765, help="port for --browser mode")
    parser.add_argument("--demo", action="store_true", help="simulate downloads instead of using spotDL")
    parser.add_argument("--debug", action="store_true", help="verbose logging")
    args = parser.parse_args()

    setup_logging(args.debug)

    if args.demo:
        factory = DemoEngine
    else:
        factory = lambda: SpotdlEngine(args.output.expanduser(), args.format)  # noqa: E731
    manager = Manager(factory)

    if not args.browser:
        try:
            import webview
        except ImportError:
            logging.warning("pywebview is not installed; opening in the browser instead")
            args.browser = True

    if args.browser:
        from .server import serve

        serve(manager, WEB_DIR, args.port)
        return

    api = Api(manager, Prefs(data_dir() / "prefs.json"))
    window = webview.create_window(
        "spotDL",
        str(WEB_DIR / "index.html"),
        js_api=api,
        width=940,
        height=960,
        min_size=(760, 780),
        frameless=True,
        easy_drag=False,  # only the title bar drags the window; the bubbles drag themselves
        background_color="#000000",
    )
    api._window = window
    webview.start(http_server=True, debug=args.debug, icon=str(WEB_DIR / "icon.png"))


if __name__ == "__main__":
    main()
