import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowForTemplate, WIDGET_ZONE_CONTENT } from './workflow';
import type { CardData, RecordingSession, SortWorkflowData } from './types';
import type { PersistedBoardV1, PersistedCardV1, SetupSnapshotV1 } from './persist';

async function resetDb() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sortboard-mvp');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function loadPersist() {
  return import('./persist');
}

function textCard(id: string, index = 0): PersistedCardV1 {
  return {
    id,
    kind: 'text',
    createdAt: index + 1,
    sizeScale: 1,
    x: 20 + index * 20,
    y: 30 + index * 20,
    z: index + 1,
    meta: {
      name: `Card ${index + 1}`,
      notes: '',
      tags: [],
      frontText: `Card ${index + 1}`,
      color: 'slate',
    },
  };
}

function imageCard(id: string, assetId: string, index = 0): PersistedCardV1 {
  return {
    id,
    kind: 'image',
    createdAt: index + 1,
    sizeScale: 1,
    x: 20 + index * 20,
    y: 30 + index * 20,
    z: index + 1,
    assetId,
    meta: {
      name: `Image ${index + 1}`,
      notes: '',
      tags: [],
      aspectRatio: 1.5,
    },
  };
}

function videoCard(id: string, assetId: string, posterAssetId: string, index = 0): PersistedCardV1 {
  return {
    id,
    kind: 'video',
    createdAt: index + 1,
    sizeScale: 1,
    x: 20 + index * 20,
    y: 30 + index * 20,
    z: index + 1,
    assetId,
    posterAssetId,
    meta: {
      name: `Video ${index + 1}`,
      notes: '',
      tags: [],
      aspectRatio: 16 / 9,
      durationSec: 10,
    },
  };
}

async function mutateZip(source: Blob, mutate: (zip: any) => void | Promise<void>) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await source.arrayBuffer());
  await mutate(zip);
  return zip.generateAsync({ type: 'blob' });
}

function board(
  id: string,
  cards: PersistedCardV1[] = [],
  workflow: SortWorkflowData = createWorkflowForTemplate('open', 1200, 800, cards.length)
): PersistedBoardV1 {
  return {
    version: 2,
    id,
    updatedAt: 1,
    sortConfig: { type: workflow.templateId },
    cardW: 240,
    cardH: 135,
    cardLayoutMode: 'as-is',
    stacks: [],
    workflow,
    activeStageId: workflow.stages[0]?.id,
    cards,
  };
}

function recording(
  cards: CardData[] = [],
  workflow: SortWorkflowData = createWorkflowForTemplate('open', 1200, 800, cards.length),
  createdAt = '2026-02-02T00:00:00.000Z'
): RecordingSession {
  return {
    version: 5,
    createdAt,
    cardW: 240,
    cardH: 135,
    boardW: 1200,
    boardH: 800,
    sortConfig: { type: workflow.templateId },
    cardLayoutModeAtStart: 'as-is',
    workflowAtStart: workflow,
    activeStageIdAtStart: workflow.stages[0]?.id,
    cardsAtStart: cards,
    segments: [],
  };
}

function setupSnapshot(cards: PersistedCardV1[] = []): SetupSnapshotV1 {
  return {
    cardLayoutMode: 'as-is',
    sortConfig: { type: 'open' },
    stacks: [],
    workflow: createWorkflowForTemplate('open', 1200, 800, cards.length),
    cards,
  };
}

describe('current persistence schema', () => {
  let persist: Awaited<ReturnType<typeof loadPersist>>;

  beforeAll(async () => {
    vi.resetModules();
    await resetDb();
    persist = await loadPersist();
  });

  beforeEach(async () => {
    await persist.persistDeleteAll();
  });

  it('stores file assets as typed blobs', async () => {
    const fileAsset = new File(['hello'], 'tiny-image.png', { type: 'image/png' });

    await persist.persistPutAsset('file-asset', fileAsset, fileAsset.type);

    const stored = await persist.persistGetAsset('file-asset');
    expect(stored?.blob).toBeInstanceOf(Blob);
    expect(stored?.blob).not.toBeInstanceOf(File);
    expect(stored?.blob.type).toBe('image/png');
    await expect(stored?.blob.text()).resolves.toBe('hello');
  });

  it('roundtrips the current closed workflow, assignments, recording, and media through ZIP', async () => {
    const workflow = createWorkflowForTemplate('closed', 1200, 800, 2);
    const stageId = workflow.stages[0]!.id;
    const source = workflow.widgets.find((widget) => widget.kind === 'source')!;
    const category = workflow.widgets.find((widget) => widget.kind === 'category')!;
    const cards = [
      {
        ...imageCard('image-1', 'asset-image'),
        widgetAssignments: {
          [stageId]: { widgetId: category.id, zoneId: WIDGET_ZONE_CONTENT, order: 0 },
        },
      },
      {
        ...textCard('text-1', 1),
        widgetAssignments: {
          [stageId]: { widgetId: source.id, zoneId: WIDGET_ZONE_CONTENT, order: 0 },
        },
      },
    ] satisfies PersistedCardV1[];

    await persist.persistPutAsset('asset-image', new Blob(['image'], { type: 'image/png' }), 'image/png');
    await persist.persistPutProject({
      version: 1,
      id: 'closed-project',
      name: 'Closed Project',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard(board('closed-project', cards, workflow));
    await persist.persistPutSession({
      version: 1,
      id: '2026-02-02T00:00:00.000Z',
      boardId: 'closed-project',
      updatedAt: 1,
      recording: recording(cards as CardData[], workflow),
    });

    const zipBlob = await persist.persistExportProjectZip('closed-project');
    await persist.persistPutProject({
      version: 1,
      id: 'name-conflict',
      name: 'Closed Project',
      createdAt: 2,
      updatedAt: 2,
    });

    const imported = await persist.persistImportProjectZip(zipBlob);
    const importedProject = await persist.persistGetProject(imported.projectId);
    const importedBoard = await persist.persistGetBoard(imported.projectId);
    const importedSessions = await persist.persistListSessions(imported.projectId);

    expect(importedProject?.name).toBe('Closed Project (copy)');
    expect(importedBoard?.version).toBe(2);
    expect(importedBoard).not.toHaveProperty('closedContainers');
    expect(importedBoard?.workflow).toEqual(workflow);
    expect(importedBoard?.cards.map((card) => card.widgetAssignments?.[stageId])).toEqual(
      cards.map((card) => card.widgetAssignments?.[stageId])
    );
    const importedImage = importedBoard?.cards.find((card) => card.id === 'image-1');
    expect(importedImage?.assetId).toBeTruthy();
    expect(importedImage?.assetId).not.toBe('asset-image');
    expect(importedImage).not.toHaveProperty('closedContainerId');
    expect(importedSessions).toHaveLength(1);
    expect(importedSessions[0]!.recording.version).toBe(5);
    expect(importedSessions[0]!.recording).not.toHaveProperty('closedContainersAtStart');
    expect(importedSessions[0]!.recording.workflowAtStart).toEqual(workflow);
    expect(importedSessions[0]!.recording.cardsAtStart[0]!.assetId).toBe(importedImage?.assetId);
  });

  it('exports video and poster assets with current extensions and MIME types', async () => {
    const video: PersistedCardV1 = {
      id: 'video-1',
      kind: 'video',
      createdAt: 1,
      x: 10,
      y: 20,
      z: 1,
      assetId: 'video-asset',
      posterAssetId: 'poster-asset',
      meta: { name: 'Clip', notes: '', tags: [], aspectRatio: 1.78, durationSec: 12 },
    };
    await persist.persistPutAsset('video-asset', new Blob(['video'], { type: 'video/mp4' }), 'video/mp4');
    await persist.persistPutAsset('poster-asset', new Blob(['poster'], { type: 'image/jpeg' }), 'image/jpeg');
    await persist.persistPutProject({ version: 1, id: 'video-project', name: 'Video', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(board('video-project', [video]));

    const zipBlob = await persist.persistExportProjectZip('video-project');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const assets = JSON.parse((await zip.file('assets.json')?.async('string')) || '[]') as Array<{
      id: string;
      mime: string;
      file: string;
    }>;
    expect(assets.find((item) => item.id === 'video-asset')?.file).toBe('assets/video-asset.mp4');
    expect(assets.find((item) => item.id === 'poster-asset')?.file).toBe('assets/poster-asset.jpg');

    const imported = await persist.persistImportProjectZip(zipBlob);
    const importedBoard = await persist.persistGetBoard(imported.projectId);
    const importedVideo = importedBoard?.cards[0];
    const videoAsset = importedVideo?.assetId ? await persist.persistGetAsset(importedVideo.assetId) : undefined;
    const posterAsset = importedVideo?.posterAssetId ? await persist.persistGetAsset(importedVideo.posterAssetId) : undefined;
    expect(videoAsset?.blob.type).toBe('video/mp4');
    expect(posterAsset?.blob.type).toBe('image/jpeg');
  });

  it('rejects unsupported board and recording versions instead of migrating them', async () => {
    await expect(persist.persistPutBoard({ ...board('old-board'), version: 1 } as any)).rejects.toThrow(
      'Unsupported board version'
    );
    await expect(
      persist.persistPutSession({
        version: 1,
        id: 'old-session',
        boardId: 'old-board',
        updatedAt: 1,
        recording: { ...recording(), version: 4 } as any,
      })
    ).rejects.toThrow('Unsupported recording version');
  });

  it('rejects an old board inside a ZIP before creating a project', async () => {
    await persist.persistPutProject({ version: 1, id: 'zip-project', name: 'ZIP', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(board('zip-project', [textCard('text-1')]));
    const validZip = await persist.persistExportProjectZip('zip-project');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await validZip.arrayBuffer());
    const boardJson = JSON.parse((await zip.file('board.json')!.async('string')) || '{}');
    boardJson.version = 1;
    zip.file('board.json', JSON.stringify(boardJson));
    const invalidZip = await zip.generateAsync({ type: 'blob' });
    const before = await persist.persistListProjects();

    await expect(persist.persistImportProjectZip(invalidZip)).rejects.toThrow('Unsupported board version');
    expect(await persist.persistListProjects()).toEqual(before);
  });

  it('rejects duplicate and dangling session references before changing persistence', async () => {
    const projectId = 'session-reference-project';
    const sessionId = '2026-02-02T00:00:00.000Z';
    const currentBoard = board(projectId, [textCard('text-1')]);
    currentBoard.activeSessionId = sessionId;
    await persist.persistPutProject({ version: 1, id: projectId, name: 'Session refs', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(currentBoard);
    await persist.persistPutSession({
      version: 1,
      id: sessionId,
      boardId: projectId,
      updatedAt: 1,
      recording: recording([], undefined, sessionId),
    });
    await persist.persistSetActiveProjectId(projectId);
    const validZip = await persist.persistExportProjectZip(projectId);
    const projectsBefore = await persist.persistListProjects();
    const activeBefore = await persist.persistGetActiveProjectId();

    const duplicateSessionZip = await mutateZip(validZip, async (zip) => {
      const sessions = JSON.parse(await zip.file('sessions.json')!.async('string'));
      sessions.push({ ...sessions[0] });
      zip.file('sessions.json', JSON.stringify(sessions));
    });
    await expect(persist.persistImportProjectZip(duplicateSessionZip)).rejects.toThrow(
      `Duplicate session ID in archive: ${sessionId}`
    );

    const danglingActiveSessionZip = await mutateZip(validZip, async (zip) => {
      const archiveBoard = JSON.parse(await zip.file('board.json')!.async('string'));
      archiveBoard.activeSessionId = 'missing-session';
      zip.file('board.json', JSON.stringify(archiveBoard));
    });
    await expect(persist.persistImportProjectZip(danglingActiveSessionZip)).rejects.toThrow(
      'Active session is missing from archive: missing-session'
    );

    expect(await persist.persistListProjects()).toEqual(projectsBefore);
    expect(await persist.persistGetActiveProjectId()).toBe(activeBefore);
  });

  it('rejects undeclared or missing board and recording assets before changing persistence', async () => {
    const projectId = 'asset-reference-project';
    const sessionId = '2026-03-03T00:00:00.000Z';
    for (const [id, mime] of [
      ['board-asset', 'image/png'],
      ['recording-asset', 'video/mp4'],
      ['recording-poster', 'image/jpeg'],
    ] as const) {
      await persist.persistPutAsset(id, new Blob([id], { type: mime }), mime);
    }
    await persist.persistPutProject({ version: 1, id: projectId, name: 'Asset refs', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(board(projectId, [imageCard('board-image', 'board-asset')]));
    await persist.persistPutSession({
      version: 1,
      id: sessionId,
      boardId: projectId,
      updatedAt: 1,
      recording: recording([videoCard('recorded-video', 'recording-asset', 'recording-poster') as CardData]),
    });
    await persist.persistSetActiveProjectId(projectId);
    const validZip = await persist.persistExportProjectZip(projectId);
    const projectsBefore = await persist.persistListProjects();
    const activeBefore = await persist.persistGetActiveProjectId();

    for (const assetId of ['board-asset', 'recording-asset', 'recording-poster']) {
      const undeclaredZip = await mutateZip(validZip, async (zip) => {
        const assets = JSON.parse(await zip.file('assets.json')!.async('string'));
        zip.file('assets.json', JSON.stringify(assets.filter((asset: { id: string }) => asset.id !== assetId)));
      });
      await expect(persist.persistImportProjectZip(undeclaredZip)).rejects.toThrow(
        `Asset is referenced but not declared in assets.json: ${assetId}`
      );
    }

    const missingFileZip = await mutateZip(validZip, async (zip) => {
      const assets = JSON.parse(await zip.file('assets.json')!.async('string')) as Array<{ id: string; file: string }>;
      const boardAsset = assets.find((asset) => asset.id === 'board-asset')!;
      zip.remove(boardAsset.file);
    });
    await expect(persist.persistImportProjectZip(missingFileZip)).rejects.toThrow(
      'Missing asset file: assets/board-asset.png'
    );

    expect(await persist.persistListProjects()).toEqual(projectsBefore);
    expect(await persist.persistGetActiveProjectId()).toBe(activeBefore);
  });

  it('refuses to export missing assets referenced by boards or recordings', async () => {
    await persist.persistPutProject({ version: 1, id: 'missing-board-asset', name: 'Board asset', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(board('missing-board-asset', [imageCard('image', 'not-stored-board-asset')]));
    await expect(persist.persistExportProjectZip('missing-board-asset')).rejects.toThrow(
      'Cannot export project: referenced asset is missing: not-stored-board-asset'
    );

    await persist.persistPutProject({
      version: 1,
      id: 'missing-recording-asset',
      name: 'Recording asset',
      createdAt: 1,
      updatedAt: 1,
    });
    await persist.persistPutBoard(board('missing-recording-asset', [textCard('text')]));
    await persist.persistPutSession({
      version: 1,
      id: 'missing-recording-session',
      boardId: 'missing-recording-asset',
      updatedAt: 1,
      recording: recording([imageCard('recorded-image', 'not-stored-recording-asset') as CardData]),
    });
    await expect(persist.persistExportProjectZip('missing-recording-asset')).rejects.toThrow(
      'Cannot export project: referenced asset is missing: not-stored-recording-asset'
    );
  });

  it('normalizes current metadata values without accepting old card kinds', async () => {
    const current = board('metadata', [
      {
        ...textCard('text-1'),
        sizeScale: Number.NaN,
        meta: { name: '', notes: '  note  ', tags: ['  tag  ', ''], frontText: '', color: 'invalid' as any },
      },
    ]);
    await persist.persistPutBoard(current);

    const stored = await persist.persistGetBoard('metadata');
    expect(stored?.cards[0]).toMatchObject({
      kind: 'text',
      sizeScale: 1,
      meta: { name: 'Card 1', notes: 'note', tags: ['tag'], frontText: 'Card 1', color: 'slate' },
    });
    await expect(
      persist.persistPutBoard({ ...current, cards: [{ ...current.cards[0], kind: 'dummy' }] } as any)
    ).rejects.toThrow('Unsupported card kind');
  });

  it('seeds unassigned current Closed and Q-Sort cards into their source widgets', async () => {
    for (const templateId of ['closed', 'qsort'] as const) {
      const workflow = createWorkflowForTemplate(templateId, 1200, 800, 2);
      const currentBoard = board(`${templateId}-seed`, [textCard(`${templateId}-1`), textCard(`${templateId}-2`, 1)], workflow);
      if (templateId === 'qsort') {
        currentBoard.activeStageId = workflow.stages.find((stage) => stage.kind === 'qsort')!.id;
      }
      await persist.persistPutBoard(currentBoard);
      const stored = await persist.persistGetBoard(currentBoard.id);
      const source = workflow.widgets.find((widget) => widget.kind === 'source')!;
      expect(stored?.cards.every((card) => card.widgetAssignments?.[source.stageId]?.widgetId === source.id)).toBe(true);
      expect(stored?.cards.every((card) => card.widgetAssignments?.[source.stageId]?.zoneId === WIDGET_ZONE_CONTENT)).toBe(true);
    }
  });

  it('deletes individual sessions and assets', async () => {
    await persist.persistPutSession({
      version: 1,
      id: 'session-1',
      boardId: 'project-1',
      updatedAt: 1,
      recording: recording([], undefined, '2026-02-02T00:00:00.000Z'),
    });
    await persist.persistPutSession({
      version: 1,
      id: 'session-2',
      boardId: 'project-1',
      updatedAt: 2,
      recording: recording([], undefined, '2026-02-03T00:00:00.000Z'),
    });
    await persist.persistPutAsset('delete-me', new Blob(['x'], { type: 'image/png' }), 'image/png');

    await persist.persistDeleteSession('session-1');
    await persist.persistDeleteAsset('delete-me');

    expect((await persist.persistListSessions('project-1')).map((session) => session.id)).toEqual(['session-2']);
    expect(await persist.persistGetAsset('delete-me')).toBeUndefined();
  });

  it('garbage-collects only assets unreferenced by boards, sessions, and undo', async () => {
    for (const id of ['board-asset', 'session-asset', 'undo-asset', 'garbage']) {
      await persist.persistPutAsset(id, new Blob([id], { type: 'image/png' }), 'image/png');
    }
    await persist.persistPutProject({ version: 1, id: 'gc-project', name: 'GC', createdAt: 1, updatedAt: 1 });
    await persist.persistPutBoard(board('gc-project', [imageCard('board-image', 'board-asset')]));
    const sessionCard = imageCard('session-image', 'session-asset') as CardData;
    await persist.persistPutSession({
      version: 1,
      id: 'gc-session',
      boardId: 'gc-project',
      updatedAt: 1,
      recording: recording([sessionCard]),
    });
    await persist.persistPutSetupUndo('gc-project', [setupSnapshot([imageCard('undo-image', 'undo-asset')])]);

    expect(await persist.persistGarbageCollectUnreferencedAssets()).toEqual({ removed: 1 });
    expect(await persist.persistGetAsset('board-asset')).toBeTruthy();
    expect(await persist.persistGetAsset('session-asset')).toBeTruthy();
    expect(await persist.persistGetAsset('undo-asset')).toBeTruthy();
    expect(await persist.persistGetAsset('garbage')).toBeUndefined();
  });

  it('deletes a project, its undo and sessions, but keeps assets referenced elsewhere', async () => {
    for (const id of ['shared', 'only-a', 'only-b']) {
      await persist.persistPutAsset(id, new Blob([id], { type: 'image/png' }), 'image/png');
    }
    await persist.persistPutProject({ version: 1, id: 'a', name: 'A', createdAt: 1, updatedAt: 1 });
    await persist.persistPutProject({ version: 1, id: 'b', name: 'B', createdAt: 2, updatedAt: 2 });
    await persist.persistSetActiveProjectId('a');
    await persist.persistPutBoard(board('a', [imageCard('a-shared', 'shared'), imageCard('a-only', 'only-a', 1)]));
    await persist.persistPutBoard(board('b', [imageCard('b-shared', 'shared'), imageCard('b-only', 'only-b', 1)]));
    await persist.persistPutSetupUndo('a', [setupSnapshot([textCard('undo-a')])]);
    await persist.persistPutSession({
      version: 1,
      id: 'a-session',
      boardId: 'a',
      updatedAt: 1,
      recording: recording(),
    });

    const result = await persist.persistDeleteProject('a');

    expect(result.activeProjectId).toBe('b');
    expect(await persist.persistGetBoard('a')).toBeUndefined();
    expect(await persist.persistGetSetupUndo('a')).toBeUndefined();
    expect(await persist.persistListSessions('a')).toEqual([]);
    expect(await persist.persistGetAsset('shared')).toBeTruthy();
    expect(await persist.persistGetAsset('only-a')).toBeUndefined();
    expect(await persist.persistGetAsset('only-b')).toBeTruthy();
  });

  it('stores, restores, and clears current setup undo snapshots', async () => {
    const snapshot = setupSnapshot([textCard('undo-card')]);
    await persist.persistPutSetupUndo('undo-project', [snapshot]);

    const stored = await persist.persistGetSetupUndo('undo-project');
    expect(stored?.version).toBe(1);
    expect(stored?.past).toEqual([snapshot]);

    await persist.persistClearSetupUndo('undo-project');
    expect(await persist.persistGetSetupUndo('undo-project')).toBeUndefined();
  });
});
