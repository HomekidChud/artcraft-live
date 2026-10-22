# tools/seed-presets

Rebuilds the Flight World fleet as **ground-up workshop designs** — real
parts from the client's `WORKSHOP_PARTS` catalog, routed wires, named groups
(Cockpit / Engines / Fuel system / Electrics / Hydraulics / Lights / Landing
gear), and research-consistent light fixtures (port red, starboard green, aft
white, strobes at wingtips + tailcone, beacon top + bottom).

The generator reads `AIRCRAFT_FLEET` and `WORKSHOP_PARTS` directly from
`airplanecraft/index.html`, so the client stays the single source of truth —
new fleet entries automatically get workshop presets on the next run.

## Usage

    node tools/seed-presets/generate.mjs --out airplanecraft/presets-fleet.json
    node tools/seed-presets/generate.mjs --api http://localhost:3000

- `--out <file>` writes the offline preset pack (committed as
  `airplanecraft/presets-fleet.json`, served next to the game so it works
  when the cloud server is down — the Cloud panel has a
  "Fleet presets (local)" button that loads it through the same
  validateDesign → workshopRestoreSnapshot path as cloud builds).
- `--api <url>` POSTs every design to a running server with `kind: 'preset'`
  (envelope `data: { schema: 'flightworld-build', build }`), so presets load
  as editable builds, not opaque blobs.

Every generated design is validated with the same rules the client's
`validateDesign` enforces (part IDs, symmetry pairs, wire kinds/endpoints,
scale and position limits), and the server re-validates with its own copy.

## Design per aircraft

Built from the fleet table's real dimensions (length, body width/height,
wingspan, engine count/type, wing placement, mass):

- Fuselage + nose + tail cone scaled to the cfg; wings (longWing/wingPanel)
  with mirror symmetry pairs; tailplane pair + fin + rudder.
- Engines placed per engineCount (nose single / wing pairs), with propellers
  for piston types; tricycle landing gear.
- Fuel: wing tanks → strainer at the low point → boost pump (only when tanks
  sit below the engine — low wing; high-wing gravity feed skips it) → engines.
- Electrics: battery + alternator → bus → breaker → loads, ground-return
  network to the battery negative, 5V devices (servo, receiver) fed from the
  flight computer rail.
- Hydraulics on aircraft over 8 t: pump → reservoir → gear actuators with
  return lines.
- Cockpit as its own group (seats, panel, canopy, computer, servo, receiver).

## Status / parity

The procedural fleet path (`buildFleetAircraft`) still exists in the client.
Do not remove it until the workshop presets reach visual + performance parity
(see the migration matrix in the root TODO.md). The audit + systems checks
(fuel ordering, cockpit clearance, hydraulic reachability) are enforced
client-side in `workshopSystemsAudit()`.
