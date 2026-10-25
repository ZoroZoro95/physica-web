import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PHYSICA_BASE_URL ?? 'http://localhost:3000';
const out = '/tmp/physica-dimensions';
await mkdir(out, { recursive: true });
async function api(path, body) {
  const response = await fetch(`${base}/api/playground/v1/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const anchor = (target, feature) => ({ kind: 'object', target, feature });
const distance = (id, label, start, end, axis='direct', side=1) => ({
  op: 'set_measurement', measurement: { kind: 'distance', id, label, start, end, axis, side },
});
const browser = await chromium.launch({ headless: true });
try {
  for (const kind of ['cliff', 'wedge']) {
    let scene = await api('scenes', { gravity: 10 });
    const cliff = kind === 'cliff';
    scene = await api('scenes/apply', { scene, commands: [
      { op: 'add_surface', surface: cliff
        ? { kind: 'ground', id: 'surface', x_min: -5, x_max: 40, y: 0 }
        : { kind: 'wedge', id: 'surface', width: 4, height: 3, rising: false } },
      { op: 'add_particle', id: 'P', ...(cliff ? { position: { x: 0, y: 45 } }
        : { on_surface: { surface_id: 'surface', fraction: 0.1 } }) },
      { op: 'set_launch', particle_id: 'P', speed: cliff ? 10 : 2, direction: 'angle', angle_deg: cliff ? 0 : 53 },
      ...(cliff ? [
        distance('height', 'Height', anchor('P','launch'), anchor('P','contact'), 'vertical', -1),
        distance('range', 'Range', anchor('P','launch'), anchor('P','contact'), 'horizontal', -1),
      ] : [
        distance('height', 'Height', anchor('surface','base_start'), anchor('surface','top_start'), 'vertical', -1),
        distance('length', 'Slope length', anchor('surface','top_start'), anchor('surface','top_end')),
        { op: 'set_measurement', measurement: { kind: 'angle', id: 'slope', label: 'Slope',
          start: anchor('surface','base_start'), vertex: anchor('surface','top_end'), end: anchor('surface','top_start') } },
      ]),
    ] });
    const simulation = await api('simulations', { scene, particle_id: 'P', max_time: 5 });
    const { meshes } = await api('geometry', scene);
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/playground/v1/generate', route => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'review', reason: 'Dimension fixture', assumptions: [], report_id: kind, scene, simulation, meshes }) }));
      await page.goto(`${base}/playground`);
      await page.locator('canvas[data-framed=true]').waitFor();
      await page.getByLabel('Physics question', { exact: true }).fill(kind);
      await page.getByRole('button', { name: 'Generate scene', exact: true }).click();
      await page.getByText('Dimension fixture', { exact: true }).waitFor();
      for (const label of cliff ? ['Height = 45 m', 'Range = 30 m'] : ['Height = 3 m', 'Slope length = 5 m', 'Slope = 36.87°']) {
        await page.getByText(label, { exact: true }).waitFor();
      }
      const canvas = page.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const labels = page.locator('[data-label-id^="measurement-"]');
      const boxes = await labels.evaluateAll(es => es.map(e => {
        const r=e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height };
      }));
      const frame = await canvas.boundingBox();
      for (const [i,a] of boxes.entries()) {
        assert.ok(a.x >= frame.x-1 && a.x+a.w <= frame.x+frame.width+1);
        for (const b of boxes.slice(i+1)) assert.ok(!(a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y), 'label overlap');
      }
      await page.screenshot({ path: `${out}/${kind}-${width}.png`, fullPage: true });
      const before = await canvas.getAttribute('data-camera');
      await page.getByLabel('Dimensions and angles', { exact: true }).uncheck();
      await page.waitForFunction(() => document.querySelectorAll('[data-label-id^="measurement-"]').length === 0);
      assert.equal(await labels.count(), 0);
      assert.equal(await canvas.getAttribute('data-camera'), before, 'dimension toggle moved camera');
      await page.getByLabel('Dimensions and angles', { exact: true }).check();
      await page.getByRole('slider', { name: 'Simulation time' }).focus();
      await page.getByRole('slider', { name: 'Simulation time' }).press('End');
      await page.waitForFunction(t => Math.abs(Number(document.querySelector('canvas').dataset.time)-t)<1e-8, simulation.samples.at(-1).t);
      const position = JSON.parse(await canvas.getAttribute('data-particle'));
      assert.ok(Math.abs(position[0]-simulation.samples.at(-1).position.x)<1e-6);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(`PASS generic dimensions and angles: cliff/wedge desktop/mobile, values, labels, camera-preserving toggle. ${out}`);
} finally { await browser.close(); }
