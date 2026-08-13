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
  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Start sorting →' }) as HTMLButtonElement;
    if (button.disabled) {
      throw new Error('start sorting still disabled');
    }
  }, { timeout: 5000 });
  return view;
}

function mockRectForCard(card: HTMLElement, left = 140, top = 120) {
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

function resizeFromEastEdge(card: HTMLElement, pointerId: number, deltaX: number) {
  const { left, top, width, height } = mockRectForCard(card);
  const edgeX = left + width - 2;
  const midY = top + height / 2;
  fireEvent.pointerDown(card, { pointerId, button: 0, clientX: edgeX, clientY: midY });
  fireEvent.pointerMove(window, { pointerId, clientX: edgeX + deltaX, clientY: midY });
  fireEvent.pointerUp(window, { pointerId, clientX: edgeX + deltaX, clientY: midY });
}

describe('App setup card size slider', () => {
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

  it('shows the card size slider in setup only', async () => {
    await renderAppReady();
    expect(screen.getByLabelText('Card size')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: 'End sorting →' });
    expect(screen.queryByLabelText('Card size')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));
    await screen.findByText('Replay');
    expect(screen.queryByLabelText('Card size')).toBeNull();
  });

  it('updates rendered card size and persists it across reload', async () => {
    const firstRender = await renderAppReady();
    const slider = screen.getByLabelText('Card size') as HTMLInputElement;
    const firstCard = firstRender.container.querySelector('.card') as HTMLElement;
    expect(firstCard.style.width).toBe('240px');

    fireEvent.change(slider, { target: { value: '304' } });

    await waitFor(() => {
      expect((screen.getByLabelText('Card size') as HTMLInputElement).value).toBe('304');
      expect((firstRender.container.querySelector('.card') as HTMLElement).style.width).toBe('304px');
      expect((firstRender.container.querySelector('.card') as HTMLElement).style.height).toBe('171px');
    });

    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    await waitFor(async () => {
      const board = await persist.persistGetBoard(projectId!);
      expect(board?.cardW).toBe(304);
      expect(board?.cardH).toBe(171);
    }, { timeout: 3000 });

    firstRender.unmount();
    const secondRender = await renderAppReady();
    await waitFor(() => {
      expect((screen.getByLabelText('Card size') as HTMLInputElement).value).toBe('304');
      expect((secondRender.container.querySelector('.card') as HTMLElement).style.width).toBe('304px');
      expect((secondRender.container.querySelector('.card') as HTMLElement).style.height).toBe('171px');
    });
  });

  it('keeps per-card resize scale when global card size changes', async () => {
    const view = await renderAppReady();
    const cards = Array.from(view.container.querySelectorAll('.card')) as HTMLElement[];
    expect(cards.length).toBeGreaterThan(1);

    const firstCard = cards[0];
    const secondCard = cards[1];
    await userEvent.click(firstCard);
    resizeFromEastEdge(firstCard, 9, 60);

    await waitFor(() => {
      expect(firstCard.style.width).toBe('300px');
      expect(secondCard.style.width).toBe('240px');
    });

    const slider = screen.getByLabelText('Card size') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '280' } });

    await waitFor(() => {
      expect(firstCard.style.width).toBe('350px');
      expect(secondCard.style.width).toBe('280px');
    });
  });
});
