import { CameraViewConfig } from "./types";

export const CAMERA_VIEWS: Record<string, CameraViewConfig> = {
  wide_incline: {
    position: [0, 8, 25],
    target: [0, 2, 0],
    fov: 45,
  },
  collision_view: {
    position: [5, 5, 15],
    target: [2, 1, 0],
    fov: 40,
  },
  axis_view: {
    position: [0, 5, 20],
    target: [0, 2, 0],
    fov: 45,
  },
  vector_view: {
    position: [-2, 4, 12],
    target: [0, 1, 0],
    fov: 35,
  },
  parallel_motion_view: {
    position: [0, 5, 20],
    target: [2, 1, 0],
    fov: 45,
  },
  perpendicular_view: {
    position: [15, 5, 0],
    target: [0, 2, 0],
    fov: 40,
  },
  equation_view: {
    position: [0, 5, 20],
    target: [0, 2, 0],
    fov: 45,
  },
  final_view: {
    position: [0, 6, 22],
    target: [0, 2, 0],
    fov: 45,
  },
  height_view: {
    position: [-10, 8, 20],
    target: [-2, 3, 0],
    fov: 45,
  },
  top_down: {
    position: [5, 20, 0.1],
    target: [5, 0, 0],
    fov: 50,
  },
  close_up: {
    position: [0, 3, 8],
    target: [0, 1, 0],
    fov: 35,
  },
};

export const DEFAULT_CAMERA_VIEW: CameraViewConfig = {
  position: [0, 8, 25],
  target: [0, 2, 0],
  fov: 45,
};
