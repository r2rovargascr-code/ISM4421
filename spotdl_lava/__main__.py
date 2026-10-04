"""Start the spotDL lava UI.

    python -m spotdl_lava              desktop window (needs pywebview)
    python -m spotdl_lava --browser    open in your web browser instead
    python -m spotdl_lava --demo       fake downloads, to try the UI
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .backend import DemoEngine, Manager, SpotdlEngine

WEB_DIR = Path(__file__).resolve().parent / "web"


class Api:
    """Methods callable from the page as `window.pywebview.api.<name>()`."""

    def __init__(self, manager: Manager):
        self._manager = manager
        self._window = None

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

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

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

    api = Api(manager)
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
    webview.start(http_server=True, debug=args.debug)


if __name__ == "__main__":
    main()
