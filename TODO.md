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
- NOT verified in a browser this session (no headless browser run): flight,
  crash/damage, workshop interaction, grouping, cloud panel from the live
  page, mobile layout. The client edits are parse-checked only — run the
  browser QA from item 6 before trusting Test Fly.

### Constraints that still stand

- Atoms/air molecules never visible. Damage cells stay clipped original
  geometry. No hard-coded preset geometry once the build-from-parts path is
  live (it is live — the generator is the only allowed source of preset
  geometry, driven by the fleet table). Cite research for every routing rule.
