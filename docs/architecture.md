# Architecture

SortBoard is a client-only React application. It has no router, server, account system, or external data service.

## Product model

The app has three runtime modes:

- `setup`: create projects, cards, stacks, and workflow structure
- `sort`: move cards while recording the session
- `end`: replay a recorded session

Workflow templates add structure to the shared board:

| Template | Stages | Board structure |
| --- | --- | --- |
| Open | none | Free placement and stacks |
| Closed | `closed-sort` | Source plus category areas |
| Q-Sort | `presort`, `qsort` | Two pre-sort groups, two lanes, and capacity-limited buckets |

## Main modules

- `src/App.tsx`: application state, project lifecycle, media ingest, sorting, and replay
- `src/Board.tsx`: shared board renderer
- `src/types.ts`: cards, workflows, widgets, and recording data
- `src/workflow.ts`: workflow creation and editing helpers
- `src/stageSurface.ts`: visible stage geometry, card layout, and drop targets
- `src/widgetSort.ts`: assignment rules, capacities, and Q-Sort transitions
- `src/persist.ts`: IndexedDB storage and ZIP import/export
- `src/media.ts`: image dimensions, video metadata, and poster generation
- `src/replayIndex.ts`: replay tracks and timeline markers

## Persistence

IndexedDB stores projects, boards, media assets, sessions, metadata, and setup undo history. Runtime media URLs are created from stored blobs and are not persisted.

Project ZIP exports contain the board state, sessions, asset metadata, and media blobs. Import assigns new local IDs so an archive can be restored without overwriting an existing project.

SortBoard is pre-release software and does not migrate older persistence formats. A local schema change may reset browser data, and ZIP import accepts only the current archive format. Invalid or unsupported archives are rejected before a project is created.

## Recording and replay

Starting a sort creates a recording automatically. A recording stores the initial board and workflow plus timestamped segments for:

- card drags and sampled paths
- group movement
- widget-assignment changes
- workflow-stage transitions

Replay uses the same board renderer as live sorting.
