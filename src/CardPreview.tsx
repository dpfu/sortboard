import * as React from 'react';
import type { CardData } from './types';
import { formatDurationLabel } from './media';

export interface CardPreviewProps {
  card: CardData;
  className?: string;
  onOpenPreview?: (cardId: string) => void;
  showPreviewButton?: boolean;
}

export function CardPreview({ card, className = '', onOpenPreview, showPreviewButton = true }: CardPreviewProps) {
  const durationLabel = React.useMemo(() => formatDurationLabel(card.meta.durationSec), [card.meta.durationSec]);
  const isVideo = card.kind === 'video';
  const isImage = card.kind === 'image';
  const isText = card.kind === 'text';
  const previewLabel = card.meta.name || 'video';

  return (
    <div className={`cardPreview ${isText ? 'cardPreview--text' : ''} ${isVideo ? 'cardPreview--video' : ''} ${className}`.trim()}>
      {isImage && card.src ? <img className="cardPreview__img" src={card.src} alt="" decoding="async" draggable={false} /> : null}

      {isVideo ? (
        <>
          {card.posterSrc ? (
            <img className="cardPreview__img cardPreview__img--video" src={card.posterSrc} alt="" decoding="async" draggable={false} />
          ) : (
            <div className="cardPreview__videoFallback" aria-hidden>
              <span>{card.meta.name || 'Video'}</span>
            </div>
          )}
          <div className="cardPreview__videoShade" aria-hidden />
          <div className="cardPreview__videoMeta" aria-hidden>
            <span className="cardPreview__pill">Video</span>
            {durationLabel ? <span className="cardPreview__pill">{durationLabel}</span> : null}
          </div>
          {onOpenPreview && showPreviewButton ? (
            <button
              className="cardPreview__previewBtn"
              type="button"
              aria-label={`Preview ${previewLabel}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenPreview(card.id);
              }}
            >
              <span className="cardPreview__previewGlyph" aria-hidden>
                ▶
              </span>
            </button>
          ) : null}
        </>
      ) : null}

      {isText ? (
        <div className={`cardPreview__text cardPreview__text--${card.meta.color || 'slate'}`}>
          <span>{card.meta.frontText || card.meta.name}</span>
        </div>
      ) : null}
    </div>
  );
}
