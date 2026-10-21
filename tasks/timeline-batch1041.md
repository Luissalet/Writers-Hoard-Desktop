# Timeline event batches

Confirmed offline gap L10: select several events, move their dates together or remove the selection, retaining distances and undoing the complete mutation including cross-timeline connections.

Success criteria:
- [x] One normal domain operation for UI and MCP, explicit Base/era and full aggregate CAS.
- [x] Shift exact calendar/world dates by whole days, retaining durations, clocks, links and authored date precision; reject ambiguous free-text/partial dates before writing.
- [x] Remove the selected events and touching connections atomically; one Undo restores the complete group, refusing a newer edit.
- [x] Normal selection UI with desktop/narrow verification, effective era isolation, external MCP and regression checks.

Session Undo uses opaque receipts; durable recovery remains the ordinary document history. The operation does not invent a day for a free-text or partial date.

Proof: `tests/timeline-batch.browser.ts` three groups PASS (leap/world-year boundaries, ranges/clocks, stale CAS, no partial write on invalid date, cross-line connections, occupied foreign child IDs, era/Base and newer-edit Undo). `tests/timeline-batch-ui.browser.tsx` native 1440/640 PASS select/move/Undo/confirm-delete/restore, actual TimelineEngine and CSS; final images Temp/wh-codex-properties-ui-bYJjBz/timeline-batch-{1440,640}.png inspected by root. `scripts/run-world-authoring-transport.cjs` full external stdio→HTTP→executor→IPC→IndexedDB PASS with all three registered batch tools and Base/era checks. Focused ESLint passes. Independent functional and finish reviews remain pending.
