"""CI check: read a real YouTube Music playlist and download one song as MP3.

    python packaging/ci_youtube_check.py <path to qjs.exe>
"""

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from spotdl_lava import youtube  # noqa: E402


def ffmpeg_path() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    from spotdl.utils.ffmpeg import download_ffmpeg, get_ffmpeg_path

    return str(get_ffmpeg_path() or download_ffmpeg())


def main() -> None:
    qjs = sys.argv[1] if len(sys.argv) > 1 else None
    runtimes = {"quickjs": {"path": qjs}} if qjs else {}

    from ytmusicapi import YTMusic

    hits = YTMusic().search("pop hits", filter="community_playlists", limit=5)
    playlist_id = next(h["browseId"] for h in hits if h.get("browseId"))
    playlist_id = playlist_id[2:] if playlist_id.startswith("VL") else playlist_id
    link = f"https://music.youtube.com/playlist?list={playlist_id}&si=shareTracking"
    songs = youtube.search(link)
    print(f"playlist {playlist_id}: {len(songs)} songs; first: {songs[0]['artist']} - {songs[0]['title']}")
    assert len(songs) > 1, "playlist came back empty"

    out = Path(tempfile.mkdtemp())
    steps = []
    result = youtube.download(songs[0]["song"], out, ffmpeg_path(), runtimes,
                              lambda p, m: steps.append(round(p)))
    files = list(out.iterdir())
    print("result:", result, "| progress:", steps[:3], "...", steps[-3:], "| files:", [f.name for f in files])
    mp3 = [f for f in files if f.suffix == ".mp3"]
    assert result == "done" and len(mp3) == 1 and len(files) == 1, "expected exactly one MP3"

    from mutagen.mp3 import MP3

    audio = MP3(str(mp3[0]))
    tags = audio.tags or {}
    print(f"mp3: {audio.info.length:.0f}s {audio.info.bitrate // 1000}kbps | "
          f"title={tags.get('TIT2')} artist={tags.get('TPE1')} cover={'APIC:' in tags or any(k.startswith('APIC') for k in tags.keys())}")
    assert audio.info.length > 10, "MP3 is too short"
    assert str(tags.get("TIT2")) == songs[0]["title"], "title tag not written"


if __name__ == "__main__":
    main()
