# Board freehand drawing: implemented and verified

- [x] Store vector strokes on ordinary shape nodes, without a new engine/table.
- [x] Pencil mode, brush color/width, per-stroke inspector width and a clear Done action.
- [x] Normalize geometry to node bounds and simplify dense paths iteratively.
- [x] Reuse move/resize/layer/lock/copy/delete/undo/batched persistence/ZIP behavior.
- [x] Hidden Electron geometry, command history, editing, duplication, reopen and archive tests.
- [x] Trusted pointer draw/move/undo/redo and Escape cancellation; final screenshot inspected.

## Validation

- `npx electron scripts/run-focused-browser-tests.cjs tests/board-freehand.browser.tsx testBoardFreehand 180000` — three groups pass.
- `npx electron scripts/run-board-freehand-qa.cjs` — two saved pointer strokes, visible node movement, persistent positions, whole-stroke undo/redo and Escape cancel pass in a hidden isolated profile.
- Scoped ESLint and full renderer typecheck pass after integration.
- Visual artifact: `work/board-freehand-preview.png`.

The existing canvas shortcut target helper excluded SVG surfaces. It now accepts Element targets while still excluding buttons/forms/dialogs, so SVG drawing focuses the canvas for Escape and undo. QA servers disable file watching and HMR, preventing concurrent source edits from resetting an input gesture in the synthetic profile.
