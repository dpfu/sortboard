import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import {
  cardFromTop,
  cards,
  dragLocatorBy,
  exportProjectZip,
  gotoApp,
  handleDialog,
  importProjectZip,
  openFreshApp,
  resetAppState,
  selectedProjectName,
  uploadMedia,
  waitForAppReady,
} from './helpers/app';
import { imageFixturePath } from './helpers/fixtures';

const imageFixturePayload = {
  name: 'tiny-image.png',
  mimeType: 'image/png',
  buffer: fs.readFileSync(imageFixturePath),
};

async function seedOpenReplaySession(page: Page) {
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
          const leadCard = board.cards[0];
          if (!leadCard) {
            reject(new Error('Missing cards for replay session seeding'));
            return;
          }

          const sessionId = '2026-01-01T00:00:01.000Z';
          const session = {
            version: 1,
            id: sessionId,
            boardId: board.id,
            updatedAt: 1_704_067_201_000,
            recording: {
              version: 5,
              createdAt: sessionId,
              cardW: board.cardW,
              cardH: board.cardH,
              boardW: 1200,
              boardH: 800,
              sortConfig: board.sortConfig,
              closedContainersAtStart: [],
              cardsAtStart: board.cards.map((card) => ({ ...card })),
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

          board.updatedAt = Date.now();
          board.activeSessionId = sessionId;
          const putBoard = boards.put(board, activeProjectId);
          const putSession = sessions.put(session, sessionId);

          let pending = 2;
          const done = () => {
            pending -= 1;
            if (pending === 0) {
              db.close();
              resolve();
            }
          };
          const fail = (error?: DOMException | null) => reject(error || new Error('Failed to seed replay session'));

          putBoard.onerror = () => fail(putBoard.error);
          putSession.onerror = () => fail(putSession.error);
          putBoard.onsuccess = done;
          putSession.onsuccess = done;
        };
      };
    });
  });
}

test('@smoke persists card metadata across reload', async ({ page }) => {
  await openFreshApp(page);

  const selectedCard = await cardFromTop(page);
  const selectedCardTestId = await selectedCard.getAttribute('data-testid');
  expect(selectedCardTestId).toBeTruthy();
  await selectedCard.click();
  await page.getByLabel('Name').fill('Smoke Card');
  await page.getByLabel('Notes').fill('Persisted note');
  await page.waitForTimeout(700);

  await page.reload();
  await waitForAppReady(page);

  await page.getByTestId(selectedCardTestId!).click({ force: true });
  await expect(page.getByLabel('Name')).toHaveValue('Smoke Card');
  await expect(page.getByLabel('Notes')).toHaveValue('Persisted note');
});

test('@smoke uploads an image and replays a recorded sort', async ({ page }, testInfo) => {
  await openFreshApp(page);

  const beforeCount = await cards(page).count();
  await uploadMedia(page, imageFixturePayload);
  await expect(cards(page)).toHaveCount(beforeCount + 1);
  await expect(cards(page).last().locator('img.cardPreview__img')).toBeVisible();

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  if (testInfo.project.name === 'webkit') {
    await seedOpenReplaySession(page);
    await page.reload();
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Start sorting →' }).click();
  } else {
    await dragLocatorBy(page, await cardFromTop(page), { x: 220, y: 120 });
    await expect(page.getByText('Recording · 1 action')).toBeVisible();
  }

  await page.getByRole('button', { name: 'End sorting →' }).click();
  await expect(page.getByRole('button', { name: '← Start another sort' })).toBeVisible();
  const replaySessions = page.getByTestId('replay-sessions').getByRole('button');
  if (testInfo.project.name === 'webkit') {
    await expect(replaySessions).toHaveCount(2);
    await replaySessions.nth(1).click();
  } else {
    await expect(replaySessions).toHaveCount(1);
  }
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
});

test('@smoke exports and re-imports a project zip', async ({ page }, testInfo) => {
  await openFreshApp(page);

  await handleDialog(page, () => page.getByRole('button', { name: 'Rename' }).click(), {
    messageIncludes: 'Rename project',
    promptText: 'Roundtrip Project',
  });

  const selectedCard = await cardFromTop(page);
  const selectedCardTestId = await selectedCard.getAttribute('data-testid');
  expect(selectedCardTestId).toBeTruthy();
  await selectedCard.click();
  await page.getByLabel('Name').fill('Roundtrip Card');
  const zipPath = await exportProjectZip(page, testInfo.outputDir, 'roundtrip.sortboard.zip');

  await resetAppState(page);
  await gotoApp(page);
  await importProjectZip(page, zipPath);

  await expect.poll(() => selectedProjectName(page)).toBe('Roundtrip Project');
  await page.getByTestId(selectedCardTestId!).click({ force: true });
  await expect(page.getByLabel('Name')).toHaveValue('Roundtrip Card');
});
