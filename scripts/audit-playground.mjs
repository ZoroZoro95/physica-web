import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PHYSICA_BASE_URL ?? "http://localhost:3000";
const out = process.env.PHYSICA_AUDIT_DIR ?? "/tmp/physica-playground";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/playground`);
    const canvas = page.locator("canvas[data-framed=true]");
    await canvas.waitFor();
    // The first render can precede the camera-fit effect; sample the fitted frame.
    await page.waitForFunction(() => {
      const raw = document.querySelector("canvas")?.dataset.camera;
      return raw && JSON.parse(raw).position[0] > 0;
    });
    await page.getByRole("button", { name: "Play", exact: true }).waitFor();
    assert.match(await page.getByTestId("result").innerText(), /Contact.*2\.309/);
    const pixels = await canvas.evaluate(c => {
      const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height;
      const ctx = copy.getContext("2d"); ctx.drawImage(c, 0, 0);
      const rgba = ctx.getImageData(0,0,copy.width,copy.height).data;
      const colors = new Set();
      for (let i = 0; i < rgba.length; i += 64) colors.add(`${rgba[i]},${rgba[i+1]},${rgba[i+2]}`);
      return colors.size;
    });
    assert.ok(pixels > 20, `blank canvas: ${pixels} colors`);
    // Inspect the reverse side without changing the simulation, then pan/zoom/reset.
    const cameraState = async () => JSON.parse(await canvas.getAttribute("data-camera"));
    const initialCamera = await cameraState();
    const physicsBeforeOrbit = await canvas.getAttribute("data-particle");
    const box = await canvas.boundingBox();
    const cx = box.x+box.width/2, cy = box.y+box.height/2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx+Math.min(box.width*.35, box.height*.35), cy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const orbited = await cameraState();
    assert.notDeepEqual(orbited.rotation, initialCamera.rotation, "left drag did not orbit");
    assert.equal(await canvas.getAttribute("data-particle"), physicsBeforeOrbit);
    await page.screenshot({ path: `${out}/orbit-${width}.png`, fullPage: true });
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx+40, cy+20, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(100);
    const panned = await cameraState();
    assert.notDeepEqual(panned.target, orbited.target, "right drag did not pan");
    assert.ok(panned.rotation.every((v,i) => Math.abs(v-orbited.rotation[i])<1e-8));
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(150);
    assert.ok((await cameraState()).zoom > panned.zoom, "wheel did not zoom");
    // An annotation update must retain the user's inspection view.
    const inspectionCamera = await cameraState();
    await page.getByLabel("Velocity v", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    await page.waitForTimeout(150);
    assert.deepEqual(await cameraState(), inspectionCamera, "annotations reset camera");
    await page.getByLabel("Velocity v", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    await page.waitForTimeout(150);
    const resetCamera = await cameraState();
    for (const key of ["position", "rotation", "target"]) {
      assert.ok(resetCamera[key].every((v,i) => Math.abs(v-initialCamera[key][i])<1e-8), `fit did not reset ${key}: ${JSON.stringify({ initialCamera, resetCamera })}`);
    }
    assert.ok(Math.abs(resetCamera.zoom-initialCamera.zoom)<1e-8);
    const start = await canvas.getAttribute("data-particle");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    assert.notEqual(await canvas.getAttribute("data-particle"), start, "particle did not move");
    const paused = await canvas.getAttribute("data-time");
    await page.waitForTimeout(150);
    assert.equal(await canvas.getAttribute("data-time"), paused, "pause failed");
    for (const name of ["Velocity v", "Horizontal vₓ", "Vertical vᵧ", "Gravity g"]) {
      await page.getByLabel(name, { exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
      assert.equal(await page.getByLabel(name, { exact: true }).isChecked(), true);
    }
    await page.getByLabel("Simulation time", { exact: true }).focus();
    await page.getByLabel("Simulation time", { exact: true }).press("End");
    await page.waitForTimeout(400);
    const checks = await page.evaluate(() => {
      const c = document.querySelector("canvas"), box = c.getBoundingClientRect();
      const labels = [...document.querySelectorAll("[data-audit-scene-label]")].map(e => ({ text: e.textContent, r: e.getBoundingClientRect() }));
      const failures = [];
      for (const { text, r } of labels) if (r.height < 12 || r.left < box.left-1 || r.right > box.right+1 || r.top < box.top-1 || r.bottom > box.bottom+1) failures.push(`clipped label: ${text}`);
      for (let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
        const a=labels[i].r, b=labels[j].r;
        if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) failures.push("overlapping labels");
      }
      const [x,y] = JSON.parse(c.dataset.particleScreen);
      if (x < 0 || y < 0 || x > box.width || y > box.height) failures.push("particle outside frame");
      if (document.documentElement.scrollWidth > innerWidth+1) failures.push("page overflow");
      return { failures, labels: labels.length, time: Number(c.dataset.time) };
    });
    assert.equal(checks.labels, 6); // Four vectors plus height and slope measurements.
    if (checks.failures.length) {
      await page.screenshot({ path: `${out}/labels-failure-${width}.png`, fullPage: true });
      console.error(JSON.stringify({ width, checks }));
    }
    assert.deepEqual(checks.failures, []);
    assert.ok(Math.abs(checks.time-2.30940107676) < 1e-6);
    await page.screenshot({ path: `${out}/wedge-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(Number(await canvas.getAttribute("data-time")), 0);
    // Rebuilding from an edited angle uses a fresh API scene, not a fixed picture.
    await page.getByLabel("Slope (°)", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Build scene", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.getByTestId("playground-error").count(), 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/mirrored-${width}.png`, fullPage: true });
    // Stairs are API-generated solids, including a mirrored scene, not a picture.
    await page.getByLabel("Surface", { exact: true }).selectOption("staircase");
    await page.getByLabel("Gravity (m/s²)", { exact: true }).fill("9.8");
    for (const descent of ["right", "left"]) {
      await page.getByLabel("Descent", { exact: true }).selectOption(descent);
      const simulationResponse = page.waitForResponse(r => r.url().endsWith("/v1/simulations") && r.request().method() === "POST", { timeout: 15000 });
      await page.getByRole("button", { name: "Build scene", exact: true }).click();
      const simulated = await (await simulationResponse.catch(async e => {
        await page.screenshot({ path: `${out}/stairs-failure-${width}.png`, fullPage: true });
        console.error(await page.getByTestId("playground-error").allTextContents());
        throw e;
      })).json();
      await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
      assert.equal(await page.getByTestId("playground-error").count(), 0);
      assert.equal(simulated.contact.face, "tread:21");
      await page.getByLabel("Simulation time", { exact: true }).focus();
      await page.getByLabel("Simulation time", { exact: true }).press("End");
      await page.waitForTimeout(300);
      const position = JSON.parse(await canvas.getAttribute("data-particle"));
      assert.ok(Math.abs(position[0] - simulated.contact.position.x) < 1e-8);
      assert.ok(Math.abs(position[1] + 21) < 1e-8);
      const sign = descent === "right" ? 1 : -1;
      assert.ok(position[0]*sign >= 20 && position[0]*sign <= 21);
      assert.match(await page.getByTestId("result").innerText(), /tread:21/);
      const rendered = await canvas.evaluate(c => {
        const copy = document.createElement("canvas"); copy.width=c.width; copy.height=c.height;
        const ctx=copy.getContext("2d"); ctx.drawImage(c,0,0);
        const data=ctx.getImageData(0,0,copy.width,copy.height).data;
        const colors=new Set();
        for(let i=0;i<data.length;i+=64) colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
        const [x,y]=JSON.parse(c.dataset.particleScreen), r=c.getBoundingClientRect();
        return { colors:colors.size, inFrame:x>=0 && y>=0 && x<=r.width && y<=r.height };
      });
      await page.screenshot({ path: `${out}/stairs-${descent}-${width}.png`, fullPage: true });
      assert.ok(rendered.colors > 20 && rendered.inFrame, JSON.stringify(rendered));
    }
    // Import is validated by the API and must not replace the last valid scene on failure.
    await page.getByLabel("Scene file", { exact: true }).setInputFiles({
      name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"schema_version":"unsupported"}'),
    });
    await page.getByTestId("playground-error").waitFor();
    assert.equal(await canvas.count(), 1);
    assert.deepEqual(errors, []);
    results.push({ width, pixels, ...checks, errors });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(`PASS playground desktop/mobile rendering, motion, pause, scrub, vectors, mirrored wedges/stairs, step contact and invalid import: ${out}`);
