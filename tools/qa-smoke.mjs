import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(8123, '127.0.0.1', r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://127.0.0.1:8123/?debug', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById('menuBuild').click());
await page.waitForTimeout(2000);

// helper: use the ?debug workshop API (same code paths as the tools)
const place = async (type, pos) => page.evaluate(([t, p]) => {
  const g = window.__flightWorld.workshop.create(t, { x: p[0], y: p[1], z: p[2] });
  return g ? { id: g.userData.partId, type: g.userData.typeId } : null;
}, [type, pos]);

const a = await place('bodyBlock', [0, 1.2, 0]);
const b = await place('wingPanel', [3, 1.2, 0]);
const c = await place('wingPanel', [-3, 1.2, 0]);
console.log('placed:', JSON.stringify([a, b, c]));

// select part a and check the inspector shows it
await page.evaluate(id => window.__flightWorld.workshop.select(id), a.id);
const selInfo = await page.evaluate(() => ({
  fieldsHidden: document.getElementById('workshopInspectorFields').hidden,
  type: document.getElementById('workshopSelectedType').textContent,
  mass: document.getElementById('workshopPartMass').textContent,
}));
console.log('inspector after select:', JSON.stringify(selInfo));

// glue a+b via the debug hook (same path as the glue tool)
const glueRes = await page.evaluate(([x, y]) => window.__flightWorld.workshop.glue(x, y), [a.id, b.id]);
console.log('glue:', JSON.stringify(glueRes));
const glueCount = await page.evaluate(() => document.getElementById('workshopGlueCount').textContent);
console.log('glue count in properties:', glueCount);

// wire a -> c
const wireRes = await page.evaluate(([x, y]) => window.__flightWorld.workshop.wire(x, y, 'power'), [a.id, c.id]);
console.log('wire:', JSON.stringify(wireRes));
const stats = await page.evaluate(() => document.getElementById('workshopBuildStats').textContent);
console.log('build stats:', stats);

// switch to advanced builder so engineering panel renders, check for text overflow
await page.evaluate(() => document.getElementById('builderAdvanced').click());
await page.waitForTimeout(400);
const engText = await page.evaluate(() => {
  const el = document.getElementById('workshopEngineering');
  return el ? el.textContent.slice(0, 90) : 'not present';
});
console.log('engineering panel:', engText);

await page.screenshot({ path: 'shots/smoke-build.png' });

// Test Fly
await page.evaluate(() => document.getElementById('workshopFly').click());
await page.waitForTimeout(4000);
const overlayHidden = await page.evaluate(() => document.getElementById('buildModeOverlay').hidden);
const hudAlt = await page.evaluate(() => document.getElementById('alt').textContent);
console.log('after Test Fly: overlay hidden =', overlayHidden, '| alt =', hudAlt);
await page.screenshot({ path: 'shots/smoke-fly.png' });

// re-enter build mode, verify persistence of parts + glue + wires
await page.evaluate(() => document.getElementById('menuBuild').click());
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const w = window.__flightWorld.workshop;
  return {
    parts: w.parts().length,
    wires: w.wires().length,
    glueBonds: w.bonds().length,
    stats: document.getElementById('workshopBuildStats').textContent,
  };
});
console.log('re-open build mode:', JSON.stringify(after));
await page.screenshot({ path: 'shots/smoke-rebuild.png' });

console.log('--- errors during session ---');
console.log(errors.length ? errors.join('\n') : 'none');
await browser.close();
server.close();
