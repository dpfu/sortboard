/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { seedTestProject } from './testFixtures/project';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    const persist = await import('./persist');
    await persist.persistDeleteAll();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Demo project must not fetch media'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('creates and selects a new project from setup controls', async () => {
    const { default: App } = await import('./App');
    render(<App />);

    const welcome = await screen.findByRole('dialog', { name: 'Welcome to SortBoard' }, { timeout: 5000 });
    const persist = await import('./persist');
    expect(await persist.persistListProjects()).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await userEvent.click(within(welcome).getByRole('button', { name: /Start with a blank project/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project menu' }).getAttribute('title')).toBe('Project 1'));
    expect(await persist.persistListProjects()).toHaveLength(1);
    expect((await persist.persistGetBoard((await persist.persistGetActiveProjectId())!))?.cards).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    const select = screen.getByLabelText('Select project') as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.textContent)).toContain('Project 1');
    });

    await userEvent.click(screen.getByRole('button', { name: 'New' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Project menu' }).getAttribute('title')).toBe('Project 2'));

    expect((screen.getByRole('button', { name: 'Start sorting' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('Add at least one card to begin.')).toBeTruthy();
    expect(screen.getByText('Your board is empty')).toBeTruthy();
    expect(screen.getByText('Add a text card, image, or video to get started.')).toBeTruthy();

    // Choosing a blank project never loads the optional demo library.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith('[projects] create start', expect.any(Object));
    await waitFor(() => {
      expect(console.info).toHaveBeenCalledWith('[projects] create success', expect.any(Object));
    });
  }, 10000);

  it('returns to the welcome choices when the optional demo library fails', async () => {
    const { default: App } = await import('./App');
    render(<App />);
    const welcome = await screen.findByRole('dialog', { name: 'Welcome to SortBoard' }, { timeout: 5000 });
    await userEvent.click(within(welcome).getByRole('button', { name: /Start with a demo project/ }));
    const demos = await screen.findByRole('dialog', { name: 'Demo projects' }, { timeout: 5000 });
    expect(await within(demos).findByRole('alert')).toBeTruthy();
    await userEvent.click(within(demos).getByRole('button', { name: 'Back to welcome' }));
    await screen.findByRole('dialog', { name: 'Welcome to SortBoard' });
    const persist = await import('./persist');
    expect(await persist.persistListProjects()).toHaveLength(0);
  }, 10000);

  it('preserves an existing old demo project and its edited cards without showing welcome', async () => {
    await seedTestProject();
    const persist = await import('./persist');
    const project = (await persist.persistListProjects())[0];
    await persist.persistPutProject({ ...project, name: 'Demo Project' });
    const board = (await persist.persistGetBoard(project.id))!;
    board.cards[0].meta.name = 'My edited image';
    await persist.persistPutBoard(board);
    const { default: App } = await import('./App');
    const view = render(<App />);
    await waitFor(() => expect(view.container.querySelectorAll('.card')).toHaveLength(24), { timeout: 5000 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Project menu' }).getAttribute('title')).toBe('Demo Project');
    expect(screen.getByRole('button', { name: 'Demo projects' })).toBeTruthy();
    expect((await persist.persistGetBoard(project.id))!.cards[0].meta.name).toBe('My edited image');
    expect(await persist.persistListProjects()).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 10000);

});
