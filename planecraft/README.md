# PlaneCraft

A browser reconstruction of **Plane**, the open-source project management platform — the PlaneCraft take on "Jira/Linear in your browser".

- **Workspace shell** — icon rail (Home, Work items, Inbox, Analytics, Settings), dark sidebar with workspace switcher, global search, project list and saved views.
- **Work items** — List / Board (Kanban with drag-and-drop) / Calendar layouts, filters (state, priority, assignee, label, cycle), group-by-state list, work-item detail drawer (title, description, all properties, sub-items, comments), `c` shortcut to create.
- **Cycles, Modules, Views, Pages, Analytics** — per-project tabs mirroring Plane's navigation: cycle progress, module cards, saved filtered views, a lightweight page editor, and live count charts.
- **Local-first** — all data lives in your browser's localStorage (in-memory fallback where storage is blocked); nothing leaves the page.

## Provenance

This is a clean-room reconstruction — no Plane code, assets, fonts, or trademarks are redistributed. The UI code, artwork and icon are original. **"Looks and behaves like Plane" is the design goal, not a claim**: every behavior below is labeled with how it is supported, and Plane's runtime was never execution-verified against this reconstruction (it is a static mock of a server-backed product).

| Area | Provenance | Notes |
|---|---|---|
| Feature set: work items, cycles, modules, views, pages, analytics | **Documentation-based** — [Plane README](https://github.com/makeplane/plane) and [docs.plane.so](https://docs.plane.so/) | Plane is open source (AGPL-3.0); its documented feature list drove the tab structure. No Plane source was copied |
| Navigation model: sidebar with projects, per-project tabs (Work Items, Cycles, Modules, Views, Pages, Analytics) | **Documentation-based** — docs.plane.so project overview & DeepWiki component map | Plane's current UI also has a slim icon rail; both are reconstructed with original styling |
| Default work item states (Backlog, Todo, In Progress, Done, Cancelled) and priorities (Urgent…None) | **Documentation-based** — Plane docs (work items) | Colors and chips are original |
| List / Board / Calendar layouts | **Documentation-based** — Plane docs & release notes ("five layouts: List, Kanban, Calendar, Spreadsheet, Gantt") | Spreadsheet and Gantt layouts are documented in Plane but not implemented here |
| Cycles with start/end dates, progress; modules as thematic groupings; saved views as filters; pages as documents | **Documentation-based** — Plane README feature list | |
| Shortcut `c` for quick work-item creation | **Documentation-based** — Plane launch blog | `/` for search is a design choice |
| Visual design (colors, type, layout details) | **Design choice** | Plane-inspired dark-sidebar/light-content scheme with an original indigo accent; no Plane brand assets or exact tokens copied |
| Icon | **Original artwork** | Paper plane on an indigo gradient tile (`favicon.svg`, `icon-256.png`, `icon-512.png`); the plane's shape follows the widely used "send" icon geometry from Google's Material Design icons (Apache-2.0), rotated — all composition, colors and rendering are original |

## Behavior ledger

| Behavior | Target evidence | Status |
|---|---|---|
| Workspace shell: rail + sidebar + project navigation | docs.plane.so | Implemented (verified in browser QA) |
| Work items: create via modal, edit in drawer, persist across reload | Plane docs (work items) | Implemented and browser-verified with localStorage |
| List view grouped by state with filters | Plane docs (views/layouts) | Implemented; filters verified (state, priority, assignee, label, cycle, search) |
| Board view with drag-and-drop between states | Plane docs (Kanban) | Implemented; drag-and-drop verified |
| Calendar view with items on due dates, month navigation | Plane docs (Calendar) | Implemented |
| Cycles list with progress; click filters work items to the cycle | Plane docs (cycles) | Implemented |
| Modules, saved views (apply filters), pages editor, analytics charts | Plane docs | Implemented |
| My work items / Inbox (comment activity) / Settings (local reset) | Plane docs + design choice | Implemented |
| New project creation with key and color | Plane docs (projects) | Implemented |

Not implemented: real-time collaboration, intake, initiatives/epics hierarchy, spreadsheet/Gantt layouts, members management, integrations (GitHub/GitLab/Slack), Plane AI, login/teams — those need Plane's server; this reconstruction is a static, local-only app. The WebGL2 fallback described in the repo README is a safety net, not a product claim: whether PlaneCraft-style apps should prefer WebGL2 is a design choice of the mirrored apps themselves.

Plane is a trademark of Plane Labs, Inc. — this project is not affiliated with or endorsed by them. For the real product, visit [plane.so](https://plane.so/).

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then open the PlaneCraft card. Requires an up-to-date desktop browser (ES modules). Data is stored locally; use Workspace Settings → Reset to restore the sample data.
