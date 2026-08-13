import type { CardData, StackData, StackSortKey } from './types';

const DEFAULT_STACK_STEP_PX = 6;
const DEFAULT_STACK_SPAN = 8;
const DEFAULT_STACK_DROP_THRESHOLD = 0.2;

export type PlacementResolver = (
  card: CardData,
  x: number,
  y: number,
  options?: { snap?: boolean }
) => { x: number; y: number; w: number; h: number };

export type CardBounds = { x: number; y: number; w: number; h: number };

export type StackMutationResult = {
  cards: CardData[];
  stacks: StackData[];
  stackId?: string;
};

export type DropStackTarget =
  | { type: 'stack'; stackId: string; overlapRatio: number }
  | { type: 'card'; cardId: string; overlapRatio: number }
  | null;

function stackOrderValue(card: CardData) {
  return card.stackOrder ?? Number.MAX_SAFE_INTEGER;
}

export function compareStackMembers(a: CardData, b: CardData) {
  return (
    stackOrderValue(a) - stackOrderValue(b) ||
    b.z - a.z ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function cardIndexMap(cards: CardData[]) {
  return new Map(cards.map((card, index) => [card.id, index]));
}

function normalizeCardStackFields(card: CardData, stackId?: string, stackOrder?: number): CardData {
  if (!stackId) {
    return {
      ...card,
      stackId: undefined,
      stackOrder: undefined,
    };
  }

  return {
    ...card,
    stackId,
    stackOrder,
  };
}

function sortCardsIntoSourceOrder(cards: CardData[], ids: string[]) {
  const sourceIndex = cardIndexMap(cards);
  return [...ids].sort((a, b) => (sourceIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (sourceIndex.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function stackNameSort(a: CardData, b: CardData) {
  return (
    a.meta.name.localeCompare(b.meta.name, undefined, { sensitivity: 'base' }) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function stackCreatedSort(a: CardData, b: CardData) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function fisherYates<T>(source: T[]) {
  const next = [...source];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function intersectionArea(a: CardBounds, b: CardBounds) {
  const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

function unionBounds(bounds: CardBounds[]) {
  const left = Math.min(...bounds.map((bound) => bound.x));
  const top = Math.min(...bounds.map((bound) => bound.y));
  const right = Math.max(...bounds.map((bound) => bound.x + bound.w));
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.h));
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  };
}

export function getStackCards(cards: CardData[], stackId: string) {
  return cards.filter((card) => card.stackId === stackId).sort(compareStackMembers);
}

export function getStackCount(cards: CardData[], stackId: string) {
  return cards.reduce((count, card) => (card.stackId === stackId ? count + 1 : count), 0);
}

export function getTopCardForStack(cards: CardData[], stackId: string) {
  return getStackCards(cards, stackId)[0] ?? null;
}

export function createStackName(stacks: StackData[]) {
  const names = new Set(stacks.map((stack) => stack.name));
  let counter = 1;
  while (names.has(`Stack ${counter}`)) counter += 1;
  return `Stack ${counter}`;
}

export function compactStackLayout(
  cards: CardData[],
  stackId: string,
  resolvePlacement: PlacementResolver,
  options?: {
    anchor?: { x: number; y: number };
    snap?: boolean;
    orderedIds?: string[];
    zBase?: number;
    stepPx?: number;
    span?: number;
  }
) {
  const orderedIds = options?.orderedIds;
  const orderedMembers = orderedIds
    ? orderedIds
        .map((id) => cards.find((card) => card.id === id && card.stackId === stackId))
        .filter(Boolean) as CardData[]
    : getStackCards(cards, stackId);
  if (orderedMembers.length === 0) return cards;

  const stepPx = options?.stepPx ?? DEFAULT_STACK_STEP_PX;
  const span = options?.span ?? DEFAULT_STACK_SPAN;
  const topCard = orderedMembers[0];
  const anchor = options?.anchor ?? { x: topCard.x, y: topCard.y };
  const zBase =
    options?.zBase ??
    cards.reduce((max, card) => {
      if (card.stackId === stackId) return max;
      return Math.max(max, card.z);
    }, 0);

  const nextById = new Map<string, CardData>();
  for (let index = 0; index < orderedMembers.length; index += 1) {
    const member = orderedMembers[index];
    const diagonalOffset = Math.min(index, span - 1) * stepPx + Math.floor(index / span) * 2;
    const target = resolvePlacement(member, anchor.x + diagonalOffset, anchor.y + diagonalOffset, {
      snap: options?.snap,
    });
    nextById.set(
      member.id,
      normalizeCardStackFields(
        {
          ...member,
          x: target.x,
          y: target.y,
          z: zBase + orderedMembers.length - index,
        },
        stackId,
        index
      )
    );
  }

  return cards.map((card) => nextById.get(card.id) ?? card);
}

export function dissolveSmallStacks(cards: CardData[], stacks: StackData[]): StackMutationResult {
  const countByStack = new Map<string, number>();
  for (const card of cards) {
    if (!card.stackId) continue;
    countByStack.set(card.stackId, (countByStack.get(card.stackId) ?? 0) + 1);
  }

  const dissolved = new Set<string>();
  for (const [stackId, count] of countByStack.entries()) {
    if (count < 2) dissolved.add(stackId);
  }

  if (dissolved.size === 0) {
    return { cards, stacks: stacks.filter((stack) => countByStack.get(stack.id)) };
  }

  const nextCards = cards.map((card) => (card.stackId && dissolved.has(card.stackId) ? normalizeCardStackFields(card) : card));
  return {
    cards: nextCards,
    stacks: stacks.filter((stack) => !dissolved.has(stack.id)),
  };
}

export function createStack(
  cards: CardData[],
  stacks: StackData[],
  cardIds: string[],
  stack: StackData,
  resolvePlacement: PlacementResolver,
  options?: { snap?: boolean; zBase?: number }
): StackMutationResult {
  const orderedIds = sortCardsIntoSourceOrder(cards, Array.from(new Set(cardIds))).filter((id) => cards.some((card) => card.id === id));
  if (orderedIds.length < 2) return { cards, stacks };

  const selectedCards = orderedIds
    .map((id) => cards.find((card) => card.id === id))
    .filter(Boolean) as CardData[];
  const topCard = selectedCards.sort((a, b) => b.z - a.z || a.createdAt - b.createdAt)[0];
  const anchor = topCard ? { x: topCard.x, y: topCard.y } : { x: 0, y: 0 };
  const clearedCards = cards.map((card) => (orderedIds.includes(card.id) ? normalizeCardStackFields(card, stack.id, 0) : card));
  const withStack = compactStackLayout(clearedCards, stack.id, resolvePlacement, {
    anchor,
    snap: options?.snap,
    orderedIds,
    zBase: options?.zBase,
  });

  const nextStacks = [...stacks.filter((entry) => entry.id !== stack.id), stack];
  return dissolveSmallStacks(withStack, nextStacks);
}

export function addCardsToStack(
  cards: CardData[],
  stacks: StackData[],
  stackId: string,
  cardIds: string[],
  resolvePlacement: PlacementResolver,
  options?: { snap?: boolean; zBase?: number }
): StackMutationResult {
  const targetStack = stacks.find((stack) => stack.id === stackId);
  if (!targetStack) return { cards, stacks };

  const uniqueIds = sortCardsIntoSourceOrder(cards, Array.from(new Set(cardIds))).filter((id) => cards.some((card) => card.id === id));
  if (uniqueIds.length === 0) return { cards, stacks };

  const existing = getStackCards(cards, stackId).map((card) => card.id);
  const orderedIds = [...uniqueIds.filter((id) => !existing.includes(id)), ...existing];
  const topCard = getTopCardForStack(cards, stackId);
  const anchor = topCard ? { x: topCard.x, y: topCard.y } : { x: 0, y: 0 };
  const nextCards = cards.map((card) => {
    if (!orderedIds.includes(card.id)) return card;
    return normalizeCardStackFields(card, stackId, 0);
  });

  const compacted = compactStackLayout(nextCards, stackId, resolvePlacement, {
    anchor,
    snap: options?.snap,
    orderedIds,
    zBase: options?.zBase,
  });
  return dissolveSmallStacks(compacted, stacks);
}

export function removeCardsFromStack(cards: CardData[], stacks: StackData[], cardIds: string[]): StackMutationResult {
  const ids = new Set(cardIds);
  if (ids.size === 0) return { cards, stacks };

  const affectedStackIds = new Set<string>();
  const nextCards = cards.map((card) => {
    if (!ids.has(card.id) || !card.stackId) return card;
    affectedStackIds.add(card.stackId);
    return normalizeCardStackFields(card);
  });

  let compacted = nextCards;
  for (const stackId of affectedStackIds) {
    compacted = compactStackLayout(compacted, stackId, (card, x, y) => ({ ...card, x, y, w: 0, h: 0 }), {
      orderedIds: getStackCards(compacted, stackId).map((card) => card.id),
      zBase: compacted.reduce((max, card) => (card.stackId === stackId ? max : Math.max(max, card.z)), 0),
    });
  }

  return dissolveSmallStacks(compacted, stacks);
}

export function sortStack(
  cards: CardData[],
  stacks: StackData[],
  stackId: string,
  sortKey: StackSortKey,
  resolvePlacement: PlacementResolver,
  options?: { snap?: boolean; zBase?: number }
): StackMutationResult {
  const members = getStackCards(cards, stackId);
  if (members.length < 2) return { cards, stacks };
  const topCard = members[0];
  const anchor = { x: topCard.x, y: topCard.y };
  const orderedIds = [...members]
    .sort(sortKey === 'created' ? stackCreatedSort : stackNameSort)
    .map((card) => card.id);
  return {
    cards: compactStackLayout(cards, stackId, resolvePlacement, {
      anchor,
      snap: options?.snap,
      orderedIds,
      zBase: options?.zBase,
    }),
    stacks,
  };
}

export function shuffleStack(
  cards: CardData[],
  stacks: StackData[],
  stackId: string,
  resolvePlacement: PlacementResolver,
  options?: { snap?: boolean; zBase?: number }
): StackMutationResult {
  const members = getStackCards(cards, stackId);
  if (members.length < 2) return { cards, stacks };
  const topCard = members[0];
  const anchor = { x: topCard.x, y: topCard.y };
  const shuffledIds = fisherYates(members.map((card) => card.id));
  return {
    cards: compactStackLayout(cards, stackId, resolvePlacement, {
      anchor,
      snap: options?.snap,
      orderedIds: shuffledIds,
      zBase: options?.zBase,
    }),
    stacks,
  };
}

export function splitStack(
  cards: CardData[],
  stacks: StackData[],
  stackId: string,
  nextStack: StackData,
  resolvePlacement: PlacementResolver,
  options?: { snap?: boolean; zBase?: number; splitOffset?: number }
): StackMutationResult {
  const members = getStackCards(cards, stackId);
  if (members.length < 2) return { cards, stacks };

  const splitIndex = Math.ceil(members.length / 2);
  const keepIds = members.slice(0, splitIndex).map((card) => card.id);
  const moveIds = members.slice(splitIndex).map((card) => card.id);
  const topCard = members[0];
  const splitOffset = options?.splitOffset ?? 32;
  const nextAnchor = { x: topCard.x + splitOffset, y: topCard.y + splitOffset };

  let nextCards = cards.map((card) => {
    if (keepIds.includes(card.id)) return normalizeCardStackFields(card, stackId, 0);
    if (moveIds.includes(card.id)) return normalizeCardStackFields(card, nextStack.id, 0);
    return card;
  });

  nextCards = compactStackLayout(nextCards, stackId, resolvePlacement, {
    anchor: { x: topCard.x, y: topCard.y },
    snap: options?.snap,
    orderedIds: keepIds,
    zBase: options?.zBase,
  });
  nextCards = compactStackLayout(nextCards, nextStack.id, resolvePlacement, {
    anchor: nextAnchor,
    snap: options?.snap,
    orderedIds: moveIds,
    zBase: options?.zBase != null ? options.zBase + keepIds.length : undefined,
  });

  return dissolveSmallStacks(nextCards, [...stacks, nextStack]);
}

export function findDropStackTarget(
  cards: CardData[],
  draggedCardIds: string[],
  getBounds: (card: CardData) => CardBounds,
  threshold = DEFAULT_STACK_DROP_THRESHOLD
): DropStackTarget {
  const dragged = cards.filter((card) => draggedCardIds.includes(card.id));
  if (dragged.length === 0) return null;
  const movingBounds = unionBounds(dragged.map((card) => getBounds(card)));
  const movingArea = Math.max(1, movingBounds.w * movingBounds.h);

  let best: DropStackTarget = null;

  for (const card of cards) {
    if (draggedCardIds.includes(card.id)) continue;
    const overlapArea = intersectionArea(movingBounds, getBounds(card));
    if (overlapArea <= 0) continue;
    const overlapRatio = overlapArea / movingArea;
    if (overlapRatio < threshold) continue;
    if (!best || overlapRatio > best.overlapRatio) {
      best = card.stackId
        ? { type: 'stack', stackId: card.stackId, overlapRatio }
        : { type: 'card', cardId: card.id, overlapRatio };
    }
  }

  return best;
}
