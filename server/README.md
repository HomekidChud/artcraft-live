# Flight World build sync server

Cloud storage for Flight World aircraft builds and presets. Implements the
`/api/builds` contract the workshop Cloud panel speaks:

- `GET /api/health` — service status and storage backend
- `GET /api/builds` — list saved documents (id, name, kind, timestamps)
- `POST /api/builds` — save `{ name, kind: 'build' | 'preset', data }` as JSON
- `GET /api/builds/:id` — fetch one document
- `DELETE /api/builds/:id` — remove a document

Zero dependencies (plain Node `http`), CORS open for static hosts such as
GitHub Pages. Persistence is a JSON file when the filesystem is writable
(Render free disks are ephemeral across deploys — attach MongoDB later via
`MONGODB_URI` without changing the client). Documents are capped at 2 MB and
500 stored builds (oldest dropped first).

## Run

    node index.js

Listens on `PORT` (default 3000).
