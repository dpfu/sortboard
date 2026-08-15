import path from 'node:path';
import { expect, type FilePayload, type Locator, type Page } from '@playwright/test';

const DB_NAME = 'sortboard-mvp';

export async function resetAppState(page: Page) {
  await page.context().clearCookies();
  await page.goto('/playwright-reset.html');
  await page.evaluate(async (dbName) => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // ignore storage availability errors
    }

    await new Promise<void>((resolve, reject) => {
      const req = window.indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Could not delete IndexedDB database ${dbName}`));
      req.onblocked = () => {
        // The request remains pending and will succeed once the old connection closes.
      };
    });
  }, DB_NAME);
}

export async function gotoApp(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
}

export async function openFreshApp(page: Page) {
  await resetAppState(page);
  await gotoApp(page);
}

async function persistedBoardCardCount(page: Page) {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = window.indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const boardCount = await new Promise<number | null>((resolve, reject) => {
      const tx = db.transaction(['meta', 'boards'], 'readonly');
      const metaGet = tx.objectStore('meta').get('activeProjectId');
      metaGet.onerror = () => reject(metaGet.error);
      metaGet.onsuccess = () => {
        const activeProjectId = (metaGet.result as { value?: string } | undefined)?.value ?? null;
        if (!activeProjectId) {
          resolve(null);
          return;
        }
        const boardGet = tx.objectStore('boards').get(activeProjectId);
        boardGet.onerror = () => reject(boardGet.error);
        boardGet.onsuccess = () => {
          const board = boardGet.result as { cards?: unknown[] } | undefined;
          resolve(board?.cards?.length ?? 0);
        };
      };
      tx.oncomplete = () => db.close();
    });
    return boardCount;
  }, DB_NAME);
}

export async function waitForAppReady(page: Page) {
  const startButton = page.getByRole('button', { name: 'Start sorting →' });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled({ timeout: 10_000 });
  await expect.poll(() => selectedProjectName(page)).not.toBe('');
  await expect.poll(() => persistedBoardCardCount(page)).not.toBeNull();
  const expectedCardCount = await persistedBoardCardCount(page);
  expect(expectedCardCount).not.toBeNull();
  await expect(cards(page)).toHaveCount(expectedCardCount!);
}

export function cards(page: Page) {
  return page.locator('[data-testid^="card-"]');
}

export async function cardFromTop(page: Page, offset = 0) {
  const count = await cards(page).count();
  if (count <= offset) {
    throw new Error(`Requested top card offset ${offset} with only ${count} cards available`);
  }
  return cards(page).nth(count - 1 - offset);
}

type UploadFiles = string | string[] | FilePayload | FilePayload[];

export async function uploadThroughHiddenInput(page: Page, testId: string, files: UploadFiles) {
  await page.getByTestId(testId).setInputFiles(files);
}

export async function uploadMediaWithChooser(page: Page, files: UploadFiles) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Add images or videos/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

export async function uploadMedia(page: Page, files: UploadFiles) {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName === 'webkit') {
    await uploadThroughHiddenInput(page, 'media-input', files);
    return;
  }
  await uploadMediaWithChooser(page, files);
}

export async function dragMouseFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
    await page.mouse.move(to.x, to.y);
  } finally {
    await page.mouse.up();
  }
}

async function dragFromToWithPointerEvents(
  locator: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await locator.evaluate((element, payload) => {
    const pointerId = 1;
    const steps = 12;
    const dispatch = (
      target: EventTarget,
      type: string,
      point: { x: number; y: number },
      buttons: number
    ) => {
      if (window.PointerEvent) {
        target.dispatchEvent(
          new window.PointerEvent(type, {
            bubbles: true,
            composed: true,
            cancelable: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons,
            clientX: point.x,
            clientY: point.y,
          })
        );
        return;
      }
      target.dispatchEvent(
        new window.MouseEvent(type, {
          bubbles: true,
          composed: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX: point.x,
          clientY: point.y,
        })
      );
    };

    dispatch(element, 'pointermove', payload.from, 0);
    dispatch(element, 'pointerdown', payload.from, 1);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const point = {
        x: payload.from.x + (payload.to.x - payload.from.x) * progress,
        y: payload.from.y + (payload.to.y - payload.from.y) * progress,
      };
      dispatch(window, 'pointermove', point, 1);
      dispatch(document, 'pointermove', point, 1);
      dispatch(element, 'pointermove', point, 1);
    }
    dispatch(window, 'pointerup', payload.to, 0);
    dispatch(document, 'pointerup', payload.to, 0);
    dispatch(element, 'pointerup', payload.to, 0);
  }, { from, to });
}

export async function dragLocatorBy(page: Page, locator: Locator, delta: { x: number; y: number }) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Could not resolve locator bounding box for drag');
  }

  const from = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const to = {
    x: from.x + delta.x,
    y: from.y + delta.y,
  };
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await dragFromToWithPointerEvents(locator, from, to);
    return;
  }
  await dragMouseFromTo(page, from, to);
}

export async function resizeCardFromEast(page: Page, locator: Locator, deltaX: number) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toHaveClass(/isSelected/);
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Could not resolve locator bounding box for resize');
  }

  const from = {
    x: box.x + box.width - 2,
    y: box.y + box.height / 2,
  };
  const to = {
    x: from.x + deltaX,
    y: from.y,
  };
  await dragMouseFromTo(page, from, to);
}

type DialogOptions = {
  accept?: boolean;
  messageIncludes?: string;
  promptText?: string;
};

export async function handleDialog(
  page: Page,
  trigger: () => Promise<unknown>,
  { accept = true, messageIncludes, promptText }: DialogOptions = {}
) {
  const dialogPromise = page.waitForEvent('dialog');
  const triggerPromise = trigger();
  const dialog = await dialogPromise;
  if (messageIncludes) {
    expect(dialog.message()).toContain(messageIncludes);
  }
  if (accept) {
    await dialog.accept(promptText);
  } else {
    await dialog.dismiss();
  }
  await triggerPromise;
}

export async function exportProjectZip(page: Page, outputDir: string, fileName = 'project.sortboard.zip') {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const targetPath = path.join(outputDir, fileName);
  await download.saveAs(targetPath);
  return targetPath;
}

export async function importProjectZip(page: Page, filePath: string) {
  await page.getByTestId('project-import-input').setInputFiles(filePath);
  await expect(page.getByTestId('project-status')).toContainText('Project imported.');
}

export async function selectedProjectName(page: Page) {
  const text = await page.locator('select[aria-label="Select project"] option:checked').textContent();
  return text?.trim() || '';
}
