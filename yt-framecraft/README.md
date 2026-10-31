# FrameCraft (yt-framecraft)

Paste a YouTube link, get a frame-perfect MP4 built for AI vision — every frame on the clock, numbered, and inspectable. Runs entirely in your browser; nothing is uploaded.

## What it does

- **Paste a YouTube URL and it auto-converts** — the page fetches the video through public Piped mirrors and encodes it locally with an in-browser ffmpeg engine
- **Frame-perfect output** — constant frame rate (no VFR drift), H.264 `yuv420p`, closed GOPs with a keyframe every second, `+faststart`
- **Burned-in frame numbers + timestamps** — every frame is self-describing on screen
- **Options** — force fps (24/30/60), cap the long edge (768/1280/1920), toggle the burn-in
- **Web inspector** — step frame-by-frame (±1, ±10), jump to a frame number, export the exact frame as PNG, copy a machine-readable frame reference, download the MP4 + JSON sidecar
- **Drop a video file** — same frame-perfect conversion for anything you already have
- **CLI** — `yt-framecraft` (Python 3, stdlib only) does the same via `yt-dlp` + `ffmpeg`, for long videos and unreliable-mirror days

## Usage

Open `index.html` (or the hosted `/yt-framecraft/` page), paste a YouTube link — conversion starts automatically.

```bash
# CLI: same frame-perfect output, on your machine
python3 yt-framecraft https://www.youtube.com/watch?v=VIDEO_ID
python3 yt-framecraft VIDEO_ID --fps 24 --scale 1280 --frames png_out --grid sheets
python3 yt-framecraft --file lecture.mp4 -o lecture_ai.mp4
```

## Honest limits

- Only download videos you have the rights to download
- In-browser fetch relies on public Piped mirrors — when YouTube blocks them all, use the CLI or drop a file
- First conversion downloads the ~30 MB ffmpeg engine once; encoding is single-threaded, so keep clips short (minutes, not hours)
- Videos over ~700 MB won't fit in browser memory — use the CLI for those
- The inspector cannot detect fps from a file — set the fps field to match your encode (the burned-in numbers make misalignment obvious)

## Tech

Python 3 stdlib CLI (`yt-framecraft`) + a single-file vanilla JS web inspector (`index.html`). No build step, no server, no dependencies to install.
