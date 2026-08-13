import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowForTemplate } from './workflow';

async function resetDb() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('sortboard-mvp');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

async function loadPersist() {
  const m = await import('./persist');
  return m;
}

describe('persist project management', () => {
  beforeAll(async () => {
    vi.resetModules();
    await resetDb();
  });

  it('migrates legacy v1 current board into a demo project', async () => {
    const legacy = await openDB('sortboard-mvp', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards');
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions');
          sessions.createIndex('byBoardId', 'boardId');
        }
      },
    });

    await legacy.put('boards', {
      version: 1,
      id: 'current',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cards: [{ id: 'c1', kind: 'dummy', x: 1, y: 2, z: 3 }],
    }, 'current');
    await legacy.put('sessions', {
      version: 1,
      id: 's1',
      boardId: 'current',
      updatedAt: 2,
      recording: {
        version: 1,
        createdAt: '2026-02-01T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        cardsAtStart: [{ id: 'c1', kind: 'dummy', x: 1, y: 2, z: 3 }],
        segments: [],
      },
    }, 's1');
    legacy.close();

    const persist = await loadPersist();
    const projects = await persist.persistListProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Demo Project');

    const activeProjectId = await persist.persistGetActiveProjectId();
    expect(activeProjectId).toBe(projects[0].id);

    const migratedBoard = await persist.persistGetBoard(projects[0].id);
    expect(migratedBoard?.id).toBe(projects[0].id);
    expect(migratedBoard?.cards).toHaveLength(1);
    expect(migratedBoard?.cards[0].kind).toBe('text');
    expect(migratedBoard?.cards[0].meta?.name).toBe('Card 1');

    const sessions = await persist.persistListSessions(projects[0].id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].boardId).toBe(projects[0].id);
    expect(sessions[0].recording.cardsAtStart[0].meta.name).toBe('Card 1');
  });
});

describe('persist project workflows', () => {
  let persist: Awaited<ReturnType<typeof loadPersist>>;

  beforeAll(async () => {
    persist = await loadPersist();
  });

  beforeEach(async () => {
    await persist.persistDeleteAll();
  });

  it('stores file assets as plain blobs for cross-browser IndexedDB compatibility', async () => {
    const fileAsset = new File(['hello'], 'tiny-image.png', { type: 'image/png' });

    await persist.persistPutAsset('file-asset', fileAsset, fileAsset.type);

    const stored = await persist.persistGetAsset('file-asset');
    expect(stored).toBeTruthy();
    expect(stored?.blob).toBeInstanceOf(Blob);
    expect(stored?.blob).not.toBeInstanceOf(File);
    expect(stored?.blob.type).toBe('image/png');
    await expect(stored?.blob.text()).resolves.toBe('hello');
  });

  it('exports/imports a real zip and remaps ids', async () => {
    const assetId = 'asset-a';
    await persist.persistPutAsset(assetId, new Blob(['hello'], { type: 'image/png' }), 'image/png');
    await persist.persistPutProject({
      version: 1,
      id: 'p1',
      name: 'Project Alpha',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p1',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cardLayoutMode: 'fixed-9-16',
      cards: [
        {
          id: 'c1',
          kind: 'image',
          sizeScale: 1.4,
          x: 10,
          y: 20,
          z: 1,
          assetId,
          meta: { name: 'Sushi', notes: 'main', tags: ['food', 'red'], aspectRatio: 1.5 },
        },
        {
          id: 't1',
          kind: 'text',
          sizeScale: 0.8,
          x: 28,
          y: 32,
          z: 2,
          meta: { name: 'Card 2', notes: 'note', tags: ['ranked'], frontText: 'Top Pick', color: 'rose' },
        },
      ],
      activeSessionId: '2026-02-02T00:00:00.000Z',
    });
    await persist.persistPutSession({
      version: 1,
      id: '2026-02-02T00:00:00.000Z',
      boardId: 'p1',
      updatedAt: 1,
      recording: {
        version: 4,
        createdAt: '2026-02-02T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        closedContainersAtStart: [],
        cardsAtStart: [
          {
            id: 'c1',
            kind: 'image',
            createdAt: 1,
            sizeScale: 1.4,
            x: 10,
            y: 20,
            z: 1,
            assetId,
            meta: { name: 'Sushi', notes: 'main', tags: ['food', 'red'], aspectRatio: 1.5 },
          },
          {
            id: 't1',
            kind: 'text',
            createdAt: 2,
            sizeScale: 0.8,
            x: 28,
            y: 32,
            z: 2,
            meta: { name: 'Card 2', notes: 'note', tags: ['ranked'], frontText: 'Top Pick', color: 'rose' },
          },
        ],
        segments: [],
      },
    });

    const zipBlob = await persist.persistExportProjectZip('p1');
    expect(zipBlob.type).toBe('application/zip');

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(zip.file('manifest.json')).toBeTruthy();
    expect(zip.file('project.json')).toBeTruthy();
    expect(zip.file('board.json')).toBeTruthy();
    expect(zip.file('sessions.json')).toBeTruthy();
    expect(zip.file('assets.json')).toBeTruthy();

    // Create a name conflict to verify copy naming.
    await persist.persistPutProject({
      version: 1,
      id: 'p-existing',
      name: 'Project Alpha',
      createdAt: 2,
      updatedAt: 2,
    });

    const imported = await persist.persistImportProjectZip(zipBlob);
    expect(imported.projectId).not.toBe('p1');

    const importedProject = await persist.persistGetProject(imported.projectId);
    expect(importedProject?.name).toBe('Project Alpha (copy)');

    const importedBoard = await persist.persistGetBoard(imported.projectId);
    expect(importedBoard?.id).toBe(imported.projectId);
    expect(importedBoard?.cards).toHaveLength(2);
    expect(importedBoard?.cardLayoutMode).toBe('fixed-9-16');
    const importedImageCard = importedBoard?.cards.find((card) => card.id === 'c1');
    const importedTextCard = importedBoard?.cards.find((card) => card.id === 't1');
    expect(importedImageCard?.kind).toBe('image');
    expect(importedTextCard?.kind).toBe('text');
    const importedAssetId = importedImageCard?.assetId;
    expect(importedAssetId).toBeTruthy();
    expect(importedAssetId).not.toBe(assetId);
    expect(importedImageCard?.meta?.name).toBe('Sushi');
    expect(importedImageCard?.meta?.notes).toBe('main');
    expect(importedImageCard?.meta?.tags).toEqual(['food', 'red']);
    expect(importedImageCard?.meta?.aspectRatio).toBe(1.5);
    expect(importedImageCard?.sizeScale).toBe(1.4);
    expect(importedTextCard?.meta?.name).toBe('Card 2');
    expect(importedTextCard?.meta?.notes).toBe('note');
    expect(importedTextCard?.meta?.tags).toEqual(['ranked']);
    expect(importedTextCard?.meta?.frontText).toBe('Top Pick');
    expect(importedTextCard?.meta?.color).toBe('rose');
    expect(importedTextCard?.sizeScale).toBe(0.8);

    const importedAsset = importedAssetId ? await persist.persistGetAsset(importedAssetId) : null;
    expect(importedAsset?.mime).toBe('image/png');

    const importedSessions = await persist.persistListSessions(imported.projectId);
    expect(importedSessions).toHaveLength(1);
    expect(importedSessions[0].boardId).toBe(imported.projectId);
    expect(importedSessions[0].id).not.toBe('2026-02-02T00:00:00.000Z');
    expect(importedSessions[0].recording.createdAt).toBe(importedSessions[0].id);
    const importedSessionImage = importedSessions[0].recording.cardsAtStart.find((card) => card.id === 'c1');
    const importedSessionText = importedSessions[0].recording.cardsAtStart.find((card) => card.id === 't1');
    expect(importedSessionImage?.assetId).toBe(importedAssetId);
    expect(importedSessionImage?.meta.name).toBe('Sushi');
    expect(importedSessionImage?.meta.tags).toEqual(['food', 'red']);
    expect(importedSessionImage?.sizeScale).toBe(1.4);
    expect(importedSessionText?.kind).toBe('text');
    expect(importedSessionText?.meta.frontText).toBe('Top Pick');
    expect(importedSessionText?.meta.color).toBe('rose');
    expect(importedSessionText?.sizeScale).toBe(0.8);
  });

  it('exports video assets with real extensions and restores typed blobs on import', async () => {
    await persist.persistPutAsset('video-asset', new Blob(['video'], { type: 'video/mp4' }), 'video/mp4');
    await persist.persistPutAsset('poster-asset', new Blob(['poster'], { type: 'image/jpeg' }), 'image/jpeg');
    await persist.persistPutProject({
      version: 1,
      id: 'p-video',
      name: 'Video Project',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-video',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cardLayoutMode: 'as-is',
      cards: [
        {
          id: 'v1',
          kind: 'video',
          x: 12,
          y: 18,
          z: 1,
          assetId: 'video-asset',
          posterAssetId: 'poster-asset',
          meta: { name: 'Clip 1', notes: 'short', tags: ['demo'], aspectRatio: 1.78, durationSec: 12 },
        },
      ],
    });
    await persist.persistPutSession({
      version: 1,
      id: '2026-03-03T00:00:00.000Z',
      boardId: 'p-video',
      updatedAt: 1,
      recording: {
        version: 4,
        createdAt: '2026-03-03T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        closedContainersAtStart: [],
        cardsAtStart: [
          {
            id: 'v1',
            kind: 'video',
            createdAt: 1,
            x: 12,
            y: 18,
            z: 1,
            assetId: 'video-asset',
            posterAssetId: 'poster-asset',
            meta: { name: 'Clip 1', notes: 'short', tags: ['demo'], aspectRatio: 1.78, durationSec: 12 },
          },
        ],
        segments: [],
      },
    });

    const zipBlob = await persist.persistExportProjectZip('p-video');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const assetsRaw = await zip.file('assets.json')?.async('string');
    const assets = JSON.parse(assetsRaw || '[]') as Array<{ id: string; mime: string; file: string }>;
    const videoItem = assets.find((item) => item.id === 'video-asset');
    const posterItem = assets.find((item) => item.id === 'poster-asset');

    expect(videoItem?.file).toBe('assets/video-asset.mp4');
    expect(posterItem?.file).toBe('assets/poster-asset.jpg');
    expect(zip.file(videoItem!.file)).toBeTruthy();
    expect(zip.file(posterItem!.file)).toBeTruthy();

    const imported = await persist.persistImportProjectZip(zipBlob);
    const importedBoard = await persist.persistGetBoard(imported.projectId);
    const importedVideo = importedBoard?.cards.find((card) => card.id === 'v1');
    expect(importedVideo?.kind).toBe('video');
    expect(importedVideo?.assetId).toBeTruthy();
    expect(importedVideo?.assetId).not.toBe('video-asset');
    expect(importedVideo?.posterAssetId).toBeTruthy();
    expect(importedVideo?.posterAssetId).not.toBe('poster-asset');
    expect(importedVideo?.meta?.aspectRatio).toBe(1.78);
    expect(importedVideo?.meta?.durationSec).toBe(12);

    const importedVideoAsset = importedVideo?.assetId ? await persist.persistGetAsset(importedVideo.assetId) : undefined;
    const importedPosterAsset = importedVideo?.posterAssetId ? await persist.persistGetAsset(importedVideo.posterAssetId) : undefined;
    expect(importedVideoAsset?.mime).toBe('video/mp4');
    expect(importedVideoAsset?.blob.type).toBe('video/mp4');
    expect(importedPosterAsset?.mime).toBe('image/jpeg');
    expect(importedPosterAsset?.blob.type).toBe('image/jpeg');

    const importedSessions = await persist.persistListSessions(imported.projectId);
    const importedSessionVideo = importedSessions[0]?.recording.cardsAtStart.find((card) => card.id === 'v1');
    expect(importedSessionVideo?.assetId).toBe(importedVideo?.assetId);
    expect(importedSessionVideo?.posterAssetId).toBe(importedVideo?.posterAssetId);
  });

  it('hydrates missing metadata when reading legacy board cards', async () => {
    await persist.persistPutProject({
      version: 1,
      id: 'p-legacy',
      name: 'Legacy',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-legacy',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cards: [
        { id: 'd1', kind: 'dummy', sizeScale: 0, x: 0, y: 0, z: 1, meta: undefined },
        { id: 'i1', kind: 'image', sizeScale: Number.NaN, x: 10, y: 10, z: 2, assetId: 'asset-1', meta: { name: '', notes: '', tags: [], aspectRatio: 0 } },
      ],
    });

    const board = await persist.persistGetBoard('p-legacy');
    expect(board?.cardLayoutMode).toBe('as-is');
    expect(board?.cards[0].kind).toBe('text');
    expect(board?.cards[0].sizeScale).toBe(1);
    expect(board?.cards[0].meta).toEqual({
      name: 'Card 1',
      notes: '',
      tags: [],
      frontText: 'Card 1',
      color: 'slate',
      aspectRatio: undefined,
    });
    expect(board?.cards[1].kind).toBe('image');
    expect(board?.cards[1].sizeScale).toBe(1);
    expect(board?.cards[1].meta).toEqual({
      name: 'Image 2',
      notes: '',
      tags: [],
      frontText: undefined,
      color: undefined,
      aspectRatio: undefined,
    });
  });

  it('seeds missing closed-sort widget assignments back into the source widget on read', async () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 2);
    const stageId = workflow.stages[0]!.id;
    const source = workflow.widgets.find((widget) => widget.kind === 'source')!;
    const category = workflow.widgets.find((widget) => widget.kind === 'category')!;

    await persist.persistPutProject({
      version: 1,
      id: 'p-closed-seed',
      name: 'Closed Seed',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-closed-seed',
      updatedAt: 1,
      sortConfig: { type: 'closed' },
      workflow,
      activeStageId: stageId,
      cardW: 240,
      cardH: 135,
      cards: [
        {
          id: 'c1',
          kind: 'text',
          x: 0,
          y: 0,
          z: 1,
          widgetAssignments: {
            [stageId]: {
              widgetId: category.id,
              zoneId: 'content',
              order: 0,
            },
          },
          meta: { name: 'Card 1', notes: '', tags: [], frontText: 'Card 1', color: 'slate' },
        },
        {
          id: 'c2',
          kind: 'text',
          x: 20,
          y: 20,
          z: 2,
          meta: { name: 'Card 2', notes: '', tags: [], frontText: 'Card 2', color: 'slate' },
        },
      ],
    });

    const board = await persist.persistGetBoard('p-closed-seed');
    expect(board?.cards.find((card) => card.id === 'c2')?.widgetAssignments?.[stageId]).toEqual({
      widgetId: source.id,
      zoneId: 'content',
      order: 0,
    });
  });

  it('seeds missing qsort widget assignments into the presort source widget on read', async () => {
    const workflow = createWorkflowForTemplate('qsort', 1200, 800, 2);
    const presortStage = workflow.stages.find((stage) => stage.kind === 'presort')!;
    const qsortStage = workflow.stages.find((stage) => stage.kind === 'qsort')!;
    const source = workflow.widgets.find((widget) => widget.kind === 'source')!;

    await persist.persistPutProject({
      version: 1,
      id: 'p-qsort-seed',
      name: 'QSort Seed',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-qsort-seed',
      updatedAt: 1,
      sortConfig: { type: 'qsort' },
      workflow,
      activeStageId: qsortStage.id,
      cardW: 240,
      cardH: 135,
      cards: [
        {
          id: 'q1',
          kind: 'text',
          x: 0,
          y: 0,
          z: 1,
          meta: { name: 'Card 1', notes: '', tags: [], frontText: 'Card 1', color: 'slate' },
        },
        {
          id: 'q2',
          kind: 'text',
          x: 20,
          y: 20,
          z: 2,
          meta: { name: 'Card 2', notes: '', tags: [], frontText: 'Card 2', color: 'slate' },
        },
      ],
    });

    const board = await persist.persistGetBoard('p-qsort-seed');
    expect(board?.activeStageId).toBe(qsortStage.id);
    expect(board?.cards.every((card) => card.widgetAssignments?.[presortStage.id]?.widgetId === source.id)).toBe(true);
    expect(board?.cards.every((card) => card.widgetAssignments?.[presortStage.id]?.zoneId === 'content')).toBe(true);
  });

  it('persists and reads fixed-9-16 board layout mode', async () => {
    await persist.persistPutProject({
      version: 1,
      id: 'p-layout',
      name: 'Layout',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-layout',
      updatedAt: 2,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cardLayoutMode: 'fixed-9-16',
      cards: [],
    });

    const board = await persist.persistGetBoard('p-layout');
    expect(board?.cardLayoutMode).toBe('fixed-9-16');
  });

  it('deletes a single session by id', async () => {
    await persist.persistPutSession({
      version: 1,
      id: 's1',
      boardId: 'p1',
      updatedAt: 1,
      recording: {
        version: 4,
        createdAt: '2026-02-02T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        closedContainersAtStart: [],
        cardsAtStart: [],
        segments: [],
      },
    });
    await persist.persistPutSession({
      version: 1,
      id: 's2',
      boardId: 'p1',
      updatedAt: 2,
      recording: {
        version: 4,
        createdAt: '2026-02-03T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        closedContainersAtStart: [],
        cardsAtStart: [],
        segments: [],
      },
    });

    await persist.persistDeleteSession('s1');
    const rows = await persist.persistListSessions('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s2');
  });

  it('deletes a single asset by id', async () => {
    await persist.persistPutAsset('asset-delete', new Blob(['x'], { type: 'image/png' }), 'image/png');
    expect(await persist.persistGetAsset('asset-delete')).toBeTruthy();
    await persist.persistDeleteAsset('asset-delete');
    expect(await persist.persistGetAsset('asset-delete')).toBeUndefined();
  });

  it('garbage-collects unreferenced assets while keeping referenced ones', async () => {
    await persist.persistPutAsset('asset-board', new Blob(['b'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('asset-session', new Blob(['s'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('asset-undo', new Blob(['u'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('asset-garbage', new Blob(['g'], { type: 'image/png' }), 'image/png');

    await persist.persistPutProject({ version: 1, id: 'p-gc', name: 'GC', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard({
      version: 1,
      id: 'p-gc',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cards: [{ id: 'c1', kind: 'image', x: 0, y: 0, z: 1, assetId: 'asset-board' }],
    });
    await persist.persistPutSession({
      version: 1,
      id: 's-gc',
      boardId: 'p-gc',
      updatedAt: 2,
      recording: {
        version: 4,
        createdAt: '2026-03-01T00:00:00.000Z',
        cardW: 240,
        cardH: 135,
        boardW: 1000,
        boardH: 700,
        sortConfig: { type: 'open', columns: 3 },
        closedContainersAtStart: [],
        cardsAtStart: [{ id: 'c2', kind: 'image', createdAt: 1, x: 1, y: 1, z: 2, assetId: 'asset-session', meta: { name: 'Image 1', notes: '', tags: [] } }],
        segments: [],
      },
    });
    await persist.persistPutSetupUndo('p-gc', [{
      sortConfig: { type: 'open', columns: 3 },
      cards: [{ id: 'c3', kind: 'image', x: 2, y: 2, z: 3, assetId: 'asset-undo' }],
    }]);

    const result = await persist.persistGarbageCollectUnreferencedAssets();
    expect(result.removed).toBe(1);

    expect(await persist.persistGetAsset('asset-board')).toBeTruthy();
    expect(await persist.persistGetAsset('asset-session')).toBeTruthy();
    expect(await persist.persistGetAsset('asset-undo')).toBeTruthy();
    expect(await persist.persistGetAsset('asset-garbage')).toBeUndefined();
  });

  it('delete project removes unreferenced assets and keeps shared ones', async () => {
    await persist.persistPutAsset('shared', new Blob(['s'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('only-a', new Blob(['a'], { type: 'image/png' }), 'image/png');
    await persist.persistPutAsset('only-b', new Blob(['b'], { type: 'image/png' }), 'image/png');

    await persist.persistPutProject({ version: 1, id: 'a', name: 'A', createdAt: 1, updatedAt: 1 });
    await persist.persistPutProject({ version: 1, id: 'b', name: 'B', createdAt: 2, updatedAt: 2 });
    await persist.persistSetActiveProjectId('a');

    await persist.persistPutBoard({
      version: 1,
      id: 'a',
      updatedAt: 1,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cards: [
        { id: 'a1', kind: 'image', x: 0, y: 0, z: 1, assetId: 'shared' },
        { id: 'a2', kind: 'image', x: 1, y: 1, z: 2, assetId: 'only-a' },
      ],
    });
    await persist.persistPutBoard({
      version: 1,
      id: 'b',
      updatedAt: 2,
      sortConfig: { type: 'open', columns: 3 },
      cardW: 240,
      cardH: 135,
      cards: [
        { id: 'b1', kind: 'image', x: 0, y: 0, z: 1, assetId: 'shared' },
        { id: 'b2', kind: 'image', x: 1, y: 1, z: 2, assetId: 'only-b' },
      ],
    });

    const result = await persist.persistDeleteProject('a');
    expect(result.activeProjectId).toBe('b');

    const boardA = await persist.persistGetBoard('a');
    const boardB = await persist.persistGetBoard('b');
    expect(boardA).toBeUndefined();
    expect(boardB?.id).toBe('b');

    expect(await persist.persistGetAsset('shared')).toBeTruthy();
    expect(await persist.persistGetAsset('only-a')).toBeUndefined();
    expect(await persist.persistGetAsset('only-b')).toBeTruthy();
  });

  it('stores and clears setup undo history per project', async () => {
    const snapshot = {
      sortConfig: { type: 'open' as const, columns: 3 },
      cards: [{ id: 'c1', kind: 'dummy' as const, x: 10, y: 20, z: 1, meta: { name: 'Card 1', notes: '', tags: [] } }],
    };

    await persist.persistPutSetupUndo('p1', [snapshot]);
    const stored = await persist.persistGetSetupUndo('p1');
    expect(stored?.projectId).toBe('p1');
    expect(stored?.past).toMatchObject([{
      cardLayoutMode: 'as-is',
      sortConfig: { type: 'open', columns: 3 },
      stacks: [],
      workflow: { templateId: 'open', stages: [], widgets: [] },
      closedContainers: [],
      cards: [{
        id: 'c1',
        kind: 'text',
        createdAt: 1,
        sizeScale: 1,
        stackId: undefined,
        stackOrder: undefined,
        widgetAssignments: undefined,
        closedContainerId: undefined,
        closedContainerOrder: undefined,
        x: 10,
        y: 20,
        z: 1,
        meta: {
          name: 'Card 1',
          notes: '',
          tags: [],
          frontText: 'Card 1',
          color: 'slate',
          aspectRatio: undefined,
        },
      }],
    }]);

    await persist.persistClearSetupUndo('p1');
    expect(await persist.persistGetSetupUndo('p1')).toBeUndefined();
  });

  it('delete project clears only that project undo history', async () => {
    await persist.persistPutProject({ version: 1, id: 'a', name: 'A', createdAt: 1, updatedAt: 1 });
    await persist.persistPutProject({ version: 1, id: 'b', name: 'B', createdAt: 2, updatedAt: 2 });

    await persist.persistPutSetupUndo('a', [{
      sortConfig: { type: 'open', columns: 3 },
      cards: [{ id: 'a1', kind: 'dummy', x: 0, y: 0, z: 1 }],
    }]);
    await persist.persistPutSetupUndo('b', [{
      sortConfig: { type: 'closed', columns: 4 },
      cards: [{ id: 'b1', kind: 'dummy', x: 5, y: 5, z: 1 }],
    }]);

    await persist.persistDeleteProject('a');

    expect(await persist.persistGetSetupUndo('a')).toBeUndefined();
    expect(await persist.persistGetSetupUndo('b')).toBeTruthy();
  });

  it('delete all clears setup undo history', async () => {
    await persist.persistPutSetupUndo('p1', [{
      sortConfig: { type: 'open', columns: 3 },
      cards: [{ id: 'c1', kind: 'dummy', x: 0, y: 0, z: 1 }],
    }]);
    expect(await persist.persistGetSetupUndo('p1')).toBeTruthy();

    await persist.persistDeleteAll();
    expect(await persist.persistGetSetupUndo('p1')).toBeUndefined();
  });

  it('normalizes closed container layouts and preserves explicit overrides', async () => {
    await persist.persistPutProject({
      version: 1,
      id: 'p-closed-layouts',
      name: 'Closed layouts',
      createdAt: 1,
      updatedAt: 1,
    });

    await persist.persistPutBoard({
      version: 1,
      id: 'p-closed-layouts',
      updatedAt: 1,
      sortConfig: { type: 'closed', columns: 3 },
      cardW: 240,
      cardH: 135,
      closedContainers: [
        {
          id: 'source-1',
          kind: 'source',
          name: 'Source',
          createdAt: 1,
          x: 24,
          y: 24,
          w: 320,
          h: 520,
        } as any,
        {
          id: 'target-1',
          kind: 'target',
          name: 'Fan target',
          createdAt: 2,
          x: 400,
          y: 24,
          w: 280,
          h: 220,
          description: '',
          visibleInSort: true,
          capacityMode: 'unlimited',
          allowedTags: [],
        } as any,
        {
          id: 'target-2',
          kind: 'target',
          name: 'Stack target',
          createdAt: 3,
          x: 720,
          y: 24,
          w: 280,
          h: 220,
          description: '',
          visibleInSort: true,
          capacityMode: 'unlimited',
          allowedTags: [],
          layout: 'stack',
        } as any,
      ],
      cards: [
        {
          id: 'c1',
          kind: 'text',
          createdAt: 1,
          closedContainerId: 'source-1',
          closedContainerOrder: 0,
          x: 24,
          y: 24,
          z: 1,
          meta: { name: 'Card 1', notes: '', tags: [], frontText: 'Card 1', color: 'slate' },
        },
      ],
    });

    const board = await persist.persistGetBoard('p-closed-layouts');
    expect(board?.closedContainers?.find((container) => container.id === 'source-1')?.layout).toBe('stack');
    expect(board?.closedContainers?.find((container) => container.id === 'target-1')?.layout).toBe('fan');
    expect(board?.closedContainers?.find((container) => container.id === 'target-2')?.layout).toBe('stack');
  });
});
