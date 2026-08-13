/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import JSZip from 'jszip';
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

describe('App project export', () => {
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

  it('exports the latest board state without relying on background autosave timing', async () => {
    let exportedZip: Blob | null = null;
    let objectUrlCount = 0;

    vi.spyOn(URL, 'createObjectURL').mockImplementation((value: Blob | MediaSource) => {
      if (value instanceof Blob && value.type === 'application/zip') {
        exportedZip = value;
      }
      return `blob:test-${objectUrlCount += 1}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const { container } = await renderAppReady();
    const firstCard = container.querySelector('.card') as HTMLElement;
    expect(firstCard).toBeTruthy();

    await userEvent.click(firstCard);
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Exported Name' } });
    expect(nameInput.value).toBe('Exported Name');

    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(exportedZip).toBeTruthy();
    });

    const zip = await JSZip.loadAsync(await exportedZip!.arrayBuffer());
    const boardRaw = await zip.file('board.json')?.async('string');
    expect(boardRaw).toBeTruthy();
    const board = JSON.parse(boardRaw!) as { cards: Array<{ meta?: { name?: string } }> };
    expect(board.cards.some((card) => card.meta?.name === 'Exported Name')).toBe(true);
  });
});
