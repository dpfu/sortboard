import { test, expect } from '@playwright/test';
import { cardFromTop, cards, openFreshApp, resizeCardFromEast } from './helpers/app';

test('persists setup layout mode and card size across reload', async ({ page }) => {
  await openFreshApp(page);

  await page.getByRole('button', { name: 'Fixed 9:16' }).click();
  const slider = page.getByLabel('Card size');
  await slider.focus();
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(slider).toHaveValue('320');
  await page.waitForTimeout(700);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Start sorting →' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Fixed 9:16' })).toHaveClass(/isActive/);
  await expect(slider).toHaveValue('320');

  const box = await (await cardFromTop(page)).boundingBox();
  expect(box).toBeTruthy();
  expect((box?.height || 0) > (box?.width || 0)).toBe(true);
});

test('resizes a card from the east edge and undo restores the prior size', async ({ page }) => {
  await openFreshApp(page);

  await page.getByRole('button', { name: 'New' }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: '+ Text card' }).click();
  await expect(cards(page)).toHaveCount(1);

  const firstCard = await cardFromTop(page);
  await firstCard.click();

  const initialWidth = (await firstCard.boundingBox())?.width ?? 0;
  expect(initialWidth).toBeGreaterThan(0);

  await resizeCardFromEast(page, firstCard, 80);
  await expect
    .poll(async () => (await firstCard.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialWidth + 30);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => (await firstCard.boundingBox())?.width ?? 0)
    .toBeLessThan(initialWidth + 12);
});
