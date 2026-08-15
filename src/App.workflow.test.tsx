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

describe('App sorting workflow', () => {
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

  it('starts sorting with auto-record and hides project controls in sorting mode', async () => {
    const { container } = await renderAppReady();
    const firstSetupCard = container.querySelector('.card') as HTMLElement;
    expect(firstSetupCard).toBeTruthy();
    await userEvent.click(firstSetupCard);
    expect(container.querySelector('.card.isSelected')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));

    await screen.findByRole('button', { name: '← Setup' });
    expect(screen.getByText('Recording · 0 actions')).toBeTruthy();
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(container.querySelector('.card--sort')).toBeTruthy();
    expect(container.querySelector('.card--setup')).toBeNull();
    expect(container.querySelector('.card.isSelected')).toBeNull();
    expect(container.querySelector('.card__chrome')).toBeNull();
  });

  it('hides project controls in replay mode', async () => {
    const { container } = await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End sorting →' }));

    await screen.findByText('Replay');
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(container.querySelector('.card--sort')).toBeTruthy();
    expect(container.querySelector('.card__chrome')).toBeNull();
  });

  it('asks confirmation before leaving sorting and respects cancel/confirm', async () => {
    await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));

    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValueOnce(false);
    await userEvent.click(await screen.findByRole('button', { name: '← Setup' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End sorting →' })).toBeTruthy();

    confirmSpy.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: '← Setup' }));
    await screen.findByRole('button', { name: 'Start sorting →' });
  });

  it('deletes discarded in-progress session from persistence', async () => {
    await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));

    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    expect(projectId).toBeTruthy();

    await waitFor(async () => {
      const rows = await persist.persistListSessions(projectId!);
      expect(rows.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByRole('button', { name: '← Setup' }));
    await screen.findByRole('button', { name: 'Start sorting →' });

    await waitFor(async () => {
      const rows = await persist.persistListSessions(projectId!);
      expect(rows).toHaveLength(0);
    }, { timeout: 3000 });
  });

  it('applies as-is layout mode in sorting and replay', async () => {
    const firstRender = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const board = await persist.persistGetBoard(projectId!);
    expect(board).toBeTruthy();

    const imageA = { id: 'img-a' };
    const imageB = { id: 'img-b' };
    await persist.persistPutAsset('asset-a', new Blob(['a'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('asset-b', new Blob(['b'], { type: 'image/png' }), 'image/png');

    await persist.persistPutBoard({
      ...board!,
      version: 2,
      cardLayoutMode: 'as-is',
      cards: [
        {
          id: imageA.id,
          kind: 'image',
          createdAt: 1,
          assetId: 'asset-a',
          x: 20,
          y: 20,
          z: 1,
          meta: { name: 'Image A', notes: '', tags: [], aspectRatio: 1 },
        },
        {
          id: imageB.id,
          kind: 'image',
          createdAt: 2,
          assetId: 'asset-b',
          x: 320,
          y: 20,
          z: 2,
          meta: { name: 'Image B', notes: '', tags: [], aspectRatio: 2 },
        },
      ],
    });

    firstRender.unmount();
    const secondRender = await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: '← Setup' });

    const sortCardA = secondRender.container.querySelector(`[data-testid="card-${imageA.id}"]`) as HTMLElement;
    const sortCardB = secondRender.container.querySelector(`[data-testid="card-${imageB.id}"]`) as HTMLElement;
    expect(sortCardA).toBeTruthy();
    expect(sortCardB).toBeTruthy();
    await waitFor(() => {
      expect(sortCardA.style.height).not.toBe(sortCardB.style.height);
    });

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));
    await screen.findByText('Replay');

    const replayCardA = secondRender.container.querySelector(`[data-testid="card-${imageA.id}"]`) as HTMLElement;
    const replayCardB = secondRender.container.querySelector(`[data-testid="card-${imageB.id}"]`) as HTMLElement;
    await waitFor(() => {
      expect(replayCardA.style.height).not.toBe(replayCardB.style.height);
    });
  });

  it('applies fixed 9:16 layout mode in sorting and replay', async () => {
    const firstRender = await renderAppReady();
    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    const board = await persist.persistGetBoard(projectId!);
    expect(board).toBeTruthy();

    await persist.persistPutBoard({
      ...board!,
      version: 2,
      cardLayoutMode: 'fixed-9-16',
      cards: [
        {
          id: 'img-portrait-1',
          kind: 'image',
          createdAt: 1,
          assetId: undefined,
          x: 20,
          y: 20,
          z: 1,
          meta: { name: 'Portrait 1', notes: '', tags: [], aspectRatio: 1.8 },
        },
        {
          id: 'txt-portrait-1',
          kind: 'text',
          createdAt: 2,
          x: 320,
          y: 20,
          z: 2,
          meta: { name: 'Card 2', notes: '', tags: [], frontText: 'Card 2', color: 'slate' },
        },
      ],
    });

    firstRender.unmount();
    const secondRender = await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting →' }));
    await screen.findByRole('button', { name: '← Setup' });

    const sortCard = secondRender.container.querySelector('[data-testid="card-img-portrait-1"]') as HTMLElement;
    expect(sortCard).toBeTruthy();
    await waitFor(() => {
      expect(sortCard.style.height).toBe('427px');
    });

    await userEvent.click(screen.getByRole('button', { name: 'End sorting →' }));
    await screen.findByText('Replay');

    const replayCard = secondRender.container.querySelector('[data-testid="card-img-portrait-1"]') as HTMLElement;
    await waitFor(() => {
      expect(replayCard.style.height).toBe('427px');
    });
  });
});
