import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PHYSICA_BASE_URL ?? 'http://localhost:3000';
const out = '/tmp/physica-generation-audit';
await mkdir(out, { recursive: true });
async function api(path, body) {
  const response = await fetch(`${base}/api/playground/v1/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}
let scene = await api('scenes', { gravity: 10 });
scene = await api('scenes/apply', { scene, commands: [
  { op: 'add_surface', surface: { kind: 'ground', id: 'ground', y: -10, x_min: -10, x_max: 50 } },
  { op: 'add_particle', id: 'TestParticle', position: { x: 0, y: 0 } },
  { op: 'set_launch', particle_id: 'TestParticle', direction: 'angle', angle_deg: 0, speed: 10 },
] });
const simulation = await api('simulations', { scene, particle_id: 'TestParticle', max_time: 0.2, samples: 50 });
const { meshes } = await api('geometry', scene);
const review = { status: 'review', reason: 'No contact within this horizon.', assumptions: ['Origin at launch.'],
  report_id: 'browser-fixture', scene, simulation, meshes };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/playground`);
    await page.locator('canvas[data-framed=true]').waitFor();
    const original = await page.getByTestId('result').innerText();
    const input = page.getByLabel('Physics question', { exact: true });
    const button = page.getByRole('button', { name: 'Generate scene', exact: true });
    assert.equal(await button.isDisabled(), true);
    let reply, statusCode = 200;
    await page.route('**/api/playground/v1/generate', route => route.fulfill({
      status: statusCode, contentType: 'application/json', body: JSON.stringify(reply),
    }));
    for (const status of ['needs_clarification', 'unsupported', 'failed']) {
      reply = { status, reason: `Test ${status}`, assumptions: [], report_id: status, scene: null, simulation: null, meshes: [] };
      await input.fill(`Question for ${status}`);
      await button.click();
      await page.getByTestId('generation-result').getByText(`Test ${status}`, { exact: true }).waitFor();
      assert.equal(await page.getByTestId('result').innerText(), original);
    }
    statusCode = 429; reply = { detail: 'Another scene is being generated.' };
    await button.click();
    await page.getByRole('alert').getByText(reply.detail).waitFor();
    assert.equal(await page.getByTestId('result').innerText(), original);
    statusCode = 200; reply = review;
    await button.click();
    await page.getByText('Particle TestParticle', { exact: true }).waitFor();
    assert.match(await page.getByTestId('result').innerText(), /within 0\.2 s/);
    await page.getByText('Assumptions (1)', { exact: true }).click();
    await page.getByText('Origin at launch.', { exact: true }).waitFor();
    await page.getByLabel('Velocity v', { exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('label')]
      .find(label => label.textContent === 'Velocity v')?.querySelector('input')?.checked);
    await button.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.match(await page.getByTestId('result').innerText(), /within 0\.2 s/);
    const canvas = page.locator('canvas');
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.time) > 0);
    const colors = await canvas.evaluate(c => {
      const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(c, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
      const colors = new Set();
      for (let i=0; i<pixels.length; i+=4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      return colors.size;
    });
    await page.screenshot({ path: `${out}/generation-${width}.png`, fullPage: true });
    assert.ok(colors > 20, `blank canvas at ${width}: ${colors} colors`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  if (process.env.PHYSICA_LIVE_AI === '1') {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${base}/playground`);
    await page.locator('canvas[data-framed=true]').waitFor();
    await page.getByLabel('Physics question', { exact: true }).fill('A point particle leaves the top of a staircase horizontally to the right at 10 m/s. The staircase continues indefinitely downward to the right. Each step is 1 m wide and 1 m high. Use g=9.8 m/s^2. Build a scene to inspect its first contact.');
    await page.getByRole('button', { name: 'Generate scene', exact: true }).click();
    await page.getByText('Review generated scene', { exact: true }).waitFor({ timeout: 90000 });
    await page.screenshot({ path: `${out}/live-staircase.png`, fullPage: true });
    assert.match(await page.getByTestId('result').innerText(), /tread:21.*2\.070/);
    console.log('PASS live model -> backend -> browser: staircase tread 21');
  }
  console.log(`PASS mocked generation UI desktop/mobile, preserved horizon, error states, moving nonblank canvas. Screenshots: ${out}`);
} finally { await browser.close(); }
