import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PHYSICA_BASE_URL ?? 'http://localhost:3000';
const source = process.env.PHYSICA_RELIABILITY_REPORT ?? '/tmp/physica-reliability/scenes.json';
const fixtures = JSON.parse(await readFile(source, 'utf8'));
const out = '/tmp/physica-reliability/browser';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const fixture of fixtures.examples) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.route('**/api/playground/v1/generate', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'review', reason: 'Engine regression fixture',
          assumptions: [], report_id: fixture.name, ...fixture }),
      }));
      await page.goto(`${base}/playground`);
      await page.locator('canvas[data-framed=true]').waitFor();
      await page.getByLabel('Physics question', { exact: true }).fill(fixture.name);
      await page.getByRole('button', { name: 'Generate scene', exact: true }).click();
      await page.getByText('Engine regression fixture', { exact: true }).waitFor();
      const canvas = page.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const initialCamera = JSON.parse(await canvas.getAttribute('data-camera'));
      const duration = fixture.simulation.samples.at(-1).t;
      // Scrub actual UI at start, mid-flight and contact. No synthetic position injection.
      for (const fraction of [0, .5, 1]) {
        const slider = page.getByRole('slider', { name: 'Simulation time' });
        await slider.focus();
        if (fraction === 0 || fraction === 1) await slider.press(fraction === 0 ? 'Home' : 'End');
        else {
          const box = await slider.boundingBox();
          await slider.click({position:{x:box.width/2,y:box.height/2}});
        }
        await canvas.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const state = await canvas.evaluate(c => ({ time:Number(c.dataset.time), particle:JSON.parse(c.dataset.particle), screen:JSON.parse(c.dataset.particleScreen), trailPoints:Number(c.dataset.trailPoints) }));
        const samples = fixture.simulation.samples;
        if (fraction === 1) assert.ok(state.trailPoints >= samples.length, 'completed trail collapsed to a chord');
        assert.ok(Math.abs(state.time-duration*fraction)<duration*.03+1e-7, 'scrub time mismatch');
        const next = samples.findIndex(s=>s.t>=state.time);
        const right = next === -1 ? samples.length-1 : Math.max(1,next);
        const a=samples[right-1], b=samples[right], f=(state.time-a.t)/(b.t-a.t);
        const expected={x:a.position.x+f*(b.position.x-a.position.x),y:a.position.y+f*(b.position.y-a.position.y)};
        assert.ok(Math.abs(state.particle[0]-expected.x)<1e-6, `x mismatch ${fixture.name}`);
        assert.ok(Math.abs(state.particle[1]-expected.y)<1e-6, `y mismatch ${fixture.name}`);
        const camera = JSON.parse(await canvas.getAttribute('data-camera'));
        for (const key of ['position','rotation','target']) assert.ok(camera[key].every((v,i)=>Math.abs(v-initialCamera[key][i])<1e-8), 'scrubbing changed camera');
        assert.ok(Math.abs(camera.zoom-initialCamera.zoom)<1e-8);
        const bounds = await canvas.boundingBox();
        assert.ok(state.screen[0]>=0 && state.screen[0]<=bounds.width && state.screen[1]>=0 && state.screen[1]<=bounds.height, 'particle clipped');
      }
      if (fixture.simulation.contact.touching_faces.length > 1) {
        assert.match(await page.getByTestId('result').innerText(), /Corner.*tread:20.*riser:21/);
        await page.getByText('Impact: step 20 (corner)', { exact: true }).waitFor();
      }
      const defects = await canvas.evaluate(c => {
        const box=c.getBoundingClientRect(), parent=c.closest('[data-audit-surface]');
        const labels=[...parent.querySelectorAll('[data-audit-scene-label]')].map(e=>({text:e.textContent,r:e.getBoundingClientRect()}));
        const defects=[];
        for (const {text,r} of labels) if (r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1) defects.push(`clipped: ${text}`);
        for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
          const a=labels[i].r,b=labels[j].r;
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) defects.push('labels overlap');
        }
        return defects;
      });
      assert.deepEqual(defects, []);
      const colors = await canvas.evaluate(c => {
        const copy=document.createElement('canvas'); copy.width=c.width; copy.height=c.height;
        const ctx=copy.getContext('2d'); ctx.drawImage(c,0,0);
        const pixels=ctx.getImageData(0,0,c.width,c.height).data, colors=new Set();
        for(let i=0;i<pixels.length;i+=4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
        return colors.size;
      });
      assert.ok(colors>20, 'blank canvas');
      assert.deepEqual(errors, []);
      await page.screenshot({ path:`${out}/${fixture.name}-${width}.png`, fullPage:true });
      results.push({name:fixture.name,width,status:'passed'});
    } catch(error) {
      await page.screenshot({ path:`${out}/FAILED-${fixture.name}-${width}.png`, fullPage:true });
      results.push({name:fixture.name,width,status:'failed',error:String(error)});
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`,JSON.stringify(results,null,2)+'\n');
}
const failed=results.filter(r=>r.status==='failed');
console.log(JSON.stringify({passed:results.length-failed.length,failed,report:`${out}/report.json`},null,2));
assert.equal(failed.length,0);
