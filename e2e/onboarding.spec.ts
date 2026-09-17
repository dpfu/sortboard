import { expect, test, type Page } from '@playwright/test';
import { testProjectArchive } from '../src/testFixtures/project';
import { cards, handleDialog, openProjectMenu, resetAppState } from './helpers/app';

async function localCounts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-mvp');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const count = (store: string) => new Promise<number>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { projects: await count('projects'), assets: await count('assets') };
    } finally { db.close(); }
  });
}

test('@smoke starts blank without demo data and returns to welcome after deleting the last project', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await resetAppState(page);
  const demoRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/demo/')) demoRequests.push(request.url()); });
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Welcome to SortBoard' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Nothing you add is uploaded to a server or cloud service.');
  expect(await localCounts(page)).toEqual({ projects: 0, assets: 0 });
  await expect(cards(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome-900.png') });
  await welcome.getByRole('button', { name: /Start with a blank project/ }).click();
  await expect(welcome).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Project menu' })).toHaveAttribute('title', 'Project 1');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start sorting' })).toBeDisabled();
  expect(await localCounts(page)).toEqual({ projects: 1, assets: 0 });
  expect(demoRequests).toEqual([]);
  const demos = page.getByRole('button', { name: 'Demo projects', exact: true });
  await expect(demos).toBeInViewport();
  expect((await demos.boundingBox())!.x).toBeLessThan(300);
  await page.screenshot({ path: testInfo.outputPath('blank-900.png') });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Project menu' })).toHaveAttribute('title', 'Project 1');
  await expect(welcome).toHaveCount(0);
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await openProjectMenu(page);
  await handleDialog(page, () => page.getByRole('button', { name: 'Delete', exact: true }).click());
  await expect(welcome).toBeVisible();
  expect(await localCounts(page)).toEqual({ projects: 0, assets: 0 });
  await page.reload();
  await expect(welcome).toBeVisible();
  expect(await localCounts(page)).toEqual({ projects: 0, assets: 0 });
});

test('@smoke opens a demo from welcome without creating an extra project', async ({ page }, testInfo) => {
  await resetAppState(page);
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Welcome to SortBoard' });
  await expect(welcome).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome-1440.png') });
  await welcome.getByRole('button', { name: /Start with a demo project/ }).click();
  const demos = page.getByRole('dialog', { name: 'Demo projects' });
  await expect(demos.getByRole('radio', { name: /^Closed sort/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();
  expect(await localCounts(page)).toEqual({ projects: 0, assets: 0 });
  await welcome.getByRole('button', { name: /Start with a demo project/ }).click();
  await demos.getByRole('button', { name: 'Open demo with 15 images' }).click();
  await expect(demos).not.toBeVisible({ timeout: 30000 });
  await expect(cards(page)).toHaveCount(15);
  expect(await localCounts(page)).toEqual({ projects: 1, assets: 15 });
  await page.reload();
  await expect(cards(page)).toHaveCount(15);
  await expect(welcome).toHaveCount(0);
  await page.getByRole('button', { name: 'Demo projects', exact: true }).click();
  await expect(demos).toBeVisible();
  await demos.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(cards(page)).toHaveCount(15);
  expect(await localCounts(page)).toEqual({ projects: 1, assets: 15 });
});

test('imports a saved project directly from welcome', async ({ page }) => {
  await resetAppState(page);
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Welcome to SortBoard' });
  const chooser = page.waitForEvent('filechooser');
  await welcome.getByRole('button', { name: 'Import project', exact: true }).click();
  await (await chooser).setFiles({ name: 'test-project.sortboard.zip', mimeType: 'application/zip', buffer: Buffer.from(await testProjectArchive()) });
  await expect(welcome).toHaveCount(0);
  await expect(cards(page)).toHaveCount(24);
  await expect(page.getByRole('button', { name: 'Project menu' })).toHaveAttribute('title', 'Test Project');
  expect(await localCounts(page)).toEqual({ projects: 1, assets: 24 });
  await page.reload();
  await expect(cards(page)).toHaveCount(24);
  await expect(welcome).toHaveCount(0);
});
