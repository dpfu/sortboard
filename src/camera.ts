import type { CameraKeyframe, CameraFrameSource } from './types';
import { clamp } from './utils';

export const BOARD_ZOOM_LEVELS = [0.6, 0.75, 1, 1.25, 1.5] as const;
export const BOARD_ZOOM_MIN = BOARD_ZOOM_LEVELS[0];
export const BOARD_ZOOM_MAX = BOARD_ZOOM_LEVELS[BOARD_ZOOM_LEVELS.length - 1];

export type CameraView = Omit<CameraKeyframe, 'tMs' | 'source'>;

export function boardPanGutter(width: number, height: number) {
  return { x: Math.max(1600, width), y: Math.max(1600, height) };
}

export function clampBoardZoom(scale: number) {
  return clamp(scale, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX);
}

export function nextBoardZoom(scale: number, direction: -1 | 1) {
  const epsilon = 0.001;
  if (direction < 0) {
    return [...BOARD_ZOOM_LEVELS].reverse().find((level) => level < scale - epsilon) ?? BOARD_ZOOM_MIN;
  }
  return BOARD_ZOOM_LEVELS.find((level) => level > scale + epsilon) ?? BOARD_ZOOM_MAX;
}

export function defaultCameraView(viewportW: number, viewportH: number): CameraView {
  const safeW = Math.max(1, Math.round(viewportW));
  const safeH = Math.max(1, Math.round(viewportH));
  return {
    scale: 1,
    centerX: safeW / 2,
    centerY: safeH / 2,
    viewportW: safeW,
    viewportH: safeH,
  };
}

export function cameraAt(
  track: CameraKeyframe[] | undefined,
  tMs: number,
  fallback: CameraView
): CameraView {
  if (!track?.length) return fallback;
  const t = Math.max(0, tMs);
  let frame = track[0];
  for (let index = 1; index < track.length; index += 1) {
    if (track[index].tMs > t) break;
    frame = track[index];
  }
  return {
    scale: clampBoardZoom(frame.scale),
    centerX: frame.centerX,
    centerY: frame.centerY,
    viewportW: Math.max(1, frame.viewportW),
    viewportH: Math.max(1, frame.viewportH),
  };
}

export function cameraFrame(
  view: CameraView,
  tMs: number,
  source: CameraFrameSource
): CameraKeyframe {
  return {
    tMs: Math.max(0, Math.round(tMs)),
    scale: clampBoardZoom(view.scale),
    centerX: Math.round(view.centerX * 100) / 100,
    centerY: Math.round(view.centerY * 100) / 100,
    viewportW: Math.max(1, Math.round(view.viewportW)),
    viewportH: Math.max(1, Math.round(view.viewportH)),
    source,
  };
}

export function cameraFramesEqual(a: CameraKeyframe | undefined, b: CameraKeyframe) {
  if (!a) return false;
  return (
    Math.abs(a.scale - b.scale) < 0.001 &&
    Math.abs(a.centerX - b.centerX) < 0.5 &&
    Math.abs(a.centerY - b.centerY) < 0.5 &&
    a.viewportW === b.viewportW &&
    a.viewportH === b.viewportH
  );
}
