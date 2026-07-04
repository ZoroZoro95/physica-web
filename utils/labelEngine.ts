export type PointLike = { x: number; y: number };

export type LabelAnchor = "start" | "middle" | "end";

export type LabelBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type LabelCandidate<PointT extends PointLike = PointLike> = {
  key: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color?: string;
  boxed?: boolean;
  anchor?: LabelAnchor;
  leaderFrom?: PointT;
  priority?: number;
};

export type LabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PlacedLabel<PointT extends PointLike = PointLike> = LabelCandidate<PointT> & {
  box: LabelBox;
  moved: boolean;
};

export type LabelBoxInput<PointT extends PointLike = PointLike> =
  Pick<LabelCandidate<PointT>, "text" | "size" | "x" | "y">
  & Partial<Pick<LabelCandidate<PointT>, "key" | "anchor" | "boxed" | "color" | "leaderFrom" | "priority">>;

const LABEL_CHAR_WIDTH = 0.68;

export function placeLabels<PointT extends PointLike>(
  candidates: LabelCandidate<PointT>[],
  bounds: LabelBounds,
  ui: number,
  initialOccupied: LabelBox[] = [],
): PlacedLabel<PointT>[] {
  const occupied: LabelBox[] = [...initialOccupied];
  return candidates
    .map((candidate, index) => ({ ...candidate, priority: candidate.priority ?? 50, sourceIndex: index }))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.sourceIndex - b.sourceIndex)
    .map(candidate => {
      const base: LabelCandidate<PointT> = { ...candidate };
      const placements = labelPlacementCandidates(base, bounds, ui);
      const clean = placements.find(option => !occupied.some(box => boxesOverlap(option.box, box, 0.12 * ui)));
      const placed = clean ?? leastBadPlacement(placements, occupied, bounds, ui);
      occupied.push(placed.box);
      return placed;
    });
}

export function labelPlacementCandidates<PointT extends PointLike>(
  label: LabelCandidate<PointT>,
  bounds: LabelBounds,
  ui: number,
): PlacedLabel<PointT>[] {
  const directions = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];
  const radii = [0, 1.35 * ui, 2.45 * ui, 3.7 * ui, 5.1 * ui, 6.8 * ui, 9.2 * ui];
  const options: PlacedLabel<PointT>[] = [];
  for (const radius of radii) {
    for (const direction of directions) {
      if (radius === 0 && (direction.x !== 0 || direction.y !== 0)) continue;
      const normalized = normalize2(direction);
      const candidate = clampLabelToBounds({
        ...label,
        x: label.x + normalized.x * radius,
        y: label.y + normalized.y * radius,
      }, bounds, ui);
      const box = labelBox(candidate);
      options.push({
        ...candidate,
        box,
        moved: Math.abs(candidate.x - label.x) > 0.01 * ui || Math.abs(candidate.y - label.y) > 0.01 * ui,
      });
    }
  }
  return options;
}

export function labelBox(label: LabelBoxInput): LabelBox {
  const width = labelWidth(label.text, label.size);
  const height = label.size * 1.28;
  const anchor = label.anchor ?? "start";
  const left = anchor === "middle" ? label.x - width / 2 : anchor === "end" ? label.x - width : label.x - label.size * 0.24;
  const right = left + width;
  return {
    left,
    right,
    top: label.y + height * 0.76,
    bottom: label.y - height * 0.36,
  };
}

export function labelWidth(text: string, size: number) {
  return Math.max(size * 2.2, text.length * size * LABEL_CHAR_WIDTH);
}

export function pointBox(point: PointLike, radius: number): LabelBox {
  return {
    left: point.x - radius,
    right: point.x + radius,
    top: point.y + radius,
    bottom: point.y - radius,
  };
}

export function segmentBox(from: PointLike, to: PointLike, pad: number): LabelBox {
  return {
    left: Math.min(from.x, to.x) - pad,
    right: Math.max(from.x, to.x) + pad,
    top: Math.max(from.y, to.y) + pad,
    bottom: Math.min(from.y, to.y) - pad,
  };
}

export function validBox(box: LabelBox) {
  return [box.left, box.right, box.top, box.bottom].every(Number.isFinite) && box.right >= box.left && box.top >= box.bottom;
}

export function boxesOverlap(a: LabelBox, b: LabelBox, gap: number) {
  return !(a.right + gap < b.left || b.right + gap < a.left || a.top + gap < b.bottom || b.top + gap < a.bottom);
}

export function overlapArea(a: LabelBox, b: LabelBox, gap: number) {
  const x = Math.max(0, Math.min(a.right + gap, b.right + gap) - Math.max(a.left - gap, b.left - gap));
  const y = Math.max(0, Math.min(a.top + gap, b.top + gap) - Math.max(a.bottom - gap, b.bottom - gap));
  return x * y;
}

export function normalize2(point: PointLike) {
  const magnitude = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / magnitude, y: point.y / magnitude };
}

export function vectorLabelOffset2D(component: string, labelLift: number): [number, number] {
  const lift = Math.max(0.48, labelLift * 1.16);
  if (component === "x_velocity") return [1.72, lift * 2.35];
  if (component === "y_velocity") return [0.62, lift * 0.72];
  if (component === "acceleration") return [0.44, -lift * 1.05];
  if (component === "incline_tangent") return [0.36, lift * 0.42];
  if (component === "incline_normal") return [0.48, lift * 0.92];
  if (component === "gravity_tangent") return [0.56, lift * 0.52];
  if (component === "gravity_normal") return [0.56, -lift * 0.92];
  if (component === "velocity_tangent") return [0.48, lift * 0.62];
  if (component === "velocity_normal") return [0.48, -lift * 0.78];
  return [0.44, lift * 0.72];
}

function leastBadPlacement<PointT extends PointLike>(
  options: PlacedLabel<PointT>[],
  occupied: LabelBox[],
  bounds: LabelBounds,
  ui: number,
) {
  let best = options[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const score = occupied.reduce((sum, box) => sum + overlapArea(option.box, box, 0.12 * ui), 0);
    if (score < bestScore) {
      best = option;
      bestScore = score;
    }
  }
  let adjusted = best;
  for (let attempt = 1; attempt <= 16 && occupied.some(box => boxesOverlap(adjusted.box, box, 0.12 * ui)); attempt += 1) {
    const direction = attempt % 2 === 0 ? -1 : 1;
    const next = clampLabelToBounds({
      ...adjusted,
      y: adjusted.y + direction * Math.ceil(attempt / 2) * 0.75 * ui,
    }, bounds, ui);
    const box = labelBox(next);
    adjusted = { ...next, box, moved: true };
  }
  return adjusted;
}

function clampLabelToBounds<PointT extends PointLike>(
  label: LabelCandidate<PointT>,
  bounds: LabelBounds,
  ui: number,
): LabelCandidate<PointT> {
  const box = labelBox(label);
  let dx = 0;
  let dy = 0;
  const inset = 0.65 * ui;
  if (box.left < bounds.minX + inset) dx = bounds.minX + inset - box.left;
  if (box.right > bounds.maxX - inset) dx = bounds.maxX - inset - box.right;
  if (box.bottom < bounds.minY + inset) dy = bounds.minY + inset - box.bottom;
  if (box.top > bounds.maxY - inset) dy = bounds.maxY - inset - box.top;
  return { ...label, x: label.x + dx, y: label.y + dy };
}
