"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as Controls } from "three-stdlib";
import * as THREE from "three";
import SceneLabelLayout from "@/components/SceneLabelLayout";
import { sampleAt, type Bundle, type MeshSpec } from "@/utils/playground";
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

function World({ bundle, time, fit }: { bundle: Bundle; time: number; fit: number }) {
  const { camera, size, gl } = useThree();
  const controls = useRef<Controls>(null);
  const { meshes, simulation, scene } = bundle;
  const measurement = useMemo(() => staircaseMeasurements(bundle), [bundle]);
  const current = sampleAt(simulation.samples, time);
  const bounds = useMemo(() => {
    const points = meshes.flatMap(m => m.kind !== "ground"
      ? m.vertices.map(v => new THREE.Vector3(...v))
      : m.segment.map(p => new THREE.Vector3(p.x, p.y, 0)));
    points.push(...simulation.samples.map(p => new THREE.Vector3(p.position.x, p.position.y, 0)));
    // Frame the physical flight, not the artificial base of continuing stairs.
    if (measurement?.contact && meshes.length === 1) {
      const { surface, start, contact, sign } = measurement;
      return new THREE.Box3().setFromPoints([
        ...simulation.samples.map(p => new THREE.Vector3(p.position.x, p.position.y, 0)),
        new THREE.Vector3(surface.origin.x - sign * surface.run * 3, start.y + surface.rise * 2, -surface.depth / 2),
        new THREE.Vector3(contact.x + sign * surface.run * 3, contact.y - surface.rise * 2, surface.depth / 2),
      ]);
    }
    return new THREE.Box3().setFromPoints(points);
  }, [meshes, simulation, measurement]);
  const span = Math.max(bounds.max.x-bounds.min.x, bounds.max.y-bounds.min.y, 1);
  const { x: minX, y: minY, z: minZ } = bounds.min;
  const { x: maxX, y: maxY, z: maxZ } = bounds.max;
  const annotations = scene.annotations.filter(a => a.target === simulation.particle_id);
  const maxSpeed = useMemo(() => Math.max(1, ...simulation.samples.map(s => Math.hypot(s.velocity.x, s.velocity.y))), [simulation]);
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
    gl.domElement.dataset.camera = JSON.stringify({ position: camera.position.toArray(),
      rotation: camera.quaternion.toArray(), zoom: (camera as THREE.OrthographicCamera).zoom,
      target: controls.current?.target.toArray() });
  }
  // React state still changes when the canvas is offscreen and frames are paused.
  useEffect(recordView);
  useFrame(recordView);
  const path = simulation.samples.map(s => new THREE.Vector3(s.position.x, s.position.y, 0));
  const travelled = path.slice(0, Math.max(1, simulation.samples.findIndex(s => s.t >= time)));
  travelled.push(origin);
  const vectors = annotations.flatMap(a => {
    if (a.quantity === "highlight") return [];
    const values = {
      velocity: { x: current.velocity.x, y: current.velocity.y, label: "v", color: "#177363", scale: span*0.18/maxSpeed, unit: "m/s" },
      velocity_x: { x: current.velocity.x, y: 0, label: "vₓ", color: "#285fb4", scale: span*0.18/maxSpeed, unit: "m/s" },
      velocity_y: { x: 0, y: current.velocity.y, label: "vᵧ", color: "#a63e63", scale: span*0.18/maxSpeed, unit: "m/s" },
      gravity: { x: 0, y: -scene.gravity, label: "g", color: "#925d14", scale: span*0.14/scene.gravity, unit: "m/s²" },
    };
    return [{ ...values[a.quantity], id: a.quantity }];
  });
  return <>
    <ambientLight intensity={1.5} /><directionalLight position={[span,span,span*2]} intensity={2} />
    {meshes.map(m => <Surface key={m.id} spec={m} active={scene.annotations.some(a => a.target === m.id && a.quantity === "highlight")} />)}
    <Line points={path.length > 1 ? path : [path[0], path[0]]} color="#c6cccb" lineWidth={1.5} />
    <Line points={travelled} color="#b77713" lineWidth={2.5} />
    {measurement && (() => {
      const { surface: s, sign, step, start, contact, drop, faceStart, faceEnd, faceKind } = measurement;
      const z = s.depth / 2 + 0.03;
      const point = (x: number, y: number) => new THREE.Vector3(x, y, z);
      const offset = Math.max(s.run * 1.6, span * 0.055);
      const heightX = s.origin.x - sign * offset;
      const firstY = s.origin.y - s.rise;
      const head = Math.min(s.run, s.rise) * 0.16;
      return <group>
        {contact && drop !== null && <>
        <Dimension a={point(heightX, start.y)} b={point(heightX, contact.y)} head={head}
          label={`Drop = ${Number(drop.toFixed(3))} m`} id="stair-drop"
          labelAt={point(heightX - sign * offset * 0.45, (start.y + contact.y) / 2)} />
        {[start.y, contact.y].map(y => <Line key={y}
          points={[point(heightX, y), point(y === start.y ? start.x : contact.x, y)]}
          color="#8caaa9" lineWidth={1} dashed dashSize={span * 0.009} gapSize={span * 0.006} />)}
        </>}
        <Dimension a={point(s.origin.x + sign * s.run * 1.5, s.origin.y)}
          b={point(s.origin.x + sign * s.run * 1.5, firstY)} head={head}
          label={`Step height = ${s.rise} m`} id="stair-rise"
          labelAt={point(s.origin.x + sign * s.run * 2, firstY)} />
        <Dimension a={point(s.origin.x, s.origin.y + s.rise)}
          b={point(s.origin.x + sign * s.run, s.origin.y + s.rise)} head={head}
          label={`Step width = ${s.run} m`} id="stair-run"
          labelAt={point(s.origin.x, s.origin.y + s.rise * 2)} />
        {[s.origin.x, s.origin.x + sign * s.run].map(x => <Line key={x}
          points={[point(x, firstY), point(x, s.origin.y + s.rise)]}
          color="#8caaa9" lineWidth={1} dashed dashSize={span * 0.005} gapSize={span * 0.004} />)}
        {[s.origin.y, firstY].map(y => <Line key={y}
          points={[point(s.origin.x, y), point(s.origin.x + sign * s.run * 1.5, y)]}
          color="#8caaa9" lineWidth={1} dashed dashSize={span * 0.005} gapSize={span * 0.004} />)}
        {contact && faceStart && faceEnd && <>
        <Line points={[point(faceStart.x, faceStart.y), point(faceEnd.x, faceEnd.y)]}
          color="#ae650b" lineWidth={3} depthTest={false} />
        <Label position={point(faceEnd.x + sign * s.run * 0.6, contact.y)}
          text={`Impact: step ${step}${faceKind === 'riser' ? ' (riser)' : ''}`} id="stair-impact" color="#915307" />
        </>}
      </group>;
    })()}
    <mesh position={origin} renderOrder={20}><sphereGeometry args={[measurement ? Math.min(span*0.006, measurement.surface.run*0.1, measurement.surface.rise*0.1) : span*0.008, 24, 16]} />
      <meshStandardMaterial depthTest={false} color={annotations.some(a => a.quantity === "highlight") ? "#e8b333" : "#194d48"} /></mesh>
    {vectors.map(v => {
      const direction = new THREE.Vector3(v.x, v.y, 0);
      const magnitude = direction.length();
      const tip = origin.clone().add(direction.clone().multiplyScalar(v.scale));
      const back = direction.clone().normalize().multiplyScalar(-Math.min(span*0.014, magnitude*v.scale*0.3));
      const perpendicular = new THREE.Vector3(-back.y, back.x, 0).multiplyScalar(0.5);
      return <group key={v.id}>
        {magnitude > 1e-8 && <>
          <Line points={[origin, tip]} color={v.color} lineWidth={2} depthTest={false} renderOrder={10} />
          <Line points={[tip.clone().add(back).add(perpendicular), tip, tip.clone().add(back).sub(perpendicular)]} color={v.color} lineWidth={2} depthTest={false} renderOrder={10} />
        </>}
        <Label position={tip} text={`${v.label} = ${(v.id === "velocity_y" ? v.y : v.id === "velocity_x" ? v.x : magnitude).toFixed(2)} ${v.unit}`}
          color={v.color} id={v.id} />
      </group>;
    })}
    <SceneLabelLayout />
    <OrbitControls ref={controls} enableRotate enableDamping={false}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
  </>;
}

export default function Viewport(props: { bundle: Bundle; time: number; fit: number }) {
  return <div data-audit-surface="animation-scene-3d" style={{ width: "100%", height: "100%", position: "relative" }}>
    <Canvas orthographic camera={{ position: [0,0,100], zoom: 8 }} dpr={[1,2]}
      gl={{ preserveDrawingBuffer: true }} fallback={<p>WebGL is unavailable in this browser.</p>}>
      <color attach="background" args={["#f1f5f4"]} /><World {...props} />
    </Canvas>
  </div>;
}
