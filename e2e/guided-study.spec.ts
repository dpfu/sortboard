import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { testStudy, testStudyArchive } from '../src/testFixtures/study';
import { dragMouseFromTo, resetAppState, openFreshApp } from './helpers/app';

async function loadStudy(page: Page) {
  await resetAppState(page); await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Welcome to SortBoard' })).toBeVisible();
  const buffer = Buffer.from(await testStudyArchive());
  await page.getByTestId('project-import-input').setInputFiles({ name: 'study.sortboard.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByRole('button', { name: 'Start sorting', exact: true })).toBeVisible();
}
async function storedStudy(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('sortboard-mvp'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const read = (name: string) => new Promise<any[]>((resolve, reject) => {
      const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try { return { projects: await read('projects'), sessions: await read('sessions'), assets: (await read('assets')).length }; }
    finally { db.close(); }
  });
}
async function rankAll(page: Page, drag: boolean, count = 12) {
  await expect(page.locator('.layout--sort')).toBeVisible();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(count);
  const remaining = () => page.locator('[data-testid^="qsort-lane-"] .boardSurface__count').evaluateAll(nodes => nodes.reduce((sum, n) => sum + Number(n.textContent), 0));
  const ids = await page.locator('[data-testid^="card-"]').evaluateAll(ns => ns.map(n => n.getAttribute('data-testid')!));
  for (const id of ids) {
    const card = page.getByTestId(id);
    if (drag) {
      await card.scrollIntoViewIfNeeded();
      const slot = page.locator('.widgetBucket__slot:not(.is-occupied)').first();
      await slot.scrollIntoViewIfNeeded();
      const a = await card.boundingBox(); const b = await slot.boundingBox();
      expect(a).toBeTruthy(); expect(b).toBeTruthy();
      await dragMouseFromTo(page, { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 }, { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 });
    } else {
      await card.focus();
      for (const direction of ['ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) {
        const before = await remaining();
        await page.keyboard.press(direction);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        if (await remaining() !== before) break;
      }
    }
    await expect.poll(remaining).toBe(count - ids.indexOf(id) - 1);
  }
}

test('@smoke authors a single-round Q-Sort in Setup with a custom task and scale, then replays its frozen design', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFreshApp(page);
  await page.getByRole('button', { name: 'Q-Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Set up tasks and rounds', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Q-Sort design', exact: true });
  await editor.getByLabel('Round 1 title', { exact: true }).fill('Keep or discard');
  await editor.getByLabel('Task for round 1', { exact: true }).fill('Which of these images would you keep?');
  await editor.getByLabel('Left label', { exact: true }).fill('Discard');
  await editor.getByLabel('Middle label', { exact: true }).fill('Unsure');
  await editor.getByLabel('Right label', { exact: true }).fill('Keep');
  await editor.getByLabel('Scale positions', { exact: true }).selectOption('5');
  const count = await page.locator('[data-testid^="card-"]').count();
  await editor.getByLabel('Places at position 1', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('places for');
  await editor.getByRole('button', { name: `Fit to ${count} cards`, exact: true }).click();
  await page.screenshot({ path: info.outputPath('qsort-design-editor.png') });
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Q-Sort design', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Which of these images would you keep?', exact: true })).toBeVisible();
  await expect(page.locator('.studyBoard__anchor').filter({ hasText: /^Discard$/ })).toBeVisible();
  await expect(page.locator('.studyBoard__anchor').filter({ hasText: /^Keep$/ })).toBeVisible();
  await expect(page.locator('.widgetBucket')).toHaveCount(5);
  await rankAll(page, false, count);
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your sort', exact: true })).toBeVisible();
  await expect(page.getByLabel('Comparison notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Q-Sort design', exact: true }).click();
  await editor.getByLabel('Right label', { exact: true }).fill('Collect');
  await editor.getByLabel('Exercise language', { exact: true }).selectOption('de');
  await editor.getByLabel('Task for round 1', { exact: true }).fill('A different task for a later participant.');
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await page.getByRole('button', { name: /Recordings \(/ }).click();
  await page.getByTestId('replay-sessions').getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Which of these images would you keep?', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Which of these images would you keep?', exact: true })).toHaveAttribute('lang', 'en');
  await expect(page.locator('.studyBoard__anchor').filter({ hasText: /^Keep$/ })).toBeVisible();
  const stored = await storedStudy(page);
  expect(stored.sessions[0].recording.studyRound.design.anchors.agree).toBe('Keep');
  expect(stored.projects[0].study.anchors.agree).toBe('Collect');
});

test('authors three rounds with optional pre-sort and resumes the ranking stage before comparing all tasks', async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadStudy(page);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Q-Sort design', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Q-Sort design', exact: true });
  await editor.getByRole('button', { name: 'Add round', exact: true }).click();
  await editor.getByLabel('Task for round 3', { exact: true }).fill('Which images would start a useful discussion?');
  await editor.getByLabel('Pre-sort before each round', { exact: true }).check();
  await editor.getByLabel('Group 1', { exact: true }).fill('More');
  await editor.getByLabel('Group 2', { exact: true }).fill('Less');
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  for (let round = 0; round < 3; round++) {
    await expect(page.getByRole('button', { name: 'Continue to Q-Sort', exact: true })).toBeVisible();
    const ids = await page.locator('[data-testid^="card-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')!));
    for (const [i, id] of ids.entries()) {
      const card = page.getByTestId(id);
      await card.scrollIntoViewIfNeeded();
      const target = page.locator('[data-testid^="surface-sink-"]').nth(i % 2);
      await target.scrollIntoViewIfNeeded();
      const a = await card.boundingBox(); const b = await target.boundingBox();
      await dragMouseFromTo(page, {x:a!.x+a!.width/2,y:a!.y+a!.height/2}, {x:b!.x+b!.width/2,y:b!.y+b!.height/2});
    }
    await page.getByRole('button', { name: 'Continue to Q-Sort', exact: true }).click();
    await expect(page.locator('.boardSurface--study')).toHaveCount(1);
    await expect(page.locator('[data-testid^="qsort-lane-"]')).toHaveCount(2);
    if (round === 0) {
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Resume round 1', exact: true }).click();
      await expect(page.locator('.boardSurface--study')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Continue to Q-Sort', exact: true })).toHaveCount(0);
    }
    await rankAll(page, true);
    await page.getByRole('button', { name: 'Finish round', exact: true }).click();
    if (round < 2) await page.getByRole('button', { name: `Continue to round ${round + 2}`, exact: true }).click();
  }
  await expect(page.locator('.studyComparison thead th')).toHaveCount(4);
  const stored = await storedStudy(page);
  expect(stored.sessions).toHaveLength(3);
  expect(stored.sessions.every((s: any) => s.recording.studyRound.completedAt && s.recording.segments.some((seg: any) => seg.type === 'stage-transition'))).toBe(true);
  await page.getByRole('button', { name: 'New participant', exact: true }).click();
  expect((await storedStudy(page)).sessions).toHaveLength(3);
  await expect(page.getByRole('button', { name: 'Start sorting', exact: true })).toBeVisible();
});

test('creates a Q-Sort from blank with text cards and exports a restorable one-task design', async ({ page }, info) => {
  await resetAppState(page); await page.goto('/');
  await page.getByRole('button', { name: /Start with a blank project/ }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Text card', exact: true }).click();
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(i + 1);
  }
  await page.getByRole('button', { name: 'Q-Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Set up tasks and rounds', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Q-Sort design', exact: true });
  await editor.getByLabel('Task for round 1', { exact: true }).fill('Rank these ideas by usefulness.');
  await editor.getByLabel('Scale positions', { exact: true }).selectOption('3');
  await editor.getByRole('button', { name: 'Save design', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rank these ideas by usefulness.', exact: true })).toBeVisible();
  await rankAll(page, false, 3);
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.locator('.studyImage .cardPreview__text')).toHaveCount(3);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export study', exact: true }).click();
  const file = info.outputPath('single-task-text.sortboard.zip');
  await (await downloading).saveAs(file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const recorded = JSON.parse(await zip.file('sessions.json')!.async('string'))[0].recording;
  expect(recorded.studyRound.design.rounds).toHaveLength(1);
  expect(recorded.studyRound.design.scale.map((s: any) => s.capacity)).toEqual([1, 1, 1]);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByTestId('project-import-input').setInputFiles(file);
  await expect(page.locator('.studyImage .cardPreview__text')).toHaveCount(3);
});

test('@smoke completes both guided rounds, preserves the first result, replays and exports a restorable study', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadStudy(page);
  await page.screenshot({ path: info.outputPath('01-intro.png') });
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect(page.locator('[data-testid^="qsort-lane-"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Continue to Q-Sort' })).toHaveCount(0);
  await expect.poll(() => page.locator('[data-testid^="card-"] img').evaluateAll(ns => ns.every(n => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('[data-testid^="card-"]').first().dblclick();
  await expect(page.getByTestId('image-preview-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish round', exact: true })).toBeDisabled();
  await rankAll(page, true);
  await page.screenshot({ path: info.outputPath('02-first-result.png') });
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A moment to reflect' })).toBeVisible();
  const firstSaved = (await storedStudy(page)).sessions[0].recording;
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Replay round 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A moment to reflect', exact: true })).toBeVisible();
  expect((await storedStudy(page)).sessions[0].recording).toEqual(firstSaved);
  await page.getByRole('button', { name: 'Continue to round 2', exact: true }).click();
  await expect(page.locator('[data-testid^="qsort-lane-"] .boardSurface__count')).toHaveText('12');
  await expect(page.locator('.studySortPrompt')).toContainText('I can do something');
  await rankAll(page, true);
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compare your two perspectives' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('03-comparison.png'), fullPage: true });
  await page.getByRole('button', { name: /Replay round 1/ }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  await expect(page.locator('.widgetBucket__meta')).toHaveText(['1 / 1', '1 / 1', '2 / 2', '4 / 4', '2 / 2', '1 / 1', '1 / 1']);
  await expect.poll(() => page.locator('[data-testid^="card-"] img').evaluateAll(ns => ns.every(n => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export study', exact: true }).click();
  const download = await downloading; const file = info.outputPath('completed-study.sortboard.zip'); await download.saveAs(file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const recordings = JSON.parse(await zip.file('sessions.json')!.async('string')).map((s: any) => s.recording);
  expect(recordings).toHaveLength(2);
  expect(recordings.every((r: any) => r.surfaceLayoutVersion === 4)).toBe(true);
  const firstExported = recordings.find((r: any) => r.studyRound.id === 'importance');
  expect(JSON.stringify(firstExported.segments)).toBe(JSON.stringify(firstSaved.segments));
  expect(JSON.stringify(firstExported.cardsAtStart)).toBe(JSON.stringify(firstSaved.cardsAtStart));
  expect(firstExported.workflowAtStart).toEqual(firstSaved.workflowAtStart);
  expect(recordings.every((r: any) => r.studyRound.completedAt && r.segments.length === 12)).toBe(true);
  const initialOrders = recordings.map((r: any) => r.cardsAtStart.map((c: any) => c.id));
  expect([...initialOrders[0]].sort()).toEqual([...initialOrders[1]].sort()); expect(initialOrders[0]).not.toEqual(initialOrders[1]);
  expect(JSON.parse(await zip.file('assets.json')!.async('string'))).toHaveLength(12);
  expect((await zip.file('results.csv')!.async('string')).split('\r\n')).toHaveLength(13);
  expect(zip.file('image-credits.txt')).not.toBeNull();
  expect(zip.file('discussion-notes.txt')).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Compare your two perspectives' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByTestId('project-import-input').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Compare your two perspectives' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: /Replay round 2/ }).click();
  await expect(page.locator('.widgetBucket__meta')).toHaveText(['1 / 1', '1 / 1', '2 / 2', '4 / 4', '2 / 2', '1 / 1', '1 / 1']);
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  const beforeNew = await storedStudy(page);
  await page.getByRole('button', { name: 'New participant', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start sorting', exact: true })).toBeVisible();
  const afterNew = await storedStudy(page);
  expect(afterNew.assets).toBe(beforeNew.assets);
  expect(afterNew.sessions).toHaveLength(beforeNew.sessions.length);
  expect(afterNew.projects).toHaveLength(beforeNew.projects.length + 1);
});

test('resumes an interrupted guided round after reload and pause without adding another recording', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadStudy(page);
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  const card = page.locator('[data-testid^="card-"]').first();
  await card.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid^="qsort-lane-"] .boardSurface__count')).toHaveText('11');
  await page.reload();
  await page.getByRole('button', { name: 'Resume round 1', exact: true }).click();
  await expect(page.locator('[data-testid^="qsort-lane-"] .boardSurface__count')).toHaveText('11');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume round 1', exact: true }).click();
  await expect(page.locator('[data-testid^="qsort-lane-"] .boardSurface__count')).toHaveText('11');
  expect((await storedStudy(page)).sessions).toHaveLength(1);
});

test('keeps a study round open when saving its completed result fails and safely retries', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadStudy(page);
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await rankAll(page, false);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreStudySave = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'sessions' && value.recording?.studyRound?.completedAt) throw new DOMException('Test full disk', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByRole('button', { name: 'Finish round', exact: true })).toBeEnabled();
  expect((await storedStudy(page)).sessions[0].recording.studyRound.completedAt).toBeUndefined();
  await page.evaluate(() => (window as any).restoreStudySave());
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to round 2', exact: true })).toBeVisible();
  expect((await storedStudy(page)).sessions[0].recording.studyRound.completedAt).toBeTruthy();
});

test('persists a newly created text card before it becomes visible and survives immediate reload', async ({ page }) => {
  await resetAppState(page); await page.goto('/');
  await page.getByRole('button', { name: /Start with a blank project/ }).click();
  await page.getByRole('button', { name: 'Text card', exact: true }).click();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(1);
});

test('imports a prepared study once from its link and reuses the same project after reload', async ({ page }) => {
  await resetAppState(page);
  let requests = 0;
  await page.route('**/studies/test-study.sortboard.zip', async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(await testStudyArchive()) });
  });
  await page.goto('/?study=test-study');
  await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeVisible();
  await page.getByTestId('project-import-input').setInputFiles({name:'invalid.zip', mimeType:'application/zip', buffer:Buffer.from('invalid archive')});
  await expect(page.getByRole('alert')).toContainText('Import failed');
  await page.getByTestId('project-import-input').setInputFiles({name:'study.sortboard.zip', mimeType:'application/zip', buffer:Buffer.from(await testStudyArchive())});
  await expect(page.getByRole('button', { name: 'Start sorting', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start sorting', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  expect((await storedStudy(page)).projects).toHaveLength(1);
});

test('@smoke runs the German seminar study after one project import through comparison and export', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const buffer = process.env.SORTBOARD_STUDY_ARCHIVE ? await fs.readFile(process.env.SORTBOARD_STUDY_ARCHIVE) : Buffer.from(await testStudyArchive({
    ...testStudy, id:'climate-images', taskLanguage:'de', title:'Klimabilder',
    rounds:[{id:'importance', title:'Wichtigkeit', prompt:'Dieses Bild gibt mir das Gefühl, dass der Klimawandel wichtig ist.'},
      {id:'ability-to-act', title:'Handlungsmöglichkeit', prompt:'Dieses Bild gibt mir das Gefühl, dass ich etwas gegen den Klimawandel tun kann.'}],
  }));
  const initialZip = await JSZip.loadAsync(buffer);
  expect(JSON.parse(await initialZip.file('sessions.json')!.async('string'))).toEqual([]);
  expect(JSON.parse(await initialZip.file('project.json')!.async('string')).study.taskLanguage).toBe('de');
  await page.goto(`${process.env.SORTBOARD_SITE_PATH || ''}/?study=climate-images`);
  await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeVisible();
  await page.getByTestId('project-import-input').setInputFiles({name:'climate-images.sortboard.zip', mimeType:'application/zip', buffer});
  await expect(page.getByRole('heading', { name: 'Klimabilder', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome to SortBoard' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('seminar-01-introduction.png') });
  await page.getByRole('button', { name: 'Start sorting', exact: true }).click();
  await expect(page.locator('.studySortPrompt')).toContainText('dass der Klimawandel wichtig ist');
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(12);
  await expect.poll(() => page.locator('[data-testid^="card-"] img').evaluateAll(nodes => nodes.every(n => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Eine volle Spalte nimmt kein weiteres Bild an');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: info.outputPath('seminar-02-sorting.png') });
  await rankAll(page, true);
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kurz besprechen', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.locator('.studyReflection img').evaluateAll(async nodes => { await Promise.all(nodes.map(n => (n as HTMLImageElement).decode())); });
  await page.locator('.studyReflection').screenshot({ path: info.outputPath('seminar-02-discussion.png') });
  await page.getByRole('button', { name: 'Replay round 1', exact: true }).click();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kurz besprechen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to round 2', exact: true }).click();
  await expect(page.locator('.studySortPrompt')).toContainText('etwas gegen den Klimawandel tun kann');
  await rankAll(page, true);
  await page.getByRole('button', { name: 'Finish round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zwei Perspektiven vergleichen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Replay round 1/ }).click();
  await expect(page.locator('.studyReplayHint')).toContainText('nach den Gründen fragen');
  await expect(page.getByRole('button', { name: 'New sorting session', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zwei Perspektiven vergleichen', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Zwei Perspektiven vergleichen', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export study', exact: true }).click();
  const file = info.outputPath('seminar-completed.sortboard.zip');
  await (await downloading).saveAs(file);
  await expect(page.locator('.studyExported')).toContainText('Prüft, ob die ZIP-Datei im Downloadordner liegt');
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const recordings = JSON.parse(await zip.file('sessions.json')!.async('string'));
  expect(recordings).toHaveLength(2);
  expect(recordings.every((r: any) => r.recording.studyRound.completedAt && r.recording.segments.length === 12)).toBe(true);
  await page.screenshot({ path: info.outputPath('seminar-03-comparison.png'), fullPage: true });
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByTestId('project-import-input').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Zwei Perspektiven vergleichen', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
