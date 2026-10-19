import { buildReplayIndex, replayCardsAt } from '../replayIndex';
import { createQSortWorkflow } from '../workflow';
import type { CardData, RecordingSession } from '../types';

export interface StudyDefinition {
  version: 1;
  taskLanguage?: 'de';
  id: string;
  title: string;
  introduction: string;
  reference: string;
  credits: string;
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
}

export function normalizeStudy(value: unknown): StudyDefinition | undefined {
  if (value == null) return undefined;
  const v = value as StudyDefinition;
  if (v.version !== 1 || (v.taskLanguage !== undefined && v.taskLanguage !== 'de') || !v.id || !v.title || typeof v.introduction !== 'string' ||
      typeof v.reference !== 'string' || typeof v.credits !== 'string' ||
      !Array.isArray(v.scale) || v.scale.length < 3 || v.scale.length > 15 ||
      !Array.isArray(v.rounds) || v.rounds.length !== 2 ||
      new Set(v.rounds.map(r => r.id)).size !== v.rounds.length ||
      new Set(v.scale.map(s => s.value)).size !== v.scale.length ||
      v.rounds.some(r => !r.id || !r.title || !r.prompt || [r.id, r.title, r.prompt].some(x => typeof x !== 'string')) ||
      v.scale.some(s => !Number.isFinite(s.value) || typeof s.label !== 'string' || !Number.isInteger(s.capacity) || s.capacity < 0)) {
    throw new Error('Invalid guided study configuration.');
  }
  return { version: 1, ...(v.taskLanguage ? { taskLanguage: v.taskLanguage } : {}), id: v.id, title: v.title, introduction: v.introduction, reference: v.reference,
    credits: v.credits, scale: v.scale.map(s => ({ value: s.value, label: s.label, capacity: s.capacity })),
    rounds: v.rounds.map(r => ({ id: r.id, title: r.title, prompt: r.prompt })) };
}

export function normalizeStudyRound(value: unknown): StudyRoundRecording | undefined {
  if (value == null) return undefined;
  const v = value as StudyRoundRecording;
  if (!v.id || !v.title || !v.prompt || [v.id, v.title, v.prompt].some(x => typeof x !== 'string') ||
      (v.completedAt !== undefined && !Number.isFinite(Date.parse(v.completedAt))) ||
      (v.reflection !== undefined && typeof v.reflection !== 'string') ||
      (v.comparisonNotes !== undefined && typeof v.comparisonNotes !== 'string')) throw new Error('Invalid study round.');
  return { id: v.id, title: v.title, prompt: v.prompt, completedAt: v.completedAt, reflection: v.reflection, comparisonNotes: v.comparisonNotes };
}

export function studyRecordings(study: StudyDefinition, sessions: Array<{ recording: RecordingSession }>) {
  return study.rounds.map(round => sessions.map(s => s.recording)
    .filter(r => r.studyRound?.id === round.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
}

export function prepareStudyRound(study: StudyDefinition, cards: CardData[], width: number, height: number,
  random: () => number = Math.random) {
  if (study.scale.reduce((sum, s) => sum + s.capacity, 0) !== cards.length) {
    throw new Error('The study must have exactly one place for every image.');
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
  stage.order = 0;
  const widget = workflow.widgets.find(w => w.kind === 'qsort')!;
  if (widget.kind !== 'qsort') throw new Error('Missing Q-Sort grid.');
  widget.title = study.taskLanguage === 'de' ? 'Starke Ablehnung ← Deine Zustimmung → Starke Zustimmung' : 'Strongly disagree ← Your agreement → Strongly agree';
  widget.lanes = [{ id: 'images', label: study.taskLanguage === 'de' ? 'Bilder zum Einordnen' : 'Images to place' }];
  widget.buckets = study.scale.map((s, i) => ({ id: `score-${i}`, label: s.label, capacity: s.capacity }));
  workflow.stages = [stage];
  workflow.widgets = [widget];
  return { workflow, activeStageId: stage.id, cards: shuffled.map((card, order) => ({
    ...card, z: order + 1, stackId: undefined, stackOrder: undefined,
    widgetAssignments: { [stage.id]: { widgetId: widget.id, zoneId: 'images', order } },
  })) };
}

export function studyScores(study: StudyDefinition, recording: RecordingSession): Map<string, number> {
  const index = buildReplayIndex(recording);
  const final = replayCardsAt(recording, index, Math.max(1, index.durationMs + 1));
  const widget = recording.workflowAtStart.widgets.find(w => w.kind === 'qsort');
  const scores = new Map<string, number>();
  if (widget?.kind !== 'qsort') return scores;
  for (const card of final) {
    const assignment = card.widgetAssignments?.[widget.stageId];
    const position = widget.buckets.findIndex(b => b.id === assignment?.zoneId && assignment?.widgetId === widget.id);
    if (position >= 0 && study.scale[position]) scores.set(card.id, study.scale[position].value);
  }
  return scores;
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
