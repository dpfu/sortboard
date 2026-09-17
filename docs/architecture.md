# Architecture

SortBoard is a client-only React application. It has no router, server, account system, or external data service.

## Product model

The app has three runtime modes:

- `setup`: create projects, cards, stacks, and workflow structure
- `sort`: move cards while recording the session
- `end`: browse recordings, inspect the final result, or replay a session

Workflow templates add structure to the shared board:

| Template | Stages | Board structure |
| --- | --- | --- |
| Open | none | Free placement and stacks |
| Closed | `closed-sort` | Source plus category areas |
| Q-Sort | `presort`, `qsort` | Two pre-sort groups, two lanes, and capacity-limited buckets |

## Main modules

- `src/App.tsx`: application state, project lifecycle, media ingest, sorting, and replay
- `src/Board.tsx`: shared board renderer and scroll-based camera geometry
- `src/useBoardPan.ts`: pointer capture, temporary Space hand mode, and gesture cleanup
- `src/types.ts`: cards, workflows, widgets, and recording data
- `src/workflow.ts`: workflow creation and editing helpers
- `src/stageSurface.ts`: visible stage geometry, card layout, and drop targets
- `src/widgetSort.ts`: assignment rules, capacities, and Q-Sort transitions
- `src/persist.ts`: IndexedDB storage and ZIP import/export
- `src/media.ts`: image dimensions, video metadata, and poster generation
- `src/DemoProjectDialog.tsx` and `src/demoProjects.ts`: optional demo selection and import through the standard ZIP path
- `src/replayIndex.ts`: replay tracks and timeline markers
- `src/stackRecording.ts`: group name/membership keyframes and replay group geometry
- `src/ProjectMenu.tsx` and `src/ControlsDialog.tsx`: grouped project controls and contextual gesture reference
- `src/WelcomeDialog.tsx`: first-visit choices and local-data introduction

## Interface styles

`src/styles.css` defines the shared color, border, radius, and shadow tokens in `:root`. UI typography uses `system-ui, sans-serif`; numeric readouts use tabular figures. Neutral surfaces and one green accent cover navigation, selection, focus, and valid drop targets. Warning and destructive states use separate semantic colors; stimulus content retains its own colors.

Lucide React supplies the interface icons through named imports. Decorative icons stay hidden from assistive technology; icon-only controls have accessible names and tooltips. The package notices are distributed in `public/THIRD-PARTY-NOTICES.txt`.

The header separates project selection, Setup/Recordings navigation, and contextual actions. The Setup sidebar holds card and workflow preparation. Sorting has a compact toolbar; recording playback and view controls sit together above the replay board.

## Persistence

IndexedDB stores projects, boards, media assets, sessions, metadata, and setup undo history. Runtime media URLs are created from stored blobs and are not persisted.

With no saved projects, the welcome dialog offers a blank project, the demo library, or ZIP import. Startup and deletion of the last project never generate placeholder cards. Existing projects, including older starter boards, are preserved. Workflow tests seed explicit fixtures independently of onboarding.

Project ZIP exports contain the board state, sessions, asset metadata, media blobs, and optional project instructions. Import assigns new local IDs so an archive can be restored without overwriting an existing project.

SortBoard is pre-release software and does not migrate older persistence formats. A local schema change may reset browser data, and ZIP import accepts only the current archive format. Invalid or unsupported archives are rejected before a project is created.

## Recording and replay

Setup is the canonical persisted board. Starting a sort captures its prepared state and creates a recording automatically. Live sorting is saved in the recording; returning to Setup or starting another session restores the preparation. Finishing awaits the recording save and opens its final result. Save errors leave sorting available for retry. Recordings can also be opened directly from Setup after a reload.

A recording stores the initial board and workflow plus timestamped segments for:

- card drags and sampled paths
- group movement
- widget-assignment changes
- workflow-stage transitions

Recordings include timestamped `stackTrack` snapshots for card layering and, in Open sort, group names, membership, and order. Recordings without that track retain their existing playback behavior.

Replay uses the same board renderer as live sorting and never writes replay poses back to the prepared board.

Closed sort and Pre-Sort prepare a spaced grid once, then preserve individual drop positions without reflowing other cards. Their surface geometry and card display sizes stay fixed at the recording's initial viewport. A drop on neutral space retains the source assignment. Final Q-Sort uses slot reflow. New recordings carry `surfaceLayoutVersion: 3`, adding Q-Sort tray grids with stable positions and columns whose height follows their capacity. Versions 1 and 2 retain their original surface layout and card sizing. Rejected or unchanged drags explicitly restore the card motion values, even when the saved coordinates have not changed.

Open-sort panning changes the camera, never card coordinates. The camera frame includes a gutter around the board so navigation works at every zoom level. Camera keyframes record zoom and pan separately from card actions; replay can follow that track or use a free camera.

Camera-only updates request a recording checkpoint after a gesture or a 150 ms pause, and once per second during continuous movement. A small synchronous session-storage journal retains the uncommitted camera tail for same-tab reload recovery; it is cleared only after the corresponding IndexedDB write succeeds. If journal storage is unavailable, recording writes remain eager. Completed card actions and stage changes still save immediately. Finishing, exporting, and page lifecycle events flush the latest recording; discarding a session cancels its pending checkpoint and removes its journal.
