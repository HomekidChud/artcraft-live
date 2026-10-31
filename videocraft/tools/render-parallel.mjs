// render-parallel.mjs — chunked parallel renderer for VideoCraft projects.
//
// Renders a project's timeline as N chunks across parallel headless Chrome
// instances (vc.render({ start, end }) — see README "Parallel rendering"),
// trims each chunk to its exact span, stitches with ffmpeg, and transcodes
// to MP4. Near-linear speedup with cores/GPUs on the frame-accurate MP4 path;
// on the real-time WebM path each chunk records for its own duration, so
// N chunks finish in ~1/N the wall time.
//
// Requirements: Node 18+, puppeteer (npm i puppeteer), ffmpeg on PATH.
//
// Usage:
//   node tools/render-parallel.mjs project.json [chunkSeconds=10] [concurrency=3] [outName]
// Env:
//   VC_APP_URL   app base URL   (default http://127.0.0.1:8000/videocraft/)
//   VC_MP4=1     use the WebCodecs MP4 path (GPU machines — faster, frame-accurate)
//
// Serve the app first (e.g. `python3 -m http.server 8000` from the repo root);
// the chunk receiver is built in and cleans up its temp dir when done.
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import http from 'http';

const APP_URL = process.env.VC_APP_URL || 'http://127.0.0.1:8000/videocraft/';
const RECV_URL = process.env.VC_RECV_URL || 'http://127.0.0.1:8877/upload';
const useMp4 = process.env.VC_MP4 === '1';

const projectPath = process.argv[2];
if (!projectPath) { console.error('usage: node tools/render-parallel.mjs project.json [chunkSeconds] [concurrency] [outName]'); process.exit(1); }
const projectJson = fs.readFileSync(path.resolve(projectPath), 'utf8');
const project = JSON.parse(projectJson);
const duration = Math.max(...project.clips.map((c) => c.start + c.dur));
const chunkLen = +(process.argv[3] || 10);
const concurrency = +(process.argv[4] || 3);
const OUT = process.argv[5] || (project.name || 'video').replace(/[^\w-]+/g, '_');
const workdir = fs.mkdtempSync(path.join(process.cwd(), 'vc-chunks-'));

// built-in CORS receiver: saves each POSTed chunk into workdir
const RECV_PORT = 8877;
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
  const u = new URL(req.url, `http://localhost:${RECV_PORT}`);
  const name = (u.searchParams.get('name') || 'out.webm').replace(/[^a-zA-Z0-9._-]/g, '_');
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => {
    fs.writeFileSync(path.join(workdir, name), Buffer.concat(parts));
    res.writeHead(200, cors); res.end('ok');
  });
});
await new Promise((res) => server.listen(RECV_PORT, res));
console.log(`receiver listening on :${RECV_PORT}`);

const chunks = [];
for (let s = 0; s < duration - 0.01; s += chunkLen) chunks.push({ start: +s.toFixed(3), end: +Math.min(duration, s + chunkLen).toFixed(3) });
// avoid a tiny final chunk — merge it into the previous one
if (chunks.length > 1 && duration - chunks[chunks.length - 1].start < 3) {
  const tail = chunks.pop();
  chunks[chunks.length - 1].end = tail.end;
}
console.log(`rendering ${duration.toFixed(1)}s as ${chunks.length} chunks of ≤${chunkLen}s (concurrency ${concurrency}, path: ${useMp4 ? 'MP4' : 'WebM real-time'})`);

const queue = chunks.map((c, i) => ({ ...c, i }));

async function worker() {
  const browser = await puppeteer.launch({
    headless: 'new', protocolTimeout: 600000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1200'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200 });
  page.on('dialog', (d) => d.dismiss());
  try {
    await page.goto(APP_URL + '?headless=1', { waitUntil: 'networkidle2', timeout: 180000 });
    await page.waitForFunction('!!window.vc', { timeout: 120000 });
    await page.evaluate(async (p) => window.vc.loadProject(JSON.parse(p)), projectJson);
    if (!useMp4) {
      // software GL: the tiny H.264 pre-flight passes but 1080p frames crawl —
      // force the real-time WebM path instead
      await page.evaluate(() => { VideoEncoder.isConfigSupported = async () => ({ supported: false }); });
    }
    for (;;) {
      const ch = queue.shift();
      if (!ch) return;
      const t0 = Date.now();
      try {
        const r = await page.evaluate((o) => window.vc.render(o), {
          postUrl: `${RECV_URL}?name=chunk_${String(ch.i).padStart(2, '0')}.webm`,
          quality: 'high', start: ch.start, end: ch.end,
        });
        if (!r) throw new Error('render resolved without a result');
        console.log(`chunk ${ch.i} [${ch.start}-${ch.end}s] done in ${((Date.now() - t0) / 1000).toFixed(0)}s (${(r.size / 1e6).toFixed(1)} MB)`);
      } catch (e) {
        console.error(`chunk ${ch.i} FAILED: ${String(e).slice(0, 200)}`);
        process.exitCode = 1;
      }
    }
  } finally { await browser.close().catch(() => {}); }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
console.log(`all chunks rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// per-chunk exact trim + transcode (the recorder can overshoot the range on
// starved main threads — trim to the exact span so chunks stitch frame-accurately)
async function trimChunk(ch) {
  const span = +(ch.end - ch.start).toFixed(3);
  execSync(`ffmpeg -y -v error -i ${workdir}/chunk_${String(ch.i).padStart(2, '0')}.webm -t ${span} -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 ${workdir}/part_${String(ch.i).padStart(2, '0')}.mp4`);
  const d = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${workdir}/part_${String(ch.i).padStart(2, '0')}.mp4`).toString().trim();
  console.log(`part ${ch.i} trimmed to ${d}s (target ${span}s)`);
}
const tTrim = Date.now();
const trimQueue = chunks.map((c, i) => ({ ...c, i }));
async function trimWorker() {
  for (;;) { const ch = trimQueue.shift(); if (!ch) return; await trimChunk(ch); }
}
await Promise.all(Array.from({ length: Math.min(2, trimQueue.length) }, trimWorker));
console.log(`transcoded ${chunks.length} parts in ${((Date.now() - tTrim) / 1000).toFixed(0)}s`);

fs.writeFileSync(path.join(workdir, 'parts.txt'), chunks.map((c, i) => `file 'part_${String(i).padStart(2, '0')}.mp4'`).join('\n') + '\n');
execSync(`ffmpeg -y -v error -f concat -safe 0 -i ${workdir}/parts.txt -c copy -movflags +faststart "${OUT}.mp4"`);
const d2 = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${OUT}.mp4"`).toString().trim();
console.log(`done: ${OUT}.mp4 (${d2}s, expected ${duration.toFixed(1)}s) — total wall time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
server.close();
fs.rmSync(workdir, { recursive: true, force: true });
