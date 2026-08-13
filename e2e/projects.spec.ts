import { test, expect } from '@playwright/test';
import { cards, handleDialog, openFreshApp, selectedProjectName } from './helpers/app';

test('creates, renames, switches, and deletes projects', async ({ page }) => {
  await openFreshApp(page);
  await expect.poll(() => selectedProjectName(page)).toBe('Demo Project');

  await page.getByRole('button', { name: 'New' }).click();
  await expect.poll(() => selectedProjectName(page)).toBe('Project 2');

  await page.getByRole('button', { name: '+ Text card' }).click();
  await expect(cards(page)).toHaveCount(1);
  await page.waitForTimeout(700);

  await handleDialog(page, () => page.getByRole('button', { name: 'Rename' }).click(), {
    messageIncludes: 'Rename project',
    promptText: 'Alpha Project',
  });
  await expect.poll(() => selectedProjectName(page)).toBe('Alpha Project');

  const projectSelect = page.getByLabel('Select project');
  await projectSelect.selectOption({ label: 'Demo Project' });
  await expect.poll(async () => await cards(page).count()).toBeGreaterThan(1);

  await projectSelect.selectOption({ label: 'Alpha Project' });
  await expect(cards(page)).toHaveCount(1);

  await handleDialog(page, () => page.getByRole('button', { name: 'Delete' }).click(), {
    messageIncludes: 'Permanently delete “Alpha Project”',
  });
  await expect.poll(() => selectedProjectName(page)).toBe('Demo Project');
  await expect(page.getByTestId('project-status')).toContainText('Project deleted.');
});
