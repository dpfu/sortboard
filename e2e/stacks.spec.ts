import { test, expect } from '@playwright/test';
import { cardFromTop, dragLocatorBy, openFreshApp } from './helpers/app';

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

  await page.getByRole('button', { name: 'Start sorting →' }).click();
  await dragLocatorBy(page, stackHandle, { x: 140, y: 80 });
  await expect(page.getByText('Recording · 1 action')).toBeVisible();
});
