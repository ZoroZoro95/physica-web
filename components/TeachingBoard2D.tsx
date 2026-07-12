"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { contractForbids, contractForStep, contractLabelsForTarget, type BeatVisualSpec } from "@/types/visualContract";
import {
  boxesOverlap,
  createLabelPlacementAuthority,
  labelBox,
  labelWidth,
  normalize2,
  overlapArea,
  placeLabels,
  pointBox,
  segmentBox,
  validBox,
  type LabelAnchor,
  type LabelBox,
  type LabelCandidate,
  type PlacedLabel,
} from "@/utils/labelEngine";

type Point2 = { x: number; y: number; label?: string; t?: number };

type SceneSpec2D = {
  problem: { world: string; unknown: string; engine_case: string };
  geometry: {
    points: Record<string, Point2>;
    surfaces?: Array<Record<string, unknown>>;
    obstacles?: Array<Record<string, unknown>>;
  };
  trajectories?: Array<{
    id?: string;
    actor?: string;
    sampled_points: Point2[];
    time_window?: { start: number; end: number };
  }>;
  motions?: Array<{
    actor: string;
    initial: { x: number; y: number; vx: number; vy: number };
    acceleration: { x: number; y: number };
    duration: number;
    time_window?: { start: number; end: number };
  }>;
  motion?: {
    initial: { x: number; y: number; vx: number; vy: number };
    acceleration: { x: number; y: number };
    duration: number;
  };
  actors?: Array<{
    id: string;
    type?: string;
    label?: string;
  }>;
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
    beat_visual_spec?: BeatVisualSpec;
    title?: string;
    formula?: string;
    equation?: string;
    explanation?: string;
    visual_action?: string;
    visible_vectors?: string[];
    overlays?: string[];
    visual_focus?: string[];
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
  }>;
  quantities?: Record<string, { value: number; unit: string; label: string }>;
};

type TeachingBoard2DProps = {
  sceneSpec: SceneSpec2D;
  stepId: string;
  animationProgress: number;
  revealIds?: string[];
  highlightIds?: string[];
  mode: "concept" | "event";
  actorFilter?: string;
  answerText?: string | null;
};

type ResolvedVector = {
  from: Point2;
  to: Point2;
  labelOffset: Point2;
};

type VectorCandidate = ResolvedVector & {
  laneCost: number;
  lengthCost: number;
  labelSideCost: number;
};

type VectorDrawing = {
  vector: NonNullable<SceneSpec2D["live_vectors"]>[number];
  drawn: ResolvedVector;
  dimmed: boolean;
  highlighted: boolean;
  color: string;
  label: string;
  showLabel: boolean;
  mid: Point2;
};

type PointLabelEntry = {
  id: string;
  point: Point2;
  text: string;
  priority: number;
};

const C = {
  bg: "#fbfaf4",
  grid: "rgba(23,36,43,0.05)",
  surface: "#17242b",
  mutedSurface: "rgba(23,36,43,0.34)",
  path: "#17242b",
  pathGhost: "rgba(23,36,43,0.18)",
  ball: "#17242b",
  ball2: "#51636a",
  vector: "#17242b",
  vx: "#17242b",
  vy: "#17242b",
  gravity: "#17242b",
  highlight: "#c2410c",
  dim: "rgba(23,36,43,0.26)",
  text: "#17242b",
  muted: "#51636a",
};

export default function TeachingBoard2D({
  sceneSpec,
  stepId,
  animationProgress,
  revealIds = [],
  highlightIds = [],
  mode,
  actorFilter,
  answerText,
}: TeachingBoard2DProps) {
  const renderSceneSpec = useMemo(() => actorFilter ? scopedSceneForActor(sceneSpec, actorFilter) : sceneSpec, [sceneSpec, actorFilter]);
  const trajectories = normalizedTrajectories(renderSceneSpec);
  const storyboardStep = renderSceneSpec.storyboard?.find(step => step.step_id === stepId) ?? renderSceneSpec.storyboard?.[0];
  const visualState = storyboardStep?.visual_state ?? {};
  const activeHighlightIds = unique([...(visualState.highlight_ids ?? []), ...highlightIds]);
  const rawVisibleVectorPatterns = unique([
    ...(visualState.visible_vectors ?? storyboardStep?.visible_vectors ?? []),
  ]);
  const visibleVectorPatterns = filteredTeachingVectorPatterns(rawVisibleVectorPatterns, stepId, visualState, activeHighlightIds, revealIds);
  const labelIds = unique([...(visualState.label_ids ?? [])]);
  const dimmedIds = visualState.dimmed_ids ?? [];
  const boardBadges = boardBadgesForStep(renderSceneSpec, stepId, visualState, activeHighlightIds, revealIds);
  const isConceptBoard = mode === "concept";
  const hasVectorFocus = visibleVectorPatterns.some(pattern => pattern !== "__none__");
  const supportsTextbookTemplate = isTextbookTemplateWorld(renderSceneSpec.problem.world, renderSceneSpec.problem.engine_case);
  const usesFullTextbookViewport = supportsTextbookTemplate;
  const compactConceptViewport = isConceptBoard && hasVectorFocus && renderSceneSpec.problem.world !== "parametric_curve" && !usesFullTextbookViewport;
  const bounds = useMemo(
    () => sceneBounds(renderSceneSpec, trajectories, mode, compactConceptViewport),
    [renderSceneSpec, trajectories, mode, compactConceptViewport],
  );
  const ui = uiScale(bounds);
  const launchAngle = launchAngleForScene(renderSceneSpec);
  const showLaunchAngleLabel = Boolean(launchAngle && shouldShowLaunchAngleLabel(renderSceneSpec, stepId, visualState, activeHighlightIds, revealIds));
  const textbookAnnotations = textbookProjectileAnnotations(renderSceneSpec, trajectories, visualState, activeHighlightIds);
  const useTextbookLayout = Boolean(textbookAnnotations);
  const isActorScoped = Boolean(actorFilter);
  const [panMode, setPanMode] = useState(false);
  const [viewport, setViewport] = useState({ dx: 0, dy: 0, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setViewport({ dx: 0, dy: 0, zoom: 1 });
    setPanMode(false);
  }, [renderSceneSpec, stepId, mode]);
  const viewWidth = bounds.width / viewport.zoom;
  const viewHeight = bounds.height / viewport.zoom;
  const viewBox = `${bounds.minX + viewport.dx + (bounds.width - viewWidth) / 2} ${-bounds.maxY + viewport.dy + (bounds.height - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
  const progress = clamp(animationProgress, 0, 1);
  const overlays = storyboardStep?.overlays ?? [];
  const showMotion = mode === "event" && (overlays.includes("show_motion_progress") || overlays.includes("show_trajectory"));
  const showVectorContextTrajectory = false;
  const showTrajectory = showMotion || overlays.includes("show_trajectory");
  const visibleVectorList = visibleVectors(renderSceneSpec, visibleVectorPatterns);
  const useTextbookTemplate = Boolean(supportsTextbookTemplate && !isActorScoped && isConceptBoard);
  const geometryBoxes = sceneGeometryBoxes(renderSceneSpec, trajectories, activeHighlightIds, bounds, ui, showTrajectory);
  const vectorDrawings = layoutVectors({
    sceneSpec: renderSceneSpec,
    trajectories,
    vectors: useTextbookTemplate ? [] : visibleVectorList,
    progress,
    bounds,
    ui,
    occupiedBoxes: geometryBoxes,
    dimmedIds,
    activeHighlightIds,
    storyboardStep,
    visualState,
    labelIds,
    revealIds,
    useTextbookLayout,
  });
  const placedLabels = placeLabels([
    ...(launchAngle && showLaunchAngleLabel ? [angleLabelCandidate(launchAngle, bounds.scale, ui, activeHighlightIds, stepId)] : []),
    ...(textbookAnnotations && !isActorScoped ? textbookComponentLabelCandidates(textbookAnnotations, visibleVectorPatterns, activeHighlightIds, ui) : []),
    ...vectorDrawings.filter(item => item.showLabel).map(item => ({
      key: `vector-label:${item.vector.id}`,
      x: item.mid.x + item.drawn.labelOffset.x,
      y: item.mid.y + item.drawn.labelOffset.y,
      text: formatVectorLabel(item.label),
      size: 0.72 * ui,
      color: item.dimmed ? C.muted : C.text,
      boxed: false,
      anchor: vectorLabelTextAnchor(item.drawn),
      leaderFrom: item.mid,
      priority: item.highlighted ? 90 : item.vector.kind === "axis" ? 35 : 65,
    })),
    ...(!isActorScoped ? pointLabelEntries(renderSceneSpec, activeHighlightIds, visualState, stepId, ui, hasExplicitNonPointLabels(labelIds))
      .map(({ id, point, text, priority }) => ({
        key: `point-label:${id}`,
        x: point.x + 1.65 * ui,
        y: point.y + 1.45 * ui,
        text,
        size: 0.72 * ui,
        color: C.text,
        boxed: false,
        leaderFrom: point,
        priority,
      })) : []),
  ].filter(Boolean) as LabelCandidate[], bounds, ui, [...geometryBoxes, ...vectorDrawings.map(item => vectorBox(item.drawn, ui))]);
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!panMode) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!panMode || !dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dxPixels = event.clientX - dragRef.current.x;
    const dyPixels = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setViewport(current => ({
      ...current,
      dx: current.dx - (dxPixels / Math.max(rect.width, 1)) * (bounds.width / current.zoom),
      dy: current.dy - (dyPixels / Math.max(rect.height, 1)) * (bounds.height / current.zoom),
    }));
  };
  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setViewport(current => ({
      ...current,
      zoom: clamp(current.zoom * (direction > 0 ? 1.12 : 0.9), 0.75, 3.2),
    }));
  };

  if (useTextbookTemplate) {
    return (
      <TextbookProjectileTemplate
        sceneSpec={renderSceneSpec}
        stepId={stepId}
        mode={mode}
        vectors={visibleVectorList}
        showTrajectory={showTrajectory}
        activeHighlightIds={activeHighlightIds}
        storyboardStep={storyboardStep}
        answerText={answerText ?? ""}
      />
    );
  }

  return (
    <div
      data-audit-surface="teaching-board-2d"
      data-audit-step-id={stepId}
      data-audit-mode={mode}
      data-audit-show-trajectory={showTrajectory ? "true" : "false"}
      data-audit-visible-vector-ids={vectorDrawings.map(item => item.vector.id).join(",")}
      data-audit-highlight-ids={activeHighlightIds.join(",")}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", background: C.bg }}
    >
      <svg
        data-audit-board-svg="true"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        style={{ width: "100%", height: "100%", display: "block", background: C.bg, cursor: panMode ? "grab" : "default", touchAction: "none" }}
      >
        <defs>
        <marker id={`arrow-${mode}`} markerWidth="5" markerHeight="5" refX="4.6" refY="2.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L5,2.5 L0,5 Z" fill={C.vector} />
        </marker>
        <marker id={`arrow-gravity-${mode}`} markerWidth="5" markerHeight="5" refX="4.6" refY="2.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L5,2.5 L0,5 Z" fill={C.gravity} />
          </marker>
        </defs>

        <rect x={bounds.minX} y={-bounds.maxY} width={bounds.width} height={bounds.height} fill={C.bg} />
        <BoardAxes bounds={bounds} mode={mode} ui={ui} />

        {(renderSceneSpec.geometry.surfaces ?? []).map((surface, index) => (
          <Surface2D
            key={`${surface.id ?? "surface"}:${index}`}
            surface={surface}
            points={renderSceneSpec.geometry.points}
            highlighted={!useTextbookLayout && (matchesSceneId(activeHighlightIds, `surface:${String(surface.id ?? "")}`) || activeHighlightIds.some(id => id.includes("incline")))}
            scale={bounds.scale}
            showLabel={!isConceptBoard}
          />
        ))}

        {textbookAnnotations && !isActorScoped && (
          <TextbookProjectileGuides
            annotations={textbookAnnotations}
            bounds={bounds}
            ui={ui}
            activeIds={activeHighlightIds}
          />
        )}

        {launchAngle && (
          <AngleArc2D
            origin={launchAngle.origin}
            angleRad={launchAngle.angleRad}
            scale={bounds.scale}
            ui={ui}
            highlighted={!useTextbookLayout && (activeHighlightIds.some(id => id.toLowerCase().includes("theta") || id.toLowerCase().includes("angle")) || stepId === "invariant")}
          />
        )}

        {showTrajectory && trajectories.map((trajectory, index) => {
          const activePoints = showMotion ? trajectory.points.slice(0, Math.max(2, Math.ceil(progress * trajectory.points.length))) : trajectory.points;
          return (
            <g key={trajectory.id} data-audit-trajectory-id={trajectory.id ?? `trajectory:${index}`} data-audit-actor-id={trajectory.actor}>
              <polyline
                data-audit-trajectory-layer="ghost"
                points={toPolyline(trajectory.points)}
                fill="none"
                stroke={C.pathGhost}
                strokeWidth={(showVectorContextTrajectory ? 0.006 : 0.01) * bounds.scale}
                strokeDasharray={`${0.05 * bounds.scale} ${0.07 * bounds.scale}`}
                opacity={showVectorContextTrajectory ? 0.42 : 1}
              />
              {!showVectorContextTrajectory && (
                <polyline data-audit-trajectory-layer="active" points={toPolyline(activePoints)} fill="none" stroke={index === 0 ? C.path : C.ball2} strokeWidth={0.006 * bounds.scale} strokeLinecap="round" strokeLinejoin="round" />
              )}
            </g>
          );
        })}

        {trajectories.map((trajectory, index) => {
          const p = mode === "concept" ? trajectory.points[0] : samplePath(trajectory.points, progress);
          return (
            <g key={`actor:${trajectory.actor}`} data-audit-actor-id={trajectory.actor}>
              <circle
                cx={p.x}
                cy={-p.y}
                r={(useTextbookLayout ? 0.038 : 0.058) * bounds.scale}
                fill={useTextbookLayout ? C.bg : index === 0 ? C.ball : C.ball2}
                stroke={index === 0 ? C.ball : C.ball2}
                strokeWidth={(useTextbookLayout ? 0.007 : 0.008) * bounds.scale}
              />
              {!useTextbookLayout && !isConceptBoard && (
                <Text2D x={p.x + 0.09 * bounds.scale} y={p.y + 0.09 * bounds.scale} text={actorLabel(trajectory.actor)} size={0.082 * bounds.scale} />
              )}
            </g>
          );
        })}

        {vectorDrawings.map(({ vector, drawn, dimmed, highlighted, color }) => {
          return (
            <g key={vector.id} data-audit-vector-id={vector.id} data-audit-vector-component={vector.component} data-audit-vector-kind={vector.kind}>
              <line
                x1={drawn.from.x}
                y1={-drawn.from.y}
                x2={drawn.to.x}
                y2={-drawn.to.y}
                stroke={useTextbookLayout ? C.surface : color}
                strokeWidth={(highlighted ? 0.01 : 0.007) * bounds.scale}
                strokeLinecap="round"
                markerEnd={`url(#${vector.component.includes("gravity") ? `arrow-gravity-${mode}` : `arrow-${mode}`})`}
                opacity={dimmed ? 0.42 : 1}
              />
            </g>
          );
        })}

        {!isActorScoped && importantPoints(renderSceneSpec, activeHighlightIds).map(([id, point]) => (
          <g key={id} data-audit-point-id={id}>
            <circle
              cx={point.x}
              cy={-point.y}
              r={0.048 * bounds.scale}
              fill={useTextbookLayout ? C.bg : matchesSceneId(activeHighlightIds, `point:${id}`) ? C.highlight : C.surface}
              stroke={useTextbookLayout ? C.surface : "none"}
              strokeWidth={useTextbookLayout ? 0.008 * bounds.scale : 0}
            />
          </g>
        ))}

        <LabelLayer labels={placedLabels} />
      </svg>
      {boardBadges.length > 0 && !useTextbookLayout && (
        <div style={boardBadgeStackStyle}>
          {boardBadges.map((badge, index) => (
            <div key={`${badge.title}:${index}`} style={boardBadgeStyle(badge.tone)}>
              <div style={boardBadgeTitleStyle}>{badge.title}</div>
              <div style={boardBadgeLineStackStyle}>
                {badge.lines.map(line => <div key={line} style={boardBadgeLineStyle}>{line}</div>)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={boardToolStripStyle}>
        <button type="button" onClick={() => setPanMode(value => !value)} style={boardToolButtonStyle(panMode)} title={panMode ? "Pan mode on" : "Pan board"}>
          <HandIcon />
        </button>
        <button type="button" onClick={() => setViewport({ dx: 0, dy: 0, zoom: 1 })} style={boardToolButtonStyle(false)} title="Reset board view">
          1:1
        </button>
      </div>
      <style>{`
        @keyframes board-badge-pulse {
          0%, 100% { box-shadow: 0 0 0 rgba(255,216,77,0); border-color: rgba(255,216,77,0.24); }
          50% { box-shadow: 0 0 20px rgba(255,216,77,0.22); border-color: rgba(255,216,77,0.72); }
        }
      `}</style>
    </div>
  );
}

function BoardAxes({ bounds, mode, ui }: { bounds: ReturnType<typeof sceneBounds>; mode: "concept" | "event"; ui: number }) {
  const stroke = 0.12 * ui;
  const xEnd = bounds.maxX - 1.2 * ui;
  const yEnd = bounds.maxY - 1.2 * ui;
  return (
    <g>
      <line x1={0} y1={0} x2={xEnd} y2={0} stroke={C.surface} strokeWidth={stroke} markerEnd={`url(#arrow-${mode})`} />
      <line x1={0} y1={0} x2={0} y2={-yEnd} stroke={C.surface} strokeWidth={stroke} markerEnd={`url(#arrow-${mode})`} />
      <Text2D x={xEnd + 0.45 * ui} y={-0.55 * ui} text="X" size={1.25 * ui} />
      <Text2D x={0.45 * ui} y={yEnd + 0.25 * ui} text="Y" size={1.25 * ui} />
    </g>
  );
}

type TextbookAnnotations = {
  launch: Point2;
  apex?: Point2;
  landing?: Point2;
  showRange: boolean;
  showHeight: boolean;
  showSameHeight: boolean;
};

function isTextbookTemplateWorld(world: string, engineCase = "") {
  const normalizedWorld = world.toLowerCase();
  const normalizedEngineCase = engineCase.toLowerCase();
  if (["level_ground", "height_launch", "incline", "two_inclines", "incline_collision", "staircase", "monkey_hunter", "multi_projectile"].includes(normalizedWorld)) return true;
  return [
    "wall_clearance_condition",
    "target_launch_angle_fixed_speed",
    "minimum_speed_to_hit_target",
    "two_projectile_collision_time",
    "two_projectile_same_speed_comparison",
    "two_projectile_interception_time_ratio",
    "velocity_change_interval",
    "monkey_hunter_condition",
  ].includes(normalizedEngineCase);
}

function textbookProjectileAnnotations(
  sceneSpec: SceneSpec2D,
  trajectories: ReturnType<typeof normalizedTrajectories>,
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  activeIds: string[],
): TextbookAnnotations | null {
  if (!["level_ground", "height_launch"].includes(sceneSpec.problem.world)) return null;
  const trajectory = trajectories[0];
  if (!trajectory?.points.length) return null;
  const launch = sceneSpec.geometry.points.launch ?? trajectory.points[0];
  const landing = sceneSpec.geometry.points.landing ?? trajectory.points[trajectory.points.length - 1];
  const apex = sceneSpec.geometry.points.apex ?? trajectory.points.reduce((best, point) => point.y > best.y ? point : best, trajectory.points[0]);
  const ids = [
    ...(visualState?.visible_ids ?? []),
    ...(visualState?.highlight_ids ?? []),
    ...activeIds,
  ].join(" ").toLowerCase();
  return {
    launch,
    landing,
    apex,
    showRange: ids.includes("quantity:r") || sceneSpec.problem.unknown.toLowerCase().includes("range"),
    showHeight: ids.includes("quantity:h") || sceneSpec.problem.unknown.toLowerCase().includes("height"),
    showSameHeight: ids.includes("quantity:delta_y"),
  };
}

function TextbookProjectileGuides({ annotations, bounds, ui, activeIds }: { annotations: TextbookAnnotations; bounds: ReturnType<typeof sceneBounds>; ui: number; activeIds: string[] }) {
  const { launch, landing, apex } = annotations;
  const dash = `${0.5 * ui} ${0.42 * ui}`;
  const highlightRange = activeIds.some(id => id.toLowerCase().includes("quantity:r"));
  const highlightHeight = activeIds.some(id => id.toLowerCase().includes("quantity:h"));
  const guideStroke = 0.08 * ui;
  const bracketY = 1.9 * ui;
  const bracketArm = 0.55 * ui;
  return (
    <g>
      {apex && annotations.showHeight && (
        <>
          <line x1={apex.x} y1={-apex.y} x2={apex.x} y2={0} stroke={highlightHeight ? C.highlight : C.surface} strokeWidth={guideStroke} strokeDasharray={dash} />
          <Text2D x={apex.x + 0.55 * ui} y={apex.y / 2} text="H" size={0.95 * ui} color={highlightHeight ? C.highlight : C.surface} />
        </>
      )}
      {landing && annotations.showRange && (
        <>
          <line x1={launch.x} y1={bracketY} x2={landing.x} y2={bracketY} stroke={highlightRange ? C.highlight : C.surface} strokeWidth={guideStroke} strokeDasharray={dash} />
          <line x1={launch.x} y1={bracketY - bracketArm} x2={launch.x - bracketArm} y2={bracketY} stroke={highlightRange ? C.highlight : C.surface} strokeWidth={guideStroke} />
          <line x1={launch.x} y1={bracketY + bracketArm} x2={launch.x - bracketArm} y2={bracketY} stroke={highlightRange ? C.highlight : C.surface} strokeWidth={guideStroke} />
          <line x1={landing.x} y1={bracketY - bracketArm} x2={landing.x + bracketArm} y2={bracketY} stroke={highlightRange ? C.highlight : C.surface} strokeWidth={guideStroke} />
          <line x1={landing.x} y1={bracketY + bracketArm} x2={landing.x + bracketArm} y2={bracketY} stroke={highlightRange ? C.highlight : C.surface} strokeWidth={guideStroke} />
          <Text2D x={(launch.x + landing.x) / 2} y={-2.75 * ui} text="R" size={1.1 * ui} color={highlightRange ? C.highlight : C.surface} anchor="middle" />
        </>
      )}
      {landing && annotations.showSameHeight && (
        <line x1={launch.x} y1={-launch.y} x2={landing.x} y2={-landing.y} stroke={C.highlight} strokeWidth={guideStroke} strokeDasharray={dash} />
      )}
    </g>
  );
}

function TextbookProjectileTemplate({
  sceneSpec,
  stepId,
  mode,
  vectors,
  showTrajectory,
  activeHighlightIds,
  storyboardStep,
  answerText,
}: {
  sceneSpec: SceneSpec2D;
  stepId: string;
  mode: "concept" | "event";
  vectors: NonNullable<SceneSpec2D["live_vectors"]>;
  showTrajectory: boolean;
  activeHighlightIds: string[];
  storyboardStep: NonNullable<SceneSpec2D["storyboard"]>[number] | undefined;
  answerText: string;
}) {
  const markerId = `textbook-arrow-${mode}`;
  const vectorIds = vectors.map(vector => vector.id);
  const template = textbookBeatTemplateKind(sceneSpec, stepId, vectors, activeHighlightIds, storyboardStep);
  const theta = sceneSpec.quantities?.theta ?? sceneSpec.quantities?.angle ?? sceneSpec.quantities?.launch_angle;
  const thetaDeg = theta && Number.isFinite(theta.value) ? theta.value : 45;
  const thetaText = theta && Number.isFinite(theta.value) ? `θ = ${formatQuantityValue(theta.value, "°")}°` : "θ";
  const range = sceneSpec.quantities?.R ?? sceneSpec.quantities?.range;
  const rangeText = range && Number.isFinite(range.value)
    ? `R = ${formatQuantityValue(range.value, unitForQuantity(range.unit))}${unitForQuantity(range.unit)}`
    : "R";
  const height = sceneSpec.quantities?.H ?? sceneSpec.quantities?.height;
  const heightText = height && Number.isFinite(height.value)
    ? `H = ${formatQuantityValue(height.value, unitForQuantity(height.unit))}${unitForQuantity(height.unit)}`
    : "H";
  const launchHeight = sceneSpec.quantities?.launch_height ?? sceneSpec.quantities?.h ?? sceneSpec.quantities?.height ?? sceneSpec.quantities?.H;
  const launchHeightText = launchHeight && Number.isFinite(launchHeight.value)
    ? `h = ${formatQuantityValue(launchHeight.value, unitForQuantity(launchHeight.unit))}${unitForQuantity(launchHeight.unit)}`
    : "h";
  const time = sceneSpec.quantities?.T ?? sceneSpec.quantities?.time ?? sceneSpec.quantities?.t ?? sceneSpec.quantities?.t_peak;
  const timeText = time && Number.isFinite(time.value)
    ? `T = ${formatQuantityValue(time.value, unitForQuantity(time.unit))}${unitForQuantity(time.unit)}`
    : "T";
  const peakTime = sceneSpec.quantities?.t_peak ?? sceneSpec.quantities?.time_to_peak;
  const peakTimeText = peakTime && Number.isFinite(peakTime.value)
    ? `t_peak = ${formatQuantityValue(peakTime.value, unitForQuantity(peakTime.unit))}${unitForQuantity(peakTime.unit)}`
    : "t_peak = uᵧ / g";
  const alpha = sceneSpec.quantities?.alpha ?? sceneSpec.quantities?.beta ?? sceneSpec.quantities?.incline_angle;
  const alphaText = alpha && Number.isFinite(alpha.value) ? `${formatQuantityValue(alpha.value, "°")}°` : "α";
  const alphaDeg = alpha && Number.isFinite(alpha.value) ? alpha.value : 30;
  const speed = sceneSpec.quantities?.u ?? sceneSpec.quantities?.speed ?? sceneSpec.quantities?.v0;
  const speedText = speed && Number.isFinite(speed.value)
    ? `${formatQuantityValue(speed.value, unitForQuantity(speed.unit))}${unitForQuantity(speed.unit)}`
    : "u";
  const finalAnswerText = displayAnswerText(answerText);
  const isHorizontalCliffTemplate = template.startsWith("horizontal-cliff");
  const templateViewBox = isHorizontalCliffTemplate ? "4 0 96 62" : "0 0 100 62";
  const horizontalDirection = horizontalDirectionForScene(sceneSpec);

  return (
    <div
      data-audit-surface="teaching-board-2d"
      data-audit-step-id={stepId}
      data-audit-mode={mode}
      data-audit-show-trajectory={showTrajectory ? "true" : "false"}
      data-audit-visible-vector-ids={vectorIds.join(",")}
      data-audit-highlight-ids={activeHighlightIds.join(",")}
      data-audit-template-kind={template}
      data-audit-template-theta-deg={Number.isFinite(thetaDeg) ? roundTemplateNumber(thetaDeg) : undefined}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", background: C.bg }}
    >
      <svg data-audit-board-svg="true" viewBox={templateViewBox} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block", background: C.bg }}>
        <defs>
          <marker id={markerId} markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M0,0 L6,3 L0,6 Z" fill={C.surface} />
          </marker>
        </defs>
        <TextbookAuditHooks vectors={vectors} points={sceneSpec.geometry.points} surfaces={sceneSpec.geometry.surfaces ?? []} actors={sceneSpec.actors ?? []} />
        {template === "level-ground-setup" && <LevelGroundTemplate markerId={markerId} variant="setup" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-components" && <LevelGroundTemplate markerId={markerId} variant="components" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-time-to-peak" && <LevelGroundTemplate markerId={markerId} variant="peak-time" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-landing-condition" && <LevelGroundTemplate markerId={markerId} variant="landing-condition" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-time-flight" && <LevelGroundTemplate markerId={markerId} variant="time" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-time-substitution" && <LevelGroundTemplate markerId={markerId} variant="time-substitution" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-apex" && <LevelGroundTemplate markerId={markerId} variant="apex" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-range" && <LevelGroundTemplate markerId={markerId} variant="range" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "level-ground-summary" && <LevelGroundTemplate markerId={markerId} variant="summary" thetaText={thetaText} thetaDeg={thetaDeg} rangeText={rangeText} heightText={heightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} />}
        {template === "launch-components" && <LaunchComponentsTemplate markerId={markerId} thetaText={thetaText} thetaDeg={thetaDeg} />}
        {template === "apex" && <ApexTemplate markerId={markerId} heightText={heightText} />}
        {template === "descent-components" && <DescentComponentsTemplate markerId={markerId} thetaText={thetaText} thetaDeg={thetaDeg} />}
        {template === "same-height" && <SameHeightTemplate markerId={markerId} />}
        {template === "time-flight" && <TimeFlightTemplate markerId={markerId} />}
        {template === "range" && <RangeTemplate markerId={markerId} rangeText={rangeText} />}
        {template === "peak-time-setup" && <PeakTimeTemplate markerId={markerId} variant="setup" timeText={peakTimeText} />}
        {template === "peak-time-velocity" && <PeakTimeTemplate markerId={markerId} variant="velocity" timeText={peakTimeText} />}
        {template === "peak-time-condition" && <PeakTimeTemplate markerId={markerId} variant="condition" timeText={peakTimeText} />}
        {template === "peak-time-result" && <PeakTimeTemplate markerId={markerId} variant="result" timeText={peakTimeText} />}
        {template === "multi-result" && <MultiResultTemplate markerId={markerId} rangeText={rangeText} heightText={heightText} timeText={timeText} />}
        {template === "multi-equation-bridge" && <MultiEquationBridgeTemplate markerId={markerId} rangeText={rangeText} heightText={heightText} timeText={timeText} />}
        {template === "height-launch-setup" && <HeightLaunchTemplate markerId={markerId} variant="setup" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-condition" && <HeightLaunchTemplate markerId={markerId} variant="condition" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-result" && <HeightLaunchTemplate markerId={markerId} variant="result" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-time-setup" && <HeightLaunchTemplate markerId={markerId} variant="time-setup" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-time-condition" && <HeightLaunchTemplate markerId={markerId} variant="time-condition" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-time-factor" && <HeightLaunchTemplate markerId={markerId} variant="time-factor" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "height-launch-time-result" && <HeightLaunchTemplate markerId={markerId} variant="time-result" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} />}
        {template === "horizontal-cliff-setup" && <HorizontalCliffTemplate markerId={markerId} variant="setup" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-fall-time" && <HorizontalCliffTemplate markerId={markerId} variant="fall-time" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-range" && <HorizontalCliffTemplate markerId={markerId} variant="range" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-impact" && <HorizontalCliffTemplate markerId={markerId} variant="impact-speed" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-impact-vertical" && <HorizontalCliffTemplate markerId={markerId} variant="impact-vertical" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-impact-speed" && <HorizontalCliffTemplate markerId={markerId} variant="impact-speed" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "horizontal-cliff-impact-angle" && <HorizontalCliffTemplate markerId={markerId} variant="impact-angle" rangeText={rangeText} heightText={launchHeightText} timeText={timeText} answerText={finalAnswerText} speedText={speedText} direction={horizontalDirection} />}
        {template === "wall-clearance-setup" && <WallClearanceTemplate markerId={markerId} variant="setup" />}
        {template === "wall-clearance-relation" && <WallClearanceTemplate markerId={markerId} variant="relation" />}
        {template === "wall-clearance-result" && <WallClearanceTemplate markerId={markerId} variant="result" answerText={finalAnswerText} />}
        {template === "target-hit-setup" && <TargetHitTemplate markerId={markerId} thetaText={thetaText} variant="setup" answerText={finalAnswerText} />}
        {template === "target-hit-equation" && <TargetHitTemplate markerId={markerId} thetaText={thetaText} variant="equation" answerText={finalAnswerText} />}
        {template === "target-hit-time" && <TargetHitTemplate markerId={markerId} thetaText={thetaText} variant="time" answerText={finalAnswerText} />}
        {template === "minimum-speed-target-setup" && <MinimumSpeedTargetTemplate markerId={markerId} variant="setup" />}
        {template === "minimum-speed-target-result" && <MinimumSpeedTargetTemplate markerId={markerId} variant="result" answerText={finalAnswerText} />}
        {template === "monkey-hunter-setup" && <MonkeyHunterTemplate markerId={markerId} variant="setup" speedText={speedText} heightText={heightText} />}
        {template === "monkey-hunter-projectile-drop" && <MonkeyHunterTemplate markerId={markerId} variant="projectile-drop" speedText={speedText} heightText={heightText} />}
        {template === "monkey-hunter-monkey-drop" && <MonkeyHunterTemplate markerId={markerId} variant="monkey-drop" speedText={speedText} heightText={heightText} />}
        {template === "monkey-hunter-result" && <MonkeyHunterTemplate markerId={markerId} variant="result" speedText={speedText} heightText={heightText} />}
        {template === "position-at-time-setup" && <PositionAtTimeTemplate markerId={markerId} variant="setup" />}
        {template === "position-at-time-equations" && <PositionAtTimeTemplate markerId={markerId} variant="equations" />}
        {template === "position-at-time-result" && <PositionAtTimeTemplate markerId={markerId} variant="result" answerText={finalAnswerText} />}
        {template === "time-derivation-setup" && <TimeDerivationTemplate markerId={markerId} variant="setup" />}
        {template === "time-derivation-equation" && <TimeDerivationTemplate markerId={markerId} variant="equation" />}
        {template === "time-derivation-factor" && <TimeDerivationTemplate markerId={markerId} variant="factor" />}
        {template === "time-derivation-result" && <TimeDerivationTemplate markerId={markerId} variant="result" />}
        {template === "two-projectile-setup" && <TwoProjectileTemplate markerId={markerId} variant="setup" />}
        {template === "two-projectile-time-a" && <TwoProjectileTemplate markerId={markerId} variant="time-a" />}
        {template === "two-projectile-time-b" && <TwoProjectileTemplate markerId={markerId} variant="time-b" />}
        {template === "two-projectile-collision" && <TwoProjectileTemplate markerId={markerId} variant="collision" answerText={finalAnswerText} />}
        {template === "two-projectile-compare-setup" && <TwoProjectileComparisonTemplate markerId={markerId} variant="setup" sceneSpec={sceneSpec} />}
        {template === "two-projectile-compare-time" && <TwoProjectileComparisonTemplate markerId={markerId} variant="time" sceneSpec={sceneSpec} />}
        {template === "two-projectile-compare-height" && <TwoProjectileComparisonTemplate markerId={markerId} variant="height" sceneSpec={sceneSpec} />}
        {template === "two-projectile-compare-range" && <TwoProjectileComparisonTemplate markerId={markerId} variant="range" sceneSpec={sceneSpec} />}
        {template === "velocity-change-setup" && <VelocityChangeTemplate markerId={markerId} variant="setup" />}
        {template === "velocity-change-what-changes" && <VelocityChangeTemplate markerId={markerId} variant="what-changes" />}
        {template === "velocity-change-delta" && <VelocityChangeTemplate markerId={markerId} variant="delta" />}
        {template === "interception-setup" && <InterceptionTemplate markerId={markerId} variant="setup" />}
        {template === "interception-vertical" && <InterceptionTemplate markerId={markerId} variant="vertical" />}
        {template === "interception-horizontal" && <InterceptionTemplate markerId={markerId} variant="horizontal" />}
        {template === "interception-ratio" && <InterceptionTemplate markerId={markerId} variant="ratio" />}
        {template === "incline-axes" && <InclineAxesTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-gravity-components" && <InclineGravityComponentsTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-velocity-components" && <InclineVelocityComponentsTemplate markerId={markerId} thetaText={thetaText} alphaDeg={alphaDeg} />}
        {template === "incline-perpendicular-setup" && <InclinePerpendicularSetupTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-range" && <InclineRangeTemplate markerId={markerId} rangeText={rangeText} alphaDeg={alphaDeg} />}
        {template === "incline-impact-setup" && <InclineImpactConditionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="setup" />}
        {template === "incline-impact-condition" && <InclineImpactConditionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="condition" />}
        {template === "incline-impact-relation" && <InclineImpactConditionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="relation" />}
        {template === "incline-normal-distance-setup" && <InclineNormalDistanceTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="setup" />}
        {template === "incline-normal-distance-condition" && <InclineNormalDistanceTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="condition" />}
        {template === "incline-normal-distance-result" && <InclineNormalDistanceTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="result" />}
        {template === "incline-normal-return" && <InclineMotionResolutionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="normal" />}
        {template === "incline-along-displacement" && <InclineMotionResolutionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="along" />}
        {template === "incline-range-combine" && <InclineMotionResolutionTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} variant="combine" rangeText={rangeText} answerText={finalAnswerText} />}
        {template === "two-inclines-setup" && <TwoInclinesTemplate markerId={markerId} variant="setup" />}
        {template === "two-inclines-launch" && <TwoInclinesTemplate markerId={markerId} variant="launch" />}
        {template === "two-inclines-launch-components" && <TwoInclinesComponentTemplate markerId={markerId} variant="launch" />}
        {template === "two-inclines-impact-components" && <TwoInclinesComponentTemplate markerId={markerId} variant="impact" />}
        {template === "two-inclines-component-equation" && <TwoInclinesComponentTemplate markerId={markerId} variant="equation" />}
        {template === "two-inclines-impact" && <TwoInclinesTemplate markerId={markerId} variant="impact" />}
        {template === "incline-collision-setup" && <InclineCollisionSetupTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-read-diagram" && <InclineCollisionReadDiagramTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-gravity" && <InclineCollisionGravityTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-along-cancel" && <InclineCollisionAlongCancelTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-normal" && <InclineCollisionNormalTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-normal-return" && <InclineCollisionNormalReturnTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-equation" && <InclineCollisionEquationTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "incline-collision-result" && <InclineCollisionResultTemplate markerId={markerId} alphaText={alphaText} alphaDeg={alphaDeg} />}
        {template === "staircase-setup" && <StaircaseTemplate markerId={markerId} variant="setup" />}
        {template === "staircase-motion" && <StaircaseTemplate markerId={markerId} variant="motion" />}
        {template === "staircase-drop" && <StaircaseTemplate markerId={markerId} variant="drop" />}
        {template === "staircase-impact" && <StaircaseTemplate markerId={markerId} variant="impact" />}
        {template === "smooth-plane-setup" && <SmoothPlaneTemplate markerId={markerId} variant="setup" speedText={speedText} alphaText={alphaText} />}
        {template === "smooth-plane-acceleration" && <SmoothPlaneTemplate markerId={markerId} variant="acceleration" speedText={speedText} alphaText={alphaText} />}
        {template === "smooth-plane-resultant" && <SmoothPlaneTemplate markerId={markerId} variant="resultant" speedText={speedText} alphaText={alphaText} answerText={finalAnswerText} />}
      </svg>
    </div>
  );
}

function horizontalDirectionForScene(sceneSpec: SceneSpec2D) {
  const motionVx = sceneSpec.motion?.initial?.vx;
  if (typeof motionVx === "number" && Number.isFinite(motionVx) && Math.abs(motionVx) > 1e-9) {
    return motionVx < 0 ? -1 : 1;
  }
  const quantityVx = sceneSpec.quantities?.ux?.value ?? sceneSpec.quantities?.vx?.value ?? sceneSpec.quantities?.v_x?.value ?? sceneSpec.quantities?.u_x?.value;
  return typeof quantityVx === "number" && Number.isFinite(quantityVx) && quantityVx < 0 ? -1 : 1;
}

type TextbookBeatTemplate =
  | "level-ground-setup"
  | "level-ground-components"
  | "level-ground-time-to-peak"
  | "level-ground-landing-condition"
  | "level-ground-time-flight"
  | "level-ground-time-substitution"
  | "level-ground-apex"
  | "level-ground-range"
  | "level-ground-summary"
  | "launch-components"
  | "apex"
  | "descent-components"
  | "same-height"
  | "time-flight"
  | "range"
  | "peak-time-setup"
  | "peak-time-velocity"
  | "peak-time-condition"
  | "peak-time-result"
  | "multi-result"
  | "multi-equation-bridge"
  | "height-launch-setup"
  | "height-launch-condition"
  | "height-launch-result"
  | "height-launch-time-setup"
  | "height-launch-time-condition"
  | "height-launch-time-factor"
  | "height-launch-time-result"
  | "horizontal-cliff-setup"
  | "horizontal-cliff-fall-time"
  | "horizontal-cliff-range"
  | "horizontal-cliff-impact"
  | "horizontal-cliff-impact-vertical"
  | "horizontal-cliff-impact-speed"
  | "horizontal-cliff-impact-angle"
  | "wall-clearance-setup"
  | "wall-clearance-relation"
  | "wall-clearance-result"
  | "target-hit-setup"
  | "target-hit-equation"
  | "target-hit-time"
  | "minimum-speed-target-setup"
  | "minimum-speed-target-result"
  | "monkey-hunter-setup"
  | "monkey-hunter-projectile-drop"
  | "monkey-hunter-monkey-drop"
  | "monkey-hunter-result"
  | "position-at-time-setup"
  | "position-at-time-equations"
  | "position-at-time-result"
  | "time-derivation-setup"
  | "time-derivation-equation"
  | "time-derivation-factor"
  | "time-derivation-result"
  | "two-projectile-setup"
  | "two-projectile-time-a"
  | "two-projectile-time-b"
  | "two-projectile-collision"
  | "two-projectile-compare-setup"
  | "two-projectile-compare-time"
  | "two-projectile-compare-height"
  | "two-projectile-compare-range"
  | "velocity-change-setup"
  | "velocity-change-what-changes"
  | "velocity-change-delta"
  | "interception-setup"
  | "interception-vertical"
  | "interception-horizontal"
  | "interception-ratio"
  | "incline-axes"
  | "incline-gravity-components"
  | "incline-velocity-components"
  | "incline-perpendicular-setup"
  | "incline-range"
  | "incline-impact-setup"
  | "incline-impact-condition"
  | "incline-impact-relation"
  | "incline-normal-distance-setup"
  | "incline-normal-distance-condition"
  | "incline-normal-distance-result"
  | "incline-normal-return"
  | "incline-along-displacement"
  | "incline-range-combine"
  | "two-inclines-setup"
  | "two-inclines-launch"
  | "two-inclines-launch-components"
  | "two-inclines-impact-components"
  | "two-inclines-component-equation"
  | "two-inclines-impact"
  | "incline-collision-setup"
  | "incline-collision-read-diagram"
  | "incline-collision-gravity"
  | "incline-collision-along-cancel"
  | "incline-collision-normal"
  | "incline-collision-normal-return"
  | "incline-collision-equation"
  | "incline-collision-result"
  | "staircase-setup"
  | "staircase-motion"
  | "staircase-drop"
  | "staircase-impact"
  | "smooth-plane-setup"
  | "smooth-plane-acceleration"
  | "smooth-plane-resultant";

function textbookBeatTemplateKind(
  sceneSpec: SceneSpec2D,
  stepId: string,
  vectors: NonNullable<SceneSpec2D["live_vectors"]>,
  activeIds: string[],
  storyboardStep: NonNullable<SceneSpec2D["storyboard"]>[number] | undefined,
): TextbookBeatTemplate {
  const contractTemplate = storyboardStep?.beat_visual_spec?.renderer_hints?.svg_template;
  if (contractTemplate) return contractTemplate as TextbookBeatTemplate;
  const world = sceneSpec.problem.world.toLowerCase();
  const engineCase = sceneSpec.problem.engine_case.toLowerCase();
  const visualAction = String(storyboardStep?.visual_action ?? "").toLowerCase();
  const tokens = [
    stepId,
    visualAction,
    sceneSpec.problem.world,
    sceneSpec.problem.engine_case,
    sceneSpec.problem.unknown,
    storyboardStep?.title,
    storyboardStep?.formula,
    storyboardStep?.equation,
    storyboardStep?.explanation,
    ...(storyboardStep?.overlays ?? []),
    ...activeIds,
    ...vectors.map(vector => `${vector.id} ${vector.component} ${vector.anchor}`),
  ].join(" ").toLowerCase();
  if (engineCase === "level_ground_multi_quantity") {
    if (stepId.includes("solve_2") || tokens.includes("time to peak") || tokens.includes("t_peak")) return "peak-time-result";
    if (stepId.includes("solve_5")) return "multi-equation-bridge";
    if (tokens.includes("answer") || stepId.includes("solve_7")) return "multi-result";
  }
  if (engineCase === "height_launch_horizontal_scenario") {
    if (stepId === "invariant" || stepId.includes("solve_1")) return "horizontal-cliff-setup";
    if (tokens.includes("v_x = constant") || tokens.includes("vx = constant")) return "horizontal-cliff-setup";
    if (visualAction === "show_impact_angle" || stepId.includes("impact_angle") || tokens.includes("quantity:impact_angle")) return "horizontal-cliff-impact-angle";
    if (visualAction === "show_impact_velocity_triangle" || stepId.includes("impact_speed") || tokens.includes("impact speed")) return "horizontal-cliff-impact-speed";
    if (visualAction === "show_impact_vertical_velocity" || stepId.includes("impact_vy") || tokens.includes("vector:vy")) return "horizontal-cliff-impact-vertical";
    if (tokens.includes("quantity:r") || tokens.includes("range") || tokens.includes("r =")) return "horizontal-cliff-range";
    if (tokens.includes("quantity:t") || tokens.includes("launch_height") || tokens.includes("fall time") || stepId.includes("solve_2")) return "horizontal-cliff-fall-time";
    return "horizontal-cliff-impact";
  }
  if (engineCase === "height_launch_multi_quantity") {
    if (stepId === "invariant") return "height-launch-setup";
    if (stepId.includes("solve_1") || tokens.includes("quantity:ux") || tokens.includes("quantity:uy")) return "launch-components";
    if (tokens.includes("impact angle") || tokens.includes("impact speed") || tokens.includes("quantity:impact_angle") || visualAction === "show_impact_velocity_triangle") return "descent-components";
    if (tokens.includes("positive") || tokens.includes("sqrt") || stepId.includes("solve_3")) return "height-launch-time-factor";
    if (tokens.includes("quantity:r") || tokens.includes("range") || tokens.includes("r =")) return "height-launch-result";
    if (tokens.includes("ground-impact") || tokens.includes("launch_height") || tokens.includes("event:impact") || stepId.includes("solve_2")) return "height-launch-condition";
    if (tokens.includes("h_max") || tokens.includes("maximum height") || tokens.includes("event:apex")) return "apex";
    return "height-launch-result";
  }
  if (engineCase === "height_launch_range") {
    if (stepId === "invariant") return "height-launch-setup";
    if (stepId.includes("solve_1") || tokens.includes("ground-impact") || tokens.includes("delta_y") || tokens.includes("same_height")) return "height-launch-condition";
    return "height-launch-result";
  }
  if (engineCase === "height_launch_time_of_flight") {
    if (stepId === "invariant") return "height-launch-time-setup";
    if (stepId.includes("solve_2") || tokens.includes("factor")) return "height-launch-time-factor";
    if (stepId.includes("solve_1") || tokens.includes("landing")) return "height-launch-time-condition";
    return "height-launch-time-result";
  }
  if (engineCase === "wall_clearance_condition") {
    if (stepId.includes("solve_2") || tokens.includes("answer")) return "wall-clearance-result";
    if (stepId.includes("solve_1") || tokens.includes("controlling relation")) return "wall-clearance-relation";
    return "wall-clearance-setup";
  }
  if (engineCase === "target_launch_angle_fixed_speed") {
    if (stepId.includes("solve_3") || tokens.includes("flight time")) return "target-hit-time";
    if (stepId.includes("solve_1") || stepId.includes("solve_2") || tokens.includes("event condition")) return "target-hit-equation";
    return "target-hit-setup";
  }
  if (engineCase === "minimum_speed_to_hit_target") {
    if (stepId.includes("solve_1") || tokens.includes("answer")) return "minimum-speed-target-result";
    return "minimum-speed-target-setup";
  }
  if (engineCase === "monkey_hunter_condition" || world === "monkey_hunter") {
    if (stepId.includes("solve_4") || stepId.includes("takeaway") || tokens.includes("answer") || tokens.includes("event:hit") || visualAction === "highlight_final_answer") return "monkey-hunter-result";
    if (stepId.includes("solve_3") || tokens.includes("monkey drop") || tokens.includes("trajectory:monkey_drop") || tokens.includes("quantity:drop_monkey")) return "monkey-hunter-monkey-drop";
    if (stepId.includes("solve_2") || tokens.includes("projectile drop") || tokens.includes("quantity:drop_projectile")) return "monkey-hunter-projectile-drop";
    return "monkey-hunter-setup";
  }
  if (engineCase === "level_ground_position_at_time") {
    if (stepId === "invariant") return "position-at-time-setup";
    if (stepId.includes("solve_1")) return "position-at-time-equations";
    if (stepId.includes("solve_2") || tokens.includes("calculate")) return "position-at-time-result";
    if (tokens.includes("position") || tokens.includes("controlling relation")) return "position-at-time-equations";
    return "position-at-time-setup";
  }
  if (engineCase === "level_ground_time_to_peak") {
    if (stepId === "invariant") return "peak-time-setup";
    if (stepId.includes("solve_1")) return "launch-components";
    if (stepId.includes("solve_2")) return "peak-time-velocity";
    if (stepId.includes("solve_3")) return "peak-time-condition";
    return "peak-time-result";
  }
  if (engineCase === "level_ground_time_of_flight_derivation") {
    if (stepId === "invariant") return "time-derivation-setup";
    if (stepId.includes("solve_1")) return "launch-components";
    if (stepId.includes("solve_4") || stepId.includes("solve_5") || tokens.includes("answer")) return "time-derivation-result";
    if (stepId.includes("solve_3") || tokens.includes("factor")) return "time-derivation-factor";
    return "time-derivation-equation";
  }
  if (engineCase === "two_projectile_collision_time") {
    if (stepId === "invariant") return "two-projectile-setup";
    if (stepId.includes("solve_3") || visualAction === "highlight_collision" || tokens.includes("answer")) return "two-projectile-collision";
    if (stepId.includes("solve_2")) return "two-projectile-time-b";
    return "two-projectile-time-a";
  }
  if (engineCase === "two_projectile_same_speed_comparison") {
    if (stepId === "invariant") return "two-projectile-compare-setup";
    if (stepId.includes("solve_1")) return "two-projectile-compare-time";
    if (stepId.includes("solve_2")) return "two-projectile-compare-height";
    if (stepId.includes("solve_3") || tokens.includes("answer")) return "two-projectile-compare-range";
    if (tokens.includes("sin(2theta)") || tokens.includes("sin(2θ)") || tokens.includes("range")) return "two-projectile-compare-range";
    if (tokens.includes("sin^2") || tokens.includes("height")) return "two-projectile-compare-height";
    if (tokens.includes("time") || tokens.includes("sin(theta)") || tokens.includes("sinθ")) return "two-projectile-compare-time";
    return "two-projectile-compare-setup";
  }
  if (engineCase === "velocity_change_interval") {
    if (stepId === "delta_v" || tokens.includes("delta_v") || tokens.includes("acceleration over time") || tokens.includes("answer")) return "velocity-change-delta";
    if (stepId === "model" || tokens.includes("decide what changes")) return "velocity-change-what-changes";
    return "velocity-change-setup";
  }
  if (engineCase === "two_projectile_interception_time_ratio") {
    if (stepId === "invariant") return "interception-setup";
    if (stepId.includes("solve_3") || tokens.includes("landing") || tokens.includes("answer") || tokens.includes("quantity:t")) return "interception-ratio";
    if (stepId.includes("solve_2")) return "interception-horizontal";
    return "interception-vertical";
  }
  if (engineCase === "inclined_plane_right_angle_impact_condition") {
    if (stepId === "invariant") return "incline-impact-setup";
    if (stepId.includes("solve_3") || tokens.includes("angle_condition") || tokens.includes("answer") || tokens.includes("calculate condition")) return "incline-impact-relation";
    if (stepId.includes("solve_2") || tokens.includes("impact velocity")) return "incline-impact-condition";
  }
  if (engineCase === "inclined_plane_max_normal_distance_velocity_component") {
    if (stepId === "invariant") return "incline-normal-distance-setup";
    if (stepId.includes("solve_2") || tokens.includes("answer")) return "incline-normal-distance-result";
    if (stepId.includes("solve_1") || tokens.includes("max") || tokens.includes("normal distance")) return "incline-normal-distance-condition";
    return "incline-normal-distance-setup";
  }
  if (engineCase === "perpendicular_launch_range_on_incline") {
    if (stepId === "invariant") return "incline-perpendicular-setup";
    if (stepId.includes("solve_1")) return "incline-normal-return";
    if (stepId.includes("solve_2")) return "incline-along-displacement";
    if (stepId.includes("solve_3")) return "incline-range-combine";
    return "incline-range";
  }
  if (engineCase === "two_inclines_perpendicular_launch_impact") {
    if (stepId === "invariant") return "two-inclines-setup";
    if (stepId.includes("solve_1")) return "two-inclines-launch-components";
    if (stepId.includes("solve_2")) return "two-inclines-impact-components";
    if (stepId.includes("solve_3")) return "two-inclines-component-equation";
    if (visualAction === "highlight_collision" || visualAction === "highlight_final_answer" || tokens.includes("answer") || tokens.includes("point:q") || tokens.includes("velocity_at_q")) return "two-inclines-impact";
    return "two-inclines-launch-components";
  }
  if (engineCase === "motion_on_smooth_incline_perpendicular_to_slope") {
    if (stepId === "invariant") return "smooth-plane-setup";
    if (tokens.includes("answer") || stepId.includes("solve_2") || stepId.includes("solve_3")) return "smooth-plane-resultant";
    if (tokens.includes("gravity") || tokens.includes("vector:g") || stepId.includes("solve_1")) return "smooth-plane-acceleration";
    return "smooth-plane-setup";
  }
  if (world === "staircase") {
    if (stepId === "invariant") return "staircase-setup";
    if (stepId.includes("solve_1")) return "staircase-motion";
    if (stepId.includes("solve_2")) return "staircase-drop";
    if (stepId.includes("solve_3") || stepId.includes("solve_4") || tokens.includes("answer") || tokens.includes("point:impact")) return "staircase-impact";
    if (tokens.includes("quantity:drop") || tokens.includes(":vy") || tokens.includes(":a")) return "staircase-drop";
    if (tokens.includes("*:v") || tokens.includes(":vx")) return "staircase-motion";
    return "staircase-setup";
  }
  if (world === "two_inclines") {
    if (stepId === "invariant") return "two-inclines-setup";
    if (visualAction === "highlight_collision" || visualAction === "highlight_final_answer" || tokens.includes("answer") || tokens.includes("point:q") || tokens.includes("velocity_at_q")) {
      return "two-inclines-impact";
    }
    return "two-inclines-launch";
  }
  if (world === "incline_collision") {
    if (stepId.includes("diagram") || visualAction === "show_incline_axes") return "incline-collision-read-diagram";
    if (stepId.includes("along") || tokens.includes("compare_incline_motion") || tokens.includes("gravity_tangent") || tokens.includes("along_plane")) return "incline-collision-along-cancel";
    if (stepId.includes("collision_equation") || visualAction === "highlight_collision" || tokens.includes("collision_equation")) return "incline-collision-equation";
    if (stepId.includes("answer") || tokens.includes("answer") || visualAction === "zoom_launch_vector") return "incline-collision-result";
    if (stepId.includes("normal_direction") || visualAction === "show_normal_return" || tokens.includes("gravity_normal") || tokens.includes("normal_direction")) return "incline-collision-normal-return";
    return "incline-collision-setup";
  }
  if (world === "incline") {
    if (visualAction === "show_incline_axes") return "incline-axes";
    if (visualAction === "zoom_launch_vector" || visualAction === "show_impact_velocity_triangle") return "incline-velocity-components";
    if (visualAction === "highlight_range" || visualAction === "highlight_collision" || visualAction === "highlight_final_answer") return "incline-range";
    if (tokens.includes("gravity:tangent") || tokens.includes("gravity_tangent") || tokens.includes("gravity:normal") || tokens.includes("gravity_normal") || tokens.includes("vector:g")) return "incline-gravity-components";
    if (tokens.includes("velocity:tangent") || tokens.includes("velocity_tangent") || tokens.includes("velocity:normal") || tokens.includes("velocity_normal") || tokens.includes("*:v") || tokens.includes(":vx") || tokens.includes(":vy")) return "incline-velocity-components";
    if (tokens.includes("quantity:r") || tokens.includes("range") || tokens.includes("point:impact") || tokens.includes("point:landing") || tokens.includes("answer")) return "incline-range";
    return "incline-axes";
  }
  if (world === "level_ground" || world === "height_launch") {
    if (visualAction === "zoom_launch_vector") return "launch-components";
    if (visualAction === "highlight_same_height") return "same-height";
    if (visualAction === "highlight_vertical_motion") return "time-flight";
    if (visualAction === "highlight_apex") return "apex";
    if (visualAction === "show_impact_velocity_triangle") return "descent-components";
    if (visualAction === "highlight_range" || visualAction === "highlight_collision" || visualAction === "highlight_final_answer") return "range";
  }
  if (stepId === "invariant" || tokens.includes("answer") || stepId.includes("takeaway") || stepId.includes("solve_4") || tokens.includes("quantity:r")) return "range";
  if (tokens.includes("delta_y") || tokens.includes("same_height") || stepId.includes("solve_2")) return "same-height";
  if (tokens.includes("quantity:t") || tokens.includes("flight_time") || tokens.includes("time") || stepId.includes("solve_3")) return "time-flight";
  if (tokens.includes("point:apex") || tokens.includes("quantity:h") || tokens.includes("height") || tokens.includes("max_height")) return "apex";
  if (stepId.includes("solve_1") || tokens.includes("vector:u") || tokens.includes("quantity:u") || tokens.includes("ux") || tokens.includes("uy") || tokens.includes("x_velocity") || tokens.includes("y_velocity")) return "launch-components";
  if (tokens.includes("current_position") || tokens.includes("angle_condition") || tokens.includes("point:landing") || tokens.includes("event:landing")) return "descent-components";
  if (tokens.includes("range")) return "range";
  return "launch-components";
}

function TextbookAuditHooks({
  vectors,
  points,
  surfaces,
  actors,
}: {
  vectors: NonNullable<SceneSpec2D["live_vectors"]>;
  points: Record<string, Point2>;
  surfaces: Array<Record<string, unknown>>;
  actors: NonNullable<SceneSpec2D["actors"]>;
}) {
  return (
    <g style={{ display: "none" }}>
      {vectors.map((vector, index) => (
        <g key={vector.id} data-audit-vector-id={vector.id} data-audit-vector-component={vector.component} data-audit-vector-kind={vector.kind}>
          <line x1={index} y1={0} x2={index + 1} y2={0} />
        </g>
      ))}
      {Object.entries(points).map(([id], index) => (
        <g key={id} data-audit-point-id={id}>
          <circle cx={index} cy={0} r={1} />
        </g>
      ))}
      {surfaces.map((surface, index) => {
        const id = String(surface.id ?? `surface_${index}`);
        return (
          <g key={id} data-audit-surface-id={id}>
            <line x1={index} y1={1} x2={index + 1} y2={1} />
          </g>
        );
      })}
      {actors.map((actor, index) => (
        <g key={actor.id} data-audit-actor-id={actor.id}>
          <circle cx={index} cy={2} r={1} />
        </g>
      ))}
    </g>
  );
}

function TemplateArrow({ markerId, from, to, dashed = false, width = 0.62, auditId }: { markerId: string; from: Point2; to: Point2; dashed?: boolean; width?: number; auditId?: string }) {
  return (
    <line
      data-audit-template-line-id={auditId}
      data-audit-template-angle-deg={roundTemplateNumber(templateLineAngleDeg(from, to))}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={C.surface}
      strokeWidth={width}
      strokeLinecap="square"
      strokeDasharray={dashed ? "2.2 1.7" : undefined}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function TemplateDimensionArrow({ markerId, from, to, width = 0.42, auditId }: { markerId: string; from: Point2; to: Point2; width?: number; auditId?: string }) {
  return (
    <line
      data-audit-template-line-id={auditId}
      data-audit-template-angle-deg={roundTemplateNumber(templateLineAngleDeg(from, to))}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={C.surface}
      strokeWidth={width}
      strokeLinecap="square"
      markerStart={`url(#${markerId})`}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function TemplateSurface({ from, to, auditId = "surface" }: { from: Point2; to: Point2; auditId?: string }) {
  return (
    <line
      data-audit-template-line-id={auditId}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={C.surface}
      strokeWidth={0.58}
      strokeLinecap="round"
    />
  );
}

function TemplatePoint({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={3.15} fill={C.bg} stroke={C.surface} strokeWidth={0.7} />
      {label && <TextbookSvgText x={x - 2.8} y={y + 7.2} text={label} size={6.0} audit={false} />}
    </g>
  );
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function roundTemplateNumber(value: number) {
  return Number(value.toFixed(3));
}

function signedAngleDeg(degrees: number) {
  if (!Number.isFinite(degrees)) return 45;
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function templateLineAngleDeg(from: Point2, to: Point2) {
  return signedAngleDeg(radiansToDegrees(Math.atan2(from.y - to.y, to.x - from.x)));
}

function pointAtAngle(from: Point2, length: number, angleDeg: number): Point2 {
  const radians = degreesToRadians(angleDeg);
  return {
    x: from.x + length * Math.cos(radians),
    y: from.y - length * Math.sin(radians),
  };
}

function templateAngleArcPoints(origin: Point2, radius: number, startDeg: number, endDeg: number, steps = 24) {
  const sweep = signedAngleDeg(endDeg - startDeg);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startDeg + (sweep * index) / steps;
    return pointAtAngle(origin, radius, angle);
  }).map(point => `${point.x},${point.y}`).join(" ");
}

function pointBetween(from: Point2, to: Point2, t: number): Point2 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function offsetFromIncline(point: Point2, along: number, normal: number, angleDeg: number): Point2 {
  return pointAtAngle(pointAtAngle(point, along, angleDeg), normal, angleDeg + 90);
}

function inclineSegment(angleDeg: number, start: Point2, length: number) {
  return { start, end: pointAtAngle(start, length, angleDeg), angleDeg };
}

function risingInclineFrame(alphaDeg: number) {
  const length = Math.abs(alphaDeg) >= 50 ? 46 : 76;
  const start = Math.abs(alphaDeg) >= 50 ? { x: 30, y: 52 } : { x: 12, y: 52 };
  return inclineSegment(alphaDeg, start, length);
}

function descendingInclineFrame(alphaDeg: number) {
  const length = Math.abs(alphaDeg) >= 50 ? 47 : 74;
  const start = Math.abs(alphaDeg) >= 50 ? { x: 39, y: 11 } : { x: 16, y: 16 };
  return inclineSegment(-Math.abs(alphaDeg), start, length);
}

type LevelGroundTemplateVariant = "setup" | "components" | "peak-time" | "landing-condition" | "time" | "time-substitution" | "apex" | "range" | "summary";

function LevelGroundTemplate({
  markerId,
  variant,
  thetaText,
  thetaDeg,
  rangeText,
  heightText,
  timeText,
  speedText,
}: {
  markerId: string;
  variant: LevelGroundTemplateVariant;
  thetaText: string;
  thetaDeg: number;
  rangeText: string;
  heightText: string;
  timeText: string;
  answerText: string;
  speedText: string;
}) {
  const o = { x: 17, y: 47 };
  const a = { x: 50, y: 18 };
  const b = { x: 83, y: 47 };
  const theta = Math.max(12, Math.min(72, Math.abs(signedAngleDeg(thetaDeg || 45))));
  const launchTip = pointAtAngle(o, 31, theta);
  const uxTip = { x: launchTip.x, y: o.y };
  const uyTip = launchTip;
  const groundY = 47;
  const drawsWholePath = variant !== "setup" && variant !== "components" && variant !== "peak-time" && variant !== "time-substitution";
  const cleanSpeedText = speedText.replace(/\s*m\/s$/, " m/s").replace(/\s+/g, " ").trim();
  const launchSpeedLabel = cleanSpeedText === "u" ? "u" : `u = ${cleanSpeedText}`;
  const labelAuthority = createLabelPlacementAuthority<Point2>({
    bounds: { minX: 5, maxX: 95, minY: 5, maxY: 60 },
    ui: 3.2,
    initialOccupied: [
      segmentBox({ x: 8, y: groundY }, { x: 93, y: groundY }, 1.0),
      segmentBox(o, launchTip, 1.25),
      pointBox(o, 4.0),
      ...(drawsWholePath ? [
        segmentBox(o, b, 1.0),
        pointBox(a, 3.6),
        pointBox(b, 4.0),
      ] : []),
      ...(variant === "peak-time" ? [
        segmentBox(o, a, 1.0),
        segmentBox({ x: 30, y: 42 }, { x: 30, y: 27 }, 1.2),
        segmentBox({ x: 65, y: 25 }, { x: 65, y: 40 }, 1.2),
        pointBox(a, 4.0),
      ] : []),
      ...(variant === "components" ? [
        segmentBox(o, uxTip, 1.2),
        segmentBox(uxTip, uyTip, 1.2),
      ] : []),
      ...(variant === "time-substitution" ? [
        segmentBox(o, launchTip, 1.2),
        segmentBox(uxTip, uyTip, 1.2),
        pointBox(o, 4.0),
      ] : []),
      ...(variant === "apex" || variant === "summary" ? [segmentBox({ x: a.x - 6, y: a.y + 4.5 }, { x: a.x - 6, y: groundY }, 1.0)] : []),
      ...(variant === "range" || variant === "summary" ? [segmentBox({ x: o.x, y: 55.5 }, { x: b.x, y: 55.5 }, 1.0)] : []),
    ],
  });
  const labels: LabelCandidate<Point2>[] = [];
  if (variant === "setup") {
    labels.push(
      { key: "level-ground:u", x: launchTip.x + 2.2, y: launchTip.y - 2.2, text: launchSpeedLabel, size: 4.6, priority: 80 },
      { key: "level-ground:theta", x: o.x + 14.5, y: o.y - 3.6, text: thetaText, size: 3.9, priority: 78 },
    );
  }
  if (variant === "components") {
    labels.push(
      { key: "level-ground:ux", x: o.x + 15.8, y: o.y + 9.2, text: "uₓ = u cos θ", size: 4.15, anchor: "start", priority: 92 },
      { key: "level-ground:uy", x: uxTip.x + 5.0, y: (uxTip.y + uyTip.y) / 2, text: "uᵧ = u sin θ", size: 3.65, priority: 91 },
      { key: "level-ground:u", x: launchTip.x + 2.5, y: launchTip.y - 1.8, text: "u", size: 4.9, priority: 80 },
      { key: "level-ground:theta", x: o.x + 13.2, y: o.y - 3.2, text: thetaText, size: 3.6, priority: 76 },
    );
  }
  if (variant === "time") {
    labels.push(
      { key: "level-ground:time-factor", x: 50.0, y: 36.0, text: "T(uᵧ − gT/2) = 0", size: 4.2, anchor: "middle", priority: 90, locked: true },
      { key: "level-ground:zero-root", x: 27.0, y: 58.0, text: "T = 0  (launch)", size: 3.7, anchor: "middle", priority: 88, locked: true },
      { key: "level-ground:time", x: 70.0, y: 58.0, text: "T = 2uᵧ/g  (landing)", size: 3.7, anchor: "middle", priority: 89, locked: true },
    );
  }
  if (variant === "landing-condition") {
    labels.push(
      { key: "level-ground:dy", x: 50.0, y: 41.0, text: "Δy = 0", size: 4.4, anchor: "middle", priority: 92, locked: true },
      { key: "level-ground:landing-equation", x: 50.0, y: 58.0, text: "0 = uᵧT − 1/2 gT²", size: 4.4, anchor: "middle", priority: 91, locked: true },
    );
  }
  if (variant === "time-substitution") {
    labels.push(
      { key: "level-ground:sub-u", x: launchTip.x + 2.5, y: launchTip.y - 1.8, text: "u", size: 4.8, priority: 88 },
      { key: "level-ground:sub-uy", x: uxTip.x + 4.2, y: (uxTip.y + uyTip.y) / 2, text: "uᵧ", size: 4.3, priority: 87 },
      { key: "level-ground:sub-theta", x: o.x + 13.2, y: o.y - 3.2, text: thetaText, size: 3.5, priority: 82 },
      { key: "level-ground:sub-relation", x: 66.0, y: 39.5, text: "uᵧ = u sin θ", size: 4.0, anchor: "middle", priority: 95, locked: true },
      { key: "level-ground:sub-time", x: 50.0, y: 56.5, text: "T = 2uᵧ/g  →  T = 2u sin θ/g", size: 4.0, anchor: "middle", priority: 94, locked: true },
    );
  }
  if (variant === "peak-time") {
    labels.push(
      { key: "level-ground:peak-vy-equation", x: 12.0, y: 13.2, text: "vᵧ(t) = uᵧ − gt", size: 3.8, priority: 95, locked: true },
      { key: "level-ground:peak-vy0", x: a.x + 8.0, y: a.y - 1.0, text: "at A: vᵧ = 0", size: 4.0, priority: 92, locked: true },
      { key: "level-ground:peak-zero-equation", x: 50.0, y: 45.2, text: "0 = uᵧ − gtₚₑₐₖ", size: 3.9, anchor: "middle", priority: 91, locked: true },
      { key: "level-ground:peak-time", x: 50.0, y: 53.2, text: "tₚₑₐₖ = uᵧ/g", size: 4.1, anchor: "middle", priority: 90, locked: true },
      { key: "level-ground:peak-uy", x: 32.8, y: 27.0, text: "uᵧ", size: 4.6, priority: 82, locked: true },
      { key: "level-ground:peak-g", x: 70.5, y: 31.0, text: "g", size: 5.0, priority: 80, locked: true },
    );
  }
  if (variant === "apex") {
    labels.push(
      { key: "level-ground:vy0", x: a.x + 8.0, y: a.y - 1.0, text: "vᵧ = 0", size: 4.8, priority: 91 },
      { key: "level-ground:ux-apex", x: a.x + 24.0, y: a.y - 2.0, text: "uₓ", size: 4.5, priority: 80 },
      { key: "level-ground:height", x: a.x - 14.0, y: 34.0, text: heightText, size: 4.15, anchor: "end", priority: 88 },
    );
  }
  if (variant === "range") {
    labels.push(
      { key: "level-ground:range", x: 50.0, y: 60.0, text: rangeText === "R" ? "R = uₓT" : rangeText, size: 4.6, anchor: "middle", priority: 90 },
      { key: "level-ground:ux-range", x: 43.0, y: 37.0, text: "uₓ", size: 4.6, priority: 75 },
    );
  }
  if (variant === "summary") {
    labels.push(
      { key: "level-ground:summary-time", x: 16.0, y: 13.0, text: timeText, size: 4.0, priority: 92, locked: true },
      { key: "level-ground:summary-height", x: 37.0, y: 35.0, text: heightText, size: 4.0, anchor: "end", priority: 91, locked: true },
      { key: "level-ground:summary-range", x: 50.0, y: 60.0, text: rangeText, size: 4.2, anchor: "middle", priority: 90, locked: true },
    );
  }
  const placedLabels = labelAuthority.place(labels);
  return (
    <g data-audit-template-family="level-ground">
      <line x1={8} y1={groundY} x2={93} y2={groundY} stroke={C.surface} strokeWidth={0.5} data-audit-template-line-id="level-ground-ground" />
      {drawsWholePath && (
        <path data-audit-template-line-id="level-ground-trajectory" d={`M ${o.x} ${o.y} C 31 18, 60 16, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.64} />
      )}
      <TemplatePoint x={o.x} y={o.y} label={variant === "time" ? undefined : "O"} />
      {drawsWholePath && <TemplatePoint x={b.x} y={b.y} label={variant === "time" ? undefined : "B"} />}
      {variant === "time" && (
        <>
          <TextbookSvgText x={o.x - 5.0} y={o.y + 1.7} text="O" size={4.8} anchor="end" audit={false} />
          <TextbookSvgText x={b.x + 5.0} y={b.y + 1.7} text="B" size={4.8} anchor="start" audit={false} />
        </>
      )}
      {(variant === "setup" || variant === "components" || variant === "time-substitution") && (
        <>
          <line x1={o.x} y1={o.y} x2={o.x + 34} y2={o.y} stroke={C.surface} strokeWidth={0.36} strokeDasharray="2 1.5" data-audit-template-line-id="level-ground-horizontal-reference" />
          <TemplateArrow markerId={markerId} from={o} to={launchTip} width={0.58} auditId="level-ground-u" />
          <polyline points={templateAngleArcPoints(o, 10.8, 0, theta, 16)} fill="none" stroke={C.surface} strokeWidth={0.48} data-audit-template-line-id="level-ground-theta-arc" />
        </>
      )}
      {variant === "components" && (
        <>
          <TemplateArrow markerId={markerId} from={o} to={uxTip} width={0.5} auditId="level-ground-ux" />
          <TemplateArrow markerId={markerId} from={uxTip} to={uyTip} width={0.5} auditId="level-ground-uy" />
          <path d={`M ${uxTip.x - 3.2} ${uxTip.y} L ${uxTip.x - 3.2} ${uxTip.y - 3.2} L ${uxTip.x} ${uxTip.y - 3.2}`} fill="none" stroke={C.surface} strokeWidth={0.38} data-audit-template-line-id="level-ground-component-right-angle" />
        </>
      )}
      {variant === "time-substitution" && (
        <>
          <line x1={o.x} y1={o.y} x2={uxTip.x} y2={uxTip.y} stroke={C.surface} strokeWidth={0.36} strokeDasharray="2 1.5" data-audit-template-line-id="level-ground-substitution-horizontal-guide" />
          <TemplateArrow markerId={markerId} from={uxTip} to={uyTip} width={0.5} auditId="level-ground-substitution-uy" />
        </>
      )}
      {variant === "peak-time" && (
        <>
          <path data-audit-template-line-id="level-ground-peak-trajectory" d={`M ${o.x} ${o.y} C 29 27, 40 19, ${a.x} ${a.y}`} fill="none" stroke={C.surface} strokeWidth={0.64} />
          <TemplatePoint x={a.x} y={a.y} />
          <TextbookSvgText x={a.x - 2.2} y={a.y - 5.3} text="A" size={5.8} audit={false} />
          <TemplateArrow markerId={markerId} from={{ x: 30, y: 42 }} to={{ x: 30, y: 27 }} width={0.46} auditId="level-ground-peak-uy" />
          <TemplateArrow markerId={markerId} from={{ x: 65, y: 25 }} to={{ x: 65, y: 40 }} width={0.46} auditId="level-ground-peak-g" />
        </>
      )}
      {variant === "landing-condition" && (
        <>
          <line x1={o.x + 4} y1={43.0} x2={b.x - 4} y2={43.0} stroke={C.surface} strokeWidth={0.4} strokeDasharray="2 1.6" data-audit-template-line-id="level-ground-same-height-reference" />
          <line x1={o.x} y1={43.0} x2={o.x} y2={groundY} stroke={C.surface} strokeWidth={0.4} />
          <line x1={b.x} y1={43.0} x2={b.x} y2={groundY} stroke={C.surface} strokeWidth={0.4} />
        </>
      )}
      {(variant === "apex" || variant === "summary") && (
        <>
          <TemplatePoint x={a.x} y={a.y} />
          <TextbookSvgText x={a.x - 2.2} y={a.y - 5.3} text="A" size={5.8} audit={false} />
          <line x1={a.x - 6} y1={a.y + 4.5} x2={a.x - 6} y2={groundY} stroke={C.surface} strokeWidth={0.34} strokeDasharray="2 1.5" data-audit-template-line-id="level-ground-height-guide" />
          <TemplateDimensionArrow markerId={markerId} from={{ x: a.x - 9.0, y: a.y + 4.5 }} to={{ x: a.x - 9.0, y: groundY - 1.4 }} width={0.42} auditId="level-ground-height" />
        </>
      )}
      {variant === "apex" && <TemplateArrow markerId={markerId} from={{ x: a.x + 2.0, y: a.y }} to={{ x: a.x + 22, y: a.y }} width={0.46} auditId="level-ground-apex-ux" />}
      {(variant === "range" || variant === "summary") && (
        <>
          <TemplateDimensionArrow markerId={markerId} from={{ x: o.x + 1.2, y: 55.5 }} to={{ x: b.x - 1.2, y: 55.5 }} width={0.42} auditId="level-ground-range" />
          <line x1={o.x} y1={52.2} x2={o.x} y2={58.4} stroke={C.surface} strokeWidth={0.38} data-audit-template-line-id="level-ground-range-left" />
          <line x1={b.x} y1={52.2} x2={b.x} y2={58.4} stroke={C.surface} strokeWidth={0.38} data-audit-template-line-id="level-ground-range-right" />
        </>
      )}
      {variant === "range" && <TemplateArrow markerId={markerId} from={{ x: 27, y: 39 }} to={{ x: 47, y: 39 }} width={0.46} auditId="level-ground-range-ux" />}
      <TextbookLabelLayer labels={placedLabels} />
    </g>
  );
}

function LaunchComponentsTemplate({ markerId, thetaText, thetaDeg }: { markerId: string; thetaText: string; thetaDeg: number }) {
  const theta = signedAngleDeg(thetaDeg);
  const radians = degreesToRadians(theta);
  const horizontalSign = Math.cos(radians) < -0.02 ? -1 : 1;
  const verticalSign = Math.sin(radians) < -0.02 ? -1 : 1;
  const o = { x: horizontalSign < 0 ? 66 : 31, y: verticalSign < 0 ? 28 : 41 };
  const uTip = pointAtAngle(o, 30, theta);
  const uxTip = { x: uTip.x, y: o.y };
  const uxLabel = pointBetween(o, uxTip, 0.5);
  const uyLabel = pointBetween(uxTip, uTip, 0.5);
  const uAnchor = horizontalSign < 0 ? "end" : "start";
  const uxLabelAnchor = horizontalSign < 0 ? "end" : "start";
  const uxLabelX = horizontalSign < 0 ? Math.min(o.x - 7, uxLabel.x + 2) : Math.max(o.x + 5, uxLabel.x - 2);
  const uyLabelX = uxTip.x + horizontalSign * 7.0;
  const uyLabelAnchor = horizontalSign > 0 ? "start" : "end";
  const nearlyVertical = Math.abs(Math.cos(radians)) < 0.08;
  const thetaLabelX = nearlyVertical ? o.x - 5.0 : o.x - horizontalSign * 13.0;
  const thetaLabelY = o.y + (verticalSign > 0 ? -14.0 : 15.0);
  const thetaLabelAnchor = nearlyVertical ? "end" : horizontalSign > 0 ? "start" : "end";
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 10, y: 53 }} to={{ x: 92, y: 53 }} width={0.48} auditId="launch-x-axis" />
      <TemplateArrow markerId={markerId} from={{ x: 10, y: 53 }} to={{ x: 10, y: 11 }} width={0.48} auditId="launch-y-axis" />
      <TextbookSvgText x={93.5} y={55.2} text="X" size={6.2} audit={false} />
      <TextbookSvgText x={14.3} y={13.2} text="Y" size={6.2} audit={false} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <line x1={o.x} y1={o.y} x2={o.x + 18} y2={o.y} stroke={C.surface} strokeWidth={0.36} strokeDasharray="2 1.5" data-audit-template-line-id="launch-positive-x-reference" />
      <TemplateArrow markerId={markerId} from={o} to={uxTip} auditId="launch-ux" />
      <TemplateArrow markerId={markerId} from={uxTip} to={uTip} auditId="launch-uy" />
      <TemplateArrow markerId={markerId} from={o} to={uTip} dashed auditId="launch-u" />
      <polyline points={templateAngleArcPoints(o, 9, 0, theta)} fill="none" stroke={C.surface} strokeWidth={0.5} data-audit-template-line-id="launch-theta-arc" />
      <TextbookSvgText x={uxLabelX} y={o.y + (verticalSign > 0 ? 8.5 : -5.0)} text="uₓ = u cos θ" size={4.45} anchor={uxLabelAnchor} />
      <TextbookSvgText x={uyLabelX} y={uyLabel.y + (verticalSign > 0 ? -0.8 : 4.8)} text="uᵧ = u sin θ" size={3.6} anchor={uyLabelAnchor} />
      <TextbookSvgText x={uTip.x + horizontalSign * 3.0} y={uTip.y + (verticalSign > 0 ? -2.0 : 5.0)} text="u" size={5.1} anchor={uAnchor} />
      <TextbookSvgText x={thetaLabelX} y={thetaLabelY} text={thetaText} size={3.25} anchor={thetaLabelAnchor} />
    </g>
  );
}

function ApexTemplate({ markerId, heightText }: { markerId: string; heightText: string }) {
  const a = { x: 50, y: 20 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 12, y: 53 }} to={{ x: 90, y: 53 }} width={0.48} auditId="apex-ground" />
      <path data-audit-template-line-id="apex-trajectory" d={`M 18 48 C 30 24, 43 15, ${a.x} ${a.y} C 57 21, 66 27, 76 42`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={a.x} y={a.y} />
      <TextbookSvgText x={a.x - 2.4} y={a.y - 5.4} text="A" size={6.2} />
      <TemplateArrow markerId={markerId} from={{ x: a.x, y: a.y + 3.4 }} to={{ x: a.x, y: 53 }} auditId="apex-height" />
      <TemplateArrow markerId={markerId} from={{ x: a.x + 1.2, y: a.y }} to={{ x: a.x + 25, y: a.y }} auditId="apex-horizontal-velocity" />
      <TextbookSvgText x={a.x + 6.2} y={a.y - 2.0} text="uₓ = u cos θ" size={5.3} />
      <TextbookSvgText x={25.0} y={10.8} text="uᵧ = 0" size={5.0} />
      <TextbookSvgText x={57.0} y={58.5} text={heightText} size={3.8} />
    </g>
  );
}

function DescentComponentsTemplate({ markerId, thetaText, thetaDeg }: { markerId: string; thetaText: string; thetaDeg: number }) {
  const theta = signedAngleDeg(thetaDeg);
  const horizontalSign = Math.cos(degreesToRadians(theta)) < -0.02 ? -1 : 1;
  const descentAngle = -Math.abs(theta || 35);
  const p = { x: horizontalSign < 0 ? 58 : 42, y: 28 };
  const uTip = pointAtAngle(p, 32, descentAngle);
  const uxTip = { x: uTip.x, y: p.y };
  const pathStart = { x: p.x - horizontalSign * 28, y: p.y - 16 };
  const pathEnd = { x: p.x + horizontalSign * 34, y: p.y + 25 };
  const uxLabel = pointBetween(p, uxTip, 0.5);
  const uyLabel = pointBetween(uxTip, uTip, 0.5);
  const thetaLabel = pointAtAngle(p, 13, descentAngle / 2);
  return (
    <g>
      <path data-audit-template-line-id="descent-trajectory" d={`M ${pathStart.x} ${pathStart.y} C ${p.x - horizontalSign * 12} ${p.y - 8}, ${p.x + horizontalSign * 12} ${p.y + 9}, ${pathEnd.x} ${pathEnd.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={p.x} y={p.y} />
      <line x1={p.x} y1={p.y} x2={p.x + 18} y2={p.y} stroke={C.surface} strokeWidth={0.36} strokeDasharray="2 1.5" data-audit-template-line-id="descent-positive-x-reference" />
      <TemplateArrow markerId={markerId} from={p} to={uxTip} auditId="descent-ux" />
      <TemplateArrow markerId={markerId} from={uxTip} to={uTip} auditId="descent-uy" />
      <TemplateArrow markerId={markerId} from={p} to={uTip} dashed auditId="descent-u" />
      <polyline points={templateAngleArcPoints(p, 9, 0, descentAngle)} fill="none" stroke={C.surface} strokeWidth={0.5} data-audit-template-line-id="descent-theta-arc" />
      <TextbookSvgText x={uxLabel.x} y={p.y - 4.5} text="uₓ = u cos θ" size={4.45} anchor="middle" />
      <TextbookSvgText x={uyLabel.x + (horizontalSign > 0 ? 2.5 : -2.5)} y={uyLabel.y + 4.5} text="uᵧ" size={4.7} anchor={horizontalSign > 0 ? "start" : "end"} />
      <TextbookSvgText x={thetaLabel.x} y={thetaLabel.y + 5.0} text={thetaText.replace("θ = ", "")} size={4.5} anchor="middle" />
    </g>
  );
}

function SameHeightTemplate({ markerId }: { markerId: string }) {
  const o = { x: 18, y: 45 };
  const b = { x: 82, y: 45 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 45 }} to={{ x: 93, y: 45 }} width={0.52} auditId="same-height-ground" />
      <path data-audit-template-line-id="same-height-trajectory" d={`M ${o.x} ${o.y} C 35 12, 59 12, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <line data-audit-template-line-id="same-height-reference" x1={o.x} y1={34} x2={b.x} y2={34} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2.2 1.7" />
      <TemplateArrow markerId={markerId} from={{ x: 50, y: 34 }} to={{ x: 50, y: 45 }} width={0.44} auditId="same-height-delta-y" />
      <TextbookSvgText x={12.0} y={17.0} text="same height" size={4.1} />
      <TextbookSvgText x={53.6} y={42.0} text="Δy = 0" size={4.8} />
    </g>
  );
}

function TimeFlightTemplate({ markerId }: { markerId: string }) {
  const o = { x: 19, y: 45 };
  const a = { x: 50, y: 18 };
  const b = { x: 82, y: 45 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 45 }} to={{ x: 93, y: 45 }} width={0.5} auditId="time-ground" />
      <path data-audit-template-line-id="time-trajectory" d={`M ${o.x} ${o.y} C 34 14, 62 14, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={a.x} y={a.y} />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <TextbookSvgText x={a.x - 2.2} y={a.y - 5.4} text="A" size={5.8} />
      <TemplateArrow markerId={markerId} from={{ x: 35, y: 40 }} to={{ x: 35, y: 24 }} auditId="time-upward-uy" />
      <TemplateArrow markerId={markerId} from={{ x: 65, y: 24 }} to={{ x: 65, y: 40 }} auditId="time-downward-g" />
      <TextbookSvgText x={21.5} y={23.5} text="uᵧ" size={5.0} />
      <TextbookSvgText x={73.5} y={27.0} text="g" size={5.0} />
      <TextbookSvgText x={50} y={58.3} text="T = 2uᵧ / g" size={5.1} anchor="middle" />
    </g>
  );
}

function RangeTemplate({ markerId, rangeText }: { markerId: string; rangeText: string }) {
  const o = { x: 18, y: 45 };
  const b = { x: 82, y: 45 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 45 }} to={{ x: 93, y: 45 }} width={0.52} auditId="range-ground" />
      <path data-audit-template-line-id="range-trajectory" d={`M ${o.x} ${o.y} C 35 12, 59 12, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <line data-audit-template-line-id="range-bracket" x1={o.x} y1={52} x2={b.x} y2={52} stroke={C.surface} strokeWidth={0.5} />
      <line data-audit-template-line-id="range-bracket-left" x1={o.x} y1={49.5} x2={o.x} y2={54.5} stroke={C.surface} strokeWidth={0.5} />
      <line data-audit-template-line-id="range-bracket-right" x1={b.x} y1={49.5} x2={b.x} y2={54.5} stroke={C.surface} strokeWidth={0.5} />
      <TextbookSvgText x={50} y={59} text={rangeText} size={5.5} anchor="middle" />
    </g>
  );
}

type PeakTimeTemplateVariant = "setup" | "velocity" | "condition" | "result";

function PeakTimeTemplate({ markerId, variant, timeText }: { markerId: string; variant: PeakTimeTemplateVariant; timeText: string }) {
  const o = { x: 18, y: 47 };
  const a = { x: 50, y: 18 };
  const b = { x: 82, y: 47 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 47 }} to={{ x: 93, y: 47 }} width={0.5} auditId="peak-time-ground" />
      <path data-audit-template-line-id="peak-time-trajectory" d={`M ${o.x} ${o.y} C 32 18, 45 14, ${a.x} ${a.y} C 58 21, 69 31, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={a.x} y={a.y} />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      {(variant === "velocity" || variant === "condition" || variant === "result") && (
        <TemplateArrow markerId={markerId} from={{ x: a.x - 17, y: a.y }} to={{ x: a.x - 2.8, y: a.y }} width={0.44} auditId="peak-time-horizontal-v" />
      )}
      {(variant === "setup" || variant === "velocity") && (
        <TemplateArrow markerId={markerId} from={{ x: 30, y: 42 }} to={{ x: 30, y: 27 }} width={0.48} auditId="peak-time-uy" />
      )}
      <TextbookSvgText x={a.x - 2.0} y={a.y - 5.4} text="A" size={5.6} />
      {variant === "setup" && (
        <>
          <TextbookSvgText x={58.0} y={14.0} text="highest point" size={4.5} audit={false} />
          <TextbookSvgText x={18.5} y={24.5} text="uᵧ" size={4.7} />
          <TextbookSvgText x={50} y={58.4} text="find time to reach A" size={4.1} anchor="middle" audit={false} />
        </>
      )}
      {variant === "velocity" && (
        <>
          <TextbookSvgText x={21.0} y={24.5} text="uᵧ" size={4.7} />
          <TextbookSvgText x={56.0} y={14.0} text="vᵧ(t) = uᵧ - gt" size={4.1} audit={false} />
          <TextbookSvgText x={50} y={58.4} text="vertical velocity changes only by g" size={3.7} anchor="middle" audit={false} />
        </>
      )}
      {variant === "condition" && (
        <>
          <TextbookSvgText x={59.0} y={15.0} text="vᵧ = 0" size={5.1} />
          <TextbookSvgText x={50} y={58.4} text="at the highest point" size={4.1} anchor="middle" audit={false} />
        </>
      )}
      {variant === "result" && (
        <>
          <TextbookSvgText x={59.0} y={15.0} text="vᵧ = 0" size={5.1} />
          <TextbookSvgText x={50} y={58.4} text={timeText} size={5.0} anchor="middle" />
        </>
      )}
    </g>
  );
}

function MultiResultTemplate({ markerId, rangeText, heightText, timeText }: { markerId: string; rangeText: string; heightText: string; timeText: string }) {
  const o = { x: 11, y: 47 };
  const a = { x: 35, y: 20 };
  const b = { x: 59, y: 47 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 6, y: 47 }} to={{ x: 64, y: 47 }} width={0.46} auditId="multi-ground" />
      <path data-audit-template-line-id="multi-trajectory" d={`M ${o.x} ${o.y} C 22 16, 45 16, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.58} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={a.x} y={a.y} />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <line x1={a.x} y1={23.5} x2={a.x} y2={47} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2.0 1.6" data-audit-template-line-id="multi-height-guide" />
      <line x1={o.x} y1={53.0} x2={b.x} y2={53.0} stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="multi-range-guide" />
      <TextbookSvgText x={38.5} y={34.5} text={heightText} size={3.6} audit={false} />
      <TextbookSvgText x={35.0} y={60.0} text={rangeText} size={3.9} anchor="middle" audit={false} />
      <TextbookSvgText x={69.0} y={10.5} text="requested values" size={3.7} audit={false} />
      <TextbookSvgText x={68.0} y={19.0} text="uₓ = u cosθ" size={3.35} />
      <TextbookSvgText x={68.0} y={27.0} text="uᵧ = u sinθ" size={3.35} />
      <TextbookSvgText x={68.0} y={35.0} text="tₚ = uᵧ/g" size={3.35} />
      <TextbookSvgText x={68.0} y={43.0} text="T = 2uᵧ/g" size={3.35} />
      <TextbookSvgText x={68.0} y={51.0} text="H = uᵧ²/2g" size={3.25} />
      <TextbookSvgText x={68.0} y={58.4} text={rangeText === "R" ? "R = uₓT" : rangeText} size={3.25} audit={false} />
    </g>
  );
}

function MultiEquationBridgeTemplate({ markerId, rangeText, heightText, timeText }: { markerId: string; rangeText: string; heightText: string; timeText: string }) {
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 49 }} to={{ x: 92, y: 49 }} width={0.46} auditId="multi-bridge-ground" />
      <path data-audit-template-line-id="multi-bridge-trajectory" d="M 16 49 C 31 17, 56 17, 80 49" fill="none" stroke={C.surface} strokeWidth={0.56} />
      <TemplatePoint x={16} y={49} label="O" />
      <TemplatePoint x={80} y={49} label="B" />
      <TemplateArrow markerId={markerId} from={{ x: 23, y: 43 }} to={{ x: 23, y: 27 }} width={0.44} auditId="multi-bridge-uy" />
      <TemplateArrow markerId={markerId} from={{ x: 34, y: 49 }} to={{ x: 53, y: 49 }} width={0.44} auditId="multi-bridge-ux" />
      <TextbookSvgText x={15.0} y={13.0} text="connect components" size={4.0} audit={false} />
      <TextbookSvgText x={15.0} y={21.5} text="uₓ gives R = uₓT" size={3.85} />
      <TextbookSvgText x={57.0} y={15.0} text={timeText === "T" ? "T from vertical" : timeText} size={3.7} audit={false} />
      <TextbookSvgText x={57.0} y={24.0} text={heightText === "H" ? "H = uᵧ²/2g" : heightText} size={3.7} audit={false} />
      <TextbookSvgText x={57.0} y={33.0} text={rangeText === "R" ? "R = uₓT" : rangeText} size={3.7} audit={false} />
    </g>
  );
}

type HeightLaunchTemplateVariant = "setup" | "condition" | "result" | "time-setup" | "time-condition" | "time-factor" | "time-result";

function HeightLaunchTemplate({
  markerId,
  variant,
  rangeText,
  heightText,
  timeText,
}: {
  markerId: string;
  variant: HeightLaunchTemplateVariant;
  rangeText: string;
  heightText: string;
  timeText: string;
}) {
  const launch = { x: 31, y: 28 };
  const landing = { x: 83, y: 52 };
  const isTimeOnly = variant.startsWith("time-");
  return (
    <g>
      <line x1={9} y1={52} x2={92} y2={52} stroke={C.surface} strokeWidth={0.58} data-audit-template-line-id="height-launch-ground" />
      <line x1={10} y1={28} x2={31} y2={28} stroke={C.surface} strokeWidth={0.66} data-audit-template-line-id="height-launch-platform-top" />
      <line x1={10} y1={28} x2={10} y2={52} stroke={C.surface} strokeWidth={0.66} data-audit-template-line-id="height-launch-platform-side" />
      <path data-audit-template-line-id="height-launch-trajectory" d={`M ${launch.x} ${launch.y} C 45 12, 67 21, ${landing.x} ${landing.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={launch.x} y={launch.y} label="O" />
      <TemplatePoint x={landing.x} y={landing.y} label="B" />
      <TemplateArrow markerId={markerId} from={launch} to={{ x: launch.x + 20, y: launch.y - 9 }} auditId="height-launch-u" />
      <TemplateArrow markerId={markerId} from={{ x: 21, y: 31 }} to={{ x: 21, y: 49 }} width={0.44} auditId="height-launch-h" />
      {!isTimeOnly && <line x1={launch.x} y1={58} x2={landing.x} y2={58} stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="height-launch-range-bracket" />}
      <TextbookSvgText x={24.0} y={42.0} text={heightText === "H" ? "h" : heightText.replace("H =", "h =")} size={4.6} />
      {!isTimeOnly && <TextbookSvgText x={58.0} y={56.3} text={rangeText} size={3.9} anchor="middle" audit={false} />}
      {variant === "setup" && <TextbookSvgText x={49.0} y={10.0} text="raised launch" size={4.8} audit={false} />}
      {variant === "condition" && (
        <>
          <TextbookSvgText x={43.0} y={9.5} text="ground condition" size={4.2} audit={false} />
          <TextbookSvgText x={45.0} y={16.5} text="0 = h + uᵧt - 1/2gt²" size={3.7} audit={false} />
        </>
      )}
      {variant === "result" && (
        <>
          <TextbookSvgText x={45.0} y={9.5} text={timeText === "T" ? "find T first" : timeText} size={4.2} audit={false} />
          <TextbookSvgText x={47.5} y={16.5} text="then R = uₓT" size={4.1} audit={false} />
        </>
      )}
      {variant === "time-setup" && <TextbookSvgText x={43.0} y={10.0} text="find flight time" size={4.8} audit={false} />}
      {variant === "time-condition" && (
        <>
          <TextbookSvgText x={39.0} y={9.5} text="landing condition" size={4.2} audit={false} />
          <TextbookSvgText x={45.0} y={16.5} text="0 = h + uᵧt - 1/2gt²" size={3.7} audit={false} />
        </>
      )}
      {variant === "time-factor" && (
        <>
          <TextbookSvgText x={28.0} y={9.5} text="0 = h + uᵧT - 1/2gT²" size={3.55} audit={false} />
          <TextbookSvgText x={36.0} y={16.5} text={timeText === "T" ? "T = positive root" : timeText} size={4.0} audit={false} />
          <TextbookSvgText x={43.0} y={47.0} text="choose positive root" size={3.65} audit={false} />
        </>
      )}
      {variant === "time-result" && (
        <>
          <TextbookSvgText x={44.0} y={9.5} text={timeText === "T" ? "flight time" : timeText} size={4.4} audit={false} />
          <TextbookSvgText x={47.5} y={16.5} text="vertical motion only" size={4.0} audit={false} />
        </>
      )}
    </g>
  );
}

type HorizontalCliffTemplateVariant = "setup" | "fall-time" | "range" | "impact-vertical" | "impact-speed" | "impact-angle";

function HorizontalCliffTemplate({
  markerId,
  variant,
  rangeText,
  heightText,
  timeText,
  answerText = "",
  speedText = "u",
  direction = 1,
}: {
  markerId: string;
  variant: HorizontalCliffTemplateVariant;
  rangeText: string;
  heightText: string;
  timeText: string;
  answerText?: string;
  speedText?: string;
  direction?: number;
}) {
  const dir = direction < 0 ? -1 : 1;
  const mirrorX = (x: number) => dir < 0 ? 100 - x : x;
  const mapPoint = (point: Point2): Point2 => ({ x: mirrorX(point.x), y: point.y });
  const mirrorAnchor = (anchor?: "start" | "middle" | "end") => {
    if (dir > 0 || anchor === "middle" || !anchor) return anchor;
    return anchor === "start" ? "end" : "start";
  };
  const mapLabel = (label: LabelCandidate): LabelCandidate => ({
    ...label,
    x: mirrorX(label.x),
    anchor: mirrorAnchor(label.anchor),
    leaderFrom: label.leaderFrom ? mapPoint(label.leaderFrom) : undefined,
  });
  const cleanSpeedText = speedText.replace(/\s*m\/s$/, " m/s").replace(/\s+/g, " ").trim();
  const launchSpeedLabel = speedText === "u" ? "u" : `u = ${cleanSpeedText}`;

  if (variant === "impact-angle") {
    const o = mapPoint({ x: 32, y: 38 });
    const vxTip = mapPoint({ x: 68, y: 38 });
    const vTip = mapPoint({ x: 68, y: 53 });
    const angleSpan = Math.abs(radiansToDegrees(Math.atan2(vTip.y - o.y, Math.abs(vTip.x - o.x))));
    const arcStart = dir > 0 ? 0 : 180;
    const arcEnd = dir > 0 ? -angleSpan : 180 + angleSpan;
    return (
      <g>
        <TextbookSvgText x={50} y={14} text="impact angle" size={4.6} anchor="middle" />
        <TextbookSvgText x={50} y={24} text="tan θ = vᵧ / vₓ" size={4.5} anchor="middle" />
        <TemplateArrow markerId={markerId} from={o} to={vxTip} width={0.56} auditId="horizontal-cliff-angle-vx" />
        <TemplateArrow markerId={markerId} from={vxTip} to={vTip} width={0.56} auditId="horizontal-cliff-angle-vy" />
        <TemplateArrow markerId={markerId} from={o} to={vTip} width={0.62} auditId="horizontal-cliff-angle-v" />
        <path d={`M ${vxTip.x - dir * 3.4} ${vxTip.y} L ${vxTip.x - dir * 3.4} ${vxTip.y + 3.4} L ${vxTip.x} ${vxTip.y + 3.4}`} fill="none" stroke={C.surface} strokeWidth={0.42} data-audit-template-line-id="horizontal-cliff-angle-right-angle" />
        <polyline points={templateAngleArcPoints(o, 8.2, arcStart, arcEnd, 16)} fill="none" stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="horizontal-cliff-angle-theta-arc" />
        <TextbookSvgText x={mirrorX(49.5)} y={34.2} text="vₓ" size={4.1} anchor="middle" />
        <TextbookSvgText x={mirrorX(71.5)} y={47.2} text="vᵧ" size={4.1} anchor={dir > 0 ? "start" : "end"} />
        <TextbookSvgText x={mirrorX(51.0)} y={49.8} text="v" size={4.4} anchor="middle" />
        <TextbookSvgText x={mirrorX(42.2)} y={43.2} text="θ" size={4.1} anchor="middle" />
      </g>
    );
  }

  const launchBase = { x: 27, y: 20 };
  const groundY = 49;
  const impactBase = { x: 80, y: groundY };
  const impactTriangleDx = 15.0;
  const impactTriangleDy = 8.4;
  const impactVxTipBase = { x: impactBase.x + impactTriangleDx, y: impactBase.y };
  const impactVyTipBase = { x: impactBase.x, y: impactBase.y + impactTriangleDy };
  const impactVTipBase = { x: impactBase.x + impactTriangleDx, y: impactBase.y + impactTriangleDy };
  const launch = mapPoint(launchBase);
  const impact = mapPoint(impactBase);
  const impactVxTip = mapPoint(impactVxTipBase);
  const impactVyTip = mapPoint(impactVyTipBase);
  const impactVTip = mapPoint(impactVTipBase);
  const impactAngleText = "θ";
  const showRange = variant === "range";
  const showTrajectory = variant === "range" || variant.startsWith("impact");
  const showLaunchVector = variant === "setup" || variant === "range";
  const showGravity = variant === "setup" || variant === "fall-time";
  const showHeightDimension = variant === "setup" || variant === "fall-time" || variant === "range" || variant.startsWith("impact");
  const showLaunchPoint = variant === "setup" || variant === "fall-time" || variant === "range";
  const showImpactVertical = variant === "impact-vertical";
  const showImpactTriangle = variant === "impact-speed";
  const showImpactAngle = false;
  const launchPointLabel = variant === "setup" || variant === "range" ? "O" : undefined;
  const gravityFromBase = { x: 63, y: 21 };
  const gravityToBase = { x: 63, y: 33 };
  const launchVectorToBase = { x: launchBase.x + 22, y: launchBase.y };
  const gravityFrom = mapPoint(gravityFromBase);
  const gravityTo = mapPoint(gravityToBase);
  const launchVectorTo = mapPoint(launchVectorToBase);
  const heightLabelText = "h";
  const groundEndBaseX = showImpactVertical ? impactBase.x + 3.2 : showImpactTriangle ? impactBase.x + impactTriangleDx + 2.0 : 93;
  const groundStart = mapPoint({ x: 9, y: groundY });
  const groundEnd = mapPoint({ x: groundEndBaseX, y: groundY });
  const labelAuthority = createLabelPlacementAuthority({
    bounds: { minX: 5, maxX: showImpactVertical || showImpactTriangle ? 99 : 95, minY: 5, maxY: 60 },
    ui: 1,
    initialOccupied: [
      segmentBox(groundStart, groundEnd, 1.1),
      segmentBox(mapPoint({ x: 10, y: 20 }), launch, 1.0),
      segmentBox(mapPoint({ x: 10, y: 20 }), mapPoint({ x: 10, y: groundY }), 1.0),
      ...(showTrajectory ? [segmentBox(launch, impact, 1.4)] : []),
      ...(showLaunchPoint ? [pointBox(launch, 3.4)] : []),
      ...(showTrajectory ? [pointBox(impact, showImpactVertical ? 3.0 : 3.2)] : []),
      ...(showLaunchVector ? [segmentBox(launch, launchVectorTo, 1.35)] : []),
      ...(showGravity ? [segmentBox(gravityFrom, gravityTo, 1.45)] : []),
      ...(showHeightDimension ? [segmentBox(mapPoint({ x: 18, y: 22.5 }), mapPoint({ x: 18, y: groundY - 2.5 }), 1.6)] : []),
      ...(showRange ? [segmentBox(mapPoint({ x: launchBase.x, y: 56.5 }), mapPoint({ x: impactBase.x, y: 56.5 }), 1.0)] : []),
      ...(showImpactVertical ? [segmentBox(impact, mapPoint({ x: impactBase.x, y: impactBase.y + 9.0 }), 0.9)] : []),
      ...(showImpactTriangle ? [
        segmentBox(impact, impactVxTip, 1.3),
        segmentBox(impact, impactVyTip, 1.3),
        segmentBox(impact, impactVTip, 1.4),
      ] : []),
    ],
  });
  const placedTemplateLabels = labelAuthority.place([
    ...(showHeightDimension ? [{
      key: "horizontal-cliff:height-label",
      x: 21.8,
      y: 36.0,
      text: heightLabelText,
      size: 4.0,
      leaderFrom: { x: 18, y: 35.5 },
      priority: 86,
    }] : []),
    ...(showLaunchVector ? [{
      key: "horizontal-cliff:launch-speed-label",
      x: 42.0,
      y: 17.0,
      text: launchSpeedLabel,
      size: 3.75,
      leaderFrom: { x: 40, y: 20 },
      priority: 92,
    }] : []),
    ...(showGravity ? [{
      key: "horizontal-cliff:g-label",
      x: 66.0,
      y: 32.0,
      text: "g",
      size: 4.0,
      leaderFrom: gravityToBase,
      priority: 88,
    }] : []),
    ...(variant === "setup" ? [
      {
        key: "horizontal-cliff:title",
        x: 43.0,
        y: 9.0,
        text: "horizontal launch",
        size: 4.6,
        anchor: "start" as const,
        priority: 45,
      },
      {
        key: "horizontal-cliff:uy-zero",
        x: 39.0,
        y: 29.2,
        text: "uᵧ = 0",
        size: 4.0,
        leaderFrom: launchBase,
        priority: 82,
      },
    ] : []),
    ...(variant === "fall-time" ? [
      {
        key: "horizontal-cliff:fall-time-title",
        x: 50.0,
        y: 10.8,
        text: "fall time from height",
        size: 4.25,
        anchor: "middle" as const,
        priority: 92,
      },
      {
        key: "horizontal-cliff:fall-time-equation",
        x: 50.0,
        y: 18.2,
        text: "h = 1/2 gT²",
        size: 4.0,
        anchor: "middle" as const,
        priority: 74,
      },
      {
        key: "horizontal-cliff:fall-time-result",
        x: 42.0,
        y: 58.0,
        text: timeText === "T" ? "T from vertical fall" : timeText,
        size: 3.8,
        anchor: "middle" as const,
        priority: 78,
      },
    ] : []),
    ...(showRange ? [{
      key: "horizontal-cliff:range-label",
      x: 55.0,
      y: 54.7,
      text: rangeText === "R" ? "R = vₓT" : rangeText,
      size: 3.9,
      anchor: "middle" as const,
      leaderFrom: { x: 55, y: 56.5 },
      priority: 82,
    }] : []),
    ...(variant === "range" ? [
      {
        key: "horizontal-cliff:range-title",
        x: 42.0,
        y: 9.0,
        text: "horizontal distance",
        size: 4.35,
        priority: 45,
      },
      {
        key: "horizontal-cliff:range-equation",
        x: 43.0,
        y: 15.8,
        text: "R = vₓT",
        size: 4.1,
        priority: 72,
      },
    ] : []),
    ...(showImpactVertical ? [
      {
        key: "horizontal-cliff:impact-vy-title",
        x: 62.0,
        y: 14.0,
        text: "vertical speed at impact",
        size: 4.0,
        anchor: "middle" as const,
        priority: 45,
      },
      {
        key: "horizontal-cliff:impact-vy-label",
        x: 84.8,
        y: 56.2,
        text: "vᵧ = gt",
        size: 3.35,
        anchor: "start" as const,
        leaderFrom: { x: impactBase.x, y: impactBase.y + 8.4 },
        priority: 94,
        locked: true,
      },
    ] : []),
    ...(showImpactTriangle ? [
      {
        key: "horizontal-cliff:impact-vx-label",
        x: 94.0,
        y: 46.3,
        text: "vₓ",
        size: 3.25,
        anchor: "start" as const,
        leaderFrom: impactVxTipBase,
        priority: 86,
        locked: true,
      },
      {
        key: "horizontal-cliff:impact-vy-triangle-label",
        x: 76.8,
        y: 59.0,
        text: "vᵧ",
        size: 3.35,
        anchor: "end" as const,
        leaderFrom: impactVyTipBase,
        priority: 86,
        locked: true,
      },
      {
        key: "horizontal-cliff:impact-speed-label",
        x: 93.4,
        y: 56.8,
        text: "v",
        size: 3.65,
        anchor: "start" as const,
        leaderFrom: impactVTipBase,
        priority: 90,
        locked: true,
      },
      {
        key: "horizontal-cliff:impact-triangle-title",
        x: 55.5,
        y: 9.0,
        text: "impact velocity triangle",
        size: 4.0,
        anchor: "middle" as const,
        priority: 45,
      },
      ...(showImpactAngle ? [
        {
          key: "horizontal-cliff:impact-angle-label",
          x: 89.7,
          y: 53.4,
          text: impactAngleText,
          size: 3.35,
          leaderFrom: { x: impactBase.x + 5.5, y: impactBase.y + 4.3 },
          priority: 88,
        },
        {
          key: "horizontal-cliff:impact-angle-equation",
          x: 61.0,
          y: 39.6,
          text: "tan θ = vᵧ / vₓ",
          size: 3.15,
          anchor: "start" as const,
          leaderFrom: { x: impactBase.x + 5.2, y: impactBase.y + 4.6 },
          priority: 96,
          locked: true,
        },
      ] : []),
    ] : []),
  ].map(mapLabel) satisfies LabelCandidate[]);
  return (
    <g>
      <line x1={groundStart.x} y1={groundStart.y} x2={groundEnd.x} y2={groundEnd.y} stroke={C.surface} strokeWidth={0.62} data-audit-template-line-id="horizontal-cliff-ground" />
      <line x1={mapPoint({ x: 10, y: 20 }).x} y1={20} x2={launch.x} y2={launch.y} stroke={C.surface} strokeWidth={0.72} data-audit-template-line-id="horizontal-cliff-top" />
      <line x1={mapPoint({ x: 10, y: 20 }).x} y1={20} x2={mapPoint({ x: 10, y: groundY }).x} y2={groundY} stroke={C.surface} strokeWidth={0.72} data-audit-template-line-id="horizontal-cliff-side" />
      {showTrajectory && (
        <path data-audit-template-line-id="horizontal-cliff-trajectory" d={`M ${launch.x} ${launch.y} C ${mapPoint({ x: 47, y: 20 }).x} 20, ${mapPoint({ x: 67, y: 34 }).x} 34, ${impact.x} ${impact.y}`} fill="none" stroke={C.surface} strokeWidth={0.64} />
      )}
      {showLaunchPoint && <TemplatePoint x={launch.x} y={launch.y} label={launchPointLabel} />}
      {showTrajectory && <TemplatePoint x={impact.x} y={impact.y} />}
      {showLaunchVector && <TemplateArrow markerId={markerId} from={launch} to={launchVectorTo} auditId="horizontal-cliff-vx" />}
      {showHeightDimension && (
        <>
          <line x1={mapPoint({ x: 10, y: 20 }).x} y1={20} x2={mapPoint({ x: 18, y: 20 }).x} y2={20} stroke={C.surface} strokeWidth={0.34} data-audit-template-line-id="horizontal-cliff-height-top-guide" />
          <line x1={mapPoint({ x: 10, y: groundY }).x} y1={groundY} x2={mapPoint({ x: 18, y: groundY }).x} y2={groundY} stroke={C.surface} strokeWidth={0.34} data-audit-template-line-id="horizontal-cliff-height-bottom-guide" />
          <TemplateDimensionArrow markerId={markerId} from={mapPoint({ x: 18, y: 22.5 })} to={mapPoint({ x: 18, y: groundY - 2.5 })} width={0.42} auditId="horizontal-cliff-height" />
        </>
      )}
      {showGravity && (
        <>
          <TemplateArrow markerId={markerId} from={gravityFrom} to={gravityTo} width={0.42} auditId="horizontal-cliff-g" />
        </>
      )}
      {variant === "fall-time" && (
        <></>
      )}
      {showRange && (
        <>
          <line x1={mapPoint({ x: launchBase.x, y: 56.5 }).x} y1={56.5} x2={mapPoint({ x: impactBase.x, y: 56.5 }).x} y2={56.5} stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="horizontal-cliff-range" />
        </>
      )}
      {variant === "range" && (
        <></>
      )}
      {showImpactVertical && (
        <>
          <TemplateArrow markerId={markerId} from={impact} to={mapPoint({ x: impactBase.x, y: impactBase.y + 9.0 })} width={0.54} auditId="horizontal-cliff-impact-vy" />
        </>
      )}
      {showImpactTriangle && (
        <>
          <TemplateArrow markerId={markerId} from={impact} to={impactVxTip} width={0.46} auditId="horizontal-cliff-impact-vx" />
          <TemplateArrow markerId={markerId} from={impact} to={impactVyTip} width={0.46} auditId="horizontal-cliff-impact-vy" />
          <TemplateArrow markerId={markerId} from={impact} to={impactVTip} width={0.52} auditId="horizontal-cliff-impact-v" />
          {showImpactAngle && (
            <>
              <path d={`M ${impact.x + 2.9} ${impact.y} L ${impact.x + 2.9} ${impact.y + 2.9} L ${impact.x} ${impact.y + 2.9}`} fill="none" stroke={C.surface} strokeWidth={0.36} data-audit-template-line-id="horizontal-cliff-impact-right-angle" />
              <path d={`M ${impact.x + 7.1} ${impact.y} A 7.1 7.1 0 0 1 ${impact.x + 4.6} ${impact.y + 5.4}`} fill="none" stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="horizontal-cliff-impact-angle" />
            </>
          )}
        </>
      )}
      <TextbookLabelLayer labels={placedTemplateLabels} />
    </g>
  );
}

type WallClearanceTemplateVariant = "setup" | "relation" | "result";

function WallClearanceTemplate({ markerId, variant, answerText = "" }: { markerId: string; variant: WallClearanceTemplateVariant; answerText?: string }) {
  const o = { x: 14, y: 48 };
  const top = { x: 66, y: 31 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 7, y: 54 }} to={{ x: 93, y: 54 }} width={0.5} auditId="wall-ground" />
      <path data-audit-template-line-id="wall-trajectory" d={`M ${o.x} ${o.y} C 31 18, 54 17, 86 49`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <line x1={66} y1={31} x2={66} y2={54} stroke={C.surface} strokeWidth={0.86} data-audit-template-line-id="wall-obstacle" />
      <line x1={60} y1={31} x2={72} y2={31} stroke={C.surface} strokeWidth={0.54} data-audit-template-line-id="wall-top" />
      <circle cx={top.x} cy={top.y} r={2.2} fill={C.bg} stroke={C.surface} strokeWidth={0.58} />
      <line x1={66} y1={18} x2={66} y2={31} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="wall-clearance-guide" />
      <TemplateArrow markerId={markerId} from={o} to={{ x: o.x + 20, y: o.y - 12 }} auditId="wall-launch-u" />
      <TextbookSvgText x={72.0} y={47.0} text="wall" size={4.7} audit={false} />
      <TextbookSvgText x={70.0} y={24.0} text="clearance" size={4.1} />
      {variant === "setup" && <TextbookSvgText x={30.0} y={11.5} text="projectile clears wall?" size={4.6} audit={false} />}
      {variant === "relation" && <TextbookSvgText x={30.0} y={11.5} text="evaluate y at wall" size={4.6} audit={false} />}
      {variant === "result" && (
        <>
          <TextbookSvgText x={31.0} y={11.5} text="compare with wall height" size={4.2} audit={false} />
          <TextbookSvgText x={27.0} y={60.0} text={answerText || "clearance = 2 m"} size={4.2} />
        </>
      )}
      {variant !== "result" && <TextbookSvgText x={37.0} y={60.0} text="x = wall distance" size={3.8} audit={false} />}
    </g>
  );
}

type TargetHitTemplateVariant = "setup" | "equation" | "time";

function TargetHitTemplate({ markerId, thetaText, variant, answerText = "" }: { markerId: string; thetaText: string; variant: TargetHitTemplateVariant; answerText?: string }) {
  const o = { x: 16, y: 49 };
  const target = { x: 78, y: 29 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 52 }} to={{ x: 93, y: 52 }} width={0.46} auditId="target-x-axis" />
      <TemplateArrow markerId={markerId} from={{ x: 12, y: 55 }} to={{ x: 12, y: 10 }} width={0.46} auditId="target-y-axis" />
      <path data-audit-template-line-id="target-trajectory" d={`M ${o.x} ${o.y} C 31 19, 55 14, ${target.x} ${target.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      {variant === "time" && (
        <path data-audit-template-line-id="target-trajectory-alt" d={`M ${o.x} ${o.y} C 32 43, 56 37, ${target.x} ${target.y}`} fill="none" stroke={C.surface} strokeWidth={0.52} strokeDasharray="2.1 1.5" />
      )}
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={target.x} y={target.y} label="P" />
      <TemplateArrow markerId={markerId} from={o} to={{ x: o.x + 21, y: o.y - 19 }} auditId="target-u" />
      <line x1={target.x} y1={target.y} x2={target.x} y2={52} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="target-x-guide" />
      <line x1={12} y1={target.y} x2={target.x} y2={target.y} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="target-y-guide" />
      <path d={`M ${o.x + 6.2} ${o.y} A 9 9 0 0 0 ${o.x + 9.7} ${o.y - 6.6}`} fill="none" stroke={C.surface} strokeWidth={0.45} />
      <TextbookSvgText x={41.0} y={59.5} text={variant === "time" ? "solve for θ" : "x = uₓt"} size={4.0} audit={false} />
      <TextbookSvgText x={16.5} y={25.0} text="y" size={4.5} />
      <TextbookSvgText x={92.0} y={25.0} text="target" size={4.1} anchor="end" />
      {variant !== "time" && <TextbookSvgText x={29.0} y={48.0} text={thetaText} size={3.7} />}
      {variant === "setup" && <TextbookSvgText x={44.0} y={10.0} text="hit P(x, y)" size={4.8} audit={false} />}
      {variant === "equation" && (
        <>
          <TextbookSvgText x={27.0} y={10.0} text="target equation" size={4.4} audit={false} />
          <TextbookSvgText x={24.0} y={17.5} text="y = x tanθ - gx²/(2u²cos²θ)" size={3.0} audit={false} />
        </>
      )}
      {variant === "time" && (
        <>
          <TextbookSvgText x={31.0} y={10.0} text="angle solutions" size={4.4} audit={false} />
          <TextbookSvgText x={26.0} y={17.8} text={answerText || "θ = 45° or 71.565°"} size={3.95} />
          <TextbookSvgText x={51.0} y={43.5} text="two arcs" size={3.35} audit={false} />
        </>
      )}
    </g>
  );
}

type MinimumSpeedTargetTemplateVariant = "setup" | "result";

function MinimumSpeedTargetTemplate({ markerId, variant, answerText = "" }: { markerId: string; variant: MinimumSpeedTargetTemplateVariant; answerText?: string }) {
  const o = { x: 15, y: 50 };
  const target = { x: 78, y: 29 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 52 }} to={{ x: 93, y: 52 }} width={0.46} auditId="minimum-target-ground" />
      <TemplateArrow markerId={markerId} from={{ x: 12, y: 55 }} to={{ x: 12, y: 11 }} width={0.46} auditId="minimum-target-y" />
      <path data-audit-template-line-id="minimum-target-trajectory" d={`M ${o.x} ${o.y} C 28 22, 55 13, ${target.x} ${target.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={target.x} y={target.y} label="P" />
      <TemplateArrow markerId={markerId} from={o} to={{ x: o.x + 20, y: o.y - 17 }} auditId="minimum-target-u" />
      <line x1={target.x} y1={target.y} x2={target.x} y2={52} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="minimum-target-x-guide" />
      <line x1={12} y1={target.y} x2={target.x} y2={target.y} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="minimum-target-y-guide" />
      <TextbookSvgText x={variant === "setup" ? 82.0 : 93.0} y={variant === "setup" ? 17.0 : 13.0} text={variant === "setup" ? "target" : "target P"} size={variant === "setup" ? 4.4 : 3.9} anchor="end" audit={false} />
      <TextbookSvgText x={variant === "setup" ? 30.0 : 25.0} y={11.0} text={variant === "setup" ? "minimum launch speed" : "limiting trajectory"} size={4.6} audit={false} />
      {variant === "setup" && <TextbookSvgText x={39.0} y={60.0} text="choose lowest u that reaches P" size={3.7} anchor="middle" audit={false} />}
      {variant === "result" && (
        <>
          <TextbookSvgText x={19.0} y={58.6} text="uₘᵢₙ² = g(y + √(x²+y²))" size={3.25} audit={false} />
          <TextbookSvgText x={94.0} y={60.6} text={`uₘᵢₙ = ${answerText || "9.48683 m/s"}`} size={3.45} anchor="end" />
        </>
      )}
    </g>
  );
}

type MonkeyHunterTemplateVariant = "setup" | "projectile-drop" | "monkey-drop" | "result";

function MonkeyHunterTemplate({
  markerId,
  variant,
  speedText,
  heightText,
}: {
  markerId: string;
  variant: MonkeyHunterTemplateVariant;
  speedText: string;
  heightText: string;
}) {
  const gun = { x: 20, y: 45 };
  const monkeyStart = { x: 72, y: 20 };
  const monkeyCurrent = { x: 72, y: 35 };
  const aimAtProjectileX = 47;
  const aimAtProjectileY = 32;
  const projectileCurrent = variant === "result" ? monkeyCurrent : { x: aimAtProjectileX, y: 39 };
  const showProjectileDrop = variant === "projectile-drop";
  const showMonkeyDrop = variant === "monkey-drop" || variant === "result";
  const showProjectile = variant === "projectile-drop" || variant === "result";
  const showProjectilePath = variant !== "setup" && variant !== "monkey-drop";
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 54 }} to={{ x: 94, y: 54 }} width={0.46} auditId="monkey-hunter-ground" />
      <line x1={82} y1={54} x2={82} y2={14} stroke={C.surface} strokeWidth={1.05} data-audit-template-line-id="monkey-hunter-tree-trunk" />
      <line x1={63} y1={18} x2={87} y2={18} stroke={C.surface} strokeWidth={0.84} strokeLinecap="round" data-audit-template-line-id="monkey-hunter-branch" />
      <line
        x1={gun.x}
        y1={gun.y}
        x2={monkeyStart.x}
        y2={monkeyStart.y}
        stroke={C.surface}
        strokeWidth={0.46}
        strokeDasharray="2.2 1.8"
        data-audit-template-line-id="monkey-hunter-aim-line"
      />

      <g data-audit-entity="hunter">
        <circle cx={14.2} cy={39.5} r={3.0} fill={C.bg} stroke={C.surface} strokeWidth={0.68} />
        <line x1={14.2} y1={42.6} x2={14.2} y2={51.0} stroke={C.surface} strokeWidth={0.72} />
        <line x1={14.2} y1={45.2} x2={gun.x} y2={gun.y} stroke={C.surface} strokeWidth={0.68} />
        <line x1={gun.x - 2.8} y1={gun.y + 0.6} x2={gun.x + 8.7} y2={gun.y - 5.1} stroke={C.surface} strokeWidth={1.0} data-audit-template-line-id="monkey-hunter-gun" />
        <TextbookSvgText x={7.8} y={59.3} text="hunter" size={3.9} auditKey="monkey-hunter-label:hunter" />
      </g>

      <g data-audit-entity="monkey">
        <circle cx={monkeyStart.x} cy={monkeyStart.y + 4.2} r={2.7} fill={C.bg} stroke={C.surface} strokeWidth={0.66} opacity={showMonkeyDrop ? 0.34 : 1} />
        <line x1={monkeyStart.x} y1={monkeyStart.y + 1.6} x2={monkeyStart.x} y2={monkeyStart.y + 8.6} stroke={C.surface} strokeWidth={0.58} opacity={showMonkeyDrop ? 0.34 : 1} />
        <path d={`M ${monkeyStart.x + 2.2} ${monkeyStart.y + 7.4} C ${monkeyStart.x + 6.2} ${monkeyStart.y + 9.0}, ${monkeyStart.x + 6.2} ${monkeyStart.y + 13.5}, ${monkeyStart.x + 2.7} ${monkeyStart.y + 14.5}`} fill="none" stroke={C.surface} strokeWidth={0.48} opacity={showMonkeyDrop ? 0.34 : 1} />
        {showMonkeyDrop && (
          <>
            <circle cx={monkeyCurrent.x} cy={monkeyCurrent.y} r={2.9} fill={C.bg} stroke={C.surface} strokeWidth={0.68} />
            <line x1={monkeyCurrent.x} y1={monkeyCurrent.y + 2.7} x2={monkeyCurrent.x} y2={monkeyCurrent.y + 8.7} stroke={C.surface} strokeWidth={0.58} />
          </>
        )}
        <TextbookSvgText x={61.0} y={9.8} text="monkey" size={4.1} anchor="end" auditKey="monkey-hunter-label:monkey" />
      </g>

      {showProjectilePath && (
        <path data-audit-template-line-id="monkey-hunter-projectile-path" d={`M ${gun.x} ${gun.y} C 34 40, 53 35, ${monkeyCurrent.x} ${monkeyCurrent.y}`} fill="none" stroke={C.surface} strokeWidth={0.58} />
      )}
      {showProjectile && <circle data-audit-entity="projectile" cx={projectileCurrent.x} cy={projectileCurrent.y} r={2.25} fill={C.surface} />}

      {showProjectileDrop && (
        <>
          <line x1={aimAtProjectileX} y1={aimAtProjectileY} x2={aimAtProjectileX} y2={projectileCurrent.y} stroke={C.surface} strokeWidth={0.44} strokeDasharray="1.8 1.5" data-audit-template-line-id="monkey-hunter-projectile-drop" />
          <TextbookSvgText x={30.0} y={25.7} text="projectile drop" size={3.55} audit={false} />
          <TextbookSvgText x={50.8} y={44.0} text="½gt²" size={3.7} />
        </>
      )}

      {showMonkeyDrop && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: monkeyStart.x + 6.2, y: monkeyStart.y + 6.0 }} to={{ x: monkeyCurrent.x + 6.2, y: monkeyCurrent.y + 1.0 }} width={0.42} auditId="monkey-hunter-monkey-drop" />
          {variant === "monkey-drop" && (
            <>
              <TextbookSvgText x={58.0} y={42.0} text="monkey" size={3.45} audit={false} />
              <TextbookSvgText x={58.0} y={47.8} text="drop = ½gt²" size={3.45} />
            </>
          )}
        </>
      )}

      {variant === "setup" && (
        <>
          <TextbookSvgText x={37.0} y={29.5} text="aims at monkey" size={3.7} audit={false} />
          <TextbookSvgText x={7.0} y={29.5} text={`u = ${speedText}`} size={3.9} />
          <TextbookSvgText x={90.0} y={59.2} text={heightText} size={3.7} anchor="end" />
        </>
      )}
      {variant === "result" && (
        <>
          <circle cx={monkeyCurrent.x} cy={monkeyCurrent.y} r={4.2} fill="none" stroke={C.surface} strokeWidth={0.62} data-audit-template-line-id="monkey-hunter-hit-ring" />
          <TextbookSvgText x={23.5} y={19.5} text="same ½gt² drop" size={3.65} audit={false} />
          <TextbookSvgText x={63.0} y={59.3} text="arrives first ⇒ hit" size={3.65} anchor="middle" audit={false} />
        </>
      )}
    </g>
  );
}

type PositionAtTimeTemplateVariant = "setup" | "equations" | "result";

function PositionAtTimeTemplate({ markerId, variant, answerText = "" }: { markerId: string; variant: PositionAtTimeTemplateVariant; answerText?: string }) {
  const o = { x: 17, y: 48 };
  const p = { x: 55, y: 27 };
  const b = { x: 84, y: 48 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 50 }} to={{ x: 93, y: 50 }} width={0.48} auditId="position-ground" />
      {variant !== "equations" && (
        <path data-audit-template-line-id="position-trajectory" d={`M ${o.x} ${o.y} C 32 17, 58 15, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      )}
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <line x1={p.x} y1={p.y + 3.2} x2={p.x} y2={50} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="position-y-guide" />
      <line x1={o.x} y1={54.8} x2={p.x} y2={54.8} stroke={C.surface} strokeWidth={0.46} data-audit-template-line-id="position-x-bracket" />
      <TemplateArrow markerId={markerId} from={{ x: p.x + 5, y: p.y + 15 }} to={{ x: p.x + 5, y: p.y + 3.4 }} width={0.42} auditId="position-y-bracket" />
      <TextbookSvgText x={43.0} y={60.0} text="x(t)" size={4.3} anchor="middle" />
      <TextbookSvgText x={63.0} y={41.0} text="y(t)" size={4.3} />
      {variant === "setup" && <TextbookSvgText x={60.5} y={22.0} text="position at time t" size={4.1} audit={false} />}
      {variant === "equations" && (
        <>
          <TextbookSvgText x={16.0} y={13.0} text="use component motion" size={4.0} audit={false} />
          <TextbookSvgText x={17.0} y={23.0} text="x = uₓt" size={4.2} />
          <TextbookSvgText x={17.0} y={32.0} text="y = uᵧt - 1/2gt²" size={3.6} />
        </>
      )}
      {variant === "result" && (
        <>
          <TextbookSvgText x={61.0} y={10.0} text="substitute time" size={3.6} audit={false} />
          <TextbookSvgText x={64.0} y={17.0} text="x = uₓt" size={3.55} />
          <TextbookSvgText x={64.0} y={24.0} text="y from vertical" size={3.35} audit={false} />
          <TextbookSvgText x={12.0} y={10.5} text={answerText || "x=17.3205 m, y=5 m"} size={3.35} />
        </>
      )}
    </g>
  );
}

type TimeDerivationTemplateVariant = "setup" | "equation" | "factor" | "result";

function TimeDerivationTemplate({ markerId, variant }: { markerId: string; variant: TimeDerivationTemplateVariant }) {
  const o = { x: 18, y: 47 };
  const b = { x: 82, y: 47 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 9, y: 47 }} to={{ x: 93, y: 47 }} width={0.5} auditId="tof-ground" />
      <path data-audit-template-line-id="tof-trajectory" d={`M ${o.x} ${o.y} C 35 13, 61 13, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <line x1={o.x} y1={35.5} x2={b.x} y2={35.5} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.5" data-audit-template-line-id="tof-same-height-guide" />
      {variant === "setup" && (
        <>
          <TextbookSvgText x={38.0} y={12.0} text="derive flight time" size={4.8} audit={false} />
          <TextbookSvgText x={47.0} y={58.5} text="launch and landing at same height" size={3.7} anchor="middle" audit={false} />
        </>
      )}
      {variant === "equation" && (
        <>
          <TextbookSvgText x={25.0} y={8.5} text="y(t) = uᵧt - 1/2gt²" size={4.0} audit={false} />
          <TextbookSvgText x={50.0} y={58.5} text="landing: y = 0" size={4.2} anchor="middle" audit={false} />
        </>
      )}
      {variant === "factor" && (
        <>
          <TextbookSvgText x={31.0} y={8.5} text="t(uᵧ - 1/2gt) = 0" size={4.0} audit={false} />
          <TextbookSvgText x={50.0} y={58.5} text="ignore t = 0 launch instant" size={4.0} anchor="middle" audit={false} />
        </>
      )}
      {variant === "result" && (
        <>
          <TextbookSvgText x={31.0} y={8.5} text="uᵧ - 1/2gT = 0" size={4.0} audit={false} />
          <TextbookSvgText x={50.0} y={58.5} text="T = 2uᵧ / g" size={5.0} anchor="middle" audit={false} />
        </>
      )}
    </g>
  );
}

type TwoProjectileTemplateVariant = "setup" | "time-a" | "time-b" | "collision";

function TwoProjectileTemplate({ markerId, variant, answerText = "" }: { markerId: string; variant: TwoProjectileTemplateVariant; answerText?: string }) {
  const a = { x: 14, y: 49 };
  const b = { x: 86, y: 49 };
  const c = { x: 51, y: 25 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 7, y: 52 }} to={{ x: 93, y: 52 }} width={0.46} auditId="two-projectile-ground" />
      <path data-audit-template-line-id="two-projectile-a-path" d={`M ${a.x} ${a.y} C 27 19, 40 17, ${c.x} ${c.y}`} fill="none" stroke={C.surface} strokeWidth={0.6} />
      <path data-audit-template-line-id="two-projectile-b-path" d={`M ${b.x} ${b.y} C 75 20, 62 16, ${c.x} ${c.y}`} fill="none" stroke={C.surface} strokeWidth={0.6} strokeDasharray={variant === "setup" ? undefined : "2.2 1.7"} />
      <TemplatePoint x={a.x} y={a.y} label="A" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <TemplatePoint x={c.x} y={c.y} label="C" />
      <TemplateArrow markerId={markerId} from={a} to={{ x: a.x + 18, y: a.y - 20 }} auditId="two-projectile-u1" />
      <TemplateArrow markerId={markerId} from={b} to={{ x: b.x - 18, y: b.y - 20 }} auditId="two-projectile-u2" />
      {variant === "setup" && <TextbookSvgText x={36.0} y={10.0} text="two projectiles" size={4.8} audit={false} />}
      {(variant === "time-a" || variant === "time-b") && (
        <>
          <TextbookSvgText x={variant === "time-a" ? 22.0 : 10.0} y={variant === "time-a" ? 20.0 : 15.0} text={variant === "time-a" ? "T₁" : "known"} size={4.8} audit={variant === "time-a"} />
          <TextbookSvgText x={variant === "time-b" ? 75.0 : 90.0} y={variant === "time-b" ? 20.0 : 15.0} text={variant === "time-b" ? "T₂" : "known"} size={4.8} anchor={variant === "time-b" ? "start" : "end"} audit={variant === "time-b"} />
          <TextbookSvgText x={variant === "time-a" ? 32.0 : 35.0} y={59.0} text={variant === "time-a" ? "projectile A time" : "projectile B time"} size={4.0} audit={false} />
        </>
      )}
      {variant === "collision" && (
        <>
          <TextbookSvgText x={57.0} y={14.0} text="collision" size={4.4} audit={false} />
          <TextbookSvgText x={17.0} y={58.0} text="same point, same time" size={3.7} audit={false} />
          <TextbookSvgText x={10.0} y={14.0} text={`t = ${answerText || "3.33333 s"}`} size={4.0} />
        </>
      )}
    </g>
  );
}

type TwoProjectileComparisonVariant = "setup" | "time" | "height" | "range";

function TwoProjectileComparisonTemplate({
  markerId,
  variant,
  sceneSpec,
}: {
  markerId: string;
  variant: TwoProjectileComparisonVariant;
  sceneSpec: SceneSpec2D;
}) {
  const q = sceneSpec.quantities ?? {};
  const angle1 = q.angle1?.value ?? 30;
  const angle2 = q.angle2?.value ?? 60;
  const time1 = quantityText(q.T1, "T₁", "s");
  const time2 = quantityText(q.T2, "T₂", "s");
  const height1 = quantityText(q.H1, "H₁", "m");
  const height2 = quantityText(q.H2, "H₂", "m");
  const range1 = quantityText(q.R1, "R₁", "m");
  const range2 = quantityText(q.R2, "R₂", "m");
  const speed = quantityText(q.u, "u", "m/s").replace("u = ", "");
  const o = { x: 14, y: 51 };
  const land = { x: 88, y: 51 };
  const lowApex = { x: 47, y: 33 };
  const highApex = { x: 47, y: 12 };
  const highlightTime = variant === "time";
  const highlightHeight = variant === "height";
  const highlightRange = variant === "range";
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 54 }} to={{ x: 94, y: 54 }} width={0.46} auditId="two-compare-ground" />
      <path data-audit-template-line-id="two-compare-low-path" d={`M ${o.x} ${o.y} C 30 36, 62 36, ${land.x} ${land.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <path data-audit-template-line-id="two-compare-high-path" d={`M ${o.x} ${o.y} C 28 7, 63 7, ${land.x} ${land.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} strokeDasharray="2.4 1.8" />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={land.x} y={land.y} label="B" />
      <TemplateArrow markerId={markerId} from={o} to={{ x: 31, y: 41 }} width={0.5} auditId="two-compare-u1" />
      <TemplateArrow markerId={markerId} from={o} to={{ x: 24, y: 30 }} width={0.5} auditId="two-compare-u2" />
      <TextbookSvgText x={28.0} y={48.5} text={`θ₁ = ${formatQuantityValue(angle1, "°")}°`} size={3.45} />
      <TextbookSvgText x={9.0} y={24.0} text={`θ₂ = ${formatQuantityValue(angle2, "°")}°`} size={3.45} />
      <TextbookSvgText x={8.5} y={10.5} text={`same u = ${speed}`} size={3.45} audit={false} />

      {variant === "setup" && (
        <>
          <TextbookSvgText x={60.0} y={31.0} text="lower angle" size={3.35} audit={false} />
          <TextbookSvgText x={57.0} y={13.0} text="higher angle" size={3.35} audit={false} />
        </>
      )}

      {highlightTime && (
        <>
          <TextbookSvgText x={70.0} y={15.2} text="T ∝ sin θ" size={4.0} />
          <TextbookSvgText x={58.0} y={60.5} text={time1} size={3.4} />
          <TextbookSvgText x={68.0} y={9.0} text={time2} size={3.55} />
        </>
      )}

      {highlightHeight && (
        <>
          <line x1={lowApex.x} y1={lowApex.y} x2={lowApex.x} y2={54} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.4" data-audit-template-line-id="two-compare-h1" />
          <line x1={highApex.x + 7} y1={highApex.y} x2={highApex.x + 7} y2={54} stroke={C.surface} strokeWidth={0.42} strokeDasharray="2 1.4" data-audit-template-line-id="two-compare-h2" />
          <TextbookSvgText x={8.0} y={60.5} text={height1} size={3.4} />
          <TextbookSvgText x={62.0} y={9.0} text={height2} size={3.5} />
          <TextbookSvgText x={62.0} y={59.5} text="H ∝ sin²θ" size={3.65} anchor="middle" />
        </>
      )}

      {highlightRange && (
        <>
          <line x1={o.x} y1={57.0} x2={land.x} y2={57.0} stroke={C.surface} strokeWidth={0.48} data-audit-template-line-id="two-compare-range-bracket" />
          <line x1={o.x} y1={54.8} x2={o.x} y2={59.4} stroke={C.surface} strokeWidth={0.48} data-audit-template-line-id="two-compare-range-left" />
          <line x1={land.x} y1={54.8} x2={land.x} y2={59.4} stroke={C.surface} strokeWidth={0.48} data-audit-template-line-id="two-compare-range-right" />
          <TextbookSvgText x={50.0} y={61.3} text="R₁ = R₂" size={3.45} anchor="middle" />
          <TextbookSvgText x={51.0} y={7.8} text="sin60° = sin120°" size={3.55} />
          <TextbookSvgText x={68.0} y={14.2} text={`${range1} = ${range2.replace("R₂ = ", "")}`} size={3.1} anchor="middle" audit={false} />
        </>
      )}
    </g>
  );
}

function quantityText(quantity: { value: number; unit?: string } | undefined, label: string, fallbackUnit: string) {
  if (!quantity || !Number.isFinite(quantity.value)) return `${label}`;
  const unit = unitForQuantity(quantity.unit || fallbackUnit);
  return `${label} = ${formatQuantityValue(quantity.value, unit)}${unit}`;
}

type VelocityChangeTemplateVariant = "setup" | "what-changes" | "delta";

function VelocityChangeTemplate({ markerId, variant }: { markerId: string; variant: VelocityChangeTemplateVariant }) {
  const p1 = { x: 24, y: 35 };
  const p2 = { x: 65, y: 35 };
  return (
    <g>
      <path data-audit-template-line-id="velocity-change-context" d="M 13 49 C 30 18, 61 18, 86 49" fill="none" stroke={C.surface} strokeWidth={0.52} strokeDasharray="2.2 1.7" />
      <TemplatePoint x={p1.x} y={p1.y} label="1" />
      <TemplatePoint x={p2.x} y={p2.y} label="2" />
      <TemplateArrow markerId={markerId} from={p1} to={{ x: p1.x + 22, y: p1.y - 9 }} auditId="velocity-change-v1" />
      <TemplateArrow markerId={markerId} from={p2} to={{ x: p2.x + 22, y: p2.y + 9 }} auditId="velocity-change-v2" />
      <TextbookSvgText x={36.0} y={22.0} text="v₁" size={4.9} />
      <TextbookSvgText x={84.0} y={31.5} text="v₂" size={4.9} />
      {variant === "setup" && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 50, y: 14 }} to={{ x: 50, y: 29 }} width={0.48} auditId="velocity-change-g" />
          <TextbookSvgText x={54.0} y={24.0} text="g" size={5.0} />
          <TextbookSvgText x={26.0} y={58.0} text="horizontal part unchanged" size={3.8} audit={false} />
        </>
      )}
      {variant === "what-changes" && (
        <>
          <line x1={p1.x} y1={p1.y} x2={p1.x + 22} y2={p1.y} stroke={C.surface} strokeWidth={0.38} strokeDasharray="2 1.5" data-audit-template-line-id="velocity-change-v1-horizontal" />
          <line x1={p2.x} y1={p2.y} x2={p2.x + 22} y2={p2.y} stroke={C.surface} strokeWidth={0.38} strokeDasharray="2 1.5" data-audit-template-line-id="velocity-change-v2-horizontal" />
          <TemplateArrow markerId={markerId} from={{ x: 52, y: 18 }} to={{ x: 52, y: 45 }} width={0.5} auditId="velocity-change-only-vertical" />
          <TextbookSvgText x={15.0} y={13.0} text="vₓ same" size={4.1} />
          <TextbookSvgText x={56.0} y={11.5} text="vᵧ changes" size={3.75} audit={false} />
          <TextbookSvgText x={56.0} y={18.0} text="only" size={3.75} audit={false} />
          <TextbookSvgText x={30.0} y={58.0} text="Δv is vertical" size={4.0} audit={false} />
        </>
      )}
      {variant === "delta" && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 47, y: 18 }} to={{ x: 47, y: 48 }} width={0.62} auditId="velocity-change-delta-v" />
          <TextbookSvgText x={52.0} y={36.0} text="Δv" size={5.2} />
          <TextbookSvgText x={31.0} y={58.0} text="Δv = g Δt downward" size={4.0} audit={false} />
          <TextbookSvgText x={63.0} y={13.0} text="for 0.5 s: 5 m/s" size={3.6} audit={false} />
        </>
      )}
    </g>
  );
}

type InterceptionTemplateVariant = "setup" | "vertical" | "horizontal" | "ratio";

function InterceptionTemplate({ markerId, variant }: { markerId: string; variant: InterceptionTemplateVariant }) {
  const a = { x: 16, y: 49 };
  const b = { x: 84, y: 49 };
  const c = { x: 52, y: 24 };
  return (
    <g>
      <TemplateArrow markerId={markerId} from={{ x: 8, y: 52 }} to={{ x: 93, y: 52 }} width={0.46} auditId="interception-ground" />
      <path data-audit-template-line-id="interception-left-path" d={`M ${a.x} ${a.y} C 30 17, 42 15, ${c.x} ${c.y}`} fill="none" stroke={C.surface} strokeWidth={0.6} />
      <path data-audit-template-line-id="interception-right-path" d={`M ${b.x} ${b.y} C 74 18, 62 15, ${c.x} ${c.y}`} fill="none" stroke={C.surface} strokeWidth={0.6} strokeDasharray="2.2 1.7" />
      <TemplatePoint x={a.x} y={a.y} label="A" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <TemplatePoint x={c.x} y={c.y} label="C" />
      <TemplateArrow markerId={markerId} from={a} to={{ x: a.x + 17, y: a.y - 22 }} auditId="interception-u1" />
      <TemplateArrow markerId={markerId} from={b} to={{ x: b.x - 17, y: b.y - 22 }} auditId="interception-u2" />
      {variant === "setup" && <TextbookSvgText x={34.0} y={10.0} text="interception point C" size={4.8} audit={false} />}
      {variant === "vertical" && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 48, y: 47 }} to={{ x: 48, y: 27 }} width={0.44} auditId="interception-vertical-time" />
          <TextbookSvgText x={13.0} y={15.0} text="vertical time" size={4.0} audit={false} />
        </>
      )}
      {variant === "horizontal" && (
        <>
          <line x1={a.x} y1={57} x2={c.x} y2={57} stroke={C.surface} strokeWidth={0.44} data-audit-template-line-id="interception-horizontal-left" />
          <line x1={c.x} y1={57} x2={b.x} y2={57} stroke={C.surface} strokeWidth={0.44} data-audit-template-line-id="interception-horizontal-right" />
          <TextbookSvgText x={42.0} y={61.0} text="horizontal closure" size={3.8} anchor="middle" audit={false} />
        </>
      )}
      {variant === "ratio" && (
        <>
          <TextbookSvgText x={29.0} y={19.5} text="T₁" size={4.8} />
          <TextbookSvgText x={72.0} y={19.5} text="T₂" size={4.8} />
          <TextbookSvgText x={17.0} y={58.0} text="same C: y₁(T₁)=y₂(T₂)" size={3.45} audit={false} />
          <TextbookSvgText x={58.0} y={12.0} text="T₁/T₂ = 2" size={4.2} />
        </>
      )}
    </g>
  );
}

function InclineAxesTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = risingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.35);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-surface" />
      <TemplatePoint x={p.x} y={p.y} label="O" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 26, frame.angleDeg)} auditId="incline-tangent-axis" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 22, frame.angleDeg + 90)} auditId="incline-normal-axis" />
      <TextbookSvgText x={pointAtAngle(p, 30, frame.angleDeg).x + 2} y={pointAtAngle(p, 30, frame.angleDeg).y - 1} text="along plane" size={4.0} />
      <TextbookSvgText x={pointAtAngle(p, 25, frame.angleDeg + 90).x - 2} y={pointAtAngle(p, 25, frame.angleDeg + 90).y - 2} text="normal" size={4.0} anchor="end" />
      <TextbookSvgText x={frame.start.x + 23.0} y={frame.start.y + 5.0} text={`α = ${alphaText}`} size={4.0} />
    </g>
  );
}

function InclineGravityComponentsTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = risingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.42);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-gravity-surface" />
      <TemplatePoint x={p.x} y={p.y} label="O" />
      <TemplateArrow markerId={markerId} from={{ x: p.x, y: p.y - 10 }} to={{ x: p.x, y: p.y + 17 }} auditId="incline-g" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 22, frame.angleDeg + 180)} auditId="incline-g-sin" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 22, frame.angleDeg - 90)} auditId="incline-g-cos" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 24, frame.angleDeg)} width={0.46} auditId="incline-axis-tangent" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 19, frame.angleDeg + 90)} width={0.46} auditId="incline-axis-normal" />
      <TextbookSvgText x={pointAtAngle(p, 25, frame.angleDeg + 180).x - 2} y={pointAtAngle(p, 25, frame.angleDeg + 180).y + 5} text="g sin α" size={4.7} anchor="end" />
      <TextbookSvgText x={pointAtAngle(p, 25, frame.angleDeg - 90).x + 1} y={pointAtAngle(p, 25, frame.angleDeg - 90).y + 5} text="g cos α" size={4.7} />
      <TextbookSvgText x={p.x + 3.5} y={p.y + 10.5} text="g" size={5.2} />
      <TextbookSvgText x={frame.start.x + 29.0} y={frame.start.y + 5.0} text={`α = ${alphaText}`} size={3.6} />
    </g>
  );
}

function InclineVelocityComponentsTemplate({ markerId, thetaText, alphaDeg }: { markerId: string; thetaText: string; alphaDeg: number }) {
  const frame = risingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.34);
  const vTip = offsetFromIncline(p, 22, 18, frame.angleDeg);
  const parallelTip = pointAtAngle(p, 27, frame.angleDeg);
  const normalTip = pointAtAngle(p, 22, frame.angleDeg + 90);
  const parallelLabel = { x: Math.min(75, parallelTip.x + 15), y: 8 };
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-velocity-surface" />
      <TemplatePoint x={p.x} y={p.y} label="O" />
      <TemplateArrow markerId={markerId} from={p} to={parallelTip} auditId="incline-v-parallel" />
      <TemplateArrow markerId={markerId} from={p} to={normalTip} auditId="incline-v-normal" />
      <TemplateArrow markerId={markerId} from={p} to={vTip} dashed auditId="incline-v" />
      <TextbookSvgText x={parallelLabel.x} y={parallelLabel.y} text="v along" size={4.0} anchor="middle" />
      <TextbookSvgText x={normalTip.x - 2.5} y={normalTip.y - 2.0} text="v normal" size={3.8} anchor="end" />
      <TextbookSvgText x={p.x + 12.0} y={p.y + 7.5} text={thetaText.replace("θ = ", "θ = ")} size={3.8} />
    </g>
  );
}

function InclinePerpendicularSetupTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const o = pointBetween(frame.start, frame.end, 0.08);
  const b = pointBetween(frame.start, frame.end, 0.88);
  const c1 = offsetFromIncline(o, 16, 22, frame.angleDeg);
  const c2 = offsetFromIncline(b, -16, 20, frame.angleDeg);
  const normalTip = pointAtAngle(o, 25, frame.angleDeg + 90);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-perpendicular-surface" />
      <path data-audit-template-line-id="incline-perpendicular-trajectory" d={`M ${o.x} ${o.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="A" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <TemplateArrow markerId={markerId} from={o} to={normalTip} auditId="incline-perpendicular-u" />
      <TextbookSvgText x={normalTip.x + 2.0} y={normalTip.y - 2.0} text="u ⟂ plane" size={4.4} />
      <TextbookSvgText x={55.0} y={9.0} text="range along incline" size={4.1} anchor="middle" audit={false} />
      <TextbookSvgText x={frame.end.x + 1.5} y={frame.end.y - 2.5} text={`α = ${alphaText}`} size={4.1} />
    </g>
  );
}

function InclineRangeTemplate({ markerId, rangeText, alphaDeg }: { markerId: string; rangeText: string; alphaDeg: number }) {
  const frame = risingInclineFrame(alphaDeg);
  const o = pointBetween(frame.start, frame.end, 0.18);
  const b = pointBetween(frame.start, frame.end, 0.82);
  const c1 = offsetFromIncline(o, 14, 22, frame.angleDeg);
  const c2 = offsetFromIncline(b, -16, 19, frame.angleDeg);
  const label = offsetFromIncline(pointBetween(o, b, 0.5), 0, -8, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-range-surface" />
      <path d={`M ${o.x} ${o.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={b.x} y={b.y} label="B" />
      <TemplateArrow markerId={markerId} from={offsetFromIncline(o, 0, -5, frame.angleDeg)} to={offsetFromIncline(b, 0, -5, frame.angleDeg)} width={0.48} auditId="incline-range-bracket" />
      <TextbookSvgText x={label.x} y={label.y + 3.5} text={rangeText} size={5.0} anchor="middle" />
      <TextbookSvgText x={b.x + 3.0} y={b.y - 4.0} text="impact" size={4.2} />
    </g>
  );
}

type InclineImpactConditionTemplateVariant = "setup" | "condition" | "relation";

function InclineImpactConditionTemplate({
  markerId,
  alphaText,
  alphaDeg,
  variant,
}: {
  markerId: string;
  alphaText: string;
  alphaDeg: number;
  variant: InclineImpactConditionTemplateVariant;
}) {
  const frame = risingInclineFrame(alphaDeg);
  const o = pointBetween(frame.start, frame.end, 0.16);
  const q = pointBetween(frame.start, frame.end, 0.82);
  const c1 = offsetFromIncline(o, 12, 24, frame.angleDeg);
  const c2 = offsetFromIncline(q, -18, 20, frame.angleDeg);
  const normalImpact = pointAtAngle(q, 20, frame.angleDeg - 90);
  const tangentAxis = pointAtAngle(q, 17, frame.angleDeg);
  const normalAxis = pointAtAngle(q, 15, frame.angleDeg + 90);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-impact-surface" />
      <path data-audit-template-line-id="incline-impact-trajectory" d={`M ${o.x} ${o.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${q.x} ${q.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={q.x} y={q.y} label="Q" />
      <TemplateArrow markerId={markerId} from={o} to={offsetFromIncline(o, 13, 23, frame.angleDeg)} auditId="incline-impact-launch-u" />
      <TemplateArrow markerId={markerId} from={q} to={normalImpact} auditId="incline-impact-normal-v" />
      <TemplateArrow markerId={markerId} from={q} to={tangentAxis} width={0.44} auditId="incline-impact-tangent-axis" />
      <TemplateArrow markerId={markerId} from={q} to={normalAxis} width={0.44} auditId="incline-impact-normal-axis" />
      {variant === "setup" && (
        <>
          <TextbookSvgText x={41.0} y={9.8} text="hit incline at 90°" size={4.0} anchor="middle" audit={false} />
          <TextbookSvgText x={q.x - 5.0} y={q.y - 13.0} text="impact normal" size={3.8} audit={false} />
        </>
      )}
      {variant === "condition" && (
        <>
          <TextbookSvgText x={42.0} y={9.8} text="event condition" size={4.1} anchor="middle" audit={false} />
          <TextbookSvgText x={q.x - 4.0} y={q.y - 13.0} text="vₜ = 0" size={4.7} />
        </>
      )}
      {variant === "relation" && (
        <>
          <TextbookSvgText x={36.0} y={9.8} text="final angle relation" size={4.0} anchor="middle" audit={false} />
          <TextbookSvgText x={17.0} y={59.0} text="cot θ = 2 tan α" size={4.4} />
          <TextbookSvgText x={q.x - 4.0} y={q.y - 13.0} text="vₜ = 0" size={4.3} />
        </>
      )}
      <TextbookSvgText x={tangentAxis.x + 2.0} y={tangentAxis.y + 1.5} text="tangent" size={3.6} audit={false} />
      {variant === "relation" ? (
        <TextbookSvgText x={94.0} y={58.5} text={`α = ${alphaText}`} size={3.7} anchor="end" audit={false} />
      ) : (
        <TextbookSvgText x={frame.start.x + 30.0} y={frame.start.y + 5.0} text={`plane angle ${alphaText}`} size={3.8} audit={false} />
      )}
    </g>
  );
}

type InclineNormalDistanceTemplateVariant = "setup" | "condition" | "result";

function InclineNormalDistanceTemplate({
  markerId,
  alphaText,
  alphaDeg,
  variant,
}: {
  markerId: string;
  alphaText: string;
  alphaDeg: number;
  variant: InclineNormalDistanceTemplateVariant;
}) {
  const frame = risingInclineFrame(alphaDeg);
  const o = pointBetween(frame.start, frame.end, 0.12);
  const foot = pointBetween(frame.start, frame.end, 0.48);
  const a = offsetFromIncline(foot, 0, 25, frame.angleDeg);
  const b = pointBetween(frame.start, frame.end, 0.82);
  const c1 = offsetFromIncline(o, 12, 18, frame.angleDeg);
  const c2 = offsetFromIncline(foot, -5, 24, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-normal-distance-surface" />
      <path data-audit-template-line-id="incline-normal-distance-trajectory" d={`M ${o.x} ${o.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${a.x} ${a.y} C ${offsetFromIncline(foot, 13, 24, frame.angleDeg).x} ${offsetFromIncline(foot, 13, 24, frame.angleDeg).y}, ${offsetFromIncline(b, -16, 12, frame.angleDeg).x} ${offsetFromIncline(b, -16, 12, frame.angleDeg).y}, ${b.x} ${b.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={a.x} y={a.y} label="A" />
      <TemplateArrow markerId={markerId} from={o} to={pointAtAngle(o, 20, frame.angleDeg + 90)} auditId="incline-normal-distance-axis" />
      <TemplateArrow markerId={markerId} from={foot} to={a} width={0.44} auditId="incline-normal-distance-max" />
      <TemplateArrow markerId={markerId} from={a} to={pointAtAngle(a, 18, frame.angleDeg - 90)} width={0.44} auditId="incline-normal-distance-gcos" />
      <TextbookSvgText x={9.0} y={11.5} text="normal" size={4.2} />
      {variant === "setup" && <TextbookSvgText x={a.x + 5.0} y={a.y - 8.0} text="normal distance" size={4.3} audit={false} />}
      {variant === "condition" && <TextbookSvgText x={a.x - 1.0} y={a.y - 8.0} text="vₙ = 0" size={4.8} />}
      {variant === "result" && (
        <>
          <TextbookSvgText x={a.x - 3.5} y={a.y - 8.0} text="vₙ = 0" size={4.6} />
          <TextbookSvgText x={22.0} y={58.0} text="Dₘₐₓ = uₙ²/(2g cos α)" size={3.75} audit={false} />
        </>
      )}
      <TextbookSvgText x={offsetFromIncline(foot, 19, -6, frame.angleDeg).x} y={offsetFromIncline(foot, 19, -6, frame.angleDeg).y + 3} text={variant === "setup" ? "measure from plane" : "normal component"} size={3.8} audit={false} />
      <TextbookSvgText x={75.0} y={17.0} text={`α = ${alphaText}`} size={3.5} audit={false} />
    </g>
  );
}

type InclineMotionResolutionVariant = "normal" | "along" | "combine";

function InclineMotionResolutionTemplate({
  markerId,
  alphaText,
  alphaDeg,
  variant,
  rangeText = "R",
  answerText = "",
}: {
  markerId: string;
  alphaText: string;
  alphaDeg: number;
  variant: InclineMotionResolutionVariant;
  rangeText?: string;
  answerText?: string;
}) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.08);
  const q = pointBetween(frame.start, frame.end, 0.84);
  const c1 = offsetFromIncline(p, 15, 21, frame.angleDeg);
  const c2 = offsetFromIncline(q, -16, 18, frame.angleDeg);
  const gOrigin = offsetFromIncline(pointBetween(frame.start, frame.end, 0.46), 0, 23, frame.angleDeg);
  const gSinTip = pointAtAngle(gOrigin, 19, frame.angleDeg);
  const gCosTip = pointAtAngle(gOrigin, 18, frame.angleDeg - 90);
  const normalAxisTip = pointAtAngle(p, 22, frame.angleDeg + 90);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="incline-resolution-plane" />
      <path data-audit-template-line-id="incline-resolution-trajectory" d={`M ${p.x} ${p.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${q.x} ${q.y}`} fill="none" stroke={C.surface} strokeWidth={0.52} strokeDasharray="2.2 1.7" />
      <TemplatePoint x={p.x} y={p.y} label="O" />
      <TemplatePoint x={q.x} y={q.y} label="B" />
      {variant === "normal" && (
        <>
          <TemplateArrow markerId={markerId} from={p} to={normalAxisTip} width={0.48} auditId="incline-resolution-normal-axis" />
          <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 25, frame.angleDeg + 90)} auditId="incline-resolution-u-normal" />
          <TemplateArrow markerId={markerId} from={gOrigin} to={{ x: gOrigin.x, y: gOrigin.y + 23 }} width={0.58} auditId="incline-resolution-g" />
          <TemplateArrow markerId={markerId} from={gOrigin} to={gCosTip} width={0.46} auditId="incline-resolution-g-cos" />
          <TextbookSvgText x={gOrigin.x + 7.5} y={gOrigin.y + 10.0} text="g" size={4.8} />
          <TextbookSvgText x={12.0} y={43.0} text="g cos α" size={4.2} />
          <TextbookSvgText x={normalAxisTip.x + 2.0} y={normalAxisTip.y - 2.0} text="normal" size={3.8} audit={false} />
          <TextbookSvgText x={63.0} y={8.5} text="normal motion" size={4.1} anchor="middle" audit={false} />
          <TextbookSvgText x={64.0} y={15.5} text="t = 2u/(g cos α)" size={3.4} audit={false} />
        </>
      )}
      {variant === "along" && (
        <>
          <TemplateArrow markerId={markerId} from={p} to={q} width={0.52} auditId="incline-resolution-s" />
          <TemplateArrow markerId={markerId} from={gOrigin} to={{ x: gOrigin.x, y: gOrigin.y + 23 }} width={0.58} auditId="incline-resolution-g" />
          <TemplateArrow markerId={markerId} from={gOrigin} to={gSinTip} width={0.46} auditId="incline-resolution-g-sin" />
          <TextbookSvgText x={gOrigin.x + 13.0} y={gOrigin.y + 4.0} text="g" size={4.8} />
          <TextbookSvgText x={gSinTip.x + 2.0} y={gSinTip.y + 4.0} text="g sin α" size={4.2} />
          <TextbookSvgText x={60.0} y={8.5} text="along-plane motion" size={3.9} anchor="middle" audit={false} />
          <TextbookSvgText x={63.0} y={15.5} text="s = 1/2 g sin α · t²" size={3.4} audit={false} />
        </>
      )}
      {variant === "combine" && (
        <>
          <TemplateArrow markerId={markerId} from={p} to={q} width={0.52} auditId="incline-resolution-range" />
          <TextbookSvgText x={63.0} y={8.5} text="substitute t into s" size={4.0} anchor="middle" audit={false} />
          <TextbookSvgText x={61.0} y={15.5} text="s = 2u² sin α/(g cos²α)" size={3.2} audit={false} />
          <TextbookSvgText x={17.0} y={61.0} text={answerText || rangeText || "R = 13.3333 m"} size={4.1} />
        </>
      )}
      <TextbookSvgText x={frame.end.x - 19.0} y={frame.end.y + 6.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

type TwoInclinesTemplateVariant = "setup" | "launch" | "impact";

function TwoInclinesTemplate({ markerId, variant }: { markerId: string; variant: TwoInclinesTemplateVariant }) {
  const o = { x: 50, y: 49 };
  const oaEnd = pointAtAngle(o, 42, 150);
  const obEnd = pointAtAngle(o, 44, 60);
  const p = pointAtAngle(o, 34, 150);
  const q = pointAtAngle(o, 37, 60);
  return (
    <g>
      <TemplateSurface from={o} to={oaEnd} auditId="two-incline-oa" />
      <TemplateSurface from={o} to={obEnd} auditId="two-incline-ob" />
      <path d={`M ${p.x} ${p.y} C 34 7, 55 2, ${q.x} ${q.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={o.x} y={o.y} label="O" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={q.x} y={q.y} label="Q" />
      {(variant === "setup" || variant === "launch") && (
        <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 26, 60)} auditId="two-incline-u" />
      )}
      {variant === "impact" && (
        <TemplateArrow markerId={markerId} from={q} to={pointAtAngle(q, 19, -30)} auditId="two-incline-vq" />
      )}
      <TextbookSvgText x={18.0} y={47.2} text="OA" size={4.8} />
      <TextbookSvgText x={69.0} y={41.2} text="OB" size={4.8} />
      {variant === "setup" && <TextbookSvgText x={36.5} y={7.5} text="OA 30°, OB 60°" size={4.2} />}
      {variant === "launch" && <TextbookSvgText x={39.5} y={9.5} text="u ⟂ OA" size={4.5} />}
      {variant === "impact" && <TextbookSvgText x={70.0} y={38.0} text="v at Q ⟂ OB" size={4.1} />}
    </g>
  );
}

type TwoInclinesComponentTemplateVariant = "launch" | "impact" | "equation";

function TwoInclinesComponentTemplate({ markerId, variant }: { markerId: string; variant: TwoInclinesComponentTemplateVariant }) {
  const p = { x: 26, y: 45 };
  const q = { x: 72, y: 28 };
  const useLaunch = variant === "launch";
  const anchor = useLaunch ? p : q;
  const oaLeft = pointAtAngle(p, 18, 150);
  const oaRight = pointAtAngle(p, 18, -30);
  const obLower = pointAtAngle(q, 18, 240);
  const obUpper = pointAtAngle(q, 18, 60);
  const vectorTip = useLaunch ? pointAtAngle(anchor, 25, 60) : pointAtAngle(anchor, 20, -30);
  const horizontalTip = pointAtAngle(anchor, useLaunch ? 27 : 21, 0);
  return (
    <g>
      <TemplateSurface from={oaLeft} to={oaRight} auditId="two-inclines-component-oa" />
      <TemplateSurface from={obLower} to={obUpper} auditId="two-inclines-component-ob" />
      <TemplateArrow markerId={markerId} from={{ x: 10, y: 54 }} to={{ x: 93, y: 54 }} width={0.44} auditId="two-inclines-component-horizontal" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={q.x} y={q.y} label="Q" />
      {variant !== "equation" && (
        <>
          <TemplateArrow
            markerId={markerId}
            from={anchor}
            to={vectorTip}
            auditId={useLaunch ? "two-inclines-launch-vector-u" : "two-inclines-impact-vector-vq"}
          />
          <TemplateArrow
            markerId={markerId}
            from={anchor}
            to={horizontalTip}
            width={0.5}
            auditId={useLaunch ? "two-inclines-launch-horizontal-component" : "two-inclines-impact-horizontal-component"}
          />
          <line x1={vectorTip.x} y1={vectorTip.y} x2={horizontalTip.x} y2={horizontalTip.y} stroke={C.surface} strokeWidth={0.38} strokeDasharray="2 1.5" data-audit-template-line-id="two-inclines-component-drop" />
          <path d={`M ${anchor.x + 6.2} ${anchor.y} A 9 9 0 0 ${useLaunch ? 0 : 1} ${anchor.x + 8.8} ${useLaunch ? anchor.y - 6.3 : anchor.y + 4.9}`} fill="none" stroke={C.surface} strokeWidth={0.45} />
        </>
      )}
      {variant === "launch" && (
        <>
          <TextbookSvgText x={52.0} y={11.0} text="resolve launch u" size={4.0} audit={false} />
          <TextbookSvgText x={8.5} y={13.5} text="uₓ = u cos 60°" size={4.0} />
          <TextbookSvgText x={vectorTip.x + 2.0} y={vectorTip.y - 1.0} text="u" size={4.6} audit={false} />
        </>
      )}
      {variant === "impact" && (
        <>
          <TextbookSvgText x={41.0} y={12.0} text="resolve impact velocity" size={4.0} audit={false} />
          <TextbookSvgText x={7.5} y={20.0} text="vₓ = v_Q cos 30°" size={4.0} />
          <TextbookSvgText x={q.x + 3.0} y={q.y + 18.0} text="v_Q" size={4.7} />
        </>
      )}
      {variant === "equation" && (
        <>
          <TextbookSvgText x={34.0} y={12.0} text="same horizontal velocity" size={4.1} audit={false} />
          <TextbookSvgText x={10.0} y={24.0} text="u cos 60° = v_Q cos 30°" size={3.9} />
          <TextbookSvgText x={31.0} y={36.0} text="solve for v_Q" size={4.1} audit={false} />
          <TextbookSvgText x={32.0} y={45.0} text="v_Q = 10 m/s" size={4.2} />
        </>
      )}
      <TextbookSvgText x={17.0} y={35.0} text="OA" size={4.0} audit={false} />
      <TextbookSvgText x={82.5} y={20.5} text="OB" size={4.0} audit={false} />
    </g>
  );
}

function InclineCollisionSetupTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const start = pointBetween(frame.start, frame.end, 0.12);
  const hit = pointBetween(frame.start, frame.end, 0.84);
  const c1 = offsetFromIncline(start, 13, 22, frame.angleDeg);
  const c2 = offsetFromIncline(hit, -16, 18, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-surface" />
      <path d={`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${hit.x} ${hit.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <line data-audit-template-line-id="collision-slider-path" x1={start.x} y1={start.y} x2={hit.x} y2={hit.y} stroke={C.surface} strokeWidth={0.46} strokeDasharray="2 1.6" />
      <TemplatePoint x={start.x} y={start.y} label="P,Q" />
      <TemplatePoint x={hit.x} y={hit.y} label="C" />
      <TemplateArrow markerId={markerId} from={start} to={pointAtAngle(start, 25, frame.angleDeg + 90)} auditId="collision-u" />
      <TextbookSvgText x={7.0} y={8.0} text="projectile P" size={4.2} />
      <TextbookSvgText x={14.0} y={57.0} text="slider Q" size={4.2} />
      <TextbookSvgText x={hit.x + 3.0} y={hit.y - 4.0} text="collision" size={4.6} />
      <TextbookSvgText x={start.x + 18.0} y={start.y - 17.0} text="u" size={5.0} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

function InclineCollisionReadDiagramTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const start = pointBetween(frame.start, frame.end, 0.16);
  const tangentTip = pointAtAngle(start, 26, frame.angleDeg);
  const normalTip = pointAtAngle(start, 25, frame.angleDeg + 90);
  const qTip = pointAtAngle(start, 18, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-read-surface" />
      <TemplatePoint x={start.x} y={start.y} label="P,Q" />
      <TemplateArrow markerId={markerId} from={start} to={normalTip} auditId="collision-read-u-normal" />
      <TemplateArrow markerId={markerId} from={start} to={qTip} width={0.48} auditId="collision-read-slider-direction" />
      <TemplateArrow markerId={markerId} from={start} to={tangentTip} width={0.42} dashed auditId="collision-read-tangent-axis" />
      <TextbookSvgText x={normalTip.x + 2.0} y={normalTip.y - 2.0} text="P: u normal" size={3.8} />
      <TextbookSvgText x={qTip.x + 2.0} y={qTip.y + 5.0} text="Q slides on plane" size={3.5} audit={false} />
      <TextbookSvgText x={6.0} y={12.0} text="read the figure" size={4.2} audit={false} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

function InclineCollisionGravityTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.18);
  const q = pointBetween(frame.start, frame.end, 0.67);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-gravity-surface" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={q.x} y={q.y} label="Q" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 18, frame.angleDeg)} auditId="collision-p-g-sin" />
      <TemplateArrow markerId={markerId} from={q} to={pointAtAngle(q, 18, frame.angleDeg)} auditId="collision-q-g-sin" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 18, frame.angleDeg + 90)} width={0.46} auditId="collision-normal-axis" />
      <TextbookSvgText x={p.x + 12.0} y={p.y + 10.0} text="P: g sin α" size={4.4} />
      <TextbookSvgText x={q.x + 9.0} y={q.y + 10.0} text="Q: g sin α" size={4.4} />
      <TextbookSvgText x={pointAtAngle(p, 21, frame.angleDeg + 90).x + 2.0} y={pointAtAngle(p, 21, frame.angleDeg + 90).y - 2.0} text="normal" size={3.7} audit={false} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} />
    </g>
  );
}

function InclineCollisionAlongCancelTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.18);
  const q = pointBetween(frame.start, frame.end, 0.62);
  const pTip = pointAtAngle(p, 20, frame.angleDeg);
  const qTip = pointAtAngle(q, 20, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-along-surface" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={q.x} y={q.y} label="Q" />
      <TemplateArrow markerId={markerId} from={p} to={pTip} auditId="collision-along-p-acceleration" />
      <TemplateArrow markerId={markerId} from={q} to={qTip} auditId="collision-along-q-acceleration" />
      <line x1={pTip.x} y1={pTip.y} x2={qTip.x} y2={qTip.y} stroke={C.surface} strokeWidth={0.35} strokeDasharray="1.8 1.4" data-audit-template-line-id="collision-along-equal-guide" />
      <TextbookSvgText x={5.5} y={12.0} text="along plane cancels" size={4.0} audit={false} />
      <TextbookSvgText x={6.0} y={49.5} text="a_P = a_Q" size={3.8} />
      <TextbookSvgText x={6.0} y={56.5} text="= g sin α" size={3.8} />
      <TextbookSvgText x={5.5} y={27.0} text="u∥ starts 0 for both" size={3.45} audit={false} />
      <TextbookSvgText x={pointBetween(p, q, 0.58).x + 2.0} y={pointBetween(p, q, 0.58).y + 7.0} text="same s(t)" size={3.7} audit={false} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

function InclineCollisionNormalTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.16);
  const hit = pointBetween(frame.start, frame.end, 0.82);
  const c1 = offsetFromIncline(p, 12, 21, frame.angleDeg);
  const c2 = offsetFromIncline(hit, -14, 17, frame.angleDeg);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-normal-surface" />
      <path d={`M ${p.x} ${p.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${hit.x} ${hit.y}`} fill="none" stroke={C.surface} strokeWidth={0.62} />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={hit.x} y={hit.y} label="C" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 21, frame.angleDeg + 90)} auditId="collision-normal-axis" />
      <TemplateArrow markerId={markerId} from={p} to={pointAtAngle(p, 19, frame.angleDeg - 90)} auditId="collision-g-cos" />
      <TextbookSvgText x={pointAtAngle(p, 23, frame.angleDeg + 90).x + 2.0} y={pointAtAngle(p, 23, frame.angleDeg + 90).y - 2.0} text="normal" size={4.2} />
      <TextbookSvgText x={pointAtAngle(p, 22, frame.angleDeg - 90).x - 1.0} y={pointAtAngle(p, 22, frame.angleDeg - 90).y + 5.0} text="g cos α" size={5.0} anchor="end" />
      <TextbookSvgText x={hit.x + 3.0} y={hit.y - 4.0} text="collision" size={4.6} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} />
    </g>
  );
}

function InclineCollisionNormalReturnTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.20);
  const nTip = pointAtAngle(p, 24, frame.angleDeg + 90);
  const gCosTip = pointAtAngle(p, 20, frame.angleDeg - 90);
  const apex = pointAtAngle(p, 20, frame.angleDeg + 90);
  const back = pointBetween(frame.start, frame.end, 0.56);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-normal-return-surface" />
      <path data-audit-template-line-id="collision-normal-return-path" d={`M ${p.x} ${p.y} C ${apex.x + 9} ${apex.y - 8}, ${back.x - 6} ${back.y - 14}, ${back.x} ${back.y}`} fill="none" stroke={C.surface} strokeWidth={0.6} />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplatePoint x={back.x} y={back.y} label="C" />
      <TemplateArrow markerId={markerId} from={p} to={nTip} auditId="collision-normal-return-u" />
      <TemplateArrow markerId={markerId} from={p} to={gCosTip} width={0.5} auditId="collision-normal-return-gcos" />
      <TextbookSvgText x={nTip.x + 1.5} y={nTip.y - 2.0} text="u" size={4.5} />
      <TextbookSvgText x={gCosTip.x - 1.5} y={gCosTip.y + 5.0} text="g cos α" size={4.3} anchor="end" />
      <TextbookSvgText x={7.0} y={12.0} text="normal return controls" size={3.9} audit={false} />
      <TextbookSvgText x={7.0} y={20.0} text="normal motion:" size={3.55} audit={false} />
      <TextbookSvgText x={7.0} y={27.0} text="Δn = 0" size={4.0} audit={false} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

function InclineCollisionEquationTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.18);
  const nTip = pointAtAngle(p, 22, frame.angleDeg + 90);
  const gCosTip = pointAtAngle(p, 18, frame.angleDeg - 90);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-equation-surface" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplateArrow markerId={markerId} from={p} to={nTip} auditId="collision-equation-u" />
      <TemplateArrow markerId={markerId} from={p} to={gCosTip} width={0.5} auditId="collision-equation-gcos" />
      <TextbookSvgText x={63.0} y={14.0} text="normal equation" size={3.8} audit={false} />
      <TextbookSvgText x={63.0} y={23.0} text="0 = uT - 1/2 g cosα T²" size={3.1} audit={false} />
      <TextbookSvgText x={63.0} y={31.0} text="T = 2u/(g cosα)" size={3.55} />
      <TextbookSvgText x={62.0} y={53.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

function InclineCollisionResultTemplate({ markerId, alphaText, alphaDeg }: { markerId: string; alphaText: string; alphaDeg: number }) {
  const frame = descendingInclineFrame(alphaDeg);
  const p = pointBetween(frame.start, frame.end, 0.18);
  const nTip = pointAtAngle(p, 23, frame.angleDeg + 90);
  return (
    <g>
      <TemplateSurface from={frame.start} to={frame.end} auditId="collision-result-surface" />
      <TemplatePoint x={p.x} y={p.y} label="P" />
      <TemplateArrow markerId={markerId} from={p} to={nTip} auditId="collision-result-u" />
      <TextbookSvgText x={7.0} y={12.0} text="T = 4 s" size={4.0} audit={false} />
      <TextbookSvgText x={7.0} y={21.0} text="u = 1/2 g cos60° · T" size={3.55} audit={false} />
      <TextbookSvgText x={7.0} y={31.0} text="u = 10 m/s" size={5.0} />
      <TextbookSvgText x={nTip.x + 1.5} y={nTip.y - 2.0} text="projection speed" size={3.6} audit={false} />
      <TextbookSvgText x={frame.end.x + 4.0} y={frame.end.y + 5.0} text={`α = ${alphaText}`} size={3.6} audit={false} />
    </g>
  );
}

type StaircaseTemplateVariant = "setup" | "motion" | "drop" | "impact";

function StaircaseTemplate({ markerId, variant }: { markerId: string; variant: StaircaseTemplateVariant }) {
  const start = { x: 18, y: 15 };
  const impact = { x: 83, y: 48 };
  const stepPath = staircasePath(18, 17, 8, 4, 8);
  return (
    <g>
      <path d={stepPath} fill="none" stroke={C.surface} strokeWidth={0.72} strokeLinejoin="miter" strokeLinecap="square" data-audit-template-line-id="staircase-steps" />
      <path d={`M ${start.x} ${start.y} C 38 15, 61 34, ${impact.x} ${impact.y}`} fill="none" stroke={C.surface} strokeWidth={0.58} strokeDasharray="2.2 1.7" />
      <circle cx={start.x} cy={start.y} r={2.7} fill={C.surface} />
      <TemplateArrow markerId={markerId} from={{ x: start.x + 3.5, y: start.y }} to={{ x: start.x + 25, y: start.y }} auditId="staircase-horizontal-velocity" />
      <TextbookSvgText x={start.x + 8.5} y={start.y - 4.5} text="u = 10 m/s" size={4.4} />

      <line x1={26} y1={22.7} x2={34} y2={22.7} stroke={C.surface} strokeWidth={0.42} markerEnd={`url(#${markerId})`} data-audit-template-line-id="staircase-x-dimension" />
      <line x1={35.4} y1={17} x2={35.4} y2={21} stroke={C.surface} strokeWidth={0.42} markerEnd={`url(#${markerId})`} data-audit-template-line-id="staircase-y-dimension" />
      <TextbookSvgText x={26.2} y={29.8} text="x = 1 m" size={3.6} />
      <TextbookSvgText x={8.5} y={21.2} text="y = 1 m" size={3.6} />

      {(variant === "drop" || variant === "impact") && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 57, y: 18 }} to={{ x: 57, y: 44 }} auditId="staircase-drop" />
          <TextbookSvgText x={55.0} y={11.2} text="drop = n m" size={4.2} />
          <TemplateArrow markerId={markerId} from={{ x: 48, y: 22 }} to={{ x: 48, y: 37 }} auditId="staircase-g" />
          <TextbookSvgText x={50.7} y={31.0} text="g" size={4.4} />
        </>
      )}

      {variant === "motion" && (
        <>
          <line x1={start.x} y1={55} x2={impact.x} y2={55} stroke={C.surface} strokeWidth={0.42} data-audit-template-line-id="staircase-horizontal-distance" />
          <TextbookSvgText x={50.5} y={60.0} text="horizontal distance = n m" size={4.0} anchor="middle" />
        </>
      )}

      {variant === "impact" && (
        <>
          <circle cx={impact.x} cy={impact.y} r={3.0} fill={C.bg} stroke={C.surface} strokeWidth={0.72} />
          <TextbookSvgText x={76.0} y={57.5} text="n = 21" size={5.3} />
        </>
      )}

      {variant === "setup" && <TextbookSvgText x={57.5} y={11.0} text="find step n" size={4.6} />}
    </g>
  );
}

function staircasePath(x: number, y: number, stepW: number, stepH: number, count: number) {
  const commands = [`M ${x} ${y}`];
  for (let index = 0; index < count; index += 1) {
    const x2 = x + (index + 1) * stepW;
    const y1 = y + index * stepH;
    const y2 = y + (index + 1) * stepH;
    commands.push(`L ${x2} ${y1}`, `L ${x2} ${y2}`);
  }
  return commands.join(" ");
}

type SmoothPlaneTemplateVariant = "setup" | "acceleration" | "resultant";

function SmoothPlaneTemplate({
  markerId,
  variant,
  speedText,
  alphaText,
  answerText = "",
}: {
  markerId: string;
  variant: SmoothPlaneTemplateVariant;
  speedText: string;
  alphaText: string;
  answerText?: string;
}) {
  const a = { x: 26, y: 47 };
  const b = { x: 72, y: 47 };
  const c = { x: 84, y: 14 };
  const d = { x: 38, y: 14 };
  return (
    <g>
      <path d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} L ${d.x} ${d.y} Z`} fill="none" stroke={C.surface} strokeWidth={0.72} strokeLinejoin="round" data-audit-template-line-id="smooth-plane-board" />
      <TemplateArrow markerId={markerId} from={{ x: 44, y: 30.5 }} to={{ x: 63, y: 30.5 }} auditId="smooth-plane-initial-speed" />
      <TextbookSvgText x={43.8} y={25.2} text={speedText === "u" ? "8 m/s" : speedText} size={5.0} />
      <line x1={b.x} y1={b.y} x2={92} y2={36.6} stroke={C.surface} strokeWidth={0.54} data-audit-template-line-id="smooth-plane-angle-line" />
      <path d={`M ${b.x + 3.4} ${b.y - 0.2} A 9 9 0 0 0 ${b.x + 7.4} ${b.y - 6.2}`} fill="none" stroke={C.surface} strokeWidth={0.45} />
      <TextbookSvgText x={84.5} y={53.0} text="37°" size={4.9} />

      {(variant === "acceleration" || variant === "resultant") && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 68, y: 19 }} to={{ x: 55, y: 40 }} auditId="smooth-plane-greatest-slope" />
          <TextbookSvgText x={35.5} y={8.2} text="greatest slope" size={3.5} />
          <TextbookSvgText x={96.0} y={6.5} text="g sin 37°" size={4.0} anchor="end" />
        </>
      )}

      {variant === "resultant" && (
        <>
          <TemplateArrow markerId={markerId} from={{ x: 17, y: 55 }} to={{ x: 35, y: 55 }} width={0.5} auditId="smooth-plane-triangle-horizontal" />
          <TemplateArrow markerId={markerId} from={{ x: 35, y: 55 }} to={{ x: 46, y: 44 }} width={0.5} auditId="smooth-plane-triangle-slope" />
          <TemplateArrow markerId={markerId} from={{ x: 17, y: 55 }} to={{ x: 46, y: 44 }} width={0.5} auditId="smooth-plane-triangle-resultant" />
          <TextbookSvgText x={23.0} y={60.6} text="8" size={3.7} audit={false} />
          <TextbookSvgText x={40.6} y={54.0} text="6" size={3.7} audit={false} />
          <TextbookSvgText x={49.0} y={59.7} text={`v = ${answerText || "10.0109 m/s"}`} size={3.85} />
          <TextbookSvgText x={8.0} y={12.0} text="v = √(8² + 6²)" size={3.8} audit={false} />
        </>
      )}

      {variant === "setup" && (
        <TextbookSvgText x={14.0} y={58.5} text="v ⟂ greatest slope" size={4.0} />
      )}
    </g>
  );
}

function TextbookSvgText({
  x,
  y,
  text,
  size,
  anchor = "start",
  auditKey,
  audit = true,
}: {
  x: number;
  y: number;
  text: string;
  size: number;
  anchor?: "start" | "middle" | "end";
  auditKey?: string;
  audit?: boolean;
}) {
  return (
    <text
      data-audit-label-key={audit ? auditKey ?? `template-label:${text}:${x}:${y}` : undefined}
      data-audit-label-kind={audit ? "template" : undefined}
      x={x}
      y={y}
      fill={C.text}
      fontSize={size}
      fontWeight={760}
      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      textAnchor={anchor}
    >
      {text}
    </text>
  );
}

function TextbookLabelLayer({ labels }: { labels: PlacedLabel[] }) {
  const layerRef = useRef<SVGGElement | null>(null);
  const sourceSignature = labels
    .map(label => [label.key, label.text, label.x, label.y, label.size, label.anchor, label.priority].join("|"))
    .join(";");
  const [measuredLayout, setMeasuredLayout] = useState<{
    signature: string;
    labels: PlacedLabel[];
    unresolved: number;
  }>({ signature: "", labels, unresolved: 0 });
  const renderedLabels = measuredLayout.signature === sourceSignature ? measuredLayout.labels : labels;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const svg = layer?.ownerSVGElement;
    if (!layer || !svg) return;
    const viewBox = svg.viewBox.baseVal;
    const bounds = {
      left: viewBox.x + 1.5,
      right: viewBox.x + viewBox.width - 1.5,
      top: viewBox.y + 1.5,
      bottom: viewBox.y + viewBox.height - 1.5,
    };
    const measured = labels.map(label => {
      const node = layer.querySelector<SVGTextElement>(`[data-audit-label-key="${CSS.escape(label.key)}"]`);
      const box = node?.getBBox();
      return {
        label,
        width: Math.max(box?.width ?? labelWidth(label.text, label.size), label.size * 1.6),
        height: Math.max(box?.height ?? label.size * 1.15, label.size),
      };
    });
    const resolved = labels.map(label => ({ ...label }));
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const order = measured
      .map((item, index) => ({ ...item, index }))
      .sort((a, b) => (b.label.priority ?? 50) - (a.label.priority ?? 50) || a.index - b.index);
    const gap = 1.1;
    const offsets = measuredLabelOffsets();
    for (const item of order) {
      const anchor = item.label.anchor ?? "start";
      let best: { x: number; y: number; box: { left: number; right: number; top: number; bottom: number }; score: number } | null = null;
      for (const [dx, dy] of offsets) {
        let x = item.label.x + dx;
        let y = item.label.y + dy;
        let box = measuredTextBox(x, y, item.width, item.height, anchor);
        if (box.left < bounds.left) x += bounds.left - box.left;
        if (box.right > bounds.right) x -= box.right - bounds.right;
        if (box.top < bounds.top) y += bounds.top - box.top;
        if (box.bottom > bounds.bottom) y -= box.bottom - bounds.bottom;
        box = measuredTextBox(x, y, item.width, item.height, anchor);
        const score = occupied.reduce((sum, other) => sum + measuredOverlapArea(box, other, gap), 0);
        if (score === 0) {
          best = { x, y, box, score };
          break;
        }
        if (!best || score < best.score) best = { x, y, box, score };
      }
      if (!best) continue;
      resolved[item.index] = {
        ...item.label,
        x: best.x,
        y: best.y,
        moved: Math.abs(best.x - item.label.x) > 0.01 || Math.abs(best.y - item.label.y) > 0.01,
        box: {
          left: best.box.left,
          right: best.box.right,
          top: best.box.bottom,
          bottom: best.box.top,
        },
      };
      occupied.push(best.box);
    }
    let unresolved = 0;
    for (let i = 0; i < occupied.length; i += 1) {
      for (let j = i + 1; j < occupied.length; j += 1) {
        if (measuredOverlapArea(occupied[i], occupied[j], 0.25) > 0) unresolved += 1;
      }
    }
    setMeasuredLayout({ signature: sourceSignature, labels: resolved, unresolved });
  }, [sourceSignature]);

  return (
    <g
      ref={layerRef}
      data-audit-label-layer="template-authority"
      data-audit-unresolved-overlaps={measuredLayout.signature === sourceSignature ? measuredLayout.unresolved : 0}
    >
      {renderedLabels.map(label => (
        <TextbookSvgText
          key={label.key}
          x={label.x}
          y={label.y}
          text={label.text}
          size={label.size}
          anchor={label.anchor}
          auditKey={label.key}
        />
      ))}
    </g>
  );
}

function measuredLabelOffsets(): Array<[number, number]> {
  const offsets: Array<[number, number]> = [[0, 0]];
  for (const radius of [3, 5.5, 8, 11, 14, 18, 23]) {
    offsets.push(
      [radius, 0], [-radius, 0], [0, radius], [0, -radius],
      [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius],
    );
  }
  return offsets;
}

function measuredTextBox(x: number, y: number, width: number, height: number, anchor: LabelAnchor) {
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return { left, right: left + width, top: y - height, bottom: y };
}

function measuredOverlapArea(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
  gap: number,
) {
  const width = Math.max(0, Math.min(a.right + gap, b.right + gap) - Math.max(a.left - gap, b.left - gap));
  const height = Math.max(0, Math.min(a.bottom + gap, b.bottom + gap) - Math.max(a.top - gap, b.top - gap));
  return width * height;
}

function Surface2D({
  surface,
  points,
  highlighted,
  scale,
  showLabel,
}: {
  surface: Record<string, unknown>;
  points: Record<string, Point2>;
  highlighted: boolean;
  scale: number;
  showLabel: boolean;
}) {
  const ends = surfaceEndpoints(surface, points);
  if (!ends) return null;
  return (
    <g data-audit-surface-id={String(surface.id ?? "")}>
      <line
        x1={ends.from.x}
        y1={-ends.from.y}
        x2={ends.to.x}
        y2={-ends.to.y}
        stroke={highlighted ? C.highlight : C.surface}
        strokeWidth={(highlighted ? 0.032 : 0.019) * scale}
        strokeLinecap="round"
      />
      {showLabel && typeof surface.label === "string" && (
        <Text2D x={(ends.from.x + ends.to.x) / 2} y={(ends.from.y + ends.to.y) / 2 + 0.1 * scale} text={surface.label} size={0.074 * scale} color={C.muted} />
      )}
    </g>
  );
}

function AngleArc2D({ origin, angleRad, scale, ui, highlighted }: { origin: Point2; angleRad: number; scale: number; ui: number; highlighted: boolean }) {
  const radius = Math.max(1.55 * ui, 0.18 * scale);
  const samples = 18;
  const start = 0;
  const end = angleRad;
  const points = Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const a = start + (end - start) * t;
    return { x: origin.x + radius * Math.cos(a), y: origin.y + radius * Math.sin(a) };
  });
  const mid = start + (end - start) / 2;
  return (
    <g>
      <polyline
        points={toPolyline(points)}
        fill="none"
        stroke={highlighted ? C.highlight : C.vy}
        strokeWidth={(highlighted ? 0.14 : 0.1) * ui}
        strokeLinecap="round"
      />
    </g>
  );
}

function angleLabelCandidate(
  launchAngle: NonNullable<ReturnType<typeof launchAngleForScene>>,
  scale: number,
  ui: number,
  activeIds: string[],
  stepId: string,
): LabelCandidate {
  const radius = Math.max(1.55 * ui, 0.18 * scale);
  const mid = launchAngle.angleRad / 2;
  const highlighted = activeIds.some(id => id.toLowerCase().includes("theta") || id.toLowerCase().includes("angle")) || stepId === "invariant";
  return {
    key: "angle-label:theta",
    x: launchAngle.origin.x + (radius + 1.55 * ui) * Math.cos(mid),
    y: launchAngle.origin.y + (radius + 1.55 * ui) * Math.sin(mid),
    text: `θ = ${formatQuantityValue(launchAngle.angleDeg, "°")}°`,
    size: 1.0 * ui,
    color: C.text,
    boxed: false,
    leaderFrom: {
      x: launchAngle.origin.x + radius * Math.cos(mid),
      y: launchAngle.origin.y + radius * Math.sin(mid),
    },
    priority: highlighted ? 80 : 45,
  };
}

function LabelLayer({ labels }: { labels: PlacedLabel[] }) {
  return (
    <g>
      {labels.map(label => {
        return (
          <g key={label.key}>
            <g data-audit-label-key={label.key} data-audit-label-kind={label.key.split(":")[0]}>
              <Text2D
                x={label.x}
                y={label.y}
                text={label.text}
                size={label.size}
                color={label.color}
                boxed={label.boxed}
                anchor={label.anchor}
              />
            </g>
          </g>
        );
      })}
    </g>
  );
}

function textbookComponentLabelCandidates(
  annotations: TextbookAnnotations,
  vectorPatterns: string[],
  activeIds: string[],
  ui: number,
) {
  const ids = [...vectorPatterns, ...activeIds].join(" ").toLowerCase();
  const showU = vectorPatterns.some(pattern => pattern === "*:v" || pattern.endsWith(":v")) || /\b(vector:u|quantity:u|projection_speed)\b/.test(ids);
  const showUx = vectorPatterns.some(pattern => pattern === "*:vx" || pattern.endsWith(":vx")) || /\b(ux|vx|quantity:ux|vector:ux)\b/.test(ids);
  const showUy = vectorPatterns.some(pattern => pattern === "*:vy" || pattern.endsWith(":vy")) || /\b(uy|vy|quantity:uy|vector:uy)\b/.test(ids);
  const { launch } = annotations;
  const labelSize = 1.22 * ui;
  const labels: LabelCandidate[] = [];
  if (showU) {
    labels.push({
      key: "textbook-label:u",
      x: launch.x + 3.2 * ui,
      y: launch.y + 4.25 * ui,
      text: "u",
      size: 1.42 * ui,
      color: C.text,
      boxed: false,
      leaderFrom: launch,
      priority: 72,
    });
  }
  if (showUx) {
    labels.push({
      key: "textbook-label:ux",
      x: launch.x + 0.95 * ui,
      y: launch.y - 1.7 * ui,
      text: "uₓ = u cos θ",
      size: 1.42 * ui,
      color: C.text,
      boxed: false,
      leaderFrom: launch,
      priority: 74,
    });
  }
  if (showUy) {
    labels.push({
      key: "textbook-label:uy",
      x: launch.x - 0.72 * ui,
      y: launch.y + 2.55 * ui,
      text: "uᵧ = u sin θ",
      size: 0.86 * ui,
      color: C.text,
      boxed: false,
      leaderFrom: launch,
      anchor: "end",
      priority: 74,
    });
  }
  return labels;
}

function Text2D({
  x,
  y,
  text,
  size,
  color = C.text,
  boxed = false,
  anchor = "start",
}: {
  x: number;
  y: number;
  text: string;
  size: number;
  color?: string;
  boxed?: boolean;
  anchor?: "start" | "middle" | "end";
}) {
  const width = labelWidth(text, size);
  const boxX = anchor === "middle" ? -width / 2 : anchor === "end" ? -width : -size * 0.24;
  return (
    <g transform={`translate(${x} ${-y})`}>
      {boxed && <rect x={boxX} y={-size * 1.0} width={width} height={size * 1.22} rx={size * 0.08} fill="rgba(251,250,244,0.92)" stroke="rgba(23,36,43,0.16)" strokeWidth={size * 0.018} />}
      <text fill={color} fontSize={size} fontWeight={520} fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" textAnchor={anchor}>{text}</text>
    </g>
  );
}

function sceneGeometryBoxes(
  sceneSpec: SceneSpec2D,
  trajectories: ReturnType<typeof normalizedTrajectories>,
  activeHighlightIds: string[],
  bounds: ReturnType<typeof sceneBounds>,
  ui: number,
  showTrajectory: boolean,
): LabelBox[] {
  const boxes: LabelBox[] = [];
  const pointRadius = Math.max(0.42 * ui, 0.07 * bounds.scale);
  for (const [, point] of importantPoints(sceneSpec, activeHighlightIds)) {
    boxes.push(pointBox(point, pointRadius));
  }
  for (const surface of sceneSpec.geometry.surfaces ?? []) {
    const ends = surfaceEndpoints(surface, sceneSpec.geometry.points);
    if (ends) boxes.push(segmentBox(ends.from, ends.to, Math.max(0.42 * ui, 0.022 * bounds.scale)));
  }
  if (showTrajectory) {
    for (const trajectory of trajectories) {
      const points = trajectory.points;
      const stride = Math.max(1, Math.floor(points.length / 14));
      for (let index = 0; index < points.length - 1; index += stride) {
        boxes.push(segmentBox(points[index], points[Math.min(points.length - 1, index + stride)], 0.18 * ui));
      }
    }
  }
  return boxes.filter(validBox);
}

function distance(a: Point2, b: Point2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizedTrajectories(sceneSpec: SceneSpec2D) {
  const trajectories = sceneSpec.trajectories?.length ? sceneSpec.trajectories : [{
    id: "trajectory:path",
    actor: "projectile",
    sampled_points: [sceneSpec.geometry.points.launch ?? { x: 0, y: 0 }, sceneSpec.geometry.points.landing ?? { x: 1, y: 0 }],
  }];
  return trajectories.map((trajectory, index) => ({
    id: trajectory.id ?? `trajectory:${index}`,
    actor: trajectory.actor ?? (index === 0 ? "projectile" : `actor_${index}`),
    points: (trajectory.sampled_points ?? []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0, t: point.t })),
  })).filter(item => item.points.length);
}

function scopedSceneForActor(sceneSpec: SceneSpec2D, actor: string): SceneSpec2D {
  const trajectories = (sceneSpec.trajectories ?? []).filter(trajectory => (trajectory.actor ?? "projectile") === actor);
  const motions = (sceneSpec.motions ?? []).filter(motion => motion.actor === actor);
  const liveVectors = (sceneSpec.live_vectors ?? []).filter(vector => vector.actor === actor);
  const trajectory = trajectories[0];
  const sampled = trajectory?.sampled_points ?? [];
  const launch = sampled[0] ?? sceneSpec.geometry.points.launch ?? { x: 0, y: 0 };
  const surfaces = (sceneSpec.geometry.surfaces ?? []).map(surface => {
    const ends = surfaceEndpoints(surface, sceneSpec.geometry.points);
    if (!ends) return surface;
    return {
      ...surface,
      from_xy: [ends.from.x, ends.from.y],
      to_xy: [ends.to.x, ends.to.y],
    };
  });
  const scopedPoints: Record<string, Point2> = {
    launch: { ...launch, label: actorLabel(actor) },
  };
  return {
    ...sceneSpec,
    geometry: {
      ...sceneSpec.geometry,
      points: scopedPoints,
      surfaces,
    },
    trajectories,
    motions,
    motion: motions[0] ? { initial: motions[0].initial, acceleration: motions[0].acceleration, duration: motions[0].duration } : sceneSpec.motion,
    live_vectors: liveVectors,
  };
}

function launchAngleForScene(sceneSpec: SceneSpec2D) {
  if (sceneSpec.problem.world === "parametric_curve") return null;
  const quantity = sceneSpec.quantities?.theta ?? sceneSpec.quantities?.angle ?? sceneSpec.quantities?.launch_angle;
  const motion = sceneSpec.motion ?? sceneSpec.motions?.[0];
  const launch = sceneSpec.geometry.points.launch ?? sceneSpec.geometry.points.O ?? Object.values(sceneSpec.geometry.points ?? {})[0];
  if (!launch) return null;
  let angleDeg = quantity && Number.isFinite(quantity.value) ? quantity.value : NaN;
  if (!Number.isFinite(angleDeg) && motion) {
    angleDeg = Math.atan2(motion.initial.vy, motion.initial.vx) * 180 / Math.PI;
  }
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 0.01) return null;
  return {
    origin: launch,
    angleDeg,
    angleRad: angleDeg * Math.PI / 180,
  };
}

function shouldShowLaunchAngleLabel(
  sceneSpec: SceneSpec2D,
  stepId: string,
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  activeIds: string[],
  revealIds: string[],
) {
  const ids = [
    ...(visualState.visible_ids ?? []),
    ...(visualState.highlight_ids ?? []),
    ...(visualState.label_ids ?? []),
    ...activeIds,
    ...revealIds,
  ].join(" ").toLowerCase();
  if (ids.includes("theta") || ids.includes("angle") || ids.includes("quantity:θ")) return true;
  return stepId === "invariant" && ["level_ground", "height_launch"].includes(sceneSpec.problem.world);
}

function sceneBounds(
  sceneSpec: SceneSpec2D,
  trajectories: ReturnType<typeof normalizedTrajectories>,
  mode: "concept" | "event",
  compactConceptViewport = false,
) {
  const launch = sceneSpec.geometry.points.launch ?? trajectories[0]?.points[0] ?? { x: 0, y: 0 };
  const pts: Point2[] = compactConceptViewport
    ? [
      launch,
      ...trajectories.map(trajectory => trajectory.points[0]).filter(Boolean),
    ]
    : [
      ...Object.values(sceneSpec.geometry.points ?? {}),
      ...trajectories.flatMap(trajectory => trajectory.points),
    ];
  if (!compactConceptViewport) {
    for (const surface of sceneSpec.geometry.surfaces ?? []) {
      const ends = surfaceEndpoints(surface, sceneSpec.geometry.points);
      if (ends) pts.push(ends.from, ends.to);
    }
  }
  const xs = pts.map(p => p.x).filter(Number.isFinite);
  const ys = pts.map(p => p.y).filter(Number.isFinite);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(1, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = span * (mode === "concept" ? 0.42 : 0.32);
  let width = maxX - minX + pad * 2;
  let height = maxY - minY + pad * 2;
  const targetAspect = 16 / 9;
  const aspect = width / Math.max(height, 0.001);
  let extraX = 0;
  let extraY = 0;
  if (aspect < targetAspect) {
    extraX = (height * targetAspect - width) / 2;
    width += extraX * 2;
  } else {
    extraY = (width / targetAspect - height) / 2;
    height += extraY * 2;
  }
  return {
    minX: minX - pad - extraX,
    maxX: maxX + pad + extraX,
    minY: minY - pad - extraY,
    maxY: maxY + pad + extraY,
    width,
    height,
    scale: span,
  };
}

function uiScale(bounds: ReturnType<typeof sceneBounds>) {
  return clamp(bounds.scale * 0.04, 0.22, 2.4);
}

function surfaceEndpoints(surface: Record<string, unknown>, points: Record<string, Point2>) {
  const fromXY = surface.from_xy as [number, number] | undefined;
  const toXY = surface.to_xy as [number, number] | undefined;
  if (Array.isArray(fromXY) && Array.isArray(toXY)) {
    return { from: { x: Number(fromXY[0]), y: Number(fromXY[1]) }, to: { x: Number(toXY[0]), y: Number(toXY[1]) } };
  }
  const fromId = typeof surface.from === "string" ? surface.from : "";
  const toId = typeof surface.to === "string" ? surface.to : "";
  if (fromId && toId && points[fromId] && points[toId]) return { from: points[fromId], to: points[toId] };
  return null;
}

function visibleVectors(sceneSpec: SceneSpec2D, patterns: string[]) {
  const vectors = sceneSpec.live_vectors ?? [];
  if (!patterns.length) return [];
  if (patterns.includes("__none__")) return [];
  return vectors.filter(vector => patterns.some(pattern => vectorPatternMatches(pattern, vector.id)));
}

function layoutVectors({
  sceneSpec,
  trajectories,
  vectors,
  progress,
  bounds,
  ui,
  occupiedBoxes,
  dimmedIds,
  activeHighlightIds,
  storyboardStep,
  visualState,
  labelIds,
  revealIds,
  useTextbookLayout,
}: {
  sceneSpec: SceneSpec2D;
  trajectories: ReturnType<typeof normalizedTrajectories>;
  vectors: NonNullable<SceneSpec2D["live_vectors"]>;
  progress: number;
  bounds: ReturnType<typeof sceneBounds>;
  ui: number;
  occupiedBoxes: LabelBox[];
  dimmedIds: string[];
  activeHighlightIds: string[];
  storyboardStep: NonNullable<SceneSpec2D["storyboard"]>[number] | undefined;
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"];
  labelIds: string[];
  revealIds: string[];
  useTextbookLayout: boolean;
}): VectorDrawing[] {
  const occupied = [...occupiedBoxes];
  const drawings: VectorDrawing[] = [];
  const explicitLabelPatterns = labelIds.flatMap(sceneIdToVectorPatterns);
  const explicitVectorLabelCount = vectors.filter(vector => explicitLabelPatterns.some(pattern => vectorPatternMatches(pattern, vector.id))).length;
  const highlightedExplicitVectorLabelCount = vectors.filter(vector => (
    explicitLabelPatterns.some(pattern => vectorPatternMatches(pattern, vector.id))
    && matchesSceneId(activeHighlightIds, vector.id)
  )).length;
  vectors.forEach((vector, index) => {
    const dimmed = dimmedIds.flatMap(sceneIdToVectorPatterns).some(pattern => vectorPatternMatches(pattern, vector.id));
    const highlighted = matchesSceneId(activeHighlightIds, vector.id);
    const color = dimmed ? C.dim : highlighted ? C.highlight : vectorColor(vector);
    const label = vectorLabel(storyboardStep, vector, visualState, activeHighlightIds, revealIds);
    const explicitLabel = explicitLabelPatterns.some(pattern => vectorPatternMatches(pattern, vector.id));
    const showLabel = !useTextbookLayout && explicitLabel && (
      explicitVectorLabelCount <= 2
      || highlightedExplicitVectorLabelCount === 0
      || highlighted
    );
    const labelInfo = showLabel ? { text: formatVectorLabel(label), size: 0.72 * ui } : undefined;
    const drawn = resolveVector(sceneSpec, trajectories, vector, progress, bounds, index, occupied, ui, labelInfo);
    if (!drawn) return;
    const mid = vectorLabelAnchor(drawn);
    occupied.push(vectorBox(drawn, ui));
    if (labelInfo) occupied.push(vectorLabelBox(drawn, labelInfo.text, labelInfo.size));
    drawings.push({ vector, drawn, dimmed, highlighted, color, label, showLabel, mid });
  });
  return drawings;
}

function resolveVector(
  sceneSpec: SceneSpec2D,
  trajectories: ReturnType<typeof normalizedTrajectories>,
  vector: NonNullable<SceneSpec2D["live_vectors"]>[number],
  progress: number,
  bounds: ReturnType<typeof sceneBounds>,
  index: number,
  occupiedBoxes: LabelBox[] = [],
  ui = bounds.scale * 0.04,
  labelInfo?: { text: string; size: number },
): ResolvedVector | null {
  const trajectory = trajectories.find(item => item.actor === vector.actor) ?? trajectories[0];
  if (!trajectory) return null;
  const motion = motionForActor(sceneSpec, vector.actor);
  const anchorBase = vector.anchor === "launch" ? trajectory.points[0] : samplePath(trajectory.points, progress);
  const components = vectorComponents(sceneSpec, motion, vector.component);
  if (!components) return null;
  const length = Math.hypot(components.x, components.y) || 1;
  const normalized = { x: components.x / length, y: components.y / length };
  const baseLength = vectorBaseLength(vector, bounds.scale);
  const candidates = vectorLayoutCandidates(vector, anchorBase, normalized, baseLength, bounds, ui, index);
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score = vectorLayoutScore(candidate, occupiedBoxes, bounds, ui, labelInfo);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function vectorBaseLength(vector: NonNullable<SceneSpec2D["live_vectors"]>[number], scale: number) {
  if (vector.kind === "axis") return 0.42 * scale;
  if (vector.component === "velocity") return 0.25 * scale;
  if (vector.component === "x_velocity" || vector.component === "y_velocity") return 0.19 * scale;
  return 0.22 * scale;
}

function vectorLabelGap(vector: NonNullable<SceneSpec2D["live_vectors"]>[number], ui: number) {
  if (vector.kind === "axis") return 2.4 * ui;
  if (vector.component.includes("gravity") || vector.component.includes("normal") || vector.component.includes("tangent")) return 3.1 * ui;
  return 2.35 * ui;
}

function vectorLayoutCandidates(
  vector: NonNullable<SceneSpec2D["live_vectors"]>[number],
  anchorBase: Point2,
  direction: Point2,
  baseLength: number,
  bounds: ReturnType<typeof sceneBounds>,
  ui: number,
  index: number,
): VectorCandidate[] {
  const scale = bounds.scale;
  const baseSpread = teachingVectorSpread(vector, scale, index);
  const perp = { x: -direction.y, y: direction.x };
  const along = direction;
  const lengthMultipliers = vector.kind === "axis" ? [1, 0.78, 1.18, 0.62] : [1, 0.82, 1.16, 0.66, 1.34];
  const lanes = vectorLaneOffsets(vector, scale, index);
  const labelSides = preferredLabelSides(anchorBase, perp, bounds);
  const candidates: VectorCandidate[] = [];
  for (const lane of lanes) {
    for (const lengthMultiplier of lengthMultipliers) {
      for (const labelSide of labelSides) {
        const from = {
          x: anchorBase.x + baseSpread.x + perp.x * lane.perp + along.x * lane.along,
          y: anchorBase.y + baseSpread.y + perp.y * lane.perp + along.y * lane.along,
        };
        const vectorLength = baseLength * lengthMultiplier;
        const to = {
          x: from.x + direction.x * vectorLength,
          y: from.y + direction.y * vectorLength,
        };
        const labelGap = Math.max(vectorLabelGap(vector, ui), 0.13 * scale);
        candidates.push({
          from,
          to,
          labelOffset: {
            x: perp.x * labelGap * labelSide.side + direction.x * 0.34 * ui,
            y: perp.y * labelGap * labelSide.side + direction.y * 0.34 * ui,
          },
          laneCost: Math.abs(lane.perp) / Math.max(0.08 * scale, 0.001) + Math.abs(lane.along) / Math.max(0.08 * scale, 0.001),
          lengthCost: Math.abs(lengthMultiplier - 1),
          labelSideCost: labelSide.cost,
        });
      }
    }
  }
  return candidates;
}

function preferredLabelSides(anchor: Point2, perp: Point2, bounds: ReturnType<typeof sceneBounds>) {
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const outward = normalize2({ x: anchor.x - center.x, y: anchor.y - center.y });
  const dot = outward.x * perp.x + outward.y * perp.y;
  const preferred = Math.abs(dot) < 0.12 ? 1 : dot >= 0 ? 1 : -1;
  return [
    { side: preferred, cost: 0 },
    { side: -preferred, cost: 0.55 },
  ];
}

function vectorLaneOffsets(vector: NonNullable<SceneSpec2D["live_vectors"]>[number], scale: number, index: number) {
  const base = Math.max(0.08 * scale, 0.001);
  const lane = (index % 5) - 2;
  const preserveTriangle = ["velocity", "x_velocity", "y_velocity"].includes(vector.component);
  if (preserveTriangle) {
    return [
      { perp: 0, along: 0 },
      { perp: base * 0.9, along: 0 },
      { perp: -base * 0.9, along: 0 },
      { perp: base * 1.8, along: base * 0.4 },
      { perp: -base * 1.8, along: base * 0.4 },
    ];
  }
  if (vector.kind === "axis") {
    return [
      { perp: base * lane, along: 0 },
      { perp: base * (lane + 1), along: base },
      { perp: base * (lane - 1), along: -base },
      { perp: base * 2.4, along: 0 },
      { perp: -base * 2.4, along: 0 },
    ];
  }
  return [
    { perp: base * lane, along: 0 },
    { perp: base * (lane + 1.5), along: base * 0.5 },
    { perp: base * (lane - 1.5), along: base * 0.5 },
    { perp: base * 3, along: -base * 0.4 },
    { perp: -base * 3, along: -base * 0.4 },
  ];
}

function vectorLayoutScore(
  drawn: VectorCandidate,
  occupiedBoxes: LabelBox[],
  bounds: ReturnType<typeof sceneBounds>,
  ui: number,
  labelInfo?: { text: string; size: number },
) {
  const softBounds = drawableBoundsBox(bounds, 0.55 * ui);
  const box = vectorBox(drawn, ui);
  const labelBoxCandidate = labelInfo ? vectorLabelBox(drawn, labelInfo.text, labelInfo.size) : null;
  const vectorOverlapPenalty = occupiedBoxes.reduce((sum, occupied) => sum + overlapArea(box, occupied, 0.2 * ui), 0) * 140;
  const labelOverlapPenalty = labelBoxCandidate
    ? occupiedBoxes.reduce((sum, occupied) => sum + overlapArea(labelBoxCandidate, occupied, 0.2 * ui), 0) * 165
    : 0;
  const selfOverlapPenalty = labelBoxCandidate ? overlapArea(labelBoxCandidate, box, 0.18 * ui) * 120 : 0;
  const outOfBoundsPenalty = (
    overflowAmount(box, softBounds)
    + (labelBoxCandidate ? overflowAmount(labelBoxCandidate, softBounds) : 0)
  ) * 95;
  const geometryPenalty = drawn.laneCost * 7 + drawn.lengthCost * 9 + drawn.labelSideCost * 5;
  return vectorOverlapPenalty + labelOverlapPenalty + selfOverlapPenalty + outOfBoundsPenalty + geometryPenalty;
}

function vectorBox(drawn: ResolvedVector, ui: number): LabelBox {
  const pad = Math.max(0.52 * ui, 0.001);
  return {
    left: Math.min(drawn.from.x, drawn.to.x) - pad,
    right: Math.max(drawn.from.x, drawn.to.x) + pad,
    top: Math.max(drawn.from.y, drawn.to.y) + pad,
    bottom: Math.min(drawn.from.y, drawn.to.y) - pad,
  };
}

function vectorLabelAnchor(drawn: ResolvedVector) {
  return {
    x: drawn.from.x + (drawn.to.x - drawn.from.x) * 1.18,
    y: drawn.from.y + (drawn.to.y - drawn.from.y) * 1.18,
  };
}

function vectorLabelTextAnchor(drawn: ResolvedVector): LabelAnchor {
  const position = {
    x: vectorLabelAnchor(drawn).x + drawn.labelOffset.x,
    y: vectorLabelAnchor(drawn).y + drawn.labelOffset.y,
  };
  const direction = { x: drawn.to.x - drawn.from.x, y: drawn.to.y - drawn.from.y };
  if (position.x < drawn.from.x - Math.abs(direction.x) * 0.18) return "end";
  if (Math.abs(direction.x) < Math.abs(direction.y) * 0.35) return "middle";
  return "start";
}

function vectorLabelBox(drawn: ResolvedVector, text: string, size: number): LabelBox {
  const mid = vectorLabelAnchor(drawn);
  return labelBox({
    key: "vector-label-preview",
    text,
    x: mid.x + drawn.labelOffset.x,
    y: mid.y + drawn.labelOffset.y,
    size,
    boxed: true,
    anchor: vectorLabelTextAnchor(drawn),
  });
}

function drawableBoundsBox(bounds: ReturnType<typeof sceneBounds>, inset: number): LabelBox {
  return {
    left: bounds.minX + inset,
    right: bounds.maxX - inset,
    bottom: bounds.minY + inset,
    top: bounds.maxY - inset,
  };
}

function overflowAmount(box: LabelBox, bounds: LabelBox) {
  return (
    Math.max(0, bounds.left - box.left)
    + Math.max(0, box.right - bounds.right)
    + Math.max(0, bounds.bottom - box.bottom)
    + Math.max(0, box.top - bounds.top)
  );
}

function motionForActor(sceneSpec: SceneSpec2D, actor: string) {
  const all = sceneSpec.motions ?? (sceneSpec.motion ? [{ actor: "projectile", ...sceneSpec.motion }] : []);
  const motion = all.find(item => item.actor === actor) ?? all[0];
  return motion ?? { initial: { x: 0, y: 0, vx: 1, vy: 0 }, acceleration: { x: 0, y: -1 }, duration: 1 };
}

function vectorComponents(sceneSpec: SceneSpec2D, motion: ReturnType<typeof motionForActor>, component: string) {
  if (component === "horizontal_axis") return { x: 1, y: 0 };
  if (component === "vertical_axis") return { x: 0, y: 1 };
  if (component === "velocity") return { x: motion.initial.vx, y: motion.initial.vy };
  if (component === "x_velocity") return { x: motion.initial.vx, y: 0 };
  if (component === "y_velocity") return { x: 0, y: motion.initial.vy };
  if (component === "acceleration") return { x: motion.acceleration.x, y: motion.acceleration.y };
  if (component.includes("incline") || component.includes("gravity") || component.includes("tangent") || component.includes("normal")) {
    const incline = (sceneSpec.geometry.surfaces ?? []).map(surface => surfaceEndpoints(surface, sceneSpec.geometry.points)).find(Boolean);
    if (!incline) return null;
    const dx = incline.to.x - incline.from.x;
    const dy = incline.to.y - incline.from.y;
    const mag = Math.hypot(dx, dy) || 1;
    const tangent = { x: dx / mag, y: dy / mag };
    const normal = { x: -tangent.y, y: tangent.x };
    if (component === "incline_tangent") return tangent;
    if (component === "incline_normal") return normal;
    if (component === "gravity_tangent") {
      const projection = motion.acceleration.x * tangent.x + motion.acceleration.y * tangent.y;
      return { x: projection * tangent.x, y: projection * tangent.y };
    }
    if (component === "gravity_normal") {
      const projection = motion.acceleration.x * normal.x + motion.acceleration.y * normal.y;
      return { x: projection * normal.x, y: projection * normal.y };
    }
    if (component === "velocity_tangent") {
      const projection = motion.initial.vx * tangent.x + motion.initial.vy * tangent.y;
      return { x: projection * tangent.x, y: projection * tangent.y };
    }
    if (component === "velocity_normal") {
      const projection = motion.initial.vx * normal.x + motion.initial.vy * normal.y;
      return { x: projection * normal.x, y: projection * normal.y };
    }
  }
  return null;
}

function teachingVectorSpread(vector: NonNullable<SceneSpec2D["live_vectors"]>[number], scale: number, index: number) {
  if (vector.anchor !== "launch" && !vector.component.includes("gravity")) return { x: 0, y: 0 };
  if (["velocity", "x_velocity", "y_velocity"].includes(vector.component)) return { x: 0, y: 0 };
  const lane = (index % 5) - 2;
  if (vector.component === "gravity_tangent") return { x: lane * 0.12 * scale, y: -0.18 * scale };
  if (vector.component === "gravity_normal") return { x: lane * 0.12 * scale, y: 0.18 * scale };
  if (vector.component === "incline_tangent") return { x: 0, y: -0.08 * scale };
  if (vector.component === "incline_normal") return { x: 0.08 * scale, y: 0.08 * scale };
  return { x: lane * 0.08 * scale, y: lane * 0.04 * scale };
}

function samplePath(points: Point2[], progress: number) {
  if (!points.length) return { x: 0, y: 0 };
  const index = clamp(Math.round(progress * (points.length - 1)), 0, points.length - 1);
  return points[index];
}

function toPolyline(points: Point2[]) {
  return points.map(point => `${point.x},${-point.y}`).join(" ");
}

function importantPoints(sceneSpec: SceneSpec2D, highlightIds: string[]) {
  const allowed = new Set(["launch", "landing", "apex", "impact", "collision", "target", "wall_top", "position_at_t"]);
  return Object.entries(sceneSpec.geometry.points ?? {}).filter(([id]) => allowed.has(id) || matchesSceneId(highlightIds, `point:${id}`));
}

function pointLabelEntries(
  sceneSpec: SceneSpec2D,
  activeHighlightIds: string[],
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  stepId: string,
  ui: number,
  suppressImplicitPointLabels: boolean,
): PointLabelEntry[] {
  const explicitLabelIds = visualState.label_ids ?? [];
  const visibleIds = visualState.visible_ids ?? [];
  const highlightedIds = [...(visualState.highlight_ids ?? []), ...activeHighlightIds];
  const pointRequestIds = [...explicitLabelIds, ...visibleIds, ...highlightedIds];
  const impactRequested = pointIdRequested(pointRequestIds, "impact");
  const entries: PointLabelEntry[] = [];
  for (const [id, point] of importantPoints(sceneSpec, activeHighlightIds)) {
    const text = String(point.label ?? id).trim();
    if (!text) continue;
    if (id === "landing" && text.toLowerCase() === "reference" && impactRequested) continue;
    const highlighted = pointIdRequested(highlightedIds, id);
    const labeled = pointIdRequested(explicitLabelIds, id);
    const visible = pointIdRequested(visibleIds, id);
    if (suppressImplicitPointLabels && !labeled) continue;
    if (!highlighted && !labeled && !visible) continue;
    entries.push({
      id,
      point,
      text,
      priority: highlighted ? 88 : labeled ? 76 : stepId === "invariant" ? 62 : 58,
    });
  }
  return collapseNearbyPointLabels(entries, ui);
}

function hasExplicitNonPointLabels(labelIds: string[]) {
  return labelIds.some(id => {
    const token = id.trim().toLowerCase();
    return token && !token.startsWith("point:");
  });
}

function pointIdRequested(ids: string[], id: string) {
  const normalizedId = id.toLowerCase();
  return ids.some(raw => {
    const token = raw.trim().toLowerCase();
    return token === normalizedId || token === `point:${normalizedId}`;
  });
}

function collapseNearbyPointLabels(entries: PointLabelEntry[], ui: number) {
  const kept: PointLabelEntry[] = [];
  const mergeDistance = Math.max(1.1 * ui, 0.001);
  for (const entry of entries) {
    const existing = kept.find(item => distance(item.point, entry.point) <= mergeDistance);
    if (!existing) {
      kept.push({ ...entry });
      continue;
    }
    if (entry.priority > existing.priority || existing.text.toLowerCase() === "reference") {
      existing.id = entry.id;
      existing.point = entry.point;
      existing.text = entry.text;
    } else if (entry.text.toLowerCase() !== "reference" && !existing.text.includes(entry.text)) {
      existing.text = `${existing.text}/${entry.text}`;
    }
    existing.priority = Math.max(existing.priority, entry.priority);
  }
  return kept;
}

function sceneIdToVectorPatterns(id: string) {
  const normalized = id.trim().toLowerCase();
  if (!normalized || normalized.startsWith("emphasis:")) return [];
  if (normalized.startsWith("*:")) return [normalized];
  if (normalized === "velocity:x_component" || normalized === "velocity:horizontal_component") return ["*:vx"];
  if (normalized === "velocity:y_component" || normalized === "velocity:vertical_component") return ["*:vy"];
  if (normalized === "velocity:impact_x_component") return ["*:vx"];
  if (normalized === "velocity:impact_y_component") return ["*:vy"];
  if (normalized === "velocity:impact" || normalized === "velocity:resultant") return ["*:v"];
  if (normalized.includes(":gravity_")) return [id];
  if (normalized.startsWith("gravity:") || normalized.startsWith("velocity:")) return [id];
  if (normalized.includes("normal_axis")) return ["incline:normal_axis"];
  if (normalized.includes("tangent_axis") || normalized.includes("parallel") || normalized.includes("along")) return ["incline:tangent_axis"];
  if (normalized === "quantity:u" || normalized === "vector:u" || normalized === "vector:v" || normalized.endsWith(":v") || normalized.includes("projection_speed")) return ["*:v"];
  if (normalized.includes("vx") || normalized.includes("ux") || normalized.endsWith(":vx")) return ["*:vx"];
  if (normalized.includes("vy") || normalized.includes("uy") || normalized.endsWith(":vy")) return ["*:vy"];
  if (normalized.includes("gravity") || normalized.endsWith(":a")) return ["*:a"];
  return [id];
}

function vectorPatternMatches(pattern: string, vectorId: string) {
  if (pattern === vectorId) return true;
  if (pattern.startsWith("*:")) return vectorId.endsWith(pattern.slice(1));
  return false;
}

function matchesSceneId(ids: string[], id: string) {
  return ids.flatMap(sceneIdToVectorPatterns).some(pattern => vectorPatternMatches(pattern, id)) || ids.includes(id);
}

function labelOverride(storyboardStep: NonNullable<SceneSpec2D["storyboard"]>[number] | undefined, vectorId: string) {
  const contractLabel = contractLabelsForTarget(contractForStep(storyboardStep), vectorId);
  if (contractLabel) return contractLabel;
  return storyboardStep?.labels?.find(label => label.target_id === vectorId)?.text;
}

function vectorLabel(
  storyboardStep: NonNullable<SceneSpec2D["storyboard"]>[number] | undefined,
  vector: NonNullable<SceneSpec2D["live_vectors"]>[number],
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  activeHighlightIds: string[],
  revealIds: string[],
) {
  const contract = contractForStep(storyboardStep);
  const explicit = labelOverride(storyboardStep, vector.id);
  const ids = [
    ...(visualState.visible_ids ?? []),
    ...(visualState.highlight_ids ?? []),
    ...(visualState.label_ids ?? []),
    ...activeHighlightIds,
    ...revealIds,
  ].join(" ").toLowerCase();
  if (contractForbids(contract, "u_cos_theta") && vector.component === "x_velocity") return explicit ?? vector.label;
  if (contractForbids(contract, "u_sin_theta") && vector.component === "y_velocity") return explicit ?? vector.label;
  if (vector.component === "x_velocity" && /\b(quantity:ux|vector:ux|ux)\b/.test(ids)) return "u_x = u cos(theta)";
  if (vector.component === "y_velocity" && /\b(quantity:uy|vector:uy|uy)\b/.test(ids)) return "u_y = u sin(theta)";
  return explicit ?? vector.label;
}

function vectorColor(vector: NonNullable<SceneSpec2D["live_vectors"]>[number]) {
  if (vector.component === "x_velocity") return C.vx;
  if (vector.component === "y_velocity") return C.vy;
  if (vector.component.includes("gravity") || vector.component === "acceleration") return C.gravity;
  if (vector.kind === "axis") return C.surface;
  return C.vector;
}

function formatVectorLabel(label: string) {
  return label
    .replace(/u_x/g, "uₓ")
    .replace(/u_y/g, "uᵧ")
    .replace(/v_x/g, "vₓ")
    .replace(/v_y/g, "vᵧ")
    .replace(/g_normal/g, "gₙ")
    .replace(/g_parallel/g, "g∥")
    .replace(/alpha/g, "α")
    .replace(/beta/g, "β")
    .replace(/theta/g, "θ")
    .replace(/_parallel/g, "∥")
    .replace(/parallel/g, "∥")
    .replace(/_normal/g, "ₙ")
    .replace(/\bnormal\b/g, "n")
    .replace(/\*/g, "×");
}

function filteredTeachingVectorPatterns(
  patterns: string[],
  _stepId: string,
  _visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  _activeHighlightIds: string[],
  _revealIds: string[],
) {
  return unique(patterns);
}

type BoardBadge = {
  title: string;
  lines: string[];
  tone: "given" | "target" | "relation";
};

function boardBadgesForStep(
  sceneSpec: SceneSpec2D,
  stepId: string,
  visualState: NonNullable<SceneSpec2D["storyboard"]>[number]["visual_state"] = {},
  activeHighlightIds: string[],
  revealIds: string[],
): BoardBadge[] {
  const ids = [
    stepId,
    ...(visualState.visible_ids ?? []),
    ...(visualState.highlight_ids ?? []),
    ...(visualState.label_ids ?? []),
    ...activeHighlightIds,
    ...revealIds,
  ].join(" ").toLowerCase();
  const badges: BoardBadge[] = [];
  const needsGiven = ids.includes("emphasis:given") || stepId === "invariant";
  if (needsGiven) {
    const lines = [
      quantityLine(sceneSpec, ["u", "v0", "v_0", "speed", "initial_speed"], "u"),
      quantityLine(sceneSpec, ["theta", "angle", "launch_angle"], "θ"),
    ].filter(Boolean) as string[];
    if (lines.length) badges.push({ title: "Given", lines, tone: "given" });
    badges.push({ title: "To find", lines: [unknownLabel(sceneSpec.problem.unknown)], tone: "target" });
  }
  if (ids.includes("quantity:ux") || ids.includes("quantity:uy") || ids.includes("vector:ux") || ids.includes("vector:uy")) {
    badges.push({ title: "Resolve launch", lines: ["uₓ = u cos(θ)", "uᵧ = u sin(θ)"], tone: "relation" });
  }
  if (ids.includes("quantity:delta_y") || ids.includes("same_height") || ids.includes("landing condition")) {
    badges.push({ title: "Landing condition", lines: ["Δy = 0", "launch height = landing height"], tone: "relation" });
  }
  if (ids.includes("quantity:t")) {
    if (sceneSpec.problem.world === "parametric_curve") {
      badges.push({ title: "Parameter", lines: ["t drives the curve"], tone: "relation" });
    } else {
      badges.push({ title: "Flight time", lines: ["T = 2uᵧ/g"], tone: "relation" });
    }
  }
  if (ids.includes("quantity:r")) {
    const finalRange = quantityLine(sceneSpec, ["R", "range"], "R");
    const lines = finalRange ? ["R = uₓT", finalRange] : ["R = uₓT"];
    badges.push({ title: "Range relation", lines, tone: "target" });
  }
  return badges.slice(0, 3);
}

function quantityLine(sceneSpec: SceneSpec2D, keys: string[], fallbackSymbol: string) {
  for (const key of keys) {
    const quantity = sceneSpec.quantities?.[key];
    if (!quantity || !Number.isFinite(quantity.value)) continue;
    const symbol = symbolForQuantity(key, quantity.label || fallbackSymbol);
    const unit = unitForQuantity(quantity.unit);
    return `${symbol} = ${formatQuantityValue(quantity.value, unit)}${unit}`;
  }
  return "";
}

function symbolForQuantity(key: string, label: string) {
  const normalized = `${key} ${label}`.toLowerCase();
  if (normalized.includes("theta") || normalized.includes("angle")) return "θ";
  if (normalized.includes("range") || key === "R") return "R";
  if (normalized.includes("time") || key === "T") return "T";
  if (normalized.includes("height") || key === "H") return "H";
  if (normalized.includes("speed") || normalized === "u") return "u";
  return formatVectorLabel(label || key);
}

function unitForQuantity(unit: string) {
  if (!unit || unit === "unitless") return "";
  if (unit === "deg" || unit === "degree" || unit === "degrees") return "°";
  return unit.startsWith(" ") ? unit : ` ${unit}`;
}

function formatQuantityValue(value: number, unit: string) {
  if (unit === "°") return `${Number(value.toFixed(3)).toString()}`;
  return Number(value.toFixed(4)).toString();
}

function displayAnswerText(answer: string | null | undefined) {
  return String(answer ?? "")
    .trim()
    .replace(/deg\b/gi, "°")
    .replace(/\s+/g, " ");
}

function unknownLabel(unknown: string) {
  const normalized = (unknown || "").toLowerCase();
  if (normalized.includes("range")) return "R";
  if (normalized.includes("time")) return "T";
  if (normalized.includes("height")) return "H";
  if (normalized.includes("speed") || normalized.includes("velocity")) return "speed";
  return formatVectorLabel(unknown || "answer");
}

function actorLabel(actor: string) {
  if (actor === "projectile_p") return "P";
  if (actor === "slider_q") return "Q";
  return actor.replace(/^projectile_?/i, "").replace(/_/g, " ").trim().toUpperCase() || "projectile";
}

function HandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

const boardToolStripStyle = {
  position: "absolute" as const,
  right: 8,
  top: 8,
  display: "flex",
  gap: 5,
  padding: 4,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(17,17,28,0.76)",
  pointerEvents: "auto" as const,
};

const boardBadgeStackStyle = {
  position: "absolute" as const,
  left: 10,
  top: 10,
  display: "grid",
  gap: 7,
  maxWidth: "min(360px, calc(100% - 86px))",
  pointerEvents: "none" as const,
};

function boardBadgeStyle(tone: BoardBadge["tone"]) {
  const color = tone === "given" ? "#58c4dd" : tone === "target" ? "#ffd84d" : "#f4f4f5";
  return {
    border: `1px solid ${tone === "relation" ? "rgba(255,255,255,0.16)" : `${color}66`}`,
    borderRadius: 10,
    background: "rgba(17,17,28,0.84)",
    padding: "8px 10px",
    color,
    boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
    animation: tone === "relation" ? "none" : "board-badge-pulse 1.35s ease-in-out infinite",
  };
}

const boardBadgeTitleStyle = {
  color: "rgba(244,244,245,0.74)",
  fontSize: 10,
  fontWeight: 850,
  textTransform: "uppercase" as const,
  letterSpacing: 0,
  marginBottom: 5,
};

const boardBadgeLineStackStyle = {
  display: "grid",
  gap: 3,
};

const boardBadgeLineStyle = {
  color: "inherit",
  fontSize: 15,
  fontWeight: 900,
  lineHeight: 1.25,
  whiteSpace: "nowrap" as const,
};

function boardToolButtonStyle(active: boolean) {
  return {
    width: 28,
    height: 26,
    border: `1px solid ${active ? "rgba(255,216,77,0.55)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 7,
    background: active ? "rgba(255,216,77,0.14)" : "rgba(255,255,255,0.06)",
    color: active ? C.highlight : C.text,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 900,
  };
}

function wantsAny(ids: string[], tokens: string[]) {
  return ids.some(id => tokens.some(token => id.includes(token)));
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
