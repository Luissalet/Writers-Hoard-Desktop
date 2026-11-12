# Fullscreen in Tables and Sheets

## Normal use

Open a table or sheet in the project workspace. **Full screen** in the document toolbar expands its grid inside Writer. The same document and grid stay mounted with their effective Base or era, grouping, filters, selection and unsaved draft, such as a pending column. The document list and workspace chrome hide; browser fullscreen is unchanged. In the split layout the other pane remains mounted and inert. **Exit full screen** or free Escape restores the layout; the cell editor gets Escape first when editing. Changing the active companion tab while its table is expanded also restores the layout and preserves the previous grid in its tab. Changing views does not save data or add document Undo.

## MCP and Source boundary

Discover mounted, visible hosts with `wh_workspace_focus_get` filtered by `projectId`, optional `eraId`, `namespace: 'tables'` and optional `documentId`. Call `wh_workspace_focus_set` with the observed ephemeral `hostId`, matching scope and `active`. A hidden or revoked target is unavailable; no request is queued. Project departure removes the targets. Pass `eraId` for an exact era match; omitting it does not restrict discovery to Base. Base targets omit `eraId` in the result. The transport reports the same logical state as the toolbar, without acknowledging paint. Source concentration and its author hook retain their existing behavior. There are no new tools, persistent workspace preferences or headless targets.

## Reference and evidence

The public VVD Table 0.1.44 example expanded its grouped grid inside the application window, with `document.fullscreenElement` null, and restored its rows on exit. The inspected controls showed `and` between conditions and no OR selector or group subtotal. A fresh tab reopened the original example; this was not a persistence test in a user world. `REFERENCE-TABLE-FULLSCREEN-r1.md` records the bounded comparison; `BRAVE2940-r1.json` records that the prior Writer workspace lacked the toolbar control.

The receipts below are in `Research/writer-parity-20261110/sdk-nonadditive-reference/`.

- `BRAVE-GREEN2942-r3.md`: real Brave 3, private fixture through MainLayout / ProjectDetail / Tables. Fifteen workspace checks passed, plus two Source shell checks and one shared-hook check. Both grids stay mounted with their state; the hidden pane and workspace chrome are inert. The opposite Source editor keeps its node while its portalled menu closes when MCP expands the table. In a live table, the first Escape cancels the edit from 2450 to 3000 and the next exits fullscreen. Mod+2 switches to another companion tab, exits fullscreen, keeps the prior grid node and makes its target unavailable until returning. Project data stays identical and targets disappear on exit. The geometry measurements in this receipt belong to r1, not a new r3 measurement.
- `NATIVE2942-r3.md`, `NATIVE-INPUTS2942-r3.log` and `native2942/run-20261112T013453Z-caaa9d64/RESULT.json`: eight exact runtime inputs, private hidden Electron, production stdio/IPC and two distinct keys; 15 IPC responses. Both panes, Base/Past, hidden-target unavailability, UI/MCP agreement, and exact grid nodes and project data. Both keys were revoked with HTTP 401 and no IPC; both processes exited 0, the port closed and the private profile was retired. Receipt SHA-256 `0ec16257e586a667b97cacfb2b2e3e7b54dd90f70fd5229fd3fe60461704e9d3`.
- `VERIFY-QUICK2942-r3.log` and `BUILD2942-r3.log`: both exited 0; conformance reported 34 engines, 64 engine tables and zero known warnings. The production build completed in 2m 42s.
- Earlier r1/r2 observations remain historical; the r3 receipts are the final Brave and Native checks. The isolated fixture cleanup found 89 empty test database tables. The design detector reports the inherited 10px indicator in TablesEngine.
- `MERGE2942-RESULT-r1.json`: task #2942, submission revision 1 approved for exact commit `e5fd0ff36a3408a210203a3a3171bcca76d1d0ad`. Root fast-forwarded Main from `a7f7b865b9722d0e9fd1058b27bd030de1dfe398`, verified all eight paths and preserved unrelated work. No push.
- `MANUAL2942-r1.json`: Root verified a 217-character update to the family manual with the prior content and structure preserved.

The reference observation and Writer fixture prove their named cases. They do not establish every device or document type, other VVD table features, global SDK/web parity or completion of task 1095.
