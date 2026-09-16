import { describe, expect, it } from 'vitest';
import {
  cameraAt,
  cameraFrame,
  clampBoardZoom,
  defaultCameraView,
  nextBoardZoom,
} from './camera';

describe('board camera', () => {
  it('uses predictable stepped zoom levels and clamps imported values', () => {
    expect(nextBoardZoom(1, 1)).toBe(1.25);
    expect(nextBoardZoom(1, -1)).toBe(0.75);
    expect(nextBoardZoom(1.5, 1)).toBe(1.5);
    expect(clampBoardZoom(99)).toBe(1.5);
    expect(clampBoardZoom(0.01)).toBe(0.6);
  });

  it('replays the last camera keyframe at or before the requested time', () => {
    const fallback = defaultCameraView(1200, 800);
    const track = [
      cameraFrame(fallback, 0, 'initial'),
      cameraFrame({ ...fallback, scale: 1.25, centerX: 720 }, 300, 'zoom'),
      cameraFrame({ ...fallback, scale: 1.5, centerX: 840 }, 700, 'pan'),
    ];

    expect(cameraAt(track, 299, fallback)).toMatchObject({ scale: 1, centerX: 600 });
    expect(cameraAt(track, 300, fallback)).toMatchObject({ scale: 1.25, centerX: 720 });
    expect(cameraAt(track, 999, fallback)).toMatchObject({ scale: 1.5, centerX: 840 });
  });
});
