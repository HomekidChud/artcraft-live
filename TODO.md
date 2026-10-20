# TODO — UnityCraft & RobloxCraft upgrade ledger

Single canonical handoff file for the two in-repo reconstructions. Update it in
**every push** that touches either app so the next AI can continue. Both apps
are editable in-repo originals (NOT generated craft bundles — ordinary source
development is correct here). Repo rules that still apply: `npm test` must pass,
assistant widget integration in catalog crafts must not break, and all claims in
READMEs must stay honest (these are reconstructions, not real Unity/Roblox).

## Shared context

- Repo: `HomekidChud/artcraft-live` (GitHub Pages site, one folder per app).
- Both apps are single-file static apps (`unitycraft/index.html`,
  `robloxcraft/index.html`), Three.js 0.160 via CDN import maps, WebGL renderer
  (deliberately NOT WebGPU-only — the site owner's browser has broken WebGPU).
- Both apps expose QA handles: `window.unitycraft` / `window.robloxcraft`.
- Repeatable QA: `qa/reconstructions-qa.mjs` (run `node qa/reconstructions-qa.mjs`
  with Playwright installed; needs a local static server on port 8123, or pass a
  BASE_URL env var). Always run `npm test` before pushing.
- Landing page: `index.html` APPS array at the repo root lists the apps. Sister apps
  built the same way: `planecraft/` (Plane PM reconstruction) and
  `airplanecraft/` (owner-supplied flight-sim HTML, v17.2, branding-only
  changes — do not refactor its code without the owner's ask).

## UnityCraft — status

Files: `unitycraft/index.html` (single file, ~1430 lines). Key globals: `ed`
(editor state), `makeObject(type, opts)`, `serializeObject/restoreObject`,
`handleAction`, `renderHierarchy/renderInspector`, `togglePlay`,
`pushHistory/undo/redo`. Storage keys: `unitycraft-scene` (scene JSON).

### Working (verified in browser QA)

- Hub: projects (favorites/search/new-project with templates), installs, learn,
  community, preferences views; opens the editor.
- Editor: hierarchy + inspector (transform/mesh/light/camera/script components),
  scene view (grid/gizmos/wireframe toggles), orbit camera, TransformControls
  (move/rotate/scale), click-pick with outlines, undo/redo (50 steps),
  copy/paste/duplicate/delete, play mode with full snapshot restore
  (spin/bob scripts), save/open scene (localStorage), keyboard shortcuts
  (QWERT, F, Del, Ctrl+Z/Y/D/S/C/V/N/G, P), axis gizmo, FPS counter,
  console/project/services bottom tabs.

### Milestones completed in this upgrade

- (commit 1) Baseline: this ledger created; no app changes yet.
- (commit 2) UnityCraft editor pass 1: grid snapping (Snap checkbox in the
  scene toolbar, 0.5 translate / 15° rotate / 0.25 scale, hold Ctrl to
  invert while dragging — `SNAP` + `applySnap()`), 5 new primitives (cone,
  torus, torusknot, ring, icosahedron in `GEOM` + GameObject menu),
  hierarchy search (`#hier-search` → `ed.hierFilter` → `renderHierarchy`),
  richer materials (metallic/emission/preset in the inspector; serialized
  through `serializeObject`/`restoreObject` so saves keep them), console
  filter bar (All/Info/Warnings/Errors + Clear via `showConsole` + CSS
  `[data-cfilter]` rules). QA handle now exposes `tcontrols`/`applySnap`.
- (commit 3) UnityCraft editor pass 2: prefabs (Assets ▸ Create ▸ Prefab
  From Selection → `ed.prefabs` + `unitycraft-prefabs` key; instantiate by
  clicking the prefab in the Project window — `instantiatePrefab`),
  multi-slot scenes (File ▸ Save Scene As… → `unitycraft-scenes` map;
  Project window lists scenes — `openSavedScene`; legacy `unitycraft-scene`
  quick-save key kept in sync), play-mode physics (PlayerController script:
  camera-relative WASD, gravity + jump + vertical AABB ground collision
  `stepPlayerControllers`/`groundTopFor`, third-person follow camera in
  Game view, respawn below y<-30; state restored on Stop), Window ▸
  Statistics panel (`#stats-panel`, renderer.info draw calls/tris + fps).

### Planned milestones (move each to "completed" as it lands)

- (none — see next actions below for the next candidates)

### Known limitations (do not claim otherwise in README)

- No real C# scripting; the two built-in behaviours are simulated.
- No lighting bake, no UI toolkit, no asset import, no build pipeline.
- Physics is AABB only (no rotation-aware collisions).

### Next 3 actions for the next AI

1. Hierarchy: real parent/child nesting (drag to reparent) — currently flat
   (Create Empty Parent is still partial).
2. Play-mode physics: horizontal collision (walls) — currently vertical
   ground collision only; and a visible spawn-marker object type.
3. Project window: prefab rename/delete + scene delete buttons (data is in
   `ed.prefabs` / `unitycraft-scenes`).

## RobloxCraft — status

Files: `robloxcraft/index.html` (single file, ~1185 lines). Key globals: `state`
(player state), `world` (colliders/coins/hazards/spinners/checkpoints),
`buildWorld/buildLevel`, `stepPhysics/stepGameplay`, `addPart/addCoin`,
`people` (leaderboard), `window.robloxcraft` QA handle.

### Working (verified in browser QA)

- Launcher (hero + experience cards), loading screen, baseplate world with
  stud-textured ground, R6 blocky avatar with face + nametag, third-person
  camera (drag look, wheel zoom), WASD + jump with buffered input, AABB physics
  on colliders, coins, hazards (damage + invincibility + respawn), spinners,
  chat (with XSS-safe rendering), People leaderboard, Esc menu (volume,
  sensitivity, screenshot, leave flow), damage vignette, procedural audio,
  fixed-timestep physics loop with anti-throttling, adaptive quality drop.

### Milestones completed in this upgrade

- (commit 1) Baseline: this ledger created; no app changes yet.
- (commit 4) RobloxCraft pass 1: avatar editor (launcher Avatar tab:
  15 skin/shirt/pants swatches + 4 faces with live preview, persisted in
  `robloxcraft-avatar`, applied to the R6 rig + face texture), gear shop
  (Esc menu Shop section: Speed Coil 10 / Gravity Coil 15 / Fusion Coil 25
  coins — `GEAR`, `buyGear`), wallet persistence (`robloxcraft-save`;
  coins survive sessions and world rebuilds), backpack panel (topbar
  inventory button + number keys 1-9 equip, `updateBackpackUI`), gear
  effects in physics (x1.6 walk / x1.35 jump), equipped coil shown in
  hand (`updateGearVisual`).
- (commit 5) RobloxCraft pass 2: obby checkpoints (5 glowing pads,
  `addCheckpoint` — respawn at last checkpoint, best stage persisted in
  `WALLET.best.obby`), Neon City Showcase world now playable (night sky
  `applySky`, ~40 emissive-window towers + neon signs + street lamps,
  2 moving platforms that carry the player `addMover`, rooftop/street
  coins, hazard barriers), chat commands (`/help` expanded, `/respawn`,
  `/reset`, `/stage`, `/e wave|dance` arm animations), friends panel in
  the launcher (simulated, Join buttons enter experiences). buildWorld
  now delegates to buildLevel (was a stale duplicate that ignored
  showcase).
- (none — see next actions below for the next candidates)

### Known limitations (do not claim otherwise in README)

- Single player only; other "players" in chat/leaderboard are simulated.
- No real Roblox compatibility (no .rbxl, no replication, no Luau).

### Next 3 actions for the next AI

1. Mobile touch controls (virtual joystick + jump button) — currently desktop
   keyboard only at usable fidelity.
2. Settings: persist volume/sensitivity (currently reset per session).
3. Obby: checkpoints are position-teleport based — add visual stage
   banners + a finish-line objective (coin gate) at the top.

## Verification log (append per push)

- 2026-10-20 commit 1: `npm test` 64 pass; TODO baseline only, no app changes.
- 2026-10-20 airplanecraft push: owner's flight-sim HTML added as
  `airplanecraft/index.html` (title/menu rebrand only), README + landing
  registration. QA: main menu → Sandbox starts, plane on runway with HUD,
  0 console errors. `npm test` 64 pass.
- 2026-10-20 commit 2 (unitycraft pass 1): `node qa/reconstructions-qa.mjs`
  24/24 PASS (incl. new: snap default/toggle, 5 primitives, hierarchy
  search, save/reload keeps metalness+emissive, console filters+clear,
  play-mode restore). `npm test` 64 pass. One bug found & fixed during QA:
  snapping was not initialized on editor open (applySnap now called in
  bindToolbar).
- 2026-10-20 commit 3 (unitycraft pass 2): `node qa/reconstructions-qa.mjs`
  32/32 PASS (prefab create+instantiate, save-as+reopen from Project window,
  PlayerController gravity/jump/WASD/restore, statistics window). `npm
  test` 64 pass. QA harness note: headless rAF throttling on background
  pages can fake physics failures — always bringToFront / close stale
  contexts (the QA script launches its own browser, unaffected).
- 2026-10-20 commit 4 (robloxcraft pass 1): `node qa/reconstructions-qa.mjs`
  41/41 PASS (avatar editor + persistence, wallet seed/load, shop buy,
  key-equip, live speed 25.6 with coil, backpack). `npm test` 64 pass.
  Measurement note: displacement-based speed checks are noisy (page timer
  jitter) — the QA handle exposes `state.speed` (live velocity) for exact
  checks.
- 2026-10-20 commit 5 (robloxcraft pass 2): `node qa/reconstructions-qa.mjs`
  51/51 PASS (friends join, Neon City 100+ meshes, chat commands, obby
  checkpoints 1→2, best persistence, checkpoint respawn, /reset). `npm
  test` 64 pass. Bugs found & fixed during QA: city loop missing braces
  (only 7 of 40 towers spawned) and buildWorld carrying a stale inline
  level copy (showcase entered with the baseplate layout).
