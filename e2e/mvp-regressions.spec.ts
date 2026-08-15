import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  cardFromTop,
  cards,
  dragMouseFromTo,
  exportProjectZip,
  gotoApp,
  handleDialog,
  importProjectZip,
  openFreshApp,
  resetAppState,
  selectedProjectName,
  waitForAppReady,
} from './helpers/app';

const VIEWPORT_HEIGHT = 720;
const REGRESSION_WIDTHS = [900, 980, 981, 1280] as const;

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

function intersectBox(a: Box, b: Box) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

async function testIdOf(locator: Locator) {
  const testId = await locator.getAttribute('data-testid');
  if (!testId) throw new Error('Expected locator to have a data-testid');
  return testId;
}

async function allCardTestIds(page: Page) {
  return cards(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid')).filter((value): value is string => !!value)
  );
}

async function waitForStableBox(locator: Locator, label: string) {
  let previousKey = '';
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      if (!box) {
        previousKey = '';
        stableSamples = 0;
        return false;
      }
      const key = [box.x, box.y, box.width, box.height].map(Math.round).join(':');
      stableSamples = key === previousKey ? stableSamples + 1 : 1;
      previousKey = key;
      return stableSamples >= 3;
    }, { message: `wait for ${label} to finish reflowing` })
    .toBe(true);
}

async function scrollCardIntoView(page: Page, card: Locator) {
  await card.scrollIntoViewIfNeeded();
  await waitForStableBox(card, (await card.getAttribute('data-testid')) || 'card');
  const board = page.getByTestId('board-root');
  await expect
    .poll(async () => {
      const [boardBox, cardBox] = await Promise.all([board.boundingBox(), card.boundingBox()]);
      return !!boardBox && !!cardBox && !!intersectBox(boardBox, cardBox);
    }, { message: 'card is reachable in the visible board viewport' })
    .toBe(true);
}

async function dragVisibleCardToTarget(page: Page, card: Locator, target: Locator) {
  const board = page.getByTestId('board-root');
  await waitForStableBox(card, (await card.getAttribute('data-testid')) || 'card');

  const [boardBox, cardBox, targetBox] = await Promise.all([
    board.boundingBox(),
    card.boundingBox(),
    target.boundingBox(),
  ]);
  if (!boardBox || !cardBox || !targetBox) {
    throw new Error('Could not resolve current board, card, and target bounds for drag');
  }

  const visibleCard = intersectBox(cardBox, boardBox);
  const visibleTarget = intersectBox(targetBox, boardBox);
  if (!visibleCard || visibleCard.width < 8 || visibleCard.height < 8) {
    throw new Error('Card has no usable visible area for a physical mouse drag');
  }
  if (!visibleTarget || visibleTarget.width < 8 || visibleTarget.height < 8) {
    throw new Error('Drop target has no usable visible area for a physical mouse drag');
  }

  const cardTestId = await testIdOf(card);
  const candidates = [0.08, 0.18, 0.32, 0.5, 0.72, 0.9].flatMap((yFraction) =>
    [0.12, 0.32, 0.5, 0.68, 0.88].map((xFraction) => ({
      x: visibleCard.left + visibleCard.width * xFraction,
      y: visibleCard.top + visibleCard.height * yFraction,
    }))
  );
  const from = await page.evaluate(
    ({ points, expectedTestId }) =>
      points.find((point) =>
        document
          .elementFromPoint(point.x, point.y)
          ?.closest('[data-testid^="card-"]')
          ?.getAttribute('data-testid') === expectedTestId
      ) || null,
    { points: candidates, expectedTestId: cardTestId }
  );
  if (!from) {
    throw new Error(`${cardTestId} has no exposed point that a user can grab with the mouse`);
  }
  const targetTop = Math.max(visibleTarget.top + 8, boardBox.y + 96);
  const targetBottom = visibleTarget.bottom - 8;
  const to = {
    x: visibleTarget.left + visibleTarget.width / 2,
    y: targetTop <= targetBottom ? (targetTop + targetBottom) / 2 : visibleTarget.top + visibleTarget.height / 2,
  };

  await dragMouseFromTo(page, from, to);
}

async function allCardsAreInsideCanvas(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="board-canvas"]');
    const cardElements = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="card-"]'));
    if (!canvas || cardElements.length === 0) return false;
    const canvasRect = canvas.getBoundingClientRect();
    const tolerance = 1;
    return cardElements.every((card) => {
      const rect = card.getBoundingClientRect();
      return (
        rect.left >= canvasRect.left - tolerance &&
        rect.top >= canvasRect.top - tolerance &&
        rect.right <= canvasRect.right + tolerance &&
        rect.bottom <= canvasRect.bottom + tolerance
      );
    });
  });
}

async function editTopCard(page: Page, field: 'Name' | 'Notes', value: string) {
  await expect(cards(page)).not.toHaveCount(0);
  const card = await cardFromTop(page);
  const cardTestId = await testIdOf(card);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByLabel(field, { exact: true }).fill(value);
  return cardTestId;
}

async function closeDetailsDrawerIfPresent(page: Page) {
  const closeButton = page.getByRole('button', { name: 'Close', exact: true });
  if (await closeButton.isVisible()) await closeButton.click();
}

for (const width of REGRESSION_WIDTHS) {
  test(`@smoke keeps the setup board measurable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await openFreshApp(page);

    const board = page.getByTestId('board-root');
    await expect
      .poll(async () => (await board.boundingBox())?.height || 0, {
        message: `board should retain a useful height at ${width}px`,
      })
      .toBeGreaterThanOrEqual(240);
    await expect
      .poll(async () => (await board.boundingBox())?.width || 0)
      .toBeGreaterThanOrEqual(300);
    await expect(page.getByLabel('Card size')).toBeEnabled();
    await expect(cards(page)).toHaveCount(24);
  });
}

test('@smoke flushes a pending card edit before switching projects', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect.poll(() => selectedProjectName(page)).toBe('Project 2');
  await page.getByLabel('Select project').selectOption({ label: 'Demo Project' });
  await expect.poll(() => selectedProjectName(page)).toBe('Demo Project');

  const cardTestId = await editTopCard(page, 'Name', 'Saved before project switch');
  await closeDetailsDrawerIfPresent(page);
  await page.getByLabel('Select project').selectOption({ label: 'Project 2' });
  await expect.poll(() => selectedProjectName(page)).toBe('Project 2');

  await page.getByLabel('Select project').selectOption({ label: 'Demo Project' });
  await expect.poll(() => selectedProjectName(page)).toBe('Demo Project');
  await page.getByTestId(cardTestId).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Saved before project switch');
});

test('@smoke flushes a pending card edit before reload', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);

  const cardTestId = await editTopCard(page, 'Notes', 'Saved before reload');
  await page.reload();
  await waitForAppReady(page);

  await page.getByTestId(cardTestId).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Saved before reload');
});

test('@smoke flushes a pending card edit before sorting starts', async ({ page }) => {
  await page.setViewportSize({ width: 981, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);

  const cardTestId = await editTopCard(page, 'Name', 'Saved before sort start');
  await closeDetailsDrawerIfPresent(page);
  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeVisible();
  await handleDialog(page, () => page.getByRole('button', { name: '← Setup' }).click(), {
    messageIncludes: 'This unfinished session will not be available for replay.',
  });
  await waitForAppReady(page);
  await page.reload();
  await waitForAppReady(page);

  await page.getByTestId(cardTestId).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Saved before sort start');
});

test('@smoke flushes a pending card edit into an immediate project export', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);

  const cardTestId = await editTopCard(page, 'Name', 'Saved in immediate export');
  const zipPath = await exportProjectZip(page, testInfo.outputDir, 'pending-edit.sortboard.zip');

  await resetAppState(page);
  await gotoApp(page);
  await importProjectZip(page, zipPath);
  await page.getByTestId(cardTestId).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Saved in immediate export');
});

test('@smoke keeps all 24 demo cards reachable through a closed-sort workflow', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);
  const cardTestIds = await allCardTestIds(page);
  expect(cardTestIds).toHaveLength(24);

  await page.getByRole('button', { name: 'Closed sort' }).click();
  await page.getByRole('button', { name: 'Start sorting →' }).click();

  const board = page.getByTestId('board-root');
  const source = page.locator('[data-testid^="surface-work-area-"]');
  const category = page.locator('[data-testid^="surface-sink-"]').first();
  await expect(source.locator('.boardSurface__count')).toHaveText('24');
  await expect.poll(() => board.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  await expect.poll(() => allCardsAreInsideCanvas(page)).toBe(true);

  for (const [index, cardTestId] of cardTestIds.slice().reverse().entries()) {
    const card = page.getByTestId(cardTestId);
    await scrollCardIntoView(page, card);
    await dragVisibleCardToTarget(page, card, category);
    await expect(category.locator('.boardSurface__count')).toHaveText(String(index + 1));
    await expect(source.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
  }

  await expect(page.getByText('All cards placed')).toBeVisible();
  await expect(page.getByText('Recording · 24 actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeEnabled();
  await expect.poll(() => allCardsAreInsideCanvas(page)).toBe(true);
  await page.getByRole('button', { name: 'End sorting →' }).click();
  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(cards(page)).toHaveCount(24);
});

test('@smoke moves all 24 demo cards through Q-Sort pre-sort and reaches the outer bucket', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await openFreshApp(page);
  const cardTestIds = await allCardTestIds(page);
  expect(cardTestIds).toHaveLength(24);

  await page.getByRole('button', { name: 'Q-Sort' }).click();
  await page.getByRole('button', { name: 'Start sorting →' }).click();

  const board = page.getByTestId('board-root');
  const source = page.locator('[data-testid^="surface-work-area-"]');
  const preSortSurfaces = page.locator('[data-testid^="surface-sink-"]');
  await expect(preSortSurfaces).toHaveCount(2);
  await expect(source.locator('.boardSurface__count')).toHaveText('24');
  await expect.poll(() => board.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  await expect.poll(() => allCardsAreInsideCanvas(page)).toBe(true);

  const laneCardIds: string[][] = [[], []];
  const laneCounts = [0, 0];
  for (const [index, cardTestId] of cardTestIds.slice().reverse().entries()) {
    const card = page.getByTestId(cardTestId);
    await scrollCardIntoView(page, card);
    const targetIndex = index % 2;
    const target = preSortSurfaces.nth(targetIndex);
    await dragVisibleCardToTarget(page, card, target);
    laneCardIds[targetIndex].push(cardTestId);
    laneCounts[targetIndex] += 1;
    await expect(target.locator('.boardSurface__count')).toHaveText(String(laneCounts[targetIndex]));
    await expect(source.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
  }

  await expect(page.getByRole('button', { name: 'Next stage →' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next stage →' }).click();

  const qSortSurface = page.locator('[data-testid^="surface-qsort-"]');
  const qSortBuckets = page.locator('[data-testid^="qsort-bucket-"]');
  await expect(qSortSurface).toHaveCount(1);
  await expect(qSortBuckets).toHaveCount(7);
  await expect.poll(() => allCardsAreInsideCanvas(page)).toBe(true);
  await expect
    .poll(() => board.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeGreaterThan(0);

  const outerBucket = qSortBuckets.last();
  await outerBucket.scrollIntoViewIfNeeded();
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const outerCapacityText = (await outerBucket.locator('.widgetBucket__meta').textContent())?.trim() || '';
  const outerCapacityMatch = outerCapacityText.match(/^0\s*\/\s*(\d+)$/);
  if (!outerCapacityMatch || Number(outerCapacityMatch[1]) < 1) {
    throw new Error(`Expected the outer Q-Sort bucket to accept a card, received "${outerCapacityText}"`);
  }
  const outerCapacity = Number(outerCapacityMatch[1]);

  const laneWithCards = laneCardIds.findIndex((ids) => ids.length > 0);
  expect(laneWithCards).toBeGreaterThanOrEqual(0);
  const exposedCard = page.getByTestId(laneCardIds[laneWithCards].at(-1)!);
  await dragVisibleCardToTarget(page, exposedCard, outerBucket);
  await expect(outerBucket.locator('.widgetBucket__meta')).toHaveText(`1 / ${outerCapacity}`);
  await expect(page.locator('[data-testid^="qsort-lane-"]').nth(laneWithCards).locator('.boardSurface__count')).toHaveText(
    String(laneCounts[laneWithCards] - 1)
  );
  await expect(page.getByText('Recording · 26 actions')).toBeVisible();
});
