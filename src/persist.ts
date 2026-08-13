import { nanoid } from 'nanoid';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  TEXT_CARD_COLOR_KEYS,
  type BoardWidgetData,
  type CardData,
  type CardLayoutMode,
  type CardMetadataV1,
  type CardWidgetAssignmentsByStage,
  type ClosedContainerLayout,
  type ClosedContainerData,
  type ClosedTargetData,
  type RecordingSession,
  type SortStageData,
  type SortTemplateId,
  type SortWorkflowData,
  type StackData,
  type SortConfig,
  type TextCardColorKey,
} from './types';
import { normalizeCardLayoutMode, normalizeCardSizeScale, normalizeImageAspectRatio } from './cardLayout';
import {
  createWorkflowForTemplate,
  getDefaultActiveStageId,
  getSeedSourceWidget,
  migrateLegacyClosedCardAssignments,
  migrateLegacyClosedContainersToWorkflow,
  toLegacyClosedContainers,
} from './workflow';
import { assignUnassignedCardsToWidgetZone } from './widgetSort';

export type BoardId = string;

export type PersistedCardV1 = {
  id: string;
  kind: CardData['kind'] | 'dummy';
  createdAt?: number;
  sizeScale?: number;
  stackId?: string;
  stackOrder?: number;
  widgetAssignments?: CardWidgetAssignmentsByStage;
  closedContainerId?: string;
  closedContainerOrder?: number;
  x: number;
  y: number;
  z: number;
  // For media cards we persist only the asset ids (blobs live in the assets store).
  assetId?: string;
  posterAssetId?: string;
  meta?: CardMetadataV1;
};

export type PersistedStackV1 = StackData;

export type PersistedClosedContainerV1 = ClosedContainerData;
export type PersistedSortWorkflowV2 = SortWorkflowData;

export type PersistedBoardV1 = {
  version: number;
  id: BoardId;
  updatedAt: number;
  sortConfig: SortConfig;
  cardW: number;
  cardH: number;
  cardLayoutMode?: CardLayoutMode;
  stacks?: PersistedStackV1[];
  workflow?: PersistedSortWorkflowV2;
  activeStageId?: string;
  closedContainers?: PersistedClosedContainerV1[];
  cards: PersistedCardV1[];
  activeSessionId?: string;
};

export type PersistedSessionV1 = {
  version: 1;
  id: string; // session id
  boardId: BoardId;
  updatedAt: number;
  // We store the current RecordingSession shape (already includes replay traces).
  recording: RecordingSession;
};

export type PersistedAssetV1 = {
  version: 1;
  id: string;
  mime: string;
  blob: Blob | ArrayBuffer;
  createdAt: number;
};

export type PersistedProjectV1 = {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PersistedMetaV1 = {
  key: 'activeProjectId';
  value: string;
};

export type SetupSnapshotV1 = {
  cardLayoutMode?: CardLayoutMode;
  sortConfig: SortConfig;
  stacks?: PersistedStackV1[];
  workflow?: PersistedSortWorkflowV2;
  activeStageId?: string;
  closedContainers?: PersistedClosedContainerV1[];
  cards: PersistedCardV1[];
};

export type PersistedSetupUndoV1 = {
  version: 1;
  projectId: string;
  updatedAt: number;
  past: SetupSnapshotV1[];
};

export type ProjectExportManifestV1 = {
  format: 'sortboard-project-export';
  version: 1;
  exportedAt: string;
};

export type ProjectExportAssetV1 = {
  id: string;
  mime: string;
  file: string;
};

interface SortboardDB extends DBSchema {
  boards: {
    key: BoardId;
    value: PersistedBoardV1;
  };
  assets: {
    key: string;
    value: PersistedAssetV1;
  };
  sessions: {
    key: string;
    value: PersistedSessionV1;
    indexes: { byBoardId: BoardId };
  };
  projects: {
    key: string;
    value: PersistedProjectV1;
  };
  meta: {
    key: 'activeProjectId';
    value: PersistedMetaV1;
  };
  setupUndo: {
    key: string;
    value: PersistedSetupUndoV1;
  };
}

const DB_NAME = 'sortboard-mvp';
const DB_VERSION = 7;
const LEGACY_BOARD_ID = 'current';
const DEFAULT_IMAGE_CARD_NAME = 'Image';
const DEFAULT_VIDEO_CARD_NAME = 'Video';
const DEFAULT_TEXT_CARD_NAME = 'Card';
const DEFAULT_TEXT_CARD_COLOR: TextCardColorKey = 'slate';
const MAX_CLOSED_TARGETS = 5;

let dbPromise: Promise<IDBPDatabase<SortboardDB>> | null = null;
let resolvedDb: IDBPDatabase<SortboardDB> | null = null;
let jsZipPromise: Promise<any> | null = null;

async function loadJSZip() {
  if (!jsZipPromise) {
    jsZipPromise = import('jszip').then((module: any) => module.default ?? module);
  }
  return jsZipPromise;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) next.push(trimmed);
  }
  return next;
}

function normalizeTextCardColor(value: unknown): TextCardColorKey {
  if (typeof value !== 'string') return DEFAULT_TEXT_CARD_COLOR;
  if ((TEXT_CARD_COLOR_KEYS as readonly string[]).includes(value)) {
    return value as TextCardColorKey;
  }
  return DEFAULT_TEXT_CARD_COLOR;
}

function normalizeDurationSec(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeCardCreatedAt(value: unknown, index: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return index + 1;
}

function normalizeStackId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStackOrder(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function normalizeClosedContainerOrder(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function normalizeClosedTargetRowOrder(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function normalizeClosedContainerId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStackCreatedAt(value: unknown, index: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return index + 1;
}

function normalizeSortTemplateId(value: unknown): SortTemplateId {
  return value === 'closed' || value === 'qsort' ? value : 'open';
}

function normalizePersistedSortConfig(value: SortConfig | undefined): SortConfig {
  const templateId = normalizeSortTemplateId(value?.type);
  const columns = typeof value?.columns === 'number' && Number.isFinite(value.columns) ? Math.max(1, Math.floor(value.columns)) : 3;
  return {
    type: templateId,
    columns,
  };
}

function normalizeWidgetAssignments(value: unknown): CardWidgetAssignmentsByStage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const next: CardWidgetAssignmentsByStage = {};
  for (const [stageId, rawAssignment] of Object.entries(value as Record<string, unknown>)) {
    if (!stageId.trim()) continue;
    if (!rawAssignment || typeof rawAssignment !== 'object') continue;
    const widgetId = normalizeOptionalString((rawAssignment as { widgetId?: unknown }).widgetId);
    const zoneId = normalizeOptionalString((rawAssignment as { zoneId?: unknown }).zoneId);
    const orderRaw = (rawAssignment as { order?: unknown }).order;
    const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw) && orderRaw >= 0 ? Math.floor(orderRaw) : 0;
    if (!widgetId || !zoneId) continue;
    next[stageId] = { widgetId, zoneId, order };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeWidgetRect(
  value: Pick<BoardWidgetData, 'x' | 'y' | 'w' | 'h'>
): Pick<BoardWidgetData, 'x' | 'y' | 'w' | 'h'> {
  return {
    x: typeof value.x === 'number' && Number.isFinite(value.x) ? Math.round(value.x) : 24,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? Math.round(value.y) : 24,
    w: typeof value.w === 'number' && Number.isFinite(value.w) && value.w > 0 ? Math.round(value.w) : 280,
    h: typeof value.h === 'number' && Number.isFinite(value.h) && value.h > 0 ? Math.round(value.h) : 220,
  };
}

function normalizeWorkflowStage(stage: unknown, index: number): SortStageData | null {
  if (!stage || typeof stage !== 'object') return null;
  const raw = stage as { id?: unknown; kind?: unknown; name?: unknown; order?: unknown };
  const id = normalizeOptionalString(raw.id);
  const kind =
    raw.kind === 'closed-sort' || raw.kind === 'presort' || raw.kind === 'qsort'
      ? raw.kind
      : null;
  if (!id || !kind) return null;
  return {
    id,
    kind,
    name: normalizeOptionalString(raw.name) || (kind === 'closed-sort' ? 'Closed Sort' : kind === 'presort' ? 'Pre-Sort' : 'Q-Sort'),
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.floor(raw.order) : index,
  };
}

function normalizePreSortZones(value: unknown): [{ id: string; label: string }, { id: string; label: string }] {
  const fallback: [{ id: string; label: string }, { id: string; label: string }] = [
    { id: 'lane-a', label: '+' },
    { id: 'lane-b', label: '-' },
  ];
  if (!Array.isArray(value) || value.length < 2) return [fallback[0], fallback[1]];
  const next = value
    .slice(0, 2)
    .map((zone, index) => {
      if (!zone || typeof zone !== 'object') return fallback[index];
      const raw = zone as { id?: unknown; label?: unknown };
      return {
        id: normalizeOptionalString(raw.id) || fallback[index].id,
        label: normalizeOptionalString(raw.label) || fallback[index].label,
      };
    });
  return [next[0], next[1]] as [{ id: string; label: string }, { id: string; label: string }];
}

function normalizeQSortBuckets(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return createWorkflowForTemplate('qsort', 1200, 800, 15).widgets.find((widget) => widget.kind === 'qsort')?.buckets || [];
  }
  const next = value
    .map((bucket, index) => {
      if (!bucket || typeof bucket !== 'object') return null;
      const raw = bucket as { id?: unknown; label?: unknown; capacity?: unknown };
      const id = normalizeOptionalString(raw.id);
      if (!id) return null;
      return {
        id,
        label: normalizeOptionalString(raw.label) || `${index}`,
        capacity:
          typeof raw.capacity === 'number' && Number.isFinite(raw.capacity) && raw.capacity >= 0
            ? Math.floor(raw.capacity)
            : 0,
      };
    })
    .filter((bucket): bucket is NonNullable<typeof bucket> => !!bucket);
  return next;
}

function normalizeQSortLanes(value: unknown) {
  const fallback = [
    { id: 'lane-a', label: '+' },
    { id: 'lane-b', label: '-' },
  ];
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const next = value
    .map((lane, index) => {
      if (!lane || typeof lane !== 'object') return null;
      const raw = lane as { id?: unknown; label?: unknown };
      const id = normalizeOptionalString(raw.id);
      if (!id) return null;
      return {
        id,
        label: normalizeOptionalString(raw.label) || `${index + 1}`,
      };
    })
    .filter((lane): lane is NonNullable<typeof lane> => !!lane);
  return next.length > 0 ? next : fallback;
}

function normalizeWorkflowWidget(widget: unknown, index: number, validStageIds: Set<string>): BoardWidgetData | null {
  if (!widget || typeof widget !== 'object') return null;
  const raw = widget as Partial<BoardWidgetData> & {
    description?: unknown;
    capacityMode?: unknown;
    capacity?: unknown;
    allowedTags?: unknown;
    layout?: unknown;
    zones?: unknown;
    lanes?: unknown;
    buckets?: unknown;
  };
  const id = normalizeOptionalString(raw.id);
  const stageId = normalizeOptionalString(raw.stageId);
  const kind =
    raw.kind === 'source' || raw.kind === 'category' || raw.kind === 'pre-sort' || raw.kind === 'qsort'
      ? raw.kind
      : null;
  if (!id || !stageId || !kind || !validStageIds.has(stageId)) return null;
  const base = {
    id,
    kind,
    stageId,
    title: normalizeOptionalString(raw.title) || (kind === 'source' ? 'Source' : kind === 'category' ? `Target ${index + 1}` : kind === 'pre-sort' ? 'Pre-Sort' : 'Q-Sort'),
    createdAt: normalizeStackCreatedAt(raw.createdAt, index),
    ...normalizeWidgetRect(raw as Pick<BoardWidgetData, 'x' | 'y' | 'w' | 'h'>),
    z: typeof raw.z === 'number' && Number.isFinite(raw.z) ? Math.floor(raw.z) : 10 + index,
  };
  if (kind === 'source') {
    return {
      ...base,
      kind: 'source',
      layout: normalizeClosedContainerLayout(raw.layout, 'stack'),
    };
  }
  if (kind === 'category') {
    return {
      ...base,
      kind: 'category',
      description: typeof raw.description === 'string' ? raw.description : '',
      capacityMode: raw.capacityMode === 'limited' ? 'limited' : 'unlimited',
      capacity:
        raw.capacityMode === 'limited' && typeof raw.capacity === 'number' && Number.isFinite(raw.capacity)
          ? Math.max(1, Math.floor(raw.capacity))
          : undefined,
      allowedTags: normalizeTags(raw.allowedTags),
      layout: normalizeClosedContainerLayout(raw.layout, 'fan'),
    };
  }
  if (kind === 'pre-sort') {
    const zones = normalizePreSortZones(raw.zones);
    return {
      ...base,
      kind: 'pre-sort',
      zones,
    };
  }
  return {
    ...base,
    kind: 'qsort',
    lanes: normalizeQSortLanes(raw.lanes),
    buckets: normalizeQSortBuckets(raw.buckets),
  };
}

function normalizePersistedWorkflow(
  workflow: PersistedSortWorkflowV2 | undefined,
  sortConfig: SortConfig,
  closedContainers: PersistedClosedContainerV1[] | undefined,
  boardW = 1200,
  boardH = 800,
  cardCount = 0
): SortWorkflowData {
  if (!workflow || typeof workflow !== 'object') {
    if (sortConfig.type === 'closed' && Array.isArray(closedContainers) && closedContainers.length > 0) {
      return migrateLegacyClosedContainersToWorkflow(closedContainers);
    }
    if (sortConfig.type === 'qsort') {
      return createWorkflowForTemplate('qsort', boardW, boardH, cardCount);
    }
    if (sortConfig.type === 'closed') {
      return createWorkflowForTemplate('closed', boardW, boardH, cardCount);
    }
    return createWorkflowForTemplate('open', boardW, boardH, cardCount);
  }
  const templateId = normalizeSortTemplateId((workflow as { templateId?: unknown }).templateId);
  const stagesRaw = Array.isArray((workflow as { stages?: unknown[] }).stages) ? (workflow as { stages: unknown[] }).stages : [];
  const stages = stagesRaw
    .map((stage, index) => normalizeWorkflowStage(stage, index))
    .filter((stage): stage is NonNullable<typeof stage> => !!stage)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const validStageIds = new Set(stages.map((stage) => stage.id));
  const widgetsRaw = Array.isArray((workflow as { widgets?: unknown[] }).widgets) ? (workflow as { widgets: unknown[] }).widgets : [];
  const widgets = widgetsRaw
    .map((widget, index) => normalizeWorkflowWidget(widget, index, validStageIds))
    .filter((widget): widget is BoardWidgetData => !!widget);
  if (stages.length === 0) {
    return normalizePersistedWorkflow(undefined, { type: templateId }, closedContainers, boardW, boardH, cardCount);
  }
  return {
    templateId,
    stages,
    widgets,
  };
}

export function createCardMetadata(
  name: string,
  notes = '',
  tags: string[] = [],
  options: {
    frontText?: string;
    color?: TextCardColorKey;
    aspectRatio?: number;
    durationSec?: number;
    originalFileName?: string;
  } = {}
): CardMetadataV1 {
  const nextName = name.trim();
  const frontText = options.frontText?.trim();
  const aspectRatio = normalizeImageAspectRatio(options.aspectRatio);
  return {
    name: nextName,
    notes: notes.trim(),
    tags: normalizeTags(tags),
    frontText: frontText || undefined,
    color: options.color,
    aspectRatio,
    durationSec: normalizeDurationSec(options.durationSec),
    originalFileName: normalizeOptionalString(options.originalFileName),
  };
}

function normalizeCardKind(kind: CardData['kind'] | 'dummy'): CardData['kind'] {
  if (kind === 'dummy') return 'text';
  return kind;
}

function fallbackCardName(kind: CardData['kind'] | 'dummy', index: number) {
  if (kind === 'text' || kind === 'dummy') return `${DEFAULT_TEXT_CARD_NAME} ${index + 1}`;
  if (kind === 'video') return `${DEFAULT_VIDEO_CARD_NAME} ${index + 1}`;
  return `${DEFAULT_IMAGE_CARD_NAME} ${index + 1}`;
}

export function normalizeCardMetadata(
  meta: CardMetadataV1 | undefined,
  fallbackName: string,
  kind: CardData['kind'] | 'dummy'
): CardMetadataV1 {
  const normalizedKind = normalizeCardKind(kind);
  const nextName = meta?.name?.trim() || fallbackName;
  const base: CardMetadataV1 = {
    name: nextName,
    notes: meta?.notes?.trim() || '',
    tags: normalizeTags(meta?.tags),
  };
  if (normalizedKind === 'text') {
    const frontText = meta?.frontText?.trim() || nextName;
    return {
      ...base,
      frontText,
      color: normalizeTextCardColor(meta?.color),
      aspectRatio: undefined,
      durationSec: undefined,
      originalFileName: undefined,
    };
  }
  return {
    ...base,
    frontText: undefined,
    color: undefined,
    aspectRatio: normalizeImageAspectRatio(meta?.aspectRatio),
    durationSec: normalizeDurationSec(meta?.durationSec),
    originalFileName: normalizeOptionalString(meta?.originalFileName),
  };
}

function normalizePersistedCard(card: PersistedCardV1, index: number): PersistedCardV1 {
  const kind = normalizeCardKind(card.kind);
  return {
    ...card,
    kind,
    createdAt: normalizeCardCreatedAt(card.createdAt, index),
    sizeScale: normalizeCardSizeScale(card.sizeScale),
    stackId: normalizeStackId(card.stackId),
    stackOrder: normalizeStackOrder(card.stackOrder),
    widgetAssignments: normalizeWidgetAssignments(card.widgetAssignments),
    closedContainerId: normalizeClosedContainerId(card.closedContainerId),
    closedContainerOrder: normalizeClosedContainerOrder(card.closedContainerOrder),
    assetId: normalizeOptionalString(card.assetId),
    posterAssetId: kind === 'video' ? normalizeOptionalString(card.posterAssetId) : undefined,
    meta: normalizeCardMetadata(card.meta, fallbackCardName(kind, index), kind),
  };
}

function normalizePersistedStack(stack: PersistedStackV1, index: number): PersistedStackV1 {
  return {
    id: stack.id,
    name: stack.name?.trim() || `Stack ${index + 1}`,
    createdAt: normalizeStackCreatedAt(stack.createdAt, index),
  };
}

function normalizeContainerRect(
  value: Pick<PersistedClosedContainerV1, 'x' | 'y' | 'w' | 'h'>
): Pick<PersistedClosedContainerV1, 'x' | 'y' | 'w' | 'h'> {
  return {
    x: typeof value.x === 'number' && Number.isFinite(value.x) ? Math.round(value.x) : 24,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? Math.round(value.y) : 24,
    w: typeof value.w === 'number' && Number.isFinite(value.w) && value.w > 0 ? Math.round(value.w) : 280,
    h: typeof value.h === 'number' && Number.isFinite(value.h) && value.h > 0 ? Math.round(value.h) : 220,
  };
}

function normalizePersistedClosedContainer(
  container: PersistedClosedContainerV1,
  index: number
): PersistedClosedContainerV1 | null {
  if (!container || typeof container.id !== 'string' || !container.id.trim()) return null;
  const base = {
    id: container.id,
    name: container.name?.trim() || (container.kind === 'source' ? 'Source' : `Target ${index + 1}`),
    createdAt: normalizeStackCreatedAt(container.createdAt, index),
    ...normalizeContainerRect(container),
  };
  if (container.kind === 'source') {
    return {
      ...base,
      kind: 'source',
      layout: normalizeClosedContainerLayout(container.layout, 'stack'),
    };
  }
  return {
    ...base,
    kind: 'target',
    rowOrder: normalizeClosedTargetRowOrder((container as { rowOrder?: unknown }).rowOrder) ?? index,
    description: typeof container.description === 'string' ? container.description : '',
    visibleInSort: typeof container.visibleInSort === 'boolean' ? container.visibleInSort : true,
    capacityMode: container.capacityMode === 'limited' ? 'limited' : 'unlimited',
    capacity:
      container.capacityMode === 'limited' && typeof container.capacity === 'number' && Number.isFinite(container.capacity)
        ? Math.max(1, Math.floor(container.capacity))
        : undefined,
    allowedTags: normalizeTags((container as ClosedTargetData).allowedTags),
    layout: normalizeClosedContainerLayout(container.layout, 'fan'),
  };
}

function normalizePersistedClosedContainers(closedContainers: PersistedClosedContainerV1[] | undefined) {
  if (!Array.isArray(closedContainers)) return [] as PersistedClosedContainerV1[];
  const seen = new Set<string>();
  let source: PersistedClosedContainerV1 | null = null;
  const targets: Array<{ container: Extract<PersistedClosedContainerV1, { kind: 'target' }>; hasRowOrder: boolean }> = [];
  for (let index = 0; index < closedContainers.length; index += 1) {
    const raw = closedContainers[index];
    const normalized = normalizePersistedClosedContainer(raw, index);
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    if (normalized.kind === 'source') {
      if (source) continue;
      source = normalized;
    } else {
      targets.push({
        container: normalized,
        hasRowOrder: normalizeClosedTargetRowOrder((raw as { rowOrder?: unknown }).rowOrder) != null,
      });
    }
    seen.add(normalized.id);
  }
  const orderedTargets = targets
    .sort((a, b) => {
      const aRow = a.hasRowOrder ? a.container.rowOrder : Number.MAX_SAFE_INTEGER;
      const bRow = b.hasRowOrder ? b.container.rowOrder : Number.MAX_SAFE_INTEGER;
      return (
        aRow - bRow ||
        a.container.x - b.container.x ||
        a.container.createdAt - b.container.createdAt ||
        a.container.id.localeCompare(b.container.id)
      );
    })
    .slice(0, MAX_CLOSED_TARGETS);

  if (targets.length > MAX_CLOSED_TARGETS) {
    console.warn(`[persist] clamped closed targets from ${targets.length} to ${MAX_CLOSED_TARGETS}`);
  }

  return [
    ...(source ? [source] : []),
    ...orderedTargets.map(({ container }, index) => ({
      ...container,
      rowOrder: index,
    })),
  ];
}

function normalizeClosedContainerLayout(value: unknown, fallback: ClosedContainerLayout): ClosedContainerLayout {
  return value === 'fan' || value === 'stack' ? value : fallback;
}

function normalizePersistedStacks(stacks: PersistedStackV1[] | undefined) {
  if (!Array.isArray(stacks)) return [] as PersistedStackV1[];
  const seen = new Set<string>();
  const next: PersistedStackV1[] = [];
  for (let index = 0; index < stacks.length; index += 1) {
    const stack = stacks[index];
    if (!stack || typeof stack.id !== 'string' || !stack.id.trim()) continue;
    const normalized = normalizePersistedStack(stack, index);
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    next.push(normalized);
  }
  return next;
}

function normalizeCardStackMembership(cards: PersistedCardV1[], stacks: PersistedStackV1[]) {
  const validStackIds = new Set(stacks.map((stack) => stack.id));
  const nextCards = cards.map((card) =>
    !card.stackId || !validStackIds.has(card.stackId)
      ? {
          ...card,
          stackId: undefined,
          stackOrder: undefined,
        }
      : card
  );

  const idsByStack = new Map<string, PersistedCardV1[]>();
  for (const card of nextCards) {
    if (!card.stackId) continue;
    const list = idsByStack.get(card.stackId) || [];
    list.push(card);
    idsByStack.set(card.stackId, list);
  }

  const filteredStacks = stacks.filter((stack) => (idsByStack.get(stack.id)?.length ?? 0) >= 2);
  const filteredIds = new Set(filteredStacks.map((stack) => stack.id));
  const normalizedCards = nextCards.map((card) => {
    if (!card.stackId || !filteredIds.has(card.stackId)) {
      return {
        ...card,
        stackId: undefined,
        stackOrder: undefined,
      };
    }
    return card;
  });

  for (const stack of filteredStacks) {
    const ordered = normalizedCards
      .filter((card) => card.stackId === stack.id)
      .sort((a, b) => {
        return (
          (a.stackOrder ?? Number.MAX_SAFE_INTEGER) - (b.stackOrder ?? Number.MAX_SAFE_INTEGER) ||
          b.z - a.z ||
          (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
          a.id.localeCompare(b.id)
        );
      });
    ordered.forEach((card, index) => {
      card.stackOrder = index;
    });
  }

  return {
    cards: normalizedCards,
    stacks: filteredStacks,
  };
}

function normalizeCardClosedMembership(cards: PersistedCardV1[], closedContainers: PersistedClosedContainerV1[]) {
  if (closedContainers.length === 0) {
    return {
      cards: cards.map((card) => ({
        ...card,
        closedContainerId: undefined,
        closedContainerOrder: undefined,
      })),
      closedContainers: [],
    };
  }

  const source = closedContainers.find((container) => container.kind === 'source');
  if (!source) {
    return {
      cards: cards.map((card) => ({
        ...card,
        closedContainerId: undefined,
        closedContainerOrder: undefined,
      })),
      closedContainers: [],
    };
  }

  const validIds = new Set(closedContainers.map((container) => container.id));
  const grouped = new Map<string, PersistedCardV1[]>();
  const normalizedCards = cards.map((card) => {
    const closedContainerId =
      card.closedContainerId && validIds.has(card.closedContainerId) ? card.closedContainerId : source.id;
    const next = {
      ...card,
      closedContainerId,
      closedContainerOrder: card.closedContainerOrder,
    };
    const list = grouped.get(closedContainerId) || [];
    list.push(next);
    grouped.set(closedContainerId, list);
    return next;
  });

  for (const cardsInContainer of grouped.values()) {
    cardsInContainer
      .sort(
        (a, b) =>
          (a.closedContainerOrder ?? Number.MAX_SAFE_INTEGER) - (b.closedContainerOrder ?? Number.MAX_SAFE_INTEGER) ||
          b.z - a.z ||
          (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
          a.id.localeCompare(b.id)
      )
      .forEach((card, index) => {
        card.closedContainerOrder = index;
      });
  }

  return {
    cards: normalizedCards,
    closedContainers,
  };
}

function normalizeBoardWorkflowState(
  sortConfig: SortConfig,
  cards: PersistedCardV1[],
  workflow: PersistedSortWorkflowV2 | undefined,
  activeStageId: string | undefined,
  closedContainers: PersistedClosedContainerV1[] | undefined,
  boardW = 1200,
  boardH = 800
) {
  const normalizedWorkflow = normalizePersistedWorkflow(
    workflow,
    sortConfig,
    closedContainers,
    boardW,
    boardH,
    cards.length
  );
  const normalizedActiveStageId = normalizeOptionalString(activeStageId) || getDefaultActiveStageId(normalizedWorkflow) || undefined;
  let nextCards = cards.map((card) => ({ ...card }));

  if (sortConfig.type !== 'open') {
    const stageId = normalizedActiveStageId || getDefaultActiveStageId(normalizedWorkflow);
    const normalizedClosedContainers =
      sortConfig.type === 'closed' && closedContainers && closedContainers.length > 0
        ? normalizePersistedClosedContainers(closedContainers)
        : sortConfig.type === 'closed'
          ? toLegacyClosedContainers(normalizedWorkflow, stageId || undefined)
          : [];
    const hasAssignments = !!stageId && nextCards.some((card) => !!card.widgetAssignments?.[stageId]);
    if (sortConfig.type === 'closed' && stageId && !hasAssignments && normalizedClosedContainers.length > 0) {
      nextCards = migrateLegacyClosedCardAssignments(nextCards as CardData[], normalizedClosedContainers, stageId) as PersistedCardV1[];
    }
    const seedSource = getSeedSourceWidget(normalizedWorkflow, normalizedActiveStageId || undefined);
    if (seedSource) {
      nextCards = assignUnassignedCardsToWidgetZone(
        nextCards as CardData[],
        seedSource.stageId,
        seedSource.widget.id
      ) as PersistedCardV1[];
    }
    return {
      cards: nextCards,
      workflow: normalizedWorkflow,
      activeStageId: stageId || undefined,
      closedContainers: normalizedClosedContainers,
    };
  }

  return {
    cards: nextCards,
    workflow: normalizedWorkflow,
    activeStageId: normalizedActiveStageId,
    closedContainers: normalizePersistedClosedContainers(closedContainers),
  };
}

function normalizePersistedCards(cards: PersistedCardV1[]) {
  return cards.map((card, index) => normalizePersistedCard(card, index));
}

type RuntimeCardInput = Omit<CardData, 'kind'> & { kind: CardData['kind'] | 'dummy' };

function normalizeRuntimeCard(card: RuntimeCardInput, index: number): CardData {
  const kind = normalizeCardKind(card.kind);
  return {
    ...card,
    kind,
    createdAt: normalizeCardCreatedAt(card.createdAt, index),
    sizeScale: normalizeCardSizeScale(card.sizeScale),
    stackId: normalizeStackId(card.stackId),
    stackOrder: normalizeStackOrder(card.stackOrder),
    widgetAssignments: normalizeWidgetAssignments(card.widgetAssignments),
    closedContainerId: normalizeClosedContainerId(card.closedContainerId),
    closedContainerOrder: normalizeClosedContainerOrder(card.closedContainerOrder),
    meta: normalizeCardMetadata(card.meta, fallbackCardName(kind, index), kind),
  };
}

function normalizeRuntimeCards(cards: RuntimeCardInput[]) {
  return cards.map((card, index) => normalizeRuntimeCard(card, index));
}

function normalizeRecording(recording: RecordingSession): RecordingSession {
  const normalizeWidgetAssignmentChanges = (changes: unknown) =>
    Array.isArray(changes)
      ? changes
          .filter((change) => change && typeof change === 'object' && typeof (change as { cardId?: unknown }).cardId === 'string')
          .map((change) => {
            const raw = change as { cardId: string; stageId?: unknown; assignment?: unknown };
            return {
              cardId: raw.cardId,
              stageId: normalizeOptionalString(raw.stageId) || '',
              assignment: (() => {
                const normalized = normalizeWidgetAssignments(raw.stageId ? { [String(raw.stageId)]: raw.assignment } : {});
                return raw.stageId ? normalized?.[String(raw.stageId)] : undefined;
              })(),
            };
          })
          .filter((change) => !!change.stageId)
      : [];

  const normalizeStaticMoveMembers = (members: unknown) =>
    Array.isArray(members)
      ? members
          .filter((member) => member && typeof member === 'object' && typeof (member as { cardId?: unknown }).cardId === 'string')
          .map((member) => ({
            cardId: (member as { cardId: string }).cardId,
            from: {
              x: Number((member as { from?: { x?: unknown } }).from?.x) || 0,
              y: Number((member as { from?: { y?: unknown } }).from?.y) || 0,
            },
            final: {
              x: Number((member as { final?: { x?: unknown } }).final?.x) || 0,
              y: Number((member as { final?: { y?: unknown } }).final?.y) || 0,
            },
          }))
      : [];

  return {
    ...recording,
    version: 5,
    sortConfig: normalizePersistedSortConfig(recording.sortConfig),
    workflowAtStart: normalizePersistedWorkflow(
      recording.workflowAtStart,
      normalizePersistedSortConfig(recording.sortConfig),
      recording.closedContainersAtStart,
      recording.boardW,
      recording.boardH,
      Array.isArray(recording.cardsAtStart) ? recording.cardsAtStart.length : 0
    ),
    activeStageIdAtStart:
      normalizeOptionalString(recording.activeStageIdAtStart) ||
      getDefaultActiveStageId(
        normalizePersistedWorkflow(
          recording.workflowAtStart,
          normalizePersistedSortConfig(recording.sortConfig),
          recording.closedContainersAtStart,
          recording.boardW,
          recording.boardH,
          Array.isArray(recording.cardsAtStart) ? recording.cardsAtStart.length : 0
        )
      ) ||
      undefined,
    closedContainersAtStart: normalizePersistedClosedContainers(recording.closedContainersAtStart),
    cardsAtStart: normalizeRuntimeCards(recording.cardsAtStart as RuntimeCardInput[]),
    segments: Array.isArray(recording.segments)
      ? recording.segments
          .filter((segment) => segment && typeof segment === 'object' && typeof (segment as { type?: unknown }).type === 'string')
          .map((segment) => {
            if (segment.type === 'source-promote') {
              return {
                type: 'source-promote' as const,
                id: segment.id,
                cardId: segment.cardId,
                t0: segment.t0,
                t1: segment.t1,
                members: normalizeStaticMoveMembers(segment.members),
                settleMs: segment.settleMs,
              };
            }
            if (segment.type === 'target-cycle') {
              return {
                type: 'target-cycle' as const,
                id: segment.id,
                containerId: segment.containerId,
                t0: segment.t0,
                t1: segment.t1,
                members: normalizeStaticMoveMembers(segment.members),
                settleMs: segment.settleMs,
              };
            }
            if (segment.type === 'stage-transition') {
              return {
                type: 'stage-transition' as const,
                id: segment.id,
                fromStageId: normalizeOptionalString(segment.fromStageId) || '',
                toStageId: normalizeOptionalString(segment.toStageId) || '',
                t0: segment.t0,
                t1: segment.t1,
                members: normalizeStaticMoveMembers(segment.members),
                widgetAssignmentChanges: normalizeWidgetAssignmentChanges(segment.widgetAssignmentChanges),
                settleMs: segment.settleMs,
              };
            }
            return {
              ...segment,
              type: 'drag' as const,
              groupMembers: Array.isArray(segment.groupMembers)
                ? segment.groupMembers
                    .filter((member) => member && typeof member.cardId === 'string')
                    .map((member) => ({
                      cardId: member.cardId,
                      from: { x: member.from.x, y: member.from.y },
                      drop: { x: member.drop.x, y: member.drop.y },
                      final: { x: member.final.x, y: member.final.y },
                    }))
                : undefined,
              widgetAssignmentChanges: normalizeWidgetAssignmentChanges(segment.widgetAssignmentChanges),
              settleMembers: normalizeStaticMoveMembers(segment.settleMembers),
            };
          })
      : [],
  };
}

function getExtFromMime(mime: string) {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('quicktime')) return 'mov';
  if (lower.includes('m4v')) return 'm4v';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('ogg') || lower.includes('ogv')) return 'ogv';
  if (lower.includes('avi') || lower.includes('x-msvideo')) return 'avi';
  if (lower.includes('matroska') || lower.includes('mkv')) return 'mkv';
  return 'bin';
}

function normalizeAssetBlob(blob: Blob, mime: string) {
  const normalizedMime = mime || blob.type || 'application/octet-stream';
  return new Blob([blob], { type: normalizedMime });
}

function hydrateAssetBlob(blob: Blob | ArrayBuffer, mime: string) {
  if (blob instanceof Blob) {
    return normalizeAssetBlob(blob, mime);
  }
  return new Blob([blob], { type: mime || 'application/octet-stream' });
}

async function cloneAssetBlobForStorage(blob: Blob) {
  return blob.arrayBuffer();
}

function uniqueProjectName(base: string, existingNames: Set<string>) {
  const trimmed = base.trim() || 'Imported Project';
  if (!existingNames.has(trimmed)) return trimmed;
  const first = `${trimmed} (copy)`;
  if (!existingNames.has(first)) return first;
  let i = 2;
  while (existingNames.has(`${trimmed} (copy ${i})`)) i += 1;
  return `${trimmed} (copy ${i})`;
}

function collectAssetIdsFromBoard(board: PersistedBoardV1, out: Set<string>) {
  for (const c of board.cards) {
    if ((c.kind === 'image' || c.kind === 'video') && c.assetId) out.add(c.assetId);
    if (c.kind === 'video' && c.posterAssetId) out.add(c.posterAssetId);
  }
}

function collectAssetIdsFromRecording(rec: RecordingSession, out: Set<string>) {
  for (const c of rec.cardsAtStart) {
    if ((c.kind === 'image' || c.kind === 'video') && c.assetId) out.add(c.assetId);
    if (c.kind === 'video' && c.posterAssetId) out.add(c.posterAssetId);
  }
}

async function collectReferencedAssetIds(
  boardsStore: { getAll: () => Promise<PersistedBoardV1[]> },
  sessionsStore: { getAll: () => Promise<PersistedSessionV1[]> },
  setupUndoStore: { getAll: () => Promise<PersistedSetupUndoV1[]> }
) {
  const refs = new Set<string>();
  const boards = await boardsStore.getAll();
  for (const board of boards) collectAssetIdsFromBoard(board, refs);

  const sessions = await sessionsStore.getAll();
  for (const session of sessions) collectAssetIdsFromRecording(session.recording, refs);

  const undoEntries = await setupUndoStore.getAll();
  for (const entry of undoEntries) {
    for (const snapshot of entry.past) {
      for (const card of snapshot.cards) {
        if ((card.kind === 'image' || card.kind === 'video') && card.assetId) refs.add(card.assetId);
        if (card.kind === 'video' && card.posterAssetId) refs.add(card.posterAssetId);
      }
    }
  }

  return refs;
}

function sanitizeRecording(recording: RecordingSession): RecordingSession {
  const normalized = normalizeRecording(recording);
  return {
    ...normalized,
    cardsAtStart: normalized.cardsAtStart.map((c) => ({ ...c, src: undefined, posterSrc: undefined })),
  };
}

function remapRecordingAssetIds(recording: RecordingSession, assetIdMap: Map<string, string>, createdAt: string): RecordingSession {
  const normalized = normalizeRecording(recording);
  return {
    ...sanitizeRecording(normalized),
    createdAt,
    cardsAtStart: normalized.cardsAtStart.map((c) => {
      if (c.kind === 'text') return { ...c, src: undefined, posterSrc: undefined };
      const mapped = c.assetId ? assetIdMap.get(c.assetId) : undefined;
      const mappedPoster = c.kind === 'video' && c.posterAssetId ? assetIdMap.get(c.posterAssetId) : undefined;
      return { ...c, src: undefined, posterSrc: undefined, assetId: mapped, posterAssetId: mappedPoster };
    }),
  };
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function validateManifest(value: any): asserts value is ProjectExportManifestV1 {
  if (!value || value.format !== 'sortboard-project-export' || value.version !== 1) {
    throw new Error('Unsupported export format');
  }
}

function nextIsoSessionId(existing: Set<string>, startMs: number) {
  let cursor = startMs;
  while (true) {
    const id = new Date(cursor).toISOString();
    if (!existing.has(id)) {
      existing.add(id);
      return id;
    }
    cursor += 1;
  }
}

function createStores(db: IDBPDatabase<SortboardDB>) {
  if (!db.objectStoreNames.contains('boards')) {
    db.createObjectStore('boards');
  }
  if (!db.objectStoreNames.contains('assets')) {
    db.createObjectStore('assets');
  }
  if (!db.objectStoreNames.contains('sessions')) {
    const sessions = db.createObjectStore('sessions');
    sessions.createIndex('byBoardId', 'boardId');
  }
  if (!db.objectStoreNames.contains('projects')) {
    db.createObjectStore('projects');
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta');
  }
  if (!db.objectStoreNames.contains('setupUndo')) {
    db.createObjectStore('setupUndo');
  }
}

async function migrateLegacyCurrentBoard(tx: any) {
  const boards = tx.objectStore('boards');
  const sessions = tx.objectStore('sessions');
  const projects = tx.objectStore('projects');
  const meta = tx.objectStore('meta');

  const existingProjects = (await projects.getAll()) as PersistedProjectV1[];
  const legacyBoard = (await boards.get(LEGACY_BOARD_ID)) as PersistedBoardV1 | undefined;

  if (!legacyBoard) {
    if (existingProjects.length > 0) {
      const active = (await meta.get('activeProjectId')) as PersistedMetaV1 | undefined;
      if (!active?.value) {
        const sorted = [...existingProjects].sort((a, b) => b.updatedAt - a.updatedAt);
        if (sorted[0]) {
          await meta.put({ key: 'activeProjectId', value: sorted[0].id }, 'activeProjectId');
        }
      }
    }
    return;
  }

  const now = Date.now();
  const projectId = nanoid();
  const project: PersistedProjectV1 = {
    version: 1,
    id: projectId,
    name: 'Demo Project',
    createdAt: now,
    updatedAt: legacyBoard.updatedAt || now,
  };

  await projects.put(project, project.id);
  await boards.put({ ...legacyBoard, id: projectId, updatedAt: project.updatedAt }, projectId);
  await boards.delete(LEGACY_BOARD_ID);

  let cursor = await sessions.openCursor();
  while (cursor) {
    const value = cursor.value as PersistedSessionV1;
    if (value.boardId === LEGACY_BOARD_ID) {
      await cursor.update({ ...value, boardId: projectId });
    }
    cursor = await cursor.continue();
  }

  await meta.put({ key: 'activeProjectId', value: projectId }, 'activeProjectId');
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SortboardDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          createStores(db);
        }
        if (oldVersion < 2) {
          createStores(db);
          await migrateLegacyCurrentBoard(tx);
        }
        if (oldVersion < 3) {
          createStores(db);
        }
        if (oldVersion < 4) {
          createStores(db);
        }
        if (oldVersion < 5) {
          createStores(db);
        }
        if (oldVersion < 6) {
          createStores(db);
        }
        if (oldVersion < 7) {
          createStores(db);
        }
      },
    }).then((db) => {
      resolvedDb = db;
      return db;
    });
  }
  return dbPromise;
}

export async function persistPutAsset(assetId: string, blob: Blob, mime = blob.type || 'application/octet-stream') {
  const db = await getDB();
  const val: PersistedAssetV1 = {
    version: 1,
    id: assetId,
    blob: await cloneAssetBlobForStorage(blob),
    mime,
    createdAt: Date.now(),
  };
  await db.put('assets', val, assetId);
}

export async function persistGetAsset(assetId: string) {
  const db = await getDB();
  const asset = await db.get('assets', assetId);
  if (!asset) return undefined;
  return {
    ...asset,
    blob: hydrateAssetBlob(asset.blob, asset.mime),
  };
}

export async function persistDeleteAsset(assetId: string) {
  const db = await getDB();
  await db.delete('assets', assetId);
}

export async function persistPutBoard(board: PersistedBoardV1) {
  const sortConfig = normalizePersistedSortConfig(board.sortConfig);
  const stackNormalized = normalizeCardStackMembership(
    normalizePersistedCards(board.cards),
    normalizePersistedStacks(board.stacks)
  );
  const workflowNormalized = normalizeBoardWorkflowState(
    sortConfig,
    stackNormalized.cards,
    board.workflow,
    board.activeStageId,
    board.closedContainers,
    board.cardW,
    board.cardH
  );
  const closedNormalized = normalizeCardClosedMembership(
    workflowNormalized.cards,
    workflowNormalized.closedContainers
  );
  const value: PersistedBoardV1 = {
    ...board,
    version: 2,
    sortConfig,
    cardLayoutMode: normalizeCardLayoutMode(board.cardLayoutMode),
    stacks: stackNormalized.stacks,
    workflow: workflowNormalized.workflow,
    activeStageId: workflowNormalized.activeStageId,
    closedContainers: closedNormalized.closedContainers,
    cards: closedNormalized.cards,
  };
  const db = resolvedDb;
  if (db) {
    await db.put('boards', value, board.id);
    return;
  }
  await (await getDB()).put(
    'boards',
    value,
    board.id
  );
}

export async function persistGetBoard(boardId: BoardId) {
  const db = await getDB();
  const board = await db.get('boards', boardId);
  if (!board) return undefined;
  const sortConfig = normalizePersistedSortConfig(board.sortConfig);
  const stackNormalized = normalizeCardStackMembership(
    normalizePersistedCards(board.cards),
    normalizePersistedStacks(board.stacks)
  );
  const workflowNormalized = normalizeBoardWorkflowState(
    sortConfig,
    stackNormalized.cards,
    board.workflow,
    board.activeStageId,
    board.closedContainers,
    board.cardW,
    board.cardH
  );
  const closedNormalized = normalizeCardClosedMembership(
    workflowNormalized.cards,
    workflowNormalized.closedContainers
  );
  return {
    ...board,
    version: 2,
    sortConfig,
    cardLayoutMode: normalizeCardLayoutMode(board.cardLayoutMode),
    stacks: stackNormalized.stacks,
    workflow: workflowNormalized.workflow,
    activeStageId: workflowNormalized.activeStageId,
    closedContainers: closedNormalized.closedContainers,
    cards: closedNormalized.cards,
  };
}

export async function persistPutSession(session: PersistedSessionV1) {
  const db = await getDB();
  await db.put(
    'sessions',
    {
      ...session,
      recording: sanitizeRecording(session.recording),
    },
    session.id
  );
}

export async function persistDeleteSession(sessionId: string) {
  const db = await getDB();
  await db.delete('sessions', sessionId);
}

export async function persistListSessions(boardId: BoardId) {
  const db = await getDB();
  const sessions = await db.getAllFromIndex('sessions', 'byBoardId', boardId);
  return sessions.map((session) => ({
    ...session,
    recording: normalizeRecording(session.recording),
  }));
}

export async function persistListProjects() {
  const db = await getDB();
  const projects = await db.getAll('projects');
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function persistGetProject(projectId: string) {
  const db = await getDB();
  return db.get('projects', projectId);
}

export async function persistPutProject(project: PersistedProjectV1) {
  const db = await getDB();
  await db.put('projects', project, project.id);
}

export async function persistTouchProject(projectId: string, updatedAt = Date.now()) {
  const db = await getDB();
  const current = await db.get('projects', projectId);
  if (!current) return;
  await db.put('projects', { ...current, updatedAt }, projectId);
}

export async function persistGetActiveProjectId() {
  const db = await getDB();
  const row = await db.get('meta', 'activeProjectId');
  return row?.value || null;
}

export async function persistSetActiveProjectId(projectId: string) {
  const db = await getDB();
  await db.put('meta', { key: 'activeProjectId', value: projectId }, 'activeProjectId');
}

export async function persistGetSetupUndo(projectId: string) {
  const db = await getDB();
  const entry = await db.get('setupUndo', projectId);
  if (!entry) return undefined;
  return {
    ...entry,
    past: entry.past.map((snapshot) => ({
      cardLayoutMode: normalizeCardLayoutMode(snapshot.cardLayoutMode),
      sortConfig: normalizePersistedSortConfig(snapshot.sortConfig),
      ...(() => {
        const stackNormalized = normalizeCardStackMembership(
          normalizePersistedCards(snapshot.cards),
          normalizePersistedStacks(snapshot.stacks)
        );
        const workflowNormalized = normalizeBoardWorkflowState(
          normalizePersistedSortConfig(snapshot.sortConfig),
          stackNormalized.cards,
          snapshot.workflow,
          snapshot.activeStageId,
          snapshot.closedContainers
        );
        const closedNormalized = normalizeCardClosedMembership(
          workflowNormalized.cards,
          workflowNormalized.closedContainers
        );
        return {
          stacks: stackNormalized.stacks,
          workflow: workflowNormalized.workflow,
          activeStageId: workflowNormalized.activeStageId,
          closedContainers: closedNormalized.closedContainers,
          cards: closedNormalized.cards,
        };
      })(),
    })),
  };
}

export async function persistPutSetupUndo(projectId: string, past: SetupSnapshotV1[]) {
  const db = await getDB();
  await db.put(
    'setupUndo',
    {
      version: 1,
      projectId,
      updatedAt: Date.now(),
      past: past.map((snapshot) => {
        const sortConfig = normalizePersistedSortConfig(snapshot.sortConfig);
        const stackNormalized = normalizeCardStackMembership(
          normalizePersistedCards(snapshot.cards),
          normalizePersistedStacks(snapshot.stacks)
        );
        const workflowNormalized = normalizeBoardWorkflowState(
          sortConfig,
          stackNormalized.cards,
          snapshot.workflow,
          snapshot.activeStageId,
          snapshot.closedContainers
        );
        const closedNormalized = normalizeCardClosedMembership(
          workflowNormalized.cards,
          workflowNormalized.closedContainers
        );
        return {
          cardLayoutMode: normalizeCardLayoutMode(snapshot.cardLayoutMode),
          sortConfig,
          stacks: stackNormalized.stacks,
          workflow: workflowNormalized.workflow,
          activeStageId: workflowNormalized.activeStageId,
          closedContainers: closedNormalized.closedContainers,
          cards: closedNormalized.cards,
        };
      }),
    },
    projectId
  );
}

export async function persistClearSetupUndo(projectId: string) {
  const db = await getDB();
  await db.delete('setupUndo', projectId);
}

export async function persistDeleteProject(projectId: string) {
  const db = await getDB();
  const tx = db.transaction(['projects', 'boards', 'sessions', 'assets', 'meta', 'setupUndo'], 'readwrite');
  const projects = tx.objectStore('projects');
  const boards = tx.objectStore('boards');
  const sessions = tx.objectStore('sessions');
  const assets = tx.objectStore('assets');
  const meta = tx.objectStore('meta');
  const setupUndo = tx.objectStore('setupUndo');

  await projects.delete(projectId);
  await boards.delete(projectId);
  await setupUndo.delete(projectId);

  const sessionsByBoard = sessions.index('byBoardId');
  let sesCursor = await sessionsByBoard.openCursor(projectId);
  while (sesCursor) {
    await sesCursor.delete();
    sesCursor = await sesCursor.continue();
  }

  const refs = await collectReferencedAssetIds(boards, sessions, setupUndo);

  let assetCursor = await assets.openCursor();
  let removedAssets = 0;
  while (assetCursor) {
    const value = assetCursor.value as PersistedAssetV1;
    if (!refs.has(value.id)) {
      await assetCursor.delete();
      removedAssets += 1;
    }
    assetCursor = await assetCursor.continue();
  }

  let activeProjectId: string | null = null;
  const active = (await meta.get('activeProjectId')) as PersistedMetaV1 | undefined;
  if (active?.value === projectId) {
    const remainingProjects = ((await projects.getAll()) as PersistedProjectV1[]).sort((a, b) => b.updatedAt - a.updatedAt);
    if (remainingProjects[0]) {
      activeProjectId = remainingProjects[0].id;
      await meta.put({ key: 'activeProjectId', value: activeProjectId }, 'activeProjectId');
    } else {
      await meta.delete('activeProjectId');
    }
  } else {
    activeProjectId = active?.value || null;
  }

  await tx.done;
  return { activeProjectId, removedAssets };
}

export async function persistGarbageCollectUnreferencedAssets() {
  const db = await getDB();
  const tx = db.transaction(['boards', 'sessions', 'assets', 'setupUndo'], 'readwrite');
  const boards = tx.objectStore('boards');
  const sessions = tx.objectStore('sessions');
  const assets = tx.objectStore('assets');
  const setupUndo = tx.objectStore('setupUndo');

  const refs = await collectReferencedAssetIds(boards, sessions, setupUndo);
  let removed = 0;

  let cursor = await assets.openCursor();
  while (cursor) {
    const value = cursor.value as PersistedAssetV1;
    if (!refs.has(value.id)) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return { removed };
}

export async function persistExportProjectZip(projectId: string): Promise<Blob> {
  const JSZip = await loadJSZip();
  const db = await getDB();
  const project = await db.get('projects', projectId);
  const rawBoard = await db.get('boards', projectId);
  if (!project || !rawBoard) {
    throw new Error('Project not found');
  }
  const sortConfig = normalizePersistedSortConfig(rawBoard.sortConfig);
  const board: PersistedBoardV1 = {
    ...rawBoard,
    version: 2,
    sortConfig,
    cardLayoutMode: normalizeCardLayoutMode(rawBoard.cardLayoutMode),
    ...(() => {
      const stackNormalized = normalizeCardStackMembership(
        normalizePersistedCards(rawBoard.cards),
        normalizePersistedStacks(rawBoard.stacks)
      );
      const workflowNormalized = normalizeBoardWorkflowState(
        sortConfig,
        stackNormalized.cards,
        rawBoard.workflow,
        rawBoard.activeStageId,
        rawBoard.closedContainers,
        rawBoard.cardW,
        rawBoard.cardH
      );
      const closedNormalized = normalizeCardClosedMembership(
        workflowNormalized.cards,
        workflowNormalized.closedContainers
      );
      return {
        stacks: stackNormalized.stacks,
        workflow: workflowNormalized.workflow,
        activeStageId: workflowNormalized.activeStageId,
        closedContainers: closedNormalized.closedContainers,
        cards: closedNormalized.cards,
      };
    })(),
  };
  const sessions = ((await db.getAllFromIndex('sessions', 'byBoardId', projectId)) as PersistedSessionV1[]).map((session) => ({
    ...session,
    recording: normalizeRecording(session.recording),
  }));

  const assetIds = new Set<string>();
  collectAssetIdsFromBoard(board, assetIds);
  for (const session of sessions) {
    collectAssetIdsFromRecording(session.recording, assetIds);
  }

  const assets: ProjectExportAssetV1[] = [];
  const zip = new JSZip();
  const assetsFolder = zip.folder('assets');
  if (!assetsFolder) {
    throw new Error('Failed to initialize export archive');
  }

  for (const assetId of assetIds) {
    const asset = await db.get('assets', assetId);
    if (!asset) continue;
    const blob = hydrateAssetBlob(asset.blob, asset.mime);
    const ext = getExtFromMime(asset.mime);
    const file = `assets/${asset.id}.${ext}`;
    assets.push({ id: asset.id, mime: asset.mime, file });
    assetsFolder.file(`${asset.id}.${ext}`, await blob.arrayBuffer());
  }

  const manifest: ProjectExportManifestV1 = {
    format: 'sortboard-project-export',
    version: 1,
    exportedAt: new Date().toISOString(),
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file('board.json', JSON.stringify(board, null, 2));
  zip.file('sessions.json', JSON.stringify(sessions.map((s) => ({ ...s, recording: sanitizeRecording(s.recording) })), null, 2));
  zip.file('assets.json', JSON.stringify(assets, null, 2));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function persistImportProjectZip(file: Blob): Promise<{ projectId: string }> {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestRaw = await zip.file('manifest.json')?.async('string');
  const projectRaw = await zip.file('project.json')?.async('string');
  const boardRaw = await zip.file('board.json')?.async('string');
  const sessionsRaw = await zip.file('sessions.json')?.async('string');
  const assetsRaw = await zip.file('assets.json')?.async('string');

  if (!manifestRaw || !projectRaw || !boardRaw || !sessionsRaw || !assetsRaw) {
    throw new Error('Missing required export files');
  }

  const manifest = parseJson<ProjectExportManifestV1>(manifestRaw, 'manifest.json');
  validateManifest(manifest);

  const importedProject = parseJson<PersistedProjectV1>(projectRaw, 'project.json');
  const importedBoardRaw = parseJson<PersistedBoardV1>(boardRaw, 'board.json');
  const importedSessionsRaw = parseJson<PersistedSessionV1[]>(sessionsRaw, 'sessions.json');
  const importedAssets = parseJson<ProjectExportAssetV1[]>(assetsRaw, 'assets.json');

  if (!importedProject || !importedBoardRaw || !Array.isArray(importedSessionsRaw) || !Array.isArray(importedAssets)) {
    throw new Error('Invalid archive payload');
  }
  const importedBoard: PersistedBoardV1 = {
    ...importedBoardRaw,
    version: 2,
    sortConfig: normalizePersistedSortConfig(importedBoardRaw.sortConfig),
    cardLayoutMode: normalizeCardLayoutMode(importedBoardRaw.cardLayoutMode),
    ...(() => {
      const stackNormalized = normalizeCardStackMembership(
        normalizePersistedCards(importedBoardRaw.cards || []),
        normalizePersistedStacks(importedBoardRaw.stacks)
      );
      const workflowNormalized = normalizeBoardWorkflowState(
        normalizePersistedSortConfig(importedBoardRaw.sortConfig),
        stackNormalized.cards,
        importedBoardRaw.workflow,
        importedBoardRaw.activeStageId,
        importedBoardRaw.closedContainers,
        importedBoardRaw.cardW,
        importedBoardRaw.cardH
      );
      const closedNormalized = normalizeCardClosedMembership(
        workflowNormalized.cards,
        workflowNormalized.closedContainers
      );
      return {
        stacks: stackNormalized.stacks,
        workflow: workflowNormalized.workflow,
        activeStageId: workflowNormalized.activeStageId,
        closedContainers: closedNormalized.closedContainers,
        cards: closedNormalized.cards,
      };
    })(),
  };
  const importedSessions: PersistedSessionV1[] = importedSessionsRaw.map((session) => ({
    ...session,
    recording: normalizeRecording(session.recording),
  }));

  const importedAssetBlobs = new Map<string, Blob>();
  for (const item of importedAssets) {
    const sourceFile = zip.file(item.file);
    if (!sourceFile) {
      throw new Error(`Missing asset file: ${item.file}`);
    }
    const blob = await sourceFile.async('blob');
    importedAssetBlobs.set(item.id, normalizeAssetBlob(blob, item.mime || blob.type || 'application/octet-stream'));
  }

  const db = await getDB();
  const existingProjects = await db.getAll('projects');
  const existingProjectNames = new Set(existingProjects.map((p) => p.name));
  const existingSessionIds = new Set((await db.getAllKeys('sessions')).map((x) => String(x)));

  const projectId = nanoid();
  const projectName = uniqueProjectName(importedProject.name || 'Imported Project', existingProjectNames);
  const now = Date.now();

  const assetIdMap = new Map<string, string>();
  const importedBlobs = new Map<string, { id: string; mime: string; blob: ArrayBuffer }>();
  for (const item of importedAssets) {
    const blob = importedAssetBlobs.get(item.id);
    if (!blob) {
      throw new Error(`Missing asset payload: ${item.file}`);
    }
    const id = nanoid();
    assetIdMap.set(item.id, id);
    importedBlobs.set(item.id, {
      id,
      mime: item.mime || blob.type || 'application/octet-stream',
      blob: await cloneAssetBlobForStorage(blob),
    });
  }

  const sessionIdMap = new Map<string, string>();
  const remappedSessions = importedSessions.map((session, idx) => {
    const sessionId = nextIsoSessionId(existingSessionIds, now + idx);
    sessionIdMap.set(session.id, sessionId);
    return {
      version: 1 as const,
      id: sessionId,
      boardId: projectId,
      updatedAt: now + idx,
      recording: remapRecordingAssetIds(session.recording, assetIdMap, sessionId),
    };
  });

  const remappedBoard: PersistedBoardV1 = {
    ...importedBoard,
    version: 2,
    id: projectId,
    updatedAt: now,
    cardLayoutMode: normalizeCardLayoutMode(importedBoard.cardLayoutMode),
    stacks: importedBoard.stacks,
    closedContainers: importedBoard.closedContainers,
    cards: importedBoard.cards.map((c) => {
      if (c.kind === 'text') return { ...c, assetId: undefined, posterAssetId: undefined };
      return {
        ...c,
        assetId: c.assetId ? assetIdMap.get(c.assetId) : undefined,
        posterAssetId: c.kind === 'video' && c.posterAssetId ? assetIdMap.get(c.posterAssetId) : undefined,
      };
    }),
    activeSessionId: importedBoard.activeSessionId ? sessionIdMap.get(importedBoard.activeSessionId) : undefined,
  };

  const project: PersistedProjectV1 = {
    version: 1,
    id: projectId,
    name: projectName,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction(['projects', 'boards', 'sessions', 'assets', 'meta'], 'readwrite');
  const projects = tx.objectStore('projects');
  const boards = tx.objectStore('boards');
  const sessions = tx.objectStore('sessions');
  const assets = tx.objectStore('assets');
  const meta = tx.objectStore('meta');

  projects.put(project, project.id);
  boards.put(remappedBoard, remappedBoard.id);

  for (const item of remappedSessions) {
    sessions.put(item, item.id);
  }

  for (const item of importedBlobs.values()) {
    assets.put(
      {
        version: 1,
        id: item.id,
        mime: item.mime,
        blob: item.blob,
        createdAt: now,
      },
      item.id
    );
  }

  meta.put({ key: 'activeProjectId', value: projectId }, 'activeProjectId');
  await tx.done;

  return { projectId };
}

export async function persistDeleteAll() {
  const db = await getDB();
  const tx = db.transaction(['boards', 'assets', 'sessions', 'projects', 'meta', 'setupUndo'], 'readwrite');
  await Promise.all([
    tx.objectStore('boards').clear(),
    tx.objectStore('assets').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('projects').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('setupUndo').clear(),
  ]);
  await tx.done;
}
