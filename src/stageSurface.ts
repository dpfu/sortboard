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
  grid?: { columns: number; cellW: number; cellH: number; cardIds: string[] };
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
  stageId: string;
  widgetId: string;
  title: string;
  count: number;
  layoutVersion?: 3;
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
  cardFrame?: { w: number; h: number; columns: number };
};

const OUTER_PAD_X = 32;
const OUTER_PAD_Y = 32;
const SORT_TOP_CLEARANCE = 92;
const COLUMN_GAP = 24;
const SINK_GAP = 18;
const SURFACE_INNER_PAD = 18;
const GRID_GAP = 18;
const WORK_AREA_HEADER_PAD = 72;
const SINK_HEADER_PAD = 74;
const QSORT_LANE_HEADER_PAD = 52;
const QSORT_BUCKET_GAP = 12;
const QSORT_SLOT_GAP = 10;
const QSORT_LANE_GAP = 18;
const QSORT_SECTION_GAP = 24;
const QSORT_DISTRIBUTION_HEADER_H = 84;
const QSORT_BUCKET_HEADER_H = 58;

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

function buildLegacyClosedOrPreSortScene(
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

function buildClosedOrPreSortScene(
  workflow: SortWorkflowData,
  stageId: string,
  cards: CardData[],
  selectedWidgetId: string | null,
  mode: Mode,
  viewport: { width: number; height: number },
  activeDrop?: { widgetId: string; zoneId: string; state: WidgetDropState } | null
): StageSurfaceScene {
  const scene = buildLegacyClosedOrPreSortScene(workflow, stageId, cards, selectedWidgetId, mode, viewport, activeDrop);
  const source = scene.surfaces.find(surface => surface.kind === 'work-area');
  const targets = scene.surfaces.filter(surface => surface.kind === 'sink');
  if (!source) return scene;

  const pad = 24;
  const gap = 24;
  const top = mode === 'sort' ? 88 : 24;
  const sourceW = Math.round((viewport.width - pad * 2 - gap) * (targets.length > 1 ? 0.44 : 0.52));
  const bodyW = sourceW - SURFACE_INNER_PAD * 2;
  const availableH = Math.max(260, viewport.height - top - pad);
  const bodyH = availableH - WORK_AREA_HEADER_PAD - SURFACE_INNER_PAD;
  // Size the initial grid from the entire set, so removing a card never changes
  // the display size or the remaining cards' positions.
  const columns = clamp(Math.round(Math.sqrt(Math.max(1, cards.length) * bodyW / bodyH)), 1, Math.max(1, Math.floor((bodyW + GRID_GAP) / (88 + GRID_GAP))));
  const rows = Math.max(1, Math.ceil(cards.length / columns));
  const frameW = Math.floor((bodyW - (columns - 1) * GRID_GAP) / columns);
  const frameH = Math.max(96, Math.min(180, Math.floor((bodyH - (rows - 1) * GRID_GAP) / rows)));
  const contentH = Math.max(availableH, WORK_AREA_HEADER_PAD + rows * frameH + (rows - 1) * GRID_GAP + SURFACE_INNER_PAD);
  const targetCols = Math.min(2, Math.max(1, targets.length));
  const targetRows = Math.ceil(targets.length / targetCols);
  const targetW = (viewport.width - pad * 2 - sourceW - gap - (targetCols - 1) * 16) / targetCols;
  const targetH = Math.max(220, (Math.min(contentH, Math.max(480, viewport.height * 0.68)) - Math.max(0, targetRows - 1) * 16) / Math.max(1, targetRows));
  return {
    ...scene,
    canvasH: top + Math.max(contentH, targetRows * targetH + Math.max(0, targetRows - 1) * 16) + pad,
    cardFrame: { w: Math.min(200, frameW), h: frameH, columns },
    surfaces: [
      { ...source, x: pad, y: top, w: sourceW, h: contentH, title: 'Unsorted' },
      ...targets.map((surface, index) => ({
        ...surface,
        x: pad + sourceW + gap + (index % targetCols) * (targetW + 16),
        y: top + Math.floor(index / targetCols) * (targetH + 16),
        w: targetW,
        h: targetH,
        placeholderLabel: undefined,
      })),
    ],
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
  const setupHeaderH = mode === 'setup' ? 52 : 0;
  const contentW = Math.max(656, viewport.width - OUTER_PAD_X * 2);
  const trayH = clamp(Math.round(contentH * 0.22), 156, 190);
  const distributionH = Math.max(416, contentH - trayH - QSORT_SECTION_GAP);
  const canvasW = Math.max(viewport.width, contentW + OUTER_PAD_X * 2);
  const canvasH = Math.max(
    viewport.height,
    topPad + setupHeaderH + trayH + QSORT_SECTION_GAP + distributionH + OUTER_PAD_Y
  );
  const viewportX = 0;
  const leftColumnRect: Rect = {
    x: OUTER_PAD_X,
    y: topPad + setupHeaderH,
    w: contentW,
    h: trayH,
  };
  const distributionRect: Rect = {
    x: OUTER_PAD_X,
    y: topPad + trayH + QSORT_SECTION_GAP,
    w: contentW,
    h: distributionH,
  };
  const laneGap = QSORT_LANE_GAP;
  const laneW = Math.floor((leftColumnRect.w - laneGap) / Math.max(1, qsortWidget.lanes.length));
  const lanes = qsortWidget.lanes.map((lane, index) => ({
    zoneId: lane.id,
    label: lane.label,
    x: leftColumnRect.x + index * (laneW + laneGap),
    y: leftColumnRect.y,
    w: laneW,
    h: leftColumnRect.h,
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
  const bucketTop = distributionRect.y + QSORT_DISTRIBUTION_HEADER_H;
  const bucketH = Math.max(300, distributionRect.h - QSORT_DISTRIBUTION_HEADER_H - 18);
  const slotAreaTop = bucketTop + QSORT_BUCKET_HEADER_H;
  const slotAreaH = Math.max(240, bucketH - QSORT_BUCKET_HEADER_H - 16);
  const slotHeight = clamp(
    Math.floor((slotAreaH - QSORT_SLOT_GAP * Math.max(0, maxCapacity - 1)) / maxCapacity),
    30,
    112
  );
  const baselineY = slotAreaTop;
  const center = (qsortWidget.buckets.length - 1) / 2;
  const buckets = qsortWidget.buckets.map((bucket, index) => {
    const count = countCardsInWidgetZone(cards, stageId, qsortWidget.id, bucket.id);
    const slots = Array.from({ length: Math.max(0, bucket.capacity) }, (_, slotIndex) => ({
      slotIndex,
      x: bucketStartX + index * (bucketW + QSORT_BUCKET_GAP),
      y: slotAreaTop + slotIndex * (slotHeight + QSORT_SLOT_GAP),
      w: bucketW,
      h: slotHeight,
      occupied: slotIndex < Math.min(count, bucket.capacity),
    }));
    return {
      zoneId: bucket.id,
      label: bucket.label,
      x: bucketStartX + index * (bucketW + QSORT_BUCKET_GAP),
      y: bucketTop,
      w: bucketW,
      h: bucketH,
      count,
      capacity: bucket.capacity,
      capacityLabel: `${count} / ${bucket.capacity}`,
      slots,
      columnHeight: bucketH,
      baselineY,
      isCenter: Math.abs(index - center) <= 0.5,
      isExtreme: index === 0 || index === qsortWidget.buckets.length - 1,
      state: activeDropState(activeDrop, qsortWidget.id, bucket.id),
    } satisfies QSortBucketSurfaceView;
  });

  return {
    stageKind,
    canvasW,
    canvasH,
    viewportX,
    surfaces: [
      {
        kind: 'qsort-stage',
        surfaceId: `qsort-stage-${qsortWidget.id}`,
        stageId,
        widgetId: qsortWidget.id,
        x: leftColumnRect.x,
        y: topPad,
        w: contentW,
        h: distributionRect.y + distributionRect.h - topPad,
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

// Earlier recordings retain the shelf layout and its original card geometry.
function buildQSortGridScene(
  scene: StageSurfaceScene,
  workflow: SortWorkflowData,
  cards: CardData[],
  mode: Mode,
  viewport: { width: number; height: number }
): StageSurfaceScene {
  const surface = scene.surfaces.find((entry): entry is QSortCanvasSurfaceView => entry.kind === 'qsort-stage');
  if (!surface) return scene;
  const pad = 24;
  const gap = 8;
  const top = mode === 'setup' ? 20 : 84;
  const width = Math.max(672, viewport.width - pad * 2);
  const laneW = Math.floor((width - QSORT_LANE_GAP * (surface.lanes.length - 1)) / surface.lanes.length);
  const columns = Math.max(1, Math.floor((laneW - 24 + gap) / 92));
  const cellW = Math.floor((laneW - 24 - gap * (columns - 1)) / columns);
  const cellH = clamp(Math.round(cellW * 0.9), 68, 88);
  const presort = workflow.widgets.find((entry): entry is PreSortWidgetData => entry.kind === 'pre-sort');
  // Keep each card's tray place when others are ranked. The pre-sort assignment
  // remains in the recording even after its Q-Sort assignment changes.
  const lanePools = surface.lanes.map((lane, laneIndex) => cards.filter((card, cardIndex) => {
    const homeZone = presort && card.widgetAssignments?.[presort.stageId]?.zoneId;
    const homeIndex = presort?.zones.findIndex(zone => zone.id === homeZone) ?? -1;
    const current = card.widgetAssignments?.[surface.stageId];
    return (homeIndex < 0 ? cardIndex % surface.lanes.length : homeIndex) === laneIndex ||
      (current?.widgetId === surface.widgetId && current.zoneId === lane.zoneId);
  }).map(card => card.id));
  const rows = Math.max(1, ...lanePools.map(pool => Math.ceil(pool.length / columns)));
  const trayH = 40 + rows * cellH + (rows - 1) * gap + 12;
  const leftColumnRect = { x: pad, y: top + (mode === 'setup' ? 52 : 0), w: width, h: trayH };
  const lanes = surface.lanes.map((lane, index) => ({
    ...lane, x: pad + index * (laneW + QSORT_LANE_GAP), y: leftColumnRect.y, w: laneW, h: trayH,
    grid: { columns, cellW, cellH, cardIds: lanePools[index] },
  }));
  const distributionY = leftColumnRect.y + trayH + 20;
  const maxCapacity = Math.max(1, ...surface.buckets.map(bucket => bucket.capacity));
  const bucketW = Math.floor((width - QSORT_BUCKET_GAP * (surface.buckets.length - 1)) / surface.buckets.length);
  const headerH = 44;
  const bucketHeaderH = 48;
  const slotH = clamp(Math.floor((viewport.height - distributionY - headerH - bucketHeaderH - pad - gap * (maxCapacity - 1)) / maxCapacity), 88, 112);
  const bucketY = distributionY + headerH;
  const buckets = surface.buckets.map((bucket, index) => {
    const x = pad + index * (bucketW + QSORT_BUCKET_GAP);
    const slots = bucket.slots.map(slot => ({
      ...slot, x, y: bucketY + bucketHeaderH + slot.slotIndex * (slotH + gap), w: bucketW, h: slotH,
    }));
    const h = bucketHeaderH + bucket.capacity * (slotH + gap) - (bucket.capacity ? gap : 0);
    return { ...bucket, x, y: bucketY, w: bucketW, h, columnHeight: h, baselineY: bucketY + bucketHeaderH, slots };
  });
  const distributionRect = { x: pad, y: distributionY, w: width, h: headerH + Math.max(...buckets.map(bucket => bucket.h)) };
  return {
    ...scene,
    canvasW: Math.max(viewport.width, width + pad * 2),
    canvasH: Math.max(viewport.height, distributionY + distributionRect.h + pad),
    surfaces: [{ ...surface, layoutVersion: 3, x: pad, y: top, w: width,
      h: distributionY + distributionRect.h - top, leftColumnRect, distributionRect,
      baselineY: bucketY + bucketHeaderH, lanes, buckets }],
  };
}

export function buildStageSurfaceScene(
  workflow: SortWorkflowData,
  stageId: string,
  cards: CardData[],
  selectedWidgetId: string | null,
  mode: Mode,
  viewportInput: { width: number; height: number },
  activeDrop?: { widgetId: string; zoneId: string; state: WidgetDropState } | null,
  layoutVersion: 1 | 2 | 3 = 3
): StageSurfaceScene {
  const stageKind = getStageById(workflow, stageId)?.kind || 'closed-sort';
  const viewport = getViewportSize(viewportInput);
  if (stageKind !== 'qsort' && layoutVersion !== 1) {
    viewport.width = Math.max(560, Math.round(viewportInput.width || 1200));
  }
  if (stageKind === 'qsort') {
    const scene = buildQSortScene(workflow, stageId, cards, selectedWidgetId, mode, viewport, activeDrop);
    return layoutVersion === 3 ? buildQSortGridScene(scene, workflow, cards, mode, viewport) : scene;
  }
  return (layoutVersion === 1 ? buildLegacyClosedOrPreSortScene : buildClosedOrPreSortScene)(workflow, stageId, cards, selectedWidgetId, mode, viewport, activeDrop);
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

function fitCardDimensions(bounds: CardBounds, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / Math.max(1, bounds.w), maxH / Math.max(1, bounds.h));
  return {
    w: Math.max(1, Math.round(bounds.w * scale)),
    h: Math.max(1, Math.round(bounds.h * scale)),
  };
}

export function getSurfaceCardDimensions(card: CardData, scene: StageSurfaceScene | null | undefined, getBounds: (card: CardData) => CardBounds) {
  const full = getBounds(card);
  return scene?.cardFrame ? fitCardDimensions(full, scene.cardFrame.w, scene.cardFrame.h) : { w: full.w, h: full.h };
}

export function getQSortCardDisplayDimensions(
  card: CardData,
  surface: QSortCanvasSurfaceView,
  getBounds: (card: CardData) => CardBounds
) {
  const full = getBounds(card);
  const assignment = card.widgetAssignments?.[surface.stageId];
  if (!assignment || assignment.widgetId !== surface.widgetId) {
    return { w: full.w, h: full.h };
  }

  const lane = surface.lanes.find((entry) => entry.zoneId === assignment.zoneId);
  if (lane?.grid) return fitCardDimensions(full, lane.grid.cellW - 4, lane.grid.cellH - 4);
  if (lane) {
    const maxW = clamp(Math.round(lane.w * 0.2), 96, 132);
    const maxH = Math.max(54, lane.h - QSORT_LANE_HEADER_PAD - 18);
    return fitCardDimensions(full, maxW, maxH);
  }

  const bucket = surface.buckets.find((entry) => entry.zoneId === assignment.zoneId);
  const slot = bucket?.slots[0];
  if (slot) {
    return fitCardDimensions(full, Math.max(24, slot.w - 12), Math.max(16, slot.h - 10));
  }
  return fitCardDimensions(full, 72, 48);
}

function layoutCardsAsShelf(cards: CardData[], rect: Rect, getBounds: (card: CardData) => CardBounds) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const dimensions = cards.map((card) => getBounds(card));
  const maxW = Math.max(...dimensions.map((entry) => entry.w));
  const availableSpreadX = Math.max(0, rect.w - maxW);
  const stepX = cards.length > 1 ? Math.min(maxW + 10, availableSpreadX / (cards.length - 1)) : 0;
  const spreadX = Math.max(0, (cards.length - 1) * stepX);
  const startX = rect.x + Math.max(0, Math.round((rect.w - maxW - spreadX) / 2));
  const next = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    const dims = dimensions[index]!;
    next.set(card.id, {
      x: Math.round(startX + index * stepX),
      y: Math.round(rect.y + Math.max(0, (rect.h - dims.h) / 2)),
    });
  });
  return next;
}

export function layoutCardsInWorkArea(cards: CardData[], rect: Rect, getBounds: (card: CardData) => CardBounds, frame?: StageSurfaceScene['cardFrame']) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const bodyRect = insetRect(rect, {
    top: WORK_AREA_HEADER_PAD,
    right: SURFACE_INNER_PAD,
    bottom: SURFACE_INNER_PAD,
    left: SURFACE_INNER_PAD,
  });
  const { maxW, maxH } = maxCardSize(cards, getBounds);
  const usableW = Math.max(1, bodyRect.w);
  const cols = frame?.columns || Math.max(1, Math.floor((usableW + GRID_GAP) / (maxW + GRID_GAP)));
  const cellW = (usableW - (cols - 1) * GRID_GAP) / cols;
  const rowHeight = frame?.h || maxH;
  const next = new Map<string, { x: number; y: number }>();
  cards.forEach((card, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const dims = getBounds(card);
    next.set(card.id, {
      x: Math.round(bodyRect.x + col * (cellW + GRID_GAP) + (cellW - dims.w) / 2),
      y: Math.round(bodyRect.y + row * (rowHeight + GRID_GAP) + (rowHeight - dims.h) / 2),
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
  mode: Mode,
  layoutVersion: 1 | 2 | 3 = 3
) {
  const scene = buildStageSurfaceScene(workflow, stageId, cards, null, mode, viewportInput, null, layoutVersion);
  const nextById = new Map(cards.map((card) => [card.id, card]));
  let changed = false;
  const setPosition = (card: CardData, pos: { x: number; y: number } | undefined) => {
    if (!pos || (card.x === pos.x && card.y === pos.y)) return;
    nextById.set(card.id, { ...card, x: pos.x, y: pos.y });
    changed = true;
  };
  const stageKind = scene.stageKind;
  if (stageKind === 'closed-sort' || stageKind === 'presort') {
    const displayBounds = (card: CardData) => ({ x: card.x, y: card.y, ...getSurfaceCardDimensions(card, scene, getBounds) });
    const workArea = scene.surfaces.find((surface): surface is WorkAreaSurfaceView => surface.kind === 'work-area');
    if (workArea) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, workArea.widgetId, WIDGET_ZONE_CONTENT);
      const layout = layoutCardsInWorkArea(zoneCards, workArea, displayBounds, scene.cardFrame);
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
      const layout = layoutCardsInSink(zoneCards, surface, displayBounds, layoutMode);
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
    return changed ? cards.map((card) => nextById.get(card.id) || card) : cards;
  }

  const qsortSurface = scene.surfaces.find((surface): surface is QSortCanvasSurfaceView => surface.kind === 'qsort-stage');
  const qsortWidget = getQSortWidget(workflow, stageId);
  if (qsortSurface && qsortWidget) {
    const getCompactBounds = (card: CardData): CardBounds => {
      const compact = getQSortCardDisplayDimensions(card, qsortSurface, getBounds);
      return { x: card.x, y: card.y, w: compact.w, h: compact.h };
    };
    for (const lane of qsortSurface.lanes) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, qsortWidget.id, lane.zoneId);
      const layout = lane.grid ? new Map(zoneCards.map(card => {
        const grid = lane.grid!;
        const index = grid.cardIds.indexOf(card.id);
        const dims = getCompactBounds(card);
        return [card.id, {
          x: Math.round(lane.x + 12 + (index % grid.columns) * (grid.cellW + 8) + (grid.cellW - dims.w) / 2),
          y: Math.round(lane.y + 40 + Math.floor(index / grid.columns) * (grid.cellH + 8) + (grid.cellH - dims.h) / 2),
        }];
      })) : layoutCardsAsShelf(
        zoneCards,
        insetRect(lane, { top: QSORT_LANE_HEADER_PAD, right: 14, bottom: 14, left: 14 }),
        getCompactBounds
      );
      for (const card of zoneCards) {
        setPosition(card, layout.get(card.id));
      }
    }
    for (const bucket of qsortSurface.buckets) {
      const zoneCards = getCardsInWidgetZone(cards, stageId, qsortWidget.id, bucket.zoneId);
      const layout = layoutCardsInQSortBucketSlots(zoneCards, bucket, getCompactBounds);
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
