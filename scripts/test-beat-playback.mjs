import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../utils/beatPlayback.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { shouldPlayBeatMotion } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

for (const mode of ["static", "freeze"]) {
  assert.equal(shouldPlayBeatMotion(mode, ["show_motion_progress", "show_trajectory"]), false,
    `${mode} must remain still even with stale motion overlays`);
}
for (const mode of ["partial", "lifecycle"]) {
  assert.equal(shouldPlayBeatMotion(mode, []), true, `${mode} must play without an overlay`);
}
assert.equal(shouldPlayBeatMotion(undefined, ["show_trajectory"]), false, "a path is not an instruction to move");
assert.equal(shouldPlayBeatMotion(undefined, ["show_motion_progress"]), true, "retain explicit legacy motion");
assert.equal(shouldPlayBeatMotion(undefined), false);
console.log("PASS 7 beat playback checks");
