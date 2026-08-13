import * as React from 'react';
import type { CardData, CardLayoutMode, Mode, SortConfig } from './types';
import { DraggableCard, type ResizeEdge, type ResizeStartPayload } from './DraggableCard';
import { isSupportedMediaFile } from './utils';
import { getCardDimensions } from './cardLayout';
import type { StageSurfaceScene } from './stageSurface';

export interface StackBadgeView {
  stackId: string;
  name: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  isSelected?: boolean;
}

type PointerStartPayload = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

type SelectableWidgetLike = {
  widgetId: string;
  dragEnabled?: boolean;
  resizeEnabled?: boolean;
};

type KeyboardDirection = 'left' | 'right' | 'up' | 'down';

type KeyboardDropTarget = {
  key: string;
  kind: 'source' | 'sink' | 'lane' | 'bucket';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  available: boolean;
};

export interface BoardProps {
  mode: Mode;
  sortConfig: SortConfig;
  cards: CardData[];
  stackBadges?: StackBadgeView[];
  surfaceScene?: StageSurfaceScene | null;
  baseCardWidth: number;
  cardLayoutMode: CardLayoutMode;
  selectedCardIds?: string[];
  boardRef: React.RefObject<HTMLDivElement>;
  dragEnabled: boolean;
  onBringToFront: (id: string) => void;
  onMoveEnd: (id: string, newX: number, newY: number) => boolean | void;
  onResizeStart?: (id: string, pointer: ResizeStartPayload) => void;
  onSelectCard?: (id: string, options?: { toggle?: boolean }) => void;
  onSelectStack?: (stackId: string) => void;
  onSelectWidget?: (widgetId: string) => void;
  onStackDragStart?: (stackId: string, clientX: number, clientY: number) => void;
  onStackDragMove?: (stackId: string, clientX: number, clientY: number) => void;
  onStackDragEnd?: (stackId: string, clientX: number, clientY: number) => void;
  onWidgetDragStart?: (widgetId: string, pointer: PointerStartPayload) => void;
  onWidgetResizeStart?: (widgetId: string, pointer: ResizeStartPayload) => void;
  onClearSelection?: () => void;
  onLassoSelect?: (ids: string[], append: boolean) => void;
  onFilesAdded: (files: File[]) => void;
  onDragTraceStart?: (id: string, x: number, y: number) => void;
  onDragTraceSample?: (id: string, x: number, y: number) => void;
  onOpenPreview?: (id: string) => void;
}

function canvasPoint(event: React.PointerEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const scrollLeft = event.currentTarget.scrollLeft || 0;
  const scrollTop = event.currentTarget.scrollTop || 0;
  return {
    x: Math.max(0, Math.min(rect.width + scrollLeft, event.clientX - rect.left + scrollLeft)),
    y: Math.max(0, Math.min(rect.height + scrollTop, event.clientY - rect.top + scrollTop)),
  };
}

function surfaceStateClass(state?: string) {
  return state && state !== 'idle' ? `is-${state}` : '';
}

function keyboardDropTargets(scene: StageSurfaceScene | null | undefined): KeyboardDropTarget[] {
  if (!scene) return [];
  const targets: KeyboardDropTarget[] = [];
  for (const surface of scene.surfaces) {
    if (surface.kind === 'work-area') {
      targets.push({
        key: `${surface.widgetId}:content`,
        kind: 'source',
        label: surface.title,
        x: surface.x,
        y: surface.y,
        w: surface.w,
        h: surface.h,
        available: true,
      });
      continue;
    }
    if (surface.kind === 'sink') {
      targets.push({
        key: `${surface.widgetId}:${surface.zoneId}`,
        kind: 'sink',
        label: surface.title,
        x: surface.x,
        y: surface.y,
        w: surface.w,
        h: surface.h,
        // App owns tag and capacity validation; rejected moves are discarded.
        available: true,
      });
      continue;
    }
    for (const lane of surface.lanes) {
      targets.push({
        key: `${surface.widgetId}:${lane.zoneId}`,
        kind: 'lane',
        label: lane.label,
        x: lane.x,
        y: lane.y,
        w: lane.w,
        h: lane.h,
        available: true,
      });
    }
    for (const bucket of surface.buckets) {
      targets.push({
        key: `${surface.widgetId}:${bucket.zoneId}`,
        kind: 'bucket',
        label: bucket.label,
        x: bucket.x,
        y: bucket.y,
        w: bucket.w,
        h: bucket.h,
        available: bucket.count < bucket.capacity,
      });
    }
  }
  return targets;
}

function targetContainingCard(targets: KeyboardDropTarget[], card: CardData, cardW: number, cardH: number) {
  const centerX = card.x + cardW / 2;
  const centerY = card.y + cardH / 2;
  return targets.find(
    (target) =>
      centerX >= target.x &&
      centerX <= target.x + target.w &&
      centerY >= target.y &&
      centerY <= target.y + target.h
  );
}

function nextKeyboardDropTarget(
  targets: KeyboardDropTarget[],
  card: CardData,
  cardW: number,
  cardH: number,
  direction: KeyboardDirection
) {
  const current = targetContainingCard(targets, card, cardW, cardH);
  const originX = card.x + cardW / 2;
  const originY = card.y + cardH / 2;
  const candidates = targets
    .filter((target) => target.key !== current?.key && target.available)
    // In the distribution stage the lanes are source piles, not alternative
    // destinations. A card leaving a lane must enter an available bucket.
    .filter((target) => current?.kind !== 'lane' || target.kind === 'bucket')
    .map((target) => {
      const targetX = target.x + target.w / 2;
      const targetY = target.y + target.h / 2;
      const dx = targetX - originX;
      const dy = targetY - originY;
      const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
      const crossAxis = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      return { target, primary, score: primary + crossAxis * 1.75 };
    })
    .filter((candidate) => candidate.primary > 1)
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.target || null;
}

export const boardKeyboardTestUtils = {
  keyboardDropTargets,
  targetContainingCard,
  nextKeyboardDropTarget,
};

export function Board({
  mode,
  sortConfig: _sortConfig,
  cards,
  stackBadges,
  surfaceScene,
  baseCardWidth,
  cardLayoutMode,
  selectedCardIds,
  boardRef,
  dragEnabled,
  onBringToFront,
  onMoveEnd,
  onResizeStart,
  onSelectCard,
  onSelectStack,
  onSelectWidget,
  onStackDragStart,
  onStackDragMove,
  onStackDragEnd,
  onWidgetDragStart,
  onWidgetResizeStart,
  onClearSelection,
  onLassoSelect,
  onFilesAdded,
  onDragTraceStart,
  onDragTraceSample,
  onOpenPreview,
}: BoardProps) {
  const [isFileOver, setIsFileOver] = React.useState(false);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = React.useState('');
  const [lassoRect, setLassoRect] = React.useState<{ x0: number; y0: number; x1: number; y1: number; append: boolean } | null>(null);
  const lassoPointerIdRef = React.useRef<number | null>(null);
  const badgeDragRef = React.useRef<{ pointerId: number; stackId: string } | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const hasSetupSelection = mode === 'setup' && !!selectedCardIds && selectedCardIds.length > 0;
  const cardDimsById = React.useMemo(() => {
    const next = new Map<string, { w: number; h: number }>();
    for (const card of cards) {
      next.set(card.id, getCardDimensions(card, cardLayoutMode, baseCardWidth));
    }
    return next;
  }, [baseCardWidth, cardLayoutMode, cards]);
  const keyboardTargets = React.useMemo(() => keyboardDropTargets(surfaceScene), [surfaceScene]);
  const cardsRef = React.useRef(cards);
  const cardDimsByIdRef = React.useRef(cardDimsById);
  const keyboardTargetsRef = React.useRef(keyboardTargets);
  cardsRef.current = cards;
  cardDimsByIdRef.current = cardDimsById;
  keyboardTargetsRef.current = keyboardTargets;

  const getCardLocationLabel = React.useCallback(
    (card: CardData, cardW: number, cardH: number) =>
      targetContainingCard(keyboardTargets, card, cardW, cardH)?.label,
    [keyboardTargets]
  );

  const handleCardKeyboardMove = React.useCallback(
    (id: string, direction: KeyboardDirection) => {
      if (mode !== 'sort' || !dragEnabled) return;
      const currentCards = cardsRef.current;
      const currentTargets = keyboardTargetsRef.current;
      const card = currentCards.find((entry) => entry.id === id);
      if (!card) return;
      const dims = cardDimsByIdRef.current.get(id) || getCardDimensions(card, cardLayoutMode, baseCardWidth);
      const restoreCardFocus = () => {
        window.requestAnimationFrame(() => {
          const expectedTestId = `card-${id}`;
          const element = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="card-"]')).find(
            (candidate) => candidate.dataset.testid === expectedTestId
          );
          element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          element?.focus({ preventScroll: true });
        });
      };
      if (currentTargets.length === 0) {
        const step = 32;
        const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
        const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
        onDragTraceStart?.(id, card.x, card.y);
        const moved = onMoveEnd(id, card.x + dx, card.y + dy);
        setKeyboardAnnouncement(moved ? `Moved ${card.meta.name}.` : `${card.meta.name} cannot move farther in that direction.`);
        restoreCardFocus();
        return;
      }
      const target = nextKeyboardDropTarget(currentTargets, card, dims.w, dims.h, direction);
      if (!target) {
        setKeyboardAnnouncement(`${card.meta.name} has no available area in that direction.`);
        return;
      }

      onDragTraceStart?.(id, card.x, card.y);
      const moved = onMoveEnd(id, target.x + (target.w - dims.w) / 2, target.y + (target.h - dims.h) / 2);
      setKeyboardAnnouncement(
        moved ? `Moved ${card.meta.name} to ${target.label}.` : `${card.meta.name} cannot move to ${target.label}.`
      );

      // Reflow can move the card and horizontally distant Q buckets can be outside
      // the viewport. Keep the user's context and keyboard focus on the moved card.
      restoreCardFocus();
    },
    [baseCardWidth, cardLayoutMode, dragEnabled, mode, onDragTraceStart, onMoveEnd]
  );

  React.useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    if (!surfaceScene) {
      board.scrollLeft = 0;
      board.scrollTop = 0;
      return;
    }
    const targetX = surfaceScene.stageKind === 'qsort' ? surfaceScene.viewportX : 0;
    if (Math.abs(board.scrollLeft - targetX) > 1) {
      board.scrollLeft = targetX;
    }
  }, [boardRef, surfaceScene]);

  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      if (mode !== 'setup') return;
      const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
      if (!hasFiles) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsFileOver(true);
    },
    [mode]
  );

  const handleDragLeave = React.useCallback(() => {
    setIsFileOver(false);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      if (mode !== 'setup') return;
      const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
      if (!hasFiles) return;
      e.preventDefault();
      setIsFileOver(false);
      const files = Array.from(e.dataTransfer.files || []).filter(isSupportedMediaFile);
      if (files.length > 0) onFilesAdded(files);
    },
    [mode, onFilesAdded]
  );

  const handleCanvasPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (mode !== 'setup') return;
      // Let the browser own one-finger touch gestures so an overflowing board
      // remains pannable. Lasso selection is a mouse/pen interaction.
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (event.target !== event.currentTarget) return;
      const point = canvasPoint(event);
      lassoPointerIdRef.current = event.pointerId;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture errors in non-browser test environments
      }
      setLassoRect({
        x0: point.x,
        y0: point.y,
        x1: point.x,
        y1: point.y,
        append: event.shiftKey,
      });
    },
    [mode]
  );

  const handleCanvasPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!lassoRect) return;
      if (lassoPointerIdRef.current !== event.pointerId) return;
      const point = canvasPoint(event);
      setLassoRect((prev) => (prev ? { ...prev, x1: point.x, y1: point.y } : prev));
    },
    [lassoRect]
  );

  const handleCanvasPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!lassoRect) return;
      if (lassoPointerIdRef.current !== event.pointerId) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore capture release errors from non-browser test environments
      }

      lassoPointerIdRef.current = null;
      const minX = Math.min(lassoRect.x0, lassoRect.x1);
      const maxX = Math.max(lassoRect.x0, lassoRect.x1);
      const minY = Math.min(lassoRect.y0, lassoRect.y1);
      const maxY = Math.max(lassoRect.y0, lassoRect.y1);
      const isClick = maxX - minX < 4 && maxY - minY < 4;

      if (isClick) {
        if (!lassoRect.append) onClearSelection?.();
        setLassoRect(null);
        return;
      }

      const selectedIds = cards
        .filter((card) => {
          const dims = cardDimsById.get(card.id) || { w: baseCardWidth, h: Math.round(baseCardWidth * (9 / 16)) };
          const cardMinX = card.x;
          const cardMaxX = card.x + dims.w;
          const cardMinY = card.y;
          const cardMaxY = card.y + dims.h;
          const intersects = !(cardMaxX < minX || cardMinX > maxX || cardMaxY < minY || cardMinY > maxY);
          return intersects;
        })
        .map((card) => card.id);

      onLassoSelect?.(selectedIds, lassoRect.append);
      if (selectedIds.length === 0 && !lassoRect.append) {
        onClearSelection?.();
      }
      setLassoRect(null);
    },
    [baseCardWidth, cardDimsById, cards, lassoRect, onClearSelection, onLassoSelect]
  );

  const handleCanvasPointerCancel = React.useCallback(() => {
    lassoPointerIdRef.current = null;
    setLassoRect(null);
  }, []);

  const lassoBounds = React.useMemo(() => {
    if (!lassoRect) return null;
    const left = Math.min(lassoRect.x0, lassoRect.x1);
    const top = Math.min(lassoRect.y0, lassoRect.y1);
    return {
      left,
      top,
      width: Math.abs(lassoRect.x1 - lassoRect.x0),
      height: Math.abs(lassoRect.y1 - lassoRect.y0),
    };
  }, [lassoRect]);

  const handleStackBadgePointerDown = React.useCallback(
    (stackId: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      badgeDragRef.current = { pointerId: event.pointerId, stackId };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture errors in test environments
      }
      onSelectStack?.(stackId);
      onStackDragStart?.(stackId, event.clientX, event.clientY);
    },
    [onSelectStack, onStackDragStart]
  );

  const handleStackBadgePointerMove = React.useCallback(
    (stackId: string, event: React.PointerEvent<HTMLElement>) => {
      const drag = badgeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.stackId !== stackId) return;
      onStackDragMove?.(stackId, event.clientX, event.clientY);
    },
    [onStackDragMove]
  );

  const finishStackBadgeDrag = React.useCallback(
    (stackId: string, event: React.PointerEvent<HTMLElement>) => {
      const drag = badgeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.stackId !== stackId) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore pointer capture release errors in tests
      }
      badgeDragRef.current = null;
      onStackDragEnd?.(stackId, event.clientX, event.clientY);
    },
    [onStackDragEnd]
  );

  const handleWidgetHeaderPointerDown = React.useCallback(
    (widget: SelectableWidgetLike, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelectWidget?.(widget.widgetId);
      if (!widget.dragEnabled) return;
      onWidgetDragStart?.(widget.widgetId, {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [onSelectWidget, onWidgetDragStart]
  );

  const handleWidgetResizePointerDown = React.useCallback(
    (widget: SelectableWidgetLike, edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelectWidget?.(widget.widgetId);
      if (!widget.resizeEnabled) return;
      onWidgetResizeStart?.(widget.widgetId, {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        edge,
      });
    },
    [onSelectWidget, onWidgetResizeStart]
  );

  const canvasStyle = React.useMemo<React.CSSProperties>(
    () => ({
      width: surfaceScene ? surfaceScene.canvasW : '100%',
      height: surfaceScene ? surfaceScene.canvasH : '100%',
      minWidth: '100%',
      minHeight: '100%',
    }),
    [surfaceScene]
  );

  return (
    <div
      ref={boardRef}
      data-testid="board-root"
      className={`board ${mode === 'setup' ? 'board--setup' : 'board--sort'} ${
        hasSetupSelection ? 'board--hasSelection' : ''
      } ${isFileOver ? 'board--fileover' : ''} ${surfaceScene?.stageKind === 'qsort' ? 'board--canvasScrollX' : ''}`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerCancel}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isFileOver && mode === 'setup' ? (
        <div className="fileOverlay" aria-hidden>
          <div className="fileOverlay__inner">Drop images or videos to add cards</div>
        </div>
      ) : null}

      <div
        ref={canvasRef}
        data-testid="board-canvas"
        className={`boardCanvas ${surfaceScene?.stageKind === 'qsort' ? 'boardCanvas--qsort' : ''}`}
        style={canvasStyle}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerCancel}
      >
        <p className="srOnly" id="setup-card-keyboard-help">
          Press Enter or Space to select this card. Hold Shift to add or remove it from the selection.
        </p>
        <p className="srOnly" id="sort-card-keyboard-help">
          Use the arrow keys to move this card.
        </p>
        <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
          {keyboardAnnouncement}
        </p>
        {mode === 'setup' && cards.length === 0 && !surfaceScene ? (
          <div className="boardEmptyState" role="status">
            <div className="boardEmptyState__title">Your board is empty</div>
            <div className="boardEmptyState__text">Add a text card, image, or video to get started.</div>
          </div>
        ) : null}

        {mode === 'setup' && lassoBounds && lassoBounds.width > 2 && lassoBounds.height > 2 ? (
          <div
            className="boardLasso"
            style={{
              left: lassoBounds.left,
              top: lassoBounds.top,
              width: lassoBounds.width,
              height: lassoBounds.height,
            }}
            aria-hidden
          />
        ) : null}

        {surfaceScene?.surfaces.map((surface) => {
          if (surface.kind === 'work-area') {
            return (
              <div
                key={surface.surfaceId}
                data-testid={`surface-work-area-${surface.widgetId}`}
                className={`boardSurface boardSurface--workArea ${surfaceStateClass(surface.state)}`}
                style={{ left: surface.x, top: surface.y, width: surface.w, height: surface.h }}
                aria-hidden
              >
                <div className="boardSurface__titleRow">
                  <div className="boardSurface__title">{surface.title}</div>
                  <div className="boardSurface__count">{surface.count}</div>
                </div>
              </div>
            );
          }

          if (surface.kind === 'sink') {
            const sinkContent = (
              <>
                <div className="boardSurface__titleRow">
                  <div className="boardSurface__title">{surface.title}</div>
                  <div className="boardSurface__count">{surface.capacityLabel || surface.count}</div>
                </div>
                {surface.count === 0 && surface.placeholderLabel ? (
                  <div className="boardSurface__placeholder">
                    <span className="boardSurface__placeholderTitle">{surface.placeholderLabel}</span>
                  </div>
                ) : null}
              </>
            );
            const sinkClassName = `boardSurface boardSurface--sink ${surface.isSelected ? 'isSelected' : ''} ${surfaceStateClass(surface.state)}`;
            const sinkStyle = { left: surface.x, top: surface.y, width: surface.w, height: surface.h };
            if (mode !== 'setup' || !onSelectWidget) {
              return (
                <div
                  key={surface.surfaceId}
                  data-testid={`surface-sink-${surface.widgetId}-${surface.zoneId}`}
                  className={sinkClassName}
                  style={sinkStyle}
                >
                  {sinkContent}
                </div>
              );
            }
            return (
              <button
                key={surface.surfaceId}
                type="button"
                data-testid={`surface-sink-${surface.widgetId}-${surface.zoneId}`}
                className={sinkClassName}
                style={sinkStyle}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectWidget?.(surface.selectWidgetId || surface.widgetId);
                }}
                onClick={() => onSelectWidget?.(surface.selectWidgetId || surface.widgetId)}
              >
                {sinkContent}
              </button>
            );
          }

          return (
            <div
              key={surface.surfaceId}
              data-testid={`surface-qsort-${surface.widgetId}`}
              className={`boardSurface boardSurface--qsort ${surface.isSelected ? 'isSelected' : ''}`}
              style={{ left: surface.x, top: surface.y, width: surface.w, height: surface.h }}
            >
              {surface.resizeEnabled ? (
                <>
                  <div
                    className="widget__resize widget__resize--n"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'n', event)}
                  />
                  <div
                    className="widget__resize widget__resize--e"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'e', event)}
                  />
                  <div
                    className="widget__resize widget__resize--s"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 's', event)}
                  />
                  <div
                    className="widget__resize widget__resize--w"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'w', event)}
                  />
                  <div
                    className="widget__resize widget__resize--ne"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'ne', event)}
                  />
                  <div
                    className="widget__resize widget__resize--nw"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'nw', event)}
                  />
                  <div
                    className="widget__resize widget__resize--se"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'se', event)}
                  />
                  <div
                    className="widget__resize widget__resize--sw"
                    onPointerDown={(event) => handleWidgetResizePointerDown(surface, 'sw', event)}
                  />
                </>
              ) : null}

              {surface.dragEnabled ? (
                <button
                  className="boardSurface__header boardSurface__header--interactive"
                  type="button"
                  onPointerDown={(event) => handleWidgetHeaderPointerDown(surface, event)}
                  onClick={() => onSelectWidget?.(surface.selectWidgetId || surface.widgetId)}
                >
                  <span className="boardSurface__headerMeta">
                    <span className="boardSurface__title">{surface.title}</span>
                  </span>
                  <span className="boardSurface__count">{surface.count}</span>
                </button>
              ) : (
                <div className="boardSurface__header">
                  <span className="boardSurface__headerMeta">
                    <span className="boardSurface__title">{surface.title}</span>
                  </span>
                  <span className="boardSurface__count">{surface.count}</span>
                </div>
              )}

              <div
                className="boardQSort__leftColumn"
                data-testid={`qsort-rail-${surface.widgetId}`}
                style={{
                  left: surface.leftColumnRect.x - surface.x,
                  top: surface.leftColumnRect.y - surface.y,
                  width: surface.leftColumnRect.w,
                  height: surface.leftColumnRect.h,
                }}
              >
                {surface.lanes.map((lane) => (
                  <div
                    key={lane.zoneId}
                    className={`boardSurface boardSurface--sink boardSurface--presort ${surfaceStateClass(lane.state)}`}
                    data-testid={`qsort-lane-${surface.widgetId}-${lane.zoneId}`}
                    style={{ left: lane.x - surface.leftColumnRect.x, top: lane.y - surface.leftColumnRect.y, width: lane.w, height: lane.h }}
                  >
                    <div className="boardSurface__titleRow">
                      <div className="boardSurface__title">{lane.label}</div>
                      <div className="boardSurface__count">{lane.count}</div>
                    </div>
                    {lane.count === 0 && lane.placeholderLabel ? (
                      <div className="boardSurface__placeholder">
                        <span className="boardSurface__placeholderTitle">{lane.placeholderLabel}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div
                className="boardQSort__distribution"
                data-testid={`qsort-distribution-${surface.widgetId}`}
                style={{
                  left: surface.distributionRect.x - surface.x,
                  top: surface.distributionRect.y - surface.y,
                  width: surface.distributionRect.w,
                  height: surface.distributionRect.h,
                }}
              >
                <div
                  className="boardQSort__baseline"
                  aria-hidden
                  style={{ top: surface.baselineY - surface.distributionRect.y }}
                />
                {surface.buckets.map((bucket) => (
                  <div
                    key={bucket.zoneId}
                    className={`widgetBucket ${surfaceStateClass(bucket.state)} ${bucket.isCenter ? 'is-center' : ''} ${
                      bucket.isExtreme ? 'is-extreme' : ''
                    } ${bucket.capacity === 0 ? 'is-zero' : ''}`}
                    data-testid={`qsort-bucket-${surface.widgetId}-${bucket.zoneId}`}
                    style={{
                      left: bucket.x - surface.distributionRect.x,
                      top: bucket.y - surface.distributionRect.y,
                      width: bucket.w,
                      height: bucket.h,
                    }}
                  >
                    <div
                      className="widgetBucket__column"
                      data-testid={`qsort-column-${surface.widgetId}-${bucket.zoneId}`}
                      style={{
                        top: bucket.baselineY - bucket.y - bucket.columnHeight,
                        height: bucket.columnHeight,
                      }}
                    />
                    {bucket.slots.map((slot) => (
                      <div
                        key={`${bucket.zoneId}:${slot.slotIndex}`}
                        className={`widgetBucket__slot ${slot.occupied ? 'is-occupied' : ''}`}
                        data-testid={`qsort-slot-${surface.widgetId}-${bucket.zoneId}-${slot.slotIndex}`}
                        style={{
                          left: slot.x - bucket.x,
                          top: slot.y - bucket.y,
                          width: slot.w,
                          height: slot.h,
                        }}
                      />
                    ))}
                    <div className="widgetBucket__footer">
                      <div className="widgetBucket__label">{bucket.label}</div>
                      <div className="widgetBucket__meta">{bucket.capacityLabel}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {stackBadges?.map((badge) => (
          <div
            key={badge.stackId}
            className={`stackHalo ${badge.isSelected ? 'isSelected' : ''}`}
            style={{ left: badge.x, top: badge.y, width: badge.width, height: badge.height, zIndex: badge.z }}
          >
            <div className="stackHalo__outline" aria-hidden />
            <div
              className="stackHalo__edge stackHalo__edge--top"
              aria-hidden
              onPointerDown={(event) => handleStackBadgePointerDown(badge.stackId, event)}
              onPointerMove={(event) => handleStackBadgePointerMove(badge.stackId, event)}
              onPointerUp={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onPointerCancel={(event) => finishStackBadgeDrag(badge.stackId, event)}
            />
            <div
              className="stackHalo__edge stackHalo__edge--right"
              aria-hidden
              onPointerDown={(event) => handleStackBadgePointerDown(badge.stackId, event)}
              onPointerMove={(event) => handleStackBadgePointerMove(badge.stackId, event)}
              onPointerUp={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onPointerCancel={(event) => finishStackBadgeDrag(badge.stackId, event)}
            />
            <div
              className="stackHalo__edge stackHalo__edge--bottom"
              aria-hidden
              onPointerDown={(event) => handleStackBadgePointerDown(badge.stackId, event)}
              onPointerMove={(event) => handleStackBadgePointerMove(badge.stackId, event)}
              onPointerUp={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onPointerCancel={(event) => finishStackBadgeDrag(badge.stackId, event)}
            />
            <div
              className="stackHalo__edge stackHalo__edge--left"
              aria-hidden
              onPointerDown={(event) => handleStackBadgePointerDown(badge.stackId, event)}
              onPointerMove={(event) => handleStackBadgePointerMove(badge.stackId, event)}
              onPointerUp={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onPointerCancel={(event) => finishStackBadgeDrag(badge.stackId, event)}
            />
            <button
              className="stackHalo__handle"
              type="button"
              aria-label={`Stack with ${badge.count} cards`}
              title={badge.name}
              tabIndex={mode === 'setup' && !!onSelectStack ? 0 : -1}
              onPointerDown={(event) => handleStackBadgePointerDown(badge.stackId, event)}
              onPointerMove={(event) => handleStackBadgePointerMove(badge.stackId, event)}
              onPointerUp={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onPointerCancel={(event) => finishStackBadgeDrag(badge.stackId, event)}
              onClick={() => onSelectStack?.(badge.stackId)}
            >
              <span className="stackHalo__name">{badge.name}</span>
              <span className="stackHalo__count" aria-hidden>
                {badge.count}
              </span>
            </button>
          </div>
        ))}

        {cards.map((card) => {
          const dims = cardDimsById.get(card.id) || getCardDimensions(card, cardLayoutMode, baseCardWidth);
          return (
            <DraggableCard
              key={card.id}
              card={card}
              cardW={dims.w}
              cardH={dims.h}
              mode={mode}
              isSelected={mode === 'setup' && !!selectedCardIds?.includes(card.id)}
              dragEnabled={dragEnabled}
              dragConstraintsRef={canvasRef}
              onBringToFront={onBringToFront}
              onMoveEnd={onMoveEnd}
              onResizeStart={onResizeStart}
              onSelectCard={onSelectCard}
              onKeyboardMove={mode === 'sort' && dragEnabled ? handleCardKeyboardMove : undefined}
              keyboardDescriptionId={mode === 'setup' ? 'setup-card-keyboard-help' : mode === 'sort' ? 'sort-card-keyboard-help' : undefined}
              locationLabel={getCardLocationLabel(card, dims.w, dims.h)}
              onDragTraceStart={onDragTraceStart}
              onDragTraceSample={onDragTraceSample}
              onOpenPreview={onOpenPreview}
              showChrome
            />
          );
        })}
      </div>
    </div>
  );
}
