import { expect, test, type Locator, type Page } from '@playwright/test';
import { cards, openFreshApp } from './helpers/app';

test.use({ hasTouch: true, viewport: { width: 900, height: 720 } });

async function moveFocusedCardUntil(page: Page, completionButton: Locator) {
  for (const direction of ['ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']) {
    await page.keyboard.press(direction);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    if (await completionButton.isEnabled()) return;
  }
}

test('keeps touch panning available and removes card springs for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFreshApp(page);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const board = page.getByTestId('board-root');
  const card = cards(page).first();
  await expect.poll(() => board.evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-x pan-y');
  await expect.poll(() => card.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');

  // Let the initial card placement settle, then verify direct drag rotation is
  // also suppressed rather than merely skipping state-driven springs.
  await page.waitForTimeout(600);
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox!.x + cardBox!.width / 2 + 24, cardBox!.y + cardBox!.height / 2, { steps: 4 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const rotationComponents = await card.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { b: matrix.b, c: matrix.c };
  });
  expect(Math.abs(rotationComponents.b)).toBeLessThan(0.001);
  expect(Math.abs(rotationComponents.c)).toBeLessThan(0.001);
  await page.mouse.up();

  await page.getByRole('button', { name: 'Closed sort' }).click();
  const transformAfterChange = await card.evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(80);

  expect(await card.evaluate((element) => getComputedStyle(element).transform)).toBe(transformAfterChange);
});

test('pans an overflowing blank board with a native Chromium touch gesture', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Native touch dispatch is covered in Chromium.');
  await openFreshApp(page);
  await page.getByRole('button', { name: 'Q-Sort' }).click();

  const board = page.getByTestId('board-root');
  await expect.poll(() => board.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const box = await board.boundingBox();
  expect(box).not.toBeNull();

  const session = await context.newCDPSession(page);
  const x = box!.x + box!.width - 20;
  const startY = box!.y + box!.height - 20;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  for (let step = 1; step <= 10; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY - step * 20, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect.poll(() => board.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('.boardLasso')).toHaveCount(0);
});

test('pans a Q-Sort replay when the touch starts on a static card', async ({ browserName, context, page }) => {
  test.skip(browserName !== 'chromium', 'Native touch dispatch is covered in Chromium.');
  await openFreshApp(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: '+ Text card', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Q-Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Start sorting →', exact: true }).click();

  const card = cards(page).first();
  await card.focus();
  const nextStage = page.getByRole('button', { name: 'Next stage →', exact: true });
  await moveFocusedCardUntil(page, nextStage);
  await expect(nextStage).toBeEnabled();
  await nextStage.click();
  await card.focus();
  const endSorting = page.getByRole('button', { name: 'End sorting →', exact: true });
  await moveFocusedCardUntil(page, endSorting);
  await expect(endSorting).toBeEnabled();
  await endSorting.click();

  const timeline = page.getByTestId('replay-timeline');
  await timeline.focus();
  await page.keyboard.press('End');
  await expect.poll(() => card.evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-x pan-y');

  const board = page.getByTestId('board-root');
  await expect.poll(() => board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await card.scrollIntoViewIfNeeded();
  const before = await board.evaluate((element) => ({
    left: element.scrollLeft,
    max: element.scrollWidth - element.clientWidth,
  }));
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();
  const swipeRight = before.left > before.max / 2;
  const startX = cardBox!.x + cardBox!.width / 2;
  const y = cardBox!.y + cardBox!.height / 2;
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: startX + (swipeRight ? 1 : -1) * step * 18,
        y,
        id: 1,
        radiusX: 2,
        radiusY: 2,
        force: 1,
      }],
    });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect
    .poll(() => board.evaluate((element, initialLeft) => Math.abs(element.scrollLeft - initialLeft), before.left))
    .toBeGreaterThan(10);
});
