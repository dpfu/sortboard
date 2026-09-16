import { openDisplay, openProjectMenu, openReplayView } from './helpers/app';
import { expect, test, type Page } from '@playwright/test';
import { cards, exportProjectZip, handleDialog, importProjectZip, openFreshApp, waitForAppReady } from './helpers/app';

const option = (page: Page) => page.getByRole('switch', { name: 'Start in full screen', exact: true });
const enter = (page: Page) => page.getByRole('button', { name: 'Full screen', exact: true });
const exit = (page: Page) => page.getByRole('button', { name: 'Exit full screen', exact: true });
const fullscreenTarget = (page: Page) => page.evaluate(() => document.fullscreenElement?.className ?? null);

test('defaults new projects to full screen and preserves opting out through sort types, reload and ZIP transfer', async ({ page }, testInfo) => {
  await openFreshApp(page);
  await openDisplay(page);
  await expect(option(page)).toBeChecked();
  await option(page).uncheck();
  for (const type of ['Closed sort', 'Q-Sort', 'Open sort']) {
    await page.getByRole('button', { name: type, exact: true }).click();
    await openDisplay(page);
    await expect(option(page)).not.toBeChecked();
  }
  const zip = await exportProjectZip(page, testInfo.outputDir);
  await page.reload();
  await waitForAppReady(page);
  await openDisplay(page);
  await expect(option(page)).not.toBeChecked();
  expect(await fullscreenTarget(page)).toBeNull();

  await openProjectMenu(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await openDisplay(page);
  await expect(option(page)).toBeChecked();
  await importProjectZip(page, zip);
  await openDisplay(page);
  await expect(option(page)).not.toBeChecked();
  expect(await fullscreenTarget(page)).toBeNull();
});

test('starts a full-screen recording at its actual viewport and returns to a fitted replay', async ({ page }) => {
  await openFreshApp(page);
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(exit(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBe('app app--sort');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  await cards(page).last().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Recording · 1 action', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish sorting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Setup', exact: true })).toBeVisible();
  expect(await fullscreenTarget(page)).toBeNull();
  await openReplayView(page);
  await expect(page.getByText(`Recorded viewport ${viewport.width} × ${viewport.height}`, { exact: false })).toBeVisible();
  await expect(page.locator('.replayViewportPlane')).toHaveCSS('width', `${viewport.width}px`);
  await expect(page.getByText('1 recorded action', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Replay fitted to the resized window' })).toHaveCount(0);

  await enter(page).click();
  await expect(exit(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBe('replayPresentation');
  await exit(page).click();
  await expect(enter(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBeNull();

  await page.getByRole('button', { name: 'New sorting session', exact: true }).click();
  await expect(exit(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBe('app app--sort');
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
});

test('can toggle full screen during a normal sort and follows browser-initiated exit', async ({ page }) => {
  await openFreshApp(page);
  await openDisplay(page);
  await option(page).uncheck();
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(enter(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBeNull();
  await enter(page).click();
  await expect(exit(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBe('app app--sort');
  await page.keyboard.press('Escape');
  await expect(enter(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBeNull();
  await enter(page).click();
  await expect(exit(page)).toBeEnabled();
  // Native API exit exercises the same fullscreenchange event as browser Esc.
  // It also covers changes initiated outside the app's buttons and shortcuts.
  await page.evaluate(() => document.exitFullscreen());
  await expect(enter(page)).toBeEnabled();
  await expect(enter(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  await enter(page).click();
  await expect(exit(page)).toBeEnabled();
  await exit(page).click();
  await expect(enter(page)).toBeEnabled();
  expect(await fullscreenTarget(page)).toBeNull();
});

for (const type of ['Closed sort', 'Q-Sort']) {
  test(`starts ${type} in full screen and exits when returning to Setup`, async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: type, exact: true }).click();
    await page.getByRole('button', { name: 'Start sorting' }).click();
    await expect(exit(page)).toBeEnabled();
    expect(await fullscreenTarget(page)).toBe('app app--sort');
    await expect(cards(page)).toHaveCount(24);
    await handleDialog(page, () => page.getByRole('button', { name: 'Leave sorting', exact: true }).click());
    await openDisplay(page);
    await expect(option(page)).toBeChecked();
    expect(await fullscreenTarget(page)).toBeNull();
    await expect(cards(page)).toHaveCount(24);
  });
}

test('continues sorting and recording when the browser rejects a full-screen request', async ({ page }) => {
  await openFreshApp(page);
  await openDisplay(page);
  await option(page).check();
  await page.evaluate(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new DOMException('Denied for test', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Full screen could not start.' })).toBeVisible();
  expect(await fullscreenTarget(page)).toBeNull();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
  await cards(page).last().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Recording · 1 action', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish sorting', exact: true }).click();
  await expect(page.getByText('1 recorded action', { exact: true })).toBeVisible();
});

test('leaves sorting available when full screen is unsupported', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }));
  await openFreshApp(page);
  await openDisplay(page);
  await expect(option(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(enter(page)).toBeDisabled();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toBeVisible();
});

test('returns to windowed Setup if the board cannot be saved before a full-screen start', async ({ page }) => {
  await openFreshApp(page);
  await openDisplay(page);
  await option(page).check();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'boards') throw new DOMException('Storage failure for test', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('project-status')).toContainText('Could not save the latest board changes before sorting.');
  expect(await fullscreenTarget(page)).toBeNull();
  await openDisplay(page);
  await expect(option(page)).toBeChecked();
  await expect(page.getByText('Recording · 0 actions', { exact: true })).toHaveCount(0);
});
