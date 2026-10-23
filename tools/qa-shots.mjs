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
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// open build mode straight from the main menu (programmatic click — overlays intercept real clicks)
await page.evaluate(() => document.getElementById('menuBuild').click());
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/buildmode-empty.png' });

// place a part: pick a fuselage from the toolbox, then click on the canvas
const palette = page.locator('.workshop-palette-item');
console.log('palette items:', await palette.count());
if (await palette.count()) {
  await palette.first().click();
  await page.waitForTimeout(400);
  const canvas = page.locator('#workshopCanvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  // select the part via explorer if not selected
  const treeItem = page.locator('#fwExplorerTree .fw-tree-item');
  if (await treeItem.count()) { await treeItem.first().click(); await page.waitForTimeout(400); }
}
await page.screenshot({ path: 'shots/buildmode-part.png' });

// computed styles audit: accent colors actually applied
const audit = await page.evaluate(() => {
  const cs = id => { const el = document.querySelector(id); if (!el) return null; const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, border: s.borderColor }; };
  return {
    ribbonBtn: cs('#workshopSelectTool'),
    eyebrowToolbox: cs('.workshop-library .workshop-eyebrow'),
    paletteItem: cs('.workshop-palette-item'),
    eyebrowProperties: cs('#fwProperties .workshop-eyebrow'),
    propTitle: cs('.fw-prop-title'),
    selectedType: cs('.workshop-selected-type'),
    numInput: cs('.workshop-number-grid input'),
    actionBtn: cs('.workshop-inspector-actions button'),
    explorerItem: cs('#fwExplorerTree .fw-tree-item'),
    search: cs('#workshopSearch'),
  };
});
console.log(JSON.stringify(audit, null, 1));
await browser.close();
server.close();
