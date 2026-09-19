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

1. On your first visit, choose **Start with a blank project** for your own material or **Start with a demo project**. Closed sort with 15 images is suggested for a short test. No project or placeholder cards are created until you choose.
2. In **Setup**, add cards, choose a sort mode, and configure categories or the distribution. Select a card or area to open its details.
3. Select **Start sorting**. Recording starts automatically. Double-click an image or video to inspect it. **Instructions** opens the task; **Controls** collects the available gestures.
4. Select **Finish sorting** when ready. Q-Sort first uses **Continue to Q-Sort** to advance from Pre-Sort.
5. Review the result, play the recording, or scrub through the timeline. **Export project** downloads the project and its recordings.

**Setup** and **Recordings** are available from the project header. **New sorting session** starts from the prepared Setup board. Completed sorts do not overwrite that preparation. The project-name menu contains project switching, creation, import, and export. **Demo projects** is always visible at the top of the left Setup sidebar.

New projects and demos start sorting in full screen by default. Open **Display** in Setup to turn off **Start in full screen** or change card proportions and size. Existing projects retain their saved preference. Full screen can also be toggled while sorting; **Esc** returns to the window. Finishing a sort leaves full screen. If full screen is unavailable, sorting continues in the window.

**Open-sort navigation:** drag empty space to pan, or hold **Space** and drag over cards. Middle-button dragging also pans. In Setup, **Shift + drag** selects several cards; **Enter** selects a focused card. **Center board** restores the view. Panning is always available; zoom is optional. Drop cards onto one another to form a stack and double-click its label to name it. Group names and membership are included in the recording.

In Closed sort and Pre-Sort, cards stay where you release them. Dropping inside an eligible category assigns the card; dropping on neutral board space keeps it unsorted. Other cards stay in place. Arrow keys choose an available position in the next area. The final Q-Sort stage uses fixed slots and image trays with stable positions. Full columns reject a drop and return the card to its previous place. Smaller windows scroll vertically to keep images readable.

Replay opens at the final result. **Go to start**, **Play recording**, and **Show result** control playback. **View** contains recorded-camera versus free-view navigation and display sizing. The recorded viewport remains fixed and is fitted into the current window.

## Image demos

The optional demo library contains 30 DiffusionDB / Imagegen pairs. Choose the suggested Open (60 images), Closed (15), or Q-Sort (24) selection, select your own images, or start with an empty template. Q-Sort capacities follow the selected image count. Each demo creates a separate browser-local project with task instructions and source details in card Notes.

The welcome screen links to the library; **Demo projects** reopens it from Setup. Choosing a blank project does not load the library. Only the selected images are copied into a project. Its 60 resized WebP copies total about 5.6 MiB. Original prompts and provenance are retained; images are resized without cropping. See [demo sources](public/demo/README.md) and the [colleague test guide](docs/colleague-test.md).

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

## Prior art

Card sorting, visual sorting and online Q studies have a substantial software history. These projects provide useful points of comparison for SortBoard's local-first board and replayable sorting process.

Public sources checked on **2026-09-19**. Years identify the linked publication, documentation, release or announced launch. Maintenance notes describe public evidence; an advertised service alone does not establish ongoing development.

| Project and reference | Access / deployment | Sorting features | Maintenance evidence |
| --- | --- | --- | --- |
| **[MeSort](https://mesoftware.org/index.php/mesort/)** — [2020 manual](https://mesoftware.org/wp-content/uploads/2020/03/Working-Paper-Manual-MeSort-v1.0.pdf) | Web; open source ([AGPL-3.0](https://github.com/zemki/mesort)). Developed at the University of Bremen. | Circle, Q- and concentric-circle/network sorts; image/text tokens, multiple passes, accompanying questions and PDF/XLSX exports. | **Support-end notice with later activity:** the [README](https://github.com/zemki/mesort#developer-notes) announces the end of official support on 2024-12-01, but later [code changes](https://github.com/zemki/mesort/commit/3faa8e0cd613a2eac34ef39c95f5d8f1e9e5a73f) were merged on 2025-10-06. |
| **[VQMethod](https://vqmethod.com/Home)** — [2019 paper](https://journals.sagepub.com/doi/10.1177/2059799119832194) | Hosted; advertised as free for researchers. | Image, video and sound Q-sort cards; configurable grids, real-time reports, data export and hosted media storage. | Website and registration available. No dated public release history located; ongoing maintenance is unverified. |
| **[QMethod Software](https://qmethodsoftware.com/)** — [2019 citation](https://qmethodsoftware.com/how-to-cite-qmethod-software/) | Hosted commercial service with a limited free tier. | Study creation, participant management, dashboards, exports and guided Q-method analysis. | Commercial service with [pricing and support information](https://qmethodsoftware.com/frequently-asked-questions/). No dated public release history located; maintenance cadence is unverified. |
| **[Q-sortware](https://www.qsortware.net/)** — [2010 launch](https://www.qsortware.net/about.html) | Hosted; free to use. | Online Q-sorting with study links, accompanying questions and CSV data export. | The site continues to advertise the free service; latest dated homepage news found: 2023-11-17. Current maintenance is unverified. |
| **[Q-sorTouch](https://qsortouch.com/new/)** — [2017 launch](https://www.qsortware.net/about.html) | Hosted commercial service; touch-oriented. | Image/sound stimuli, randomization, additional response formats and multilingual interfaces. | A replacement version is documented for 2024; latest dated homepage news found: 2024-10-25. Current maintenance is unverified. |
| **[HtmlQ](https://github.com/aproxima/htmlq)** — [2015 release](https://github.com/aproxima/htmlq/releases/tag/1.0.4) | Open source (MIT); self-hosted web application. | HTML5 Q-sorting, XML configuration and compatibility with FlashQ settings and its optional PHP backend. | **Dormant upstream:** latest default-branch [commit](https://github.com/aproxima/htmlq/commit/6bc570a98071108a5722bcff0de1fd8793cda626) is dated 2015-03-22; latest release, 1.0.4, is dated 2015-04-19. Repository is not archived. |
| **[EQ Web Sort](https://github.com/shawnbanasick/eq-web-sort)** — 2024 citation for v6.0.0 | Open source (GPL-3.0); configurable web hosting or offline notebook use. | Statement/image Q-sorts, customizable grids and storage back ends; no built-in cookies, tokens or analytics. | [v7.0.1](https://github.com/shawnbanasick/eq-web-sort/releases/tag/v7.0.1) released 2025-06-29; [README updated](https://github.com/shawnbanasick/eq-web-sort/commit/351528495e7f334c3b464e96c1e624960c611616) 2026-04-27. The maintainer now recommends **[QUINCE](https://quince-config.netlify.app/)** for online sorting of text statements. |
| **Q-Assessor** — [2000 validation study](https://ojs.library.okstate.edu/osu/index.php/osub/article/view/8945) | Proprietary online system, also listed by [ISSSS](https://qmethod.org/resources/software/). | Internet-based Q-sorting and analysis; the validation study compared computer-based and paper sorts. | **Historical precedent:** the former project domain now serves unrelated content. A current service or maintainer could not be verified. |
| **[xSort](https://xsortapp.com/)** | Freeware; native macOS application. | Table-like card sorting with open, semi-open and closed exercises, subgroups, and real-time cluster/distance analysis. | **No longer maintained**, explicitly stated on the official site, which also warns of compatibility issues with recent macOS versions. |

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
