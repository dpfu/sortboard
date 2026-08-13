/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

describe('App closed sort widgets', () => {
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

  it('scaffolds a hidden source assignment and first category surface when switching to closed sort', async () => {
    await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));

    await waitFor(async () => {
      const board = await getActiveBoard();
      const stage = board.workflow?.stages[0];
      const source = board.workflow?.widgets.find((widget) => widget.kind === 'source');
      const categories = board.workflow?.widgets.filter((widget) => widget.kind === 'category') || [];

      expect(board.sortConfig.type).toBe('closed');
      expect(board.workflow?.templateId).toBe('closed');
      expect(stage?.kind).toBe('closed-sort');
      expect(source).toBeTruthy();
      expect(categories).toHaveLength(1);
      expect(board.cards.every((card) => card.widgetAssignments?.[stage!.id]?.widgetId === source?.id)).toBe(true);
      expect(board.cards.every((card) => card.widgetAssignments?.[stage!.id]?.zoneId === 'content')).toBe(true);
      expect(board.stacks || []).toHaveLength(0);
    });

    expect(screen.getByRole('button', { name: 'Add category' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('adds a closed-sort category widget from setup', async () => {
    await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add category' }));

    await waitFor(async () => {
      const board = await getActiveBoard();
      expect(board.workflow?.widgets.filter((widget) => widget.kind === 'category')).toHaveLength(2);
    });

    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('assigns newly added setup cards into the closed-sort source widget', async () => {
    await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Text card' }));

    await waitFor(async () => {
      const board = await getActiveBoard();
      const stage = board.workflow?.stages[0];
      const source = board.workflow?.widgets.find((widget) => widget.kind === 'source');
      const newest = board.cards
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

      expect(stage).toBeTruthy();
      expect(source).toBeTruthy();
      expect(newest?.widgetAssignments?.[stage!.id]).toEqual({
        widgetId: source!.id,
        zoneId: 'content',
        order: expect.any(Number),
      });
    });
  });

  it('returns category cards to the source widget when deleting a target', async () => {
    const firstView = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));

    const persist = await import('./persist');
    const activeProjectId = await persist.persistGetActiveProjectId();
    expect(activeProjectId).toBeTruthy();
    let board = await persist.persistGetBoard(activeProjectId!);
    await waitFor(async () => {
      board = await persist.persistGetBoard(activeProjectId!);
      expect(board?.workflow?.templateId).toBe('closed');
    });

    const stage = board!.workflow!.stages[0]!;
    const source = board!.workflow!.widgets.find((widget) => widget.kind === 'source')!;
    const category = board!.workflow!.widgets.find((widget) => widget.kind === 'category')!;
    const firstCard = board!.cards[0]!;

    await persist.persistPutBoard({
      ...board!,
      cards: board!.cards.map((card, index) =>
        card.id !== firstCard.id
          ? card
          : {
              ...card,
              widgetAssignments: {
                ...(card.widgetAssignments || {}),
                [stage.id]: {
                  widgetId: category.id,
                  zoneId: 'content',
                  order: index,
                },
              },
            }
      ),
    });

    firstView.unmount();
    const secondView = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));
    const categorySurface = await screen.findByTestId(`surface-sink-${category.id}-content`);
    await userEvent.click(categorySurface);
    await userEvent.click(screen.getByRole('button', { name: 'Remove category' }));

    await waitFor(() => {
      expect(secondView.container.querySelector(`[data-testid="surface-sink-${category.id}-content"]`)).toBeNull();
    });

    await waitFor(async () => {
      const updated = await persist.persistGetBoard(activeProjectId!);
      expect(updated?.workflow?.widgets.some((widget) => widget.id === category.id)).toBe(false);
      expect(updated?.cards.find((card) => card.id === firstCard.id)?.widgetAssignments?.[stage.id]).toEqual({
        widgetId: source.id,
        zoneId: 'content',
        order: expect.any(Number),
      });
    }, { timeout: 3000 });
  });

  it('renders board surfaces for closed sort in sort mode', async () => {
    const view = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));

    let sourceId = '';
    let categoryId = '';
    await waitFor(async () => {
      const board = await getActiveBoard();
      sourceId = board.workflow?.widgets.find((widget) => widget.kind === 'source')?.id || '';
      categoryId = board.workflow?.widgets.find((widget) => widget.kind === 'category')?.id || '';
      expect(sourceId).toBeTruthy();
      expect(categoryId).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));

    expect(await screen.findByTestId(`surface-work-area-${sourceId}`)).toBeTruthy();
    expect(await screen.findByTestId(`surface-sink-${categoryId}-content`)).toBeTruthy();
    expect(view.container.querySelector('.closedFixedBoard')).toBeNull();
    expect(view.container.querySelector('[data-testid^="closed-container-"]')).toBeNull();
  });

  it('uses the shared board renderer for closed-sort replay', async () => {
    const firstView = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));

    const persist = await import('./persist');
    const activeProjectId = await persist.persistGetActiveProjectId();
    expect(activeProjectId).toBeTruthy();
    let board = await persist.persistGetBoard(activeProjectId!);
    await waitFor(async () => {
      board = await persist.persistGetBoard(activeProjectId!);
      expect(board?.workflow?.templateId).toBe('closed');
      expect(board?.workflow?.stages[0]).toBeTruthy();
    });

    const stage = board?.workflow?.stages[0];
    const source = board?.workflow?.widgets.find((widget) => widget.kind === 'source');
    const category = board?.workflow?.widgets.find((widget) => widget.kind === 'category');
    expect(stage).toBeTruthy();
    expect(source).toBeTruthy();
    expect(category).toBeTruthy();

    await persist.persistPutBoard({
      ...board!,
      activeStageId: stage!.id,
      cards: board!.cards.map((card, index) => ({
        ...card,
        widgetAssignments: {
          ...(card.widgetAssignments || {}),
          [stage!.id]: {
            widgetId: category!.id,
            zoneId: 'content',
            order: index,
          },
        },
      })),
    });

    firstView.unmount();
    const view = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End sorting →' }));

    expect(await screen.findByText('Replay')).toBeTruthy();
    expect(view.container.querySelector('.board')).toBeTruthy();
    expect(view.container.querySelector('.closedFixedBoard')).toBeNull();
    expect(view.container.querySelector('[data-testid^="closed-container-"]')).toBeNull();
    expect(await screen.findByTestId(`surface-work-area-${source!.id}`)).toBeTruthy();
    expect(await screen.findByTestId(`surface-sink-${category!.id}-content`)).toBeTruthy();
  });
});
