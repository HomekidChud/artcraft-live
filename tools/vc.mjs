#!/usr/bin/env node
// vc.mjs — VideoCraft CLI
// Render VideoCraft projects to MP4 from the terminal, no browser tab needed.
//
//   node tools/vc.mjs render my-video.vfproject.json            # -> my-video.mp4
//   node tools/vc.mjs render proj.json --out film.mp4 --quality high
//   node tools/vc.mjs render proj.json --chrome /usr/bin/chromium
//   node tools/vc.mjs info proj.json                            # timeline summary
//   node tools/vc.mjs new --name "My video" > proj.vfproject.json
//
// Requires Node 22+ (global WebSocket + fetch) and a Chrome/Chromium/Edge binary.
// Rendering runs a real headless Chrome (WebGL via SwiftShader — no GPU needed)
// against the videocraft/ app in this repo, so what you get is exactly what the
// browser would export: H.264 + AAC MP4, audio and burned-in captions included.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const cmd = args[0];

function arg(name, fallback = undefined) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return fallback;
}
function has(name) { return args.includes(name); }

const help = () => console.log(`VideoCraft CLI — render projects to MP4 from the terminal

Usage:
  vc render <project.vfproject.json> [options]
      --out <file.mp4>     output path (default: <project>.mp4)
      --quality <q>        high | standard | draft  (default standard)
      --chrome <path>      Chrome/Chromium/Edge binary (or $VC_CHROME / $CHROME_PATH)
      --app <dir>          videocraft app folder (default: <repo>/videocraft)
      --timeout <sec>      overall timeout (default 3600)
      --keep               keep the browser open on failure for debugging
  vc info <project.vfproject.json>      print a timeline summary
  vc new [--name <n>] [--aspect 16:9|9:16|1:1|4:5|2.39:1] [--preset hero|landscape|anime|empty]
      print a starter project JSON on stdout (redirect to a .vfproject.json)
`);

// ---------------------------------------------------------------- chrome discovery

async function findChrome(explicit) {
  const from = explicit || process.env.VC_CHROME || process.env.CHROME_PATH;
  if (from) return from;
  const candidates = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : process.platform === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge',
  ];
  for (const p of candidates) {
    try { await stat(p); return p; } catch (e) {}
  }
  return null;
}

// ---------------------------------------------------------------- minimal websocket client
// (avoids any npm dependency — works on Node 18+)

class Ws {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname; this.port = +u.port; this.path = u.pathname + u.search;
    this.socket = null; this.buf = Buffer.alloc(0); this.upgraded = false;
    this.onmessage = null; this.onclose = null; this._frags = []; this._fragOp = 0;
  }
  connect() {
    return new Promise((res, rej) => {
      const key = randomBytes(16).toString('base64');
      this.socket = netConnect(this.port, this.host, () => {
        this.socket.write(`GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      this.socket.on('error', (e) => this.upgraded ? this._closed() : rej(e));
      this.socket.on('close', () => this._closed());
      this.socket.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!this.upgraded) {
          const i = this.buf.indexOf('\r\n\r\n');
          if (i < 0) return;
          const status = this.buf.slice(0, i).toString().split('\r\n')[0];
          if (!/\s101\s/.test(status)) return rej(new Error('websocket handshake failed: ' + status));
          this.upgraded = true;
          this.buf = this.buf.slice(i + 4);
          res();
        }
        this._parse();
      });
    });
  }
  _closed() { this.onclose && this.onclose(); }
  _parse() {
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 0x0f, fin = (b0 & 0x80) !== 0;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > 1n << 40n) { this.socket.destroy(); return; } len = Number(big); off = 10; }
      let mask = null;
      if (masked) { if (this.buf.length < off + 4) return; mask = this.buf.slice(off, off + 4); off += 4; }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (mask) payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      if (op === 8) { try { this.socket.end(); } catch (e) {} this._closed(); return; }
      if (op === 9) { this._sendFrame(0x8a, payload); continue; } // ping -> pong
      if (op === 10) continue; // pong
      if (op === 0 || (op !== 1 && this._frags.length)) { // continuation
        this._frags.push(payload);
        if (fin) { const full = Buffer.concat(this._frags); this._frags = []; this.onmessage && this.onmessage(full.toString()); }
        continue;
      }
      if (!fin) { this._frags = [payload]; continue; }
      this.onmessage && this.onmessage(payload.toString());
    }
  }
  _sendFrame(op, payload) {
    const mask = randomBytes(4);
    let header;
    if (payload.length < 126) header = Buffer.from([0x80 | op, 0x80 | payload.length]);
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    this.socket.write(Buffer.concat([header, mask, masked]));
  }
  send(text) { this._sendFrame(0x1, Buffer.from(text)); }
  close() { try { this._sendFrame(0x8, Buffer.alloc(0)); this.socket.end(); } catch (e) {} }
}

// ---------------------------------------------------------------- minimal CDP client

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  connect() {
    return new Promise(async (res, rej) => {
      this.ws = new Ws(this.wsUrl);
      this.ws.onmessage = (text) => {
        const m = JSON.parse(text);
        if (m.id && this.pending.has(m.id)) {
          const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? rej(new Error(m.error.message)) : res(m.result);
        } else if (m.method && this.handlers.has(m.method)) {
          for (const h of this.handlers.get(m.method)) h(m.params);
        }
      };
      try { await this.ws.connect(); res(); } catch (e) { rej(e); }
    });
  }
  on(method, h) { (this.handlers.get(method) || this.handlers.set(method, []).get(method)).push(h); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expression, opts = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...opts });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  // evaluate without waiting for the returned promise (fire-and-forget calls)
  fire(expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: false, awaitPromise: false }).then((r) => {
      if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function startServer(appDir, projectPath) {
  return new Promise(async (res) => {
    const projectJson = await readFile(projectPath, 'utf8');
    const result = { resolve: null };
    const server = createServer((req, rsp) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/project') {
        rsp.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return rsp.end(projectJson);
      }
      if (url.pathname === '/result' && req.method === 'POST') {
        // stream the MP4 straight to disk as it arrives
        const out = createWriteStream(result.outPath);
        req.pipe(out);
        req.on('end', () => { rsp.writeHead(204); rsp.end(); result.resolve && result.resolve(); });
        return;
      }
      // static files from the app dir
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = join(appDir, p.replace(/\/+/g, '/').replace(/^\/+/, ''));
      if (!file.startsWith(appDir)) { rsp.writeHead(403); return rsp.end(); }
      readFile(file).then((buf) => {
        rsp.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        rsp.end(buf);
      }).catch(() => { rsp.writeHead(404); rsp.end('not found'); });
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, result }));
  });
}

// ---------------------------------------------------------------- render

async function renderCmd() {
  const projectPath = args[1];
  if (!projectPath || !projectPath.endsWith('.json')) return console.error('Usage: vc render <project.vfproject.json> [--out file.mp4] [--chrome path] [--quality high|standard|draft]');
  const outPath = resolve(arg('--out') || projectPath.replace(/\.vfproject\.json$|\.json$/, '.mp4'));
  const quality = arg('--quality', 'standard');
  if (!['high', 'standard', 'draft'].includes(quality)) return console.error('--quality must be high | standard | draft');
  const appDir = resolve(arg('--app') || join(REPO_ROOT, 'videocraft'));
  const chromeBin = await findChrome(arg('--chrome'));
  if (!chromeBin) return console.error('No Chrome/Chromium found. Pass --chrome <path> or set $VC_CHROME.');

  await mkdir(dirname(outPath), { recursive: true });
  const { server, port, result } = await startServer(appDir, resolve(projectPath));
  result.outPath = outPath;
  const appUrl = `http://127.0.0.1:${port}/?headless=1`;
  const resultPromise = new Promise((r) => { result.resolve = r; });

  const debugPort = 20000 + (randomBytes(2).readUInt16BE(0) % 20000);
  const userDataDir = join(tmpdir(), `vc-chrome-${Date.now()}`);
  const chromeArgs = [
    '--headless=new', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--mute-audio', '--hide-scrollbars', '--disable-features=Translate',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    'about:blank',
  ];
  const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeDied = '';
  chrome.stderr.on('data', (d) => { chromeDied += d; });

  const finish = (code) => {
    try { chrome.kill(); } catch (e) {}
    server.close();
    process.exit(code);
  };
  const timeoutMs = (+arg('--timeout', 3600)) * 1000;
  const killTimer = setTimeout(() => { console.error('\nTimed out.'); finish(1); }, timeoutMs);

  try {
    // wait for the CDP endpoint
    let targets;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        targets = await r.json();
        if (targets.some((t) => t.type === 'page')) break;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 150));
      if (chrome.exitCode !== null) throw new Error('Chrome exited early.\n' + chromeDied.slice(-2000));
    }
    const page = targets.find((t) => t.type === 'page');
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: appUrl });
    for (let i = 0; i < 200; i++) { // wait for the app + automation hooks
      const stage = await cdp.eval('window.__vcProgress && window.__vcProgress.stage');
      if (stage === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const summary = await cdp.eval(`(async () => window.vc.loadProject(await (await fetch('/project')).text()))()`);
    console.log(`Project: ${summary.name} — ${summary.clips} clips, ${summary.scenes} scenes, ${summary.duration.toFixed(1)}s, ${summary.aspect}`);

    await cdp.fire(`window.vc.render({ postUrl: 'http://127.0.0.1:${port}/result', quality: '${quality}' })
      .then((r) => { window.__vcDone = r; }).catch((e) => { window.__vcError = String(e && e.stack || e); })`);

    // progress loop
    let lastLine = '', lastStage = '';
    const t0 = Date.now();
    while (true) {
      const err = await cdp.eval('window.__vcError || null');
      if (err) throw new Error(err);
      const prog = await cdp.eval('window.__vcProgress || {}');
      if (prog.stage && prog.stage !== lastStage) {
        if (lastLine) process.stderr.write('\n');
        process.stderr.write(`[${prog.stage}]${prog.note ? ' ' + prog.note : ''}\n`);
        lastStage = prog.stage; lastLine = '';
      }
      if (prog.stage === 'video' && prog.frames) {
        const pct = Math.round((prog.frame / prog.frames) * 100);
        const elapsed = (Date.now() - t0) / 1000;
        const speed = prog.frame > 0 ? (prog.frame / elapsed).toFixed(1) : '?';
        const line = `  encoding ${prog.frame}/${prog.frames} frames (${pct}%, ~${speed} fps)`;
        if (line !== lastLine) { process.stderr.write('\r' + line); lastLine = line; }
      }
      if (prog.stage === 'done') break;
      const done = await Promise.race([resultPromise.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
      if (done) break;
    }
    await resultPromise;

    const log = await cdp.eval('window.__vcLog || []');
    for (const l of log) process.stderr.write(`  ${l.stage}${l.note ? ' — ' + l.note : ''}\n`);
    const info = await cdp.eval('window.__vcResult || {}');
    cdp.close();
    clearTimeout(killTimer);
    const size = (await stat(outPath)).size;
    process.stderr.write('\n');
    console.log(`Wrote ${basename(outPath)} (${(size / 1e6).toFixed(1)} MB${info.name ? `, "${info.name}"` : ''})`);
    finish(0);
  } catch (err) {
    clearTimeout(killTimer);
    console.error('\nRender failed: ' + err.message);
    if (has('--keep')) { console.error('Chrome left running for debugging (remote debugging port ' + debugPort + ')'); server.close(); process.exit(1); }
    finish(1);
  }
}

// ---------------------------------------------------------------- info

async function infoCmd() {
  const projectPath = args[1];
  if (!projectPath) return console.error('Usage: vc info <project.vfproject.json>');
  const p = JSON.parse(await readFile(resolve(projectPath), 'utf8'));
  const end = (c) => c.start + c.dur;
  const total = Math.max(0, ...(p.clips || []).map(end), ...(p.captions || []).map(end), 0.001);
  console.log(`Name:      ${p.name || 'Untitled'}`);
  console.log(`Aspect:    ${p.aspect || '16:9'}   FPS: ${p.fps || 30}`);
  console.log(`Duration:  ${total.toFixed(2)}s`);
  console.log(`Clips:     ${(p.clips || []).length}   Scenes: ${(p.scenes || []).length}   Captions: ${(p.captions || []).length}`);
  for (const c of (p.clips || []).slice().sort((a, b) => a.start - b.start)) {
    const label = c.kind === 'scene' ? (p.scenes || []).find((s) => s.id === c.sceneId)?.name : (p.media || []).find((m) => m.id === c.mediaId)?.name;
    console.log(`  [${c.track}] ${c.start.toFixed(1)}–${end(c).toFixed(1)}s  ${c.kind}${label ? ' · ' + label : ''}`);
  }
  const embedded = (p.media || []).filter((m) => m.data).length;
  const missing = (p.media || []).filter((m) => !m.data).length;
  if ((p.media || []).length) console.log(`Media:     ${p.media.length} (${embedded} embedded, ${missing} external/missing)`);
}

// ---------------------------------------------------------------- new

async function newCmd() {
  const rid = (p) => p + Math.random().toString(36).slice(2, 8);
  const presets = {
    hero: { objects: [
      { id: rid('o'), type: 'ground', name: 'Ground', pos: [0, 0, 0], rot: [0, 0, 0], scale: [30, 1, 30], color: '#2c3140', opacity: 1, keys: [] },
      { id: rid('o'), type: 'character', name: 'Hero', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#d9d2c7', opacity: 1, keys: [], motion: 'idle', skin: '#e8b88a', shirt: '#c9553d', pants: '#31465e', hair: '#2a2018' },
      { id: rid('o'), type: 'box', name: 'Prop', pos: [2.2, 0.5, -1], rot: [0, 0, 0], scale: [1, 1, 1], color: '#b0a48f', opacity: 1, keys: [] },
    ] },
    landscape: { objects: [
      { id: rid('o'), type: 'ground', name: 'Ground', pos: [0, 0, 0], rot: [0, 0, 0], scale: [60, 1, 60], color: '#2e3d2e', opacity: 1, keys: [] },
      { id: rid('o'), type: 'sphere', name: 'Sun', pos: [-14, 9, -22], rot: [0, 0, 0], scale: [3, 3, 3], color: '#ffd9a0', opacity: 1, keys: [] },
      { id: rid('o'), type: 'cylinder', name: 'Tower', pos: [6, 2, -8], rot: [0, 0, 0], scale: [1.2, 4, 1.2], color: '#5d6577', opacity: 1, keys: [] },
      { id: rid('o'), type: 'fx', name: 'Mist', pos: [0, 0.4, 2], rot: [0, 0, 0], scale: [1, 1, 1], color: '#d9d2c7', opacity: 1, keys: [], fx: 'fire', size: 2.4 },
    ], look: { style: 'film', grade: 'sunset', bloom: 0.8, vignette: 0.4, grain: 0.05, chroma: 0.5, outline: 1.0, toonSteps: 4, exposure: 1.0, streak: 0.5 } },
    anime: { objects: [
      { id: rid('o'), type: 'ground', name: 'Ground', pos: [0, 0, 0], rot: [0, 0, 0], scale: [40, 1, 40], color: '#3a4a5e', opacity: 1, keys: [] },
      { id: rid('o'), type: 'character', name: 'Protagonist', pos: [-1, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#d9d2c7', opacity: 1, keys: [], motion: 'wave', skin: '#e8b88a', shirt: '#e8e4dc', pants: '#31465e', hair: '#1d2f4d' },
      { id: rid('o'), type: 'cylinder', name: 'Lamp post', pos: [3, 1.8, -2], rot: [0, 0, 0], scale: [0.15, 3.6, 0.15], color: '#8a93a5', opacity: 1, keys: [] },
    ], look: { style: 'anime', grade: 'comic', bloom: 0.35, vignette: 0.25, grain: 0.05, chroma: 0.5, outline: 1.0, toonSteps: 4, exposure: 1.0, streak: 0 } },
    empty: { objects: [
      { id: rid('o'), type: 'ground', name: 'Ground', pos: [0, 0, 0], rot: [0, 0, 0], scale: [30, 1, 30], color: '#2c3140', opacity: 1, keys: [] },
    ] },
  };
  const preset = presets[arg('--preset', 'hero')] || presets.hero;
  const scId = rid('sc');
  const scene = {
    id: scId, name: '3D Scene', duration: 6,
    sky: '#0d1522', fog: 0, lighting: 'three-point',
    camera: { pos: [7, 4, 11], target: [0, 1.4, 0] }, camKeys: [],
    look: preset.look || { style: 'film', grade: 'cine', bloom: 0.55, vignette: 0.4, grain: 0.05, chroma: 0.5, outline: 1.0, toonSteps: 4, exposure: 1.0, streak: 0.25 },
    objects: preset.objects, events: [{ type: 'fadein', t: 0, dur: 0.6 }, { type: 'fadeout', t: 5.4, dur: 0.6 }],
    _rev: 1,
  };
  const project = {
    app: 'videocraft', version: 1,
    name: arg('--name', 'My video'), aspect: arg('--aspect', '16:9'), fps: 30,
    clips: [{ id: rid('c'), track: 'v', kind: 'scene', sceneId: scId, start: 0, dur: 6, in: 0, volume: 1 }],
    scenes: [scene],
    captions: [{ id: rid('cap'), start: 0.8, dur: 3, text: 'My video', pos: 'bottom', size: 1.2, color: '#ffffff', bg: true }],
    media: [],
  };
  process.stdout.write(JSON.stringify(project, null, 2) + '\n');
}

// ---------------------------------------------------------------- main

switch (cmd) {
  case 'render': await renderCmd(); break;
  case 'info': await infoCmd(); break;
  case 'new': await newCmd(); break;
  default: help();
}
