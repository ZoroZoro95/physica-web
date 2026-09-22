import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.PHYSICA_BASE_URL || "http://localhost:3000";
const out = process.env.PHYSICA_AUDIT_DIR || "/tmp/physica-readability";
const cases = [
  ["level", "A ball is launched at 20 m/s at 30 degrees. Find range, time of flight and maximum height. Take g=10 m/s^2."],
  ["tower", "A stone is thrown horizontally from a tower 80 m high at 5 m/s. How long to reach the ground?"],
  ["incline", "A projectile is fired perpendicular to an inclined plane of angle 30deg with speed 10 m/s. Find the range on the inclined plane. Take g = 10 m/s^2."],
  ["two-inclines", "Two inclined planes OA and OB with inclinations 30 deg and 60 deg intersect at O. A particle is projected from P with velocity u = 10*sqrt(3) m/s perpendicular to plane OA. If it strikes plane OB perpendicularly at Q, find the velocity at Q."],
  ["staircase", "A marble rolls down from top of a staircase with constant horizontal velocity 10 m/s. Each step is 1 m high and 1 m wide. To which step will the marble strike directly? Take g=9.8 m/s^2."],
  ["two-particles", "A particle P is projected perpendicular to a smooth inclined plane of angle 60 deg. Simultaneously particle Q is released from the same position on the plane. P and Q collide after t = 4 second. Find the speed of projection of P."],
];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, question] of cases) {
    const response = await fetch(`${base}/api/backend/solve-question`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_text_solver: question, options: [], givens: [] }) });
    const solve = await response.json();
    if (solve.status !== "passed" || !solve.animation_scene_spec) throw Error(`${name}: ${JSON.stringify(solve.reason)}`);
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      // Use the production component with a fixed full-lifecycle state and the real API payload.
      await page.addInitScript(payload => sessionStorage.setItem("walkthrough-sync-audit-payload", JSON.stringify(payload)), { animation_scene_spec: solve.animation_scene_spec, solver: { status: solve.status, answer: solve.answer } });
      await page.goto(`${base}/audit/walkthrough-sync`, { waitUntil: "domcontentloaded" });
      const surface = page.locator('[data-audit-surface="animation-scene-3d"]');
      await surface.waitFor({ state: "visible" });
      // Constrain the audit host too: its old desktop grid otherwise masks mobile clipping.
      await surface.evaluate(el => { el.parentElement.style.width = "100%"; el.parentElement.style.maxWidth = "100%"; el.closest("main").style.overflow = "hidden"; });
      await page.waitForTimeout(1000);
      const checks = await surface.evaluate(el => {
        const canvas = el.querySelector("canvas").getBoundingClientRect();
        const labels = [...el.querySelectorAll("[data-audit-scene-label]")].map(e => ({ text: e.textContent, box: e.getBoundingClientRect(), unresolved: e.dataset.unresolvedOverlap === "true" }));
        const failures = [];
        for (const a of labels) {
          if (a.box.width === 0 || a.box.height < 12 || a.unresolved) failures.push(`unreadable: ${a.text}`);
          if (a.box.left < canvas.left - 1 || a.box.right > canvas.right + 1 || a.box.top < canvas.top - 1 || a.box.bottom > canvas.bottom + 1) failures.push(`clipped: ${a.text}`);
        }
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i].box, b = labels[j].box;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) failures.push(`overlap: ${labels[i].text}/${labels[j].text}`);
        }
        return { failures, labels: labels.length, frame: JSON.parse(el.querySelector("canvas").dataset.auditFrame || "null"), canvasWidth: canvas.width };
      });
      await surface.screenshot({ path: `${out}/${name}-${width}.png` });
      results.push({ name, width, answer: solve.answer, ...checks });
      await page.close();
    }
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
const failures = results.filter(r => r.failures.length);
console.log(JSON.stringify({ renders: results.length, failures, report: `${out}/report.json` }, null, 2));
if (failures.length) process.exitCode = 1;
