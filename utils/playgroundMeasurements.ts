import type { Bundle, XY } from './playground';

export type Staircase = {
  kind: 'staircase'; id: string; origin: XY; rise: number; run: number;
  count: number; direction: 'left' | 'right'; depth: number;
};

export function staircaseMeasurements(bundle: Bundle) {
  const contact = bundle.simulation.contact;
  const surface = bundle.scene.surfaces.find(value => {
    const s = value as Partial<Staircase> | null;
    return s?.kind === 'staircase' && s.id === contact?.surface_id;
  }) as Staircase | undefined;
  if (!surface || !contact || !/^tread:\d+$/.test(contact.face)) return null;
  const step = Number(contact.face.split(':')[1]);
  if (step < 1 || step > surface.count) return null;
  const sign = surface.direction === 'left' ? -1 : 1;
  const start = bundle.simulation.samples[0].position;
  return {
    surface, step, sign, start, contact: contact.position,
    drop: start.y - contact.position.y,
    treadStart: { x: surface.origin.x + sign * (step - 1) * surface.run, y: contact.position.y },
    treadEnd: { x: surface.origin.x + sign * step * surface.run, y: contact.position.y },
  };
}
