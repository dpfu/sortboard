import { describe, expect, it } from 'vitest';
import type { CardData, QSortBucketData, QSortWidgetData } from './types';
import {
  WIDGET_ZONE_CONTENT,
  addClosedCategoryWidget,
  createWorkflowForTemplate,
  getDefaultActiveStageId,
  getQSortWidget,
  getSourceWidget,
} from './workflow';
import {
  buildStageSurfaceScene,
  findStageSurfaceDropTarget,
  getQSortCardDisplayDimensions,
  reflowCardsForStage,
  getSurfaceCardDimensions,
} from './stageSurface';

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

function getCardBounds(card: CardData) {
  return {
    x: card.x,
    y: card.y,
    w: 180,
    h: 120,
  };
}

function getDemoCardBounds(card: CardData) {
  return {
    x: card.x,
    y: card.y,
    w: 240,
    h: 135,
  };
}

function assignToZone(cards: CardData[], stageId: string, widgetId: string, zoneId: string) {
  return cards.map((card, index) => ({
    ...card,
    z: index + 1,
    widgetAssignments: {
      [stageId]: {
        widgetId,
        zoneId,
        order: index,
      },
    },
  }));
}

describe('stageSurface layout', () => {
  it('retains the original vertical targets and card sizes for older recordings', () => {
    let workflow = createWorkflowForTemplate('closed', 1280, 720, 15);
    const stageId = getDefaultActiveStageId(workflow)!;
    workflow = addClosedCategoryWidget(workflow, stageId, 1280, 720);
    const card = makeCard('legacy');
    const scene = buildStageSurfaceScene(workflow, stageId, [card], null, 'sort', { width: 1280, height: 720 }, null, 1);
    const targets = scene.surfaces.filter(surface => surface.kind === 'sink');
    expect(targets[0].x).toBe(targets[1].x);
    expect(targets[0].y + targets[0].h).toBeLessThan(targets[1].y);
    expect(getSurfaceCardDimensions(card, scene, getCardBounds)).toEqual({ w: 180, h: 120 });
  });
  it('reflows closed-sort source cards below the work-area header band', () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 3);
    const stageId = getDefaultActiveStageId(workflow)!;
    const source = getSourceWidget(workflow, stageId)!;
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')].map((card, index) => ({
      ...card,
      widgetAssignments: {
        [stageId]: {
          widgetId: source.id,
          zoneId: WIDGET_ZONE_CONTENT,
          order: index,
        },
      },
    }));

    const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'setup', { width: 1400, height: 900 });
    const workArea = scene.surfaces.find((surface) => surface.kind === 'work-area');
    expect(workArea).toBeTruthy();

    const reflowed = reflowCardsForStage(cards, workflow, stageId, getCardBounds, { width: 1400, height: 900 }, 'setup');
    expect(reflowed.every((card) => card.y >= (workArea?.y || 0) + 60)).toBe(true);
  });

  it('returns the same cards and references when an identical reflow is already stable', () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 3);
    const stageId = getDefaultActiveStageId(workflow)!;
    const source = getSourceWidget(workflow, stageId)!;
    const cards = assignToZone(
      [makeCard('card-a'), makeCard('card-b'), makeCard('card-c')],
      stageId,
      source.id,
      WIDGET_ZONE_CONTENT
    );

    const firstReflow = reflowCardsForStage(
      cards,
      workflow,
      stageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );
    const secondReflow = reflowCardsForStage(
      firstReflow,
      workflow,
      stageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );

    expect(secondReflow).toBe(firstReflow);
    secondReflow.forEach((card, index) => expect(card).toBe(firstReflow[index]));
  });

  it('preserves unaffected card references when reflow corrects a real position change', () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 3);
    const stageId = getDefaultActiveStageId(workflow)!;
    const source = getSourceWidget(workflow, stageId)!;
    const cards = assignToZone(
      [makeCard('card-a'), makeCard('card-b'), makeCard('card-c')],
      stageId,
      source.id,
      WIDGET_ZONE_CONTENT
    );
    const stableCards = reflowCardsForStage(
      cards,
      workflow,
      stageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );
    const displacedCards = stableCards.map((card, index) =>
      index === 0 ? { ...card, x: card.x + 40, y: card.y + 20 } : card
    );

    const reflowed = reflowCardsForStage(
      displacedCards,
      workflow,
      stageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );

    expect(reflowed).not.toBe(displacedCards);
    expect(reflowed[0]).not.toBe(displacedCards[0]);
    expect(reflowed[0]).toMatchObject({ x: stableCards[0]!.x, y: stableCards[0]!.y });
    expect(reflowed[1]).toBe(stableCards[1]);
    expect(reflowed[2]).toBe(stableCards[2]);
  });

  it.each([
    { width: 900, height: 446 },
    { width: 980, height: 446 },
    { width: 981, height: 720 },
    { width: 1280, height: 720 },
  ])('keeps 24 closed-sort source cards reachable inside a $width px work area', ({ width, height }) => {
    const workflow = createWorkflowForTemplate('closed', width, height, 24);
    const stageId = getDefaultActiveStageId(workflow)!;
    const source = getSourceWidget(workflow, stageId)!;
    const cards = assignToZone(
      Array.from({ length: 24 }, (_, index) => makeCard(`card-${index + 1}`)),
      stageId,
      source.id,
      WIDGET_ZONE_CONTENT
    );

    const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'setup', { width, height });
    const workArea = scene.surfaces.find((surface) => surface.kind === 'work-area');
    expect(workArea?.kind).toBe('work-area');
    if (!workArea || workArea.kind !== 'work-area') return;

    const reflowed = reflowCardsForStage(cards, workflow, stageId, getDemoCardBounds, { width, height }, 'setup');
    for (const card of reflowed) {
      expect(card.x).toBeGreaterThanOrEqual(workArea.x + 18);
      expect(card.x + getSurfaceCardDimensions(card, scene, getDemoCardBounds).w).toBeLessThanOrEqual(workArea.x + workArea.w - 18);
      expect(card.y).toBeGreaterThanOrEqual(workArea.y + 72);
      expect(card.y + getSurfaceCardDimensions(card, scene, getDemoCardBounds).h).toBeLessThanOrEqual(workArea.y + workArea.h - 18);
    }

    const cardsByColumn = new Map<number, CardData[]>();
    for (const card of reflowed) {
      cardsByColumn.set(card.x, [...(cardsByColumn.get(card.x) || []), card]);
    }
    for (const columnCards of cardsByColumn.values()) {
      const orderedY = columnCards.map((card) => card.y).sort((a, b) => a - b);
      for (let index = 1; index < orderedY.length; index += 1) {
        expect(orderedY[index]! - orderedY[index - 1]!).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('keeps 24 q-sort pre-sort source cards inside the scrollable work area', () => {
    const workflow = createWorkflowForTemplate('qsort', 1280, 720, 24);
    const stageId = workflow.stages.find((stage) => stage.kind === 'presort')!.id;
    const source = getSourceWidget(workflow, stageId)!;
    const cards = assignToZone(
      Array.from({ length: 24 }, (_, index) => makeCard(`card-${index + 1}`)),
      stageId,
      source.id,
      WIDGET_ZONE_CONTENT
    );
    const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'sort', { width: 1280, height: 720 });
    const workArea = scene.surfaces.find((surface) => surface.kind === 'work-area');
    expect(workArea?.kind).toBe('work-area');
    if (!workArea || workArea.kind !== 'work-area') return;

    const reflowed = reflowCardsForStage(cards, workflow, stageId, getDemoCardBounds, { width: 1280, height: 720 }, 'sort');
    expect(reflowed).toHaveLength(24);
    expect(reflowed.every((card) => card.y + getSurfaceCardDimensions(card, scene, getDemoCardBounds).h <= workArea.y + workArea.h - 18)).toBe(true);
    expect(scene.surfaces.filter((surface) => surface.kind === 'sink')).toHaveLength(2);
  });

  it.each([900, 1280])('keeps every source card and five closed targets reachable on a %d px wide board', (width) => {
    const height = 720;
    let workflow = createWorkflowForTemplate('closed', width, height, 24);
    const stageId = getDefaultActiveStageId(workflow)!;
    for (let index = 1; index < 5; index += 1) {
      workflow = addClosedCategoryWidget(workflow, stageId, width, height);
    }
    const source = getSourceWidget(workflow, stageId)!;
    const cards = assignToZone(
      Array.from({ length: 24 }, (_, index) => makeCard(`card-${index + 1}`)),
      stageId,
      source.id,
      WIDGET_ZONE_CONTENT
    );
    const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'sort', { width, height });
    const sinks = scene.surfaces.filter((surface) => surface.kind === 'sink');
    const reflowed = reflowCardsForStage(cards, workflow, stageId, getDemoCardBounds, { width, height }, 'sort');

    expect(sinks).toHaveLength(5);
    expect(reflowed.every((card) => card.y >= 0 && card.y + getSurfaceCardDimensions(card, scene, getDemoCardBounds).h <= scene.canvasH)).toBe(true);
    for (const sink of sinks) {
      expect(sink.y + sink.h).toBeLessThanOrEqual(scene.canvasH);
      const dropBounds = {
        x: sink.x + sink.w / 2 - 120,
        y: sink.y + sink.h / 2 - 67.5,
        w: 240,
        h: 135,
      };
      expect(findStageSurfaceDropTarget(scene, dropBounds)?.widgetId).toBe(sink.widgetId);
    }
  });

  it('compresses a full closed-sort fan into its category without changing small-fan spacing', () => {
    const workflow = createWorkflowForTemplate('closed', 1280, 720, 24);
    const stageId = getDefaultActiveStageId(workflow)!;
    const category = workflow.widgets.find((widget) => widget.kind === 'category')!;
    const cards = assignToZone(
      Array.from({ length: 24 }, (_, index) => makeCard(`card-${index + 1}`)),
      stageId,
      category.id,
      WIDGET_ZONE_CONTENT
    );
    const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'sort', { width: 1280, height: 720 });
    const sink = scene.surfaces.find((surface) => surface.kind === 'sink');
    expect(sink?.kind).toBe('sink');
    if (!sink || sink.kind !== 'sink') return;

    const reflowed = reflowCardsForStage(cards, workflow, stageId, getCardBounds, { width: 1280, height: 720 }, 'sort');
    const ordered = reflowed.slice().sort((a, b) => a.widgetAssignments![stageId]!.order - b.widgetAssignments![stageId]!.order);
    expect(ordered[0]!.x).toBeGreaterThanOrEqual(sink.x + 18);
    expect(ordered.at(-1)!.x + getSurfaceCardDimensions(ordered.at(-1)!, scene, getCardBounds).w).toBeLessThanOrEqual(sink.x + sink.w - 18);
    expect(ordered[1]!.x - ordered[0]!.x).toBeGreaterThan(0);
    expect(ordered[1]!.x - ordered[0]!.x).toBeLessThan(28);

    const smallFan = reflowCardsForStage(cards.slice(0, 3), workflow, stageId, getCardBounds, { width: 1280, height: 720 }, 'sort');
    const smallOrdered = smallFan.slice().sort((a, b) => a.widgetAssignments![stageId]!.order - b.widgetAssignments![stageId]!.order);
    expect(smallOrdered[1]!.x - smallOrdered[0]!.x).toBe(28);
  });

  it('fits q-sort into the viewport and keeps tray cards below the tray header', () => {
    const workflow = createWorkflowForTemplate('qsort', 1600, 900, 12);
    const presortStageId = workflow.stages.find((stage) => stage.kind === 'presort')!.id;
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const qsortWidget = getQSortWidget(workflow, qsortStageId)!;
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')].map((card, index) => ({
      ...card,
      widgetAssignments: {
        [qsortStageId]: {
          widgetId: qsortWidget.id,
          zoneId: qsortWidget.lanes[index % qsortWidget.lanes.length]!.id,
          order: index,
        },
      },
    }));

    const scene = buildStageSurfaceScene(workflow, qsortStageId, cards, null, 'sort', { width: 1600, height: 900 });
    const qsortSurface = scene.surfaces.find((surface) => surface.kind === 'qsort-stage');
    expect(scene.canvasW).toBe(1600);
    expect(scene.viewportX).toBe(0);
    expect(qsortSurface).toBeTruthy();
    expect(qsortSurface?.distributionRect.w || 0).toBeGreaterThan(1500);

    const reflowed = reflowCardsForStage(cards, workflow, qsortStageId, getCardBounds, { width: 1600, height: 900 }, 'sort');
    const laneTop = qsortSurface?.lanes[0]?.y || 0;
    expect(reflowed.every((card) => card.y >= laneTop + 40)).toBe(true);
    expect(presortStageId).toBeTruthy();
  });

  it.each([900, 1440])('keeps all tray images visible and preserves their places at %d px', (width) => {
    const workflow = createWorkflowForTemplate('qsort', width, 1000, 24);
    const pre = workflow.widgets.find(widget => widget.kind === 'pre-sort')!;
    if (pre.kind !== 'pre-sort') throw new Error('Missing pre-sort');
    const stageId = workflow.stages.find(stage => stage.kind === 'qsort')!.id;
    const widget = getQSortWidget(workflow, stageId)!;
    for (const split of [0, 13]) {
      const cards = Array.from({ length: 24 }, (_, index) => {
        const lane = index < split ? 0 : 1;
        return { ...makeCard(`card-${index}`), widgetAssignments: {
          [pre.stageId]: { widgetId: pre.id, zoneId: pre.zones[lane].id, order: index },
          [stageId]: { widgetId: widget.id, zoneId: widget.lanes[lane].id, order: index },
        } };
      });
      const viewport = { width, height: 1000 };
      const scene = buildStageSurfaceScene(workflow, stageId, cards, null, 'sort', viewport);
      const surface = scene.surfaces.find(entry => entry.kind === 'qsort-stage')!;
      const placed = reflowCardsForStage(cards, workflow, stageId, getDemoCardBounds, viewport, 'sort');
      const boxes = placed.map(card => ({ x: card.x, y: card.y, ...getQSortCardDisplayDimensions(card, surface, getDemoCardBounds) }));
      boxes.forEach((box, index) => {
        const lane = surface.lanes.find(entry => entry.zoneId === placed[index].widgetAssignments![stageId]!.zoneId)!;
        expect(box.x).toBeGreaterThanOrEqual(lane.x);
        expect(box.y).toBeGreaterThanOrEqual(lane.y + 40);
        expect(box.x + box.w).toBeLessThanOrEqual(lane.x + lane.w);
        expect(box.y + box.h).toBeLessThanOrEqual(lane.y + lane.h);
        for (const other of boxes.slice(index + 1)) {
          expect(box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h <= other.y || other.y + other.h <= box.y).toBe(true);
        }
      });
      const moved = placed.map((card, index) => index === 0 ? {
        ...card, widgetAssignments: { ...card.widgetAssignments, [stageId]: {
          widgetId: widget.id, zoneId: widget.buckets.find(bucket => bucket.capacity > 0)!.id, order: 0,
        } },
      } : card);
      const after = reflowCardsForStage(moved, workflow, stageId, getDemoCardBounds, viewport, 'sort');
      expect(after.slice(1).map(card => [card.x, card.y])).toEqual(placed.slice(1).map(card => [card.x, card.y]));
      expect(surface.buckets.flatMap(bucket => bucket.slots).every(slot => slot.h >= 88)).toBe(true);
    }
  });

  it('preserves the shelf and equal-height columns for earlier Q-Sort recordings', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 24);
    const stageId = workflow.stages.find(stage => stage.kind === 'qsort')!.id;
    for (const version of [1, 2] as const) {
      const scene = buildStageSurfaceScene(workflow, stageId, [], null, 'sort', { width: 1200, height: 800 }, null, version);
      const surface = scene.surfaces.find(entry => entry.kind === 'qsort-stage')!;
      expect(surface.layoutVersion).toBeUndefined();
      expect(surface.lanes.every(lane => !lane.grid)).toBe(true);
      expect(new Set(surface.buckets.map(bucket => bucket.h)).size).toBe(1);
    }
  });

  it('builds top trays and capacity-shaped columns with top-aligned slots', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 15);
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const scene = buildStageSurfaceScene(workflow, qsortStageId, [], null, 'sort', { width: 1200, height: 800 });
    const surface = scene.surfaces.find((entry) => entry.kind === 'qsort-stage');
    expect(surface?.kind).toBe('qsort-stage');
    if (!surface || surface.kind !== 'qsort-stage') return;

    const centerBucket = surface.buckets[Math.floor(surface.buckets.length / 2)]!;
    const edgeBucket = surface.buckets[0]!;
    expect(surface.leftColumnRect.y + surface.leftColumnRect.h).toBeLessThan(surface.distributionRect.y);
    expect(surface.lanes[0]!.x + surface.lanes[0]!.w).toBeLessThan(surface.lanes[1]!.x);
    expect(surface.baselineY).toBeGreaterThan(surface.distributionRect.y);
    expect(centerBucket.columnHeight).toBeGreaterThan(edgeBucket.columnHeight);
    expect(centerBucket.slots).toHaveLength(centerBucket.capacity);
    expect(centerBucket.slots[0]!.y).toBeLessThan(centerBucket.slots[1]!.y);
  });

  it('keeps the original aspect ratio while fitting q-sort cards into trays and slots', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 15);
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const qsortWidget = getQSortWidget(workflow, qsortStageId)!;
    const imageCard: CardData = {
      ...makeCard('wide-image'),
      kind: 'image',
      meta: { ...makeCard('wide-image').meta, aspectRatio: 2 },
      widgetAssignments: {
        [qsortStageId]: { widgetId: qsortWidget.id, zoneId: qsortWidget.lanes[0]!.id, order: 0 },
      },
    };
    const scene = buildStageSurfaceScene(workflow, qsortStageId, [imageCard], null, 'sort', { width: 1200, height: 800 });
    const surface = scene.surfaces.find((entry) => entry.kind === 'qsort-stage');
    expect(surface?.kind).toBe('qsort-stage');
    if (!surface || surface.kind !== 'qsort-stage') return;

    const trayDims = getQSortCardDisplayDimensions(imageCard, surface, () => ({ x: 0, y: 0, w: 240, h: 120 }));
    expect(trayDims.w / trayDims.h).toBe(2);
    expect(trayDims.w).toBeLessThan(240);

    const slottedCard = {
      ...imageCard,
      widgetAssignments: {
        [qsortStageId]: { widgetId: qsortWidget.id, zoneId: qsortWidget.buckets[0]!.id, order: 0 },
      },
    };
    const slotDims = getQSortCardDisplayDimensions(slottedCard, surface, () => ({ x: 0, y: 0, w: 240, h: 120 }));
    expect(slotDims.w / slotDims.h).toBe(2);
    expect(slotDims.w).toBeLessThanOrEqual(surface.buckets[0]!.slots[0]!.w - 12);
    expect(slotDims.h).toBeLessThanOrEqual(surface.buckets[0]!.slots[0]!.h - 10);
  });

  it('renders zero-capacity q-sort buckets as empty stubs without slots', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 10);
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const qsortWidget = getQSortWidget(workflow, qsortStageId)!;
    const zeroCapacityBuckets = qsortWidget.buckets.map((bucket, index) =>
      index === 0 ? ({ ...bucket, capacity: 0 } satisfies QSortBucketData) : bucket
    );
    const nextWorkflow = {
      ...workflow,
      widgets: workflow.widgets.map((widget) =>
        widget.kind === 'qsort' && widget.id === qsortWidget.id
          ? ({ ...widget, buckets: zeroCapacityBuckets } satisfies QSortWidgetData)
          : widget
      ),
    };
    const scene = buildStageSurfaceScene(nextWorkflow, qsortStageId, [], null, 'sort', { width: 1200, height: 800 });
    const surface = scene.surfaces.find((entry) => entry.kind === 'qsort-stage');
    expect(surface?.kind).toBe('qsort-stage');
    if (!surface || surface.kind !== 'qsort-stage') return;

    expect(surface.buckets[0]!.capacity).toBe(0);
    expect(surface.buckets[0]!.slots).toHaveLength(0);
    expect(surface.buckets[0]!.columnHeight).toBeGreaterThan(0);
  });

  it('reflows q-sort cards through the active surface slots and keeps overflow stable', () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 3);
    const qsortStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
    const qsortWidget = getQSortWidget(workflow, qsortStageId)!;
    const bucket = qsortWidget.buckets[0]!;
    const limitedWorkflow = {
      ...workflow,
      widgets: workflow.widgets.map((widget) =>
        widget.kind === 'qsort' && widget.id === qsortWidget.id
          ? ({
              ...widget,
              buckets: [{ ...bucket, capacity: 2 }, ...qsortWidget.buckets.slice(1)],
            } satisfies QSortWidgetData)
          : widget
      ),
    };

    let cards: CardData[] = [
      { ...makeCard('card-a'), widgetAssignments: { [qsortStageId]: { widgetId: qsortWidget.id, zoneId: bucket.id, order: 0 } } },
      { ...makeCard('card-b'), widgetAssignments: { [qsortStageId]: { widgetId: qsortWidget.id, zoneId: bucket.id, order: 1 } } },
      { ...makeCard('card-c'), widgetAssignments: { [qsortStageId]: { widgetId: qsortWidget.id, zoneId: bucket.id, order: 2 } } },
    ];

    let reflowed = reflowCardsForStage(
      cards,
      limitedWorkflow,
      qsortStageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );
    const cardA = reflowed.find((card) => card.id === 'card-a')!;
    const cardB = reflowed.find((card) => card.id === 'card-b')!;
    const cardC = reflowed.find((card) => card.id === 'card-c')!;

    expect(cardA.y).toBeLessThan(cardB.y);
    expect(cardC.y).toBeGreaterThan(cardB.y);

    cards = reflowed.filter((card) => card.id !== 'card-a');
    reflowed = reflowCardsForStage(
      cards,
      limitedWorkflow,
      qsortStageId,
      getCardBounds,
      { width: 1200, height: 800 },
      'sort'
    );
    const compactedB = reflowed.find((card) => card.id === 'card-b')!;
    const compactedC = reflowed.find((card) => card.id === 'card-c')!;

    expect(compactedB.y).toBe(cardA.y);
    expect(compactedC.y).toBe(cardB.y);
  });
});
