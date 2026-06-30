"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chapter } from "./SceneViewer";
import { buildLessonScene } from "@/utils/lessonScript";

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface TeacherPanelProps {
  narration: string;
  isThinking: boolean;
  chapters: Chapter[];
  currentChapterIndex: number;
  isLessonStarted: boolean;
  onStartTutor?: () => void;
  onStudentMessage: (msg: string) => void;
  onAdvance?: () => void;
  onReplayScene?: () => void;
  onNarrationEnded: () => void;
  onInterrupt?: () => void;       // tells page.tsx to pause animation
  physicsT: number;               // 0-1 live animation progress for telemetry
  completed: boolean;
  doubtLimitReached?: boolean;
  interactiveOptions?: Array<{ id: string; text: string; type?: string }>;
}

// ─────────────────────────────────────────────
// Voice hook
// ─────────────────────────────────────────────

function pickVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter(v => v.lang.toLowerCase().startsWith("en"));
  for (const name of ["Samantha","Karen","Tessa","Moira","Jenny","Aria","Google UK English Female","Microsoft Aria"]) {
    const v = english.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
    if (v) return v;
  }
  return english.find(v => /female|natural|premium|enhanced/i.test(v.name)) ?? english[0] ?? null;
}

function useTeacherVoice(onEnded: () => void) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => { voiceRef.current = pickVoice(window.speechSynthesis.getVoices()); };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) {
      onEnded(); return;
    }
    window.speechSynthesis.cancel();
    if (mutedRef.current) { onEnded(); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.voice = voiceRef.current;
    utt.rate = 0.93; utt.pitch = 1.05; utt.volume = 1;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend = () => { setIsSpeaking(false); onEnded(); };
    utt.onerror = () => { setIsSpeaking(false); onEnded(); };
    window.speechSynthesis.speak(utt);
  }, [onEnded]);

  return { isSpeaking, muted, setMuted, speak, cancel };
}

// ─────────────────────────────────────────────
// Tutor Avatar SVG — Prof. Newton the Owl
// ─────────────────────────────────────────────

function TutorAvatar({ state }: { state: "idle" | "talking" | "listening" }) {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 130);
    }, 3500 + Math.random() * 1500);
    return () => clearInterval(blinkInterval);
  }, []);

  useEffect(() => {
    if (state !== "talking") { setMouthOpen(false); return; }
    const talkInterval = setInterval(() => {
      setMouthOpen(prev => !prev);
    }, 220);
    return () => clearInterval(talkInterval);
  }, [state]);

  const cls = state === "talking" ? "tutor-avatar talking"
            : state === "listening" ? "tutor-avatar listening"
            : "tutor-avatar";

  const eyeScaleY = blink ? 0.06 : 1;

  return (
    <div className={cls} style={{ width: 96, height: 108, flexShrink: 0, userSelect: "none" }}>
      <svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%", overflow: "visible" }}>
        {/* Graduation gown body */}
        <ellipse cx="50" cy="95" rx="29" ry="20" fill="#1e293b"/>
        <ellipse cx="50" cy="87" rx="24" ry="17" fill="#312e81"/>
        {/* White collar */}
        <polygon points="43,71 50,78 57,71" fill="#f8fafc" opacity="0.9"/>

        {/* Head */}
        <circle cx="50" cy="43" r="27" fill="#d4a574"/>
        {/* Ear tufts */}
        <polygon points="26,22 18,4 34,18" fill="#c4956a"/>
        <polygon points="74,22 82,4 66,18" fill="#c4956a"/>

        {/* Eye whites */}
        <ellipse cx="37" cy="39" rx="9" ry="10" fill="white"/>
        <ellipse cx="63" cy="39" rx="9" ry="10" fill="white"/>
        <ellipse cx="37" cy="39" rx="9" ry="10" stroke="#c4956a" strokeWidth="1.5" fill="none"/>
        <ellipse cx="63" cy="39" rx="9" ry="10" stroke="#c4956a" strokeWidth="1.5" fill="none"/>

        {/* Left pupil (blinks) */}
        <g style={{ transform: `scaleY(${eyeScaleY})`, transformOrigin: "37px 39px", transition: "transform 0.05s" }}>
          <circle cx="37" cy="39" r="5" fill="#1a0a2e"/>
          <circle cx="39" cy="37" r="1.5" fill="white"/>
        </g>
        {/* Right pupil */}
        <g style={{ transform: `scaleY(${eyeScaleY})`, transformOrigin: "63px 39px", transition: "transform 0.05s" }}>
          <circle cx="63" cy="39" r="5" fill="#1a0a2e"/>
          <circle cx="65" cy="37" r="1.5" fill="white"/>
        </g>

        {/* Beak */}
        <polygon points="50,47 44,55 56,55" fill="#F59E0B"/>

        {/* Mouth */}
        <ellipse
          cx="50" cy="59"
          rx="6.5"
          ry={mouthOpen ? 3.5 : state === "listening" ? 2.5 : 1.5}
          fill="#7c3aed"
          opacity="0.88"
          style={{ transition: "ry 0.12s ease" }}
        />

        {/* Graduation cap */}
        <rect x="27" y="16" width="46" height="6" rx="2" fill="#0f172a"/>
        <rect x="34" y="10" width="32" height="7" rx="2" fill="#1e293b"/>
        <line x1="73" y1="19" x2="82" y2="32" stroke="#fbbf24" strokeWidth="2.5"/>
        <circle cx="82" cy="33.5" r="3.5" fill="#fbbf24"/>

        {/* Bowtie */}
        <polygon points="40,73 50,78 40,83" fill="#dc2626"/>
        <polygon points="60,73 50,78 60,83" fill="#dc2626"/>
        <circle cx="50" cy="78" r="3.5" fill="#b91c1c"/>

        {/* Listening bubbles */}
        {state === "listening" && <>
          <circle cx="76" cy="27" r="2.5" fill="rgba(109,212,238,0.5)"/>
          <circle cx="83" cy="20" r="4" fill="rgba(109,212,238,0.4)"/>
          <circle cx="91" cy="13" r="5.5" fill="rgba(109,212,238,0.3)"/>
        </>}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────
// Chalk Telemetry — live x,y,Vx,Vy
// ─────────────────────────────────────────────

const SCALE = 10;
const SCENE_G = 1.0;

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function ChalkTelemetry({ chapter, t }: { chapter: Chapter; t: number }) {
  const ball = chapter.objects.find(
    o => o.type === "sphere" && Array.isArray(o.path) && (o.path?.length ?? 0) >= 2
  );
  if (!ball?.path || ball.path.length < 2) return null;

  const path = ball.path as [number, number, number][];
  const raw = t * (path.length - 1);
  const lo = Math.min(Math.floor(raw), path.length - 2);
  const hi = lo + 1;
  const alpha = raw - lo;
  const pos = lerp3(path[lo], path[hi], alpha);

  const ip = (ball as any).physics_intent?.params ?? {};
  const v0Raw = ip.velocity;
  const v0s: [number, number, number] | null =
    Array.isArray(v0Raw) && v0Raw.length >= 3
      ? [Number(v0Raw[0]), Number(v0Raw[1]), Number(v0Raw[2])]
      : null;

  const T = ip.T != null ? Number(ip.T) : null;
  const tReal = T != null ? t * T : null;

  const vx_r = v0s ? v0s[0] * SCALE : null;
  const vy_r = v0s && tReal != null ? (v0s[1] - SCENE_G * tReal) * SCALE : null;
  const spd  = vx_r != null && vy_r != null ? Math.sqrt(vx_r * vx_r + vy_r * vy_r) : null;

  const rows: { label: string; val: string; color: string }[] = [
    { label: "x", val: (pos[0] * SCALE).toFixed(1) + " m", color: "#f0ece0" },
    { label: "y", val: (pos[1] * SCALE).toFixed(1) + " m", color: "#f0ece0" },
    ...(vx_r != null ? [{ label: "Vₓ", val: vx_r.toFixed(1) + " m/s", color: "#6dd4ee" }] : []),
    ...(vy_r != null ? [{ label: "Vᵧ", val: vy_r.toFixed(1) + " m/s", color: "#f5e642" }] : []),
    ...(spd != null ? [{ label: "|v|", val: spd.toFixed(1) + " m/s", color: "#fc8ab0" }] : []),
    ...(T != null && tReal != null ? [{ label: "t", val: tReal.toFixed(2) + " s", color: "#b8f0c0" }] : []),
  ];

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        fontFamily: "var(--font-chalk)", fontSize: 10.5,
        color: "rgba(240,236,224,0.45)", letterSpacing: "0.14em",
        textTransform: "uppercase", marginBottom: 5,
      }}>
        ✦ Live telemetry
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px" }}>
        {rows.map(r => (
          <div key={r.label} style={{
            fontFamily: "var(--font-chalk)", fontSize: 14,
            color: r.color, textShadow: `0 0 8px ${r.color}55`,
          }}>
            <span style={{ opacity: 0.6 }}>{r.label} = </span>
            <strong>{r.val}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Chalkboard Formula Panel
// ─────────────────────────────────────────────

function ChalkFormulaBoard({ formula, derivation, title }: {
  formula: string; derivation: string; title: string;
}) {
  return (
    <div className="wood-frame chalkboard" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Chapter label */}
      <div style={{
        fontFamily: "var(--font-chalk)", fontSize: 16,
        color: "rgba(240,236,224,0.75)",
        paddingBottom: 8,
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}>
        {title}
      </div>

      {/* Formula */}
      {formula && (
        <div style={{ fontFamily: "var(--font-chalk)", fontSize: 17, lineHeight: 1.65, color: "#f5e642", textShadow: "0 0 12px rgba(245,230,66,0.45)" }}>
          {formula}
        </div>
      )}

      {/* Derivation */}
      {derivation && (
        <div className="chalk-step" style={{ fontSize: 13, lineHeight: 1.75, color: "#b8f0c0" }}>
          {derivation}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main TeacherPanel export
// ─────────────────────────────────────────────

export default function TeacherPanel({
  narration, isThinking, chapters, currentChapterIndex,
  isLessonStarted, onStartTutor,
  onStudentMessage, onAdvance, onReplayScene, onNarrationEnded, onInterrupt,
  physicsT, completed, doubtLimitReached, interactiveOptions,
}: TeacherPanelProps) {
  const [input, setInput] = useState("");
  const [isInterrupted, setIsInterrupted] = useState(false);
  const lastSpoken = useRef("");

  const chapter = chapters[currentChapterIndex];
  const lesson  = chapter ? buildLessonScene(chapter, currentChapterIndex) : null;

  // Pull formula/derivation: prefer backend-supplied, else lesson helper
  const formula    = (chapter as any)?.formula    ?? lesson?.formula    ?? "";
  const derivation = (chapter as any)?.derivation ?? lesson?.derivation ?? "";

  const handleTTSEnd = useCallback(() => {
    onNarrationEnded();
  }, [onNarrationEnded]);

  const { isSpeaking, muted, setMuted, speak, cancel } = useTeacherVoice(handleTTSEnd);

  // ── Speech Recognition (Voice Input) ───────
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = "en-US";

        rec.onstart = () => {
          setIsListening(true);
          // Interrupt the tutor if speaking
          if (window.speechSynthesis && window.speechSynthesis.speaking) {
            cancel();
            setIsInterrupted(true);
            onInterrupt?.();
          }
        };

        rec.onresult = (event: any) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            setInput(finalTranscript);
            // Automatically submit spoken response
            setTimeout(() => {
              cancel();
              setIsInterrupted(true);
              onInterrupt?.();
              onStudentMessage(finalTranscript.trim());
              setInput("");
            }, 600);
          } else {
            setInput(interimTranscript);
          }
        };

        rec.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
        };

        rec.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = rec;
      }
    }
  }, [cancel, onInterrupt, onStudentMessage]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Try Chrome or Safari.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setInput("");
      recognitionRef.current.start();
    }
  };

  // Text changes - trigger instant interruption
  const handleInputChange = (val: string) => {
    setInput(val);
    if (val.trim() && isSpeaking) {
      cancel();
      setIsInterrupted(true);
      onInterrupt?.();
    }
  };

  // Auto-speak narration whenever it changes (only when lesson has started!)
  useEffect(() => {
    if (!narration || narration === lastSpoken.current || !isLessonStarted) return;
    lastSpoken.current = narration;
    setIsInterrupted(false);
    speak(narration);
  }, [narration, speak, isLessonStarted]);

  // Reset on chapter change
  useEffect(() => {
    setIsInterrupted(false);
    lastSpoken.current = "";
  }, [currentChapterIndex]);

  const avatarState: "idle" | "talking" | "listening" =
    isThinking      ? "listening"
    : isListening   ? "listening"
    : isInterrupted ? "listening"
    : isSpeaking    ? "talking"
    : "idle";

  const sendDoubt = () => {
    if (!input.trim() || isThinking || completed) return;
    cancel();
    setIsInterrupted(true);
    onInterrupt?.();
    onStudentMessage(input.trim());
    setInput("");
  };

  const resumeLesson = () => {
    setIsInterrupted(false);
    if (narration) speak(narration);
  };

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: "#181c24", color: "#d0d5e8",
      fontFamily: "var(--font-ui)", overflow: "hidden",
    }}>

      {/* ── Header ──────────────────────────────── */}
      <div style={{
        padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        background: "rgba(255,255,255,0.02)",
      }}>
        <TutorAvatar state={avatarState} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e4ef", letterSpacing: "-0.01em" }}>
            Prof. Newton
          </div>
          <div style={{ fontSize: 11, color: "#636780", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: isSpeaking ? "#4ade80" : isListening ? "#fc6255" : isInterrupted ? "#f5e642" : isThinking ? "#58c4dd" : "#4b5263",
              boxShadow: isSpeaking ? "0 0 8px #4ade80" : isListening ? "0 0 8px #fc6255" : isInterrupted ? "0 0 6px #f5e642" : "none",
              animation: isSpeaking || isListening ? "scrubberPulse 1s ease infinite" : "none",
            }}/>
            <span>
              {isListening   ? "Listening to your voice…"
               : isSpeaking  ? "Teaching…"
               : isInterrupted ? "Class paused…"
               : isThinking  ? "Thinking…"
               : completed   ? "Lesson complete ✓"
               : !isLessonStarted ? "Lesson built" : "Ready"}
            </span>
          </div>
        </div>

        <button
          onClick={() => { setMuted(v => !v); if (!muted) cancel(); }}
          style={{
            background: muted ? "rgba(252,130,86,0.1)" : "rgba(74,222,128,0.08)",
            border: `1px solid ${muted ? "rgba(252,130,86,0.25)" : "rgba(74,222,128,0.2)"}`,
            borderRadius: 8, padding: "5px 9px",
            color: muted ? "#fc8256" : "#4ade80",
            fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.2s",
          }}
        >
          {muted ? "🔇 Muted" : "🔊 Sound"}
        </button>
      </div>

      {/* ── Paused Start Lesson Screen ─────────── */}
      {!isLessonStarted && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "36px 20px", gap: 16, background: "rgba(255,255,255,0.015)",
          border: "1px solid rgba(255,255,255,0.04)", borderRadius: 12, margin: "16px 14px",
          boxShadow: "inset 0 0 20px rgba(0,0,0,0.2)",
          animation: "fadeSlideUp 0.4s ease",
        }}>
          <div style={{ fontSize: 44 }}>🎓</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8f0", textAlign: "center", fontFamily: "var(--font-ui)" }}>
            Welcome to Prof. Newton's Classroom
          </div>
          <div style={{ fontSize: 12.5, color: "#7880a0", textAlign: "center", lineHeight: 1.6, maxWidth: 280 }}>
            An interactive, story-driven physics simulation has been built for you. Let's see the concepts in action!
          </div>
          <button onClick={onStartTutor} className="resume-pill" style={{
            background: "rgba(88,196,221,0.14)",
            border: "1px solid rgba(88,196,221,0.35)",
            borderRadius: 24, padding: "10px 30px",
            color: "#58c4dd", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 0 16px rgba(88,196,221,0.2)",
            fontFamily: "inherit",
            transition: "all 0.2s",
            marginTop: 8,
          }}>
            ▶ Start Lesson
          </button>
        </div>
      )}

      {/* ── Current narration speech bubble ─────── */}
      {isLessonStarted && narration && !isInterrupted && (
        <div style={{
          margin: "12px 14px 0", flexShrink: 0,
          padding: "11px 13px",
          background: "rgba(88,196,221,0.04)",
          border: "1px solid rgba(88,196,221,0.12)",
          borderRadius: 12,
          position: "relative",
          animation: "fadeSlideUp 0.35s ease",
        }}>
          <div style={{ fontSize: 10, color: "#58c4dd", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
            Prof. Newton
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#c4c9e0", whiteSpace: "pre-line" }}>
            {narration}
          </div>
        </div>
      )}

      {/* ── Scrollable body ─────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Chalkboard */}
        {isLessonStarted && chapter && (
          <>
            <ChalkFormulaBoard
              title={chapter.title}
              formula={formula}
              derivation={derivation}
            />
            {/* Live telemetry appended below chalkboard */}
            {physicsT > 0.01 && physicsT < 0.999 && (
              <div style={{
                padding: "10px 14px",
                background: "rgba(45,90,61,0.35)",
                border: "1px solid rgba(109,212,238,0.15)",
                borderRadius: 10,
              }}>
                <ChalkTelemetry chapter={chapter} t={physicsT} />
              </div>
            )}
          </>
        )}

        {/* Interactive Option Buttons */}
        {isLessonStarted && interactiveOptions && interactiveOptions.length > 0 && !isThinking && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            marginTop: 4, animation: "fadeSlideUp 0.3s ease"
          }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: "#58c4dd",
              letterSpacing: "0.08em", textTransform: "uppercase",
              opacity: 0.8
            }}>Interactive Choice</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {interactiveOptions.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    cancel();
                    onStudentMessage(opt.text);
                  }}
                  style={{
                    width: "100%", textAlign: "left",
                    background: "rgba(184,240,192,0.05)",
                    border: "1px solid rgba(184,240,192,0.18)",
                    borderRadius: 10, padding: "10px 14px",
                    color: "#b8f0c0", fontSize: 13.5, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "all 0.2s",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "rgba(184,240,192,0.12)";
                    e.currentTarget.style.borderColor = "#b8f0c0";
                    e.currentTarget.style.boxShadow = "0 0 12px rgba(184,240,192,0.25)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(184,240,192,0.05)";
                    e.currentTarget.style.borderColor = "rgba(184,240,192,0.18)";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.1)";
                  }}
                >
                  ✦ {opt.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Thinking spinner */}
        {isThinking && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 13px",
            background: "rgba(88,196,221,0.05)",
            border: "1px solid rgba(88,196,221,0.12)",
            borderRadius: 10,
            animation: "fadeSlideUp 0.3s ease",
          }}>
            <div style={{
              width: 14, height: 14, flexShrink: 0,
              border: "2px solid rgba(88,196,221,0.25)",
              borderTopColor: "#58c4dd", borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}/>
            <span style={{ fontSize: 13, color: "#58c4dd" }}>
              {isInterrupted ? "Answering your doubt…" : "Thinking…"}
            </span>
          </div>
        )}

        {/* Doubt reply panel (after interrupt + response) */}
        {isLessonStarted && isInterrupted && narration && !isThinking && (
          <div style={{
            padding: "12px 14px",
            background: "rgba(245,230,66,0.05)",
            border: "1px solid rgba(245,230,66,0.2)",
            borderRadius: 10,
            animation: "fadeSlideUp 0.4s ease",
          }}>
            <div style={{ fontSize: 10, color: "#f5e642", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7 }}>
              Tutor reply
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#d0d5e8", whiteSpace: "pre-line" }}>
              {narration}
            </div>
            <button onClick={resumeLesson} className="resume-pill" style={{
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 7,
              background: "rgba(74,222,128,0.1)",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: 20, padding: "7px 18px",
              color: "#4ade80", fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}>
              ▶ Resume Lesson
            </button>
          </div>
        )}

        {/* Completed */}
        {completed && (
          <div style={{
            padding: "18px 14px", textAlign: "center",
            background: "rgba(74,222,128,0.06)",
            border: "1px solid rgba(74,222,128,0.18)",
            borderRadius: 12,
            animation: "fadeSlideUp 0.5s ease",
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎓</div>
            <div style={{ fontSize: 15, color: "#4ade80", fontWeight: 700 }}>Lesson complete!</div>
            <div style={{ fontSize: 12, color: "#636780", marginTop: 5 }}>
              You've worked through all scenes.
            </div>
          </div>
        )}
      </div>

      {/* ── Doubt input footer ───────────────────── */}
      {isLessonStarted && (
        <div style={{
          padding: "10px 14px 12px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
          background: "rgba(255,255,255,0.015)",
        }}>
          <div style={{
            display: "flex", gap: 8, alignItems: "center",
          }}>
            {/* Microphone Button */}
            <button
              onClick={toggleListening}
              title={isListening ? "Stop listening" : "Talk to Prof. Newton"}
              style={{
                width: 40, height: 40, borderRadius: "50%",
                background: isListening ? "rgba(252,98,85,0.2)" : "rgba(88,196,221,0.08)",
                border: `1px solid ${isListening ? "#fc6255" : "rgba(88,196,221,0.25)"}`,
                color: isListening ? "#fc6255" : "#58c4dd",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.25s",
                boxShadow: isListening ? "0 0 14px rgba(252,98,85,0.4)" : "none",
                animation: isListening ? "pulseGlow 1.5s ease infinite" : "none",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill={isListening ? "currentColor" : "none"}/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
            </button>

            {/* Glowing input border box */}
            <div style={{
              display: "flex", gap: 8, alignItems: "center", flex: 1,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${isListening ? "rgba(252,98,85,0.5)" : isInterrupted ? "rgba(245,230,66,0.35)" : "rgba(255,255,255,0.07)"}`,
              borderRadius: 10, padding: "8px 10px",
              boxShadow: isListening ? "0 0 10px rgba(252,98,85,0.15)" : "none",
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}>
              <input
                value={input}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendDoubt()}
                placeholder={
                  completed ? "Lesson done ✓"
                  : isThinking ? "Thinking…"
                  : isListening ? "Listening... Speak now!"
                  : "Ask a doubt anytime…"
                }
                disabled={completed || isThinking}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#c4c9e0", fontSize: 13, fontFamily: "var(--font-ui)",
                }}
              />
              <button
                onClick={sendDoubt}
                disabled={!input.trim() || isThinking || completed}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: "none",
                  background: input.trim() && !isThinking && !completed
                    ? "rgba(88,196,221,0.85)" : "rgba(255,255,255,0.05)",
                  color: input.trim() && !isThinking && !completed
                    ? "#0f1420" : "rgba(255,255,255,0.25)",
                  cursor: input.trim() && !isThinking && !completed ? "pointer" : "default",
                  fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}
              >→</button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#454a60", marginTop: 6, textAlign: "center" }}>
            {isListening ? "Tutor is listening... Speak clearly." : "Interrupt anytime — Prof. Newton will answer & resume"}
          </div>
        </div>
      )}
    </div>
  );
}
