"""Build the standalone app with PyInstaller.

    pip install -r requirements.txt pyinstaller
    python packaging/build.py

Output: dist/spotDL Lava/  (run "spotDL Lava.exe" on Windows)
"""

import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
SEP = ";" if sys.platform == "win32" else ":"

args = [
    str(ROOT / "packaging" / "launcher.py"),
    "--name", "spotDL Lava",
    "--noconfirm",
    "--clean",
    "--windowed",  # no console window
    "--icon", str(ROOT / "packaging" / ("icon.ico" if sys.platform == "win32" else "icon.png")),
    "--paths", str(ROOT),
    "--add-data", f"{ROOT / 'spotdl_lava' / 'web'}{SEP}spotdl_lava/web",
    # spotDL and its helpers load modules and data files dynamically
    "--collect-all", "spotdl",
    "--collect-all", "ytmusicapi",
    "--collect-all", "yt_dlp",
    "--collect-all", "yt_dlp_ejs",
    "--collect-all", "syncedlyrics",
    "--collect-data", "pykakasi",
    "--collect-all", "webview",
    "--distpath", str(ROOT / "dist"),
    "--workpath", str(ROOT / "build"),
    "--specpath", str(ROOT / "build"),
]

PyInstaller.__main__.run(args)
