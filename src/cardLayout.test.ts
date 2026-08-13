import { describe, expect, it } from 'vitest';
import { getCardDimensions, normalizeCardLayoutMode } from './cardLayout';
import type { CardData } from './types';

const imageCard: CardData = {
  id: 'img-1',
  kind: 'image',
  createdAt: 1,
  assetId: 'asset-1',
  meta: { name: 'Image 1', notes: '', tags: [], aspectRatio: 2 },
  x: 0,
  y: 0,
  z: 1,
};

const videoCard: CardData = {
  id: 'vid-1',
  kind: 'video',
  createdAt: 2,
  assetId: 'asset-2',
  posterAssetId: 'poster-2',
  meta: { name: 'Video 1', notes: '', tags: [] },
  x: 0,
  y: 0,
  z: 2,
};

describe('cardLayout', () => {
  it('normalizes fixed-9-16 layout mode', () => {
    expect(normalizeCardLayoutMode('fixed-9-16')).toBe('fixed-9-16');
  });

  it('falls back unknown layout mode to as-is', () => {
    expect(normalizeCardLayoutMode('weird')).toBe('as-is');
  });

  it('computes fixed-9-16 portrait dimensions', () => {
    const dims = getCardDimensions(imageCard, 'fixed-9-16', 240);
    expect(dims.w).toBe(240);
    expect(dims.h).toBe(427);
  });

  it('falls back local videos without metadata to a portrait card in as-is mode', () => {
    const dims = getCardDimensions(videoCard, 'as-is', 240);
    expect(dims.w).toBe(240);
    expect(dims.h).toBe(427);
  });
});
