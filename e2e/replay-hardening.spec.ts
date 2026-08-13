import { expect, test, type Locator, type Page } from '@playwright/test';
import { cardFromTop, cards, dragLocatorBy, openFreshApp, waitForAppReady } from './helpers/app';

type Point = { x: number; y: number };

async function createSingleCardProject(page: Page) {
  await openFreshApp(page);
  await page.getByRole('button', { name: 'New' }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: '+ Text card' }).click();
  await expect(cards(page)).toHaveCount(1);

  const card = await cardFromTop(page);
  const testId = await card.getAttribute('data-testid');
  if (!testId) {
    throw new Error('Expected the text card to have a test id');
  }
  return page.getByTestId(testId);
}

async function cardPoint(card: Locator): Promise<Point> {
  return card.evaluate((element) => {
    const transform = window.getComputedStyle(element).transform;
    if (!transform || transform === 'none') return { x: 0, y: 0 };
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function settledCardPoint(card: Locator) {
  let previous: Point | null = null;
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const current = await cardPoint(card);
      stableSamples = previous && pointDistance(previous, current) < 0.5 ? stableSamples + 1 : 0;
      previous = current;
      return stableSamples;
    }, { message: 'wait for the card position to settle' })
    .toBeGreaterThanOrEqual(2);
  return cardPoint(card);
}

async function expectCardNear(card: Locator, expected: Point, tolerance = 5) {
  await expect
    .poll(async () => pointDistance(await cardPoint(card), expected), {
      message: `expected card near (${Math.round(expected.x)}, ${Math.round(expected.y)})`,
    })
    .toBeLessThanOrEqual(tolerance);
}

async function seekReplay(page: Page, fraction: number) {
  const timeline = page.getByTestId('replay-timeline');
  await expect(timeline).toBeVisible();
  const box = await timeline.boundingBox();
  if (!box) {
    throw new Error('Missing replay timeline bounds');
  }

  const x = box.x + Math.max(1, Math.min(box.width - 1, box.width * fraction));
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function recordedDragMidpointFraction(page: Page) {
  let result: { midpoint: number; duration: number } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = window.indexedDB.open('sortboard-mvp');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const sessions = await new Promise<
          Array<{
            updatedAt: number;
            recording?: {
              segments?: Array<{ type: string; t0: number; t1: number; settleMs?: number }>;
            };
          }>
        >((resolve, reject) => {
          const request = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        db.close();

        const recording = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.recording;
        const segments = recording?.segments || [];
        const drag = segments.find((segment) => segment.type === 'drag');
        if (!drag) return null;
        const duration = Math.max(
          1,
          ...segments.map((segment) => segment.t1 + (segment.settleMs || 0))
        );
        return { midpoint: (drag.t0 + drag.t1) / 2, duration };
      });
      return result !== null;
    }, { message: 'wait for the physical drag recording to persist' })
    .toBe(true);

  return result!.midpoint / result!.duration;
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

async function completeOpenSession(page: Page, delta: Point) {
  const card = await createSingleCardProject(page);
  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeVisible();

  const start = await settledCardPoint(card);
  await dragLocatorBy(page, card, delta);
  await expect(page.getByText('Recording · 1 action')).toBeVisible();
  const final = await settledCardPoint(card);
  expect(pointDistance(start, final)).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'End sorting →' }).click();
  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(page.getByTestId('replay-sessions').getByRole('button')).toHaveCount(1);

  return { card, start, final };
}

async function dragCardTo(page: Page, card: Locator, target: Locator) {
  await expect(card).toBeVisible();
  await expect(target).toBeVisible();
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) {
    throw new Error('Could not resolve card and target bounds');
  }

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
  await page.mouse.up();
}

test.describe('replay state isolation', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Replay persistence regressions run in Chromium.');

  test('@smoke keeps the final Open board after reloading from an intermediate replay pose', async ({ page }) => {
    const { card, start, final } = await completeOpenSession(page, { x: 260, y: 140 });
    const dragMidpointFraction = await recordedDragMidpointFraction(page);

    await page.getByRole('button', { name: 'Play' }).click();
    await seekReplay(page, dragMidpointFraction);
    const intermediate = await settledCardPoint(card);
    expect(pointDistance(intermediate, start)).toBeGreaterThan(30);
    expect(pointDistance(intermediate, final)).toBeGreaterThan(30);

    await page.reload();
    await waitForAppReady(page);
    await expectCardNear(card, final);
  });

  test('Stop resets replay time and the Open board to the selected session start', async ({ page }) => {
    const { card, start, final } = await completeOpenSession(page, { x: 240, y: 120 });

    await page.getByRole('button', { name: 'Play' }).click();
    await seekReplay(page, 0.6);
    await expect
      .poll(async () => pointDistance(await cardPoint(card), final))
      .toBeGreaterThan(20);
    await expect(page.locator('.replayTimeLabel')).not.toHaveText('00:00.000');

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset to start' }).click();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await expect(page.locator('.replayTimeLabel')).toHaveText('00:00.000');
    await expectCardNear(card, start);
  });

  test('selecting the older of two Open sessions immediately shows that session start', async ({ page }) => {
    const card = await createSingleCardProject(page);
    await page.getByRole('button', { name: 'Start sorting →' }).click();
    const firstSessionStart = await settledCardPoint(card);

    await dragLocatorBy(page, card, { x: 220, y: 80 });
    await expect(page.getByText('Recording · 1 action')).toBeVisible();
    const firstSessionFinal = await settledCardPoint(card);
    await page.getByRole('button', { name: 'End sorting →' }).click();

    const sessionButtons = page.getByTestId('replay-sessions').getByRole('button');
    await expect(sessionButtons).toHaveCount(1);
    const firstSessionId = await sessionButtons.first().getAttribute('title');
    if (!firstSessionId) {
      throw new Error('Expected the first session button to expose its id');
    }

    await page.waitForTimeout(10);
    await page.getByRole('button', { name: '← Start another sort' }).click();
    await expect(page.getByRole('button', { name: 'End sorting →' })).toBeVisible();
    await expectCardNear(card, firstSessionFinal);

    await dragLocatorBy(page, card, { x: 140, y: 120 });
    await expect(page.getByText('Recording · 1 action')).toBeVisible();
    const secondSessionFinal = await settledCardPoint(card);
    expect(pointDistance(firstSessionStart, secondSessionFinal)).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'End sorting →' }).click();
    await expect(sessionButtons).toHaveCount(2);

    const olderSession = page.getByTestId('replay-sessions').getByTitle(firstSessionId);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await olderSession.click();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await expect(olderSession).toHaveClass(/isActive/);
    await expectCardNear(card, firstSessionStart);
  });

  test('Q-Sort records and replays Pre-Sort first even when setup was showing Q-Sort', async ({ page }) => {
    const card = await createSingleCardProject(page);
    await page.getByRole('button', { name: 'Q-Sort', exact: true }).click();

    const stageControl = page.locator('.columns').filter({
      has: page.locator('.columns__label', { hasText: 'Stage' }),
    });
    await stageControl.getByRole('button', { name: 'Q-Sort', exact: true }).click();
    await expect(stageControl.getByRole('button', { name: 'Q-Sort', exact: true })).toHaveClass(/isActive/);
    await expect(page.locator('[data-testid^="surface-qsort-"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Start sorting →' }).click();
    await expect(page.locator('.sortBar .pill').filter({ hasText: /^Pre-Sort$/ })).toHaveCount(1);

    const source = page.locator('[data-testid^="surface-work-area-"]');
    const preSortTargets = page.locator('[data-testid^="surface-sink-"]');
    await expect(source.locator('.boardSurface__count')).toHaveText('1');
    await expect(preSortTargets).toHaveCount(2);

    await dragCardTo(page, card, preSortTargets.first());
    await expect(source.locator('.boardSurface__count')).toHaveText('0');
    await expect(preSortTargets.first().locator('.boardSurface__count')).toHaveText('1');

    const nextStage = page.getByRole('button', { name: 'Next stage →' });
    await expect(nextStage).toBeEnabled();
    await nextStage.click();

    const buckets = page.locator('[data-testid^="qsort-bucket-"]');
    let availableBucket: Locator | null = null;
    for (let index = 0; index < (await buckets.count()); index += 1) {
      const bucket = buckets.nth(index);
      const capacity = (await bucket.locator('.widgetBucket__meta').textContent())?.trim();
      if (capacity === '0 / 1') {
        availableBucket = bucket;
        break;
      }
    }
    if (!availableBucket) {
      throw new Error('Expected a Q-Sort bucket with one available slot');
    }

    const liveLaneCard = page.getByTestId((await card.getAttribute('data-testid'))!);
    const availableSlot = availableBucket.locator('.widgetBucket__slot:not(.is-occupied)').first();
    await expect(availableSlot).toBeVisible();
    await waitForStableBox(liveLaneCard, 'Q-Sort lane card');
    await waitForStableBox(availableSlot, 'Q-Sort bucket slot');
    await dragCardTo(page, liveLaneCard, availableSlot);
    await expect(availableBucket.locator('.widgetBucket__meta')).toHaveText('1 / 1');
    const endSorting = page.getByRole('button', { name: 'End sorting →' });
    await expect(endSorting).toBeEnabled();
    await endSorting.click();

    const session = page.getByTestId('replay-sessions').getByRole('button').first();
    await session.click();
    await expect(session).toHaveClass(/isActive/);
    await expect(page.locator('[data-testid^="surface-qsort-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('1');

    await page.getByRole('button', { name: 'Play' }).click();
    const pause = page.getByRole('button', { name: 'Pause' });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.locator('[data-testid^="surface-qsort-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(2);
  });
});
