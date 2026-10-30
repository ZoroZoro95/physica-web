"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as Controls } from "three-stdlib";
import * as THREE from "three";
import SceneLabelLayout from "@/components/SceneLabelLayout";
import { playbackSample, particleColor, trackStatus, type Bundle, type MeshSpec, type ResolvedMeasurement, type Simulation, type Scene } from "@/utils/playground";
import { staircaseMeasurements } from "@/utils/playgroundMeasurements";

function Dimension({ a, b, label, id, labelAt, head }: {
  a: THREE.Vector3; b: THREE.Vector3; label: string; id: string; labelAt: THREE.Vector3; head: number;
}) {
  const direction = b.clone().sub(a).normalize();
  const side = new THREE.Vector3(-direction.y, direction.x, 0).multiplyScalar(head * 0.45);
  return <group>
    <Line points={[a, b]} color="#496975" lineWidth={1} depthTest={false} />
    {[a, b].map((tip, index) => {
      const back = direction.clone().multiplyScalar(index === 0 ? head : -head);
      return <Line key={index} points={[tip.clone().add(back).add(side), tip, tip.clone().add(back).sub(side)]}
        color="#496975" lineWidth={1} depthTest={false} />;
    })}
    <Label position={labelAt} text={label} id={id} color="#294b58" />
  </group>;
}

function Label({ position, text, id, color }: { position: THREE.Vector3; text: string; id: string; color: string }) {
  return <Html position={position} style={{ pointerEvents: "none" }}><span
    data-audit-scene-label data-label-id={id} data-priority="10"
    style={{ display: "block", whiteSpace: "nowrap", font: "600 13px system-ui", color,
      background: "rgba(247,250,250,.94)", padding: "3px 5px", borderRadius: 3 }}>{text}</span></Html>;
}

function Measurement({ spec, span, z }: { spec: ResolvedMeasurement; span: number; z: number }) {
  if (spec.status !== 'ready' || spec.value === null) return null;
  const points = spec.points.map(p => new THREE.Vector3(p.x, p.y, z));
  const text = `${spec.label} = ${Number(spec.value.toPrecision(5))}${spec.unit === 'deg' ? '°' : ' m'}`;
  const id = `measurement-${spec.id}`;
  if (spec.kind === 'angle') {
    const [a, vertex, b] = points;
    const from = Math.atan2(a.y-vertex.y, a.x-vertex.x);
    const to = Math.atan2(b.y-vertex.y, b.x-vertex.x);
    const sweep = Math.atan2(Math.sin(to-from), Math.cos(to-from));
    const radius = Math.min(span * 0.09, a.distanceTo(vertex) * 0.4, b.distanceTo(vertex) * 0.4);
    const arc = Array.from({ length: 33 }, (_, i) => vertex.clone().add(new THREE.Vector3(
      radius * Math.cos(from+sweep*i/32), radius * Math.sin(from+sweep*i/32), 0)));
    const middle = from+sweep/2;
    return <group>
      <Line points={arc} color="#496975" lineWidth={1.5} depthTest={false} />
      <Line points={[a, vertex, b]} color="#8caaa9" lineWidth={1} dashed dashSize={span*.008} gapSize={span*.006} />
      <Label position={vertex.clone().add(new THREE.Vector3((radius+span*.025)*Math.cos(middle),
        (radius+span*.025)*Math.sin(middle), 0))} text={text} id={id} color="#294b58" />
    </group>;
  }
  const [start, end] = points;
  const offset = span * 0.055;
  let a = start.clone(), b = end.clone();
  if (spec.axis === 'vertical') {
    const x = (spec.side === 1 ? Math.max(a.x, b.x) : Math.min(a.x, b.x)) + spec.side*offset;
    a.x = b.x = x;
  } else if (spec.axis === 'horizontal') {
    const y = (spec.side === 1 ? Math.max(a.y, b.y) : Math.min(a.y, b.y)) + spec.side*offset;
    a.y = b.y = y;
  } else {
    const d = end.clone().sub(start).normalize();
    const shift = new THREE.Vector3(-d.y, d.x, 0).multiplyScalar(spec.side*offset);
    a = a.add(shift); b = b.add(shift);
  }
  const length = a.distanceTo(b);
  return <group>
    {length > 1e-9 && <Dimension a={a} b={b} label={text} id={id}
      labelAt={a.clone().lerp(b, 0.5)} head={Math.min(span*.009, length*.15)} />}
    {length <= 1e-9 && <Label position={a} text={text} id={id} color="#294b58" />}
    {[[start, a], [end, b]].map((line, i) => <Line key={i} points={line} color="#8caaa9"
      lineWidth={1} dashed dashSize={span*.008} gapSize={span*.006} />)}
  </group>;
}

function Surface({ spec, active }: { spec: MeshSpec; active: boolean }) {
  const geometry = useMemo(() => {
    if (spec.kind === "ground") return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(spec.vertices.flat(), 3));
    g.setIndex(spec.triangles.flat());
    g.computeVertexNormals();
    return g;
  }, [spec]);
  const edges = useMemo(() => {
    if (spec.kind !== "ground" && spec.outline) {
      const lines = new THREE.BufferGeometry();
      lines.setAttribute("position", new THREE.Float32BufferAttribute(spec.outline.flat(), 3));
      return lines;
    }
    return geometry ? new THREE.EdgesGeometry(geometry) : null;
  }, [geometry, spec]);
  useEffect(() => () => { geometry?.dispose(); edges?.dispose(); }, [geometry, edges]);
  if (spec.kind === "ground") return <Line points={spec.segment.map(p => [p.x, p.y, 0])}
    color={active ? "#b87708" : "#637778"} lineWidth={3} />;
  return <group>
    <mesh geometry={geometry!}><meshStandardMaterial color={active ? "#e8ba59" : "#9fbfba"} roughness={0.85} flatShading /></mesh>
    <lineSegments geometry={edges!}><lineBasicMaterial color="#557c75" /></lineSegments>
  </group>;
}

function ParticleTrack({ simulation, scene, time, span, radius, index, multiple }: {
  simulation: Simulation; scene: Scene; time: number; span: number; radius: number; index: number; multiple: boolean;
}) {
  const current = playbackSample(simulation, time);
  const waiting = trackStatus(simulation, time) === 'Waiting';
  const origin = new THREE.Vector3(current.position.x, current.position.y, 0);
  const path = simulation.samples.map(s => new THREE.Vector3(s.position.x, s.position.y, 0));
  const next = simulation.samples.findIndex(s => s.t > time);
  const travelled = path.slice(0, next === -1 ? path.length : Math.max(1, next));
  travelled.push(origin);
  const annotations = scene.annotations.filter(a => a.target === simulation.particle_id);
  const maxSpeed = Math.max(1, ...simulation.samples.map(s => Math.hypot(s.velocity.x, s.velocity.y)));
  const ended = !!simulation.contact && time > simulation.contact.time;
  const color = multiple ? particleColor(index) : '#194d48';
  const vectors = annotations.flatMap(a => {
    if (a.quantity === 'highlight' || waiting || (multiple && ended)) return [];
    const values = {
      velocity: { x: current.velocity.x, y: current.velocity.y, label: 'v', color: '#177363', scale: span*.18/maxSpeed, unit: 'm/s' },
      velocity_x: { x: current.velocity.x, y: 0, label: 'vₓ', color: '#285fb4', scale: span*.18/maxSpeed, unit: 'm/s' },
      velocity_y: { x: 0, y: current.velocity.y, label: 'vᵧ', color: '#a63e63', scale: span*.18/maxSpeed, unit: 'm/s' },
      gravity: { x: 0, y: -scene.gravity, label: 'g', color: '#925d14', scale: span*.14/scene.gravity, unit: 'm/s²' },
    };
    return [{ ...values[a.quantity], id: a.quantity }];
  });
  return <group>
    <Line points={path.length > 1 ? path : [path[0], path[0]]} color="#c6cccb" lineWidth={1.5} />
    {!waiting && <Line points={travelled} color={multiple ? color : '#b77713'} lineWidth={2.5} />}
    <mesh position={origin} renderOrder={20}><sphereGeometry args={[radius, 24, 16]} />
      <meshStandardMaterial depthTest={false} color={annotations.some(a => a.quantity === 'highlight') ? '#e8b333' : ended && multiple ? '#697c7a' : color} /></mesh>
    {multiple && <Label position={origin.clone().add(new THREE.Vector3(span*.015, span*.02, 0))}
      text={`${simulation.particle_id}${waiting ? ' · waiting' : ended ? ' · impact' : ''}`} id={`particle-${simulation.particle_id}`} color={color} />}
    {vectors.map(v => {
      const direction = new THREE.Vector3(v.x, v.y, 0), magnitude = direction.length();
      const tip = origin.clone().add(direction.clone().multiplyScalar(v.scale));
      const back = direction.clone().normalize().multiplyScalar(-Math.min(span*.014, magnitude*v.scale*.3));
      const perpendicular = new THREE.Vector3(-back.y, back.x, 0).multiplyScalar(.5);
      return <group key={v.id}>
        {magnitude > 1e-8 && <>
          <Line points={[origin, tip]} color={v.color} lineWidth={2} depthTest={false} renderOrder={10} />
          <Line points={[tip.clone().add(back).add(perpendicular), tip, tip.clone().add(back).sub(perpendicular)]}
            color={v.color} lineWidth={2} depthTest={false} renderOrder={10} />
        </>}
        <Label position={tip} text={`${multiple ? simulation.particle_id + ': ' : ''}${v.label} = ${(v.id === 'velocity_y' ? v.y : v.id === 'velocity_x' ? v.x : magnitude).toFixed(2)} ${v.unit}`}
          color={v.color} id={multiple ? `${simulation.particle_id}-${v.id}` : v.id} />
      </group>;
    })}
  </group>;
}

function World({ bundle, time, fit, showMeasurements = true }: { bundle: Bundle; time: number; fit: number; showMeasurements?: boolean }) {
  const { camera, size, gl } = useThree();
  const controls = useRef<Controls>(null);
  const { meshes, simulation, scene } = bundle;
  const tracks = useMemo(() => bundle.tracks ?? [simulation], [bundle.tracks, simulation]);
  const measurement = useMemo(() => staircaseMeasurements(bundle), [bundle]);
  const current = playbackSample(simulation, time);
  const bounds = useMemo(() => {
    const samples = tracks.flatMap(t => t.samples);
    const flight = new THREE.Box3().setFromPoints(samples.map(p => new THREE.Vector3(p.position.x, p.position.y, 0)));
    const padding = Math.max(flight.max.x-flight.min.x, flight.max.y-flight.min.y, 1)*0.15;
    const points = meshes.flatMap(m => m.kind !== "ground"
      ? m.vertices.map(v => new THREE.Vector3(...v))
      : (() => {
        // A large ground extent controls collision, not the teaching viewport.
        // Keep finite edges when they fall within the flight's horizontal window.
        const lo = Math.max(Math.min(...m.segment.map(p => p.x)), flight.min.x-padding);
        const hi = Math.min(Math.max(...m.segment.map(p => p.x)), flight.max.x+padding);
        return lo <= hi ? [new THREE.Vector3(lo, m.segment[0].y, 0), new THREE.Vector3(hi, m.segment[0].y, 0)]
          : m.segment.map(p => new THREE.Vector3(p.x, p.y, 0));
      })());
    points.push(...samples.map(p => new THREE.Vector3(p.position.x, p.position.y, 0)));
    const measuredPoints = tracks.flatMap(t => (t.measurements ?? []).flatMap(m => m.points.map(p => new THREE.Vector3(p.x, p.y, 0))));
    points.push(...measuredPoints);
    // Frame the physical flight, not the artificial base of continuing stairs.
    if (tracks.length === 1 && measurement?.contact && meshes.length === 1) {
      const { surface, start, contact, sign } = measurement;
      return new THREE.Box3().setFromPoints([
        ...simulation.samples.map(p => new THREE.Vector3(p.position.x, p.position.y, 0)),
        ...measuredPoints,
        new THREE.Vector3(surface.origin.x - sign * surface.run * 3, start.y + surface.rise * 2, -surface.depth / 2),
        new THREE.Vector3(contact.x + sign * surface.run * 3, contact.y - surface.rise * 2, surface.depth / 2),
      ]);
    }
    return new THREE.Box3().setFromPoints(points);
  }, [meshes, simulation, measurement, tracks]);
  const span = Math.max(bounds.max.x-bounds.min.x, bounds.max.y-bounds.min.y, 1);
  const { x: minX, y: minY, z: minZ } = bounds.min;
  const { x: maxX, y: maxY, z: maxZ } = bounds.max;
  const origin = new THREE.Vector3(current.position.x, current.position.y, 0);
  useEffect(() => {
    const center = new THREE.Vector3((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2);
    camera.position.copy(center).add(new THREE.Vector3(span*0.22, span*0.12, span*2));
    camera.lookAt(center);
    camera.near = 0.01;
    camera.far = span*10 + 100;
    camera.updateMatrixWorld(true);
    const corners = [minX, maxX].flatMap(x => [minY, maxY].flatMap(y =>
      [minZ, maxZ].map(z => new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse))));
    const view = new THREE.Box3().setFromPoints(corners);
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.min(size.width/Math.max(view.max.x-view.min.x, 1), size.height/Math.max(view.max.y-view.min.y, 1))*0.72;
    ortho.updateProjectionMatrix();
    controls.current?.target.copy(center);
    controls.current?.update();
    gl.domElement.dataset.framed = "true";
  }, [minX, minY, minZ, maxX, maxY, maxZ, camera, gl, size.width, size.height, span, fit]);
  function recordView() {
    const projected = origin.clone().project(camera);
    gl.domElement.dataset.particle = JSON.stringify([current.position.x, current.position.y]);
    gl.domElement.dataset.particleScreen = JSON.stringify([(projected.x+1)*size.width/2, (1-projected.y)*size.height/2]);
    gl.domElement.dataset.time = String(current.t);
    gl.domElement.dataset.sceneTime = String(time);
    gl.domElement.dataset.trailPoints = String(travelled.length);
    gl.domElement.dataset.particles = JSON.stringify(tracks.map(track => {
      const sample = playbackSample(track, time);
      const screen = new THREE.Vector3(sample.position.x, sample.position.y, 0).project(camera);
      return { id: track.particle_id, position: sample.position, velocity: sample.velocity, status: trackStatus(track, time),
        screen: [(screen.x+1)*size.width/2, (1-screen.y)*size.height/2] };
    }));
    gl.domElement.dataset.camera = JSON.stringify({ position: camera.position.toArray(),
      rotation: camera.quaternion.toArray(), zoom: (camera as THREE.OrthographicCamera).zoom,
      target: controls.current?.target.toArray() });
  }
  // React state still changes when the canvas is offscreen and frames are paused.
  useEffect(recordView);
  useFrame(recordView);
  const path = simulation.samples.map(s => new THREE.Vector3(s.position.x, s.position.y, 0));
  const nextSample = simulation.samples.findIndex(s => s.t > time);
  const travelled = path.slice(0, nextSample === -1 ? path.length : Math.max(1, nextSample));
  travelled.push(origin);
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[span,span,span*2]} intensity={2} />
    {meshes.map(m => <Surface key={m.id} spec={m} active={scene.annotations.some(a => a.target === m.id && a.quantity === "highlight")} />)}
    {tracks.map((track, index) => <ParticleTrack key={track.particle_id} simulation={track} scene={scene}
      time={time} span={span} index={index} multiple={tracks.length > 1}
      radius={measurement ? Math.min(span*.006, measurement.surface.run*.1, measurement.surface.rise*.1) : span*.008} />)}
    {showMeasurements && (simulation.measurements ?? []).map(spec => <Measurement key={spec.id} spec={spec} span={span} z={maxZ+0.03} />)}
    {measurement && (() => {
      const { surface: s, sign, step, contact, faceStart, faceEnd, faceKind, corner } = measurement;
      const z = s.depth / 2 + 0.03;
      const point = (x: number, y: number) => new THREE.Vector3(x, y, z);
      return <group>
        {contact && faceStart && faceEnd && <>
        <Line points={[point(faceStart.x, faceStart.y), point(faceEnd.x, faceEnd.y)]}
          color="#ae650b" lineWidth={3} depthTest={false} />
        <Label position={point(faceEnd.x + sign * s.run * 0.6, contact.y)}
          text={`Impact: step ${step}${corner ? ' (corner)' : faceKind === 'riser' ? ' (riser)' : ''}`} id="stair-impact" color="#915307" />
        </>}
      </group>;
    })()}
    <SceneLabelLayout />
    <OrbitControls ref={controls} enableRotate enableDamping={false}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
  </>;
}

export default function Viewport(props: { bundle: Bundle; time: number; fit: number; showMeasurements?: boolean }) {
  return <div data-audit-surface="animation-scene-3d" style={{ width: "100%", height: "100%", position: "relative" }}>
    <Canvas orthographic camera={{ position: [0,0,100], zoom: 8 }} dpr={[1,2]}
      gl={{ preserveDrawingBuffer: true }} fallback={<p>WebGL is unavailable in this browser.</p>}>
      <color attach="background" args={["#f1f5f4"]} /><World {...props} />
    </Canvas>
  </div>;
}
