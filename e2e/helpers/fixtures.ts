import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(helperDir, '..', 'fixtures');

export const imageFixturePath = path.join(fixturesDir, 'tiny-image.png');
export const webmVideoFixturePath = path.join(fixturesDir, 'tiny-video.webm');

const videoFixtureByProject: Record<string, string | null> = {
  chromium: webmVideoFixturePath,
  firefox: webmVideoFixturePath,
  // WebKit video support is skipped until a reliable Linux CI fixture is available.
  webkit: null,
};

export function videoFixturePathForProject(projectName: string) {
  return videoFixtureByProject[projectName] ?? null;
}
