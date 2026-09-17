import { createCardMetadata, type PersistedBoardV1, type PersistedProjectV1 } from '../persist';
import { createWorkflowForTemplate } from '../workflow';

// Workflow tests use explicit local data, independent of first-visit onboarding.
export function createTestProject() {
  const now = Date.now();
  const project: PersistedProjectV1 = { version: 1, id: 'test-project', name: 'Test Project', createdAt: now, updatedAt: now };
  const assets = Array.from({ length: 24 }, (_, i) => ({
    id: `test-image-${i + 1}`, mime: 'image/svg+xml',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#e6ede7"/><text x="72" y="104" font-family="sans-serif" font-size="54">Card ${i + 1}</text></svg>`,
  }));
  const board: PersistedBoardV1 = {
    version: 2, id: project.id, updatedAt: now,
    sortConfig: { type: 'open', stacksEnabled: true, zoomEnabled: false, startInFullscreen: true },
    cardW: 240, cardH: 135, cardLayoutMode: 'as-is', stacks: [],
    workflow: createWorkflowForTemplate('open', 1200, 800, assets.length),
    cards: assets.map((asset, i) => ({
      id: `test-card-${i + 1}`, kind: 'image', createdAt: now + i, assetId: asset.id,
      x: 28 + i * 18, y: 28 + i * 18, z: i + 1,
      meta: createCardMetadata(`Card ${i + 1}`, '', ['test'], { aspectRatio: 16 / 9, originalFileName: `${asset.id}.svg` }),
    })),
  };
  return { project, board, assets };
}

export async function seedTestProject() {
  const persist = await import('../persist');
  const { project, board, assets } = createTestProject();
  for (const asset of assets) await persist.persistPutAsset(asset.id, new Blob([asset.svg], { type: asset.mime }), asset.mime);
  await persist.persistPutProject(project);
  await persist.persistPutBoard(board);
  await persist.persistSetActiveProjectId(project.id);
}

export async function testProjectArchive() {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { project, board, assets } = createTestProject();
  zip.file('manifest.json', JSON.stringify({ format: 'sortboard-project-export', version: 1, exportedAt: new Date().toISOString() }));
  zip.file('project.json', JSON.stringify(project));
  zip.file('board.json', JSON.stringify(board));
  zip.file('sessions.json', '[]');
  zip.file('assets.json', JSON.stringify(assets.map(asset => ({ id: asset.id, mime: asset.mime, file: `assets/${asset.id}.svg` }))));
  for (const asset of assets) zip.file(`assets/${asset.id}.svg`, asset.svg);
  return zip.generateAsync({ type: 'uint8array' });
}
