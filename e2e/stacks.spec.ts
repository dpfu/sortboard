import { test, expect } from '@playwright/test';
import { cardFromTop, dragLocatorBy, dragMouseFromTo, openFreshApp } from './helpers/app';

async function persistedStackState(page: Parameters<typeof openFreshApp>[0]) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-mvp');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<{ enabled: boolean | undefined; count: number }>((resolve, reject) => {
      const tx = db.transaction(['meta', 'boards'], 'readonly');
      const metaRequest = tx.objectStore('meta').get('activeProjectId');
      metaRequest.onerror = () => reject(metaRequest.error);
      metaRequest.onsuccess = () => {
        const projectId = (metaRequest.result as { value?: string } | undefined)?.value;
        if (!projectId) {
          reject(new Error('Missing active project'));
          return;
        }
        const boardRequest = tx.objectStore('boards').get(projectId);
        boardRequest.onerror = () => reject(boardRequest.error);
        boardRequest.onsuccess = () => {
          const board = boardRequest.result as
            | { sortConfig?: { stacksEnabled?: boolean }; stacks?: unknown[] }
            | undefined;
          resolve({
            enabled: board?.sortConfig?.stacksEnabled,
            count: board?.stacks?.length ?? 0,
          });
        };
      };
      tx.oncomplete = () => db.close();
    });
  });
}

test('can disable stacking for an Open sort', async ({ page }) => {
  await openFreshApp(page);

  const stackSwitch = page.getByRole('switch', { name: 'Allow stacks' });
  await expect(stackSwitch).toBeChecked();
  await page.getByText('Allow stacks', { exact: true }).click();
  await expect(stackSwitch).not.toBeChecked();
  await expect(page.getByText(/Turning this off separates existing stacks/)).toBeVisible();

  const moving = await cardFromTop(page, 0);
  const target = await cardFromTop(page, 8);
  const movingBox = await moving.boundingBox();
  const targetBox = await target.boundingBox();
  if (!movingBox || !targetBox) throw new Error('Could not resolve cards for drag');
  await dragMouseFromTo(
    page,
    { x: movingBox.x + movingBox.width / 2, y: movingBox.y + movingBox.height / 2 },
    { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
  );

  await expect(page.getByRole('button', { name: /Stack with/ })).toHaveCount(0);
  await expect.poll(() => persistedStackState(page)).toEqual({ enabled: false, count: 0 });
});

test('creates a stack, adds another card, and moves it in sort mode', async ({ page }) => {
  await openFreshApp(page);

  const firstCard = await cardFromTop(page, 0);
  const secondCard = await cardFromTop(page, 4);
  await firstCard.dispatchEvent('pointerdown', { button: 0, pointerId: 1, clientX: 24, clientY: 24 });
  await firstCard.dispatchEvent('pointerup', { button: 0, pointerId: 1, clientX: 24, clientY: 24 });
  await secondCard.dispatchEvent('pointerdown', { button: 0, shiftKey: true, pointerId: 2, clientX: 24, clientY: 24 });
  await secondCard.dispatchEvent('pointerup', { button: 0, shiftKey: true, pointerId: 2, clientX: 24, clientY: 24 });
  await expect(page.getByText('2 cards selected.')).toBeVisible();

  await page.getByRole('button', { name: 'Create stack' }).click();
  await expect(page.getByRole('button', { name: 'Stack with 2 cards' })).toBeVisible();

  const thirdCard = await cardFromTop(page, 8);
  await thirdCard.dispatchEvent('pointerdown', { button: 0, pointerId: 3, clientX: 24, clientY: 24 });
  await thirdCard.dispatchEvent('pointerup', { button: 0, pointerId: 3, clientX: 24, clientY: 24 });
  await page.getByRole('button', { name: /^Add$/ }).click();
  const stackHandle = page.getByRole('button', { name: 'Stack with 3 cards' });
  await expect(stackHandle).toBeVisible();

  await page.getByRole('button', { name: 'Start sorting' }).click();
  await expect(page.getByTestId('recording-status')).toBeVisible();
  await dragLocatorBy(page, stackHandle, { x: 140, y: 80 });
  await expect(page.getByText('Recording · 1 action')).toBeVisible();
});
