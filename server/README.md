# Flight World build sync server

Cloud storage for Flight World aircraft builds and presets. Implements the
`/api/builds` contract the workshop Cloud panel speaks:

- `GET /api/health` — service status and storage backend
- `GET /api/builds` — list saved documents (id, name, kind, timestamps)
- `POST /api/builds` — save `{ name, kind: 'build' | 'preset', data }` as JSON
- `GET /api/builds/:id` — fetch one document
- `DELETE /api/builds/:id` — remove a document

Zero dependencies (plain Node `http`), CORS open for static hosts such as
GitHub Pages. Persistence is a JSON file when the filesystem is writable —
**MongoDB is not implemented yet**: the `MONGODB_URI` env var is reserved for
a future adapter, and on Render's free plan the file store is ephemeral across
redeploys (saved builds survive restarts but not new deploys until MongoDB is
attached). Documents are capped at 2 MB and 500 stored builds — when full the
server returns an error rather than deleting anything.

Optional write protection: set `API_KEY` in the environment and writes/deletes
require the `X-API-Key` header (reads stay open). Without it the API is open —
suitable for personal use, not for public shared storage.

## MongoDB (later)

When a MongoDB database is attached (Render dashboard → your database →
connection string in `MONGODB_URI`), the storage adapter in `index.js` should be
swapped for a Mongo collection with the same `{ id, name, kind, data }` shape —
no client change is needed.

## Run

    node index.js

Listens on `PORT` (default 3000).
