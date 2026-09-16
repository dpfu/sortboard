import { expect, test, type Page } from '@playwright/test';
import { cards, openDisplay, resetAppState } from './helpers/app';

async function poses(page: Page) {
  return cards(page).evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const card = node as HTMLElement;
    const matrix = new DOMMatrix(getComputedStyle(card).transform);
    return [card.dataset.testid!, { x: Math.round(matrix.m41), y: Math.round(matrix.m42), w: card.offsetWidth, h: card.offsetHeight }];
  })));
}

async function layers(page: Page) {
  return cards(page).evaluateAll(nodes => Object.fromEntries(nodes.map(node => [(node as HTMLElement).dataset.testid!, getComputedStyle(node).zIndex])));
}

async function dropAt(page: Page, id: string, x: number, y: number) {
  const card = page.getByTestId(id);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 14 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.mouse.up();
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  await expect.poll(async () => {
    const pose = (await poses(page))[id];
    return Math.max(Math.abs(pose.x - (x - canvas.x - pose.w / 2)), Math.abs(pose.y - (y - canvas.y - pose.h / 2)));
  }).toBeLessThanOrEqual(1);
}

for (const width of [900, 1454]) {
  test(`keeps Closed-sort cards where released and replays their positions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 979 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await resetAppState(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open demo with 15 images', exact: true }).click();
    await expect(cards(page)).toHaveCount(15);
    await openDisplay(page);
    await page.getByRole('switch', { name: 'Start in full screen', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Start sorting' }).click();
    await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');
    await cards(page).locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    let previous = '';
    let stableSamples = 0;
    await expect.poll(async () => {
      const current = JSON.stringify(await poses(page));
      stableSamples = current === previous ? stableSamples + 1 : 0;
      previous = current;
      return stableSamples;
    }).toBeGreaterThanOrEqual(2);
    const initial = await poses(page);
    const ids = Object.keys(initial);
    const rectangles = Object.values(initial);
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      expect(a.x + a.w + 10 <= b.x || b.x + b.w + 10 <= a.x || a.y + a.h + 10 <= b.y || b.y + b.h + 10 <= a.y).toBe(true);
    }
    const source = page.locator('[data-testid^="surface-work-area-"]');
    const targets = page.locator('[data-testid^="surface-sink-"]');
    const left = (await targets.first().boundingBox())!, right = (await targets.last().boundingBox())!;
    expect(left.y).toEqual(right.y);
    expect(left.x + left.width).toBeLessThan(right.x);
    expect((await page.locator('.sortBar').boundingBox())!.height).toBe(64);
    await page.screenshot({ path: testInfo.outputPath(`board-start-${width}.png`) });

    await page.getByTestId(ids[0]).click();
    expect(await poses(page)).toEqual(initial);
    await expect(page.getByTestId('recording-status')).toHaveText('Recording · 0 actions');
    // Neutral board space remains usable; this card is still unsorted.
    await dropAt(page, ids[0], left.x + left.width / 2, left.y + left.height + 90);
    await expect(page.getByTestId('recording-status')).toHaveText('Recording · 1 action');
    const neutral = await poses(page);
    for (const id of ids.slice(1)) expect(neutral[id]).toEqual(initial[id]);
    await expect(source.locator('.boardSurface__count')).toHaveText('15');
    await expect(page.getByRole('button', { name: 'Finish sorting' })).toBeDisabled();

    await dropAt(page, ids[1], left.x + left.width / 2, left.y + 160);
    await expect(page.getByTestId('recording-status')).toHaveText('Recording · 2 actions');
    const assigned = await poses(page);
    for (const id of ids.filter(id => id !== ids[1])) expect(assigned[id]).toEqual(neutral[id]);
    await expect(source.locator('.boardSurface__count')).toHaveText('14');
    await expect(targets.first().locator('.boardSurface__count')).toHaveText('1');
    // Reposition within the category without moving its neighbours.
    await dropAt(page, ids[1], left.x + left.width / 2 + 12, left.y + 220);
    await expect(page.getByTestId('recording-status')).toHaveText('Recording · 3 actions');
    const repositioned = await poses(page);
    for (const id of ids.filter(id => id !== ids[1])) expect(repositioned[id]).toEqual(assigned[id]);
    await expect(targets.first().locator('.boardSurface__count')).toHaveText('1');
    await page.setViewportSize({ width: width - 100, height: 850 });
    expect(await poses(page)).toEqual(repositioned);
    await page.setViewportSize({ width, height: 979 });

    let remaining = 14;
    for (const id of ids.filter(id => id !== ids[1])) {
      for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) {
        await page.getByTestId(id).focus();
        await page.keyboard.press(key);
        if (await source.locator('.boardSurface__count').textContent() === String(remaining - 1)) break;
      }
      await expect(source.locator('.boardSurface__count')).toHaveText(String(--remaining));
    }
    expect((await poses(page))[ids[1]]).toEqual(repositioned[ids[1]]);
    await page.screenshot({ path: testInfo.outputPath(`board-sorted-${width}.png`) });
    const final = await poses(page);
    const finalLayers = await layers(page);
    await page.getByRole('button', { name: 'Finish sorting' }).click();
    await expect(page.getByText('Result', { exact: true })).toBeVisible();
    expect(await poses(page)).toEqual(final);
    expect(await layers(page)).toEqual(finalLayers);
    await page.reload();
    await page.getByRole('button', { name: 'Recordings (1)', exact: true }).click();
    await expect(page.getByText('Result', { exact: true })).toBeVisible();
    expect(await poses(page)).toEqual(final);
    expect(await layers(page)).toEqual(finalLayers);
  });
}
