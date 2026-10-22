/* Flight World cloud build sync — implements the /api/builds contract.
 * Node server with a swappable storage adapter:
 *   - MONGODB_URI set  → MongoDB collection (driver loaded lazily)
 *   - otherwise        → JSON file when the filesystem is writable
 *                         (Render free disks are ephemeral across redeploys)
 * Bundled starter presets in seed/presets.json are loaded automatically when
 * the store is empty, so redeploys always restore the default preset set.
 *
 * Hardening (17.10.2):
 *   - server-side validation of build documents (mirrors client validateDesign)
 *   - per-IP rate limiting on writes
 *   - CORS restricted via CORS_ORIGINS (set to the game origin(s), or * to allow all)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const MAX_BUILDS = 500;
const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2 MB per build document
const API_KEY = process.env.API_KEY || ''; // optional shared secret for writes/deletes
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'builds.json');

/* ---------- CORS: restricted by default, override with CORS_ORIGINS ---------- */
const DEFAULT_ORIGINS = [
  'https://homekidchud.github.io',
  'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173'
];
const CORS_ORIGINS = (process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(','))
  .split(',').map(s => s.trim()).filter(Boolean);
const CORS_ALLOW_ALL = CORS_ORIGINS.includes('*');

/* ---------- rate limiting: token bucket per IP (writes) ---------- */
const RATE_LIMIT_DEFAULT = Number(process.env.RATE_LIMIT || 30); // writes per window
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60_000);
const buckets = new Map(); // ip -> {tokens, refilled}
function rateAllow(ip) {
  const limit = Number(process.env.RATE_LIMIT) || RATE_LIMIT_DEFAULT;
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: limit, ts: now }; buckets.set(ip, b); }
  const elapsed = now - b.ts;
  if (elapsed > RATE_WINDOW_MS) { b.tokens = limit; b.ts = now; }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}
setInterval(() => { // keep the map small
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [ip, b] of buckets) if (b.ts < cutoff) buckets.delete(ip);
}, RATE_WINDOW_MS).unref();

let store = { builds: {} }; // id -> {id, name, kind, data, createdAt, updatedAt}
let storageMode = 'memory';

const SEED_FILE = path.join(__dirname, 'seed', 'presets.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
let mongo = null; // set when the MongoDB adapter is active

/* ---------- validation (mirrors the client's validateDesign) ----------
 * The server does not know the part catalog, so it validates shape and limits
 * only; type strings must look like catalog keys. Client-side validateDesign
 * remains the authoritative gate before Test Fly. */
const WIRE_KINDS = ['power', 'signal', 'data', 'ground', 'hydraulic', 'fuel', 'water'];
function validVector(v, min, max) {
  if (v == null) return true;
  if (typeof v !== 'object') return false;
  for (const axis of ['x', 'y', 'z']) {
    const n = v[axis];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return false;
  }
  return true;
}
function validateBuildData(data) {
  if (!data || typeof data !== 'object') throw new Error('Missing build data');
  // Ground-up workshop presets are stored in an envelope; validate the inner build.
  if (data.schema === 'flightworld-build') {
    if (!data.build || typeof data.build !== 'object') throw new Error('Preset envelope missing build');
    return validateBuildData(data.build);
  }
  if (data.schema === 'flightworld-preset') {
    if (!data.specs || typeof data.specs !== 'object' || !data.specs.id) throw new Error('Preset envelope missing specs');
    return;
  }
  if (!Array.isArray(data.parts)) throw new Error('Missing parts list');
  if (data.parts.length > 600) throw new Error('Maximum 600 components per aircraft');
  const ids = new Set();
  for (const [i, p] of data.parts.entries()) {
    if (!p || typeof p !== 'object') throw new Error(`Invalid component at ${i + 1}`);
    if (typeof p.type !== 'string' || !/^[a-z][a-zA-Z0-9]{0,30}$/.test(p.type)) throw new Error(`Unknown component at ${i + 1}`);
    const id = p.id ?? `part-${i + 1}`;
    if (typeof id !== 'string' || !/^part-\d+$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate component ID');
    ids.add(id);
    if (!validVector(p.position, -500, 500)) throw new Error('Invalid component position');
    if (!validVector(p.rotation, -Math.PI * 20, Math.PI * 20)) throw new Error('Invalid component rotation');
    if (!validVector(p.scale, 0.1, 20)) throw new Error('Invalid component scale');
    if (p.color != null && !/^#[a-f0-9]{6}$/i.test(p.color)) throw new Error('Invalid component color');
    if (p.symmetryPairId != null && !/^mirror-\d+$/.test(p.symmetryPairId)) throw new Error('Invalid symmetry pair');
  }
  if (data.wires != null && !Array.isArray(data.wires)) throw new Error('Invalid wiring list');
  const wires = data.wires || [];
  if (wires.length > 2400) throw new Error('Maximum 2400 connections');
  const seen = new Set();
  for (const w of wires) {
    if (!w || !ids.has(w.from) || !ids.has(w.to) || w.from === w.to || !WIRE_KINDS.includes(w.kind)) throw new Error('Invalid wiring connection');
    const key = [w.from, w.to].sort().join(':') + ':' + w.kind;
    if (seen.has(key)) throw new Error('Duplicate wiring connection');
    seen.add(key);
  }
  if (data.groups != null) {
    if (!Array.isArray(data.groups)) throw new Error('Invalid groups list');
    // group membership may reference parts OR other groups (nested hierarchy)
    const groupIds = new Set(data.groups.map(g => g && g.id).filter(Boolean));
    const partIds = new Set(data.parts.map(p => p.id));
    for (const g of data.groups) {
      if (!g || typeof g !== 'object' || typeof g.name !== 'string' || !Array.isArray(g.parts)) throw new Error('Invalid group');
      for (const id of g.parts) if (!partIds.has(id) && !groupIds.has(id)) throw new Error('Group references unknown component');
    }
  }
  if (data.snapIncrement != null && ![0, .25, .5, 1, 2].includes(data.snapIncrement)) throw new Error('Invalid grid snap');
}

async function initStore() {
  if (MONGODB_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      mongo = client.db().collection('builds');
      storageMode = 'mongo';
      const n = await mongo.countDocuments({});
      if (n === 0) await seedStore();
      return;
    } catch (err) {
      console.error('MongoDB adapter failed, falling back to file storage:', String(err.message || err));
    }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    storageMode = 'file';
    if (!Object.keys(store.builds).length) await seedStore();
  } catch (_) { /* read-only fs: run in-memory */ }
}

async function seedStore() {
  try {
    if (!fs.existsSync(SEED_FILE)) return;
    const docs = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    if (!Array.isArray(docs)) return;
    for (const d of docs) {
      if (!d || !d.data) continue;
      const id = newId();
      const now = Date.now();
      const doc = { id, name: sanitize(d.name || 'Preset', 60), kind: d.kind === 'preset' ? 'preset' : 'build', data: d.data, createdAt: now, updatedAt: now, seeded: true };
      if (mongo) await mongo.insertOne(doc);
      else store.builds[id] = doc;
    }
    persist();
    console.log('Seeded', docs.length, 'starter presets from seed/presets.json');
  } catch (_) { /* no seed file: start empty */ }
}

let saveTimer = null;
function persist() {
  if (storageMode !== 'file') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, DATA_FILE);
    } catch (_) { /* best effort */ }
  }, 150);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function sanitize(str, max) {
  return String(str == null ? '' : str).replace(/[<>&"']/g, '').slice(0, max);
}
function listBuilds() {
  return Object.values(store.builds)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(({ id, name, kind, createdAt, updatedAt }) => ({ id, name, kind, createdAt, updatedAt }));
}

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = CORS_ALLOW_ALL ? '*' : (CORS_ORIGINS.includes(origin) ? origin : '');
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
    'Vary': 'Origin'
  };
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return headers;
}
function send(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extra);
  res.writeHead(code, headers);
  res.end(body);
}
function authorized(req) {
  if (!API_KEY) return true; // no key configured: open access (set API_KEY to lock writes)
  return req.headers['x-api-key'] === API_KEY;
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_DOC_BYTES) { reject(new Error('Payload too large (max 2 MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api','builds',id?]
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') return send(res, 204, {}, cors);

    try {
      if (parts[0] !== 'api') return send(res, 404, { error: 'Not found' }, cors);

      if (req.method === 'GET' && parts[1] === 'health') {
        const count = mongo ? await mongo.countDocuments({}) : Object.keys(store.builds).length;
        return send(res, 200, { ok: true, storage: storageMode, builds: count, version: '1.2.0' }, cors);
      }

      if (parts[1] === 'builds') {
        if (req.method === 'GET' && !parts[2]) {
          if (mongo) return send(res, 200, (await mongo.find({}, { projection: { _id: 0, data: 0 } }).sort({ updatedAt: -1 }).limit(500).toArray()), cors);
          return send(res, 200, listBuilds(), cors);
        }

        if (req.method === 'POST' && !parts[2]) {
          if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' }, cors);
          if (!rateAllow(clientIp(req))) return send(res, 429, { error: 'Too many requests — slow down' }, cors);
          const raw = await readBody(req);
          const body = JSON.parse(raw);
          if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON body' }, cors);
          const name = sanitize(body.name || 'Untitled build', 60);
          const kind = body.kind === 'preset' ? 'preset' : 'build';
          const data = body.data;
          if (!data || typeof data !== 'object') return send(res, 400, { error: 'Missing build data' }, cors);
          if (raw.length > MAX_DOC_BYTES) return send(res, 413, { error: 'Build document too large' }, cors);
          try { validateBuildData(data); }
          catch (v) { return send(res, 400, { error: 'Rejected build: ' + String(v.message || v) }, cors); }
          // capacity is an error, never a silent deletion of someone's saved build
          const count = mongo ? await mongo.countDocuments({}) : Object.keys(store.builds).length;
          if (count >= MAX_BUILDS) return send(res, 507, { error: 'Server full (' + MAX_BUILDS + ' builds) — delete a build first' }, cors);
          const id = newId();
          const now = Date.now();
          const doc = { id, name, kind, data, createdAt: now, updatedAt: now };
          if (mongo) await mongo.insertOne(doc);
          else { store.builds[id] = doc; persist(); }
          return send(res, 201, { id, name, kind }, cors);
        }

        if (parts[2]) {
          let doc = null;
          if (mongo) doc = await mongo.findOne({ id: parts[2] }, { projection: { _id: 0 } });
          else doc = store.builds[parts[2]];
          if (req.method === 'GET' && doc) return send(res, 200, doc, cors);
          if (req.method === 'DELETE') {
            if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' }, cors);
            if (!rateAllow(clientIp(req))) return send(res, 429, { error: 'Too many requests — slow down' }, cors);
            if (!doc) return send(res, 404, { error: 'Build not found' }, cors);
            if (mongo) await mongo.deleteOne({ id: parts[2] });
            else { delete store.builds[parts[2]]; persist(); }
            return send(res, 200, { ok: true }, cors);
          }
        }
      }
      return send(res, 404, { error: 'Not found' }, cors);
    } catch (err) {
      return send(res, err.message === 'Payload too large (max 2 MB)' ? 413 : 500, { error: String(err.message || err) }, cors);
    }
  });
}

if (require.main === module) {
  initStore().then(() => {
    createServer().listen(PORT, () => console.log('Flight World build sync listening on :' + PORT + ' (' + storageMode + ' storage)'));
  }).catch(err => { console.error('Storage init failed:', err); process.exit(1); });
}

module.exports = { createServer, initStore, validateBuildData, listBuilds, newId, sanitize, corsHeaders, rateAllow };
