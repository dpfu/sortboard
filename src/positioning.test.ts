import { describe, expect, it } from 'vitest';
import { clampToBoard } from './positioning';

const CARD_W = 240;
const CARD_H = Math.round((CARD_W * 9) / 16);

describe('positioning', () => {
  it('clampToBoard: rounds without clamping when board size is unknown', () => {
    const p = clampToBoard(10.4, 9.6, {
      boardW: 0,
      boardH: 0,
      cardW: CARD_W,
      cardH: CARD_H,
    });
    expect(p).toEqual({ x: 10, y: 10 });
  });

  it('clampToBoard: clamps into the visible board', () => {
    const p = clampToBoard(-50, 10_000, {
      boardW: 800,
      boardH: 600,
      cardW: CARD_W,
      cardH: CARD_H,
    });

    const maxX = 800 - CARD_W;
    const maxY = 600 - CARD_H;
    expect(p.x).toBe(0);
    expect(p.y).toBe(maxY);
    expect(p.x).toBeLessThanOrEqual(maxX);
    expect(p.y).toBeLessThanOrEqual(maxY);
  });
});
