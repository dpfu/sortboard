import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { cards, exportProjectZip, handleDialog, importProjectZip, openDisplay, openFreshApp, resetAppState } from './helpers/app';

async function placeNext(page: Page, id: string, remaining: number) {
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']) {
    await page.getByTestId(id).focus();
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (await page.locator('[data-testid^="surface-work-area-"] .boardSurface__count').textContent() === String(remaining - 1)) return;
  }
  throw new Error(`Could not place ${id}`);
}

async function twoImageBoard(page: Page) {
  await openFreshApp(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('sortboard-mvp'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['meta', 'boards'], 'readwrite');
      const get = tx.objectStore('meta').get('activeProjectId');
      get.onsuccess = () => {
        const boards = tx.objectStore('boards');
        const read = boards.get(get.result.value);
        read.onsuccess = () => {
          const board = read.result;
          board.sortConfig.startInFullscreen = false;
          board.cards = board.cards.slice(0, 2).map((card: any, index: number) => ({ ...card, x: 100 + 400 * index, y: 100, z: index + 1, stackId: undefined, stackOrder: undefined }));
          board.stacks = [];
          boards.put(board, board.id);
        };
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Fixture transaction aborted'));
    });
  });
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
}

async function center(page: Page, index: number) {
  const box = await cards(page).nth(index).boundingBox();
  if (!box) throw new Error('Missing card');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('@smoke welcomes a new colleague, saves the result, and starts fresh after reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetAppState(page);
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Try SortBoard' });
  await expect(welcome.getByRole('radio', { name: /^Closed sort/ })).toBeChecked();
  await expect(welcome.getByRole('checkbox')).toHaveCount(0);
  await expect(welcome.locator('.demoDialog__preview img')).toHaveCount(6);
  await welcome.getByRole('button', { name: 'Open demo with 15 images' }).click();
  await expect(welcome).not.toBeVisible();
  await expect(cards(page)).toHaveCount(15);
  // Keep this responsive-layout scenario at its explicit 900 px window size.
  await openDisplay(page);
  await page.getByRole('switch', { name: 'Start in full screen', exact: true }).uncheck();
  await expect(page.locator('.detailsPanel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Recordings (0)' }).click();
  await expect(page.getByRole('heading', { name: 'No recordings yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare a sort' }).click();
  const ids = await cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!));
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');
  for (const [index, id] of ids.entries()) await placeNext(page, id, ids.length - index);
  await expect(page.getByTestId('sort-completion')).toHaveText('All cards placed.');
  await expect(page.getByTestId('sort-completion').getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ready-900.png') });
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('0');
  await page.getByRole('button', { name: 'New sorting session' }).click();
  await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('15');
  await handleDialog(page, () => page.getByRole('button', { name: 'Leave sorting' }).click());
  await expect(page.getByRole('button', { name: 'Recordings (1)' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recordings (1)' }).click();
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('0');
  await page.screenshot({ path: testInfo.outputPath('result-900.png') });
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.locator('[data-testid^="surface-work-area-"] .boardSurface__count')).toHaveText('15');
});

test('inspects images, names a group, and preserves names and the prepared board through ZIP transfer', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await twoImageBoard(page);
  const initial = await cards(page).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
  await cards(page).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.detailsPanel')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.detailsPanel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toBeVisible();
  const enlarge = cards(page).first();
  await enlarge.focus();
  await page.keyboard.press('Alt+Enter');
  await expect(page.getByTestId('image-preview-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(enlarge).toBeFocused();
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeEnabled();
  // Firefox announces fullscreenchange before laying out the larger viewport.
  // Wait for the board before Playwright scrolls a card into view for its click.
  await expect.poll(() => page.evaluate(() => {
    const board = document.querySelector('.board');
    return board?.clientWidth === innerWidth && board?.clientHeight === innerHeight;
  })).toBe(true);
  await cards(page).first().dblclick();
  await expect(page.getByTestId('image-preview-dialog')).toBeVisible();
  await expect(page.locator('.videoDialog__footer')).toHaveCount(0);
  await page.keyboard.press('Escape');
  if (browserName !== 'chromium') {
    // Firefox and WebKit reserve the first Escape for its native full-screen exit.
    await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toBeVisible();
    await expect(page.getByTestId('image-preview-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('image-preview-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  }
  await expect(page.getByTestId('image-preview-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible();
  if (browserName !== 'chromium') await page.getByRole('dialog', { name: 'Controls' }).getByRole('button', { name: 'Close', exact: true }).click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');

  const from = await center(page, 1), to = await center(page, 0);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('.stackDropPreview')).toContainText('Create stack');
  await page.mouse.up();
  const label = page.locator('.stackHalo__handle');
  await expect(label).toHaveCount(1);
  await label.dblclick();
  const name = page.getByRole('textbox', { name: 'Stack name' });
  await name.fill('Unexpected connections');
  await name.press('Enter');
  await expect(label).toContainText('Unexpected connections');
  await expect(page.getByTestId('recording-status')).toHaveText('Recording · 1 action');
  await label.dblclick();
  await name.fill('Cancelled name');
  await name.press('Escape');
  await expect(label).toContainText('Unexpected connections');
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(label).toContainText('Unexpected connections');
  await page.getByRole('button', { name: 'Go to start' }).click();
  await expect(label).toHaveCount(0);
  await page.getByRole('button', { name: 'Show result' }).click();
  await expect(label).toContainText('Unexpected connections');
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Enlarge Demo 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('image-preview-dialog')).toBeVisible();
  if (browserName !== 'chromium') await page.getByTestId('image-preview-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(label).toHaveCount(0);
  expect(await cards(page).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(initial);
  const zipPath = await exportProjectZip(page, testInfo.outputDir);
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const board = JSON.parse(await zip.file('board.json')!.async('string'));
  const sessions = JSON.parse(await zip.file('sessions.json')!.async('string'));
  expect(board.stacks).toEqual([]);
  expect(sessions[0].recording.stackTrack.at(-1).stacks[0].name).toBe('Unexpected connections');
  await importProjectZip(page, zipPath);
  await page.getByRole('button', { name: 'Recordings (1)' }).click();
  await expect(label).toContainText('Unexpected connections');
});

test('keeps sorting open when saving the recording fails and allows retry', async ({ page }) => {
  await twoImageBoard(page);
  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');
  await cards(page).last().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('recording-status')).toContainText('1 action');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreRecordingStore = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'sessions') throw new DOMException('Test storage failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save the recording.');
  await expect(page.getByTestId('recording-status')).toBeVisible();
  await page.evaluate(() => (window as any).restoreRecordingStore());
  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
});
