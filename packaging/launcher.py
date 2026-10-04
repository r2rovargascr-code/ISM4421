"""Entry point for the packaged app (PyInstaller cannot start from `-m`)."""

from spotdl_lava.__main__ import main

if __name__ == "__main__":
    main()
