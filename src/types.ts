export type Mode = 'setup' | 'sort' | 'end';

export type SortTemplateId = 'open' | 'closed' | 'qsort';
export type SortType = SortTemplateId;
export type SortStageKind = 'closed-sort' | 'presort' | 'qsort';
export type BoardWidgetKind = 'source' | 'category' | 'pre-sort' | 'qsort';

export const TEXT_CARD_COLOR_KEYS = ['slate', 'sand', 'mint', 'sky', 'rose', 'amber'] as const;

export type TextCardColorKey = (typeof TEXT_CARD_COLOR_KEYS)[number];

export type CardLayoutMode = 'as-is' | 'fixed-16-9' | 'fixed-9-16';

export type CardKind = 'text' | 'image' | 'video';

export type StackSortKey = 'name' | 'created';

export type ClosedContainerKind = 'source' | 'target';

export type WidgetLayoutMode = 'stack' | 'fan';
export type ClosedContainerLayout = WidgetLayoutMode;

export type ClosedContainerCapacityMode = 'unlimited' | 'limited';

export interface CardMetadataV1 {
  name: string;
  notes: string;
  tags: string[];
  frontText?: string;
  color?: TextCardColorKey;
  aspectRatio?: number;
  durationSec?: number;
  originalFileName?: string;
}

export interface SortConfig {
  type: SortTemplateId;
  // Legacy field kept for backward compatibility with persisted boards.
  columns?: number;
}

export interface SortStageData {
  id: string;
  kind: SortStageKind;
  name: string;
  order: number;
}

export interface BoardWidgetBase {
  id: string;
  kind: BoardWidgetKind;
  stageId: string;
  title: string;
  createdAt: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface SourceWidgetData extends BoardWidgetBase {
  kind: 'source';
  layout: WidgetLayoutMode;
}

export interface CategoryWidgetData extends BoardWidgetBase {
  kind: 'category';
  description: string;
  capacityMode: ClosedContainerCapacityMode;
  capacity?: number;
  allowedTags: string[];
  layout: WidgetLayoutMode;
}

export interface PreSortZoneData {
  id: string;
  label: string;
}

export interface PreSortWidgetData extends BoardWidgetBase {
  kind: 'pre-sort';
  zones: [PreSortZoneData, PreSortZoneData];
}

export interface QSortLaneData {
  id: string;
  label: string;
}

export interface QSortBucketData {
  id: string;
  label: string;
  capacity: number;
}

export interface QSortWidgetData extends BoardWidgetBase {
  kind: 'qsort';
  lanes: QSortLaneData[];
  buckets: QSortBucketData[];
}

export type BoardWidgetData = SourceWidgetData | CategoryWidgetData | PreSortWidgetData | QSortWidgetData;

export interface SortWorkflowData {
  templateId: SortTemplateId;
  stages: SortStageData[];
  widgets: BoardWidgetData[];
}

export interface CardWidgetAssignment {
  widgetId: string;
  zoneId: string;
  order: number;
}

export type CardWidgetAssignmentsByStage = Record<string, CardWidgetAssignment | undefined>;

export interface StackData {
  id: string;
  name: string;
  createdAt: number;
}

export interface ClosedContainerBase {
  id: string;
  kind: ClosedContainerKind;
  name: string;
  createdAt: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClosedSourcePileData extends ClosedContainerBase {
  kind: 'source';
  layout: ClosedContainerLayout;
}

export interface ClosedTargetData extends ClosedContainerBase {
  kind: 'target';
  rowOrder: number;
  description: string;
  visibleInSort: boolean;
  capacityMode: ClosedContainerCapacityMode;
  capacity?: number;
  allowedTags: string[];
  layout: ClosedContainerLayout;
}

export type ClosedContainerData = ClosedSourcePileData | ClosedTargetData;

export interface CardData {
  id: string;
  kind: CardKind;
  createdAt: number;
  // Media cards are backed by a persisted assetId (blob in IndexedDB).
  // src is the runtime object URL (derived from the blob), not stable across reloads.
  assetId?: string;
  src?: string;
  // Videos may also persist a lightweight poster image asset for fast board rendering.
  posterAssetId?: string;
  posterSrc?: string;
  meta: CardMetadataV1;
  sizeScale?: number;
  stackId?: string;
  stackOrder?: number;
  widgetAssignments?: CardWidgetAssignmentsByStage;
  // Legacy closed-sort membership fields kept for migration and old recordings.
  closedContainerId?: string;
  closedContainerOrder?: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Recording: Drag Segments (plan)
 * Coordinates are in board space (same units as CardData.x/y).
 */
export type TraceSample = [tMs: number, x: number, y: number];

export interface DragGroupMember {
  cardId: string;
  from: { x: number; y: number };
  drop: { x: number; y: number };
  final: { x: number; y: number };
}

export interface StaticMoveMember {
  cardId: string;
  from: { x: number; y: number };
  final: { x: number; y: number };
}

export interface WidgetAssignmentChange {
  cardId: string;
  stageId: string;
  assignment?: CardWidgetAssignment;
}

export type DragSegment = {
  type: 'drag';
  id: string; // segment id
  cardId: string;
  t0: number; // ms since recording start
  t1: number; // ms since recording start (drop moment)
  from: { x: number; y: number };
  // keyframes during drag (throttled/decimated)
  path: TraceSample[];
  // release position (clamped)
  drop: { x: number; y: number };
  // final settled position (snapped+clamped)
  final: { x: number; y: number };
  // Additional cards moved by a stack badge drag.
  groupMembers?: DragGroupMember[];
  // Additional cards that stay in place during the drag and only settle afterwards.
  settleMembers?: StaticMoveMember[];
  widgetAssignmentChanges?: WidgetAssignmentChange[];
  // settle animation duration for replay
  settleMs?: number;
};

export type SourcePromoteSegment = {
  type: 'source-promote';
  id: string;
  cardId: string;
  t0: number;
  t1: number;
  members: StaticMoveMember[];
  settleMs?: number;
};

export type TargetCycleSegment = {
  type: 'target-cycle';
  id: string;
  containerId: string;
  t0: number;
  t1: number;
  members: StaticMoveMember[];
  settleMs?: number;
};

export type StageTransitionSegment = {
  type: 'stage-transition';
  id: string;
  fromStageId: string;
  toStageId: string;
  t0: number;
  t1: number;
  members: StaticMoveMember[];
  widgetAssignmentChanges?: WidgetAssignmentChange[];
  settleMs?: number;
};

export type RecordingSegment = DragSegment | SourcePromoteSegment | TargetCycleSegment | StageTransitionSegment;

export interface RecordingSession {
  version: 4 | 5;
  createdAt: string; // ISO
  cardW: number;
  cardH: number;
  boardW: number;
  boardH: number;
  sortConfig: SortConfig;
  cardLayoutModeAtStart?: CardLayoutMode;
  workflowAtStart?: SortWorkflowData;
  activeStageIdAtStart?: string;
  closedContainersAtStart: ClosedContainerData[];
  cardsAtStart: CardData[];
  segments: RecordingSegment[];
}
