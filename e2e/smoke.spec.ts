import { openProjectMenu } from './helpers/app';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
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
  uploadMedia,
  waitForAppReady,
} from './helpers/app';
import { imageFixturePath } from './helpers/fixtures';

const imageFixturePayload = {
  name: 'tiny-image.png',
  mimeType: 'image/png',
  buffer: fs.readFileSync(imageFixturePath),
};

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

test('@smoke uploads an image and replays a recorded sort', async ({ page }) => {
  await openFreshApp(page);

  const beforeCount = await cards(page).count();
  await uploadMedia(page, imageFixturePayload);
  await expect(cards(page)).toHaveCount(beforeCount + 1);
  await expect(cards(page).last().locator('img.cardPreview__img')).toBeVisible();

  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('recording-status')).toBeVisible();
  const card = await cardFromTop(page);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing uploaded image bounds');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragMouseFromTo(page, from, { x: from.x + 220, y: from.y + 120 });
  await expect(page.getByText('Recording · 1 action')).toBeVisible();

  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(page.getByRole('button', { name: 'New sorting session' })).toBeVisible();
  const replaySessions = page.getByTestId('replay-sessions').getByRole('button');
  await expect(replaySessions).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeEnabled();
});

test('@smoke exports and re-imports a project zip', async ({ page }, testInfo) => {
  await openFreshApp(page);

  await openProjectMenu(page);
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
