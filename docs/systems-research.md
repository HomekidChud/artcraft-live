# Flight World — Systems Research (v17.10.x)

Research grounding for routed fuel / hydraulic / electrical / light systems in
Flight World's workshop. Every rule below is tied to a public source. The
"Sim rule" after each finding is how Flight World should encode it — as routed
lines that follow structure and as checks in the workshop audit.

## 1. Fuel systems

### General aviation (piston)

**Finding:** high-wing aircraft usually gravity-feed fuel from tank to engine
(most carbureted high-wing designs), while low-wing aircraft must pump fuel
because the tank sits below the engine — typically a mechanically-driven main
pump plus an auxiliary electric pump used for takeoff/landing, priming, or
emergency backup ([AOPA — Fuel Systems](https://www.aopa.org/training-and-safety/online-learning/safety-spotlights/fuel-management/fuel-systems)).

**Sim rule:** `wingPlacement: 'high'` aircraft may route tank → strainer →
engine with gravity (fuel wire only, pump optional). `wingPlacement: 'low'`
aircraft fail the audit unless a `fuelPump` sits between tank and engine.

**Finding:** all aircraft have a tank selector/shutoff (positions like
Off/Left/Both/Right); most low-wing singles cannot feed both wing tanks at
once; tanks are vented so they do not collapse as fuel is drawn
([AOPA — Fuel Systems](https://www.aopa.org/training-and-safety/online-learning/safety-spotlights/fuel-management/fuel-systems)).

**Sim rule:** builds with more than one tank need a selector-type part (or the
existing fuel strainer node) in the path; audit warns on unvented multi-tank
buildings. Fuel must not pass through the cockpit volume — route along spars
and the belly.

**Finding:** the classic GA chain is tank → selector valve → gascolator
(strainer) → pump → engine, with the gascolator at the low point for water
drainage ([AOPA — How airplanes Work](https://www.aopa.org/news-and-media/all-news/2009/march/flight-training-magazine/how-aiplanes-work),
[CFI Notebook — Aviation Fuel Systems](https://www.cfinotebook.net/notebook/operation-of-aircraft-systems/aviation-fuel-systems)).

**Sim rule:** audit checks ordering: every fuel path from `fuelTank` to an
engine part must pass a `fuelStrainer`, and (low wing) a `fuelPump`, in that
order.

### Airliners / large aircraft

**Finding:** modern airliners use multiple integral wing tanks (plus center
section, sometimes outer-wing tanks used late in flight to reduce wing
bending, and trim tanks in the stabiliser), each with internal pumps and
valves; larger aircraft have several pumps per tank for redundancy, automated
in-flight transfer, single-point refuelling, fuel dumping, and crossfeed so
fuel from one wing can be burned by the engine on the other wing
([SKYbrary — Aircraft Fuel Systems](https://skybrary.aero/articles/aircraft-fuel-systems)).
The 737 keeps fuel in three tanks within the wings and center section and
feeds both engines from them ([B737 Systems Summary — Fuel](https://static1.1.sqspcdn.com/static/f/1003521/16076338/1326771530163/B737+Systems+Summary+-+Fuel+Information+Sheet.pdf));
the 747 feeds four engines from four main tanks via a crossfeed manifold
([Boeing 747 fuel system](https://www.boeing-747.com/boeing-747-internals/fuel-system.html)).

**Sim rule:** airliner-class presets (mass > ~20 t) should model: wing tanks +
center tank, transfer lines between them, crossfeed manifold, and APU feed.
Fuel routing follows the wing box and belly fairing — never the cabin.

## 2. Hydraulics

**Finding:** hydraulic fluid is stored in a pressurized reservoir; the pump
draws fluid through a suction line and delivers it at higher pressure, with
accumulators smoothing transients ([HAW Hamburg — Hydraulic Power ATA 29](https://www.fzt.haw-hamburg.de/pers/Scholz/materialFS/FS-Notes-ATA29.pdf)).

**Sim rule:** reservoir must be in the hydraulic loop upstream of the pumps.

**Finding:** large aircraft use multiple independent hydraulic systems for
redundancy — the 737 NG has three 3,000 psi systems (A, B, standby), the 777
has three (left, center, right); fluid is stored in pressurized reservoirs and
delivered by engine-driven pumps, electric motor-driven pumps, or air
turbine-driven pumps ([Aircraft Systems Tech — Large Aircraft Hydraulic Systems](https://www.aircraftsystemstech.com/p/large-aircraft-hydraulic-systems.html),
[b737.org.uk — Hydraulics](http://www.b737.org.uk/hydraulics.htm)).
On the 737 the reservoirs live in the wheel well area and are pressurized by
bleed air; standpipes keep fluid available to the ACMP if an EDP line leaks;
the DC-9 family uses two completely separate systems ([Aircraft Systems Tech](https://www.aircraftsystemstech.com/p/large-aircraft-hydraulic-systems.html),
[Power & Motion — MD-80 hydraulics](https://www.powermotiontech.com/applications/aerospace/article/21883977/the-md-80-hydraulics-simple-reliable-and-easy-to-operate)).

**Sim rule:**
- Airliner presets: at least two independent pump → reservoir → actuator
  networks (no shared reservoir), one engine-driven + one electric pump.
- Audit: every `hydraulicActuator` must be reachable from a pump through
  `hydraulic` wires, and reservoirs must sit upstream of pumps.
- Reservoir placement: near the wheel well / belly for airliners, above the
  pump for gravity-fed GA installs (positive pressure feed to the pump is the
  general principle; [HAW Hamburg ATA 29](https://www.fzt.haw-hamburg.de/pers/Scholz/materialFS/FS-Notes-ATA29.pdf)).

### Line routing follows structure (implemented in presets v17.10.x)

**Finding:** FAA guidance treats fluid lines and wiring as components that must
be routed WITH the airframe: wires and cable bundles must be supported by
clamps at fixed intervals and routed so contact with structure and equipment is
avoided, and chafing between adjacent components must be designed out by
rerouting ([FAA AC 43.13-1B Ch. 9/11 — environmental protection & clamping](https://www.landseaskyspace.com/ac4313/11-147.html),
[EASA SIB CE-17-05](https://ad.easa.europa.eu/blob/CE1705.pdf/SIB_CE-17-05_1));
fuel line installations are individually reviewed for routing, drainage and
chafing against structure ([FAA CATA worklist ANAC-001 — fuel line installation](https://www.faa.gov/aircraft/air_cert/design_approvals/transport/transport_intl/cata/CATA_ANAC-001),
[DTIC — Fuel Line Study ADA284918](https://apps.dtic.mil/sti/tr/pdf/ADA284918.pdf)).

**Sim rule (implemented):** wires are encoded as part-to-part connections with
optional waypoint polylines that follow structure — fuel and hydraulic supply/
return lines run under the cabin floor (belly) or spanwise in the wing-box
plane (spar corridor) to wing-mounted actuators; alternator-to-bus and
hydraulic-pump power/ground feeds run along the belly with the other trunk
runs. The workshop audit enforces the same rule for both fluid kinds: a
straight line through the cockpit volume fails, a belly/spar polyline passes
(exact segment–box intersection, no sampling gaps).

## 3. Electrical

**Finding:** small aircraft run a 28 V DC system: alternator charges the
battery, both feed the bus bar, and every load connects through a circuit
breaker or fuse; the ground return usually runs through the airframe
([Cessna Flyer — Alternators and Electrical Systems](https://www.cessnaflyer.org/magazine/article-archives/maintenance-technical/alternators-electrical-systems.html),
[EAA — Electrical Systems Simplified](https://www.eaa.org/eaa/aircraft-building/builderresources/while-youre-building/building-articles/electrical/electrical-systems-simplified-part-1),
[Pilotfriend — aircraft electrical systems](https://www.pilotfriend.com/training/flight_training/tech/elec.htm)).
EASA guidance for GA electrical design likewise puts the alternator and
battery on the bus and requires a load analysis ([EASA ABCD-SDE-24-00](https://www.easa.europa.eu/download/general-aviation/documents-guidance-and-examples/ABCD-SDE-24-00%20-%20Electrical%20System%20Description%20and%20Load%20Analysis%20-%2017.02.16%20-%20v1.docx)).

**Sim rule:** the existing strict-wiring audit (source → bus → loads, airframe
ground return) matches the real topology. Airliner presets add an APU source
and an avionics bus (separate bus part) — APU fuel feed comes from the fuel
system ([SKYbrary](https://skybrary.aero/articles/aircraft-fuel-systems)).

## 4. External lights

**Finding:** port (left) wingtip = red, starboard (right) wingtip = green,
tail = white, as far aft as possible; anti-collision = white strobes at the
wingtips and tail plus a red flashing beacon top and bottom of the fuselage;
beacon is on before engine start and for the whole flight; taxi lights on
while taxiing, landing lights and strobes on for the runway
([Wikipedia — Navigation light](https://en.wikipedia.org/wiki/Navigation_light),
[AOPA — Anticollision lights](https://www.aopa.org/news-and-media/all-news/2023/june/flight-training-magazine/what-am-i-anticollision-lights)).

**Sim rule:** light fixtures must be placed by these conventions (port red,
starboard green, aft white; strobes wingtips + tailcone; beacon top and
bottom), colours fixed, and every fixture is a powered electrical load gated
by the master electrical state. Landing/taxi lights cast real ground
illumination at night.

## 5. Per-class routing matrix (for preset builds)

| Class | Fuel | Hydraulics | Electrical | Extras |
|---|---|---|---|---|
| GA high-wing | wing tanks → selector → strainer → engine, gravity | none (manual gear/flaps) | battery + alternator → bus → breakers | nav/strobe/beacon, cabin light |
| GA low-wing | wing tanks → selector → strainer → pump → engine | optional (flaps) | battery + alternator → bus | same |
| Glider | none | none ( spoilers are the "system") | battery → avionics bus only | nav lights |
| Warbird / fighter | wing + fuselage tank → strainer → pump → engine | gear only, single system | battery + generator → bus, weapon bus | formation lights |
| Turboprop twin | nacelle/wing tanks → pumps → engines | single system: gear/flaps/brakes | battery + generators → bus | de-ice (bleed) |
| Business jet / narrow-body | wing + center tanks → transfer → crossfeed | 1–2 systems | battery + generators → buses + APU | logo, wing-inspection lights |
| Wide-body / supersonic | multiple integral tanks, transfer, dump | 2–3 independent systems | multiple buses + APU | de-ice, water/waste, oxygen |

Sources for the matrix rows are the class-level sources above: AOPA fuel
([1](https://www.aopa.org/training-and-safety/online-learning/safety-spotlights/fuel-management/fuel-systems)),
SKYbrary airliner fuel ([2](https://skybrary.aero/articles/aircraft-fuel-systems)),
Aircraft Systems Tech hydraulics ([3](https://www.aircraftsystemstech.com/p/large-aircraft-hydraulic-systems.html)),
Wikipedia nav lights ([4](https://en.wikipedia.org/wiki/Navigation_light)).

## 6. Audit rules to implement (client `workshopElectricalAudit` extension)

1. **Fuel in cockpit:** any `fuel` wire whose polyline enters the cockpit
   bounding volume → error (route along spars/belly instead).
2. **Fuel ordering:** tank → strainer → (pump if low-wing) → engine. Missing
   strainer → error; low-wing without pump → error.
3. **Fuel near ignition:** fuel wires passing within a radius of an engine
   hot part (`jetEngine`, `pistonEngine` exhaust) other than the intended
   feed endpoint → error.
4. **Hydraulic reachability:** every `hydraulicActuator` must have a
   `hydraulic` path from a `hydraulicPump` through a `hydraulicReservoir`.
5. **Hydraulic independence:** airliner-class builds must not share
   reservoirs between engine-driven and electric systems.
6. **Electrical:** unchanged strict wiring (source → bus → load, airframe
   ground return) — already research-consistent.
7. **Lights:** every light part must be a powered load; port fixtures must
   be red, starboard green, aft white (colour check on fixture parts).

## 7. What is implemented vs pending

- Implemented: fuel/hydraulic/water wire kinds, pump/reservoir/strainer/tank
  catalog parts, strict electrical audit, per-light power gating, ground
  return networks.
- Implemented (follow-up): routed-line polylines that follow structure —
  optional per-wire waypoints (max 8, ±500 m) in the design schema, rendered as
  straight LineSegments through the resolved points, checked by the audit with
  exact slab intersection, preserved through snapshot/restore/cloud round trips.
  Presets: 225 routed wires (fuel 113, power 34, ground 34, hydraulic 44).
- Pending: waypoint editor affordance (drag to add/move/remove), per-class
  audit matrix, cockpit-bounding-volume helper, fleet-lamp lens fixtures,
  Build Mode UI consolidation, Render deploy verification.

## §9 Energy-form physics (17.10.5, 2026-10-23)

Implemented as `EnergyCore` (pure functions) + a coupled mechanical/thermal slice on
the wire ropes + a live aircraft energy ledger in the HUD.

| Form | Model | Source |
|---|---|---|
| Kinetic | E = ½mv², m = aircraft + fuel, v = physicsVelocity | textbook |
| Gravitational potential | E = mgh (h = MSL) | textbook |
| Elastic | tension-only springs, explicit stiffness per wire kind (1.2–4 kN/m), E = ½kx² on actual stretch | steel-wire behaviour, stability bound k·h²/m < 1 for the integrator |
| Thermal/heat | damping power c·v² dissipates into wire thermal mass; copper cp 385 J/(kg·K); Newton cooling h·A·(T−T_amb) | copper cp: [Wikipedia – copper](https://en.wikipedia.org/wiki/Copper_(data_page)) |
| Temperature limit | PVC wire insulation 70–105°C → inspector warning above 80°C | [Wikipedia – PVC](https://en.wikipedia.org/wiki/Polyvinyl_chloride) |
| Chemical | fuel energy 43.02 MJ/kg (Jet-A) | [Chevron Jet A spec](https://www.chevron.com/-/media/chevron/stories/documents/chevron-jet-a.pdf) |
| Electrical | live Electrics bus load (W) | existing Electrics system |
| Light | lamp draw × 15% radiant efficiency (design estimate; remainder → heat) | estimate, labelled as such |
| Sound | not modelled — deliberately excluded rather than invented | — |
| Pressure | hydraulic 3000 psi / fuel 30 psi connectivity model (previous session) | nominal system ratings |

Glue replaces weld: flight attachment is now "physically touching structure OR glued
(bond graph)"; the Weld/Unweld buttons were removed. Constants are cited in the code
comments next to `EnergyCore`.

### §9 addendum — flight-time ropes and re-entry heating

- **Apparent gravity**: ropes in the airframe frame feel g − a_plane (rotated
  into the plane frame) — the standard non-inertial-frame treatment; sag in level
  flight, weightless in free fall, 2–3g downward in pull-ups.
- **Elastic limit**: 8% stretch before snap — consistent with copper wire
  fracture strains (~1–15% depending on temper; conservative game value).
- **Stagnation heating**: T₀ = T·(1 + 0.2M²), the isentropic compressible-flow
  relation (e.g. [NASA Glenn](https://www.grc.nasa.gov/www/BGH/stagnnt.html));
  skin lags with ~8 s thermal time constant.
- **Flame threshold is game-scaled** (80°C vs ~500°C for visible dull-red
  steel) so the effect is reachable in normal gameplay; white-hot by ~480°C.

### §9 addendum 2 — glue joints carry load; flight wires carry heat (17.10.5d)

- **Glue joint strength (350 N per bond)**: a design estimate — a ~25 mm² epoxy
  lap joint at ~14 MPa shear (structural epoxies typically 10–30 MPa,
  [Wikipedia – epoxy](https://en.wikipedia.org/wiki/Epoxy)). In flight each
  glue-carried part (attached only by glue) is load-tested every frame:
  load = mass × apparent-gravity magnitude, capacity = bond count × strength.
  Overload — hard maneuver, gust, re-entry deceleration, ground impact — and
  the joint fails: spark, the part tears off as debris, airframe stats refresh.
  This closes the "glued groups never fall apart" bug.
- **Flight wire thermal**: flight ropes now carry a temperature (same copper
  thermal mass as the workshop: 50 g/node, cp 385) but cool by FORCED
  convection (h ≈ 80 W/m²K, mid-range of the 25–250 W/m²K band for forced
  convection in air, [Engineering Toolbox](https://www.engineeringtoolbox.com/convective-heat-transfer-d_430.html));
  the static workshop uses h ≈ 10 (natural convection). Ambient is the live
  airframe skin temperature — a hard re-entry that heats the skin to hundreds
  of °C cooks the wires: 80°C triggers an insulation warning; at 105°C (the PVC
  continuous-service rating, used as a TUNED GAMEPLAY DAMAGE THRESHOLD) the
  insulation gives and the line burns through (electrical fault, spark) — the
  same failure path as a snap. (Wire temperature is an integrated state that
  relaxes toward the skin temperature, so it takes a sustained hot soak to cross
  the threshold — but any update that crosses it kills the wire.)
- **Glue failure mechanics**: glued parts are evaluated as bond-connected
  components — when a group's joint lets go, the whole group detaches as debris
  and every wire attached to any of its parts rips out with it (line dead,
  electrical fault) — no wire stays anchored in mid-air and no part is left
  floating without a support path.
- **Honest limits**: the bond strength is a game-scaled design estimate, not a
  specific adhesive spec; load is the part's own inertia (bond-chain loading,
  where a bond also carries a neighbouring glued part's weight, is approximated
  by counting bonds); joints backed by physical contact (part touching the
  airframe) are held by that contact per the game's contact-attachment model and
  are not additionally glue-load-tested; skin/wire heating is one lumped node per
  wire, not a longitudinal temperature profile; the 105°C melt point is a
  gameplay threshold, not a material-spec melt model. Temperature is an
  integrated state (no single-frame spikes possible), but glue failure needs
  two consecutive overloaded frames so single-frame acceleration spikes
  (spawn teleports, mid-flight resets) never rip parts off.

### §9 addendum 3 — rope rest-length root cause + settle guard (17.10.5d, review round)

- **Root cause of "wires that disobey gravity"**: the flight rope builder
  emitted ONE rest length per span while the verlet step indexes rests per
  SEGMENT — on every built wire, all segments past the first had an undefined
  rest → NaN stretch → no spring force and no snap check, so those rope nodes
  free-fell. The builder now emits per-segment rests
  (`rests.length === pts.length - 1`, verified by an integration test that also
  checks unequal waypoint spans get distinct rests and that a builder-produced
  rope sags without snapping).
- **Settle guard**: a freshly built rope starts perfectly straight; its
  gravity-sag transient can exceed the 8% elastic limit. Snap checks are
  suppressed for the first 30 frames (`FW_WIRE_SETTLE_FRAMES`); a genuinely
  overstretched rope (pins 4 m apart, 2 m of total rest — the stretch cannot
  relax below the pin-to-pin distance) still snaps once the window passes.
- **Glue groups as components**: glued parts are evaluated as bond-connected
  components — the boundary bonds (carried ↔ structural) carry the group's total
  weight (counted once, from the carried side); teardown detaches the whole
  group, and a part whose structural anchor was removed by the damage model
  falls off even at 1g. No unsupported group can float on the airframe.
  Independent assemblies bonded to the SAME structural part are separate groups
  (the BFS traverses carried↔carried edges only; anchors contribute boundary
  capacity, never a traversal path) — a 10 kg/1-bond part tears off while a
  1 kg/2-bond part on the same anchor stays on.

### §9 addendum 4 — rope gravity corrected to a·h² per substep (17.10.5d, final review round)

- **36× gravity bug**: the rope step ran 6 verlet substeps per frame (h = dt/6,
  introduced for spring stability) but applied the gravity offset as a·dt² per
  substep instead of a·h² — 36× too strong, in BOTH the workshop and flight rope
  steps. Fixed in both: ropes now sag under real gravity (a 4 m rope sags ~18 cm,
  a 5 m/0.5 m-rest rope ~40 cm — still clearly visible). The 11-node 0.5 m-rest
  rope that snapped in 3 frames under the old gravity now survives 10 s of 1g
  (regression test); the settle guard is kept as protection for degenerate
  straight-start builds, and genuinely overstretched ropes still snap.

### §9 addendum 5a — wire-free builds: glue must track gravity on its own (17.10.5d, final review)

- **Gap found in review**: `fwLastGAppMag` (the apparent-gravity magnitude feeding the glue
  joint load test) was refreshed only by the flight rope step — a glue-only custom
  aircraft with no wires has no rope step, so the load test ran on the initial 9.81
  m/s² forever and never saw maneuvers. `fwGlueLoadUpdate(dt)` now computes the apparent
  gravity itself when there is no live rope root (own prev-velocity tracker, same
  formula as the rope step: |(0,−g,0) − a| in model space), so every build's glue joints
  feel real acceleration. Regression-tested: wire-free build computes 1g at rest,
  tracks ~8g sustained acceleration, and tears an overloaded joint after two
  consecutive overloaded frames.

### §9 addendum 5 — the clone swap: physics must bind to the model actually flying (17.10.5d, live smoke test)

- **Root cause found live**: `resetFlight()` (called by Test Fly) and every repair
  run `restoreCustomAircraft()`, which replaces `fleetModelSlot`'s content with a
  fresh `clone(true)` of `customPristineModel`. The glue joints and rope sims were
  built on the ORIGINAL flight root — which that swap detaches from the scene.
  The glue load test then never ran (joints sat on a parentless root; the guard
  nulled them on the first frame), and the visible wires were frozen straight
  COPIES of the rope lines — exactly the "wires that disobey gravity" symptom.
  Unit tests never caught it because they call the steps directly; only a live
  browser run (blob-instrumented page + CDP) exposed the swap.
- **Fix**: `fwRebindFlightPhysics(model)` re-binds both systems to the model
  actually in the slot — glue joints rebuilt from the live model's own parts
  (fresh `fwGlueCarriedIds`), rope sims rebuilt on its `ElectricalWiring` group.
  Called at the end of Test Fly (after `detachUnweldedParts`) and inside
  `restoreCustomAircraft` (so repairs and flight resets keep glue + ropes alive).
  Verified live: a 144 kg drop tank on one 350 N bond tore off at 1 g with the
  proper flight-log entry and airframe mass refresh.
- **Two more live-only bugs** (both hidden because the flight rope step never ran
  in the scene before the rebind):
  - **Rope spring instability on slow frames**: the substep was h=dt/6 with the
    frame dt capped only at 0.1 s — k·h²/m reaches 33 for a 3000 N/m fuel line
    (stability needs < 1), so nodes exploded to ~5e11 m/s, damping power hit
    ~1e24 W, and wire temps "melted at 9.5e22 °C" (observed live). Both rope
    steps now run fixed-size substeps h=min(dt/6, 1/480) with
    n=clamp(round(dt/h), 1, 60) — stable for any frame time; the equilibrium
    sag is unchanged (mg/k is timestep-independent).
  - **Re-entry skin temperature chased Kelvin**: `atmosphere()` returns Kelvin,
    but `fwReentry.skinT` is °C — it converged toward 288 °C at Mach 0 (observed
    "SKIN 229 °C" and a re-entry flame while parked). `stagT` now converts
    to °C (−273.15); real re-entry heating at high Mach is unaffected
    (Mach 5 at sea level ≈ 1450 °C).
