export type BeatVisualLabel = {
  target_id: string;
  text: string;
  math?: string;
  placement?: string;
  priority?: number;
};

export type BeatVisualSpec = {
  schema_version: number;
  family: string;
  engine_case: string;
  step_id: string;
  beat: string;
  student_text?: string;
  must_show?: string[];
  must_not_show?: string[];
  labels?: BeatVisualLabel[];
  renderer_hints?: {
    svg_template?: string;
    camera?: string;
    layout_mode?: string;
    label_strategy?: string;
  };
  render_primitives?: Array<{
    type?: string;
    target_id?: string;
    required?: boolean;
    [key: string]: unknown;
  }>;
  checks?: Array<Record<string, unknown>>;
  director?: {
    selected_family?: string;
    selection_source?: string;
    warnings?: string[];
  };
};

export type VisualContractStoryboardStep = {
  beat_visual_spec?: BeatVisualSpec;
};

export function contractForStep<T extends VisualContractStoryboardStep | null | undefined>(step: T): BeatVisualSpec | null {
  const spec = step?.beat_visual_spec;
  return spec && typeof spec === "object" ? spec : null;
}

export function contractLabelsForTarget(spec: BeatVisualSpec | null, targetId: string) {
  if (!spec?.labels?.length) return undefined;
  const exact = spec.labels.find(label => label.target_id === targetId);
  if (exact?.text) return exact.text;
  const patterns = sceneIdToVectorPatternsForContract(targetId);
  const semantic = spec.labels.find(label => {
    const labelPatterns = sceneIdToVectorPatternsForContract(label.target_id);
    return labelPatterns.some(pattern => patterns.includes(pattern));
  });
  return semantic?.text;
}

export function contractForbids(spec: BeatVisualSpec | null, id: string) {
  return Boolean(spec?.must_not_show?.includes(id));
}

export function sceneIdToVectorPatternsForContract(id: string) {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return [];
  if (normalized === "velocity:x_component" || normalized === "velocity:horizontal_component") return ["*:vx"];
  if (normalized === "velocity:y_component" || normalized === "velocity:vertical_component") return ["*:vy"];
  if (normalized === "velocity:impact_x_component") return ["*:vx"];
  if (normalized === "velocity:impact_y_component") return ["*:vy"];
  if (normalized === "velocity:impact" || normalized === "velocity:resultant") return ["*:v"];
  if (normalized.includes("vx") || normalized.includes("ux")) return ["*:vx"];
  if (normalized.includes("vy") || normalized.includes("uy")) return ["*:vy"];
  if (normalized.startsWith("*:")) return [normalized];
  return [id];
}
