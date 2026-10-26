import type { Bundle, XY } from './playground';

export type Staircase = {
  kind: 'staircase'; id: string; origin: XY; rise: number; run: number;
  count: number; direction: 'left' | 'right'; depth: number;
};

export function staircaseMeasurements(bundle: Bundle) {
  const contact = bundle.simulation.contact;
  const staircases = bundle.scene.surfaces.filter(value => {
    const s = value as Partial<Staircase> | null;
    return s?.kind === 'staircase';
  }) as Staircase[];
  const surface = staircases.find(s => s.id === contact?.surface_id) ?? staircases[0];
  if (!surface) return null;
  const hit = contact?.surface_id === surface.id ? contact : null;
  const face = hit?.face.match(/^(tread|riser):(\d+)$/);
  const index = face ? Number(face[2]) : 0;
  const step = index >= 1 && index <= surface.count ? index : null;
  const sign = surface.direction === 'left' ? -1 : 1;
  const start = bundle.simulation.samples[0].position;
  return {
    surface, step, sign, start, contact: hit?.position ?? null,
    drop: hit ? start.y - hit.position.y : null,
    faceKind: face?.[1],
    corner: (hit?.touching_faces ?? []).filter(f => f.surface_id === surface.id).length > 1,
    faceStart: step ? { x: surface.origin.x + sign * (step - 1) * surface.run,
      y: surface.origin.y - (face?.[1] === 'riser' ? step - 1 : step) * surface.rise } : null,
    faceEnd: step ? { x: surface.origin.x + sign * (face?.[1] === 'riser' ? step - 1 : step) * surface.run,
      y: surface.origin.y - step * surface.rise } : null,
  };
}
