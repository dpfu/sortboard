/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { seedTestProject } from './testFixtures/project';
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
    const button = screen.getByRole('button', { name: 'Start sorting' }) as HTMLButtonElement;
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
    await seedTestProject();
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

  it('requires a task and records a single round with the clean Q-Sort board', async () => {
    await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Q-Sort' }));
    expect(screen.queryByRole('group', { name: 'Setup stage' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting' }));
    expect(screen.getByRole('dialog', { name: 'Q-Sort design' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Finish round' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Task for round 1'), { target: { value: 'Which images would you keep?' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save design' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Start sorting' }));
    expect(await screen.findByRole('heading', { name: 'Which images would you keep?' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Finish round' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to Q-Sort' })).toBeNull();
    const { persist, activeProjectId } = await getActiveBoard();
    await waitFor(async () => {
      const sessions = await persist.persistListSessions(activeProjectId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].recording.surfaceLayoutVersion).toBe(4);
      expect(sessions[0].recording.studyRound?.design?.rounds).toHaveLength(1);
      expect(sessions[0].recording.workflowAtStart?.stages.map(s => s.kind)).toEqual(['qsort']);
    });
  });

  it('validates capacities in the common editor and keeps custom scale labels when fitting', async () => {
    await renderAppReady();
    await userEvent.click(screen.getByRole('button', { name: 'Q-Sort' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set up tasks and rounds' }));
    fireEvent.change(screen.getByLabelText('Task for round 1'), { target: { value: 'Rank these cards.' } });
    fireEvent.change(screen.getByLabelText('Label at position 1'), { target: { value: 'Strongly disagree' } });
    fireEvent.change(screen.getByLabelText('Places at position 1'), { target: { value: '0' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save design' }));
    expect(screen.getByRole('alert').textContent).toContain('places for 24 cards');
    await userEvent.click(screen.getByRole('button', { name: 'Fit to 24 cards' }));
    expect((screen.getByLabelText('Label at position 1') as HTMLInputElement).value).toBe('Strongly disagree');
    await userEvent.click(screen.getByRole('button', { name: 'Save design' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const { persist, activeProjectId } = await getActiveBoard();
    const project = (await persist.persistListProjects()).find(p => p.id === activeProjectId)!;
    expect(project.study?.scale.reduce((sum, s) => sum + s.capacity, 0)).toBe(24);
    expect(project.study?.scale[0].label).toBe('Strongly disagree');
  });
});
