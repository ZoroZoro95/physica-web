import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function load(name) {
  const source = readFileSync(new URL(`../utils/${name}.ts`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const { fitSceneFrame } = await load("sceneFraming");
const { placeScreenLabels, boxesIntersect } = await load("screenLabels");
for (const [width, height] of [[740, 250], [340, 250], [900, 600]]) {
  for (const bounds of [
    { minX: -1, maxX: 9, minY: -1, maxY: 3 },
    { minX: -4, maxX: 2, minY: -8, maxY: 1 },
    { minX: -5, maxX: 5, minY: 0, maxY: 6 },
  ]) {
    const fit = fitSceneFrame(bounds, width, height);
    assert.ok((bounds.maxX - bounds.minX) * fit.zoom <= width);
    assert.ok((bounds.maxY - bounds.minY) * fit.zoom <= height);
    assert.equal(fit.x, (bounds.minX + bounds.maxX) / 2);
  }
  const input = Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: -5, y: height - 5, width: 80, height: 16, priority: i }));
  const placed = placeScreenLabels(input, width, height);
  assert.ok(placed.every(p => !p.unresolved && p.x >= 0 && p.y >= 0 && p.x + p.width <= width && p.y + p.height <= height));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!boxesIntersect(placed[i], placed[j]));
}
console.log("PASS scene framing and measured label placement across desktop/mobile bounds");
