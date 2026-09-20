/** Explicit beat motion takes precedence over legacy display overlays. */
export function shouldPlayBeatMotion(mode: unknown, overlays: readonly string[] = []): boolean {
  if (mode === "static" || mode === "freeze") return false;
  if (mode === "partial" || mode === "lifecycle") return true;
  return overlays.includes("show_motion_progress");
}
