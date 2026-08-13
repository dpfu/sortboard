import { describe, expect, it } from 'vitest';
import {
  MAX_SETUP_UNDO_SNAPSHOTS,
  appendSetupSnapshot,
  isEditableTarget,
  isSetupSnapshotEqual,
} from './setupUndo';

describe('setup undo helpers', () => {
  const base = {
    sortConfig: { type: 'open' as const, columns: 3 },
    cards: [{ id: 'c1', kind: 'text' as const, x: 10, y: 20, z: 1 }],
  };

  it('detects equal snapshots', () => {
    const clone = {
      sortConfig: { ...base.sortConfig },
      cards: base.cards.map((c) => ({ ...c })),
    };
    expect(isSetupSnapshotEqual(base, clone)).toBe(true);
  });

  it('dedupes when appending identical snapshot', () => {
    const past = [base];
    const next = appendSetupSnapshot(past, {
      sortConfig: { ...base.sortConfig },
      cards: base.cards.map((c) => ({ ...c })),
    });
    expect(next).toBe(past);
  });

  it('appends when snapshot changes', () => {
    const past = [base];
    const next = appendSetupSnapshot(past, {
      sortConfig: { type: 'closed', columns: 3 },
      cards: base.cards.map((c) => ({ ...c })),
    });
    expect(next).toHaveLength(2);
  });

  it('keeps only the most recent setup actions', () => {
    let past: Parameters<typeof appendSetupSnapshot>[0] = [];
    for (let index = 0; index < MAX_SETUP_UNDO_SNAPSHOTS + 5; index += 1) {
      past = appendSetupSnapshot(past, {
        ...base,
        cards: [{ ...base.cards[0], x: index }],
      });
    }

    expect(past).toHaveLength(MAX_SETUP_UNDO_SNAPSHOTS);
    expect(past[0].cards[0].x).toBe(5);
    expect(past.at(-1)?.cards[0].x).toBe(MAX_SETUP_UNDO_SNAPSHOTS + 4);
  });

  it('treats closed container layout changes as setup changes', () => {
    const a = {
      sortConfig: { type: 'closed' as const, columns: 3 },
      closedContainers: [
        { id: 'source-1', kind: 'source' as const, name: 'Source', createdAt: 1, x: 0, y: 0, w: 200, h: 200, layout: 'stack' as const },
      ],
      cards: [{ id: 'c1', kind: 'text' as const, x: 10, y: 20, z: 1 }],
    };
    const b = {
      ...a,
      closedContainers: [
        { ...a.closedContainers[0], layout: 'fan' as const },
      ],
    };
    expect(isSetupSnapshotEqual(a, b)).toBe(false);
  });

  it('detects editable targets', () => {
    const OriginalHTMLElement = (globalThis as any).HTMLElement;
    class MockElement {}

    try {
      (globalThis as any).HTMLElement = MockElement;

      const input = Object.assign(new MockElement(), { tagName: 'INPUT', isContentEditable: false });
      const div = Object.assign(new MockElement(), { tagName: 'DIV', isContentEditable: true });
      const plain = Object.assign(new MockElement(), { tagName: 'DIV', isContentEditable: false });

      expect(isEditableTarget(input as unknown as EventTarget)).toBe(true);
      expect(isEditableTarget(div as unknown as EventTarget)).toBe(true);
      expect(isEditableTarget(plain as unknown as EventTarget)).toBe(false);
      expect(isEditableTarget(null)).toBe(false);
    } finally {
      (globalThis as any).HTMLElement = OriginalHTMLElement;
    }
  });
});
