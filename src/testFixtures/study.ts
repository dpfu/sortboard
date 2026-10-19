import { createTestProject } from './project';
import { prepareStudyRound, type StudyDefinition } from '../study/model';
import type { CardData } from '../types';

export const testStudy: StudyDefinition = {
  version: 1, id: 'test-study', title: 'Two perspectives',
  introduction: 'Sort the same twelve images under two different statements.', reference: 'Synthetic test material.', credits: 'Generated SVG fixtures.',
  scale: [1, 1, 2, 4, 2, 1, 1].map((capacity, i) => ({ value: i - 3, label: String(i - 3), capacity })),
  rounds: [{ id: 'importance', title: 'Importance', prompt: 'This image makes me feel that climate change is important.' },
    { id: 'ability-to-act', title: 'Ability to act', prompt: 'This image makes me feel I can do something about climate change.' }],
};

export async function testStudyArchive(study: StudyDefinition = testStudy) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { project, board, assets } = createTestProject();
  board.cards = board.cards.slice(0, 12).map((c, i) => ({ ...c, meta: { ...c.meta, name: String(i + 1).padStart(2, '0') } }));
  const prepared = prepareStudyRound(study, board.cards as CardData[], 1200, 800);
  board.cards = prepared.cards;
  board.workflow = prepared.workflow;
  board.activeStageId = prepared.activeStageId;
  board.sortConfig = { type: 'qsort', stacksEnabled: false, zoomEnabled: false, startInFullscreen: true };
  project.study = study;
  zip.file('manifest.json', JSON.stringify({ format: 'sortboard-project-export', version: 1 }));
  zip.file('project.json', JSON.stringify(project)); zip.file('board.json', JSON.stringify(board)); zip.file('sessions.json', '[]');
  zip.file('assets.json', JSON.stringify(assets.slice(0, 12).map(a => ({ id: a.id, mime: a.mime, file: `assets/${a.id}.svg` }))));
  for (const asset of assets.slice(0, 12)) zip.file(`assets/${asset.id}.svg`, asset.svg);
  return zip.generateAsync({ type: 'uint8array' });
}
