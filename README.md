# SortBoard

SortBoard is an experimental, local-first board for sorting text, images, and short videos.
It runs entirely in a desktop browser and does not require a backend or account.

**Live demo:** [dpfu.github.io/sortboard](https://dpfu.github.io/sortboard/)

## Status

SortBoard is pre-release research software. The current goal is a small, testable v0.1 rather than a general-purpose collaboration platform.

## Sort modes

| Mode | Purpose |
| --- | --- |
| Open sort | Place cards freely, with optional movable stacks and board zoom. |
| Closed sort | Sort cards from a source into named categories. |
| Q-Sort | Move cards through a two-step Pre-Sort and Q-Sort distribution. |

All three modes use the same board and card model.

## Core workflow

1. On your first visit, open a prepared demo. Closed sort with 15 images is suggested for a short test. You can also open the generated starter board or use your own material.
2. In **Setup**, add cards, choose a sort mode, and configure categories or the distribution. Select a card or area to open its details.
3. Select **Start sorting**. Recording starts automatically. Double-click an image or video to inspect it. **Instructions** opens the task; **Controls** collects the available gestures.
4. Select **Finish sorting** when ready. Q-Sort first uses **Continue to Q-Sort** to advance from Pre-Sort.
5. Review the result, play the recording, or scrub through the timeline. **Export project** downloads the project and its recordings.

**Setup** and **Recordings** are available from the project header. **New sorting session** starts from the prepared Setup board. Completed sorts do not overwrite that preparation. The project-name menu contains project switching, creation, import, export, and the demo library.

New projects and demos start sorting in full screen by default. Open **Display** in Setup to turn off **Start in full screen** or change card proportions and size. Existing projects retain their saved preference. Full screen can also be toggled while sorting; **Esc** returns to the window. Finishing a sort leaves full screen. If full screen is unavailable, sorting continues in the window.

**Open-sort navigation:** drag empty space to pan, or hold **Space** and drag over cards. Middle-button dragging also pans. In Setup, **Shift + drag** selects several cards; **Enter** selects a focused card. **Center board** restores the view. Panning is always available; zoom is optional. Drop cards onto one another to form a stack and double-click its label to name it. Group names and membership are included in the recording.

In Closed sort and Pre-Sort, cards stay where you release them. Dropping inside an eligible category assigns the card; dropping on neutral board space keeps it unsorted. Other cards stay in place. Arrow keys choose an available position in the next area. The final Q-Sort stage uses fixed slots and image trays with stable positions. Full columns reject a drop and return the card to its previous place. Smaller windows scroll vertically to keep images readable.

Replay opens at the final result. **Go to start**, **Play recording**, and **Show result** control playback. **View** contains recorded-camera versus free-view navigation and display sizing. The recorded viewport remains fixed and is fitted into the current window.

## Image demos

The optional demo library contains 30 DiffusionDB / Imagegen pairs. Choose the suggested Open (60 images), Closed (15), or Q-Sort (24) selection, select your own images, or start with an empty template. Q-Sort capacities follow the selected image count. Each demo creates a separate browser-local project with task instructions and source details in card Notes.

The library opens on the first visit and can be reopened from the project menu. Only the selected images are copied into a project. Its 60 resized WebP copies total about 5.6 MiB. Original prompts and provenance are retained; images are resized without cropping. See [demo sources](public/demo/README.md) and the [colleague test guide](docs/colleague-test.md).

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

The archive is intended for backup and transfer between SortBoard installations using the current export format. Pre-release updates may reset local browser data or reject exports created by older versions. The JSON is inspectable, but the export is not a stable analysis API.

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
- persistence and export schemas may change before v0.1, without migration support

See [docs/architecture.md](docs/architecture.md) for the implementation overview.

## License

SortBoard is available under the [MIT License](LICENSE).

Interface icons use [Lucide](https://lucide.dev/). See [third-party notices](public/THIRD-PARTY-NOTICES.txt).
