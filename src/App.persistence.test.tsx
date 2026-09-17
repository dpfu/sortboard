/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { seedTestProject } from './testFixtures/project';
import * as React from 'react';
import JSZip from 'jszip';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const putBoardHooks = vi.hoisted(() => ({
  before: null as null | ((board: any) => void | Promise<void>),
  after: null as null | ((board: any) => void | Promise<void>),
}));
const putSessionHooks = vi.hoisted(() => ({
  before: null as null | ((session: any) => void | Promise<void>),
  after: null as null | ((session: any) => void | Promise<void>),
}));

vi.mock('./persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persist')>();
  return {
    ...actual,
    persistPutBoard: async (board: Parameters<typeof actual.persistPutBoard>[0]) => {
      await putBoardHooks.before?.(board);
      await actual.persistPutBoard(board);
      await putBoardHooks.after?.(board);
    },
    persistPutSession: async (session: Parameters<typeof actual.persistPutSession>[0]) => {
      await putSessionHooks.before?.(session);
      await actual.persistPutSession(session);
      await putSessionHooks.after?.(session);
    },
  };
});

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

let observedBoardWidth = 1200;
let observedBoardHeight = 800;

async function renderAppReady() {
  const { default: App } = await import('./App');
  const view = render(<App />);
  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Start sorting' }) as HTMLButtonElement;
    if (button.disabled) throw new Error('start sorting still disabled');
  }, { timeout: 5000 });
  return view;
}

function boardCardName(board: { cards: Array<{ meta?: { name?: string } }> }, cardId: string) {
  return board.cards.find((card: any) => card.id === cardId)?.meta?.name;
}

function firstCardIdentity(container: HTMLElement) {
  const card = container.querySelector('.card') as HTMLElement;
  expect(card).toBeTruthy();
  const testId = card.getAttribute('data-testid') || '';
  expect(testId).toMatch(/^card-/);
  return { card, cardId: testId.slice('card-'.length), testId };
}

describe('App pending persistence', () => {
  beforeAll(() => {
    class MockResizeObserver {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback(
          [{ contentRect: { width: observedBoardWidth, height: observedBoardHeight } } as ResizeObserverEntry],
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
    observedBoardWidth = 1200;
    observedBoardHeight = 800;
    putBoardHooks.before = null;
    putBoardHooks.after = null;
    putSessionHooks.before = null;
    putSessionHooks.after = null;
    const persist = await import('./persist');
    await persist.persistDeleteAll();
    await seedTestProject();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const blob = new Blob(['demo'], { type: 'image/svg+xml' });
      return new Response(blob, { status: 200 });
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    putBoardHooks.before = null;
    putBoardHooks.after = null;
    putSessionHooks.before = null;
    putSessionHooks.after = null;
    cleanup();
  });

  it('flushes the outgoing board to its own id before creating and switching projects', async () => {
    const view = await renderAppReady();
    const persist = await import('./persist');
    const originalProjectId = await persist.persistGetActiveProjectId();
    expect(originalProjectId).toBeTruthy();
    const { card, cardId, testId } = firstCardIdentity(view.container);

    await userEvent.click(card);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved in original project' } });
    await userEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Project menu' }) as HTMLButtonElement).disabled).toBe(false));

    await userEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    const projectSelect = await screen.findByLabelText('Select project') as HTMLSelectElement;
    await waitFor(() => expect(projectSelect.value).not.toBe(originalProjectId));
    const newProjectId = projectSelect.value;
    const originalBoard = await persist.persistGetBoard(originalProjectId!);
    const newBoard = await persist.persistGetBoard(newProjectId);
    expect(boardCardName(originalBoard!, cardId)).toBe('Saved in original project');
    expect(newBoard?.cards).toHaveLength(0);

    await userEvent.selectOptions(projectSelect, originalProjectId!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Project menu' }).getAttribute('title')).toBe('Test Project');
      expect(view.container.querySelector(`[data-testid="${testId}"]`)).toBeTruthy();
    });
    await userEvent.click(view.container.querySelector(`[data-testid="${testId}"]`) as HTMLElement);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Saved in original project');
  });

  it('persists the exact setup state before sorting changes mode', async () => {
    const view = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const { card, cardId } = firstCardIdentity(view.container);

    await userEvent.click(card);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sorting start snapshot' } });
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting' }));
    await screen.findByRole('button', { name: 'Finish sorting' });

    const board = await persist.persistGetBoard(projectId!);
    expect(boardCardName(board!, cardId)).toBe('Sorting start snapshot');
  });

  it('starts persistence before pagehide even when the board has no measurable size', async () => {
    observedBoardWidth = 0;
    observedBoardHeight = 0;
    const firstView = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const { card, cardId, testId } = firstCardIdentity(firstView.container);

    await userEvent.click(card);
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Survives immediate reload' } });
    window.dispatchEvent(new Event('pagehide'));
    firstView.unmount();

    await waitFor(async () => {
      const board = await persist.persistGetBoard(projectId!);
      expect(board?.cards.find((entry) => entry.id === cardId)?.meta?.notes).toBe('Survives immediate reload');
    });

    const secondView = await renderAppReady();
    await waitFor(() => expect(secondView.container.querySelector(`[data-testid="${testId}"]`)).toBeTruthy());
    await userEvent.click(secondView.container.querySelector(`[data-testid="${testId}"]`) as HTMLElement);
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Survives immediate reload');
  });

  it('flushes the latest metadata when pagehide follows the input commit immediately', async () => {
    const firstView = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const { card, cardId, testId } = firstCardIdentity(firstView.container);
    await userEvent.click(card);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Older in-flight snapshot' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Survives immediate reload' } });
    window.dispatchEvent(new Event('pagehide'));
    firstView.unmount();
    await waitFor(async () => {
      const board = await persist.persistGetBoard(projectId!);
      expect(boardCardName(board!, cardId)).toBe('Survives immediate reload');
    });

    const secondView = await renderAppReady();
    await waitFor(() => expect(secondView.container.querySelector(`[data-testid="${testId}"]`)).toBeTruthy());
    await userEvent.click(secondView.container.querySelector(`[data-testid="${testId}"]`) as HTMLElement);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Survives immediate reload');
    const board = await persist.persistGetBoard(projectId!);
    expect(boardCardName(board!, cardId)).toBe('Survives immediate reload');
  });

  it('does not let an older in-flight save overwrite the snapshot exported afterward', async () => {
    let exportedZip: Blob | null = null;
    let releaseStale!: () => void;
    let releaseLatest!: () => void;
    let markStaleStarted!: () => void;
    let markStaleFinished!: () => void;
    let markLatestStarted!: () => void;
    let markLatestFinished!: () => void;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const latestGate = new Promise<void>((resolve) => { releaseLatest = resolve; });
    const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
    const staleFinished = new Promise<void>((resolve) => { markStaleFinished = resolve; });
    const latestStarted = new Promise<void>((resolve) => { markLatestStarted = resolve; });
    const latestFinished = new Promise<void>((resolve) => { markLatestFinished = resolve; });
    let cardId = '';

    vi.spyOn(URL, 'createObjectURL').mockImplementation((value: Blob | MediaSource) => {
      if (value instanceof Blob && value.type === 'application/zip') exportedZip = value;
      return 'blob:test-export';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const view = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const identity = firstCardIdentity(view.container);
    cardId = identity.cardId;
    await userEvent.click(identity.card);

    putBoardHooks.before = async (board) => {
      const name = boardCardName(board, cardId);
      if (name === 'Stale snapshot') {
        markStaleStarted();
        await staleGate;
      }
      if (name === 'Latest snapshot') {
        markLatestStarted();
        await latestGate;
      }
    };
    putBoardHooks.after = (board) => {
      const name = boardCardName(board, cardId);
      if (name === 'Stale snapshot') markStaleFinished();
      if (name === 'Latest snapshot') markLatestFinished();
    };

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stale snapshot' } });
    await staleStarted;
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Latest snapshot' } });
    await userEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    const latestStartedBeforeRelease = await Promise.race([
      latestStarted.then(() => true),
      new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 50)),
    ]);
    releaseLatest();
    if (latestStartedBeforeRelease) await latestFinished;
    releaseStale();
    await staleFinished;

    await waitFor(() => expect(exportedZip).toBeTruthy());
    await latestFinished;
    const finalBoard = await persist.persistGetBoard(projectId!);
    expect(boardCardName(finalBoard!, cardId)).toBe('Latest snapshot');

    const zip = await JSZip.loadAsync(await exportedZip!.arrayBuffer());
    const boardRaw = await zip.file('board.json')?.async('string');
    const exportedBoard = JSON.parse(boardRaw!) as { cards: Array<{ id: string; meta?: { name?: string } }> };
    expect(boardCardName(exportedBoard, cardId)).toBe('Latest snapshot');
  });

  it('keeps the newest camera checkpoint when an older write completes afterward', async () => {
    await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting' }));
    await screen.findByRole('button', { name: 'Finish sorting' });
    await waitFor(async () => expect(await persist.persistListSessions(projectId!)).toHaveLength(1));

    let releaseOld!: () => void;
    let oldStarted!: () => void;
    let oldFinished!: () => void;
    const gate = new Promise<void>(resolve => { releaseOld = resolve; });
    const started = new Promise<void>(resolve => { oldStarted = resolve; });
    const finished = new Promise<void>(resolve => { oldFinished = resolve; });
    let blocked = false;
    putSessionHooks.before = async (session) => {
      if (!blocked && session.recording.cameraTrack.at(-1).viewportW === 1301) {
        blocked = true;
        oldStarted();
        await gate;
      }
    };
    putSessionHooks.after = session => {
      if (session.recording.cameraTrack.at(-1).viewportW === 1301) oldFinished();
    };

    const width = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1301 });
      fireEvent(window, new Event('resize'));
      fireEvent(window, new Event('pagehide'));
      await started;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1401 });
      fireEvent(window, new Event('resize'));
      fireEvent(window, new Event('pagehide'));
      await waitFor(async () => {
        expect((await persist.persistListSessions(projectId!))[0].recording.cameraTrack?.at(-1)?.viewportW).toBe(1401);
      });
      releaseOld();
      await finished;
      await waitFor(async () => {
        const track = (await persist.persistListSessions(projectId!))[0].recording.cameraTrack!;
        expect(track.at(-1)?.viewportW).toBe(1401);
        expect(track.some(frame => frame.viewportW === 1301)).toBe(true);
      });
    } finally {
      releaseOld();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});
