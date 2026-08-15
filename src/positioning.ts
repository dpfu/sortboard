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
