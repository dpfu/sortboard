import * as React from 'react';

type PanGesture = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  scale: number;
  moved: boolean;
  clearOnClick: boolean;
};

function ownsSpace(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]')) return false;
  // Cards keep Enter for selection; ordinary controls keep their native Space action.
  return !target.closest('button, a, summary, [role="button"]:not(.card), [role="slider"], [role="switch"]');
}

export function useBoardPan({
  enabled,
  setup,
  boardRef,
  onPanEnd,
  onBlankClick,
}: {
  enabled: boolean;
  setup: boolean;
  boardRef: React.RefObject<HTMLDivElement>;
  onPanEnd: () => void;
  onBlankClick?: () => void;
}) {
  const gesture = React.useRef<PanGesture | null>(null);
  const space = React.useRef(false);
  const otherPointer = React.useRef<number | null>(null);
  const suppressClick = React.useRef(false);
  const callbacks = React.useRef({ onPanEnd, onBlankClick });
  callbacks.current = { onPanEnd, onBlankClick };
  const [handMode, setHandMode] = React.useState(false);
  const [panning, setPanning] = React.useState(false);

  const finish = React.useCallback((cancelled = false) => {
    const current = gesture.current;
    gesture.current = null;
    setPanning(false);
    if (!current) return;
    const board = boardRef.current;
    if (board?.hasPointerCapture?.(current.pointerId)) board.releasePointerCapture(current.pointerId);
    if (current.moved) callbacks.current.onPanEnd();
    else if (!cancelled && current.clearOnClick) callbacks.current.onBlankClick?.();
  }, [boardRef]);

  React.useEffect(() => {
    if (!enabled) return;
    const reset = () => {
      space.current = false;
      otherPointer.current = null;
      setHandMode(false);
      finish(true);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || !ownsSpace(event.target)) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (otherPointer.current !== null) return;
      space.current = true;
      setHandMode(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !space.current) return;
      event.preventDefault();
      event.stopPropagation();
      space.current = false;
      setHandMode(false);
      // Releasing Space does not transfer an active gesture to the card below it.
    };
    const pointerEnd = (event: PointerEvent) => {
      if (otherPointer.current === event.pointerId) otherPointer.current = null;
    };
    const visibilityChange = () => { if (document.hidden) reset(); };
    const focusChange = (event: FocusEvent) => { if (!ownsSpace(event.target)) reset(); };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('pointerup', pointerEnd, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibilityChange);
    document.addEventListener('focusin', focusChange);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibilityChange);
      document.removeEventListener('focusin', focusChange);
      reset();
    };
  }, [enabled, finish]);

  return {
    handMode: enabled && handMode,
    panning: enabled && panning,
    handlers: {
      onPointerDownCapture(event: React.PointerEvent<HTMLDivElement>) {
        if (!enabled || gesture.current || event.pointerType === 'touch') return;
        suppressClick.current = false;
        const target = event.target as Element;
        const blank = target.hasAttribute('data-board-background');
        const shouldPan = event.button === 1 || (event.button === 0 && (space.current || (blank && !(setup && event.shiftKey))));
        if (!shouldPan) {
          otherPointer.current = event.pointerId;
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const board = event.currentTarget;
        board.focus({ preventScroll: true });
        gesture.current = {
          pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: board.scrollLeft, top: board.scrollTop, moved: false,
          scale: board.offsetWidth ? board.getBoundingClientRect().width / board.offsetWidth : 1,
          clearOnClick: setup && blank && !space.current && event.button === 0,
        };
        suppressClick.current = true;
        setPanning(true);
        board.setPointerCapture?.(event.pointerId);
      },
      onPointerMoveCapture(event: React.PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const dx = (event.clientX - current.x) / current.scale;
        const dy = (event.clientY - current.y) / current.scale;
        current.moved ||= Math.hypot(dx, dy) >= 3;
        if (!current.moved) return;
        event.currentTarget.scrollLeft = current.left - dx;
        event.currentTarget.scrollTop = current.top - dy;
      },
      onPointerUpCapture(event: React.PointerEvent<HTMLDivElement>) {
        if (gesture.current?.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        finish();
      },
      onPointerCancelCapture(event: React.PointerEvent<HTMLDivElement>) {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      },
      onLostPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      },
      onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
