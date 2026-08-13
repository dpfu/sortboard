import type { PersistedCardV1, PersistedClosedContainerV1, PersistedStackV1, SetupSnapshotV1 } from './persist';
import type { SortConfig } from './types';

export const MAX_SETUP_UNDO_SNAPSHOTS = 50;

function isSortConfigEqual(a: SortConfig, b: SortConfig) {
  return a.type === b.type && a.columns === b.columns;
}

function isCardEqual(a: PersistedCardV1, b: PersistedCardV1) {
  const aTags = a.meta?.tags || [];
  const bTags = b.meta?.tags || [];
  if (aTags.length !== bTags.length) return false;
  for (let i = 0; i < aTags.length; i += 1) {
    if (aTags[i] !== bTags[i]) return false;
  }
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    (a.createdAt || 0) === (b.createdAt || 0) &&
    (a.sizeScale || 1) === (b.sizeScale || 1) &&
    (a.stackId || '') === (b.stackId || '') &&
    (a.stackOrder ?? -1) === (b.stackOrder ?? -1) &&
    (a.closedContainerId || '') === (b.closedContainerId || '') &&
    (a.closedContainerOrder ?? -1) === (b.closedContainerOrder ?? -1) &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.assetId === b.assetId &&
    (a.meta?.name || '') === (b.meta?.name || '') &&
    (a.meta?.notes || '') === (b.meta?.notes || '') &&
    (a.meta?.frontText || '') === (b.meta?.frontText || '') &&
    (a.meta?.color || '') === (b.meta?.color || '') &&
    (a.meta?.aspectRatio || 0) === (b.meta?.aspectRatio || 0)
  );
}

function isStackEqual(a: PersistedStackV1, b: PersistedStackV1) {
  return a.id === b.id && a.name === b.name && a.createdAt === b.createdAt;
}

function isClosedContainerEqual(a: PersistedClosedContainerV1, b: PersistedClosedContainerV1) {
  if (a.id !== b.id || a.kind !== b.kind || a.name !== b.name || a.createdAt !== b.createdAt) return false;
  if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return false;
  if (a.layout !== b.layout) return false;
  if (a.kind === 'source' && b.kind === 'source') return true;
  if (a.kind !== 'target' || b.kind !== 'target') return false;
  if (a.rowOrder !== b.rowOrder) return false;
  const aTags = a.allowedTags || [];
  const bTags = b.allowedTags || [];
  if (a.description !== b.description) return false;
  if (a.visibleInSort !== b.visibleInSort) return false;
  if (a.capacityMode !== b.capacityMode) return false;
  if ((a.capacity ?? -1) !== (b.capacity ?? -1)) return false;
  if (aTags.length !== bTags.length) return false;
  for (let i = 0; i < aTags.length; i += 1) {
    if (aTags[i] !== bTags[i]) return false;
  }
  return true;
}

export function isSetupSnapshotEqual(a: SetupSnapshotV1, b: SetupSnapshotV1) {
  if ((a.cardLayoutMode || 'as-is') !== (b.cardLayoutMode || 'as-is')) return false;
  if (!isSortConfigEqual(a.sortConfig, b.sortConfig)) return false;
  const aStacks = a.stacks || [];
  const bStacks = b.stacks || [];
  if (aStacks.length !== bStacks.length) return false;
  for (let i = 0; i < aStacks.length; i += 1) {
    if (!isStackEqual(aStacks[i], bStacks[i])) return false;
  }
  const aClosedContainers = a.closedContainers || [];
  const bClosedContainers = b.closedContainers || [];
  if (aClosedContainers.length !== bClosedContainers.length) return false;
  for (let i = 0; i < aClosedContainers.length; i += 1) {
    if (!isClosedContainerEqual(aClosedContainers[i], bClosedContainers[i])) return false;
  }
  if (a.cards.length !== b.cards.length) return false;
  for (let i = 0; i < a.cards.length; i += 1) {
    if (!isCardEqual(a.cards[i], b.cards[i])) return false;
  }
  return true;
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
