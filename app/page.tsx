"use client";

import { useState, useRef, useCallback, useEffect, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import katex from "katex";
import TeacherPanel from "@/components/TeacherPanel";
import VideoController from "@/components/VideoController";
import { PhysicsScene } from "@/components/SceneViewer";
import { buildLessonScene, getFocusId } from "@/utils/lessonScript";
import TeachingBoard2D from "@/components/TeachingBoard2D";
import type { BeatVisualSpec } from "@/types/visualContract";

const SceneViewer = dynamic(() => import("@/components/SceneViewer"), { ssr: false });
const AnimationScene3D = dynamic(() => import("@/components/AnimationScene3D"), { ssr: false });

const API = "/api/backend";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          cancel?: () => void;
        };
      };
    };
  }
}

// ─────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────

const T = {
  bg: "#eef4f3",
  surface: "#fbfcfa",
  surfaceNavy: "#102027",
  surfaceNavy2: "#17333d",
  parchment: "#fbfcfa",
  parchment2: "#e6eee9",
  border: "rgba(16,32,39,0.14)",
  borderSub: "rgba(16,32,39,0.09)",
  text: "#102027",
  textOnDark: "#fbfcfa",
  textMid: "#51636a",
  textMuted: "#7a8a8f",
  accent: "#2c7a78",
  accentHov: "#3fa7a3",
  danger: "#c9574d",
  green: "#1f7a5a",
  brass: "#b8872f",
  brassHov: "#d5a84f",
  radius: "14px",
  radiusSm: "8px",
  shadow: "0 24px 70px rgba(16,32,39,0.16), 0 2px 10px rgba(16,32,39,0.08)",
  shadowSm: "0 8px 24px rgba(16,32,39,0.10)",
  fontUi: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontDisplay: "'Instrument Serif', Georgia, serif",
};

const smallGhostButtonStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 7,
  color: T.textOnDark,
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
  padding: "5px 7px",
  whiteSpace: "nowrap",
};

const R = {
  bg: "#f3efe6",
  bg2: "#e8eee9",
  surface: "#fffaf0",
  surface2: "#f8f1e4",
  surface3: "#f0eadc",
  text: "#17242b",
  textMid: "#4f615f",
  textMuted: "#75807b",
  border: "rgba(23,36,43,0.14)",
  borderSub: "rgba(23,36,43,0.09)",
  accent: "#2c7a78",
  accentSoft: "rgba(44,122,120,0.10)",
  good: "#1f7a5a",
  goodSoft: "rgba(31,122,90,0.10)",
  warn: "#8b6f33",
  warnSoft: "rgba(184,135,47,0.12)",
  danger: "#b84f44",
  dangerSoft: "rgba(184,79,68,0.10)",
};

const MAX_DOUBTS_PER_CHAPTER = 3;
type LessonMode = "ready" | "text" | "tutor" | "doubt";

interface ExtractedQuestion {
  debug_report_id?: string | null;
  debug_report_path?: string | null;
  question_text: string;
  question_text_raw?: string;
  question_text_display?: string;
  question_text_solver?: string;
  cleaned_prompt: string;
  is_projectile_question: boolean;
  question_type: "mcq" | "subjective" | "unknown";
  options: string[];
  diagram: {
    present: boolean;
    type: string;
    entities: Array<{
      id: string;
      kind: string;
      label?: string | null;
      label_display?: string | null;
      label_solver?: string | null;
      value?: string | null;
      unit?: string | null;
      description: string;
      confidence: number;
    }>;
    coordinate_system?: string | null;
    confidence: number;
  };
  givens: string[];
  requested_quantity?: string | null;
  suggested_engine_case?: string | null;
  confidence: number;
  needs_review: boolean;
  warnings: string[];
}

interface SolveResult {
  debug_report_id?: string | null;
  debug_report_path?: string | null;
  status: "passed" | "failed" | "unsupported" | "needs_review";
  engine_case?: string | null;
  template_id?: string | null;
  template_confidence?: number | null;
  template_reason?: string;
  template_warnings?: string[];
  diagram_valid?: boolean | null;
  diagram_warnings?: string[];
  equation_plan?: {
    template_id: string;
    engine_case: string;
    goal: string;
    givens: string[];
    unknown: string;
    invariant: string;
    steps: Array<{
      id: string;
      title: string;
      equation: string;
      substitution: string;
      explanation: string;
      focus_ids: string[];
    }>;
    final_answer: string;
    exam_takeaway: string;
  } | null;
  answer?: string | null;
  matched_option?: string | null;
  computed_value?: number | null;
  trace: string[];
  animation_scene_spec?: AnimationSceneSpec | null;
  walkthrough?: {
    engine_case: string;
    answer?: string | null;
    matched_option?: string | null;
    diagram_model?: DiagramModel;
    steps: Array<{
      id: string;
      beat_visual_spec?: BeatVisualSpec;
      title: string;
      student_goal?: string;
      concept_used?: string;
      formula: string;
      equation?: string;
      substitution?: string;
      calculation?: string;
      result?: string;
      explanation: string;
      animation_intent: string;
      focus_ids: string[];
      animation_focus?: string;
      objects_to_highlight?: string[];
      voiceover_text?: string;
    }>;
    explainer_beats?: ExplainerBeatUi[];
  } | null;
  reason: string;
  feedback_ticket_id?: string | null;
  feedback_status?: string | null;
}

interface AuthState {
  token: string;
  user: {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };
}

interface FeedbackNotification {
  notification_id: string;
  ticket_id: string;
  created_at: string;
  question_text: string;
  engine_case?: string | null;
  answer?: string | null;
}

type GoogleIdApi = NonNullable<Window["google"]>["accounts"]["id"];

interface AnimationSceneSpec {
  schema_version: number;
  problem: {
    world: string;
    unknown: string;
    constraints: string[];
    engine_case: string;
  };
  geometry: {
    points: Record<string, { x: number; y: number; label?: string }>;
    surfaces: Array<Record<string, unknown>>;
    obstacles: Array<Record<string, unknown>>;
    axes: Array<Record<string, unknown>>;
  };
  trajectories: Array<{
    id: string;
    actor: string;
    equation: string;
    sampled_points: Array<{ x: number; y: number; t?: number }>;
  }>;
  quantities: Record<string, { value: number; unit: string; label: string }>;
  events: Array<{ id: string; time: number; point: string; label: string }>;
  steps: Array<{
    id: string;
    beat_visual_spec?: BeatVisualSpec;
    title: string;
    equation_step_id: string;
    student_goal?: string;
    concept_used?: string;
    equation?: string;
    substitution?: string;
    visual_action?: string;
    trap_note?: string;
    focus_ids: string[];
    reveal_ids: string[];
    highlight_ids: string[];
    camera_target_ids: string[];
    overlays: string[];
  }>;
  warnings: string[];
}

interface WalkthroughStepUi {
  id: string;
  beat_visual_spec?: BeatVisualSpec;
  title: string;
  student_goal?: string;
  teaching_goal?: string;
  visual_action?: string;
  concept_used?: string;
  formula: string;
  equation?: string;
  substitution?: string;
  calculation?: string;
  result?: string;
  explanation: string;
  trap_note?: string;
  animation_intent: string;
  focus_ids: string[];
  camera_target_ids?: string[];
  highlight_ids?: string[];
  animation_focus?: string;
  objects_to_highlight?: string[];
  known_values?: string[];
  next_known_values?: string[];
  voiceover_text?: string;
}

interface ExplainerSubRevealUi {
  id: string;
  beat_visual_spec?: BeatVisualSpec;
  text?: string;
  visual_instruction?: string;
  formula_lines?: string[];
  reveal_ids?: string[];
  highlight_ids?: string[];
}

interface ExplainerBeatUi {
  id: string;
  beat_visual_spec?: BeatVisualSpec;
  step_id?: string;
  title?: string;
  learner_message?: string;
  visual_instruction?: string;
  animation_phase?: string;
  formula_lines?: string[];
  sub_reveals?: ExplainerSubRevealUi[];
  reveal_ids?: string[];
  highlight_ids?: string[];
  why_it_matters?: string;
}

interface SolutionPlayback {
  prompt: string;
  imageUrl: string;
  imageName: string;
  options?: string[];
  solveResult: SolveResult;
}

interface ActiveRevealState {
  id?: string;
  index: number;
  revealIds: string[];
  highlightIds: string[];
}

interface DiagramModel {
  kind: string;
  coordinate_frame?: Record<string, unknown>;
  points?: Record<string, Record<string, unknown>>;
  surfaces?: Array<Record<string, unknown>>;
  vectors?: Array<Record<string, unknown>>;
  constraints?: string[];
  validation_warnings?: string[];
}

// ─────────────────────────────────────────────
// Example problems
// ─────────────────────────────────────────────

const EXAMPLES = [
  { label: "Try this", text: "Projectile at 45° with 25 m/s. Find the maximum range." },
];

function formatMathDisplay(text: string) {
  return text
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√$1")
    .replace(/\bsqrt\(([^)]+[+\-*/][^)]+)\)/gi, "√($1)")
    .replace(/\bsqrt\(([^)]+)\)/gi, "√$1")
    .replace(/\bsin\^2\s*\(\s*theta\s*\)/gi, "sin²(θ)")
    .replace(/\bcos\^2\s*\(\s*theta\s*\)/gi, "cos²(θ)")
    .replace(/\btan\^2\s*\(\s*theta\s*\)/gi, "tan²(θ)")
    .replace(/\^\{?2\}?/g, "²")
    .replace(/\^\{?3\}?/g, "³")
    .replace(/\bu0\b/g, "u₀")
    .replace(/\bv0\b/g, "v₀")
    .replace(/\bux\b/g, "uₓ")
    .replace(/\buy\b/g, "uᵧ")
    .replace(/\bvx\b/g, "vₓ")
    .replace(/\bvy\b/g, "vᵧ")
    .replace(/\bu_y\b/g, "uᵧ")
    .replace(/\bu_x\b/g, "uₓ")
    .replace(/\bv_y\b/g, "vᵧ")
    .replace(/\bv_x\b/g, "vₓ")
    .replace(/\bt_peak\b/g, "tₚₑₐₖ")
    .replace(/\bt_fall\b/g, "t_fall")
    .replace(/\bsin\s*\(\s*2\s*theta\s*\)/gi, "sin(2θ)")
    .replace(/\bcos\s*\(\s*2\s*theta\s*\)/gi, "cos(2θ)")
    .replace(/\btan\s*\(\s*2\s*theta\s*\)/gi, "tan(2θ)")
    .replace(/\bsin\s*\(\s*theta\s*\)/gi, "sin(θ)")
    .replace(/\bcos\s*\(\s*theta\s*\)/gi, "cos(θ)")
    .replace(/\btan\s*\(\s*theta\s*\)/gi, "tan(θ)")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\gamma\b/g, "γ")
    .replace(/\\sin\b/g, "sin")
    .replace(/\\cos\b/g, "cos")
    .replace(/\\tan\b/g, "tan")
    .replace(/\btheta\b/gi, "θ")
    .replace(/\balpha\b/gi, "α")
    .replace(/\bbeta\b/gi, "β")
    .replace(/\bgamma\b/gi, "γ")
    .replace(/deg\b/gi, "°")
    .replace(/\bt1\b/g, "t₁")
    .replace(/\bt2\b/g, "t₂")
    .replace(/\bR1\b/g, "R₁")
    .replace(/\bR2\b/g, "R₂");
}

function renderKatex(value: string, displayMode: boolean) {
  const expression = toKatexExpression(value);
  if (!expression || !shouldUseKatex(expression)) return null;
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return null;
  }
}

function toKatexExpression(value: string) {
  return value
    .trim()
    .replace(/^□\s*/, "")
    .replace(/\\\(|\\\)/g, "")
    .replace(/\bu₀\b|u0\b/g, "u_0")
    .replace(/\bv₀\b|v0\b/g, "v_0")
    .replace(/\buₓ\b|\bux\b/g, "u_x")
    .replace(/\buᵧ\b|\buy\b/g, "u_y")
    .replace(/\bvₓ\b|\bvx\b/g, "v_x")
    .replace(/\bvᵧ\b|\bvy\b/g, "v_y")
    .replace(/m\/s²/g, "m/s^2")
    .replace(/\s*deg\b/gi, "^\\circ")
    .replace(/°/g, "^\\circ")
    .replace(/π/g, "\\pi")
    .replace(/√\s*\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9.]+)/g, "\\sqrt{$1}")
    .replace(/\bsqrt\(([^)]+)\)/gi, "\\sqrt{$1}")
    .replace(/(\d)\s*sqrt\b/gi, "$1\\sqrt")
    .replace(/\\theta\b|θ/g, "\\theta")
    .replace(/\\alpha\b|α/g, "\\alpha")
    .replace(/\\beta\b|β/g, "\\beta")
    .replace(/\\gamma\b|γ/g, "\\gamma")
    .replace(/\btheta\b/gi, "\\theta")
    .replace(/(\d)\s*theta\b/gi, "$1\\theta")
    .replace(/\balpha\b/gi, "\\alpha")
    .replace(/\bbeta\b/gi, "\\beta")
    .replace(/\bgamma\b/gi, "\\gamma")
    .replace(/\bsin\s*\(/gi, "\\sin(")
    .replace(/\bcos\s*\(/gi, "\\cos(")
    .replace(/\btan\s*\(/gi, "\\tan(")
    .replace(/([0-9)}])\s+x\s+(?=[0-9A-Za-z\\(])/gi, "$1\\times ")
    .replace(/\*/g, "\\times ")
    .replace(/([A-Za-z])_([A-Za-z0-9]+)/g, "$1_{$2}")
    .replace(/\^([+-]?\d+)/g, "^{$1}")
    .replace(/(\d(?:[\d.]*))\s*(m\/s\^2|m\/s|m|s)\b/g, "$1\\,\\mathrm{$2}");
}

function shouldUseKatex(expression: string) {
  if (containsProseWordsForKatex(expression)) return false;
  return /[=+\-*/^_\\]|\\sqrt|\\sin|\\cos|\\tan|\\theta|\\alpha|\\beta|\\gamma|\d\s*\\,\\mathrm/.test(expression);
}

function containsProseWordsForKatex(expression: string) {
  const cleaned = expression
    .replace(/\\mathrm\{[^}]*\}/g, " ")
    .replace(/\\(?:theta|alpha|beta|gamma|sin|cos|tan|sqrt|times|frac|pi|circ)\b/g, " ")
    .replace(/[A-Za-z]_\{?[A-Za-z0-9]+\}?/g, " ")
    .replace(/\b[uvrgthxyRHT]\b/g, " ");
  return /[A-Za-z]{2,}/.test(cleaned);
}

function MathText({
  value,
  block = false,
  className,
}: {
  value: string;
  block?: boolean;
  className?: string;
}) {
  const html = renderKatex(value, block);
  if (!html) return <>{formatMathDisplay(value)}</>;
  return (
    <span
      className={className}
      style={{ display: block ? "block" : "inline", maxWidth: "100%", overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function RichMathText({ value }: { value: string }) {
  const parts = splitInlineMath(value);
  if (parts.length === 1 && !parts[0].math) {
    return <>{formatMathDisplay(value)}</>;
  }
  return (
    <>
      {parts.map((part, index) => (
        part.math
          ? <span key={`${part.text}-${index}`}> <MathText value={part.text} /> </span>
          : <span key={`${part.text}-${index}`}>{formatMathDisplay(part.text)}</span>
      ))}
    </>
  );
}

function splitInlineMath(value: string): Array<{ text: string; math: boolean }> {
  const source = String(value ?? "");
  const pattern = /([A-Za-zθαβγ_][A-Za-z0-9_{}θαβγ\\^().√+\-*/×\s]*\s*(?:=|>=|<=)\s*[A-Za-z0-9_{}θαβγ\\^().√+\-*/×\s]+)/g;
  const parts: Array<{ text: string; math: boolean }> = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trimmed = raw.replace(/[.,;:]+$/g, "");
    if (!trimmed.trim() || looksLikeEquationWithProse(trimmed) || !shouldUseKatex(toKatexExpression(trimmed))) continue;
    const end = start + trimmed.length;
    if (start > cursor) parts.push({ text: source.slice(cursor, start), math: false });
    parts.push({ text: trimmed, math: true });
    cursor = end;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), math: false });
  return parts.length ? parts : [{ text: source, math: false }];
}

function looksLikeEquationWithProse(value: string) {
  const lowered = ` ${value.toLowerCase()} `;
  const relation = value.match(/^(.*?)\s*(?:=|>=|<=)\s*(.*)$/);
  if (relation) {
    const lhs = relation[1].trim();
    const rhs = relation[2].trim();
    if (/\b(has|launch|horizontal|vertical|angle|height|speed|time|range|component|velocity|distance)\b/i.test(lhs)) return true;
    if (/\s/.test(lhs) && !/[+\-*/^_()√\\]/.test(lhs)) return true;
    if (/\b(above|below|horizontal|vertical|impact|speed|angle|range|height|time)\b/i.test(rhs) && !/[+\-*/^_()√\\]/.test(rhs)) {
      return true;
    }
  }
  return /\b(the|then|root|gives|because|previous|equation|physical|later|instant|component|relation|substitute|known|values)\b/.test(lowered);
}

function AnswerMathText({ value }: { value: string }) {
  return <RichMathText value={value} />;
}

function MatchedOptionText({
  matchedOption,
  options = [],
}: {
  matchedOption?: string | null;
  options?: string[];
}) {
  if (!matchedOption) return null;
  const letter = matchedOption.trim().toLowerCase();
  const index = letter.length === 1 ? letter.charCodeAt(0) - 97 : -1;
  const option = index >= 0 && index < options.length ? options[index] : "";
  return (
    <>
      {" · option "}
      {letter}
      {option ? (
        <>
          {") "}
          <MathText value={option} />
        </>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────
// Prompt screen
// ─────────────────────────────────────────────

function PromptScreen({ onSubmit, loading, auth, authError, notifications, onGoogleCredential, onSignOut, onReadNotifications }: {
  onSubmit: (prompt: string, image?: File) => void;
  loading: boolean;
  auth: AuthState | null;
  authError: string;
  notifications: FeedbackNotification[];
  onGoogleCredential: (credential: string) => void;
  onSignOut: () => void;
  onReadNotifications: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = Boolean(prompt.trim() || image) && !loading;
  const submit = () => { if (canSubmit) onSubmit(prompt, image ?? undefined); };

  return (
    <div style={{
      minHeight: "100vh",
      background: T.bg,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "44px 24px",
      fontFamily: T.fontUi,
      position: "relative",
      overflow: "hidden",
    }}>
      <LandingSimulationBackdrop />
      <div style={{ position: "absolute", top: 18, right: 20, zIndex: 3 }}>
        <AuthPanel
          auth={auth}
          authError={authError}
          notifications={notifications}
          onGoogleCredential={onGoogleCredential}
          onSignOut={onSignOut}
          onReadNotifications={onReadNotifications}
        />
      </div>
      <div style={{ textAlign: "center", marginBottom: 34, position: "relative", zIndex: 2 }}>
        <div style={{
          color: "rgba(191,230,213,0.92)",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}>
          able to describe and analyze projectile motion.
        </div>
        <div style={{
          fontSize: 64,
          fontWeight: 400,
          letterSpacing: "0",
          color: T.textOnDark,
          marginBottom: 8,
          lineHeight: 0.95,
          fontFamily: T.fontDisplay,
          textShadow: "0 14px 42px rgba(0,0,0,0.55)",
        }}>
          physica
        </div>
        <div style={{
          fontSize: 24,
          color: "rgba(251,252,250,0.82)",
          fontWeight: 400,
          letterSpacing: "0",
          fontFamily: T.fontDisplay,
          opacity: 0.94,
        }}>
          See the physics, not just the formula.
        </div>
      </div>

      <div style={{
        width: "100%", maxWidth: 580,
        background: "rgba(251,252,250,0.94)",
        borderRadius: 14,
        border: "1px solid rgba(16,32,39,0.12)",
        boxShadow: T.shadow,
        overflow: "hidden",
        position: "relative",
        zIndex: 2,
        backdropFilter: "blur(10px)",
      }}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && e.metaKey) submit(); }}
          placeholder="Describe a physics problem, paste text, or upload a question image…"
          rows={3}
          style={{
            width: "100%", padding: "20px 20px 12px",
            background: "transparent", border: "none", outline: "none",
            resize: "none", fontSize: 15, lineHeight: 1.6,
            color: T.text, fontFamily: T.fontUi, boxSizing: "border-box",
          }}
        />

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px 16px", gap: 10,
          borderTop: `1px solid ${T.borderSub}`,
        }}>
          <button onClick={() => fileRef.current?.click()} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: image ? "rgba(44,122,120,0.14)" : "rgba(44,122,120,0.08)",
            border: `1px solid ${image ? T.accent : "rgba(44,122,120,0.28)"}`,
            borderRadius: 8, padding: "6px 12px", fontSize: 12,
            color: T.accent, cursor: "pointer", fontFamily: "inherit",
            boxShadow: image ? "0 0 0 1px rgba(44,122,120,0.16)" : "none",
          }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1" y="1" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="4.5" cy="4.5" r="1.2" fill="currentColor" />
              <path d="M1 9l3-3 2.5 2.5L9.5 5l2.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {image ? image.name.slice(0, 18) + "…" : "Add image"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => setImage(e.target.files?.[0] ?? null)} />

          <button onClick={submit} disabled={!canSubmit} style={{
            background: canSubmit ? T.accent : T.borderSub,
            color: canSubmit ? T.textOnDark : T.textMuted,
            border: "none", borderRadius: 10, padding: "8px 20px",
            fontSize: 14, fontWeight: 600, cursor: canSubmit ? "pointer" : "default",
            fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8,
            transition: "background 0.15s",
          }}>
            {loading ? (
              <>
                <span style={{
                  width: 13, height: 13, border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "white", borderRadius: "50%",
                  display: "inline-block", animation: "spin 0.7s linear infinite",
                }} />
                {image ? "Extracting…" : "Preparing…"}
              </>
            ) : image ? "Extract question →" : "Review question →"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 26, width: "100%", maxWidth: 580, position: "relative", zIndex: 2 }}>
        {/* <div style={{
          fontSize: 11, color: "rgba(251,252,250,0.56)", letterSpacing: "0.08em",
          textTransform: "uppercase", fontWeight: 600,
          marginBottom: 12, textAlign: "center",
          textShadow: "0 2px 14px rgba(0,0,0,0.42)",
        }}>Quick test</div> */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EXAMPLES.map(ex => (
            <button key={ex.label} onClick={() => setPrompt(ex.text)} style={{
              background: "linear-gradient(135deg, rgba(251,252,250,0.22), rgba(251,252,250,0.08))",
              border: "1px solid rgba(251,252,250,0.28)",
              borderRadius: 12, padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 12,
              cursor: "pointer", textAlign: "left",
              boxShadow: "0 18px 45px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
              transition: "border-color 0.15s, transform 0.15s, background 0.15s",
              fontFamily: "inherit",
              backdropFilter: "blur(16px) saturate(130%)",
              WebkitBackdropFilter: "blur(16px) saturate(130%)",
            }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "rgba(191,230,213,0.62)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "rgba(251,252,250,0.28)";
                e.currentTarget.style.transform = "translateY(0)";
              }}>
              <span style={{
                fontSize: 10, fontWeight: 800, color: "rgba(191,230,213,0.96)",
                background: "rgba(44,122,120,0.28)",
                border: "1px solid rgba(191,230,213,0.20)",
                borderRadius: 7,
                padding: "3px 8px", whiteSpace: "nowrap", letterSpacing: "0.04em",
              }}>{ex.label}</span>
              <span style={{ fontSize: 13, color: T.textOnDark, textShadow: "0 1px 10px rgba(0,0,0,0.42)" }}>{ex.text}</span>
            </button>
          ))}
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function LandingSimulationBackdrop() {
  const [loadVideo, setLoadVideo] = useState(false);

  useEffect(() => {
    const prefersReducedData = window.matchMedia?.("(prefers-reduced-data: reduce)").matches;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedData || prefersReducedMotion) return;
    const timer = globalThis.setTimeout(() => setLoadVideo(true), 900);
    return () => globalThis.clearTimeout(timer);
  }, []);

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      background: "radial-gradient(circle at 32% 22%, rgba(63,167,163,0.34), transparent 30%), linear-gradient(135deg, #102027 0%, #17333d 54%, #102027 100%)",
    }}>
      {loadVideo && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 1,
            mixBlendMode: "normal",
          }}
        >
          <source src="/landing-simulation.webm" type="video/webm" />
          <source src="/landing-simulation.mp4" type="video/mp4" />
        </video>
      )}
      <style>{`
        video::-webkit-media-controls { display: none !important; }
      `}</style>
    </div>
  );
}

function AuthPanel({
  auth,
  authError,
  notifications,
  onGoogleCredential,
  onSignOut,
  onReadNotifications,
}: {
  auth: AuthState | null;
  authError: string;
  notifications: FeedbackNotification[];
  onGoogleCredential: (credential: string) => void;
  onSignOut: () => void;
  onReadNotifications: () => void;
}) {
  const buttonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (auth) {
      cleanupGoogleSignInButton(buttonRef.current);
      const timeouts = [0, 100, 500, 1200].map(delay => window.setTimeout(() => cleanupGoogleSignInButton(null), delay));
      return () => timeouts.forEach(window.clearTimeout);
    }
    cleanupGoogleSignInButton(null);
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) {
      return;
    }
    buttonRef.current.innerHTML = "";
    if (buttonRef.current.dataset.googleRendered === "true") {
      return;
    }
    buttonRef.current.dataset.googleRendered = "true";
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google || !buttonRef.current || auth) return;
      buttonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: response => {
          if (response.credential) onGoogleCredential(response.credential);
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "rectangular",
      });
    };
    if (window.google) {
      render();
      return () => {
        cancelled = true;
      };
    }
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existingScript) {
      existingScript.addEventListener("load", render, { once: true });
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", render);
      };
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.referrerPolicy = "no-referrer-when-downgrade";
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [auth, onGoogleCredential]);

  return (
    <div style={{
      minWidth: 220,
      maxWidth: 320,
      background: "rgba(16,32,39,0.88)",
      border: "1px solid rgba(63,167,163,0.28)",
      borderRadius: 10,
      padding: 10,
      color: "rgba(251,252,250,0.82)",
      boxShadow: T.shadowSm,
      fontFamily: T.fontUi,
      backdropFilter: "blur(10px)",
    }}>
      {auth ? (
        <div style={{ display: "grid", gap: 8 }}>
          <GoogleIdentityHiddenStyle />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.parchment, fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {auth.user.name || auth.user.email}
              </div>
              <div style={{ color: "rgba(251,252,250,0.58)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                feedback sync on
              </div>
            </div>
            <button type="button" onClick={onSignOut} style={smallGhostButtonStyle}>Sign out</button>
          </div>
          <a href="/failed-questions" style={{ ...smallGhostButtonStyle, textDecoration: "none", textAlign: "center" }}>
            Failed questions
          </a>
          {notifications.length > 0 && (
            <div style={{
              border: "1px solid rgba(74,222,128,0.28)",
              background: "rgba(74,222,128,0.08)",
              borderRadius: 8,
              padding: 8,
              color: "#bbf7d0",
              fontSize: 12,
              lineHeight: 1.45,
            }}>
              {notifications.length} previously failed question{notifications.length === 1 ? "" : "s"} now work.
              <button type="button" onClick={onReadNotifications} style={{ ...smallGhostButtonStyle, marginLeft: 8, color: "#bbf7d0" }}>
                Mark read
              </button>
            </div>
          )}
        </div>
      ) : GOOGLE_CLIENT_ID ? (
        <div style={{ display: "grid", gap: 7 }}>
          <div ref={buttonRef} />
          <div style={{ fontSize: 11, color: "rgba(251,252,250,0.62)" }}>Sign in to get notified when failed questions are fixed.</div>
          {authError && <div style={{ fontSize: 11, color: "#ffb4ad" }}>{authError}</div>}
        </div>
      ) : (
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>
          Google OAuth is not configured. Set <span style={{ fontFamily: "monospace" }}>NEXT_PUBLIC_GOOGLE_CLIENT_ID</span> and backend <span style={{ fontFamily: "monospace" }}>GOOGLE_CLIENT_ID</span>.
        </div>
      )}
    </div>
  );
}

function cleanupGoogleSignInButton(container: HTMLDivElement | null) {
  try {
    (window.google?.accounts.id as GoogleIdApi | undefined)?.cancel?.();
  } catch {
    // Ignore GIS cleanup errors; stale UI cleanup is best-effort.
  }
  if (container) container.innerHTML = "";
  document.querySelectorAll([
    'iframe[src*="accounts.google.com/gsi"]',
    'iframe[title*="Sign in with Google"]',
    '#credential_picker_container',
    '#g_a11y_announcement',
    '.g_id_signin',
    '[data-google-rendered="true"] iframe',
  ].join(",")).forEach(node => {
    const frame = node as HTMLIFrameElement;
    const parent = frame.parentElement;
    if (node.id === "credential_picker_container" || node.classList.contains("g_id_signin")) {
      node.remove();
    } else if (parent?.parentElement && parent.childElementCount === 1) {
      parent.remove();
    } else {
      frame.remove();
    }
  });
}

function GoogleIdentityHiddenStyle() {
  return (
    <style>{`
      iframe[src*="accounts.google.com/gsi"],
      iframe[title*="Sign in with Google"],
      #credential_picker_container,
      #g_a11y_announcement,
      .g_id_signin {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `}</style>
  );
}

function ExtractionReviewScreen({
  extracted,
  imageUrl,
  imageName,
  loading,
  solving,
  solveResult,
  signedIn,
  onSolve,
  onGenerate,
  onBack,
}: {
  extracted: ExtractedQuestion;
  imageUrl: string;
  imageName: string;
  loading: boolean;
  solving: boolean;
  solveResult: SolveResult | null;
  signedIn: boolean;
  onSolve: (prompt: string) => void;
  onGenerate: (prompt: string) => void;
  onBack: () => void;
}) {
  const [reviewPrompt, setReviewPrompt] = useState<string>(
    extracted.question_text_display || extracted.question_text || extracted.cleaned_prompt || extracted.question_text_solver || ""
  );
  const [hasPromptChangedAfterSolve, setHasPromptChangedAfterSolve] = useState(false);
  const confidencePct = Math.round((extracted.confidence || 0) * 100);
  const canSolve = Boolean(reviewPrompt.trim()) && !loading && !solving && (solveResult?.status !== "passed" || hasPromptChangedAfterSolve);
  const hasImage = Boolean(imageUrl);

  return (
    <div style={{
      height: "100vh",
      background: `linear-gradient(180deg, ${R.bg} 0%, ${R.bg2} 100%)`,
      color: R.text,
      padding: "28px",
      fontFamily: T.fontUi,
      display: "grid", gridTemplateColumns: hasImage ? "minmax(320px, 0.9fr) minmax(360px, 1.1fr)" : "minmax(0, 1fr)",
      gap: 20, overflow: "hidden", boxSizing: "border-box",
    }}>
      {hasImage && (
        <div style={{
          background: R.surface, border: `1px solid ${R.border}`,
          borderRadius: 12, overflow: "hidden", minHeight: 0,
          display: "flex", flexDirection: "column",
          boxShadow: "0 18px 52px rgba(23,36,43,0.10)",
        }}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${R.borderSub}`, fontSize: 13, color: R.textMid, fontWeight: 650 }}>
            {imageName}
          </div>
          <div style={{ padding: 14, minHeight: 0, overflow: "auto" }}>
            <img src={imageUrl} alt="Uploaded question" style={{
              display: "block", width: "100%", maxHeight: "calc(100vh - 120px)",
              objectFit: "contain", borderRadius: 8, background: "#111827",
            }} />
          </div>
        </div>
      )}

      <div style={{
        display: "flex", flexDirection: "column", gap: 14, minWidth: 0,
        minHeight: 0, overflowY: "auto", paddingRight: 6, paddingBottom: 4,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: R.text }}>Review extraction</div>
            <div style={{ fontSize: 13, color: R.textMid, marginTop: 4 }}>
              Confidence {confidencePct}% · {extracted.question_type.toUpperCase()} · {extracted.diagram.present ? extracted.diagram.type : "no diagram"}
            </div>
            {extracted.debug_report_id && (
              <div style={{ fontSize: 11, color: R.textMuted, marginTop: 5, fontFamily: "monospace" }}>
                debug {extracted.debug_report_id}
              </div>
            )}
          </div>
          <button onClick={onBack} style={{
            background: R.surface, border: `1px solid ${R.border}`,
            color: R.textMid, borderRadius: 8, padding: "7px 12px", cursor: "pointer",
          }}>Back</button>
        </div>

        {extracted.warnings.length > 0 && (
          <div style={{
            padding: "10px 12px", background: R.dangerSoft,
            border: `1px solid rgba(184,79,68,0.24)`, borderRadius: 8,
            color: R.danger, fontSize: 13, lineHeight: 1.5,
            flexShrink: 0,
          }}>
            {extracted.warnings.join(" ")}
          </div>
        )}

        <div style={{ flexShrink: 0 }}>
          <label style={{ fontSize: 11, color: R.accent, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Student-facing prompt
          </label>
          <div style={{ fontSize: 13, color: R.textMid, marginTop: 5, lineHeight: 1.45 }}>
            Please correct this if you find something wrong in the extraction.
          </div>
        </div>
        <textarea
          value={reviewPrompt}
          onChange={e => {
            setReviewPrompt(e.target.value);
            setHasPromptChangedAfterSolve(true);
          }}
          rows={7}
          style={{
            width: "100%", padding: 16, background: R.surface,
            border: `1px solid ${R.border}`, borderRadius: 10,
            color: R.text, fontFamily: T.fontUi, fontSize: 15.5,
            lineHeight: 1.55, resize: "vertical", minHeight: 170,
            flexShrink: 0,
            boxShadow: "0 10px 30px rgba(23,36,43,0.06)",
          }}
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          <button
            onClick={() => {
              onSolve(reviewPrompt);
              setHasPromptChangedAfterSolve(false);
            }}
            disabled={!canSolve}
            style={{
              background: canSolve ? R.accent : R.borderSub,
              color: canSolve ? R.surface : R.textMuted,
              border: "none", borderRadius: 10, padding: "10px 20px",
              fontSize: 14, fontWeight: 700, cursor: canSolve ? "pointer" : "default",
            }}
          >
            {solving ? "Solving…" : solveResult?.status === "passed" && !hasPromptChangedAfterSolve ? "Solved" : "Solve"}
          </button>

          <button
            onClick={() => onGenerate(reviewPrompt)}
            disabled={solveResult?.status !== "passed" || loading || solving}
            style={{
              background: solveResult?.status === "passed" && !loading && !solving ? R.good : R.borderSub,
              color: solveResult?.status === "passed" && !loading && !solving ? R.surface : R.textMuted,
              border: "none", borderRadius: 10, padding: "10px 20px",
              fontSize: 14, fontWeight: 700,
              cursor: solveResult?.status === "passed" && !loading && !solving ? "pointer" : "default",
            }}
          >
            {loading ? "Building…" : "Generate walkthrough"}
          </button>
        </div>

        {solveResult?.status === "passed" && hasPromptChangedAfterSolve && (
          <div style={{
            padding: "10px 12px",
            background: R.warnSoft,
            border: "1px solid rgba(184,135,47,0.28)",
            borderRadius: 8,
            color: R.warn,
            fontSize: 13,
            lineHeight: 1.45,
            flexShrink: 0,
          }}>
            The question was edited after solving. Click Solve again to update validation and walkthrough data.
          </div>
        )}

        {solveResult && (
          <div style={{
            background: solveResult.status === "passed"
              ? R.goodSoft
              : solveResult.status === "needs_review"
                ? R.warnSoft
                : R.dangerSoft,
            border: `1px solid ${solveResult.status === "passed"
              ? "rgba(31,122,90,0.24)"
              : solveResult.status === "needs_review"
                ? "rgba(184,135,47,0.28)"
                : "rgba(184,79,68,0.24)"}`,
            borderRadius: 10,
            padding: 14,
            flexShrink: 0,
          }}>
            <div style={{ fontSize: 11, color: solveResult.status === "passed" ? R.good : solveResult.status === "needs_review" ? R.warn : R.danger, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>
              Solver {solveResult.status}
            </div>
            {solveResult.engine_case && (
              <div style={{ fontSize: 13, color: R.textMid, marginBottom: 6 }}>
                {solveResult.engine_case}
              </div>
            )}
            {solveResult.template_id && (
              <div style={{ fontSize: 13, color: R.textMid, marginBottom: 6 }}>
                Template: {solveResult.template_id}
                {typeof solveResult.template_confidence === "number" ? ` · ${Math.round(solveResult.template_confidence * 100)}%` : ""}
              </div>
            )}
            {solveResult.template_warnings && solveResult.template_warnings.length > 0 && (
              <div style={{
                fontSize: 13,
                color: R.warn,
                marginBottom: 7,
                lineHeight: 1.45,
              }}>
                {solveResult.template_warnings[0]}
              </div>
            )}
            {solveResult.diagram_warnings && solveResult.diagram_warnings.length > 0 && (
              <div style={{
                fontSize: 13,
                color: R.warn,
                marginBottom: 7,
                lineHeight: 1.45,
              }}>
                {solveResult.diagram_warnings.join(" · ")}
              </div>
            )}
            {solveResult.status === "passed" && (
              <div style={{ fontSize: 13.5, color: R.textMid, lineHeight: 1.5 }}>
                Validated. Generate the walkthrough to view the worked solution.
              </div>
            )}
            {solveResult.status !== "passed" && solveResult.reason && (
              <div style={{ fontSize: 13.5, color: R.textMid, lineHeight: 1.5 }}>
                {solveResult.reason}
              </div>
            )}
            {solveResult.status !== "passed" && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: signedIn ? R.accentSoft : R.warnSoft,
                border: `1px solid ${signedIn ? "rgba(44,122,120,0.22)" : "rgba(184,135,47,0.25)"}`,
                color: signedIn ? R.accent : R.warn,
                fontSize: 12,
                lineHeight: 1.45,
              }}>
                {signedIn && solveResult.feedback_ticket_id
                  ? `Saved to retry queue (${solveResult.feedback_ticket_id}). You will see an in-app notification when this question starts passing.`
                  : "Sign in before solving to get notified when failed questions are fixed."}
              </div>
            )}
            {solveResult.debug_report_path && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(23,36,43,0.06)",
                color: R.textMuted,
                fontSize: 11,
                lineHeight: 1.45,
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}>
                Debug report: {solveResult.debug_report_path}
              </div>
            )}
          </div>
        )}

        {extracted.options.length > 0 && (
          <div style={{ background: R.surface, border: `1px solid ${R.border}`, borderRadius: 10, padding: 14, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: R.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>
              Options
            </div>
            {extracted.options.map((option, index) => (
              <div key={`${index}-${option}`} style={{ fontSize: 14.5, color: R.text, lineHeight: 1.75 }}>
                {String.fromCharCode(97 + index)}) <MathText value={option} />
              </div>
            ))}
          </div>
        )}

        <div style={{ background: R.surface, border: `1px solid ${R.border}`, borderRadius: 10, padding: 14, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: R.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>
            Diagram facts
          </div>
          {extracted.diagram.entities.length === 0 ? (
            <div style={{ fontSize: 14, color: R.textMuted }}>No structured diagram entities extracted.</div>
          ) : extracted.diagram.entities.map(entity => (
            <div key={entity.id} style={{ fontSize: 14, color: R.textMid, lineHeight: 1.7 }}>
              <span style={{ color: R.accent, fontWeight: 700 }}>{entity.kind}</span>
              {entity.label_display || entity.label ? ` ${entity.label_display ?? entity.label}` : ""}
              {entity.value ? ` = ${entity.value}${entity.unit ? ` ${entity.unit}` : ""}` : ""}
              {entity.description ? ` · ${entity.description}` : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SolutionPlayer({
  playback,
  onBack,
}: {
  playback: SolutionPlayback;
  onBack: () => void;
}) {
  const steps = playback.solveResult.walkthrough?.steps ?? [];
  const explainerBeats = playback.solveResult.walkthrough?.explainer_beats ?? [];
  const [activeStep, setActiveStep] = useState(0);
  const [compactLayout, setCompactLayout] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [stepProgress, setStepProgress] = useState(0);
  const [playbackRunId, setPlaybackRunId] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playbackMode, setPlaybackMode] = useState<"step" | "full">("step");
  const [solutionMode, setSolutionMode] = useState<"explainer" | "complete">(explainerBeats.length ? "explainer" : "complete");
  const [isQuestionPanelCollapsed, setIsQuestionPanelCollapsed] = useState(false);
  const [areStepsCollapsed, setAreStepsCollapsed] = useState(false);
  const [isAnimationExpanded, setIsAnimationExpanded] = useState(false);
  const [questionPanelWidth, setQuestionPanelWidth] = useState(260);
  const [solutionPanelWidth, setSolutionPanelWidth] = useState(360);
  const [resizingPanel, setResizingPanel] = useState<"question" | "solution" | null>(null);
  const [hoveredResizePanel, setHoveredResizePanel] = useState<"question" | "solution" | null>(null);
  const [showPanelGuide, setShowPanelGuide] = useState(false);
  const [panelGuideStep, setPanelGuideStep] = useState(0);
  const mainGridRef = useRef<HTMLDivElement | null>(null);
  const effectiveSolutionMode = solutionMode === "explainer" && !explainerBeats.length ? "complete" : solutionMode;
  const guidedCount = effectiveSolutionMode === "explainer" && explainerBeats.length ? explainerBeats.length : steps.length;
  const stepCount = playbackMode === "full" ? Math.max(steps.length, 1) : Math.max(guidedCount, 1);
  const fullStepIndex = steps.length
    ? Math.min(steps.length - 1, Math.floor(Math.min(0.999999, stepProgress) * steps.length))
    : 0;
  const displayStepIndex = playbackMode === "full" ? fullStepIndex : activeStep;
  const activeBeat = effectiveSolutionMode === "explainer" && playbackMode !== "full" ? explainerBeats[displayStepIndex] : undefined;
  const activeReveal = activeBeat ? activeRevealForBeat(activeBeat, stepProgress) : undefined;
  const step = activeBeat ? stepForExplainerBeat(activeBeat, steps) ?? steps[displayStepIndex] : steps[displayStepIndex];
  const canPrev = displayStepIndex > 0;
  const canNext = displayStepIndex < stepCount - 1;
  const showQuestionPanel = !isAnimationExpanded && !isQuestionPanelCollapsed;
  const showStepsPanel = !isAnimationExpanded && !areStepsCollapsed;
  const showResizeHandles = !compactLayout && !isAnimationExpanded;
  const mainGridColumns = compactLayout || isAnimationExpanded
    ? "minmax(0, 1fr)"
    : [
      showQuestionPanel ? `${questionPanelWidth}px` : "",
      showQuestionPanel ? "10px" : "",
      "minmax(420px, 1fr)",
      showStepsPanel ? "10px" : "",
      showStepsPanel ? `${solutionPanelWidth}px` : "",
    ].filter(Boolean).join(" ");
  const mainGridRows = compactLayout && !isAnimationExpanded
    ? [
      showQuestionPanel ? "minmax(150px, 24vh)" : "",
      "minmax(680px, 78vh)",
      showStepsPanel ? "minmax(260px, auto)" : "",
    ].filter(Boolean).join(" ")
    : undefined;
  const visualProgress = stepProgress;
  const visualStepId = playbackMode === "full" ? "__full_lifecycle" : (activeBeat?.step_id || step?.id || "");
  const fullAnimationActive = playbackMode === "full";
  const playbackStatusLabel = playbackMode === "full"
    ? `Full animation · step ${displayStepIndex + 1}/${stepCount}`
    : effectiveSolutionMode === "explainer"
      ? `Explainer beat ${displayStepIndex + 1}/${stepCount}`
      : `Step ${displayStepIndex + 1}/${stepCount}`;
  const visualStudentText = activeBeat?.beat_visual_spec?.student_text
    || step?.beat_visual_spec?.student_text
    || activeBeat?.learner_message
    || step?.explanation
    || "";
  const visualHeaderTitle = playbackMode === "full"
    ? "Full animation"
    : activeBeat?.title || step?.title || "Animation";

  const restartPlaybackFromStart = (playing: boolean) => {
    setStepProgress(0);
    setIsPlaying(playing);
    setPlaybackRunId(value => value + 1);
  };

  const goToStep = (index: number) => {
    setPlaybackMode("step");
    setActiveStep(clamp(index, 0, Math.max(stepCount - 1, 0)));
    restartPlaybackFromStart(true);
  };

  useEffect(() => {
    setActiveStep(0);
    restartPlaybackFromStart(true);
    setPlaybackMode("step");
    setSolutionMode(explainerBeats.length ? "explainer" : "complete");
  }, [playback.solveResult.debug_report_id, explainerBeats.length]);

  useEffect(() => {
    if (playbackMode === "full") return;
    restartPlaybackFromStart(true);
    setPlaybackMode("step");
  }, [activeStep, playbackMode]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let startedAt: number | null = null;
    const initialProgress = stepProgress;
    const durationMs = (playbackMode === "full" ? Math.max(steps.length, 1) * 2200 : 3200) / speed;
    const tick = (timestamp: number) => {
      if (startedAt === null) startedAt = timestamp;
      const next = Math.min(1, initialProgress + (timestamp - startedAt) / durationMs);
      setStepProgress(next);
      if (next >= 1) {
        setIsPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, speed, activeStep, playbackMode, steps.length, playbackRunId]);

  useEffect(() => {
    const updateLayout = () => setCompactLayout(window.innerWidth < 1180);
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    if (!isAnimationExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAnimationExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAnimationExpanded]);

  useEffect(() => {
    if (!resizingPanel) return;
    const onMouseMove = (event: MouseEvent) => {
      const bounds = mainGridRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const animationMinimum = 460;
      const otherPanelWidth = resizingPanel === "question" && showStepsPanel ? solutionPanelWidth : resizingPanel === "solution" && showQuestionPanel ? questionPanelWidth : 0;
      const maxPanelWidth = Math.max(220, bounds.width - animationMinimum - otherPanelWidth - 24);
      if (resizingPanel === "question") {
        setQuestionPanelWidth(clamp(event.clientX - bounds.left, 180, Math.max(180, Math.min(460, maxPanelWidth))));
      } else {
        setSolutionPanelWidth(clamp(bounds.right - event.clientX, 280, Math.max(280, Math.min(620, maxPanelWidth))));
      }
    };
    const onMouseUp = () => setResizingPanel(null);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [questionPanelWidth, resizingPanel, showQuestionPanel, showStepsPanel, solutionPanelWidth]);

  const closePanelGuide = (markSeen = true) => {
    setShowPanelGuide(false);
    if (markSeen && typeof window !== "undefined") {
      window.localStorage.setItem("physica.simulationPanelGuide.v1", "done");
    }
  };

  return (
    <div style={{
      height: compactLayout ? "auto" : "100vh",
      minHeight: "100vh",
      background: T.bg,
      color: T.text,
      display: "grid",
      gridTemplateRows: "auto 1fr",
      overflow: compactLayout ? "auto" : "hidden",
      fontFamily: "-apple-system,'SF Pro Display','Helvetica Neue',sans-serif",
      boxSizing: "border-box",
      position: isAnimationExpanded ? "fixed" : undefined,
      inset: isAnimationExpanded ? 0 : undefined,
      zIndex: isAnimationExpanded ? 100 : undefined,
    }}>
      {!isAnimationExpanded && (
        <div style={{
          padding: compactLayout ? "10px 14px" : "12px 22px",
          background: T.surface,
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: compactLayout ? "wrap" : "nowrap",
          minWidth: 0,
        }}>
          <button onClick={onBack} style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            color: T.textMid,
            borderRadius: 8,
            padding: "7px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}>Back</button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 3 }}>
              {playback.solveResult.engine_case}
            </div>
            <div style={{ fontSize: 15, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {playback.prompt}
            </div>
          </div>
          <div style={{
            color: "#4ade80",
            background: "rgba(74,222,128,0.08)",
            border: "1px solid rgba(74,222,128,0.25)",
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            Answer: <AnswerMathText value={playback.solveResult.answer ?? ""} />
            <MatchedOptionText matchedOption={playback.solveResult.matched_option} options={playback.options} />
          </div>
        </div>
      )}

      <div ref={mainGridRef} style={{
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: mainGridColumns,
        gridTemplateRows: mainGridRows,
        gap: isAnimationExpanded ? 0 : compactLayout ? 12 : 0,
        padding: isAnimationExpanded ? 0 : compactLayout ? 12 : 18,
        overflow: compactLayout ? "visible" : "hidden",
        boxSizing: "border-box",
      }}>
        {showQuestionPanel && (
          <div style={{
            minHeight: 0,
            minWidth: 0,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderSub}`, fontSize: 12, color: T.textMid }}>
              {playback.imageUrl ? playback.imageName || "Uploaded image" : "Question"}
            </div>
            <div style={{ padding: 12, minHeight: 0, overflow: "auto" }}>
              {playback.imageUrl ? (
                <img src={playback.imageUrl} alt="Uploaded question" style={{
                  display: "block",
                  width: "100%",
                  objectFit: "contain",
                  borderRadius: 8,
                  background: "#111827",
                }} />
              ) : (
                <div style={{
                  color: T.textMid,
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {playback.prompt}
                </div>
              )}
            </div>
          </div>
        )}
        {showQuestionPanel && showResizeHandles && (
          <ResizeHandle
            active={resizingPanel === "question" || hoveredResizePanel === "question"}
            label="Resize question panel"
            onMouseDown={() => setResizingPanel("question")}
            onMouseEnter={() => setHoveredResizePanel("question")}
            onMouseLeave={() => setHoveredResizePanel(value => value === "question" ? null : value)}
          />
        )}

        <div style={{
          minHeight: 0,
          minWidth: 0,
          background: "#151522",
          border: isAnimationExpanded ? "none" : `1px solid ${T.border}`,
          borderRadius: isAnimationExpanded ? 0 : 12,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{
            padding: "12px 14px",
            borderBottom: `1px solid ${T.borderSub}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: compactLayout ? "wrap" : "nowrap",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.textOnDark, fontWeight: 800, fontSize: 14 }}>
                {formatMathDisplay(visualHeaderTitle)}
              </div>
              <div style={{ color: "rgba(251,252,250,0.76)", fontSize: 11, marginTop: 3, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: compactLayout || isAnimationExpanded ? "70vw" : "42vw" }}>
                {visualStudentText ? formatMathDisplay(visualStudentText) : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsQuestionPanelCollapsed(value => !value)}
                disabled={isAnimationExpanded}
                data-guide-id="question-panel"
                style={panelToggleButtonStyle(!isAnimationExpanded)}
                title={isQuestionPanelCollapsed ? "Show question panel" : "Hide question panel"}
              >
                {isQuestionPanelCollapsed ? "Show question" : "Hide question"}
              </button>
              <button
                onClick={() => {
                  setAreStepsCollapsed(value => !value);
                }}
                disabled={isAnimationExpanded}
                data-guide-id="steps-panel"
                style={panelToggleButtonStyle(!isAnimationExpanded)}
                title={areStepsCollapsed ? "Show steps panel" : "Hide steps panel"}
              >
                {areStepsCollapsed ? "Show steps" : "Hide steps"}
              </button>
              <button
                onClick={() => setIsAnimationExpanded(value => !value)}
                data-guide-id="fullscreen"
                style={panelToggleButtonStyle(true)}
                title={isAnimationExpanded ? "Exit focused animation view" : "Fill the screen with the animation"}
              >
                {isAnimationExpanded ? "Exit full screen" : "Full screen"}
              </button>
              <button
                onClick={() => {
                  setShowPanelGuide(value => !value);
                  setPanelGuideStep(0);
                }}
                data-guide-id="panel-guide"
                style={panelToggleButtonStyle(true)}
                title="Explain the simulation controls and visual layers"
              >
                Panel guide
              </button>
              <div style={{ color: "rgba(251,252,250,0.70)", fontSize: 12, whiteSpace: "nowrap" }}>
                {playbackStatusLabel}
              </div>
            </div>
          </div>

          <WalkthroughVisual
            engineCase={playback.solveResult.engine_case ?? ""}
            diagramModel={playback.solveResult.walkthrough?.diagram_model}
            sceneSpec={playback.solveResult.animation_scene_spec ?? undefined}
            stepId={visualStepId}
            animationProgress={visualProgress}
            fullAnimationActive={fullAnimationActive}
            activeReveal={activeReveal}
            intent={step?.animation_intent ?? ""}
            answerText={playback.solveResult.answer ?? playback.solveResult.equation_plan?.final_answer ?? ""}
          />
          {showPanelGuide && (
            <SimulationPanelGuide
              step={panelGuideStep}
              onNext={() => setPanelGuideStep(value => Math.min(value + 1, SIMULATION_PANEL_GUIDE.length - 1))}
              onPrev={() => setPanelGuideStep(value => Math.max(value - 1, 0))}
              onClose={() => closePanelGuide(true)}
            />
          )}

          <div style={{
            padding: 12,
            borderTop: `1px solid ${T.borderSub}`,
            background: "#080812",
            boxShadow: "0 -10px 24px rgba(0,0,0,0.28)",
            display: "flex",
            gap: 8,
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            flexShrink: 0,
            position: "relative",
            zIndex: 5,
          }}>
            <button data-guide-id="step-prev" onClick={() => goToStep(displayStepIndex - 1)} disabled={!canPrev} style={playerButtonStyle(canPrev)}>
              Previous
            </button>
            <button data-guide-id="step-play" onClick={() => {
              if (stepProgress >= 1) {
                restartPlaybackFromStart(true);
                return;
              }
              setIsPlaying(value => !value);
            }} style={playerButtonStyle(true)}>
              {isPlaying ? "Pause" : stepProgress >= 1 ? "Play again" : "Play"}
            </button>
            <button data-guide-id="step-next" onClick={() => goToStep(displayStepIndex + 1)} disabled={!canNext} style={playerButtonStyle(canNext)}>
              {effectiveSolutionMode === "explainer" && playbackMode !== "full" ? "Ahead" : "Next"}
            </button>
            <button data-guide-id="step-replay" onClick={() => {
              setPlaybackMode("step");
              restartPlaybackFromStart(true);
            }} style={playerButtonStyle(true)}>
              Replay step
            </button>
            <button
              data-guide-id="full-animation"
              onClick={() => {
                setPlaybackMode("full");
                setActiveStep(0);
                restartPlaybackFromStart(true);
              }}
              style={playerButtonStyle(true)}
            >
              Full animation
            </button>
            <label data-guide-id="speed-control" style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "rgba(251,252,250,0.82)", fontSize: 12, fontWeight: 750 }}>
              Speed
              <select
                value={speed}
                onChange={event => setSpeed(Number(event.target.value))}
                style={{
                  background: T.textOnDark,
                  color: T.text,
                  border: "1px solid rgba(251,252,250,0.55)",
                  borderRadius: 8,
                  padding: "7px 28px 7px 10px",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  minWidth: 78,
                  colorScheme: "light",
                }}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
          </div>
        </div>

        {showStepsPanel && showResizeHandles && (
          <ResizeHandle
            active={resizingPanel === "solution" || hoveredResizePanel === "solution"}
            label="Resize solution panel"
            onMouseDown={() => setResizingPanel("solution")}
            onMouseEnter={() => setHoveredResizePanel("solution")}
            onMouseLeave={() => setHoveredResizePanel(value => value === "solution" ? null : value)}
          />
        )}
        {showStepsPanel && (
          <div style={{
            minHeight: 0,
            minWidth: 0,
            overflowY: "auto",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: 0,
          }}>
            <div style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 12px 10px",
              background: T.surface,
              borderBottom: `1px solid ${T.borderSub}`,
            }}>
              <div style={{
                color: R.textMuted,
                fontSize: 10,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}>
                View
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    setSolutionMode("explainer");
                    setPlaybackMode("step");
                    setActiveStep(0);
                    restartPlaybackFromStart(true);
                  }}
                  disabled={!explainerBeats.length}
                  style={solutionModeToggleButtonStyle(effectiveSolutionMode === "explainer", Boolean(explainerBeats.length))}
                  title="Guided beat-by-beat explanation"
                >
                  Explainer
                </button>
                <button
                  onClick={() => {
                    setSolutionMode("complete");
                    setPlaybackMode("step");
                    setActiveStep(0);
                    restartPlaybackFromStart(false);
                  }}
                  style={solutionModeToggleButtonStyle(effectiveSolutionMode === "complete", true)}
                  title="Full textbook-style solution"
                >
                  Complete Sol
                </button>
              </div>
            </div>
            <div style={{ padding: 16, paddingRight: 4 }}>
            {effectiveSolutionMode === "explainer" && explainerBeats.length ? (
              <ExplainerSolution
                beats={explainerBeats}
                activeBeat={displayStepIndex}
                activeRevealIndex={activeReveal?.index ?? 0}
                onBeatSelect={index => goToStep(index)}
                sceneSpec={playback.solveResult.animation_scene_spec ?? undefined}
                activeReveal={activeReveal}
              />
            ) : (
              <TextbookSolution
                solveResult={playback.solveResult}
                options={playback.options}
                activeStep={displayStepIndex}
                onStepSelect={index => goToStep(index)}
              />
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextbookSolution({
  solveResult,
  options = [],
  activeStep,
  onStepSelect,
  compact = false,
}: {
  solveResult: SolveResult;
  options?: string[];
  activeStep?: number;
  onStepSelect?: (index: number) => void;
  compact?: boolean;
}) {
  const steps = solveResult.walkthrough?.steps ?? [];
  const givens = uniqueTextRows(solveResult.equation_plan?.givens ?? []);
  const finalAnswer = solveResult.equation_plan?.final_answer || solveResult.answer || "";
  return (
    <div style={{
      color: R.text,
      fontSize: compact ? 15 : 15.5,
      lineHeight: 1.62,
    }}>
      <TextbookHeading>Solution</TextbookHeading>

      <TextbookSectionTitle>Given</TextbookSectionTitle>
      {givens.length > 0 ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
          marginBottom: compact ? 12 : 16,
        }}>
          {givens.map(given => (
            <div key={given} style={givenChipStyle}>
              <MathText value={given} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: R.textMuted, marginBottom: compact ? 12 : 18 }}>
          No explicit numerical givens were extracted.
        </div>
      )}

      {steps.map((step, index) => (
        <TextbookStep
          key={step.id}
          step={step}
          index={index}
          active={index === activeStep}
          onSelect={onStepSelect ? () => onStepSelect(index) : undefined}
          compact={compact}
          givens={givens}
          unknown={solveResult.equation_plan?.unknown ?? ""}
        />
      ))}

      <TextbookSectionTitle>Final Answer</TextbookSectionTitle>
      <BoxedAnswer>
        <AnswerMathText value={finalAnswer || solveResult.answer || "See computed result above."} />
        <MatchedOptionText matchedOption={solveResult.matched_option} options={options} />
      </BoxedAnswer>
    </div>
  );
}

function ExplainerSolution({
  beats,
  activeBeat,
  activeRevealIndex,
  onBeatSelect,
  sceneSpec,
  activeReveal,
}: {
  beats: ExplainerBeatUi[];
  activeBeat: number;
  activeRevealIndex: number;
  onBeatSelect: (index: number) => void;
  sceneSpec?: AnimationSceneSpec;
  activeReveal?: ActiveRevealState;
}) {
  const visibleBeats = beats.slice(0, Math.min(activeBeat + 1, beats.length));
  const actors = sceneSpec ? sceneActors(sceneSpec) : [];
  const hasMultipleActors = actors.length > 1;
  const activeCue = hasMultipleActors ? activeWindowCue(actors, beats[activeBeat], activeReveal) : "";
  return (
    <div style={{
      color: R.text,
      fontSize: 15.5,
      lineHeight: 1.62,
      paddingBottom: 14,
    }}>
      <TextbookHeading>Explainer Mode</TextbookHeading>
      <div style={{
        color: R.textMid,
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 14,
      }}>
        Follow the reasoning one idea at a time. The animation updates with the current idea while the earlier reasoning stays visible.
      </div>
      {hasMultipleActors && (
        <div style={windowCueStyle}>
          {activeCue || (
            <>
              Look at <strong>Window 1</strong> for {actorDisplayName(actors[0], 0)} alone, <strong>Window 2</strong> for {actorDisplayName(actors[1], 1)} alone, and <strong>Overall animation</strong> for how they meet in the same scene.
            </>
          )}
        </div>
      )}
      {visibleBeats.map((beat, index) => (
        <ExplainerBeatBlock
          key={`${beat.id}-${index}`}
          beat={beat}
          index={index}
          active={index === activeBeat}
          activeRevealIndex={index === activeBeat ? activeRevealIndex : -1}
          onSelect={() => onBeatSelect(index)}
        />
      ))}
      {activeBeat < beats.length - 1 && (
        <div style={{
          marginTop: 12,
          color: R.textMuted,
          fontSize: 12,
          borderTop: `1px solid ${R.borderSub}`,
          paddingTop: 12,
        }}>
          Press `Ahead` to reveal the next teaching beat.
        </div>
      )}
    </div>
  );
}

function ExplainerBeatBlock({
  beat,
  index,
  active,
  activeRevealIndex,
  onSelect,
}: {
  beat: ExplainerBeatUi;
  index: number;
  active: boolean;
  activeRevealIndex: number;
  onSelect: () => void;
}) {
  const teachingReveals = (beat.sub_reveals ?? []).filter(reveal => {
    const hasText = Boolean(reveal.text?.trim());
    const hasFormula = (reveal.formula_lines ?? []).some(line => line.trim());
    return hasText || hasFormula;
  });
  const revealFormulaKeys = new Set(teachingReveals.flatMap(reveal => reveal.formula_lines ?? []).map(line => line.trim()));
  const formulaLines = uniqueTextRows(beat.formula_lines ?? []).filter(line => !revealFormulaKeys.has(line.trim()));
  return (
    <section style={{
      marginBottom: 14,
      padding: active ? "13px 14px" : "10px 0 2px",
      borderLeft: active ? `3px solid ${R.accent}` : `3px solid ${R.borderSub}`,
      paddingLeft: active ? 14 : 13,
      background: active ? "rgba(44,122,120,0.045)" : "transparent",
      borderRadius: active ? 10 : 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
        <h3 style={{
          margin: 0,
          color: R.text,
          fontSize: 16,
          fontWeight: 850,
          lineHeight: 1.35,
        }}>
          {index + 1}. {formatMathDisplay(beat.title || "Next idea")}
        </h3>
        <button
          onClick={onSelect}
          style={{
            border: "none",
            background: "transparent",
            color: active ? R.accent : R.textMuted,
            cursor: "pointer",
            padding: 0,
            font: "inherit",
            fontSize: 11,
            textDecoration: "underline",
            textUnderlineOffset: 3,
            whiteSpace: "nowrap",
          }}
        >
          replay beat
        </button>
      </div>

      {beat.learner_message && (
        <p style={{ ...solutionParagraphStyle, marginBottom: 8 }}>
          <RichMathText value={beat.learner_message} />
        </p>
      )}

      {teachingReveals.length > 0 && (
        <div style={teacherBreakdownStyle}>
          {teachingReveals.map((reveal, revealIndex) => (
            <div
              key={`${reveal.id}-${revealIndex}`}
              style={teacherBreakdownItemStyle(active && revealIndex === activeRevealIndex)}
            >
              {reveal.text && (
                <p style={{ ...solutionParagraphStyle, margin: "0 0 5px", color: R.text }}>
                  <RichMathText value={reveal.text} />
                </p>
              )}
              {(reveal.formula_lines ?? []).length > 0 && (
                <div style={{ display: "grid", gap: 3 }}>
                  {(reveal.formula_lines ?? []).map(line => (
                    <MathLine key={line}>{line}</MathLine>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formulaLines.length > 0 && (
        <div style={calculationBlockStyle}>
          {formulaLines.map(line => (
            <MathLine key={line}>{line}</MathLine>
          ))}
        </div>
      )}

      {active && beat.why_it_matters && (
        <div style={trapNoteStyle}>
          <RichMathText value={beat.why_it_matters} />
        </div>
      )}
    </section>
  );
}

const SIMULATION_PANEL_GUIDE = [
  {
    target: "question-panel",
    title: "Question panel",
    body: "Hide or show the original question/image when you need more room for the simulation.",
  },
  {
    target: "steps-panel",
    title: "Solution panel",
    body: "Hide or show the textbook solution. Clicking a solution step also jumps the simulation to that step.",
  },
  {
    target: "fullscreen",
    title: "Full screen",
    body: "Use this when the scene is cramped. The question and solution panels collapse so the animation gets the full viewport.",
  },
  {
    target: "panel-guide",
    title: "Panel guide",
    body: "This button reopens this walkthrough later. The guide auto-starts only once for a new browser profile.",
  },
  {
    target: "camera-pan",
    title: "Pan tool",
    body: "Use the hand tool to drag a zoomed scene left, right, up, or down. Turn it off to rotate/orbit again.",
  },
  {
    target: "step-prev",
    title: "Previous step",
    body: "Move backward through the solution. Each step should focus the simulation on the exact idea being explained.",
  },
  {
    target: "step-play",
    title: "Play and pause",
    body: "Play or pause the current step animation. Step animation is local to the current explanation step.",
  },
  {
    target: "step-next",
    title: "Next step",
    body: "Move forward through the solution in order, like a guided worked example.",
  },
  {
    target: "step-replay",
    title: "Replay step",
    body: "Replay only the current step. This is different from replaying the whole projectile lifecycle.",
  },
  {
    target: "full-animation",
    title: "Full animation",
    body: "Play the complete physical lifecycle. This is not just all solution steps stitched together.",
  },
  {
    target: "speed-control",
    title: "Speed",
    body: "Slow the animation down when a vector, collision, or impact event is too fast to inspect.",
  },
];

function SimulationPanelGuide({
  step,
  onNext,
  onPrev,
  onClose,
}: {
  step: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const item = SIMULATION_PANEL_GUIDE[step] ?? SIMULATION_PANEL_GUIDE[0];
  const isFirst = step <= 0;
  const isLast = step >= SIMULATION_PANEL_GUIDE.length - 1;
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ width: 1024, height: 720 });

  useEffect(() => {
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const target = document.querySelector<HTMLElement>(`[data-guide-id="${item.target}"]`);
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const timer = window.setTimeout(update, 120);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearTimeout(timer);
    };
  }, [item.target]);

  const tooltipWidth = 360;
  const tooltipLeft = targetRect
    ? Math.min(viewport.width - tooltipWidth - 16, Math.max(16, targetRect.left + targetRect.width / 2 - tooltipWidth / 2))
    : Math.max(16, viewport.width / 2 - tooltipWidth / 2);
  const tooltipTop = targetRect
    ? (
      targetRect.top > 220
        ? Math.max(16, targetRect.top - 188)
        : Math.min(viewport.height - 220, targetRect.bottom + 18)
    )
    : Math.max(80, viewport.height / 2 - 120);
  return (
    <>
      <div style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.28)",
        zIndex: 1000,
        pointerEvents: "none",
      }} />
      {targetRect && (
        <div style={{
          position: "fixed",
          left: targetRect.left - 7,
          top: targetRect.top - 7,
          width: targetRect.width + 14,
          height: targetRect.height + 14,
          border: `2px solid ${T.accent}`,
          borderRadius: 10,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.28), 0 0 22px rgba(88,196,221,0.48)",
          zIndex: 1001,
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "fixed",
        left: tooltipLeft,
        top: tooltipTop,
        width: tooltipWidth,
        maxWidth: "calc(100vw - 32px)",
        background: "rgba(17,17,28,0.97)",
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: T.shadow,
        padding: 16,
        zIndex: 1002,
        color: T.text,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ color: T.accent, fontSize: 11, fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Simulation controls {step + 1}/{SIMULATION_PANEL_GUIDE.length}
            </div>
            <div style={{ fontSize: 16, fontWeight: 850 }}>{item.title}</div>
          </div>
          <button type="button" onClick={onClose} style={smallGhostButtonStyle}>Close</button>
        </div>
        <div style={{ color: T.textMid, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
          {item.body}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <button type="button" disabled={isFirst} onClick={onPrev} style={playerButtonStyle(!isFirst)}>
            Previous
          </button>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center" }}>
            {SIMULATION_PANEL_GUIDE.map((_, index) => (
              <span key={index} style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: index === step ? T.accent : T.border,
                display: "block",
              }} />
            ))}
          </div>
          <button type="button" onClick={isLast ? onClose : onNext} style={playerButtonStyle(true)}>
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}

function ResizeHandle({
  active,
  label,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: {
  active: boolean;
  label: string;
  onMouseDown: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={resizeHandleStyle(active)}
    >
      <div style={{
        width: 2,
        height: 34,
        borderRadius: 999,
        background: active ? T.accent : "rgba(160,160,192,0.32)",
        boxShadow: active ? "0 0 14px rgba(88,196,221,0.36)" : "none",
      }} />
    </div>
  );
}

function TextbookStep({
  step,
  index,
  active,
  onSelect,
  compact,
  givens,
  unknown,
}: {
  step: WalkthroughStepUi;
  index: number;
  active: boolean;
  onSelect?: () => void;
  compact: boolean;
  givens: string[];
  unknown: string;
}) {
  const equation = step.equation || step.formula;
  const explanation = cleanStepExplanation(step.explanation);
  const rawResult = step.result || (step.title.toLowerCase().includes("answer") ? equation : "");
  const result = shouldShowBoxedStepResult(rawResult) ? rawResult : "";
  return (
    <section style={{
      border: `1px solid ${active ? "rgba(44,122,120,0.34)" : R.border}`,
      background: active ? "rgba(44,122,120,0.055)" : "rgba(255,250,240,0.74)",
      borderRadius: 12,
      padding: compact ? "12px 13px" : "14px 15px",
      marginBottom: compact ? 10 : 14,
      boxShadow: active ? "0 10px 28px rgba(44,122,120,0.10)" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <h3 style={{
          margin: 0,
          color: R.text,
          fontSize: compact ? 15 : 16,
          fontWeight: 850,
          lineHeight: 1.35,
        }}>
          Step {index + 1}: {formatMathDisplay(step.title)}
        </h3>
        {onSelect && (
          <button
            onClick={onSelect}
            style={{
              border: "none",
              background: "transparent",
              color: active ? R.accent : R.textMuted,
              cursor: "pointer",
              padding: 0,
              font: "inherit",
              fontSize: 11,
              textDecoration: "underline",
              textUnderlineOffset: 3,
              whiteSpace: "nowrap",
            }}
          >
            show in animation
          </button>
        )}
      </div>

      {(step.teaching_goal || step.student_goal) && (
        <p style={teachingGoalStyle}>
          {formatMathDisplay(step.teaching_goal || step.student_goal || "")}
        </p>
      )}

      {step.id === "invariant" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 8,
          marginBottom: 9,
        }}>
          <div style={solutionHighlightBoxStyle}>
            <div style={solutionHighlightLabelStyle}>Given</div>
            {givens.length > 0 ? givens.slice(0, 5).map(given => (
              <div key={given} style={solutionHighlightMathStyle}>
                <MathText value={given} />
              </div>
            )) : (
              <div style={{ color: T.textMuted, fontSize: 12 }}>No explicit numerical givens.</div>
            )}
          </div>
          <div style={{ ...solutionHighlightBoxStyle, borderColor: "rgba(31,122,90,0.24)", background: R.goodSoft }}>
            <div style={solutionHighlightLabelStyle}>To Find</div>
            <div style={{ ...solutionHighlightMathStyle, color: R.good }}>
              <MathText value={unknown || "requested quantity"} />
            </div>
          </div>
        </div>
      )}

      {step.concept_used && (
        <p style={solutionParagraphStyle}>
          Principle: {formatMathDisplay(step.concept_used)}
        </p>
      )}
      {explanation && (
        <p style={solutionParagraphStyle}>{formatMathDisplay(explanation)}</p>
      )}
      {(equation || step.substitution || (step.calculation && step.calculation !== step.substitution)) && (
        <div style={calculationBlockStyle}>
          <div style={calculationLabelStyle}>Calculation</div>
          {equation && <MathLine>{equation}</MathLine>}
          {step.substitution && <MathLine>{step.substitution}</MathLine>}
          {step.calculation && step.calculation !== step.substitution && <MathLine>{step.calculation}</MathLine>}
        </div>
      )}
      {result && (
        <>
          <p style={solutionParagraphStyle}>Therefore,</p>
          <BoxedAnswer><AnswerMathText value={result} /></BoxedAnswer>
        </>
      )}
      {step.trap_note && (
        <div style={trapNoteStyle}>
          {formatMathDisplay(step.trap_note)}
        </div>
      )}
      {step.id !== "invariant" && step.next_known_values && step.next_known_values.length > (step.known_values?.length ?? 0) && (
        <div style={knownUpdateStyle}>
          Added to known values:{" "}
          <MathText value={step.next_known_values[step.next_known_values.length - 1]} />
        </div>
      )}
    </section>
  );
}

function TextbookHeading({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      color: R.textMuted,
      marginBottom: 10,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontWeight: 850,
    }}>
      {children}
    </div>
  );
}

function TextbookSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{
      margin: "12px 0 8px",
      color: R.text,
      fontSize: 16,
      lineHeight: 1.3,
      fontWeight: 850,
    }}>
      {children}
    </h2>
  );
}

function MathLine({ children }: { children: string }) {
  if (!shouldRenderAsEquationLine(children)) {
    return (
      <p style={solutionParagraphStyle}>
        <RichMathText value={children} />
      </p>
    );
  }
  return (
    <div style={mathLineStyle}>
      <MathText value={children} block />
    </div>
  );
}

function BoxedAnswer({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "inline-block",
      maxWidth: "100%",
      border: "1px solid rgba(31,122,90,0.28)",
      background: R.goodSoft,
      borderRadius: 7,
      padding: "6px 9px",
      color: R.good,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 14,
      lineHeight: 1.45,
      overflowWrap: "anywhere",
      fontWeight: 750,
    }}>
      □ {children}
    </div>
  );
}

function cleanStepExplanation(value: string) {
  return value
    .split("\n")
    .filter(line => !line.trim().toLowerCase().startsWith("substitute:"))
    .join("\n")
    .trim();
}

function shouldRenderAsEquationLine(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(for|because|where|using|at|now|this)\b/i.test(trimmed)) return false;
  if (/\b(projectile|motion|range depends|horizontal range|same height|report only)\b/i.test(trimmed)) return false;
  if (/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(trimmed)) return false;
  return /[=\\]|\\sqrt|√|\bsqrt\b|\bsin\b|\bcos\b|\btan\b|\^|_/.test(trimmed);
}

function shouldShowBoxedStepResult(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(range|time|height|speed|velocity|answer|position)$/i.test(trimmed)) return false;
  return true;
}

function uniqueTextRows(rows: string[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const normalized = normalizedTextRowKey(row);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizedTextRowKey(row: string) {
  return row
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^time=/, "t=")
    .replace(/^angle=/, "theta=")
    .replace(/°/g, "deg");
}

function stepForExplainerBeat(beat: ExplainerBeatUi, steps: WalkthroughStepUi[]) {
  const stepId = beat.step_id || beat.id;
  return steps.find(step => step.id === stepId) ?? null;
}

function activeRevealForBeat(beat: ExplainerBeatUi, progress: number): ActiveRevealState {
  const reveals = beat.sub_reveals ?? [];
  if (!reveals.length) {
    return {
      index: 0,
      revealIds: beat.reveal_ids ?? [],
      highlightIds: beat.highlight_ids ?? [],
    };
  }
  const clamped = clamp(progress, 0, 0.999999);
  const index = clamp(Math.floor(clamped * reveals.length), 0, reveals.length - 1);
  const visibleReveals = reveals.slice(0, index + 1);
  const current = reveals[index];
  return {
    id: current?.id,
    index,
    revealIds: uniqueTextRows(visibleReveals.flatMap(reveal => reveal.reveal_ids ?? [])),
    highlightIds: uniqueTextRows(current?.highlight_ids?.length ? current.highlight_ids : (beat.highlight_ids ?? [])),
  };
}

const solutionParagraphStyle: CSSProperties = {
  margin: "0 0 8px",
  color: R.textMid,
  fontSize: 14.5,
  lineHeight: 1.58,
  whiteSpace: "pre-line",
};

const teachingGoalStyle: CSSProperties = {
  margin: "0 0 8px",
  color: R.text,
  background: R.accentSoft,
  border: "1px solid rgba(44,122,120,0.16)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 14,
  lineHeight: 1.48,
  fontWeight: 650,
};

const trapNoteStyle: CSSProperties = {
  marginTop: 8,
  color: R.warn,
  background: R.warnSoft,
  border: "1px solid rgba(184,135,47,0.22)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 13.5,
  lineHeight: 1.45,
};

const knownUpdateStyle: CSSProperties = {
  marginTop: 8,
  color: R.good,
  background: R.goodSoft,
  border: "1px solid rgba(31,122,90,0.20)",
  borderRadius: 8,
  padding: "6px 9px",
  fontSize: 12.5,
  lineHeight: 1.45,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const mathLineStyle: CSSProperties = {
  color: R.text,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 14,
  lineHeight: 1.65,
  overflowWrap: "anywhere",
};

const givenChipStyle: CSSProperties = {
  color: R.text,
  background: R.surface2,
  border: `1px solid ${R.borderSub}`,
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 14,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

const calculationBlockStyle: CSSProperties = {
  background: R.surface2,
  border: `1px solid ${R.borderSub}`,
  borderRadius: 10,
  padding: "8px 10px",
  margin: "8px 0 9px",
};

const calculationLabelStyle: CSSProperties = {
  color: R.textMuted,
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 4,
};

const teacherBreakdownStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
  margin: "8px 0 10px",
};

const teacherBreakdownLabelStyle: CSSProperties = {
  color: R.textMuted,
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 6,
};

function teacherBreakdownItemStyle(active: boolean): CSSProperties {
  return {
    padding: active ? "8px 10px" : "6px 0",
    borderTop: "none",
    borderRadius: 8,
    background: active ? "rgba(44,122,120,0.10)" : "transparent",
    boxShadow: active ? "inset 3px 0 0 rgba(44,122,120,0.55)" : "none",
    transition: "background 120ms ease",
  };
}

const solutionHighlightBoxStyle: CSSProperties = {
  border: `1px solid ${R.borderSub}`,
  background: R.surface2,
  borderRadius: 8,
  padding: "8px 9px",
};

const solutionHighlightLabelStyle: CSSProperties = {
  color: R.textMuted,
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
  marginBottom: 4,
};

const solutionHighlightMathStyle: CSSProperties = {
  color: R.text,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13.5,
  lineHeight: 1.55,
};

function WalkthroughVisual({
  engineCase,
  diagramModel,
  sceneSpec,
  stepId,
  animationProgress,
  fullAnimationActive,
  activeReveal,
  intent,
  answerText,
}: {
  engineCase: string;
  diagramModel?: DiagramModel;
  sceneSpec?: AnimationSceneSpec;
  stepId: string;
  animationProgress: number;
  fullAnimationActive: boolean;
  activeReveal?: ActiveRevealState;
  intent: string;
  answerText: string;
}) {
  const [collapsedViews, setCollapsedViews] = useState<Record<string, boolean>>({});
  const toggleView = (id: string) => {
    setCollapsedViews(value => ({ ...value, [id]: !value[id] }));
  };
  const actors = sceneSpec ? sceneActors(sceneSpec) : [];
  const hasMultipleActors = actors.length > 1;
  const isBoardCollapsed = Boolean(collapsedViews.board);
  const isFullCollapsed = Boolean(collapsedViews.full);
  const collapsedPanels = [
    isBoardCollapsed ? { id: "board", title: hasMultipleActors ? "Object boards" : "Teaching board" } : null,
    isFullCollapsed ? { id: "full", title: "3D animation" } : null,
  ].filter(Boolean) as Array<{ id: string; title: string }>;
  const animationStepId = fullAnimationActive ? "__full_lifecycle" : stepId;

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      position: "relative",
      background: "radial-gradient(circle at 35% 20%, rgba(88,196,221,0.10), transparent 34%), #11111c",
      overflow: "hidden",
    }}>
      {sceneSpec ? (
        <div style={multiViewShellStyle}>
          {collapsedPanels.length > 0 && (
            <div style={restoreChipRowStyle}>
              {collapsedPanels.map(panel => (
                <button key={panel.id} type="button" onClick={() => toggleView(panel.id)} style={restoreChipStyle}>
                  Show {panel.title}
                </button>
              ))}
            </div>
          )}
          {!isBoardCollapsed && (
            <TeachingScenePanel
              id="board"
              title={hasMultipleActors ? "Object boards" : "Teaching board"}
              subtitle={hasMultipleActors ? "Separate state diagrams for each moving object" : "Current quantities, labels, and step-local highlights"}
              onToggle={() => toggleView("board")}
              grow={isFullCollapsed}
            >
              {hasMultipleActors ? (
                <div style={actorBoardGridStyle}>
                  {actors.map((actor, index) => (
                    <div key={actor} style={actorBoardTileStyle}>
                      <div style={actorBoardHeaderStyle}>
                        <span>{`Window ${index + 1}`}</span>
                        <strong>{actorDisplayName(actor, index)}</strong>
                      </div>
                      <div style={actorBoardBodyStyle}>
                        <TeachingBoard2D
                          sceneSpec={sceneSpec}
                          stepId={stepId}
                          animationProgress={0}
                          revealIds={activeReveal?.revealIds ?? []}
                          highlightIds={activeReveal?.highlightIds ?? []}
                          mode="concept"
                          actorFilter={actor}
                          answerText={answerText}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <TeachingBoard2D
                  sceneSpec={sceneSpec}
                  stepId={stepId}
                  animationProgress={0}
                  revealIds={activeReveal?.revealIds ?? []}
                  highlightIds={activeReveal?.highlightIds ?? []}
                  mode="concept"
                  answerText={answerText}
                />
              )}
            </TeachingScenePanel>
          )}
          {!isFullCollapsed && (
            <TeachingScenePanel
              id="full"
              title="3D animation"
              subtitle={fullAnimationActive ? "Complete lifecycle" : "Step-local motion for this beat"}
              onToggle={() => toggleView("full")}
              grow
            >
              <AnimationScene3D
                sceneSpec={sceneSpec}
                stepId={animationStepId}
                teachingStepId={stepId}
                animationProgress={animationProgress}
                revealIds={activeReveal?.revealIds ?? []}
                highlightIds={activeReveal?.highlightIds ?? []}
                accumulateTeachingVectors={false}
                vectorMode={fullAnimationActive ? "lifecycle" : "beat"}
              />
            </TeachingScenePanel>
          )}
        </div>
      ) : (
        <div style={{
          height: "100%",
          minHeight: 360,
          display: "grid",
          placeItems: "center",
          color: T.textMuted,
          textAlign: "center",
          padding: 24,
        }}>
          <div>
            <div style={{ color: T.text, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>3D scene unavailable</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 420 }}>
              This solve did not produce a validated animation scene. The renderer no longer falls back to placeholder SVGs.
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes walk-dot { from { offset-distance: 0%; } to { offset-distance: 100%; } }
        @keyframes pulse-focus { 0%,100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.08); opacity: 1; } }
        @keyframes arrow-grow { from { transform: scaleX(0.25); opacity: 0.45; } to { transform: scaleX(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

function TeachingScenePanel({
  title,
  subtitle,
  collapsed = false,
  onToggle,
  grow = false,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  collapsed?: boolean;
  onToggle: () => void;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section style={{
      ...teachingScenePanelStyle,
      flex: grow ? "1 1 0" : "1 1 0",
      minHeight: collapsed ? 44 : grow ? 320 : 230,
    }}>
      <div style={teachingScenePanelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={teachingScenePanelTitleStyle}>{title}</div>
          <div style={teachingScenePanelSubtitleStyle}>{subtitle}</div>
        </div>
        <button type="button" onClick={onToggle} style={teachingSceneCollapseButtonStyle}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <div style={teachingScenePanelBodyStyle}>
          {children}
        </div>
      )}
    </section>
  );
}

function sceneActors(sceneSpec: AnimationSceneSpec) {
  const runtimeSpec = sceneSpec as AnimationSceneSpec & {
    motions?: Array<{ actor?: string }>;
    live_vectors?: Array<{ actor?: string }>;
  };
  const trajectoryActors = uniqueNonEmpty(sceneSpec.trajectories.map(trajectory => trajectory.actor || "projectile"));
  if (trajectoryActors.length > 0) return trajectoryActors.slice(0, 2);
  const motionActors = uniqueNonEmpty((runtimeSpec.motions ?? []).map(motion => motion.actor || ""));
  if (motionActors.length > 0) return motionActors.slice(0, 2);
  return uniqueNonEmpty((runtimeSpec.live_vectors ?? []).map(vector => vector.actor || "")).slice(0, 2);
}

function uniqueNonEmpty(items: string[]) {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

function actorDisplayName(actor: string, index: number) {
  if (actor === "projectile_p") return "Object P";
  if (actor === "slider_q") return "Object Q";
  if (actor === "projectile") return `Object ${index + 1}`;
  const cleaned = actor
    .replace(/^projectile_?/i, "")
    .replace(/^slider_?/i, "")
    .replace(/_/g, " ")
    .trim();
  return cleaned ? `Object ${cleaned.toUpperCase()}` : `Object ${index + 1}`;
}

function activeWindowCue(actors: string[], beat: ExplainerBeatUi | undefined, activeReveal?: ActiveRevealState) {
  const ids = [
    ...(beat?.reveal_ids ?? []),
    ...(beat?.highlight_ids ?? []),
    ...(activeReveal?.revealIds ?? []),
    ...(activeReveal?.highlightIds ?? []),
  ].map(id => id.toLowerCase());
  if (!ids.length) return "";
  const matchedActorIndexes = actors
    .map((actor, index) => ({ actor, index }))
    .filter(({ actor }) => ids.some(id => id.includes(actor.toLowerCase()) || id.includes(actorAlias(actor))));
  const sharedEvent = ids.some(id => /collision|impact|meet|event:|point:collision|point:impact|trajectory:/.test(id));
  if (sharedEvent || matchedActorIndexes.length > 1) {
    return "Use Overall animation for the shared event, then compare the smaller windows only for each object’s own motion.";
  }
  if (matchedActorIndexes.length === 1) {
    const { actor, index } = matchedActorIndexes[0];
    return `Look at Window ${index + 1} for ${actorDisplayName(actor, index)} alone. The overall animation is only for checking how the objects line up in the same scene.`;
  }
  if (ids.some(id => id.includes("quantity") || id.includes("vector") || id.includes("gravity"))) {
    return "Use the smaller window that contains the highlighted vector or quantity; use Overall animation only for the complete event.";
  }
  return "";
}

function actorAlias(actor: string) {
  if (actor === "projectile_p") return "actor:projectile_p";
  if (actor === "slider_q") return "actor:slider_q";
  return actor.replace(/^projectile_?/i, "").replace(/^slider_?/i, "").toLowerCase();
}

const multiViewShellStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
};

const actorBoardGridStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 8,
};

const actorBoardTileStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid rgba(23,36,43,0.14)",
  borderRadius: 8,
  background: "#fbfaf4",
};

const actorBoardHeaderStyle: CSSProperties = {
  flex: "0 0 auto",
  minHeight: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 8px",
  borderBottom: "1px solid rgba(23,36,43,0.10)",
  color: "#17242b",
  fontSize: 11,
  fontWeight: 900,
};

const actorBoardBodyStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
};

const windowCueStyle: CSSProperties = {
  margin: "0 0 14px",
  padding: "10px 12px",
  border: `1px solid ${R.border}`,
  borderRadius: 10,
  background: "rgba(44,122,120,0.08)",
  color: R.text,
  fontSize: 13,
  lineHeight: 1.5,
};

const restoreChipRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  flex: "0 0 auto",
};

const restoreChipStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(17,17,28,0.78)",
  color: T.textMid,
  borderRadius: 999,
  padding: "7px 10px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const teachingScenePanelStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  background: "rgba(10,10,20,0.56)",
};

const teachingScenePanelHeaderStyle: CSSProperties = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(17,17,28,0.72)",
  flexShrink: 0,
};

const teachingScenePanelTitleStyle: CSSProperties = {
  color: T.textOnDark,
  fontSize: 12,
  fontWeight: 900,
  lineHeight: 1.2,
};

const teachingScenePanelSubtitleStyle: CSSProperties = {
  color: "rgba(251,252,250,0.68)",
  fontSize: 10.5,
  fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const teachingSceneCollapseButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(251,252,250,0.74)",
  borderRadius: 8,
  padding: "5px 8px",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

const teachingScenePanelBodyStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
};

function ProjectileVisual({ stepId }: { stepId: string }) {
  return (
    <svg viewBox="0 0 640 380" style={{ width: "100%", height: "100%", display: "block" }}>
      <path d="M70 310 H585" stroke="#3a3a55" strokeWidth="3" />
      <path d="M95 290 C210 105 365 105 520 290" stroke="#58c4dd" strokeWidth="4" fill="none" strokeDasharray="8 8" />
      <circle cx="95" cy="290" r="13" fill="#fc6255" />
      <line x1="95" y1="290" x2="190" y2="290" stroke="#58c4dd" strokeWidth="7" strokeLinecap="round" style={{ animation: "arrow-grow 0.7s ease both", transformOrigin: "95px 290px" }} />
      <line x1="95" y1="290" x2="95" y2="205" stroke="#ffff00" strokeWidth="7" strokeLinecap="round" style={{ animation: "arrow-grow 0.7s ease both", transformOrigin: "95px 290px" }} />
      <circle cx={stepId === "answer" ? 520 : stepId === "delta_v" ? 315 : 95} cy={stepId === "answer" ? 290 : stepId === "delta_v" ? 140 : 290} r="16" fill="#fc6255" style={{ animation: "pulse-focus 1.1s ease-in-out infinite" }} />
      <text x="105" y="328" fill="#a0a0c0" fontSize="15">velocity components</text>
      <text x="440" y="270" fill="#4ade80" fontSize="16">final answer</text>
    </svg>
  );
}

function SceneSpecProjectileVisual({ sceneSpec, stepId, animationProgress }: { sceneSpec: AnimationSceneSpec; stepId: string; animationProgress: number }) {
  const trajectory = sceneSpec.trajectories[0]?.sampled_points ?? [];
  const quantities = sceneSpec.quantities;
  const points = Object.values(sceneSpec.geometry.points);
  const obstacles = sceneSpec.geometry.obstacles as Array<{ id?: string; type?: string; x?: number; height?: number }>;
  const maxX = Math.max(1, ...trajectory.map(point => point.x), ...points.map(point => point.x), ...obstacles.map(item => item.x ?? 0));
  const maxY = Math.max(1, ...trajectory.map(point => point.y), ...points.map(point => point.y), ...obstacles.map(item => item.height ?? 0));
  const mapX = (x: number) => 70 + (x / maxX) * 500;
  const mapY = (y: number) => 310 - (y / maxY) * 205;
  const path = trajectory
    .map((point, index) => `${index === 0 ? "M" : "L"}${mapX(point.x).toFixed(1)} ${mapY(point.y).toFixed(1)}`)
    .join(" ");
  const clampedProgress = Math.max(0, Math.min(1, animationProgress));
  const launch = sceneSpec.geometry.points.launch ?? { x: 0, y: 0 };
  const landing = sceneSpec.geometry.points.landing ?? trajectory[trajectory.length - 1] ?? { x: maxX, y: 0 };
  const apex = sceneSpec.geometry.points.apex ?? trajectory.reduce((best, point) => point.y > best.y ? point : best, { x: 0, y: 0 });
  const target = sceneSpec.geometry.points.target;
  const wallTop = sceneSpec.geometry.points.wall_top;
  const positionAtT = sceneSpec.geometry.points.position_at_t;
  const isRangeScene = sceneSpec.problem.unknown.includes("range");
  const isHeightScene = sceneSpec.problem.unknown.includes("height");
  const isWallScene = sceneSpec.problem.world === "wall";
  const isTargetScene = sceneSpec.problem.world === "target";
  const isPositionScene = sceneSpec.problem.unknown === "position_at_time";
  const showRange = isRangeScene || stepId.includes("range") || stepId.includes("answer");
  const showHeight = isRangeScene || isHeightScene || sceneSpec.problem.world === "height_launch" || stepId.includes("height") || stepId.includes("peak") || stepId.includes("answer");
  const showTimer = stepId.includes("time") || sceneSpec.problem.unknown === "time_of_flight";
  const focusPoint = isWallScene && wallTop ? wallTop : isTargetScene && target ? target : isPositionScene && positionAtT ? positionAtT : showHeight ? apex : showRange || showTimer ? landing : launch;
  const launchX = mapX(launch.x);
  const launchY = mapY(launch.y);
  const angle = ((quantities.theta?.value ?? 45) * Math.PI) / 180;
  const vectorLength = 95;
  const vectorTip = {
    x: launchX + Math.cos(angle) * vectorLength,
    y: launchY - Math.sin(angle) * vectorLength,
  };
  const movingPoint = interpolateTrajectory(trajectory, clampedProgress);
  const tangentPoint = interpolateTrajectory(trajectory, Math.min(1, clampedProgress + 0.035));
  const tangentDx = mapX(tangentPoint.x) - mapX(movingPoint.x);
  const tangentDy = mapY(tangentPoint.y) - mapY(movingPoint.y);
  const tangentLength = Math.max(1, Math.hypot(tangentDx, tangentDy));
  const velocityTip = {
    x: mapX(movingPoint.x) + (tangentDx / tangentLength) * 58,
    y: mapY(movingPoint.y) + (tangentDy / tangentLength) * 58,
  };

  return (
    <svg viewBox="0 0 640 380" style={{ width: "100%", height: "100%", display: "block" }}>
      <path d="M60 310 H590" stroke="#3a3a55" strokeWidth="3" />
      <path d={path} stroke="#3a3a55" strokeWidth="4" fill="none" strokeDasharray="8 8" opacity="0.8" />
      <path d={path} stroke="#58c4dd" strokeWidth="5" fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - clampedProgress} strokeLinecap="round" />
      {obstacles.map((obstacle, index) => obstacle.type === "vertical_wall" && typeof obstacle.x === "number" ? (
        <g key={obstacle.id ?? index}>
          <rect x={mapX(obstacle.x) - 8} y={mapY(obstacle.height ?? 0)} width="16" height={310 - mapY(obstacle.height ?? 0)} fill="#6b6b8a" opacity="0.9" />
          <text x={mapX(obstacle.x) + 12} y={mapY(obstacle.height ?? 0) + 18} fill="#d7f7ff" fontSize="14">wall</text>
        </g>
      ) : null)}
      <circle cx={launchX} cy={launchY} r="12" fill="#fc6255" />
      <circle cx={mapX(apex.x)} cy={mapY(apex.y)} r="8" fill="#ffd166" stroke="#11111c" strokeWidth="3" />
      <text x={mapX(apex.x) + 10} y={mapY(apex.y) - 10} fill="#ffd166" fontSize="14">apex</text>
      <circle cx={mapX(landing.x)} cy={mapY(landing.y)} r="8" fill="#4ade80" stroke="#11111c" strokeWidth="3" />
      {target && (
        <>
          <circle cx={mapX(target.x)} cy={mapY(target.y)} r="11" fill="#4ade80" stroke="#11111c" strokeWidth="3" />
          <path d={`M${mapX(target.x) - 16} ${mapY(target.y)} H${mapX(target.x) + 16} M${mapX(target.x)} ${mapY(target.y) - 16} V${mapY(target.y) + 16}`} stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
          <text x={mapX(target.x) + 16} y={mapY(target.y) - 12} fill="#4ade80" fontSize="14">target</text>
        </>
      )}
      {positionAtT && (
        <>
          <circle cx={mapX(positionAtT.x)} cy={mapY(positionAtT.y)} r="10" fill="#d7f7ff" stroke="#11111c" strokeWidth="3" />
          <text x={mapX(positionAtT.x) + 12} y={mapY(positionAtT.y) - 10} fill="#d7f7ff" fontSize="14">{positionAtT.label ?? "position"}</text>
        </>
      )}
      <line x1={launchX} y1={launchY} x2={vectorTip.x} y2={vectorTip.y} stroke="#fc6255" strokeWidth="7" strokeLinecap="round" />
      <line x1={launchX} y1={launchY} x2={launchX + 78} y2={launchY} stroke="#58c4dd" strokeWidth="5" strokeLinecap="round" opacity="0.68" />
      <line x1={launchX} y1={launchY} x2={launchX} y2={launchY - 78} stroke="#ffff00" strokeWidth="5" strokeLinecap="round" opacity="0.68" />
      <path d={`M${launchX + 34} ${launchY} A34 34 0 0 0 ${launchX + Math.cos(angle) * 34} ${launchY - Math.sin(angle) * 34}`} stroke="#d7f7ff" strokeWidth="2" fill="none" />
      {showRange && (
        <>
          <line x1={mapX(launch.x)} y1="340" x2={mapX(landing.x)} y2="340" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
          <line x1={mapX(launch.x)} y1="331" x2={mapX(launch.x)} y2="349" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
          <line x1={mapX(landing.x)} y1="331" x2={mapX(landing.x)} y2="349" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
          <text x={(mapX(launch.x) + mapX(landing.x)) / 2 - 38} y="363" fill="#4ade80" fontSize="16">R = {formatNumber(quantities.R?.value)} m</text>
        </>
      )}
      {showHeight && (
        <>
          <line x1={mapX(apex.x)} y1={mapY(0)} x2={mapX(apex.x)} y2={mapY(apex.y)} stroke="#ffd166" strokeWidth="4" strokeDasharray="6 5" />
          <text x={mapX(apex.x) + 10} y={mapY(apex.y) + 8} fill="#ffd166" fontSize="16">H = {formatNumber(quantities.H?.value)} m</text>
        </>
      )}
      {showTimer && (
        <text x="430" y="68" fill="#d7f7ff" fontSize="17">T = {formatNumber(quantities.T?.value)} s</text>
      )}
      {isWallScene && wallTop && (
        <text x={mapX(wallTop.x) - 76} y="68" fill="#d7f7ff" fontSize="16">
          y_wall = {formatNumber(wallTop.y)} m
        </text>
      )}
      <line x1={mapX(movingPoint.x)} y1={mapY(movingPoint.y)} x2={velocityTip.x} y2={velocityTip.y} stroke="#fc6255" strokeWidth="5" strokeLinecap="round" />
      <circle cx={mapX(movingPoint.x)} cy={mapY(movingPoint.y)} r="12" fill="#fc6255" stroke="#11111c" strokeWidth="3" />
      <text x={mapX(movingPoint.x) + 14} y={mapY(movingPoint.y) - 12} fill="#fc6255" fontSize="13">v</text>
      <circle cx={mapX(focusPoint.x)} cy={mapY(focusPoint.y)} r="17" fill="#fc6255" style={{ animation: "pulse-focus 1.1s ease-in-out infinite" }} />
      <text x={launchX + 10} y={launchY + 28} fill="#a0a0c0" fontSize="14">u = {formatNumber(quantities.u?.value)} m/s, theta = {formatNumber(quantities.theta?.value)}°</text>
      <text x="72" y="38" fill="#a0a0c0" fontSize="13">{sceneSpec.problem.world} / {sceneSpec.problem.unknown}</text>
    </svg>
  );
}

function formatNumber(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Math.abs(value) >= 100 ? value.toFixed(0) : Number(value.toFixed(3)).toString();
}

function interpolateTrajectory(points: Array<{ x: number; y: number; t?: number }>, progress: number) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (points.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(points.length - 1, left + 1);
  const local = scaled - left;
  return {
    x: points[left].x + (points[right].x - points[left].x) * local,
    y: points[left].y + (points[right].y - points[left].y) * local,
  };
}

function StaircaseVisual({ stepId }: { stepId: string }) {
  const highlightX = stepId === "first_hit" ? 502 : stepId === "drop" ? 330 : 195;
  const highlightY = stepId === "first_hit" ? 252 : stepId === "drop" ? 176 : 108;
  return (
    <svg viewBox="0 0 640 380" style={{ width: "100%", height: "100%", display: "block" }}>
      <path d="M90 90 H180 V130 H270 V170 H360 V210 H450 V250 H540 V310 H590" stroke="#6b6b8a" strokeWidth="5" fill="none" />
      <path d="M105 88 C210 95 310 135 405 205 C465 248 505 280 555 305" stroke="#58c4dd" strokeWidth="4" fill="none" strokeDasharray="7 7" />
      <circle cx={highlightX} cy={highlightY} r="24" fill="none" stroke="#4ade80" strokeWidth="5" style={{ animation: "pulse-focus 1.1s ease-in-out infinite" }} />
      <circle cx="105" cy="88" r="12" fill="#fc6255" />
      <line x1="105" y1="88" x2="185" y2="88" stroke="#58c4dd" strokeWidth="7" strokeLinecap="round" />
      <text x="84" y="342" fill="#a0a0c0" fontSize="15">first vertical face satisfying the inequality is highlighted</text>
      <text x="482" y="235" fill="#4ade80" fontSize="18">21st</text>
    </svg>
  );
}

function InclineVisual({ engineCase, diagramModel, stepId }: { engineCase: string; diagramModel?: DiagramModel; stepId: string }) {
  const twoInclines = engineCase === "two_inclines_perpendicular_launch_impact";
  const model = twoInclines ? buildTwoInclineSvgModel(diagramModel) : null;
  return (
    <svg viewBox="0 0 640 380" style={{ width: "100%", height: "100%", display: "block" }}>
      {twoInclines && model ? (
        <>
          <path d="M68 312 H590" stroke="#3a3a55" strokeWidth="4" />
          <path d={`M${model.O.x} ${model.O.y} L${model.A.x} ${model.A.y}`} stroke="#6b6b8a" strokeWidth="6" strokeLinecap="round" />
          <path d={`M${model.O.x} ${model.O.y} L${model.B.x} ${model.B.y}`} stroke="#6b6b8a" strokeWidth="6" strokeLinecap="round" />
          <path d={`M${model.P.x} ${model.P.y} C300 170 390 122 ${model.Q.x} ${model.Q.y}`} stroke="#58c4dd" strokeWidth="4" strokeDasharray="8 8" fill="none" />
          <line x1={model.P.x} y1={model.P.y} x2={model.uTip.x} y2={model.uTip.y} stroke="#fc6255" strokeWidth="7" strokeLinecap="round" />
          <line x1={model.Q.x} y1={model.Q.y} x2={model.vqTip.x} y2={model.vqTip.y} stroke="#4ade80" strokeWidth="7" strokeLinecap="round" style={{ opacity: stepId === "impact_speed" ? 1 : 0.52 }} />
          <line x1={model.P.x} y1={model.P.y} x2={model.vxTip.x} y2={model.vxTip.y} stroke="#58c4dd" strokeWidth="5" strokeLinecap="round" style={{ opacity: stepId === "horizontal_component" ? 1 : 0.45 }} />
          <circle cx={stepId === "impact_speed" ? model.Q.x : stepId === "horizontal_component" ? model.vxTip.x : model.P.x} cy={stepId === "impact_speed" ? model.Q.y : stepId === "horizontal_component" ? model.vxTip.y : model.P.y} r="18" fill="#fc6255" style={{ animation: "pulse-focus 1.1s ease-in-out infinite" }} />
          <path d="M286 285 A44 44 0 0 0 330 241" stroke="#d7f7ff" strokeWidth="3" fill="none" />
          <path d="M330 285 A58 58 0 0 1 388 227" stroke="#d7f7ff" strokeWidth="3" fill="none" />
          <text x={model.O.x - 9} y={model.O.y + 21} fill="#e8e8f0" fontSize="19">O</text>
          <text x={model.A.x - 3} y={model.A.y - 10} fill="#e8e8f0" fontSize="17">A</text>
          <text x={model.B.x + 4} y={model.B.y - 3} fill="#e8e8f0" fontSize="17">B</text>
          <text x={model.P.x - 12} y={model.P.y - 9} fill="#e8e8f0" fontSize="17">P</text>
          <text x={model.Q.x + 8} y={model.Q.y - 5} fill="#e8e8f0" fontSize="17">Q</text>
          <text x="248" y="274" fill="#a0a0c0" fontSize="15">OA 30° left of horizontal</text>
          <text x="392" y="228" fill="#a0a0c0" fontSize="15">OB 60°</text>
          <text x="305" y="124" fill="#fc6255" fontSize="15">u ⟂ OA</text>
          <text x="520" y="190" fill="#4ade80" fontSize="15">vQ ⟂ OB</text>
        </>
      ) : (
        <>
          <path d="M80 295 L565 170" stroke="#6b6b8a" strokeWidth="6" />
          <line x1="225" y1="258" x2="310" y2="235" stroke="#58c4dd" strokeWidth="7" strokeLinecap="round" />
          <line x1="310" y1="235" x2="360" y2="285" stroke="#ffff00" strokeWidth="7" strokeLinecap="round" style={{ opacity: stepId === "down_slope" ? 1 : 0.45 }} />
          <line x1="310" y1="235" x2="390" y2="260" stroke="#4ade80" strokeWidth="7" strokeLinecap="round" style={{ opacity: stepId === "resultant" ? 1 : 0.45 }} />
          <circle cx={stepId === "components" ? 225 : stepId === "down_slope" ? 360 : 390} cy={stepId === "components" ? 258 : stepId === "down_slope" ? 285 : 260} r="17" fill="#fc6255" style={{ animation: "pulse-focus 1.1s ease-in-out infinite" }} />
          <text x="92" y="322" fill="#a0a0c0" fontSize="15">smooth inclined plane</text>
        </>
      )}
    </svg>
  );
}

function buildTwoInclineSvgModel(diagramModel?: DiagramModel) {
  const O = { x: 330, y: 285 };
  const surface = (id: string) => (diagramModel?.surfaces ?? []).find(item => item.id === id);
  const vector = (id: string) => (diagramModel?.vectors ?? []).find(item => item.id === id);
  const oaDeg = numberValue(surface("OA")?.ray_direction_deg, 150);
  const obDeg = numberValue(surface("OB")?.ray_direction_deg, 60);
  const uDeg = numberValue(vector("u")?.direction_deg, 60);
  const vqDeg = numberValue(vector("vQ")?.direction_deg, -30);

  const A = pointFrom(O, oaDeg, 225);
  const B = pointFrom(O, obDeg, 230);
  const P = pointFrom(O, oaDeg, 104);
  const Q = pointFrom(O, obDeg, 170);
  const uTip = pointFrom(P, uDeg, 115);
  const vqTip = pointFrom(Q, vqDeg, 78);
  const vxTip = pointFrom(P, 0, 78);
  return { O, A, B, P, Q, uTip, vqTip, vxTip };
}

function pointFrom(origin: { x: number; y: number }, deg: number, length: number) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: origin.x + Math.cos(rad) * length,
    y: origin.y - Math.sin(rad) * length,
  };
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function playerButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.borderSub,
    color: active ? T.bg : T.textMuted,
    border: "none",
    borderRadius: 9,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: active ? "pointer" : "default",
    fontFamily: "inherit",
  };
}

function resizeHandleStyle(active: boolean): CSSProperties {
  return {
    minHeight: 0,
    width: 10,
    cursor: "col-resize",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? "rgba(88,196,221,0.08)" : "transparent",
    transition: "background 120ms ease",
    touchAction: "none",
  };
}

function panelToggleButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(88,196,221,0.10)" : "rgba(45,45,69,0.6)",
    color: active ? T.accent : T.textMuted,
    border: `1px solid ${active ? "rgba(88,196,221,0.35)" : T.borderSub}`,
    borderRadius: 8,
    padding: "7px 9px",
    fontSize: 12,
    fontWeight: 700,
    cursor: active ? "pointer" : "default",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
}

function solutionModeToggleButtonStyle(selected: boolean, enabled: boolean): CSSProperties {
  return {
    background: selected ? R.accent : R.surface2,
    color: selected ? "#fffaf0" : enabled ? R.textMid : R.textMuted,
    border: `1px solid ${selected ? R.accent : R.border}`,
    borderRadius: 8,
    padding: "6px 9px",
    fontSize: 12,
    fontWeight: 850,
    cursor: enabled ? "pointer" : "default",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeTextExtractedQuestion(prompt: string): ExtractedQuestion {
  const options = extractMcqOptions(prompt);
  const isMcq = options.length >= 2;
  return {
    debug_report_id: null,
    debug_report_path: null,
    question_text: prompt,
    question_text_raw: prompt,
    question_text_display: prompt,
    question_text_solver: prompt,
    cleaned_prompt: prompt,
    is_projectile_question: true,
    question_type: isMcq ? "mcq" : "subjective",
    options,
    diagram: { present: false, type: "none", entities: [], confidence: 0 },
    givens: [],
    requested_quantity: null,
    suggested_engine_case: null,
    confidence: 0.9,
    needs_review: true,
    warnings: ["Please correct the text if extraction/parsing looks wrong."],
  };
}

function extractMcqOptions(prompt: string) {
  const matches = [...prompt.matchAll(/(?:^|\n)\s*(?:\(([a-dA-D])\)|([a-dA-D])[\).])\s*([^\n]+)/g)];
  if (matches.length < 2) return [];
  return matches
    .sort((a, b) => {
      const left = (a[1] || a[2] || "").toLowerCase().charCodeAt(0);
      const right = (b[1] || b[2] || "").toLowerCase().charCodeAt(0);
      return left - right;
    })
    .map(match => match[3].trim());
}

function authHeaders(auth: AuthState | null): HeadersInit {
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

function jsonHeaders(auth: AuthState | null): HeadersInit {
  return { "Content-Type": "application/json", ...authHeaders(auth) };
}

function loadStoredAuth(): AuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("physica.auth");
    return raw ? JSON.parse(raw) as AuthState : null;
  } catch {
    return null;
  }
}

function storeAuth(auth: AuthState | null) {
  if (typeof window === "undefined") return;
  if (!auth) {
    window.localStorage.removeItem("physica.auth");
    return;
  }
  window.localStorage.setItem("physica.auth", JSON.stringify(auth));
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

export default function Page() {
  // ── Core scene state ──────────────────────
  const [scene, setScene] = useState<PhysicsScene | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [narration, setNarration] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [lessonMode, setLessonMode] = useState<LessonMode>("ready");
  const [replayNonce, setReplayNonce] = useState(0);
  const [extractedQuestion, setExtractedQuestion] = useState<ExtractedQuestion | null>(null);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [solutionPlayback, setSolutionPlayback] = useState<SolutionPlayback | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState("");
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState("");
  const [feedbackNotifications, setFeedbackNotifications] = useState<FeedbackNotification[]>([]);
  const frameRef = useRef<string | null>(null);

  // ── Phase 5: tutor UX state ───────────────
  const [isLessonStarted, setIsLessonStarted] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightStep, setHighlightStep] = useState<number | null>(null);
  // doubtCounts: Record<chapterIndex, count>
  const [doubtCounts, setDoubtCounts] = useState<Record<number, number>>({});
  const [interactiveOptions, setInteractiveOptions] = useState<Array<{ id: string; text: string; type?: string }>>([]);

  // ── Video controller state ──────────────────
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(10);
  const [videoVolume, setVideoVolume] = useState(0.8);
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const videoPlayPauseRef = useRef(false);

  // Race condition guard: ignore stale /teach responses
  const teachRequestId = useRef(0);

  const handleCapture = useCallback((b64: string) => { frameRef.current = b64; }, []);

  useEffect(() => {
    const stored = loadStoredAuth();
    if (!stored) return;
    setAuth(stored);
    fetch(`${API}/auth/me`, { headers: authHeaders(stored) })
      .then(async res => {
        if (!res.ok) throw new Error("Stored auth expired");
      })
      .catch(() => {
        storeAuth(null);
        setAuth(null);
      });
  }, []);

  const refreshFeedbackNotifications = useCallback(async (currentAuth: AuthState | null = auth) => {
    if (!currentAuth) {
      setFeedbackNotifications([]);
      return;
    }
    try {
      const res = await fetch(`${API}/feedback/notifications`, { headers: authHeaders(currentAuth) });
      const data = await res.json();
      if (res.ok) setFeedbackNotifications(data.notifications ?? []);
    } catch {
      // Notification polling must never block solving.
    }
  }, [auth]);

  useEffect(() => {
    refreshFeedbackNotifications(auth);
    if (!auth) return;
    const timer = window.setInterval(() => refreshFeedbackNotifications(auth), 45000);
    return () => window.clearInterval(timer);
  }, [auth, refreshFeedbackNotifications]);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setAuthError("");
    try {
      const res = await fetch(`${API}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: credential }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.detail ?? "Google sign-in failed");
      const nextAuth = data as AuthState;
      storeAuth(nextAuth);
      setAuth(nextAuth);
      await refreshFeedbackNotifications(nextAuth);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google sign-in failed");
    }
  }, [refreshFeedbackNotifications]);

  const handleSignOut = useCallback(async () => {
    const currentAuth = auth;
    storeAuth(null);
    setAuth(null);
    setFeedbackNotifications([]);
    if (!currentAuth) return;
    try {
      await fetch(`${API}/auth/logout`, {
        method: "POST",
        headers: authHeaders(currentAuth),
      });
    } catch {
      // Local sign-out must still succeed if the network call fails.
    }
  }, [auth]);

  const handleReadNotifications = useCallback(async () => {
    if (!auth) return;
    try {
      await fetch(`${API}/feedback/notifications/read`, {
        method: "POST",
        headers: authHeaders(auth),
      });
      setFeedbackNotifications([]);
    } catch {
      // Keep the badge visible if the read call fails.
    }
  }, [auth]);

  useEffect(() => {
    return () => {
      if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
    };
  }, [pendingImageUrl]);

  // Auto-transition to tutor when scene is ready (paused state)
  useEffect(() => {
    if (scene && lessonMode === "ready") {
      const timer = setTimeout(() => {
        setLessonMode("tutor");
        setChapterIndex(0);
        setIsLessonStarted(false);
        if (scene && scene.chapters.length > 0) {
          setHighlightId(getFocusId(scene.chapters[0]));
          setHighlightStep(0);
        }
        setReplayNonce(n => n + 1);
        setNarration("Physics visualization ready. Click 'Start Lesson' on the blackboard to begin the visual story.");
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [scene, lessonMode]);

  // ─────────────────────────────────────────
  // Generate
  // ─────────────────────────────────────────

  const resetLessonState = () => {
    setScene(null); setNarration(""); setCompleted(false);
    setChapterIndex(0); setDoubtCounts({});
    setHighlightId(null); setHighlightStep(null);
    setLessonMode("ready"); setReplayNonce(0);
    setInteractiveOptions([]);
    setIsLessonStarted(false);
    setIsInterrupted(false);
    videoPlayPauseRef.current = false;
  };

  const generateScene = async (prompt: string, image?: File) => {
    setIsGenerating(true);
    setCurrentPrompt(prompt);
    resetLessonState();

    const form = new FormData();
    form.append("prompt", prompt);
    if (image) form.append("image", image);

    try {
      const res = await fetch(`${API}/generate`, { method: "POST", headers: authHeaders(auth), body: form });
      const data = await res.json();
      if (!data.session_id) throw new Error(data.detail ?? "Generation failed");
      setSessionId(data.session_id);
      setScene(data.scene);
      setChapterIndex(0);
      setNarration(data.message);

      // Auto-transition to classroom layout after scene loads
      setTimeout(() => {
        setLessonMode("tutor");
      }, 600);
    } catch (err) {
      setNarration(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (prompt: string, image?: File) => {
    if (!image) {
      if (prompt.trim()) {
        resetLessonState();
        setCurrentPrompt(prompt);
        setPendingImage(null);
        setPendingImageUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return "";
        });
        setSolveResult(null);
        setSolutionPlayback(null);
        setExtractedQuestion(makeTextExtractedQuestion(prompt));
        return;
      }
      await generateScene(prompt);
      return;
    }

    setIsExtracting(true);
    resetLessonState();
    setCurrentPrompt(prompt);
    setPendingImage(image);
    const objectUrl = URL.createObjectURL(image);
    setPendingImageUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });

    const form = new FormData();
    form.append("image", image);
    if (prompt.trim()) form.append("hint", prompt.trim());

    try {
      const res = await fetch(`${API}/extract-question`, { method: "POST", headers: authHeaders(auth), body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Extraction failed");
      setExtractedQuestion(data);
      setSolveResult(null);
      setSolutionPlayback(null);
    } catch (err) {
      setNarration(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
      setExtractedQuestion({
        debug_report_id: null,
        debug_report_path: null,
        question_text: prompt,
        question_text_raw: prompt,
        question_text_display: prompt,
        question_text_solver: prompt,
        cleaned_prompt: prompt,
        is_projectile_question: false,
        question_type: "unknown",
        options: [],
        diagram: { present: false, type: "none", entities: [], confidence: 0 },
        givens: [],
        confidence: 0,
        needs_review: true,
        warnings: [`Extraction failed: ${err instanceof Error ? err.message : "Something went wrong"}`],
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSolveFromReview = async (reviewedPrompt: string) => {
    if (!extractedQuestion) return;
    setIsSolving(true);
    setSolveResult(null);

    try {
      const res = await fetch(`${API}/solve-question`, {
        method: "POST",
        headers: jsonHeaders(auth),
        body: JSON.stringify({
          question_text_solver: reviewedPrompt,
          debug_report_id: extractedQuestion.debug_report_id,
          options: extractedQuestion.options,
          suggested_engine_case: extractedQuestion.suggested_engine_case,
          givens: extractedQuestion.givens,
          requested_quantity: extractedQuestion.requested_quantity,
          diagram: extractedQuestion.diagram,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Solving failed");
      setSolveResult(data);
      if (data.status !== "passed") refreshFeedbackNotifications(auth);
    } catch (err) {
      setSolveResult({
        status: "failed",
        debug_report_id: extractedQuestion.debug_report_id,
        debug_report_path: extractedQuestion.debug_report_path,
        answer: null,
        matched_option: null,
        computed_value: null,
        trace: [],
        walkthrough: null,
        reason: err instanceof Error ? err.message : "Solving failed",
        animation_scene_spec: null,
      });
      return;
    } finally {
      setIsSolving(false);
    }
  };

  const handleGenerateFromReview = async (reviewedPrompt: string) => {
    if (solveResult?.status !== "passed" || !solveResult.walkthrough) return;
    setSolutionPlayback({
      prompt: reviewedPrompt,
      imageUrl: pendingImageUrl,
      imageName: pendingImage?.name ?? "Uploaded image",
      options: extractedQuestion?.options ?? [],
      solveResult,
    });
  };

  const handleBackFromReview = () => {
    setExtractedQuestion(null);
    setSolveResult(null);
    setSolutionPlayback(null);
    setPendingImage(null);
    setPendingImageUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
  };

  // ─────────────────────────────────────────
  // Student message / doubt
  // ─────────────────────────────────────────

  const handleStudentMessage = async (msg: string) => {
    if (!sessionId || isThinking) return;

    // Doubt depth cap
    const currentCount = doubtCounts[chapterIndex] ?? 0;
    if (currentCount >= MAX_DOUBTS_PER_CHAPTER) return;

    // Only increment doubt count and trigger interruption if it's a real doubt/question, 
    // not a click on an interactive choice button or start_tutoring trigger.
    const isChoiceClick = interactiveOptions.some(opt => opt.text.trim().toLowerCase() === msg.trim().toLowerCase()) || msg === "start_tutoring";

    if (!isChoiceClick) {
      setDoubtCounts(prev => ({ ...prev, [chapterIndex]: currentCount + 1 }));
      setIsInterrupted(true);
      videoPlayPauseRef.current = true;
    }

    setIsThinking(true);
    // Tag this request so stale responses can be discarded
    const myId = ++teachRequestId.current;

    try {
      const res = await fetch(`${API}/teach`, {
        method: "POST", headers: jsonHeaders(auth),
        body: JSON.stringify({
          session_id: sessionId,
          student_message: msg,
          current_chapter_index: chapterIndex,
          frame_base64: frameRef.current ?? null,
          interactive_mode: true,
        }),
      });
      const data = await res.json();

      // Discard if a newer request has been issued
      if (myId !== teachRequestId.current) return;

      setNarration(data.narration);
      setCompleted(data.completed ?? false);

      // Set interactive options if available
      if (data.interactive_options && Array.isArray(data.interactive_options)) {
        setInteractiveOptions(data.interactive_options);
      } else {
        setInteractiveOptions([]);
      }

      // Sync active chapter index and replay animation if chapter progressed
      if (data.advance_chapter && data.step_number !== undefined) {
        setChapterIndex(data.step_number);
        setReplayNonce(n => n + 1);

        // Also sync focus highlights for the new chapter
        if (data.highlight_id) {
          setHighlightId(data.highlight_id);
          setHighlightStep(data.step_number);
        } else if (scene) {
          setHighlightId(getFocusId(scene.chapters[data.step_number]));
          setHighlightStep(data.step_number);
        }
      } else {
        // Sync highlights for the current chapter
        if (data.highlight_id) {
          setHighlightId(data.highlight_id);
          setHighlightStep(data.step_number ?? chapterIndex);
        } else {
          setHighlightId(scene ? getFocusId(scene.chapters[chapterIndex]) : null);
          setHighlightStep(chapterIndex);
        }
      }
    } catch (err) {
      if (myId !== teachRequestId.current) return;
      setNarration(`Error: ${err instanceof Error ? err.message : "Something went wrong"}`);
    } finally {
      if (myId === teachRequestId.current) setIsThinking(false);
    }
  };

  // ─────────────────────────────────────────
  // Manual chapter advance
  // ─────────────────────────────────────────

  const handleAdvance = (index?: number) => {
    if (!scene) return;
    const next = index ?? chapterIndex + 1;
    if (next >= 0 && next < scene.chapters.length) {
      setChapterIndex(next);
      setHighlightId(getFocusId(scene.chapters[next]));
      setHighlightStep(next);
      setNarration(buildLessonScene(scene.chapters[next], next).tutorScript);
      setReplayNonce(n => n + 1);
    }
  };

  const startTutor = () => {
    if (!scene) return;
    setIsLessonStarted(true);
    setChapterIndex(0);
    setHighlightId(getFocusId(scene.chapters[0]));
    setHighlightStep(0);
    setReplayNonce(n => n + 1);
    // Kickstart the interactive flow immediately
    handleStudentMessage("start_tutoring");
  };

  // ─────────────────────────────────────────
  // Narration ended (TTS finished)
  // ─────────────────────────────────────────

  const handleNarrationEnded = useCallback(() => {
  }, []);

  // ─────────────────────────────────────────
  // Doubt limit for current chapter
  // ─────────────────────────────────────────

  const doubtLimitReached = (doubtCounts[chapterIndex] ?? 0) >= MAX_DOUBTS_PER_CHAPTER;

  // ─────────────────────────────────────────
  // Video controller handlers
  // ─────────────────────────────────────────

  const handlePlayPause = (playing: boolean) => {
    videoPlayPauseRef.current = playing;
  };

  const handleSeek = (time: number) => {
    setVideoTime(time);
  };

  const handleResumeLesson = () => {
    setIsInterrupted(false);
    videoPlayPauseRef.current = false;
  };

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────

  // Auto-transition: if scene loaded and still in "ready" mode, it will transition to tutor
  // But if we're still loading, show prompt screen
  if (solutionPlayback) {
    return <SolutionPlayer playback={solutionPlayback} onBack={() => setSolutionPlayback(null)} />;
  }

  if (extractedQuestion) {
    return (
      <ExtractionReviewScreen
        extracted={extractedQuestion}
        imageUrl={pendingImageUrl}
        imageName={pendingImage?.name ?? "Typed question"}
        loading={isGenerating}
        solving={isSolving}
        solveResult={solveResult}
        signedIn={Boolean(auth)}
        onSolve={handleSolveFromReview}
        onGenerate={handleGenerateFromReview}
        onBack={handleBackFromReview}
      />
    );
  }

  if (!scene) {
    return (
      <PromptScreen
        onSubmit={handleSubmit}
        loading={isGenerating || isExtracting}
        auth={auth}
        authError={authError}
        notifications={feedbackNotifications}
        onGoogleCredential={handleGoogleCredential}
        onSignOut={handleSignOut}
        onReadNotifications={handleReadNotifications}
      />
    );
  }

  const PANEL_WIDTH = 390;

  return (
    <div style={{
      height: "100vh", width: "100vw", display: "flex",
      flexDirection: "column", overflow: "hidden", background: T.bg,
      animation: lessonMode === "ready" ? "fadeIn 0.4s ease" : "none",
    }}>
      {/* ── Problem statement bar ─────────────── */}
      <div style={{
        padding: "10px 24px",
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: 13, color: T.textMid,
        fontFamily: "-apple-system,sans-serif",
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: T.accent,
          background: `${T.accent}18`, borderRadius: 6,
          padding: "2px 8px", whiteSpace: "nowrap",
          letterSpacing: "0.04em", textTransform: "uppercase",
        }}>Problem</span>
        <span style={{ fontWeight: 500, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentPrompt}
        </span>
      </div>

      {/* ── Two-panel row ─────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* 3D viewer */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <SceneViewer
            scene={scene}
            chapterIndex={chapterIndex}
            onCapture={handleCapture}
            highlightId={highlightId}
            highlightStep={highlightStep}
            autoPlay={isLessonStarted && !isInterrupted}
            replayNonce={replayNonce}
          />

          {/* Back button */}
          <button onClick={() => setScene(null)} style={{
            position: "absolute", top: 16, left: 16, zIndex: 30,
            background: "rgba(255,255,255,0.88)",
            border: `1px solid ${T.border}`,
            borderRadius: 8, padding: "5px 12px",
            fontSize: 11, color: T.textMid, cursor: "pointer",
            fontFamily: "inherit", fontWeight: 500,
            backdropFilter: "blur(12px)",
            boxShadow: T.shadowSm,
            marginTop: 28,
          }}>← New problem</button>
        </div>

        {/* ── Collapsible panel toggle ────────── */}
        <button
          onClick={() => setIsChatCollapsed(c => !c)}
          title={isChatCollapsed ? "Open tutor" : "Collapse tutor"}
          style={{
            position: "absolute",
            // Sits at the left edge of the panel
            right: isChatCollapsed ? 0 : PANEL_WIDTH,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 40,
            width: 22, height: 56,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRight: isChatCollapsed ? `1px solid ${T.border}` : "none",
            borderRadius: isChatCollapsed ? "6px 0 0 6px" : "6px 0 0 6px",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.textMuted, fontSize: 11,
            transition: "right 0.3s ease",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.2)",
          }}
        >
          {isChatCollapsed ? "⟩" : "⟨"}
        </button>

        {/* ── Teacher panel ─────────────────────── */}
        <div style={{
          width: isChatCollapsed ? 0 : PANEL_WIDTH,
          flexShrink: 0,
          overflow: "hidden",
          borderLeft: `1px solid ${T.border}`,
          background: T.surface,
          display: "flex", flexDirection: "column",
          transition: "width 0.3s ease",
        }}>
          {/* Prevent invisible panel from receiving pointer events when collapsed */}
          <div style={{
            width: PANEL_WIDTH, height: "100%",
            display: "flex", flexDirection: "column",
            visibility: isChatCollapsed ? "hidden" : "visible",
            transition: "visibility 0.3s",
          }}>
            <TeacherPanel
              narration={narration}
              isThinking={isThinking}
              chapters={scene.chapters}
              currentChapterIndex={chapterIndex}
              isLessonStarted={isLessonStarted}
              onStartTutor={startTutor}
              onStudentMessage={handleStudentMessage}
              onAdvance={handleAdvance}
              onReplayScene={() => setReplayNonce(n => n + 1)}
              onNarrationEnded={handleNarrationEnded}
              completed={completed}
              doubtLimitReached={doubtLimitReached}
              interactiveOptions={interactiveOptions}
              onInterrupt={() => setIsInterrupted(true)}
              physicsT={videoTime / Math.max(videoDuration, 1)}
            />
          </div>
        </div>
      </div>

      {/* ── Unified Video Controller (bottom) ────── */}
      {isLessonStarted && (
        <VideoController
          isPlaying={videoPlayPauseRef.current && !isInterrupted}
          onPlayPause={handlePlayPause}
          currentTime={videoTime}
          duration={videoDuration}
          onSeek={handleSeek}
          volume={videoVolume}
          onVolumeChange={setVideoVolume}
          playbackRate={videoPlaybackRate}
          onPlaybackRateChange={setVideoPlaybackRate}
          isInterrupted={isInterrupted}
          onResume={handleResumeLesson}
        />
      )}
    </div>
  );
}
