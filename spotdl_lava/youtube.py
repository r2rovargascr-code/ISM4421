"""YouTube Music / YouTube links: read playlists, albums and songs, download them as MP3.

Track lists come from YouTube Music itself (ytmusicapi), so songs that are not on
Spotify are kept, unlike spotDL's own handling of these links. Downloads use yt-dlp
and ffmpeg, the same tools spotDL uses.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

YOUTUBE_HOSTS = ("youtube.com", "youtu.be")
MP3_QUALITY = "192"  # kbit/s


def is_youtube_link(link: str) -> bool:
    host = urlparse(link.strip()).netloc.lower()
    return any(host == h or host.endswith("." + h) for h in YOUTUBE_HOSTS)


def parse_link(link: str) -> tuple[Optional[str], Optional[str]]:
    """Return (playlist_id, video_id) from any YouTube / YouTube Music link.

    Share links carry extra parameters such as `&si=...`, which are dropped here.
    """
    url = urlparse(link.strip())
    query = parse_qs(url.query)
    playlist_id = (query.get("list") or [None])[0]
    video_id = (query.get("v") or [None])[0]
    host = url.netloc.lower()
    if host == "youtu.be" or host.endswith(".youtu.be"):
        video_id = url.path.strip("/").split("/")[0] or video_id
    elif url.path.startswith("/browse/VL"):
        playlist_id = url.path[len("/browse/VL"):]
    elif url.path.startswith(("/shorts/", "/live/", "/embed/")):
        video_id = url.path.split("/")[2] or video_id
    return playlist_id or None, video_id or None


def _artists(track: dict) -> str:
    names = [a.get("name") for a in (track.get("artists") or []) if a.get("name")]
    return ", ".join(names)


def _largest_thumbnail(thumbnails: Any) -> Optional[str]:
    if not thumbnails:
        return None
    best = max(thumbnails, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
    return best.get("url")


def _clean_artist(name: Optional[str]) -> str:
    # auto-generated YouTube channels are called "Artist - Topic"
    return re.sub(r"\s+-\s+Topic$", "", name or "").strip()


def _entry(video_id: str, title: str, artist: str, duration: Any, cover: Optional[str],
           album: Optional[str] = None) -> dict:
    url = f"https://music.youtube.com/watch?v={video_id}"
    return {
        "title": title or video_id,
        "artist": artist or "Unknown artist",
        "duration": int(duration or 0),
        "cover": cover,
        "url": url,
        "song": {"source": "youtube", "url": url, "title": title or video_id,
                 "artist": artist or "Unknown artist", "album": album},
    }


def search(link: str) -> list[dict]:
    """List the songs behind a YouTube Music / YouTube link."""
    playlist_id, video_id = parse_link(link)
    if video_id and playlist_id and playlist_id.startswith("RD"):
        playlist_id = None  # a song played from an endless "Mix": just the song
    if playlist_id:
        try:
            return _ytm_list(playlist_id)
        except Exception as exc:  # not a YouTube Music list, private, region locked...
            log.info("YouTube Music could not read list %s (%s); trying YouTube", playlist_id, exc)
            return _ytdlp_list(f"https://www.youtube.com/playlist?list={playlist_id}")
    if video_id:
        try:
            return [_ytm_song(video_id)]
        except Exception as exc:
            log.info("YouTube Music could not read song %s (%s); trying YouTube", video_id, exc)
            return _ytdlp_list(f"https://www.youtube.com/watch?v={video_id}")
    raise ValueError("That YouTube link has no playlist or song in it")


def _ytm():
    from ytmusicapi import YTMusic

    return YTMusic()


def _ytm_list(playlist_id: str) -> list[dict]:
    ytm = _ytm()
    if playlist_id.startswith("OLAK5uy_"):  # an album's playlist id
        browse_id = ytm.get_album_browse_id(playlist_id)
        if not browse_id:
            raise ValueError("album not found")
        album = ytm.get_album(browse_id)
        cover = _largest_thumbnail(album.get("thumbnails"))
        album_artist = _artists(album)
        return [
            _entry(t["videoId"], t.get("title"), _artists(t) or album_artist,
                   t.get("duration_seconds"), cover, album.get("title"))
            for t in album.get("tracks") or [] if t.get("videoId")
        ]
    playlist = ytm.get_playlist(playlist_id, limit=None)
    return [
        _entry(t["videoId"], t.get("title"), _artists(t), t.get("duration_seconds"),
               _largest_thumbnail(t.get("thumbnails")), (t.get("album") or {}).get("name"))
        for t in playlist.get("tracks") or []
        if t.get("videoId") and t.get("isAvailable", True) is not False
    ]


def _ytm_song(video_id: str) -> dict:
    details = _ytm().get_song(video_id)["videoDetails"]
    return _entry(video_id, details.get("title"), _clean_artist(details.get("author")),
                  details.get("lengthSeconds"),
                  _largest_thumbnail((details.get("thumbnail") or {}).get("thumbnails")))


def _ytdlp_list(url: str) -> list[dict]:
    from yt_dlp import YoutubeDL

    with YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
                    "skip_download": True, "logger": _YtdlpLogger()}) as ydl:
        info = ydl.extract_info(url, download=False)
    entries = info.get("entries") if info.get("_type") == "playlist" else [info]
    return [
        _entry(e["id"], e.get("track") or e.get("title"),
               _clean_artist(e.get("artist") or e.get("channel") or e.get("uploader")),
               e.get("duration"), _largest_thumbnail(e.get("thumbnails")) or e.get("thumbnail"),
               e.get("album"))
        for e in entries or [] if e and e.get("id")
    ]


# ---------------------------------------------------------------- matching


def _simplify(title: str) -> str:
    """Drop decorations like " - Remastered 2009" or "(feat. X)" for comparisons."""
    title = re.sub(r"\s+-\s+.*$", "", title or "")
    title = re.sub(r"\s*[\(\[].*?[\)\]]", "", title)
    return title.strip().lower()


def find_on_ytmusic(title: str, artist: str, duration: int) -> dict:
    """Find the YouTube Music song that best matches a song from Spotify.

    Returns {"video_id", "album"}; raises LookupError if nothing plausible is found.
    """
    from rapidfuzz import fuzz

    ytm = _ytm()
    first_artist = (artist or "").split(",")[0].strip()
    query = f"{first_artist} {_simplify(title) or title}"
    best, best_score = None, 0.0
    for kind in ("songs", "videos"):
        for hit in ytm.search(query, filter=kind, limit=10)[:10]:
            if not hit.get("videoId"):
                continue
            hit_artists = _artists(hit)
            score = fuzz.token_set_ratio(_simplify(title), _simplify(hit.get("title", "")))
            score += 0.6 * fuzz.token_set_ratio(first_artist.lower(), hit_artists.lower())
            if duration and hit.get("duration_seconds"):
                score -= min(abs(duration - hit["duration_seconds"]), 60) * 1.5
            if kind == "videos":
                score -= 10  # prefer the official audio upload
            if score > best_score:
                best, best_score = hit, score
        if best_score >= 120:  # good enough among "songs": no need to look at videos
            break
    if best is None or best_score < 90:
        raise LookupError(f"Couldn't find \"{artist} - {title}\" on YouTube Music")
    return {"video_id": best["videoId"], "album": (best.get("album") or {}).get("name")}


# ---------------------------------------------------------------- download


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    return name.strip().rstrip(". ")[:180] or "song"


def download(song: dict, output_dir: Path, ffmpeg: str, js_runtimes: dict,
             on_progress: Callable[[float, str], None]) -> str:
    """Download one song as an MP3 with tags and cover art. Returns "done" or "skipped"."""
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(f"{song['artist']} - {song['title']}")
    target = output_dir / f"{stem}.mp3"
    if target.exists():
        on_progress(100.0, "Skipped")
        return "skipped"

    def progress_hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                on_progress(5 + 80 * d.get("downloaded_bytes", 0) / total, "Downloading")
        elif d.get("status") == "finished":
            on_progress(85.0, "Converting")

    def postprocessor_hook(d: dict) -> None:
        if d.get("status") == "started" and d.get("postprocessor") == "ExtractAudio":
            on_progress(88.0, "Converting")

    options = {
        "format": "bestaudio/best",
        "outtmpl": {"default": str(output_dir / f"{stem}.%(ext)s")},
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _YtdlpLogger(),
        "ffmpeg_location": ffmpeg,
        "js_runtimes": js_runtimes,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": MP3_QUALITY},
            {"key": "FFmpegMetadata", "add_metadata": True},
            {"key": "EmbedThumbnail"},
        ],
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
    }
    on_progress(2.0, "Starting")
    try:
        with YoutubeDL(options) as ydl:
            ydl.download([song["url"]])
    except DownloadError as exc:
        raise RuntimeError(str(exc).replace("ERROR: ", "", 1)) from exc
    if not target.exists():
        raise RuntimeError("Download finished but no MP3 was produced")
    _write_tags(target, song)
    on_progress(100.0, "Done")
    return "done"


def _write_tags(path: Path, song: dict) -> None:
    """Use the YouTube Music names (yt-dlp's guesses from the video can differ)."""
    try:
        from mutagen.easyid3 import EasyID3
        from mutagen.id3 import ID3NoHeaderError

        try:
            tags = EasyID3(str(path))
        except ID3NoHeaderError:
            tags = EasyID3()
        tags["title"] = song["title"]
        tags["artist"] = song["artist"]
        if song.get("album"):
            tags["album"] = song["album"]
        tags.save(str(path))
        if song.get("cover"):
            _embed_cover(path, song["cover"])
    except Exception:
        log.warning("could not write tags to %s", path, exc_info=True)


def _embed_cover(path: Path, url: str) -> None:
    """Replace the video thumbnail with the album cover (songs from Spotify)."""
    import requests
    from mutagen.id3 import APIC, ID3

    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    tags = ID3(str(path))
    tags.delall("APIC")
    tags.add(APIC(encoding=3, mime=resp.headers.get("Content-Type", "image/jpeg"), type=3,
                  desc="Cover", data=resp.content))
    tags.save(str(path))


class _YtdlpLogger:
    def debug(self, msg: str) -> None:
        log.debug(msg)

    def info(self, msg: str) -> None:
        log.debug(msg)

    def warning(self, msg: str) -> None:
        log.info("yt-dlp: %s", msg)

    def error(self, msg: str) -> None:
        log.warning("yt-dlp: %s", msg)
