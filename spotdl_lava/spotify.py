"""Spotify links without spotDL's Spotify API client.

spotDL's own Spotify lookups can be slow or fail ("Failed to complete request"), so
track lists are read from Spotify's public embed player instead (no login needed).
Each song is then found on YouTube Music when it is downloaded.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

log = logging.getLogger(__name__)

TYPES = ("track", "album", "playlist", "artist")
LINK_RE = re.compile(
    r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?|spotify:)"
    r"(?P<type>track|album|playlist|artist)[/:](?P<id>[A-Za-z0-9]{10,})",
)
EMBED_LIMIT = 100  # the embed player lists at most this many songs
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en",
}


class PartialList(list):
    """A track list that could only be read in part; `note` says why."""

    note = ""


def is_spotify_link(link: str) -> bool:
    link = link.strip()
    return bool(LINK_RE.search(link)) or "spotify.link/" in link


def parse_link(link: str) -> tuple[str, str]:
    import requests

    link = link.strip()
    if "spotify.link/" in link:  # short share link: follow the redirect
        link = requests.get(link, headers=HEADERS, timeout=15, allow_redirects=True).url
    match = LINK_RE.search(link)
    if not match:
        raise ValueError("That doesn't look like a Spotify song, album, playlist or artist link")
    return match["type"], match["id"]


def _embed(kind: str, spotify_id: str) -> dict:
    import requests

    resp = requests.get(f"https://open.spotify.com/embed/{kind}/{spotify_id}", headers=HEADERS, timeout=20)
    resp.raise_for_status()
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', resp.text, re.S)
    if not match:
        raise ValueError("Spotify's player page has changed")
    state = json.loads(match.group(1))["props"]["pageProps"]["state"]
    return {"entity": state["data"]["entity"], "token": (state.get("settings") or {}).get("session", {}).get("accessToken")}


def _image(entity: dict) -> Optional[str]:
    images = (entity.get("visualIdentity") or {}).get("image") or []
    if images:
        return max(images, key=lambda i: i.get("maxWidth") or 0).get("url")
    sources = (entity.get("coverArt") or {}).get("sources") or []
    return sources[0].get("url") if sources else None


def _song(track_id: str, title: str, artist: str, duration_ms: int, album: Optional[str],
          cover: Optional[str]) -> dict:
    url = f"https://open.spotify.com/track/{track_id}"
    return {
        "title": title,
        "artist": artist or "Unknown artist",
        "duration": int((duration_ms or 0) / 1000),
        "cover": cover,
        "url": url,
        "song": {"source": "spotify", "url": url, "title": title, "artist": artist or "Unknown artist",
                 "album": album, "duration": int((duration_ms or 0) / 1000), "cover": cover},
    }


def search(link: str) -> list[dict]:
    """List the songs behind a Spotify link."""
    kind, spotify_id = parse_link(link)
    page = _embed(kind, spotify_id)
    entity = page["entity"]
    cover = _image(entity)

    if kind == "track":
        artist = ", ".join(a.get("name", "") for a in entity.get("artists") or []) or entity.get("subtitle", "")
        return [_song(entity["id"], entity.get("title") or entity.get("name"), artist,
                      entity.get("duration", 0), None, cover)]

    album = entity.get("name") if kind == "album" else None
    songs = PartialList(
        _song(t["uri"].rsplit(":", 1)[-1], t.get("title"), t.get("subtitle", ""), t.get("duration", 0),
              album, cover if kind == "album" else None)
        for t in entity.get("trackList") or []
        if t.get("uri", "").startswith("spotify:track:")
    )
    if kind == "playlist" and len(songs) >= EMBED_LIMIT:
        try:
            songs.extend(_more_playlist_tracks(spotify_id, page["token"], offset=len(songs)))
        except Exception as exc:
            log.warning("could not read the rest of playlist %s: %s", spotify_id, exc)
            songs.note = f"Only the first {len(songs)} songs of this playlist could be read"
    return songs


def _more_playlist_tracks(playlist_id: str, token: Optional[str], offset: int) -> list[dict]:
    """Songs after the first 100, via the Web API with the embed player's anonymous token."""
    import requests

    if not token:
        raise ValueError("no access token on the player page")
    songs = []
    url = (f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks?offset={offset}&limit=100"
           "&fields=next,items(track(id,name,duration_ms,artists(name),album(name,images)))")
    while url:
        resp = requests.get(url, headers={**HEADERS, "Authorization": f"Bearer {token}"}, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items") or []:
            track = item.get("track") or {}
            if not track.get("id"):
                continue
            images = (track.get("album") or {}).get("images") or []
            songs.append(_song(track["id"], track.get("name"),
                               ", ".join(a["name"] for a in track.get("artists") or []),
                               track.get("duration_ms", 0), (track.get("album") or {}).get("name"),
                               images[0]["url"] if images else None))
        url = data.get("next")
    return songs
