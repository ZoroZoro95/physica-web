"use client";

import { useState, useEffect, useRef } from "react";

interface VideoControllerProps {
  isPlaying: boolean;
  onPlayPause: (playing: boolean) => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  isInterrupted: boolean;
  onResume?: () => void;
}

export default function VideoController({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  onSeek,
  volume,
  onVolumeChange,
  playbackRate,
  onPlaybackRateChange,
  isInterrupted,
  onResume,
}: VideoControllerProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    onSeek(pct * duration);
  };

  const handleScrubberMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(pct * duration);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.5))",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid rgba(255,255,255,0.1)",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Scrubber bar */}
      <div
        ref={scrubberRef}
        onClick={handleScrubberClick}
        onMouseMove={handleScrubberMove}
        onMouseLeave={() => setHoverTime(null)}
        style={{
          position: "relative",
          height: 6,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 3,
          cursor: "pointer",
          overflow: "hidden",
          transition: "height 0.15s ease",
        }}
      >
        {/* Progress bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #6dd4ee, #58c4dd)",
            borderRadius: 3,
            transition: "width 0.1s linear",
            boxShadow: "0 0 8px rgba(109,212,238,0.6)",
          }}
        />
        {/* Hover indicator */}
        {hoverTime !== null && (
          <div
            style={{
              position: "absolute",
              left: `${(hoverTime / duration) * 100}%`,
              top: -2,
              width: 10,
              height: 10,
              background: "#6dd4ee",
              borderRadius: "50%",
              transform: "translateX(-50%)",
              boxShadow: "0 0 12px rgba(109,212,238,0.8)",
              opacity: 0.8,
            }}
          />
        )}
      </div>

      {/* Controls row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        {/* Left: Play/Pause + Time */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => onPlayPause(!isPlaying)}
            disabled={isInterrupted}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.2)",
              background: isInterrupted ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)",
              color: isInterrupted ? "rgba(255,255,255,0.3)" : "#6dd4ee",
              fontSize: 14,
              cursor: isInterrupted ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
              fontWeight: 700,
            }}
            onMouseEnter={(e) => {
              if (!isInterrupted) {
                e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                e.currentTarget.style.boxShadow = "0 0 12px rgba(109,212,238,0.3)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isInterrupted) {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.boxShadow = "none";
              }
            }}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>

          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.6)",
              fontFamily: "monospace",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* Middle: Volume & Speed */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Volume */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🔊</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              style={{
                width: 60,
                cursor: "pointer",
                accentColor: "#6dd4ee",
              }}
            />
          </div>

          {/* Playback speed */}
          <select
            value={playbackRate}
            onChange={(e) => onPlaybackRateChange(parseFloat(e.target.value))}
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.3)",
              color: "rgba(255,255,255,0.8)",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </div>

        {/* Right: Resume (if interrupted) */}
        {isInterrupted && onResume && (
          <button
            onClick={onResume}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              background: "linear-gradient(135deg, #f5e642, #ffb347)",
              color: "#0f0f1a",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              animation: "pulse 1.2s ease-in-out infinite",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            ▶ Resume Lesson
          </button>
        )}
      </div>
    </div>
  );
}
