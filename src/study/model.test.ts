import { describe, it, expect } from 'vitest';
import { createTestProject } from '../testFixtures/project';
import { testStudy } from '../testFixtures/study';
import { normalizeStudy, normalizeStudyRound, prepareStudyRound, studyRecordings, studyScores } from './model';
import type { CardData, RecordingSession } from '../types';
import { buildStageSurfaceScene, reflowCardsForStage, getQSortCardDisplayDimensions } from '../stageSurface';

describe('guided study data', () => {
  it('fits the new study board without moving the layout used by earlier recordings', () => {
    const prepared = prepareStudyRound(testStudy, createTestProject().board.cards.slice(0, 12) as CardData[], 1280, 800);
    const scene = (version: 3 | 4) => buildStageSurfaceScene(prepared.workflow, prepared.activeStageId, prepared.cards, null, 'sort', { width:1280, height:800 }, null, version);
    const old = scene(3);
    const surface = scene(4).surfaces.find(s => s.kind === 'qsort-stage')!;
    expect(surface.kind).toBe('qsort-stage');
    if (surface.kind !== 'qsort-stage') throw new Error('Missing grid');
    expect(surface.promptRect!.y).toBeGreaterThanOrEqual(surface.lanes[0].y + surface.lanes[0].h);
    expect(surface.buckets[0].y).toBeGreaterThanOrEqual(surface.promptRect!.y + surface.promptRect!.h);
    expect(surface.buckets.flatMap(b => b.slots)).toHaveLength(12);
    expect(surface.buckets.every(b => b.slots.every(s => s.y + s.h <= 800))).toBe(true);
    const bounds = (card: CardData) => ({ x:card.x, y:card.y, w:200, h:140 });
    const cards = reflowCardsForStage(prepared.cards, prepared.workflow, prepared.activeStageId, bounds, { width:1280, height:800 }, 'sort', 4);
    expect(cards.every(card => {
      const dims = getQSortCardDisplayDimensions(card, surface, () => bounds(card));
      return card.y >= surface.lanes[0].y && card.y + dims.h <= surface.lanes[0].y + surface.lanes[0].h;
    })).toBe(true);
    expect(scene(3)).toEqual(old);
  });
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
