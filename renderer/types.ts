export interface TimelineBlock {
  start_sec: number;
  end_sec: number;
  primitive_type: string;
  camera_view: string;
  narration: string;
  overlays: string[];
}

export interface TimelineData {
  timeline: TimelineBlock[];
}

export interface CameraViewConfig {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}
