# Flight World build sync server

Cloud storage for Flight World aircraft builds and presets. Implements the
`/api/builds` contract the workshop Cloud panel speaks:

- `GET /api/health` — service status, storage backend, document count
- `GET /api/builds` — list saved documents (id, name, kind, timestamps)
- `POST /api/builds` — save `{ name, kind: 'build' | 'preset', data }` as JSON
- `GET /api/builds/:id` — fetch one document
- `DELETE /api/builds/:id` — remove a document

## Hardening

- **Server-side validation** — every POST is validated against the same schema
  the client's `validateDesign` enforces (part IDs, positions, wire kinds and
  endpoints, group membership, size caps). Malformed builds are rejected with 400.
- **Rate limiting** — per-IP token bucket on writes and deletes
  (`RATE_LIMIT` writes per `RATE_WINDOW_MS`, defaults 30/min). 429 when exceeded.
- **CORS** — restricted by default to the game origin (GitHub Pages) and local
  dev ports. Set `CORS_ORIGINS` (comma-separated) to change; use `*` to allow all.
- **Size caps** — 2 MB per document, 500 stored builds; the server errors rather
  than silently deleting anything when full.
- **Optional write protection** — set `API_KEY` and writes/deletes require the
  `X-API-Key` header (reads stay open).

## Storage adapters

`MONGODB_URI` set → MongoDB collection (driver loaded lazily, seeded when empty).
Otherwise → JSON file when the filesystem is writable; in-memory as a last resort.
Render free disks are ephemeral across redeploys — attach MongoDB (below) for
durable storage. Bundled starter presets in `seed/presets.json` are loaded
automatically whenever the store starts empty.

## Deploy on Render

1. Push this repo to GitHub (the `server/` folder is the service root).
2. Render dashboard → **New → Web Service** → connect the repo.
3. Root directory `server`, build `npm install`, start `npm start`
   (or just deploy with `render.yaml` via **New → Blueprint**).
4. Health check path: `/api/health`.
5. Env vars: `CORS_ORIGINS=https://homekidchud.github.io`
   (`MONGODB_URI`, `API_KEY` optional — set in the dashboard, never commit them).

To attach MongoDB: Render dashboard → your database → copy the connection
string into the service's `MONGODB_URI`. No code change is needed — the
adapter switches automatically and seeds the presets when the collection is empty.

## Run and test locally

    npm start          # listens on PORT (default 3000)
    npm test           # validation, CRUD, CORS, rate-limit and round-trip tests

The test suite covers an end-to-end save → server → reload round trip using a
workshop snapshot fixture.

## Seeding workshop presets

`../tools/seed-presets` (repo root) rebuilds the fleet as ground-up workshop
designs and POSTs them to a running server with `kind: 'preset'`. See that
folder's README.
