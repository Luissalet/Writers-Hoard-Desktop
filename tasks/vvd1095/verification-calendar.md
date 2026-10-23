# Edit events from Calendar — task1095

Integrated source `4e4bf5ddb92177becf55c001f8a26e2e1bf42e7d`, independently approved CAS12 by `codex-writer-cal`. Root completed integration and clean-main verify/build under the merge lock, then released it. Task1095 stays open.

## Actual reference and existing behavior

Root's authenticated Brave reference Timeline0.1.21 flow created a synthetic event on10January1500, duration three days and Weekly recurrence. It covered10–12/17–19/24–26/31 into February. Never/Yearly/Monthly/Weekly and Plain/Bunting/Scallop/Ribbon were observed; Ribbon was selected. No Today/current-world-date capability was proved. `_stage/calendar-next/REFERENCE-root.md` preserves the reference and initial Writer comparison.

Writer already had inclusive end dates, weekly/monthly/yearly recurrence, three-day repeated bands and normal MCP/form persistence. Its day-detail event title was a paragraph, requiring a trip to List to open the existing full editor. A native date-input CUA fill initially changed DOM value without updating React; root's ArrowUp/ArrowDown interaction then saved Jan10–12 correctly. This is an automation-input limitation, not a product persistence bug or a reason to rewrite the data model. Writer's solid/stripes/dots/checks are fill patterns, not the reference's decorative Ribbon/Bunting/Scallop shapes; those remain outside this delta.

## Delivered entry and independent correction

Selecting an event title from Calendar's selected-day detail opens its existing TimelineView editor, using the event's owning timeline and current pane era. Calendar remains mounted while hidden, so Save/Cancel returns to the same month/day. A failed write retains the modal and draft for retry. Two Gregorian date inputs now have localized accessible names; existing validation, operations and MCP tools remain unchanged. Standalone Calendar callers without the optional callback retain readonly details.

Independent review found a P2: hiding Calendar before Modal captured focus left BODY focused after clean Escape. The author passed the actual event button and reused Modal's existing restoreFocus callback, checking context and connection before restoring it. The reviewer's unchanged real-engine keyboard oracle went from RED (`review-focus-first.log`) to PASS (`review-focus-final.log`), covering one dialog, initial focus, inert background, Tab/Shift+Tab containment, named dates/constraint and restoration to the same event button without source writes. No second editor or parallel focus timer was added.

The reviewer executed17final focused groups: own focus1, author entry3, existing reference4, native date1, recurrence legacy3 and world-calendar UI5. Owner timeline, write failure/retry, era/Base preservation, range coverage and existing routes passed. These overlap author/legacy suites and are not a new global battery or added to the16earlier greens. Author final types/lint passed; the initial ref-during-render lint failure and fixture/router mistakes remain separately retained. See `_stage/calendar-next/RESULT.md` and `REVIEW-independent.md`.

## Final normal Browser and formal receipts

Root's final Brave flow selected the Jan17 weekly occurrence, clicked its event title and opened the originalJan10–12/Weekly event. Clean Escape returned to Jan17 with activeElement the event BUTTON. Root reopened it, saved description `QA calendario: edición directa y retorno al día 17 verificados.` and returned to CalendarJan17 with that text retained. `_stage/calendar-next/writer-calendar-edit-saved.png` shows the selected-day detail and description. These interactions belong to root; a static image alone does not prove their timing or keyboard sequence. This documentation pass did not repeat them.

The initial candidate a2ffbb1/r11 was not voted: one extra EOF blank line in the reference test was removed routinely. The replacement4e4bf5d/r12 differs only by that blank line, with product/other tests/oracle/runner unchanged. CAS12 was read and fixed before voting; `formal-r12-task-before.json`, `formal-r12-hashes.json`, `formal-r12-review.txt` and `formal-r12-receipt.json` preserve it. Eight committed paths comprise six frozen paths, the independent oracle and four runner exports180000ms. Final diff-check/runner syntax passed;17groups were not repeated for whitespace alone.

Root's `_stage/calendar-next/main-verify.log` records successful renderer/Electron typechecks, shipping lint and conformance:34engines/64tables/6510keys/22locale files/zero known warnings. `main-build.log` records Vite27.91s, Electron bundles and both plain-Node manifest/schema checks with932tools; root's build session39723 completed exit0 and the merge lock was released. These are root's build/catalogue receipts, not932end-to-end tool executions or another peer-suite run.

No new MCP tool, final-source stdio transport, installed-profile update, model execution, visual shape parity or task closure is claimed. Audio subsequently received its separate CAS13/integration/build, recorded in verification-sdk-audio.md; it is not part of this CAS12. Native manual updates for calendar/audio remain pending behind codex-silver-visual1323's shared lock. The previous notes/atlas update does not cover these deltas. New shape extensions are being implemented separately and remain unintegrated; this record does not reopen or promote them.
