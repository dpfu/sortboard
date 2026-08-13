/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockViewportWidth = 1400;

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

describe('App setup details panel', () => {
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
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 1120px)' ? mockViewportWidth <= 1120 : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  beforeEach(async () => {
    mockViewportWidth = 1400;
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

  it('shows selected card details and clears selection on board background click', async () => {
    const { container } = await renderAppReady();
    expect(screen.getByText('Select an item on the board to edit its details.')).toBeTruthy();
    const board = container.querySelector('.board') as HTMLElement;
    expect(board.classList.contains('board--hasSelection')).toBe(false);

    const firstCard = container.querySelector('.card') as HTMLElement;
    expect(firstCard).toBeTruthy();
    await userEvent.click(firstCard);
    expect(board.classList.contains('board--hasSelection')).toBe(true);

    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByText('Card')).toBeTruthy();

    fireEvent.pointerDown(board, { pointerId: 1, button: 0, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(board, { pointerId: 1, button: 0, clientX: 900, clientY: 700 });
    expect(screen.getByText('Select an item on the board to edit its details.')).toBeTruthy();
    expect(board.classList.contains('board--hasSelection')).toBe(false);
  });

  it('does not render per-card delete buttons', async () => {
    const { container } = await renderAppReady();
    expect(container.querySelector('.card__delete')).toBeNull();
  });

  it('renders setup hover chip content and no card index delete chrome', async () => {
    const { container } = await renderAppReady();
    await waitFor(() => {
      expect(container.querySelector('.card__tag')?.textContent).toBe('Demo 1');
    });
    const chip = container.querySelector('.card__tag');
    expect(chip?.textContent).not.toContain('#');
  });

  it('supports as-is, fixed 16:9, and fixed 9:16 layout modes with persisted project setting', async () => {
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
      cardLayoutMode: 'as-is',
      cards: [
        {
          id: imageA.id,
          kind: 'image',
          assetId: 'asset-a',
          x: 20,
          y: 20,
          z: 1,
          meta: { name: 'Image A', notes: '', tags: [], aspectRatio: 1 },
        },
        {
          id: imageB.id,
          kind: 'image',
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

    const cardA = secondRender.container.querySelector(`[data-testid="card-${imageA.id}"]`) as HTMLElement;
    const cardB = secondRender.container.querySelector(`[data-testid="card-${imageB.id}"]`) as HTMLElement;
    expect(cardA).toBeTruthy();
    expect(cardB).toBeTruthy();

    await waitFor(() => {
      expect(cardA.style.height).not.toBe(cardB.style.height);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Fixed 16:9' }));

    await waitFor(() => {
      expect(cardA.style.height).toBe(cardB.style.height);
      expect(cardA.style.height).toBe('135px');
    });

    await waitFor(async () => {
      const updated = await persist.persistGetBoard(projectId!);
      expect(updated?.cardLayoutMode).toBe('fixed-16-9');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Fixed 9:16' }));

    await waitFor(() => {
      expect(cardA.style.height).toBe(cardB.style.height);
      expect(cardA.style.height).toBe('427px');
    });

    await waitFor(async () => {
      const updated = await persist.persistGetBoard(projectId!);
      expect(updated?.cardLayoutMode).toBe('fixed-9-16');
    });
  });

  it('persists metadata edits across reload', async () => {
    const firstRender = await renderAppReady();
    const firstCard = firstRender.container.querySelector('.card') as HTMLElement;
    const cardTestId = firstCard.getAttribute('data-testid') || '';
    const cardId = cardTestId.replace('card-', '');
    expect(cardTestId).toContain('card-');

    await userEvent.click(firstCard);
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    const notesInput = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    const tagsInput = screen.getByLabelText('Tags') as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Edited Card' } });
    fireEvent.change(notesInput, { target: { value: 'A detailed note' } });
    fireEvent.change(tagsInput, { target: { value: 'alpha, beta' } });

    await waitFor(() => {
      expect(nameInput.value).toBe('Edited Card');
      expect(notesInput.value).toBe('A detailed note');
      expect(tagsInput.value).toBe('alpha, beta');
    });

    const persist = await import('./persist');
    const projectId = await persist.persistGetActiveProjectId();
    await waitFor(async () => {
      const board = await persist.persistGetBoard(projectId!);
      const updated = board?.cards.find((card) => card.id === cardId);
      expect(updated?.meta?.name).toBe('Edited Card');
      expect(updated?.meta?.notes).toBe('A detailed note');
      expect(updated?.meta?.tags).toEqual(['alpha', 'beta']);
    }, { timeout: 2500 });

    firstRender.unmount();
    const secondRender = await renderAppReady();
    const sameCard = secondRender.container.querySelector(`[data-testid="${cardTestId}"]`) as HTMLElement;
    await userEvent.click(sameCard);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Edited Card');
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('A detailed note');
    expect((screen.getByLabelText('Tags') as HTMLInputElement).value).toBe('alpha, beta');
  });

  it('keeps the docked details panel at medium setup widths', async () => {
    mockViewportWidth = 1200;
    const view = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add category' }));

    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(view.container.querySelector('.detailsPanel--drawer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('shows a closable drawer with backdrop at narrow setup widths', async () => {
    mockViewportWidth = 1000;
    const view = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: 'Closed sort' }));
    const addCategory = await screen.findByRole('button', { name: 'Add category' });
    await userEvent.click(addCategory);

    const close = screen.getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(view.container.querySelector('.detailsPanel--drawer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close details panel' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(view.container.querySelector('.detailsPanel--drawer')).toBeNull();
      expect(document.activeElement).toBe(addCategory);
    });
  });

  it('deletes selected card from details panel only after confirmation', async () => {
    const { container } = await renderAppReady();
    const initialCount = container.querySelectorAll('.card').length;
    const firstCard = container.querySelector('.card') as HTMLElement;
    await userEvent.click(firstCard);

    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    expect(container.querySelectorAll('.card').length).toBe(initialCount);

    confirmSpy.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    await waitFor(() => {
      expect(container.querySelectorAll('.card').length).toBe(initialCount - 1);
      expect(screen.getByText('Select an item on the board to edit its details.')).toBeTruthy();
    });
  });

  it('undo reverses metadata edits', async () => {
    const { container } = await renderAppReady();
    const firstCard = container.querySelector('.card') as HTMLElement;
    await userEvent.click(firstCard);

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    const original = nameInput.value;
    await userEvent.type(nameInput, 'xyz');
    expect(nameInput.value).toBe(`${original}xyz`);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(original);
    });
  });

  it('creates text cards and persists front text/color edits with undo', async () => {
    const { container } = await renderAppReady();

    await userEvent.click(screen.getByRole('button', { name: '+ Text card' }));

    const createdCard = await waitFor(async () => {
      const board = await getActiveBoard();
      const textCards = board.cards.filter((card) => card.kind === 'text');
      expect(textCards.length).toBeGreaterThan(0);
      return textCards[textCards.length - 1];
    });
    if (!createdCard.meta) {
      throw new Error('expected created text card to include metadata');
    }
    const createdCardName = createdCard.meta.name;

    expect(createdCardName).toMatch(/^Card \d+$/);
    expect(createdCard.meta.frontText).toBe(createdCardName);
    expect(createdCard.meta.color).toBe('slate');

    const createdCardEl = container.querySelector(`[data-testid="card-${createdCard.id}"]`) as HTMLElement;
    expect(createdCardEl).toBeTruthy();
    await userEvent.click(createdCardEl);

    const frontTextInput = screen.getByLabelText('Text on card') as HTMLInputElement;
    const colorSelect = screen.getByLabelText('Color') as HTMLSelectElement;
    expect(frontTextInput.value).toBe(createdCardName);
    expect(colorSelect.value).toBe('slate');

    fireEvent.change(frontTextInput, { target: { value: 'Priority A' } });
    fireEvent.change(colorSelect, { target: { value: 'rose' } });

    await waitFor(() => {
      expect((screen.getByLabelText('Text on card') as HTMLInputElement).value).toBe('Priority A');
      expect((screen.getByLabelText('Color') as HTMLSelectElement).value).toBe('rose');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect((screen.getByLabelText('Text on card') as HTMLInputElement).value).toBe('Priority A');
      expect((screen.getByLabelText('Color') as HTMLSelectElement).value).toBe('slate');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect((screen.getByLabelText('Text on card') as HTMLInputElement).value).toBe(createdCardName);
      expect((screen.getByLabelText('Color') as HTMLSelectElement).value).toBe('slate');
    });
  });

  it('supports lasso multi-select and shift toggling in setup', async () => {
    const { container } = await renderAppReady();
    const board = container.querySelector('.board') as HTMLElement;
    expect(board).toBeTruthy();

    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(board, { pointerId: 21, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(board, { pointerId: 21, clientX: 280, clientY: 240 });
    fireEvent.pointerUp(board, { pointerId: 21, button: 0, clientX: 280, clientY: 240 });

    await waitFor(() => {
      const selected = container.querySelectorAll('.card.isSelected');
      expect(selected.length).toBeGreaterThan(1);
      expect(screen.getByText(/\d+ cards selected\./i)).toBeTruthy();
    });

    const selectedBeforeToggle = container.querySelectorAll('.card.isSelected').length;
    const selectedCard = container.querySelector('.card.isSelected') as HTMLElement;
    expect(selectedCard).toBeTruthy();

    // Clicking one selected card without shift should keep multi-selection
    // so a subsequent drag can move the entire selected group.
    fireEvent.pointerDown(selectedCard, { button: 0 });
    await waitFor(() => {
      const selected = container.querySelectorAll('.card.isSelected');
      expect(selected.length).toBe(selectedBeforeToggle);
    });

    fireEvent.pointerDown(selectedCard, { button: 0, shiftKey: true });

    await waitFor(() => {
      const selected = container.querySelectorAll('.card.isSelected');
      expect(selected.length).toBe(selectedBeforeToggle - 1);
    });
  });
});
