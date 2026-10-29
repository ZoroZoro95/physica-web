import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = '/tmp/physica-ensemble';
await mkdir(out, { recursive: true });
const scene = { schema_version: '1', id: 'ensemble-audit', revision: 1, gravity: 10,
  surfaces: [{ kind: 'ground', id: 'ground', y: 0 }],
  particles: [
    { id: 'P', position: { x: 0, y: 5 }, velocity: { x: 2, y: 0 }, launch_set: true },
    { id: 'Q', position: { x: 10, y: 20 }, velocity: { x: -3, y: 0 }, launch_set: true },
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
    const imported = page.waitForResponse(r => r.url().endsWith('/v1/simulations/scene'));
    await page.getByLabel('Scene file', { exact: true }).setInputFiles({ name: 'two.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
    assert.equal((await imported).status(), 200);
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles ?? '[]').length === 2);
    const states = async () => JSON.parse(await canvas.getAttribute('data-particles'));
    const camera = async () => JSON.parse(await canvas.getAttribute('data-camera'));
    const fit = await camera();
    assert.equal((await states()).length, 2);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.ok((await states()).every((p, i) => p.position.y < scene.particles[i].position.y));
    const paused = await canvas.getAttribute('data-scene-time');
    await page.waitForTimeout(150);
    assert.equal(await canvas.getAttribute('data-scene-time'), paused);
    const slider = page.getByLabel('Simulation time', { exact: true });
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width*.75, box.y + box.height/2);
    await page.waitForTimeout(150);
    const t = Number(await canvas.getAttribute('data-scene-time'));
    assert.ok(t > 1.3 && t < 1.7);
    const [p, q] = await states();
    assert.equal(p.status, 'Contact');
    assert.equal(q.status, 'In flight');
    assert.ok(Math.abs(p.position.x-2) < 1e-8 && Math.abs(p.position.y) < 1e-8);
    assert.ok(Math.abs(q.position.x-(10-3*t)) < .001);
    assert.ok(Math.abs(q.position.y-(20-5*t*t)) < .001);
    const captured = await canvas.getAttribute('data-particles');
    await page.getByLabel('Particle', { exact: true }).selectOption('Q');
    await page.waitForTimeout(100);
    assert.equal(await canvas.getAttribute('data-scene-time'), String(t));
    assert.equal(await canvas.getAttribute('data-particles'), captured);
    const switched = await camera();
    for (const key of ['position', 'rotation', 'target'])
      assert.ok(switched[key].every((v, i) => Math.abs(v-fit[key][i]) < 1e-8));
    assert.ok(Math.abs(switched.zoom-fit.zoom) < 1e-8);
    await page.getByLabel('Velocity v', { exact: true }).click();
    await page.waitForSelector('[data-label-id="Q-velocity"]');
    assert.equal(await page.locator('[data-label-id="P-velocity"]').count(), 0);
    assert.equal(await canvas.getAttribute('data-scene-time'), String(t));
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const render = await canvas.evaluate(c => {
      const r = c.getBoundingClientRect();
      const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
      const rgba = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set();
      for (let i = 0; i < rgba.length; i += 64) colors.add(`${rgba[i]},${rgba[i+1]},${rgba[i+2]}`);
      const labels = [...document.querySelectorAll('[data-audit-scene-label]')].map(e => e.getBoundingClientRect());
      const overlap = labels.some((a,i) => labels.slice(i+1).some(b =>
        Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
      return { colors: colors.size, overlap,
        clipped: labels.some(a => a.left < r.left-1 || a.right > r.right+1 || a.top < r.top-1 || a.bottom > r.bottom+1),
        inFrame: JSON.parse(c.dataset.particles).every(p => p.screen[0]>=0 && p.screen[0]<=r.width && p.screen[1]>=0 && p.screen[1]<=r.height),
        overflow: document.documentElement.scrollWidth > innerWidth+1 };
    });
    assert.ok(render.colors > 20 && render.inFrame);
    assert.equal(render.overlap, false); assert.equal(render.clipped, false); assert.equal(render.overflow, false);
    await page.screenshot({ path: `${out}/two-particles-${width}.png`, fullPage: true });
    for (const [label, value] of [['Initial x (m)', '20'], ['Initial y (m)', '45'], ['New speed (m/s)', '0']])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Add particle', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles).length === 3);
    assert.equal(Number(await slider.getAttribute('max')).toFixed(4), '3.0000');
    await slider.focus(); await slider.press('End');
    await page.waitForTimeout(150);
    assert.ok((await states()).every(p => p.status === 'Contact'));
    const last = await canvas.getAttribute('data-particles');
    await page.getByLabel('Initial y (m)', { exact: true }).fill('-1');
    await page.getByRole('button', { name: 'Add particle', exact: true }).click();
    await page.getByTestId('playground-error').waitFor();
    assert.equal(await canvas.getAttribute('data-particles'), last);
    // Generated bundles lack the original request horizon. Preserve their
    // displayed finite horizon when adding a particle, rather than extending it.
    const one = { ...scene, particles: [scene.particles[0]] };
    const validated = await (await page.request.post('http://localhost:3000/api/playground/v1/scenes/validate', { data: one })).json();
    const sim = await (await page.request.post('http://localhost:3000/api/playground/v1/simulations', {
      data: { scene: validated, particle_id: 'P', max_time: .5, samples: 121 } })).json();
    const geometry = await (await page.request.post('http://localhost:3000/api/playground/v1/geometry', { data: validated })).json();
    await page.route('**/api/playground/v1/generate', route => route.fulfill({ json: {
      status: 'review', reason: 'Scripted fixture', assumptions: [], report_id: 'fixture',
      scene: validated, simulation: sim, meshes: geometry.meshes } }));
    await page.getByLabel('Physics question', { exact: true }).fill('Finite horizon test fixture');
    await page.getByRole('button', { name: 'Generate scene', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles).length === 1);
    await page.getByLabel('Initial y (m)', { exact: true }).fill('45');
    await page.getByRole('button', { name: 'Add particle', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('canvas').dataset.particles).length === 2);
    assert.equal(Number(await slider.getAttribute('max')), .5);
    assert.deepEqual(errors, []);
    results.push({ width, render, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(`PASS independent multi-particle timeline, selection, contact markers, labels and add-particle safety: ${out}`);
