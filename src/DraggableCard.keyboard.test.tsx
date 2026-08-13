/** @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraggableCard } from './DraggableCard';
import type { CardData, Mode } from './types';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
      const {
        drag: _drag,
        dragControls: _dragControls,
        dragListener: _dragListener,
        dragConstraints: _dragConstraints,
        dragMomentum: _dragMomentum,
        dragElastic: _dragElastic,
        animate: _animate,
        transition: _transition,
        whileDrag: _whileDrag,
        onDrag: _onDrag,
        onDragStart: _onDragStart,
        onDragEnd: _onDragEnd,
        ...domProps
      } = props as Record<string, unknown>;
      return React.createElement('div', { ...domProps, ref });
    }),
  },
  useMotionValue: () => ({ set: () => undefined }),
  useSpring: (value: unknown) => value,
  useReducedMotion: () => false,
  useDragControls: () => ({ start: () => undefined }),
}));

const card: CardData = {
  id: 'card-one',
  kind: 'text',
  createdAt: 1,
  meta: { name: 'First idea', notes: '', tags: [], frontText: 'First idea', color: 'slate' },
  x: 20,
  y: 30,
  z: 1,
};

function renderCard(
  mode: Mode,
  overrides: Partial<React.ComponentProps<typeof DraggableCard>> = {}
) {
  const props: React.ComponentProps<typeof DraggableCard> = {
    card,
    cardW: 200,
    cardH: 120,
    mode,
    dragEnabled: mode !== 'end',
    dragConstraintsRef: React.createRef<HTMLElement>(),
    onBringToFront: vi.fn(),
    onMoveEnd: vi.fn(),
    ...overrides,
  };
  return { ...render(<DraggableCard {...props} />), props };
}

afterEach(cleanup);

describe('DraggableCard keyboard interaction', () => {
  it('selects a setup card with Enter and toggles it with Shift+Space', () => {
    const onSelectCard = vi.fn();
    const onBringToFront = vi.fn();
    renderCard('setup', { onSelectCard, onBringToFront, isSelected: true });
    const element = screen.getByRole('button', { name: 'Card: First idea' });

    fireEvent.keyDown(element, { key: 'Enter' });
    expect(onSelectCard).toHaveBeenNthCalledWith(1, 'card-one', { toggle: false });
    expect(onBringToFront).toHaveBeenCalledWith('card-one');

    const allowedDefault = fireEvent.keyDown(element, { key: ' ', shiftKey: true });
    expect(allowedDefault).toBe(false);
    expect(onSelectCard).toHaveBeenNthCalledWith(2, 'card-one', { toggle: true });
    expect(element.getAttribute('aria-pressed')).toBe('true');
  });

  it('supports synthetic button activation without duplicating pointer selection', () => {
    const onSelectCard = vi.fn();
    const onBringToFront = vi.fn();
    renderCard('setup', { onSelectCard, onBringToFront });
    const element = screen.getByRole('button', { name: 'Card: First idea' });

    fireEvent.click(element, { detail: 0 });
    expect(onSelectCard).toHaveBeenCalledOnce();
    expect(onSelectCard).toHaveBeenCalledWith('card-one', { toggle: false });

    fireEvent.pointerDown(element, { button: 0 });
    fireEvent.click(element, { detail: 1 });
    expect(onSelectCard).toHaveBeenCalledTimes(2);
  });

  it('does not nest a preview button inside a setup card button', () => {
    renderCard('setup', {
      card: { ...card, kind: 'video', meta: { ...card.meta, name: 'Interview clip' } },
      onSelectCard: vi.fn(),
      onOpenPreview: vi.fn(),
    });
    const element = screen.getByRole('button', { name: 'Card: Interview clip' });
    expect(element.querySelector('button')).toBeNull();
  });

  it('moves a sort card with arrows and exposes its current area', () => {
    const onKeyboardMove = vi.fn();
    renderCard('sort', {
      onKeyboardMove,
      keyboardDescriptionId: 'sort-help',
      locationLabel: 'Cards',
    });
    const element = screen.getByRole('group', { name: 'Card: First idea. Current area: Cards' });

    const allowedDefault = fireEvent.keyDown(element, { key: 'ArrowRight' });
    expect(allowedDefault).toBe(false);
    expect(onKeyboardMove).toHaveBeenCalledWith('card-one', 'right');
    expect(element.getAttribute('aria-roledescription')).toBe('movable card');
    expect(element.getAttribute('aria-describedby')).toBe('sort-help');
  });

  it('keeps replay cards out of the tab order', () => {
    renderCard('end', { onKeyboardMove: vi.fn() });
    const element = screen.getByTestId('card-card-one');
    expect(element.getAttribute('tabindex')).toBe('-1');
    expect(element.hasAttribute('role')).toBe(false);
  });
});
