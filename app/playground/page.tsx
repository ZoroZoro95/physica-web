"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { loadScene, playground, sampleAt, type Bundle, type Quantity, type Scene } from "@/utils/playground";
import styles from "./playground.module.css";

const Viewport = dynamic(() => import("@/components/playground/Viewport"), { ssr: false });
const initial = { surface: "wedge", slope: -30, width: 50, speed: 10, gravity: 10, direction: "surface_normal", angle: 45,
  rise: 1, run: 1, count: 30, descent: "right" };

async function buildScene(config: typeof initial) {
  const scene = await playground<Scene>("scenes", { gravity: config.gravity });
  const surface = config.surface === "wedge"
    ? { op: "add_wedge", id: "surface", width: config.width, angle_deg: config.slope, depth: 3 }
    : config.surface === "staircase"
      ? { op: "add_surface", surface: { kind: "staircase", id: "surface", rise: config.rise,
          run: config.run, count: config.count, direction: config.descent, depth: 2 } }
      : { op: "add_surface", surface: { kind: "ground", id: "surface", x_min: 0, x_max: config.width } };
  const changed = await playground<Scene>("scenes/apply", { scene, commands: [
    surface,
    { op: "add_particle", id: "P", ...(config.surface === "staircase"
      ? { position: { x: 0, y: 0 } } : { on_surface: { surface_id: "surface", fraction: 0.3 } }) },
    { op: "set_launch", particle_id: "P", speed: config.speed, direction: config.direction,
      ...(config.direction === "angle" ? { angle_deg: config.angle } : { surface_id: "surface" }) },
  ] });
  return loadScene(changed);
}

export default function Playground() {
  const [config, setConfig] = useState(initial);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [fit, setFit] = useState(0);
  const request = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const duration = bundle?.simulation.samples.at(-1)?.t ?? 0;
  const current = bundle ? sampleAt(bundle.simulation.samples, time) : null;

  async function replace(task: () => Promise<Bundle>, reset = true) {
    const token = ++request.current;
    setBusy(true); setError(""); setPlaying(false);
    try {
      const result = await task();
      if (token !== request.current) return;
      setBundle(result);
      if (reset) { setTime(0); setFit(n => n+1); }
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : "Unable to load scene");
    } finally { if (token === request.current) setBusy(false); }
  }
  useEffect(() => {
    void replace(() => buildScene(initial));
    return () => { request.current += 1; };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame: number, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now-last)/1000, 0.1)*rate;
      last = now;
      setTime(t => Math.min(duration, t+dt));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, rate]);
  useEffect(() => { if (time >= duration) setPlaying(false); }, [time, duration]);

  function annotate(quantity: Quantity, visible: boolean) {
    if (!bundle) return;
    void replace(async () => {
      const scene = await playground<Scene>("scenes/apply", { scene: bundle.scene, commands: [
        { op: "set_annotation", annotation: { target: bundle.simulation.particle_id, quantity }, visible },
      ] });
      return loadScene(scene, bundle.simulation.particle_id);
    }, false);
  }
  function download() {
    if (!bundle) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle.scene, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "playground-scene.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const number = (key: "slope" | "width" | "speed" | "gravity" | "angle" | "rise" | "run" | "count", title: string, min: number, max: number) =>
    <label>{title}<input aria-label={title} type="number" min={min} max={max} step={key === "count" ? 1 : "any"} required value={config[key]}
      onChange={e => setConfig({ ...config, [key]: e.target.value === "" ? "" as unknown as number : Number(e.target.value) })} /></label>;

  return <main className={styles.app}>
    <header className={styles.header}><div><strong>Physica / Playground</strong><span>Local prototype</span></div>
      <div className={styles.actions}>
        <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Scene file" onChange={e => {
          const selected = e.target.files?.[0]; e.target.value = "";
          if (!selected) return;
          void replace(async () => {
            if (selected.size > 1_000_000) throw new Error("Scene file exceeds 1 MB.");
            return loadScene(JSON.parse(await selected.text()));
          });
        }} />
        <button disabled={busy} onClick={() => file.current?.click()}>Import scene</button>
        <button disabled={!bundle || busy} onClick={download}>Export scene</button>
      </div>
    </header>
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <form onSubmit={e => { e.preventDefault(); void replace(() => buildScene(config)); }}>
          <h1>Scene</h1>
          <label>Surface<select aria-label="Surface" value={config.surface} onChange={e => setConfig({ ...config, surface: e.target.value,
            ...(e.target.value === "staircase" ? { direction: "angle", angle: config.descent === "right" ? 0 : 180 } : {}) })}>
            <option value="wedge">Wedge</option><option value="ground">Ground</option><option value="staircase">Staircase</option></select></label>
          {config.surface === "wedge" && number("slope", "Slope (°)", -89, 89)}
          {config.surface === "staircase" ? <>
            {number("rise", "Step height (m)", 0.01, 100)}
            {number("run", "Step width (m)", 0.01, 100)}
            {number("count", "Steps", 1, 128)}
            <label>Descent<select aria-label="Descent" value={config.descent} onChange={e => setConfig({ ...config,
              descent: e.target.value, angle: e.target.value === "right" ? 0 : 180 })}>
              <option value="right">To the right</option><option value="left">To the left</option>
            </select></label>
          </> : number("width", "Width (m)", 0.01, 1000)}
          {number("gravity", "Gravity (m/s²)", 0.01, 100)}
          <h2>Launch</h2>
          {number("speed", "Speed (m/s)", 0, 1000)}
          <label>Direction<select value={config.direction} onChange={e => setConfig({ ...config, direction: e.target.value })}>
            {config.surface !== "staircase" && <><option value="surface_normal">Normal to surface</option><option value="surface_tangent">Along surface</option></>}<option value="angle">Angle from horizontal</option>
          </select></label>
          {config.direction === "angle" && number("angle", "Launch angle (°)", -180, 180)}
          <button className={styles.primary} disabled={busy} type="submit">{busy ? "Calculating…" : "Build scene"}</button>
        </form>
        {bundle && <section className={styles.annotations}>
          <h2>Objects</h2>
          <label>Particle<select aria-label="Particle" value={bundle.simulation.particle_id} disabled={busy}
            onChange={e => void replace(() => loadScene(bundle.scene, e.target.value))}>
            {bundle.scene.particles.map(p => <option key={p.id}>{p.id}</option>)}
          </select></label>
          <h2>Vectors</h2>
          {([["velocity", "Velocity v"], ["velocity_x", "Horizontal vₓ"], ["velocity_y", "Vertical vᵧ"], ["gravity", "Gravity g"]] as [Quantity,string][]).map(([q, title]) =>
            <label className={styles.check} key={q}><input type="checkbox" disabled={busy}
              checked={bundle.scene.annotations.some(a => a.target === bundle.simulation.particle_id && a.quantity === q)}
              onChange={e => annotate(q, e.target.checked)} />{title}</label>)}
        </section>}
      </aside>
      <section className={styles.stage}>
        {error && <div role="alert" data-testid="playground-error" className={styles.error}>{error}</div>}
        <div className={styles.sceneHeader}><strong>{bundle ? `Particle ${bundle.simulation.particle_id}` : "Scene"}</strong>
          <button disabled={!bundle} onClick={() => setFit(n => n+1)}>Fit view</button></div>
        <div className={styles.viewport} data-testid="playground-viewport">
          {bundle ? <Viewport bundle={bundle} time={time} fit={fit} /> : <div className={styles.empty}>{busy ? "Loading scene…" : "No scene loaded"}</div>}
        </div>
        <div className={styles.transport}>
          <button disabled={!bundle || busy || duration === 0} onClick={() => {
            if (time >= duration) setTime(0); setPlaying(p => !p);
          }}>{playing ? "Pause" : "Play"}</button>
          <button disabled={!bundle} onClick={() => { setTime(0); setPlaying(false); }}>Reset</button>
          <input aria-label="Simulation time" type="range" min={0} max={duration || 1} step="any" value={time}
            disabled={!bundle || duration === 0} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} />
          <output data-testid="time">{time.toFixed(2)} s</output>
          <select aria-label="Playback speed" value={rate} onChange={e => setRate(Number(e.target.value))}>
            <option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
          </select>
        </div>
        <dl className={styles.readouts}>
          {current && [["x", current.position.x, "m"], ["y", current.position.y, "m"], ["vₓ", current.velocity.x, "m/s"], ["vᵧ", current.velocity.y, "m/s"]].map(([name,value,unit]) =>
            <div key={name}><dt>{name}</dt><dd>{Number(value).toFixed(2)} <small>{unit}</small></dd></div>)}
        </dl>
        {bundle && <footer className={styles.result} data-testid="result">
          {bundle.simulation.contact ? `Contact · ${bundle.simulation.contact.surface_id} / ${bundle.simulation.contact.face} · ${bundle.simulation.contact.time.toFixed(3)} s`
            : `No surface contact within ${duration.toFixed(1)} s`}
        </footer>}
      </section>
    </div>
  </main>;
}
