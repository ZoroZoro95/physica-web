"use client";

import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SceneObject {
  id: string;
  type: "sphere" | "box" | "plane" | "cylinder" | "line" | "arrow" | "axes" | "trail" | "rope" | "spring" | "arc";
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  label?: string;
  label_always_visible?: boolean;
  args?: number[];
  path?: [number, number, number][];
  rotation_path?: [number, number, number][];
  visible?: boolean;
  opacity?: number;
  emissive?: boolean;
  emissive_intensity?: number;
  physics_intent?: { type: string; params: Record<string, unknown> };
}

export interface Annotation {
  id: string; text: string;
  position: [number, number, number];
  color?: string; size?: "sm" | "md" | "lg";
  path?: [number, number, number][];
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number; transition_duration?: number;
}

export interface Chapter {
  id: string; title: string; narration: string;
  camera: CameraState;
  objects: SceneObject[];
  annotations?: Annotation[];
  reveal_ids?: string[]; hide_ids?: string[];
  autoplay?: boolean; loop?: boolean; duration_hint?: number;
}

export interface SceneEffects {
  background_color?: string; bloom?: boolean; grid?: boolean;
  ambient_intensity?: number; directional_intensity?: number;
}

export interface PhysicsScene {
  topic: string; subject: string;
  effects?: SceneEffects; chapters: Chapter[];
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SCALE = 10.0;
const SCENE_GRAVITY = 1.0;
const ARROW_PX = 0.06;

const THEME = {
  bg: "#1e1e2e",
  bgPanel: "#2a2a3e",
  grid: "#2d2d45",
  gridSub: "#252538",
  ground: "#2d2d45",
  text: "#e8e8f0",
  textMuted: "#6b6b8a",
  border: "#3a3a55",
  panel: "rgba(30,30,46,0.92)",
  btnBg: "rgba(255,255,255,0.06)",
  btnBorder: "rgba(255,255,255,0.12)",
  btnText: "rgba(255,255,255,0.7)",
  accent: "#58c4dd",
};

const VX_COLOR = "#58c4dd";
const VY_COLOR = "#ffff00";
const VT_COLOR = "#fc6255";

// ─────────────────────────────────────────────
// Math utils
// ─────────────────────────────────────────────

const isV3 = (p: unknown): p is [number, number, number] =>
  Array.isArray(p) && p.length === 3 &&
  (p as number[]).every(v => typeof v === "number" && isFinite(v));

function vecLen(v: [number, number, number]) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function samplePath(path: [number, number, number][], t: number): [number, number, number] {
  if (!path || path.length === 0) return [0, 0, 0];
  if (path.length === 1) return path[0];
  const c = Math.min(Math.max(t, 0), 1);
  const exact = c * (path.length - 1);
  const lo = Math.floor(exact);
  const hi = Math.min(lo + 1, path.length - 1);
  const a = exact - lo;
  const p1 = path[lo], p2 = path[hi];
  return [p1[0] + (p2[0] - p1[0]) * a, p1[1] + (p2[1] - p1[1]) * a, p1[2] + (p2[2] - p1[2]) * a];
}

function projectileVelAt(
  v0s: [number, number, number],
  path: [number, number, number][],
  t: number,
  T_override?: number
): [number, number, number] {
  let T = T_override ?? 0;
  if (!T) {
    const sy = path[0][1], vy = v0s[1], g = SCENE_GRAVITY;
    const disc = vy * vy + 2 * g * sy;
    if (disc >= 0) {
      const candidates = [(vy + Math.sqrt(disc)) / g, (vy - Math.sqrt(disc)) / g].filter(x => x > 0.001);
      T = candidates.length ? Math.max(...candidates) : 4.0;
    } else T = 4.0;
  }
  const tPhys = t * T;
  return [v0s[0], v0s[1] - SCENE_GRAVITY * tPhys, v0s[2]];
}

function velToReal(vs: [number, number, number]): [number, number, number] {
  return [vs[0] * SCALE, vs[1] * SCALE, vs[2] * SCALE];
}

// ─────────────────────────────────────────────
// AutoFitCamera
// ─────────────────────────────────────────────

function AutoFitCamera({ chapter, chapterKey }: { chapter: Chapter; chapterKey: string }) {
  const { camera, controls } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const endPos = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const progress = useRef(1);

  useEffect(() => {
    const box = new THREE.Box3();
    chapter.objects.forEach(obj => {
      if (isV3(obj.position)) box.expandByPoint(new THREE.Vector3(...obj.position));
      if (obj.path) obj.path.forEach(p => { if (isV3(p)) box.expandByPoint(new THREE.Vector3(...p)); });
    });
    (chapter.annotations ?? []).forEach(ann => {
      if (isV3(ann.position)) box.expandByPoint(new THREE.Vector3(...ann.position));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(5, 3, 1));

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const pad = 1.35;
    const maxDim = Math.max(size.x, size.y, size.z) * pad;
    const fov = 42 * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2);
    const camPos = new THREE.Vector3(
      center.x + dist * 0.8,
      center.y + dist * 0.6,
      center.z + dist * 0.8,
    );

    startPos.current.copy(camera.position);
    // @ts-ignore
    startTarget.current.copy(controls?.target ?? center);
    endPos.current.copy(camPos);
    endTarget.current.copy(center);
    progress.current = 0;

    if (chapterKey.endsWith("-snap")) {
      camera.position.copy(camPos);
      // @ts-ignore
      if (controls?.target) { controls.target.copy(center); controls.update(); }
      progress.current = 1;
    }
  }, [chapterKey]); // eslint-disable-line

  useFrame((_, delta) => {
    if (progress.current >= 1) return;
    const dur = chapter.camera?.transition_duration ?? 1.0;
    progress.current = Math.min(progress.current + delta / dur, 1);
    const p = progress.current;
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    camera.position.lerpVectors(startPos.current, endPos.current, ease);
    // @ts-ignore
    if (controls?.target) {
      // @ts-ignore
      controls.target.lerpVectors(startTarget.current, endTarget.current, ease);
      // @ts-ignore
      controls.update();
    }
    (camera as THREE.PerspectiveCamera).fov = 42;
    camera.updateProjectionMatrix();
  });

  return null;
}

// ─────────────────────────────────────────────
// ZoomHandler
// ─────────────────────────────────────────────

function ZoomHandler({ trigger, setTrigger }: { trigger: "in" | "out" | null, setTrigger: (t: null) => void }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!trigger) return;
    // @ts-ignore
    const target = controls?.target;
    if (target) {
      const dist = camera.position.distanceTo(target);
      const dir = camera.position.clone().sub(target).normalize();
      if (trigger === "in") camera.position.copy(target).add(dir.multiplyScalar(dist * 0.75));
      else if (trigger === "out") camera.position.copy(target).add(dir.multiplyScalar(dist * 1.33));
      // @ts-ignore
      controls?.update();
    }
    setTrigger(null);
  }, [trigger, camera, controls, setTrigger]);
  return null;
}

// ─────────────────────────────────────────────
// Arrow3D
// ─────────────────────────────────────────────

function Arrow3D({ from, to, color, label, opacity = 1 }: {
  from: [number, number, number]; to: [number, number, number];
  color: string; label?: string; opacity?: number;
}) {
  const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = dir.length();
  if (length < 0.06) return null;
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const euler = new THREE.Euler().setFromQuaternion(quat);
  const shaft = Math.max(length - 0.28, 0.04);

  return (
    <group position={from} rotation={[euler.x, euler.y, euler.z]}>
      <mesh position={[0, shaft / 2, 0]}>
        <cylinderGeometry args={[0.022, 0.022, shaft, 10]} />
        <meshStandardMaterial color={color} roughness={0.2} metalness={0} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, shaft + 0.14, 0]}>
        <coneGeometry args={[0.07, 0.28, 10]} />
        <meshStandardMaterial color={color} roughness={0.2} metalness={0} transparent opacity={opacity} />
      </mesh>
      {label && (
        <Html position={[0, length + 0.45, 0]} center distanceFactor={10}>
          <div style={{
            background: THEME.bgPanel, border: `1px solid ${color}44`,
            color, padding: "3px 9px", borderRadius: 10,
            fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
            fontWeight: 700, whiteSpace: "nowrap",
            boxShadow: `0 2px 12px rgba(0,0,0,0.45), 0 0 8px ${color}22`,
          }}>{label}</div>
        </Html>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────
// ThetaArc
// ─────────────────────────────────────────────

function ThetaArc({ origin, v0, radius = 0.75 }: {
  origin: [number, number, number]; v0: [number, number, number]; radius?: number;
}) {
  const angle = Math.atan2(v0[1], v0[0]);
  if (Math.abs(angle) < 0.01) return null;
  const steps = 24;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * angle;
    pts.push([origin[0] + radius * Math.cos(a), origin[1] + radius * Math.sin(a), origin[2]]);
  }
  const labelAngle = angle / 2;
  const labelPos: [number, number, number] = [
    origin[0] + (radius + 0.4) * Math.cos(labelAngle),
    origin[1] + (radius + 0.4) * Math.sin(labelAngle),
    origin[2],
  ];
  return (
    <>
      <Line points={pts} color={VY_COLOR} lineWidth={2} opacity={0.8} transparent />
      <Line points={[origin, [origin[0] + radius + 0.2, origin[1], origin[2]]]}
        color={THEME.textMuted} lineWidth={1} opacity={0.4} transparent dashed dashSize={0.1} gapSize={0.08} />
      <Html position={labelPos} center distanceFactor={10}>
        <div style={{
          color: VY_COLOR, fontSize: 11,
          fontFamily: "'SF Mono','JetBrains Mono',monospace", fontWeight: 700,
          whiteSpace: "nowrap", pointerEvents: "none"
        }}>θ = {(angle * 180 / Math.PI).toFixed(1)}°</div>
      </Html>
    </>
  );
}

// ─────────────────────────────────────────────
// LiveVectors
// ─────────────────────────────────────────────

function LiveVectors({ v0, path, t, origin, intentParams }: {
  v0: [number, number, number]; path: [number, number, number][];
  t: number; origin: [number, number, number];
  intentParams?: Record<string, unknown>;
}) {
  const T = intentParams?.T ? Number(intentParams.T) : undefined;
  const vs = projectileVelAt(v0, path, t, T);
  const vr = velToReal(vs);

  const vxEnd: [number, number, number] = [origin[0] + vs[0] * ARROW_PX * SCALE, origin[1], origin[2] + vs[2] * ARROW_PX * SCALE];
  const vyEnd: [number, number, number] = [origin[0], origin[1] + vs[1] * ARROW_PX * SCALE, origin[2]];
  const vtEnd: [number, number, number] = [origin[0] + vs[0] * ARROW_PX * SCALE, origin[1] + vs[1] * ARROW_PX * SCALE, origin[2]];

  const vxL = Math.abs(vs[0]) * ARROW_PX * SCALE;
  const vyL = Math.abs(vs[1]) * ARROW_PX * SCALE;
  const spd = vecLen(vr);

  return <>
    {vxL > 0.06 && <Arrow3D from={origin} to={vxEnd} color={VX_COLOR} label={`Vx = ${Math.abs(vr[0]).toFixed(1)} m/s`} />}
    {vyL > 0.06 && <Arrow3D from={origin} to={vyEnd} color={VY_COLOR} label={`Vy = ${vr[1].toFixed(1)} m/s`} />}
    {spd > 0.5 && <Arrow3D from={origin} to={vtEnd} color={VT_COLOR} label={`v = ${spd.toFixed(1)} m/s`} opacity={0.65} />}
  </>;
}

// ─────────────────────────────────────────────
// TrajectoryTrail
// ─────────────────────────────────────────────

function TrajectoryTrail({ path, t, color }: {
  path: [number, number, number][]; t: number; color: string;
}) {
  const travelled = path.slice(0, Math.max(2, Math.ceil(t * path.length)));
  return <>
    <Line points={path} color="#cccccc" lineWidth={1}
      dashed dashSize={0.15} gapSize={0.1} opacity={0.5} transparent />
    {travelled.length >= 2 && (
      <Line points={travelled} color={color} lineWidth={2.5} opacity={0.85} transparent />
    )}
  </>;
}

// ─────────────────────────────────────────────
// Phase 3: pulsing highlight material
// ─────────────────────────────────────────────

function PulsingMaterial({ color, baseIntensity = 0.7 }: { color: string; baseIntensity?: number }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!matRef.current) return;
    // Smooth sine pulse between 0.2 and 1.2
    matRef.current.emissiveIntensity =
      baseIntensity + 0.5 * Math.sin(clock.getElapsedTime() * 3.5);
  });
  return (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      emissive={color}
      emissiveIntensity={baseIntensity}
      roughness={0.2}
      metalness={0.05}
    />
  );
}

// ─────────────────────────────────────────────
// PhysicsObject  (Phase 3: accepts isHighlighted)
// ─────────────────────────────────────────────

function PhysicsObject({ obj, t, showVectors, isHighlighted }: {
  obj: SceneObject; t: number; showVectors: boolean; isHighlighted: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const hasPath = Array.isArray(obj.path) && obj.path.length >= 2;
  const currentPos: [number, number, number] = hasPath
    ? samplePath(obj.path!, t)
    : (isV3(obj.position) ? obj.position : [0, 0, 0]);

  const v0Raw = obj.physics_intent?.params?.velocity;
  const v0: [number, number, number] | null = Array.isArray(v0Raw) && v0Raw.length >= 3
    ? [Number(v0Raw[0]), Number(v0Raw[1]), Number(v0Raw[2])] : null;
  const isProjectile = obj.physics_intent?.type === "projectile" && v0 !== null && hasPath;

  if (obj.visible === false) return null;

  const matProps = { roughness: 0.25, metalness: 0.05 };

  const renderMesh = () => {
    switch (obj.type) {
      case "sphere": return (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[Math.max(obj.args?.[0] ?? 0.3, 0.08), 32, 32]} />
          {isHighlighted
            ? <PulsingMaterial color={obj.color} />
            : <meshStandardMaterial color={obj.color} {...matProps} />}
        </mesh>
      );
      case "box": return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[obj.args?.[0] ?? 1, obj.args?.[1] ?? 1, obj.args?.[2] ?? 1]} />
          {isHighlighted
            ? <PulsingMaterial color={obj.color} />
            : <meshStandardMaterial color={obj.color} {...matProps} />}
        </mesh>
      );
      case "cylinder": return (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[obj.args?.[0] ?? 0.3, obj.args?.[1] ?? 0.3, obj.args?.[2] ?? 1, 32]} />
          {isHighlighted
            ? <PulsingMaterial color={obj.color} />
            : <meshStandardMaterial color={obj.color} {...matProps} />}
        </mesh>
      );
      case "plane": return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[obj.args?.[0] ?? 20, obj.args?.[1] ?? 20]} />
          <meshStandardMaterial color={THEME.ground} transparent opacity={0.6} depthWrite={false} />
        </mesh>
      );
      case "arrow": {
        const len = obj.args?.[0] ?? 2;
        return (
          <group>
            <mesh position={[0, len / 2, 0]}>
              <cylinderGeometry args={[0.03, 0.03, len, 12]} />
              <meshStandardMaterial color={obj.color} {...matProps} />
            </mesh>
            <mesh position={[0, len + 0.14, 0]}>
              <coneGeometry args={[0.09, 0.28, 12]} />
              <meshStandardMaterial color={obj.color} {...matProps} />
            </mesh>
          </group>
        );
      }
      case "spring": {
        const sLen = obj.args?.[0] ?? 3, coils = 10;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= coils * 14; i++) {
          const tt = i / (coils * 14), ang = tt * coils * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(ang) * 0.12, tt * sLen - sLen / 2, Math.sin(ang) * 0.12));
        }
        return <Line points={pts} color={obj.color} lineWidth={2} />;
      }
      case "rope":
        if (!obj.path || obj.path.length < 2) return null;
        return <Line points={obj.path} color={obj.color} lineWidth={3} />;
      case "axes":
        return <axesHelper args={[obj.args?.[0] ?? 4]} />;
      default: return null;
    }
  };

  return <>
    {hasPath && obj.type !== "rope" && obj.type !== "plane" && obj.type !== "axes" && (
      <TrajectoryTrail path={obj.path!} t={t} color={obj.color} />
    )}
    {isProjectile && v0 && t < 0.14 && (
      <ThetaArc origin={obj.path![0]} v0={v0} />
    )}
    <group
      position={currentPos}
      rotation={(obj.rotation ?? [0, 0, 0]) as [number, number, number]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {renderMesh()}
      {obj.label && (obj.label_always_visible || hovered) && (
        <Html distanceFactor={12} position={[0, (obj.args?.[0] ?? 0.3) + 0.45, 0]} center>
          <div style={{
            background: isHighlighted ? `${obj.color}22` : THEME.bgPanel,
            border: `1px solid ${isHighlighted ? obj.color : THEME.border}`,
            color: isHighlighted ? obj.color : THEME.text,
            padding: "3px 9px", borderRadius: 10,
            fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
            fontWeight: 600, whiteSpace: "nowrap",
            boxShadow: isHighlighted
              ? `0 0 12px ${obj.color}66, 0 2px 12px rgba(0,0,0,0.4)`
              : "0 2px 12px rgba(0,0,0,0.4)",
            transition: "all 0.2s",
          }}>{obj.label}</div>
        </Html>
      )}
    </group>
    {isProjectile && v0 && showVectors && t > 0.01 && t < 0.999 && (
      <LiveVectors v0={v0} path={obj.path!} t={t} origin={currentPos}
        intentParams={obj.physics_intent?.params} />
    )}
  </>;
}

// ─────────────────────────────────────────────
// WorldAnnotation
// ─────────────────────────────────────────────

function WorldAnnotation({ ann, t }: { ann: Annotation; t: number }) {
  const pos: [number, number, number] = ann.path && ann.path.length >= 2
    ? samplePath(ann.path, t)
    : (isV3(ann.position) ? ann.position : [0, 0, 0]);
  const sizes: Record<string, string> = { sm: "10px", md: "12px", lg: "15px" };
  return (
    <Html position={pos} center>
      <div style={{
        color: ann.color ?? THEME.text, fontSize: sizes[ann.size ?? "md"],
        fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
        whiteSpace: "nowrap", pointerEvents: "none",
        background: THEME.bgPanel, padding: "3px 9px", borderRadius: 8,
        border: `1px solid ${THEME.border}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        textShadow: `0 0 8px ${(ann.color ?? THEME.accent)}55`,
      }}>{ann.text}</div>
    </Html>
  );
}

// ─────────────────────────────────────────────
// Ground
// ─────────────────────────────────────────────

function Ground() {
  return <>
    <gridHelper args={[60, 60, THEME.grid, THEME.gridSub]} position={[0, 0, 0]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
      <planeGeometry args={[400, 400]} />
      <meshStandardMaterial color={THEME.ground} transparent opacity={0.3} />
    </mesh>
  </>;
}

// ─────────────────────────────────────────────
// AnimationClock
// ─────────────────────────────────────────────

function AnimationClock({ playing, loop, duration, onTick, chapterKey }: {
  playing: boolean; loop: boolean; duration: number;
  onTick: (t: number) => void; chapterKey: string;
}) {
  const elapsed = useRef(0);
  useEffect(() => { elapsed.current = 0; onTick(0); }, [chapterKey]); // eslint-disable-line
  useFrame((_, delta) => {
    if (!playing) return;
    elapsed.current += delta;
    let t = elapsed.current / duration;
    if (loop) t = t % 1; else t = Math.min(t, 1);
    onTick(t);
  });
  return null;
}

// ─────────────────────────────────────────────
// ParamPanel
// ─────────────────────────────────────────────

function ParamPanel({ chapter, t }: { chapter: Chapter; t: number }) {
  const ball = chapter.objects.find(o => o.type === "sphere" && Array.isArray(o.path) && o.path.length >= 2);
  if (!ball || !ball.path) return null;

  const ip = ball.physics_intent?.params ?? {};
  const v0Raw = ip.velocity;
  const v0s: [number, number, number] | null = Array.isArray(v0Raw) && v0Raw.length >= 3
    ? [Number(v0Raw[0]), Number(v0Raw[1]), Number(v0Raw[2])] : null;

  const vx_r = ip.vx_real != null ? Number(ip.vx_real) : (v0s ? v0s[0] * SCALE : null);
  const vy0_r = ip.vy_real != null ? Number(ip.vy_real) : (v0s ? v0s[1] * SCALE : null);
  const v0_r = ip.v0_real != null ? Number(ip.v0_real) : null;
  const T = ip.T != null ? Number(ip.T) : null;

  const pos_s = samplePath(ball.path, t);
  const land_s = ball.path[ball.path.length - 1];
  const vel_s = v0s ? projectileVelAt(v0s, ball.path, t, T ?? undefined) : null;
  const vel_r = vel_s ? velToReal(vel_s) : null;
  const spd_r = vel_r ? vecLen(vel_r) : null;
  const angle = (vx_r != null && vy0_r != null) ? Math.atan2(vy0_r, vx_r) * 180 / Math.PI : null;
  const atLanding = t > 0.93;

  type Row = [string, string, string];
  const rows: Row[] = [
    ...(angle != null ? [["θ₀", `${angle.toFixed(2)}°`, VY_COLOR] as Row] : []),
    ...(v0_r != null ? [["v₀", `${v0_r.toFixed(2)} m/s`, "#888"] as Row] : []),
    ...(vx_r != null ? [["Vx", `${vx_r.toFixed(2)} m/s`, VX_COLOR] as Row] : []),
    ...(vel_r ? [[atLanding ? "Vy'" : "Vy", `${vel_r[1].toFixed(2)} m/s`, VY_COLOR] as Row] : []),
    ...(vel_r ? [[atLanding ? "|v|'" : "|v|", `${spd_r!.toFixed(2)} m/s`, VT_COLOR] as Row] : []),
    ["x", `${(pos_s[0] * SCALE).toFixed(2)} m`, "#888"],
    ["y", `${(pos_s[1] * SCALE).toFixed(2)} m`, "#888"],
    ["Range", `${(land_s[0] * SCALE).toFixed(2)} m`, "#83c167"],
    ...(T != null ? [["T", `${T.toFixed(2)} s`, "#888"] as Row] : []),
    ...(ip.height_real != null && Number(ip.height_real) > 0
      ? [["h", `${Number(ip.height_real).toFixed(2)} m`, "#83c167"] as Row] : []),
  ];

  return (
    <div style={{
      position: "absolute", top: 16, right: 16, zIndex: 20,
      background: THEME.bgPanel, border: `1px solid ${THEME.border}`,
      borderRadius: 12, padding: "12px 14px", minWidth: 165,
      fontFamily: "'JetBrains Mono','SF Mono',monospace",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      backdropFilter: "blur(16px)",
    }}>
      <div style={{
        fontSize: 9, letterSpacing: "0.12em", color: THEME.textMuted,
        textTransform: "uppercase", marginBottom: 10, fontWeight: 600
      }}>Parameters</div>
      {rows.map(([k, v, c]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 11, lineHeight: "2.0" }}>
          <span style={{ color: THEME.textMuted }}>{k}</span>
          <span style={{ color: c, fontWeight: 700 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main SceneViewer  (Phase 3: highlightId + highlightStep props)
// ─────────────────────────────────────────────

interface SceneViewerProps {
  scene: PhysicsScene;
  chapterIndex: number;
  onCapture?: (base64: string) => void;
  autoPlay?: boolean;
  replayNonce?: number;
  // Phase 3 additions
  highlightId?: string | null;
  highlightStep?: number | null;
  // Cozy classroom additions
  onTick?: (t: number) => void;          // live 0-1 progress for telemetry
  externalPlaying?: boolean | null;      // null = use internal state; boolean = override
}

export default function SceneViewer({
  scene, chapterIndex, onCapture,
  autoPlay = true, replayNonce = 0,
  highlightId = null, highlightStep = null,
  onTick, externalPlaying = null,
}: SceneViewerProps) {
  const chapter = scene.chapters[chapterIndex];
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showVec, setShowVec] = useState(true);
  const [zoomTrigger, setZoomTrigger] = useState<"in" | "out" | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => { setT(0); setPlaying(autoPlay && (chapter?.autoplay ?? true)); }, [chapterIndex, autoPlay]); // eslint-disable-line

  useEffect(() => {
    if (replayNonce === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setT(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaying(true);
  }, [replayNonce]);

  useEffect(() => {
    if (!onCapture || !glRef.current) return;
    const id = setTimeout(() => {
      const url = glRef.current!.domElement.toDataURL("image/jpeg", 0.75);
      onCapture(url.split(",")[1]);
    }, 900);
    return () => clearTimeout(id);
  }, [chapterIndex, t, onCapture]);

  const replay = useCallback(() => { setT(0); setPlaying(true); }, []);
  if (!chapter) return null;
  const hideSet = new Set(chapter.hide_ids ?? []);

  // A highlight is active only when both the id and step match the current chapter
  const activeHighlight = (highlightId && highlightStep === chapterIndex) ? highlightId : null;

  return (
    <div className="relative w-full h-full" style={{ background: THEME.bg }}>
      <Canvas
        shadows
        camera={{ position: [14, 10, 14], fov: 42 }}
        onCreated={({ gl }) => { glRef.current = gl; }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={[THEME.bg]} />

        <AutoFitCamera chapter={chapter} chapterKey={`${chapterIndex}-${chapter.id}`} />

        <AnimationClock
          playing={externalPlaying != null ? externalPlaying : playing} loop={chapter.loop ?? false}
          duration={chapter.duration_hint ?? 7}
          onTick={(tick) => { setT(tick); onTick?.(tick); }}
          chapterKey={`${chapterIndex}-${chapter.id}-${replayNonce}`}
        />

        <ZoomHandler trigger={zoomTrigger} setTrigger={setZoomTrigger} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[15, 30, 15]} intensity={0.9} castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-30} shadow-camera-right={30}
            shadow-camera-top={30} shadow-camera-bottom={-30}
            shadow-bias={-0.001} />
          <directionalLight position={[-10, 15, -10]} intensity={0.25} color="#4466ff" />
          <pointLight position={[0, 10, 0]} intensity={0.2} color="#58c4dd" />

          <Ground />

          {chapter.objects.filter(o => !hideSet.has(o.id)).map(o => (
            <PhysicsObject
              key={`${chapter.id}-${o.id}`}
              obj={o}
              t={t}
              showVectors={showVec}
              isHighlighted={o.id === activeHighlight}
            />
          ))}

          {(chapter.annotations ?? []).map(a => (
            <WorldAnnotation key={a.id} ann={a} t={t} />
          ))}

          {/* OrbitControls — kept fully enabled, student can always pan/rotate/zoom */}
          <OrbitControls makeDefault enablePan={false} enableDamping
            dampingFactor={0.06} rotateSpeed={0.55}
            minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.05} />
        </Suspense>
      </Canvas>

      <ParamPanel chapter={chapter} t={t} />

      {/* Progress bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 2, background: "rgba(255,255,255,0.06)", zIndex: 10 }}>
        <div data-testid="scene-progress-fill" style={{
          height: "100%", width: `${t * 100}%`,
          background: `linear-gradient(90deg,${THEME.accent},#fc6255)`,
          boxShadow: `0 0 6px ${THEME.accent}`,
          transition: "width 0.08s linear"
        }} />
      </div>

      {/* Controls — bottom right */}
      <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 20, display: "flex", gap: 6 }}>
        {([
          { label: "zoom -", action: () => setZoomTrigger("out"), active: false },
          { label: "zoom +", action: () => setZoomTrigger("in"), active: false },
          { label: "vectors", action: () => setShowVec(v => !v), active: showVec },
          { label: "replay", action: replay, active: false },
          { label: playing ? "pause" : "play", action: () => setPlaying(p => !p), active: false },
        ]).map(({ label, action, active }) => (
          <button key={label} onClick={action} style={{
            background: active ? `${THEME.accent}22` : THEME.btnBg,
            border: `1px solid ${active ? THEME.accent : THEME.btnBorder}`,
            color: active ? THEME.accent : THEME.btnText,
            padding: "5px 13px", borderRadius: 20, fontSize: 10,
            fontFamily: "'JetBrains Mono','SF Mono',monospace",
            fontWeight: 500, cursor: "pointer", letterSpacing: "0.04em",
            backdropFilter: "blur(8px)",
          }}>{label}</button>
        ))}
      </div>

      {/* Chapter title — top left */}
      <div style={{
        position: "absolute", top: 16, left: 16, zIndex: 20,
        fontFamily: "'JetBrains Mono','SF Mono',monospace",
        fontSize: 10, color: THEME.textMuted, letterSpacing: "0.14em",
        textTransform: "uppercase", fontWeight: 600,
      }}>{chapter.title}</div>
    </div>
  );
}
