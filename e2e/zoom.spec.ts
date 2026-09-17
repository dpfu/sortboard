import { openReplayView } from './helpers/app';
import { expect, test } from '@playwright/test';
import { dragMouseFromTo, openFreshApp } from './helpers/app';

async function latestRecording(page: Parameters<typeof openFreshApp>[0]) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<{ actions: number; cameraFrames: number }>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const sessions = request.result as Array<{
          updatedAt: number;
          recording?: { segments?: unknown[]; cameraTrack?: unknown[] };
        }>;
        const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        resolve({
          actions: latest?.recording?.segments?.length ?? 0,
          cameraFrames: latest?.recording?.cameraTrack?.length ?? 0,
        });
      };
      tx.oncomplete = () => db.close();
    });
  });
}

test('records Open-sort zoom as camera data and preserves the replay viewport after resize', async ({ page }) => {
  const recordedViewport = page.viewportSize();
  if (!recordedViewport) throw new Error('Missing browser viewport');
  await openFreshApp(page);
  // This case resizes the window; full-screen viewport changes have their own suite.
  await page.locator('.displaySettings summary').click();
  await page.getByRole('switch', { name: 'Start in full screen', exact: true }).uncheck();

  const zoomSwitch = page.getByRole('switch', { name: 'Allow board zoom' });
  await expect(zoomSwitch).not.toBeChecked();
  await page.getByText('Allow board zoom', { exact: true }).click();
  await page.getByText('Allow stacks', { exact: true }).click();
  await page.getByRole('button', { name: 'Start sorting' }).click();

  const zoomGroup = page.getByRole('group', { name: 'Board zoom' });
  await expect(zoomGroup).toBeVisible();
  await zoomGroup.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomGroup.getByRole('button', { name: /Reset zoom to 100%/ })).toHaveText('125%');
  await expect(page.getByText('Recording · 0 actions')).toBeVisible();
  await expect(page.getByTestId('recording-status')).toHaveAttribute('data-camera-changes', '1');

  const movingCard = page.locator('[data-testid^="card-"]').last();
  const cardBox = await movingCard.boundingBox();
  if (!cardBox) throw new Error('Missing card bounds');
  const cardXBefore = await movingCard.evaluate(
    (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41
  );
  await dragMouseFromTo(
    page,
    { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    { x: cardBox.x + cardBox.width / 2 + 250, y: cardBox.y + cardBox.height / 2 }
  );
  await expect(page.getByText('Recording · 1 action')).toBeVisible();
  await expect.poll(async () => {
    const x = await movingCard.evaluate(
      (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41
    );
    return Math.abs(x - cardXBefore - 200) <= 2;
  }).toBe(true);

  const sortBoard = page.getByTestId('board-root');
  const boardBox = await sortBoard.boundingBox();
  if (!boardBox) throw new Error('Missing sorting board bounds');
  const beforePan = await sortBoard.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  await page.mouse.move(boardBox.x + boardBox.width - 300, boardBox.y + boardBox.height - 160);
  await page.mouse.down();
  await page.mouse.move(boardBox.x + boardBox.width - 460, boardBox.y + boardBox.height - 240, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => sortBoard.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforePan.left);
  await expect.poll(() => sortBoard.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforePan.top);
  await expect(page.getByText('Recording · 1 action')).toBeVisible();

  await page.getByRole('button', { name: 'Finish sorting' }).click();
  await openReplayView(page);
  await expect(page.getByRole('button', { name: 'Follow recording' })).toBeVisible();
  await openReplayView(page);
  await expect(page.getByRole('button', { name: 'Free view' })).toBeVisible();
  await expect(
    page.getByText(`Recorded viewport ${recordedViewport.width} × ${recordedViewport.height}`, { exact: false })
  ).toBeVisible();
  await expect.poll(async () => (await latestRecording(page)).actions).toBe(1);
  await expect.poll(async () => (await latestRecording(page)).cameraFrames).toBeGreaterThan(2);

  const replayCanvas = page.locator('.replayViewportPlane [data-testid="board-canvas"]');
  await page.getByRole('button', { name: 'Go to start' }).click();
  await expect.poll(() => replayCanvas.evaluate((element) => (element as HTMLElement).style.transform)).toBe('scale(1)');
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect.poll(() => replayCanvas.evaluate((element) => (element as HTMLElement).style.transform)).toBe('scale(1.25)');

  const replayPlane = page.locator('.replayViewportPlane');
  await expect(replayPlane).toHaveCSS('width', `${recordedViewport.width}px`);
  await page.setViewportSize({ width: recordedViewport.width - 120, height: recordedViewport.height - 80 });
  await expect(page.getByRole('alert')).toContainText('Replay fitted to the resized window');
  await expect(replayPlane).toHaveCSS('width', `${recordedViewport.width}px`);
});
