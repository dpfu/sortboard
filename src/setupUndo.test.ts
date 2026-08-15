import { describe, expect, it } from 'vitest';
import type { SetupSnapshotV1 } from './persist';
import {
  MAX_SETUP_UNDO_SNAPSHOTS,
  appendSetupSnapshot,
  isEditableTarget,
  isSetupSnapshotEqual,
} from './setupUndo';

describe('setup undo helpers', () => {
  const base: SetupSnapshotV1 = {
    cardLayoutMode: 'as-is',
    sortConfig: { type: 'open' },
    stacks: [],
    workflow: { templateId: 'open', stages: [], widgets: [] },
    cards: [
      {
        id: 'c1',
        kind: 'text',
        createdAt: 1,
        meta: { name: 'Card 1', notes: '', tags: [], frontText: 'Card 1', color: 'slate' },
        x: 10,
        y: 20,
        z: 1,
      },
    ],
  };

  it('detects equal snapshots', () => {
    const clone = structuredClone(base);
    expect(isSetupSnapshotEqual(base, clone)).toBe(true);
  });

  it('dedupes when appending identical snapshot', () => {
    const past = [base];
    const next = appendSetupSnapshot(past, structuredClone(base));
    expect(next).toBe(past);
  });

  it('appends when snapshot changes', () => {
    const past = [base];
    const next = appendSetupSnapshot(past, {
      ...structuredClone(base),
      cards: base.cards.map((card) => ({ ...card, x: card.x + 1 })),
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

  it('detects workflow, active-stage, and widget-assignment changes', () => {
    const a: SetupSnapshotV1 = {
      ...structuredClone(base),
      sortConfig: { type: 'closed' },
      workflow: {
        templateId: 'closed',
        stages: [{ id: 'closed-stage', kind: 'closed-sort', name: 'Closed sort', order: 0 }],
        widgets: [
          {
            id: 'source-1',
            kind: 'source',
            stageId: 'closed-stage',
            title: 'Source',
            createdAt: 1,
            x: 0,
            y: 0,
            w: 200,
            h: 200,
            z: 1,
            layout: 'stack',
          },
        ],
      },
      activeStageId: 'closed-stage',
      cards: base.cards.map((card) => ({
        ...card,
        widgetAssignments: {
          'closed-stage': { widgetId: 'source-1', zoneId: 'content', order: 0 },
        },
      })),
    };
    const workflowChanged = structuredClone(a);
    const sourceWidget = workflowChanged.workflow.widgets[0];
    if (sourceWidget?.kind !== 'source') throw new Error('Expected source widget fixture');
    sourceWidget.layout = 'fan';
    const stageChanged = { ...structuredClone(a), activeStageId: 'another-stage' };
    const assignmentChanged = structuredClone(a);
    assignmentChanged.cards[0].widgetAssignments!['closed-stage']!.order = 1;

    expect(isSetupSnapshotEqual(a, workflowChanged)).toBe(false);
    expect(isSetupSnapshotEqual(a, stageChanged)).toBe(false);
    expect(isSetupSnapshotEqual(a, assignmentChanged)).toBe(false);
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
