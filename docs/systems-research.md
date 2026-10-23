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
