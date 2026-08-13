import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { cards, openFreshApp, uploadMedia } from './helpers/app';
import { videoFixturePathForProject } from './helpers/fixtures';

test('uploads a video and opens the preview dialog when the browser fixture is supported', async ({ page }, testInfo) => {
  const videoFixturePath = videoFixturePathForProject(testInfo.project.name);
  test.skip(!videoFixturePath, `Video upload is intentionally skipped in ${testInfo.project.name} until a CI-stable codec fixture is available.`);

  await openFreshApp(page);

  const beforeCount = await cards(page).count();
  await uploadMedia(page, {
    name: videoFixturePath!.endsWith('.mp4') ? 'tiny-video.mp4' : 'tiny-video.webm',
    mimeType: videoFixturePath!.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
    buffer: fs.readFileSync(videoFixturePath!),
  });
  await expect(cards(page)).toHaveCount(beforeCount + 1);

  const newCard = cards(page).last();
  await page.setViewportSize({ width: 900, height: 720 });
  await newCard.click();
  const detailsDrawer = page.getByRole('dialog', { name: 'Card' });
  await expect(detailsDrawer).toBeVisible();
  const openVideoButton = detailsDrawer.getByRole('button', { name: 'Open video' });
  await openVideoButton.click();

  const previewDialog = page.getByTestId('video-preview-dialog');
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  const player = page.getByTestId('video-preview-player');
  await expect(player).toBeVisible();
  await expect
    .poll(async () => player.evaluate((element) => (element as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(previewDialog).toBeHidden();
  await expect(detailsDrawer).toBeVisible();
  await expect(openVideoButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(detailsDrawer).toBeHidden();
});
