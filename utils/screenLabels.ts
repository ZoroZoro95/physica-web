export type ScreenBox = { x: number; y: number; width: number; height: number };
export type ScreenLabel = ScreenBox & { id: string; priority: number };

export function boxesIntersect(a: ScreenBox, b: ScreenBox, gap = 3) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Place measured text as a group; never shrink it to disguise a collision. */
export function placeScreenLabels(labels: ScreenLabel[], width: number, height: number, obstacles: ScreenBox[] = []) {
  const occupied = [...obstacles];
  const pad = 6;
  return [...labels].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).map(label => {
    const clamp = (x: number, y: number): ScreenBox => ({
      x: Math.max(pad, Math.min(x, width - label.width - pad)),
      y: Math.max(pad, Math.min(y, height - label.height - pad)),
      width: label.width,
      height: label.height,
    });
    const candidates = [clamp(label.x, label.y)];
    const stride = label.height + 5;
    for (let ring = 1; ring <= 12; ring += 1) {
      for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        candidates.push(clamp(label.x + dx * ring * stride, label.y + dy * ring * stride));
      }
    }
    let chosen = candidates.find(candidate => !occupied.some(box => boxesIntersect(candidate, box)));
    if (!chosen) {
      for (let y = pad; y <= height - label.height - pad && !chosen; y += stride) {
        for (let x = pad; x <= width - label.width - pad; x += Math.max(12, label.width / 3)) {
          const candidate = clamp(x, y);
          if (!occupied.some(box => boxesIntersect(candidate, box))) { chosen = candidate; break; }
        }
      }
    }
    const box = chosen ?? candidates[0];
    occupied.push(box);
    return { ...label, ...box, unresolved: !chosen };
  });
}
