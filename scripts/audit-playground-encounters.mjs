import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/physica-encounters';
await mkdir(out, { recursive: true });
const scene = { schema_version: '1', id: 'meeting-audit', revision: 1, gravity: 10,
  surfaces: [{ kind: 'ground', id: 'ground', y: 0 }],
  particles: [
    { id: 'P', position: { x: 0, y: 50 }, velocity: { x: 2, y: 0 }, launch_set: true },
    { id: 'Q', position: { x: 6, y: 45 }, velocity: { x: -2, y: -10 }, launch_set: true, launch_time: 1 },
  ], annotations: [], measurements: [] };
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3000/playground');
    const canvas = page.locator('canvas[data-framed=true]');
    await canvas.waitFor();
    const load = async value => {
      const response = page.waitForResponse(r => r.url().endsWith('/v1/simulations/scene'));
      await page.getByLabel('Scene file', { exact: true }).setInputFiles({ name: 'meeting.json',
        mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
      assert.equal((await response).status(), 200);
      await page.getByRole('region', { name: 'Free-flight meetings' }).waitFor();
      await page.waitForTimeout(300);
    };
    await load(scene);
    const camera = await canvas.getAttribute('data-camera');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Jump to P and Q meeting', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(Number(await canvas.getAttribute('data-scene-time')), 2);
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
    const particles = JSON.parse(await canvas.getAttribute('data-particles'));
    for (const p of particles) assert.deepEqual(p.position, { x: 4, y: 30 });
    assert.equal(await canvas.getAttribute('data-camera'), camera);
    assert.equal(await page.getByTestId('encounter-0').getAttribute('data-active'), 'true');
    await page.getByLabel('Particle', { exact: true }).selectOption('Q');
    assert.equal(Number(await canvas.getAttribute('data-scene-time')), 2);
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const render = await canvas.evaluate(c => {
      const copy = document.createElement('canvas'); copy.width=c.width; copy.height=c.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(c,0,0);
      const d=ctx.getImageData(0,0,c.width,c.height).data;
      let ink=0;
      for(let i=0;i<d.length;i+=4) if(Math.abs(d[i]-d[0])+Math.abs(d[i+1]-d[1])+Math.abs(d[i+2]-d[2])>24) ink++;
      const labels=[...document.querySelectorAll('[data-audit-scene-label]')].map(e=>e.getBoundingClientRect());
      return { ink, overflow: document.documentElement.scrollWidth>innerWidth,
        overlap: labels.some((a,i)=>labels.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)) };
    });
    assert.ok(render.ink>100); assert.equal(render.overflow,false); assert.equal(render.overlap,false);
    await page.screenshot({ path: `${out}/meeting-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const after=JSON.parse(await canvas.getAttribute('data-particles'));
    assert.ok(after[0].position.x>after[1].position.x);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('encounter-0').getAttribute('data-active'), 'false');
    await page.getByLabel('Selected launch time (s)', { exact: true }).fill('300');
    await page.getByRole('button', { name: 'Set launch time', exact: true }).click();
    await page.getByText('No meetings during overlapping flights.', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('encounter-0').count(), 0);
    const together=structuredClone(scene);
    together.particles[1]={...structuredClone(together.particles[0]), id:'Q'};
    await load(together);
    await page.getByRole('button', { name: 'Jump to P and Q interval end', exact: true }).click();
    await page.waitForTimeout(100);
    assert.ok(Number(await canvas.getAttribute('data-scene-time'))>3);
    await page.getByRole('button', { name: 'Jump to P and Q interval start', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(Number(await canvas.getAttribute('data-scene-time')),0);
    assert.deepEqual(errors, []);
    results.push({ width, render, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));
console.log(`PASS desktop/mobile exact meeting jumps, pause/resume, reset, schedule invalidation and coincident intervals: ${out}`);
