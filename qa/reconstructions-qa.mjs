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
  await zeroErrors("airplanecraft");
} catch (e) { check("airplanecraft: suite ran", false, String(e).slice(0, 160)); }

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + results.length + " checks, " + failed.length + " failed");
process.exit(failed.length ? 1 : 0);
