import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildDemoBoard, createDemoArchive, demoDistribution, type DemoCatalog, type DemoImage, type DemoPreset } from './demoProjects';
const preset: DemoPreset = { id: 'q-sort-24', name: 'Q-Sort', type: 'qsort', imageIds: Array.from({length: 24}, (_, i) => String(i)), instructions: 'Rank these images.', distribution: [2,3,4,6,4,3,2] };
const image: DemoImage = { id: '0', pairId: '01', title: 'Example', source: 'DiffusionDB / 2022', file: 'images/0.webp', bytes: 3, sha256: 'invalid', meta: { name: 'Image 001', notes: 'Original prompt:\nexample ', tags: [] } };
afterEach(() => vi.unstubAllGlobals());
describe('demo project preparation', () => {
  it('keeps the curated distribution and adjusts capacities for custom and empty selections', () => {
    expect(demoDistribution(preset, 24)).toEqual([2,3,4,6,4,3,2]);
    for (const count of [0,1,15,23,60]) {
      const board = buildDemoBoard(preset, Array.from({length: count}, (_, i) => ({...image,id:String(i)})));
      const qsort = board.workflow.widgets.find(widget => widget.kind === 'qsort')!;
      expect(qsort.kind === 'qsort' && qsort.buckets.reduce((sum,bucket) => sum+bucket.capacity,0)).toBe(count);
      expect(board.cards.every(card => !!card.widgetAssignments?.[board.activeStageId!])).toBe(true);
    }
  });
  it('rejects corrupted image downloads before producing an import archive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3]))));
    const catalog: DemoCatalog = { version:1, images:[image], presets:[{...preset,imageIds:['0']}] };
    await expect(createDemoArchive(catalog, preset, new Set(['0']), new AbortController().signal, () => {})).rejects.toThrow('download of Image 001');
  });
});
