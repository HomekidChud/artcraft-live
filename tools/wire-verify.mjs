import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try { const u = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(process.cwd(), u === '/' ? 'index.html' : u);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
server.listen(8142, '127.0.0.1', async () => {
  try {
    const presets = JSON.parse(await readFile('presets-fleet.json'));
    const build = presets[1].data.build;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    await page.goto('http://127.0.0.1:8142/?debug', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.getElementById('menuBuild').click());
    await page.waitForTimeout(1500);
    await page.evaluate(b => { window.__flightWorld.workshop.restore(b); }, build);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('workshopFly').click());
    await page.waitForTimeout(1200);
    // drive the wire sim deterministically: 300 steps @ 60fps = 5s of settling
    const res = await page.evaluate(() => {
      const w = window.__flightWorld;
      for (let i = 0; i < 300; i++) w.wireStep(1 / 60);
      const sims = w.wireSims();
      const cables = w.wireCables();
      const dead = sims.filter(s => s.dead).length;
      const alive = sims.filter(s => !s.dead);
      const ages = alive.map(s => s.age);
      return { total: sims.length, dead, minAge: Math.min(...ages), maxAge: Math.max(...ages),
        totalNodes: alive.reduce((a, s) => a + s.pts, 0), insideNodes: alive.reduce((a, s) => a + (s.inside||0), 0), cables };
    });
    console.log(JSON.stringify(res, null, 1));
    await page.screenshot({ path: 'shots/c172-wire-verify.png', timeout: 60000 });
    await browser.close(); server.close();
  } catch (e) { console.error('FAIL', e && e.message); server.close(); process.exit(1); }
});
