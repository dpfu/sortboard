import type { CardData, CardLayoutMode } from './types';

export const CARD_SIZE_SCALE_MIN = 0.5;
export const CARD_SIZE_SCALE_MAX = 2;

export function fixedCardHeightFromWidth(width: number) {
  return Math.round(width * (9 / 16));
}

export function fixedPortraitCardHeightFromWidth(width: number) {
  return Math.round(width * (16 / 9));
}

export function isValidAspectRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizeCardLayoutMode(value: unknown): CardLayoutMode {
  if (value === 'fixed-16-9') return 'fixed-16-9';
  if (value === 'fixed-9-16') return 'fixed-9-16';
  return 'as-is';
}

export function normalizeCardSizeScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(CARD_SIZE_SCALE_MIN, Math.min(CARD_SIZE_SCALE_MAX, value));
}

export function getCardDimensions(card: CardData, layoutMode: CardLayoutMode, baseWidth: number) {
  const scale = normalizeCardSizeScale(card.sizeScale);
  const w = Math.max(1, Math.round(baseWidth * scale));
  if (layoutMode === 'fixed-16-9') {
    return { w, h: fixedCardHeightFromWidth(w) };
  }
  if (layoutMode === 'fixed-9-16') {
    return { w, h: fixedPortraitCardHeightFromWidth(w) };
  }
  if ((card.kind === 'image' || card.kind === 'video') && isValidAspectRatio(card.meta.aspectRatio)) {
    const h = Math.max(1, Math.round(w / card.meta.aspectRatio));
    return { w, h };
  }
  if (card.kind === 'video') {
    return { w, h: fixedPortraitCardHeightFromWidth(w) };
  }
  return { w, h: fixedCardHeightFromWidth(w) };
}

export function normalizeImageAspectRatio(value: unknown) {
  return isValidAspectRatio(value) ? value : undefined;
}
