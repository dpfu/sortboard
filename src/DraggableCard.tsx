import * as React from 'react';
import { motion, useDragControls, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import type { CardData, Mode } from './types';
import { clamp } from './utils';
import { CardPreview } from './CardPreview';

const ROTATION_MAX = 2; // degrees
const RESIZE_EDGE_BAND_PX = 12;
const RESIZE_EDGE_BAND_MIN_PX = 6;

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeStartPayload {
  pointerId: number;
  clientX: number;
  clientY: number;
  edge: ResizeEdge;
}

function detectResizeEdge(localX: number, localY: number, width: number, height: number): ResizeEdge | null {
  if (width <= 0 || height <= 0) return null;
  const edgeBand = Math.max(
    RESIZE_EDGE_BAND_MIN_PX,
    Math.min(RESIZE_EDGE_BAND_PX, Math.floor(Math.min(width, height) / 4))
  );
  const nearLeft = localX <= edgeBand;
  const nearRight = localX >= width - edgeBand;
  const nearTop = localY <= edgeBand;
  const nearBottom = localY >= height - edgeBand;

  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop) return 'n';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  if (nearRight) return 'e';
  return null;
}

export interface DraggableCardProps {
  card: CardData;
  cardW: number;
  cardH: number;
  mode: Mode;
  isSelected?: boolean;
  dragEnabled: boolean;
  dragConstraintsRef: React.RefObject<HTMLElement>;
  onBringToFront: (id: string) => void;
  onMoveEnd: (id: string, newX: number, newY: number) => void;
  onResizeStart?: (id: string, pointer: ResizeStartPayload) => void;
  onSelectCard?: (id: string, options?: { toggle?: boolean }) => void;
  onKeyboardMove?: (id: string, direction: 'left' | 'right' | 'up' | 'down') => void;
  keyboardDescriptionId?: string;
  locationLabel?: string;
  onDragTraceStart?: (id: string, x: number, y: number) => void;
  onDragTraceSample?: (id: string, x: number, y: number) => void;
  onOpenPreview?: (id: string) => void;
  showChrome?: boolean;
}

function DraggableCardComponent({
  card,
  cardW,
  cardH,
  mode,
  isSelected,
  dragEnabled,
  dragConstraintsRef,
  onBringToFront,
  onMoveEnd,
  onResizeStart,
  onSelectCard,
  onKeyboardMove,
  keyboardDescriptionId,
  locationLabel,
  onDragTraceStart,
  onDragTraceSample,
  onOpenPreview,
  showChrome,
}: DraggableCardProps) {
  const rawRotate = useMotionValue(0);
  const springRotate = useSpring(rawRotate, { stiffness: 800, damping: 55 });
  const prefersReducedMotion = useReducedMotion();
  const rotate = prefersReducedMotion ? rawRotate : springRotate;
  const dragControls = useDragControls();
  const canResize = mode === 'setup' && !!isSelected && !!onResizeStart;
  const [resizeHotEdge, setResizeHotEdge] = React.useState<ResizeEdge | null>(null);
  const isKeyboardInteractive = mode === 'setup' ? !!onSelectCard : mode === 'sort' && !!onKeyboardMove;
  const cardLabel = card.meta.name || card.meta.frontText || `${card.kind} card`;
  React.useEffect(() => {
    if (!canResize) {
      setResizeHotEdge(null);
    }
  }, [canResize]);

  const getResizeEdgeFromEvent = React.useCallback(
    (e: React.PointerEvent) => {
      if (!canResize) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      return detectResizeEdge(localX, localY, rect.width, rect.height);
    },
    [canResize]
  );

  const updateResizeHotEdge = React.useCallback(
    (e: React.PointerEvent) => {
      const next = getResizeEdgeFromEvent(e);
      setResizeHotEdge((prev) => (prev === next ? prev : next));
    },
    [getResizeEdgeFromEvent]
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const resizeEdge = !e.shiftKey ? getResizeEdgeFromEvent(e) : null;
      if (resizeEdge) {
        e.preventDefault();
        e.stopPropagation();
        const native = e.nativeEvent as PointerEvent & { stopImmediatePropagation?: () => void };
        native.stopImmediatePropagation?.();
        onBringToFront(card.id);
        onResizeStart?.(card.id, {
          pointerId: e.pointerId,
          clientX: e.clientX,
          clientY: e.clientY,
          edge: resizeEdge,
        });
        return;
      }
      // Keep default focus behavior, but lift card to top.
      // (Avoid preventDefault here; it can interfere with pointer capture in some browsers.)
      if (e.shiftKey) {
        onSelectCard?.(card.id, { toggle: true });
      } else if (!isSelected) {
        onSelectCard?.(card.id, { toggle: false });
      }
      onBringToFront(card.id);
      if (!dragEnabled) return;
      if (e.button !== 0) return;
      if (e.shiftKey) return;
      dragControls.start(e);
    },
    [card.id, dragControls, dragEnabled, getResizeEdgeFromEvent, isSelected, onBringToFront, onResizeStart, onSelectCard]
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Let nested controls, such as the video preview button, handle their own keys.
      if (event.target !== event.currentTarget) return;

      if (mode === 'setup' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onSelectCard?.(card.id, { toggle: event.shiftKey });
        onBringToFront(card.id);
        return;
      }

      if (mode !== 'sort' || !onKeyboardMove) return;
      const direction =
        event.key === 'ArrowLeft'
          ? 'left'
          : event.key === 'ArrowRight'
            ? 'right'
            : event.key === 'ArrowUp'
              ? 'up'
              : event.key === 'ArrowDown'
                ? 'down'
                : null;
      if (!direction) return;
      event.preventDefault();
      onKeyboardMove(card.id, direction);
    },
    [card.id, mode, onBringToFront, onKeyboardMove, onSelectCard]
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== 'setup' || !onSelectCard) return;
      // Pointer activation already ran through onPointerDown. A zero-detail click
      // is the synthetic activation exposed by assistive technology.
      if (event.detail !== 0) return;
      onSelectCard(card.id, { toggle: event.shiftKey });
      onBringToFront(card.id);
    },
    [card.id, mode, onBringToFront, onSelectCard]
  );

  return (
    <motion.div
      className={`card ${mode === 'setup' ? 'card--setup' : 'card--sort'} ${dragEnabled ? 'card--draggable' : 'card--static'} ${isSelected ? 'isSelected' : ''} ${
        resizeHotEdge && canResize ? 'isResizeHot' : ''
      } ${
        resizeHotEdge && canResize ? `isResizeHot--${resizeHotEdge}` : ''
      }`}
      data-testid={`card-${card.id}`}
      role={mode === 'setup' && isKeyboardInteractive ? 'button' : mode === 'sort' && isKeyboardInteractive ? 'group' : undefined}
      aria-roledescription={mode === 'sort' && isKeyboardInteractive ? 'movable card' : undefined}
      tabIndex={isKeyboardInteractive ? 0 : -1}
      aria-label={`Card: ${cardLabel}${locationLabel ? `. Current area: ${locationLabel}` : ''}`}
      aria-describedby={isKeyboardInteractive ? keyboardDescriptionId : undefined}
      aria-pressed={mode === 'setup' ? !!isSelected : undefined}
      style={{ zIndex: card.z, rotate, width: cardW, height: cardH }}
      drag={dragEnabled}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={dragConstraintsRef}
      dragMomentum={false}
      dragElastic={0.10}
      // State-driven position. While dragging, Framer temporarily takes over.
      animate={{ x: card.x, y: card.y }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
      whileDrag={{ scale: 1.03, boxShadow: 'var(--shadow-lift)' }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerMove={updateResizeHotEdge}
      onPointerEnter={updateResizeHotEdge}
      onPointerLeave={() => setResizeHotEdge(null)}
      onPointerCancel={() => setResizeHotEdge(null)}
      onDrag={(e, info) => {
        void e;
        // Very subtle rotation driven by recent horizontal movement.
        const next = prefersReducedMotion ? 0 : clamp(info.delta.x * 0.35, -ROTATION_MAX, ROTATION_MAX);
        rawRotate.set(next);

        onDragTraceSample?.(card.id, card.x + info.offset.x, card.y + info.offset.y);
      }}
      onDragStart={() => {
        rawRotate.set(0);
        onDragTraceStart?.(card.id, card.x, card.y);
      }}
      onDragEnd={(e, info) => {
        void e;
        rawRotate.set(0);
        const nextX = card.x + info.offset.x;
        const nextY = card.y + info.offset.y;
        onMoveEnd(card.id, nextX, nextY);
      }}
      onDoubleClick={() => {
        if (card.kind === 'video') {
          onOpenPreview?.(card.id);
        }
      }}
    >
      <div className="card__surface">
        <CardPreview card={card} onOpenPreview={onOpenPreview} showPreviewButton={mode !== 'setup'} />

        {showChrome && mode === 'setup' ? (
          <div className="card__chrome">
            <div className="card__meta">
              <span className="card__tag">{card.meta.name}</span>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

export const DraggableCard = React.memo(DraggableCardComponent);
DraggableCard.displayName = 'DraggableCard';
