# Task links across project copies — Source2349

Source `3ea6f14b1bdc8e18b25d539433b1852e19373f2e`, revision1, was independently approved by Root and integrated in main `d61e174def975bcb7531232431b41a7ffbdd4fc4`, without push. The product delta is limited to `src/services/worldMetadata.ts` and the normal regression in `tests/todos-link-portability.browser.ts`.

## Capability and contract

Notes → To-do can link a task to a chapter or Codex entry. When the normal project duplicate or JSON import creates new document identities, each semantic task link follows the destination identity through the existing remap callback: writing uses `wr`, Codex uses `codex`. The source project remains intact. The destination keeps task revision, item IDs, order, text, status, urgency, dates, timestamps, link titles and link order; only each semantic link ID changes. Text containing an ID as literal prose is not rewritten.

Repeated unresolved links receive a stable identity for their type in the copy, without creating a document or deleting the reference. They do not later reconnect to a document that reappears in the source. Older projects without their own `todos` property keep that absence. This does not add a task model, UI control, bridge tool, general identity remapper or new era task behavior.

Use Home → Duplicate project to make a copy, or Home → Import Project to import JSON. Existing MCP `wh_project_duplicate_preview` and `wh_project_duplicate` use the same normal operation and CAS/Undo contract; `wh_todo_action`, `wh_todo_list` and document readers expose the resulting links. JSON import in the acceptance harness uses the normal renderer `importProjectData` API: it is not attributed to an invented MCP import tool. Normal project ZIP export/import preserves task metadata and the linked project-owned documents.

## Verification and attribution

| Evidence | Scope and result |
| --- | --- |
| Source author, final composed cut | Two original duplicate/JSON cases plus four metadata cases pass; final quick checks pass renderer/Electron types, shipping lint and conformance. |
| Earlier author area run | Nine successful functions/57 PASS lines on `5a168f75` plus the delta, including the six own cases. This was not replayed as57 final cases or as Root execution. |
| Preserved baseline failure | `testProjectDuplicateCore` expects88 declared tables and observes89, with missing/obsolete empty, identically in baseline5a and candidate. It fails before copying and remains FAIL; neither the test nor catalog was changed. |
| Root independent Source review | Both complete diffs and remap consumers read; six final focused cases replayed with EOF0, with actual destination identities/project ownership and source unchanged. |
| Root genuine Native2353 r4 | Warm38MCP/39bridge replies and cold19MCP/19bridge replies in different Electron processes using the same private userData/file origin. Four distinct real keys, EOF0/stderr0 and revocation401. |
| Independent offline Native check | Four scripts,30 preparation inputs and4639 build input occurrences/4408 unique files rehashed exactly; both physical ZIPs opened and metadata/document rows compared. This is not a second Native run. |
| Root real Brave | Original JSON import, UI project duplication and links/cold; then both unchanged Native ZIPs imported normally, links opened by gesture and complete task regions preserved after reload. |

There are57 MCP tools/call in the Native total, including two expected negative calls; initialization and catalog RPC are separate. The58 bridge replies include one reply for authenticated HTTP Undo. Native resources use17 internal requests:12inspect,2stage,2finalize,1discard. HTTP Undo accounts for two of those internal requests, separately from the tool-call deltas. Genuine `native.inspect` provides an external version distinct from the browser fallback; the actual registration, sender/frame roles and four preload channels are used. The fixture has no external assets and does not certify copying published asset bytes.

The real stale-preview CAS and cross-project task-link negative reject without partial changes. The first duplicate is removed by HTTP Undo using its actual audit receipt; the source and unrelated control stay unchanged. Repeating the retained duplicate's operation ID keeps the same destination and complete private snapshot. Each call retains its own `_undo` transport receipt, so audit indices9 and10 differ while the service result remains identical. JSON import occurs while the source document IDs are still occupied. The three cold DTOs retain every field except derived `today`, which is independently validated against the actual local day before/after each read; all observed dates were2026-11-10. Date was not frozen.

The final archived snapshot retains source/control exactly, contains four projects and omits the undone copy. Transient before/after CAS, scope, Undo and replay snapshot equalities are assertions of Root's executed frozen harness; they were not additionally archived as separate snapshot pairs. The cold full-snapshot equality likewise belongs to the executed harness, while raw warm/cold DTOs are retained for offline comparison. The deleted output bundles are represented by their recorded hashes and the executed cold reuse assertions; an offline rehash of removed bytes is not claimed.

## ZIP transfer and real browser acceptance

The retained duplicate ZIP is11315bytes, SHA256 `5c847568195eab19edf25d86b1214d99e3d53bd72ec70fed745d67fe2ddc5de5`. The JSON-import ZIP is15316bytes, SHA256 `710cdf39713b24c2ed76d53dbd9e82a4018bdb4f53fe91d16c6d9158b18514a5`. Each physical archive has30entries and passes CRC; `project.json` contains exact destination task metadata, and actual writing/Codex rows match their project-owned identities. Literal source IDs in prose remain untouched.

Root imported both files through Home → Import Project and the ordinary Brave file picker. Their project, chapter and card IDs matched the actual ZIP rows; each task link opened that exact document within its destination project, showing the expected prose. Selecting All showed both tasks with their distinct states, urgencies, date/no-date and reversed link order. Reloading Notes and reopening To-do/All preserved the full region: text, all input/select values and options with their values. In this ZIP phase the link gestures occurred before reload; post-reload persistence is established by the complete values/options, not a claimed second click on every link. The earlier JSON/UI-copy phase separately clicked both links again after reload.

Native and Brave are separate libraries joined by explicit normal ZIP transfer. MCP did not connect directly to Brave's IndexedDB. Source-ID collision is exercised by the focal/Native JSON route, not assumed in the Brave library. Root read document routes and DOM rather than claiming access to its private database.

## Preserved failures and limits

Native r2 stopped at an observer equality that included the legitimate per-call `_undo.audit_index`. A new reviewed r3 compared only the service data, validated both full receipts and added complete snapshot equality. R3 then stopped at a final cold observer expecting mutating audit entries from successful read-only calls. The executor returns those reads before audit, so reviewed r4 checks the two actual sessions, each successful IPC response and exact adapter RPC accounting instead. Both original attempts remain FAIL with their logs and cleanup; r4 is a single separate successful attempt, with no product edit or relaxed data oracle.

An early Root browser wait looked for Home after import had already opened Overview; later route reads identified the successful import. A full-window duplicate screenshot had a CDP timeout; bringing its normal tab forward resolved capture, with repeated surface outside the principal panel retained in the evidence. The later JSON screenshot has a documented1550×720 clip showing title/tasks. This does not justify an unrelated UI edit or a narrow-layout claim.

Native cleanup records zero projects,89 empty tables, profile removal with seven checked ancestors, no reparse points or own processes, and no retry. The browser kept four owned QA fixtures; it did not delete other data. Rejected `finite-debug` and `wh-inline-review-7oayFi` profiles remained outside the work. The Source author retired the clean, integrated Source2349 worktree and branch after Root approval and integration: `CLEANUP-2349.json` records six ancestors,41867 entries, no reparse points or processes and no force. Evidence in Research is retained. Only task2367's documentation worktree remains within this task. This documentation task adds no dependencies and runs no Native, Browser, app or model.

## Continuity

Task2367 prepares four Markdown paths plus a213UTF-16 insertion into manual paragraph389, an append-only memory entry and two Writer concepts. These external payloads require Root's explicit review/GO; this first documentation cut does not claim they have been written. Manual language401, spelling386 and SDK412, existing memory bytes and existing graph rows/edges are protected by the proposed preservation checks. External execution, integration and retirement will have separate receipts.

No assignee/Mine filter, new era-specific task semantics, external-asset copying, full-suite green result or complete product parity is claimed. Other task and SDK work retains its own scope.

Evidence: `E:/Development/IA/Research/writer-parity-20261109/todos-link-portability` holds `SOURCE-SUBMIT-r1.md`, `SOURCE-CUT-r1.json`, `BASELINE-AREA-NOTE-r1.md`, `ROOT-STATIC-REVIEW-r1.md`, `ROOT-APPROVE-SOURCE-r1.md`, `INTEGRATION-r1.json`, `ROOT-BRAVE-r1.md` and `ROOT-BRAVE-native-r4.md`. `todos-link-native` holds `EXECUTION-REPORT-r4.md`, `EXECUTION-CHECK-r4.json`, `EXECUTION-CUT-r4.json`, `DONE.json`, the original failures and `root-r4/run-20261109T232745Z-f7443ab0` with actual ZIPs, receipts, DTOs, input hashes and logs. `todos-link-continuity` holds the reviewed external payloads and this documentation cut. Writers threads2598/2603/2618 and ecosystem1195 retain coordination and approvals.
