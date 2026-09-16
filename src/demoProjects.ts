import type { CardMetadataV1, SortTemplateId } from './types';
import type { PersistedBoardV1 } from './persist';
import { buildNormalDistributionBuckets, createWorkflowForTemplate } from './workflow';

export interface DemoImage {
  id: string;
  pairId: string;
  title: string;
  source: string;
  file: string;
  bytes: number;
  sha256: string;
  meta: CardMetadataV1;
}
export interface DemoPreset {
  id: string;
  name: string;
  type: SortTemplateId;
  imageIds: string[];
  instructions: string;
  distribution: number[] | null;
}
export interface DemoCatalog {
  version: 1;
  images: DemoImage[];
  presets: DemoPreset[];
}
export const demoAssetUrl = (file: string) => `${import.meta.env.BASE_URL}demo/${file}`;

export async function loadDemoCatalog(signal: AbortSignal): Promise<DemoCatalog> {
  const response = await fetch(demoAssetUrl('catalog.json'), { signal });
  if (!response.ok) throw new Error('Could not load the demo library. Check your connection and try again.');
  const catalog = await response.json() as DemoCatalog;
  if (catalog.version !== 1 || !catalog.images?.length || !catalog.presets?.length) {
    throw new Error('The demo library is unavailable. Please reload the app.');
  }
  return catalog;
}

export function demoDistribution(preset: DemoPreset, count: number) {
  return count === preset.imageIds.length && preset.distribution
    ? preset.distribution
    : buildNormalDistributionBuckets(count, 7).map(bucket => bucket.capacity);
}

export function buildDemoBoard(preset: DemoPreset, images: DemoImage[], now = Date.now()): PersistedBoardV1 {
  const workflow = createWorkflowForTemplate(preset.type, 1200, 800, images.length);
  const activeStageId = workflow.stages[0]?.id;
  const source = workflow.widgets.find(widget => widget.kind === 'source');
  if (preset.type === 'closed') {
    const first = workflow.widgets.find(widget => widget.kind === 'category');
    if (first?.kind === 'category') {
      first.title = 'Looks AI-generated';
      first.description = 'Choose based on your impression of the image.';
      workflow.widgets.push({ ...first, id: `${first.id}-other`, title: 'Looks non-AI-generated', y: first.y + first.h + 32, z: first.z + 1 });
    }
  }
  for (const widget of workflow.widgets) {
    if (widget.kind === 'pre-sort') {
      widget.title = 'Which way does it lean?';
      widget.zones[0].label = 'Worth keeping';
      widget.zones[1].label = 'Slop';
    }
    if (widget.kind === 'qsort') {
      widget.title = 'Slop (-3) to worth keeping (+3)';
      widget.lanes[0].label = 'Worth keeping';
      widget.lanes[1].label = 'Slop';
      const capacities = demoDistribution(preset, images.length);
      widget.buckets.forEach((bucket, index) => { bucket.capacity = capacities[index]; });
    }
  }
  return {
    version: 2, id: preset.id, updatedAt: now,
    sortConfig: { type: preset.type, stacksEnabled: true, zoomEnabled: preset.type === 'open', startInFullscreen: true },
    cardW: preset.type === 'open' ? 160 : 200, cardH: 160, cardLayoutMode: 'as-is',
    stacks: [], workflow, activeStageId,
    cards: images.map((image, index) => ({
      id: image.id, kind: 'image', assetId: image.id, createdAt: now + index,
      x: 32 + index % 5 * 185, y: 100 + Math.floor(index / 5) * 265, z: index + 1,
      meta: image.meta,
      widgetAssignments: activeStageId && source
        ? { [activeStageId]: { widgetId: source.id, zoneId: 'content', order: index } }
        : undefined,
    })),
  };
}

export async function createDemoArchive(
  catalog: DemoCatalog, preset: DemoPreset, selectedIds: Set<string>,
  signal: AbortSignal, onProgress: (message: string) => void
): Promise<Blob> {
  // Keep the same mixed order across presets, including custom selections.
  const order = catalog.presets.find(item => item.type === 'open')?.imageIds || catalog.images.map(image => image.id);
  const images = order.filter(id => selectedIds.has(id)).map(id => catalog.images.find(image => image.id === id)!);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let next = 0;
  let complete = 0;
  // Bound simultaneous requests and finish all workers before surfacing failures.
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, images.length) }, async () => {
    while (next < images.length) {
      const image = images[next++];
      const response = await fetch(demoAssetUrl(image.file), { signal });
      if (!response.ok) throw new Error(`Could not load ${image.meta.name}. Please try again.`);
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== image.sha256) throw new Error(`The download of ${image.meta.name} is incomplete. Please try again.`);
      zip.file(`assets/${image.id}.webp`, bytes);
      onProgress(`Loading images: ${++complete} / ${images.length}`);
    }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  signal.throwIfAborted();
  const now = Date.now();
  const board = buildDemoBoard(preset, images, now);
  zip.file('manifest.json', JSON.stringify({ format: 'sortboard-project-export', version: 1, exportedAt: new Date(now).toISOString() }));
  zip.file('project.json', JSON.stringify({ version: 1, id: preset.id, name: preset.name, instructions: preset.instructions, createdAt: now, updatedAt: now }));
  zip.file('board.json', JSON.stringify(board));
  zip.file('sessions.json', '[]');
  zip.file('assets.json', JSON.stringify(images.map(image => ({ id: image.id, mime: 'image/webp', file: `assets/${image.id}.webp` }))));
  onProgress('Creating your local project...');
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
