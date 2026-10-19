import { test, expect, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { openFreshApp } from './helpers/app';

async function dragAcrossBoard(page: Page, card: Locator, target: Locator) {
  await card.scrollIntoViewIfNeeded();
  let previous = await card.boundingBox();
  await expect.poll(async () => {
    const next = await card.boundingBox();
    const stable = !!previous && !!next && Math.abs(previous.y - next.y) < 0.1;
    previous = next; return stable;
  }, { intervals: [50, 50, 100] }).toBe(true);
  const start = (await card.boundingBox())!;
  const board = (await page.getByTestId('board-root').boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  let pointer = { x: 0, y: 0 };
  try {
    await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2, { steps: 3 });
    await expect(card).toHaveClass(/isDragging/);
    await expect.poll(async () => {
      const box = (await target.boundingBox())!;
      const center = box.y + box.height / 2;
      if (center < board.y + 80) { await page.mouse.move(box.x + box.width / 2, board.y + 5); return false; }
      if (center > board.y + board.height - 80) { await page.mouse.move(box.x + box.width / 2, board.y + board.height - 5); return false; }
      pointer = { x: box.x + box.width / 2, y: center };
      await page.mouse.move(pointer.x, pointer.y, { steps: 5 });
      return true;
    }, { timeout: 15000, intervals: [50, 100] }).toBe(true);
    // A stationary pointer must stay attached to its card while the board scrolls.
    await expect.poll(async () => {
      const a = (await card.boundingBox())!;
      return Math.abs(pointer.x - a.x - a.width / 2) < 2 && Math.abs(pointer.y - a.y - a.height / 2) < 2;
    }).toBe(true);
  } finally { await page.mouse.up(); }
}

test('@smoke sorts 60 demo images with the common single-round Q-Sort flow', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFreshApp(page);
  await page.getByRole('button', { name: 'Demo projects', exact: true }).click();
  const demos = page.getByRole('dialog', { name: 'Demo projects', exact: true });
  await demos.getByRole('button', { name: 'Customize images' }).click();
  await demos.getByRole('radio', { name: /^Q-Sort/ }).check();
  await demos.getByRole('button', { name: 'Select all', exact: true }).click();
  await demos.getByRole('button', { name: 'Open demo with 60 images', exact: true }).click();
  await expect(demos).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(60);
  // Even an older Q-Sort template must enter the common task editor before sorting.
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Q-Sort design', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Task for round 1', { exact: true }).fill('Which of these images would you keep?');
  await editor.getByLabel('Left label', { exact: true }).fill('Slop');
  await editor.getByLabel('Right label', { exact: true }).fill('Worth keeping');
  await editor.getByRole('checkbox', { name: 'Pre-sort before each round', exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect(page.locator('.boardSurface--study')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('large-qsort-start.png') });
  const geometry = await page.locator('.board').evaluate(el => ({ viewport: el.clientHeight, height: el.scrollHeight }));
  expect(geometry.height).toBeGreaterThan(geometry.viewport);
  const ids = await page.locator('[data-testid^="card-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!));
  const column = page.locator('[data-testid^="qsort-bucket-"]').nth(3);
  const last = column.locator('.widgetBucket__slot').last();
  const tray = page.locator('[data-testid^="qsort-lane-"]');
  const byAspect = await page.locator('[data-testid^="card-"]').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { id: node.getAttribute('data-testid')!, ratio: box.height / box.width };
  }).sort((a, b) => a.ratio - b.ratio));
  // Cover both extremes deterministically: lifting a portrait must not move
  // its drop point beyond the bottom slot when the preview grows.
  for (const image of [byAspect.at(-1)!, byAspect[0]]) {
    await dragAcrossBoard(page, page.getByTestId(image.id), last);
    await expect(last).toHaveClass(/is-occupied/);
    await dragAcrossBoard(page, page.getByTestId(image.id), tray);
    await expect(last).not.toHaveClass(/is-occupied/);
  }
  for (const id of ids) {
    const before = await tray.locator('.boardSurface__count').textContent();
    await page.getByTestId(id).focus();
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(key);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await tray.locator('.boardSurface__count').textContent() !== before) break;
    }
    await expect(tray.locator('.boardSurface__count')).toHaveText(String(59 - ids.indexOf(id)));
  }
  await expect(page.getByRole('button', { name: 'Finish round', exact: true })).toBeEnabled();
  const lastCard = page.getByTestId(ids.at(-1)!);
  const previousArea = await lastCard.getAttribute('aria-label');
  await dragAcrossBoard(page, lastCard, page.locator('.widgetBucket__slot').first());
  await expect(lastCard).toHaveAttribute('aria-label', previousArea!);
  await expect(page.locator('.widgetBucket__slot.is-occupied')).toHaveCount(60);
  await page.screenshot({ path: info.outputPath('large-qsort-complete.png') });
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your sort', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Replay round 1(?: ·|$)/ }).click();
  await expect(page.locator('.widgetBucket__slot.is-occupied')).toHaveCount(60);
  await page.getByRole('button', { name: 'Go to start', exact: true }).click();
  await expect(page.locator('.widgetBucket__slot.is-occupied')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show result', exact: true }).click();
  await expect(page.locator('.widgetBucket__slot.is-occupied')).toHaveCount(60);
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export study', exact: true }).click();
  const file = info.outputPath('large-qsort.sortboard.zip');
  await (await downloading).saveAs(file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const sessions = JSON.parse(await zip.file('sessions.json')!.async('string'));
  expect(sessions).toHaveLength(1);
  expect(sessions[0].recording.studyRound.design.rounds).toHaveLength(1);
  expect(sessions[0].recording.cardsAtStart).toHaveLength(60);
  expect((await zip.file('results.csv')!.async('string')).trim().split('\n')).toHaveLength(61);
});
