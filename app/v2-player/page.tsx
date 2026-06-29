"use client";

import React, { useState } from "react";
import TimelinePlayer from "../../renderer/TimelinePlayer";
import { TimelineData, TimelineBlock } from "../../renderer/types";

// ---------------------------------------------------------------------------
// Mock Timeline JSON — output from Milestone 1 backend test
// ---------------------------------------------------------------------------
const MOCK_TIMELINE: TimelineData = {
  timeline: [
    {
      start_sec: 0,
      end_sec: 6,
      primitive_type: "show_setup",
      camera_view: "wide_incline",
      narration:
        "Let's take a look at the initial setup. Particle P will be launched perpendicular to the smooth inclined plane at 60°, while particle Q is released from rest at the same point.",
      overlays: [],
    },
    {
      start_sec: 6,
      end_sec: 14,
      primitive_type: "play_raw_motion",
      camera_view: "wide_incline",
      narration:
        "Watch the motion unfold — P flies away from the plane while Q slides down. They will meet again at t = 4 seconds.",
      overlays: [],
    },
    {
      start_sec: 14,
      end_sec: 21,
      primitive_type: "show_equation",
      camera_view: "equation_view",
      narration:
        "The key insight is that both particles have the same acceleration along the incline. So we only need to track P's motion perpendicular to the incline.",
      overlays: ["equation:perpendicular_displacement"],
    },
    {
      start_sec: 21,
      end_sec: 28,
      primitive_type: "substitute_values",
      camera_view: "equation_view",
      narration:
        "At the collision, P returns to the incline — so its perpendicular displacement is zero. This gives us: 0 = ut − ½·g·cos θ·t²",
      overlays: ["equation:collision_condition"],
    },
    {
      start_sec: 28,
      end_sec: 35,
      primitive_type: "substitute_values",
      camera_view: "equation_view",
      narration:
        "Solving for u: u = ½ · g · cos 60° · t = ½ × 10 × 0.5 × 4 = 10 m/s.",
      overlays: ["equation:speed_result"],
    },
    {
      start_sec: 35,
      end_sec: 40,
      primitive_type: "final_answer",
      camera_view: "final_view",
      narration:
        "The initial projection speed of particle P is 10 m/s. Notice how the perpendicular-return condition gave us the answer cleanly!",
      overlays: ["u = 10 m/s"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function V2PlayerPage() {
  const [activeBlock, setActiveBlock] = useState<TimelineBlock | null>(null);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d0d1a",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 20px",
          background: "rgba(13,13,26,0.95)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 8px #4ade80",
            }}
          />
          <span style={{ color: "#e8e8f0", fontWeight: 700, fontSize: 15 }}>
            V2 Timeline Player
          </span>
          <span
            style={{
              color: "#a0a0c0",
              fontSize: 12,
              background: "rgba(255,255,255,0.06)",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            Projectile Perpendicular to Incline — Collision Problem
          </span>
        </div>
        {activeBlock && (
          <span style={{ color: "#58c4dd", fontFamily: "monospace", fontSize: 12 }}>
            {activeBlock.primitive_type}
          </span>
        )}
      </div>

      {/* Player — takes remaining height */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TimelinePlayer
          timelineData={MOCK_TIMELINE}
          isPlaying
          onBlockChange={setActiveBlock}
        />
      </div>
    </div>
  );
}
