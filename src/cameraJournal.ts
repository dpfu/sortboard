import type { CameraKeyframe, RecordingSession } from './types';

type CameraJournal = { from: number; frames: CameraKeyframe[] };
const key = (boardId: string, sessionId: string) => `sortboard.pending-camera.v1:${boardId}:${sessionId}`;

function read(boardId: string, sessionId: string): CameraJournal | null {
  try {
    const raw = window.sessionStorage.getItem(key(boardId, sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as CameraJournal;
    if (!Number.isInteger(value.from) || value.from < 0 || !Array.isArray(value.frames)) return null;
    if (!value.frames.every(frame => frame &&
      [frame.tMs, frame.scale, frame.centerX, frame.centerY, frame.viewportW, frame.viewportH].every(Number.isFinite) &&
      frame.tMs >= 0 && frame.scale > 0 && frame.viewportW > 0 && frame.viewportH > 0 &&
      ['initial', 'pan', 'zoom', 'resize'].includes(frame.source))) return null;
    return value;
  } catch { return null; }
}

// Only the not-yet-checkpointed tail is copied synchronously, never the full recording.
// If storage is unavailable, the caller must retain eager IndexedDB saving.
export function journalCameraTrack(boardId: string, recording: RecordingSession, from: number) {
  try {
    const previous = read(boardId, recording.createdAt);
    const start = Math.min(previous?.from ?? from, from);
    window.sessionStorage.setItem(key(boardId, recording.createdAt), JSON.stringify({
      from: start, frames: recording.cameraTrack?.slice(start) || [],
    } satisfies CameraJournal));
    return true;
  } catch { return false; }
}

export function discardCameraJournal(boardId: string, sessionId: string) {
  try { window.sessionStorage.removeItem(key(boardId, sessionId)); } catch { /* Storage may be disabled. */ }
}

export function acknowledgeCameraTrack(boardId: string, recording: RecordingSession) {
  const journal = read(boardId, recording.createdAt);
  if (!journal) return;
  const track = recording.cameraTrack || [];
  const count = Math.min(journal.frames.length, Math.max(0, track.length - journal.from));
  // A completed older write must not erase frames captured while it was in flight.
  const fields: Array<keyof CameraKeyframe> = ['tMs', 'scale', 'centerX', 'centerY', 'viewportW', 'viewportH', 'source'];
  if (!count || !journal.frames.slice(0, count).every((frame, i) =>
    fields.every(field => frame[field] === track[journal.from + i][field]))) return;
  try {
    if (count === journal.frames.length) discardCameraJournal(boardId, recording.createdAt);
    else window.sessionStorage.setItem(key(boardId, recording.createdAt), JSON.stringify({
      from: journal.from + count, frames: journal.frames.slice(count),
    } satisfies CameraJournal));
  } catch { /* The existing journal remains safe to replay. */ }
}

export function recoverCameraTrack(boardId: string, recording: RecordingSession): RecordingSession {
  const journal = read(boardId, recording.createdAt);
  const track = recording.cameraTrack || [];
  if (!journal || journal.from > track.length || journal.from + journal.frames.length <= track.length) return recording;
  return { ...recording, cameraTrack: [...track, ...journal.frames.slice(track.length - journal.from)] };
}
