# RobloxCraft

A browser reconstruction of the **Roblox** experience — a discovery launcher and a playable in-experience 3D world with the Roblox player UI (topbar, chat, leaderboard, health bar, Roblox Menu). Independently implemented — the downloaded client's code, assets, and fonts are not bundled in this repository; all artwork is original.

- **Launcher** — dark discovery page with experience cards, simulated player counts and ratings, a Play flow, and an **Avatar editor** (skin/shirt/pants colors + face, saved to the browser and applied to your character in every experience).
- **Experience** — Three.js baseplate world with a classic blocky R6-style avatar: WASD movement, jumping, third-person orbit camera, coin collection, hazard bricks with damage, respawn on falling off the edge, and a **gear shop** (Speed/Gravity/Fusion Coils bought with collected coins) with a **backpack** (topbar button or number keys to equip) and coil effects on walk speed / jump power.
- **Player UI** — topbar with Chat/Leaderboard/Inventory/Menu buttons, chat window with the official welcome text and `/`-key focus, People leaderboard, health bar, Esc menu with Resume/Respawn Character/Screenshot/Shop/Volume/Sensitivity, and the leave-confirmation dialog. Coins and purchases persist between sessions.

## Provenance

This is an independently implemented reconstruction — the downloaded client's code, assets, and fonts are not bundled in this repository. All artwork (logo, avatar, face, studs, world) is original.

| Area | Provenance | Notes |
|---|---|---|
| Target identity | **Binary-based** — official Roblox Player for Windows, version 0.743.0.7431134 (version GUID `11f155f3450f4c8e`) | 20 of the 22 manifest packages downloaded from Roblox's official CDN (`setup.rbxcdn.com`, package manifest at `https://setup.rbxcdn.com/version-11f155f3450f4c8e-rbxPkgManifest.txt`, SHA-256 `066907a5e348a40085d19573173043697f25aaa2e52ae9a6d538d34789b1ed93`) and MD5-verified; the two WebView2 runtime packages were skipped (not relevant to this reconstruction). Version resolved via the official API `https://clientsettings.roblox.com/v2/client-version/WindowsPlayer`. The client was never executed — static analysis only. Deep native inspection via REA was attempted but the Ghidra-class provider was unavailable in the analysis environment; analysis proceeded with package inventory and string extraction |
| In-experience UI text | **Binary-based** — `extracontent-translations.zip` → `CoreScriptLocalization.csv` | 1,605 official UI strings recovered from the package, including "To chat click here or press \"/\" key", "Are you sure you want to leave the experience?", "People", "Leaderboard", "Respawn Character", "Chat '/?' or '/help' for a list of chat commands." — implemented verbatim where shown |
| Chat window color | **Documentation-based** — Roblox developer forum post quoting the chat window `BackgroundColor3` value [25, 27, 29] | Used as the chat panel background; this value was not extracted from the client binary |
| Topbar button set | **Binary-based** — `CoreScriptLocalization.csv` (`CoreScripts.TopBar.*`) + client strings (`AvatarExperience.UA.TopBarView`, `GetTopbarTransparency`) | Chat, Leaderboard (People), Inventory, Menu buttons implemented; Emotes/Voice/Party/Captures/Report present in the real topbar are not implemented (Voice button shown disabled) |
| Engine internals (Backpack/Tool/HopperBin classes) | **Binary-based** — `RobloxPlayerBeta.exe` strings | Confirms the Backpack/Tool systems exist in the client; the Inventory button in this reconstruction reports an empty backpack — tools are not implemented |
| UI typeface | **Binary-based** — `content-fonts.zip` | Roblox ships Builder Sans/Builder Sans Bold; this clone approximates it with Manrope (Google Fonts, OFL) — not the real font |
| Physics constants | **Documentation-based** — Roblox Creator Documentation | Default Workspace gravity 196.2 studs/s², Humanoid WalkSpeed 16, JumpPower 50, classic 512×512-stud baseplate |
| R6 avatar proportions | **Documentation-based** — public R6 specifications | 2×2×1 torso, 1.2×1.2×1.2 head, 1×2×1 limbs; colors are the classic starter palette (original artwork) |
| 3D rendering | Three.js (MIT) | https://threejs.org |

Deep binary decompilation (Ghidra-class) was not available in the analysis environment; the native `RobloxPlayerBeta.exe`/`.dll` were analyzed via strings, package inventory, and embedded resources only. Strings are evidence of what exists in the client, not proof of runtime behavior.

## Behavior ledger

| Behavior | Target evidence | Status |
|---|---|---|
| Launcher with experience cards → Play → loading → experience | Documentation-based (roblox.com flow) | Verified: full flow including re-entry. Card player counts and ratings are simulated demo data, labeled as such in the launcher footnote |
| Chat window: welcome message, `/`-key focus, local message echo, `/help` command | CoreScriptLocalization.csv (binary-based) | Verified: focus via `/`, message send, command reply |
| Leaderboard (People) panel with sorted stat rows | CoreScriptLocalization.csv ("People", "Leaderboard") | Verified: coin collection updates the correct row and re-sorts |
| Health bar: green, red below 25 | Documentation-based (Roblox health bar spec) | Verified: 20-point damage increments reach a 20-health red-bar state before the final hit |
| Hazard bricks damage on touch (incl. standing on top), 900 ms invulnerability window | Reconstruction decision | Verified: 100→80→60→40→20 (red bar observed at 20) → death → automatic respawn, sampled at 300 ms intervals |
| Respawn on death and on falling off the baseplate edge (y < −40) | Documentation-based (Roblox respawn behavior) | Verified: edge-fall respawn and menu respawn |
| Roblox Menu (Esc): Resume, Respawn Character, Screenshot, Volume, Camera Sensitivity, Leave | CoreScripts.TopBar + InGame.HelpMenu strings (binary-based) | Verified: menu actions work; volume and sensitivity sliders drive the audio gain and camera multipliers (verified as handler-wiring checks via synthetic input events); Screenshot exports a valid PNG of the 3D canvas view (scene content confirmed by inspecting the export; the DOM HUD overlay is not part of the capture); leave flow shows the official confirmation text |
| Movement: WASD camera-relative, Space jump, right-drag orbit, wheel zoom | Documentation-based (Roblox default controls) | Verified: 16 studs/s movement, jump with airborne state and landing (apex ≈ 6 studs, discrete steps), orbit drag changes camera yaw, zoom changes distance. Space taps are buffered (physics-step countdown) so a short press is not lost between frames under throttled rendering |
| Coin collection with sound + chat notification + leaderboard update | Reconstruction decision (stand-in gameplay) | Verified |
| Mobile: leaderboard hidden by default, compact chat | Documentation-based (Roblox mobile defaults) | Verified at 375 px (responsive layout only — touch movement controls are not implemented) |
| Fixed-step physics with capped wall-clock catch-up | Reconstruction decision | Verified under throttled software rendering; very low frame rates can still affect input timing |
| Avatar editor: 15 color swatches per part + 4 faces, live preview, persisted | Documentation-based (Roblox avatar editor) | Verified: picks persist in localStorage and apply to the R6 rig (colors + face texture) in the experience |
| Gear shop + backpack + equip (Speed/Gravity/Fusion Coil) | Documentation-based (Roblox gear/backpack) | Verified: buy with coins (wallet persists across sessions and world rebuilds), equip via number keys or backpack click; Speed Coil raises walk speed 16 → 25.6 studs/s (live velocity readout), Gravity Coil raises jump apex ≈ 6.4 → 11.6 studs; equipped coil rendered in hand |

Not implemented: Luau scripting, multiplayer, accounts, emotes (chat replies that they are unavailable), voice chat, friends, real experiences (the two playable worlds are original stand-ins), touch controls. The other players on the leaderboard are simulated demo data. This is a local single-player reconstruction — "1:1" is the design goal, not a claim; the client's runtime behavior was not execution-verified.

Roblox® is a trademark of Roblox Corporation — this project is not affiliated with or endorsed by them. For the real platform, visit https://www.roblox.com.

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then launch the RobloxCraft card. Requires an up-to-date desktop browser (WebGL + ES modules). Keyboard: WASD move, Space jump, right-drag look, wheel zoom, `/` chat, Esc menu.
