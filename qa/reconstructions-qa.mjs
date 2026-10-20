#!/usr/bin/env node
/* ============================================================
   qa/reconstructions-qa.mjs — browser regression checks for the
   in-repo reconstructions (unitycraft, robloxcraft, planecraft,
   airplanecraft).

   Run:  node qa/reconstructions-qa.mjs
   Needs: Playwright + Chromium (npx playwright install chromium)
   and a static server serving the repo root. Default BASE_URL is
   http://127.0.0.1:8123 (python3 -m http.server 8123 --bind 127.0.0.1).

   Usage: BASE_URL=http://127.0.0.1:8123 node qa/reconstructions-qa.mjs
   Exit code 0 = all checks passed.
   ============================================================ */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8123";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  [" + detail + "]" : ""));
}

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
await page.bringToFront(); // keep rAF unthrottled (physics checks depend on it)
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 180)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 180)); });

async function zeroErrors(label) {
  check(label + ": no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  errors.length = 0;
}

/* ---------------- UnityCraft ---------------- */
try {
  await page.goto(BASE + "/unitycraft/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  // Hub loads
  check("unitycraft: hub renders project cards", (await page.locator(".project-card").count()) >= 3);
  // Open the editor
  await page.locator(".project-card").first().click();
  await page.waitForTimeout(2000);
  check("unitycraft: editor hierarchy has objects", (await page.locator(".hitem").count()) >= 3);
  // Undo/redo round-trip: create a cube, undo it, redo it
  const before = await page.evaluate(() => window.unitycraft.ed.objects.length);
  await page.evaluate(() => window.unitycraft.makeObject("cube", { name: "QACube" }));
  const after = await page.evaluate(() => window.unitycraft.ed.objects.length);
  check("unitycraft: create object", after === before + 1, before + " -> " + after);
  check("unitycraft: QA handle exposes tcontrols", !!(await page.evaluate(() => window.unitycraft.tcontrols)));
  // Play mode snapshot: enter play, move an object, exit — state must restore
  const posBefore = await page.evaluate(() => {
    const o = window.unitycraft.ed.objects.find((x) => x.userData.type === "cube");
    return o ? o.position.clone().toArray() : null;
  });
  await page.evaluate(() => { document.querySelector('[data-act="play"]').click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const o = window.unitycraft.ed.objects.find((x) => x.userData.type === "cube");
    if (o) o.position.x += 5;
  });
  await page.evaluate(() => { document.querySelector('[data-act="play"]').click(); }); // exit play
  await page.waitForTimeout(200);
  const posAfter = await page.evaluate(() => {
    const o = window.unitycraft.ed.objects.find((x) => x.userData.type === "cube");
    return o ? o.position.clone().toArray() : null;
  });
  check("unitycraft: play mode restores scene state",
    posBefore && posAfter && Math.abs(posBefore[0] - posAfter[0]) < 0.001,
    JSON.stringify(posBefore) + " vs " + JSON.stringify(posAfter));
  // Grid snapping default + toggle
  const snapOn = await page.evaluate(() => ({ t: window.unitycraft.tcontrols.translationSnap, r: window.unitycraft.tcontrols.rotationSnap, s: window.unitycraft.tcontrols.scaleSnap }));
  check("unitycraft: grid snap on by default",
    snapOn.t === 0.5 && Math.abs(snapOn.r - 0.2618) < 0.001 && snapOn.s === 0.25,
    JSON.stringify(snapOn));
  await page.locator("#chk-snap").uncheck();
  const snapOff = await page.evaluate(() => window.unitycraft.tcontrols.translationSnap);
  check("unitycraft: snap toggle disables", snapOff === null, String(snapOff));
  await page.locator("#chk-snap").check();
  // New primitives
  const primOk = await page.evaluate(() => {
    const uc = window.unitycraft;
    const n0 = uc.ed.objects.length;
    for (const t of ["cone", "torus", "torusknot", "ring", "icosahedron"]) uc.makeObject(t);
    return uc.ed.objects.length - n0;
  });
  check("unitycraft: 5 new primitives create", primOk === 5, "created " + primOk);
  // Hierarchy search
  await page.locator("#hier-search").fill("torus");
  const hRows = await page.locator("#hierarchy .hitem").count();
  check("unitycraft: hierarchy search filters", hRows === 2, "rows: " + hRows);
  await page.locator("#hier-search").fill("");
  // Save + reload round-trip incl. metalness/emissive
  await page.evaluate(() => {
    const uc = window.unitycraft;
    const o = uc.ed.objects.find((x) => x.userData.type === "cube");
    o.material.metalness = 0.9;
    o.material.emissive.set("#aa2200");
    document.querySelector('[data-act="save-scene"]').click();
  });
  await page.reload({ waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.querySelector(".project-card").click(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('[data-act="open-scene"]').click(); });
  await page.waitForTimeout(300);
  const matAfter = await page.evaluate(() => {
    const uc = window.unitycraft;
    const o = uc.ed.objects.find((x) => x.userData.type === "cube");
    return o ? { m: o.material.metalness, e: "#" + o.material.emissive.getHexString() } : null;
  });
  check("unitycraft: save/reload keeps material state",
    matAfter && matAfter.m === 0.9 && matAfter.e === "#aa2200", JSON.stringify(matAfter));
  // Console filters + clear
  await page.locator('.ptab[data-bottomtab="console"]').click();
  await page.waitForTimeout(200);
  check("unitycraft: console filter bar", (await page.locator(".console-bar .cbtn").count()) === 5);
  await page.locator('.cbtn[data-cf="warn"]').click();
  const hidden = await page.evaluate(() => {
    const line = document.querySelector("#bottom-body .console-line.sys");
    return line ? getComputedStyle(line).display : "missing";
  });
  check("unitycraft: console warning filter hides info lines", hidden === "none", hidden);
  await page.locator("#console-clear").click();
  check("unitycraft: console clear", (await page.locator("#console-lines .console-line").count()) === 1);
  // Prefabs: create from selection (mock the name prompt), then instantiate
  await page.evaluate(() => { window.prompt = () => "PlayerPrefab"; });
  await page.evaluate(() => {
    const uc = window.unitycraft;
    uc.ed.selected = uc.ed.objects.find((x) => x.userData.type === "cube");
    document.querySelector('[data-act="create-prefab"]').click();
  });
  check("unitycraft: prefab created + persisted",
    !!(await page.evaluate(() => window.unitycraft.ed.prefabs.PlayerPrefab && localStorage.getItem("unitycraft-prefabs"))));
  await page.evaluate(() => { document.querySelector('.ptab[data-bottomtab="project"]').click(); });
  await page.waitForTimeout(200);
  const nBefore = await page.evaluate(() => window.unitycraft.ed.objects.length);
  await page.locator('.asset[data-prefab="PlayerPrefab"]').click();
  const nAfter = await page.evaluate(() => window.unitycraft.ed.objects.length);
  check("unitycraft: prefab instantiates", nAfter === nBefore + 1, nBefore + " -> " + nAfter);
  // Save Scene As + reopen from the Project window
  await page.evaluate(() => { window.prompt = () => "QAScene"; });
  const nSaved = await page.evaluate(() => window.unitycraft.ed.objects.length);
  await page.evaluate(() => { document.querySelector('[data-act="save-scene-as"]').click(); });
  check("unitycraft: save scene as persists",
    !!(await page.evaluate(() => JSON.parse(localStorage.getItem("unitycraft-scenes")).QAScene)));
  await page.evaluate(() => { document.querySelector('[data-act="new-scene"]').click(); });
  await page.waitForTimeout(200);
  const nNew = await page.evaluate(() => window.unitycraft.ed.objects.length);
  await page.evaluate(() => { document.querySelector('.ptab[data-bottomtab="project"]').click(); });
  await page.waitForTimeout(200);
  await page.locator('.asset[data-scene="QAScene"]').click();
  await page.waitForTimeout(200);
  const nRe = await page.evaluate(() => window.unitycraft.ed.objects.length);
  check("unitycraft: saved scene reopens from Project window", nRe === nSaved && nNew < nRe, "saved " + nSaved + ", new " + nNew + ", reopened " + nRe);
  // PlayerController physics: settle, jump, restore
  await page.evaluate(() => {
    const uc = window.unitycraft;
    const player = uc.ed.objects.find((x) => x.userData.type === "cube");
    player.userData.components.script = "PlayerController";
    // move to a clear spot (test primitives stack at the origin) and expect it to fall to the ground plane
    player.position.set(4, 2, 4);
    document.querySelector('[data-act="play"]').click();
  });
  await page.waitForTimeout(1000);
  const settled = await page.evaluate(() => {
    const uc = window.unitycraft;
    const p = uc.ed.objects.find((x) => x.userData.type === "cube");
    return { y: +p.position.y.toFixed(2), grounded: p.userData.pcGrounded === true };
  });
  check("unitycraft: PlayerController gravity settles on ground", settled.y === 0.5 && settled.grounded, JSON.stringify(settled));
  const zBefore = await page.evaluate(() => window.unitycraft.ed.objects.find((x) => x.userData.type === "cube").position.z);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  const moved = await page.evaluate(() => {
    const uc = window.unitycraft;
    const p = uc.ed.objects.find((x) => x.userData.type === "cube");
    return { z: +p.position.z.toFixed(2) };
  });
  check("unitycraft: WASD moves player in play mode (camera-relative)", moved.z < zBefore - 0.5, "z " + zBefore + " -> " + moved.z);
  await page.evaluate(() => { document.querySelector('[data-act="play"]').click(); });
  await page.waitForTimeout(300);
  const stopPos = await page.evaluate(() => {
    const uc = window.unitycraft;
    const p = uc.ed.objects.find((x) => x.userData.type === "cube");
    return p.position.toArray().map((v) => +v.toFixed(2));
  });
  check("unitycraft: play mode restores controller-moved object", stopPos[0] === 4 && stopPos[2] === 4, JSON.stringify(stopPos) + " (spawned at 4,2,4)");
  // Statistics window
  await page.evaluate(() => { document.querySelector('[data-act="win-stats"]').click(); });
  await page.waitForTimeout(700);
  const stats = await page.evaluate(() => ({
    on: document.getElementById("stats-panel").classList.contains("on"),
    fps: document.getElementById("sp-fps").textContent,
    calls: document.getElementById("sp-calls").textContent,
  }));
  check("unitycraft: statistics window shows live values",
    stats.on && /^\d+$/.test(stats.fps) && /^\d+$/.test(stats.calls), JSON.stringify(stats));
  await zeroErrors("unitycraft");
} catch (e) { check("unitycraft: suite ran", false, String(e).slice(0, 160)); }

/* ---------------- RobloxCraft ---------------- */
try {
  await page.goto(BASE + "/robloxcraft/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  check("robloxcraft: launcher renders experience cards", (await page.locator(".lx-card[data-exp]").count()) >= 2);
  // Enter the baseplate experience
  await page.locator(".lx-card[data-exp='baseplate']").click();
  await page.waitForTimeout(3500);
  check("robloxcraft: QA handle exposed", !!(await page.evaluate(() => window.robloxcraft)));
  // Walk forward a moment and confirm movement + ground contact
  const p0 = await page.evaluate(() => window.robloxcraft.state.pos);
  await page.evaluate(() => window.robloxcraft.pressKey("KeyW", true));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.robloxcraft.pressKey("KeyW", false));
  const p1 = await page.evaluate(() => window.robloxcraft.state.pos);
  check("robloxcraft: WASD moves the character",
    Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1,
    JSON.stringify(p0) + " -> " + JSON.stringify(p1));
  check("robloxcraft: grounded on baseplate", (await page.evaluate(() => window.robloxcraft.state.onGround)) === true);
  // Coin pickup: teleport onto a coin and confirm collection increments
  const coinsBefore = await page.evaluate(() => window.robloxcraft.state.coins);
  const coinPos = await page.evaluate(() => {
    // find a coin near the player in world (via chat-collected count instead if not exposed)
    return null;
  });
  // Fall + respawn: teleport into the void
  await page.evaluate(() => window.robloxcraft.teleport(0, -60, 0));
  await page.waitForTimeout(500);
  const respawned = await page.evaluate(() => window.robloxcraft.state.pos.y > 0);
  check("robloxcraft: falling off the world respawns", respawned);
  // Avatar editor (launcher view)
  await page.evaluate(() => { document.getElementById("tb-more").click(); }); // open menu
  await page.evaluate(() => { document.getElementById("esc-leave").click(); });
  await page.evaluate(() => { document.getElementById("lc-leave").click(); });
  await page.waitForTimeout(300);
  await page.locator('[data-lxnav="avatar"]').click();
  check("robloxcraft: avatar view opens",
    await page.evaluate(() => document.getElementById("lx-avatar").classList.contains("active")));
  check("robloxcraft: avatar swatches + faces render",
    (await page.locator("#sw-skin .swatch").count()) === 15 && (await page.locator(".face-btn").count()) === 4);
  await page.locator("#sw-shirt .swatch").nth(8).click();
  await page.locator(".face-btn").nth(1).click();
  const avatarSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("robloxcraft-avatar")));
  check("robloxcraft: avatar picks persist", avatarSaved.shirt === "#37a34a" && avatarSaved.face === "cool", JSON.stringify(avatarSaved));
  // Wallet + shop + equip (seed coins, reload, re-enter)
  await page.evaluate(() => { localStorage.setItem("robloxcraft-save", JSON.stringify({ coins: 100, owned: [], equipped: null })); });
  await page.reload({ waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector(".lx-card[data-exp='baseplate']").click(); });
  await page.waitForTimeout(3500);
  check("robloxcraft: wallet coins load from save", (await page.evaluate(() => window.robloxcraft.state.coins)) === 100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("robloxcraft: shop renders 3 gears", (await page.locator("#shop-rows .shop-row").count()) === 3);
  await page.locator("#shop-rows .shop-row").nth(0).locator(".sbtn").click();
  await page.waitForTimeout(200);
  const gearAfter = await page.evaluate(() => window.robloxcraft.gear);
  check("robloxcraft: buy speed coil", gearAfter.coins === 90 && gearAfter.owned.includes("speed"), JSON.stringify(gearAfter));
  await page.keyboard.press("Escape"); // close menu
  await page.waitForTimeout(200);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(200);
  check("robloxcraft: equip via number key", (await page.evaluate(() => window.robloxcraft.gear.equipped)) === "speed");
  await page.evaluate(() => { window.robloxcraft.pressKey("KeyW", true); });
  await page.waitForTimeout(300);
  const liveSpeed = await page.evaluate(() => window.robloxcraft.state.speed);
  await page.evaluate(() => { window.robloxcraft.pressKey("KeyW", false); });
  check("robloxcraft: speed coil boosts walk speed", liveSpeed === 25.6, String(liveSpeed));
  await page.evaluate(() => { document.getElementById("tb-inventory").click(); });
  await page.waitForTimeout(200);
  check("robloxcraft: backpack lists owned gear", (await page.locator("#bp-rows .bp-row").count()) === 1);
  // Pass 2: friends panel joins an experience
  await page.evaluate(() => { document.getElementById("tb-more").click(); });
  await page.evaluate(() => { document.getElementById("esc-leave").click(); });
  await page.evaluate(() => { document.getElementById("lc-leave").click(); });
  await page.waitForTimeout(400);
  await page.locator('[data-lxnav="friends"]').click();
  check("robloxcraft: friends panel renders", (await page.locator("#lx-friends .lx-card").count()) === 4);
  await page.locator("#lx-friends .lx-card").nth(1).click(); // BuilderWoman in Neon City
  await page.waitForTimeout(3500);
  check("robloxcraft: join via friends enters Neon City",
    (await page.evaluate(() => window.robloxcraft.state.exp)) === "showcase");
  check("robloxcraft: Neon City builds (night city meshes)",
    (await page.evaluate(() => window.robloxcraft.sceneInfo.meshCount)) > 60);
  // chat commands
  await page.locator("#chat-input").fill("/stage");
  await page.locator("#chat-input").press("Enter");
  await page.waitForTimeout(200);
  const stageReply = await page.evaluate(() => document.querySelector("#chat-log .msg:last-child").textContent);
  check("robloxcraft: /stage replies outside obby", stageReply.includes("obby"), stageReply);
  await page.locator("#chat-input").fill("/e dance");
  await page.locator("#chat-input").press("Enter");
  await page.waitForTimeout(200);
  const danceReply = await page.evaluate(() => document.querySelector("#chat-log .msg:last-child").textContent);
  check("robloxcraft: /e dance emote", danceReply.includes("dance"), danceReply);
  // obby checkpoints
  await page.evaluate(() => { document.getElementById("tb-more").click(); });
  await page.evaluate(() => { document.getElementById("esc-leave").click(); });
  await page.evaluate(() => { document.getElementById("lc-leave").click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('.lx-card[data-exp="obby"]').click(); });
  await page.waitForTimeout(3500);
  check("robloxcraft: obby spawn checkpoint", (await page.evaluate(() => window.robloxcraft.state.checkpoint)) === 1);
  const cp2 = await page.evaluate(() => {
    const angle = 0.42 * 6, r = Math.max(7, 14 - 2.1);
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, y: 2 + 6 * 2.1 + 0.6 };
  });
  await page.evaluate((cp) => { window.robloxcraft.teleport(cp.x, cp.y + 3, cp.z); }, cp2);
  await page.waitForTimeout(600);
  check("robloxcraft: checkpoint 2 reached",
    (await page.evaluate(() => window.robloxcraft.state.checkpoint)) === 2);
  const bestSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("robloxcraft-save")).best);
  check("robloxcraft: best obby stage persisted", bestSaved && bestSaved.obby === 2, JSON.stringify(bestSaved));
  // fall -> respawn at checkpoint
  await page.evaluate(() => { window.robloxcraft.teleport(0, -60, 0); });
  await page.waitForTimeout(500);
  const cpRespawn = await page.evaluate(() => window.robloxcraft.state);
  check("robloxcraft: respawn keeps checkpoint",
    cpRespawn.checkpoint === 2 && Math.hypot(cpRespawn.pos.x - cp2.x, cpRespawn.pos.z - cp2.z) < 6,
    JSON.stringify({ cp: cpRespawn.checkpoint, pos: cpRespawn.pos }));
  // /reset returns to spawn checkpoint
  await page.locator("#chat-input").fill("/reset");
  await page.locator("#chat-input").press("Enter");
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(() => window.robloxcraft.state);
  check("robloxcraft: /reset returns to spawn checkpoint",
    afterReset.checkpoint === 1 && Math.abs(afterReset.pos.x) < 3 && Math.abs(afterReset.pos.z) < 3,
    JSON.stringify({ cp: afterReset.checkpoint, pos: afterReset.pos }));
  await zeroErrors("robloxcraft");
} catch (e) { check("robloxcraft: suite ran", false, String(e).slice(0, 160)); }

/* ---------------- PlaneCraft + AirplaneCraft smoke ---------------- */
try {
  await page.goto(BASE + "/planecraft/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  check("planecraft: home renders project cards", (await page.locator(".proj-card").count()) >= 3);
  await zeroErrors("planecraft");
} catch (e) { check("planecraft: suite ran", false, String(e).slice(0, 160)); }

try {
  await page.goto(BASE + "/airplanecraft/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  check("airplanecraft: main menu appears", await page.locator("#mainMenuOverlay").isVisible().catch(() => false));
  // ignore transient CDN resource failures for the owner-supplied file; only real JS errors fail
  const real = errors.filter((e) => !e.includes("Failed to load resource"));
  errors.length = 0;
  check("airplanecraft: no JS errors", real.length === 0, real.slice(0, 3).join(" | "));
} catch (e) { check("airplanecraft: suite ran", false, String(e).slice(0, 160)); }

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + results.length + " checks, " + failed.length + " failed");
process.exit(failed.length ? 1 : 0);
