/* Flight World cloud build sync — implements the /api/builds contract.
 * Node server with a swappable storage adapter:
 *   - MONGODB_URI set  → MongoDB collection (driver loaded lazily)
 *   - otherwise        → JSON file when the filesystem is writable
 *                         (Render free disks are ephemeral across redeploys)
 * Bundled starter presets in seed/presets.json are loaded automatically when
 * the store is empty, so redeploys always restore the default preset set.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const MAX_BUILDS = 500;
const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2 MB per build document
const API_KEY = process.env.API_KEY || ''; // optional shared secret for writes/deletes
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'builds.json');

let store = { builds: {} }; // id -> {id, name, kind, data, createdAt, updatedAt}
let storageMode = 'memory';

const SEED_FILE = path.join(__dirname, 'seed', 'presets.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
let mongo = null; // set when the MongoDB adapter is active

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

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
    'Cache-Control': 'no-store'
  };
  res.writeHead(code, headers);
  res.end(body);
}
function authorized(req) {
  if (!API_KEY) return true; // no key configured: open access (set API_KEY to lock writes)
  return req.headers['x-api-key'] === API_KEY;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','builds',id?]

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    if (parts[0] !== 'api') return send(res, 404, { error: 'Not found' });

    if (req.method === 'GET' && parts[1] === 'health') {
      const count = mongo ? await mongo.countDocuments({}) : Object.keys(store.builds).length;
      return send(res, 200, { ok: true, storage: storageMode, builds: count, version: '1.1.0' });
    }

    if (parts[1] === 'builds') {
      if (req.method === 'GET' && !parts[2]) {
        if (mongo) return send(res, 200, (await mongo.find({}, { projection: { _id: 0, data: 0 } }).sort({ updatedAt: -1 }).limit(500).toArray()));
        return send(res, 200, listBuilds());
      }

      if (req.method === 'POST' && !parts[2]) {
        if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON body' });
        const name = sanitize(body.name || 'Untitled build', 60);
        const kind = body.kind === 'preset' ? 'preset' : 'build';
        const data = body.data;
        if (!data || typeof data !== 'object') return send(res, 400, { error: 'Missing build data' });
        if (raw.length > MAX_DOC_BYTES) return send(res, 413, { error: 'Build document too large' });
        // capacity is an error, never a silent deletion of someone's saved build
        const count = mongo ? await mongo.countDocuments({}) : Object.keys(store.builds).length;
        if (count >= MAX_BUILDS) return send(res, 507, { error: 'Server full (' + MAX_BUILDS + ' builds) — delete a build first' });
        const id = newId();
        const now = Date.now();
        const doc = { id, name, kind, data, createdAt: now, updatedAt: now };
        if (mongo) await mongo.insertOne(doc);
        else { store.builds[id] = doc; persist(); }
        return send(res, 201, { id, name, kind });
      }

      if (parts[2]) {
        let doc = null;
        if (mongo) doc = await mongo.findOne({ id: parts[2] }, { projection: { _id: 0 } });
        else doc = store.builds[parts[2]];
        if (req.method === 'GET' && doc) return send(res, 200, doc);
        if (req.method === 'DELETE') {
          if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });
          if (!doc) return send(res, 404, { error: 'Build not found' });
          if (mongo) await mongo.deleteOne({ id: parts[2] });
          else { delete store.builds[parts[2]]; persist(); }
          return send(res, 200, { ok: true });
        }
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, err.message === 'Payload too large (max 2 MB)' ? 413 : 500, { error: String(err.message || err) });
  }
});

initStore().then(() => {
  server.listen(PORT, () => console.log('Flight World build sync listening on :' + PORT + ' (' + storageMode + ' storage)'));
}).catch(err => { console.error('Storage init failed:', err); process.exit(1); });
