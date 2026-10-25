import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PHYSICA_BASE_URL ?? 'http://localhost:3000';
const out = '/tmp/physica-measurements';
await mkdir(out, { recursive: true });
async function api(path, body) {
  const response = await fetch(`${base}/api/playground/v1/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of [
    { name: 'tread', gravity: 9.8, maxTime: 3, face: 'tread:21', drop: 21 },
    { name: 'riser', gravity: 10, maxTime: 3, face: 'riser:21', drop: 20 },
    { name: 'no-contact', gravity: 10, maxTime: 0.5, face: null, drop: null },
  ]) for (const direction of ['right', 'left']) {
    let scene = await api('scenes', { gravity: testCase.gravity });
    scene = await api('scenes/apply', { scene, commands: [
      { op: 'add_surface', surface: { kind: 'staircase', id: 'stairs', origin: { x: 0, y: 0 },
        rise: 1, run: 1, count: 31, depth: 0.5, base_thickness: 0.1, direction } },
      { op: 'add_particle', id: 'P', position: { x: 0, y: 0 } },
      { op: 'set_launch', particle_id: 'P', direction: 'angle', angle_deg: direction === 'right' ? 0 : 180, speed: 10 },
    ] });
    const simulation = await api('simulations', { scene, particle_id: 'P', max_time: testCase.maxTime, samples: 121 });
    const { meshes } = await api('geometry', scene);
    // At (20, -20), tread 20 and riser 21 share an endpoint. Mirroring
    // through 180 degrees can change the tie via floating-point roundoff.
    if (testCase.name === 'riser') {
      assert.ok(['riser:21', 'tread:20'].includes(simulation.contact?.face));
    } else assert.equal(simulation.contact?.face ?? null, testCase.face);
    const [faceKind, step] = (simulation.contact?.face ?? '').split(':');
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/playground/v1/generate', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'review',
          reason: 'Saved deterministic test scene', assumptions: [], report_id: 'measurements', scene, simulation, meshes }),
      }));
      await page.goto(`${base}/playground`);
      await page.locator('canvas[data-framed=true]').waitFor();
      await page.getByLabel('Physics question', { exact: true }).fill('Staircase measurement test');
      await page.getByRole('button', { name: 'Generate scene', exact: true }).click();
      await page.getByText('Step height = 1 m', { exact: true }).waitFor();
      const canvas = page.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      await page.getByRole('slider', { name: 'Simulation time' }).focus();
      await page.getByRole('slider', { name: 'Simulation time' }).press('End');
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const actual = JSON.parse(await canvas.getAttribute('data-particle'));
      const expected = simulation.samples.at(-1).position;
      assert.ok(Math.abs(actual[0] - expected.x) < 1e-8);
      assert.ok(Math.abs(actual[1] - expected.y) < 1e-8);
      for (const text of ['Step height = 1 m', 'Step width = 1 m', ...(testCase.face ? [
        `Drop = ${testCase.drop} m`, `Impact: step ${step}${faceKind === 'riser' ? ' (riser)' : ''}`,
      ] : [])]) {
        await page.getByText(text, { exact: true }).waitFor();
      }
      if (!testCase.face) {
        assert.equal(await page.locator('[data-label-id="stair-drop"]').count(), 0);
        assert.equal(await page.locator('[data-label-id="stair-impact"]').count(), 0);
      }
      const boxes = await page.locator('[data-audit-scene-label]').evaluateAll(elements => elements.map(e => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.labelId, x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      const frame = await canvas.boundingBox();
      for (const [i, a] of boxes.entries()) {
        assert.ok(a.x >= frame.x - 1 && a.x + a.w <= frame.x + frame.width + 1, `clipped label ${a.id}`);
        for (const b of boxes.slice(i + 1)) {
          assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `overlap ${a.id}/${b.id}`);
        }
      }
      const colors = await canvas.evaluate(c => {
        const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
        const ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data, unique = new Set();
        for (let i = 0; i < data.length; i += 4) unique.add(`${data[i]},${data[i+1]},${data[i+2]}`);
        return unique.size;
      });
      assert.ok(colors > 20, 'blank canvas');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${out}/${testCase.name}-${direction}-${width}.png`, fullPage: true });
      await page.close();
    }
  }
  console.log(`PASS left/right staircase, desktop/mobile: contact position, dimension labels, no overlaps, nonblank canvas. ${out}`);
} finally { await browser.close(); }
