"""Download queue, ETA and IP location for the spotDL lava UI."""

from __future__ import annotations

import itertools
import json
import logging
import random
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

FINISHED = ("done", "skipped", "error")


@dataclass
class Item:
    id: int
    title: str
    artist: str
    duration: int
    cover: Optional[str]
    url: str
    status: str = "queued"  # queued | downloading | done | skipped | error
    progress: float = 0.0  # 0-100
    error: Optional[str] = None
    song: Any = field(default=None, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "artist": self.artist,
            "duration": self.duration,
            "cover": self.cover,
            "status": self.status,
            "progress": round(self.progress, 1),
            "error": self.error,
        }


# ---------------------------------------------------------------- engines


class SpotdlEngine:
    """Thin wrapper around the spotDL library.

    Must be created and used from a single thread: spotDL binds an asyncio
    event loop to the thread that creates it.
    """

    def __init__(self, output_dir: Path, audio_format: str = "mp3"):
        from spotdl import Spotdl
        from spotdl.download.downloader import DownloaderError
        from spotdl.utils.config import SPOTIFY_OPTIONS

        output_dir.mkdir(parents=True, exist_ok=True)
        settings = {
            "output": str(output_dir / "{artists} - {title}.{output-ext}"),
            "format": audio_format,
            "simple_tui": True,
        }
        kwargs = dict(
            client_id=SPOTIFY_OPTIONS["client_id"],
            client_secret=SPOTIFY_OPTIONS["client_secret"],
            downloader_settings=settings,
        )
        try:
            self._spotdl = Spotdl(**kwargs)
        except DownloaderError as exc:
            if "ffmpeg" not in str(exc).lower():
                raise
            # Same as `spotdl --download-ffmpeg`: fetch spotDL's own ffmpeg build.
            from spotdl.utils.ffmpeg import download_ffmpeg
            from spotdl.utils.spotify import SpotifyClient

            log.info("ffmpeg not found, downloading it")
            download_ffmpeg()
            SpotifyClient._instance = None  # allow the client to be initialised again
            self._spotdl = Spotdl(**kwargs)

        self._on_progress: Optional[Callable[[float, str], None]] = None
        self._last_message = ""
        self._spotdl.downloader.progress_handler.update_callback = self._on_update

    def _on_update(self, tracker: Any, message: str) -> None:
        if message:
            self._last_message = message
        if self._on_progress:
            self._on_progress(float(tracker.progress), message)

    def search(self, link: str) -> list[dict]:
        songs = self._spotdl.search([link])
        return [
            {
                "title": song.name,
                "artist": song.artist,
                "duration": int(song.duration or 0),
                "cover": song.cover_url,
                "url": song.url,
                "song": song,
            }
            for song in songs
        ]

    def download(self, song: Any, on_progress: Callable[[float, str], None]) -> str:
        self._on_progress = on_progress
        self._last_message = ""
        try:
            _, path = self._spotdl.download(song)
        finally:
            self._on_progress = None
        if self._last_message == "Skipped":
            return "skipped"
        if path is None:
            raise RuntimeError("No match found or download failed")
        return "done"


class DemoEngine:
    """Fake engine for trying the UI without downloading anything."""

    SONGS = [
        ("Midnight City", "M83", 243),
        ("Electric Feel", "MGMT", 229),
        ("Rattlesnake", "King Gizzard & The Lizard Wizard", 467),
        ("Lost in Yesterday (Live at Glastonbury 2019 Remaster)", "Tame Impala", 250),
        ("Let It Happen", "Tame Impala", 467),
        ("Time to Pretend", "MGMT", 261),
        ("Wait", "M83", 343),
        ("Kids", "MGMT", 302),
    ]

    def search(self, link: str) -> list[dict]:
        time.sleep(1.2)
        return [
            {"title": t, "artist": a, "duration": d, "cover": None,
             "url": f"{link}#{i}-{time.time()}", "song": None}
            for i, (t, a, d) in enumerate(self.SONGS)
        ]

    def download(self, song: Any, on_progress: Callable[[float, str], None]) -> str:
        total = random.uniform(5, 10)
        start = time.monotonic()
        while (elapsed := time.monotonic() - start) < total:
            on_progress(min(99.0, elapsed / total * 100), "Downloading")
            time.sleep(0.2)
        on_progress(100.0, "Done")
        return "done"


# ---------------------------------------------------------------- location

LOCATION_SERVICES = [
    ("https://ipwho.is/", lambda d: (d.get("success") is not False) and
        (d.get("ip"), d.get("country_code"), d.get("country"))),
    ("https://ipapi.co/json/", lambda d: (d.get("ip"), d.get("country_code"), d.get("country_name"))),
    ("https://ipinfo.io/json", lambda d: (d.get("ip"), d.get("country"), d.get("country"))),
]


def lookup_location(timeout: float = 6.0) -> dict:
    """Return the public IP's country, trying several free services in turn."""
    for url, parse in LOCATION_SERVICES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "spotdl-lava/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                parsed = parse(json.load(resp))
            if parsed and parsed[1]:
                ip, code, country = parsed
                return {"status": "ok", "ip": ip, "code": str(code).upper(), "country": country or code}
        except Exception as exc:  # network errors, bad JSON, rate limits
            log.debug("location lookup via %s failed: %s", url, exc)
    return {"status": "error"}


# ---------------------------------------------------------------- manager


class Manager:
    """Owns the queue. One worker thread looks up links and downloads songs in order."""

    LOCATION_INTERVAL = 60  # seconds between IP checks

    def __init__(self, engine_factory: Callable[[], Any]):
        self._engine_factory = engine_factory
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._relocate = threading.Event()
        self._ids = itertools.count(1)
        self._items: list[Item] = []
        self._links: list[str] = []
        self._looking_up = False
        self._message = ""
        self._current: Optional[Item] = None
        self._current_started = 0.0
        self._song_times: list[float] = []
        self._location: dict = {"status": "checking"}
        threading.Thread(target=self._worker, name="downloader", daemon=True).start()
        threading.Thread(target=self._location_loop, name="location", daemon=True).start()

    # -- called from the UI

    def add(self, link: str) -> dict:
        link = (link or "").strip()
        if not link:
            return {"ok": False, "message": "Paste a Spotify link first"}
        with self._lock:
            self._links.append(link)
        self._wake.set()
        return {"ok": True}

    def refresh_location(self) -> None:
        with self._lock:
            self._location = {**self._location, "status": "checking"}
        self._relocate.set()

    def state(self) -> dict:
        with self._lock:
            items = [i.public() for i in self._items]
            finished = sum(i.status in FINISHED for i in self._items)
            cur = self._current
            total = len(self._items)
            overall = (finished + (cur.progress / 100 if cur else 0)) / total if total else 0.0
            return {
                "items": items,
                "finished": finished,
                "overall": overall,
                "eta": self._eta_locked(),
                "busy": self._looking_up or bool(self._links),
                "message": self._message,
                "location": dict(self._location),
            }

    # -- internals

    def _eta_locked(self) -> Optional[int]:
        queued = sum(i.status == "queued" for i in self._items)
        cur = self._current
        if cur is None and queued == 0:
            return None
        avg = sum(self._song_times) / len(self._song_times) if self._song_times else None
        remaining = 0.0
        per_song = avg or 30.0
        if cur is not None:
            elapsed = time.monotonic() - self._current_started
            p = cur.progress / 100
            estimate = elapsed / p if p >= 0.15 else per_song
            remaining = max(estimate - elapsed, 0.0)
            if avg is None and p >= 0.15:
                per_song = estimate
        return round(remaining + per_song * queued)

    def _next_job(self):
        with self._lock:
            if self._links:
                self._looking_up = True
                return "link", self._links.pop(0)
            for item in self._items:
                if item.status == "queued":
                    item.status = "downloading"
                    item.progress = 0.0
                    self._current = item
                    self._current_started = time.monotonic()
                    return "song", item
        return None

    def _worker(self) -> None:
        engine = None
        while True:
            job = self._next_job()
            if job is None:
                self._wake.wait()
                self._wake.clear()
                continue
            kind, payload = job
            if engine is None:
                try:
                    self._set_message("Starting spotDL…")
                    engine = self._engine_factory()
                    self._set_message("")
                except Exception as exc:
                    log.exception("could not start spotDL")
                    self._fail_job(kind, payload, f"Could not start spotDL: {exc}")
                    continue
            if kind == "link":
                self._lookup(engine, payload)
            else:
                self._download(engine, payload)

    def _fail_job(self, kind: str, payload: Any, message: str) -> None:
        with self._lock:
            self._message = message
            self._looking_up = False
            if kind == "song":
                payload.status, payload.error = "error", message
                self._current = None

    def _lookup(self, engine: Any, link: str) -> None:
        self._set_message("Looking up link…")
        try:
            found = engine.search(link)
        except Exception as exc:
            log.exception("search failed for %s", link)
            with self._lock:
                self._looking_up = False
                self._message = f"Couldn't read that link: {exc}"
            return
        with self._lock:
            known = {i.url for i in self._items if i.status != "error"}
            new = [f for f in found if f["url"] not in known]
            for f in new:
                self._items.append(Item(id=next(self._ids), **f))
            self._looking_up = False
            if not found:
                self._message = "No songs found for that link"
            elif not new:
                self._message = "Those songs are already in the queue"
            else:
                self._message = f"Added {len(new)} song{'s' if len(new) != 1 else ''}"

    def _download(self, engine: Any, item: Item) -> None:
        def on_progress(progress: float, _message: str) -> None:
            with self._lock:
                item.progress = max(item.progress, min(progress, 100.0))

        try:
            result = engine.download(item.song, on_progress)
            error = None
        except Exception as exc:
            log.exception("download failed: %s - %s", item.artist, item.title)
            result, error = "error", str(exc)
        with self._lock:
            item.status, item.error = result, error
            item.progress = 100.0
            if result == "done":
                self._song_times.append(time.monotonic() - self._current_started)
            self._current = None

    def _set_message(self, message: str) -> None:
        with self._lock:
            self._message = message

    def _location_loop(self) -> None:
        while True:
            location = lookup_location()
            with self._lock:
                self._location = location
            self._relocate.wait(self.LOCATION_INTERVAL)
            self._relocate.clear()
