import { buildReplayIndex, replayCardsAt } from '../replayIndex';
import { createQSortWorkflow, WIDGET_ZONE_CONTENT } from '../workflow';
import type { CardData, RecordingSession } from '../types';

export interface StudyDefinition {
  version: 1;
  taskLanguage?: 'de';
  id: string;
  title: string;
  introduction: string;
  reference: string;
  credits: string;
  anchors?: { disagree: string; undecided: string; agree: string };
  preSort?: { labels: [string, string] };
  discussionQuestions?: string[];
  comparisonQuestions?: string[];
  scale: Array<{ value: number; label: string; capacity: number }>;
  rounds: Array<{ id: string; title: string; prompt: string }>;
}

export interface StudyRoundRecording {
  id: string;
  title: string;
  prompt: string;
  completedAt?: string;
  reflection?: string;
  comparisonNotes?: string;
  design?: StudyDefinition;
}

export function normalizeStudy(value: unknown): StudyDefinition | undefined {
  if (value == null) return undefined;
  const v = value as StudyDefinition;
  if (v.version !== 1 || (v.taskLanguage !== undefined && v.taskLanguage !== 'de') || !v.id || !v.title || typeof v.introduction !== 'string' ||
      typeof v.reference !== 'string' || typeof v.credits !== 'string' ||
      !Array.isArray(v.scale) || v.scale.length < 3 || v.scale.length > 15 ||
      !Array.isArray(v.rounds) || v.rounds.length < 1 ||
      new Set(v.rounds.map(r => r.id)).size !== v.rounds.length ||
      new Set(v.scale.map(s => s.value)).size !== v.scale.length ||
      v.rounds.some(r => !r.id || !r.title || !r.prompt || [r.id, r.title, r.prompt].some(x => typeof x !== 'string')) ||
      v.scale.some(s => !Number.isFinite(s.value) || typeof s.label !== 'string' || !Number.isInteger(s.capacity) || s.capacity < 0) ||
      (v.anchors !== undefined && ['disagree', 'undecided', 'agree'].some(k => typeof v.anchors?.[k as keyof NonNullable<StudyDefinition['anchors']>] !== 'string')) ||
      (v.preSort !== undefined && (!Array.isArray(v.preSort.labels) || v.preSort.labels.length !== 2 || v.preSort.labels.some(s => typeof s !== 'string' || !s.trim()))) ||
      [v.discussionQuestions, v.comparisonQuestions].some(q => q !== undefined && (!Array.isArray(q) || q.some(s => typeof s !== 'string')))) {
    throw new Error('Invalid guided study configuration.');
  }
  return { version: 1, ...(v.taskLanguage ? { taskLanguage: v.taskLanguage } : {}), id: v.id, title: v.title, introduction: v.introduction, reference: v.reference,
    credits: v.credits, scale: v.scale.map(s => ({ value: s.value, label: s.label, capacity: s.capacity })),
    ...(v.anchors ? { anchors: { ...v.anchors } } : {}),
    ...(v.preSort ? { preSort: { labels: [...v.preSort.labels] as [string, string] } } : {}),
    ...(v.discussionQuestions ? { discussionQuestions: [...v.discussionQuestions] } : {}),
    ...(v.comparisonQuestions ? { comparisonQuestions: [...v.comparisonQuestions] } : {}),
    rounds: v.rounds.map(r => ({ id: r.id, title: r.title, prompt: r.prompt })) };
}

export function normalizeStudyRound(value: unknown): StudyRoundRecording | undefined {
  if (value == null) return undefined;
  const v = value as StudyRoundRecording;
  if (!v.id || !v.title || !v.prompt || [v.id, v.title, v.prompt].some(x => typeof x !== 'string') ||
      (v.completedAt !== undefined && !Number.isFinite(Date.parse(v.completedAt))) ||
      (v.reflection !== undefined && typeof v.reflection !== 'string') ||
      (v.comparisonNotes !== undefined && typeof v.comparisonNotes !== 'string')) throw new Error('Invalid study round.');
  return { id: v.id, title: v.title, prompt: v.prompt, completedAt: v.completedAt, reflection: v.reflection, comparisonNotes: v.comparisonNotes,
    ...(v.design ? { design: normalizeStudy(v.design) } : {}) };
}

export function studyRecordings(study: StudyDefinition, sessions: Array<{ recording: RecordingSession }>) {
  return study.rounds.map(round => sessions.map(s => s.recording)
    .filter(r => r.studyRound?.id === round.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
}

export function prepareStudyRound(study: StudyDefinition, cards: CardData[], width: number, height: number,
  random: () => number = Math.random) {
  if (study.scale.reduce((sum, s) => sum + s.capacity, 0) !== cards.length) {
    throw new Error('The study must have exactly one place for every card.');
  }
  const original = cards.map(c => c.id).join(',');
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // A fresh round must never accidentally retain the previous tray order.
  if (shuffled.length > 1 && shuffled.map(c => c.id).join(',') === original) shuffled.push(shuffled.shift()!);
  const workflow = createQSortWorkflow(width, height, cards.length);
  const stage = workflow.stages.find(s => s.kind === 'qsort')!;
  stage.order = study.preSort ? 1 : 0;
  const widget = workflow.widgets.find(w => w.kind === 'qsort')!;
  if (widget.kind !== 'qsort') throw new Error('Missing Q-Sort grid.');
  widget.title = 'Q-Sort';
  const preSort = workflow.widgets.find(w => w.kind === 'pre-sort')!;
  if (study.preSort && preSort.kind === 'pre-sort') {
    preSort.zones = preSort.zones.map((zone, i) => ({ ...zone, label: study.preSort!.labels[i] })) as typeof preSort.zones;
    widget.lanes = preSort.zones.map(z => ({ ...z }));
  } else widget.lanes = [{ id: 'images', label: study.taskLanguage === 'de' ? 'Karten zum Einordnen' : 'Cards to place' }];
  widget.buckets = study.scale.map((s, i) => ({ id: `score-${i}`, label: s.label, capacity: s.capacity }));
  if (!study.preSort) { workflow.stages = [stage]; workflow.widgets = [widget]; }
  const firstStage = workflow.stages[0];
  const firstWidget = study.preSort ? workflow.widgets.find(w => w.kind === 'source')! : widget;
  return { workflow, activeStageId: firstStage.id, cards: shuffled.map((card, order) => ({
    ...card, z: order + 1, stackId: undefined, stackOrder: undefined,
    widgetAssignments: { [firstStage.id]: { widgetId: firstWidget.id, zoneId: study.preSort ? WIDGET_ZONE_CONTENT : 'images', order } },
  })) };
}

export function studyDistribution(study: StudyDefinition, recording: RecordingSession) {
  const scale = recording.studyRound?.design?.scale || study.scale;
  const index = buildReplayIndex(recording);
  const final = replayCardsAt(recording, index, Math.max(1, index.durationMs + 1));
  const widget = recording.workflowAtStart.widgets.find(w => w.kind === 'qsort');
  return scale.map((position, i) => ({ ...position, cardIds: widget?.kind === 'qsort' ? final
    .filter(card => {
      const assignment = card.widgetAssignments?.[widget.stageId];
      return assignment?.widgetId === widget.id && assignment.zoneId === widget.buckets[i]?.id;
    })
    .sort((a, b) => (a.widgetAssignments?.[widget.stageId]?.order ?? 0) - (b.widgetAssignments?.[widget.stageId]?.order ?? 0))
    .map(card => card.id) : [] }));
}

export function studyScores(study: StudyDefinition, recording: RecordingSession): Map<string, number> {
  return new Map(studyDistribution(study, recording).flatMap(position => position.cardIds.map(id => [id, position.value] as const)));
}

export function studyResultsCsv(study: StudyDefinition, recordings: RecordingSession[]) {
  const completed = study.rounds.map(round => recordings.find(r => r.studyRound?.id === round.id && r.studyRound.completedAt));
  const scores = completed.map(r => r ? studyScores(study, r) : new Map<string, number>());
  const cards = completed.find(Boolean)?.cardsAtStart || [];
  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [['image_id', 'image_number', ...study.rounds.map(r => r.title)],
    ...[...cards].sort((a, b) => a.meta.name.localeCompare(b.meta.name)).map(c =>
      [c.id, c.meta.name, ...scores.map(s => s.get(c.id) ?? '')])].map(row => row.map(quote).join(',')).join('\r\n');
}

const journalKey = (projectId: string) => `sortboard.pending-study.v1:${projectId}`;
export function journalStudyRecording(projectId: string, recording: RecordingSession) {
  try {
    sessionStorage.setItem(journalKey(projectId), JSON.stringify({ ...recording,
      cardsAtStart: recording.cardsAtStart.map(c => ({ ...c, src: undefined, posterSrc: undefined })) }));
  } catch { /* The regular IndexedDB checkpoint remains active. */ }
}
export function readStudyJournal(projectId: string): RecordingSession | null {
  try {
    const raw = sessionStorage.getItem(journalKey(projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as RecordingSession;
    return value.version === 5 && value.studyRound && Array.isArray(value.cardsAtStart) && Array.isArray(value.segments) ? value : null;
  } catch { return null; }
}
export function clearStudyJournal(projectId: string, saved?: RecordingSession) {
  try {
    const pending = readStudyJournal(projectId);
    if (!saved || (pending?.createdAt === saved.createdAt && JSON.stringify(pending) === JSON.stringify({ ...saved,
      cardsAtStart: saved.cardsAtStart.map(c => ({ ...c, src: undefined, posterSrc: undefined })) }))) sessionStorage.removeItem(journalKey(projectId));
  } catch { /* Storage may be unavailable. */ }
}
