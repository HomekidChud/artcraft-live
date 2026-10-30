# FrameCraft (yt-framecraft)

Turn any YouTube video into a frame-perfect MP4 that AI can actually look at — every frame on the clock, numbered, and inspectable.

## What it does

- **Fetch any YouTube video** — URL or video ID, via `yt-dlp`
- **Make it frame-perfect** — re-encoded to a constant frame rate (no variable-frame-rate drift), deinterlaced, H.264 `yuv420p`, closed GOPs with a keyframe every second, `+faststart`
- **Burned-in frame numbers + timestamps** — every frame is self-describing on screen (on by default, `--no-burn` to skip)
- **AI-friendly sidecar** — a `.json` next to the MP4 with fps, frame count, duration and resolution, so pipelines can reference "frame 1234 @ 41.133s" exactly
- **Vision-model friendly options** — cap the long edge (`--scale 1280`), force a clean fps (`--fps 24`)
- **Optional exports** — every frame as PNG (`--frames`), 5×5 contact sheets at 1 fps (`--grid`)
- **Web inspector** — open `index.html`, drop the MP4, step frame-by-frame (±1, ±10), jump to a frame number, export the exact frame as PNG, copy a machine-readable frame reference
- **Local files too** — `--file lecture.mp4` runs the same frame-perfect pass on anything you already have

## Usage

```bash
# grab any YouTube video as a frame-perfect, AI-ready MP4
python3 yt-framecraft https://www.youtube.com/watch?v=VIDEO_ID

# force 24 fps, cap the long edge at 1280px for vision models
python3 yt-framecraft VIDEO_ID --fps 24 --scale 1280

# also dump every frame as PNG + 5x5 contact sheets
python3 yt-framecraft VIDEO_ID --frames png_out --grid sheets

# convert a local file instead
python3 yt-framecraft --file lecture.mp4 -o lecture_ai.mp4
```

Then open `index.html` to inspect the result frame by frame in the browser.

## Honest limits

- Only download videos you have the rights to download
- Needs `yt-dlp` and `ffmpeg` installed and on your PATH (Python 3.8+, no pip packages)
- Re-encoding takes real time (x264 `medium`, CRF 18 by default — tune with `--preset`/`--crf`)
- The web inspector cannot detect fps from a file — set the fps field to match your encode (the burned-in numbers make misalignment obvious)
- Browsers seek to the nearest keyframe first, then decode to the exact frame — with keyframes every second this stays fast and accurate

## Tech

Python 3 stdlib CLI (`yt-framecraft`) + a single-file vanilla JS web inspector (`index.html`). No build step, no server, no dependencies to install.
