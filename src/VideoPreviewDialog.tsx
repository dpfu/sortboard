import * as React from 'react';
import type { CardData } from './types';
import { formatDurationLabel } from './media';

export interface VideoPreviewDialogProps {
  card: CardData;
  onClose: () => void;
}

export function VideoPreviewDialog({ card, onClose }: VideoPreviewDialogProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const titleId = React.useId();
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  if (card.kind !== 'video') return null;

  const durationLabel = formatDurationLabel(card.meta.durationSec);
  const aspectLabel =
    typeof card.meta.aspectRatio === 'number' && Number.isFinite(card.meta.aspectRatio)
      ? `${card.meta.aspectRatio.toFixed(2)}:1`
      : '';

  return (
    <div
      className="videoDialog"
      data-testid="video-preview-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button className="videoDialog__backdrop" type="button" tabIndex={-1} aria-label="Close preview" onClick={onClose} />
      <div className="videoDialog__panel" ref={panelRef}>
        <div className="videoDialog__header">
          <div>
            <div className="videoDialog__title" id={titleId}>{card.meta.name || 'Untitled video'}</div>
            <div className="videoDialog__sub">
              <span className="pill pill--muted">Local video</span>
              {durationLabel ? <span className="pill pill--muted">{durationLabel}</span> : null}
              {aspectLabel ? <span className="pill pill--muted">{aspectLabel}</span> : null}
            </div>
          </div>
          <button ref={closeButtonRef} className="btn btn--ghost btn--tiny" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="videoDialog__body">
          {card.src ? (
            <video
              className="videoDialog__player"
              data-testid="video-preview-player"
              src={card.src}
              poster={card.posterSrc}
              controls
              playsInline
              autoPlay
              preload="metadata"
            />
          ) : (
            <div className="videoDialog__empty">This video file is unavailable.</div>
          )}
        </div>

        {card.meta.notes || card.meta.tags.length > 0 || card.meta.originalFileName ? (
          <div className="videoDialog__footer">
            {card.meta.originalFileName ? (
              <div className="videoDialog__metaRow">
                <span>File</span>
                <span>{card.meta.originalFileName}</span>
              </div>
            ) : null}
            {card.meta.notes ? (
              <div className="videoDialog__notes">{card.meta.notes}</div>
            ) : null}
            {card.meta.tags.length > 0 ? (
              <div className="videoDialog__tags">
                {card.meta.tags.map((tag) => (
                  <span key={tag} className="pill pill--muted">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
