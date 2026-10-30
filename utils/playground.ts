export type XY = { x: number; y: number };
export type Quantity = "velocity" | "velocity_x" | "velocity_y" | "gravity" | "highlight";
export type Scene = {
  schema_version: "1"; id: string; revision: number; gravity: number;
  surfaces: unknown[];
  particles: { id: string; position: XY; velocity: XY; launch_set: boolean; launch_time?: number }[];
  annotations: { target: string; quantity: Quantity }[];
  measurements?: unknown[] | null;
};
export type ResolvedMeasurement = {
  id: string; label: string; kind: 'distance' | 'angle'; status: 'ready' | 'unavailable';
  points: XY[]; value: number | null; unit: 'm' | 'deg';
  axis: 'horizontal' | 'vertical' | 'direct'; side: -1 | 1; reason: string | null;
};
export type MeshSpec = { id: string } & (
  { kind: "wedge" | "staircase"; vertices: [number, number, number][]; triangles: [number, number, number][]; outline?: [number, number, number][] }
  | { kind: "ground"; segment: XY[] }
);
export type Sample = { t: number; position: XY; velocity: XY };
export type Simulation = {
  scene_id: string; revision: number; particle_id: string; status: "contact" | "time_limit" | "waiting";
  launch_time?: number;
  samples: Sample[];
  contact: null | { time: number; surface_id: string; face: string; position: XY; velocity: XY;
    touching_faces?: { surface_id: string; face: string }[] };
  measurements?: ResolvedMeasurement[];
};
export type SceneSimulation = { scene_id: string; revision: number; duration: number;
  interaction: 'independent'; tracks: Simulation[] };
export type Bundle = { scene: Scene; meshes: MeshSpec[]; simulation: Simulation;
  tracks?: Simulation[]; duration?: number; maxTime?: number };

export function particleColor(index: number) {
  return ['#194d48', '#285fb4', '#a63e63', '#925d14'][index % 4];
}

export function trackStatus(track: Simulation, time: number) {
  if (track.status === 'waiting' || time < (track.launch_time ?? 0)) return 'Waiting';
  return track.contact && time >= track.contact.time ? 'Contact' :
    time >= track.samples.at(-1)!.t ? 'Time limit' : 'In flight';
}

export function playbackSample(track: Simulation, time: number): Sample {
  if (trackStatus(track, time) === 'Waiting') {
    return { t: time, position: track.samples[0].position, velocity: { x: 0, y: 0 } };
  }
  return sampleAt(track.samples, time);
}

export function contactDescription(contact: NonNullable<Simulation['contact']>) {
  const faces = contact.touching_faces ?? [];
  if (faces.length > 1) {
    const sameSurface = faces.every(f => f.surface_id === contact.surface_id);
    return `${sameSurface ? 'Corner' : 'Shared contact'} · ${sameSurface ? `${contact.surface_id} / ` : ''}${faces.map(f => sameSurface ? f.face : `${f.surface_id}/${f.face}`).join(' + ')}`;
  }
  return `Contact · ${contact.surface_id} / ${contact.face}`;
}
export type Generation = {
  status: "review" | "needs_clarification" | "unsupported" | "failed";
  reason: string; assumptions: string[]; report_id: string;
  scene: Scene | null; simulation: Simulation | null; meshes: MeshSpec[];
};

export async function playground<T>(path: string, body: unknown, timeout = 15000): Promise<T> {
  const response = await fetch(`/api/playground/v1/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail)
      ? detail.map((e: { msg?: string }) => e.msg ?? "Invalid scene").join("; ")
      : "Playground API unavailable. Check the service on port 8001.");
  }
  return data as T;
}

export async function loadScene(input: unknown, particleId?: string, maxTime = 30): Promise<Bundle> {
  const scene = await playground<Scene>("scenes/validate", input);
  const particle = scene.particles.find(p => p.id === particleId) ?? scene.particles[0];
  if (!particle) throw new Error("Add a particle before simulating this scene.");
  const geometry = await playground<{ meshes: MeshSpec[] }>("geometry", scene);
  if (scene.particles.length > 1) {
    const result = await playground<SceneSimulation>('simulations/scene', { scene, samples: 501, max_time: maxTime });
    if (result.scene_id !== scene.id || result.revision !== scene.revision ||
        result.tracks.length !== scene.particles.length ||
        scene.particles.some(p => result.tracks.filter(t => t.particle_id === p.id &&
          t.scene_id === scene.id && t.revision === scene.revision && t.samples.length > 0).length !== 1)) {
      throw new Error('The scene and particle tracks do not match.');
    }
    return { scene, meshes: geometry.meshes, simulation: result.tracks.find(t => t.particle_id === particle.id)!,
      tracks: result.tracks, duration: result.duration, maxTime };
  }
  const simulation = await playground<Simulation>("simulations", {
    scene, particle_id: particle.id, samples: 501, max_time: maxTime,
  });
  return { scene, meshes: geometry.meshes, simulation, maxTime };
}

/** Interpolate returned samples for playback; do not solve a second trajectory. */
export function sampleAt(samples: Sample[], time: number): Sample {
  if (samples.length === 1 || time <= samples[0].t) return samples[0];
  if (time >= samples.at(-1)!.t) return samples.at(-1)!;
  let low = 0, high = samples.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].t <= time) low = mid; else high = mid;
  }
  const a = samples[low], b = samples[high], f = (time - a.t) / (b.t - a.t);
  const mix = (p: XY, q: XY) => ({ x: p.x + f*(q.x-p.x), y: p.y + f*(q.y-p.y) });
  return { t: time, position: mix(a.position, b.position), velocity: mix(a.velocity, b.velocity) };
}
