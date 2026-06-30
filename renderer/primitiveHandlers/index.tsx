import React from "react";
import { TimelineBlock } from "../types";

// ---------------------------------------------------------------------------
// Primitive Handler contract
// ---------------------------------------------------------------------------

export interface PrimitiveProps {
  progress: number;  // 0.0 → 1.0 over the block's duration
  block: TimelineBlock;
}

export type PrimitiveHandler = React.FC<PrimitiveProps>;

// ---------------------------------------------------------------------------
// Shared helper objects (used across handlers)
// ---------------------------------------------------------------------------

function SphereObject({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[0.5, 32, 32]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function InclinePlane() {
  return (
    <mesh position={[5, 4.33, 0]} rotation={[0, 0, Math.PI / 6]} castShadow receiveShadow>
      <boxGeometry args={[20, 0.2, 5]} />
      <meshStandardMaterial color="#8B4513" />
    </mesh>
  );
}

function BaseInclineScene() {
  return (
    <group>
      <InclinePlane />
      <SphereObject position={[0, 8.66, 0]} color="#fc6255" />
      <SphereObject position={[0, 8.66, 0.6]} color="#58c4dd" />
    </group>
  );
}

// Generic stub — renders incline scene so video is never blank.
const FallbackOverlay: PrimitiveHandler = () => <BaseInclineScene />;

// ---------------------------------------------------------------------------
// ── Universal setup / inspection ────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowSetup: PrimitiveHandler = () => <BaseInclineScene />;

const HighlightObject: PrimitiveHandler = ({ progress }) => {
  const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 4);
  return (
    <group>
      <InclinePlane />
      <mesh position={[0, 8.66, 0]} castShadow>
        <sphereGeometry args={[0.5 + pulse * 0.15, 32, 32]} />
        <meshStandardMaterial color="#fc6255" emissive="#fc6255" emissiveIntensity={pulse} />
      </mesh>
    </group>
  );
};

const LabelGivenValues: PrimitiveHandler = () => <BaseInclineScene />;

const FreezeFrame: PrimitiveHandler = () => (
  <group>
    <InclinePlane />
    <SphereObject position={[8.5, 3.66, 0]} color="#fc6255" />
    <SphereObject position={[8.5, 3.66, 0.6]} color="#58c4dd" />
  </group>
);

const PlayRawMotion: PrimitiveHandler = ({ progress }) => {
  const p_x = progress * 8.5;
  const p_y = 8.66 - progress * 5;
  const q_x = progress * 5;
  const q_y = 8.66 - progress * 2.88;
  return (
    <group>
      <InclinePlane />
      <SphereObject position={[p_x, p_y, 0]} color="#fc6255" />
      <SphereObject position={[q_x, q_y, 0.6]} color="#58c4dd" />
    </group>
  );
};

const SlowMotion: PrimitiveHandler = ({ progress }) => {
  const p_x = progress * 8.5;
  const p_y = 8.66 - progress * 5;
  return (
    <group>
      <InclinePlane />
      <SphereObject position={[p_x, p_y, 0]} color="#fc6255" />
    </group>
  );
};

const ReplayMotion: PrimitiveHandler = ({ progress }) => {
  const looped = progress % 1;
  const p_x = looped * 8.5;
  const p_y = 8.66 - looped * 5;
  return (
    <group>
      <InclinePlane />
      <SphereObject position={[p_x, p_y, 0]} color="#fc6255" />
    </group>
  );
};

// ---------------------------------------------------------------------------
// ── Vector decomposition ────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const SplitVector: PrimitiveHandler = FallbackOverlay;
const DrawVelocityArrow: PrimitiveHandler = FallbackOverlay;
const AnimateVxConstant: PrimitiveHandler = FallbackOverlay;
const AnimateVyChanging: PrimitiveHandler = FallbackOverlay;
const ShowVelocityAtApex: PrimitiveHandler = FallbackOverlay;
const ShowVelocityComponentsLive: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Coordinate / axis transforms ────────────────────────────────────────────
// ---------------------------------------------------------------------------

const RotateAxes: PrimitiveHandler = FallbackOverlay;
const ShowInclineComponents: PrimitiveHandler = FallbackOverlay;
const ShowNormalVector: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Incline-specific ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowShadowProjection: PrimitiveHandler = FallbackOverlay;
const CompareParallelMotion: PrimitiveHandler = FallbackOverlay;
const IsolatePerpendicularMotion: PrimitiveHandler = FallbackOverlay;
const AnimateInclineLaunch: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Height launch ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowCliff: PrimitiveHandler = () => (
  <group>
    <mesh position={[-4, 3, 0]} castShadow receiveShadow>
      <boxGeometry args={[2, 6, 5]} />
      <meshStandardMaterial color="#555577" />
    </mesh>
    <SphereObject position={[-3, 6.5, 0]} color="#fc6255" />
  </group>
);

const AnimateHorizontalThrow: PrimitiveHandler = ({ progress }) => {
  const x = progress * 12;
  const y = 6.5 - 0.5 * 10 * (progress * 3) ** 2 / 10;
  return (
    <group>
      <mesh position={[-4, 3, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 6, 5]} />
        <meshStandardMaterial color="#555577" />
      </mesh>
      <SphereObject position={[x - 3, Math.max(0, y), 0]} color="#fc6255" />
    </group>
  );
};

const ShowDropLine: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Range / symmetry ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowRangeBracket: PrimitiveHandler = FallbackOverlay;
const ShowHeightMarker: PrimitiveHandler = FallbackOverlay;
const ShowFlightTimeTimer: PrimitiveHandler = FallbackOverlay;
const HighlightApex: PrimitiveHandler = FallbackOverlay;
const ShowAngleArc: PrimitiveHandler = FallbackOverlay;
const ShowComplementaryAngles: PrimitiveHandler = FallbackOverlay;
const ShowSameRange: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Relative motion / Monkey-Gun ────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowTwoObjects: PrimitiveHandler = () => (
  <group>
    <SphereObject position={[0, 0.5, 0]} color="#fc6255" />
    <SphereObject position={[8, 6, 0.6]} color="#4ade80" />
  </group>
);

const AnimateRelativeMotion: PrimitiveHandler = FallbackOverlay;

const MonkeyGunDrop: PrimitiveHandler = ({ progress }) => {
  const dartX = progress * 8;
  const dartY = progress * 6 - 0.5 * 10 * (progress * 2) ** 2 / 10;
  const monkeyY = 6 - 0.5 * 10 * (progress * 2) ** 2 / 10;
  return (
    <group>
      <SphereObject position={[dartX, Math.max(0, dartY), 0]} color="#fc6255" />
      <SphereObject position={[8, Math.max(0, monkeyY), 0.6]} color="#4ade80" />
    </group>
  );
};

const ShowCommonFrame: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Collision of two projectiles ────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowCollisionPoint: PrimitiveHandler = () => (
  <mesh position={[5, 4, 0]}>
    <sphereGeometry args={[0.4, 32, 32]} />
    <meshStandardMaterial color="#ffd166" emissive="#ffd166" emissiveIntensity={0.6} />
  </mesh>
);

const AnimateCollision: PrimitiveHandler = ({ progress }) => {
  const ax = progress * 5;
  const ay = progress * 8 - 0.5 * 10 * (progress * 1.5) ** 2 / 10;
  const bx = 10 - progress * 5;
  const by = progress * 6 - 0.5 * 10 * (progress * 1.5) ** 2 / 10;
  return (
    <group>
      <SphereObject position={[ax, Math.max(0, ay), 0]} color="#fc6255" />
      <SphereObject position={[bx, Math.max(0, by), 0.6]} color="#58c4dd" />
    </group>
  );
};

const ShowParametricPaths: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Split / Explosion at apex ────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowPreSplitMotion: PrimitiveHandler = ({ progress }) => {
  const x = progress * 6;
  const y = progress * 5 - 0.5 * 10 * (progress * 1.5) ** 2 / 10;
  return <SphereObject position={[x, Math.max(0, y), 0]} color="#fc6255" />;
};

const AnimateSplitExplosion: PrimitiveHandler = ({ progress }) => {
  const f1x = 6 + progress * 4;
  const f1y = 5 - progress * 3;
  const f2x = 6 - progress * 2;
  const f2y = 5 - progress * 5;
  return (
    <group>
      <SphereObject position={[f1x, Math.max(0, f1y), 0]} color="#fc6255" />
      <SphereObject position={[f2x, Math.max(0, f2y), 0.6]} color="#ffd166" />
    </group>
  );
};

const ShowFragmentPaths: PrimitiveHandler = FallbackOverlay;
const MomentumArrowBalance: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Bounce / Restitution ────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const AnimateBounce: PrimitiveHandler = ({ progress }) => {
  const e = 0.7;
  const bounceCount = Math.floor(progress * 4);
  const localP = (progress * 4) % 1;
  const height = Math.pow(e, bounceCount) * 6;
  const y = height * Math.sin(localP * Math.PI);
  return <SphereObject position={[bounceCount * 3, y, 0]} color="#fc6255" />;
};

const ShowRestitutionRatio: PrimitiveHandler = FallbackOverlay;
const ShowEnergyBar: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Wall / Target ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowWall: PrimitiveHandler = () => (
  <mesh position={[7, 2.5, 0]} castShadow>
    <boxGeometry args={[0.3, 5, 3]} />
    <meshStandardMaterial color="#6b6b8a" />
  </mesh>
);

const AnimateWallClear: PrimitiveHandler = ({ progress }) => {
  const x = progress * 14;
  const y = progress * 8 - 0.5 * 10 * (progress * 1.8) ** 2 / 10;
  return (
    <group>
      <mesh position={[7, 2.5, 0]} castShadow>
        <boxGeometry args={[0.3, 5, 3]} />
        <meshStandardMaterial color="#6b6b8a" />
      </mesh>
      <SphereObject position={[x, Math.max(0, y), 0]} color="#fc6255" />
    </group>
  );
};

const ShowTarget: PrimitiveHandler = () => (
  <mesh position={[10, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <torusGeometry args={[0.8, 0.08, 12, 32]} />
    <meshStandardMaterial color="#4ade80" emissive="#4ade80" emissiveIntensity={0.3} />
  </mesh>
);

const AnimateTargetHit: PrimitiveHandler = ({ progress }) => {
  const x = progress * 10;
  const y = progress * 6 - 0.5 * 10 * (progress * 1.6) ** 2 / 10;
  return (
    <group>
      <mesh position={[10, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.8, 0.08, 12, 32]} />
        <meshStandardMaterial color="#4ade80" emissive="#4ade80" emissiveIntensity={0.3} />
      </mesh>
      <SphereObject position={[x, Math.max(0, y), 0]} color="#fc6255" />
    </group>
  );
};

const ShowMinSpeedEnvelope: PrimitiveHandler = FallbackOverlay;

// ---------------------------------------------------------------------------
// ── Piecewise gravity ───────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowGravityBoundary: PrimitiveHandler = () => (
  <mesh position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <planeGeometry args={[30, 30]} />
    <meshStandardMaterial color="#ffd166" transparent opacity={0.15} />
  </mesh>
);

const AnimatePiecewiseMotion: PrimitiveHandler = ({ progress }) => {
  let x, y;
  if (progress < 0.5) {
    const t = progress * 3;
    x = progress * 10;
    y = progress * 12 - 0.5 * 10 * t ** 2 / 10;
  } else {
    const t = (progress - 0.5) * 3;
    x = 5 + (progress - 0.5) * 10;
    y = 5 + (progress - 0.5) * 8 - 0.5 * 5 * t ** 2 / 10;
  }
  return (
    <group>
      <ShowGravityBoundary progress={progress} block={{ start_sec: 0, end_sec: 1, primitive_type: "show_gravity_boundary", camera_view: "", narration: "", overlays: [] }} />
      <SphereObject position={[x, Math.max(0, y), 0]} color="#fc6255" />
    </group>
  );
};

// ---------------------------------------------------------------------------
// ── Math overlays ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ShowEquation: PrimitiveHandler = FallbackOverlay;
const SubstituteValues: PrimitiveHandler = FallbackOverlay;
const DeriveStep: PrimitiveHandler = FallbackOverlay;
const HighlightKeyTerm: PrimitiveHandler = FallbackOverlay;
const ShowReasoningText: PrimitiveHandler = FallbackOverlay;

const FinalAnswer: PrimitiveHandler = () => (
  <group>
    <InclinePlane />
    <SphereObject position={[8.5, 3.66, 0]} color="#fc6255" />
    <SphereObject position={[8.5, 3.66, 0.6]} color="#58c4dd" />
  </group>
);

// ---------------------------------------------------------------------------
// REGISTRY — every known primitive_type must be here.
// Unknown primitive → loud error in TimelinePlayer (never silent).
// ---------------------------------------------------------------------------

export const PRIMITIVE_HANDLERS: Record<string, PrimitiveHandler> = {
  // Universal
  show_setup:                    ShowSetup,
  highlight_object:              HighlightObject,
  label_given_values:            LabelGivenValues,
  freeze_frame:                  FreezeFrame,
  play_raw_motion:               PlayRawMotion,
  slow_motion:                   SlowMotion,
  replay_motion:                 ReplayMotion,

  // Vector decomposition
  split_vector:                  SplitVector,
  draw_velocity_arrow:           DrawVelocityArrow,
  animate_vx_constant:           AnimateVxConstant,
  animate_vy_changing:           AnimateVyChanging,
  show_velocity_at_apex:         ShowVelocityAtApex,
  show_velocity_components_live: ShowVelocityComponentsLive,

  // Coordinate transforms
  rotate_axes:                   RotateAxes,
  show_incline_components:       ShowInclineComponents,
  show_normal_vector:            ShowNormalVector,

  // Incline-specific
  show_shadow_projection:        ShowShadowProjection,
  compare_parallel_motion:       CompareParallelMotion,
  isolate_perpendicular_motion:  IsolatePerpendicularMotion,
  animate_incline_launch:        AnimateInclineLaunch,

  // Height launch
  show_cliff:                    ShowCliff,
  animate_horizontal_throw:      AnimateHorizontalThrow,
  show_drop_line:                ShowDropLine,

  // Range / symmetry
  show_range_bracket:            ShowRangeBracket,
  show_height_marker:            ShowHeightMarker,
  show_flight_time_timer:        ShowFlightTimeTimer,
  highlight_apex:                HighlightApex,
  show_angle_arc:                ShowAngleArc,
  show_complementary_angles:     ShowComplementaryAngles,
  show_same_range:               ShowSameRange,

  // Relative motion / Monkey-Gun
  show_two_objects:              ShowTwoObjects,
  animate_relative_motion:       AnimateRelativeMotion,
  monkey_gun_drop:               MonkeyGunDrop,
  show_common_frame:             ShowCommonFrame,

  // Collision
  show_collision_point:          ShowCollisionPoint,
  animate_collision:             AnimateCollision,
  show_parametric_paths:         ShowParametricPaths,

  // Split / Explosion
  show_pre_split_motion:         ShowPreSplitMotion,
  animate_split_explosion:       AnimateSplitExplosion,
  show_fragment_paths:           ShowFragmentPaths,
  momentum_arrow_balance:        MomentumArrowBalance,

  // Bounce / Restitution
  animate_bounce:                AnimateBounce,
  show_restitution_ratio:        ShowRestitutionRatio,
  show_energy_bar:               ShowEnergyBar,

  // Wall / Target
  show_wall:                     ShowWall,
  animate_wall_clear:            AnimateWallClear,
  show_target:                   ShowTarget,
  animate_target_hit:            AnimateTargetHit,
  show_min_speed_envelope:       ShowMinSpeedEnvelope,

  // Piecewise gravity
  show_gravity_boundary:         ShowGravityBoundary,
  animate_piecewise_motion:      AnimatePiecewiseMotion,

  // Math overlays
  show_equation:                 ShowEquation,
  substitute_values:             SubstituteValues,
  derive_step:                   DeriveStep,
  highlight_key_term:            HighlightKeyTerm,
  show_reasoning_text:           ShowReasoningText,
  final_answer:                  FinalAnswer,
};
