import { test, expect, type Locator, type Page } from '@playwright/test';
import { cardFromTop, cards, dragLocatorBy, handleDialog, openFreshApp, waitForAppReady } from './helpers/app';

async function createEmptyProjectWithTextCards(page: Page, count: number) {
  await openFreshApp(page);
  await page.getByRole('button', { name: 'New' }).click();
  await expect(cards(page)).toHaveCount(0);

  const cardTestIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await page.getByRole('button', { name: '+ Text card' }).click();
    await expect(cards(page)).toHaveCount(index + 1);
    const testId = await cards(page).nth(index).getAttribute('data-testid');
    if (!testId) {
      throw new Error(`Missing test id for text card ${index + 1}`);
    }
    cardTestIds.push(testId);
  }

  return cardTestIds;
}

async function dragCardTo(page: Page, cardTestId: string, targetTestId: string) {
  const card = page.getByTestId(cardTestId);
  const target = page.getByTestId(targetTestId);
  await expect(card).toBeVisible();
  await expect(target).toBeVisible();

  let previousBoxKey = '';
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const box = await card.boundingBox();
      if (!box) {
        previousBoxKey = '';
        stableSamples = 0;
        return false;
      }
      const boxKey = [box.x, box.y, box.width, box.height].map(Math.round).join(':');
      stableSamples = boxKey === previousBoxKey ? stableSamples + 1 : 1;
      previousBoxKey = boxKey;
      return stableSamples >= 3;
    }, { message: `wait for ${cardTestId} to finish reflowing` })
    .toBe(true);

  // Both cards and surfaces reflow after every assignment, so resolve fresh
  // viewport bounds immediately before each physical mouse drag.
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) {
    throw new Error(`Could not resolve drag bounds for ${cardTestId} -> ${targetTestId}`);
  }

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
  await page.mouse.up();
}

async function testIdOf(locator: Locator) {
  const testId = await locator.getAttribute('data-testid');
  if (!testId) {
    throw new Error('Expected locator to have a data-testid');
  }
  return testId;
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

test('@smoke completes a closed sort through the UI and replays it', async ({ page }) => {
  const cardTestIds = await createEmptyProjectWithTextCards(page, 4);

  await page.getByRole('button', { name: 'Closed sort' }).click();
  const categorySurfaces = page.locator('[data-testid^="surface-sink-"]');
  await expect(categorySurfaces).toHaveCount(1);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(categorySurfaces).toHaveCount(2);
  await expect(categorySurfaces.nth(0)).toContainText('Category 1');
  await expect(categorySurfaces.nth(1)).toContainText('Category 2');

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  const endButton = page.getByRole('button', { name: 'End sorting →' });
  const sourceSurface = page.locator('[data-testid^="surface-work-area-"]');
  await expect(sourceSurface.locator('.boardSurface__count')).toHaveText('4');
  await expect(endButton).toBeDisabled();

  const categoryTestIds = [await testIdOf(categorySurfaces.nth(0)), await testIdOf(categorySurfaces.nth(1))];
  const categoryCounts = [0, 0];
  for (const [index, cardTestId] of cardTestIds.slice().reverse().entries()) {
    const categoryIndex = index % categoryTestIds.length;
    await dragCardTo(page, cardTestId, categoryTestIds[categoryIndex]);
    categoryCounts[categoryIndex] += 1;
    await expect(page.getByTestId(categoryTestIds[categoryIndex]).locator('.boardSurface__count')).toHaveText(
      String(categoryCounts[categoryIndex])
    );
    await expect(sourceSurface.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
    if (index < cardTestIds.length - 1) {
      await expect(endButton).toBeDisabled();
    }
  }

  await expect(page.getByText('All cards placed')).toBeVisible();
  await expect(page.getByText('Recording · 4 actions')).toBeVisible();
  await expect(endButton).toBeEnabled();
  await endButton.click();

  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(page.getByTestId('replay-sessions').getByRole('button')).toHaveCount(1);
  await expect(page.getByText('4 recorded actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(sourceSurface.locator('.boardSurface__count')).toHaveText('4');
  await seekReplay(page, 1);
  await expect(sourceSurface.locator('.boardSurface__count')).toHaveText('0');
  await expect(page.getByTestId(categoryTestIds[0]).locator('.boardSurface__count')).toHaveText('2');
  await expect(page.getByTestId(categoryTestIds[1]).locator('.boardSurface__count')).toHaveText('2');
});

test('@smoke completes both q-sort stages through the UI and replays them', async ({ page }) => {
  const cardTestIds = await createEmptyProjectWithTextCards(page, 4);

  await page.getByRole('button', { name: 'Q-Sort' }).click();
  await page.getByRole('button', { name: 'Start sorting →' }).click();

  const nextStageButton = page.getByRole('button', { name: 'Next stage →' });
  const sourceSurface = page.locator('[data-testid^="surface-work-area-"]');
  const preSortSurfaces = page.locator('[data-testid^="surface-sink-"]');
  await expect(preSortSurfaces).toHaveCount(2);
  await expect(sourceSurface.locator('.boardSurface__count')).toHaveText('4');
  await expect(nextStageButton).toBeDisabled();

  const preSortTestIds = [await testIdOf(preSortSurfaces.nth(0)), await testIdOf(preSortSurfaces.nth(1))];
  const laneCardIds: string[][] = [[], []];
  const preSortCounts = [0, 0];
  for (const [index, cardTestId] of cardTestIds.slice().reverse().entries()) {
    const laneIndex = index % preSortTestIds.length;
    await dragCardTo(page, cardTestId, preSortTestIds[laneIndex]);
    laneCardIds[laneIndex].push(cardTestId);
    preSortCounts[laneIndex] += 1;
    await expect(page.getByTestId(preSortTestIds[laneIndex]).locator('.boardSurface__count')).toHaveText(
      String(preSortCounts[laneIndex])
    );
    await expect(sourceSurface.locator('.boardSurface__count')).toHaveText(String(cardTestIds.length - index - 1));
    if (index < cardTestIds.length - 1) {
      await expect(nextStageButton).toBeDisabled();
    }
  }

  await expect(nextStageButton).toBeEnabled();
  await nextStageButton.click();

  const qSortSurface = page.locator('[data-testid^="surface-qsort-"]');
  const qSortLanes = page.locator('[data-testid^="qsort-lane-"]');
  const qSortBuckets = page.locator('[data-testid^="qsort-bucket-"]');
  const endButton = page.getByRole('button', { name: 'End sorting →' });
  await expect(qSortSurface).toHaveCount(1);
  await expect(qSortLanes).toHaveCount(2);
  await expect(qSortLanes.nth(0).locator('.boardSurface__count')).toHaveText('2');
  await expect(qSortLanes.nth(1).locator('.boardSurface__count')).toHaveText('2');
  await expect(endButton).toBeDisabled();

  const bucketTargets: Array<{ testId: string; placed: number; capacity: number }> = [];
  for (let index = 0; index < (await qSortBuckets.count()); index += 1) {
    const bucket = qSortBuckets.nth(index);
    const capacityText = (await bucket.locator('.widgetBucket__meta').textContent())?.trim() || '';
    const match = capacityText.match(/^0\s*\/\s*(\d+)$/);
    if (!match) {
      throw new Error(`Unexpected Q-Sort capacity label: ${capacityText}`);
    }
    const capacity = Number(match[1]);
    if (capacity > 0) {
      bucketTargets.push({ testId: await testIdOf(bucket), placed: 0, capacity });
    }
  }
  expect(bucketTargets.reduce((sum, bucket) => sum + bucket.capacity, 0)).toBe(cardTestIds.length);

  const cardsFromBothLanes = laneCardIds.flatMap((ids, laneIndex) =>
    ids
      .slice()
      .reverse()
      .map((cardTestId) => ({ cardTestId, laneIndex }))
  );
  let bucketIndex = 0;
  const remainingInLane = [...preSortCounts];
  for (const [index, { cardTestId, laneIndex }] of cardsFromBothLanes.entries()) {
    while (bucketTargets[bucketIndex].placed >= bucketTargets[bucketIndex].capacity) {
      bucketIndex += 1;
    }
    const bucket = bucketTargets[bucketIndex];
    await dragCardTo(page, cardTestId, bucket.testId);
    bucket.placed += 1;
    remainingInLane[laneIndex] -= 1;
    await expect(page.getByTestId(bucket.testId).locator('.widgetBucket__meta')).toHaveText(
      `${bucket.placed} / ${bucket.capacity}`
    );
    await expect(qSortLanes.nth(laneIndex).locator('.boardSurface__count')).toHaveText(String(remainingInLane[laneIndex]));
    if (index < cardsFromBothLanes.length - 1) {
      await expect(endButton).toBeDisabled();
    }
  }

  await expect(endButton).toBeEnabled();
  await expect(page.getByText('Recording · 9 actions')).toBeVisible();
  await endButton.click();

  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(page.getByTestId('replay-sessions').getByRole('button')).toHaveCount(1);
  await expect(page.getByText('9 recorded actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(preSortSurfaces).toHaveCount(2);
  await expect(sourceSurface.locator('.boardSurface__count')).toHaveText('4');
  await seekReplay(page, 1);
  await expect(qSortSurface).toHaveCount(1);
  await expect(qSortLanes.nth(0).locator('.boardSurface__count')).toHaveText('0');
  await expect(qSortLanes.nth(1).locator('.boardSurface__count')).toHaveText('0');
  for (const bucket of bucketTargets) {
    await expect(page.getByTestId(bucket.testId).locator('.widgetBucket__meta')).toHaveText(
      `${bucket.capacity} / ${bucket.capacity}`
    );
  }
});

async function seedClosedSortCompleteState(page: Page) {
  await page.evaluate(async () => {
    const activeProjectId = await new Promise<string | null>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['meta'], 'readonly');
        const get = tx.objectStore('meta').get('activeProjectId');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const value = (get.result as { value?: string } | undefined)?.value ?? null;
          db.close();
          resolve(value);
        };
      };
    });

    if (!activeProjectId) {
      throw new Error('Missing active project id');
    }

    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['boards'], 'readwrite');
        const boards = tx.objectStore('boards');
        const get = boards.get(activeProjectId);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const board = get.result as {
            workflow?: { stages: Array<{ id: string }>; widgets: Array<{ id: string; kind: string }> };
            cards: Array<{ widgetAssignments?: Record<string, { widgetId: string; zoneId: string; order: number }> }>;
            activeStageId?: string | null;
            updatedAt?: number;
          };
          const stageId = board.workflow?.stages[0]?.id;
          const categoryId = board.workflow?.widgets.find((widget) => widget.kind === 'category')?.id;
          if (!stageId || !categoryId) {
            reject(new Error('Missing closed sort stage or category'));
            return;
          }
          board.activeStageId = stageId;
          board.updatedAt = Date.now();
          board.cards = board.cards.map((card, index) => ({
            ...card,
            widgetAssignments: {
              ...(card.widgetAssignments || {}),
              [stageId]: {
                widgetId: categoryId,
                zoneId: 'content',
                order: index,
              },
            },
          }));
          const put = boards.put(board, activeProjectId);
          put.onerror = () => reject(put.error);
          put.onsuccess = () => {
            db.close();
            resolve();
          };
        };
      };
    });
  });
}

async function seedQSortPreSortCompleteState(page: Page) {
  await page.evaluate(async () => {
    const activeProjectId = await new Promise<string | null>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['meta'], 'readonly');
        const get = tx.objectStore('meta').get('activeProjectId');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const value = (get.result as { value?: string } | undefined)?.value ?? null;
          db.close();
          resolve(value);
        };
      };
    });

    if (!activeProjectId) {
      throw new Error('Missing active project id');
    }

    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['boards'], 'readwrite');
        const boards = tx.objectStore('boards');
        const get = boards.get(activeProjectId);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const board = get.result as {
            workflow?: {
              stages: Array<{ id: string; kind: string }>;
              widgets: Array<{ id: string; kind: string; stageId?: string; zones?: Array<{ id: string }> }>;
            };
            cards: Array<{ widgetAssignments?: Record<string, { widgetId: string; zoneId: string; order: number }> }>;
            activeStageId?: string | null;
            updatedAt?: number;
          };
          const presortStage = board.workflow?.stages.find((stage) => stage.kind === 'presort');
          const presortWidget = board.workflow?.widgets.find(
            (widget) => widget.kind === 'pre-sort' && widget.stageId === presortStage?.id
          );
          const zoneIds = presortWidget?.zones?.map((zone) => zone.id).filter(Boolean) || [];
          if (!presortStage || !presortWidget || zoneIds.length < 2) {
            reject(new Error('Missing qsort presort state'));
            return;
          }
          board.activeStageId = presortStage.id;
          board.updatedAt = Date.now();
          board.cards = board.cards.map((card, index) => ({
            ...card,
            widgetAssignments: {
              ...(card.widgetAssignments || {}),
              [presortStage.id]: {
                widgetId: presortWidget.id,
                zoneId: zoneIds[index % zoneIds.length]!,
                order: Math.floor(index / zoneIds.length),
              },
            },
          }));
          const put = boards.put(board, activeProjectId);
          put.onerror = () => reject(put.error);
          put.onsuccess = () => {
            db.close();
            resolve();
          };
        };
      };
    });
  });
}

async function seedOpenReplaySessions(page: Page) {
  await page.evaluate(async () => {
    const activeProjectId = await new Promise<string | null>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['meta'], 'readonly');
        const get = tx.objectStore('meta').get('activeProjectId');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const value = (get.result as { value?: string } | undefined)?.value ?? null;
          db.close();
          resolve(value);
        };
      };
    });

    if (!activeProjectId) {
      throw new Error('Missing active project id');
    }

    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['boards', 'sessions'], 'readwrite');
        const boards = tx.objectStore('boards');
        const sessions = tx.objectStore('sessions');
        const get = boards.get(activeProjectId);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const board = get.result as {
            id: string;
            cardW: number;
            cardH: number;
            sortConfig: { type: 'open' | 'closed' | 'qsort'; columns?: number };
            cards: Array<{
              id: string;
              x: number;
              y: number;
              z: number;
              kind: string;
              meta: Record<string, unknown>;
              createdAt: number;
            }>;
            updatedAt?: number;
            activeSessionId?: string;
          };
          const baseCards = board.cards.map((card) => ({ ...card }));
          const leadCard = baseCards[0];
          const secondCard = baseCards[1] || leadCard;
          if (!leadCard || !secondCard) {
            reject(new Error('Missing cards for replay session seeding'));
            return;
          }

          const sessionOneId = '2026-01-01T00:00:01.000Z';
          const sessionTwoId = '2026-01-01T00:00:02.000Z';
          const sessionOne = {
            version: 1,
            id: sessionOneId,
            boardId: board.id,
            updatedAt: 1_704_067_201_000,
            recording: {
              version: 5,
              createdAt: sessionOneId,
              cardW: board.cardW,
              cardH: board.cardH,
              boardW: 1200,
              boardH: 800,
              sortConfig: board.sortConfig,
              closedContainersAtStart: [],
              cardsAtStart: baseCards,
              segments: [
                {
                  type: 'drag',
                  id: 'seed-drag-1',
                  cardId: leadCard.id,
                  t0: 0,
                  t1: 600,
                  from: { x: leadCard.x, y: leadCard.y },
                  path: [
                    [0, leadCard.x, leadCard.y],
                    [300, leadCard.x + 80, leadCard.y + 40],
                    [600, leadCard.x + 160, leadCard.y + 80],
                  ],
                  drop: { x: leadCard.x + 160, y: leadCard.y + 80 },
                  final: { x: leadCard.x + 160, y: leadCard.y + 80 },
                  settleMs: 0,
                },
              ],
            },
          };
          const sessionTwo = {
            version: 1,
            id: sessionTwoId,
            boardId: board.id,
            updatedAt: 1_704_067_202_000,
            recording: {
              version: 5,
              createdAt: sessionTwoId,
              cardW: board.cardW,
              cardH: board.cardH,
              boardW: 1200,
              boardH: 800,
              sortConfig: board.sortConfig,
              closedContainersAtStart: [],
              cardsAtStart: baseCards,
              segments: [
                {
                  type: 'drag',
                  id: 'seed-drag-2a',
                  cardId: leadCard.id,
                  t0: 0,
                  t1: 500,
                  from: { x: leadCard.x, y: leadCard.y },
                  path: [
                    [0, leadCard.x, leadCard.y],
                    [250, leadCard.x + 60, leadCard.y + 30],
                    [500, leadCard.x + 120, leadCard.y + 60],
                  ],
                  drop: { x: leadCard.x + 120, y: leadCard.y + 60 },
                  final: { x: leadCard.x + 120, y: leadCard.y + 60 },
                  settleMs: 0,
                },
                {
                  type: 'drag',
                  id: 'seed-drag-2b',
                  cardId: secondCard.id,
                  t0: 700,
                  t1: 1300,
                  from: { x: secondCard.x, y: secondCard.y },
                  path: [
                    [700, secondCard.x, secondCard.y],
                    [1000, secondCard.x - 70, secondCard.y + 50],
                    [1300, secondCard.x - 140, secondCard.y + 100],
                  ],
                  drop: { x: secondCard.x - 140, y: secondCard.y + 100 },
                  final: { x: secondCard.x - 140, y: secondCard.y + 100 },
                  settleMs: 0,
                },
              ],
            },
          };

          board.updatedAt = Date.now();
          board.activeSessionId = sessionTwoId;
          const putBoard = boards.put(board, activeProjectId);
          const putOne = sessions.put(sessionOne, sessionOneId);
          const putTwo = sessions.put(sessionTwo, sessionTwoId);

          let pending = 3;
          const done = () => {
            pending -= 1;
            if (pending === 0) {
              db.close();
              resolve();
            }
          };
          const fail = (error?: DOMException | null) => reject(error || new Error('Failed to seed replay sessions'));

          putBoard.onerror = () => fail(putBoard.error);
          putOne.onerror = () => fail(putOne.error);
          putTwo.onerror = () => fail(putTwo.error);
          putBoard.onsuccess = done;
          putOne.onsuccess = done;
          putTwo.onsuccess = done;
        };
      };
    });
  });
}

test('handles leave-sort confirmation and replay session controls', async ({ page }) => {
  await openFreshApp(page);

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await handleDialog(page, () => page.getByRole('button', { name: '← Setup' }).click(), {
    accept: false,
    messageIncludes: 'This unfinished session will not be available for replay.',
  });
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeVisible();
  await handleDialog(page, () => page.getByRole('button', { name: '← Setup' }).click(), {
    accept: true,
    messageIncludes: 'This unfinished session will not be available for replay.',
  });
  await waitForAppReady(page);

  await seedOpenReplaySessions(page);
  await page.reload();
  await waitForAppReady(page);

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await page.getByRole('button', { name: 'End sorting →' }).click();
  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(page.getByTestId('replay-sessions').getByRole('button')).toHaveCount(3);

  const seededCurrent = page.getByTestId('replay-sessions').getByRole('button').nth(1);
  await seededCurrent.click();
  await expect(seededCurrent).toHaveClass(/isActive/);
  await expect(page.getByText('2 recorded actions')).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  const timeline = page.getByTestId('replay-timeline');
  const box = await timeline.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    throw new Error('Missing replay timeline bounds');
  }
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.replayTimeLabel')).not.toHaveText('00:00.000');

  await page.getByRole('button', { name: 'Reset to start' }).click();
  await expect(page.locator('.replayTimeLabel')).toHaveText('00:00.000');

  const olderSession = page.getByTestId('replay-sessions').getByRole('button').nth(2);
  await olderSession.click();
  await expect(olderSession).toHaveClass(/isActive/);
  await expect(page.getByText('1 recorded action')).toBeVisible();
});

test('adds and removes a closed-sort category and renders closed surfaces in replay', async ({ page }) => {
  await openFreshApp(page);

  await page.getByRole('button', { name: 'Closed sort' }).click();
  const closedSurfaces = page.locator('[data-testid^="surface-sink-"]');
  await expect(closedSurfaces).toHaveCount(1);

  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(closedSurfaces).toHaveCount(2);

  await closedSurfaces.last().click();
  await page.getByRole('button', { name: 'Remove category' }).click();
  await expect(closedSurfaces).toHaveCount(1);
  await page.waitForTimeout(700);

  await seedClosedSortCompleteState(page);
  await page.reload();
  await waitForAppReady(page);

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await expect(page.locator('[data-testid^="surface-work-area-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeEnabled();

  await page.getByRole('button', { name: 'End sorting →' }).click();
  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  await expect(page.locator('[data-testid^="surface-work-area-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(1);
});

test('advances from pre-sort into q-sort distribution surfaces', async ({ page }) => {
  await openFreshApp(page);

  await page.getByRole('button', { name: 'Q-Sort' }).click();
  await page.waitForTimeout(700);
  await seedQSortPreSortCompleteState(page);
  await page.reload();
  await waitForAppReady(page);
  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await expect(page.getByRole('button', { name: 'Next stage →' })).toBeEnabled();
  await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Next stage →' }).click();
  await expect(page.locator('[data-testid^="surface-qsort-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="qsort-distribution-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="qsort-slot-"]').first()).toBeVisible();
  await expect.poll(() => page.getByTestId('board-root').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'End sorting →' })).toBeVisible();
});
