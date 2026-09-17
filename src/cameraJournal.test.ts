/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeCameraTrack, discardCameraJournal, journalCameraTrack, recoverCameraTrack } from './cameraJournal';
import { cameraFrame, defaultCameraView } from './camera';
import type { RecordingSession } from './types';

const frames = Array.from({ length: 8 }, (_, i) => cameraFrame({ ...defaultCameraView(1200, 800), centerX: 600 + i * 20 }, i * 30, i ? 'pan' : 'initial'));
const recording = (count: number) => ({ createdAt: 'session-a', cameraTrack: frames.slice(0, count) } as RecordingSession);

beforeEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe('camera recovery journal', () => {
  it('recovers every pending point after an interrupted checkpoint without duplicating saved points', () => {
    expect(journalCameraTrack('board-a', recording(3), 1)).toBe(true);
    expect(journalCameraTrack('board-a', recording(5), 3)).toBe(true);
    expect(recoverCameraTrack('board-a', recording(1)).cameraTrack).toEqual(frames.slice(0, 5));
    expect(recoverCameraTrack('board-a', recording(3)).cameraTrack).toEqual(frames.slice(0, 5));
    const newer = recording(7);
    expect(recoverCameraTrack('board-a', newer)).toBe(newer);
  });

  it('keeps points captured while an older checkpoint is in flight', () => {
    journalCameraTrack('board-a', recording(3), 1);
    const inFlight = recording(3);
    journalCameraTrack('board-a', recording(6), 3);
    acknowledgeCameraTrack('board-a', inFlight);
    expect(recoverCameraTrack('board-a', inFlight).cameraTrack).toEqual(frames.slice(0, 6));
    expect(JSON.parse(window.sessionStorage.getItem(window.sessionStorage.key(0)!)!).frames).toHaveLength(3);
    acknowledgeCameraTrack('board-a', recording(6));
    expect(window.sessionStorage.length).toBe(0);
  });

  it('isolates boards and sessions and discards only the requested recording', () => {
    journalCameraTrack('board-a', recording(3), 1);
    journalCameraTrack('board-b', recording(4), 1);
    const otherSession = { ...recording(5), createdAt: 'session-b' };
    journalCameraTrack('board-a', otherSession, 1);
    discardCameraJournal('board-a', 'session-a');
    expect(recoverCameraTrack('board-a', recording(1)).cameraTrack).toHaveLength(1);
    expect(recoverCameraTrack('board-b', recording(1)).cameraTrack).toHaveLength(4);
    expect(recoverCameraTrack('board-a', { ...recording(1), createdAt: 'session-b' }).cameraTrack).toHaveLength(5);
  });

  it('signals that writes must stay eager when synchronous recovery storage is unavailable', () => {
    vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(journalCameraTrack('board-a', recording(3), 1)).toBe(false);
  });

  it('does not acknowledge mismatching data or apply corrupt journal entries', () => {
    journalCameraTrack('board-a', recording(3), 1);
    acknowledgeCameraTrack('board-a', { ...recording(3), cameraTrack: frames.slice(0, 3).map(f => ({ ...f, centerX: 0 })) });
    expect(recoverCameraTrack('board-a', recording(1)).cameraTrack).toHaveLength(3);
    const storageKey = window.sessionStorage.key(0)!;
    for (const value of ['not json', '{"from":-1,"frames":[]}', '{"from":1,"frames":[{"tMs":null}]}']) {
      window.sessionStorage.setItem(storageKey, value);
      const base = recording(1);
      expect(recoverCameraTrack('board-a', base)).toBe(base);
    }
  });
});
