import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/physica-launch-times';
await mkdir(out, { recursive: true });
const scene = { schema_version: '1', id: 'delayed-audit', revision: 1, gravity: 10,
  surfaces: [{ kind: 'ground', id: 'ground', y: 0 }],
  particles: [
    { id: 'P', position: { x: 0, y: 5 }, velocity: { x: 2, y: 0 }, launch_set: true, launch_time: 1.5 },
    { id: 'Q', position: { x: 10, y: 20 }, velocity: { x: -3, y: 0 }, launch_set: true },
  ], annotations: [{ target: 'P', quantity: 'velocity' }], measurements: [] };
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
    const imported = page.waitForResponse(r => r.url().endsWith('/v1/simulations/scene'));
    await page.getByLabel('Scene file', { exact: true }).setInputFiles({ name: 'delayed.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
    assert.equal((await imported).status(), 200);
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles ?? '[]').length === 2);
    const states = async () => JSON.parse(await canvas.getAttribute('data-particles'));
    const time = async () => Number(await canvas.getAttribute('data-scene-time'));
    const slider = page.getByLabel('Simulation time', { exact: true });
    const scrub = async fraction => {
      await slider.scrollIntoViewIfNeeded();
      const box = await slider.boundingBox();
      await page.mouse.click(box.x+box.width*fraction, box.y+box.height/2);
      await page.waitForTimeout(150);
      return time();
    };
    assert.ok(Math.abs(Number(await slider.getAttribute('max'))-2.5)<1e-8);
    assert.equal((await states())[0].status, 'Waiting');
    assert.deepEqual((await states())[0].velocity, { x: 0, y: 0 });
    assert.equal(await page.locator('[data-label-id="P-velocity"]').count(), 0);
    const camera = await canvas.getAttribute('data-camera');
    let t = await scrub(.3);
    assert.ok(t < 1.5);
    assert.deepEqual((await states())[0].position, { x: 0, y: 5 });
    assert.ok((await states())[1].position.y < 20);
    await page.getByLabel('Particle', { exact: true }).selectOption('Q');
    await page.waitForTimeout(100);
    assert.equal(await time(), t);
    assert.equal(await canvas.getAttribute('data-camera'), camera);
    await page.getByLabel('Particle', { exact: true }).selectOption('P');
    t = await scrub(.7);
    const p = (await states())[0], age = t-1.5;
    assert.equal(p.status, 'In flight');
    assert.ok(Math.abs(p.position.x-2*age) < .001);
    assert.ok(Math.abs(p.position.y-(5-5*age*age)) < .001);
    assert.ok(Math.abs(p.velocity.y+10*age) < .001);
    await page.locator('[data-label-id="P-velocity"]').waitFor();
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const rendering = await canvas.evaluate(c => {
      const box = c.getBoundingClientRect();
      const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
      const rgba = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set();
      let ink = 0;
      for (let i=0;i<rgba.length;i+=4) if (Math.abs(rgba[i]-rgba[0])+Math.abs(rgba[i+1]-rgba[1])+Math.abs(rgba[i+2]-rgba[2])>24) ink++;
      for (let i=0;i<rgba.length;i+=64) colors.add(`${rgba[i]},${rgba[i+1]},${rgba[i+2]}`);
      const labels = [...document.querySelectorAll('[data-audit-scene-label]')].map(e => e.getBoundingClientRect());
      return { colors: colors.size, ink,
        clipped: labels.some(r => r.left < box.left-1 || r.right > box.right+1 || r.top < box.top-1 || r.bottom > box.bottom+1),
        overlap: labels.some((a,i) => labels.slice(i+1).some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)),
        inFrame: JSON.parse(c.dataset.particles).every(p => p.screen[0]>=0 && p.screen[0]<=box.width && p.screen[1]>=0 && p.screen[1]<=box.height) };
    });
    await page.screenshot({ path: `${out}/delayed-${width}.png`, fullPage: true });
    assert.ok(rendering.ink > 100 && rendering.colors > 5 && rendering.inFrame, JSON.stringify({ width, rendering }));
    assert.equal(rendering.overlap, false); assert.equal(rendering.clipped, false);
    await scrub(.9);
    assert.equal((await states())[0].status, 'In flight');
    assert.equal((await states())[1].status, 'Contact');
    await slider.focus(); await slider.press('End');
    await page.waitForTimeout(100);
    assert.ok((await states()).every(p => p.status === 'Contact'));
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal((await states())[0].status, 'Waiting');
    assert.equal(await page.locator('[data-label-id="P-velocity"]').count(), 0);

    // Editing the schedule resets the clock and persists in the exported scene.
    await page.getByLabel('Particle', { exact: true }).selectOption('Q');
    await page.getByLabel('Selected launch time (s)', { exact: true }).fill('300');
    await page.getByRole('button', { name: 'Set launch time', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="state-Q"]')?.textContent.includes('Waiting'));
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Set launch time')?.disabled);
    assert.equal(await time(), 0);
    assert.equal(Number(await slider.getAttribute('max')), 30);
    for (const [label, value] of [['Initial x (m)', '20'], ['Initial y (m)', '45'], ['New speed (m/s)', '0'], ['New launch time (s)', '2']])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Add particle', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles).length === 3);
    assert.equal((await states()).find(p => p.id === 'P2').status, 'Waiting');
    await slider.focus(); await slider.press('End');
    await page.waitForTimeout(100);
    assert.equal((await states()).find(p => p.id === 'Q').status, 'Waiting');
    assert.equal((await states()).find(p => p.id === 'P2').status, 'Contact');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export scene', exact: true }).click();
    await (await download).saveAs(`${out}/scene-${width}.json`);
    const exported = JSON.parse(await readFile(`${out}/scene-${width}.json`, 'utf8'));
    assert.equal(exported.particles.find(p => p.id === 'P').launch_time, 1.5);
    assert.equal(exported.particles.find(p => p.id === 'Q').launch_time, 300);
    assert.equal(exported.particles.find(p => p.id === 'P2').launch_time, 2);
    assert.deepEqual(errors, []);
    results.push({ width, rendering, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(`PASS delayed-launch playback, vectors, scheduling and export on desktop/mobile: ${out}`);
