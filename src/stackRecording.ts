import type { CardData, StackData, StackKeyframe } from './types';
import { getCardDimensions } from './cardLayout';
import type { CardLayoutMode } from './types';

export function stackFrame(cards: CardData[], stacks: StackData[], tMs: number): StackKeyframe {
  return { tMs, stacks: stacks.map(stack => ({ ...stack })), cards: cards.map(({ id, stackId, stackOrder, z }) => ({ id, stackId, stackOrder, z })) };
}

export function stackFrameAt(track: StackKeyframe[] | undefined, tMs: number) {
  let found: StackKeyframe | undefined;
  for (const frame of track || []) {
    if (frame.tMs > tMs) break;
    found = frame;
  }
  return found;
}

export function applyStackFrame(cards: CardData[], frame?: StackKeyframe) {
  if (!frame) return cards;
  const byId = new Map(frame.cards.map(card => [card.id, card]));
  return cards.map(card => {
    const entry = byId.get(card.id);
    return entry ? { ...card, stackId: entry.stackId, stackOrder: entry.stackOrder, z: entry.z } : card;
  });
}

export function buildStackBadges(cards: CardData[], stacks: StackData[], width: number, layout: CardLayoutMode, selectedId?: string | null) {
  return stacks.flatMap(stack => {
    const members = cards.filter(card => card.stackId === stack.id);
    if (members.length < 2) return [];
    const x = Math.min(...members.map(card => card.x)) - 14;
    const y = Math.min(...members.map(card => card.y)) - 14;
    const right = Math.max(...members.map(card => card.x + getCardDimensions(card, layout, width).w));
    const bottom = Math.max(...members.map(card => card.y + getCardDimensions(card, layout, width).h));
    return [{ stackId: stack.id, name: stack.name, count: members.length, x, y,
      width: right - x + 14, height: bottom - y + 14,
      z: Math.max(...members.map(card => card.z)) + 1, isSelected: selectedId === stack.id }];
  });
}
