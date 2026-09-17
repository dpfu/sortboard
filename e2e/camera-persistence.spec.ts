import fs from 'node:fs';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';
import { exportProjectZip, handleDialog, openFreshApp, waitForAppReady } from './helpers/app';

async function storedRecording(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sortboard-mvp');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<any>((resolve, reject) => {
        const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.recording);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  });
}

async function startOpen(page: Page) {
  await openFreshApp(page);
  await page.locator('.displaySettings summary').click();
  await page.getByRole('switch', { name: 'Start in full screen', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect.poll(async () => (await storedRecording(page))?.cameraTrack?.length || 0).toBeGreaterThan(0);
  return storedRecording(page);
}

async function observePan(page: Page, duration: number, fail: 'none' | 'database' | 'journal' = 'none') {
  const before = await storedRecording(page);
  const result = await page.getByTestId('board-root').evaluate(async (el, { duration, fail }) => {
    const board = el as HTMLElement;
    const left = board.scrollLeft;
    const top = board.scrollTop;
    const observed: Array<{ x: number; y: number }> = [];
    const count = { sessions: 0, projects: 0, failures: 0 };
    (window as any).cameraWriteCounts = count;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'sessions') {
        count.sessions++;
        if (fail === 'database') { count.failures++; throw new DOMException('Interrupted checkpoint', 'AbortError'); }
      }
      if (this.name === 'projects') count.projects++;
      return put.apply(this, args);
    };
    const setItem = Storage.prototype.setItem;
    if (fail === 'journal') Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('sortboard.pending-camera.')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
    const capture = () => observed.push({ x: board.scrollLeft - left, y: board.scrollTop - top });
    board.addEventListener('scroll', capture);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    let n = 0;
    while (performance.now() - start < duration) {
      board.scrollLeft = left + 4 * ++n;
      board.scrollTop = top + 2 * n;
      await frame();
    }
    await frame(); await frame();
    board.removeEventListener('scroll', capture);
    return observed;
  }, { duration, fail });
  const origin = before.cameraTrack.at(-1);
  const expected = result.filter((point, i) => !i || point.x !== result[i - 1].x || point.y !== result[i - 1].y)
    .map(point => ({ centerX: Math.round((origin.centerX + point.x / origin.scale) * 100) / 100,
      centerY: Math.round((origin.centerY + point.y / origin.scale) * 100) / 100 }));
  expect(expected.length).toBeGreaterThan(3);
  return { before, expected };
}

const journalCount = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('sortboard.pending-camera.')).length);
const cameraTail = (recording: any, start: number) => recording.cameraTrack.slice(start).map(({ centerX, centerY }: any) => ({ centerX, centerY }));

test('batches camera checkpoints without dropping samples through finish, export, and reload', async ({ page }, testInfo) => {
  await startOpen(page);
  const { before, expected } = await observePan(page, 1500);
  await expect.poll(() => journalCount(page)).toBe(0);
  const saved = await storedRecording(page);
  expect(cameraTail(saved, before.cameraTrack.length)).toEqual(expected);
  const writes = await page.evaluate(() => (window as any).cameraWriteCounts);
  expect(writes.sessions).toBeGreaterThan(0);
  expect(writes.sessions).toBeLessThan(8);
  expect(writes.projects).toBeLessThan(8);
  await page.getByRole('button', { name: 'Finish sorting', exact: true }).click();
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
  const zipPath = await exportProjectZip(page, testInfo.outputDir, 'camera.sortboard.zip');
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const sessions = JSON.parse(await zip.file('sessions.json')!.async('string'));
  expect(sessions[0].recording.cameraTrack).toEqual(saved.cameraTrack);
  await page.reload();
  await waitForAppReady(page);
  expect((await storedRecording(page)).cameraTrack).toEqual(saved.cameraTrack);
});

test('recovers the full pending camera path after checkpoint failure and immediate reload', async ({ page }) => {
  await startOpen(page);
  const { before, expected } = await observePan(page, 250, 'database');
  await expect.poll(() => journalCount(page)).toBe(1);
  // The journal must survive even when the pagehide checkpoint also fails.
  await page.reload();
  await waitForAppReady(page);
  expect(cameraTail(await storedRecording(page), before.cameraTrack.length)).toEqual(expected);
  await expect.poll(() => journalCount(page)).toBe(0);
});

test('keeps eager recording saves when recovery storage is unavailable', async ({ page }) => {
  await startOpen(page);
  const { before, expected } = await observePan(page, 250, 'journal');
  await expect.poll(async () => cameraTail(await storedRecording(page), before.cameraTrack.length)).toEqual(expected);
  expect((await page.evaluate(() => (window as any).cameraWriteCounts)).sessions).toBeGreaterThanOrEqual(expected.length);
  expect(await journalCount(page)).toBe(0);
});

test('does not resurrect a discarded recording from a pending camera checkpoint', async ({ page }) => {
  await startOpen(page);
  await observePan(page, 200);
  await handleDialog(page, () => page.getByRole('button', { name: 'Leave sorting' }).click(), {
    messageIncludes: 'This unfinished session will not be available for replay.',
  });
  await waitForAppReady(page);
  expect(await journalCount(page)).toBe(0);
  // Let the checkpoint deadline pass before checking that deletion stays final.
  await page.waitForTimeout(1100);
  expect(await storedRecording(page)).toBeUndefined();
  await page.reload();
  await waitForAppReady(page);
  await expect(page.getByRole('button', { name: 'Recordings (0)' })).toBeVisible();
});
