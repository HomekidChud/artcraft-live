# RobloxCraft

A clean-room browser reconstruction of the **Roblox** experience — a discovery launcher and a playable in-experience 3D world with the Roblox player UI (topbar, chat, leaderboard, health bar, Roblox Menu).

- **Launcher** — dark discovery page with experience cards, live player counts, ratings and a Play flow.
- **Experience** — Three.js baseplate world with a classic blocky R6-style avatar: WASD movement, jumping, third-person orbit camera, coin collection, hazard bricks with damage, respawn on falling off the edge.
- **Player UI** — topbar with Chat/Leaderboard/Inventory/Menu buttons, chat window with the official welcome text and `/`-key focus, People leaderboard, health bar, Esc menu with Resume/Respawn Character/Screenshot/Volume/Sensitivity, and the leave-confirmation dialog.

## Provenance

This is a clean-room reconstruction — no Roblox Corporation code, assets, fonts, or trademarks are redistributed. All artwork (logo, avatar, face, studs, world) is original.

| Area | Provenance | Notes |
|---|---|---|
| Target identity | **Binary-based** — official Roblox Player for Windows, version 0.743.0.7431134 (version GUID `11f155f3450f4c8e`) | All 20 deployment packages downloaded from Roblox's official CDN (`setup.rbxcdn.com`) and MD5-verified against the official package manifest (`rbxPkgManifest.txt`, SHA-256 `066907a5e348a40085d19573173043697f25aaa2e52ae9a6d538d34789b1ed93`). The client was never executed — static analysis only |
| In-experience UI text | **Binary-based** — `extracontent-translations.zip` → `CoreScriptLocalization.csv` | 1,605 official UI strings recovered from the package, including "To chat click here or press \"/\" key", "Are you sure you want to leave the experience?", "People", "Leaderboard", "Respawn Character", "Chat '/?' or '/help' for a list of chat commands." — implemented verbatim where shown |
| Chat window color | **Binary-based** — `RobloxPlayerBeta.dll` | Chat window `BackgroundColor3` value [25, 27, 29] recovered from the client binary strings; used as the chat panel background |
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
| Launcher with experience cards → Play → loading → experience | Documentation-based (roblox.com flow) | Verified: full flow including re-entry |
| Chat window: welcome message, `/`-key focus, local message echo, `/help` command | CoreScriptLocalization.csv (binary-based) | Verified: focus via `/`, message send, command reply |
| Leaderboard (People) panel with sorted stat rows | CoreScriptLocalization.csv ("People", "Leaderboard") | Verified: coin collection updates the correct row and re-sorts |
| Health bar: green, red below 25% | Documentation-based (Roblox health bar spec) | Verified: 25-damage increments turn the bar red at low health |
| Hazard bricks damage on touch (incl. standing on top), 900 ms invulnerability window | Reconstruction decision | Verified: 100→75→50→25→0 → death → respawn |
| Respawn on death and on falling off the baseplate edge (y < −40) | Documentation-based (Roblox respawn behavior) | Verified: edge-fall respawn and menu respawn |
| Roblox Menu (Esc): Resume, Respawn Character, Screenshot, Volume, Camera Sensitivity, Leave | CoreScriptLocalization.csv (binary-based) | Verified: all menu actions work; leave flow shows the official confirmation text |
| Movement: WASD camera-relative, Space jump, right-drag orbit, wheel zoom | Documentation-based (Roblox default controls) | Verified: 16 studs/s movement, jump apex ≈ 6.4 studs, orbit/zoom |
| Coin collection with sound + chat notification + leaderboard update | Reconstruction decision (stand-in gameplay) | Verified |
| Mobile: leaderboard hidden by default, compact chat | Documentation-based (Roblox mobile defaults) | Verified at 375 px |
| Physics speed independent of frame rate (wall-clock catch-up) | Reconstruction decision | Verified under throttled software rendering |

Not implemented: Luau scripting, multiplayer, accounts, avatar customization, emotes, voice chat, tools/backpack items, friends, real experiences (the two playable worlds are original stand-ins). This is a local single-player reconstruction — "1:1" is the design goal, not a claim; the client's runtime behavior was not execution-verified.

Roblox® is a trademark of Roblox Corporation — this project is not affiliated with or endorsed by them. For the real platform, visit https://www.roblox.com.

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then launch the RobloxCraft card. Requires an up-to-date desktop browser (WebGL + ES modules). Keyboard: WASD move, Space jump, right-drag look, wheel zoom, `/` chat, Esc menu.
