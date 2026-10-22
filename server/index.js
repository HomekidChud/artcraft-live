/* Flight World cloud build sync — implements the /api/builds contract.
 * Zero-dependency Node server. Persists to a JSON file when the filesystem
 * allows (Render free disks are ephemeral across deploys; MongoDB can be
 * attached later via MONGODB_URI without changing the client).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const MAX_BUILDS = 500;
const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2 MB per build document
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'builds.json');

let store = { builds: {} }; // id -> {id, name, kind, data, createdAt, updatedAt}
let storageMode = 'memory';

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  storageMode = 'file';
} catch (_) { /* read-only fs: run in-memory */ }

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
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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
      return send(res, 200, { ok: true, storage: storageMode, builds: Object.keys(store.builds).length, version: '1.0.0' });
    }

    if (parts[1] === 'builds') {
      if (req.method === 'GET' && !parts[2]) return send(res, 200, listBuilds());

      if (req.method === 'POST' && !parts[2]) {
        const raw = await readBody(req);
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON body' });
        const name = sanitize(body.name || 'Untitled build', 60);
        const kind = body.kind === 'preset' ? 'preset' : 'build';
        const data = body.data;
        if (!data || typeof data !== 'object') return send(res, 400, { error: 'Missing build data' });
        if (raw.length > MAX_DOC_BYTES) return send(res, 413, { error: 'Build document too large' });
        if (Object.keys(store.builds).length >= MAX_BUILDS) {
          // drop the oldest to make room
          const oldest = listBuilds().pop();
          if (oldest) delete store.builds[oldest.id];
        }
        const id = newId();
        const now = Date.now();
        store.builds[id] = { id, name, kind, data, createdAt: now, updatedAt: now };
        persist();
        return send(res, 201, { id, name, kind });
      }

      if (parts[2]) {
        const doc = store.builds[parts[2]];
        if (req.method === 'GET' && doc) return send(res, 200, doc);
        if (req.method === 'DELETE') {
          if (!doc) return send(res, 404, { error: 'Build not found' });
          delete store.builds[parts[2]];
          persist();
          return send(res, 200, { ok: true });
        }
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, err.message === 'Payload too large (max 2 MB)' ? 413 : 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => console.log('Flight World build sync listening on :' + PORT + ' (' + storageMode + ' storage)'));
