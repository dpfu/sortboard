/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => {
  return {
    motion: {
      div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) =>
        React.createElement('div', { ...props, ref })
      ),
    },
    useMotionValue: () => ({ set: () => undefined }),
    useSpring: (value: unknown) => value,
    useReducedMotion: () => false,
    useDragControls: () => ({ start: () => undefined }),
  };
});

async function renderAppReady() {
  const { default: App } = await import('./App');
  const view = render(<App />);
  await waitFor(
    () => {
      const button = screen.getByRole('button', { name: 'Start sorting →' }) as HTMLButtonElement;
      if (button.disabled) {
        throw new Error('start sorting still disabled');
      }
    },
    { timeout: 5000 }
  );
  return view;
}

function mockRectForCard(card: HTMLElement, left = 120, top = 100) {
  const width = Number.parseFloat(card.style.width || '240') || 240;
  const height = Number.parseFloat(card.style.height || '135') || 135;
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
  return { left, top, width, height };
}

type ResizeTestEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function edgePoint(
  edge: ResizeTestEdge,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  switch (edge) {
    case 'n':
      return { x: centerX, y: top + 1 };
    case 's':
      return { x: centerX, y: top + height - 1 };
    case 'e':
      return { x: left + width - 1, y: centerY };
    case 'w':
      return { x: left + 1, y: centerY };
    case 'ne':
      return { x: left + width - 1, y: top + 1 };
    case 'nw':
      return { x: left + 1, y: top + 1 };
    case 'se':
      return { x: left + width - 1, y: top + height - 1 };
    case 'sw':
      return { x: left + 1, y: top + height - 1 };
    default:
      return { x: left + width - 1, y: centerY };
  }
}

function resizeFromEdge(
  card: HTMLElement,
  pointerId: number,
  edge: ResizeTestEdge,
  deltaX: number,
  deltaY: number
) {
  const { left, top, width, height } = mockRectForCard(card);
  const point = edgePoint(edge, left, top, width, height);
  fireEvent.pointerMove(card, { pointerId, clientX: point.x, clientY: point.y });
  fireEvent.pointerDown(card, { pointerId, button: 0, clientX: point.x, clientY: point.y });
  fireEvent.pointerMove(window, { pointerId, clientX: point.x + deltaX, clientY: point.y + deltaY });
  fireEvent.pointerUp(window, { pointerId, clientX: point.x + deltaX, clientY: point.y + deltaY });
}

describe('App setup card resize action', () => {
  beforeAll(() => {
    class MockResizeObserver {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback(
          [{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }

      unobserve() {}

      disconnect() {}
    }

    (globalThis as any).ResizeObserver = MockResizeObserver;
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  beforeEach(async () => {
    const persist = await import('./persist');
    await persist.persistDeleteAll();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const blob = new Blob(['cat'], { type: 'image/png' });
      return new Response(blob, { status: 200 });
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('has no visible corner resize handle in any mode', async () => {
    const { container } = await renderAppReady();
    expect(container.querySelector('.card__resizeHandle')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: 'End sorting →' });
    expect(container.querySelector('.card__resizeHandle')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));
    await screen.findByText('Replay');
    expect(container.querySelector('.card__resizeHandle')).toBeNull();
  });

  it('resizes a selected card from edge drag and undo restores prior size', async () => {
    const { container } = await renderAppReady();
    const cards = Array.from(container.querySelectorAll('.card')) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(2);
    const targetCard = cards[2];

    await userEvent.click(targetCard);
    expect(targetCard.classList.contains('isSelected')).toBe(true);

    await waitFor(() => {
      expect(targetCard.style.width).toBe('240px');
      expect(targetCard.style.height).toBe('135px');
    });

    resizeFromEdge(targetCard, 7, 'e', 60, 0);

    await waitFor(() => {
      expect(targetCard.style.width).toBe('300px');
      expect(targetCard.style.height).toBe('169px');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(targetCard.style.width).toBe('240px');
      expect(targetCard.style.height).toBe('135px');
    });
  });

  it('scales all selected cards together during multi-select edge resize', async () => {
    const { container } = await renderAppReady();
    const cards = Array.from(container.querySelectorAll('.card')) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(2);
    const first = cards[0];
    const second = cards[1];
    const third = cards[2];

    await userEvent.click(first);
    fireEvent.pointerDown(second, { button: 0, shiftKey: true });

    await waitFor(() => {
      const selected = container.querySelectorAll('.card.isSelected');
      expect(selected.length).toBe(2);
    });

    const firstBefore = first.style.width;
    const secondBefore = second.style.width;
    const thirdBefore = third.style.width;

    resizeFromEdge(first, 11, 'e', 48, 0);

    await waitFor(() => {
      expect(first.style.width).not.toBe(firstBefore);
      expect(second.style.width).not.toBe(secondBefore);
      expect(third.style.width).toBe(thirdBefore);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(first.style.width).toBe(firstBefore);
      expect(second.style.width).toBe(secondBefore);
      expect(third.style.width).toBe(thirdBefore);
    });
  });

  it('detects edge/corner zones and supports resizing from each edge family', async () => {
    const { container } = await renderAppReady();
    const card = (container.querySelectorAll('.card')[2] as HTMLElement) || (container.querySelector('.card') as HTMLElement);
    expect(card).toBeTruthy();

    await userEvent.click(card);
    const { left, top, width, height } = mockRectForCard(card, 180, 120);

    const hotCases: Array<{ edge: ResizeTestEdge; expectedClass: string }> = [
      { edge: 'n', expectedClass: 'isResizeHot--n' },
      { edge: 's', expectedClass: 'isResizeHot--s' },
      { edge: 'e', expectedClass: 'isResizeHot--e' },
      { edge: 'w', expectedClass: 'isResizeHot--w' },
      { edge: 'ne', expectedClass: 'isResizeHot--ne' },
      { edge: 'nw', expectedClass: 'isResizeHot--nw' },
      { edge: 'se', expectedClass: 'isResizeHot--se' },
      { edge: 'sw', expectedClass: 'isResizeHot--sw' },
    ];

    for (const { edge, expectedClass } of hotCases) {
      const point = edgePoint(edge, left, top, width, height);
      fireEvent.pointerMove(card, { pointerId: 40, clientX: point.x, clientY: point.y });
      await waitFor(() => {
        expect(card.classList.contains(expectedClass)).toBe(true);
      });
    }

    const resizeCases: Array<{ edge: ResizeTestEdge; dx: number; dy: number }> = [
      { edge: 'n', dx: 0, dy: -34 },
      { edge: 'e', dx: 34, dy: 0 },
      { edge: 'ne', dx: 24, dy: -24 },
      { edge: 'sw', dx: -24, dy: 24 },
    ];

    for (let i = 0; i < resizeCases.length; i += 1) {
      const before = card.style.width;
      const spec = resizeCases[i];
      resizeFromEdge(card, 90 + i, spec.edge, spec.dx, spec.dy);
      await waitFor(() => {
        expect(card.style.width).not.toBe(before);
      });
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => {
        expect(card.style.width).toBe(before);
      });
    }
  });
});
