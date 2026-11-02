"""CI check: read real Spotify links from the embed player and match a song on YouTube Music."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from spotdl_lava import spotify, youtube  # noqa: E402

LINKS = {
    "album (17 songs)": "https://open.spotify.com/album/0ETFjACtuP2ADo6LFhL6HN",
    "playlist over 100 songs": "https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe?si=x",
    "single song, intl link": "https://open.spotify.com/intl-es/track/52eg6sF7RVtQhcuaWoC0ja?si=cef30bca6be94bf5",
}

failed = False
for label, link in LINKS.items():
    try:
        songs = spotify.search(link)
        print(f"{label}: {len(songs)} songs; first: {songs[0]['artist']} - {songs[0]['title']}"
              f"{' | NOTE: ' + songs.note if getattr(songs, 'note', '') else ''}")
        match = youtube.find_on_ytmusic(songs[0]["title"], songs[0]["artist"], songs[0]["duration"])
        print(f"   matched on YouTube Music: https://music.youtube.com/watch?v={match['video_id']} album={match['album']}")
    except Exception as exc:
        failed = True
        print(f"{label}: FAILED - {type(exc).__name__}: {exc}")
sys.exit(1 if failed else 0)
