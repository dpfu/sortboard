import { describe, expect, it } from 'vitest';
import { clampToBoard, snapClosed } from './positioning';

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

  it('snapClosed: snaps based on card center to the correct column', () => {
    // 3 columns on 900px board => 300px per column.
    const p0 = snapClosed(0, 20, {
      boardW: 900,
      boardH: 600,
      cardW: CARD_W,
      cardH: CARD_H,
      columns: 3,
    });
    // First column center alignment: (colW-cardW)/2 = 30
    expect(p0.x).toBe(30);

    const p2 = snapClosed(700, 20, {
      boardW: 900,
      boardH: 600,
      cardW: CARD_W,
      cardH: CARD_H,
      columns: 3,
    });
    // Third column x = 2*300 + 30 = 630
    expect(p2.x).toBe(630);
  });

  it('snapClosed: works with columns=1', () => {
    const p = snapClosed(500, 20, {
      boardW: 900,
      boardH: 600,
      cardW: CARD_W,
      cardH: CARD_H,
      columns: 1,
    });
    // single column => centered
    expect(p.x).toBe((900 - CARD_W) / 2);
  });
});
