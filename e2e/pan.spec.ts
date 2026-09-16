import { openProjectMenu, openReplayView } from './helpers/app';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { cards, dragMouseFromTo, openFreshApp } from './helpers/app';

const scroll = (board: Locator) => board.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
const positions = (page: Page) => cards(page).evaluateAll(elements => elements.map(el => {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { id: el.getAttribute('data-testid'), x: matrix.m41, y: matrix.m42 };
}));
async function center(card: Locator) {
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function blankPoint(board: Locator) {
  return board.evaluate(el => {
    const box = el.getBoundingClientRect();
    for (let y = box.bottom - 100; y > box.top + 20; y -= 50) {
      for (let x = box.right - 120; x > box.left + 20; x -= 50) {
        if (document.elementFromPoint(x, y)?.hasAttribute('data-board-background')) return { x, y };
      }
    }
    throw new Error('Missing empty board space');
  });
}
async function expectScroll(board: Locator, expected: { x: number; y: number }) {
  await expect.poll(async () => {
    const actual = await scroll(board);
    return Math.hypot(actual.x - expected.x, actual.y - expected.y);
  }).toBeLessThan(2);
}

test('pans the setup at 100%, keeps card positions and selection, and centers the board', async ({ page }) => {
  await openFreshApp(page);
  const board = page.getByTestId('board-root');
  const card = cards(page).last();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const before = await scroll(board);
  const originalCards = await positions(page);
  const point = await blankPoint(board);
  await page.mouse.move(point.x, point.y);
  await expect(board).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await expect(board).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(point.x + 90, point.y + 70, { steps: 6 });
  await page.mouse.up();
  await expectScroll(board, { x: before.x - 90, y: before.y - 70 });
  expect(await positions(page)).toEqual(originalCards);
  await expect(card).toHaveAttribute('aria-pressed', 'true');

  // This starts outside the original canvas, in the camera gutter.
  const box = await board.boundingBox();
  if (!box) throw new Error('Missing board');
  await dragMouseFromTo(page, { x: box.x + 15, y: box.y + 15 }, { x: box.x + 70, y: box.y + 55 });
  await expectScroll(board, { x: before.x - 145, y: before.y - 110 });
  await page.getByRole('button', { name: 'Center board', exact: true }).click();
  await expectScroll(board, before);
  expect(await positions(page)).toEqual(originalCards);

  await page.mouse.click(point.x, point.y);
  await expect(card).toHaveAttribute('aria-pressed', 'false');
});

test('Space pans over cards, survives key release, and records only camera movement', async ({ page }) => {
  await openFreshApp(page);
  await page.getByText('Allow stacks', { exact: true }).click();
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board zoom' })).toHaveCount(0);
  const board = page.getByTestId('board-root');
  const card = cards(page).last();
  const originalCards = await positions(page);
  const before = await scroll(board);
  const point = await center(card);
  await board.focus();
  await page.keyboard.down('Space');
  await expect(card).toHaveCSS('cursor', 'grab');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 50, point.y + 40, { steps: 5 });
  await page.keyboard.up('Space');
  await expect(card).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(point.x + 100, point.y + 80, { steps: 5 });
  await page.mouse.up();
  await expectScroll(board, { x: before.x - 100, y: before.y - 80 });
  expect(await positions(page)).toEqual(originalCards);
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();

  const next = await center(card);
  await dragMouseFromTo(page, next, { x: next.x + 120, y: next.y });
  await expect(page.getByText('Recording · 1 action', { exact: true })).toBeVisible();
  await expect.poll(async () => (await positions(page)).at(-1)!.x).toBe(originalCards.at(-1)!.x + 120);
  const finalView = await scroll(board);
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await page.getByTestId('replay-timeline').focus();
  await page.keyboard.press('End');
  await expectScroll(board, finalView);
  await expect.poll(async () => (await positions(page)).at(-1)!.x).toBe(originalCards.at(-1)!.x + 120);

  // Following a recording is read-only; free view explicitly enables panning.
  await board.focus();
  await page.keyboard.down('Space');
  await expect(board).not.toHaveClass(/isHandMode/);
  await page.keyboard.up('Space');
  const lockedPoint = await center(card);
  await page.mouse.move(lockedPoint.x, lockedPoint.y);
  await page.mouse.wheel(120, 80);
  await expectScroll(board, finalView);
  await openReplayView(page);
  await page.getByRole('button', { name: 'Free view', exact: true }).click();
  await board.focus();
  const replayPoint = await center(card);
  await page.keyboard.down('Space');
  await page.mouse.move(replayPoint.x, replayPoint.y);
  await page.mouse.down();
  await page.mouse.move(replayPoint.x + 60, replayPoint.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(async () => (await scroll(board)).x).toBeLessThan(finalView.x);
  await expect.poll(async () => {
    const moved = await center(card);
    return Math.hypot(moved.x - replayPoint.x - 60, moved.y - replayPoint.y - 30);
  }).toBeLessThan(2);
});

test('keeps Space in text fields and controls, and clears hand mode on blur and cancellation', async ({ page }) => {
  await openFreshApp(page);
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  const board = page.getByTestId('board-root');
  const card = cards(page).first();
  const field = page.getByLabel('Text on card', { exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await field.fill('Two');
  await page.keyboard.press('Space');
  await page.keyboard.type('words');
  await expect(field).toHaveValue('Two words');
  await expect(board).not.toHaveClass(/isHandMode/);
  const originalCards = await positions(page);
  await card.focus();
  await page.keyboard.down('Space');
  await expect(board).toHaveClass(/isHandMode/);
  const point = await center(card);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 50, point.y + 30);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(board).not.toHaveClass(/isHandMode|isCameraPanning/);
  const afterBlur = await scroll(board);
  await page.mouse.move(point.x + 110, point.y + 80);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expectScroll(board, afterBlur);
  expect(await positions(page)).toEqual(originalCards);

  await board.focus();
  await page.keyboard.down('Space');
  const next = await center(card);
  await board.evaluate(el => document.addEventListener('pointerdown', event => {
    el.setAttribute('data-test-pointer-id', String(event.pointerId));
  }, { capture: true, once: true }));
  await page.mouse.move(next.x, next.y);
  await page.mouse.down();
  await page.mouse.move(next.x + 20, next.y);
  await board.evaluate(el => {
    const pointerId = Number(el.getAttribute('data-test-pointer-id'));
    el.removeAttribute('data-test-pointer-id');
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
  });
  await expect(board).not.toHaveClass(/isCameraPanning/);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(board).not.toHaveClass(/isHandMode/);

  await page.getByRole('button', { name: 'Text card', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(cards(page)).toHaveCount(2);
  await expect(board).not.toHaveClass(/isHandMode/);
});

test('supports middle-button panning and Shift lasso in world coordinates after a pan', async ({ page }) => {
  await openFreshApp(page);
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  const board = page.getByTestId('board-root');
  const card = cards(page).first();
  await board.focus();
  const before = await scroll(board);
  const originalCards = await positions(page);
  const point = await center(card);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x + 110, point.y + 90, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expectScroll(board, { x: before.x - 110, y: before.y - 90 });
  expect(await positions(page)).toEqual(originalCards);
  const blank = await blankPoint(board);
  await page.mouse.click(blank.x, blank.y);
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card');
  await page.keyboard.down('Shift');
  await dragMouseFromTo(page, { x: box.x - 10, y: box.y - 10 }, { x: box.x + box.width + 10, y: box.y + box.height + 10 });
  await page.keyboard.up('Shift');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expectScroll(board, { x: before.x - 110, y: before.y - 90 });
});

test('places cards in space revealed by panning and replays negative world coordinates', async ({ page }) => {
  await openFreshApp(page);
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  const board = page.getByTestId('board-root');
  const card = cards(page).first();
  const initialPosition = (await positions(page))[0];
  const before = await scroll(board);
  const point = { x: 160, y: 320 };
  await dragMouseFromTo(page, point, { x: 910, y: 510 });
  await expectScroll(board, { x: before.x - 750, y: before.y - 190 });
  const cardPoint = await center(card);
  await dragMouseFromTo(page, cardPoint, { x: cardPoint.x - 200, y: cardPoint.y });
  await expect(page.getByText('Recording · 1 action', { exact: true })).toBeVisible();
  await expect.poll(async () => (await positions(page))[0].x).toBe(initialPosition.x - 200);
  expect((await positions(page))[0].x).toBeLessThan(0);
  const finalView = await scroll(board);
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await page.getByTestId('replay-timeline').focus();
  await page.keyboard.press('End');
  await expectScroll(board, finalView);
  await expect.poll(async () => (await positions(page))[0].x).toBe(initialPosition.x - 200);
});

test('Space takes priority over card resize edges and stack handles', async ({ page }) => {
  await openFreshApp(page);
  const first = cards(page).last();
  const second = cards(page).nth(19);
  await first.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await first.focus();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  if (!box) throw new Error('Missing selected card');
  const board = page.getByTestId('board-root');
  const originalCards = await positions(page);
  const before = await scroll(board);
  await page.keyboard.down('Space');
  await dragMouseFromTo(page, { x: box.x + box.width - 1, y: box.y + box.height / 2 }, { x: box.x + box.width + 49, y: box.y + box.height / 2 });
  await page.keyboard.up('Space');
  await expectScroll(board, { x: before.x - 50, y: before.y });
  expect((await first.boundingBox())?.width).toBe(box.width);
  expect(await positions(page)).toEqual(originalCards);
  await second.focus();
  await page.keyboard.press('Shift+Enter');
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Stack with 2 cards', exact: true });
  await expect(handle).toBeVisible();
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  let previousPositions = '';
  await expect.poll(async () => {
    const current = JSON.stringify(await positions(page));
    const stable = current === previousPositions;
    previousPositions = current;
    return stable;
  }).toBe(true);
  const stackPositions = await positions(page);
  const stackView = await scroll(board);
  await board.focus();
  await page.keyboard.down('Space');
  const handlePoint = await center(handle);
  await dragMouseFromTo(page, handlePoint, { x: handlePoint.x + 80, y: handlePoint.y + 40 });
  await page.keyboard.up('Space');
  await expectScroll(board, { x: stackView.x - 80, y: stackView.y - 40 });
  expect(await positions(page)).toEqual(stackPositions);
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
});
