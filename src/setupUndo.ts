import type { SetupSnapshotV1 } from './persist';

export const MAX_SETUP_UNDO_SNAPSHOTS = 50;

function isStructurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => isStructurallyEqual(value, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined).sort();
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key, index) => key === bKeys[index] && isStructurallyEqual(aRecord[key], bRecord[key])
  );
}

export function isSetupSnapshotEqual(a: SetupSnapshotV1, b: SetupSnapshotV1) {
  return isStructurallyEqual(a, b);
}

export function appendSetupSnapshot(past: SetupSnapshotV1[], next: SetupSnapshotV1) {
  const last = past[past.length - 1];
  if (last && isSetupSnapshotEqual(last, next)) return past;
  const appended = [...past, next];
  return appended.length > MAX_SETUP_UNDO_SNAPSHOTS
    ? appended.slice(-MAX_SETUP_UNDO_SNAPSHOTS)
    : appended;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
