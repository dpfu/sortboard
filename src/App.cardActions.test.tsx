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

async function getActiveBoard() {
  const persist = await import('./persist');
  const activeProjectId = await persist.persistGetActiveProjectId();
  if (!activeProjectId) {
    throw new Error('missing active project id');
  }
  const board = await persist.persistGetBoard(activeProjectId);
  if (!board) {
    throw new Error('missing active board');
  }
  return board;
}

async function createStackFromFirstTwoCards(container: HTMLElement) {
  const cards = Array.from(container.querySelectorAll('.card')) as HTMLElement[];
  expect(cards.length).toBeGreaterThan(2);
  fireEvent.pointerDown(cards[0], { button: 0 });
  fireEvent.pointerDown(cards[1], { button: 0, shiftKey: true });
  await waitFor(() => {
    expect(screen.getByText('2 cards selected.')).toBeTruthy();
  });
  await userEvent.click(screen.getByRole('button', { name: 'Create stack' }));
  await waitFor(async () => {
    const board = await getActiveBoard();
    expect(board.stacks || []).toHaveLength(1);
  });
}

describe('App setup card actions', () => {
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

  it('removes global Shuffle and Clear actions from the cards panel', async () => {
    await renderAppReady();
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stack' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: 'End sorting →' });
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stack' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));
    await screen.findByText('Replay');
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stack' })).toBeNull();
  });

  it('creates a stack from multi-selection and undo restores loose cards', async () => {
    const { container } = await renderAppReady();
    const before = await getActiveBoard();
    const beforePos = new Map(before.cards.map((card) => [card.id, `${card.x},${card.y}`]));

    await createStackFromFirstTwoCards(container);

    await waitFor(async () => {
      const board = await getActiveBoard();
      expect(board.stacks || []).toHaveLength(1);
      const stackId = board.stacks?.[0]?.id;
      expect(stackId).toBeTruthy();
      expect(board.cards.filter((card) => card.stackId === stackId)).toHaveLength(2);
      expect(board.cards.some((card) => `${card.x},${card.y}` !== beforePos.get(card.id))).toBe(true);
    }, { timeout: 3000 });

    expect(screen.getByRole('button', { name: 'Stack with 2 cards' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const restored = await getActiveBoard();
      expect(restored.stacks || []).toHaveLength(0);
      expect(restored.cards.every((card) => !card.stackId)).toBe(true);
      expect(
        restored.cards.every((card) => `${card.x},${card.y}` === beforePos.get(card.id))
      ).toBe(true);
    }, { timeout: 3000 });
  });

  it('adds a single selected card to an existing stack from the details panel', async () => {
    const { container } = await renderAppReady();
    await createStackFromFirstTwoCards(container);

    const thirdCard = (Array.from(container.querySelectorAll('.card')) as HTMLElement[])[2];
    await userEvent.click(thirdCard);

    await waitFor(() => {
      expect(screen.getByLabelText('Add to stack')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(async () => {
      const board = await getActiveBoard();
      expect(board.stacks || []).toHaveLength(1);
      const stackId = board.stacks?.[0]?.id;
      expect(board.cards.filter((card) => card.stackId === stackId)).toHaveLength(3);
    });
  });

  it('moves a stack via badge drag in sort mode and records group members', async () => {
    const { container } = await renderAppReady();
    await createStackFromFirstTwoCards(container);

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    const badge = await screen.findByRole('button', { name: 'Stack with 2 cards' });

    fireEvent.pointerDown(badge, { pointerId: 41, button: 0, clientX: 180, clientY: 120 });
    fireEvent.pointerMove(badge, { pointerId: 41, clientX: 260, clientY: 200 });
    fireEvent.pointerUp(badge, { pointerId: 41, clientX: 260, clientY: 200 });

    await waitFor(() => {
      expect(screen.getByText('Recording · 1 action')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));

    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    await waitFor(async () => {
      const sessions = await persist.persistListSessions(projectId!);
      const firstSegment = sessions[0]?.recording.segments[0];
      expect(firstSegment?.type).toBe('drag');
      if (!firstSegment || firstSegment.type !== 'drag') {
        throw new Error('expected drag segment');
      }
      expect(firstSegment.groupMembers?.length).toBe(1);
    }, { timeout: 3000 });
  });
});
