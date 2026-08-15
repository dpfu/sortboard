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
  return { persist, activeProjectId, board };
}

describe('App qsort workflow', () => {
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

  it('advances from pre-sort into q-sort and swaps the visible stage surface', async () => {
    const firstView = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Q-Sort' }));

    const { persist, activeProjectId } = await getActiveBoard();
    let board = await persist.persistGetBoard(activeProjectId);
    await waitFor(async () => {
      board = await persist.persistGetBoard(activeProjectId);
      expect(board?.workflow?.templateId).toBe('qsort');
    });
    if (!board) {
      throw new Error('missing qsort board');
    }
    const qsortBoard = board;
    expect(qsortBoard.workflow?.templateId).toBe('qsort');

    const presortStage = qsortBoard.workflow!.stages.find((stage) => stage.kind === 'presort')!;
    const qsortStage = qsortBoard.workflow!.stages.find((stage) => stage.kind === 'qsort')!;
    const presortWidget = qsortBoard.workflow!.widgets.find(
      (widget): widget is Extract<(typeof qsortBoard.workflow.widgets)[number], { kind: 'pre-sort' }> =>
        widget.kind === 'pre-sort' && widget.stageId === presortStage.id
    )!;
    const qsortWidget = qsortBoard.workflow!.widgets.find(
      (widget): widget is Extract<(typeof qsortBoard.workflow.widgets)[number], { kind: 'qsort' }> =>
        widget.kind === 'qsort' && widget.stageId === qsortStage.id
    )!;

    await persist.persistPutBoard({
      ...qsortBoard,
      version: 2,
      activeStageId: presortStage.id,
      cards: qsortBoard.cards.map((card, index) => ({
        ...card,
        widgetAssignments: {
          ...(card.widgetAssignments || {}),
          [presortStage.id]: {
            widgetId: presortWidget.id,
            zoneId: index % 2 === 0 ? presortWidget.zones[0]!.id : presortWidget.zones[1]!.id,
            order: Math.floor(index / 2),
          },
        },
      })),
    });

    firstView.unmount();
    const secondView = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    expect(await screen.findByRole('button', { name: 'Next stage →' })).toBeTruthy();
    expect(await screen.findByTestId(`surface-work-area-${qsortBoard.workflow!.widgets.find((widget) => widget.kind === 'source' && widget.stageId === presortStage.id)!.id}`)).toBeTruthy();
    expect(await screen.findByTestId(`surface-sink-${presortWidget.id}-${presortWidget.zones[0]!.id}`)).toBeTruthy();
    expect(await screen.findByTestId(`surface-sink-${presortWidget.id}-${presortWidget.zones[1]!.id}`)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Next stage →' }));

    await waitFor(() => {
      expect(secondView.container.querySelector(`[data-testid="surface-sink-${presortWidget.id}-${presortWidget.zones[0]!.id}"]`)).toBeNull();
    });
    expect(await screen.findByTestId(`surface-qsort-${qsortWidget.id}`)).toBeTruthy();
    expect(await screen.findByTestId(`qsort-rail-${qsortWidget.id}`)).toBeTruthy();
    expect(await screen.findByTestId(`qsort-distribution-${qsortWidget.id}`)).toBeTruthy();
    expect(secondView.container.querySelector(`.widgetZone--bucket`)).toBeNull();
    expect(secondView.container.querySelector(`[data-testid^="qsort-slot-${qsortWidget.id}-"]`)).toBeTruthy();
    await waitFor(() => {
      const boardElement = secondView.container.querySelector('.board') as HTMLDivElement | null;
      expect(boardElement).toBeTruthy();
      expect((boardElement?.scrollLeft || 0)).toBeGreaterThan(0);
    });

    const centerBucket = qsortWidget.buckets[Math.floor(qsortWidget.buckets.length / 2)]!;
    const edgeBucket = qsortWidget.buckets[0]!;
    const centerColumn = await screen.findByTestId(`qsort-column-${qsortWidget.id}-${centerBucket.id}`);
    const edgeColumn = await screen.findByTestId(`qsort-column-${qsortWidget.id}-${edgeBucket.id}`);
    expect(parseFloat(centerColumn.style.height)).toBeGreaterThan(parseFloat(edgeColumn.style.height));
    expect(screen.getByRole('button', { name: 'End sorting →' })).toBeTruthy();

    expect(activeProjectId).toBeTruthy();
  });

  it('explains and blocks a Q-Sort whose distribution is too small', async () => {
    await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Q-Sort' }));
    const qSortStageButton = screen.getAllByRole('button', { name: 'Q-Sort' }).at(-1)!;
    await userEvent.click(qSortStageButton);

    const capacityInputs = await screen.findAllByLabelText(/^Capacity for /);
    const firstLabel = screen.getByLabelText('Label for scale position 1') as HTMLInputElement;
    fireEvent.change(firstLabel, { target: { value: 'Strongly disagree' } });
    const positiveCapacity = capacityInputs.find((input) => Number((input as HTMLInputElement).value) > 0) as
      | HTMLInputElement
      | undefined;
    expect(positiveCapacity).toBeTruthy();
    fireEvent.change(positiveCapacity!, { target: { value: '0' } });

    await waitFor(() => {
      const start = screen.getByRole('button', { name: 'Start sorting →' }) as HTMLButtonElement;
      expect(start.disabled).toBe(true);
      expect(screen.getByText(/The distribution has \d+ places for 24 cards\. Open the Q-Sort stage/)).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate distribution' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Start sorting →' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByLabelText('Label for scale position 1') as HTMLInputElement).value).toBe('Strongly disagree');
    });
  });
});
