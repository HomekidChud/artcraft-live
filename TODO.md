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

- No real C# scripting; the three built-in behaviours (Spin, Bob,
  PlayerController) are simulated.
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
- 2026-10-20 commit 6 (repair pass, from a review audit): backpack no
  longer overlaps the People panel (starts hidden, mutually exclusive,
  reset on join); avatar (colors/face) now rebuilds the rig on every
  experience entry; wallet coins sync before the board renders; the
  UnityCraft in-memory storage fallback is per-key (prefabs/scenes/
  quick-save no longer collide when localStorage is blocked);
  `escAttr` now really HTML-escapes (was an identity map); the Game-view
  follow camera keeps a FIXED yaw so strafing is a straight line (was a
  basis feedback loop); speed verified step-exact (dist/steps = 25.6/60
  with coil, 16/60 base); platform carrying and emote arm animation now
  covered by QA. 59/59 PASS, exit 0. Stale doc claims corrected
  (UnityCraft script count, RobloxCraft tools row, AirplaneCraft
  authorship wording).
- 2026-10-20 commit 5 (robloxcraft pass 2): `node qa/reconstructions-qa.mjs`
  51/51 PASS (friends join, Neon City 100+ meshes, chat commands, obby
  checkpoints 1→2, best persistence, checkpoint respawn, /reset). `npm
  test` 64 pass. Bugs found & fixed during QA: buildWorld carried a stale
  inline level copy (showcase entered with the baseplate layout —
  mesh-count check caught it).

## RobloxCraft v2 upgrade — active task (2026-10-20)

User request: go big on RobloxCraft — services, rig/character visual
upgrade, avatar-creation upgrade, marketplace, and a custom Inspect
Element (Ctrl+Shift+I) for ALL apps. Advisor plan: 6 milestones, each
QA'd + pushed.

### Milestones

- [x] M1 (this commit): rig factory + character upgrade — `createRig()`
  reusable factory (gameplay + future preview, returns
  {root,parts,nametag,dispose()}, does NOT touch globals;
  `buildPlayerRig()` adapter sets them). RoundedBoxGeometry limbs/head
  (three/addons importmap), 256px face texture with highlights/brows
  and 6 expressions (smile/cool/happy/wink/skeptical/mad — editor UI
  for the 2 new ones comes in M2), per-limb colors via `AVATAR.limbs`
  (`limbColor()`), ACES filmic tone mapping, damped walk cycle with
  speed-driven phase (`state.walkPhase`, `_swingAmp` blend), idle
  breathing bob + walk bob + head counter-sway. QA: 59/59 still green,
  armRX damps -0.66 (walk) → 0 (idle), front-view screenshot verified.
- [x] M2 (this commit): avatar editor upgrade — live 3D rotating
  preview (own WebGLRenderer + scene, own rig instance via createRig,
  drag to rotate, only renders while avatar view active, old rig
  disposed on every change), per-limb color rows (armL/armR/legL/legR
  via AVATAR.limbs), hats (Top Hat / Cap / Halo / Headphones meshes,
  attached to head, saved as AVATAR.hat), 6 faces (added skeptical +
  mad to texture + 2D preview), old saves migrate automatically
  (missing limbs/hat fall back to skin/pants/null). QA: 62 checks
  (added 3D canvas, limb rows, hat row, limb+hat persistence); fixed
  QA runner focus bug (blocked-storage section left bp in front —
  its context was closed but main-page focus was never restored —
  throttling the main page's rAF and causing physics false-failures;
  an explicit bringToFront after that section fixed the rerun).
- [x] M2.5 (this commit, advisor corrective review): createRig threads
  the avatar explicitly (makeFaceTexture(avatar), local limb color
  resolution — no global AVATAR swap; two differently-configured rigs
  coexist); buildPlayerRig attaches the dispose handle consistently
  (initial rig no longer leaks on first rebuild; rebuildPlayerRig()
  used for every rebuild); top-hat brim now rests ON the head (was
  inside it), cap raised; preview camera frames the full bounding
  box (feet were clipped), verified at desktop + 375px; preview truly
  lazy (renderer created on first avatar-tab open, loop also gates on
  document.hidden). QA +2 behavioral checks (old-format save ->
  default limbs/no hat; new-format save -> limb colors + hat on the
  actual gameplay rig), 64 total.
- [x] M3 (this commit): marketplace — new Market tab (nav: Discover /
  Avatar / Market / Friends) with hats (6) / faces (7) / gear (3)
  cards, canvas icons, coins display. ONE wallet/ownership model:
  namespaced ids (hat:crown, face:stars) in the existing
  robloxcraft-save owned[] array; free items (all previously released
  hats/faces/colors + legacy gear ids) stay free/owned-by-default —
  nothing existing was invalidated. New premium items: Crown (40),
  Propeller Cap (50, animated), Star Eyes face (35). Single
  buyItem() purchase path (funds check, debit, persist, refresh ALL
  views); buyGear() syncs live gameplay coins then routes through it;
  equipCosmetic() writes hats/faces into the avatar save; buying a
  cosmetic auto-equips. Backpack, bp-count and number-key equip now
  filter owned[] to GEAR only (was raw-indexed — would have broken
  with cosmetics in owned[]). Wallet hydrated at boot before any
  view renders; market purchases work from the launcher BEFORE ever
  entering an experience. QA +4 checks (catalog render, launcher
  purchase debit+own+equip, insufficient funds + no repeat debit,
  reload persistence), 68 total; disabled buy button contrast fixed.
- [x] M4 (this commit): services explorer — Esc menu > Services
  opens a tabbed panel with WORKING local services (labeled "local
  browser services — nothing leaves your machine"): Workspace
  (scene object counts by type, select player/deselect with live
  BoxHelper highlight + position readout), Players (local player
  card: position/health/coins/gear/hat/face + simulated players),
  Lighting (live sliders: ambient, sun intensity, sun direction,
  fog near/far + Day/Sunset/Night/World-default presets), Simulation
  (Pause/Resume integrated into the fixed-step loop, Step-once,
  steps counter, status), Persistence (localStorage keys with sizes,
  export saves as JSON download, reset avatar/wallet). Opens from
  the Esc menu; Escape closes; movement keys cleared on open.
  worldLights refs stored by buildWorld. QA +8 checks (open, workspace
  list, player selection, lighting slider + night preset, pause
  freeze, step-once, esc close), 76 total. QA runner hardening: the
  platform-carry check is now oscillation-phase independent (tracks
  player-to-mover distance instead of raw x spread — random teleport
  phase used to flake it); the pause check snapshots steps after the
  pause engages (a jammed main thread can run a physics catch-up
  burst before the click handler).
- [x] M5 (this commit): shared inspector core — new
  inspector/inspector.js (self-contained classic script, shadow-DOM
  panel, no deps). Elements tab: lazily expandable DOM tree (starts
  html/head/body expanded), hover highlight + pick mode (click to
  select, auto-switches to Elements), box-model highlight overlay
  (margin/border/padding/content), breadcrumbs, live updates
  (MutationObserver), editable inline style declarations, matched
  stylesheet rules (cross-origin sheets labeled, never faked),
  searchable computed props, box model, editable attributes + text
  nodes. Console tab: captured log/warn/error/rejection history +
  command eval (safe text rendering). Network tab: only actually
  observed fetch/XHR, honestly labeled (a page cannot read the
  browser network stack). Ctrl+Shift+I best-effort (some browsers
  reserve it) + floating button fallback; Escape closes ONLY the
  inspector (stopPropagation so the game menu does not open); typing
  in the panel is key-isolated (events cut at the host boundary);
  focus restored on close; ArtCraftInspector.onOpen lets apps clear
  held keys (robloxcraft does). RobloxCraft loads it via script
  tag. GAME FIX: moving-platform carry now tests within-bounds against
  the platform's start-of-step position — a long frame gap used to
  move the platform > the carry tolerance in one step and drop the
  player. QA +8 checks (84 total), runner hardened (atomic
  mover teleport, live-wait for speed reading).
- [ ] M6: all-app integration
- [ ] M4: services explorer — in-experience panel with WORKING local
  services: Workspace (scene objects), Players (local player),
  Lighting (live controls), Simulation (pause/step the fixed-step
  loop), Persistence (local save management, labeled local-only).
- [ ] M5: shared inspector core — `inspector/inspector.js`, Elements
  panel (DOM tree, picking, highlight, editable styles, computed,
  box model) + Console (JS eval). Input isolation: swallow keys while
  open, clear movement keys, exclude own DOM.
- [x] M6 (this commit): all-app integration — inspector everywhere:
  direct script tags in the root hub, unitycraft, robloxcraft and
  airplanecraft (single tag; owner-supplied code untouched); catalog
  crafts + launcher get it injected by assistant/widget.js (DOM
  contract preserved — npm test 64/64 + python suite OK; assistant
  sw.js cache bumped v12 -> v13); planecraft covered via its existing
  widget tag. QA: inspector-present checks on hub, launcher, figcraft,
  wordcraft, unitycraft, planecraft, airplanecraft + hub open/close
  smoke — 92 checks total. README gained an honest Page inspector
  section (limits disclosed). Visual check: inspector coexists with
  the figcraft editor + chat widget.

### v2 upgrade COMPLETE (M1-M6, commits 8441bf0..41e62b7)

Next 3 actions for the next AI:
1. Run `npm test`, `python3 -m unittest discover -s assistant/tests
   -p 'test_*.py'`, `node qa/reconstructions-qa.mjs` (92 checks) —
   all must be green before any further push.
2. RobloxCraft v2 candidates: emotes wheel (3D keyframe poses), NPC
   friends that walk the world, per-experience leaderboards, obby
   stage 2 (new geometry), more marketplace items (color packs,
   trails). Keep every milestone QA'd + pushed + TODO updated.
3. Inspector candidates: sourcemap-less stack traces in Console,
   localStorage editor pane, element screenshots, performance panel
   (long-task observer). Keep the honesty notes — no browser-level
   network/debugging claims.

### Notes / constraints

- Entry index.html files of catalog crafts are GENERATED — never edit;
  the assistant widget is the sanctioned injection point for them
  (bump sw.js cache when it changes). Editable: unitycraft,
  robloxcraft, planecraft, airplanecraft (owner sanctioned inspector
  for all).
- "1:1 DevTools copy" boundary: in-page inspector can do Elements/
  Styles/Console faithfully; browser-level network/debugging and
  cross-origin stylesheet access have real limits — disclose in README,
  don't ship dead tabs.
- AirplaneCraft code stays untouched apart from the inspector script
  tag (owner sanctioned).

## AirplaneCraft — v17.10 upgrade (2026-10-22)

Owner-directed upgrade from the v17.2 snapshot to the owner-supplied
`Flight-World-17.10.html`, plus code changes requested in the same session.
`npm test` passes (64/64) and headless-browser QA was run before pushing.

- Build mode UI: one coherent editor theme (patch `fwBuildUiV2` style block at the
  end of the module script) replacing the stacked lime/graphite/cream skins;
  steps bar is now Starters · Build · Notebook · Advanced; the auto-opening
  "Quick build lesson" tour no longer auto-shows (button only).
- Build checklist → **Build Notebook**: small collapsible bottom-left widget with
  live checkboxes (structure, power source, power wiring, ground return, lights,
  fuel plumbing, hydraulics). Advisory only — Test Flight is always available.
- Wiring realism: added `fuel` and `water` wire kinds (plus existing hydraulic);
  new parts `fuelPump`, `fuelStrainer`, `strobeLight`, `beaconLight`,
  `landingLight`; snapshot validation accepts the new kinds; starter templates
  are wired ground-up (battery → bus → CB → loads, ground return, tank →
  strainer → pump → engine, twin gets a hydraulic loop).
- Lights: `shape:'light'` parts are now fixtures (housing + lens + real
  THREE.PointLight, strobe/beacon animated); flight clones carry the lights;
  `setAircraftLights` toggles them; Electrics gates them on power.
- Presets: cloud "Publish build as preset" stores a `flightworld-build` document
  (the workshop snapshot itself — nothing hard-coded); loading restores it as an
  editable build. Legacy `flightworld-preset` fleet docs still load.
- Server: `server/` (zero-dep Node) implements `/api/builds` + `/api/health`
  (GET/POST/DELETE, CORS, 2 MB/500-doc caps, JSON-file storage, MongoDB via
  MONGODB_URI later). Deployed on Render; the client ships that URL as its
  default cloud server.

## AirplaneCraft — 17.10.2 session (2026-10-22, later same day)

Continuation of the outstanding-work brief. Committed on top of the above
(heads `b3c2e4b`..`b901d85` in order). Everything below was verified in-session;
items marked PENDING were not done and are the next AI's queue.

### Completed this session (verified)

- **Cleanup:** removed the injected `data-pplx-inline-edit` script block
  (lines 10412–10852 of the old file); title/version labels aligned to
  `17.10.1` (static title, runtime title, debug-export version). Both inline
  scripts parse (`node --check` on extracted module code).
- **Server hardening** (`server/index.js`, rewritten but same contract):
  server-side validation mirroring the client's `validateDesign` (part IDs,
  positions, scales, wire kinds/endpoints, group membership, both preset
  envelopes), per-IP token-bucket rate limiting on writes/deletes
  (`RATE_LIMIT`/`RATE_WINDOW_MS`), CORS restricted by default to the game
  origin + local dev ports (`CORS_ORIGINS` env, `*` to reopen), optional
  `API_KEY` write protection, `render.yaml` (rootDir server, health check),
  README rewrite, and a `node --test` suite (7 tests: validation parity,
  CRUD, CORS, rate limit, save→reload e2e round-trip, seed) — all passing.
- **Research docs** (all with citations):
  - `docs/systems-research.md` — fuel (GA high/low wing, airliner
    transfer/crossfeed), hydraulics (reservoir above pump, independent
    systems), electrical, lights conventions; mapped to concrete sim rules
    and an audit checklist.
  - `docs/build-ui-research.md` — Roblox Studio / KSP VAB / Space Engineers /
    Trailmakers / Aviassembly survey and the one-design-system plan.
  - `docs/game-engine-research.md` — Unity DOTS/SRP, Unreal modules, Godot
    scene-tree, Rapier determinism; mapped to a 5-step upgrade roadmap.
- **Ground-up workshop presets:** `tools/seed-presets/generate.mjs` builds a
  real workshop design (catalog parts + routed wires + named groups incl.
  Cockpit hierarchy + research-consistent light fixtures) for **all 24
  AIRCRAFT_FLEET entries** (the brief said 28 — the table has 24 at HEAD;
  the other 4 cloud presets are the starter pack). Each design passes the
  same validation rules as `validateDesign`; `--api` POSTs them as
  `kind:'preset'` (verified against a local server: 4 starters + 24 fleet
  docs). `--out` writes `airplanecraft/presets-fleet.json` (committed) as
  the offline fallback pack.
- **Offline preset loading:** Cloud panel gained a "Fleet presets (local)"
  button that fetches `presets-fleet.json` and loads any preset through the
  same path as a user build (validateDesign → workshopRestoreSnapshot).
  Works with no server at all (GitHub Pages serves the pack).
- **Systems routing audit:** new `workshopSystemsAudit()` in the client:
  fuel path tank → strainer → (pump when tanks sit below the engine) →
  engine; fuel lines must not cross the cockpit bounding volume; hydraulic
  actuators must be reachable from a pump through a reservoir; nav light
  colours (port red / stbd green / aft white). Wired into Test Fly (blocks
  on errors) and the Engineering panel (new SYSTEMS ROUTING section).

### PENDING — next AI queue (in priority order)

1. **Preset parity + fleet-path removal.** The procedural fleet path
   (`buildFleetAircraft`, `AIRCRAFT_FLEET` models) is STILL the default in
   the main menu. The workshop presets exist and load, but visual/perf
   parity has NOT been demonstrated (no Test Fly of the generated designs
   in a browser, no side-by-side). Do that first: load each local preset,
   Test Fly it, compare mass/stall/looks with the procedural twin. Only
   then switch the menu to prefer workshop presets and delete the
   procedural path. Also: the generated presets use generic part scaling —
   they will need per-class tuning (engine placement, wing chord, tail
   moment) before they fly like the fleet.
2. **Lights, further.** Fixture models exist for workshop builds but the
   remaining fleet-model lamps are still spheres; landing/taxi ground
   illumination at night is not verified. Convert fleet models to the same
   fixture parts (can come free once item 1 lands).
3. **Build Mode UI overhaul.** The six CSS skins are still stacked (the
   17.10.1 patch added a v2 block; the old skins remain). Follow
   `docs/build-ui-research.md`: ONE token-based design system, ribbon,
   Toolbox with search + drag ghost preview, floating transform toolbar,
   view cube, snap controls, Explorer drag-reparent/eye/lock/rename/
   multi-select, keyboard overlay, context menu, undo/redo history list,
   empty states, responsive 44px targets, SVG icon set (no emoji).
4. **Routed wires that follow structure.** Wires are still straight
   part-to-part lines. Encode spars/longerons/belly paths as polylines
   (see systems-research.md §6 rules 1–3, 5) so the cockpit-clearance check
   can use real geometry instead of the straight-segment approximation now
   in `workshopSystemsAudit`.
5. **Server deploy follow-through.** `render.yaml` + README are ready; the
   live Render service still needs the new code pushed and `CORS_ORIGINS`
  / `MONGODB_URI` set in the dashboard. Add a CI step (`npm --prefix server
   test`) to the repo workflow if one is added.
6. **Deterministic regression harness.** Rapier is locally deterministic —
  build a fixed-timestep headless QA (extend `qa/reconstructions-qa.mjs`
   pattern) asserting flight state + damage cells for a scripted crash and
   a scripted landing, plus a workshop flow (open → add part → group →
   Test Fly → cloud save against a local server).

### Session regression results

- `node --check` on both inline scripts: PASS after every edit.
- Server tests: 7/7 PASS (validation parity, CRUD, CORS, rate limit, e2e
  save→reload, seed presets).
- Seed e2e: local server + `--api`: 24/24 fleet presets accepted, list shows
  28 presets.
- Browser regression (cloud browser against the live GitHub Pages deploy,
  commit 3ba70db): landing menu loads; Sandbox flight mode runs (c172,
  unpaused); Build Mode opens (ribbon, notebook, starters, toolbox,
  explorer); Cloud panel loads; "Fleet presets (local)" fetches the offline
  pack (24 rows); loading the 747-8 preset restores it as an editable
  build named correctly with 47 parts / 60 wires; ELECTRICAL audit passes
  ("All circuits valid — test flight approved"); SYSTEMS ROUTING panel
  renders ("✓ Routing follows real aircraft practice"); Test Fly passes the
  gates and enters flight mode with the scratch-build; engines spool to
  full RPM with throttle 100.
- NOT verified: actual takeoff roll / flight / crash-damage in the browser
  — speed stayed 0 kt even for the built-in trainer starter under the same
  automated steps (throttle 100, engines ON, brakes off, master on), so
  this looks like an environment limitation of the headless cloud browser
  (synthetic-input physics gate), not a preset defect. The deterministic
  harness (item 6 below) must settle it. Mobile layout also not checked.
- CDN note: GitHub Pages caches `presets-fleet.json` per-URL (~10 min); the
  client fetches it with `?v=17.10.2` + `cache:'no-store'` — bump the
  version query whenever the pack is regenerated.

### Post-test fixes (already committed)

- Local preset list: the log no longer replaces the Load rows.
- Preset wiring: jet FADEC loads wired to the main power circuit with
  ground returns; fuel chain wired tank → strainer → pump → engine.
- Preset gear: wheels hang below the belly line so builds rest on wheels
  (visual check pending the flight-verification item above).

## AirplaneCraft — 17.10.3 additions (same day, owner follow-up)

Owner follow-up: "upgrade the unity a lot also continue, and the cockpit
/cabin should not be a single part — it must be a group of many parts that
are grouped".

- **Cockpit/cabin is now a group of many parts** in every generated preset:
  skin-panel floor, port/starboard walls, roof, rear bulkhead, glazing,
  two seats, instrument panel, flight computer, servo and receiver — all
  under the named "Cockpit" group (12 parts on the C172). No cabinBlock.
- **Ground-stick root causes found and fixed in the generator:** the earlier
  zero-speed was my own test error (mixture set to 1% — withdrawn the
  environment claim); the REAL preset blockers were (a) propeller disks
  and scaled jet nacelles dipping below the ground plane (now lifted:
  engine y = max(wing offset, prop radius + margin / nacelle clearance))
  and (b) thrust scale (jet nacelles now scale with aircraft class since
  the flight model scales jet thrust with nacelle x·y scale — 747 gets
  ~234 kN per engine, T/W ≈ 0.24).
- **Gascolator moved to the belly** (under the cabin floor, aft of the
  cockpit) per real GA practice — fuel lines no longer cross the crewed
  zone.
- Fleet label in the landing menu is now computed from the real fleet
  table (was a stale hard-coded "28").

## AirplaneCraft — 17.10.4 (preset pack v4: flight-time connectivity)

- **CRITICAL discovery — the flight-time structural rule:** at Test Fly the
  client REPLACES `markDetachedFlightParts` (search the second definition, ~line
  10089) with a stricter version using `physicalPartsTouch` = RAPIER convex-hull
  contact within 25 mm — NOT bounding-box overlap. Any part that fails it gets
  `flightDetached`, breaks off at flight start (`detachUnweldedParts`), and is
  REMOVED from the aero model — thrust/mass/wings are then recomputed WITHOUT it
  (`refreshCustomFlightStats`), so a lost prop/strainer reads as "thrust 0 N".
  This is what zeroed every earlier preset roll test (the flight log line
  "5 unwelded part(s) broke off and fell away · Airframe now 433 kg · thrust 0 N"
  was the smoking gun). Symptom: RPM shows full, speed stays exactly 0.00.
- **Generator now self-verifies contact** for all 24 designs: every part's raw
  catalog-size box must overlap another part's box. This is a PRELIMINARY,
  conservative approximation — necessary but NOT sufficient (box overlap does
  not strictly guarantee 25 mm convex-hull contact on tapered geometry like
  cones; the runtime pipeline is the final arbiter). Build fails with
  `[aircraft name]` + the floating part list. Also self-verifies the
  fuel-routing cockpit-clearance rule (mirrors `workshopSystemsAudit`).
- **Layout fixes so every part touches structure:** prop hub now overlaps the
  engine face (z +0.38, was +0.55 — the old prop was 1 cm short of contact);
  fuel strainer embedded low INSIDE the aft fuselage block; boost pump embedded
  low inside the forward fuselage (fuel line runs under the floor and climbs
  ahead of the firewall — audit-clean AND contact-safe); landing lights embedded
  in the wing-root region of the fuselage (the old wing-root gap never touched
  the wing or the fuselage); gear actuators pulled inboard (±W·0.35, was ±W·0.8
  which sat outside the hull); rudder flush with the fin (−L·0.4); top beacon
  dropped to H·0.8 (the tail cone's hull only spans y 0.1H–0.9H — the beacon at
  0.98H floated in the gap); cockpit height clamped so the roof stays INSIDE the
  fuselage (F-16's bubble-cabin roof used to poke out the top).
- **Delta designs (Concorde):** tanks, engines, nav/strobe lights now carried on
  the delta slab itself (y = H·0.42) instead of the low-wing height, where they
  floated in space under the slab. Concorde now correctly gets JET engines
  (its fleet engineType is `supersonic`, which the old `=== 'jet'` check missed).
- **Multi-engine layout:** engine pairs at ±half·(0.45 + rank·0.25), z = 0.9
  (jets) / 0.6 (pistons) so nacelles overlap the wing slab — engines at L·0.18
  on long aircraft floated ahead of the wing's z-extent.
- **Pack cache-bust bumped to `?v=17.10.4`** (the CDN caches per-URL ~10 min;
  bump this EVERY time the pack is regenerated, or the browser keeps serving the
  old pack and you will chase ghost bugs).
- Preset test procedure (validated): build mode → Cloud panel → Local pack →
  load preset → **CLOSE the Cloud panel** (a Test Fly click under the open
  modal is swallowed — the sim stays paused in build mode and speed reads 0 —
  this invalidated several earlier test runs) → Test Fly → verify
  `buildModeOverlay.hidden === true` → throttle 100 + Engines ON via input
  events (throttle/mixture are 0–100 scales) → wait ~10 s of REAL time → read
  `JSON.parse(window.render_game_to_text()).speedKts`. Debug handles:
  `window.__flightWorld` exposes `state`, `systems`, `plane`, `tick`,
  `workshop.propulsion()` (the workshop scene is NOT reachable via
  `workshop.camera().parent` — that returned null; reach parts via
  `workshop.create()` + `.parent.traverse`). The flight log (`flightLog` list)
  reports breakaways + recomputed thrust — read it FIRST when a preset won't
  move. NOTE: `flightLog` history persists across page reloads (localStorage),
  so old "Ready: …" lines from a previous preset can appear — judge by the
  physics state (thrust/speed), not the log alone.
- Runtime verification so far: C172 (single piston, high wing) — rolled,
  rotated, 126 kt at 421 m; 747 (4-engine jet) — rolling at 164 kt with
  936 kN total thrust; both with zero breakaways. The other 22 designs pass
  the generator checks but are NOT individually flight-tested — next AI
  should runtime-verify a small twin piston, the Concorde (delta + tapered
  cones — riskiest for hull contact) and a glider before declaring the pack
  fully flight-verified.

## UnityCraft — pass 3 (owner follow-up)

- **Nested hierarchy with drag-to-reparent:** children keyed by parentId,
  depth-first render with indents and collapsible carets; dropping a row
  on another makes it a child (cycle-safe), dropping on the empty area
  unpairs to root; deleting a parent re-homes its children to the
  grandparent; nesting survives save/load and play-mode snapshots;
  pasted copies and prefab instances always start at the root.
- **Horizontal play-mode collision:** axis-separated AABB blocking with
  slide-along-walls and a 0.3 m step allowance (walk onto ledges, blocked
  by walls) — previously vertical ground collision only.
- **Spawn Point object type** (GameObject menu): editor-only ring + cone
  marker, never a collider; entering Play teleports the PlayerController
  to it.
- **Project window management:** scene delete, prefab delete and rename
  (with confirm dialogs), synced to the unitycraft-scenes/prefabs keys.
- Next candidates: real local transforms (children move with parents —
  nesting is currently logical only), rotation-aware collisions, prefab
  variant overrides.

### Constraints that still stand

- Atoms/air molecules never visible. Damage cells stay clipped original
  geometry. No hard-coded preset geometry once the build-from-parts path is
  live (it is live — the generator is the only allowed source of preset
  geometry, driven by the fleet table). Cite research for every routing rule.

## Waypoint editor + persistence (second follow-up session)

Done and live-verified (GitHub Pages, ?debug):
- Waypoint editor UI: wires are clickable in the 3D view (part-hit takes priority; clicking a wire selects it), the 'Wire routing' inspector panel shows kind / from→to / waypoint rows with numeric X-Y-Z inputs, '＋ Waypoint' inserts the snapped midpoint, 'Clear routing' reverts to a straight run, 'Delete wire' removes it. Escape deselects. Selecting a part clears the wire selection and vice versa; restoreSnapshot clears it so a stale index can't point at another wire.
- Live-verified on the deployed build: wire selected by real viewport click ("Alternator → Main bus · 3 waypoints" in the panel), Add Waypoint 3→4, undo reverted 4→3 and hid the panel (as designed).
- Autosave actually persists: fwPreviewStore was a pure in-memory Map, so "SAVED ON THIS DEVICE" was false — the saved 747 preset came back EMPTY after reload. Now localStorage with in-memory fallback. Live-verified end-to-end: load preset → localStorage written → full page reload → reopen Build Mode → design restored with all 60 wires / 15 routed / name "Boeing 747-8".
- Wire pick threshold and waypoint handle size now scale with camera distance (~4-5 px of screen at any zoom); wheel zoom rebuilds handles. Found live: at the auto-framed zoom (camera ~980 m out) the fixed 0.35 m threshold was sub-pixel and wires were unpickable. NOTE: this last change was NOT yet on Pages at verification time — verified by the committed unit tests only; re-check live.

Known issue (pre-existing, cosmetic): the cloud browser showed the "Frame" toolbar button label truncated ("Fra"); sidebar clipped; test-fit sample of mobile layout was not rechecked this session.

## Waypoint wire routing (this session)
Scope note: this is a routing/schema milestone, NOT a full editor affordance — wires with waypoints are rendered, audited, validated and persisted, but there is no UI yet to drag a waypoint; selection/editing of wires is unchanged from before.
Done:
- Wire schema now supports optional per-wire `waypoints` (max 8, ±500 m, x/y/z) — accepted by client `validateDesign`, mirrored server-side in `server/index.js` with round-trip + rejection tests (`server/test/server.test.js`).
- `workshopWirePath()` (client) resolves a wire's polyline (part endpoints + waypoints); `workshopRebuildWires()` renders it as straight LineSegments. Rendering and audit share the helper so they see the same geometry. NOTE: wire selection/editing in the UI is unchanged from before — waypoints are schema + render + audit, not yet a draggable editor affordance.
- `workshopSystemsAudit()` fuel-through-cockpit rule now checks the real polyline segment by segment (straight through cabin fails; belly run passes).
- `tools/seed-presets/generate.mjs`: `routedWire()` emits belly-following fuel polylines (90 routed wires across the 24 presets); presets-fleet.json regenerated and re-validated (24/24 pass client validateDesign, waypoints preserved).
- Verified with extracted-function tests: waypoint schema accept/reject, polyline rendering, audit straight-vs-routed, full preset pack through client validateDesign.
- `tools/tests/waypoint-wires.test.js`: 9 committed regression tests against the production functions (extracted verbatim from the client), including save→validate→restore round-trip preserving waypoints and an exact-intersection cockpit-clip case the old 13-point sampler could miss.
- Rendering now matches the audit exactly: workshopRebuildWires renders straight LineSegments through workshopWirePath's resolved points, the same polyline the audit checks segment-by-segment. No spline bow can hide from the audit.
- Waypoints persist through workshopSnapshot and workshopRestoreSnapshot — the restore test EXECUTES the real restore with scene/DOM stubs, asserts waypoints survive and that the restore is a deep copy (undo/redo history cannot be corrupted through aliasing).
- Generator's cockpit-clearance check upgraded to exact slab intersection on the SAME lifted-endpoint polyline the client audit uses — it immediately caught a real violation (Extra 300 straight strainer→pump through the cockpit box) which is now routed under the floor; presets regenerated.
- Committed and pushed (a1d1834 + follow-up fixes).
Live-site verification of THIS turn's changes: BLOCKED — GitHub Pages had not rebuilt more than 4 minutes after the push (served pack still showed 113 routed wires, 0 hydraulic; the new pack is 225 routed / 44 hydraulic). All this turn's changes are verified locally by the committed tests instead. Re-check the live site after Pages rebuilds.

Cloud-browser smoke test (PARTIAL, on GitHub Pages, previous commit): Build Mode opened, 24 local presets listed, Boeing 747-8 loaded as an editable build, Test Fly reached the runway with idle-engine telemetry (4 engines, 650 RPM, READY FOR DEPARTURE). NOT verified: routed-wire visibility in the workshop viewport (screenshot did not establish this), the served commit (GitHub Pages revision not matched to a pushed commit), and broader regression (crash/damage, grouping, cloud save against the Render API, mobile layout). One defect noted: a minimap label was truncated in the flight view. Routed wire count after regeneration: 113 across the 24 presets (was 90 — the Extra 300 strainer→pump line is now routed under the floor, adding more).

Still to do:
- Editor affordance: user-facing way to add/move/remove waypoints on a selected wire in the workshop UI (right now waypoints exist in schema + presets + audit only).
- DONE (follow-up session): routing extended beyond fuel — hydraulic supply AND return lines now follow the wing spar (sparWire), alternator power/ground and hydraulic-pump power/ground feeds follow the belly (routedWire). Presets regenerated: 225 routed wires (fuel 113, power 34, ground 34, hydraulic 44). Client audit's cockpit-clearance rule now covers hydraulic lines as well as fuel (same structure-following rule); committed test covers both. Verified 0 cockpit-box violations across all 24 presets for both kinds, using the exact lifted-endpoint slab geometry the client audit uses.

## AirplaneCraft — 17.10.5 session (2026-10-23): wire physics, water arcing, pressure, glue

Commits: `00603ee` (wire physics), `4c156f1` (glue). Tests: 18 waypoint-wires (3 physics tests — the floor clamp lives inside the sag
test — plus 4 glue tests) + 1 e2e
+ 8 server (27 total for this app; `npm test` at repo root is unrelated tooling).

### Wire physics (real gravity/sag — owner request: "wires has no physics")
- Wires are now **verlet ropes** (`workshopRebuildWireSims` + `workshopStepWirePhysics`,
  hooked into `workshopFrame` at 60 Hz): subdivided ~0.8 m nodes, gravity −9.81,
  damping .985, 6 Gauss-Seidel distance-constraint passes per frame. Endpoints and
  waypoints stay pinned (`workshopWirePinsFor`); free spans sag, swing and settle on
  the floor (y ≥ .03). Rendering = sim points (LineSegments), so what you see is the
  physics. Sims are cached by a wire key; dragging a part moves its rope live.
- **Water-contact arcing:** power/ground wires within 0.5 m of a water line's
  polyline trigger `workshopSparkAt` — 48-particle additive spark burst at the contact
  point (per AC 43.13-1B ch.11 wet-location wiring). Also an audit error rule of the
  same geometry (test: accept separated runs, reject 0.2 m-apart runs).
- **System pressure** (`workshopSystemPressures`): BFS from hydraulic pumps (3000 psi)
  and fuel pumps (30 psi) through their own fluid kind only — networks never cross.
  Shown in the wire inspector route line ("· 3000 psi"). No pressure model in flight
  yet — workshop-only readout for now.

### Glue (owner request: "add glue and stick things")
- **Glue tool** (◌ button next to ⌁): click two components → bond; click a glued pair
  again → unglue; tool switch cancels. Amber strut + blob rendered between bonded
  parts (`workshopRebuildBonds`, own scene root).
- **Drag propagation:** moving a part walks the glue graph (`workshopBondedSet`)
  and shifts every bonded part + its symmetry mirror by the same delta.
- Inspector: Glue section with per-bond × and "Unglue all". Bonds ride
  snapshot/undo/redo/export/import/restore; deleting a part cleans its bonds.
- **Schema:** `bonds: [{from,to}]` validated client-side (max 400, existing parts,
  no self/duplicates) and mirrored in `server/index.js`; validateDesign returns
  normalized `bonds`.
- Flight-time meaning of glue is NOT yet implemented (bonded parts flying as one
  rigid group in the atoms/damage sim is future work; today the weld flag still
  governs flight detachment).

### Advisor-review fixes (same day, follow-up commit)
- **Frame-rate independence:** physics now advances via a fixed-step accumulator
  in `workshopFrame` (1/60 steps driven by elapsed time, catch-up capped at .25 s)
  — no longer one step per rendered frame (120 Hz displays doubled the physics rate).
- **Water-arc audit now measures true segment-to-segment distance** (Ericson
  closest-points, clamped) — the old vertex-only check missed runs that cross
  halfway between distant endpoints; regression test added with crossing wires.
  Spark trigger threshold unified with the audit at 0.5 m.
- **Pressure is kind-keyed** (`pressures[partId] = {hydraulic, fuel}`) — a part on
  both networks keeps separate readings; a fuel wire never displays 3000 psi.
- **Glue drag dedupe:** bonded moves skip parts that already moved (group members,
  synced mirrors) — no more double-delta on grouped+glued parts.
- **Lifecycle:** `workshopClear` resets bonds/glue start; part-placement tool
  clears glue start + button; client schema rejects non-array `bonds`.
- Honesty notes: the 0.5 m threshold is our design choice informed by AC 43.13-1B
  wet-location guidance, NOT a number published by the FAA; pressure values are
  nominal connectivity readings (pump rating propagated through the network), not
  flow/pressure-loss physics; sparks trigger on proximity to water-line geometry,
  which is a proxy — leaked vs intact plumbing is not modelled.

### Remaining (unchanged)
- Fleet path removal (parity unproven), Build Mode UI overhaul (six CSS skins),
  light fixture models for fleet lamps, Unity/game-engine deep research, Render
  deploy verification. Live smoke test of this session's features on Pages is
  still pending (Pages rebuild is slow — use `?debug&fresh=N`).

## AirplaneCraft — 17.10.5b (same day): glue replaces weld + 8 energy forms

Commits: see git log (glue-replaces-weld + EnergyCore). Tests: 23 waypoint-wires
(+5 energy: ballistic conservation, spring→heat, thermal equilibrium/cooling,
battery/fuel-density, full ledger from stubbed live state).

### Glue replaces weld (owner: "remove the weld its useless when we got glue")
- Weld/Unweld buttons removed from both inspector UIs (advanced + simple builder);
  replaced with a glue hint. The `unwelded` flag stays in the schema for imported
  files but has no UI.
- `markDetachedFlightParts` now unions glue-bonded parts — glued parts fly with the
  aircraft even across empty space; anything not touching structure and not glued
  breaks off at flight start (wording: "unattached part(s) broke off").
- `workshopClear` resets glue state.

### Energy physics (owner: "all the 7 or 8 physics")
- `EnergyCore` pure functions: kinetic, gravitational, spring (½kx²), damper heat
  (c·v²·dt), thermal step (heat in − Newton cooling), battery, fuel (43.02 MJ/kg
  Jet-A), radiant output. Cited in docs/systems-research.md §9.
- Wire ropes upgraded from hard constraints to **tension-only spring–damper** dynamics
  (6 substeps/frame, explicit stiffness per wire kind, stability k·h²/m < 1):
  real stretch stores elastic energy, damping dissipates as heat, each wire carries
  a temperature (thermal mass + cooling) shown live in the wire inspector with a
  ⚠ INSULATION warning above 80°C (PVC 70–105°C).
- Flight HUD: new **Energy** readout — KE, PE, chemical fuel from live state
  (mass incl. fuel, physicsVelocity, altitude, fuel kg), electrical draw, light
  output. `window.__flightWorld.workshop.energy()` exposes the ledger.
- Honest limits: sound deliberately not modelled; light efficiency is a labelled
  estimate; thermal is wire-level only (no engine/airframe heat yet); flight-time
  wires are static clones (spring/thermal live in the workshop only).

## AirplaneCraft — 17.10.5c (same day): flight ropes + re-entry flame

- **Flight wires are ropes now** (owner: "flying wires that disobey gravity"):
  custom aircraft get real rope sims in the airframe frame (`fwBuildFlightWireSims`
  at Test Fly replaces the static wire clones with LineSegments ropes). They feel
  APPARENT gravity (g − a_plane, rotated into the plane frame): sag in level
  flight, float in free-fall/pushover, slam down in pull-ups. Overstretch past
  the 8% elastic limit SNAPS the wire → spark, hidden line, Electrics fault.
- **Re-entry flame** (owner: "descending fast flame should come"): skin
  temperature follows isentropic stagnation heat T·(1+0.2M²) with ~8 s thermal
  lag; above 80°C skin an additive flame cone trails opposite the velocity,
  brightening to white-hot by ~480°C. SKIN °C shown in the HUD energy line.
  Game-scaled glow threshold (real dull-red glow needs ~500°C) — labelled as
  such in docs §9.
- Tests: 25 waypoint-wires (+2: apparent-gravity sag/float/pushover/snap with a
  hand-built rope, stagnation formula). The snap test caught a real test bug
  (first-step acceleration spike) — production code was correct.

## AirplaneCraft — 17.10.5d (same day): glue joints carry load + flight wire heat

Owner follow-up: glued groups should be able to fall apart ("never fall apart"),
and the physics should keep advancing. Two additions, both tested.

### ROOT-CAUSE FIX: flight ropes had springs on the FIRST segment only
- Found during review: the flight rope builder pushed ONE rest length per span
  (`rests.push(span/(k+1))`) while the step indexes `sim.rests[j]` per SEGMENT —
  so on every built wire, all segments past the first had `rests[j]` undefined →
  NaN stretch → NO spring force and NO snap check. Result: rope nodes past
  segment 1 free-fell — very plausibly the owner's original "wires that
  disobey the laws of gravity" bug. Builder now emits per-SEGMENT rests
  (`rests.length === pts.length-1`), verified by a builder integration test.
- Settle guard added: a freshly built rope starts perfectly straight; its
  gravity-sag transient could exceed the 8% elastic limit and snap it
  (`FW_WIRE_SETTLE_FRAMES=30`). Snap checks run only after the settle window;
  a genuinely overstretched rope (pinned 4 m apart, 2 m of rest) still snaps.

### Glue joint strength (flight-time load test)
- `FW_GLUE_BOND_STRENGTH_N=350` (~25 mm² epoxy lap joint at ~14 MPa shear —
  design estimate, cited in docs §9 addendum 2).
- At Test Fly, `fwGlueCarriedIds` two-passes `markDetachedFlightParts` (now takes
  an optional bonds list, default `workshopBonds`) to find parts attached ONLY
  by glue; `fwBuildGlueJoints` maps the bonds onto the flight-model parts.
- Every frame `fwGlueLoadUpdate` (after `fwStepFlightWires`, which publishes the
  apparent-gravity magnitude in `fwLastGAppMag`) evaluates glue groups as
  BOND-CONNECTED COMPONENTS: the boundary bonds (carried ↔ structural) carry
  the whole group's weight — load = carried mass × |g_app|, capacity = boundary
  bonds × 350 N. Overload → spark, the whole carried group tears off as debris
  (`detachPartAsDebris` each), `refreshCustomFlightStats(true)`, flight log
  "Glue joint failed at Ng (X N > Y N)". A 5 kg part on one bond tears off above
  ~7g; hard re-entries and crashes rip glued parts off — glued groups now fall
  apart like real structures.
- Chained parts go WITH their joint (part glued only to an overloaded part
  tears off in the same event), and a part whose structural anchor is removed
  by the damage model has zero boundary bonds → falls off even at 1g — no
  floating unsupported groups.
- Honesty: bond-chain loading (a bond also carrying a neighbouring glued part)
  is approximated by counting bonds; strength is game-scaled, not a specific
  adhesive spec; joints backed by physical contact are held by that contact
  (the game's contact-attachment model) and not additionally glue-load-tested.
  The 105°C insulation failure is a tuned gameplay threshold at the PVC
  continuous-service rating, not a material-spec melt model.

### Review-fix rounds (same session, before push): robustness
- **Two-frame overload guard**: a glue joint fails only after two consecutive
  overloaded frames — single-frame acceleration spikes (spawn teleports,
  mid-flight resets) can no longer rip parts off.
- **Wires rip out with torn-off parts**: when a glued group detaches, every wire
  attached to any of its parts dies with it (line hidden, Electrics fault,
  flight log) — no rope left anchored in mid-air.
- **Component model**: glue groups are bond-connected components; boundary
  bonds are counted once (from the carried side) and carry the group's total
  weight; teardown detaches the whole group so no unsupported group floats.
- **Rope rest-length fix + settle guard** (see ROOT-CAUSE FIX above).
- **105°C insulation failure** documented as a tuned gameplay threshold at the
  PVC continuous-service rating (not a material-spec melt model); touching
  glued joints are held by contact per the game's contact-attachment model
  (same as unwelded stacked parts) and are not additionally glue-load-tested.

### Live smoke test round (same day): the clone swap — glue/ropes never ran in the scene
- **Found live on the deployed Pages build** (blob-instrumented page + CDP):
  Test Fly's `resetFlight()` → `restoreCustomAircraft()` REPLACES the model with
  a clone of `customPristineModel`, detaching the flight root the glue joints
  and rope sims were built on. Result in the live game: the glue load test
  never ran (joints nulled by the parent guard on frame 1) and the visible
  wires were frozen straight copies — the user's "wires disobey gravity"
  symptom persisting in the real game despite all unit tests passing.
- **Fix**: new `fwRebindFlightPhysics(model)` — rebuilds glue joints (with fresh
  carried ids) and rope sims (on the model's `ElectricalWiring` group) against
  the model actually in `fleetModelSlot`. Called at the end of Test Fly and
  inside `restoreCustomAircraft` (repairs/flight resets keep physics alive).
- **Live verification**: 144 kg drop tank on one 350 N bond tore off at 1 g
  with the proper "Glue joint failed at 1g (1413 N > 350 N)" log entry and
  airframe mass refresh — the full glue pipeline works in the deployed game.
- Tests: 31→32 (+rebind regression); npm test 64/64, e2e-cloud green.
- Docs: §9 addendum 5.

### Final review round (same day): 36× rope gravity + shared-anchor capacity
- **36× gravity bug fixed (workshop AND flight ropes)**: the verlet substep
  (h=dt/6, added for spring stability) still applied gravity as a·dt² per
  substep — 36× too strong. Both steps now use a·h². Ropes sag under real
  gravity (~18 cm for a 4 m rope — still clearly visible); the 11-node 0.5 m-rest
  rope that snapped in 3 frames under the old gravity survives 10 s of 1g
  (regression test). The settle guard stays as degenerate-build protection.
- **Shared-anchor capacity leak fixed**: the glue BFS no longer traverses
  structural anchors — independent assemblies bonded to the SAME frame part are
  separate groups (a 10 kg/1-bond part tears off at 9g while a 1 kg/2-bond part
  on the same anchor stays on). Regression-tested.
- Docs: removed the wrong "a single frame can never kill a wire" claim.
- Tests: 31 waypoint-wires (+1: the 11-node regression; glue test extended with
  the shared-anchor pair; builder test asserts BOTH wires survive with finite
  positions). npm test 64/64, e2e-cloud green.

### Flight wire thermal (wires now burn in re-entry)
- Flight ropes carry a temperature (same copper thermal mass as the workshop)
  but cool by FORCED convection (h≈80 W/m²K vs the workshop's h≈10) toward the
  LIVE skin temperature (`fwReentry.skinT`).
- 80°C → one-time "insulation running hot" warning; 105°C (PVC continuous
  rating) → insulation melts: spark, line dead, Electrics fault — same failure
  path as a snap. A hard re-entry that soaks the skin at hundreds of °C cooks
  the wiring harness.
- Tests: 30 waypoint-wires (+5: glue joint holds at 1g / tears off at 9g;
  glue load-update integration — spike guard, group teardown, chain, wire
  rip-out, floating group; wire cooks past 105°C in a pure-thermalStep loop;
  full-step melt integration with a hot skin; rope BUILDER integration —
  per-segment rests, distinct waypoint-span rests, builder rope sags without
  snapping; plus the settle-guard assertions in the rope test). The rope test
  harness gained `length()`/`sub()`/`add()` stubs and rebinding for
  `fwLastGAppMag`/`fwReentry`/`FW_WIRE_SETTLE_FRAMES`. Repo `npm test` 64/64 green.
- Remaining (unchanged): fleet path removal, Build Mode UI overhaul, fleet lamp
  fixtures, Render deploy verification, live Pages smoke test (`?debug&fresh=N`).
