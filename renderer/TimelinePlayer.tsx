"use client";

import React, { useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { TimelineData, TimelineBlock, CameraViewConfig } from "./types";
import { CAMERA_VIEWS, DEFAULT_CAMERA_VIEW } from "./cameraViews";
import { PRIMITIVE_HANDLERS } from "./primitiveHandlers";

// ---------------------------------------------------------------------------
// Camera rig — smoothly transitions to new config whenever camera_view changes
// ---------------------------------------------------------------------------

function CameraRig({ config }: { config: CameraViewConfig }) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    camera.position.set(...config.position);
    if ("fov" in camera) {
      (camera as THREE.PerspectiveCamera).fov = config.fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    if (controlsRef.current) {
      controlsRef.current.target.set(...config.target);
      controlsRef.current.update();
    }
  }, [config.position.join(","), config.target.join(","), config.fov]);

  return (
    <OrbitControls
      ref={controlsRef}
      target={new THREE.Vector3(...config.target)}
      enableDamping
      dampingFactor={0.08}
      enablePan
      enableZoom
      enableRotate
    />
  );
}

// ---------------------------------------------------------------------------
// Active primitive renderer — dispatches to handler or errors loudly
// ---------------------------------------------------------------------------

function PrimitiveRenderer({
  activeBlock,
  localProgress,
}: {
  activeBlock: TimelineBlock | null;
  localProgress: number;
}) {
  if (!activeBlock) return null;

  const Handler = PRIMITIVE_HANDLERS[activeBlock.primitive_type];
  if (!Handler) {
    // Loud failure — never silently skip unknown primitives
    console.error(
      `[V2Renderer] ❌ UNKNOWN PRIMITIVE: "${activeBlock.primitive_type}". Add it to primitiveHandlers/index.tsx`
    );
    return null;
  }

  return <Handler progress={localProgress} block={activeBlock} />;
}

// ---------------------------------------------------------------------------
// TimelinePlayer
// ---------------------------------------------------------------------------

interface TimelinePlayerProps {
  timelineData: TimelineData;
  isPlaying?: boolean;
  onBlockChange?: (block: TimelineBlock | null) => void;
}

export default function TimelinePlayer({
  timelineData,
  isPlaying = true,
  onBlockChange,
}: TimelinePlayerProps) {
  const [masterTime, setMasterTime] = useState(0);
  const [isPaused, setIsPaused] = useState(!isPlaying);
  const clockRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);

  const totalDuration =
    timelineData.timeline.length > 0
      ? timelineData.timeline[timelineData.timeline.length - 1].end_sec
      : 0;

  // Find the active block
  const activeBlock =
    timelineData.timeline.find(
      (b) => masterTime >= b.start_sec && masterTime < b.end_sec
    ) ?? timelineData.timeline[timelineData.timeline.length - 1] ?? null;

  const localProgress = activeBlock
    ? Math.min(
        1,
        Math.max(
          0,
          (masterTime - activeBlock.start_sec) /
            (activeBlock.end_sec - activeBlock.start_sec)
        )
      )
    : 0;

  const cameraConfig =
    CAMERA_VIEWS[activeBlock?.camera_view ?? ""] ?? DEFAULT_CAMERA_VIEW;

  // rAF-based master clock
  useEffect(() => {
    const tick = (timestamp: number) => {
      if (!isPaused) {
        if (lastTimestampRef.current !== null) {
          const dt = (timestamp - lastTimestampRef.current) / 1000;
          setMasterTime((prev) => Math.min(totalDuration, prev + dt));
        }
        lastTimestampRef.current = timestamp;
      } else {
        lastTimestampRef.current = null;
      }
      clockRef.current = requestAnimationFrame(tick);
    };
    clockRef.current = requestAnimationFrame(tick);
    return () => {
      if (clockRef.current) cancelAnimationFrame(clockRef.current);
    };
  }, [isPaused, totalDuration]);

  // Notify parent on block change
  const prevBlockRef = useRef<string | null>(null);
  useEffect(() => {
    const blockId = activeBlock?.primitive_type ?? null;
    if (blockId !== prevBlockRef.current) {
      prevBlockRef.current = blockId;
      onBlockChange?.(activeBlock);
    }
  }, [activeBlock?.primitive_type]);

  const progressPct = totalDuration > 0 ? (masterTime / totalDuration) * 100 : 0;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0d0d1a" }}>
      {/* ── 3D Canvas ───────────────────────────────────────────────────── */}
      <Canvas
        shadows
        camera={{ position: cameraConfig.position, fov: cameraConfig.fov }}
        gl={{ antialias: true }}
      >
        <CameraRig config={cameraConfig} />
        <color attach="background" args={["#0d0d1a"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 16, 10]} intensity={1.2} castShadow />
        <directionalLight position={[-8, 5, -4]} intensity={0.3} color="#58c4dd" />

        {/* Persistent ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
        <gridHelper args={[60, 30, "#252540", "#252540"]} position={[0, 0.01, 0]} />

        <PrimitiveRenderer activeBlock={activeBlock} localProgress={localProgress} />
      </Canvas>

      {/* ── Narration bar ───────────────────────────────────────────────── */}
      {activeBlock?.narration && (
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(13,13,26,0.88)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(88,196,221,0.25)",
            borderRadius: 12,
            padding: "14px 24px",
            color: "#e8e8f0",
            maxWidth: "68%",
            textAlign: "center",
            fontSize: "1rem",
            lineHeight: 1.55,
            fontFamily: "'Inter', sans-serif",
            pointerEvents: "none",
            boxShadow: "0 4px 32px rgba(88,196,221,0.08)",
          }}
        >
          {activeBlock.narration}
        </div>
      )}

      {/* ── Equation / overlay pills ────────────────────────────────────── */}
      {activeBlock?.overlays && activeBlock.overlays.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "center",
          }}
        >
          {activeBlock.overlays.map((overlay, i) => {
            const isAnswer = !overlay.startsWith("equation:");
            return (
              <div
                key={i}
                style={{
                  background: isAnswer
                    ? "rgba(74,222,128,0.15)"
                    : "rgba(88,196,221,0.12)",
                  border: `1px solid ${isAnswer ? "rgba(74,222,128,0.5)" : "rgba(88,196,221,0.4)"}`,
                  borderRadius: 8,
                  padding: "8px 18px",
                  color: isAnswer ? "#4ade80" : "#58c4dd",
                  fontFamily: "monospace",
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  pointerEvents: "none",
                  boxShadow: isAnswer
                    ? "0 0 24px rgba(74,222,128,0.15)"
                    : "0 0 16px rgba(88,196,221,0.1)",
                }}
              >
                {isAnswer ? overlay : overlay.replace("equation:", "Eq: ")}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Progress bar ────────────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: 40,
          background: "rgba(13,13,26,0.9)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
        }}
      >
        {/* Play/Pause */}
        <button
          onClick={() => setIsPaused((p) => !p)}
          style={{
            background: "rgba(88,196,221,0.15)",
            border: "1px solid rgba(88,196,221,0.4)",
            borderRadius: 6,
            color: "#58c4dd",
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {isPaused ? "▶ Play" : "⏸ Pause"}
        </button>

        {/* Scrubber */}
        <div style={{ flex: 1, position: "relative" }}>
          <input
            type="range"
            min={0}
            max={totalDuration}
            step={0.1}
            value={masterTime}
            onChange={(e) => {
              setMasterTime(Number(e.target.value));
              lastTimestampRef.current = null;
            }}
            style={{ width: "100%", accentColor: "#58c4dd", cursor: "pointer" }}
          />
          {/* Block markers */}
          {timelineData.timeline.map((block) => (
            <div
              key={block.start_sec}
              title={block.primitive_type}
              style={{
                position: "absolute",
                left: `${(block.start_sec / totalDuration) * 100}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#58c4dd",
                opacity: 0.6,
                pointerEvents: "none",
              }}
            />
          ))}
        </div>

        {/* Time display */}
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            color: "#a0a0c0",
            minWidth: 80,
            textAlign: "right",
          }}
        >
          {masterTime.toFixed(1)}s / {totalDuration.toFixed(0)}s
        </span>

        {/* Active primitive tag */}
        {activeBlock && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "#4ade80",
              background: "rgba(74,222,128,0.1)",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: 4,
              padding: "2px 8px",
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeBlock.primitive_type}
          </span>
        )}
      </div>
    </div>
  );
}
