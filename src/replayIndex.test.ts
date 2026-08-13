import { describe, expect, it } from 'vitest';
import type { CardData, RecordingSession, SortWorkflowData } from './types';
import { buildReplayIndex, replayCardsAt, replayStageIdAt } from './replayIndex';

const workflow: SortWorkflowData = {
  templateId: 'qsort',
  stages: [
    { id: 'pre', kind: 'presort', name: 'Pre-Sort', order: 0 },
    { id: 'q', kind: 'qsort', name: 'Q-Sort', order: 1 },
  ],
  widgets: [],
};

const startCard: CardData = {
  id: 'card-1',
  kind: 'text',
  createdAt: 1,
  meta: { name: 'Card 1', notes: '', tags: [], frontText: 'Card 1' },
  widgetAssignments: { pre: { widgetId: 'source', zoneId: 'content', order: 0 } },
  x: 0,
  y: 0,
  z: 1,
};

function recording(): RecordingSession {
  return {
    version: 5,
    createdAt: '2026-08-13T00:00:00.000Z',
    cardW: 200,
    cardH: 120,
    boardW: 1000,
    boardH: 700,
    sortConfig: { type: 'qsort' },
    workflowAtStart: workflow,
    activeStageIdAtStart: 'pre',
    closedContainersAtStart: [],
    cardsAtStart: [startCard],
    // Intentionally out of input order and with non-monotone t1 values. The
    // index owns chronological ordering for both poses and discrete state.
    segments: [
      {
        type: 'drag',
        id: 'later-start-earlier-drop',
        cardId: 'card-1',
        t0: 20,
        t1: 40,
        from: { x: 20, y: 0 },
        path: [[20, 20, 0]],
        drop: { x: 40, y: 0 },
        final: { x: 40, y: 0 },
        widgetAssignmentChanges: [
          { cardId: 'card-1', stageId: 'pre' },
          { cardId: 'card-1', stageId: 'q', assignment: { widgetId: 'qsort', zoneId: 'bucket-1', order: 0 } },
        ],
      },
      {
        type: 'stage-transition',
        id: 'transition',
        fromStageId: 'pre',
        toStageId: 'q',
        t0: 50,
        t1: 50,
        members: [],
      },
      {
        type: 'drag',
        id: 'early-start-later-drop',
        cardId: 'card-1',
        t0: 10,
        t1: 70,
        from: { x: 0, y: 0 },
        path: [[10, 0, 0]],
        drop: { x: 20, y: 0 },
        final: { x: 20, y: 0 },
        widgetAssignmentChanges: [
          { cardId: 'card-1', stageId: 'pre', assignment: { widgetId: 'presort', zoneId: 'plus', order: 0 } },
        ],
      },
    ],
  };
}

describe('replay index discrete state', () => {
  it('indexes assignment and stage events by their application time', () => {
    const session = recording();
    const index = buildReplayIndex(session);

    expect(replayCardsAt(session, index, 0)).toBe(session.cardsAtStart);
    expect(replayCardsAt(session, index, 39)[0]?.widgetAssignments?.pre?.widgetId).toBe('source');

    const atFirstDrop = replayCardsAt(session, index, 40)[0]!;
    expect(atFirstDrop.widgetAssignments?.pre).toBeUndefined();
    expect(atFirstDrop.widgetAssignments?.q?.zoneId).toBe('bucket-1');
    expect(replayStageIdAt(session, index, 49)).toBe('pre');
    expect(replayStageIdAt(session, index, 50)).toBe('q');

    const afterLaterDrop = replayCardsAt(session, index, 70)[0]!;
    expect(afterLaterDrop.widgetAssignments?.pre?.zoneId).toBe('plus');
    expect(afterLaterDrop.widgetAssignments?.q?.zoneId).toBe('bucket-1');
  });
});
