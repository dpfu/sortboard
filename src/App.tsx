import * as React from 'react';
import { nanoid } from 'nanoid';
import { Board } from './Board';
import type { ResizeEdge } from './DraggableCard';
import { CardDetailsPanel, type DetailsPanelContext, type StackOption } from './CardDetailsPanel';
import { VideoPreviewDialog } from './VideoPreviewDialog';
import type {
  BoardWidgetData,
  CardData,
  CardLayoutMode,
  CardMetadataV1,
  ClosedContainerData,
  DragSegment,
  Mode,
  RecordingSession,
  SortWorkflowData,
  StackData,
  StackSortKey,
  SortConfig,
  SortType,
  TraceSample,
} from './types';
import { SUPPORTED_MEDIA_ACCEPT, clamp, detectMediaKind, isSupportedMediaFile } from './utils';
import { clampToBoard as clampToBoardPure, snapClosed as snapClosedPure } from './positioning';
import { useElementSize } from './useElementSize';
import {
  CARD_SIZE_SCALE_MAX,
  CARD_SIZE_SCALE_MIN,
  fixedCardHeightFromWidth,
  getCardDimensions,
  isValidAspectRatio,
  normalizeCardLayoutMode,
  normalizeCardSizeScale,
} from './cardLayout';
import { readImageAspectRatioFromBlob, readVideoMetadataFromBlob } from './media';
import {
  createCardMetadata,
  persistDeleteAsset,
  normalizeCardMetadata,
  persistClearSetupUndo,
  persistDeleteSession,
  persistGarbageCollectUnreferencedAssets,
  persistDeleteProject,
  persistExportProjectZip,
  persistGetActiveProjectId,
  persistGetAsset,
  persistGetBoard,
  persistGetSetupUndo,
  persistImportProjectZip,
  persistListProjects,
  persistListSessions,
  persistPutAsset,
  persistPutBoard,
  persistPutSetupUndo,
  persistPutProject,
  persistPutSession,
  persistSetActiveProjectId,
  persistTouchProject,
  type BoardId,
  type PersistedBoardV1,
  type PersistedClosedContainerV1,
  type PersistedSessionV1,
  type PersistedStackV1,
  type PersistedProjectV1,
  type SetupSnapshotV1,
} from './persist';
import { MAX_SETUP_UNDO_SNAPSHOTS, appendSetupSnapshot, isEditableTarget } from './setupUndo';
import { buildReplayIndex, replayCardsAt, replayStageIdAt, type ReplayIndex } from './replayIndex';
import { ReplayTimeline, formatTimeMs } from './ReplayTimeline';
import {
  addClosedCategoryWidget,
  buildNormalDistributionBuckets,
  createWorkflowForTemplate,
  getClosedCategoryWidgets,
  getDefaultActiveStageId,
  getNextStageId,
  getQSortWidget,
  getSeedSourceWidget,
  getSourceWidget,
  getTemplateLabel,
  isWorkflowConfiguredForSorting,
  migrateLegacyClosedCardAssignments,
  migrateLegacyClosedContainersToWorkflow,
  projectClosedCardsForStage,
  patchWorkflowWidget,
  removeWidgetFromWorkflow,
  toLegacyClosedContainers,
  WIDGET_ZONE_CONTENT,
} from './workflow';
import {
  assignCardsToWidgetZone,
  assignUnassignedCardsToWidgetZone,
  type CardBounds as WidgetCardBounds,
  clampWidgetRect,
  countCardsInWidgetZone,
  getMinimumWidgetSize,
  isStageComplete,
  moveAssignedCardsToWidgetZone,
  seedStageAssignments,
  transitionPreSortToQSort,
  validateWidgetDrop,
  visibleCardsForStage,
  type WidgetDropState,
} from './widgetSort';
import {
  buildStageSurfaceScene,
  findStageSurfaceDropTarget,
  reflowCardsForStage as reflowStageSurfaceCards,
  type StageSurfaceScene,
} from './stageSurface';
import {
  addCardsToStack,
  compactStackLayout,
  createStack,
  createStackName,
  dissolveSmallStacks,
  findDropStackTarget,
  getStackCards,
  getStackCount,
  getTopCardForStack,
  removeCardsFromStack,
  shuffleStack,
  sortStack,
  splitStack,
} from './stacks';

const DEFAULT_CARD_W = 240;
const CARD_W_MIN = 160;
const CARD_W_MAX = 360;
const CARD_W_STEP = 8;
const DEFAULT_SORT_CONFIG: SortConfig = { type: 'open', columns: 3 };
const DEFAULT_PROJECT_NAME = 'Demo Project';
const DEMO_CARD_COUNT = 24;
const DEFAULT_CARD_LAYOUT_MODE: CardLayoutMode = 'as-is';
const DEFAULT_STACK_SORT_KEY: StackSortKey = 'name';
const STACK_SPLIT_OFFSET_PX = 32;
const SETUP_DETAILS_DRAWER_MEDIA_QUERY = '(max-width: 1120px)';

type ProjectBootstrapResult = {
  projects: PersistedProjectV1[];
  activeProjectId: string | null;
};

let projectBootstrapPromise: Promise<ProjectBootstrapResult> | null = null;

type SessionItem = { id: string; updatedAt: number; recording: RecordingSession };
type ReplayViewState = {
  recording: RecordingSession;
  index: ReplayIndex;
};
type SetupGroupDragState = {
  leaderId: string;
  leaderStart: { x: number; y: number };
  selectedIds: string[];
  startById: Map<string, { x: number; y: number }>;
};

type StackDragState = {
  stackId: string;
  leaderId: string;
  leaderStart: { x: number; y: number };
  pointerStart: { x: number; y: number };
  memberIds: string[];
  startById: Map<string, { x: number; y: number }>;
};

type WidgetDragState = {
  widgetId: string;
  pointerStart: { x: number; y: number };
  rectStart: { x: number; y: number; w: number; h: number };
};

type WidgetResizeState = {
  widgetId: string;
  edge: ResizeEdge;
  pointerStart: { x: number; y: number };
  rectStart: { x: number; y: number; w: number; h: number };
};

type WidgetDropIndicator = {
  widgetId: string;
  zoneId: string;
  state: WidgetDropState;
};

type WidgetSetupSnapshot = {
  cards: CardData[];
  stacks: StackData[];
  workflow: SortWorkflowData;
  activeStageId: string | null;
};

type SetupResizeCardStart = {
  startScale: number;
  centerX: number;
  centerY: number;
  minRatio: number;
  maxRatio: number;
};

function resizeDeltaForEdge(edge: ResizeEdge, dx: number, dy: number) {
  switch (edge) {
    case 'e':
      return dx;
    case 'w':
      return -dx;
    case 'n':
      return -dy;
    case 's':
      return dy;
    case 'ne':
      return (dx - dy) / 2;
    case 'nw':
      return (-dx - dy) / 2;
    case 'se':
      return (dx + dy) / 2;
    case 'sw':
      return (-dx + dy) / 2;
    default:
      return dx;
  }
}

function resizeRectForEdge(
  rect: { x: number; y: number; w: number; h: number },
  edge: ResizeEdge,
  dx: number,
  dy: number
) {
  switch (edge) {
    case 'n':
      return { x: rect.x, y: rect.y + dy, w: rect.w, h: rect.h - dy };
    case 's':
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h + dy };
    case 'e':
      return { x: rect.x, y: rect.y, w: rect.w + dx, h: rect.h };
    case 'w':
      return { x: rect.x + dx, y: rect.y, w: rect.w - dx, h: rect.h };
    case 'ne':
      return { x: rect.x, y: rect.y + dy, w: rect.w + dx, h: rect.h - dy };
    case 'nw':
      return { x: rect.x + dx, y: rect.y + dy, w: rect.w - dx, h: rect.h - dy };
    case 'se':
      return { x: rect.x, y: rect.y, w: rect.w + dx, h: rect.h + dy };
    case 'sw':
      return { x: rect.x + dx, y: rect.y, w: rect.w - dx, h: rect.h + dy };
    default:
      return rect;
  }
}

function cursorForResizeEdge(edge: ResizeEdge) {
  switch (edge) {
    case 'n':
      return 'n-resize';
    case 's':
      return 's-resize';
    case 'e':
      return 'e-resize';
    case 'w':
      return 'w-resize';
    case 'ne':
      return 'ne-resize';
    case 'nw':
      return 'nw-resize';
    case 'se':
      return 'se-resize';
    case 'sw':
      return 'sw-resize';
    default:
      return 'nwse-resize';
  }
}

function fileNameWithoutExtension(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\.[^/.]+$/, '');
}

function defaultTextMeta(index: number) {
  const name = `Card ${index + 1}`;
  return createCardMetadata(name, '', [], { frontText: name, color: 'slate' });
}

function defaultImageMeta(index: number, fileName?: string, aspectRatio?: number) {
  const fromName = fileName ? fileNameWithoutExtension(fileName) : '';
  return createCardMetadata(fromName || `Image ${index + 1}`, '', [], {
    aspectRatio,
    originalFileName: fileName,
  });
}

function defaultVideoMeta(
  index: number,
  fileName?: string,
  options: { aspectRatio?: number; durationSec?: number } = {}
) {
  const fromName = fileName ? fileNameWithoutExtension(fileName) : '';
  return createCardMetadata(fromName || `Video ${index + 1}`, '', [], {
    aspectRatio: options.aspectRatio,
    durationSec: options.durationSec,
    originalFileName: fileName,
  });
}

function fallbackCardNameForKind(kind: CardData['kind'] | 'dummy', index: number) {
  if (kind === 'text' || kind === 'dummy') return `Card ${index + 1}`;
  if (kind === 'video') return `Video ${index + 1}`;
  return `Image ${index + 1}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sortTypeDescription(type: SortType) {
  if (type === 'closed') return 'Sort cards into named categories.';
  if (type === 'qsort') return 'Split cards into two groups, then place them on a scale.';
  return 'Arrange cards freely and create stacks.';
}

function nextCreatedAt(index = 0) {
  return Date.now() + index;
}

type LegacyCardData = Omit<CardData, 'kind'> & { kind: CardData['kind'] | 'dummy' };

function normalizeCard(card: LegacyCardData, index: number): CardData {
  const kind = card.kind === 'dummy' ? 'text' : card.kind;
  return {
    ...card,
    kind,
    createdAt: typeof card.createdAt === 'number' ? card.createdAt : index + 1,
    sizeScale: normalizeCardSizeScale(card.sizeScale),
    stackId: typeof card.stackId === 'string' ? card.stackId : undefined,
    stackOrder: typeof card.stackOrder === 'number' ? card.stackOrder : undefined,
    widgetAssignments: card.widgetAssignments,
    closedContainerId: typeof card.closedContainerId === 'string' ? card.closedContainerId : undefined,
    closedContainerOrder: typeof card.closedContainerOrder === 'number' ? card.closedContainerOrder : undefined,
    assetId: kind === 'text' ? undefined : card.assetId,
    src: kind === 'text' ? undefined : card.src,
    posterAssetId: kind === 'video' ? card.posterAssetId : undefined,
    posterSrc: kind === 'video' ? card.posterSrc : undefined,
    meta: normalizeCardMetadata(card.meta, fallbackCardNameForKind(kind, index), kind),
  };
}

function normalizeCards(cards: LegacyCardData[]) {
  return cards.map((card, index) => normalizeCard(card, index));
}

function createTextCard(index: number, z: number): CardData {
  return {
    id: nanoid(),
    kind: 'text',
    createdAt: nextCreatedAt(index),
    meta: defaultTextMeta(index),
    x: 28 + index * 18,
    y: 28 + index * 18,
    z,
  };
}

function createInitialCards(): CardData[] {
  return Array.from({ length: 6 }).map((_, i) => createTextCard(i, i + 1));
}

function toPersistedCards(cards: CardData[]) {
  return cards.map((c, index) => ({
    id: c.id,
    kind: c.kind,
    createdAt: c.createdAt,
    sizeScale: normalizeCardSizeScale(c.sizeScale),
    stackId: c.stackId,
    stackOrder: c.stackOrder,
    widgetAssignments: c.widgetAssignments,
    closedContainerId: c.closedContainerId,
    closedContainerOrder: c.closedContainerOrder,
    meta: normalizeCardMetadata(c.meta, fallbackCardNameForKind(c.kind, index), c.kind),
    x: c.x,
    y: c.y,
    z: c.z,
    assetId: c.kind === 'image' || c.kind === 'video' ? c.assetId : undefined,
    posterAssetId: c.kind === 'video' ? c.posterAssetId : undefined,
  }));
}

function toPersistedStacks(stacks: StackData[]): PersistedStackV1[] {
  return stacks.map((stack) => ({
    id: stack.id,
    name: stack.name,
    createdAt: stack.createdAt,
  }));
}

function toPersistedClosedContainers(closedContainers: ClosedContainerData[]): PersistedClosedContainerV1[] {
  return closedContainers.map((container) => ({ ...container }));
}

function toPersistedWorkflow(workflow: SortWorkflowData): SortWorkflowData {
  return {
    templateId: workflow.templateId,
    stages: workflow.stages.map((stage) => ({ ...stage })) as SortWorkflowData['stages'],
    widgets: workflow.widgets.map((widget) => ({ ...widget })) as BoardWidgetData[],
  };
}

function sanitizeRecording(recording: RecordingSession): RecordingSession {
  const closedStageId =
    recording.sortConfig.type === 'closed'
      ? recording.activeStageIdAtStart || getDefaultActiveStageId(recording.workflowAtStart)
      : null;
  const closedContainersAtStart =
    recording.sortConfig.type === 'closed' && recording.workflowAtStart
      ? toLegacyClosedContainers(recording.workflowAtStart, closedStageId || undefined)
      : [];
  const cardsAtStart =
    recording.sortConfig.type === 'closed' && recording.workflowAtStart && closedStageId
      ? projectClosedCardsForStage(recording.cardsAtStart, closedStageId)
      : recording.cardsAtStart;
  return {
    ...recording,
    version: 5,
    workflowAtStart: recording.workflowAtStart
      ? {
          templateId: recording.workflowAtStart.templateId,
          stages: recording.workflowAtStart.stages.map((stage) => ({ ...stage })),
          widgets: recording.workflowAtStart.widgets.map((widget) => ({ ...widget })) as BoardWidgetData[],
        }
      : undefined,
    closedContainersAtStart: toPersistedClosedContainers(closedContainersAtStart),
    cardsAtStart: normalizeCards(cardsAtStart).map((c) => ({ ...c, src: undefined, posterSrc: undefined })),
  };
}

function deriveClosedContainersForPersistence(
  sortConfig: SortConfig,
  workflow: SortWorkflowData,
  activeStageId: string | null | undefined
) {
  if (sortConfig.type !== 'closed') return [] as PersistedClosedContainerV1[];
  return toPersistedClosedContainers(toLegacyClosedContainers(workflow, activeStageId || undefined));
}

function projectCardsForPersistence(
  cards: CardData[],
  sortConfig: SortConfig,
  _workflow: SortWorkflowData,
  activeStageId: string | null | undefined
) {
  if (sortConfig.type !== 'closed' || !activeStageId) return toPersistedCards(cards);
  return toPersistedCards(projectClosedCardsForStage(cards, activeStageId));
}

function resolveRuntimeWorkflowState(
  sortConfig: SortConfig,
  workflow: SortWorkflowData | null | undefined,
  activeStageId: string | null | undefined,
  legacyClosedContainers: ClosedContainerData[] | undefined,
  cards: CardData[],
  boardW = 1200,
  boardH = 800
) {
  if (sortConfig.type === 'open') {
    return {
      workflow: createWorkflowForTemplate('open', boardW, boardH, cards.length),
      activeStageId: null,
      cards,
    };
  }

  const nextWorkflow =
    workflow?.templateId === sortConfig.type
      ? toPersistedWorkflow(workflow)
      : sortConfig.type === 'closed' && legacyClosedContainers && legacyClosedContainers.length > 0
        ? migrateLegacyClosedContainersToWorkflow(legacyClosedContainers)
        : createWorkflowForTemplate(sortConfig.type, boardW, boardH, cards.length);
  const nextStageId = activeStageId || getDefaultActiveStageId(nextWorkflow);
  let nextCards = cards;

  if (sortConfig.type === 'closed' && nextStageId && legacyClosedContainers && legacyClosedContainers.length > 0) {
    const hasAssignments = nextCards.some((card) => !!card.widgetAssignments?.[nextStageId]);
    if (!hasAssignments) {
      nextCards = migrateLegacyClosedCardAssignments(nextCards, legacyClosedContainers, nextStageId);
    }
  }

  const seedSource = getSeedSourceWidget(nextWorkflow, nextStageId);
  if (seedSource) {
    nextCards = assignUnassignedCardsToWidgetZone(nextCards, seedSource.stageId, seedSource.widget.id, WIDGET_ZONE_CONTENT);
  }

  return {
    workflow: nextWorkflow,
    activeStageId: nextStageId,
    cards: nextCards,
  };
}

function migrateRecording(recAny: any): RecordingSession {
  if (recAny && Array.isArray(recAny.segments)) {
    return {
      ...recAny,
      version: 5,
      closedContainersAtStart: Array.isArray(recAny.closedContainersAtStart) ? recAny.closedContainersAtStart : [],
      cardsAtStart: normalizeCards(Array.isArray(recAny.cardsAtStart) ? recAny.cardsAtStart : []),
    };
  }
  return {
    version: 5,
    createdAt: recAny.createdAt,
    cardW: recAny.cardW,
    cardH: recAny.cardH,
    boardW: recAny.boardW,
    boardH: recAny.boardH,
    sortConfig: recAny.sortConfig,
    closedContainersAtStart: [],
    cardsAtStart: normalizeCards(Array.isArray(recAny.cardsAtStart) ? recAny.cardsAtStart : []),
    segments: Array.isArray(recAny?.traces)
      ? recAny.traces.map((tr: any) => {
          const first = tr.samples?.[0] as TraceSample | undefined;
          const last = tr.samples?.[tr.samples.length - 1] as TraceSample | undefined;
          const fromX = first ? first[1] : 0;
          const fromY = first ? first[2] : 0;
          const dropX = last ? last[1] : fromX;
          const dropY = last ? last[2] : fromY;
          return {
            type: 'drag',
            id: nanoid(),
            cardId: tr.cardId,
            t0: tr.startMs ?? (first ? first[0] : 0),
            t1: tr.endMs ?? (last ? last[0] : tr.startMs ?? 0),
            from: { x: fromX, y: fromY },
            path: Array.isArray(tr.samples) ? tr.samples : ([] as TraceSample[]),
            drop: { x: dropX, y: dropY },
            final: { x: dropX, y: dropY },
            settleMs: 0,
          };
        })
      : [],
  };
}

function sanitizeFileName(name: string) {
  const base = name.trim() || 'project';
  return base.replace(/[^a-z0-9-_ ]/gi, '_').replace(/\s+/g, '-').toLowerCase();
}

async function readAspectRatioFromBlob(blob: Blob): Promise<number | undefined> {
  return readImageAspectRatioFromBlob(blob);
}

function clampCardWidth(width: number) {
  return clamp(Math.round(width), CARD_W_MIN, CARD_W_MAX);
}

const DEMO_CARD_PALETTES = [
  ['#f4f0e7', '#243642', '#e7a23b'],
  ['#edf7f2', '#265947', '#d76847'],
  ['#f3edf8', '#3b315f', '#7db6d8'],
  ['#eef3fb', '#244a70', '#d2a33d'],
  ['#f8eeee', '#673b44', '#58a48d'],
  ['#edf2ea', '#35472d', '#bf6f4a'],
] as const;

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return char;
    }
  });
}

function createLocalDemoImageBlob(index: number) {
  const [background, ink, accent] = DEMO_CARD_PALETTES[index % DEMO_CARD_PALETTES.length]!;
  const label = escapeSvgText(`Demo ${index + 1}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<rect width="960" height="540" rx="36" fill="${background}"/>
<circle cx="${160 + (index % 4) * 120}" cy="${140 + (index % 3) * 48}" r="92" fill="${accent}" opacity="0.9"/>
<path d="M96 388 C 226 298, 326 458, 456 360 S 692 258, 864 352" fill="none" stroke="${ink}" stroke-width="24" stroke-linecap="round"/>
<path d="M108 430 L 840 430" stroke="${ink}" stroke-width="4" stroke-linecap="round" opacity="0.35"/>
<text x="72" y="104" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="700" fill="${ink}">${label}</text>
<text x="76" y="162" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" letter-spacing="6" fill="${ink}" opacity="0.62">LOCAL DEMO CARD</text>
</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function bootstrapProjectsOnce(createDemoProjectCards: (count?: number) => Promise<CardData[]>) {
  if (!projectBootstrapPromise) {
    projectBootstrapPromise = (async () => {
      let listed = await persistListProjects();

      if (listed.length === 0) {
        const projectId = nanoid();
        const now = Date.now();
        const starter = await createDemoProjectCards(DEMO_CARD_COUNT);
        await persistPutProject({
          version: 1,
          id: projectId,
          name: DEFAULT_PROJECT_NAME,
          createdAt: now,
          updatedAt: now,
        });
        await persistPutBoard({
          version: 2,
          id: projectId,
          updatedAt: now,
          sortConfig: DEFAULT_SORT_CONFIG,
          cardW: DEFAULT_CARD_W,
          cardH: fixedCardHeightFromWidth(DEFAULT_CARD_W),
          cardLayoutMode: DEFAULT_CARD_LAYOUT_MODE,
          stacks: [],
          workflow: createWorkflowForTemplate('open', 1200, 800, starter.length),
          activeStageId: undefined,
          closedContainers: [],
          cards: toPersistedCards(starter),
        });
        await persistSetActiveProjectId(projectId);
        listed = await persistListProjects();
      }

      let active = await persistGetActiveProjectId();
      if (!active || !listed.some((p) => p.id === active)) {
        active = listed[0]?.id || null;
        if (active) {
          await persistSetActiveProjectId(active);
        }
      }

      return { projects: listed, activeProjectId: active };
    })().finally(() => {
      projectBootstrapPromise = null;
    });
  }

  return projectBootstrapPromise;
}

export default function App() {
  const boardRef = React.useRef<HTMLDivElement>(null);
  const boardSize = useElementSize(boardRef);

  const [mode, setMode] = React.useState<Mode>('setup');
  const [sortConfig, setSortConfig] = React.useState<SortConfig>(DEFAULT_SORT_CONFIG);
  const [cards, setCards] = React.useState<CardData[]>(() => createInitialCards());
  const [stacks, setStacks] = React.useState<StackData[]>([]);
  const [workflow, setWorkflow] = React.useState<SortWorkflowData>(() => createWorkflowForTemplate('open', 1200, 800, 0));
  const [activeStageId, setActiveStageId] = React.useState<string | null>(null);
  const [cardWidth, setCardWidth] = React.useState(DEFAULT_CARD_W);
  const [cardLayoutMode, setCardLayoutMode] = React.useState<CardLayoutMode>(DEFAULT_CARD_LAYOUT_MODE);
  const [projects, setProjects] = React.useState<PersistedProjectV1[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [isProjectHydrated, setIsProjectHydrated] = React.useState(false);
  const [projectStatus, setProjectStatus] = React.useState<string>('');
  const [isProjectBusy, setIsProjectBusy] = React.useState(false);
  const setupUndoPastByProjectRef = React.useRef<Map<string, SetupSnapshotV1[]>>(new Map());
  const [setupUndoPast, setSetupUndoPast] = React.useState<SetupSnapshotV1[]>([]);
  const [selectedCardIds, setSelectedCardIds] = React.useState<string[]>([]);
  const [selectedStackId, setSelectedStackId] = React.useState<string | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = React.useState<string | null>(null);
  const [stackSortKey, setStackSortKey] = React.useState<StackSortKey>(DEFAULT_STACK_SORT_KEY);
  const [isDetailsDrawerOpen, setIsDetailsDrawerOpen] = React.useState(false);
  const [isResizingCard, setIsResizingCard] = React.useState(false);
  const [previewCardId, setPreviewCardId] = React.useState<string | null>(null);
  const [isNarrowSetupLayout, setIsNarrowSetupLayout] = React.useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(SETUP_DETAILS_DRAWER_MEDIA_QUERY).matches;
  });
  const activeProject = React.useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [activeProjectId, projects]
  );
  const selectedCards = React.useMemo(() => {
    if (selectedCardIds.length === 0) return [] as CardData[];
    const byId = new Map(cards.map((card) => [card.id, card]));
    return selectedCardIds.map((id) => byId.get(id)).filter(Boolean) as CardData[];
  }, [cards, selectedCardIds]);
  const selectedCard = selectedCards.length === 1 ? selectedCards[0] : null;
  const selectedCardCount = selectedCards.length;
  const previewCard = React.useMemo(
    () => (previewCardId ? cards.find((card) => card.id === previewCardId && card.kind === 'video') || null : null),
    [cards, previewCardId]
  );
  const selectedStack = React.useMemo(
    () => stacks.find((stack) => stack.id === selectedStackId) || null,
    [selectedStackId, stacks]
  );
  const selectedWidget = React.useMemo(
    () => workflow.widgets.find((widget) => widget.id === selectedWidgetId) || null,
    [selectedWidgetId, workflow.widgets]
  );
  const selectedStackCards = React.useMemo(
    () => (selectedStackId ? getStackCards(cards, selectedStackId) : []),
    [cards, selectedStackId]
  );
  const selectedStackCount = selectedStackCards.length;
  const cardResizeCleanupRef = React.useRef<(() => void) | null>(null);
  const cardHeight = React.useMemo(() => fixedCardHeightFromWidth(cardWidth), [cardWidth]);
  const boardId: BoardId | null = activeProjectId;
  const activeProjectIdRef = React.useRef<string | null>(activeProjectId);
  const activateProject = React.useCallback((projectId: string | null) => {
    if (activeProjectIdRef.current === projectId) return;
    activeProjectIdRef.current = projectId;
    setIsProjectHydrated(false);
    setActiveProjectId(projectId);
  }, []);
  React.useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);
  const selectedCardIdsRef = React.useRef<string[]>(selectedCardIds);
  React.useEffect(() => {
    selectedCardIdsRef.current = selectedCardIds;
  }, [selectedCardIds]);
  const selectedStackIdRef = React.useRef<string | null>(selectedStackId);
  React.useEffect(() => {
    selectedStackIdRef.current = selectedStackId;
  }, [selectedStackId]);
  const activeStageIdRef = React.useRef<string | null>(activeStageId);
  React.useEffect(() => {
    activeStageIdRef.current = activeStageId;
  }, [activeStageId]);
  const modeRef = React.useRef<Mode>(mode);
  modeRef.current = mode;
  const isResizingCardRef = React.useRef(isResizingCard);
  React.useEffect(() => {
    isResizingCardRef.current = isResizingCard;
  }, [isResizingCard]);
  React.useEffect(() => {
    if (mode !== 'setup') {
      setSelectedCardIds([]);
      setSelectedStackId(null);
      setSelectedWidgetId(null);
      setIsDetailsDrawerOpen(false);
      setupGroupDragRef.current = null;
      stackDragRef.current = null;
    }
  }, [mode]);
  React.useEffect(() => {
    if (selectedCardCount === 0 && !selectedStackId && !selectedWidgetId) {
      setIsDetailsDrawerOpen(false);
    }
  }, [selectedCardCount, selectedStackId, selectedWidgetId]);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(SETUP_DETAILS_DRAWER_MEDIA_QUERY);
    const update = (event?: MediaQueryListEvent) => {
      setIsNarrowSetupLayout(event ? event.matches : media.matches);
    };
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);
  React.useEffect(() => {
    if (selectedCardIds.length === 0) return;
    const existing = new Set(cards.map((card) => card.id));
    const next = selectedCardIds.filter((id) => existing.has(id));
    if (next.length === selectedCardIds.length) return;
    setSelectedCardIds(next);
  }, [cards, selectedCardIds]);
  React.useEffect(() => {
    if (!selectedStackId) return;
    if (stacks.some((stack) => stack.id === selectedStackId)) return;
    setSelectedStackId(null);
  }, [selectedStackId, stacks]);
  React.useEffect(() => {
    if (!selectedWidgetId) return;
    if (workflow.widgets.some((widget) => widget.id === selectedWidgetId)) return;
    setSelectedWidgetId(null);
  }, [selectedWidgetId, workflow.widgets]);

  const assetGcTimerRef = React.useRef<number | null>(null);
  const runSafePersistence = React.useCallback(async (label: string, task: () => Promise<void>) => {
    try {
      await task();
      setProjectStatus((prev) =>
        prev.startsWith('Couldn’t save your latest changes') ? '' : prev
      );
      return true;
    } catch (err) {
      console.error(`[persist] ${label} failed`, err);
      if (modeRef.current === 'setup') {
        setProjectStatus((prev) =>
          prev && !prev.startsWith('Couldn’t save your latest changes')
            ? prev
            : 'Couldn’t save your latest changes in this browser. Keep this tab open to avoid losing them.'
        );
      }
      return false;
    }
  }, []);

  const scheduleAssetGc = React.useCallback(
    (reason: string) => {
      if (assetGcTimerRef.current != null) {
        window.clearTimeout(assetGcTimerRef.current);
      }
      assetGcTimerRef.current = window.setTimeout(() => {
        assetGcTimerRef.current = null;
        void runSafePersistence(`asset cleanup: ${reason}`, async () => {
          await persistGarbageCollectUnreferencedAssets();
        });
      }, 900);
    },
    [runSafePersistence]
  );

  React.useEffect(() => {
    return () => {
      if (assetGcTimerRef.current != null) {
        window.clearTimeout(assetGcTimerRef.current);
        assetGcTimerRef.current = null;
      }
    };
  }, []);

  const cancelCardResize = React.useCallback(() => {
    if (cardResizeCleanupRef.current) {
      cardResizeCleanupRef.current();
      cardResizeCleanupRef.current = null;
    }
    setIsResizingCard(false);
  }, []);

  const cancelWidgetInteraction = React.useCallback(() => {
    if (widgetInteractionCleanupRef.current) {
      widgetInteractionCleanupRef.current();
      widgetInteractionCleanupRef.current = null;
    }
    widgetDragRef.current = null;
    widgetResizeRef.current = null;
  }, []);

  React.useEffect(() => cancelCardResize, [cancelCardResize]);
  React.useEffect(() => cancelWidgetInteraction, [cancelWidgetInteraction]);

  React.useEffect(() => {
    if (mode !== 'setup') {
      cancelCardResize();
      cancelWidgetInteraction();
    }
  }, [cancelCardResize, cancelWidgetInteraction, mode]);

  React.useEffect(() => {
    cancelCardResize();
    cancelWidgetInteraction();
    setupGroupDragRef.current = null;
    stackDragRef.current = null;
  }, [activeProjectId, cancelCardResize, cancelWidgetInteraction]);

  // Recording + replay (minimal): record only drag segments, not idle mouse movement.
  const [recordingSession, setRecordingSession] = React.useState<RecordingSession | null>(null);
  const [replayView, setReplayView] = React.useState<ReplayViewState | null>(null);
  const replayViewRef = React.useRef<ReplayViewState | null>(null);
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const discardedSessionIdsRef = React.useRef<Set<string>>(new Set());
  const [isRecording, setIsRecording] = React.useState(false);
  const [isReplaying, setIsReplaying] = React.useState(false);
  const [replayTimeMs, setReplayTimeMs] = React.useState(0);

  const recordingRef = React.useRef<{
    startPerf: number;
    lastSampleMs: number;
    activeSeg: DragSegment | null;
  }>({
    startPerf: 0,
    lastSampleMs: -1,
    activeSeg: null,
  });

  // rAF sampler (plan): onDrag just updates latest x/y; rAF loop samples at ~30Hz with Δdist gate.
  const latestDragRef = React.useRef<{ cardId: string; x: number; y: number } | null>(null);
  const samplerRafRef = React.useRef<number | null>(null);
  const setupGroupDragRef = React.useRef<SetupGroupDragState | null>(null);
  const stackDragRef = React.useRef<StackDragState | null>(null);
  const widgetDragRef = React.useRef<WidgetDragState | null>(null);
  const widgetResizeRef = React.useRef<WidgetResizeState | null>(null);
  const widgetInteractionCleanupRef = React.useRef<(() => void) | null>(null);
  const widgetSetupSnapshotRef = React.useRef<WidgetSetupSnapshot | null>(null);
  const [activeWidgetDropIndicator, setActiveWidgetDropIndicator] = React.useState<WidgetDropIndicator | null>(null);

  const isRecordingRef = React.useRef(isRecording);
  const isReplayingRef = React.useRef(isReplaying);
  React.useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  React.useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  const nowRecMs = React.useCallback(() => Math.round(performance.now() - recordingRef.current.startPerf), []);

  const stopSampler = React.useCallback(() => {
    if (samplerRafRef.current != null) {
      cancelAnimationFrame(samplerRafRef.current);
      samplerRafRef.current = null;
    }
    latestDragRef.current = null;
  }, []);

  const startSampler = React.useCallback(() => {
    if (samplerRafRef.current != null) return; // already running

    const tick = () => {
      const seg = recordingRef.current.activeSeg;
      const latest = latestDragRef.current;

      if (!isRecordingRef.current || isReplayingRef.current || !seg) {
        samplerRafRef.current = null;
        return;
      }

      if (latest && latest.cardId === seg.cardId) {
        const t = nowRecMs();
        if (t - recordingRef.current.lastSampleMs >= 33) {
          const sx = Math.round(latest.x);
          const sy = Math.round(latest.y);
          const last = seg.path[seg.path.length - 1];
          if (last) {
            const dx = sx - last[1];
            const dy = sy - last[2];
            if (dx * dx + dy * dy >= 0.75 * 0.75) {
              seg.path.push([t, sx, sy]);
              recordingRef.current.lastSampleMs = t;
            }
          } else {
            seg.path.push([t, sx, sy]);
            recordingRef.current.lastSampleMs = t;
          }
        }
      }

      samplerRafRef.current = requestAnimationFrame(tick);
    };

    samplerRafRef.current = requestAnimationFrame(tick);
  }, [nowRecMs]);

  const replayRef = React.useRef<{
    startPerf: number;
    index: ReplayIndex | null;
    raf: number | null;
  }>({ startPerf: 0, index: null, raf: null });
  const replaySelectionRequestRef = React.useRef(0);
  const cancelReplayFrame = React.useCallback(() => {
    if (replayRef.current.raf != null) {
      cancelAnimationFrame(replayRef.current.raf);
      replayRef.current.raf = null;
    }
  }, []);

  // Cache object URLs for persisted assets (assetId -> objectURL).
  const assetUrlRef = React.useRef<Map<string, string>>(new Map());
  const assetUrlPromiseRef = React.useRef<Map<string, Promise<string | null>>>(new Map());
  const dragSurfaceSceneRef = React.useRef<StageSurfaceScene | null>(null);

  const getOrCreateObjectUrlForAsset = React.useCallback((assetId: string) => {
    const cached = assetUrlRef.current.get(assetId);
    if (cached) return Promise.resolve(cached);
    const inFlight = assetUrlPromiseRef.current.get(assetId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const asset = await persistGetAsset(assetId);
      if (!asset) return null;
      const cachedAfterRead = assetUrlRef.current.get(assetId);
      if (cachedAfterRead) return cachedAfterRead;
      const mime = asset.mime || 'application/octet-stream';
      let blob: Blob;
      if (asset.blob && typeof (asset.blob as Blob).arrayBuffer === 'function') {
        const candidate = asset.blob as Blob;
        if (candidate.type === mime) {
          blob = candidate;
        } else {
          blob = new Blob([await candidate.arrayBuffer()], { type: mime });
        }
      } else {
        blob = new Blob([asset.blob as BlobPart], { type: mime });
      }
      const url = URL.createObjectURL(blob);
      assetUrlRef.current.set(assetId, url);
      return url;
    })();
    assetUrlPromiseRef.current.set(assetId, promise);
    const clearInFlight = () => {
      if (assetUrlPromiseRef.current.get(assetId) === promise) {
        assetUrlPromiseRef.current.delete(assetId);
      }
    };
    void promise.then(clearInFlight, clearInFlight);
    return promise;
  }, []);

  const boardSaveInFlightRef = React.useRef<Promise<boolean> | null>(null);
  const sessionSaveInFlightRef = React.useRef<Promise<boolean> | null>(null);
  const boardSaveRevisionRef = React.useRef(0);
  const latestBoardSaveRevisionRef = React.useRef<Map<string, number>>(new Map());
  const latestBoardSnapshotRef = React.useRef<Map<string, PersistedBoardV1>>(new Map());
  const completedBoardSaveRevisionRef = React.useRef<Map<string, number>>(new Map());
  const sessionSaveRevisionRef = React.useRef(0);
  const latestSessionSaveRevisionRef = React.useRef<Map<string, number>>(new Map());

  const enqueuePersistenceTask = React.useCallback(
    (queueRef: React.MutableRefObject<Promise<boolean> | null>, task: () => Promise<boolean>) => {
      const previous = queueRef.current;
      const next = previous ? previous.then(task, task) : task();
      queueRef.current = next;
      void next.then(
        () => {
          if (queueRef.current === next) queueRef.current = null;
        },
        () => {
          if (queueRef.current === next) queueRef.current = null;
        }
      );
      return next;
    },
    []
  );

  const currentBoardSnapshot = React.useMemo<PersistedBoardV1 | null>(() => {
    if (!boardId || !isProjectHydrated) return null;
    if (mode === 'end') return null;
    if (sortConfig.type !== 'open' && mode !== 'setup') return null;

    return {
      version: 2,
      id: boardId,
      updatedAt: Date.now(),
      sortConfig,
      cardW: cardWidth,
      cardH: cardHeight,
      cardLayoutMode,
      activeSessionId: recordingSession?.createdAt,
      stacks: toPersistedStacks(stacks),
      workflow: toPersistedWorkflow(workflow),
      activeStageId: activeStageId || undefined,
      closedContainers: deriveClosedContainersForPersistence(sortConfig, workflow, activeStageId),
      cards: projectCardsForPersistence(cards, sortConfig, workflow, activeStageId),
    };
  }, [
    activeStageId,
    boardId,
    cardHeight,
    cardLayoutMode,
    cardWidth,
    cards,
    isProjectHydrated,
    mode,
    recordingSession?.createdAt,
    sortConfig,
    stacks,
    workflow,
  ]);
  const latestBoardStateRef = React.useRef<{
    cards: CardData[];
    stacks: StackData[];
    workflow: SortWorkflowData;
    activeStageId: string | null;
    sortConfig: SortConfig;
    cardWidth: number;
    cardHeight: number;
    cardLayoutMode: CardLayoutMode;
    recordingSessionId?: string;
  }>({
    cards,
    stacks,
    workflow,
    activeStageId,
    sortConfig,
    cardWidth,
    cardHeight,
    cardLayoutMode,
    recordingSessionId: recordingSession?.createdAt,
  });
  const immediateCardSaveRef = React.useRef<{
    cards: CardData[];
    promise: Promise<boolean>;
  } | null>(null);
  latestBoardStateRef.current = {
    cards,
    stacks,
    workflow,
    activeStageId,
    sortConfig,
    cardWidth,
    cardHeight,
    cardLayoutMode,
    recordingSessionId: recordingSession?.createdAt,
  };

  const buildImmediateBoardSnapshot = React.useCallback((): PersistedBoardV1 | null => {
    if (!boardId || !isProjectHydrated) return null;
    if (modeRef.current === 'end') return null;
    const latest = latestBoardStateRef.current;
    if (latest.sortConfig.type !== 'open' && modeRef.current !== 'setup') return null;
    return {
      version: 2,
      id: boardId,
      updatedAt: Date.now(),
      sortConfig: latest.sortConfig,
      cardW: latest.cardWidth,
      cardH: latest.cardHeight,
      cardLayoutMode: latest.cardLayoutMode,
      activeSessionId: latest.recordingSessionId,
      stacks: toPersistedStacks(latest.stacks),
      workflow: toPersistedWorkflow(latest.workflow),
      activeStageId: latest.activeStageId || undefined,
      closedContainers: deriveClosedContainersForPersistence(
        latest.sortConfig,
        latest.workflow,
        latest.activeStageId
      ),
      cards: projectCardsForPersistence(
        latest.cards,
        latest.sortConfig,
        latest.workflow,
        latest.activeStageId
      ),
    };
  }, [boardId, isProjectHydrated]);

  const persistBoardSnapshot = React.useCallback(
    (snapshot: PersistedBoardV1, label: string, immediate = false) => {
      const revision = boardSaveRevisionRef.current + 1;
      boardSaveRevisionRef.current = revision;
      latestBoardSaveRevisionRef.current.set(snapshot.id, revision);
      latestBoardSnapshotRef.current.set(snapshot.id, snapshot);
      const task = () => {
        if (latestBoardSaveRevisionRef.current.get(snapshot.id) !== revision) return Promise.resolve(true);
        return runSafePersistence(label, async () => {
          await persistPutBoard(snapshot);
          const completedRevision = completedBoardSaveRevisionRef.current.get(snapshot.id) || 0;
          let authoritativeSnapshot = snapshot;
          if (completedRevision > revision) {
            // IndexedDB normally completes same-store writes in transaction order.
            // If an older request nevertheless completes last, restore the newest
            // known snapshot before reporting the save as complete.
            authoritativeSnapshot = latestBoardSnapshotRef.current.get(snapshot.id) || snapshot;
            await persistPutBoard(authoritativeSnapshot);
          }
          completedBoardSaveRevisionRef.current.set(snapshot.id, Math.max(completedRevision, revision));
          await persistTouchProject(authoritativeSnapshot.id, authoritativeSnapshot.updatedAt);
          setProjects((prev) =>
            prev
              .map((project) =>
                project.id === authoritativeSnapshot.id
                  ? { ...project, updatedAt: authoritativeSnapshot.updatedAt }
                  : project
              )
              .sort((a, b) => b.updatedAt - a.updatedAt)
          );
        });
      };
      return immediate ? task() : enqueuePersistenceTask(boardSaveInFlightRef, task);
    },
    [enqueuePersistenceTask, runSafePersistence]
  );

  const persistCurrentBoardSnapshot = React.useCallback(
    async (label: string) => {
      if (!currentBoardSnapshot) return true;
      return persistBoardSnapshot({ ...currentBoardSnapshot, updatedAt: Date.now() }, label);
    },
    [currentBoardSnapshot, persistBoardSnapshot]
  );

  const persistCurrentBoardSnapshotImmediately = React.useCallback(
    async (label: string) => {
      const snapshot = buildImmediateBoardSnapshot();
      if (!snapshot) return true;
      return persistBoardSnapshot({ ...snapshot, updatedAt: Date.now() }, label, true);
    },
    [buildImmediateBoardSnapshot, persistBoardSnapshot]
  );

  const flushCurrentBoardSnapshot = React.useCallback(
    async (label: string, expectedBoardId?: string | null) => {
      if (expectedBoardId && boardId !== expectedBoardId) return false;
      return persistCurrentBoardSnapshot(label);
    },
    [boardId, persistCurrentBoardSnapshot]
  );

  const persistSessionSnapshot = React.useCallback(
    (snapshot: PersistedSessionV1, label: string, immediate = false) => {
      const revision = sessionSaveRevisionRef.current + 1;
      sessionSaveRevisionRef.current = revision;
      latestSessionSaveRevisionRef.current.set(snapshot.id, revision);
      const task = () => {
        if (discardedSessionIdsRef.current.has(snapshot.id)) return Promise.resolve(true);
        if (latestSessionSaveRevisionRef.current.get(snapshot.id) !== revision) return Promise.resolve(true);
        return runSafePersistence(label, async () => {
          await persistPutSession(snapshot);
          await persistTouchProject(snapshot.boardId, snapshot.updatedAt);
          if (discardedSessionIdsRef.current.has(snapshot.id)) return;
          if (latestSessionSaveRevisionRef.current.get(snapshot.id) !== revision) return;
          if (activeProjectIdRef.current !== snapshot.boardId) return;
          const savedSession: SessionItem = {
            id: snapshot.id,
            updatedAt: snapshot.updatedAt,
            recording: snapshot.recording,
          };
          setSessions((previous) =>
            [savedSession, ...previous.filter((session) => session.id !== snapshot.id)].sort(
              (a, b) => b.updatedAt - a.updatedAt
            )
          );
        });
      };
      return immediate ? task() : enqueuePersistenceTask(sessionSaveInFlightRef, task);
    },
    [enqueuePersistenceTask, runSafePersistence]
  );

  const persistCurrentRecordingSession = React.useCallback(
    async (label: string) => {
      if (mode !== 'sort' || !isRecording) return true;
      if (!boardId || !isProjectHydrated || !recordingSession) return true;
      if (discardedSessionIdsRef.current.has(recordingSession.createdAt)) return true;

      const updatedAt = Date.now();
      const sanitized = sanitizeRecording(recordingSession);
      return persistSessionSnapshot({
        version: 1,
        id: recordingSession.createdAt,
        boardId,
        updatedAt,
        recording: sanitized,
      }, label);
    },
    [boardId, isProjectHydrated, isRecording, mode, persistSessionSnapshot, recordingSession]
  );

  const persistCurrentRecordingSessionImmediately = React.useCallback(
    async (label: string) => {
      if (mode !== 'sort' || !isRecording) return true;
      if (!boardId || !isProjectHydrated || !recordingSession) return true;
      if (discardedSessionIdsRef.current.has(recordingSession.createdAt)) return true;
      return persistSessionSnapshot({
        version: 1,
        id: recordingSession.createdAt,
        boardId,
        updatedAt: Date.now(),
        recording: sanitizeRecording(recordingSession),
      }, label, true);
    },
    [boardId, isProjectHydrated, isRecording, mode, persistSessionSnapshot, recordingSession]
  );

  const flushCurrentRecordingSession = React.useCallback(
    async (label: string) => {
      return persistCurrentRecordingSession(label);
    },
    [persistCurrentRecordingSession]
  );

  // Track a monotonically increasing z for predictable stacking.
  const zTop = React.useRef<number>(Math.max(...cards.map((c) => c.z), 0));

  type HydratableCard = Omit<CardData, 'kind' | 'src' | 'posterSrc' | 'meta' | 'createdAt'> & {
    kind: CardData['kind'] | 'dummy';
    createdAt?: number;
    assetId?: string;
    posterAssetId?: string;
    meta?: CardMetadataV1;
  };

  const hydrateCardsFromPersisted = React.useCallback(
    async (persistedCards: HydratableCard[]) => {
      const assetIds = new Set<string>();
      for (const card of persistedCards) {
        if ((card.kind === 'image' || card.kind === 'video') && card.assetId) {
          assetIds.add(card.assetId);
        }
        if (card.kind === 'video' && card.posterAssetId) {
          assetIds.add(card.posterAssetId);
        }
      }
      await Promise.all(Array.from(assetIds, (assetId) => getOrCreateObjectUrlForAsset(assetId)));

      return persistedCards.map((pc, i): CardData => {
        const kind = pc.kind === 'dummy' ? 'text' : pc.kind;
        const meta = normalizeCardMetadata(pc.meta, fallbackCardNameForKind(kind, i), kind);
        const src =
          (kind === 'image' || kind === 'video') && pc.assetId
            ? assetUrlRef.current.get(pc.assetId)
            : undefined;
        const posterSrc =
          kind === 'video' && pc.posterAssetId
            ? assetUrlRef.current.get(pc.posterAssetId)
            : undefined;
        return {
          ...pc,
          kind,
          createdAt: typeof pc.createdAt === 'number' ? pc.createdAt : i + 1,
          sizeScale: normalizeCardSizeScale(pc.sizeScale),
          meta,
          assetId: kind === 'image' || kind === 'video' ? pc.assetId : undefined,
          src,
          posterAssetId: kind === 'video' ? pc.posterAssetId : undefined,
          posterSrc,
        };
      });
    },
    [getOrCreateObjectUrlForAsset]
  );

  const aspectProbeInFlightRef = React.useRef<Set<string>>(new Set());

  const probeMissingImageAspectRatios = React.useCallback(
    async (projectId: string, sourceCards: CardData[]) => {
      const candidates = sourceCards.filter(
        (card) => card.kind === 'image' && card.assetId && !isValidAspectRatio(card.meta.aspectRatio)
      );
      if (candidates.length === 0) return;

      for (const card of candidates) {
        const key = `${projectId}:${card.id}`;
        if (aspectProbeInFlightRef.current.has(key)) continue;
        aspectProbeInFlightRef.current.add(key);

        try {
          const asset = card.assetId ? await persistGetAsset(card.assetId) : undefined;
          if (!asset) continue;
          const aspectRatio = await readAspectRatioFromBlob(asset.blob);
          if (!isValidAspectRatio(aspectRatio)) continue;
          if (activeProjectIdRef.current !== projectId) continue;

          setCards((prev) =>
            prev.map((current) => {
              if (current.id !== card.id || current.kind !== 'image') return current;
              if (isValidAspectRatio(current.meta.aspectRatio)) return current;
              return {
                ...current,
                meta: {
                  ...current.meta,
                  aspectRatio,
                },
              };
            })
          );
        } finally {
          aspectProbeInFlightRef.current.delete(key);
        }
      }
    },
    []
  );

  const getCardDims = React.useCallback(
    (card: CardData, baseWidth = cardWidth, layoutMode = cardLayoutMode) =>
      getCardDimensions(card, layoutMode, baseWidth),
    [cardLayoutMode, cardWidth]
  );

  const getCardBounds = React.useCallback(
    (card: CardData): WidgetCardBounds => {
      const dims = getCardDims(card);
      return { x: card.x, y: card.y, w: dims.w, h: dims.h };
    },
    [getCardDims]
  );

  const getClosedCardBounds = getCardBounds;

  const boardViewport = React.useMemo(
    () => ({
      width: boardSize.width || 1200,
      height: boardSize.height || 800,
    }),
    [boardSize.height, boardSize.width]
  );

  const reflowCardsForStage = React.useCallback(
    (nextCards: CardData[], nextWorkflow: SortWorkflowData, stageId: string, nextMode = modeRef.current) =>
      reflowStageSurfaceCards(nextCards, nextWorkflow, stageId, getClosedCardBounds, boardViewport, nextMode),
    [boardViewport, getClosedCardBounds]
  );

  const commitBoardState = React.useCallback((nextCards: CardData[], nextStacks: StackData[]) => {
    cardsRef.current = nextCards;
    stacksRef.current = nextStacks;
    setCards(nextCards);
    setStacks(nextStacks);
    let maxZ = 0;
    for (const card of nextCards) maxZ = Math.max(maxZ, card.z);
    zTop.current = maxZ;
  }, []);

  const captureSetupSnapshot = React.useCallback(
    (): SetupSnapshotV1 => ({
      cardLayoutMode,
      sortConfig: { ...sortConfig },
      stacks: toPersistedStacks(stacks),
      workflow: toPersistedWorkflow(workflow),
      activeStageId: activeStageId || undefined,
      closedContainers: deriveClosedContainersForPersistence(sortConfig, workflow, activeStageId),
      cards: projectCardsForPersistence(cards, sortConfig, workflow, activeStageId),
    }),
    [activeStageId, cardLayoutMode, cards, sortConfig, stacks, workflow]
  );

  const setSetupUndoPastForProject = React.useCallback(
    (projectId: string, past: SetupSnapshotV1[], persist = true, cleanupAssets = false) => {
      setupUndoPastByProjectRef.current.set(projectId, past);
      if (activeProjectIdRef.current === projectId) {
        setSetupUndoPast(past);
      }
      if (!persist) return;

      void (async () => {
        try {
          if (past.length === 0) {
            await persistClearSetupUndo(projectId);
          } else {
            await persistPutSetupUndo(projectId, past);
          }
          if (cleanupAssets) scheduleAssetGc('setup undo history rotation');
        } catch (err) {
          console.error('[setup-undo] failed to persist undo stack', {
            projectId,
            size: past.length,
            err,
          });
        }
      })();
    },
    [scheduleAssetGc]
  );

  const pushSetupUndoSnapshotIfNeeded = React.useCallback(
    (projectId: string) => {
      if (modeRef.current !== 'setup') return;
      if (activeProjectIdRef.current !== projectId) return;
      const past = setupUndoPastByProjectRef.current.get(projectId) || [];
      const next = appendSetupSnapshot(past, captureSetupSnapshot());
      if (next === past) return;
      const evictedSnapshot = past.length >= MAX_SETUP_UNDO_SNAPSHOTS && next[0] !== past[0];
      setSetupUndoPastForProject(projectId, next, true, evictedSnapshot);
    },
    [captureSetupSnapshot, setSetupUndoPastForProject]
  );

  const applySetupSnapshot = React.useCallback(
    async (projectId: string, snapshot: SetupSnapshotV1) => {
      const hydratedCards = await hydrateCardsFromPersisted(
        snapshot.cards.map((c) => ({ ...c, src: undefined }))
      );
      if (activeProjectIdRef.current !== projectId) return;
      const runtimeState = resolveRuntimeWorkflowState(
        snapshot.sortConfig,
        snapshot.workflow || null,
        snapshot.activeStageId || null,
        snapshot.closedContainers,
        hydratedCards,
        1200,
        800
      );
      setCardLayoutMode(normalizeCardLayoutMode(snapshot.cardLayoutMode));
      setSortConfig({ ...snapshot.sortConfig });
      setStacks(snapshot.stacks || []);
      setWorkflow(runtimeState.workflow);
      setActiveStageId(runtimeState.activeStageId);
      setCards(runtimeState.cards);
      zTop.current = Math.max(...runtimeState.cards.map((c) => c.z), 0);
    },
    [hydrateCardsFromPersisted]
  );

  const undoSetup = React.useCallback(() => {
    if (modeRef.current !== 'setup') return;
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;

    const past = setupUndoPastByProjectRef.current.get(projectId) || [];
    const snapshot = past[past.length - 1];
    if (!snapshot) return;

    const nextPast = past.slice(0, -1);
    setSetupUndoPastForProject(projectId, nextPast, true);
    void applySetupSnapshot(projectId, snapshot);
  }, [applySetupSnapshot, setSetupUndoPastForProject]);

  const refreshProjects = React.useCallback(async () => {
    const listed = await persistListProjects();
    setProjects(listed);
    return listed;
  }, []);

  const stopReplayImmediate = React.useCallback(() => {
    cancelReplayFrame();
    replaySelectionRequestRef.current += 1;
    setIsReplaying(false);
    setReplayTimeMs(0);
    replayRef.current.startPerf = performance.now();
    replayRef.current.index = null;
    replayViewRef.current = null;
    setReplayView(null);
  }, [cancelReplayFrame]);

  const createDemoProjectCards = React.useCallback(async (count = DEMO_CARD_COUNT) => {
    const out: CardData[] = [];

    for (let i = 0; i < count; i += 1) {
      const x = 28 + i * 18;
      const y = 28 + i * 18;
      const z = i + 1;
      const blob = createLocalDemoImageBlob(i);
      const displayName = `Demo ${i + 1}`;
      const assetId = nanoid();
      await persistPutAsset(assetId, blob, blob.type);
      const src = URL.createObjectURL(blob);
      assetUrlRef.current.set(assetId, src);
      out.push({
        id: nanoid(),
        kind: 'image',
        createdAt: nextCreatedAt(i),
        assetId,
        src,
        meta: createCardMetadata(displayName, '', ['demo'], {
          aspectRatio: 16 / 9,
          originalFileName: `demo-${i + 1}.svg`,
        }),
        x,
        y,
        z,
      });
    }

    return out;
  }, []);

  // Keep latest cards for unmount cleanup.
  const cardsRef = React.useRef<CardData[]>(cards);
  React.useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  const stacksRef = React.useRef<StackData[]>(stacks);
  React.useEffect(() => {
    stacksRef.current = stacks;
  }, [stacks]);
  const workflowRef = React.useRef<SortWorkflowData>(workflow);
  React.useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  // Boot project metadata (projects list + active project id).
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const { projects: listed, activeProjectId: active } = await bootstrapProjectsOnce(createDemoProjectCards);

      if (!cancelled) {
        setProjects(listed);
        activateProject(active);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activateProject, createDemoProjectCards]);

  React.useEffect(() => {
    if (!activeProjectId) {
      setSetupUndoPast([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const persisted = await persistGetSetupUndo(activeProjectId);
      if (cancelled) return;
      setSetupUndoPastForProject(activeProjectId, persisted?.past || [], false);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, setSetupUndoPastForProject]);

  // Load board + sessions for current active project.
  React.useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    setIsProjectHydrated(false);
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(null);
    setIsDetailsDrawerOpen(false);
    discardedSessionIdsRef.current.clear();

    (async () => {
      const [persisted, persistedSessions] = await Promise.all([
        persistGetBoard(boardId),
        persistListSessions(boardId),
      ]);
      if (cancelled) return;

      if (!persisted) {
        const starter = createInitialCards();
        await persistPutBoard({
          version: 2,
          id: boardId,
          updatedAt: Date.now(),
          sortConfig: DEFAULT_SORT_CONFIG,
          cardW: DEFAULT_CARD_W,
          cardH: fixedCardHeightFromWidth(DEFAULT_CARD_W),
          cardLayoutMode: DEFAULT_CARD_LAYOUT_MODE,
          stacks: [],
          workflow: createWorkflowForTemplate('open', 1200, 800, starter.length),
          activeStageId: undefined,
          closedContainers: [],
          cards: toPersistedCards(starter),
        });
        if (cancelled) return;
        setSortConfig(DEFAULT_SORT_CONFIG);
        setCardWidth(DEFAULT_CARD_W);
        setCardLayoutMode(DEFAULT_CARD_LAYOUT_MODE);
        setStacks([]);
        setWorkflow(createWorkflowForTemplate('open', 1200, 800, starter.length));
        setActiveStageId(null);
        setCards(starter);
        zTop.current = Math.max(...starter.map((c) => c.z), 0);
        setSessions([]);
        setRecordingSession(null);
        setIsRecording(false);
        recordingRef.current.activeSeg = null;
        stopSampler();
        stopReplayImmediate();
        setIsProjectHydrated(true);
        return;
      }

      const sessionItems = persistedSessions
        .map((s) => ({ id: s.id, updatedAt: s.updatedAt, recording: s.recording }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const activeSession =
        (persisted.activeSessionId && sessionItems.find((s) => s.id === persisted.activeSessionId)) || sessionItems[0];

      const hydratedCards = await hydrateCardsFromPersisted(
        persisted.cards.map((c) => ({ ...c, src: undefined }))
      );
      if (cancelled) return;
      const runtimeState = resolveRuntimeWorkflowState(
        persisted.sortConfig,
        persisted.workflow || null,
        persisted.activeStageId || null,
        persisted.closedContainers || [],
        hydratedCards,
        1200,
        800
      );

      setSortConfig(persisted.sortConfig);
      setCardWidth(clampCardWidth(persisted.cardW || DEFAULT_CARD_W));
      setCardLayoutMode(normalizeCardLayoutMode(persisted.cardLayoutMode));
      setStacks(persisted.stacks || []);
      setWorkflow(runtimeState.workflow);
      setActiveStageId(runtimeState.activeStageId);
      setCards(runtimeState.cards);
      zTop.current = Math.max(...runtimeState.cards.map((c) => c.z), 0);
      setSessions(sessionItems);
      void probeMissingImageAspectRatios(boardId, runtimeState.cards);

      if (activeSession?.recording) {
        const migrated = migrateRecording(activeSession.recording);
        const cardsAtStart = await hydrateCardsFromPersisted(
          migrated.cardsAtStart.map((c) => ({ ...c, src: undefined }))
        );
        if (cancelled) return;
        setRecordingSession({ ...migrated, cardsAtStart });
      } else {
        setRecordingSession(null);
      }

      setIsRecording(false);
      recordingRef.current.activeSeg = null;
      stopSampler();
      stopReplayImmediate();
      setIsProjectHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, hydrateCardsFromPersisted, probeMissingImageAspectRatios, stopReplayImmediate, stopSampler]);

  // Revoke object URLs on unmount.
  React.useEffect(() => {
    return () => {
      for (const url of assetUrlRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      assetUrlRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bringToFront = React.useCallback((id: string) => {
    zTop.current += 1;
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, z: zTop.current } : c)));
  }, []);

  const openVideoPreview = React.useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((entry) => entry.id === cardId && entry.kind === 'video');
      if (!card) return;
      bringToFront(cardId);
      setPreviewCardId(cardId);
    },
    [bringToFront]
  );

  const closeVideoPreview = React.useCallback(() => {
    setPreviewCardId(null);
  }, []);

  const bringStackToFront = React.useCallback((stackId: string) => {
    setCards((prev) => {
      const members = getStackCards(prev, stackId);
      if (members.length === 0) return prev;
      const zBase = prev.reduce((max, card) => (card.stackId === stackId ? max : Math.max(max, card.z)), zTop.current);
      zTop.current = zBase + members.length;
      const nextZById = new Map<string, number>();
      members.forEach((member, index) => {
        nextZById.set(member.id, zBase + members.length - index);
      });
      return prev.map((card) => (nextZById.has(card.id) ? { ...card, z: nextZById.get(card.id)! } : card));
    });
  }, []);

  const handleSelectCard = React.useCallback(
    (cardId: string, options?: { toggle?: boolean }) => {
      if (modeRef.current !== 'setup') return;
      setSelectedStackId(null);
      setSelectedWidgetId(null);
      setSelectedCardIds((prev) => {
        if (!options?.toggle) return [cardId];
        if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
        return [...prev, cardId];
      });
      setIsDetailsDrawerOpen(true);
    },
    []
  );

  const handleClearSelection = React.useCallback(() => {
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(null);
    setIsDetailsDrawerOpen(false);
  }, []);

  const handleSelectStack = React.useCallback((stackId: string) => {
    if (modeRef.current !== 'setup') return;
    setSelectedCardIds([]);
    setSelectedWidgetId(null);
    setSelectedStackId(stackId);
    setIsDetailsDrawerOpen(true);
  }, []);

  const handleSelectWidget = React.useCallback((widgetId: string) => {
    if (modeRef.current !== 'setup') return;
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(widgetId);
    setIsDetailsDrawerOpen(true);
  }, []);

  const handleLassoSelect = React.useCallback((ids: string[], append: boolean) => {
    setSelectedStackId(null);
    setSelectedWidgetId(null);
    setSelectedCardIds((prev) => {
      const unique = Array.from(new Set(ids));
      if (!append) return unique;
      const set = new Set(prev);
      for (const id of unique) set.add(id);
      return Array.from(set);
    });
    if (ids.length > 0) {
      setIsDetailsDrawerOpen(true);
    }
  }, []);

  const cardMetaEditRef = React.useRef<{ key: string; snapshotCaptured: boolean } | null>(null);
  const handleBeginSelectedCardMetaEdit = React.useCallback(() => {
    const projectId = activeProjectIdRef.current;
    if (modeRef.current !== 'setup' || !projectId || selectedCards.length !== 1) return;
    cardMetaEditRef.current = {
      key: `${projectId}\u0000${selectedCards[0].id}`,
      snapshotCaptured: false,
    };
  }, [selectedCards]);
  const handleEndSelectedCardMetaEdit = React.useCallback(() => {
    cardMetaEditRef.current = null;
  }, []);

  const handleUpdateSelectedCardMeta = React.useCallback(
    (patch: Partial<CardMetadataV1>) => {
      const projectId = activeProjectIdRef.current;
      if (modeRef.current !== 'setup' || !projectId || selectedCards.length !== 1) return;
      const selectedId = selectedCards[0].id;
      const currentCards = cardsRef.current;
      const idx = currentCards.findIndex((card) => card.id === selectedId);
      if (idx < 0) return;
      const current = currentCards[idx];
      const shouldFollowName =
        current.kind === 'text' &&
        (!current.meta.frontText || current.meta.frontText.trim() === '' || current.meta.frontText === current.meta.name) &&
        patch.frontText == null;
      const mergedName = patch.name ?? current.meta.name;
      const nextMeta = normalizeCardMetadata(
        {
          name: mergedName,
          notes: patch.notes ?? current.meta.notes,
          tags: patch.tags ?? current.meta.tags,
          frontText: patch.frontText ?? (shouldFollowName ? mergedName : current.meta.frontText),
          color: patch.color ?? current.meta.color,
          aspectRatio: patch.aspectRatio ?? current.meta.aspectRatio,
          durationSec: patch.durationSec ?? current.meta.durationSec,
          originalFileName: patch.originalFileName ?? current.meta.originalFileName,
        },
        fallbackCardNameForKind(current.kind, idx),
        current.kind
      );
      const unchanged =
        current.meta.name === nextMeta.name &&
        current.meta.notes === nextMeta.notes &&
        current.meta.tags.length === nextMeta.tags.length &&
        current.meta.tags.every((tag, tagIndex) => tag === nextMeta.tags[tagIndex]) &&
        (current.meta.frontText || '') === (nextMeta.frontText || '') &&
        (current.meta.color || '') === (nextMeta.color || '') &&
        (current.meta.aspectRatio || 0) === (nextMeta.aspectRatio || 0) &&
        (current.meta.durationSec || 0) === (nextMeta.durationSec || 0) &&
        (current.meta.originalFileName || '') === (nextMeta.originalFileName || '');
      if (unchanged) return;

      const editKey = `${projectId}\u0000${selectedId}`;
      const activeEdit = cardMetaEditRef.current;
      if (!activeEdit || activeEdit.key !== editKey) {
        pushSetupUndoSnapshotIfNeeded(projectId);
        if (activeEdit) cardMetaEditRef.current = { key: editKey, snapshotCaptured: true };
      } else if (!activeEdit.snapshotCaptured) {
        pushSetupUndoSnapshotIfNeeded(projectId);
        activeEdit.snapshotCaptured = true;
      }
      const nextCards = cardsRef.current.map((card) =>
        card.id === selectedId ? { ...card, meta: nextMeta } : card
      );
      cardsRef.current = nextCards;
      latestBoardStateRef.current.cards = nextCards;
      setCards(nextCards);
      const promise = persistCurrentBoardSnapshotImmediately('board save after card metadata edit');
      immediateCardSaveRef.current = { cards: nextCards, promise };
      void promise;
    },
    [persistCurrentBoardSnapshotImmediately, pushSetupUndoSnapshotIfNeeded, selectedCards]
  );

  const createFreshSortingSession = React.useCallback(
    (startCards: CardData[], startWorkflow: SortWorkflowData, startStageId: string | null) => {
      const createdAt = new Date().toISOString();
      const closedContainersAtStart = deriveClosedContainersForPersistence(
        sortConfig,
        startWorkflow,
        startStageId
      );
      const session: RecordingSession = {
        version: 5,
        createdAt,
        cardW: cardWidth,
        cardH: cardHeight,
        boardW: boardSize.width,
        boardH: boardSize.height,
        sortConfig,
        cardLayoutModeAtStart: cardLayoutMode,
        workflowAtStart: toPersistedWorkflow(startWorkflow),
        activeStageIdAtStart: startStageId || undefined,
        closedContainersAtStart,
        cardsAtStart:
          sortConfig.type === 'closed' && startStageId
            ? projectClosedCardsForStage(startCards, startStageId).map((card) => ({ ...card }))
            : startCards.map((card) => ({ ...card })),
        segments: [],
      };
      const sessionItem: SessionItem = {
        id: createdAt,
        updatedAt: Date.now(),
        recording: {
          ...session,
          closedContainersAtStart: closedContainersAtStart.map((container) => ({ ...container })),
          cardsAtStart: session.cardsAtStart.map((card) => ({ ...card, src: undefined, posterSrc: undefined })),
        },
      };
      return { session, sessionItem };
    },
    [boardSize.height, boardSize.width, cardHeight, cardLayoutMode, cardWidth, sortConfig]
  );

  const beginSortingWorkflow = React.useCallback(() => {
    stopReplayImmediate();
    stopSampler();

    const startWorkflow = toPersistedWorkflow(workflow);
    let startStageId = activeStageId;
    let startCards = cards;
    if (sortConfig.type !== 'open' && workflow.templateId === sortConfig.type) {
      if (mode === 'setup') {
        widgetSetupSnapshotRef.current = {
          cards: cards.map((card) => ({ ...card })),
          stacks: stacks.map((stack) => ({ ...stack })),
          workflow: toPersistedWorkflow(workflow),
          activeStageId: activeStageId,
        };
      }
      const firstStageId = getDefaultActiveStageId(workflow);
      if (firstStageId) {
        startStageId = firstStageId;
        setActiveStageId(firstStageId);
        const sourceWidget = getSourceWidget(workflow, firstStageId);
        const seededCards = sourceWidget
          ? assignUnassignedCardsToWidgetZone(
              cards.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined })),
              firstStageId,
              sourceWidget.id,
              WIDGET_ZONE_CONTENT
            )
          : cards.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined }));
        startCards = reflowCardsForStage(seededCards, startWorkflow, firstStageId, 'sort');
        commitBoardState(startCards, []);
      }
    }

    const { session, sessionItem } = createFreshSortingSession(startCards, startWorkflow, startStageId);
    recordingRef.current.startPerf = performance.now();
    recordingRef.current.lastSampleMs = -1;
    recordingRef.current.activeSeg = null;

    setRecordingSession(session);
    setSessions((prev) => [sessionItem, ...prev.filter((s) => s.id !== session.createdAt)]);
    setIsRecording(true);
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(null);
    setIsDetailsDrawerOpen(false);
    setMode('sort');
  }, [
    activeStageId,
    cards,
    commitBoardState,
    createFreshSortingSession,
    mode,
    reflowCardsForStage,
    sortConfig.type,
    stacks,
    stopReplayImmediate,
    stopSampler,
    workflow,
  ]);

  const sortStartInFlightRef = React.useRef(false);
  const startSortingWorkflow = React.useCallback(() => {
    if (!activeProjectId || !isProjectHydrated || isReplaying || sortStartInFlightRef.current) return;

    sortStartInFlightRef.current = true;
    setIsProjectBusy(true);
    void (async () => {
      try {
        const flushed = await flushCurrentBoardSnapshot('board save before sorting', activeProjectId);
        if (!flushed) {
          setProjectStatus('Could not save the latest board changes before sorting.');
          return;
        }
        beginSortingWorkflow();
      } finally {
        sortStartInFlightRef.current = false;
        setIsProjectBusy(false);
      }
    })();
  }, [activeProjectId, beginSortingWorkflow, flushCurrentBoardSnapshot, isProjectHydrated, isReplaying]);

  const discardInProgressSortingSession = React.useCallback(async () => {
    const current = recordingSession;
    if (!current) {
      setIsRecording(false);
      recordingRef.current.activeSeg = null;
      stopSampler();
      stopReplayImmediate();
      return;
    }

    discardedSessionIdsRef.current.add(current.createdAt);

    setIsRecording(false);
    recordingRef.current.activeSeg = null;
    stopSampler();
    stopReplayImmediate();
    setSessions((prev) => prev.filter((s) => s.id !== current.createdAt));
    setRecordingSession(null);

    try {
      await persistDeleteSession(current.createdAt);
    } catch (err) {
      console.error('[sorting] failed to delete discarded session', { sessionId: current.createdAt, err });
    }
  }, [recordingSession, stopReplayImmediate, stopSampler]);

  const handleBackToSetupFromSort = React.useCallback(() => {
    const ok = window.confirm('Leave sorting? This unfinished session will not be available for replay.');
    if (!ok) return;
    void (async () => {
      await discardInProgressSortingSession();
      if (sortConfig.type !== 'open' && widgetSetupSnapshotRef.current) {
        commitBoardState(
          widgetSetupSnapshotRef.current.cards.map((card) => ({ ...card })),
          widgetSetupSnapshotRef.current.stacks.map((stack) => ({ ...stack }))
        );
        setWorkflow(toPersistedWorkflow(widgetSetupSnapshotRef.current.workflow));
        setActiveStageId(widgetSetupSnapshotRef.current.activeStageId);
      }
      setMode('setup');
    })();
  }, [commitBoardState, discardInProgressSortingSession, sortConfig.type]);

  const showReplaySessionAtStart = React.useCallback((recording: RecordingSession) => {
    cancelReplayFrame();
    const index = buildReplayIndex(recording);
    replayRef.current.startPerf = performance.now();
    replayRef.current.index = index;
    const nextView = { recording, index };
    replayViewRef.current = nextView;
    setReplayView(nextView);
    setReplayTimeMs(0);
    setIsReplaying(false);
  }, [cancelReplayFrame]);

  const startReplay = React.useCallback(() => {
    if (!replayView || replayView.recording.segments.length === 0) return;

    cancelReplayFrame();
    const startTime = replayTimeMs >= replayView.index.durationMs ? 0 : replayTimeMs;
    replayRef.current.index = replayView.index;
    replayRef.current.startPerf = performance.now() - startTime;
    setReplayTimeMs(startTime);
    setIsReplaying(true);
  }, [cancelReplayFrame, replayTimeMs, replayView]);

  const stopReplay = React.useCallback(() => {
    cancelReplayFrame();
    setIsReplaying(false);
    setReplayTimeMs(0);
    replayRef.current.startPerf = performance.now();
    replayRef.current.index = replayView?.index || null;
  }, [cancelReplayFrame, replayView]);

  const pauseReplay = React.useCallback(() => {
    cancelReplayFrame();
    setIsReplaying(false);
  }, [cancelReplayFrame]);

  const endSorting = React.useCallback(() => {
    setIsRecording(false);
    recordingRef.current.activeSeg = null;
    stopSampler();
    stopReplay();
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(null);
    setActiveWidgetDropIndicator(null);
    if (recordingSession) {
      showReplaySessionAtStart(recordingSession);
    } else {
      replayViewRef.current = null;
      setReplayView(null);
      replayRef.current.index = null;
    }
    setMode('end');
  }, [recordingSession, showReplaySessionAtStart, stopReplay, stopSampler]);

  const handleAdvanceSortStage = React.useCallback(() => {
    if (sortConfig.type !== 'qsort') {
      endSorting();
      return;
    }
    const currentStageId = activeStageIdRef.current;
    if (!currentStageId) return;
    const nextStageId = getNextStageId(workflowRef.current, currentStageId);
    if (!nextStageId) {
      endSorting();
      return;
    }
    const presortWidget = workflowRef.current.widgets.find(
      (widget): widget is Extract<BoardWidgetData, { kind: 'pre-sort' }> =>
        widget.kind === 'pre-sort' && widget.stageId === currentStageId
    );
    const qsortWidget = getQSortWidget(workflowRef.current, nextStageId);
    if (!presortWidget || !qsortWidget) return;

    const transitioned = transitionPreSortToQSort(cardsRef.current, currentStageId, nextStageId, presortWidget, qsortWidget);
    const reflowed = reflowCardsForStage(transitioned, workflowRef.current, nextStageId);
    const members = collectStaticMoveMembers(cardsRef.current, reflowed);
    commitBoardState(reflowed, []);
    setActiveStageId(nextStageId);
    setSelectedCardIds([]);
    setSelectedWidgetId(null);
    setActiveWidgetDropIndicator(null);

    if (isRecordingRef.current && !isReplayingRef.current && members.length > 0) {
      const t = nowRecMs();
      setRecordingSession((prev) =>
        prev
          ? {
              ...prev,
              segments: [
                ...prev.segments,
                {
                  type: 'stage-transition',
                  id: nanoid(),
                  fromStageId: currentStageId,
                  toStageId: nextStageId,
                  t0: t,
                  t1: t,
                  members,
                  widgetAssignmentChanges: reflowed.map((card) => ({
                    cardId: card.id,
                    stageId: nextStageId,
                    assignment: card.widgetAssignments?.[nextStageId],
                  })),
                  settleMs: 220,
                },
              ],
            }
          : prev
      );
    }
  }, [endSorting, nowRecMs, reflowCardsForStage, sortConfig.type]);

  const selectSession = React.useCallback(
    async (sessionId: string) => {
      const s = sessions.find((x) => x.id === sessionId);
      if (!s) return;

      const rec = recordingSession?.createdAt === sessionId ? recordingSession : s.recording;
      const requestId = replaySelectionRequestRef.current + 1;
      replaySelectionRequestRef.current = requestId;
      showReplaySessionAtStart(rec);

      // Text cards render immediately; persisted media URLs are filled in-place
      // once IndexedDB hydration completes. A later selection wins the race.
      const cardsAtStart = await hydrateCardsFromPersisted(rec.cardsAtStart.map((c) => ({ ...c, src: undefined })));
      if (replaySelectionRequestRef.current !== requestId) return;

      const currentView = replayViewRef.current;
      if (currentView?.recording.createdAt !== rec.createdAt) return;
      const hydratedRecording = { ...rec, cardsAtStart };
      const nextView = { recording: hydratedRecording, index: buildReplayIndex(hydratedRecording) };
      replayViewRef.current = nextView;
      replayRef.current.index = nextView.index;
      setReplayView(nextView);
    },
    [hydrateCardsFromPersisted, recordingSession, sessions, showReplaySessionAtStart]
  );

  const addTextCard = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId) return;
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    zTop.current += 1;
    setSelectedStackId(null);
    const prev = cardsRef.current;
    const idx = prev.length;
    const seedSource =
      sortConfig.type !== 'open' && workflowRef.current.templateId === sortConfig.type
        ? getSeedSourceWidget(workflowRef.current, activeStageIdRef.current)
        : null;
    const nextCard: CardData = {
      id: nanoid(),
      kind: 'text',
      createdAt: nextCreatedAt(idx),
      meta: defaultTextMeta(idx),
      x: 28 + idx * 16,
      y: 28 + idx * 16,
      z: zTop.current,
    };
    let nextCards = [...prev, nextCard];
    if (seedSource) {
      nextCards = assignCardsToWidgetZone(
        nextCards,
        seedSource.stageId,
        seedSource.widget.id,
        WIDGET_ZONE_CONTENT,
        [nextCard.id],
        { insertAt: 'back' }
      );
      nextCards = reflowCardsForStage(nextCards, workflowRef.current, seedSource.stageId);
      if (activeStageIdRef.current !== seedSource.stageId) {
        setActiveStageId(seedSource.stageId);
      }
      setSelectedWidgetId(seedSource.widget.id);
    }
    commitBoardState(nextCards, stacksRef.current);
  }, [activeProjectId, commitBoardState, mode, pushSetupUndoSnapshotIfNeeded, reflowCardsForStage, sortConfig.type]);

  const addLocalMedia = React.useCallback((files: File[]) => {
    if (modeRef.current !== 'setup') return;
    const targetProjectId = activeProjectIdRef.current;
    if (!targetProjectId) return;
    const mediaFiles = files
      .map((file, i) => ({ file, i, kind: detectMediaKind(file) }))
      .filter((item): item is { file: File; i: number; kind: 'image' | 'video' } => item.kind === 'image' || item.kind === 'video');
    if (mediaFiles.length === 0) return;

    void (async () => {
      const persistedAssetIds: string[] = [];
      try {
        const planned = await Promise.all(
          mediaFiles.map(async ({ file, i, kind }) => {
            if (kind === 'video') {
              const videoMeta = await readVideoMetadataFromBlob(file).catch(
                () => ({}) as Awaited<ReturnType<typeof readVideoMetadataFromBlob>>
              );
              return {
                file,
                i,
                kind,
                assetId: nanoid(),
                posterAssetId: videoMeta.posterBlob ? nanoid() : undefined,
                cardId: nanoid(),
                aspectRatio: videoMeta.aspectRatio,
                durationSec: videoMeta.durationSec,
                posterBlob: videoMeta.posterBlob,
              };
            }
            const aspectRatio = await readAspectRatioFromBlob(file).catch(() => undefined);
            return {
              file,
              i,
              kind,
              assetId: nanoid(),
              posterAssetId: undefined,
              cardId: nanoid(),
              aspectRatio,
              durationSec: undefined,
              posterBlob: undefined,
            };
          })
        );

        const persisted = await runSafePersistence('media ingest', async () => {
          await Promise.all(
            planned.flatMap((item) => {
              const operations = [persistPutAsset(item.assetId, item.file, item.file.type)];
              if (item.posterAssetId && item.posterBlob) {
                operations.push(persistPutAsset(item.posterAssetId, item.posterBlob, item.posterBlob.type || 'image/jpeg'));
              }
              return operations;
            })
          );
        });
        if (!persisted) return;

        persistedAssetIds.push(
          ...planned.flatMap((item) => [item.assetId, item.posterAssetId].filter((value): value is string => !!value))
        );

        if (modeRef.current !== 'setup' || activeProjectIdRef.current !== targetProjectId) {
          await runSafePersistence('media ingest rollback', async () => {
            await Promise.all(persistedAssetIds.map((assetId) => persistDeleteAsset(assetId)));
          });
          return;
        }

        pushSetupUndoSnapshotIfNeeded(targetProjectId);
        setSelectedStackId(null);
        const prev = cardsRef.current;
        const seedSource =
          sortConfig.type !== 'open' && workflowRef.current.templateId === sortConfig.type
            ? getSeedSourceWidget(workflowRef.current, activeStageIdRef.current)
            : null;
        const addedCards: CardData[] = [];

        for (const item of planned) {
          zTop.current += 1;
          const src = URL.createObjectURL(item.file);
          assetUrlRef.current.set(item.assetId, src);
          const posterSrc = item.posterBlob ? URL.createObjectURL(item.posterBlob) : undefined;
          if (item.posterAssetId && posterSrc) {
            assetUrlRef.current.set(item.posterAssetId, posterSrc);
          }
          const cardIndex = prev.length + item.i;
          addedCards.push({
            id: item.cardId,
            kind: item.kind,
            createdAt: nextCreatedAt(cardIndex),
            assetId: item.assetId,
            src,
            posterAssetId: item.kind === 'video' ? item.posterAssetId : undefined,
            posterSrc: item.kind === 'video' ? posterSrc : undefined,
            meta:
              item.kind === 'video'
                ? defaultVideoMeta(cardIndex, item.file.name, {
                    aspectRatio: item.aspectRatio,
                    durationSec: item.durationSec,
                  })
                : defaultImageMeta(cardIndex, item.file.name, item.aspectRatio),
            x: 28 + cardIndex * 16,
            y: 28 + cardIndex * 16,
            z: zTop.current,
          });
        }

        let nextCards = [...prev, ...addedCards];
        if (seedSource) {
          nextCards = assignCardsToWidgetZone(
            nextCards,
            seedSource.stageId,
            seedSource.widget.id,
            WIDGET_ZONE_CONTENT,
            addedCards.map((card) => card.id),
            { insertAt: 'back' }
          );
          nextCards = reflowCardsForStage(nextCards, workflowRef.current, seedSource.stageId);
          if (activeStageIdRef.current !== seedSource.stageId) {
            setActiveStageId(seedSource.stageId);
          }
          setSelectedWidgetId(seedSource.widget.id);
        }
        commitBoardState(nextCards, stacksRef.current);
      } catch (err) {
        console.error('[cards] add local media failed', err);
        if (persistedAssetIds.length > 0) {
          await runSafePersistence('media ingest cleanup', async () => {
            await Promise.all(persistedAssetIds.map((assetId) => persistDeleteAsset(assetId)));
          });
        }
        setProjectStatus('Adding media failed.');
      }
    })();
  }, [commitBoardState, pushSetupUndoSnapshotIfNeeded, reflowCardsForStage, runSafePersistence, sortConfig.type]);

  const deleteCards = React.useCallback((ids: string[]) => {
    if (mode !== 'setup' || !activeProjectId) return;
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    if (!cards.some((c) => idSet.has(c.id))) return;
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    for (const target of cards) {
      if (!idSet.has(target.id)) continue;
      if (target.kind === 'image' || target.kind === 'video') {
        if (target.src?.startsWith('blob:')) {
          URL.revokeObjectURL(target.src);
        }
        if (target.assetId) {
          const cached = assetUrlRef.current.get(target.assetId);
          if (cached) {
            URL.revokeObjectURL(cached);
            assetUrlRef.current.delete(target.assetId);
          }
        }
      }
      if (target.kind === 'video' && target.posterAssetId) {
        if (target.posterSrc?.startsWith('blob:')) {
          URL.revokeObjectURL(target.posterSrc);
        }
        const cachedPoster = assetUrlRef.current.get(target.posterAssetId);
        if (cachedPoster) {
          URL.revokeObjectURL(cachedPoster);
          assetUrlRef.current.delete(target.posterAssetId);
        }
      }
    }
    const filteredCards = cards.filter((card) => !idSet.has(card.id));
    let nextStacks = stacksRef.current;
    if (sortConfig.type !== 'open' && workflowRef.current.templateId === sortConfig.type && activeStageIdRef.current) {
      const nextCards = reflowCardsForStage(filteredCards, workflowRef.current, activeStageIdRef.current);
      commitBoardState(nextCards, nextStacks);
    } else {
      const normalized = dissolveSmallStacks(filteredCards, stacksRef.current);
      commitBoardState(normalized.cards, normalized.stacks);
      nextStacks = normalized.stacks;
    }
    setSelectedCardIds((prev) => prev.filter((id) => !idSet.has(id)));
    setPreviewCardId((prev) => (prev && idSet.has(prev) ? null : prev));
    if (selectedStackIdRef.current && !nextStacks.some((stack) => stack.id === selectedStackIdRef.current)) {
      setSelectedStackId(null);
    }
    setIsDetailsDrawerOpen(false);
    scheduleAssetGc('delete cards');
  }, [
    activeProjectId,
    cards,
    commitBoardState,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    reflowCardsForStage,
    scheduleAssetGc,
    sortConfig.type,
  ]);

  const deleteCard = React.useCallback((id: string) => {
    deleteCards([id]);
  }, [deleteCards]);

  const handleDeleteSelectedCard = React.useCallback(() => {
    if (!selectedCard) return;
    const ok = window.confirm(`Delete "${selectedCard.meta.name || 'this card'}"?`);
    if (!ok) return;
    deleteCard(selectedCard.id);
  }, [deleteCard, selectedCard]);

  const handleDeleteSelectedCards = React.useCallback(() => {
    if (selectedCardCount <= 1) return;
    const ok = window.confirm(`Delete ${selectedCardCount} selected cards?`);
    if (!ok) return;
    deleteCards(selectedCardIds);
  }, [deleteCards, selectedCardCount, selectedCardIds]);

  const createProjectWithCards = React.useCallback(
    async (name: string, nextCards: CardData[], nextSortConfig: SortConfig = DEFAULT_SORT_CONFIG) => {
      const projectId = nanoid();
      const now = Date.now();
      const project: PersistedProjectV1 = {
        version: 1,
        id: projectId,
        name,
        createdAt: now,
        updatedAt: now,
      };
      console.info('[projects] create start', {
        projectId,
        name,
        cards: nextCards.length,
        sortType: nextSortConfig.type,
        columns: nextSortConfig.columns,
      });
      await persistPutProject(project);
      await persistPutBoard({
        version: 2,
        id: projectId,
        updatedAt: now,
        sortConfig: nextSortConfig,
        cardW: DEFAULT_CARD_W,
        cardH: fixedCardHeightFromWidth(DEFAULT_CARD_W),
        cardLayoutMode: DEFAULT_CARD_LAYOUT_MODE,
        stacks: [],
        workflow: createWorkflowForTemplate('open', 1200, 800, nextCards.length),
        activeStageId: undefined,
        closedContainers: [],
        cards: toPersistedCards(nextCards),
      });
      await persistSetActiveProjectId(projectId);
      setSetupUndoPastForProject(projectId, [], true);
      activateProject(projectId);
      setProjects((prev) => [...prev, project].sort((a, b) => b.updatedAt - a.updatedAt));

      try {
        await refreshProjects();
      } catch (err) {
        console.error('[projects] create refresh failed; using optimistic local state', { projectId, err });
      }

      console.info('[projects] create success', { projectId, name });
      return projectId;
    },
    [activateProject, refreshProjects, setSetupUndoPastForProject]
  );

  const switchProject = React.useCallback(
    async (projectId: string) => {
      if (!projectId || projectId === activeProjectId || isProjectBusy) return;
      setIsProjectBusy(true);
      setProjectStatus('Saving current project...');
      try {
        const flushed = await flushCurrentBoardSnapshot('board save before project switch', activeProjectId);
        if (!flushed) {
          throw new Error('Could not save the latest board changes');
        }
        setIsRecording(false);
        recordingRef.current.activeSeg = null;
        stopSampler();
        stopReplayImmediate();
        await persistSetActiveProjectId(projectId);
        setSelectedCardIds([]);
        setSelectedStackId(null);
        setIsDetailsDrawerOpen(false);
        activateProject(projectId);
        setProjectStatus('');
      } catch (err) {
        setProjectStatus(`Project switch failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProjectBusy(false);
      }
    },
    [activateProject, activeProjectId, flushCurrentBoardSnapshot, isProjectBusy, stopReplayImmediate, stopSampler]
  );

  const handleCreateProject = React.useCallback(() => {
    if (isProjectBusy) {
      console.info('[projects] create ignored: project flow busy');
      setProjectStatus('Project action in progress. Please wait.');
      return;
    }
    setIsProjectBusy(true);
    setProjectStatus('Creating new project...');
    void (async () => {
      try {
        const flushed = await flushCurrentBoardSnapshot('board save before new project', activeProjectId);
        if (!flushed) {
          throw new Error('Could not save the latest board changes');
        }
        const projectName = `Project ${projects.length + 1}`;
        await createProjectWithCards(projectName, [], DEFAULT_SORT_CONFIG);
        setMode('setup');
        setProjectStatus(`Created "${projectName}".`);
      } catch (err) {
        console.error('[projects] create failed', err);
        setProjectStatus(`Create failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProjectBusy(false);
      }
    })();
  }, [activeProjectId, createProjectWithCards, flushCurrentBoardSnapshot, isProjectBusy, projects.length]);

  const handleRenameProject = React.useCallback(() => {
    if (!activeProject || isProjectBusy) return;
    const next = window.prompt('Rename project', activeProject.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      setProjectStatus('Project name cannot be empty.');
      return;
    }

    setIsProjectBusy(true);
    void (async () => {
      try {
        await persistPutProject({
          ...activeProject,
          name: trimmed,
          updatedAt: Date.now(),
        });
        await refreshProjects();
        setProjectStatus('Project renamed.');
      } catch (err) {
        setProjectStatus(`Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProjectBusy(false);
      }
    })();
  }, [activeProject, isProjectBusy, refreshProjects]);

  const handleDeleteProject = React.useCallback(() => {
    if (!activeProject || !activeProjectId || isProjectBusy) return;
    const ok = window.confirm(`Permanently delete “${activeProject.name}” and its replay sessions? This cannot be undone.`);
    if (!ok) return;

    setIsProjectBusy(true);
    void (async () => {
      try {
        const deleted = await persistDeleteProject(activeProjectId);
        setupUndoPastByProjectRef.current.delete(activeProjectId);
        let listed = await persistListProjects();
        let nextActive = deleted.activeProjectId;

        if (listed.length === 0) {
          const starter = await createDemoProjectCards(DEMO_CARD_COUNT);
          nextActive = await createProjectWithCards(DEFAULT_PROJECT_NAME, starter, DEFAULT_SORT_CONFIG);
          listed = await persistListProjects();
        } else if (!nextActive || !listed.some((p) => p.id === nextActive)) {
          nextActive = listed[0].id;
          await persistSetActiveProjectId(nextActive);
        }

        setProjects(listed);
        activateProject(nextActive);
        setMode('setup');
        setProjectStatus('Project deleted.');
      } catch (err) {
        setProjectStatus(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProjectBusy(false);
      }
    })();
  }, [activateProject, activeProject, activeProjectId, createDemoProjectCards, createProjectWithCards, isProjectBusy]);

  const handleExportProject = React.useCallback(() => {
    if (!activeProject || !activeProjectId || isProjectBusy) return;
    setIsProjectBusy(true);
    setProjectStatus('Exporting project...');
    void (async () => {
      try {
        const boardFlushed = await flushCurrentBoardSnapshot('board save before export', activeProjectId);
        if (!boardFlushed) {
          throw new Error('Could not save the latest board changes before export');
        }
        const sessionFlushed = await flushCurrentRecordingSession('session save before export');
        if (!sessionFlushed) {
          throw new Error('Could not save the latest recording before export');
        }
        const blob = await persistExportProjectZip(activeProjectId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFileName(activeProject.name)}.sortboard.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setProjectStatus('Project exported.');
      } catch (err) {
        setProjectStatus(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProjectBusy(false);
      }
    })();
  }, [activeProject, activeProjectId, flushCurrentBoardSnapshot, flushCurrentRecordingSession, isProjectBusy]);

  const projectImportInputRef = React.useRef<HTMLInputElement>(null);
  const handleImportProject = React.useCallback(() => {
    if (isProjectBusy) return;
    projectImportInputRef.current?.click();
  }, [isProjectBusy]);

  const handleImportProjectFile = React.useCallback(
    (file: File) => {
      if (isProjectBusy) return;
      setIsProjectBusy(true);
      setProjectStatus('Importing project...');
      void (async () => {
        try {
          const flushed = await flushCurrentBoardSnapshot('board save before project import', activeProjectId);
          if (!flushed) {
            throw new Error('Could not save the latest board changes');
          }
          const { projectId } = await persistImportProjectZip(file);
          await refreshProjects();
          await persistSetActiveProjectId(projectId);
          activateProject(projectId);
          setMode('setup');
          setProjectStatus('Project imported.');
        } catch (err) {
          setProjectStatus(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
          setIsProjectBusy(false);
        }
      })();
    },
    [activateProject, activeProjectId, flushCurrentBoardSnapshot, isProjectBusy, refreshProjects]
  );

  // Start IndexedDB writes as part of the commit. A page navigation cannot
  // reliably wait for asynchronous work first started from pagehide.
  React.useLayoutEffect(() => {
    if (!boardId || !isProjectHydrated) return;
    if (mode === 'end') return;
    if (sortConfig.type !== 'open' && mode !== 'setup') return;
    const immediateSave = immediateCardSaveRef.current;
    if (immediateSave?.cards === cards) {
      immediateCardSaveRef.current = null;
      void immediateSave.promise.then((saved) => {
        if (!saved) void persistCurrentBoardSnapshot('board autosave retry');
      });
      return;
    }
    void persistCurrentBoardSnapshot('board autosave');
  }, [
    boardId,
    cards,
    isProjectHydrated,
    mode,
    persistCurrentBoardSnapshot,
    sortConfig.type,
  ]);

  // Recording changes are infrequent (a completed move or stage transition),
  // so they use the same eager hand-off to IndexedDB.
  React.useLayoutEffect(() => {
    if (!boardId || !isProjectHydrated) return;
    if (mode !== 'sort' || !isRecording) return;
    if (!recordingSession) return;
    const sessionId = recordingSession.createdAt;
    if (discardedSessionIdsRef.current.has(sessionId)) return;
    void persistCurrentRecordingSession('session autosave');
  }, [boardId, isProjectHydrated, isRecording, mode, persistCurrentRecordingSession, recordingSession]);

  React.useLayoutEffect(() => {
    const flushForPageLifecycle = (reason: string) => {
      void persistCurrentBoardSnapshotImmediately(`board save on ${reason}`);
      void persistCurrentRecordingSessionImmediately(`session save on ${reason}`);
    };
    const onPageHide = () => flushForPageLifecycle('pagehide');
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushForPageLifecycle('visibility change');
      }
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persistCurrentBoardSnapshotImmediately, persistCurrentRecordingSessionImmediately]);

  const clampToBoardWithDims = React.useCallback(
    (x: number, y: number, w: number, h: number) => {
      const viewport = {
        width: boardSize.width || 1200,
        height: boardSize.height || 800,
      };
      const scene =
        sortConfig.type !== 'open' && workflowRef.current.templateId === sortConfig.type && activeStageIdRef.current
          ? buildStageSurfaceScene(
              workflowRef.current,
              activeStageIdRef.current,
              cardsRef.current,
              selectedWidgetId,
              modeRef.current,
              viewport
            )
          : null;
      return clampToBoardPure(x, y, {
        boardW: scene?.canvasW ?? viewport.width,
        boardH: scene?.canvasH ?? viewport.height,
        cardW: w,
        cardH: h,
      });
    },
    [boardSize.height, boardSize.width, selectedWidgetId, sortConfig.type]
  );

  const snapClosedWithDims = React.useCallback(
    (x: number, y: number, w: number, h: number) => {
      const viewport = {
        width: boardSize.width || 1200,
        height: boardSize.height || 800,
      };
      return (
      snapClosedPure(x, y, {
        boardW: viewport.width,
        boardH: viewport.height,
        cardW: w,
        cardH: h,
        columns: sortConfig.columns ?? 3,
      })
      );
    },
    [boardSize.height, boardSize.width, sortConfig.columns]
  );

  const resolveCardPlacement = React.useCallback(
    (
      card: CardData,
      x: number,
      y: number,
      options?: {
        baseWidth?: number;
        layoutMode?: CardLayoutMode;
        snap?: boolean;
      }
    ) => {
      const baseWidth = options?.baseWidth ?? cardWidth;
      const layoutMode = options?.layoutMode ?? cardLayoutMode;
      const shouldSnap = options?.snap ?? false;
      const dims = getCardDimensions(card, layoutMode, baseWidth);
      const clamped = clampToBoardWithDims(x, y, dims.w, dims.h);
      const snapped = shouldSnap
        ? snapClosedWithDims(clamped.x, clamped.y, dims.w, dims.h)
        : clamped;
      return { x: snapped.x, y: snapped.y, w: dims.w, h: dims.h };
    },
    [cardLayoutMode, cardWidth, clampToBoardWithDims, snapClosedWithDims]
  );

  const getBoardFitScaleMax = React.useCallback(
    (card: CardData, baseWidth = cardWidth, layoutMode = cardLayoutMode) => {
      if (boardSize.width <= 0 || boardSize.height <= 0) {
        return CARD_SIZE_SCALE_MAX;
      }
      const dimsAtScaleOne = getCardDimensions(
        {
          ...card,
          sizeScale: 1,
        },
        layoutMode,
        baseWidth
      );
      const maxByWidth = boardSize.width / Math.max(1, dimsAtScaleOne.w);
      const maxByHeight = boardSize.height / Math.max(1, dimsAtScaleOne.h);
      const fitMax = Math.min(CARD_SIZE_SCALE_MAX, maxByWidth, maxByHeight);
      return Math.max(CARD_SIZE_SCALE_MIN, fitMax);
    },
    [boardSize.height, boardSize.width, cardLayoutMode, cardWidth]
  );

  const hasWidgetWorkflow = sortConfig.type !== 'open' && workflow.templateId === sortConfig.type;

  const buildSurfaceScene = React.useCallback(
    (
      stageId: string,
      nextCards = cardsRef.current,
      nextWorkflow = workflowRef.current,
      nextMode = modeRef.current,
      selectedWidgetIdArg: string | null = selectedWidgetId,
      activeDrop?: WidgetDropIndicator | null
    ) =>
      buildStageSurfaceScene(
        nextWorkflow,
        stageId,
        nextCards,
        selectedWidgetIdArg,
        nextMode,
        boardViewport,
        activeDrop
      ),
    [boardViewport, selectedWidgetId]
  );

  const reflowActiveWidgetStageCards = React.useCallback(
    (nextCards: CardData[], nextWorkflow = workflowRef.current, stageId = activeStageIdRef.current) => {
      if (!hasWidgetWorkflow || !stageId) return nextCards;
      return reflowCardsForStage(nextCards, nextWorkflow, stageId);
    },
    [hasWidgetWorkflow, reflowCardsForStage]
  );

  React.useEffect(() => {
    if (!isProjectHydrated) return;
    if (mode === 'end') return;
    if (!hasWidgetWorkflow || !activeStageIdRef.current) return;
    if (boardViewport.width <= 0 || boardViewport.height <= 0) return;

    const reflowed = reflowCardsForStage(cardsRef.current, workflowRef.current, activeStageIdRef.current, modeRef.current);
    if (reflowed === cardsRef.current) return;
    commitBoardState(reflowed, stacksRef.current);
  }, [activeStageId, boardViewport.height, boardViewport.width, hasWidgetWorkflow, isProjectHydrated, mode, reflowCardsForStage, workflow]);

  function createStackRecord(name?: string): StackData {
    const trimmed = name?.trim();
    return {
      id: nanoid(),
      name: trimmed || createStackName(stacksRef.current),
      createdAt: Date.now(),
    };
  }

  function collectStaticMoveMembers(previousCards: CardData[], nextCards: CardData[]) {
    const previousById = new Map(previousCards.map((card) => [card.id, card]));
    return nextCards
      .map((card) => {
        const previous = previousById.get(card.id);
        if (!previous) return null;
        if (previous.x === card.x && previous.y === card.y) return null;
        return {
          cardId: card.id,
          from: { x: previous.x, y: previous.y },
          final: { x: card.x, y: card.y },
        };
      })
      .filter((member): member is NonNullable<typeof member> => !!member);
  }

  const compactAllStacks = React.useCallback(
    (sourceCards: CardData[], sourceStacks: StackData[], snap = sortConfig.type === 'closed') => {
      let nextCards = sourceCards;
      for (const stack of sourceStacks) {
        const topCard = getTopCardForStack(nextCards, stack.id);
        const count = getStackCount(nextCards, stack.id);
        if (!topCard || count < 2) continue;
        nextCards = compactStackLayout(nextCards, stack.id, resolveCardPlacement, {
          anchor: { x: topCard.x, y: topCard.y },
          snap,
          orderedIds: getStackCards(nextCards, stack.id).map((card) => card.id),
          zBase: zTop.current,
        });
      }
      return nextCards;
    },
    [resolveCardPlacement, sortConfig.type]
  );

  const startCardResize = React.useCallback(
    (cardId: string, pointer: { pointerId: number; clientX: number; clientY: number; edge: ResizeEdge }) => {
      if (modeRef.current !== 'setup') return;
      const projectId = activeProjectIdRef.current;
      if (!projectId) return;

      const selectedIds = selectedCardIdsRef.current;
      const selectedSet = new Set(selectedIds);
      const shouldResizeSelection = selectedIds.length > 1 && selectedSet.has(cardId);
      const resizeIds = shouldResizeSelection ? selectedIds : [cardId];
      const resizeIdSet = new Set(resizeIds);
      const startById = new Map<string, SetupResizeCardStart>();

      for (const card of cards) {
        if (!resizeIdSet.has(card.id)) continue;
        const startScale = normalizeCardSizeScale(card.sizeScale);
        const dims = getCardDimensions(
          {
            ...card,
            sizeScale: startScale,
          },
          cardLayoutMode,
          cardWidth
        );
        const fitMax = getBoardFitScaleMax(card, cardWidth, cardLayoutMode);
        startById.set(card.id, {
          startScale,
          centerX: card.x + dims.w / 2,
          centerY: card.y + dims.h / 2,
          minRatio: CARD_SIZE_SCALE_MIN / startScale,
          maxRatio: Math.min(CARD_SIZE_SCALE_MAX, fitMax) / startScale,
        });
      }

      const leaderStart = startById.get(cardId);
      if (!leaderStart) return;
      if (startById.size === 0) return;

      let ratioMin = 0;
      let ratioMax = Number.POSITIVE_INFINITY;
      for (const start of startById.values()) {
        ratioMin = Math.max(ratioMin, start.minRatio);
        ratioMax = Math.min(ratioMax, start.maxRatio);
      }
      if (!Number.isFinite(ratioMin) || !Number.isFinite(ratioMax) || ratioMin > ratioMax) return;

      cancelCardResize();
      setupGroupDragRef.current = null;
      setIsResizingCard(true);
      const previousBodyCursor =
        typeof document !== 'undefined' && document.body ? document.body.style.cursor : '';
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.cursor = cursorForResizeEdge(pointer.edge);
      }

      let undoPushed = false;

      const finalizeResize = () => {
        if (!hasWidgetWorkflow) return;
        setCards((prev) => {
          const snapped = prev.map((card) => {
            if (!startById.has(card.id)) return card;
            const placed = resolveCardPlacement(card, card.x, card.y, { snap: true });
            if (card.x === placed.x && card.y === placed.y) return card;
            return { ...card, x: placed.x, y: placed.y };
          });
          return reflowActiveWidgetStageCards(snapped);
        });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerStop);
        window.removeEventListener('pointercancel', handlePointerStop);
        if (typeof document !== 'undefined' && document.body) {
          document.body.style.cursor = previousBodyCursor;
        }
        if (cardResizeCleanupRef.current === cleanup) {
          cardResizeCleanupRef.current = null;
        }
        setIsResizingCard(false);
      };

      const handlePointerStop = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        if (modeRef.current === 'setup' && activeProjectIdRef.current === projectId) {
          finalizeResize();
        }
        cleanup();
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        if (modeRef.current !== 'setup' || activeProjectIdRef.current !== projectId) {
          cleanup();
          return;
        }

        const dx = event.clientX - pointer.clientX;
        const dy = event.clientY - pointer.clientY;
        const edgeDelta = resizeDeltaForEdge(pointer.edge, dx, dy);
        const rawLeaderScale = leaderStart.startScale + edgeDelta / Math.max(1, cardWidth);
        const rawRatio = rawLeaderScale / Math.max(0.001, leaderStart.startScale);
        const nextRatio = clamp(rawRatio, ratioMin, ratioMax);

        setCards((prev) => {
          let changed = false;
          const next = prev.map((card) => {
            const start = startById.get(card.id);
            if (!start) return card;
            const scaled = Math.round(start.startScale * nextRatio * 1000) / 1000;
            const nextScale = normalizeCardSizeScale(scaled);
            const resized = { ...card, sizeScale: nextScale };
            const dims = getCardDimensions(resized, cardLayoutMode, cardWidth);
            const rawX = start.centerX - dims.w / 2;
            const rawY = start.centerY - dims.h / 2;
            const clamped = resolveCardPlacement(resized, rawX, rawY, { snap: false });
            if (
              Math.abs(normalizeCardSizeScale(card.sizeScale) - nextScale) < 0.001 &&
              card.x === clamped.x &&
              card.y === clamped.y
            ) {
              return card;
            }
            changed = true;
            return {
              ...resized,
              x: clamped.x,
              y: clamped.y,
            };
          });
          if (!changed) return prev;
          if (!undoPushed) {
            pushSetupUndoSnapshotIfNeeded(projectId);
            undoPushed = true;
          }
          return next;
        });
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerStop);
      window.addEventListener('pointercancel', handlePointerStop);
      cardResizeCleanupRef.current = cleanup;
    },
    [
      cancelCardResize,
      cardLayoutMode,
      cardWidth,
      cards,
      getBoardFitScaleMax,
      hasWidgetWorkflow,
      pushSetupUndoSnapshotIfNeeded,
      reflowActiveWidgetStageCards,
    ]
  );

  const setLayoutMode = React.useCallback(
    (nextMode: CardLayoutMode) => {
      if (nextMode === cardLayoutMode) return;
      if (mode === 'setup' && activeProjectId) {
        pushSetupUndoSnapshotIfNeeded(activeProjectId);
      }
      setCardLayoutMode(nextMode);
      setCards((prev) => {
        const resized = prev.map((card) => {
          const next = resolveCardPlacement(card, card.x, card.y, {
            layoutMode: nextMode,
          });
          return { ...card, x: next.x, y: next.y };
        });
        return hasWidgetWorkflow
          ? reflowActiveWidgetStageCards(resized)
          : compactAllStacks(resized, stacksRef.current, sortConfig.type === 'closed');
      });
    },
    [
      activeProjectId,
      cardLayoutMode,
      compactAllStacks,
      hasWidgetWorkflow,
      mode,
      pushSetupUndoSnapshotIfNeeded,
      reflowActiveWidgetStageCards,
      resolveCardPlacement,
      sortConfig.type,
    ]
  );

  const handleCardWidthChange = React.useCallback(
    (nextWidthRaw: number) => {
      if (mode !== 'setup' || !activeProjectId) return;
      const nextWidth = clampCardWidth(nextWidthRaw);
      if (nextWidth === cardWidth) return;
      setCardWidth(nextWidth);
      setCards((prev) => {
        const resized = prev.map((card) => {
          const next = resolveCardPlacement(card, card.x, card.y, {
            baseWidth: nextWidth,
          });
          return { ...card, x: next.x, y: next.y };
        });
        return hasWidgetWorkflow
          ? reflowActiveWidgetStageCards(resized)
          : compactAllStacks(resized, stacksRef.current, sortConfig.type === 'closed');
      });
    },
    [activeProjectId, cardWidth, compactAllStacks, hasWidgetWorkflow, mode, reflowActiveWidgetStageCards, resolveCardPlacement, sortConfig.type]
  );

  const reconcileStacksAfterDrop = React.useCallback(
    (sourceCards: CardData[], sourceStacks: StackData[], movedIds: string[], placedCards: CardData[]) => {
      if (movedIds.length === 0) {
        return { cards: placedCards, stacks: sourceStacks };
      }

      let workingCards = placedCards;
      let workingStacks = sourceStacks;
      const draggedCards = sourceCards.filter((card) => movedIds.includes(card.id));
      const cameFromStack = draggedCards.some((card) => !!card.stackId);
      if (cameFromStack) {
        const removed = removeCardsFromStack(workingCards, workingStacks, movedIds);
        workingCards = removed.cards;
        workingStacks = removed.stacks;
      }

      const target = findDropStackTarget(workingCards, movedIds, getCardBounds);
      if (!target) {
        return { cards: workingCards, stacks: workingStacks };
      }

      if (target.type === 'stack') {
        return addCardsToStack(workingCards, workingStacks, target.stackId, movedIds, resolveCardPlacement, {
          snap: sortConfig.type === 'closed',
          zBase: zTop.current,
        });
      }

      const targetCard = workingCards.find((card) => card.id === target.cardId);
      if (!targetCard) {
        return { cards: workingCards, stacks: workingStacks };
      }

      if (targetCard.stackId) {
        return addCardsToStack(workingCards, workingStacks, targetCard.stackId, movedIds, resolveCardPlacement, {
          snap: sortConfig.type === 'closed',
          zBase: zTop.current,
        });
      }

      const nextStack: StackData = {
        id: nanoid(),
        name: createStackName(workingStacks),
        createdAt: Date.now(),
      };

      return createStack(workingCards, workingStacks, [targetCard.id, ...movedIds], nextStack, resolveCardPlacement, {
        snap: sortConfig.type === 'closed',
        zBase: zTop.current,
      });
    },
    [getCardBounds, resolveCardPlacement, sortConfig.type]
  );

  const handleStackDragStart = React.useCallback(
    (stackId: string, clientX: number, clientY: number) => {
      if (modeRef.current === 'end') return;
      const sourceCards = cardsRef.current;
      const stackCards = getStackCards(sourceCards, stackId);
      if (stackCards.length < 2) return;
      const leader = stackCards[0];
      const startById = new Map(stackCards.map((card) => [card.id, { x: card.x, y: card.y }]));
      stackDragRef.current = {
        stackId,
        leaderId: leader.id,
        leaderStart: { x: leader.x, y: leader.y },
        pointerStart: { x: clientX, y: clientY },
        memberIds: stackCards.map((card) => card.id),
        startById,
      };
      bringStackToFront(stackId);

      if (modeRef.current === 'setup') {
        setSelectedCardIds([]);
        setSelectedStackId(stackId);
        setIsDetailsDrawerOpen(true);
      }

      if (!isRecordingRef.current || isReplayingRef.current || !recordingSession || modeRef.current !== 'sort') return;

      const t = nowRecMs();
      recordingRef.current.activeSeg = {
        type: 'drag',
        id: nanoid(),
        cardId: leader.id,
        t0: t,
        t1: t,
        from: { x: Math.round(leader.x), y: Math.round(leader.y) },
        path: [[t, Math.round(leader.x), Math.round(leader.y)] satisfies TraceSample],
        drop: { x: Math.round(leader.x), y: Math.round(leader.y) },
        final: { x: Math.round(leader.x), y: Math.round(leader.y) },
        groupMembers: stackCards.slice(1).map((card) => ({
          cardId: card.id,
          from: { x: Math.round(card.x), y: Math.round(card.y) },
          drop: { x: Math.round(card.x), y: Math.round(card.y) },
          final: { x: Math.round(card.x), y: Math.round(card.y) },
        })),
        settleMs: 180,
      };
      recordingRef.current.lastSampleMs = t;
      latestDragRef.current = { cardId: leader.id, x: leader.x, y: leader.y };
      startSampler();
    },
    [bringStackToFront, nowRecMs, recordingSession, startSampler]
  );

  const handleStackDragMove = React.useCallback(
    (stackId: string, clientX: number, clientY: number) => {
      const drag = stackDragRef.current;
      if (!drag || drag.stackId !== stackId) return;
      const deltaX = clientX - drag.pointerStart.x;
      const deltaY = clientY - drag.pointerStart.y;

      setCards((prev) => {
        let changed = false;
        const next = prev.map((card) => {
          const start = drag.startById.get(card.id);
          if (!start) return card;
          const placed = resolveCardPlacement(card, start.x + deltaX, start.y + deltaY, { snap: false });
          if (card.x === placed.x && card.y === placed.y) return card;
          changed = true;
          return { ...card, x: placed.x, y: placed.y };
        });
        return changed ? next : prev;
      });

      if (isRecordingRef.current && !isReplayingRef.current && modeRef.current === 'sort') {
        latestDragRef.current = {
          cardId: drag.leaderId,
          x: drag.leaderStart.x + deltaX,
          y: drag.leaderStart.y + deltaY,
        };
      }
    },
    [resolveCardPlacement]
  );

  const handleStackDragEnd = React.useCallback(
    (stackId: string, clientX: number, clientY: number) => {
      const drag = stackDragRef.current;
      if (!drag || drag.stackId !== stackId) return;
      stackDragRef.current = null;

      const currentCards = cardsRef.current;
      const leader = currentCards.find((card) => card.id === drag.leaderId);
      if (!leader) return;

      const deltaX = clientX - drag.pointerStart.x;
      const deltaY = clientY - drag.pointerStart.y;
      const dropPos = resolveCardPlacement(leader, drag.leaderStart.x + deltaX, drag.leaderStart.y + deltaY, { snap: false });
      const finalPos = resolveCardPlacement(leader, drag.leaderStart.x + deltaX, drag.leaderStart.y + deltaY, {
        snap: sortConfig.type === 'closed',
      });
      const orderedIds = getStackCards(currentCards, stackId).map((card) => card.id);
      const nextCards = compactStackLayout(currentCards, stackId, resolveCardPlacement, {
        anchor: { x: finalPos.x, y: finalPos.y },
        snap: sortConfig.type === 'closed',
        orderedIds,
        zBase: zTop.current,
      });
      const didMove = dropPos.x !== drag.leaderStart.x || dropPos.y !== drag.leaderStart.y;

      if (modeRef.current === 'setup' && activeProjectIdRef.current && didMove) {
        pushSetupUndoSnapshotIfNeeded(activeProjectIdRef.current);
      }

      commitBoardState(nextCards, stacksRef.current);

      if (isRecordingRef.current && !isReplayingRef.current && recordingSession) {
        const seg = recordingRef.current.activeSeg;
        if (seg && seg.cardId === drag.leaderId) {
          const t = nowRecMs();
          seg.t1 = t;
          seg.drop = { x: dropPos.x, y: dropPos.y };
          seg.final = { x: finalPos.x, y: finalPos.y };
          const dropCards = currentCards;
          seg.groupMembers = (seg.groupMembers || []).map((member) => {
            const dropCard = dropCards.find((card) => card.id === member.cardId);
            const finalCard = nextCards.find((card) => card.id === member.cardId);
            return {
              cardId: member.cardId,
              from: member.from,
              drop: dropCard ? { x: dropCard.x, y: dropCard.y } : member.drop,
              final: finalCard ? { x: finalCard.x, y: finalCard.y } : member.final,
            };
          });
          const last = seg.path[seg.path.length - 1];
          if (!last || last[0] !== t) {
            seg.path.push([t, Math.round(seg.drop.x), Math.round(seg.drop.y)]);
          }
          setRecordingSession((prev) => (prev ? { ...prev, segments: [...prev.segments, seg] } : prev));
          recordingRef.current.activeSeg = null;
          stopSampler();
        }
      }
    },
    [commitBoardState, nowRecMs, pushSetupUndoSnapshotIfNeeded, recordingSession, resolveCardPlacement, sortConfig.type, stopSampler]
  );

  const applyWorkflowWidgetRect = React.useCallback(
    (widgetId: string, rect: { x: number; y: number; w: number; h: number }) => {
      const stageId = activeStageIdRef.current;
      if (!stageId) return;
      const currentWidget = workflowRef.current.widgets.find((widget) => widget.id === widgetId);
      const minSize = currentWidget ? getMinimumWidgetSize(currentWidget) : { minW: 220, minH: 180 };
      const clampedRect = clampWidgetRect(
        rect,
        boardSize.width || 1200,
        boardSize.height || 800,
        minSize.minW,
        minSize.minH
      );
      const nextWorkflow = patchWorkflowWidget(workflowRef.current, widgetId, clampedRect);
      workflowRef.current = nextWorkflow;
      setWorkflow(nextWorkflow);
      commitBoardState(reflowCardsForStage(cardsRef.current, nextWorkflow, stageId), stacksRef.current);
    },
    [boardSize.height, boardSize.width, commitBoardState, reflowCardsForStage]
  );

  const handleWidgetDragStart = React.useCallback(
    (widgetId: string, pointer: { pointerId: number; clientX: number; clientY: number }) => {
      if (modeRef.current !== 'setup' || !hasWidgetWorkflow) return;
      const projectId = activeProjectIdRef.current;
      if (!projectId) return;
      const widget = workflowRef.current.widgets.find((entry) => entry.id === widgetId);
      if (!widget || widget.kind !== 'qsort') return;

      cancelWidgetInteraction();
      setSelectedCardIds([]);
      setSelectedStackId(null);
      setSelectedWidgetId(widgetId);
      setIsDetailsDrawerOpen(true);
      widgetDragRef.current = {
        widgetId,
        pointerStart: { x: pointer.clientX, y: pointer.clientY },
        rectStart: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      };

      const previousBodyCursor = typeof document !== 'undefined' && document.body ? document.body.style.cursor : '';
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.cursor = 'grabbing';
      }
      let didMutate = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerStop);
        window.removeEventListener('pointercancel', handlePointerStop);
        if (typeof document !== 'undefined' && document.body) {
          document.body.style.cursor = previousBodyCursor;
        }
        if (widgetInteractionCleanupRef.current === cleanup) {
          widgetInteractionCleanupRef.current = null;
        }
        widgetDragRef.current = null;
      };

      const handlePointerStop = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        cleanup();
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        const drag = widgetDragRef.current;
        if (!drag || drag.widgetId !== widgetId) return;
        if (modeRef.current !== 'setup' || activeProjectIdRef.current !== projectId) {
          cleanup();
          return;
        }
        const dx = event.clientX - drag.pointerStart.x;
        const dy = event.clientY - drag.pointerStart.y;
        if (!didMutate && (dx !== 0 || dy !== 0)) {
          pushSetupUndoSnapshotIfNeeded(projectId);
          didMutate = true;
        }
        applyWorkflowWidgetRect(widgetId, {
          x: drag.rectStart.x + dx,
          y: drag.rectStart.y + dy,
          w: drag.rectStart.w,
          h: drag.rectStart.h,
        });
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerStop);
      window.addEventListener('pointercancel', handlePointerStop);
      widgetInteractionCleanupRef.current = cleanup;
    },
    [applyWorkflowWidgetRect, cancelWidgetInteraction, hasWidgetWorkflow, pushSetupUndoSnapshotIfNeeded]
  );

  const handleWidgetResizeStart = React.useCallback(
    (widgetId: string, pointer: { pointerId: number; clientX: number; clientY: number; edge: ResizeEdge }) => {
      if (modeRef.current !== 'setup' || !hasWidgetWorkflow) return;
      const projectId = activeProjectIdRef.current;
      if (!projectId) return;
      const widget = workflowRef.current.widgets.find((entry) => entry.id === widgetId);
      if (!widget || widget.kind !== 'qsort') return;

      cancelWidgetInteraction();
      setSelectedCardIds([]);
      setSelectedStackId(null);
      setSelectedWidgetId(widgetId);
      setIsDetailsDrawerOpen(true);
      widgetResizeRef.current = {
        widgetId,
        edge: pointer.edge,
        pointerStart: { x: pointer.clientX, y: pointer.clientY },
        rectStart: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      };

      const previousBodyCursor = typeof document !== 'undefined' && document.body ? document.body.style.cursor : '';
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.cursor = cursorForResizeEdge(pointer.edge);
      }
      let didMutate = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerStop);
        window.removeEventListener('pointercancel', handlePointerStop);
        if (typeof document !== 'undefined' && document.body) {
          document.body.style.cursor = previousBodyCursor;
        }
        if (widgetInteractionCleanupRef.current === cleanup) {
          widgetInteractionCleanupRef.current = null;
        }
        widgetResizeRef.current = null;
      };

      const handlePointerStop = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        cleanup();
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return;
        const resize = widgetResizeRef.current;
        if (!resize || resize.widgetId !== widgetId) return;
        if (modeRef.current !== 'setup' || activeProjectIdRef.current !== projectId) {
          cleanup();
          return;
        }
        const dx = event.clientX - resize.pointerStart.x;
        const dy = event.clientY - resize.pointerStart.y;
        if (!didMutate && (dx !== 0 || dy !== 0)) {
          pushSetupUndoSnapshotIfNeeded(projectId);
          didMutate = true;
        }
        applyWorkflowWidgetRect(widgetId, resizeRectForEdge(resize.rectStart, resize.edge, dx, dy));
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerStop);
      window.addEventListener('pointercancel', handlePointerStop);
      widgetInteractionCleanupRef.current = cleanup;
    },
    [applyWorkflowWidgetRect, cancelWidgetInteraction, hasWidgetWorkflow, pushSetupUndoSnapshotIfNeeded]
  );

  const handleCreateClosedTarget = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || sortConfig.type !== 'closed') return;
    const stageId = activeStageIdRef.current || getDefaultActiveStageId(workflowRef.current);
    if (!stageId) return;
    if (getClosedCategoryWidgets(workflowRef.current, stageId).length >= 5) return;
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    const nextWorkflow = addClosedCategoryWidget(
      workflowRef.current,
      stageId,
      boardSize.width || 1200,
      boardSize.height || 800
    );
    workflowRef.current = nextWorkflow;
    setWorkflow(nextWorkflow);
    const nextTarget = getClosedCategoryWidgets(nextWorkflow, stageId).at(-1);
    const nextCards = reflowCardsForStage(cardsRef.current, nextWorkflow, stageId);
    commitBoardState(nextCards, []);
    setSelectedCardIds([]);
    setSelectedStackId(null);
    setSelectedWidgetId(nextTarget?.id || null);
    setIsDetailsDrawerOpen(true);
  }, [
    activeProjectId,
    boardSize.height,
    boardSize.width,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    reflowCardsForStage,
    sortConfig.type,
  ]);

  const handlePatchSelectedWidget = React.useCallback(
    (updater: (widget: BoardWidgetData) => BoardWidgetData) => {
      if (mode !== 'setup' || !activeProjectId || !selectedWidgetId) return;
      const current = workflowRef.current.widgets.find((widget) => widget.id === selectedWidgetId);
      if (!current) return;
      pushSetupUndoSnapshotIfNeeded(activeProjectId);
      const nextWorkflow = {
        ...toPersistedWorkflow(workflowRef.current),
        widgets: workflowRef.current.widgets.map((widget) => {
          if (widget.id !== selectedWidgetId) return widget;
          const patched = updater(widget);
          const minSize = getMinimumWidgetSize(patched);
          return {
            ...patched,
            ...clampWidgetRect(
              patched,
              boardSize.width || 1200,
              boardSize.height || 800,
              minSize.minW,
              minSize.minH
            ),
          } as BoardWidgetData;
        }),
      };
      workflowRef.current = nextWorkflow;
      setWorkflow(nextWorkflow);
      if (sortConfig.type !== 'open' && activeStageIdRef.current) {
        const nextCards = reflowCardsForStage(cardsRef.current, nextWorkflow, activeStageIdRef.current);
        commitBoardState(nextCards, stacksRef.current);
      }
    },
    [
      activeProjectId,
      boardSize.height,
      boardSize.width,
      mode,
      pushSetupUndoSnapshotIfNeeded,
      reflowCardsForStage,
      selectedWidgetId,
      sortConfig.type,
    ]
  );

  const handleDeleteSelectedWidget = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || !selectedWidgetId) return;
    const selected = workflowRef.current.widgets.find((widget) => widget.id === selectedWidgetId);
    if (!selected || selected.kind === 'source' || selected.kind === 'pre-sort' || selected.kind === 'qsort') return;
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    const sourceWidget = getSourceWidget(workflowRef.current, selected.stageId);
    const reassignedCards =
      sourceWidget && sourceWidget.id !== selected.id
        ? moveAssignedCardsToWidgetZone(
            cardsRef.current,
            selected.stageId,
            selected.id,
            sourceWidget.id,
            WIDGET_ZONE_CONTENT
          )
        : cardsRef.current;
    const nextWorkflow = removeWidgetFromWorkflow(workflowRef.current, selectedWidgetId);
    workflowRef.current = nextWorkflow;
    setWorkflow(nextWorkflow);
    const nextCards = reflowCardsForStage(reassignedCards, nextWorkflow, selected.stageId);
    commitBoardState(nextCards, stacksRef.current);
    const nextSelected =
      selected.kind === 'category'
        ? getClosedCategoryWidgets(nextWorkflow, selected.stageId)[0]?.id || null
        : null;
    setSelectedWidgetId(nextSelected);
  }, [
    activeProjectId,
    commitBoardState,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    reflowCardsForStage,
    selectedWidgetId,
  ]);

  const handleGenerateQSortDistribution = React.useCallback(() => {
    if (mode !== 'setup' || !selectedWidgetId) return;
    const selected = workflowRef.current.widgets.find((widget) => widget.id === selectedWidgetId);
    if (!selected || selected.kind !== 'qsort') return;
    const generatedBuckets = buildNormalDistributionBuckets(cardsRef.current.length, selected.buckets.length || 7);
    const nextBuckets = generatedBuckets.map((generated, index) => ({
      ...generated,
      id: selected.buckets[index]?.id ?? generated.id,
      label: selected.buckets[index]?.label ?? generated.label,
    }));
    handlePatchSelectedWidget((widget) => (widget.kind === 'qsort' ? { ...widget, buckets: nextBuckets } : widget));
  }, [handlePatchSelectedWidget, mode, selectedWidgetId]);

  const handleDragTraceStart = React.useCallback(
    (id: string, x: number, y: number) => {
      if (modeRef.current === 'setup') {
        const selection = selectedCardIdsRef.current;
        if (!hasWidgetWorkflow && selection.length > 1 && selection.includes(id)) {
          const selectedSet = new Set(selection);
          const startById = new Map<string, { x: number; y: number }>();
          for (const card of cards) {
            if (!selectedSet.has(card.id)) continue;
            startById.set(card.id, { x: card.x, y: card.y });
          }
          setupGroupDragRef.current = {
            leaderId: id,
            leaderStart: { x, y },
            selectedIds: [...selection],
            startById,
          };
        } else {
          setupGroupDragRef.current = null;
        }
      }

      if (hasWidgetWorkflow) {
        setActiveWidgetDropIndicator(null);
        const stageId = activeStageIdRef.current;
        dragSurfaceSceneRef.current = stageId
          ? buildSurfaceScene(stageId, cardsRef.current, workflowRef.current, modeRef.current, null)
          : null;
      } else {
        dragSurfaceSceneRef.current = null;
      }

      if (!isRecording || isReplaying) return;
      if (!recordingSession) return;

      const t = nowRecMs();
      const sx = Math.round(x);
      const sy = Math.round(y);

      recordingRef.current.activeSeg = {
        type: 'drag',
        id: nanoid(),
        cardId: id,
        t0: t,
        t1: t,
        from: { x: sx, y: sy },
        path: [[t, sx, sy] satisfies TraceSample],
        drop: { x: sx, y: sy },
        final: { x: sx, y: sy },
        settleMs: 180,
      };
      recordingRef.current.lastSampleMs = t;

      latestDragRef.current = { cardId: id, x, y };
      startSampler();
    },
    [buildSurfaceScene, cards, hasWidgetWorkflow, isRecording, isReplaying, nowRecMs, recordingSession, startSampler]
  );

  const handleDragTraceSample = React.useCallback(
    (id: string, x: number, y: number) => {
      if (modeRef.current === 'setup') {
        const setupDrag = setupGroupDragRef.current;
        if (setupDrag && setupDrag.leaderId === id) {
          const selectedSet = new Set(setupDrag.selectedIds);
          const deltaX = x - setupDrag.leaderStart.x;
          const deltaY = y - setupDrag.leaderStart.y;

          setCards((prev) => {
            let changed = false;
            const next = prev.map((card) => {
              if (!selectedSet.has(card.id) || card.id === id) return card;
              const startPos = setupDrag.startById.get(card.id);
              if (!startPos) return card;
              const clamped = resolveCardPlacement(card, startPos.x + deltaX, startPos.y + deltaY, { snap: false });
              if (card.x === clamped.x && card.y === clamped.y) return card;
              changed = true;
              return { ...card, x: clamped.x, y: clamped.y };
            });
            return changed ? next : prev;
          });
        }
      }

      if (hasWidgetWorkflow && modeRef.current === 'sort') {
        const stageId = activeStageIdRef.current;
        const card = cardsRef.current.find((entry) => entry.id === id);
        if (card && stageId) {
          const dims = getCardDims(card);
          const scene = dragSurfaceSceneRef.current || buildSurfaceScene(stageId, cardsRef.current, workflowRef.current, 'sort', null);
          const target = findStageSurfaceDropTarget(scene, { x, y, w: dims.w, h: dims.h });
          if (target) {
            const validation = validateWidgetDrop(workflowRef.current, stageId, target, card, cardsRef.current);
            setActiveWidgetDropIndicator((previous) =>
              previous?.widgetId === target.widgetId &&
              previous.zoneId === target.zoneId &&
              previous.state === validation.state
                ? previous
                : {
                    widgetId: target.widgetId,
                    zoneId: target.zoneId,
                    state: validation.state,
                  }
            );
          } else {
            setActiveWidgetDropIndicator((previous) => (previous === null ? previous : null));
          }
        }
      }

      if (!isRecording || isReplaying) return;
      const seg = recordingRef.current.activeSeg;
      if (!seg || seg.cardId !== id) return;

      // rAF sampler will pick this up.
      latestDragRef.current = { cardId: id, x, y };
    },
    [buildSurfaceScene, getCardDims, hasWidgetWorkflow, isRecording, isReplaying, resolveCardPlacement]
  );

  const handleMoveEnd = React.useCallback(
    (id: string, newX: number, newY: number) => {
      if (isResizingCardRef.current) {
        return;
      }
      const sourceCards = cardsRef.current;
      const sourceStacks = stacksRef.current;
      const card = sourceCards.find((c) => c.id === id);
      const dropPos = card
        ? resolveCardPlacement(card, newX, newY, { snap: false })
        : { x: newX, y: newY, w: cardWidth, h: cardHeight };
      const finalPos = card
        ? resolveCardPlacement(card, newX, newY, { snap: sortConfig.type === 'closed' })
        : { x: newX, y: newY, w: cardWidth, h: cardHeight };
      const isSetup = mode === 'setup';
      const setupDrag = setupGroupDragRef.current;
      const selectionAtDrop = selectedCardIdsRef.current;
      const selectedIdsForMove =
        isSetup && !hasWidgetWorkflow && setupDrag && setupDrag.leaderId === id && setupDrag.selectedIds.length > 1
          ? setupDrag.selectedIds
          : selectionAtDrop;
      const shouldMoveSelection =
        isSetup && !hasWidgetWorkflow && !!card && selectedIdsForMove.length > 1 && selectedIdsForMove.includes(id);

      const movedIds = shouldMoveSelection ? selectedIdsForMove : [id];
      let didMove = false;
      let nextState: { cards: CardData[]; stacks: StackData[] } = { cards: sourceCards, stacks: sourceStacks };

      if (hasWidgetWorkflow && card) {
        const stageId = activeStageIdRef.current;
        let nextCards = sourceCards;
        let accepted = false;
        if (stageId) {
          const scene = buildSurfaceScene(stageId, sourceCards, workflowRef.current, mode === 'setup' ? 'setup' : 'sort', null);
          const target = findStageSurfaceDropTarget(scene, { x: dropPos.x, y: dropPos.y, w: finalPos.w, h: finalPos.h });
          if (target) {
            const validation = validateWidgetDrop(workflowRef.current, stageId, target, card, sourceCards);
            if (validation.accepted) {
              nextCards = reflowCardsForStage(
                assignCardsToWidgetZone(sourceCards, stageId, target.widgetId, target.zoneId, [id], { insertAt: 'front' }),
                workflowRef.current,
                stageId
              );
              accepted = true;
            }
          }
        }
        didMove =
          accepted &&
          nextCards.some((current, idx) => {
            const previous = sourceCards[idx];
            const currentAssignment = stageId ? current.widgetAssignments?.[stageId] : undefined;
            const previousAssignment = stageId ? previous.widgetAssignments?.[stageId] : undefined;
            return (
              current.x !== previous.x ||
              current.y !== previous.y ||
              currentAssignment?.widgetId !== previousAssignment?.widgetId ||
              currentAssignment?.zoneId !== previousAssignment?.zoneId ||
              currentAssignment?.order !== previousAssignment?.order
            );
          });
        nextState = { cards: didMove ? nextCards : sourceCards, stacks: [] };
      } else {
        const placedCards =
          shouldMoveSelection && card
            ? (() => {
                const selectedSet = new Set(selectedIdsForMove);
                const anchorX = setupDrag && setupDrag.leaderId === id ? setupDrag.leaderStart.x : card.x;
                const anchorY = setupDrag && setupDrag.leaderId === id ? setupDrag.leaderStart.y : card.y;
                const deltaX = finalPos.x - anchorX;
                const deltaY = finalPos.y - anchorY;
                return sourceCards.map((current) => {
                  if (!selectedSet.has(current.id)) return current;
                  const startPos = setupDrag?.startById.get(current.id);
                  const rawX = current.id === id ? finalPos.x : (startPos?.x ?? current.x) + deltaX;
                  const rawY = current.id === id ? finalPos.y : (startPos?.y ?? current.y) + deltaY;
                  const snappedCurrent = resolveCardPlacement(current, rawX, rawY);
                  return { ...current, x: snappedCurrent.x, y: snappedCurrent.y };
                });
              })()
            : sourceCards.map((current) => (current.id === id ? { ...current, x: finalPos.x, y: finalPos.y } : current));
        didMove = placedCards.some((current, idx) => current.x !== sourceCards[idx].x || current.y !== sourceCards[idx].y);
        nextState = didMove
          ? reconcileStacksAfterDrop(sourceCards, sourceStacks, movedIds, placedCards)
          : { cards: sourceCards, stacks: sourceStacks };
      }

      if (isSetup && activeProjectId && didMove) {
        pushSetupUndoSnapshotIfNeeded(activeProjectId);
      }

      if (didMove) {
        commitBoardState(nextState.cards, nextState.stacks);
      }
      if (setupDrag && setupDrag.leaderId === id) {
        setupGroupDragRef.current = null;
      }
      setActiveWidgetDropIndicator(null);
      dragSurfaceSceneRef.current = null;

      // A rejected, full, or unchanged drop is not an action. In particular,
      // keyboard moves create the same provisional trace as pointer drags and
      // must not leave a replay segment behind when validation rejects them.
      if (!didMove) {
        const seg = recordingRef.current.activeSeg;
        if (seg?.cardId === id) {
          recordingRef.current.activeSeg = null;
          stopSampler();
        }
        return false;
      }

      // Finalize active segment (record drop + final).
      if (isRecording && !isReplaying && recordingSession) {
        const seg = recordingRef.current.activeSeg;
        if (seg && seg.cardId === id) {
          const t = nowRecMs();
          seg.t1 = t;
          const finalCard = nextState.cards.find((current) => current.id === id);

          // drop: clamped release position
          seg.drop = { x: dropPos.x, y: dropPos.y };
          // final: snapped+clamped end position
          seg.final = finalCard ? { x: finalCard.x, y: finalCard.y } : { x: finalPos.x, y: finalPos.y };

          // Ensure last keyframe exists at drop moment (use drop as the last path point).
          const last = seg.path[seg.path.length - 1];
          if (!last || last[0] !== t) {
            seg.path.push([t, Math.round(seg.drop.x), Math.round(seg.drop.y)]);
          }

          if (seg.groupMembers) {
            seg.groupMembers = seg.groupMembers.map((member) => {
              const finalMember = nextState.cards.find((current) => current.id === member.cardId);
              return {
                ...member,
                final: finalMember ? { x: finalMember.x, y: finalMember.y } : member.final,
              };
            });
          }

          if (hasWidgetWorkflow) {
            const stageId = activeStageIdRef.current;
            if (stageId) {
              const previousAssignment = sourceCards.find((current) => current.id === id)?.widgetAssignments?.[stageId];
              const finalAssignment = nextState.cards.find((current) => current.id === id)?.widgetAssignments?.[stageId];
              if (
                previousAssignment?.widgetId !== finalAssignment?.widgetId ||
                previousAssignment?.zoneId !== finalAssignment?.zoneId ||
                previousAssignment?.order !== finalAssignment?.order
              ) {
                seg.widgetAssignmentChanges = [
                  {
                    cardId: id,
                    stageId,
                    assignment: finalAssignment,
                  },
                ];
              }
            }
            const movedIdsExcludingLeader = new Set([id, ...(seg.groupMembers || []).map((member) => member.cardId)]);
            seg.settleMembers = collectStaticMoveMembers(sourceCards, nextState.cards).filter(
              (member) => !movedIdsExcludingLeader.has(member.cardId)
            );
          }

          setRecordingSession((prev) => (prev ? { ...prev, segments: [...prev.segments, seg] } : prev));
          recordingRef.current.activeSeg = null;
          stopSampler();
        }
      }
      return true;
    },
    [
      activeProjectId,
      buildSurfaceScene,
      commitBoardState,
      cardHeight,
      cardWidth,
      hasWidgetWorkflow,
      isRecording,
      isReplaying,
      mode,
      nowRecMs,
      pushSetupUndoSnapshotIfNeeded,
      reconcileStacksAfterDrop,
      recordingSession,
      reflowCardsForStage,
      resolveCardPlacement,
      sortConfig.type,
      stopSampler,
    ]
  );

  const setSortType = React.useCallback(
    (type: SortType) => {
      if (type === sortConfig.type) return;
      if (mode !== 'setup') {
        setSortConfig((prev) => ({ ...prev, type }));
        return;
      }

      if (activeProjectId) {
        pushSetupUndoSnapshotIfNeeded(activeProjectId);
      }

      if (type === 'closed') {
        const nextWorkflow = createWorkflowForTemplate(
          'closed',
          boardSize.width || 1200,
          boardSize.height || 800,
          cardsRef.current.length
        );
        const stageId = getDefaultActiveStageId(nextWorkflow);
        const sourceWidget = stageId ? getSourceWidget(nextWorkflow, stageId) : null;
        const seeded = sourceWidget
          ? seedStageAssignments(
              cardsRef.current.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined })),
              stageId!,
              sourceWidget.id,
              WIDGET_ZONE_CONTENT
            )
          : cardsRef.current.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined }));
        const nextCards = stageId ? reflowCardsForStage(seeded, nextWorkflow, stageId) : seeded;
        const firstCategory = stageId ? getClosedCategoryWidgets(nextWorkflow, stageId)[0] : null;
        commitBoardState(nextCards, []);
        setWorkflow(nextWorkflow);
        setActiveStageId(stageId);
        setSelectedStackId(null);
        setSelectedCardIds([]);
        setSelectedWidgetId(firstCategory?.id || null);
      } else if (type === 'qsort') {
        const nextWorkflow = createWorkflowForTemplate(
          'qsort',
          boardSize.width || 1200,
          boardSize.height || 800,
          cardsRef.current.length
        );
        const stageId = getDefaultActiveStageId(nextWorkflow);
        const source = stageId ? getSourceWidget(nextWorkflow, stageId) : null;
        const seeded = source
          ? seedStageAssignments(
              cardsRef.current.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined })),
              stageId!,
              source.id,
              WIDGET_ZONE_CONTENT
            )
          : cardsRef.current.map((card) => ({ ...card, stackId: undefined, stackOrder: undefined }));
        const nextCards = stageId ? reflowCardsForStage(seeded, nextWorkflow, stageId) : seeded;
        const preSortWidget =
          stageId
            ? nextWorkflow.widgets.find(
                (widget): widget is Extract<BoardWidgetData, { kind: 'pre-sort' }> =>
                  widget.kind === 'pre-sort' && widget.stageId === stageId
              )
            : null;
        commitBoardState(nextCards, []);
        setWorkflow(nextWorkflow);
        setActiveStageId(stageId);
        setSelectedStackId(null);
        setSelectedCardIds([]);
        setSelectedWidgetId(preSortWidget?.id || null);
      } else {
        setWorkflow(createWorkflowForTemplate('open', boardSize.width || 1200, boardSize.height || 800, cardsRef.current.length));
        setActiveStageId(null);
        setSelectedWidgetId(null);
      }

      setSortConfig((prev) => ({ ...prev, type }));
    },
    [
      activeProjectId,
      boardSize.height,
      boardSize.width,
      commitBoardState,
      mode,
      pushSetupUndoSnapshotIfNeeded,
      reflowCardsForStage,
      sortConfig.type,
    ]
  );

  React.useEffect(() => {
    if (!isReplaying) return;

    const tick = () => {
      const idx = replayRef.current.index;
      if (!idx) {
        replayRef.current.raf = null;
        setIsReplaying(false);
        return;
      }

      const t = performance.now() - replayRef.current.startPerf;
      const clampedT = Math.min(idx.durationMs, Math.max(0, t));

      setReplayTimeMs(Math.round(clampedT));

      if (clampedT >= idx.durationMs) {
        replayRef.current.raf = null;
        setIsReplaying(false);
        return;
      }

      replayRef.current.raf = requestAnimationFrame(tick);
    };

    replayRef.current.raf = requestAnimationFrame(tick);
    return () => {
      cancelReplayFrame();
    };
  }, [cancelReplayFrame, isReplaying]);

  const sharedSelectionStackId = React.useMemo(() => {
    if (selectedCards.length === 0) return null;
    const firstStackId = selectedCards[0]?.stackId;
    if (!firstStackId) return null;
    return selectedCards.every((card) => card.stackId === firstStackId) ? firstStackId : null;
  }, [selectedCards]);

  const handleCreateStackFromSelection = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || sortConfig.type !== 'open') return;
    if (selectedCardIds.length < 2) return;
    const stack = createStackRecord();
    const result = createStack(cards, stacks, selectedCardIds, stack, resolveCardPlacement, {
      snap: false,
      zBase: zTop.current,
    });
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
    setSelectedCardIds([]);
    setSelectedStackId(stack.id);
    setIsDetailsDrawerOpen(true);
  }, [
    activeProjectId,
    cards,
    commitBoardState,
    createStackRecord,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    resolveCardPlacement,
    selectedCardIds,
    sortConfig.type,
    stacks,
  ]);

  const handleAddSelectionToStack = React.useCallback(
    (stackId: string) => {
      if (mode !== 'setup' || !activeProjectId || sortConfig.type !== 'open') return;
      if (selectedCardIds.length === 0) return;
      const result = addCardsToStack(cards, stacks, stackId, selectedCardIds, resolveCardPlacement, {
        snap: false,
        zBase: zTop.current,
      });
      pushSetupUndoSnapshotIfNeeded(activeProjectId);
      commitBoardState(result.cards, result.stacks);
      setSelectedCardIds([]);
      setSelectedStackId(stackId);
      setIsDetailsDrawerOpen(true);
    },
    [
      activeProjectId,
      cards,
      commitBoardState,
      mode,
      pushSetupUndoSnapshotIfNeeded,
      resolveCardPlacement,
      selectedCardIds,
      sortConfig.type,
      stacks,
    ]
  );

  const handleRemoveSelectionFromStack = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || sortConfig.type !== 'open') return;
    if (selectedCardIds.length === 0) return;
    const result = removeCardsFromStack(cards, stacks, selectedCardIds);
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
    setSelectedStackId(null);
  }, [activeProjectId, cards, commitBoardState, mode, pushSetupUndoSnapshotIfNeeded, selectedCardIds, sortConfig.type, stacks]);

  const handleRenameSelectedStack = React.useCallback(
    (name: string) => {
      if (mode !== 'setup' || !activeProjectId || !selectedStack || sortConfig.type !== 'open') return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === selectedStack.name) return;
      pushSetupUndoSnapshotIfNeeded(activeProjectId);
      setStacks((prev) => prev.map((stack) => (stack.id === selectedStack.id ? { ...stack, name: trimmed } : stack)));
    },
    [activeProjectId, mode, pushSetupUndoSnapshotIfNeeded, selectedStack, sortConfig.type]
  );

  const handleSortSelectedStack = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || !selectedStack || sortConfig.type !== 'open') return;
    const result = sortStack(cards, stacks, selectedStack.id, stackSortKey, resolveCardPlacement, {
      snap: false,
      zBase: zTop.current,
    });
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
  }, [
    activeProjectId,
    cards,
    commitBoardState,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    resolveCardPlacement,
    selectedStack,
    sortConfig.type,
    stackSortKey,
    stacks,
  ]);

  const handleShuffleSelectedStack = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || !selectedStack || sortConfig.type !== 'open') return;
    const result = shuffleStack(cards, stacks, selectedStack.id, resolveCardPlacement, {
      snap: false,
      zBase: zTop.current,
    });
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
  }, [activeProjectId, cards, commitBoardState, mode, pushSetupUndoSnapshotIfNeeded, resolveCardPlacement, selectedStack, sortConfig.type, stacks]);

  const handleSplitSelectedStack = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || !selectedStack || sortConfig.type !== 'open') return;
    const result = splitStack(cards, stacks, selectedStack.id, createStackRecord(), resolveCardPlacement, {
      snap: false,
      zBase: zTop.current,
      splitOffset: STACK_SPLIT_OFFSET_PX,
    });
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
  }, [
    activeProjectId,
    cards,
    commitBoardState,
    createStackRecord,
    mode,
    pushSetupUndoSnapshotIfNeeded,
    resolveCardPlacement,
    selectedStack,
    sortConfig.type,
    stacks,
  ]);

  const handleRemoveCardFromStack = React.useCallback(() => {
    if (mode !== 'setup' || !activeProjectId || !selectedCard?.stackId || sortConfig.type !== 'open') return;
    const result = removeCardsFromStack(cards, stacks, [selectedCard.id]);
    pushSetupUndoSnapshotIfNeeded(activeProjectId);
    commitBoardState(result.cards, result.stacks);
  }, [activeProjectId, cards, commitBoardState, mode, pushSetupUndoSnapshotIfNeeded, selectedCard, sortConfig.type, stacks]);

  // Setup-mode file picker
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const projectInteractionDisabled = isProjectBusy || isRecording || isReplaying;
  const sortMoveCount = recordingSession?.segments.length ?? 0;
  const replayRecording = replayView?.recording || null;
  const replayIndex = replayView?.index || null;
  const replayWorkflow = React.useMemo(() => {
    if (!replayRecording) return null;
    if (replayRecording.workflowAtStart) {
      return toPersistedWorkflow(replayRecording.workflowAtStart);
    }
    return createWorkflowForTemplate(
      replayRecording.sortConfig.type,
      replayRecording.boardW || boardViewport.width,
      replayRecording.boardH || boardViewport.height,
      replayRecording.cardsAtStart.length
    );
  }, [boardViewport.height, boardViewport.width, replayRecording]);
  const replayActiveStageId = React.useMemo(
    () => (replayRecording && replayIndex ? replayStageIdAt(replayRecording, replayIndex, replayTimeMs) : null),
    [replayIndex, replayRecording, replayTimeMs]
  );
  const replayCards = React.useMemo(
    () =>
      replayRecording && replayIndex
        ? replayCardsAt(replayRecording, replayIndex, replayTimeMs)
        : [],
    [replayIndex, replayRecording, replayTimeMs]
  );
  const replayHasWidgetWorkflow =
    !!replayRecording &&
    !!replayWorkflow &&
    replayRecording.sortConfig.type !== 'open' &&
    replayWorkflow.templateId === replayRecording.sortConfig.type;
  const replayVisibleCards = React.useMemo(
    () =>
      replayHasWidgetWorkflow && replayWorkflow && replayActiveStageId
        ? visibleCardsForStage(replayCards, replayWorkflow, replayActiveStageId)
        : replayCards,
    [replayActiveStageId, replayCards, replayHasWidgetWorkflow, replayWorkflow]
  );
  const replaySurfaceScene = React.useMemo<StageSurfaceScene | null>(
    () =>
      replayHasWidgetWorkflow && replayWorkflow && replayActiveStageId
        ? buildStageSurfaceScene(
            replayWorkflow,
            replayActiveStageId,
            replayCards,
            null,
            'sort',
            boardViewport,
            null
          )
        : null,
    [boardViewport, replayActiveStageId, replayCards, replayHasWidgetWorkflow, replayWorkflow]
  );
  const replayClusterMarkers = React.useMemo(() => replayIndex?.markers || [], [replayIndex]);
  const replayActivityMarkers = React.useMemo(
    () => replayClusterMarkers.filter((marker) => marker.score >= 6),
    [replayClusterMarkers]
  );
  const ignoreReplayInteraction = React.useCallback(() => undefined, []);
  const canUndoSetup = mode === 'setup' && !projectInteractionDisabled && !!activeProjectId && setupUndoPast.length > 0;
  const canAdjustCardSize =
    mode === 'setup' &&
    !projectInteractionDisabled &&
    !!activeProjectId &&
    boardSize.width > 0 &&
    boardSize.height > 0 &&
    sortConfig.type !== 'closed';
  const stackOptions = React.useMemo<StackOption[]>(
    () =>
      sortConfig.type !== 'open'
        ? []
        : stacks
        .map((stack) => ({ id: stack.id, name: stack.name, count: getStackCount(cards, stack.id) }))
        .filter((stack) => stack.count >= 2),
    [cards, sortConfig.type, stacks]
  );
  const activeWorkflowStageId = activeStageId || getDefaultActiveStageId(workflow);
  const stageVisibleCards = React.useMemo(
    () =>
      hasWidgetWorkflow && activeWorkflowStageId
        ? visibleCardsForStage(cards, workflow, activeWorkflowStageId)
        : cards,
    [activeWorkflowStageId, cards, hasWidgetWorkflow, workflow]
  );
  const boardSurfaceScene = React.useMemo<StageSurfaceScene | null>(
    () =>
      hasWidgetWorkflow && activeWorkflowStageId
        ? buildStageSurfaceScene(
            workflow,
            activeWorkflowStageId,
            cards,
            selectedWidgetId,
            mode,
            boardViewport,
            activeWidgetDropIndicator
          )
        : null,
    [activeWidgetDropIndicator, activeWorkflowStageId, boardViewport, cards, hasWidgetWorkflow, mode, selectedWidgetId, workflow]
  );
  const activeClosedSourceWidget = React.useMemo(
    () => (sortConfig.type === 'closed' ? getSourceWidget(workflow, activeWorkflowStageId) : null),
    [activeWorkflowStageId, sortConfig.type, workflow]
  );
  const closedCategoryWidgets = React.useMemo(
    () => (sortConfig.type === 'closed' ? getClosedCategoryWidgets(workflow, activeWorkflowStageId) : []),
    [activeWorkflowStageId, sortConfig.type, workflow]
  );
  const remainingClosedSourceCount = React.useMemo(
    () =>
      sortConfig.type === 'closed' && activeWorkflowStageId && activeClosedSourceWidget
        ? countCardsInWidgetZone(cards, activeWorkflowStageId, activeClosedSourceWidget.id, WIDGET_ZONE_CONTENT)
        : 0,
    [activeClosedSourceWidget, activeWorkflowStageId, cards, sortConfig.type]
  );
  const stackBadges = React.useMemo(
    () =>
      mode === 'end' || sortConfig.type !== 'open'
        ? []
        : stacks
            .map((stack) => {
              const members = getStackCards(cards, stack.id);
              const count = members.length;
              if (count < 2) return null;
              let minX = Number.POSITIVE_INFINITY;
              let minY = Number.POSITIVE_INFINITY;
              let maxX = Number.NEGATIVE_INFINITY;
              let maxY = Number.NEGATIVE_INFINITY;
              let topZ = 0;

              for (const member of members) {
                const dims = getCardDims(member);
                minX = Math.min(minX, member.x);
                minY = Math.min(minY, member.y);
                maxX = Math.max(maxX, member.x + dims.w);
                maxY = Math.max(maxY, member.y + dims.h);
                topZ = Math.max(topZ, member.z);
              }

              if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                return null;
              }

              const x = Math.max(0, minX - 14);
              const y = Math.max(0, minY - 14);
              return {
                stackId: stack.id,
                name: stack.name,
                count,
                x,
                y,
                width: Math.max(48, maxX - x + 14),
                height: Math.max(48, maxY - y + 14),
                z: topZ + 1,
                isSelected: selectedStackId === stack.id,
              };
            })
            .filter((badge): badge is NonNullable<typeof badge> => !!badge),
    [cards, getCardDims, mode, selectedStackId, sortConfig.type, stacks]
  );
  const detailsPanelContext = React.useMemo<DetailsPanelContext>(() => {
    if (sortConfig.type === 'closed' && selectedWidget) {
      if (selectedWidget.kind === 'category') {
        return {
          kind: 'closed-target',
          widget: selectedWidget,
          count: countCardsInWidgetZone(cards, selectedWidget.stageId, selectedWidget.id, WIDGET_ZONE_CONTENT),
          onUpdateName: (name) => handlePatchSelectedWidget((widget) => ({ ...widget, title: name })),
          onUpdateDescription: (description) =>
            handlePatchSelectedWidget((widget) => (widget.kind === 'category' ? { ...widget, description } : widget)),
          onUpdateCapacityMode: (capacityMode) =>
            handlePatchSelectedWidget((widget) => (widget.kind === 'category' ? { ...widget, capacityMode } : widget)),
          onUpdateCapacity: (capacity) =>
            handlePatchSelectedWidget((widget) =>
              widget.kind === 'category' ? { ...widget, capacity: Math.max(1, Math.floor(capacity)) } : widget
            ),
          onUpdateAllowedTags: (allowedTags) =>
            handlePatchSelectedWidget((widget) => (widget.kind === 'category' ? { ...widget, allowedTags } : widget)),
          onUpdateLayout: (layout) =>
            handlePatchSelectedWidget((widget) => (widget.kind === 'category' ? { ...widget, layout } : widget)),
          onDelete: handleDeleteSelectedWidget,
        };
      }
    }

    if (sortConfig.type !== 'open' && selectedWidget) {
      if (selectedWidget.kind === 'pre-sort') {
        return {
          kind: 'pre-sort-widget',
          widget: selectedWidget,
          counts: [
            countCardsInWidgetZone(cards, selectedWidget.stageId, selectedWidget.id, selectedWidget.zones[0]?.id || ''),
            countCardsInWidgetZone(cards, selectedWidget.stageId, selectedWidget.id, selectedWidget.zones[1]?.id || ''),
          ],
          onUpdateTitle: (title) => handlePatchSelectedWidget((widget) => ({ ...widget, title })),
          onUpdateZoneLabel: (zoneId, label) =>
            handlePatchSelectedWidget((widget) =>
              widget.kind !== 'pre-sort'
                ? widget
                : {
                    ...widget,
                    zones: widget.zones.map((zone) => (zone.id === zoneId ? { ...zone, label } : zone)) as typeof widget.zones,
                  }
            ),
        };
      }
      if (selectedWidget.kind === 'qsort') {
        return {
          kind: 'qsort-widget',
          widget: selectedWidget,
          laneCounts: selectedWidget.lanes.map((lane) =>
            countCardsInWidgetZone(cards, selectedWidget.stageId, selectedWidget.id, lane.id)
          ),
          bucketCounts: selectedWidget.buckets.map((bucket) =>
            countCardsInWidgetZone(cards, selectedWidget.stageId, selectedWidget.id, bucket.id)
          ),
          onUpdateTitle: (title) => handlePatchSelectedWidget((widget) => ({ ...widget, title })),
          onUpdateLaneLabel: (laneId, label) =>
            handlePatchSelectedWidget((widget) =>
              widget.kind !== 'qsort'
                ? widget
                : {
                    ...widget,
                    lanes: widget.lanes.map((lane) => (lane.id === laneId ? { ...lane, label } : lane)),
                  }
            ),
          onUpdateBucketLabel: (bucketId, label) =>
            handlePatchSelectedWidget((widget) =>
              widget.kind !== 'qsort'
                ? widget
                : {
                    ...widget,
                    buckets: widget.buckets.map((bucket) => (bucket.id === bucketId ? { ...bucket, label } : bucket)),
                  }
            ),
          onUpdateBucketCapacity: (bucketId, capacity) =>
            handlePatchSelectedWidget((widget) =>
              widget.kind !== 'qsort'
                ? widget
                : {
                    ...widget,
                    buckets: widget.buckets.map((bucket) =>
                      bucket.id === bucketId ? { ...bucket, capacity: Math.max(0, Math.floor(capacity)) } : bucket
                    ),
                  }
            ),
          onGenerateNormalDistribution: handleGenerateQSortDistribution,
        };
      }
    }

    if (selectedStack && selectedStackCount >= 2) {
      return {
        kind: 'stack',
        stack: selectedStack,
        count: selectedStackCount,
        sortKey: stackSortKey,
        onUpdateName: handleRenameSelectedStack,
        onChangeSortKey: setStackSortKey,
        onSort: handleSortSelectedStack,
        onShuffle: handleShuffleSelectedStack,
        onSplit: handleSplitSelectedStack,
      };
    }

    if (selectedCard) {
      const availableStackOptions = stackOptions.filter((option) => option.id !== selectedCard.stackId);
      const selectedCardAssignment =
        activeWorkflowStageId && sortConfig.type !== 'open'
          ? selectedCard.widgetAssignments?.[activeWorkflowStageId]
          : undefined;
      const selectedCardWidget =
        selectedCardAssignment && sortConfig.type === 'closed'
          ? workflow.widgets.find((widget) => widget.id === selectedCardAssignment.widgetId) || null
          : null;
      return {
        kind: 'card',
        card: selectedCard,
        stack: selectedCard.stackId ? stackOptions.find((option) => option.id === selectedCard.stackId) || null : null,
        stackOptions: sortConfig.type === 'open' ? availableStackOptions : [],
        closedContainer:
          selectedCardWidget && (selectedCardWidget.kind === 'source' || selectedCardWidget.kind === 'category')
          ? {
              id: selectedCardWidget.id,
              name: selectedCardWidget.kind === 'source' ? 'Cards' : selectedCardWidget.title,
              count: countCardsInWidgetZone(
                cards,
                activeWorkflowStageId!,
                selectedCardWidget.id,
                selectedCardAssignment?.zoneId || WIDGET_ZONE_CONTENT
              ),
              kind: selectedCardWidget.kind === 'source' ? 'source' : 'target',
            }
          : null,
        onUpdateMeta: handleUpdateSelectedCardMeta,
        onBeginMetaEdit: handleBeginSelectedCardMetaEdit,
        onEndMetaEdit: handleEndSelectedCardMetaEdit,
        onDeleteCard: handleDeleteSelectedCard,
        onBringToFront: () => bringToFront(selectedCard.id),
        onOpenPreview: selectedCard.kind === 'video' ? () => openVideoPreview(selectedCard.id) : undefined,
        onAddToStack: sortConfig.type === 'open' && availableStackOptions.length > 0 ? handleAddSelectionToStack : undefined,
        onRemoveFromStack: sortConfig.type === 'open' && selectedCard.stackId ? handleRemoveCardFromStack : undefined,
      };
    }

    if (selectedCardCount > 1) {
      return {
        kind: 'multi',
        selectedCount: selectedCardCount,
        stackOptions,
        sharedStackId: sharedSelectionStackId,
        onCreateStack: sortConfig.type === 'open' ? handleCreateStackFromSelection : undefined,
        onAddToStack: sortConfig.type === 'open' ? handleAddSelectionToStack : undefined,
        onRemoveFromStack: sortConfig.type === 'open' && sharedSelectionStackId ? handleRemoveSelectionFromStack : undefined,
        onDeleteSelectedCards: handleDeleteSelectedCards,
      };
    }

    return { kind: 'none' };
  }, [
    bringToFront,
    handleAddSelectionToStack,
    handleCreateStackFromSelection,
    handleDeleteSelectedWidget,
    handleDeleteSelectedCard,
    handleDeleteSelectedCards,
    handleBeginSelectedCardMetaEdit,
    handleEndSelectedCardMetaEdit,
    handleGenerateQSortDistribution,
    handlePatchSelectedWidget,
    handleRemoveCardFromStack,
    handleRemoveSelectionFromStack,
    handleRenameSelectedStack,
    handleShuffleSelectedStack,
    handleSortSelectedStack,
    handleSplitSelectedStack,
    handleUpdateSelectedCardMeta,
    activeWorkflowStageId,
    cards,
    openVideoPreview,
    selectedCard,
    selectedCardCount,
    selectedStack,
    selectedStackCount,
    selectedWidget,
    sharedSelectionStackId,
    sortConfig.type,
    stackOptions,
    stackSortKey,
    workflow.widgets,
  ]);
  const showSetupDetailsDrawer =
    mode === 'setup' &&
    isNarrowSetupLayout &&
    (selectedCardCount > 0 || selectedStackCount > 0 || !!selectedWidgetId) &&
    isDetailsDrawerOpen;
  const boardDragEnabled = !isReplaying && !isResizingCard;
  const closedTargetCount = React.useMemo(
    () => (sortConfig.type === 'closed' ? closedCategoryWidgets.length : 0),
    [closedCategoryWidgets.length, sortConfig.type]
  );
  const canAddClosedTarget = closedTargetCount < 5;
  const workflowConfiguredForSorting = isWorkflowConfiguredForSorting(workflow, sortConfig.type);
  const qSortSetupCapacity = React.useMemo(() => {
    if (sortConfig.type !== 'qsort') return null;
    const qSortStage = workflow.stages.find((stage) => stage.kind === 'qsort');
    const qSortWidget = getQSortWidget(workflow, qSortStage?.id);
    return qSortWidget ? qSortWidget.buckets.reduce((sum, bucket) => sum + bucket.capacity, 0) : null;
  }, [sortConfig.type, workflow]);
  const closedSetupCapacity = React.useMemo(() => {
    if (sortConfig.type !== 'closed' || closedCategoryWidgets.some((widget) => widget.capacityMode === 'unlimited')) {
      return null;
    }
    return closedCategoryWidgets.reduce((sum, widget) => sum + (widget.capacity || 0), 0);
  }, [closedCategoryWidgets, sortConfig.type]);
  const sortingSetupIssue =
    cards.length === 0
      ? 'Add at least one card to begin.'
      : !workflowConfiguredForSorting
        ? sortConfig.type === 'closed'
          ? 'Add at least one category before starting.'
          : 'Finish configuring this sort before starting.'
        : qSortSetupCapacity != null && qSortSetupCapacity < cards.length
          ? `The distribution has ${countLabel(qSortSetupCapacity, 'place')} for ${countLabel(cards.length, 'card')}. Open the Q-Sort stage and regenerate it before starting.`
          : closedSetupCapacity != null && closedSetupCapacity < cards.length
            ? `The categories have ${countLabel(closedSetupCapacity, 'place')} for ${countLabel(cards.length, 'card')}. Increase a capacity before starting.`
            : null;
  const canStartSorting =
    !!activeProjectId &&
    isProjectHydrated &&
    !isProjectBusy &&
    !sortingSetupIssue;
  const hasNextWorkflowStage =
    sortConfig.type === 'qsort' && activeWorkflowStageId ? !!getNextStageId(workflow, activeWorkflowStageId) : false;
  const isCurrentWorkflowStageComplete =
    hasWidgetWorkflow && activeWorkflowStageId ? isStageComplete(workflow, activeWorkflowStageId, cards) : true;
  const canEndSorting = hasWidgetWorkflow ? isCurrentWorkflowStageComplete : true;
  const incompleteStageCardCount = React.useMemo(() => {
    if (!hasWidgetWorkflow || !activeWorkflowStageId) return 0;
    const source = getSourceWidget(workflow, activeWorkflowStageId);
    if (source) {
      return countCardsInWidgetZone(cards, activeWorkflowStageId, source.id, WIDGET_ZONE_CONTENT);
    }
    const qSortWidget = getQSortWidget(workflow, activeWorkflowStageId);
    return qSortWidget
      ? qSortWidget.lanes.reduce(
          (sum, lane) => sum + countCardsInWidgetZone(cards, activeWorkflowStageId, qSortWidget.id, lane.id),
          0
        )
      : 0;
  }, [activeWorkflowStageId, cards, hasWidgetWorkflow, workflow]);
  const sortCompletionHint =
    !canEndSorting && incompleteStageCardCount > 0
      ? incompleteStageCardCount === 1
        ? 'Place the remaining card before continuing.'
        : `Place all ${incompleteStageCardCount} remaining cards before continuing.`
      : null;
  const activeSortStageLabel =
    sortConfig.type === 'qsort' && activeWorkflowStageId
      ? workflow.stages.find((stage) => stage.id === activeWorkflowStageId)?.name || null
      : null;
  const showSortStagePill = !!activeSortStageLabel && activeSortStageLabel !== getTemplateLabel(sortConfig.type);

  React.useEffect(() => {
    if (mode !== 'setup') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      if (!canUndoSetup) return;

      event.preventDefault();
      undoSetup();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndoSetup, mode, undoSetup]);

  const renderProjectControls = (compact = false) => (
    <div className={`projectTools ${compact ? 'projectTools--compact' : ''}`}>
      <div className="projectTools__row projectTools__row--select">
        <select
          className="projectTools__select"
          value={activeProjectId || ''}
          disabled={projectInteractionDisabled || projects.length === 0}
          onChange={(e) => void switchProject(e.currentTarget.value)}
          aria-label="Select project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="projectTools__row projectTools__row--actions">
        <button className="btn btn--ghost btn--tiny" type="button" disabled={projectInteractionDisabled} onClick={handleCreateProject}>
          New
        </button>
        <button
          className="btn btn--ghost btn--tiny"
          type="button"
          disabled={projectInteractionDisabled || !activeProject}
          onClick={handleRenameProject}
        >
          Rename
        </button>
        <button
          className="btn btn--ghost btn--tiny btn--dangerSoft"
          type="button"
          disabled={projectInteractionDisabled || !activeProject}
          onClick={handleDeleteProject}
        >
          Delete
        </button>
      </div>
      <div className="projectTools__row projectTools__row--actions projectTools__row--transfer">
        <button className="btn btn--ghost btn--tiny" type="button" disabled={projectInteractionDisabled} onClick={handleImportProject}>
          Import
        </button>
        <button
          className="btn btn--ghost btn--tiny"
          type="button"
          disabled={projectInteractionDisabled || !activeProject}
          onClick={handleExportProject}
        >
          Export
        </button>
      </div>
      {!compact && projectStatus ? (
        <div className="hint projectTools__status" data-testid="project-status" role="status">
          {projectStatus}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="app">
      <input
        ref={projectImportInputRef}
        data-testid="project-import-input"
        className="srOnly"
        aria-hidden="true"
        tabIndex={-1}
        type="file"
        accept=".zip,.sortboard.zip,application/zip"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) {
            handleImportProjectFile(file);
          }
          e.currentTarget.value = '';
        }}
      />
      {mode === 'setup' ? (
        <div className="layout layout--setupThreePane">
          <aside className="panel">
            <div className="panel__top">
              <div className="brand">
                <div className="brand__name">SortBoard</div>
                <div className="brand__sub">Stored in this browser</div>
              </div>

              <div className="panel__row">
                <button
                  className="btn"
                  type="button"
                  onClick={startSortingWorkflow}
                  disabled={!canStartSorting}
                  aria-describedby={sortingSetupIssue ? 'sorting-setup-issue' : undefined}
                >
                  Start sorting →
                </button>
                <button className="btn btn--ghost" type="button" onClick={undoSetup} disabled={!canUndoSetup}>
                  Undo
                </button>
              </div>
              {sortingSetupIssue ? (
                <div className="actionHint" id="sorting-setup-issue" role="status">
                  {sortingSetupIssue}
                </div>
              ) : null}
            </div>

            <div className="panel__section">
              <div className="sectionTitle">Project</div>
              {renderProjectControls()}
            </div>

            <div className="panel__section">
              <div className="sectionTitle">Add</div>

              <div
                className="dropzone"
                onDragOver={(e) => {
                  const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
                  if (!hasFiles) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []).filter(isSupportedMediaFile);
                  if (files.length > 0) addLocalMedia(files);
                }}
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="dropzone__title">Add images or videos</div>
                <div className="dropzone__sub">Choose files, or drop them onto the board.</div>
                <input
                  ref={fileInputRef}
                  data-testid="media-input"
                  className="srOnly"
                  aria-hidden="true"
                  tabIndex={-1}
                  type="file"
                  accept={SUPPORTED_MEDIA_ACCEPT}
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).filter(isSupportedMediaFile);
                    if (files.length) addLocalMedia(files);
                    // reset input so selecting same file again triggers change
                    e.currentTarget.value = '';
                  }}
                />
              </div>

              <div className="panel__row">
                <button className="btn btn--ghost" type="button" onClick={addTextCard}>
                  + Text card
                </button>
              </div>
            </div>

            <div className="panel__section">
              <div className="sectionTitle">Sort type</div>
              <div className="segmented segmented--sortTypes" role="group" aria-label="Sort type">
                <button
                  type="button"
                  className={`segmented__btn ${sortConfig.type === 'open' ? 'isActive' : ''}`}
                  aria-pressed={sortConfig.type === 'open'}
                  onClick={() => setSortType('open')}
                >
                  Open sort
                </button>
                <button
                  type="button"
                  className={`segmented__btn ${sortConfig.type === 'closed' ? 'isActive' : ''}`}
                  aria-pressed={sortConfig.type === 'closed'}
                  onClick={() => setSortType('closed')}
                >
                  Closed sort
                </button>
                <button
                  type="button"
                  className={`segmented__btn ${sortConfig.type === 'qsort' ? 'isActive' : ''}`}
                  aria-pressed={sortConfig.type === 'qsort'}
                  onClick={() => setSortType('qsort')}
                >
                  Q-Sort
                </button>
              </div>
              <div className="sortTypeDescription">{sortTypeDescription(sortConfig.type)}</div>

              {sortConfig.type === 'closed' ? (
                <div className="columns">
                  <div className="columns__label">Categories</div>
                  <div className="columns__controls">
                    <button className="btn btn--tiny" type="button" onClick={handleCreateClosedTarget} disabled={!canAddClosedTarget}>
                      Add category
                    </button>
                    <div className="columns__value">{closedTargetCount} / 5</div>
                  </div>
                </div>
              ) : null}

              {sortConfig.type === 'qsort' && workflow.stages.length > 0 ? (
                <div className="columns">
                  <div className="columns__label">Stage</div>
                  <div className="segmented segmented--compact" role="group" aria-label="Setup stage">
                    {workflow.stages
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((stage) => (
                        <button
                          key={stage.id}
                          type="button"
                          className={`segmented__btn ${activeWorkflowStageId === stage.id ? 'isActive' : ''}`}
                          aria-pressed={activeWorkflowStageId === stage.id}
                          onClick={() => {
                            setActiveStageId(stage.id);
                            const stageWidget = workflow.widgets.find(
                              (widget) =>
                                widget.stageId === stage.id && (widget.kind === 'pre-sort' || widget.kind === 'qsort')
                            );
                            setSelectedWidgetId(stageWidget?.id || null);
                          }}
                        >
                          {stage.name}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="panel__section">
              <div className="sectionTitle">Cards</div>
              <div className="cardStats">
                <div>{countLabel(cards.length, 'card')}</div>
              </div>
              <div className="layoutModeControl">
                <div className="layoutModeControl__label">Layout</div>
                <div className="segmented segmented--compact segmented--layoutModes" role="group" aria-label="Card proportions">
                  <button
                    type="button"
                    className={`segmented__btn ${cardLayoutMode === 'as-is' ? 'isActive' : ''}`}
                    aria-pressed={cardLayoutMode === 'as-is'}
                    onClick={() => setLayoutMode('as-is')}
                  >
                    Original ratio
                  </button>
                  <button
                    type="button"
                    className={`segmented__btn ${cardLayoutMode === 'fixed-16-9' ? 'isActive' : ''}`}
                    aria-pressed={cardLayoutMode === 'fixed-16-9'}
                    onClick={() => setLayoutMode('fixed-16-9')}
                  >
                    Fixed 16:9
                  </button>
                  <button
                    type="button"
                    className={`segmented__btn ${cardLayoutMode === 'fixed-9-16' ? 'isActive' : ''}`}
                    aria-pressed={cardLayoutMode === 'fixed-9-16'}
                    onClick={() => setLayoutMode('fixed-9-16')}
                  >
                    Fixed 9:16
                  </button>
                </div>
              </div>
              {sortConfig.type === 'open' ? (
                <div className="cardSizeControl">
                  <label className="cardSizeControl__label" htmlFor="card-size-slider">
                    Card size <span className="mono">{cardWidth}px</span>
                  </label>
                  <input
                    id="card-size-slider"
                    className="cardSizeControl__range"
                    type="range"
                    aria-label="Card size"
                    min={CARD_W_MIN}
                    max={CARD_W_MAX}
                    step={CARD_W_STEP}
                    value={cardWidth}
                    disabled={!canAdjustCardSize}
                    onChange={(event) => handleCardWidthChange(Number(event.currentTarget.value))}
                  />
                </div>
              ) : null}
            </div>
          </aside>

          <main className="main">
            <Board
              mode={mode}
              sortConfig={sortConfig}
              cards={hasWidgetWorkflow ? stageVisibleCards : cards}
              stackBadges={stackBadges}
              surfaceScene={boardSurfaceScene}
              baseCardWidth={cardWidth}
              cardLayoutMode={cardLayoutMode}
              selectedCardIds={selectedCardIds}
              boardRef={boardRef}
              dragEnabled={boardDragEnabled}
              onBringToFront={bringToFront}
              onMoveEnd={handleMoveEnd}
              onResizeStart={startCardResize}
              onSelectCard={handleSelectCard}
              onSelectStack={handleSelectStack}
              onSelectWidget={handleSelectWidget}
              onStackDragStart={handleStackDragStart}
              onStackDragMove={handleStackDragMove}
              onStackDragEnd={handleStackDragEnd}
              onWidgetDragStart={handleWidgetDragStart}
              onWidgetResizeStart={handleWidgetResizeStart}
              onClearSelection={handleClearSelection}
              onLassoSelect={handleLassoSelect}
              onDragTraceStart={handleDragTraceStart}
              onDragTraceSample={handleDragTraceSample}
              onOpenPreview={openVideoPreview}
              onFilesAdded={addLocalMedia}
            />
            {showSetupDetailsDrawer ? (
              <>
                <button
                  className="detailsDrawerBackdrop"
                  type="button"
                  tabIndex={-1}
                  aria-label="Close details panel"
                  onClick={() => setIsDetailsDrawerOpen(false)}
                />
                <CardDetailsPanel
                  context={detailsPanelContext}
                  isDrawer
                  onClose={() => setIsDetailsDrawerOpen(false)}
                />
              </>
            ) : null}
          </main>
          {!isNarrowSetupLayout ? (
            <CardDetailsPanel
              context={detailsPanelContext}
            />
          ) : null}
        </div>
      ) : mode === 'sort' ? (
        <div className="layout layout--sort">
          <div className="sortBar">
            <button
              className="btn btn--ghost"
              type="button"
              disabled={isReplaying}
              onClick={handleBackToSetupFromSort}
            >
              ← Setup
            </button>

            <div className="sortBar__meta">
              <span className="pill">{getTemplateLabel(sortConfig.type)}</span>
              {showSortStagePill ? <span className="pill pill--muted">{activeSortStageLabel}</span> : null}
              {sortConfig.type === 'closed' ? (
                <span className="pill pill--muted">
                  {remainingClosedSourceCount === 0
                    ? 'All cards placed'
                    : `${remainingClosedSourceCount} of ${cards.length} cards left`}
                </span>
              ) : (
                <span className="pill pill--muted">{countLabel(cards.length, 'card')}</span>
              )}
              <span className="pill pill--rec sortBar__recIndicator">Recording · {countLabel(sortMoveCount, 'action')}</span>
            </div>

            <div className="sortBar__meta">
              <button
                className="btn btn--ghost btn--tiny"
                type="button"
                disabled={isReplaying || !canEndSorting}
                aria-describedby={sortCompletionHint ? 'sort-completion-hint' : undefined}
                onClick={sortConfig.type === 'qsort' && hasNextWorkflowStage ? handleAdvanceSortStage : endSorting}
              >
                {sortConfig.type === 'qsort' && hasNextWorkflowStage ? 'Next stage →' : 'End sorting →'}
              </button>
              {sortCompletionHint ? (
                <span className="pill pill--muted" id="sort-completion-hint" role="status">
                  {sortCompletionHint}
                </span>
              ) : null}
            </div>
          </div>

          <main className="main">
            <Board
              mode={mode}
              sortConfig={sortConfig}
              cards={hasWidgetWorkflow ? stageVisibleCards : cards}
              stackBadges={stackBadges}
              surfaceScene={boardSurfaceScene}
              baseCardWidth={cardWidth}
              cardLayoutMode={cardLayoutMode}
              boardRef={boardRef}
              dragEnabled={boardDragEnabled}
              onBringToFront={bringToFront}
              onMoveEnd={handleMoveEnd}
              onStackDragStart={handleStackDragStart}
              onStackDragMove={handleStackDragMove}
              onStackDragEnd={handleStackDragEnd}
              onDragTraceStart={handleDragTraceStart}
              onDragTraceSample={handleDragTraceSample}
              onOpenPreview={openVideoPreview}
              onFilesAdded={addLocalMedia}
            />
          </main>
        </div>
      ) : (
        <div className="layout layout--sort layout--replay">
          <div className="sortBar">
            <button className="btn btn--ghost" type="button" disabled={isReplaying} onClick={startSortingWorkflow}>
              ← Start another sort
            </button>

            <div className="sortBar__meta">
              <span className="pill">Replay</span>
              {activeProject ? <span className="pill pill--muted">{activeProject.name}</span> : null}
              {replayRecording ? <span className="pill pill--muted">{countLabel(replayRecording.segments.length, 'recorded action')}</span> : null}
              {isReplaying ? <span className="pill pill--muted">Playing</span> : <span className="pill pill--muted">Paused</span>}
            </div>

            <div className="sortBar__meta">
              <button
                className="btn btn--ghost"
                type="button"
                disabled={replayActivityMarkers.length === 0}
                onClick={() => {
                  const prev = replayActivityMarkers.filter((marker) => marker.t < replayTimeMs).at(-1) || replayActivityMarkers.at(-1);
                  if (!prev) return;
                  pauseReplay();
                  setReplayTimeMs(prev.t);
                }}
                title="Previous activity peak"
              >
                ◀ Activity
              </button>

              <button
                className="btn btn--ghost"
                type="button"
                disabled={replayActivityMarkers.length === 0}
                onClick={() => {
                  const next = replayActivityMarkers.find((marker) => marker.t > replayTimeMs) || replayActivityMarkers[0];
                  if (!next) return;
                  pauseReplay();
                  setReplayTimeMs(next.t);
                }}
                title="Next activity peak"
              >
                Activity ▶
              </button>

              {isReplaying ? (
                <button className="btn" type="button" onClick={pauseReplay}>
                  Pause
                </button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  disabled={!replayRecording || replayRecording.segments.length === 0}
                  onClick={startReplay}
                >
                  Play
                </button>
              )}

              <button className="btn btn--ghost" type="button" disabled={!replayRecording} onClick={stopReplay}>
                Reset to start
              </button>
            </div>

          </div>

          <main className="main main--replay">
            <section className="replayStage">
              <div className="replayTimelineBar">
                {replayRecording && replayIndex ? (
                  <ReplayTimeline
                    recordingSession={replayRecording}
                    durationMs={replayIndex.durationMs}
                    timeMs={replayTimeMs}
                    clusterMarkers={replayClusterMarkers}
                    onTimeChange={(t) => {
                      pauseReplay();
                      setReplayTimeMs(t);
                    }}
                  />
                ) : (
                  <div className="hint">This session has no recorded actions.</div>
                )}

                <div className="replayTimeLabel">{formatTimeMs(replayTimeMs)}</div>
              </div>
              <div className="replayBoard">
                <Board
                  mode="end"
                  sortConfig={replayRecording?.sortConfig || sortConfig}
                  cards={replayVisibleCards}
                  surfaceScene={replaySurfaceScene}
                  baseCardWidth={replayRecording?.cardW || cardWidth}
                  cardLayoutMode={replayRecording?.cardLayoutModeAtStart || cardLayoutMode}
                  boardRef={boardRef}
                  dragEnabled={false}
                  onBringToFront={ignoreReplayInteraction}
                  onMoveEnd={ignoreReplayInteraction}
                  onFilesAdded={ignoreReplayInteraction}
                />
              </div>
            </section>

            <aside className="panel panel--sessions" aria-label="Replay sessions">
              <div className="panel--sessions__header">
                <div className="sectionTitle">Sessions</div>
                <div className="hint">Select a session to view its replay.</div>
              </div>
              <div className="replaySessionList" data-testid="replay-sessions">
                {sessions.length === 0 ? (
                  <div className="hint">Finish a sort to create a replay.</div>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`btn btn--ghost btn--tiny ${replayRecording?.createdAt === s.id ? 'isActive' : ''}`}
                      aria-pressed={replayRecording?.createdAt === s.id}
                      onClick={() => void selectSession(s.id)}
                      title={s.id}
                    >
                      <span className="replaySession__date">{new Date(s.id).toLocaleString()}</span>
                      <span className="replaySession__meta">
                        {getTemplateLabel(s.recording.sortConfig.type)} · {countLabel(s.recording.segments.length, 'action')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          </main>
        </div>
      )}
      {previewCard ? <VideoPreviewDialog card={previewCard} onClose={closeVideoPreview} /> : null}
    </div>
  );
}
