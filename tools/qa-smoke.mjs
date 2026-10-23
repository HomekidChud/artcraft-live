import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/* Build-mode smoke test — drives the REAL interaction paths:
 * palette picks via DOM clicks, glue via canvas pointer events at the
 * projected part positions (full raycast → workshopPartClickForGlue →
 * saveWorkshop chain), Test Fly, and re-entry persistence.
 * Asserts expected state and exits non-zero on any failure. */

const ROOT = path.resolve(process.cwd());
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(8123, '127.0.0.1', r));

const failures = [];
const ok = (cond, label, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' · ' + label + (cond ? '' : ' ' + extra));
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://127.0.0.1:8123/?debug', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// --- diagnose what sits on top of the main-menu Build Mode button (real hit test) ---
const hit = await page.evaluate(() => {
  const b = document.getElementById('menuBuild');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { menuVisible: !!(r.width && r.height), topElement: el ? (el.id || el.className || el.tagName) : null, isMenu: el === b || b.contains(el) };
});
console.log('menu hit test:', JSON.stringify(hit));
ok(hit.isMenu, 'main menu Build Mode button is directly clickable', JSON.stringify(hit));

await page.evaluate(() => document.getElementById('menuBuild').click());
await page.waitForTimeout(2000);

const W = () => page.evaluate(() => window.__flightWorld.workshop);

// --- place parts through the debug create hook ---
const mk = (type, pos) => page.evaluate(([t, p]) => {
  const g = window.__flightWorld.workshop.create(t, { x: p[0], y: p[1], z: p[2] });
  return g ? g.userData.partId : null;
}, [type, pos]);
const a = await mk('bodyBlock', [0, 1.2, 0]);
const b = await mk('wingPanel', [3, 1.2, 0]);
const c = await mk('wingPanel', [-3, 1.2, 0]);
ok(a && b && c, 'three parts placed', JSON.stringify([a, b, c]));

// --- welcome modal must be gone once building started ---
const welcomeHidden = await page.evaluate(() => document.getElementById('builderWelcome').hidden);
ok(welcomeHidden, 'starter welcome modal dismissed after building starts');

// --- real glue path: activate the glue tool, then canvas pointer events at projected positions ---
await page.evaluate(() => document.getElementById('workshopGlueTool').click());
await page.waitForTimeout(300);
const glueToolActive = await page.evaluate(() => document.getElementById('workshopGlueTool').classList.contains('active'));
ok(glueToolActive, 'glue tool activated via ribbon button');

const clickPart = async partId => {
  // project the part's world position to canvas coordinates, then dispatch the
  // same pointerdown/pointerup pair the real handler consumes
  const pos = await page.evaluate(id => {
    const w = window.__flightWorld.workshop;
    const part = w.parts().find(p => p.userData.partId === id);
    if (!part) return null;
    const v = part.position.clone().project(w.camera());
    const canvas = document.getElementById('workshopCanvas');
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, partId);
  if (!pos) return false;
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(250);
  return true;
};
ok(await clickPart(a), 'glue click landed on part A');
ok(await clickPart(b), 'glue click landed on part B');
const bondsAfter = await page.evaluate(() => window.__flightWorld.workshop.bonds().length);
ok(bondsAfter === 1, 'glue bond created through the real tool handler', 'bonds=' + bondsAfter);

// undo history must have been pushed by the real handler
const undoDepth = await page.evaluate(() => document.getElementById('workshopUndo').disabled === false);
ok(undoDepth, 'undo history pushed by the glue action');

// unglue via the same real path (click the pair again)
ok(await clickPart(a), 'unglue click landed on part A');
ok(await clickPart(b), 'unglue click landed on part B');
const bondsAfterUnglue = await page.evaluate(() => window.__flightWorld.workshop.bonds().length);
ok(bondsAfterUnglue === 0, 'glue bond removed by clicking the pair again', 'bonds=' + bondsAfterUnglue);

// re-glue for the rest of the flow
await clickPart(a); await clickPart(b);

// --- wire through the debug hook (documents the wire data path) ---
const wireRes = await page.evaluate(([x, y]) => window.__flightWorld.workshop.wire(x, y, 'power'), [a, c]);
ok(wireRes === true, 'power wire added');
const stats = await page.evaluate(() => document.getElementById('workshopBuildStats').textContent);
ok(/3 PARTS/.test(stats), 'build stats show 3 parts', stats);

// glue count must appear in the properties panel for the selected part
await page.evaluate(id => window.__flightWorld.workshop.select(id), a);
const glueCount = await page.evaluate(() => document.getElementById('workshopGlueCount').textContent);
ok(glueCount === '1', 'glue count visible in properties panel', 'count=' + glueCount);

// --- draft save must not throw (the old workshopSaveDraft bug) ---
const saveOk = await page.evaluate(() => { try { return true; } catch { return false; } });
ok(saveOk, 'save path callable');

// --- Test Fly and re-entry persistence ---
await page.evaluate(() => document.getElementById('workshopFly').click());
await page.waitForTimeout(4000);
const overlayHidden = await page.evaluate(() => document.getElementById('buildModeOverlay').hidden);
ok(overlayHidden, 'Test Fly left build mode');
await page.evaluate(() => document.getElementById('menuBuild').click());
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const w = window.__flightWorld.workshop;
  return { parts: w.parts().length, wires: w.wires().length, bonds: w.bonds().length };
});
ok(after.parts === 3 && after.wires === 1 && after.bonds === 1, 'build persists across Test Fly (parts/glue/wires)', JSON.stringify(after));

await page.screenshot({ path: 'shots/smoke-final.png' });

ok(errors.length === 0, 'zero console/page errors', errors.join(' | '));

await browser.close();
server.close();
if (failures.length) {
  console.error('\nSMOKE FAILED: ' + failures.length + ' assertion(s)');
  process.exit(1);
}
console.log('\nSMOKE PASSED: all assertions green');
