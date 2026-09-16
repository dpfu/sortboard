/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

async function resetDb() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('sortboard-mvp');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('App project creation', () => {
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
    await resetDb();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Demo project must not fetch media'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('creates and selects a new project from setup controls', async () => {
    const { default: App } = await import('./App');
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open starter board' }));
    await userEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    const select = screen.getByLabelText('Select project') as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.textContent)).toContain('Demo Project');
    });

    await userEvent.click(screen.getByRole('button', { name: 'New' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Project menu' }).getAttribute('title')).toBe('Project 2'));

    expect((screen.getByRole('button', { name: 'Start sorting' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('Add at least one card to begin.')).toBeTruthy();
    expect(screen.getByText('Your board is empty')).toBeTruthy();
    expect(screen.getByText('Add a text card, image, or video to get started.')).toBeTruthy();

    // The image library is optional; its failure does not block the local starter.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith('[projects] create start', expect.any(Object));
    await waitFor(() => {
      expect(console.info).toHaveBeenCalledWith('[projects] create success', expect.any(Object));
    });
  });
});
