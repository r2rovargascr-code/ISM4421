# ISM4421

## spotDL Lava

A green lava-lamp desktop interface for [spotDL](https://github.com/spotDL/spotify-downloader).

- **Top row:** paste a Spotify track, album, playlist or artist link and press **Add**.
- **Tank:** a green lava lamp. Two bubbles float on top of it; drag them anywhere and they wobble like lava.
  - **Flag bubble:** the country of your current public IP address, so you can confirm the VPN is working.
    It re-checks every minute; click it to re-check immediately. Hover over it to see the country and IP.
  - **Progress bubble:** a ring showing overall progress, with the time remaining for the whole queue in the middle.
- **Queue:** every song to be downloaded. The row of the song currently downloading fills up as its progress bar.

Songs are saved to `Music/spotDL` in your home folder as MP3.

### Requirements

- Python 3.9 or newer
- ffmpeg (if it is missing, the app downloads spotDL's own copy on first use)
- Linux only: pywebview needs GTK or Qt, e.g. `pip install pywebview[qt]`

### Run

| System        | Command                                  |
|---------------|------------------------------------------|
| Windows       | double-click `run.bat`                   |
| macOS / Linux | `./run.sh`                               |
| Any           | `pip install -r requirements.txt` then `python -m spotdl_lava` |

The first run creates a `.venv` folder and installs spotDL and pywebview into it.

### Options

```
python -m spotdl_lava --output "D:\Music"   # save somewhere else
python -m spotdl_lava --format flac         # mp3 (default), m4a, flac, opus, ogg, wav
python -m spotdl_lava --browser             # open in the web browser instead of a window
python -m spotdl_lava --demo                # fake downloads, to try the interface
```

### Layout

```
spotdl_lava/
  __main__.py   window setup and command-line options
  backend.py    download queue, ETA, IP location lookup
  server.py     local HTTP API for --browser mode
  web/          the interface (HTML, CSS, JavaScript)
mockup/         design mockups and renders
```
