import { describe, it, expect } from 'vitest';
import { createTestProject } from '../testFixtures/project';
import { testStudy } from '../testFixtures/study';
import { normalizeStudy, normalizeStudyRound, prepareStudyRound, studyRecordings, studyScores } from './model';
import type { CardData, RecordingSession } from '../types';

describe('guided study data', () => {
  it('preserves German task language and comparison notes without changing English studies', () => {
    expect(normalizeStudy({ ...testStudy, taskLanguage: 'de' })?.taskLanguage).toBe('de');
    expect(normalizeStudy(testStudy)?.taskLanguage).toBeUndefined();
    const round = { ...testStudy.rounds[1], comparisonNotes: 'Wichtigkeit ist nicht gleich Handlungsmöglichkeit.' };
    expect(normalizeStudyRound(round)?.comparisonNotes).toBe(round.comparisonNotes);
    expect(() => normalizeStudyRound({ ...round, comparisonNotes: [] })).toThrow('Invalid study round');
  });
  it('clears assignments and reshuffles the same identities without modifying the preceding sort', () => {
    const cards = createTestProject().board.cards.slice(0, 12) as CardData[];
    const first = prepareStudyRound(testStudy, cards, 1280, 800, () => .5);
    const before = JSON.stringify(first);
    const second = prepareStudyRound(testStudy, first.cards, 1280, 800, () => .999);
    expect(JSON.stringify(first)).toBe(before);
    expect(second.cards.map(c => c.id).sort()).toEqual(first.cards.map(c => c.id).sort());
    expect(second.cards.map(c => c.id)).not.toEqual(first.cards.map(c => c.id));
    expect(second.workflow.stages.map(s => s.kind)).toEqual(['qsort']);
    expect(second.cards.every(c => c.widgetAssignments?.[second.activeStageId]?.zoneId === 'images')).toBe(true);
    expect(() => prepareStudyRound(testStudy, cards.slice(1), 1280, 800)).toThrow('exactly one place');
  });
  it('rejects invalid capacity and duplicate round identifiers instead of silently changing a study', () => {
    expect(normalizeStudy(testStudy)).toEqual(testStudy);
    expect(() => normalizeStudy({ ...testStudy, rounds: [testStudy.rounds[0], testStudy.rounds[0]] })).toThrow();
    expect(() => normalizeStudy({ ...testStudy, scale: [{ value: -1, label: '-1', capacity: -1 }, ...testStudy.scale] })).toThrow();
  });
  it('uses stable card IDs and recorded bucket membership for comparison after shuffling', () => {
    const cards = createTestProject().board.cards.slice(0, 12) as CardData[];
    const prepared = prepareStudyRound(testStudy, cards, 1280, 800);
    const widget = prepared.workflow.widgets[0];
    const finalCards = prepared.cards.map(c => ({ ...c, widgetAssignments: { [prepared.activeStageId]: { widgetId: widget.id, zoneId: 'score-6', order: 0 } } }));
    const rec = { version: 5, createdAt: new Date().toISOString(), cardsAtStart: finalCards, segments: [], workflowAtStart: prepared.workflow,
      activeStageIdAtStart: prepared.activeStageId, studyRound: { ...testStudy.rounds[0], completedAt: new Date().toISOString() } } as unknown as RecordingSession;
    expect([...studyScores(testStudy, rec).values()]).toEqual(Array(12).fill(3));
    expect(studyRecordings(testStudy, [{ recording: rec }])).toEqual([rec, undefined]);
  });
});
