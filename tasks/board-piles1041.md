# Canvas piles and Base write integrity — task1041

## Mandatory observed evidence

Read both authenticated-reference screenshots supplied by root: outputs/vvd-reference/canvas-pile-collapsed.png and canvas-pile-expanded.png (projectless workspace). Canvas0.1.13: selecting2notes then Collapse into a pile produces a compact2items block; Open this pile reveals both original notes. Root did not save that world. We implement the offline capability in our normal Canvas, preserving its own visual system rather than claiming visual identity.

Current repository already has frame.collapsed, an Inspector toggle, geometry-based child hiding and moving frames. It lacks compact pile creation from an exact selection, persistent exact membership, count/direct-open controls and native commands. Existing Base commitBoardBatch blindly writes queued whole rows; named-era batch already does field-level three-way merge and rejects conflicting edits. Base queue recovery is currently gated off despite an existing journal key.

## Approved design before core edits

Reuse kind frame and add optional memberNodeIds and expandedSize. Explicit piles keep their original node IDs/coordinates/content/references/edges; only the frame bounds become compact. Expanding restores saved frame bounds and original member positions. Legacy geometric frames keep geometric containment; a legacy frame converted deliberately captures its members. Nested explicit membership is traversed with cycle guards. No parallel engine/format, new limits or global era state.

Pure helpers create/collapse/expand groups and calculate visible nodes. Normal selection adds Collapse into pile, frame/pile offers direct accessible Open/Collapse and Inspector uses the same operation. graph.batch records one Undo/Redo step. Move, duplicate and delete an explicit pile include its member closure and associated surviving connections. Legacy frame deletion retains its existing leave-contents behavior. Ungroup/open behavior preserves membership unless deliberately removing the wrapper.

Extract the current era field-merge logic into a pure board leaf and use it for both contexts. Base commitBoardBatch accepts optional baseline for backward compatibility, but normal queued UI and native canvas mutation always supply one. Disjoint field edits merge; changed same field/deletion identity conflict rejects the entire batch. Rejected Base/era writes remain in the existing local draft journal and normal pending-write lifecycle, so nothing overwrites an MCP winner silently.

CloneSelection and project/era/history cloning remap member IDs alongside node identities. Existing raw JSON/ZIP carries additive fields. Export consumers receive pure visibleCanvasNodes helper; root/A wire their owned preview/image leaves. Do not edit FreehandOverlay, character sheets, SDK or shared preview.

## Success criteria

- [x] Select two notes, collapse compact with count, open original content/coordinates; unrelated overlapping notes remain visible. Direct mouse/keyboard controls work.
- [x] Legacy frames remain compatible; nested member closure has no cycles/leaks; empty/deleted member references are handled.
- [x] Move/duplicate/delete selected pile carries its members and connections, with Undo/Redo retaining exact IDs/content.
- [x] Base/era two panes stay isolated; reload/recovery and normal JSON/ZIP clone preserve/remap membership and expanded bounds.
- [x] Normal native Canvas MCP can create/collapse/open a pile via the same pure operations and CAS.
- [x] Reproduce Base UI pending edit versus native MCP same-row overlap: winner preserved, rejected draft recoverable. Disjoint field changes combine in both Base/era.
- [x] Meaningful functional + actualCSS1440/640 normal UI + full native transport, regression suites, scoped lint and renderer/electron checks.

## Paths and coordination

Own board types/operations/hooks/canvasBridge/canvasManifest/graph mutations/new leaves, BoardCanvas/BoardNodeView/Inspector and local copy. Root ceded worldEras/board.ts only merge integration and portability.ts only member IDs. Root/A consumers use exported pure visibility helper; shared DB operations clone seam coordinated separately. All prior fronts frozen. No commits/production app/data/model.

## Frozen implementation and verification

`graph/membership.ts` exports pure `visibleCanvasNodes(nodes)` and `pileItemCount(frame,nodes)` for root/A export consumers. `frameMembers` resolves explicit descendants and legacy geometry with cycle guards; `pileSelection` expands explicit selected groups. `graph/piles.ts` creates and toggles existing frame nodes; member rows are never reconstructed. New fields are additive memberNodeIds/expandedSize. Root wired normal JSON clone bnode IDs; generic era/history portability includes memberNodeIds and retains richContent handling.

Normal multi-selection offers Collapse into a pile. Creating focuses the compact wrapper through viewport movement only. Direct Open/Collapse buttons support ordinary keyboard focus, count members and respect frame locks; Inspector shares the operation. Expanded size is restored; member coordinates/content and surviving connections remain unchanged. Existing move/copy/delete planners carry explicit member closure and remap internal copied edges; legacy geometric frame deletion keeps notes.

Base and named-era commit use the same pure field-level merge. Queued writes carry the last saved baseline. Overlap rejects atomically; rejected Base/era drafts use the existing persistent local journal. Review saved changes reads a specific saved snapshot and shows saved/local fields. Keep my pending changes rebases only locally changed fields onto that reviewed baseline; another concurrent overlap rejects again. Recovery is undoable, including after journal remount. Disjoint remote fields survive recovery and its Undo/Redo. Permanent conflicts do not repeatedly autosave; transient failures retain existing retry behavior. Opening/reviewing creates no writes/history.

Verification in isolated synthetic profiles:

- `electron scripts/run-focused-browser-tests.cjs tests/board-piles.browser.tsx testBoardPiles 250000`: PASS4groups. Exact two-note membership versus unrelated overlap, nested/cyclic groups, legacy frames, expanded bounds/coordinates, move/clone/delete connections, Base disjoint/overlap merge, own-era isolation, actual useBoardGraph pending UI versus normal MCP, remount journal recovery, stale review rejection, explicit recovery and Undo/Redo preserving remote color, JSON/project ZIP and Base/own-era cloned member IDs.
- `electron tests/board-piles-ui.runner.cjs`: PASS3groups with actual product CSS and native Electron mouse/keyboard. Normal select→collapse→Open restores notes, Undo recollapses, live MCP expands. CSS1440/640 with normal Fit after window resize: count/title/Open visible, page has no overflow. Native Inspector title draft→normal MCP winner→Review saved changes→Keep preserves local title and remote color. Final screenshots tasks/evidence/board-piles-{1440,640}.png. Inspected desktop and narrow images; corrected initial offscreen/chrome placement by focusing newly created pile. Existing Fit remains normal canvas navigation after resizing.
- `electron tests/board-piles-transport.cjs`: PASS real stdio→HTTP→executor→IPC→registered handlers→IndexedDB for all six pile actions create/collapse/expand/move/duplicate/delete, stale version, visible IDs and Base/era separation. Extends existing wh_board_canvas_get/action schema; no new global registration names.
- Existing `testBoardCanvasDepth`: PASS5groups (all shapes, pressure/marker, live references, rich content, erase/Undo, group keyboard movement). Existing `testBoardFreehand`: PASS3groups (geometry, editing lifecycle, portability). Expected conflict fixtures log rejected flushes; legacy React harness emits act warnings.
- Board/table scoped ESLint PASS. Electron typecheck PASS. Renderer typecheck initially PASS; final concurrent root timeline/eventBatch.ts has unused readWorldDocument and Transaction mismatch at90, communicated to root (no edits there). Final conformance PASS34engines/63engine tables/5650locale keys.

Separate reviewer correction: table calculations promote only when every row binding maps to a persistent type property or self. A local aggregate or Name/title remains local, avoiding invented missing property IDs. Unchanged independent exports testClosureTableLocalDependency and testClosureTableTitleDependency PASS; original table calculations4groups PASS. No reviewer test edited.

No commits, production app/model/data, localSDK, FreehandOverlay or image/preview consumer edits. Final review and shared integration belong to root.


## Native action Undo closure

Added canvasUndo.ts `undoCanvasAction(scope,receiptId)` and `issueCanvasReceipt(tx,scope,boardId,beforeNodesEdges,afterVersion)`. Existing action returns receiptId and audit.before contains only `{__boardCanvasReceipt:id}`. New wh_board_canvas_undo delegates the same function. Session memory retains canonical nodes/edges; there is no second durable history or binary payload in audit. Receipts bind exact Base/era and board, compare the full after document version, and restore the normal batch diff without touching layers/views. Foreign occupied child IDs reject before restoring. Issuance is invalidated on outer transaction abort. Undo claims are released on outer abort and consumed only on outer complete, so nested SDK rollback can safely retry.

`electron scripts/run-focused-browser-tests.cjs tests/board-canvas-undo.browser.ts testBoardCanvasUndo 200000`: PASS4groups covering issuance abort, Undo abort/retry/one-use, aggregate newer-edit conflict, occupied child ID conflict/retry, and wrong-scope plus actual era Undo/Base version preservation. Root added the dedicated undo.ts audit branch before generic era handling. Updated `electron tests/board-piles-transport.cjs` PASS: full native /api/audit→/api/undo restores Base and own-era children, audit before has only the opaque receipt ID, second Undo refuses, a newer aggregate edit refuses without losing its winner, and explicit wh_board_canvas_undo delegates the same path. Expected newer-edit refusal logs canvas_undo_conflict. The old generic root-fields path is not used.


Final freeze: product UI sources and receipt/handler/schema are frozen for independent review. No pending implementation work in this assigned scope. Root owns final broad checks and export/preview integration; all known Board-specific functional/native/CSS checks pass.
