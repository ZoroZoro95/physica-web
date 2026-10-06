import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.PHYSICA_BASE_URL ?? "http://localhost:3001";
const question = process.env.PHYSICA_AUDIT_QUESTION
  ?? "A stone is projected from level ground with speed 20 m/s at an angle of 30 degrees above the horizontal. Find its time of flight, maximum height, and horizontal range.";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: {
  width: Number(process.env.PHYSICA_VIEWPORT_WIDTH ?? 1440),
  height: Number(process.env.PHYSICA_VIEWPORT_HEIGHT ?? 1000),
} });
const failures = [];
let beat = 1;
let staticBeats = 0;
let movingBeats = 0;
const checkMotion = process.env.PHYSICA_AUDIT_MOTION === "1";
const reportDir = process.env.PHYSICA_BEAT_AUDIT_DIR;
const samples = [];
if (reportDir) await mkdir(reportDir, { recursive: true });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const questionBox = page.getByPlaceholder("Describe a physics problem, paste text, or upload a question image…");
  await questionBox.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Try this Projectile at 45° with 25 m/s. Find the maximum range." }).click();
  await questionBox.fill(question);
  const reviewButton = page.getByRole("button", { name: "Review question →" });
  await reviewButton.waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 50 && await reviewButton.isDisabled(); attempt += 1) {
    await page.waitForTimeout(100);
  }
  if (await reviewButton.isDisabled()) {
    throw new Error(`Question input did not enable review; current value: ${JSON.stringify(await questionBox.inputValue())}`);
  }
  await reviewButton.click();
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await page.getByRole("button", { name: "Generate walkthrough", exact: true }).click();

  while (true) {
    await page.locator('[data-audit-surface="teaching-board-2d"]').first().waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-audit-surface="teaching-board-2d"]')).map(board => {
        const layer = board.querySelector('[data-audit-label-layer="template-authority"]');
        const frame = board.getBoundingClientRect();
        const labels = Array.from(board.querySelectorAll('[data-audit-label-key]')).map(node => {
          const text = node.matches("text") ? node : node.querySelector("text, foreignObject") ?? node;
          const box = text.getBoundingClientRect();
          return { key: node.getAttribute("data-audit-label-key"), text: text.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
        });
        const collisions = [];
        const clipped = labels.filter(label => label.left < frame.left - 1 || label.right > frame.right + 1 || label.top < frame.top - 1 || label.bottom > frame.bottom + 1).map(label => label.key);
        const unreadable = labels.filter(label => label.height < 12).map(label => label.key);
        const unlabeledVectors = [...board.querySelectorAll('[data-audit-vector-id]')]
          .map(node => node.getAttribute('data-audit-vector-id'))
          .filter(id => !layer && !labels.some(label => label.key === `vector-label:${id}`));
        for (let i = 0; i < labels.length; i += 1) {
          for (let j = i + 1; j < labels.length; j += 1) {
            const a = labels[i];
            const b = labels[j];
            const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (overlapX > 1 && overlapY > 1) collisions.push(`${a.key} <> ${b.key}`);
          }
        }
        return {
          step: board.getAttribute("data-audit-step-id"),
          actor: board.getAttribute("data-audit-actor-filter"),
          actors: [...new Set([...board.querySelectorAll("[data-audit-actor-id]")].map(node => node.getAttribute("data-audit-actor-id")))],
          labels,
          clipped,
          unreadable,
          unlabeledVectors,
          unresolved: Number(layer?.getAttribute("data-audit-unresolved-overlaps") || 0),
          collisions,
        };
      });
    });
    for (const layer of result) {
      if (layer.unresolved || layer.collisions.length || layer.clipped.length) {
        failures.push(`beat ${beat}: unresolved=${layer.unresolved}; ${layer.collisions.join(", ")}; clipped=${layer.clipped.join(", ")}`);
      }
      if (layer.actor && layer.actors.some(actor => actor !== layer.actor)) failures.push(`beat ${beat}: object board contains another actor`);
      if (layer.unreadable.length) failures.push(`beat ${beat}: labels smaller than 12px: ${layer.unreadable.join(', ')}`);
      if (layer.unlabeledVectors.length) failures.push(`beat ${beat}: vectors without labels: ${layer.unlabeledVectors.join(', ')}`);
    }
    samples.push({ beat, boards: result });
    if (reportDir) await page.locator('[data-audit-surface="teaching-board-2d"]').first().screenshot({ path: `${reportDir}/beat-${beat}.png` });
    if (checkMotion) {
      // Screenshot capture can outlast a short beat. Measure from an explicit replay.
      await page.getByRole('button', { name: 'replay beat', exact: true }).last().click();
      const surface = page.locator('[data-audit-surface="animation-scene-3d"]');
      await surface.waitFor({ state: "visible" });
      const mode = await surface.getAttribute("data-audit-motion-mode");
      const playing = await surface.getAttribute("data-audit-motion-playing");
      const before = Number(await surface.getAttribute("data-audit-scene-progress"));
      await page.waitForTimeout(450);
      const after = Number(await surface.getAttribute("data-audit-scene-progress"));
      if (["static", "freeze"].includes(mode)) {
        staticBeats += 1;
        if (playing !== "false" || before !== after) failures.push(`beat ${beat}: ${mode} scene moved`);
      } else if (["partial", "lifecycle"].includes(mode)) {
        movingBeats += 1;
        if (playing !== "true" || after <= before) failures.push(`beat ${beat}: ${mode} scene did not advance (${before} -> ${after})`);
      }
    }
    const ahead = page.getByRole("button", { name: "Ahead", exact: true });
    if (await ahead.isDisabled()) break;
    await ahead.click();
    beat += 1;
  }

  if (checkMotion) {
    await page.getByRole("button", { name: "Full animation", exact: true }).click();
    const full = page.locator('[data-audit-full-lifecycle="true"]');
    await full.waitFor({ state: "visible" });
    const before = Number(await full.getAttribute("data-audit-scene-progress"));
    await page.waitForTimeout(450);
    const after = Number(await full.getAttribute("data-audit-scene-progress"));
    if (after <= before) failures.push("separate full animation did not advance");
    const canvasBox = await full.locator("canvas").boundingBox();
    const legendBox = await full.locator('[data-audit-surface="simulation-legend"]').boundingBox();
    if (!canvasBox || !legendBox || canvasBox.y + canvasBox.height > legendBox.y + 1) {
      failures.push("legend overlaps the simulation canvas");
    }
    if (!staticBeats || !movingBeats) failures.push("audit must exercise both static and moving beats");
    if (process.env.PHYSICA_AUDIT_SCREENSHOT) {
      await full.screenshot({ path: process.env.PHYSICA_AUDIT_SCREENSHOT });
    }
  }

} catch (error) {
  failures.push(String(error));
  if (reportDir) {
    await page.screenshot({ path: `${reportDir}/failure.png`, fullPage: true });
    await writeFile(`${reportDir}/failure.txt`, await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
  if (reportDir) await writeFile(`${reportDir}/report.json`, JSON.stringify({ question, failures, samples }, null, 2));
}

if (failures.length) throw new Error(`Label overlap audit failed:\n${failures.join("\n")}`);
process.stdout.write(`PASS label overlap audit across ${beat} beats\n`);
if (checkMotion) process.stdout.write(`PASS playback: ${staticBeats} static beats, ${movingBeats} moving beats, and separate full animation\n`);
