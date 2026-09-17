import { openProjectMenu } from './helpers/app';
import { expect, test, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { cards, exportProjectZip, importProjectZip, openFreshApp } from './helpers/app';

async function openDemos(page: Page, type: string) {
  const projectMenu = page.getByRole('button', { name: 'Project menu', exact: true });
  if (await projectMenu.getAttribute('aria-expanded') === 'true') await projectMenu.click();
  await page.getByRole('button', { name: 'Demo projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Demo projects' });
  await dialog.getByRole('button', { name: 'Customize images' }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(60);
  await dialog.getByRole('radio', { name: new RegExp(`^${type}`) }).check();
  return dialog;
}

async function placeCard(page: Page, id: string, sources: Locator, remaining: number) {
  for (const direction of ['ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']) {
    await page.getByTestId(id).focus();
    await page.keyboard.press(direction);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const count = (await sources.locator('.boardSurface__count').allTextContents()).reduce((sum, value) => sum + Number(value), 0);
    if (count === remaining - 1) return;
  }
  throw new Error(`Could not place ${id}`);
}

for (const [type, count] of [['Open sort', 60], ['Closed sort', 15], ['Q-Sort', 24]] as const) {
  test(`@smoke creates the ${type} image demo and preserves it through reload`, async ({ page }) => {
    await openFreshApp(page);
    const dialog = await openDemos(page, type);
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(count);
    await dialog.getByRole('button', { name: `Open demo with ${count} images`, exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    await expect(cards(page)).toHaveCount(count);
    await expect(page.locator('.projectInstructions')).toContainText(type === 'Q-Sort' ? 'Rank the images' : type === 'Closed sort' ? 'Sort each image' : 'Arrange the images');
    await page.reload();
    await expect(cards(page)).toHaveCount(count);
    await expect.poll(() => cards(page).locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await page.getByRole('button', { name: 'Start sorting' }).click();
    await expect(page.locator('.layout--sort')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeEnabled();
    await expect(page.getByText('Instructions', { exact: true })).toBeVisible();
    await expect(page.locator('.detailsPanel')).toHaveCount(0);
  });
}

test('customizes demo images, recalculates Q-Sort capacity, and preserves instructions on export', async ({ page }, testInfo) => {
  await openFreshApp(page);
  const dialog = await openDemos(page, 'Q-Sort');
  const selected = dialog.getByRole('checkbox', { checked: true }).first();
  const excludedName = (await selected.getAttribute('aria-label'))!.replace('Include ', '');
  await selected.uncheck();
  await expect(dialog.getByText('23 images selected', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open demo with 23 images', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(cards(page)).toHaveCount(23);
  const zipPath = await exportProjectZip(page, testInfo.outputDir);
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const board = JSON.parse(await zip.file('board.json')!.async('string'));
  const project = JSON.parse(await zip.file('project.json')!.async('string'));
  expect(project.instructions).toContain('Rank the images');
  expect(board.cards.some((card: any) => card.meta.name === excludedName)).toBe(false);
  expect(board.workflow.widgets.find((widget: any) => widget.kind === 'qsort').buckets.reduce((sum: number, bucket: any) => sum + bucket.capacity, 0)).toBe(23);
  expect(board.cards.every((card: any) => card.meta.notes.includes('Original prompt:') && card.meta.notes.includes('Demo copy SHA-256:'))).toBe(true);
  await importProjectZip(page, zipPath);
  await expect(cards(page)).toHaveCount(23);
  await expect(page.locator('.projectInstructions')).toContainText('Rank the images');
});

test('creates an empty template and leaves the current project intact when downloads fail', async ({ page }) => {
  await openFreshApp(page);
  let dialog = await openDemos(page, 'Closed sort');
  await page.route('**/demo/images/*.webp', route => route.abort());
  await dialog.getByRole('button', { name: 'Open demo with 15 images', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(cards(page)).toHaveCount(24);
  await openProjectMenu(page);
  await expect(page.locator('select[aria-label="Select project"] option')).toHaveCount(1);
  dialog = await openDemos(page, 'Closed sort');
  await dialog.getByRole('button', { name: 'Clear selection' }).click();
  await dialog.getByRole('button', { name: 'Create empty template' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-testid^="surface-sink-"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Start sorting' })).toBeDisabled();
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start sorting' })).toBeEnabled();
});

test('completes the 24-image Q-Sort demo and exports its replay', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFreshApp(page);
  const dialog = await openDemos(page, 'Q-Sort');
  await dialog.getByRole('button', { name: 'Open demo with 24 images' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  const ids = await cards(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')!));
  await page.getByRole('button', { name: 'Start sorting' }).click();
  for (const [index, id] of ids.entries()) {
    await placeCard(page, id, page.locator('[data-testid^="surface-work-area-"]'), ids.length - index);
  }
  await expect(page.getByRole('button', { name: 'Continue to Q-Sort' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue to Q-Sort' }).click();
  for (const [index, id] of ids.entries()) {
    await placeCard(page, id, page.locator('[data-testid^="qsort-lane-"]'), ids.length - index);
  }
  await expect(page.getByRole('button', { name: 'Finish sorting' })).toBeEnabled();
  const counts = await page.locator('.widgetBucket__meta').allTextContents();
  expect(counts.map(value => value.replace(/\s/g, ''))).toEqual(['2/2','3/3','4/4','6/6','4/4','3/3','2/2']);
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(page.getByText('49 recorded actions', { exact: true })).toBeVisible();
  await page.getByTestId('replay-timeline').focus();
  await page.keyboard.press('End');
  await expect(page.locator('.widgetBucket__meta')).toHaveText(counts);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project', exact: true }).click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath('q-sort-replay.sortboard.zip');
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const sessions = JSON.parse(await zip.file('sessions.json')!.async('string'));
  expect(sessions).toHaveLength(1);
  expect(sessions[0].recording.cardsAtStart).toHaveLength(24);
  expect(sessions[0].recording.segments).toHaveLength(49);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Demo projects', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('24');
  const afterReturn = await exportProjectZip(page, testInfo.outputDir, 'after-setup.sortboard.zip');
  const afterZip = await JSZip.loadAsync(await fs.readFile(afterReturn));
  expect(JSON.parse(await afterZip.file('sessions.json')!.async('string'))).toHaveLength(1);
});
