"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import TeachingBoard2D from "@/components/TeachingBoard2D";

const AnimationScene3D = dynamic(() => import("@/components/AnimationScene3D"), { ssr: false });

type Point2 = { x: number; y: number; label?: string; t?: number };

type SceneSpec = {
  problem: { world: string; unknown: string; engine_case: string };
  warnings: string[];
  geometry: {
    points: Record<string, Point2>;
    surfaces?: Array<Record<string, unknown>>;
    obstacles: Array<Record<string, unknown>>;
  };
  trajectories: Array<{
    id?: string;
    actor?: string;
    sampled_points: Point2[];
    time_window?: { start: number; end: number };
  }>;
  motions?: Array<{
    actor: string;
    kind: string;
    initial: { x: number; y: number; vx: number; vy: number };
    acceleration: { x: number; y: number };
    duration: number;
    time_window?: { start: number; end: number };
  }>;
  motion?: {
    kind: string;
    initial: { x: number; y: number; vx: number; vy: number };
    acceleration: { x: number; y: number };
    duration: number;
  };
  live_vectors?: Array<{
    id: string;
    actor: string;
    kind: string;
    component: string;
    anchor: string;
    label: string;
  }>;
  storyboard?: Array<{
    step_id: string;
    visual_action?: string;
    camera: string;
    visible_vectors: string[];
    overlays: string[];
    visual_focus: string[];
    highlight_ids?: string[];
    labels?: Array<{ target_id: string; text: string }>;
    motion?: Record<string, unknown>;
    visual_state?: {
      visible_ids?: string[];
      visible_vectors?: string[];
      highlight_ids?: string[];
      label_ids?: string[];
      dimmed_ids?: string[];
      persist_until?: string;
    };
    why: string;
  }>;
  quantities: Record<string, { value: number; unit: string; label: string }>;
};

type BeatPairing = {
  beat_id: string;
  step_id: string;
  title: string;
  status: string;
  learner_message: string;
  beat_visual: string;
  animation_action: string;
  visible_vectors: string[];
  overlays: string[];
  highlight_ids: string[];
  render_probe?: {
    expected_vector_ids?: string[];
    expected_point_ids?: string[];
    expected_surface_ids?: string[];
    expected_show_trajectory?: boolean;
    expected_overlay_flags?: string[];
  };
};

type AuditPayload = {
  request?: {
    question_text_solver?: string;
    question_text?: string;
  };
  solver?: { status?: string; engine_case?: string; answer?: string; reason?: string };
  walkthrough?: { engine_case?: string; explainer_beats?: unknown[] } | null;
  animation_scene_spec?: SceneSpec | null;
  audit?: {
    ok?: boolean;
    hard_fail_reason?: string;
    findings?: string[];
    beat_pairings?: BeatPairing[];
  };
};

const API = "/api/backend";

export default function WalkthroughSyncAuditPage() {
  const [question, setQuestion] = useState("A ball is thrown at u=16 m/s at 53 deg. Find range and time of flight.");
  const [rawJson, setRawJson] = useState("");
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clientReady, setClientReady] = useState(false);

  const normalized = useMemo(() => normalizePayload(payload), [payload]);
  const scene = normalized.scene;

  useEffect(() => {
    setClientReady(true);
    const loaded = readInitialPayload();
    if (loaded.rawJson && !payload) {
      setRawJson(loaded.rawJson);
      setPayload(loaded.payload);
      const loadedQuestion = questionFromPayload(loaded.payload);
      if (loadedQuestion) setQuestion(loadedQuestion);
    }
  }, [payload]);

  useEffect(() => {
    const receivePayload = (event: Event) => {
      const detail = (event as CustomEvent<{ rawJson?: string; payload?: AuditPayload }>).detail;
      const raw = detail?.rawJson ?? "";
      const nextPayload = detail?.payload ?? (raw ? JSON.parse(raw) as AuditPayload : null);
      setRawJson(raw || JSON.stringify(nextPayload, null, 2));
      setPayload(nextPayload);
      const loadedQuestion = questionFromPayload(nextPayload);
      if (loadedQuestion) setQuestion(loadedQuestion);
    };
    window.addEventListener("walkthrough-sync-audit-payload", receivePayload);
    return () => window.removeEventListener("walkthrough-sync-audit-payload", receivePayload);
  }, []);

  const renderJson = () => {
    setError("");
    try {
      const nextPayload = JSON.parse(rawJson) as AuditPayload;
      setPayload(nextPayload);
      const loadedQuestion = questionFromPayload(nextPayload);
      if (loadedQuestion) setQuestion(loadedQuestion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const runQuestionAudit = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/audit/walkthrough-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text_solver: question,
          options: [],
          givens: [],
          requested_quantity: null,
          suggested_engine_case: null,
          diagram: null,
        }),
      });
      if (!response.ok) throw new Error(`Audit API failed: ${response.status}`);
      const data = await response.json();
      setPayload(data);
      setRawJson(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit request failed");
    } finally {
      setLoading(false);
    }
  };

  if (process.env.NEXT_PUBLIC_DISABLE_AUDIT_ROUTE === "true") {
    return <main style={pageStyle}><h1 style={titleStyle}>Render Audit Disabled</h1></main>;
  }

  return (
    <main style={pageStyle} data-audit-page="walkthrough-sync" data-audit-client-ready={clientReady ? "true" : "false"}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Walkthrough Render Audit</h1>
          <p style={mutedStyle}>Backend beat contract on the left, actual rendered board state on the right.</p>
        </div>
        {normalized.scene && (
          <div style={statusStyle(normalized.audit?.ok)}>
            {normalized.audit?.ok ? "contract ok" : normalized.audit?.hard_fail_reason || "contract issues"}
          </div>
        )}
      </header>

      <section style={controlGridStyle}>
        <div style={panelStyle}>
          <label style={labelStyle} htmlFor="audit-question">Question</label>
          <textarea
            id="audit-question"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            style={inputStyle}
            rows={4}
          />
          <button type="button" onClick={runQuestionAudit} style={buttonStyle} disabled={loading}>
            {loading ? "Running..." : "Run API Audit"}
          </button>
        </div>
        <div style={panelStyle}>
          <label style={labelStyle} htmlFor="audit-json">Audit JSON</label>
          <textarea
            id="audit-json"
            data-audit-input="payload"
            value={rawJson}
            onChange={event => setRawJson(event.target.value)}
            style={inputStyle}
            rows={4}
            placeholder="Paste /audit/walkthrough-sync response JSON"
          />
          <button type="button" data-audit-render="payload" onClick={renderJson} style={buttonStyle}>
            Render JSON
          </button>
        </div>
      </section>

      {error && <div style={errorStyle}>{error}</div>}

      {scene && (
        <section style={summaryGridStyle}>
          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>Solver</h2>
            <dl style={metaGridStyle}>
              <dt>Status</dt><dd>{normalized.solver?.status || "-"}</dd>
              <dt>Engine</dt><dd>{normalized.solver?.engine_case || scene.problem.engine_case}</dd>
              <dt>Answer</dt><dd>{normalized.solver?.answer || "-"}</dd>
            </dl>
          </div>
          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>Findings</h2>
            {(normalized.audit?.findings?.length ? normalized.audit.findings : ["No automated findings."]).map(item => (
              <div key={item} style={findingStyle}>{item}</div>
            ))}
          </div>
        </section>
      )}

      {scene && (
        <section style={fullLifecycleStyle}>
          <div style={panelHeaderStyle}>
            <h2 style={sectionTitleStyle}>Full Lifecycle</h2>
            <span style={mutedStyle}>Must stay separate from beat replay.</span>
          </div>
          <div style={fullLifecycleCanvasStyle}>
            <AnimationScene3D sceneSpec={scene} stepId="__full_lifecycle" animationProgress={0.35} vectorMode="none" />
          </div>
        </section>
      )}

      <section style={beatListStyle} data-audit-beat-list="true">
        {scene && normalized.pairings.map((pairing, index) => (
          <article key={`${pairing.step_id}:${index}`} style={beatRowStyle} data-audit-beat-row={pairing.step_id}>
            <div style={beatTextStyle}>
              <div style={beatIndexStyle}>{index + 1}</div>
              <h2 style={beatTitleStyle}>{pairing.title || pairing.step_id}</h2>
              <p style={messageStyle}>{pairing.learner_message || "No learner message."}</p>
              <AuditRows pairing={pairing} />
            </div>
            <div style={boardShellStyle}>
              <TeachingBoard2D
                sceneSpec={scene}
                stepId={pairing.step_id}
                animationProgress={0.65}
                revealIds={[]}
                highlightIds={pairing.highlight_ids ?? []}
                mode="concept"
                answerText={normalized.solver?.answer ?? ""}
              />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function AuditRows({ pairing }: { pairing: BeatPairing }) {
  const probe = pairing.render_probe ?? {};
  const rows = [
    ["Pairing", pairing.status],
    ["Beat visual", pairing.beat_visual || "-"],
    ["Animation action", pairing.animation_action || "-"],
    ["Vectors expected", (probe.expected_vector_ids ?? pairing.visible_vectors ?? []).join(", ") || "-"],
    ["Points expected", (probe.expected_point_ids ?? []).join(", ") || "-"],
    ["Surfaces expected", (probe.expected_surface_ids ?? []).join(", ") || "-"],
    ["Trajectory", probe.expected_show_trajectory ? "expected" : "not expected"],
  ];
  return (
    <dl style={auditGridStyle}>
      {rows.map(([key, value]) => (
        <div key={key} style={auditRowStyle}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function normalizePayload(payload: AuditPayload | null) {
  const maybeWrapped = payload as AuditPayload & { data?: AuditPayload };
  const source = maybeWrapped?.data ?? payload;
  return {
    solver: source?.solver,
    scene: source?.animation_scene_spec ?? null,
    audit: source?.audit,
    pairings: source?.audit?.beat_pairings ?? [],
  };
}

function questionFromPayload(payload: AuditPayload | null): string {
  const maybeWrapped = payload as AuditPayload & { data?: AuditPayload };
  const source = maybeWrapped?.data ?? payload;
  return source?.request?.question_text_solver || source?.request?.question_text || "";
}

function readInitialPayload(): { rawJson: string; payload: AuditPayload | null } {
  if (typeof window === "undefined") return { rawJson: "", payload: null };
  const rawJson = window.sessionStorage.getItem("walkthrough-sync-audit-payload") ?? "";
  if (!rawJson) return { rawJson: "", payload: null };
  try {
    return { rawJson, payload: JSON.parse(rawJson) as AuditPayload };
  } catch {
    return { rawJson, payload: null };
  }
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#edf1ef",
  color: "#17242b",
  padding: 20,
  fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 28, lineHeight: 1.15, letterSpacing: 0 };
const mutedStyle: CSSProperties = { margin: "5px 0 0", color: "#667774", fontSize: 13 };
const controlGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 12 };
const summaryGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(260px, 0.8fr) minmax(320px, 1.2fr)", gap: 12, marginBottom: 12 };
const panelStyle: CSSProperties = { background: "#fbfcfa", border: "1px solid rgba(23,36,43,0.12)", borderRadius: 8, padding: 12 };
const labelStyle: CSSProperties = { display: "block", fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#4f615f" };
const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid rgba(23,36,43,0.18)", borderRadius: 6, padding: 9, font: "12px var(--font-geist-mono), monospace", color: "#17242b", background: "#fff" };
const buttonStyle: CSSProperties = { marginTop: 8, border: "1px solid rgba(23,36,43,0.16)", background: "#2c7a78", color: "#fff", borderRadius: 6, padding: "8px 10px", fontWeight: 800, cursor: "pointer" };
const errorStyle: CSSProperties = { background: "#fff1ef", border: "1px solid rgba(184,79,68,0.28)", color: "#9f3f36", borderRadius: 8, padding: 10, marginBottom: 12 };
const statusStyle = (ok?: boolean): CSSProperties => ({ border: "1px solid rgba(23,36,43,0.14)", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 900, color: ok ? "#1f7a5a" : "#9f3f36", background: ok ? "rgba(31,122,90,0.10)" : "rgba(184,79,68,0.10)" });
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 16, lineHeight: 1.25 };
const metaGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "88px 1fr", gap: "6px 10px", margin: "10px 0 0", fontSize: 13 };
const findingStyle: CSSProperties = { fontSize: 13, lineHeight: 1.45, padding: "5px 0", borderTop: "1px solid rgba(23,36,43,0.08)" };
const fullLifecycleStyle: CSSProperties = { background: "#101820", borderRadius: 8, padding: 12, marginBottom: 12, color: "#fbfcfa" };
const panelHeaderStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 };
const fullLifecycleCanvasStyle: CSSProperties = { height: 360, minHeight: 0, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, overflow: "hidden" };
const beatListStyle: CSSProperties = { display: "grid", gap: 12 };
const beatRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(320px, 0.9fr) minmax(420px, 1.1fr)", gap: 12, background: "#fbfcfa", border: "1px solid rgba(23,36,43,0.12)", borderRadius: 8, padding: 12 };
const beatTextStyle: CSSProperties = { minWidth: 0 };
const beatIndexStyle: CSSProperties = { width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 999, background: "#2c7a78", color: "#fff", fontWeight: 900, marginBottom: 8 };
const beatTitleStyle: CSSProperties = { margin: 0, fontSize: 18, lineHeight: 1.25 };
const messageStyle: CSSProperties = { fontSize: 14, lineHeight: 1.5, color: "#344947" };
const boardShellStyle: CSSProperties = { height: 420, minHeight: 0, border: "1px solid rgba(23,36,43,0.12)", borderRadius: 8, overflow: "hidden" };
const auditGridStyle: CSSProperties = { display: "grid", gap: 5, margin: 0, fontSize: 12 };
const auditRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, borderTop: "1px solid rgba(23,36,43,0.08)", paddingTop: 5 };
