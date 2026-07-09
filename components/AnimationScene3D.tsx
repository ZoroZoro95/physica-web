"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { contractForbids, contractForStep, contractLabelsForTarget, type BeatVisualSpec } from "@/types/visualContract";
import {
  createLabelPlacementAuthority,
  pointBox,
  segmentBox,
} from "@/utils/labelEngine";

interface AnimationSceneSpec {
  problem: {
    world: string;
    unknown: string;
    engine_case: string;
  };
  geometry: {
    points: Record<string, { x: number; y: number; label?: string }>;
    surfaces?: Array<{
      id?: string;
      type?: string;
      from?: string;
      to?: string;
      from_xy?: [number, number];
      to_xy?: [number, number];
      label?: string;
      angle_deg?: number;
    }>;
    obstacles: Array<Record<string, unknown>>;
  };
  trajectories: Array<{
    id?: string;
    actor?: string;
    sampled_points: Array<{ x: number; y: number; t?: number }>;
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
    role?: string;
  }>;
  camera_bookmarks?: Array<{
    id: string;
    label: string;
    target: string;
    zoom: number;
  }>;
  storyboard?: Array<{
    step_id: string;
    beat_visual_spec?: BeatVisualSpec;
    visual_action?: string;
    camera: string;
    visible_vectors: string[];
    overlays: string[];
    visual_focus: string[];
    highlight_ids?: string[];
    camera_target_ids?: string[];
    labels?: Array<{ target_id: string; text: string; placement?: string; priority?: number }>;
    motion?: Record<string, unknown>;
    visual_state?: {
      visible_ids?: string[];
      visible_vectors?: string[];
      highlight_ids?: string[];
      label_ids?: string[];
      dimmed_ids?: string[];
      persist_until?: string;
    };
    visual_plan?: Record<string, unknown>;
    why: string;
  }>;
  quantities: Record<string, { value: number; unit: string; label: string }>;
  warnings: string[];
}

interface AnimationScene3DProps {
  sceneSpec: AnimationSceneSpec;
  stepId: string;
  teachingStepId?: string;
  animationProgress: number;
  revealIds?: string[];
  highlightIds?: string[];
  accumulateTeachingVectors?: boolean;
  vectorMode?: "none" | "beat" | "lifecycle";
}

const COLORS = {
  bg: "#11111c",
  ground: "#2d2d45",
  grid: "#303049",
  trajectoryGhost: "#2f5f70",
  trajectory: "#58c4dd",
  projectile: "#fc6255",
  velocity: "#fc6255",
  vx: "#58c4dd",
  vy: "#ffff00",
  acceleration: "#c084fc",
  axis: "#f4f4f5",
  range: "#4ade80",
  height: "#ffd166",
  wall: "#6b6b8a",
  text: "#e8e8f0",
  muted: "#a0a0c0",
  given: "#ff4d4d",
  target: "#ffd84d",
};

const ACTOR_COLORS = ["#fc6255", "#58c4dd", "#ffd166", "#4ade80"];

export default function AnimationScene3D({
  sceneSpec,
  stepId,
  teachingStepId,
  animationProgress,
  revealIds = [],
  highlightIds = [],
  accumulateTeachingVectors = false,
  vectorMode = "beat",
}: AnimationScene3DProps) {
  const model = useMemo(() => buildSceneModel(sceneSpec), [sceneSpec]);
  const controlsRef = useRef<any>(null);
  const [manualFocus, setManualFocus] = useState<{ target: V3; label: string } | null>(null);
  const [cameraTool, setCameraTool] = useState<"orbit" | "pan">("orbit");
  const progress = Math.max(0, Math.min(1, animationProgress));
  const isFullLifecycle = stepId === "__full_lifecycle";
  const storyboardStep = isFullLifecycle ? null : activeStoryboardStep(sceneSpec, stepId);
  const vectorStoryboardStep = vectorMode === "none"
    ? null
    : isFullLifecycle && vectorMode === "lifecycle"
    ? lifecycleVectorStoryboardStep(model)
    : isFullLifecycle
    ? teachingVectorStoryboardStep(sceneSpec, teachingStepId, {
      accumulate: accumulateTeachingVectors,
      revealIds,
      highlightIds,
    })
    : storyboardStep;
  const vectorHighlightIds = uniqueStrings([
    ...(vectorStoryboardStep?.visual_state?.highlight_ids ?? []),
    ...(vectorStoryboardStep?.highlight_ids ?? []),
    ...highlightIds,
  ]);
  const storyboardOverlays = storyboardStep?.overlays ?? [];
  const visualAction = storyboardStep?.visual_action ?? "";
  const motionMode = String(storyboardStep?.motion?.mode ?? "");
  const requested = requestedVisualQuantities(sceneSpec.problem.unknown, sceneSpec.problem.engine_case);
  const showImpactVelocityState = visualAction === "show_impact_velocity_triangle" || visualAction === "show_impact_angle";
  const showImpactVerticalVelocity = visualAction === "show_impact_vertical_velocity";
  const showImpactAngle = visualAction === "show_impact_angle" || storyboardStep?.beat_visual_spec?.beat === "impact_angle";
  const hideLiveValues = Boolean(storyboardStep?.visual_plan?.hide_live_values);
  const shouldAnimateMotion = isFullLifecycle
    || (!showImpactVelocityState && (
      storyboardOverlays.includes("show_motion_progress")
      || motionMode === "partial"
      || motionMode === "lifecycle"
    ));
  const showStaticComponents = storyboardOverlays.includes("show_velocity_components");
  const showTrajectoryLines = isFullLifecycle || shouldAnimateMotion || (
    storyboardOverlays.includes("show_trajectory")
    && !["show_full_scene", "show_launch_setup", "show_incline_axes", "compare_incline_motion", "zoom_launch_vector"].includes(visualAction)
  );
  const staticProgress = motionMode === "freeze"
    ? 1
    : ((showStaticComponents && !showImpactVelocityState) || ["show_full_scene", "show_launch_setup", "show_incline_axes", "compare_incline_motion", "zoom_launch_vector"].includes(visualAction) ? 0 : 1);
  const sceneProgress = shouldAnimateMotion ? progress : staticProgress;
  const globalTime = sceneProgress * model.totalDuration;
  const fullSceneCamera = activeCameraBookmark(model, "full_scene");
  const activeCamera = manualFocus
    ? manualCameraBookmark(model, manualFocus.target, manualFocus.label)
    : fullSceneCamera;
  const liveMotion = liveMotionAt(model, sceneProgress);
  const liveValues = liveVariableRows(model, sceneProgress);
  const isAnswerStep = stepId.includes("answer")
    || stepId.includes("takeaway")
    || visualAction === "highlight_final_answer";
  const asksThisBeatForRange = storyboardOverlays.includes("show_range_marker")
    || visualAction === "highlight_range"
    || stepId.includes("range")
    || stepId.includes("distance")
    || (isAnswerStep && requested.range);
  const asksThisBeatForHeight = storyboardOverlays.includes("show_height_marker")
    || visualAction === "highlight_apex"
    || stepId.includes("height")
    || stepId.includes("peak")
    || stepId.includes("apex")
    || (isAnswerStep && requested.height);
  const asksThisBeatForTime = storyboardOverlays.includes("show_timer")
    || stepId.includes("time")
    || stepId.includes("flight")
    || (isAnswerStep && requested.time);
  const showInclineRange = Boolean(model.impact) && hasFiniteQuantity(model, "R") && model.world === "incline" && (
    isFullLifecycle && requested.range || asksThisBeatForRange || sceneSpec.problem.unknown.includes("distance") && isAnswerStep
  );
  const showRange = !showInclineRange && hasFiniteQuantity(model, "R") && (
    (isFullLifecycle && requested.range)
    || asksThisBeatForRange
  );
  const showSameHeight = storyboardOverlays.includes("show_same_height");
  const showHeight = hasFiniteQuantity(model, "H") && (
    (isFullLifecycle && requested.height)
    || asksThisBeatForHeight
  );
  const hasLaunchHeightQuantity = hasFiniteQuantity(model, "launch_height") || hasFiniteQuantity(model, "h");
  const showGenericHeightMarker = showHeight && !(sceneSpec.problem.world === "height_launch" && hasLaunchHeightQuantity);
  const showLaunchHeightMarker = sceneSpec.problem.world === "height_launch"
    && hasLaunchHeightQuantity
    && (
      storyboardOverlays.includes("show_height_marker")
      || asksThisBeatForHeight
      || (storyboardStep?.visual_focus ?? []).includes("quantity:launch_height")
      || (storyboardStep?.highlight_ids ?? []).includes("quantity:launch_height")
    );
  const showTimer = hasFiniteQuantity(model, "T") && (
    (isFullLifecycle && requested.time)
    || asksThisBeatForTime
  );
  const activeTarget = Boolean(model.target);
  const activeWall = Boolean(model.wall);
  const showLaunchAngle = Number.isFinite(model.theta) && Math.abs(model.theta) > 0.01;
  const activeEmphasisColor = emphasisColor(vectorHighlightIds);
  const showPerpendicularMarker = storyboardOverlays.includes("show_perpendicular_marker")
    || highlightIds.some(id => id.toLowerCase().includes("normal_axis") || id.toLowerCase().includes("perpendicular"));
  const isComponentStep = storyboardOverlays.includes("show_velocity_components");
  const showLivePanel = isFullLifecycle || isComponentStep || (!isFullLifecycle && (shouldAnimateMotion || stepId.toLowerCase().includes("velocity"))) || requested.velocity;
  const showAxisLabels = isFullLifecycle || visualAction === "show_incline_axes" || storyboardOverlays.includes("show_axes");
  const suppressEndpointMarkersForImpactVectors = showImpactVerticalVelocity || showImpactVelocityState || showImpactAngle;
  const suppressLaunchPointForHeightStep = sceneSpec.problem.world === "height_launch" && !isFullLifecycle;
  const showLaunchPointMarker = !suppressEndpointMarkersForImpactVectors && !suppressLaunchPointForHeightStep;
  const showLandingPointMarker = model.showLandingMarker && !suppressEndpointMarkersForImpactVectors && (
    isFullLifecycle
    || showRange
    || shouldAnimateMotion
  );
  const impactAngleInfo = showImpactAngle ? impactAngleGeometry(model) : null;

  useEffect(() => {
    setManualFocus(null);
  }, [sceneSpec, stepId]);

  return (
    <div
      data-audit-surface="animation-scene-3d"
      data-audit-step-id={stepId}
      data-audit-teaching-step-id={teachingStepId ?? ""}
      data-audit-full-lifecycle={isFullLifecycle ? "true" : "false"}
      data-audit-show-trajectory={showTrajectoryLines ? "true" : "false"}
      data-audit-visual-action={visualAction}
      data-audit-visible-vector-ids={visibleLiveVectors(model, vectorStoryboardStep, sceneProgress, revealIds).map(vector => vector.id).join(",")}
      style={{ width: "100%", height: "100%", minHeight: 0, position: "relative", overflow: "hidden", background: COLORS.bg, cursor: cameraTool === "pan" ? "grab" : "default" }}
    >
      <div style={animationCanvasSafeAreaStyle}>
        <Canvas
          shadows
          camera={{ position: activeCamera.position, fov: activeCamera.fov }}
          gl={{ antialias: true }}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <CameraRig bookmark={activeCamera} controlsRef={controlsRef} />
          <color attach="background" args={[COLORS.bg]} />
          <ambientLight intensity={0.58} />
          <directionalLight position={[8, 12, 8]} intensity={1.15} castShadow />
          <directionalLight position={[-8, 5, -4]} intensity={0.32} color="#58c4dd" />

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            enableRotate={cameraTool === "orbit"}
            enablePan
            enableZoom
            zoomSpeed={0.72}
            rotateSpeed={0.62}
            panSpeed={0.62}
            minDistance={0.75}
            maxDistance={model.cameraDistance * 2.2}
            minPolarAngle={0.12}
            maxPolarAngle={Math.PI / 2.12}
            mouseButtons={{
              LEFT: cameraTool === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: cameraTool === "pan" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
            }}
            target={activeCamera.target}
          />

        <Ground width={model.groundWidth} depth={model.groundDepth} />
        <Axes length={model.axisLength} showLabels={showAxisLabels} />
        {model.surfaces.map(surface => (
          <SurfaceLine
            key={surface.id}
            surface={surface}
            showLabel={surface.type === "inclined_plane" || Boolean(surfaceHighlightColor(surface, highlightIds, activeEmphasisColor))}
            highlightColor={surfaceHighlightColor(surface, highlightIds, activeEmphasisColor)}
            onFocus={() => setManualFocus({
              target: [
                (surface.from[0] + surface.to[0]) / 2,
                (surface.from[1] + surface.to[1]) / 2,
                (surface.from[2] + surface.to[2]) / 2,
              ],
              label: surface.label || surface.id,
            })}
          />
        ))}

        {model.trajectories.map((trajectoryModel, index) => {
          if (!showTrajectoryLines) return null;
          const phase = trajectoryModel.timeWindow
            ? phaseState(trajectoryModel.timeWindow, globalTime)
            : {
              status: (shouldAnimateMotion || showStaticComponents) ? "active" as const : "complete" as const,
              localProgress: sceneProgress,
            };
          if (phase.status === "pending") return null;
          const revealCount = phase.status === "complete"
            ? trajectoryModel.points.length
            : Math.max(2, Math.ceil(phase.localProgress * trajectoryModel.points.length));
          const revealedPath = trajectoryModel.points.slice(0, revealCount);
          const projectile = samplePoint(trajectoryModel.points, phase.localProgress);
          const color = ACTOR_COLORS[index % ACTOR_COLORS.length];
          return (
            <group key={trajectoryModel.id}>
              {phase.status === "active" && (
                <Line points={trajectoryModel.points} color={COLORS.trajectoryGhost} lineWidth={2} dashed dashScale={8} dashSize={0.4} gapSize={0.28} />
              )}
              <Line points={revealedPath} color={color} lineWidth={5} />
              {phase.status === "active" && (
                <>
                  <mesh position={projectile} castShadow>
                    <sphereGeometry args={[model.ballRadius, 32, 32]} />
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.42} />
                  </mesh>
                  {model.trajectories.length > 1 && (
                    <SceneLabel position={[projectile[0], projectile[1] + model.labelLift * 0.34, projectile[2]]} text={trajectoryModel.label} color={color} />
                  )}
                </>
              )}
            </group>
          );
        })}

        {!showTrajectoryLines && model.trajectories.map((trajectoryModel, index) => {
          const actorPoint = samplePoint(trajectoryModel.points, actorLocalProgress(model, trajectoryModel.actor, sceneProgress));
          const overlapOffset = model.trajectories.length > 1
            ? (index - (model.trajectories.length - 1) / 2) * model.ballRadius * 2.45
            : 0;
          const displayPoint: V3 = [
            actorPoint[0] + overlapOffset,
            actorPoint[1] + Math.abs(overlapOffset) * 0.18,
            actorPoint[2],
          ];
          const color = ACTOR_COLORS[index % ACTOR_COLORS.length];
          return (
            <ActorDot
              key={`actor-dot:${trajectoryModel.actor}`}
              position={displayPoint}
              label={trajectoryModel.label}
              color={pointHighlightColor([`actor:${trajectoryModel.actor}`, trajectoryModel.id], highlightIds, color, activeEmphasisColor)}
              labelLift={model.labelLift}
              emphasized={highlightIds.includes(`actor:${trajectoryModel.actor}`)}
              showLabel={model.trajectories.length > 1}
            />
          );
        })}

        {vectorMode !== "none" && visibleLiveVectors(model, vectorStoryboardStep, sceneProgress, revealIds).map(vector => (
          <DynamicVectorLine
            key={vector.id}
            vector={vector}
            model={model}
            progress={sceneProgress}
            emphasized={matchesAnySceneId(vectorHighlightIds, vector.id)}
            emphasisColor={matchesAnySceneId(vectorHighlightIds, vector.id) ? activeEmphasisColor : undefined}
            dimmed={shouldDimVector(vector, vectorStoryboardStep, vectorHighlightIds)}
            labelOverride={labelOverrideForVector(vectorStoryboardStep, vector.id)}
            showLabel={shouldShowVectorLabel(vector, vectorStoryboardStep, vectorHighlightIds)}
          />
        ))}

        {visualAction === "compare_incline_motion" && highlightIds.some(id => id.includes("normal_axis")) && (
          <SceneLabel
            position={[model.center.x, model.center.y + model.labelLift * 0.95, 0.08]}
            text="✓ along-plane motion cancels"
            color={COLORS.range}
            compact
          />
        )}

        {showPerpendicularMarker && model.surfaces.filter(surface => surface.type === "inclined_plane").map(surface => (
          <RightAngleMarker key={`right-angle:${surface.id}`} surface={surface} anchor={model.launch} color={COLORS.target} />
        ))}

        {showLaunchPointMarker && (
          <Marker position={model.launch} label="O" color={pointHighlightColor(["point:launch", "actor:projectile_p", "vector:u", "quantity:u"], highlightIds, COLORS.projectile, activeEmphasisColor)} onFocus={() => setManualFocus({ target: model.launch, label: "launch" })} />
        )}
        {shouldShowMarker(model, "apex", storyboardStep, isFullLifecycle && requested.height) && (
          <Marker position={model.apex} label="A" color={pointHighlightColor(["event:apex", "quantity:H"], highlightIds, COLORS.height, activeEmphasisColor)} onFocus={() => setManualFocus({ target: model.apex, label: "apex" })} />
        )}
        {showLandingPointMarker && (
          <Marker position={model.landing} label="L" color={pointHighlightColor(["point:landing", "event:landing", "quantity:R", "quantity:T"], highlightIds, COLORS.range, activeEmphasisColor)} onFocus={() => setManualFocus({ target: model.landing, label: "landing" })} />
        )}

        {activeTarget && <TargetMarker position={model.target!} onFocus={() => setManualFocus({ target: model.target!, label: "target" })} />}
        {model.impact && <Marker position={model.impact} label="Q" color={pointHighlightColor(["point:impact", "event:impact", "quantity:R"], highlightIds, COLORS.range, activeEmphasisColor)} onFocus={() => setManualFocus({ target: model.impact!, label: "impact" })} />}
        {model.collision && <Marker position={model.collision} label="C" color={pointHighlightColor(["point:collision", "event:collision"], highlightIds, COLORS.height, activeEmphasisColor)} onFocus={() => setManualFocus({ target: model.collision!, label: "collision" })} />}
        {model.collisionMarkers.map(marker => (
          <Marker key={marker.id} position={marker.position} label={marker.label} color={COLORS.height} onFocus={() => setManualFocus({ target: marker.position, label: marker.label })} />
        ))}
        {activeWall && <Wall obstacle={model.wall!} onFocus={() => setManualFocus({ target: [model.wall!.x, model.wall!.height / 2, 0], label: "wall" })} />}
        {model.positionAtT && <Marker position={model.positionAtT.position} label={model.positionAtT.label} color="#d7f7ff" onFocus={() => setManualFocus({ target: model.positionAtT!.position, label: model.positionAtT!.label })} />}

        {showRange && <RangeBracket from={model.launch} to={model.landing} label={`R = ${formatNumber(model.quantities.R)} m`} glow />}
        {showInclineRange && model.impact && (
          <SegmentMeasure from={model.launch} to={model.impact} label={`R = ${formatNumber(model.quantities.R)} m`} color={COLORS.range} />
        )}
        {showSameHeight && <SameHeightMarker from={model.launch} to={model.landing} />}
        {showGenericHeightMarker && <HeightMarker apex={model.apex} label={`H = ${formatNumber(model.quantities.H)} m`} />}
        {showLaunchHeightMarker && (
          <LaunchHeightMarker
            launch={model.launch}
            label={`h = ${formatNumber(model.quantities.launch_height ?? model.quantities.h)} m`}
            offset={Math.max(0.36, model.vectorScale * 0.68)}
          />
        )}
        {showTimer && <SceneLabel position={[model.center.x, model.maxY + model.labelLift, 0]} text={`T = ${formatNumber(model.quantities.T)} s`} color="#d7f7ff" />}
        {activeWall && <SceneLabel position={[model.wall!.x, model.wall!.height + model.labelLift * 0.42, 0]} text={`wall ${formatNumber(model.wall!.height)} m`} color="#d7f7ff" />}
        {showLaunchAngle && (
          <AngleArc
            origin={model.launch}
            fromAngle={0}
            toAngle={model.theta}
            radius={Math.max(0.42, model.vectorScale * 1.08)}
            label={`θ = ${formatNumber(model.quantities.theta)}°`}
            color="#ffd166"
          />
        )}
        {impactAngleInfo && (
          <AngleArc
            origin={impactAngleInfo.origin}
            fromAngle={0}
            toAngle={impactAngleInfo.angle}
            radius={Math.max(0.34, model.vectorScale * 0.72)}
            label={`θ = ${formatNumber(impactAngleInfo.degrees)}°`}
            color="#ffd166"
          />
        )}

        </Canvas>
      </div>
      <div aria-hidden="true" style={animationCanvasBottomSafeZoneStyle} />
      <div style={{
        position: "absolute",
        right: 12,
        top: 12,
        display: "flex",
        gap: 6,
        padding: 5,
        background: "rgba(17,17,28,0.72)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 9,
        pointerEvents: "auto",
      }}>
        <button
          type="button"
          data-guide-id="camera-pan"
          aria-pressed={cameraTool === "pan"}
          title={cameraTool === "pan" ? "Pan mode on: drag to move the zoomed scene" : "Pan tool: drag to move the zoomed scene"}
          onClick={() => setCameraTool(value => value === "pan" ? "orbit" : "pan")}
          style={cameraToolButtonStyle(cameraTool === "pan")}
        >
          <HandIcon />
        </button>
      </div>
      {showLivePanel && !hideLiveValues && (
        <div style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          display: "grid",
          gap: 5,
          background: "rgba(17,17,28,0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          padding: "8px 10px",
          color: COLORS.text,
          fontSize: 11,
          lineHeight: 1.35,
          pointerEvents: "none",
          minWidth: 164,
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            paddingBottom: 4,
            marginBottom: 2,
            borderBottom: "1px solid rgba(255,255,255,0.10)",
          }}>
            <span style={{ color: COLORS.text, fontWeight: 850 }}>{isFullLifecycle ? "Legend" : "Live values"}</span>
            <span style={{ color: COLORS.muted, fontFamily: "monospace" }}>{Math.round(sceneProgress * 100)}%</span>
          </div>
          <div style={{
            color: COLORS.muted,
            fontSize: 10,
            lineHeight: 1.35,
            paddingBottom: 3,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            {vectorSymbolLegend(model.world)}
          </div>
          {liveValues.map(row => (
            <div key={row.key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: COLORS.muted }}>{row.label}</span>
              <span style={{ fontFamily: "monospace", color: row.dynamic ? COLORS.trajectory : COLORS.text }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const animationCanvasSafeAreaStyle: React.CSSProperties = {
  position: "absolute",
  inset: "0 0 44px 0",
  minHeight: 0,
};

const animationCanvasBottomSafeZoneStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 44,
  background: "linear-gradient(180deg, rgba(17,17,28,0), #11111c 46%)",
  borderTop: "1px solid rgba(255,255,255,0.05)",
  pointerEvents: "none",
};

function Ground({ width, depth }: { width: number; depth: number }) {
  return (
    <group>
      <mesh position={[width / 2, -0.015, 0]} receiveShadow>
        <boxGeometry args={[width, 0.03, depth]} />
        <meshStandardMaterial color={COLORS.ground} roughness={0.85} />
      </mesh>
      <gridHelper args={[Math.max(width, depth), 18, COLORS.grid, COLORS.grid]} position={[width / 2, 0.002, 0]} />
    </group>
  );
}

function HandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M8.4 11.2V6.1a1.25 1.25 0 0 1 2.5 0v4.2-6.1a1.25 1.25 0 0 1 2.5 0v6-4.8a1.25 1.25 0 0 1 2.5 0v6.1-3.4a1.25 1.25 0 0 1 2.5 0v6.2c0 4.1-2.4 6.5-6.2 6.5h-1.8c-2.2 0-3.6-.8-4.9-2.6l-2.2-3.1a1.37 1.37 0 0 1 2.2-1.6l2 2.4c.2.2.4.1.4-.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function cameraToolButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: `1px solid ${active ? "rgba(88,196,221,0.55)" : "rgba(255,255,255,0.12)"}`,
    background: active ? "rgba(88,196,221,0.18)" : "rgba(45,45,69,0.68)",
    color: active ? COLORS.trajectory : COLORS.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: active ? "0 0 18px rgba(88,196,221,0.22)" : "none",
  };
}

function Axes({ length, showLabels = true }: { length: number; showLabels?: boolean }) {
  return (
    <group>
      <Line points={[[0, 0.02, 0], [length, 0.02, 0]]} color="#3a3a55" lineWidth={2} />
      <Line points={[[0, 0, 0], [0, length * 0.42, 0]]} color="#3a3a55" lineWidth={2} />
      {showLabels && (
        <>
          <SceneLabel position={[length, 0.22, 0]} text="x" color={COLORS.muted} />
          <SceneLabel position={[0.24, length * 0.42, 0]} text="y" color={COLORS.muted} />
        </>
      )}
    </group>
  );
}

function CameraRig({ bookmark, controlsRef }: { bookmark: CameraBookmark; controlsRef: MutableRefObject<any> }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    camera.position.set(bookmark.position[0], bookmark.position[1], bookmark.position[2]);
    if ("fov" in camera) {
      (camera as THREE.PerspectiveCamera).fov = bookmark.fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    const controls = controlsRef.current;
    if (controls?.target) {
      controls.target.set(bookmark.target[0], bookmark.target[1], bookmark.target[2]);
      controls.update();
    }
    invalidate();
  }, [bookmark.id, bookmark.position, bookmark.target, bookmark.fov, camera, controlsRef, invalidate]);
  return null;
}

function DynamicVectorLine({
  vector,
  model,
  progress,
  emphasized,
  emphasisColor,
  dimmed,
  labelOverride,
  showLabel,
}: {
  vector: SceneLiveVector;
  model: ReturnType<typeof buildSceneModel>;
  progress: number;
  emphasized?: boolean;
  emphasisColor?: string;
  dimmed?: boolean;
  labelOverride?: string;
  showLabel?: boolean;
}) {
  const resolved = resolveLiveVector(vector, model, progress, Boolean(emphasized));
  if (!resolved) return null;
  return (
    <VectorLine
      from={resolved.from}
      to={resolved.to}
      color={emphasisColor ?? resolved.color}
      label={labelOverride ?? resolved.label}
      component={vector.component}
      labelLift={model.labelLift}
      emphasized={Boolean(emphasized)}
      dimmed={Boolean(dimmed)}
      showLabel={Boolean(showLabel)}
    />
  );
}

function VectorLine({
  from,
  to,
  color,
  label,
  component,
  labelLift,
  emphasized = false,
  dimmed = false,
  showLabel = true,
}: {
  from: V3;
  to: V3;
  color: string;
  label: string;
  component: string;
  labelLift: number;
  emphasized?: boolean;
  dimmed?: boolean;
  showLabel?: boolean;
}) {
  const [pulse, setPulse] = useState(1);
  useFrame(({ clock }) => {
    if (!emphasized) return;
    setPulse(0.46 + 0.54 * Math.abs(Math.sin(clock.elapsedTime * 4.2)));
  });
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.035) return null;
  const liftedFrom = foregroundVectorPoint(from);
  const liftedTo = foregroundVectorPoint(to);
  const labelPlacement = vectorLabelPlacement(liftedFrom, liftedTo, component, labelLift, label);
  const lineWidth = dimmed ? 2.1 : 2.7;
  const baseOpacity = dimmed ? 0.28 : 1;
  return (
    <group renderOrder={30}>
      {emphasized && (
        <Line points={[liftedFrom, liftedTo]} color={color} lineWidth={8} transparent opacity={0.16 + 0.38 * pulse} depthTest={false} />
      )}
      <Line points={[liftedFrom, liftedTo]} color={color} lineWidth={lineWidth} transparent opacity={emphasized ? 0.64 + 0.36 * pulse : baseOpacity} depthTest={false} />
      <ArrowHead2D from={liftedFrom} to={liftedTo} color={color} lineWidth={lineWidth} opacity={emphasized ? 0.64 + 0.36 * pulse : baseOpacity} />
      {showLabel && (
        <SceneLabel
          position={labelPlacement.position}
          text={label}
          color={dimmed ? COLORS.muted : color}
          plain
          anchor={labelPlacement.anchor}
        />
      )}
    </group>
  );
}

function foregroundVectorPoint(point: V3): V3 {
  return [point[0], point[1], point[2] + 0.22];
}

function ArrowHead2D({ from, to, color, lineWidth = 2.5, opacity = 1 }: { from: V3; to: V3; color: string; lineWidth?: number; opacity?: number }) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 0.16;
  const left: V3 = [to[0] - size * Math.cos(angle - Math.PI / 6), to[1] - size * Math.sin(angle - Math.PI / 6), to[2]];
  const right: V3 = [to[0] - size * Math.cos(angle + Math.PI / 6), to[1] - size * Math.sin(angle + Math.PI / 6), to[2]];
  return (
    <group>
      <Line points={[left, to]} color={color} lineWidth={lineWidth} transparent opacity={opacity} depthTest={false} />
      <Line points={[right, to]} color={color} lineWidth={lineWidth} transparent opacity={opacity} depthTest={false} />
    </group>
  );
}

function Marker({ position, label, color, onFocus }: { position: V3; label: string; color: string; onFocus?: () => void }) {
  const labelPlacement = pointLabelPlacement(position, label);
  return (
    <group>
      <mesh
        position={position}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onFocus?.();
        }}
      >
        <sphereGeometry args={[0.11, 18, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} />
      </mesh>
      <SceneLabel position={labelPlacement.position} text={label} color={color} anchor={labelPlacement.anchor} />
    </group>
  );
}

function pointLabelPlacement(point: V3, text: string): { position: V3; anchor: SceneLabelAnchor } {
  const ui = 0.18;
  const seed = { x: point[0] + 0.24, y: point[1] + 0.24 };
  const authority = createLabelPlacementAuthority({
    bounds: {
      minX: point[0] - 1.2,
      maxX: point[0] + 1.6,
      minY: point[1] - 1.0,
      maxY: point[1] + 1.4,
    },
    ui,
    initialOccupied: [pointBox({ x: point[0], y: point[1] }, 0.28)],
  });
  const [placed] = authority.place([{
    key: `scene-point-label:${text}`,
    text,
    x: seed.x,
    y: seed.y,
    size: 0.14,
    anchor: "start",
    priority: 100,
    leaderFrom: { x: point[0], y: point[1] },
  }]);
  return {
    position: [placed?.x ?? seed.x, placed?.y ?? seed.y, point[2] + 0.04],
    anchor: "start",
  };
}

function ActorDot({
  position,
  label,
  color,
  labelLift,
  emphasized = false,
  showLabel = true,
}: {
  position: V3;
  label: string;
  color: string;
  labelLift: number;
  emphasized?: boolean;
  showLabel?: boolean;
}) {
  const [pulse, setPulse] = useState(1);
  useFrame(({ clock }) => {
    if (!emphasized) return;
    setPulse(0.54 + 0.46 * Math.abs(Math.sin(clock.elapsedTime * 4.6)));
  });
  return (
    <group>
      {emphasized && (
        <mesh position={position}>
          <sphereGeometry args={[0.18 + 0.06 * pulse, 24, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} />
        </mesh>
      )}
      <mesh position={position} castShadow>
        <sphereGeometry args={[0.13, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.38} />
      </mesh>
      {showLabel && label && (
        <SceneLabel position={[position[0] + 0.18, position[1] + labelLift * 0.36, position[2] + 0.03]} text={label} color={color} compact />
      )}
    </group>
  );
}

function TargetMarker({ position, onFocus }: { position: V3; onFocus?: () => void }) {
  return (
    <group>
      <mesh
        position={position}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onFocus?.();
        }}
      >
        <torusGeometry args={[0.24, 0.025, 12, 32]} />
        <meshStandardMaterial color={COLORS.range} emissive={COLORS.range} emissiveIntensity={0.16} />
      </mesh>
      <Line points={[[position[0] - 0.35, position[1], position[2]], [position[0] + 0.35, position[1], position[2]]]} color={COLORS.range} lineWidth={3} />
      <Line points={[[position[0], position[1] - 0.35, position[2]], [position[0], position[1] + 0.35, position[2]]]} color={COLORS.range} lineWidth={3} />
      <SceneLabel position={[position[0] + 0.34, position[1] + 0.28, position[2]]} text="target" color={COLORS.range} />
    </group>
  );
}

function Wall({ obstacle, onFocus }: { obstacle: { x: number; height: number }; onFocus?: () => void }) {
  return (
    <mesh
      position={[obstacle.x, obstacle.height / 2, 0]}
      castShadow
      receiveShadow
      onDoubleClick={(event) => {
        event.stopPropagation();
        onFocus?.();
      }}
    >
      <boxGeometry args={[0.18, Math.max(0.08, obstacle.height), 0.72]} />
      <meshStandardMaterial color={COLORS.wall} roughness={0.62} metalness={0.05} />
    </mesh>
  );
}

type SceneSurface = { id: string; type: string; from: V3; to: V3; label: string; angleDeg?: number };

function SurfaceLine({ surface, highlightColor, showLabel = true, onFocus }: { surface: SceneSurface; highlightColor?: string; showLabel?: boolean; onFocus?: () => void }) {
  const anchor: V3 = surface.to[1] <= surface.from[1] ? surface.to : surface.from;
  const other: V3 = anchor === surface.to ? surface.from : surface.to;
  const dx = other[0] - anchor[0];
  const dy = other[1] - anchor[1];
  const surfaceAngle = Math.atan2(dy, dx);
  const baselineAngle = dx >= 0 ? 0 : Math.PI;
  const angleDeg = surface.angleDeg;
  const showAngle = surface.type === "inclined_plane" && typeof angleDeg === "number" && Number.isFinite(angleDeg);
  return (
    <group>
      {highlightColor && (
        <Line points={[surface.from, surface.to]} color={highlightColor} lineWidth={11} transparent opacity={0.28} />
      )}
      <Line points={[surface.from, surface.to]} color={highlightColor ?? "#d7f7ff"} lineWidth={4} />
      <Line
        points={[surface.from, surface.to]}
        color="#ffffff"
        lineWidth={12}
        transparent
        opacity={0}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onFocus?.();
        }}
      />
      {showLabel && (
        <SceneLabel
          position={[(surface.from[0] + surface.to[0]) / 2, (surface.from[1] + surface.to[1]) / 2 + 0.25, 0]}
          text={surface.label}
          color="#d7f7ff"
        />
      )}
      {showAngle && (
        <AngleArc
          origin={anchor}
          fromAngle={baselineAngle}
          toAngle={surfaceAngle}
          radius={0.58}
          label={`${formatNumber(Math.abs(angleDeg))}°`}
          color="#ffd166"
        />
      )}
    </group>
  );
}

function RightAngleMarker({ surface, anchor, color }: { surface: SceneSurface; anchor: V3; color: string }) {
  const dx = surface.to[0] - surface.from[0];
  const dy = surface.to[1] - surface.from[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const tx = dx / length;
  const ty = dy / length;
  const nx = -ty;
  const ny = tx;
  const size = 0.28;
  const a: V3 = [anchor[0] + tx * size, anchor[1] + ty * size, anchor[2] + 0.06];
  const b: V3 = [a[0] + nx * size, a[1] + ny * size, a[2]];
  const c: V3 = [anchor[0] + nx * size, anchor[1] + ny * size, anchor[2] + 0.06];
  return (
    <group>
      <Line points={[a, b, c]} color={color} lineWidth={3} />
      <Line points={[a, b, c]} color={color} lineWidth={8} transparent opacity={0.16} />
    </group>
  );
}

function AngleArc({
  origin,
  fromAngle,
  toAngle,
  radius,
  label,
  color,
}: {
  origin: V3;
  fromAngle: number;
  toAngle: number;
  radius: number;
  label: string;
  color: string;
}) {
  const sweep = normalizeSmallAngle(toAngle - fromAngle);
  const segments = 28;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = fromAngle + (sweep * index) / segments;
    return [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle), origin[2] + 0.02] as V3;
  });
  const midAngle = fromAngle + sweep / 2;
  const labelRadius = radius + 0.22;
  return (
    <group>
      <Line points={points} color={color} lineWidth={3} />
      <Line points={[origin, [origin[0] + radius * 0.86 * Math.cos(fromAngle), origin[1] + radius * 0.86 * Math.sin(fromAngle), origin[2] + 0.02]]} color={color} lineWidth={2} transparent opacity={0.7} />
      <Line points={[origin, [origin[0] + radius * 0.86 * Math.cos(toAngle), origin[1] + radius * 0.86 * Math.sin(toAngle), origin[2] + 0.02]]} color={color} lineWidth={2} transparent opacity={0.7} />
      <SceneLabel
        position={[origin[0] + labelRadius * Math.cos(midAngle), origin[1] + labelRadius * Math.sin(midAngle), origin[2] + 0.02]}
        text={label}
        color={color}
      />
    </group>
  );
}

function normalizeSmallAngle(angle: number) {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function RangeBracket({ from, to, label, glow = false }: { from: V3; to: V3; label: string; glow?: boolean }) {
  const y = -0.22;
  const midX = (from[0] + to[0]) / 2;
  return (
    <group>
      {glow && (
        <>
          <Line points={[[from[0], y, 0], [to[0], y, 0]]} color="#bbf7d0" lineWidth={13} transparent opacity={0.18} />
          <Line points={[[from[0], y, 0], [to[0], y, 0]]} color="#4ade80" lineWidth={8} transparent opacity={0.36} />
        </>
      )}
      <Line points={[[from[0], y, 0], [to[0], y, 0]]} color={COLORS.range} lineWidth={4} />
      <Line points={[[from[0], y - 0.12, 0], [from[0], y + 0.12, 0]]} color={COLORS.range} lineWidth={4} />
      <Line points={[[to[0], y - 0.12, 0], [to[0], y + 0.12, 0]]} color={COLORS.range} lineWidth={4} />
      <SceneLabel position={[midX, y - 0.28, 0]} text={label} color={COLORS.range} />
    </group>
  );
}

function SegmentMeasure({ from, to, label, color }: { from: V3; to: V3; label: string; color: string }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = 0.18;
  const a: V3 = [from[0] + nx * offset, from[1] + ny * offset, from[2] + 0.04];
  const b: V3 = [to[0] + nx * offset, to[1] + ny * offset, to[2] + 0.04];
  const mid: V3 = [(a[0] + b[0]) / 2 + nx * 0.18, (a[1] + b[1]) / 2 + ny * 0.18, 0.04];
  return (
    <group>
      <Line points={[a, b]} color="#bbf7d0" lineWidth={12} transparent opacity={0.16} />
      <Line points={[a, b]} color={color} lineWidth={4} />
      <Line points={[from, a]} color={color} lineWidth={2} transparent opacity={0.72} />
      <Line points={[to, b]} color={color} lineWidth={2} transparent opacity={0.72} />
      <SceneLabel position={mid} text={label} color={color} compact />
    </group>
  );
}

function SameHeightMarker({ from, to }: { from: V3; to: V3 }) {
  const y = from[1] + 0.08;
  const midX = (from[0] + to[0]) / 2;
  return (
    <group>
      <Line points={[[from[0], y, 0.04], [to[0], y, 0.04]]} color="#ffd166" lineWidth={5} dashed dashScale={5} dashSize={0.26} gapSize={0.16} />
      <SceneLabel position={[midX, y + 0.32, 0.04]} text="Δy = 0" color="#ffd166" compact />
    </group>
  );
}

function HeightMarker({ apex, label }: { apex: V3; label: string }) {
  return (
    <group>
      <Line points={[[apex[0], 0, 0], apex]} color={COLORS.height} lineWidth={3} dashed dashScale={5} dashSize={0.18} gapSize={0.12} />
      <SceneLabel position={[apex[0] + 0.22, apex[1] / 2, 0]} text={label} color={COLORS.height} />
    </group>
  );
}

function LaunchHeightMarker({ launch, label, offset }: { launch: V3; label: string; offset: number }) {
  const x = launch[0] - offset;
  const ground: V3 = [x, 0, launch[2] + 0.04];
  const top: V3 = [x, launch[1], launch[2] + 0.04];
  return (
    <group>
      <Line points={[ground, top]} color={COLORS.height} lineWidth={3} dashed dashScale={5} dashSize={0.18} gapSize={0.12} />
      <Line points={[top, [launch[0], launch[1], launch[2] + 0.04]]} color={COLORS.height} lineWidth={2} transparent opacity={0.56} />
      <Line points={[ground, [launch[0], 0, launch[2] + 0.04]]} color={COLORS.height} lineWidth={2} transparent opacity={0.56} />
      <SceneLabel position={[x - 0.28, launch[1] / 2, launch[2] + 0.06]} text={label} color={COLORS.height} />
    </group>
  );
}

function SceneLabel({
  position,
  text,
  color,
  compact = false,
  plain = false,
  anchor = "center",
}: {
  position: V3;
  text: string;
  color: string;
  compact?: boolean;
  plain?: boolean;
  anchor?: SceneLabelAnchor;
}) {
  const boxed = compact && !plain;
  const centered = anchor === "center";
  const transform = anchor === "start"
    ? "translate(0, -50%)"
    : anchor === "end"
    ? "translate(-100%, -50%)"
    : undefined;
  return (
    <Html position={position} center={centered} distanceFactor={8} style={{ pointerEvents: "none" }}>
      <div style={{
        color,
        fontSize: plain || compact ? 10.5 : 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        textShadow: "0 1px 8px rgba(0,0,0,0.85)",
        fontFamily: "-apple-system,'SF Pro Display','Helvetica Neue',sans-serif",
        background: boxed ? "rgba(17,17,28,0.68)" : "transparent",
        border: boxed ? "1px solid rgba(255,255,255,0.10)" : "none",
        borderRadius: boxed ? 5 : 0,
        padding: boxed ? "1px 4px" : 0,
        transform,
      }}>
        {text}
      </div>
    </Html>
  );
}

type V3 = [number, number, number];
type SceneLabelAnchor = "center" | "start" | "end";

type SceneLiveVector = {
  id: string;
  actor: string;
  kind: string;
  component: string;
  anchor: string;
  label: string;
};

type StoryboardStep = {
  step_id: string;
  beat_visual_spec?: BeatVisualSpec;
  visual_action?: string;
  camera: string;
  visible_vectors: string[];
  overlays: string[];
  visual_focus: string[];
  highlight_ids?: string[];
  camera_target_ids?: string[];
  labels?: Array<{ target_id: string; text: string; placement?: string; priority?: number }>;
  motion?: Record<string, unknown>;
  visual_state?: {
    visible_ids?: string[];
    visible_vectors?: string[];
    highlight_ids?: string[];
    label_ids?: string[];
    dimmed_ids?: string[];
    persist_until?: string;
  };
  visual_plan?: Record<string, unknown>;
  why: string;
};

type CameraBookmark = {
  id: string;
  label: string;
  position: V3;
  target: V3;
  fov: number;
};

function buildSceneModel(sceneSpec: AnimationSceneSpec) {
  const world = sceneSpec.problem.world;
  const unknown = sceneSpec.problem.unknown;
  const rawTrajectories = sceneSpec.trajectories.length
    ? sceneSpec.trajectories.map((trajectory, index) => ({
        id: trajectory.id ?? `trajectory:${index}`,
        label: trajectory.actor ? actorLabel(trajectory.actor) : `P${index + 1}`,
        actor: trajectory.actor ?? `projectile_${index + 1}`,
        rawPoints: trajectory.sampled_points.length ? trajectory.sampled_points : [{ x: 0, y: 0 }],
        timeWindow: normalizeTimeWindow(trajectory.time_window),
      }))
    : [{ id: "trajectory:path", label: "projectile", actor: "projectile", rawPoints: [{ x: 0, y: 0 }], timeWindow: null }];
  const rawPoints = rawTrajectories[0].rawPoints;
  const allRawPoints = rawTrajectories.flatMap(trajectory => trajectory.rawPoints);
  const surfaceEndpoint = (surface: NonNullable<AnimationSceneSpec["geometry"]["surfaces"]>[number], key: "from" | "to") => {
    const xy = key === "from" ? surface.from_xy : surface.to_xy;
    if (xy) return { x: xy[0], y: xy[1] };
    const pointId = key === "from" ? surface.from : surface.to;
    return pointId ? sceneSpec.geometry.points[pointId] : undefined;
  };
  const surfaceRawPoints = (sceneSpec.geometry.surfaces ?? []).flatMap(surface => [
    surfaceEndpoint(surface, "from") ?? null,
    surfaceEndpoint(surface, "to") ?? null,
  ].filter((point): point is { x: number; y: number } => Boolean(point)));
  const allCoordinatePoints = [...allRawPoints, ...Object.values(sceneSpec.geometry.points), ...surfaceRawPoints];
  const minRawX = Math.min(0, ...allCoordinatePoints.map(point => point.x));
  const minRawY = Math.min(0, ...allCoordinatePoints.map(point => point.y));
  const xOffset = minRawX < 0 ? -minRawX + 0.5 : 0;
  const yOffset = minRawY < 0 ? -minRawY + 0.5 : 0;
  const maxRawX = Math.max(1, ...allCoordinatePoints.map(point => point.x + xOffset));
  const maxRawY = Math.max(1, ...allCoordinatePoints.map(point => point.y + yOffset));
  const scale = 8 / Math.max(maxRawX, maxRawY * 1.35, 1);
  const to3 = (point: { x: number; y: number }): V3 => [(point.x + xOffset) * scale, (point.y + yOffset) * scale, 0];
  const trajectories = rawTrajectories.map(trajectory => ({
    id: trajectory.id,
    label: trajectory.label,
    actor: trajectory.actor,
    rawPoints: trajectory.rawPoints,
    points: trajectory.rawPoints.map(to3),
    timeWindow: trajectory.timeWindow,
  }));
  const trajectory = trajectories[0].points;
  const launch = to3(sceneSpec.geometry.points.launch ?? { x: 0, y: 0 });
  const landing = to3(sceneSpec.geometry.points.landing ?? rawPoints[rawPoints.length - 1] ?? { x: maxRawX, y: 0 });
  const apex = to3(sceneSpec.geometry.points.apex ?? rawPoints.reduce((best, point) => point.y > best.y ? point : best, { x: 0, y: 0 }));
  const target = sceneSpec.geometry.points.target ? to3(sceneSpec.geometry.points.target) : null;
  const impact = sceneSpec.geometry.points.impact ? to3(sceneSpec.geometry.points.impact) : null;
  const collision = sceneSpec.geometry.points.collision ? to3(sceneSpec.geometry.points.collision) : null;
  const collisionMarkers = Object.entries(sceneSpec.geometry.points)
    .filter(([id]) => id.startsWith("collision_"))
    .map(([id, point]) => ({ id, position: to3(point), label: point.label ?? "collision" }));
  const surfaces = (sceneSpec.geometry.surfaces ?? [])
    .map(surface => {
      const from = surfaceEndpoint(surface, "from");
      const to = surfaceEndpoint(surface, "to");
      if (!from || !to) return null;
      return {
        id: surface.id ?? surface.label ?? "surface",
        type: surface.type ?? "surface",
        from: to3(from),
        to: to3(to),
        label: surface.label ?? surface.id ?? "surface",
        ...(typeof surface.angle_deg === "number" ? { angleDeg: surface.angle_deg } : {}),
      };
    })
    .filter((surface): surface is SceneSurface => surface !== null);
  const positionAtTRaw = sceneSpec.geometry.points.position_at_t;
  const positionAtT = positionAtTRaw ? { position: to3(positionAtTRaw), label: positionAtTRaw.label ?? "t" } : null;
  const wallObstacle = sceneSpec.geometry.obstacles.find(item => item.type === "vertical_wall");
  const wall = typeof wallObstacle?.x === "number"
    ? { x: (wallObstacle.x + xOffset) * scale, height: (typeof wallObstacle.height === "number" ? wallObstacle.height : 0) * scale }
    : null;
  const allPoints3 = trajectories.flatMap(item => item.points);
  const baseMaxX = Math.max(1, ...allPoints3.map(point => point[0]), landing[0], wall?.x ?? 0, target?.[0] ?? 0, impact?.[0] ?? 0, collision?.[0] ?? 0);
  const maxY = Math.max(1, ...allPoints3.map(point => point[1]), apex[1], wall?.height ?? 0, target?.[1] ?? 0, impact?.[1] ?? 0, collision?.[1] ?? 0);
  const rightLabelPad = world === "height_launch" ? Math.max(0.9, baseMaxX * 0.12) : 0;
  const maxX = baseMaxX + rightLabelPad;
  const motions = (sceneSpec.motions ?? (sceneSpec.motion ? [{ actor: rawTrajectories[0].actor, ...sceneSpec.motion }] : []))
    .map(motion => ({ ...motion, timeWindow: normalizeTimeWindow(motion.time_window) }));
  const explicitEndTimes = [
    ...rawTrajectories.map(trajectory => trajectory.timeWindow?.end),
    ...motions.map(motion => motion.timeWindow?.end),
  ].filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  const totalDuration = Math.max(0.001, ...explicitEndTimes, motions[0]?.duration ?? 1);
  const sceneSpan = Math.max(maxX, maxY, 1);
  const bottomLabelPad = world === "height_launch" ? Math.max(0.45, sceneSpan * 0.08) : 0;
  const center = { x: maxX / 2, y: Math.max(0.2, maxY / 2 - bottomLabelPad), z: 0 };
  const cameraDistance = Math.max(8.0, sceneSpan * (world === "height_launch" ? 2.05 : 1.85));
  const bookmarkTarget = (targetId: string): V3 => {
    if (targetId === "scene") return [center.x, center.y, center.z];
    const rawPoint = sceneSpec.geometry.points[targetId];
    return rawPoint ? to3(rawPoint) : [center.x, center.y, center.z];
  };
  const cameraBookmarks = (sceneSpec.camera_bookmarks ?? [])
    .map(bookmark => {
      const targetPoint = bookmarkTarget(bookmark.target);
      const distance = cameraDistance / Math.max(0.5, bookmark.zoom || 1);
      return {
        id: bookmark.id,
        label: bookmark.label,
        position: [targetPoint[0], targetPoint[1], targetPoint[2] + distance] as V3,
        target: targetPoint,
        fov: bookmark.id === "full_scene" ? 38 : 30,
      };
    });
  if (!cameraBookmarks.some(bookmark => bookmark.id === "full_scene")) {
    cameraBookmarks.push({
      id: "full_scene",
      label: "Full scene",
      position: [center.x, center.y, center.z + cameraDistance],
      target: [center.x, center.y, center.z],
      fov: 38,
    });
  }
  const maxMotionSpeed = Math.max(
    1,
    ...motions.flatMap(motion => {
      const ax = motion.acceleration.x;
      const ay = motion.acceleration.y;
      const d = motion.duration;
      return [
        Math.hypot(motion.initial.vx, motion.initial.vy),
        Math.hypot(motion.initial.vx + ax * d, motion.initial.vy + ay * d),
      ];
    }),
  );
  const vectorBase = Math.max(0.56, Math.min(1.24, sceneSpan * 0.136));
  const showLandingMarker = Boolean(sceneSpec.geometry.points.landing)
    && !["incline", "two_inclines", "multi_projectile", "incline_collision"].includes(world)
    && !String(sceneSpec.geometry.points.landing?.label ?? "").toLowerCase().includes("reference");
  return {
    world,
    unknown,
    rawTrajectory: rawPoints,
    rawTrajectories,
    trajectory,
    trajectories,
    launch,
    landing,
    showLandingMarker,
    apex,
    target,
    impact,
    collision,
    collisionMarkers,
    surfaces,
    wall,
    positionAtT,
    maxY,
    center,
    theta: ((sceneSpec.quantities.theta?.value ?? 45) * Math.PI) / 180,
    motion: motions[0] ?? sceneSpec.motion,
    motions,
    liveVectors: sceneSpec.live_vectors ?? defaultLiveVectors(rawTrajectories),
    cameraBookmarks,
    totalDuration,
    velocityVectorScale: vectorBase / maxMotionSpeed,
    vectorScale: vectorBase,
    ballRadius: Math.max(0.09, Math.min(0.16, sceneSpan * 0.016)),
    axisLength: Math.max(maxX + 0.8, 2),
    groundWidth: Math.max(maxX + 1.4, 4),
    groundDepth: Math.max(2.8, Math.max(maxX, maxY) * 0.32),
    cameraDistance,
    labelLift: Math.max(0.4, sceneSpan * 0.07),
    quantities: Object.fromEntries(Object.entries(sceneSpec.quantities).map(([key, value]) => [key, value.value])) as Record<string, number>,
  };
}

function actorLabel(actor: string) {
  if (actor === "projectile_p") return "P";
  if (actor === "slider_q") return "Q";
  return actor
    .replace(/^projectile_?/i, "")
    .replace(/_/g, " ")
    .trim()
    .toUpperCase() || "projectile";
}

function defaultLiveVectors(trajectories: Array<{ actor: string }>): SceneLiveVector[] {
  const actors = trajectories.length ? trajectories.map(item => item.actor) : ["projectile"];
  return actors.flatMap(actor => [
    { id: `${actor}:v`, actor, kind: "velocity", component: "velocity", anchor: "current_position", label: "v(t)" },
    { id: `${actor}:vx`, actor, kind: "component", component: "x_velocity", anchor: "current_position", label: "v_x" },
    { id: `${actor}:vy`, actor, kind: "component", component: "y_velocity", anchor: "current_position", label: "v_y" },
    { id: `${actor}:a`, actor, kind: "acceleration", component: "acceleration", anchor: "current_position", label: "g" },
  ]);
}

function activeStoryboardStep(sceneSpec: AnimationSceneSpec, stepId: string): StoryboardStep | null {
  const storyboard = sceneSpec.storyboard ?? [];
  if (!storyboard.length) return null;
  return storyboard.find(step => step.step_id === stepId) ?? storyboard[0];
}

function teachingVectorStoryboardStep(
  sceneSpec: AnimationSceneSpec,
  currentStepId: string | undefined,
  options: { accumulate: boolean; revealIds: string[]; highlightIds: string[] },
): StoryboardStep | null {
  const storyboard = sceneSpec.storyboard ?? [];
  if (!storyboard.length || !currentStepId) return null;
  const currentIndex = Math.max(0, storyboard.findIndex(step => step.step_id === currentStepId));
  const currentStep = storyboard[currentIndex] ?? storyboard[0];
  const includedSteps = options.accumulate ? storyboard.slice(0, currentIndex + 1) : [currentStep];
  const currentVectors = vectorIdsForStoryboardStep(currentStep);
  const visibleVectors = uniqueStrings(includedSteps.flatMap(vectorIdsForStoryboardStep).filter(id => id !== "__none__"));
  const previousVectors = uniqueStrings(
    (options.accumulate ? storyboard.slice(0, currentIndex).flatMap(vectorIdsForStoryboardStep) : [])
      .filter(id => id !== "__none__"),
  );
  const currentHighlightIds = uniqueStrings([
    ...(currentStep.visual_state?.highlight_ids ?? currentStep.highlight_ids ?? []),
    ...options.highlightIds,
  ]);
  return {
    ...currentStep,
    visible_vectors: visibleVectors,
    labels: dedupeLabels(includedSteps.flatMap(step => step.labels ?? [])),
    visual_state: {
      ...(currentStep.visual_state ?? {}),
      visible_vectors: visibleVectors,
      highlight_ids: currentHighlightIds,
      label_ids: uniqueStrings([
        ...(currentStep.visual_state?.label_ids ?? []),
      ]),
      dimmed_ids: uniqueStrings([
        ...(currentStep.visual_state?.dimmed_ids ?? []),
        ...previousVectors,
      ]),
    },
  };
}

function lifecycleVectorStoryboardStep(model: ReturnType<typeof buildSceneModel>): StoryboardStep | null {
  const lifecycleVectors = model.liveVectors.filter(vector => {
    if (vector.kind === "axis") return false;
    return (
      vector.component === "velocity"
      || vector.component === "x_velocity"
      || vector.component === "y_velocity"
      || vector.component === "velocity_tangent"
      || vector.component === "velocity_normal"
    );
  });
  const visibleVectors = uniqueStrings(lifecycleVectors.map(vector => vector.id));
  if (!visibleVectors.length) return null;
  return {
    step_id: "__full_lifecycle_vectors",
    camera: "full_scene",
    visible_vectors: visibleVectors,
    overlays: [],
    visual_focus: visibleVectors,
    highlight_ids: visibleVectors.filter(id => id.endsWith(":v")),
    labels: lifecycleVectors.map(vector => ({
      target_id: vector.id,
      text: lifecycleVectorLabel(vector),
    })),
    visual_state: {
      visible_vectors: visibleVectors,
      label_ids: visibleVectors,
      highlight_ids: visibleVectors.filter(id => id.endsWith(":v")),
      dimmed_ids: [],
    },
    why: "Full lifecycle keeps velocity vectors visible while the projectile moves.",
  };
}

function lifecycleVectorLabel(vector: SceneLiveVector) {
  if (vector.component === "velocity") return "v";
  if (vector.component === "x_velocity") return "vₓ";
  if (vector.component === "y_velocity") return "vᵧ";
  if (vector.component === "velocity_tangent") return "vₜ";
  if (vector.component === "velocity_normal") return "vₙ";
  return vector.label || vector.id;
}

function vectorIdsForStoryboardStep(step: StoryboardStep | null | undefined) {
  if (!step) return [];
  return step.visual_state?.visible_vectors ?? step.visible_vectors ?? [];
}

function dedupeLabels(labels: NonNullable<StoryboardStep["labels"]>) {
  const seen = new Set<string>();
  return labels.filter(label => {
    const key = `${label.target_id}:${label.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activeCameraBookmark(model: ReturnType<typeof buildSceneModel>, cameraId: string): CameraBookmark {
  return (
    model.cameraBookmarks.find(bookmark => bookmark.id === cameraId)
    ?? model.cameraBookmarks.find(bookmark => bookmark.id === "full_scene")
    ?? {
      id: "full_scene",
      label: "Full scene",
      position: [model.center.x, model.center.y, model.center.z + model.cameraDistance],
      target: [model.center.x, model.center.y, model.center.z],
      fov: 38,
    }
  );
}

function shouldShowMarker(
  model: ReturnType<typeof buildSceneModel>,
  marker: "apex",
  storyboardStep: StoryboardStep | null,
  isFullLifecycle: boolean,
) {
  if (isFullLifecycle) return true;
  const focus = new Set(storyboardStep?.visual_focus ?? []);
  const overlays = new Set(storyboardStep?.overlays ?? []);
  if (marker === "apex") {
    if (pointsNearlyCoincident(model.apex, model.launch, model.ballRadius * 1.8)) return false;
    return focus.has("event:apex") || focus.has("quantity:H") || overlays.has("show_height_marker") || model.world === "split_at_apex";
  }
  return false;
}

function requestedVisualQuantities(unknown: string, engineCase: string) {
  const source = `${unknown} ${engineCase}`.toLowerCase();
  const isMulti = /multi|and_time|range_time|range_and_time|range_time_height/.test(source);
  const asksVelocity = /velocity|speed|component|delta_v|change_in_velocity/.test(source);
  return {
    range: isMulti || /range|distance|horizontal_range/.test(source),
    height: isMulti || /height|apex|peak/.test(source),
    time: isMulti || /time|flight|duration/.test(source),
    velocity: isMulti || asksVelocity,
  };
}

function manualCameraBookmark(model: ReturnType<typeof buildSceneModel>, target: V3, label: string): CameraBookmark {
  const distance = Math.max(1.8, model.cameraDistance / 3.2);
  return {
    id: `manual:${label}:${target.map(value => value.toFixed(2)).join(",")}`,
    label,
    position: [target[0], target[1], target[2] + distance],
    target,
    fov: 24,
  };
}

function visibleLiveVectors(
  model: ReturnType<typeof buildSceneModel>,
  storyboardStep: StoryboardStep | null,
  progress: number,
  revealIds: string[] = [],
) {
  const revealPatterns = revealIds.flatMap(sceneIdToVectorPatterns);
  const storyboardPatterns = storyboardStep
    ? (storyboardStep.visual_state?.visible_vectors ?? storyboardStep.visible_vectors ?? [])
    : [];
  const revealVectorPatterns = revealPatterns.filter(pattern =>
    model.liveVectors.some(vector => vectorPatternMatches(pattern, vector.id)),
  );
  const patterns = Array.from(new Set([...storyboardPatterns, ...revealVectorPatterns]));
  const globalTime = progress * model.totalDuration;
  return model.liveVectors.filter(vector => {
    const trajectory = model.trajectories.find(item => item.actor === vector.actor);
    if (trajectory && phaseState(trajectory.timeWindow, globalTime).status !== "active") return false;
    return patterns.some(pattern => vectorPatternMatches(pattern, vector.id));
  });
}

function labelOverrideForVector(storyboardStep: StoryboardStep | null, vectorId: string) {
  const contract = contractForStep(storyboardStep);
  const contractLabel = contractLabelsForTarget(contract, vectorId);
  if (contractLabel) return contractLabel;
  const labels = storyboardStep?.labels ?? [];
  const match = labels.find(label => label.target_id === vectorId);
  if (match?.text) return match.text;
  const vectorSemanticMatch = labels.find(label => labelMatchesVector(String(label.target_id || ""), vectorId));
  if (vectorSemanticMatch?.text) return vectorSemanticMatch.text;
  const ids = [
    ...(storyboardStep?.visual_state?.visible_ids ?? []),
    ...(storyboardStep?.visual_state?.highlight_ids ?? []),
    ...(storyboardStep?.visual_state?.label_ids ?? []),
    ...(storyboardStep?.highlight_ids ?? []),
  ].join(" ").toLowerCase();
  if (contractForbids(contract, "u_cos_theta") && vectorId.endsWith(":vx")) return undefined;
  if (contractForbids(contract, "u_sin_theta") && vectorId.endsWith(":vy")) return undefined;
  if (vectorId.endsWith(":vx") && /\b(quantity:ux|vector:ux|ux)\b/.test(ids)) return "uₓ = u cosθ";
  if (vectorId.endsWith(":vy") && /\b(quantity:uy|vector:uy|uy)\b/.test(ids)) return "uᵧ = u sinθ";
  return undefined;
}

function shouldDimVector(vector: SceneLiveVector, storyboardStep: StoryboardStep | null, highlightIds: string[]) {
  const dimmedIds = storyboardStep?.visual_state?.dimmed_ids ?? [];
  if (dimmedIds.flatMap(sceneIdToVectorPatterns).some(pattern => vectorPatternMatches(pattern, vector.id))) return true;
  if (storyboardStep?.visual_action !== "compare_incline_motion") return false;
  if (!highlightIds.some(id => id.includes("normal_axis"))) return false;
  return vector.component === "gravity_tangent" || vector.component === "incline_tangent";
}

function shouldShowVectorLabel(vector: SceneLiveVector, storyboardStep: StoryboardStep | null, highlightIds: string[]) {
  if (labelOverrideForVector(storyboardStep, vector.id)) return true;
  if (matchesAnySceneId(highlightIds, vector.id)) return true;
  if (vector.kind === "axis") return true;
  const labelIds = storyboardStep?.visual_state?.label_ids ?? [];
  if (labelIds.flatMap(sceneIdToVectorPatterns).some(pattern => vectorPatternMatches(pattern, vector.id))) return true;
  return false;
}

function labelMatchesVector(targetId: string, vectorId: string) {
  if (!targetId) return false;
  return sceneIdToVectorPatterns(targetId).some(pattern => vectorPatternMatches(pattern, vectorId));
}

function matchesAnySceneId(sceneIds: string[], vectorId: string) {
  if (!sceneIds.length) return false;
  return sceneIds.flatMap(sceneIdToVectorPatterns).some(pattern => vectorPatternMatches(pattern, vectorId));
}

function emphasisColor(ids: string[]) {
  const normalized = ids.map(id => id.toLowerCase());
  if (normalized.includes("emphasis:target")) return COLORS.target;
  if (normalized.includes("emphasis:given")) return COLORS.given;
  return undefined;
}

function pointHighlightColor(pointIds: string[], activeIds: string[], fallback: string, activeColor?: string) {
  if (!activeColor) return fallback;
  const normalized = new Set(activeIds.map(id => id.toLowerCase()));
  return pointIds.some(id => normalized.has(id.toLowerCase())) ? activeColor : fallback;
}

function surfaceHighlightColor(surface: SceneSurface, activeIds: string[], activeColor?: string) {
  if (!activeColor) return undefined;
  const normalized = activeIds.map(id => id.toLowerCase());
  const surfaceTokens = [
    surface.id.toLowerCase(),
    surface.type.toLowerCase(),
    `surface:${surface.id}`.toLowerCase(),
    surface.type === "inclined_plane" ? "surface:inclined_plane" : "",
  ].filter(Boolean);
  return normalized.some(id => surfaceTokens.includes(id) || (surface.type === "inclined_plane" && id.includes("incline"))) ? activeColor : undefined;
}

function sceneIdToVectorPatterns(id: string) {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return [];
  if (normalized.startsWith("emphasis:")) return [];
  if (normalized.startsWith("*:")) return [normalized];
  if (normalized === "velocity:x_component" || normalized === "velocity:horizontal_component") return ["*:vx"];
  if (normalized === "velocity:y_component" || normalized === "velocity:vertical_component") return ["*:vy"];
  if (normalized === "velocity:impact_x_component") return ["*:vx"];
  if (normalized === "velocity:impact_y_component") return ["*:vy"];
  if (normalized === "velocity:impact" || normalized === "velocity:resultant") return ["*:v"];
  if (normalized === "gravity:tangent_component" || normalized.includes("gravity_tangent")) return ["*:gravity_tangent_component"];
  if (normalized === "gravity:normal_component" || normalized.includes("gravity_normal")) return ["*:gravity_normal_component"];
  if (normalized === "velocity:tangent_component" || normalized.includes("velocity_tangent")) return ["*:velocity_tangent_component"];
  if (normalized === "velocity:normal_component" || normalized.includes("velocity_normal")) return ["*:velocity_normal_component"];
  if (normalized.includes(":gravity_")) return [id];
  if (normalized.startsWith("gravity:") || normalized.startsWith("velocity:")) return [id];
  if (normalized.includes("normal_axis")) return ["incline:normal_axis"];
  if (normalized.includes("tangent_axis") || normalized.includes("parallel") || normalized.includes("along")) return ["incline:tangent_axis"];
  if (normalized === "quantity:u" || normalized === "vector:u" || normalized === "vector:v" || normalized.endsWith(":v") || normalized.includes("initial_velocity") || normalized.includes("projection_speed")) return ["*:v"];
  if (normalized === "vector:vx" || normalized === "vector:ux" || normalized.includes("quantity:ux") || normalized.includes("quantity:vx") || normalized.endsWith(":vx")) return ["*:vx"];
  if (normalized === "vector:vy" || normalized === "vector:uy" || normalized.includes("quantity:uy") || normalized.includes("quantity:vy") || normalized.endsWith(":vy")) return ["*:vy"];
  if (normalized === "vector:g" || normalized.includes("gravity") || normalized.endsWith(":a")) return ["*:a"];
  return [id];
}

function vectorPatternMatches(pattern: string, vectorId: string) {
  if (pattern === vectorId) return true;
  if (pattern.startsWith("*:")) return vectorId.endsWith(pattern.slice(1));
  return false;
}

function resolveLiveVector(vector: SceneLiveVector, model: ReturnType<typeof buildSceneModel>, progress: number, emphasized = false) {
  const trajectory = model.trajectories.find(item => item.actor === vector.actor) ?? model.trajectories[0];
  const localProgress = actorLocalProgress(model, vector.actor, progress);
  const baseAnchor = model.world === "height_launch" && vector.component === "acceleration"
    ? heightLaunchGravityAnchor(model)
    : vector.anchor === "launch"
    ? model.launch
    : samplePoint(trajectory?.points ?? model.trajectory, localProgress);
  const motion = liveMotionForActor(model, vector.actor, progress);
  const emphasisScale = emphasized ? 1.22 : 1;
  const scale = (vector.kind === "acceleration" ? model.vectorScale * 0.78 : model.vectorScale) * emphasisScale;
  let components: { x: number; y: number } | null = null;
  if (vector.component === "velocity") components = { x: motion.vx, y: motion.vy };
  if (vector.component === "x_velocity") components = { x: motion.vx, y: 0 };
  if (vector.component === "y_velocity") components = { x: 0, y: motion.vy };
  if (vector.component === "acceleration") components = { x: motion.ax, y: motion.ay };
  if (
    vector.component === "incline_tangent"
    || vector.component === "incline_normal"
    || vector.component === "gravity_tangent"
    || vector.component === "gravity_normal"
    || vector.component === "velocity_tangent"
    || vector.component === "velocity_normal"
  ) {
    const surface = model.surfaces.find(item => item.type === "inclined_plane") ?? model.surfaces[0];
    if (!surface) return null;
    const dx = surface.to[0] - surface.from[0];
    const dy = surface.to[1] - surface.from[1];
    const mag = Math.hypot(dx, dy) || 1;
    const tangent = { x: dx / mag, y: dy / mag };
    const normal = { x: -tangent.y, y: tangent.x };
    if (vector.component === "incline_tangent") components = tangent;
    if (vector.component === "incline_normal") components = normal;
    if (vector.component === "gravity_tangent") {
      const projection = motion.ax * tangent.x + motion.ay * tangent.y;
      components = { x: projection * tangent.x, y: projection * tangent.y };
    }
    if (vector.component === "gravity_normal") {
      const projection = motion.ax * normal.x + motion.ay * normal.y;
      components = { x: projection * normal.x, y: projection * normal.y };
    }
    if (vector.component === "velocity_tangent") {
      const projection = motion.vx * tangent.x + motion.vy * tangent.y;
      components = { x: projection * tangent.x, y: projection * tangent.y };
    }
    if (vector.component === "velocity_normal") {
      const projection = motion.vx * normal.x + motion.vy * normal.y;
      components = { x: projection * normal.x, y: projection * normal.y };
    }
  }
  if (!components) return null;
  const anchor = offsetVectorAnchor(baseAnchor, vector, model, components, localProgress);
  const color = vectorColor(vector);
  const useMagnitudeScale = vector.component === "velocity" || vector.component === "x_velocity" || vector.component === "y_velocity";
  const velocityMinLength = vector.component === "y_velocity"
    ? model.vectorScale * 0.18 * emphasisScale
    : model.vectorScale * 0.62 * emphasisScale;
  const rawTo = useMagnitudeScale
    ? vectorFromComponentsScaled(anchor, components.x, components.y, model.velocityVectorScale * emphasisScale, model.vectorScale * 1.9 * emphasisScale, velocityMinLength)
    : vectorFromComponents(anchor, components.x, components.y, scale);
  const clearedVector = keepInstructionalVectorAbovePlatform(anchor, rawTo, model, vector.component);
  return {
    from: clearedVector.from,
    to: clearedVector.to,
    color,
    label: formatVectorLabel(vector.label, vector.component, localProgress),
  };
}

function heightLaunchGravityAnchor(model: ReturnType<typeof buildSceneModel>): V3 {
  const sideOffset = Math.max(0.72, model.vectorScale * 1.55);
  const topInset = Math.max(0.18, model.vectorScale * 0.42);
  return [
    model.launch[0] + sideOffset,
    Math.max(model.vectorScale * 1.2, model.launch[1] - topInset),
    model.launch[2] + 0.04,
  ];
}

function keepInstructionalVectorAbovePlatform(from: V3, to: V3, model: ReturnType<typeof buildSceneModel>, component: string): { from: V3; to: V3 } {
  if (component !== "velocity" && component !== "x_velocity" && component !== "y_velocity") {
    return { from, to };
  }
  if (to[1] >= 0) return { from, to };
  const maxBelowGround = Math.max(model.vectorScale * 1.18, model.ballRadius * 7.2);
  const lowerVisibleY = -maxBelowGround;
  if (to[1] >= lowerVisibleY) return { from, to };
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dy) < 0.0001) return { from, to };
  const factor = Math.max(0.22, Math.min(1, (lowerVisibleY - from[1]) / dy));
  return {
    from,
    to: [from[0] + dx * factor, lowerVisibleY, to[2]],
  };
}

function offsetVectorAnchor(anchor: V3, vector: SceneLiveVector, model: ReturnType<typeof buildSceneModel>, components: { x: number; y: number }, progress: number): V3 {
  const actorIndex = Math.max(0, model.trajectories.findIndex(item => item.actor === vector.actor));
  const actorCount = Math.max(1, model.trajectories.length);
  const isStableTeachingVector = vector.anchor === "launch"
    || vector.component === "gravity_tangent"
    || vector.component === "gravity_normal"
    || vector.component === "incline_tangent"
    || vector.component === "incline_normal";
  const actorSpread = actorCount > 1 && isStableTeachingVector
    ? (actorIndex - (actorCount - 1) / 2) * model.ballRadius * 4.9
    : 0;
  const componentSpread = isBallAttachedVelocityComponent(vector.component)
    ? 0
    : componentAnchorSpread(vector.component, model.vectorScale);
  const length = Math.hypot(components.x, components.y) || 1;
  const px = -components.y / length;
  const py = components.x / length;
  return [
    anchor[0] + actorSpread + px * componentSpread,
    anchor[1] + Math.abs(actorSpread) * 0.18 + py * componentSpread,
    anchor[2],
  ];
}

function componentAnchorSpread(component: string, vectorScale: number) {
  if (component === "gravity_tangent") return vectorScale * 0.84;
  if (component === "gravity_normal") return vectorScale * -0.84;
  if (component === "velocity_tangent") return vectorScale * 0.72;
  if (component === "velocity_normal") return vectorScale * -0.72;
  return 0;
}

function isBallAttachedVelocityComponent(component: string) {
  return component === "velocity" || component === "x_velocity" || component === "y_velocity";
}

function vectorColor(vector: SceneLiveVector) {
  if (vector.component === "x_velocity") return COLORS.vx;
  if (vector.component === "y_velocity") return COLORS.vy;
  if (vector.component === "acceleration") return COLORS.acceleration;
  if (vector.component === "gravity_tangent" || vector.component === "gravity_normal") return COLORS.acceleration;
  if (vector.component === "velocity_tangent" || vector.component === "velocity_normal") return COLORS.velocity;
  if (vector.kind === "axis") return COLORS.axis;
  return COLORS.velocity;
}

function liveVariableRows(model: ReturnType<typeof buildSceneModel>, progress: number) {
  const motion = liveMotionAt(model, progress);
  const speed = Math.hypot(motion.vx, motion.vy);
  const rows = [
    finiteQuantityRow(model, "u", "u", "m/s"),
    finiteQuantityRow(model, "v0", "u", "m/s"),
    finiteQuantityRow(model, "theta", "θ", "°"),
    finiteQuantityRow(model, "angle", "θ", "°"),
    { key: "g", label: "g", value: `${formatNumber(Math.abs(model.motion?.acceleration.y ?? -(model.quantities.g ?? 10)))} m/s²`, dynamic: false },
    { key: "t", label: "t", value: `${formatNumber(motion.t)} s`, dynamic: true },
    { key: "x", label: "x", value: `${formatNumber(motion.x)} m`, dynamic: true },
    { key: "y", label: "y", value: `${formatNumber(motion.y)} m`, dynamic: true },
    { key: "vx", label: "vₓ", value: `${formatNumber(motion.vx)} m/s`, dynamic: true },
    { key: "vy", label: "vᵧ", value: `${formatNumber(motion.vy)} m/s`, dynamic: true },
    { key: "v", label: "|v|", value: `${formatNumber(speed)} m/s`, dynamic: true },
    finiteQuantityRow(model, "R", "R", "m"),
    finiteQuantityRow(model, "H", "H", "m"),
    finiteQuantityRow(model, "T", "T", "s"),
  ].filter((row): row is { key: string; label: string; value: string; dynamic: boolean } => row !== null && !row.value.includes("NaN"));
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.label)) return false;
    seen.add(row.label);
    return true;
  });
}

function finiteQuantityRow(model: ReturnType<typeof buildSceneModel>, key: string, label: string, unit: string) {
  const value = model.quantities[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return { key, label, value: `${formatNumber(value)}${unit === "°" ? "°" : ` ${unit}`}`, dynamic: false };
}

function liveMotionAt(model: ReturnType<typeof buildSceneModel>, progress: number) {
  const actor = model.rawTrajectories[0]?.actor ?? model.motions[0]?.actor ?? "projectile";
  return liveMotionForActor(model, actor, progress);
}

function impactAngleGeometry(model: ReturnType<typeof buildSceneModel>) {
  const motion = liveMotionForActor(model, model.rawTrajectories[0]?.actor ?? "projectile", 1);
  if (!Number.isFinite(motion.vx) || !Number.isFinite(motion.vy) || Math.abs(motion.vx) < 1e-9) return null;
  const origin = model.landing ?? model.impact ?? samplePoint(model.trajectory, 1);
  const angle = Math.atan2(motion.vy, motion.vx);
  if (!Number.isFinite(angle)) return null;
  return {
    origin,
    angle,
    degrees: Math.abs(angle * 180 / Math.PI),
  };
}

function liveMotionForActor(model: ReturnType<typeof buildSceneModel>, actor: string, progress: number) {
  const clamped = actorLocalProgress(model, actor, progress);
  const rawTrajectory = model.rawTrajectories.find(item => item.actor === actor)?.rawPoints ?? model.rawTrajectory;
  const fallbackPoint = sampleRawPoint(rawTrajectory, clamped);
  const motion = model.motions.find(item => item.actor === actor) ?? model.motion;
  if (!motion) {
    const totalTime = model.quantities.T ?? 0;
    const t = totalTime * clamped;
    const vx = model.quantities.ux ?? 0;
    const uy = model.quantities.uy ?? 0;
    const g = model.quantities.g ?? 10;
    return { t, x: fallbackPoint.x, y: fallbackPoint.y, vx, vy: uy - g * t, ax: 0, ay: -g };
  }
  const t = motion.duration * clamped;
  const { initial, acceleration } = motion;
  return {
    t,
    x: initial.x + initial.vx * t + 0.5 * acceleration.x * t * t,
    y: initial.y + initial.vy * t + 0.5 * acceleration.y * t * t,
    vx: initial.vx + acceleration.x * t,
    vy: initial.vy + acceleration.y * t,
    ax: acceleration.x,
    ay: acceleration.y,
  };
}

function actorLocalProgress(model: ReturnType<typeof buildSceneModel>, actor: string, progress: number) {
  const globalTime = Math.max(0, Math.min(1, progress)) * model.totalDuration;
  const trajectory = model.trajectories.find(item => item.actor === actor);
  if (trajectory?.timeWindow) return phaseState(trajectory.timeWindow, globalTime).localProgress;
  const motion = model.motions.find(item => item.actor === actor);
  if (motion?.timeWindow) return phaseState(motion.timeWindow, globalTime).localProgress;
  return Math.max(0, Math.min(1, progress));
}

function normalizeTimeWindow(timeWindow?: { start?: number; end?: number } | null) {
  if (!timeWindow) return null;
  const start = typeof timeWindow.start === "number" && Number.isFinite(timeWindow.start) ? timeWindow.start : 0;
  const end = typeof timeWindow.end === "number" && Number.isFinite(timeWindow.end) ? timeWindow.end : start;
  return { start, end: Math.max(start + 0.001, end) };
}

function phaseState(timeWindow: { start: number; end: number } | null, globalTime: number) {
  if (!timeWindow) {
    return {
      status: "active" as const,
      localProgress: Math.max(0, Math.min(1, globalTime)),
    };
  }
  const duration = Math.max(0.001, timeWindow.end - timeWindow.start);
  const localProgress = Math.max(0, Math.min(1, (globalTime - timeWindow.start) / duration));
  if (globalTime < timeWindow.start) return { status: "pending" as const, localProgress };
  if (globalTime > timeWindow.end) return { status: "complete" as const, localProgress };
  return { status: "active" as const, localProgress };
}

function sampleRawPoint(path: Array<{ x: number; y: number; t?: number }>, progress: number) {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (path.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(path.length - 1, left + 1);
  const local = scaled - left;
  return {
    x: path[left].x + (path[right].x - path[left].x) * local,
    y: path[left].y + (path[right].y - path[left].y) * local,
  };
}

function samplePoint(path: V3[], progress: number): V3 {
  if (path.length === 0) return [0, 0, 0];
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (path.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(path.length - 1, left + 1);
  const local = scaled - left;
  return [
    path[left][0] + (path[right][0] - path[left][0]) * local,
    path[left][1] + (path[right][1] - path[left][1]) * local,
    path[left][2] + (path[right][2] - path[left][2]) * local,
  ];
}

function vectorFromComponents(from: V3, vx: number, vy: number, length: number): V3 {
  const norm = Math.max(0.0001, Math.sqrt(vx * vx + vy * vy));
  return [from[0] + (vx / norm) * length, from[1] + (vy / norm) * length, from[2]];
}

function vectorFromComponentsScaled(from: V3, vx: number, vy: number, scale: number, maxLength: number, minLength: number): V3 {
  const dx = vx * scale;
  const dy = vy * scale;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return from;
  const targetLength = Math.max(minLength, Math.min(maxLength, length));
  const factor = targetLength / length;
  return [from[0] + dx * factor, from[1] + dy * factor, from[2]];
}

function formatVectorLabel(label: string, component?: string, progress = 1) {
  if (component === "velocity") return progress < 0.03 ? "u" : "v";
  if (component === "x_velocity") return progress < 0.03 ? "uₓ" : "vₓ";
  if (component === "y_velocity") return progress < 0.03 ? "uᵧ" : "vᵧ";
  if (component === "acceleration") return "g";
  if (component === "incline_tangent") return "vₜ";
  if (component === "incline_normal") return "vₙ";
  return label;
}

function vectorSymbolLegend(world: string) {
  const base = "v: velocity · vₓ: horizontal · vᵧ: vertical";
  return world === "incline" || world === "incline_collision" || world === "two_inclines"
    ? `${base} · vₜ: along plane · vₙ: normal`
    : base;
}

function vectorLabelPlacement(from: V3, to: V3, component: string, labelLift: number, text: string): { position: V3; anchor: SceneLabelAnchor } {
  const seed = seedVectorLabelPosition(from, to, component, labelLift);
  const anchor = vectorLabelAnchor(from, to, component);
  const authorityAnchor = anchor === "center" ? "middle" : anchor === "end" ? "end" : "start";
  const ui = Math.max(0.18, labelLift * 0.34);
  const pad = Math.max(0.14, ui * 0.64);
  const lockToArrowhead = isBallAttachedVelocityComponent(component);
  const minX = Math.min(from[0], to[0], seed[0]) - Math.max(1.0, labelLift * 1.8);
  const maxX = Math.max(from[0], to[0], seed[0]) + Math.max(1.0, labelLift * 1.8);
  const minY = Math.min(from[1], to[1], seed[1]) - Math.max(0.72, labelLift * 1.4);
  const maxY = Math.max(from[1], to[1], seed[1]) + Math.max(0.72, labelLift * 1.4);
  const authority = createLabelPlacementAuthority({
    bounds: { minX, maxX, minY, maxY },
    ui,
    initialOccupied: lockToArrowhead ? [] : [
      segmentBox({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, pad),
      pointBox({ x: from[0], y: from[1] }, pad * 1.45),
      pointBox({ x: to[0], y: to[1] }, pad * 1.6),
    ],
  });
  const [placed] = authority.place([{
    key: `scene-vector-label:${component}:${text}`,
    text,
    x: seed[0],
    y: seed[1],
    size: Math.max(0.12, ui * 0.7),
    anchor: authorityAnchor,
    priority: 100,
    leaderFrom: { x: to[0], y: to[1] },
    locked: lockToArrowhead,
  }]);
  return {
    position: [placed?.x ?? seed[0], placed?.y ?? seed[1], seed[2]],
    anchor,
  };
}

function seedVectorLabelPosition(from: V3, to: V3, component: string, labelLift: number): V3 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return [to[0], to[1], to[2] + 0.04];

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const forward = Math.max(0.1, labelLift * 0.18);
  const side = Math.max(0.32, labelLift * 0.56);
  if (component === "x_velocity" && Math.abs(ux) > 0.72) {
    return [
      to[0] + ux * forward,
      to[1] + uy * forward + Math.max(0.08, labelLift * 0.16),
      to[2] + 0.06,
    ];
  }
  if (component === "y_velocity" && uy < -0.2) {
    return [
      to[0] + Math.max(0.08, labelLift * 0.16),
      to[1] + uy * forward,
      to[2] + 0.06,
    ];
  }
  const along = vectorLabelAlongOffset(component, ux, uy, forward);
  const sideSign = vectorLabelSideSign(component, ux, uy);

  return [
    to[0] + ux * along + nx * side * sideSign,
    to[1] + uy * along + ny * side * sideSign,
    to[2] + 0.06,
  ];
}

function vectorLabelAlongOffset(component: string, ux: number, uy: number, forward: number) {
  if (
    uy < -0.2
    && (component === "y_velocity" || component === "acceleration" || component === "incline_normal")
  ) {
    return -Math.max(0.42, forward * 1.6);
  }
  return forward;
}

function vectorLabelSideSign(component: string, ux: number, uy: number) {
  if (component === "x_velocity" || component === "incline_tangent") {
    return ux < 0 ? -1 : 1;
  }
  if (component === "y_velocity" || component === "acceleration" || component === "incline_normal") {
    return uy > 0 ? -1 : 1;
  }
  return 1;
}

function vectorLabelAnchor(from: V3, to: V3, component?: string): SceneLabelAnchor {
  if (component === "x_velocity") return to[0] < from[0] ? "end" : "start";
  if (component === "y_velocity") return "start";
  return to[0] < from[0] ? "end" : "start";
}

function hasFiniteQuantity(model: ReturnType<typeof buildSceneModel>, key: string) {
  return typeof model.quantities[key] === "number" && Number.isFinite(model.quantities[key]);
}

function formatNumber(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Math.abs(value) >= 100 ? value.toFixed(0) : Number(value.toFixed(3)).toString();
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function pointsNearlyCoincident(a: V3, b: V3, tolerance: number) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tolerance;
}
