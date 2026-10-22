# Build Mode UI research — what to borrow

Survey of five build/edit UIs named in the 17.10 brief, with the specific
features worth porting into Flight World's workshop, and the single design
system that should replace the current stacked skins.

## Roblox Studio ([Studio interface docs](https://create.roblox.com/docs/en-us/studio/overview))

- Ribbon + "mezzanine" tool tabs (Home, Model, Avatar, UI, Script, Plugins)
  across the top; custom tabs possible.
- Dockable windows (Explorer tree + Properties inspector on the right),
  toggleable from a View tab ([View tab](https://github.com/Roblox/creator-docs/blob/main/content/en-us/studio/view-tab.md)).
- Explorer shows a scene hierarchy; Properties edits the selected instance's
  fields with typed inputs.

**Borrow:** the docked Explorer/Properties split is already in Flight World —
keep it, add the ribbon tab model (Build / Wire / Test), and View-tab style
panel toggles.

## Kerbal Space Program VAB ([KSP wiki — Vehicle Assembly Building](https://wiki.kerbalspaceprogram.com/wiki/Vehicle_Assembly_Building))

- Left 25–30% of screen = categorized parts tableau with sort (name, mass,
  cost, size) and custom categories; subassemblies (saved part clusters)
  can be cross-loaded.
- Symmetry: radial (VAB) or mirrored (SPH) — R toggles mode, X/Shift+X
  changes fold count; parts place with 1/2/3/4/6/8-fold symmetry.
- Gizmos appear top-left after the first part: Place, Offset, Rotate, Root
  (keys 1–4); Shift = finer steps.
- Craft name editable at top center; mode buttons (Parts / Action Groups /
  Crew) above.

**Borrow:** gizmo-mode hotkeys 1–4, Shift for fine steps, subassembly-style
saved groups (already partly there), symmetry indicator, and the
left-rail parts list with sorting + search.

## Space Engineers ([How to build](https://spaceengineers.wiki.gg/wiki/How_to_build))

- Grid-based block placement with a ghost preview before commit; blocks are
  functional (light, cockpit) not just structural ([Blocks wiki](https://spaceengineers.wiki.questlinehero.com/content/blocks/)).
- Community pain point: UI overhauls that remove familiar flows are badly
  received ([Trailmakers console discussion, same pattern](https://steamcommunity.com/app/585420/discussions/0/600777838736460917/)).

**Borrow:** ghost-preview placement (drag-to-place with ghost is in the
brief), and the lesson: when redesigning, keep the old interaction
vocabulary (same shortcut keys, same panel positions) so users are not lost.

## Trailmakers ([community reactions](https://www.reddit.com/r/trailmakers/comments/1j60etq/do_we_really_care_all_that_much_about_the_new_ui/))

- Recent builder-UI overhauls drew heavy criticism; players value quick,
  muscle-memory placement over pretty chrome.

**Borrow:** change the skin, not the motion — the CSS consolidation must not
move buttons users already know.

## Aviassembly ([Steam page](https://store.steampowered.com/app/2660460/Aviassembly/))

- Build-and-fly airplane sandbox: assemble aircraft from parts, then fly
  missions; the closest genre sibling to Flight World's Build Mode.

**Borrow:** the tight build → fly → iterate loop (Test Fly already covers
this — keep it one click).

## The one design system (replaces the six skins)

Current problem: lime, graphite, cream/hangar, Studio, v2 and workshop-redesign
CSS blocks all fight with `!important`. Target:

- **Tokens (CSS custom properties):** `--color-bg`, `--color-panel`,
  `--color-text`, `--color-accent`, `--color-danger`, spacing scale
  (4/8/12/16/24), radius scale, type scale, elevation shadows.
- **Components:** button (default/primary/danger/ghost), tab, input, select,
  panel, list row, tooltip, tree row (with caret), badge.
- **Layout:** ribbon top; left Toolbox (category icons + search + drag with
  ghost preview); center viewport with floating transform toolbar, view cube,
  snap controls; right dock Explorer (drag-and-drop reparenting, eye/lock
  toggles, rename, multi-select) + Properties; bottom status/output bar.
- **Interactions:** keyboard shortcut overlay (?), right-click context menu,
  undo/redo history list, empty states.
- **Responsive:** 44px touch targets, no horizontal scrolling on phone/tablet.
- **Icons:** one inline SVG set, no decorative emoji.
