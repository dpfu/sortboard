import { describe, expect, it } from 'vitest';
import { buildReplayIndex, replayCardsAt } from './replayIndex';
import { buildStackBadges, stackFrame, stackFrameAt } from './stackRecording';
import type { CardData, RecordingSession } from './types';

const cards: CardData[] = [0, 1].map(index => ({
  id: `card-${index}`, kind: 'text', createdAt: index, x: index * 250, y: 0, z: index,
  meta: { name: 'Card', notes: '', tags: [] },
}));
const grouped = cards.map((card, index) => ({ ...card, stackId: 'group', stackOrder: index, x: -100, y: index * 20 }));
const group = { id: 'group', name: 'Connections', createdAt: 1 };
const recording: RecordingSession = {
  version: 5, createdAt: '2026-09-16T12:00:00Z', cardW: 200, cardH: 150, boardW: 1200, boardH: 800,
  sortConfig: { type: 'open' }, cardLayoutModeAtStart: 'as-is', workflowAtStart: { templateId: 'open', stages: [], widgets: [] },
  cardsAtStart: cards, segments: [], stackTrack: [stackFrame(cards, [], 0), stackFrame(grouped, [group], 100), stackFrame(grouped, [{ ...group, name: 'New name' }], 200)],
};

describe('recorded groups', () => {
  it('shows membership and the name at the selected time, including a rename after the last move', () => {
    const index = buildReplayIndex(recording);
    expect(index.durationMs).toBe(200);
    expect(replayCardsAt(recording, index, 0).every(card => !card.stackId)).toBe(true);
    expect(replayCardsAt(recording, index, 100).map(card => card.stackId)).toEqual(['group', 'group']);
    expect(stackFrameAt(recording.stackTrack, 150)?.stacks[0].name).toBe('Connections');
    expect(stackFrameAt(recording.stackTrack, 200)?.stacks[0].name).toBe('New name');
    expect(group.name).toBe('Connections');
  });

  it('removes dissolved groups and places labels correctly beyond the original board origin', () => {
    const badges = buildStackBadges(grouped, [group], 200, 'as-is');
    expect(badges[0].x).toBe(-114);
    expect(badges[0].count).toBe(2);
    const ungroupedRecording = { ...recording, stackTrack: [...recording.stackTrack!, stackFrame(cards, [], 300)] };
    const index = buildReplayIndex(ungroupedRecording);
    expect(replayCardsAt(ungroupedRecording, index, 300).every(card => !card.stackId)).toBe(true);
    expect(stackFrameAt(ungroupedRecording.stackTrack, 300)?.stacks).toEqual([]);
  });
});
