import { describe, expect, it } from 'vitest';
import { boardKeyboardTestUtils } from './Board';
import type { CardData } from './types';
import type { StageSurfaceScene } from './stageSurface';

const card: CardData = {
  id: 'card-one',
  kind: 'text',
  createdAt: 1,
  meta: { name: 'First idea', notes: '', tags: [] },
  x: 40,
  y: 60,
  z: 1,
};

const closedScene: StageSurfaceScene = {
  stageKind: 'closed-sort',
  canvasW: 1000,
  canvasH: 700,
  viewportX: 0,
  surfaces: [
    {
      kind: 'work-area',
      stageKind: 'closed-sort',
      surfaceId: 'source-surface',
      widgetId: 'source',
      title: 'Cards',
      count: 1,
      x: 20,
      y: 20,
      w: 500,
      h: 650,
    },
    {
      kind: 'sink',
      stageKind: 'closed-sort',
      surfaceId: 'category-a-surface',
      widgetId: 'category-a',
      zoneId: 'content',
      title: 'Relevant',
      count: 0,
      x: 560,
      y: 20,
      w: 400,
      h: 300,
    },
    {
      kind: 'sink',
      stageKind: 'closed-sort',
      surfaceId: 'category-b-surface',
      widgetId: 'category-b',
      zoneId: 'content',
      title: 'Not relevant',
      count: 0,
      x: 560,
      y: 350,
      w: 400,
      h: 300,
    },
  ],
};

describe('Board keyboard target navigation', () => {
  it('selects the closest valid-direction Closed target', () => {
    const targets = boardKeyboardTestUtils.keyboardDropTargets(closedScene);
    expect(boardKeyboardTestUtils.targetContainingCard(targets, card, 200, 120)?.label).toBe('Cards');
    expect(boardKeyboardTestUtils.nextKeyboardDropTarget(targets, card, 200, 120, 'right')?.label).toBe('Relevant');
    expect(boardKeyboardTestUtils.nextKeyboardDropTarget(targets, card, 200, 120, 'left')).toBeNull();
  });

  it('skips a full Q bucket when choosing the next area', () => {
    const qScene: StageSurfaceScene = {
      stageKind: 'qsort',
      canvasW: 1200,
      canvasH: 700,
      viewportX: 0,
      surfaces: [
        {
          kind: 'qsort-stage',
          surfaceId: 'q-stage',
          widgetId: 'qsort',
          title: 'Distribution',
          count: 1,
          x: 0,
          y: 0,
          w: 1200,
          h: 700,
          leftColumnRect: { x: 20, y: 20, w: 260, h: 650 },
          distributionRect: { x: 320, y: 20, w: 840, h: 650 },
          baselineY: 500,
          lanes: [
            { zoneId: 'lane', label: 'Uncertain', x: 20, y: 20, w: 260, h: 300, count: 1 },
            { zoneId: 'other-lane', label: 'Certain', x: 20, y: 350, w: 260, h: 300, count: 0 },
          ],
          buckets: [
            {
              zoneId: 'full',
              label: '-1',
              x: 320,
              y: 20,
              w: 200,
              h: 600,
              count: 1,
              capacity: 1,
              capacityLabel: '1 / 1',
              slots: [],
              columnHeight: 200,
              baselineY: 500,
              isCenter: false,
              isExtreme: true,
            },
            {
              zoneId: 'open',
              label: '0',
              x: 560,
              y: 20,
              w: 200,
              h: 600,
              count: 0,
              capacity: 1,
              capacityLabel: '0 / 1',
              slots: [],
              columnHeight: 200,
              baselineY: 500,
              isCenter: true,
              isExtreme: false,
            },
          ],
        },
      ],
    };
    const qCard = { ...card, x: 40, y: 80 };
    const targets = boardKeyboardTestUtils.keyboardDropTargets(qScene);
    expect(boardKeyboardTestUtils.nextKeyboardDropTarget(targets, qCard, 200, 120, 'right')?.label).toBe('0');
  });
});
