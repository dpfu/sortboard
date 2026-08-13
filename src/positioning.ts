import { clamp } from './utils';

export function clampToBoard(
  x: number,
  y: number,
  opts: { boardW: number; boardH: number; cardW: number; cardH: number }
) {
  const { boardW, boardH, cardW, cardH } = opts;

  // If we don't know the board size yet (first render), don't clamp.
  if (boardW <= 0 || boardH <= 0) {
    return { x: Math.round(x), y: Math.round(y) };
  }

  const maxX = Math.max(0, boardW - cardW);
  const maxY = Math.max(0, boardH - cardH);
  return {
    x: clamp(Math.round(x), 0, maxX),
    y: clamp(Math.round(y), 0, maxY),
  };
}

/**
 * Closed sort: snap card to the nearest column.
 * Column choice is based on the *card center*.
 */
export function snapClosed(
  x: number,
  y: number,
  opts: { boardW: number; boardH: number; cardW: number; cardH: number; columns: number }
) {
  const cols = Math.max(1, opts.columns);
  if (opts.boardW <= 0) return clampToBoard(x, y, opts);

  const colW = opts.boardW / cols;
  const centerX = x + opts.cardW / 2;
  const colIdx = clamp(Math.floor(centerX / colW), 0, cols - 1);
  const targetX = colIdx * colW + (colW - opts.cardW) / 2;

  return clampToBoard(targetX, y, opts);
}
