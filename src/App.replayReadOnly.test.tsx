/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  persistDeleteAll,
  persistGetBoard,
  persistListSessions,
  persistPutBoard,
  persistPutProject,
  persistPutSession,
  persistSetActiveProjectId,
  type PersistedBoardV1,
} from './persist';
import type { CardData, RecordingSession } from './types';
import { createWorkflowForTemplate, WIDGET_ZONE_CONTENT } from './workflow';

type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
  animate?: { x?: number; y?: number };
  drag?: unknown;
  dragControls?: unknown;
  dragListener?: unknown;
  dragConstraints?: unknown;
  dragMomentum?: unknown;
  dragElastic?: unknown;
  transition?: unknown;
  whileDrag?: unknown;
  onDrag?: unknown;
  onDragStart?: unknown;
  onDragEnd?: unknown;
};

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, MotionDivProps>((props, ref) => {
      const {
        animate,
        drag: _drag,
        dragControls: _dragControls,
        dragListener: _dragListener,
        dragConstraints: _dragConstraints,
        dragMomentum: _dragMomentum,
        dragElastic: _dragElastic,
        transition: _transition,
        whileDrag: _whileDrag,
        onDrag: _onDrag,
        onDragStart: _onDragStart,
        onDragEnd: _onDragEnd,
        ...divProps
      } = props;
      return React.createElement('div', {
        ...divProps,
        ref,
        'data-replay-x': animate?.x,
        'data-replay-y': animate?.y,
      });
    }),
  },
  useMotionValue: () => ({ set: () => undefined }),
  useSpring: (value: unknown) => value,
  useReducedMotion: () => false,
  useDragControls: () => ({ start: () => undefined }),
}));

const PROJECT_ID = 'replay-read-only-project';
const LIVE_CARDS: CardData[] = [
  {
    id: 'card-alpha',
    kind: 'text',
    createdAt: 1,
    meta: { name: 'Live alpha', frontText: 'Live alpha', notes: '', tags: [], color: 'slate' },
    x: 42,
    y: 64,
    z: 1,
  },
  {
    id: 'card-beta',
    kind: 'text',
    createdAt: 2,
    meta: { name: 'Live beta', frontText: 'Live beta', notes: '', tags: [], color: 'mint' },
    x: 242,
    y: 164,
    z: 2,
  },
];

function cloneCards(cards: CardData[]) {
  return cards.map((card) => ({
    ...card,
    meta: { ...card.meta, tags: [...card.meta.tags] },
    widgetAssignments: card.widgetAssignments
      ? Object.fromEntries(
          Object.entries(card.widgetAssignments).map(([stageId, assignment]) => [
            stageId,
            assignment ? { ...assignment } : assignment,
          ])
        )
      : undefined,
  }));
}

function openRecording(id: string, startX: number, finalX: number, label: string): RecordingSession {
  const cardsAtStart = cloneCards(LIVE_CARDS).map((card, index) =>
    index === 0
      ? {
          ...card,
          meta: { ...card.meta, name: `${label} start`, frontText: `${label} start` },
          x: startX,
          y: 90,
        }
      : card
  );
  const lead = cardsAtStart[0]!;
  return {
    version: 5,
    createdAt: id,
    cardW: 180,
    cardH: 101,
    boardW: 1200,
    boardH: 800,
    sortConfig: { type: 'open' },
    cardLayoutModeAtStart: 'fixed-16-9',
    workflowAtStart: createWorkflowForTemplate('open', 1200, 800, cardsAtStart.length),
    cardsAtStart,
    segments: [
      {
        type: 'drag',
        id: `${id}-drag`,
        cardId: lead.id,
        t0: 0,
        t1: 30_000,
        from: { x: lead.x, y: lead.y },
        path: [
          [0, lead.x, lead.y],
          [15_000, (lead.x + finalX) / 2, lead.y + 80],
          [30_000, finalX, lead.y + 160],
        ],
        drop: { x: finalX, y: lead.y + 160 },
        final: { x: finalX, y: lead.y + 160 },
        settleMs: 0,
      },
    ],
  };
}

function qRecording(id: string) {
  const workflow = createWorkflowForTemplate('qsort', 1200, 800, LIVE_CARDS.length);
  const presortStage = workflow.stages.find((stage) => stage.kind === 'presort')!;
  const qsortStage = workflow.stages.find((stage) => stage.kind === 'qsort')!;
  const source = workflow.widgets.find(
    (widget) => widget.kind === 'source' && widget.stageId === presortStage.id
  )!;
  const qsort = workflow.widgets.find(
    (widget): widget is Extract<(typeof workflow.widgets)[number], { kind: 'qsort' }> =>
      widget.kind === 'qsort' && widget.stageId === qsortStage.id
  )!;
  const cardsAtStart = cloneCards(LIVE_CARDS).map((card, index) => ({
    ...card,
    x: 80 + index * 30,
    y: 120 + index * 20,
    widgetAssignments: {
      [presortStage.id]: {
        widgetId: source.id,
        zoneId: WIDGET_ZONE_CONTENT,
        order: index,
      },
    },
  }));
  const finalCards = cardsAtStart.map((card, index) => ({
    ...card,
    x: 520 + index * 120,
    y: 310,
  }));

  const recording: RecordingSession = {
    version: 5,
    createdAt: id,
    cardW: 180,
    cardH: 101,
    boardW: 1200,
    boardH: 800,
    sortConfig: { type: 'qsort' },
    cardLayoutModeAtStart: 'fixed-16-9',
    workflowAtStart: workflow,
    activeStageIdAtStart: presortStage.id,
    cardsAtStart,
    segments: [
      {
        type: 'stage-transition',
        id: `${id}-stage-transition`,
        fromStageId: presortStage.id,
        toStageId: qsortStage.id,
        t0: 30_000,
        t1: 30_000,
        members: cardsAtStart.map((card, index) => ({
          cardId: card.id,
          from: { x: card.x, y: card.y },
          final: { x: finalCards[index]!.x, y: finalCards[index]!.y },
        })),
        widgetAssignmentChanges: cardsAtStart.map((card, index) => ({
          cardId: card.id,
          stageId: qsortStage.id,
          assignment: {
            widgetId: qsort.id,
            zoneId: qsort.lanes[index % qsort.lanes.length]!.id,
            order: index,
          },
        })),
        settleMs: 0,
      },
    ],
  };

  return { recording, workflow, presortStage, qsortStage, source, qsort };
}

async function seedProject(recordings: RecordingSession[] = []) {
  const now = 1_800_000_000_000;
  const board: PersistedBoardV1 = {
    version: 2,
    id: PROJECT_ID,
    updatedAt: now,
    sortConfig: { type: 'open' },
    cardW: 180,
    cardH: 101,
    cardLayoutMode: 'fixed-16-9',
    stacks: [],
    workflow: createWorkflowForTemplate('open', 1200, 800, LIVE_CARDS.length),
    cards: cloneCards(LIVE_CARDS),
    activeSessionId: recordings.at(-1)?.createdAt,
  };

  await persistPutProject({
    version: 1,
    id: PROJECT_ID,
    name: 'Replay regression project',
    createdAt: now,
    updatedAt: now,
  });
  await persistPutBoard(board);
  for (const [index, recording] of recordings.entries()) {
    await persistPutSession({
      version: 1,
      id: recording.createdAt,
      boardId: PROJECT_ID,
      updatedAt: now + index + 1,
      recording,
    });
  }
  await persistSetActiveProjectId(PROJECT_ID);
}

async function renderAppReady() {
  const { default: App } = await import('./App');
  const view = render(<App />);
  await waitFor(
    () => {
      const button = screen.getByRole('button', { name: 'Start sorting →' }) as HTMLButtonElement;
      if (button.disabled) throw new Error('start sorting still disabled');
    },
    { timeout: 5000 }
  );
  return view;
}

async function enterReplay() {
  await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
  await userEvent.click(await screen.findByRole('button', { name: 'End sorting →' }));
  await screen.findByText('Replay');
}

function displayedCardPosition(cardId: string) {
  const card = screen.getByTestId(`card-${cardId}`);
  return {
    x: Number(card.getAttribute('data-replay-x')),
    y: Number(card.getAttribute('data-replay-y')),
  };
}

function boardContent(board: Awaited<ReturnType<typeof persistGetBoard>>) {
  if (!board) return null;
  return {
    sortConfig: board.sortConfig,
    cardW: board.cardW,
    cardH: board.cardH,
    cardLayoutMode: board.cardLayoutMode,
    stacks: board.stacks,
    workflow: board.workflow,
    activeStageId: board.activeStageId,
    activeSessionId: board.activeSessionId,
    cards: board.cards,
  };
}

function sessionContent(sessions: Awaited<ReturnType<typeof persistListSessions>>) {
  return sessions.map((session) => ({
    id: session.id,
    boardId: session.boardId,
    recording: session.recording,
  }));
}

async function scrubReplay(fraction: number) {
  const timeline = await screen.findByTestId('replay-timeline');
  timeline.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.pointerDown(timeline, { pointerId: 1, clientX: fraction * 100, buttons: 1 });
}

describe('App replay read-only behavior', () => {
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

    (globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = MockResizeObserver as never;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      HTMLCanvasElement.prototype.setPointerCapture = () => undefined;
    }
  });

  beforeEach(async () => {
    await persistDeleteAll();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['image']), { status: 200 }));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          setTransform: () => undefined,
          clearRect: () => undefined,
          fillRect: () => undefined,
          beginPath: () => undefined,
          moveTo: () => undefined,
          lineTo: () => undefined,
          stroke: () => undefined,
        }) as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the persisted live Open board unchanged across playback, scrubbing, Stop, session changes, and reload', async () => {
    const olderId = '2026-01-01T00:00:01.000Z';
    const newerId = '2026-01-01T00:00:02.000Z';
    await seedProject([
      openRecording(olderId, 310, 510, 'Older'),
      openRecording(newerId, 610, 810, 'Newer'),
    ]);
    const firstView = await renderAppReady();
    await enterReplay();
    await waitFor(async () => {
      expect(await persistListSessions(PROJECT_ID)).toHaveLength(3);
    });
    const baseline = boardContent(await persistGetBoard(PROJECT_ID));
    const sessionBaseline = sessionContent(await persistListSessions(PROJECT_ID));

    await userEvent.click(screen.getByTitle(olderId));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await scrubReplay(0.5);
    await waitFor(() => expect(displayedCardPosition('card-alpha').x).toBe(410));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to start' }));

    await userEvent.click(screen.getByTitle(newerId));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await scrubReplay(0.75);
    await waitFor(() => expect(displayedCardPosition('card-alpha').x).toBe(760));

    window.dispatchEvent(new Event('pagehide'));
    await waitFor(async () => {
      expect(boardContent(await persistGetBoard(PROJECT_ID))).toEqual(baseline);
      expect(sessionContent(await persistListSessions(PROJECT_ID))).toEqual(sessionBaseline);
    });
    firstView.unmount();

    expect(boardContent(await persistGetBoard(PROJECT_ID))).toEqual(baseline);
    expect(sessionContent(await persistListSessions(PROJECT_ID))).toEqual(sessionBaseline);

    await renderAppReady();
    expect(displayedCardPosition('card-alpha')).toEqual({ x: LIVE_CARDS[0]!.x, y: LIVE_CARDS[0]!.y });
    expect(screen.getAllByText('Live alpha').length).toBeGreaterThan(0);
  });

  it('shows each selected session at its start snapshot immediately', async () => {
    const olderId = '2026-01-02T00:00:01.000Z';
    const newerId = '2026-01-02T00:00:02.000Z';
    await seedProject([
      openRecording(olderId, 330, 530, 'Older'),
      openRecording(newerId, 630, 830, 'Newer'),
    ]);
    await renderAppReady();
    await enterReplay();

    await userEvent.click(screen.getByTitle(olderId));
    await waitFor(() => {
      expect(displayedCardPosition('card-alpha')).toEqual({ x: 330, y: 90 });
      expect(screen.getByText('Older start')).toBeTruthy();
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:00.000');
    });

    const timeline = screen.getByRole('slider', { name: 'Replay timeline' });
    expect(timeline.getAttribute('aria-valuetext')).toBe('00:00.000');
    fireEvent.keyDown(timeline, { key: 'End' });
    await waitFor(() => {
      expect(displayedCardPosition('card-alpha')).toEqual({ x: 530, y: 250 });
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:30.000');
    });
    fireEvent.keyDown(timeline, { key: 'Home' });
    await waitFor(() => {
      expect(displayedCardPosition('card-alpha')).toEqual({ x: 330, y: 90 });
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:00.000');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Pause' });
    await userEvent.click(screen.getByTitle(newerId));
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    await waitFor(() => {
      expect(displayedCardPosition('card-alpha')).toEqual({ x: 630, y: 90 });
      expect(screen.getByText('Newer start')).toBeTruthy();
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:00.000');
    });
  });

  it('resets replay time, cards, workflow, and active stage to the session start on Stop', async () => {
    const sessionId = '2026-01-03T00:00:01.000Z';
    const seeded = qRecording(sessionId);
    await seedProject([seeded.recording]);
    await renderAppReady();
    await enterReplay();
    await waitFor(async () => {
      expect(await persistListSessions(PROJECT_ID)).toHaveLength(2);
    });
    const boardBaseline = boardContent(await persistGetBoard(PROJECT_ID));
    const sessionBaseline = sessionContent(await persistListSessions(PROJECT_ID));

    await userEvent.click(screen.getByTitle(sessionId));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await scrubReplay(1);

    await waitFor(() => {
      expect(screen.getByTestId(`surface-qsort-${seeded.qsort.id}`)).toBeTruthy();
      expect(displayedCardPosition('card-alpha')).not.toEqual({
        x: seeded.recording.cardsAtStart[0]!.x,
        y: seeded.recording.cardsAtStart[0]!.y,
      });
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:30.000');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Pause' });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to start' }));
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    await waitFor(() => {
      expect(document.querySelector('.replayTimeLabel')?.textContent).toBe('00:00.000');
      expect(displayedCardPosition('card-alpha')).toEqual({
        x: seeded.recording.cardsAtStart[0]!.x,
        y: seeded.recording.cardsAtStart[0]!.y,
      });
      expect(screen.getByTestId(`surface-work-area-${seeded.source.id}`)).toBeTruthy();
      expect(screen.queryByTestId(`surface-qsort-${seeded.qsort.id}`)).toBeNull();
    });
    expect(boardContent(await persistGetBoard(PROJECT_ID))).toEqual(boardBaseline);
    expect(sessionContent(await persistListSessions(PROJECT_ID))).toEqual(sessionBaseline);
  });

  it('treats the literal session snapshot as time zero even when a transition is recorded at zero', async () => {
    const seeded = qRecording('2026-01-03T00:00:02.000Z');
    seeded.recording.segments = seeded.recording.segments.map((segment) => ({
      ...segment,
      t0: 0,
      t1: 0,
    }));
    await seedProject([seeded.recording]);
    await renderAppReady();
    await enterReplay();

    await userEvent.click(screen.getByTitle(seeded.recording.createdAt));
    await waitFor(() => {
      expect(displayedCardPosition('card-alpha')).toEqual({
        x: seeded.recording.cardsAtStart[0]!.x,
        y: seeded.recording.cardsAtStart[0]!.y,
      });
      expect(screen.getByTestId(`surface-work-area-${seeded.source.id}`)).toBeTruthy();
      expect(screen.queryByTestId(`surface-qsort-${seeded.qsort.id}`)).toBeNull();
    });
  });

  it('records Q-Sort from the real Pre-Sort stage even when the Q-Sort setup tab was open', async () => {
    await seedProject();
    await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Q-Sort' }));

    const qStageTab = screen.getAllByRole('button', { name: 'Q-Sort' }).at(-1)!;
    await userEvent.click(qStageTab);
    await waitFor(() => expect(document.querySelector('[data-testid^="surface-qsort-"]')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: 'Next stage →' });

    await waitFor(async () => {
      const sessions = await persistListSessions(PROJECT_ID);
      expect(sessions).toHaveLength(1);
      const recording = sessions[0]!.recording;
      const presortStage = recording.workflowAtStart?.stages.find((stage) => stage.kind === 'presort');
      const source = recording.workflowAtStart?.widgets.find(
        (widget) => widget.kind === 'source' && widget.stageId === presortStage?.id
      );
      expect(presortStage).toBeTruthy();
      expect(recording.activeStageIdAtStart).toBe(presortStage!.id);
      expect(recording.cardsAtStart.every((card) => card.widgetAssignments?.[presortStage!.id]?.widgetId === source?.id)).toBe(
        true
      );
    });
  });
});
