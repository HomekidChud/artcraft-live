# FrameCraft (yt-framecraft)

Paste a YouTube link, get a frame-perfect MP4 built for AI vision — every frame on the clock, numbered, and inspectable. Runs entirely in your browser; nothing is uploaded.

## What it does

- **Paste a YouTube URL and it auto-converts** — the page races 20+ public Piped and Invidious mirrors in parallel, uses whichever answers first, and encodes it locally with an in-browser ffmpeg engine
- **Frame-perfect output** — constant frame rate (no VFR drift), H.264 `yuv420p`, closed GOPs with a keyframe every second, `+faststart`
- **Burned-in frame numbers + timestamps** — every frame is self-describing on screen
- **Options** — force fps (24/30/60), cap the long edge (768/1280/1920), toggle the burn-in
- **Web inspector** — step frame-by-frame (±1, ±10), jump to a frame number, export the exact frame as PNG, copy a machine-readable frame reference, download the MP4 + JSON sidecar
- **Custom mirror** — under "advanced", paste any Piped API or Invidious base URL (saved in your browser, tried first)
- **Drop a video file** — same frame-perfect conversion for anything you already have
- **CLI does the download too — fast** — `yt-framecraft` (Python 3, stdlib only) races the mirror network first (yt-dlp is only the fallback, so a bot-walled YouTube costs zero seconds), caps the source at 720p (3x smaller download, `--hq` for full res), pulls the video over parallel HTTP range connections (~15 MB/s), downloads the audio concurrently and races it across mirrors, skips the merge step, copies the audio stream instead of re-encoding, and encodes with x264 superfast. `--turbo` goes further: when the source stream is already H.264 + constant frame rate, it skips the re-encode entirely and just remuxes — the whole conversion becomes download-bound (~16s for an 8-minute 60fps video; no frame-number burn-in in that mode, and it auto-falls back to an encode on variable-frame-rate sources). Long videos, PNG frame dumps and contact sheets included

## Usage

Open `index.html` (or the hosted `/yt-framecraft/` page), paste a YouTube link — conversion starts automatically.

```bash
# CLI: paste-and-go, same frame-perfect output
python3 yt-framecraft https://www.youtube.com/watch?v=VIDEO_ID
python3 yt-framecraft VIDEO_ID --fps 24 --scale 1280 --frames png_out --grid sheets
python3 yt-framecraft VIDEO_ID --hq          # full-res source, archival quality
python3 yt-framecraft VIDEO_ID --no-audio   # pure AI-vision mode
python3 yt-framecraft VIDEO_ID --turbo      # remux only: ~16s for an 8-min video

# force a specific mirror (any Piped API or Invidious base URL)
python3 yt-framecraft VIDEO_ID --mirror https://yt.chocolatemoo53.com

# convert a local file
python3 yt-framecraft --file lecture.mp4 -o lecture_ai.mp4
```

The sidecar JSON next to each MP4 records fps, frame count, duration and how the video was fetched (`yt-dlp` or the mirror network), so AI pipelines can reference frames exactly.

## Honest limits

- Only download videos you have the rights to download
- Public mirrors get blocked in waves — the web app and CLI both race every mirror and support a custom one, but when the whole network is down, wait and retry or use `--file`
- In-browser: first conversion downloads the ~30 MB ffmpeg engine once; encoding is single-threaded, so keep clips short (minutes, not hours); videos over ~700 MB won't fit in browser memory — use the CLI for those
- The inspector cannot detect fps from a file — set the fps field to match your encode (the burned-in numbers make misalignment obvious)

## Tech

Python 3 stdlib CLI (`yt-framecraft`) + a single-file vanilla JS web app (`index.html`) with a self-hosted ffmpeg.wasm worker (`vendor/`). No build step, no server, no dependencies to install.
