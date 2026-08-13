import { nanoid } from 'nanoid';
import type {
  BoardWidgetData,
  CardData,
  CategoryWidgetData,
  ClosedContainerData,
  PreSortWidgetData,
  QSortBucketData,
  QSortWidgetData,
  SortStageData,
  SortTemplateId,
  SortWorkflowData,
  SourceWidgetData,
} from './types';

const DEFAULT_SOURCE_W = 420;
const DEFAULT_SOURCE_H = 260;
const DEFAULT_CATEGORY_W = 300;
const DEFAULT_CATEGORY_H = 220;
const DEFAULT_PRESORT_W = 560;
const DEFAULT_PRESORT_H = 320;
const DEFAULT_QSORT_W = 1040;
const DEFAULT_QSORT_H = 620;
const BOARD_PAD = 48;

export const WIDGET_ZONE_CONTENT = 'content';

function clampWidth(width: number, min: number, boardW: number) {
  const available = Math.max(min, boardW - BOARD_PAD * 2);
  return Math.max(min, Math.min(width, available));
}

function clampHeight(height: number, min: number, boardH: number) {
  const available = Math.max(min, boardH - BOARD_PAD * 2);
  return Math.max(min, Math.min(height, available));
}

function stageName(kind: SortStageData['kind']) {
  if (kind === 'closed-sort') return 'Closed sort';
  if (kind === 'presort') return 'Pre-Sort';
  return 'Q-Sort';
}

export function getFirstStageId(workflow: SortWorkflowData | null | undefined) {
  const firstStage = workflow?.stages.slice().sort((a, b) => a.order - b.order)[0];
  return firstStage?.id || null;
}

export function getStageById(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  if (!workflow || !stageId) return null;
  return workflow.stages.find((stage) => stage.id === stageId) || null;
}

export function getWidgetsForStage(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  if (!workflow || !stageId) return [] as BoardWidgetData[];
  return workflow.widgets
    .filter((widget) => widget.stageId === stageId)
    .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function cloneWorkflow(workflow: SortWorkflowData): SortWorkflowData {
  return {
    templateId: workflow.templateId,
    stages: workflow.stages.map((stage) => ({ ...stage })),
    widgets: workflow.widgets.map((widget) => JSON.parse(JSON.stringify(widget)) as BoardWidgetData),
  };
}

function createStage(kind: SortStageData['kind'], order: number): SortStageData {
  return {
    id: nanoid(),
    kind,
    name: stageName(kind),
    order,
  };
}

function centeredRect(boardW: number, boardH: number, width: number, height: number) {
  const w = clampWidth(width, Math.min(width, 220), boardW);
  const h = clampHeight(height, Math.min(height, 180), boardH);
  return {
    x: Math.max(BOARD_PAD, Math.round((boardW - w) / 2)),
    y: Math.max(BOARD_PAD, Math.round((boardH - h) / 2)),
    w,
    h,
  };
}

function nextWidgetBase(
  kind: 'source',
  stageId: string,
  title: string,
  rect: { x: number; y: number; w: number; h: number },
  z?: number
): Omit<SourceWidgetData, 'layout'>;
function nextWidgetBase(
  kind: 'category',
  stageId: string,
  title: string,
  rect: { x: number; y: number; w: number; h: number },
  z?: number
): Omit<CategoryWidgetData, 'description' | 'capacityMode' | 'capacity' | 'allowedTags' | 'layout'>;
function nextWidgetBase(
  kind: 'pre-sort',
  stageId: string,
  title: string,
  rect: { x: number; y: number; w: number; h: number },
  z?: number
): Omit<PreSortWidgetData, 'zones'>;
function nextWidgetBase(
  kind: 'qsort',
  stageId: string,
  title: string,
  rect: { x: number; y: number; w: number; h: number },
  z?: number
): Omit<QSortWidgetData, 'lanes' | 'buckets'>;
function nextWidgetBase(
  kind: BoardWidgetData['kind'],
  stageId: string,
  title: string,
  rect: { x: number; y: number; w: number; h: number },
  z = 10
) {
  return {
    id: nanoid(),
    kind,
    stageId,
    title,
    createdAt: Date.now(),
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z,
  };
}

export function buildNormalDistributionBuckets(cardCount: number, bucketCount = 7): QSortBucketData[] {
  const safeBucketCount = Math.max(3, bucketCount | 0);
  const center = (safeBucketCount - 1) / 2;
  const weights = Array.from({ length: safeBucketCount }, (_, index) => {
    const distance = Math.abs(index - center);
    return Math.max(0.6, safeBucketCount / 2 - distance + 0.6);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (cardCount <= 0 ? 0 : (weight / totalWeight) * cardCount));
  const base = raw.map((value) => Math.floor(value));
  let remainder = Math.max(0, cardCount - base.reduce((sum, value) => sum + value, 0));
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || Math.abs(a.index - center) - Math.abs(b.index - center));
  for (const item of order) {
    if (remainder <= 0) break;
    base[item.index] += 1;
    remainder -= 1;
  }
  return base.map((capacity, index) => ({
    id: `bucket-${index + 1}`,
    label: `${index - Math.floor(safeBucketCount / 2)}`,
    capacity,
  }));
}

export function createClosedWorkflow(boardW: number, boardH: number): SortWorkflowData {
  const stage = createStage('closed-sort', 0);
  const sourceH = clampHeight(DEFAULT_SOURCE_H, 220, boardH);
  const sourceW = clampWidth(DEFAULT_SOURCE_W, 260, boardW);
  const sourceRect = {
    x: BOARD_PAD,
    y: Math.max(BOARD_PAD, boardH - sourceH - BOARD_PAD),
    w: sourceW,
    h: sourceH,
  };
  const categoryRect = {
    x: Math.min(boardW - DEFAULT_CATEGORY_W - BOARD_PAD, sourceRect.x + sourceRect.w + 96),
    y: BOARD_PAD + 32,
    w: clampWidth(DEFAULT_CATEGORY_W, 240, boardW),
    h: clampHeight(DEFAULT_CATEGORY_H, 180, boardH),
  };
  const source: SourceWidgetData = {
    ...nextWidgetBase('source', stage.id, 'Source', sourceRect, 10),
    layout: 'stack' as const,
  };
  const category: CategoryWidgetData = {
    ...nextWidgetBase('category', stage.id, 'Category 1', categoryRect, 11),
    description: '',
    capacityMode: 'unlimited' as const,
    capacity: undefined,
    allowedTags: [],
    layout: 'fan' as const,
  };
  return {
    templateId: 'closed',
    stages: [stage],
    widgets: [source, category],
  };
}

export function createQSortWorkflow(boardW: number, boardH: number, cardCount = 0): SortWorkflowData {
  const presort = createStage('presort', 0);
  const qsort = createStage('qsort', 1);
  const sourceRect = {
    x: BOARD_PAD,
    y: Math.max(BOARD_PAD, boardH - clampHeight(DEFAULT_SOURCE_H, 220, boardH) - BOARD_PAD),
    w: clampWidth(DEFAULT_SOURCE_W, 260, boardW),
    h: clampHeight(DEFAULT_SOURCE_H, 220, boardH),
  };
  const presortRect = {
    x: Math.min(boardW - DEFAULT_PRESORT_W - BOARD_PAD, sourceRect.x + sourceRect.w + 96),
    y: BOARD_PAD + 24,
    w: clampWidth(DEFAULT_PRESORT_W, 360, boardW),
    h: clampHeight(DEFAULT_PRESORT_H, 240, boardH),
  };
  const qsortRect = centeredRect(boardW, boardH, DEFAULT_QSORT_W, DEFAULT_QSORT_H);
  const laneA = { id: 'lane-a', label: '+' };
  const laneB = { id: 'lane-b', label: '-' };
  const buckets = buildNormalDistributionBuckets(cardCount || 15, 7);
  const source: SourceWidgetData = {
    ...nextWidgetBase('source', presort.id, 'Source', sourceRect, 10),
    layout: 'stack',
  };
  const preSortWidget: PreSortWidgetData = {
    ...nextWidgetBase('pre-sort', presort.id, 'Pre-Sort', presortRect, 11),
    zones: [laneA, laneB],
  };
  const qSortWidget: QSortWidgetData = {
    ...nextWidgetBase('qsort', qsort.id, 'Q-Sort', qsortRect, 10),
    lanes: [laneA, laneB],
    buckets,
  };
  return {
    templateId: 'qsort',
    stages: [presort, qsort],
    widgets: [source, preSortWidget, qSortWidget],
  };
}

export function createWorkflowForTemplate(
  templateId: SortTemplateId,
  boardW: number,
  boardH: number,
  cardCount = 0
): SortWorkflowData {
  if (templateId === 'closed') return createClosedWorkflow(boardW, boardH);
  if (templateId === 'qsort') return createQSortWorkflow(boardW, boardH, cardCount);
  return {
    templateId: 'open',
    stages: [],
    widgets: [],
  } satisfies SortWorkflowData;
}

export function migrateLegacyClosedContainersToWorkflow(closedContainers: ClosedContainerData[]): SortWorkflowData {
  const stage = createStage('closed-sort', 0);
  const widgets: BoardWidgetData[] = closedContainers.map((container, index) => {
    if (container.kind === 'source') {
      return {
        id: container.id,
        kind: 'source' as const,
        stageId: stage.id,
        title: container.name,
        createdAt: container.createdAt,
        x: container.x,
        y: container.y,
        w: container.w,
        h: container.h,
        z: 10 + index,
        layout: container.layout,
      };
    }
    return {
      id: container.id,
      kind: 'category' as const,
      stageId: stage.id,
      title: container.name,
      createdAt: container.createdAt,
      x: container.x,
      y: container.y,
      w: container.w,
      h: container.h,
      z: 10 + index,
      description: container.description,
      capacityMode: container.capacityMode,
      capacity: container.capacity,
      allowedTags: [...container.allowedTags],
      layout: container.layout,
    };
  });
  return {
    templateId: 'closed',
    stages: [stage],
    widgets,
  };
}

export function migrateLegacyClosedCardAssignments(
  cards: CardData[],
  closedContainers: ClosedContainerData[],
  stageId: string
) {
  const sourceId = closedContainers.find((container) => container.kind === 'source')?.id;
  return cards.map((card) => {
    const widgetId = card.closedContainerId || sourceId;
    if (!widgetId) return card;
    return {
      ...card,
      widgetAssignments: {
        ...(card.widgetAssignments || {}),
        [stageId]: {
          widgetId,
          zoneId: WIDGET_ZONE_CONTENT,
          order: card.closedContainerOrder ?? 0,
        },
      },
    };
  });
}

export function toLegacyClosedContainers(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  const widgets = getWidgetsForStage(workflow, stageId);
  const targets = widgets.filter((widget): widget is CategoryWidgetData => widget.kind === 'category');
  return widgets
    .filter((widget): widget is SourceWidgetData | CategoryWidgetData => widget.kind === 'source' || widget.kind === 'category')
    .map((widget) => {
      if (widget.kind === 'source') {
        return {
          id: widget.id,
          kind: 'source' as const,
          name: widget.title,
          createdAt: widget.createdAt,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          layout: widget.layout,
        };
      }
      const rowOrder = targets.findIndex((target) => target.id === widget.id);
      return {
        id: widget.id,
        kind: 'target' as const,
        name: widget.title,
        createdAt: widget.createdAt,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        rowOrder: Math.max(0, rowOrder),
        description: widget.description,
        visibleInSort: true,
        capacityMode: widget.capacityMode,
        capacity: widget.capacity,
        allowedTags: [...widget.allowedTags],
        layout: widget.layout,
      };
    });
}

export function projectClosedCardsForStage(cards: CardData[], stageId: string) {
  return cards.map((card) => {
    const assignment = card.widgetAssignments?.[stageId];
    return {
      ...card,
      closedContainerId: assignment?.widgetId,
      closedContainerOrder: assignment?.order,
    };
  });
}

export function getDefaultActiveStageId(workflow: SortWorkflowData | null | undefined) {
  return getFirstStageId(workflow);
}

export function getTemplateLabel(templateId: SortTemplateId) {
  if (templateId === 'closed') return 'Closed sort';
  if (templateId === 'qsort') return 'Q-Sort';
  return 'Open sort';
}

export function getClosedCategoryWidgets(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  return getWidgetsForStage(workflow, stageId).filter((widget): widget is CategoryWidgetData => widget.kind === 'category');
}

export function getSourceWidget(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  return getWidgetsForStage(workflow, stageId).find((widget): widget is SourceWidgetData => widget.kind === 'source') || null;
}

export function getSeedSourceWidget(workflow: SortWorkflowData | null | undefined, preferredStageId?: string | null) {
  if (!workflow) return null;
  const preferredSource = preferredStageId ? getSourceWidget(workflow, preferredStageId) : null;
  if (preferredSource && preferredStageId) {
    return {
      stageId: preferredStageId,
      widget: preferredSource,
    };
  }
  const orderedStages = workflow.stages.slice().sort((a, b) => a.order - b.order);
  for (const stage of orderedStages) {
    const source = getSourceWidget(workflow, stage.id);
    if (source) {
      return {
        stageId: stage.id,
        widget: source,
      };
    }
  }
  return null;
}

export function getQSortWidget(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  return getWidgetsForStage(workflow, stageId).find((widget): widget is QSortWidgetData => widget.kind === 'qsort') || null;
}

export function isWorkflowConfiguredForSorting(workflow: SortWorkflowData | null | undefined, templateId: SortTemplateId) {
  if (templateId === 'open') return true;
  if (!workflow) return false;
  if (templateId === 'closed') {
    const stageId = getFirstStageId(workflow);
    return !!getSourceWidget(workflow, stageId) && getClosedCategoryWidgets(workflow, stageId).length > 0;
  }
  const stages = workflow.stages;
  if (stages.length < 2) return false;
  const presort = stages.find((stage) => stage.kind === 'presort');
  const qsort = stages.find((stage) => stage.kind === 'qsort');
  return !!presort && !!qsort && !!getSourceWidget(workflow, presort.id) && !!getQSortWidget(workflow, qsort.id);
}

export function getNextStageId(workflow: SortWorkflowData | null | undefined, stageId: string | null | undefined) {
  if (!workflow || !stageId) return null;
  const ordered = workflow.stages.slice().sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((stage) => stage.id === stageId);
  if (index < 0) return null;
  return ordered[index + 1]?.id || null;
}

export function addClosedCategoryWidget(
  workflow: SortWorkflowData,
  stageId: string,
  boardW: number,
  boardH: number
) {
  const stageWidgets = getWidgetsForStage(workflow, stageId);
  const categories = stageWidgets.filter((widget): widget is CategoryWidgetData => widget.kind === 'category');
  const source = stageWidgets.find((widget): widget is SourceWidgetData => widget.kind === 'source') || null;
  const nextIndex = categories.length + 1;
  const nextWidget: CategoryWidgetData = {
    ...nextWidgetBase(
      'category',
      stageId,
      `Category ${nextIndex}`,
      {
        x: Math.min(
          Math.max(BOARD_PAD, (source?.x || BOARD_PAD) + (source?.w || DEFAULT_SOURCE_W) + 96 + categories.length * 28),
          Math.max(BOARD_PAD, boardW - DEFAULT_CATEGORY_W - BOARD_PAD)
        ),
        y: Math.min(BOARD_PAD + 32 + categories.length * 28, Math.max(BOARD_PAD, boardH - DEFAULT_CATEGORY_H - BOARD_PAD)),
        w: clampWidth(DEFAULT_CATEGORY_W, 240, boardW),
        h: clampHeight(DEFAULT_CATEGORY_H, 180, boardH),
      },
      10 + stageWidgets.length
    ),
    description: '',
    capacityMode: 'unlimited',
    capacity: undefined,
    allowedTags: [],
    layout: 'fan',
  };
  return {
    ...workflow,
    widgets: [...workflow.widgets, nextWidget],
  };
}

export function removeWidgetFromWorkflow(workflow: SortWorkflowData, widgetId: string) {
  return {
    ...workflow,
    widgets: workflow.widgets.filter((widget) => widget.id !== widgetId),
  };
}

export function patchWorkflowWidget(
  workflow: SortWorkflowData,
  widgetId: string,
  patch: Partial<BoardWidgetData>
) {
  return {
    ...workflow,
    widgets: workflow.widgets.map((widget) =>
      widget.id === widgetId ? { ...widget, ...patch } as BoardWidgetData : widget
    ),
  };
}
