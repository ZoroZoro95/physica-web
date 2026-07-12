import { chromium } from "playwright";

const baseUrl = process.env.PHYSICA_BASE_URL ?? "http://localhost:3001";
const question = process.env.PHYSICA_AUDIT_QUESTION
  ?? "A stone is projected from level ground with speed 20 m/s at an angle of 30 degrees above the horizontal. Find its time of flight, maximum height, and horizontal range.";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
let beat = 1;

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
    await page.locator('[data-audit-label-layer="template-authority"]').first().waitFor({ state: "visible" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-audit-label-layer="template-authority"]')).map(layer => {
        const labels = Array.from(layer.querySelectorAll('[data-audit-label-key]')).map(node => {
          const box = node.getBoundingClientRect();
          return { key: node.getAttribute("data-audit-label-key"), left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        });
        const collisions = [];
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
          unresolved: Number(layer.getAttribute("data-audit-unresolved-overlaps") || 0),
          collisions,
        };
      });
    });
    for (const layer of result) {
      if (layer.unresolved || layer.collisions.length) {
        failures.push(`beat ${beat}: unresolved=${layer.unresolved}; ${layer.collisions.join(", ")}`);
      }
    }
    const ahead = page.getByRole("button", { name: "Ahead", exact: true });
    if (await ahead.isDisabled()) break;
    await ahead.click();
    beat += 1;
  }

} finally {
  await browser.close();
}

if (failures.length) throw new Error(`Label overlap audit failed:\n${failures.join("\n")}`);
process.stdout.write(`PASS label overlap audit across ${beat} beats\n`);
