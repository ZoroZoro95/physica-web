export type SceneBounds = { minX: number; maxX: number; minY: number; maxY: number };

/** Uniform scaling preserves physical angles on both wide and narrow panels. */
export function fitSceneFrame(bounds: SceneBounds, width: number, height: number, padding = 24) {
  const spanX = Math.max(0.01, bounds.maxX - bounds.minX);
  const spanY = Math.max(0.01, bounds.maxY - bounds.minY);
  const inset = Math.min(padding, Math.min(width, height) * 0.18);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    zoom: Math.max(0.01, Math.min(Math.max(1, width - inset * 2) / spanX, Math.max(1, height - inset * 2) / spanY)),
  };
}
