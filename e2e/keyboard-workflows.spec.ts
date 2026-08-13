import { expect, test, type Locator, type Page } from '@playwright/test';
import { cards, openFreshApp } from './helpers/app';

type Point = { x: number; y: number };

async function createTextCardProject(page: Page, count: number) {
  await openFreshApp(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);

  for (let index = 0; index < count; index += 1) {
    await page.getByRole('button', { name: '+ Text card', exact: true }).click();
    await expect(cards(page)).toHaveCount(index + 1);
  }

  const testIds = await cards(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid')).filter((value): value is string => !!value)
  );
  expect(testIds).toHaveLength(count);
  return testIds;
}

async function cardPoint(card: Locator): Promise<Point> {
  return card.evaluate((element) => {
    const transform = window.getComputedStyle(element).transform;
    if (!transform || transform === 'none') return { x: 0, y: 0 };
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function settledCardPoint(card: Locator) {
  let previous: Point | null = null;
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const current = await cardPoint(card);
      stableSamples = previous && distance(previous, current) < 0.5 ? stableSamples + 1 : 0;
      previous = current;
      return stableSamples;
    }, { message: 'wait for the keyboard-moved card to settle' })
    .toBeGreaterThanOrEqual(2);
  return cardPoint(card);
}

async function expectCardNear(card: Locator, expected: Point) {
  await expect
    .poll(async () => distance(await cardPoint(card), expected), {
      message: `expected replay card near (${Math.round(expected.x)}, ${Math.round(expected.y)})`,
    })
    .toBeLessThanOrEqual(5);
}

async function surfaceCount(surface: Locator) {
  return Number((await surface.locator('.boardSurface__count').textContent())?.trim() || Number.NaN);
}

async function surfaceCountSum(surfaces: Locator) {
  const values = await surfaces.locator('.boardSurface__count').allTextContents();
  return values.reduce((sum, value) => sum + Number(value.trim()), 0);
}

async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

async function moveCardOutOfSurface(page: Page, card: Locator, source: Locator, expectedBefore: number) {
  for (const direction of ['ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']) {
    await card.focus();
    await page.keyboard.press(direction);
    await afterBrowserPaint(page);
    if ((await surfaceCount(source)) === expectedBefore - 1) return;
  }
  throw new Error(`No arrow direction moved ${await card.getAttribute('data-testid')} out of its source area`);
}

async function directionBetween(from: Locator, to: Locator) {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error('Could not resolve keyboard target geometry');

  const dx = toBox.x + toBox.width / 2 - (fromBox.x + fromBox.width / 2);
  const dy = toBox.y + toBox.height / 2 - (fromBox.y + fromBox.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'ArrowRight' : 'ArrowLeft';
  return dy >= 0 ? 'ArrowDown' : 'ArrowUp';
}

function oppositeDirection(direction: string) {
  if (direction === 'ArrowRight') return 'ArrowLeft';
  if (direction === 'ArrowLeft') return 'ArrowRight';
  if (direction === 'ArrowDown') return 'ArrowUp';
  return 'ArrowDown';
}

async function seekReplayToEnd(page: Page) {
  const timeline = page.getByTestId('replay-timeline');
  await expect(timeline).toBeVisible();
  await timeline.focus();
  await page.keyboard.press('End');
}

test.describe('keyboard card workflows', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Keyboard workflow coverage is Chromium-specific.');

  test('selects setup cards with Enter and Space, then replays one Open arrow move', async ({ page }) => {
    const [firstTestId, secondTestId] = await createTextCardProject(page, 2);
    const firstCard = page.getByTestId(firstTestId);
    const secondCard = page.getByTestId(secondTestId);

    await firstCard.focus();
    await page.keyboard.press('Enter');
    await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    await expect(secondCard).toHaveAttribute('aria-pressed', 'false');

    await secondCard.focus();
    await page.keyboard.press('Shift+Space');
    await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    await expect(secondCard).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Start sorting →', exact: true }).click();
    const start = await settledCardPoint(firstCard);
    await firstCard.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Recording · 1 action', { exact: true })).toBeVisible();
    const final = await settledCardPoint(firstCard);
    expect(distance(start, final)).toBeGreaterThan(20);

    await page.getByRole('button', { name: 'End sorting →', exact: true }).click();
    await expect(page.getByText('1 recorded action', { exact: true })).toBeVisible();
    await seekReplayToEnd(page);
    await expectCardNear(firstCard, final);
  });

  test('completes and replays a small Closed sort using only card arrow moves', async ({ page }) => {
    const cardTestIds = await createTextCardProject(page, 2);
    await page.getByRole('button', { name: 'Closed sort', exact: true }).click();
    const categorySetupSurface = page.locator('[data-testid^="surface-sink-"]').first();
    await categorySetupSurface.click();
    await page.getByLabel('Allowed tags', { exact: true }).fill('required-tag');
    await page.getByRole('button', { name: 'Start sorting →', exact: true }).click();

    const source = page.locator('[data-testid^="surface-work-area-"]');
    const category = page.locator('[data-testid^="surface-sink-"]').first();
    const endButton = page.getByRole('button', { name: 'End sorting →', exact: true });
    await expect(source.locator('.boardSurface__count')).toHaveText('2');
    await expect(category.locator('.boardSurface__count')).toHaveText('0');
    await expect(endButton).toBeDisabled();

    const firstCard = page.getByTestId(cardTestIds[0]);
    await firstCard.focus();
    const validDirection = await directionBetween(source, category);
    await page.keyboard.press(validDirection);
    await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
    await expect(source.locator('.boardSurface__count')).toHaveText('2');
    await expect(category.locator('.boardSurface__count')).toHaveText('0');
    await expect(page.locator('.boardCanvas > [role="status"]')).toContainText('cannot move to Category 1');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '← Setup', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start sorting →', exact: true })).toBeVisible();
    await page.locator('[data-testid^="surface-sink-"]').first().click();
    const allowedTags = page.getByLabel('Allowed tags', { exact: true });
    await expect(allowedTags).toBeVisible();
    await allowedTags.fill('');
    await page.getByRole('button', { name: 'Start sorting →', exact: true }).click();
    await expect(source.locator('.boardSurface__count')).toHaveText('2');

    await firstCard.focus();
    await page.keyboard.press(oppositeDirection(validDirection));
    await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
    await expect(source.locator('.boardSurface__count')).toHaveText('2');
    await expect(category.locator('.boardSurface__count')).toHaveText('0');

    for (const [index, testId] of cardTestIds.entries()) {
      const card = page.getByTestId(testId);
      await card.focus();
      await page.keyboard.press(validDirection);
      await expect(source.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
      await expect(category.locator('.boardSurface__count')).toHaveText(String(index + 1));
    }

    await expect(page.getByText('Recording · 2 actions', { exact: true })).toBeVisible();
    await expect(endButton).toBeEnabled();
    await endButton.click();
    await expect(page.getByText('2 recorded actions', { exact: true })).toBeVisible();

    await seekReplayToEnd(page);
    await expect(source.locator('.boardSurface__count')).toHaveText('0');
    await expect(category.locator('.boardSurface__count')).toHaveText('2');
  });

  test('completes both Q-Sort stages by keyboard at 900px and follows cards into buckets', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    const cardTestIds = await createTextCardProject(page, 4);
    await page.getByRole('button', { name: 'Q-Sort', exact: true }).click();
    await page.getByRole('button', { name: 'Start sorting →', exact: true }).click();

    const source = page.locator('[data-testid^="surface-work-area-"]');
    const preSortTargets = page.locator('[data-testid^="surface-sink-"]');
    for (const [index, testId] of cardTestIds.entries()) {
      await moveCardOutOfSurface(page, page.getByTestId(testId), source, cardTestIds.length - index);
      await expect(source.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
      await expect.poll(() => surfaceCountSum(preSortTargets)).toBe(index + 1);
    }

    const nextStage = page.getByRole('button', { name: 'Next stage →', exact: true });
    await expect(nextStage).toBeEnabled();
    await nextStage.focus();
    await page.keyboard.press('Enter');

    const board = page.getByTestId('board-root');
    const lanes = page.locator('[data-testid^="qsort-lane-"]');
    const buckets = page.locator('[data-testid^="qsort-bucket-"]');
    const endButton = page.getByRole('button', { name: 'End sorting →', exact: true });
    await expect(lanes).toHaveCount(2);
    await expect.poll(() => surfaceCountSum(lanes)).toBe(4);
    await expect(endButton).toBeDisabled();

    let observedHorizontalFollow = false;
    for (const [index, testId] of cardTestIds.entries()) {
      const card = page.getByTestId(testId);
      await board.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await settledCardPoint(card);
      await card.focus();
      await page.keyboard.press('ArrowRight');
      await afterBrowserPaint(page);
      const expectedLaneCount = cardTestIds.length - index - 1;
      const actualLaneCount = await surfaceCountSum(lanes);
      if (actualLaneCount !== expectedLaneCount) {
        const announcement = await page.locator('.boardCanvas > [role="status"]').allTextContents();
        const bucketLabels = await buckets.evaluateAll((elements) =>
          elements.map((element) => ({
            testId: element.getAttribute('data-testid'),
            label: element.querySelector('.widgetBucket__label')?.textContent?.trim(),
            capacity: element.querySelector('.widgetBucket__meta')?.textContent?.trim(),
          }))
        );
        throw new Error(
          `ArrowRight did not leave a Q-Sort lane for ${testId}: aria=${JSON.stringify(
            await card.getAttribute('aria-label')
          )}, announcement=${JSON.stringify(announcement)}, buckets=${JSON.stringify(bucketLabels)}`
        );
      }
      if ((await board.evaluate((element) => element.scrollLeft)) > 0) observedHorizontalFollow = true;
    }
    expect(observedHorizontalFollow).toBe(true);

    const finalBucketLabels = await buckets.locator('.widgetBucket__meta').allTextContents();
    expect(finalBucketLabels.some((label) => /^[1-9]\d*\s*\/\s*[1-9]\d*$/.test(label.trim()))).toBe(true);
    await expect(page.getByText('Recording · 9 actions', { exact: true })).toBeVisible();
    await expect(endButton).toBeEnabled();
    await endButton.click();
    await expect(page.getByText('9 recorded actions', { exact: true })).toBeVisible();

    await seekReplayToEnd(page);
    await expect(lanes).toHaveCount(2);
    await expect.poll(() => surfaceCountSum(lanes)).toBe(0);
    await expect(buckets.locator('.widgetBucket__meta')).toHaveText(finalBucketLabels);
    await expect(source).toHaveCount(0);
  });
});
