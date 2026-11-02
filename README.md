# ISM4421

## spotDL Lava

A green lava-lamp desktop interface for [spotDL](https://github.com/spotDL/spotify-downloader)
that downloads Spotify and YouTube Music songs, albums and playlists as MP3.

- **Top row:** paste a Spotify link (track, album, playlist, artist) or a YouTube Music / YouTube link
  (song, album, playlist; share links with `&si=` work) and press **Add**.
- **Tank:** a green lava lamp. Two bubbles float on top of it; drag them anywhere and they wobble like lava,
  and glide on a little when you let go.
  - **Flag bubble:** the flag emoji of your current public IP address's country, so you can confirm the VPN is working.
    It re-checks every minute; click it to re-check immediately. Hover over it to see the country and IP.
  - **Progress bubble:** a ring showing overall progress, with the time remaining for the whole queue in the middle
    (hidden when nothing is downloading).
- **Queue:** every song to be downloaded. The row of the song currently downloading fills up as its progress bar.

Songs are saved to `Music/spotDL` in your home folder, always as MP3 with title, artist, album and cover art.
Spotify song lists are read from Spotify's public embed player (no Spotify login or API limits; playlists over
100 songs fetch the rest through Spotify's web API, falling back to spotDL) and each song is found on
YouTube Music. YouTube Music links are read from YouTube Music directly. Downloads use yt-dlp and ffmpeg.

### Install on Windows (no Python needed)

Download the installer:
**[spotDL-Lava-Setup.exe](https://github.com/r2rovargascr-code/ISM4421/raw/claude/nifty-hypatia-bohpvl/installer/spotDL-Lava-Setup.exe)**
(rebuilt automatically after every change), run it, and start **spotDL Lava** from the Start menu. It installs for the current user, so no administrator rights are needed, and it can be
removed from *Settings → Apps*. The installer can be copied to any Windows 10/11 PC.

The log file and saved bubble positions are kept in `%LOCALAPPDATA%\spotDL Lava`.

To build the installer yourself on Windows: `pip install -r requirements.txt pyinstaller`,
`python packaging/build.py`, then compile `packaging/installer.iss` with Inno Setup 6.

### Run from source

#### Requirements

- Python 3.9 or newer
- ffmpeg (if it is missing, the app downloads spotDL's own copy on first use)
- Linux only: pywebview needs GTK or Qt, e.g. `pip install pywebview[qt]`

#### Run

| System        | Command                                  |
|---------------|------------------------------------------|
| Windows       | double-click `run.bat`                   |
| macOS / Linux | `./run.sh`                               |
| Any           | `pip install -r requirements.txt` then `python -m spotdl_lava` |

The first run creates a `.venv` folder and installs spotDL and pywebview into it.

#### Options

```
python -m spotdl_lava --output "D:\Music"   # save somewhere else
python -m spotdl_lava --browser             # open in the web browser instead of a window
python -m spotdl_lava --demo                # fake downloads, to try the interface
```

### Layout

```
spotdl_lava/
  __main__.py   window setup and command-line options
  backend.py    download queue, ETA, IP location lookup
  spotify.py    Spotify links: read song lists from the embed player
  youtube.py    YouTube Music / YouTube links: read lists, match songs, download as MP3
  server.py     local HTTP API for --browser mode
  web/          the interface (HTML, CSS, JavaScript)
packaging/      icon, PyInstaller build script, Inno Setup installer script
mockup/         design mockups and renders
```

### Credits

Flag emoji are drawn with the "Twemoji Country Flags" font from
[country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill) (MIT),
whose artwork comes from [Twemoji](https://github.com/twitter/twemoji) (CC-BY 4.0).
See `spotdl_lava/web/fonts/TwemojiCountryFlags-LICENSE.md`.

The Windows installer includes [QuickJS-ng](https://github.com/quickjs-ng/quickjs) (MIT), the JavaScript
runtime yt-dlp needs to download from YouTube.
