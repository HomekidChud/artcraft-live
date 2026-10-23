# AirplaneCraft

A single-file browser flight simulator: design an airframe in the workshop, tune its systems, and fly it in a living open world.

- **Sandbox free flight** over an open world, plus **Build Mode** for assembling an aircraft from structural and electronic components.
- Momentum-based flight model, persistent workshop, navigation and systems tuning, responsive UI (desktop and touch), and a damage model.
- **Realistic systems**: electrical (battery → bus → circuit breakers → loads with ground return), fuel (tank → strainer → pump → engine), hydraulic (pump → reservoir → actuator) and water lines; the build notebook checks each loop live.
- **Working lights**: navigation (port red / starboard green / tail white), strobes, beacons and landing lights are real fixtures with actual point-light illumination, powered by the electrical system.
- **Physics**: eight energy forms (kinetic, gravitational, elastic, thermal, chemical, electrical, light, spring/damper heat) with a live HUD ledger; wires are real ropes that sag, stretch, snap past their elastic limit and heat up (insulation melts during hot re-entries); glue bonds carry load and tear off when overloaded; descending fast at high Mach heats the skin (re-entry flame).
- **Cloud build sync**: every workshop build is a JSON document that can be saved to and loaded from the Flight World server (`server/` in this repo, deployed on Render). Build-mode presets are authored as workshop builds (ground-up parts + wiring) and published as `flightworld-build` JSON documents. The sandbox quickbar fleet remains a separate parametric set of procedurally-assembled reference aircraft.
- Runs in the browser; the only external dependency is Three.js from a CDN.

## Provenance

Originally a user-supplied HTML file (`FlightWorldTest17.2_Responsive_UI_Damage.html`, 2026-10-20) published under the **AirplaneCraft** name with branding-only changes. On 2026-10-22 the site owner supplied the newer `Flight-World-17.10.html` and directed a code upgrade (build UI overhaul, realistic wiring, working lights, notebook checklist, preset-as-build cloud flow). The simulator is a single-file app; QA is done with a headless browser (see repo TODO ledger). Not affiliated with any aircraft or flight-sim manufacturer.

## Cloud server

`server/` implements the `/api/builds` contract (zero-dependency Node; deployed on
Render). Builds and presets are stored as JSON. **MongoDB is not wired up yet** —
the `MONGODB_URI` env var is reserved for a future storage adapter; today the
server persists to a JSON file (ephemeral across Render free redeploys).

## Run

Static site — open via GitHub Pages at [airplanecraft/](https://homekidchud.github.io/artcraft-live/airplanecraft/) or serve the repo root locally. Requires an up-to-date browser with WebGL.
