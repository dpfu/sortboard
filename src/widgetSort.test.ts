import { describe, expect, it } from 'vitest';
import type {
  CardData,
  PreSortWidgetData,
  QSortWidgetData,
  SortWorkflowData,
  SourceWidgetData,
} from './types';
import {
  WIDGET_ZONE_CONTENT,
  createWorkflowForTemplate,
  getQSortWidget,
} from './workflow';
import {
  assignCardsToWidgetZone,
  assignCardToQSortZone,
  assignUnassignedCardsToWidgetZone,
  countCardsInWidgetZone,
  getMinimumWidgetSize,
  getQSortBucketCardSlots,
  isStageComplete,
  seedStageAssignments,
  transitionPreSortToQSort,
} from './widgetSort';

function makeCard(id: string): CardData {
  return {
    id,
    kind: 'text',
    createdAt: 1,
    x: 0,
    y: 0,
    z: 1,
    meta: {
      name: id,
      notes: '',
      tags: [],
      frontText: id,
      color: 'slate',
    },
  };
}

describe('widgetSort workflow helpers', () => {
  it('keeps fixed Q-Sort places when removing cards and fills holes without moving their neighbours', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 12);
    const stageId = workflow.stages.find(stage => stage.kind === 'qsort')!.id;
    const widget = getQSortWidget(workflow, stageId)!;
    const bucket = widget.buckets[3];
    bucket.capacity = 4;
    let cards = seedStageAssignments(['a', 'b', 'c', 'd'].map(makeCard), stageId, widget.id, widget.lanes[0].id);
    for (const id of ['a', 'b', 'c']) cards = assignCardToQSortZone(cards, stageId, widget, bucket.id, id);
    const first = cards.find(card => card.id === 'a')!.widgetAssignments![stageId];
    const third = cards.find(card => card.id === 'c')!.widgetAssignments![stageId];
    cards = assignCardToQSortZone(cards, stageId, widget, widget.lanes[0].id, 'b');
    expect([...getQSortBucketCardSlots(cards, stageId, widget.id, bucket.id, bucket.capacity)]).toEqual([['a', 0], ['c', 2]]);
    cards = assignCardToQSortZone(cards, stageId, widget, bucket.id, 'd');
    expect(cards.find(card => card.id === 'a')!.widgetAssignments![stageId]).toEqual(first);
    expect(cards.find(card => card.id === 'c')!.widgetAssignments![stageId]).toEqual(third);
    expect(cards.find(card => card.id === 'd')!.widgetAssignments![stageId]?.slotIndex).toBe(1);
    expect(assignCardToQSortZone(cards, stageId, widget, bucket.id, 'c')).toBe(cards);
    // An explicit empty place can also be chosen within the same column.
    cards = assignCardToQSortZone(cards, stageId, widget, bucket.id, 'd', 3);
    expect(cards.find(card => card.id === 'd')!.widgetAssignments![stageId]?.slotIndex).toBe(3);
    expect(cards.find(card => card.id === 'c')!.widgetAssignments![stageId]).toEqual(third);
  });

  it('pins the visible positions in a resumed older Q-Sort before removing a card', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 12);
    const stageId = workflow.stages.find(stage => stage.kind === 'qsort')!.id;
    const widget = getQSortWidget(workflow, stageId)!;
    const bucket = widget.buckets.find(entry => entry.capacity >= 3)!;
    const cards = ['a', 'b', 'c'].map((id, order) => ({ ...makeCard(id), widgetAssignments: {
      [stageId]: { widgetId: widget.id, zoneId: bucket.id, order },
    } }));
    const moved = assignCardToQSortZone(cards, stageId, widget, widget.lanes[0].id, 'b');
    expect([...getQSortBucketCardSlots(moved, stageId, widget.id, bucket.id, bucket.capacity)]).toEqual([['a', 0], ['c', 2]]);
    expect(cards.every(card => !('slotIndex' in card.widgetAssignments[stageId]))).toBe(true);
  });

  it('transitions cards from pre-sort zones into separate q-sort lanes', () => {
    const workflow: SortWorkflowData = {
      templateId: 'qsort',
      stages: [
        { id: 'stage-presort', kind: 'presort', name: 'Pre-Sort', order: 0 },
        { id: 'stage-qsort', kind: 'qsort', name: 'Q-Sort', order: 1 },
      ],
      widgets: [
        {
          id: 'source-1',
          kind: 'source',
          stageId: 'stage-presort',
          title: 'Source',
          createdAt: 1,
          x: 40,
          y: 420,
          w: 360,
          h: 220,
          z: 10,
          layout: 'stack',
        } satisfies SourceWidgetData,
        {
          id: 'presort-1',
          kind: 'pre-sort',
          stageId: 'stage-presort',
          title: 'Pre-Sort',
          createdAt: 2,
          x: 480,
          y: 80,
          w: 520,
          h: 320,
          z: 11,
          zones: [
            { id: 'plus-zone', label: '+' },
            { id: 'minus-zone', label: '-' },
          ],
        } satisfies PreSortWidgetData,
        {
          id: 'qsort-1',
          kind: 'qsort',
          stageId: 'stage-qsort',
          title: 'Q-Sort',
          createdAt: 3,
          x: 120,
          y: 120,
          w: 920,
          h: 420,
          z: 10,
          lanes: [
            { id: 'plus-lane', label: '+' },
            { id: 'minus-lane', label: '-' },
          ],
          buckets: [
            { id: 'bucket-left', label: '-1', capacity: 1 },
            { id: 'bucket-right', label: '+1', capacity: 1 },
          ],
        } satisfies QSortWidgetData,
      ],
    };
    const presortWidget = workflow.widgets.find((widget): widget is PreSortWidgetData => widget.kind === 'pre-sort')!;
    const qsortWidget = workflow.widgets.find((widget): widget is QSortWidgetData => widget.kind === 'qsort')!;

    let cards = seedStageAssignments(
      [makeCard('card-a'), makeCard('card-b')],
      'stage-presort',
      'source-1',
      WIDGET_ZONE_CONTENT
    );
    cards = assignCardsToWidgetZone(cards, 'stage-presort', presortWidget.id, presortWidget.zones[0].id, ['card-a']);
    cards = assignCardsToWidgetZone(cards, 'stage-presort', presortWidget.id, presortWidget.zones[1].id, ['card-b']);
    const transitioned = transitionPreSortToQSort(
      cards,
      'stage-presort',
      'stage-qsort',
      presortWidget,
      qsortWidget
    );

    expect(transitioned.find((card) => card.id === 'card-a')?.widgetAssignments?.['stage-qsort']).toEqual({
      widgetId: 'qsort-1',
      zoneId: 'plus-lane',
      order: 0,
    });
    expect(transitioned.find((card) => card.id === 'card-b')?.widgetAssignments?.['stage-qsort']).toEqual({
      widgetId: 'qsort-1',
      zoneId: 'minus-lane',
      order: 0,
    });
  });

  it('seeds only cards missing stage assignments into a source zone', () => {
    const seeded = assignUnassignedCardsToWidgetZone(
      [
        {
          ...makeCard('card-a'),
          widgetAssignments: {
            'stage-1': { widgetId: 'source-1', zoneId: WIDGET_ZONE_CONTENT, order: 0 },
          },
        },
        makeCard('card-b'),
      ],
      'stage-1',
      'source-1',
      WIDGET_ZONE_CONTENT
    );

    expect(seeded[0].widgetAssignments?.['stage-1']).toEqual({
      widgetId: 'source-1',
      zoneId: WIDGET_ZONE_CONTENT,
      order: 0,
    });
    expect(seeded[1].widgetAssignments?.['stage-1']).toEqual({
      widgetId: 'source-1',
      zoneId: WIDGET_ZONE_CONTENT,
      order: 1,
    });
  });

  it('treats q-sort stages as incomplete until lanes are empty and capacities are respected', () => {
    const qsortWorkflow: SortWorkflowData = {
      templateId: 'qsort',
      stages: [{ id: 'stage-qsort', kind: 'qsort', name: 'Q-Sort', order: 0 }],
      widgets: [
        {
          id: 'qsort-1',
          kind: 'qsort',
          stageId: 'stage-qsort',
          title: 'Q-Sort',
          createdAt: 1,
          x: 120,
          y: 120,
          w: 920,
          h: 420,
          z: 10,
          lanes: [
            { id: 'plus-lane', label: '+' },
            { id: 'minus-lane', label: '-' },
          ],
          buckets: [
            { id: 'bucket-left', label: '-1', capacity: 1 },
            { id: 'bucket-right', label: '+1', capacity: 1 },
          ],
        } satisfies QSortWidgetData,
      ],
    };

    let cards: CardData[] = [
      {
        ...makeCard('card-a'),
        widgetAssignments: {
          'stage-qsort': { widgetId: 'qsort-1', zoneId: 'plus-lane', order: 0 },
        },
      },
      {
        ...makeCard('card-b'),
        widgetAssignments: {
          'stage-qsort': { widgetId: 'qsort-1', zoneId: 'minus-lane', order: 0 },
        },
      },
    ];

    expect(isStageComplete(qsortWorkflow, 'stage-qsort', cards)).toBe(false);

    cards = assignCardsToWidgetZone(cards, 'stage-qsort', 'qsort-1', 'bucket-left', ['card-a']);
    cards = assignCardsToWidgetZone(cards, 'stage-qsort', 'qsort-1', 'bucket-right', ['card-b']);

    expect(countCardsInWidgetZone(cards, 'stage-qsort', 'qsort-1', 'plus-lane')).toBe(0);
    expect(countCardsInWidgetZone(cards, 'stage-qsort', 'qsort-1', 'minus-lane')).toBe(0);
    expect(isStageComplete(qsortWorkflow, 'stage-qsort', cards)).toBe(true);

    const overflowed = assignCardsToWidgetZone(cards, 'stage-qsort', 'qsort-1', 'bucket-left', ['card-b']);
    expect(isStageComplete(qsortWorkflow, 'stage-qsort', overflowed)).toBe(false);
  });

  it('uses a stronger minimum size for q-sort widgets than the generic widget clamp', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 15);
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const qsortWidget = getQSortWidget(workflow, qsortStageId)!;
    const minSize = getMinimumWidgetSize(qsortWidget);

    expect(minSize.minW).toBeGreaterThan(220);
    expect(minSize.minH).toBeGreaterThan(180);
  });
});
