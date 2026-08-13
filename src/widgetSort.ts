import type {
  BoardWidgetData,
  CardData,
  CardWidgetAssignment,
  PreSortWidgetData,
  QSortWidgetData,
  SortWorkflowData,
} from './types';
import { clamp } from './utils';
import { WIDGET_ZONE_CONTENT, getWidgetsForStage } from './workflow';

export type CardBounds = { x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };

export type WidgetDropState = 'idle' | 'valid' | 'invalid' | 'full';

export type WidgetDropTarget = {
  widgetId: string;
  widgetKind: BoardWidgetData['kind'];
  zoneId: string;
  zoneKind: 'content' | 'presort-zone' | 'lane' | 'bucket';
};

const HEADER_H = 44;
const PAD_X = 16;
const PAD_Y = 16;
const STACK_STEP_X = 8;
const STACK_STEP_Y = 6;
const DEFAULT_WIDGET_MIN_W = 220;
const DEFAULT_WIDGET_MIN_H = 180;
const QSORT_RAIL_GAP = 18;
const QSORT_DISTRIBUTION_BOTTOM_PAD = 28;
const QSORT_BUCKET_GAP = 12;
const QSORT_SLOT_GAP = 10;
const QSORT_MIN_COLUMN_W = 96;
const QSORT_MIN_SLOT_H = 64;
const QSORT_MIN_RAIL_H = 96;

type QSortSlotLayoutView = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type QSortBucketLayoutView = {
  x: number;
  w: number;
  slots: QSortSlotLayoutView[];
  columnHeight: number;
  baselineY: number;
};

function getAssignment(card: CardData, stageId: string) {
  return card.widgetAssignments?.[stageId];
}

function setAssignment(card: CardData, stageId: string, assignment: CardWidgetAssignment | undefined): CardData {
  const nextAssignments = { ...(card.widgetAssignments || {}) };
  if (assignment) {
    nextAssignments[stageId] = assignment;
  } else {
    delete nextAssignments[stageId];
  }
  return {
    ...card,
    widgetAssignments: Object.keys(nextAssignments).length > 0 ? nextAssignments : undefined,
  };
}

function compareAssignedCards(stageId: string) {
  return (a: CardData, b: CardData) => {
    const aa = getAssignment(a, stageId);
    const bb = getAssignment(b, stageId);
    return (
      (aa?.order ?? Number.MAX_SAFE_INTEGER) - (bb?.order ?? Number.MAX_SAFE_INTEGER) ||
      b.z - a.z ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
    );
  };
}

export function getCardsInWidgetZone(cards: CardData[], stageId: string, widgetId: string, zoneId: string) {
  return cards
    .filter((card) => {
      const assignment = getAssignment(card, stageId);
      return assignment?.widgetId === widgetId && assignment.zoneId === zoneId;
    })
    .sort(compareAssignedCards(stageId));
}

export function countCardsInWidgetZone(cards: CardData[], stageId: string, widgetId: string, zoneId: string) {
  let count = 0;
  for (const card of cards) {
    const assignment = getAssignment(card, stageId);
    if (assignment?.widgetId === widgetId && assignment.zoneId === zoneId) {
      count += 1;
    }
  }
  return count;
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

export function layoutCardsInQSortBucketSlots(
  cards: CardData[],
  bucket: QSortBucketLayoutView,
  getBounds: (card: CardData) => CardBounds
) {
  if (cards.length === 0) return new Map<string, { x: number; y: number }>();
  const next = new Map<string, { x: number; y: number }>();
  const slottedCount = Math.min(cards.length, bucket.slots.length);
  for (let index = 0; index < slottedCount; index += 1) {
    const card = cards[index];
    const slot = bucket.slots[index];
    const bounds = getBounds(card);
    next.set(card.id, {
      x: Math.round(slot.x + Math.max(0, (slot.w - bounds.w) / 2)),
      y: Math.round(slot.y + Math.max(0, (slot.h - bounds.h) / 2)),
    });
  }
  const overflowCards = cards.slice(slottedCount);
  if (overflowCards.length > 0) {
    const { maxW, maxH } = maxCardSize(overflowCards, getBounds);
    const startX = bucket.x + Math.max(0, Math.round((bucket.w - maxW) / 2));
    const startY = Math.round(bucket.baselineY - bucket.columnHeight - Math.min(18, Math.round(maxH * 0.2)));
    overflowCards.forEach((card, index) => {
      next.set(card.id, {
        x: Math.round(startX + index * STACK_STEP_X),
        y: Math.round(startY + index * STACK_STEP_Y - maxH),
      });
    });
  }
  return next;
}

export function validateWidgetDrop(
  workflow: SortWorkflowData,
  stageId: string,
  target: WidgetDropTarget,
  card: CardData,
  cards: CardData[]
): { accepted: boolean; state: WidgetDropState } {
  const widget = workflow.widgets.find((entry) => entry.id === target.widgetId && entry.stageId === stageId);
  if (!widget) return { accepted: false, state: 'invalid' };
  if (widget.kind === 'source' || widget.kind === 'pre-sort') return { accepted: true, state: 'valid' };
  if (widget.kind === 'category') {
    const tags = new Set((card.meta.tags || []).map((tag) => tag.trim().toLowerCase()).filter(Boolean));
    if (widget.allowedTags.length > 0) {
      const hasMatch = widget.allowedTags.some((tag) => tags.has(tag.trim().toLowerCase()));
      if (!hasMatch) return { accepted: false, state: 'invalid' };
    }
    if (widget.capacityMode === 'limited') {
      const count = countCardsInWidgetZone(cards, stageId, widget.id, WIDGET_ZONE_CONTENT);
      const assignment = getAssignment(card, stageId);
      const isAlreadyHere = assignment?.widgetId === widget.id && assignment.zoneId === WIDGET_ZONE_CONTENT;
      if (!isAlreadyHere && count >= (widget.capacity ?? 1)) {
        return { accepted: false, state: 'full' };
      }
    }
    return { accepted: true, state: 'valid' };
  }
  if (widget.kind === 'qsort') {
    if (target.zoneKind === 'lane') return { accepted: true, state: 'valid' };
    const bucket = widget.buckets.find((entry) => entry.id === target.zoneId);
    if (!bucket) return { accepted: false, state: 'invalid' };
    const count = countCardsInWidgetZone(cards, stageId, widget.id, bucket.id);
    const assignment = getAssignment(card, stageId);
    const isAlreadyHere = assignment?.widgetId === widget.id && assignment.zoneId === bucket.id;
    if (!isAlreadyHere && count >= bucket.capacity) {
      return { accepted: false, state: 'full' };
    }
    return { accepted: true, state: 'valid' };
  }
  return { accepted: false, state: 'invalid' };
}

export function assignCardsToWidgetZone(
  cards: CardData[],
  stageId: string,
  widgetId: string,
  zoneId: string,
  cardIds: string[],
  options?: { insertAt?: 'front' | 'back' }
) {
  const movedIdSet = new Set(cardIds);
  const existing = cards
    .filter((card) => {
      const assignment = getAssignment(card, stageId);
      return assignment?.widgetId === widgetId && assignment.zoneId === zoneId && !movedIdSet.has(card.id);
    })
    .sort(compareAssignedCards(stageId))
    .map((card) => card.id);
  const orderedIds = options?.insertAt === 'back' ? [...existing, ...cardIds] : [...cardIds, ...existing];
  const orderById = new Map<string, number>();
  orderedIds.forEach((id, index) => orderById.set(id, index));
  return cards.map((card) => {
    if (!movedIdSet.has(card.id) && !orderById.has(card.id)) return card;
    if (movedIdSet.has(card.id)) {
      return setAssignment(card, stageId, {
        widgetId,
        zoneId,
        order: orderById.get(card.id) ?? 0,
      });
    }
    const assignment = getAssignment(card, stageId);
    if (assignment?.widgetId === widgetId && assignment.zoneId === zoneId) {
      return setAssignment(card, stageId, {
        widgetId,
        zoneId,
        order: orderById.get(card.id) ?? assignment.order,
      });
    }
    return card;
  });
}

export function assignUnassignedCardsToWidgetZone(
  cards: CardData[],
  stageId: string,
  widgetId: string,
  zoneId = WIDGET_ZONE_CONTENT
) {
  const missingIds = cards.filter((card) => !getAssignment(card, stageId)).map((card) => card.id);
  if (missingIds.length === 0) return cards;
  return assignCardsToWidgetZone(cards, stageId, widgetId, zoneId, missingIds, { insertAt: 'back' });
}

export function moveAssignedCardsToWidgetZone(
  cards: CardData[],
  stageId: string,
  fromWidgetId: string,
  widgetId: string,
  zoneId = WIDGET_ZONE_CONTENT
) {
  const movedIds = cards
    .filter((card) => getAssignment(card, stageId)?.widgetId === fromWidgetId)
    .sort(compareAssignedCards(stageId))
    .map((card) => card.id);
  if (movedIds.length === 0) return cards;
  return assignCardsToWidgetZone(cards, stageId, widgetId, zoneId, movedIds, { insertAt: 'back' });
}

export function seedStageAssignments(
  cards: CardData[],
  stageId: string,
  widgetId: string,
  zoneId = WIDGET_ZONE_CONTENT
) {
  return cards.map((card, index) =>
    setAssignment(card, stageId, {
      widgetId,
      zoneId,
      order: index,
    })
  );
}

export function transitionPreSortToQSort(
  cards: CardData[],
  presortStageId: string,
  qsortStageId: string,
  presortWidget: PreSortWidgetData,
  qsortWidget: QSortWidgetData
) {
  const zoneB = presortWidget.zones[1]?.id;
  const laneA = qsortWidget.lanes[0]?.id;
  const laneB = qsortWidget.lanes[1]?.id;
  const orderByZone = new Map<string, number>();
  return cards.map((card) => {
    const assignment = getAssignment(card, presortStageId);
    if (!assignment) return card;
    const laneId = assignment.zoneId === zoneB ? laneB : laneA;
    if (!laneId) return card;
    const orderKey = `${qsortWidget.id}:${laneId}`;
    const nextOrder = orderByZone.get(orderKey) ?? 0;
    orderByZone.set(orderKey, nextOrder + 1);
    return setAssignment(card, qsortStageId, {
      widgetId: qsortWidget.id,
      zoneId: laneId,
      order: nextOrder,
    });
  });
}

export function isStageComplete(workflow: SortWorkflowData, stageId: string, cards: CardData[]) {
  const widgets = getWidgetsForStage(workflow, stageId);
  for (const widget of widgets) {
    if (widget.kind === 'source') {
      if (countCardsInWidgetZone(cards, stageId, widget.id, WIDGET_ZONE_CONTENT) > 0) return false;
    }
    if (widget.kind === 'qsort') {
      for (const lane of widget.lanes) {
        if (countCardsInWidgetZone(cards, stageId, widget.id, lane.id) > 0) return false;
      }
      for (const bucket of widget.buckets) {
        if (countCardsInWidgetZone(cards, stageId, widget.id, bucket.id) > bucket.capacity) return false;
      }
    }
  }
  return true;
}

export function visibleCardsForStage(cards: CardData[], workflow: SortWorkflowData, stageId: string) {
  const widgets = getWidgetsForStage(workflow, stageId);
  const widgetIds = new Set(widgets.map((widget) => widget.id));
  return cards.filter((card) => {
    const assignment = getAssignment(card, stageId);
    return !!assignment && widgetIds.has(assignment.widgetId);
  });
}

export function clampWidgetRect(
  rect: Rect,
  boardW: number,
  boardH: number,
  minW = DEFAULT_WIDGET_MIN_W,
  minH = DEFAULT_WIDGET_MIN_H
) {
  const w = Math.max(minW, Math.round(rect.w));
  const h = Math.max(minH, Math.round(rect.h));
  return {
    x: clamp(Math.round(rect.x), 0, Math.max(0, boardW - w)),
    y: clamp(Math.round(rect.y), 0, Math.max(0, boardH - h)),
    w: boardW > 0 ? Math.min(w, boardW) : w,
    h: boardH > 0 ? Math.min(h, boardH) : h,
  };
}

export function getMinimumWidgetSize(widget: BoardWidgetData) {
  if (widget.kind !== 'qsort') {
    return {
      minW: DEFAULT_WIDGET_MIN_W,
      minH: DEFAULT_WIDGET_MIN_H,
    };
  }
  const bucketCount = Math.max(1, widget.buckets.length);
  const maxCapacity = Math.max(1, ...widget.buckets.map((bucket) => Math.max(0, bucket.capacity)));
  return {
    minW: PAD_X * 2 + bucketCount * QSORT_MIN_COLUMN_W + Math.max(0, bucketCount - 1) * QSORT_BUCKET_GAP,
    minH:
      HEADER_H +
      PAD_Y * 2 +
      QSORT_MIN_RAIL_H +
      QSORT_RAIL_GAP +
      maxCapacity * QSORT_MIN_SLOT_H +
      Math.max(0, maxCapacity - 1) * QSORT_SLOT_GAP +
      QSORT_DISTRIBUTION_BOTTOM_PAD,
  };
}
