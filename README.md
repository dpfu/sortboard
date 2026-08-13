# SortBoard

SortBoard is an experimental, local-first board for sorting text, images, and short videos.
It runs entirely in a desktop browser and does not require a backend or account.

## Status

SortBoard is pre-release research software. The current goal is a small, testable v0.1 rather than a general-purpose collaboration platform.

## Sort modes

| Mode | Purpose |
| --- | --- |
| Open sort | Place cards freely and organize them in stacks. |
| Closed sort | Sort cards from a source into named categories. |
| Q-Sort | Move cards through a two-step Pre-Sort and Q-Sort distribution. |

All three modes use the same board and card model.

## Core workflow

1. Open the generated demo project or create an empty project.
2. Add text cards or import local image and video files.
3. Choose a sort mode and configure its categories or distribution.
4. Start sorting. SortBoard records card movements and stage changes automatically.
5. Replay the session or export the project.

## Local data and exports

Projects, media, and recordings are stored in the browser with IndexedDB. SortBoard does not upload them.

Clearing browser site data removes local projects. Export important work regularly with **Export project**.

A project export is a ZIP archive containing:

- `manifest.json`
- `project.json`
- `board.json`
- `sessions.json`
- `assets.json`
- the referenced media files in `assets/`

The archive is intended for backup and transfer between SortBoard installations. Its JSON is inspectable, but the export is not yet a stable analysis API.

## Run locally

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- a modern desktop browser

Install the locked dependencies and start the development server:

```bash
npm ci
npm run dev
```

Create a production build:

```bash
npm run build
```

## Test

Run the unit and component tests:

```bash
npm test
```

Install the Playwright browsers once, then run the Chromium smoke tests:

```bash
npm run test:e2e:install
npm run test:e2e:smoke
```

Run the full browser suite with:

```bash
npm run test:e2e:full
```

## Current limits

- single-user and local-only
- desktop-browser interface
- no backend sync, accounts, or live collaboration
- no URL or social-platform import
- no Q-method statistics or analysis report
- video support depends on browser and operating-system codecs
- persistence and export schemas may change before v0.1

See [docs/architecture.md](docs/architecture.md) for the implementation overview.

## License

SortBoard is available under the [MIT License](LICENSE).
