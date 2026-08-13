import type {
  BoardWidgetData,
  CardData,
  Mode,
  PreSortWidgetData,
  SortStageKind,
  SortWorkflowData,
} from './types';
import { clamp } from './utils';
import {
  WIDGET_ZONE_CONTENT,
  getClosedCategoryWidgets,
  getQSortWidget,
  getSourceWidget,
  getStageById,
  getWidgetsForStage,
} from './workflow';
import {
  countCardsInWidgetZone,
  getCardsInWidgetZone,
  layoutCardsInQSortBucketSlots,
  type CardBounds,
  type WidgetDropState,
} from './widgetSort';

type Rect = { x: number; y: number; w: number; h: number };

export type SurfaceDropTarget = {
  widgetId: string;
  widgetKind: BoardWidgetData['kind'];
  zoneId: string;
  zoneKind: 'content' | 'presort-zone' | 'lane' | 'bucket';
};

type BaseSurfaceView = {
  surfaceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isSelected?: boolean;
  selectWidgetId?: string | null;
  dragEnabled?: boolean;
  resizeEnabled?: boolean;
};

export type WorkAreaSurfaceView = BaseSurfaceView & {
  kind: 'work-area';
  stageKind: 'closed-sort' | 'presort';
  widgetId: string;
  title: string;
  count: number;
  state?: WidgetDropState;
};

export type SinkSurfaceView = BaseSurfaceView & {
  kind: 'sink';
  stageKind: 'closed-sort' | 'presort';
  widgetId: string;
  zoneId: string;
  title: string;
  count: number;
  capacityLabel?: string;
  placeholderLabel?: string;
  state?: WidgetDropState;
};

export type QSortLaneSurfaceView = {
  zoneId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  placeholderLabel?: string;
  state?: WidgetDropState;
};

export type QSortBucketSurfaceView = {
  zoneId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  capacity: number;
  capacityLabel: string;
  slots: Array<{
    slotIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
    occupied: boolean;
  }>;
  columnHeight: number;
  baselineY: number;
  isCenter: boolean;
  isExtreme: boolean;
  state?: WidgetDropState;
};

export type QSortCanvasSurfaceView = BaseSurfaceView & {
  kind: 'qsort-stage';
  widgetId: string;
  title: string;
  count: number;
  leftColumnRect: Rect;
  distributionRect: Rect;
  baselineY: number;
  lanes: QSortLaneSurfaceView[];
  buckets: QSortBucketSurfaceView[];
};

export type BoardSurfaceView = WorkAreaSurfaceView | SinkSurfaceView | QSortCanvasSurfaceView;

export type StageSurfaceScene = {
  stageKind: SortStageKind;
  canvasW: number;
  canvasH: number;
  viewportX: number;
  surfaces: BoardSurfaceView[];
};

const OUTER_PAD_X = 32;
const OUTER_PAD_Y = 32;
const SORT_TOP_CLEARANCE = 92;
const COLUMN_GAP = 24;
const SINK_GAP = 18;
const SURFACE_INNER_PAD = 18;
const GRID_GAP = 18;
const WORK_STAGGER_X = 26;
const WORK_STAGGER_Y = 8;
const WORK_AREA_HEADER_PAD = 72;
const SINK_HEADER_PAD = 74;
const QSORT_LANE_HEADER_PAD = 52;
const QSORT_BUCKET_GAP = 12;
const QSORT_SLOT_GAP = 10;
const QSORT_BOTTOM_PAD = 34;
const QSORT_LANE_GAP = 18;
const QSORT_LEFT_RATIO = 0.32;

function rectContains(rect: Rect, pointX: number, pointY: number) {
  return pointX >= rect.x && pointX <= rect.x + rect.w && pointY >= rect.y && pointY <= rect.y + rect.h;
}

function centerOf(bounds: CardBounds) {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  };
}

function activeDropState(
  activeDrop: { widgetId: string; zoneId: string; state: WidgetDropState } | null | undefined,
  widgetId: string,
  zoneId: string
) {
  if (!activeDrop) return 'idle' as const;
  if (activeDrop.widgetId !== widgetId || activeDrop.zoneId !== zoneId) return 'idle' as const;
  return activeDrop.state;
}

function getViewportSize(viewport: { width: number; height: number } | undefined) {
  return {
    width: Math.max(720, Math.round(viewport?.width || 1200)),
    height: Math.max(520, Math.round(viewport?.height || 800)),
  };
}

function getTopPad(mode: Mode) {
  return mode === 'sort' ? SORT_TOP_CLEARANCE : OUTER_PAD_Y;
}

function insetRect(rect: Rect, insets: { top?: number; right?: number; bottom?: number; left?: number }) {
  const top = insets.top ?? 0;
  const right = insets.right ?? 0;
  const bottom = insets.bottom ?? 0;
  const left = insets.left ?? 0;
  return {
    x: rect.x + left,
    y: rect.y + top,
    w: Math.max(0, rect.w - left - right),
    h: Math.max(0, rect.h - top - bottom),
  };
}

function buildClosedOrPreSortScene(
  workflow: SortWorkflowData,
  stageId: string,
  cards: CardData[],
  selectedWidgetId: string | null,
  mode: Mode,
  viewport: { width: number; height: number },
  activeDrop?: { widgetId: string; zoneId: string; state: WidgetDropState } | null
): StageSurfaceScene {
  const stageKind = getStageById(workflow, stageId)?.kind;
  if (stageKind !== 'closed-sort' && stageKind !== 'presort') {
    return {
      stageKind: 'closed-sort',
      canvasW: viewport.width,
      canvasH: viewport.height,
      viewportX: 0,
      surfaces: [],
    };
  }

  const topPad = getTopPad(mode);
  const sinkCount =
    stageKind === 'closed-sort'
      ? getClosedCategoryWidgets(workflow, stageId).length
      : getWidgetsForStage(workflow, stageId).find((widget): widget is PreSortWidgetData => widget.kind === 'pre-sort')?.zones.length || 0;
  const columnRatio = sinkCount <= 2 ? 0.38 : 0.35;
  const sinkColumnW = clamp(Math.round(viewport.width * columnRatio), 300, 440);
  const workAreaW = Math.max(320, viewport.width - OUTER_PAD_X * 2 - COLUMN_GAP - sinkColumnW);
  const sinkGap = stageKind === 'closed-sort' && sinkCount >= 4 ? 14 : SINK_GAP;
  const minSinkH = stageKind === 'closed-sort' ? 110 : 150;
  const requiredSinkColumnH = sinkCount * minSinkH + Math.max(0, sinkCount - 1) * sinkGap;
  const contentH = Math.max(
    220,
    viewport.height - topPad - OUTER_PAD_Y,
    requiredSinkColumnH
  );
  const workArea: Rect = {
    x: OUTER_PAD_X,
    y: topPad,
    w: workAreaW,
    h: contentH,
  };
  const sinkColumn: Rect = {
    x: workArea.x + workArea.w + COLUMN_GAP,
    y: topPad,
    w: sinkColumnW,
    h: contentH,
  };

  const sourceWidget = getSourceWidget(workflow, stageId);
  const surfaces: BoardSurfaceView[] = [];
  if (sourceWidget) {
    surfaces.push({
      kind: 'work-area',
      stageKind,
      surfaceId: `work-area-${stageId}`,
      widgetId: sourceWidget.id,
      x: workArea.x,
      y: workArea.y,
      w: workArea.w,
      h: workArea.h,
      title: 'Cards',
      count: countCardsInWidgetZone(cards, stageId, sourceWidget.id, WIDGET_ZONE_CONTENT),
      state: activeDropState(activeDrop, sourceWidget.id, WIDGET_ZONE_CONTENT),
    });
  }

  if (stageKind === 'closed-sort') {
    const categories = getClosedCategoryWidgets(workflow, stageId);
    const sinkH = Math.max(110, Math.floor((sinkColumn.h - sinkGap * Math.max(0, categories.length - 1)) / Math.max(1, categories.length)));
    categories.forEach((category, index) => {
      const count = countCardsInWidgetZone(cards, stageId, category.id, WIDGET_ZONE_CONTENT);
      surfaces.push({
        kind: 'sink',
        stageKind,
        surfaceId: `sink-${category.id}`,
        widgetId: category.id,
        zoneId: WIDGET_ZONE_CONTENT,
        x: sinkColumn.x,
        y: sinkColumn.y + index * (sinkH + sinkGap),
        w: sinkColumn.w,
        h: sinkH,
        title: category.title,
        count,
        capacityLabel: category.capacityMode === 'limited' ? `${count} / ${category.capacity ?? 1}` : undefined,
        placeholderLabel: 'Drop here',
        state: activeDropState(activeDrop, category.id, WIDGET_ZONE_CONTENT),
        isSelected: selectedWidgetId === category.id,
        selectWidgetId: category.id,
      });
    });
  } else {
    const preSortWidget = getWidgetsForStage(workflow, stageId).find(
      (widget): widget is PreSortWidgetData => widget.kind === 'pre-sort'
    );
    if (preSortWidget) {
      const sinkGap = SINK_GAP;
      const sinkH = Math.max(150, Math.floor((sinkColumn.h - sinkGap) / 2));
      preSortWidget.zones.forEach((zone, index) => {
        const count = countCardsInWidgetZone(cards, stageId, preSortWidget.id, zone.id);
        surfaces.push({
          kind: 'sink',
          stageKind,
          surfaceId: `sink-${preSortWidget.id}-${zone.id}`,
          widgetId: preSortWidget.id,
          zoneId: zone.id,
          x: sinkColumn.x,
          y: sinkColumn.y + index * (sinkH + sinkGap),
          w: sinkColumn.w,
          h: sinkH,
          title: zone.label,
          count,
          placeholderLabel: 'Drop here',
          state: activeDropState(activeDrop, preSortWidget.id, zone.id),
          isSelected: selectedWidgetId === preSortWidget.id,
          selectWidgetId: preSortWidget.id,
        });
      });
    }
  }

  return {
    stageKind,
    canvasW: viewport.width,
    canvasH: Math.max(viewport.height, topPad + contentH + OUTER_PAD_Y),
    viewportX: 0,
    surfaces,
  };
}

function buildQSortScene(
  workflow: SortWorkflowData,
  stageId: string,
  cards: CardData[],
  selectedWidgetId: string | null,
  mode: Mode,
  viewport: { width: number; height: number },
  activeDrop?: { widgetId: string; zoneId: string; state: WidgetDropState } | null
): StageSurfaceScene {
  const qsortWidget = getQSortWidget(workflow, stageId);
  const stageKind = getStageById(workflow, stageId)?.kind || 'qsort';
  if (!qsortWidget) {
    return {
      stageKind,
      canvasW: viewport.width,
      canvasH: viewport.height,
      viewportX: 0,
      surfaces: [],
    };
  }

  const topPad = getTopPad(mode);
  const contentH = Math.max(360, viewport.height - topPad - OUTER_PAD_Y);
  const leftColumnW = clamp(Math.round(viewport.width * QSORT_LEFT_RATIO), 280, 420);
  const visibleDistributionW = Math.max(
    760,
    viewport.width - OUTER_PAD_X * 2 - leftColumnW - COLUMN_GAP
  );
  const distributionW = Math.max(920, Math.round(visibleDistributionW + viewport.width * 0.18));
  const canvasW = Math.max(viewport.width, OUTER_PAD_X * 2 + leftColumnW + COLUMN_GAP + distributionW);
  const viewportX = clamp(Math.round(leftColumnW * 0.18), 0, Math.max(0, canvasW - viewport.width));
  const leftColumnRect: Rect = {
    x: OUTER_PAD_X,
    y: topPad,
    w: leftColumnW,
    h: contentH,
  };
  const distributionRect: Rect = {
    x: leftColumnRect.x + leftColumnRect.w + COLUMN_GAP,
    y: topPad,
    w: distributionW,
    h: contentH,
  };
  const laneGap = QSORT_LANE_GAP;
  const laneH = Math.max(150, Math.floor((leftColumnRect.h - laneGap) / 2));
  const lanes = qsortWidget.lanes.map((lane, index) => ({
    zoneId: lane.id,
    label: lane.label,
    x: leftColumnRect.x,
    y: leftColumnRect.y + index * (laneH + laneGap),
    w: leftColumnRect.w,
    h: laneH,
    count: countCardsInWidgetZone(cards, stageId, qsortWidget.id, lane.id),
    state: activeDropState(activeDrop, qsortWidget.id, lane.id),
  }));
  const maxCapacity = Math.max(1, ...qsortWidget.buckets.map((bucket) => Math.max(0, bucket.capacity)));
  const bucketW = Math.max(
    72,
    Math.floor((distributionRect.w - QSORT_BUCKET_GAP * Math.max(0, qsortWidget.buckets.length - 1)) / Math.max(1, qsortWidget.buckets.length))
  );
  const totalBucketW = bucketW * qsortWidget.buckets.length + QSORT_BUCKET_GAP * Math.max(0, qsortWidget.buckets.length - 1);
  const bucketStartX = distributionRect.x + Math.max(0, Math.round((distributionRect.w - totalBucketW) / 2));
  const baselineY = distributionRect.y + distributionRect.h - QSORT_BOTTOM_PAD;
  const slotHeight = Math.max(
    22,
    Math.floor((Math.max(180, baselineY - distributionRect.y) - QSORT_SLOT_GAP * Math.max(0, maxCapacity - 1)) / maxCapacity)
  );
  const center = (qsortWidget.buckets.length - 1) / 2;
  const buckets = qsortWidget.buckets.map((bucket, index) => {
    const count = countCardsInWidgetZone(cards, stageId, qsortWidget.id, bucket.id);
    const slots = Array.from({ length: Math.max(0, bucket.capacity) }, (_, slotIndex) => ({
      slotIndex,
      x: bucketStartX + index * (bucketW + QSORT_BUCKET_GAP),
      y: baselineY - slotHeight - slotIndex * (slotHeight + QSORT_SLOT_GAP),
      w: bucketW,
      h: slotHeight,
      occupied: slotIndex < Math.min(count, bucket.capacity),
    }));
    return {
      zoneId: bucket.id,
      label: bucket.label,
      x: bucketStartX + index * (bucketW + QSORT_BUCKET_GAP),
      y: distributionRect.y,
      w: bucketW,
      h: distributionRect.h,
      count,
      capacity: bucket.capacity,
      capacityLabel: `${count} / ${bucket.capacity}`,
      slots,
      columnHeight:
        bucket.capacity > 0
          ? bucket.capacity * slotHeight + Math.max(0, bucket.capacity - 1) * QSORT_SLOT_GAP
          : 32,
      baselineY,
      isCenter: Math.abs(index - center) <= 0.5,
      isExtreme: index === 0 || index === qsortWidget.buckets.length - 1,
      state: activeDropState(activeDrop, qsortWidget.id, bucket.id),
    } satisfies QSortBucketSurfaceView;
  });

  return {
    stageKind,
    canvasW,
    canvasH: viewport.height,
    viewportX,
    surfaces: [
      {
        kind: 'qsort-stage',
        surfaceId: `qsort-stage-${qsortWidget.id}`,
        widgetId: qsortWidget.id,
        x: leftColumnRect.x,
        y: topPad,
        w: distributionRect.x + distributionRect.w - leftColumnRect.x,
        h: contentH,
        title: qsortWidget.title,
        count: lanes.reduce((sum, lane) => sum + lane.count, 0) + buckets.reduce((sum, bucket) => sum + bucket.count, 0),
        leftColumnRect,
        distributionRect,
        baselineY,
        lanes,
        buckets,
        isSelected: selectedWidgetId === qsortWidget.id,
        selectWidgetId: qsortWidget.id,
        dragEnabled: mode === 'setup',
        resizeEnabled: mode === 'setup',
      },
    ],
  };
}

export function buildStageSurfaceScene(
  workflow: SortWorkflowData,
  stageId: string,
  cards: CardData[],
  selectedWidgetId: string | null,
  mode: Mode,
  viewportInput: { width: number; height: number },
  activeDrop?: { widgetId: string; zoneId: string; state: WidgetDropState } | null
): StageSurfaceScene {
  const viewport = getViewportSize(viewportInput);
  const stageKind = getStageById(workflow, stageId)?.kind || 'closed-sort';
  if (stageKind === 'qsort') {
    return buildQSortScene(workflow, stageId, cards, selectedWidgetId, mode, viewport, activeDrop);
  }
  return buildClosedOrPreSortScene(workflow, stageId, cards, selectedWidgetId, mode, viewport, activeDrop);
}

function maxCardSize(cards: CardData[], getBounds: (card: CardData) => CardBounds) {
  let maxW = 1;
  let maxH = 1;
  for (const card of cards) {
    const bounds = getBounds(card);
    maxW = Math.max(maxW, bounds.w);
    maxH = Math.max(maxH, bounds.h);
  }
  return { maxW, maxH };
}

export function layoutCardsInWorkArea(cards: CardData[], rect: Rect, getBounds: (card: CardData) => CardBounds) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const bodyRect = insetRect(rect, {
    top: WORK_AREA_HEADER_PAD,
    right: SURFACE_INNER_PAD,
    bottom: SURFACE_INNER_PAD,
    left: SURFACE_INNER_PAD,
  });
  const { maxW, maxH } = maxCardSize(cards, getBounds);
  const usableW = Math.max(1, bodyRect.w);
  const cols = Math.max(1, Math.floor((usableW + GRID_GAP) / (maxW + GRID_GAP)));
  const rows = Math.ceil(cards.length / cols);
  const rowStep = maxH + GRID_GAP + WORK_STAGGER_X;
  const requiredH = maxH + Math.max(0, rows - 1) * rowStep + WORK_STAGGER_Y;
  const useCascade = requiredH > bodyRect.h;
  const cascadeStepY = rows > 1 ? Math.max(0, bodyRect.h - maxH) / (rows - 1) : 0;
  const next = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const staggerX = useCascade || row % 2 === 0 ? 0 : Math.round(maxW * 0.12);
    const staggerY = useCascade || col % 2 === 0 ? 0 : WORK_STAGGER_Y;
    next.set(card.id, {
      x: Math.round(bodyRect.x + staggerX + col * (maxW + GRID_GAP)),
      y: Math.round(bodyRect.y + staggerY + row * (useCascade ? cascadeStepY : rowStep)),
    });
  });
  return next;
}

function layoutCardsAsStack(cards: CardData[], rect: Rect, getBounds: (card: CardData) => CardBounds) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const { maxW, maxH } = maxCardSize(cards, getBounds);
  const spreadX = Math.min(56, Math.max(0, (cards.length - 1) * 8));
  const spreadY = Math.min(42, Math.max(0, (cards.length - 1) * 6));
  const stepX = cards.length > 1 ? spreadX / (cards.length - 1) : 0;
  const stepY = cards.length > 1 ? spreadY / (cards.length - 1) : 0;
  const startX = rect.x + Math.max(0, Math.round((rect.w - maxW - spreadX) / 2));
  const startY = rect.y + Math.max(0, Math.round((rect.h - maxH - spreadY) / 2));
  const next = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    next.set(card.id, {
      x: Math.round(startX + index * stepX),
      y: Math.round(startY + index * stepY),
    });
  });
  return next;
}

function layoutCardsAsFan(cards: CardData[], rect: Rect, getBounds: (card: CardData) => CardBounds) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const { maxW, maxH } = maxCardSize(cards, getBounds);
  const availableSpreadX = Math.max(0, rect.w - maxW);
  const stepX = cards.length > 1 ? Math.min(28, availableSpreadX / (cards.length - 1)) : 0;
  const spreadX = Math.max(0, (cards.length - 1) * stepX);
  const startX = rect.x + Math.max(0, Math.round((rect.w - maxW - spreadX) / 2));
  const startY = rect.y + Math.max(0, Math.round((rect.h - maxH - 14) / 2));
  const middle = (cards.length - 1) / 2;
  const next = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    const dx = index * stepX;
    const dy = Math.round(Math.abs(index - middle) * 14 * 0.7);
    next.set(card.id, {
      x: Math.round(startX + dx),
      y: Math.round(startY + dy),
    });
  });
  return next;
}

function layoutCardsInSink(
  cards: CardData[],
  rect: Rect,
  getBounds: (card: CardData) => CardBounds,
  layout: 'fan' | 'stack' = 'fan'
) {
  const bodyRect = insetRect(rect, {
    top: SINK_HEADER_PAD,
    right: SURFACE_INNER_PAD,
    bottom: SURFACE_INNER_PAD,
    left: SURFACE_INNER_PAD,
  });
  return layout === 'stack' ? layoutCardsAsStack(cards, bodyRect, getBounds) : layoutCardsAsFan(cards, bodyRect, getBounds);
}

export function reflowCardsForStage(
  cards: CardData[],
  workflow: SortWorkflowData,
  stageId: string,
  getBounds: (card: CardData) => CardBounds,
  viewportInput: { width: number; height: number },
  mode: Mode
) {
  const scene = buildStageSurfaceScene(workflow, stageId, cards, null, mode, viewportInput);
  const nextById = new Map(cards.map((card) => [card.id, card]));
  let changed = false;
  const setPosition = (card: CardData, pos: { x: number; y: number } | undefined) => {
    if (!pos || (card.x === pos.x && card.y === pos.y)) return;
    nextById.set(card.id, { ...card, x: pos.x, y: pos.y });
    changed = true;
  };
  const stageKind = scene.stageKind;
  if (stageKind === 'closed-sort' || stageKind === 'presort') {
    const workArea = scene.surfaces.find((surface): surface is WorkAreaSurfaceView => surface.kind === 'work-area');
    if (workArea) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, workArea.widgetId, WIDGET_ZONE_CONTENT);
      const layout = layoutCardsInWorkArea(zoneCards, workArea, getBounds);
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
    for (const surface of scene.surfaces) {
      if (surface.kind !== 'sink') continue;
      const stageWidget = workflow.widgets.find((widget) => widget.id === surface.widgetId);
      const layoutMode =
        stageKind === 'closed-sort' && stageWidget?.kind === 'category' ? stageWidget.layout : 'fan';
      const zoneCards = getCardsInWidgetZone(cards, stageId, surface.widgetId, surface.zoneId);
      const layout = layoutCardsInSink(zoneCards, surface, getBounds, layoutMode);
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
    return changed ? cards.map((card) => nextById.get(card.id) || card) : cards;
  }

  const qsortSurface = scene.surfaces.find((surface): surface is QSortCanvasSurfaceView => surface.kind === 'qsort-stage');
  const qsortWidget = getQSortWidget(workflow, stageId);
  if (qsortSurface && qsortWidget) {
    for (const lane of qsortSurface.lanes) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, qsortWidget.id, lane.zoneId);
      const layout = layoutCardsAsStack(
        zoneCards,
        insetRect(lane, { top: QSORT_LANE_HEADER_PAD, right: 14, bottom: 14, left: 14 }),
        getBounds
      );
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
    for (const bucket of qsortSurface.buckets) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, qsortWidget.id, bucket.zoneId);
      const layout = layoutCardsInQSortBucketSlots(zoneCards, bucket, getBounds);
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
  }
  return changed ? cards.map((card) => nextById.get(card.id) || card) : cards;
}

export function findStageSurfaceDropTarget(scene: StageSurfaceScene, bounds: CardBounds): SurfaceDropTarget | null {
  const center = centerOf(bounds);
  for (const surface of scene.surfaces) {
    if (surface.kind === 'work-area') {
      if (rectContains(surface, center.x, center.y)) {
        return {
          widgetId: surface.widgetId,
          widgetKind: 'source',
          zoneId: WIDGET_ZONE_CONTENT,
          zoneKind: 'content',
        };
      }
      continue;
    }
    if (surface.kind === 'sink') {
      if (rectContains(surface, center.x, center.y)) {
        return {
          widgetId: surface.widgetId,
          widgetKind: surface.stageKind === 'closed-sort' ? 'category' : 'pre-sort',
          zoneId: surface.zoneId,
          zoneKind: surface.stageKind === 'closed-sort' ? 'content' : 'presort-zone',
        };
      }
      continue;
    }
    for (const lane of surface.lanes) {
      if (rectContains(lane, center.x, center.y)) {
        return {
          widgetId: surface.widgetId,
          widgetKind: 'qsort',
          zoneId: lane.zoneId,
          zoneKind: 'lane',
        };
      }
    }
    for (const bucket of surface.buckets) {
      if (rectContains(bucket, center.x, center.y)) {
        return {
          widgetId: surface.widgetId,
          widgetKind: 'qsort',
          zoneId: bucket.zoneId,
          zoneKind: 'bucket',
        };
      }
    }
  }
  return null;
}
