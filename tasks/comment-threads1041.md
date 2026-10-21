# Local comment threads — task1041/W16

## Verified source and actual gap

Primary source checked20October2026: https://vvd.world/whats-new,20September2026, In-world Comments: comments on cards/maps/canvas/any tool, tagging collaborators, resolve/delete. This offline product has no collaborator identity or notification transport; implement real local document mentions and local backlinks, never claim online collaboration.

Current annotations are the correct pipeline to extend: annotations holds each anchored note, annotationReferences its optional single-reference target. MarginPanel/NoteCard/NoteCreator are embedded in normal editors; AnnotationsEngine lists project notes; hooks run fuzzy reanchor; wh_annotate/wh_list_annotations use those same operations; ZIP already carries both tables. Missing: reply content, thread revision/CAS, resolved state/reopen, local mention targets/backlinks, normal discussion controls, contextual era reads/writes, and project/full JSON comments. AnchorAdapters currently read Base directly, so annotation scope alone would still reanchor era comments against the wrong text.

## Contract and scope

Extend Annotation additively, with optional eraId, revision(default0), replies(array), mentions(array) and resolvedAt. Legacy rows are Base/open/revision0. Keep replies in the existing annotation aggregate: no parallel comment engine or new reply table/index migration. Existing reference rows remain intact. Thread mutations use one rw transaction, compare the read revision, increment it, and return an Undo receipt. Undo changes only thread-authored fields and preserves current reanchored offsets; stale receipts preserve newer replies/edits. Creation/deletion/reference pairing is atomic and deletion receipt includes the reference row. No history subsystem edits.

Comments belong to an explicit exact context: Base comments appear in Base; named-era comments appear in that era, whether their source is a Base fallback or an own document. No copied annotations on switching panes. Lists, backlinks, counts, composer drafts and reanchor use project+era+engine+entity. The effective-source helper reads existing world-era adapters (roots and owned children) and falls back to the existing adapter/resolver for shared legacy engines. It never changes global era or stores fake project IDs. Automatic reanchor updates anchors/orphan state independently of the thread revision and never rewinds replies.

Local mentions are structured engine/entity references selected from actual effective local project documents. Normal controls link to those documents in the current era and mentions appear as local backlinks. No invented accounts, author identities or online notifications. Existing reference picker must read effective candidates; inline creation that only writes Base is omitted in named-era context rather than silently escaping that scope.

## Success before implementation

- [x] Reply/edit reply/remove reply, resolve/reopen, update root text and delete/Undo through the existing normal annotation UI and reusable operations.
- [x] Revision CAS preserves concurrent winners and failed/rejected UI drafts; Undo refuses later edits and preserves fuzzy reanchor corrections.
- [x] Base and two named eras on the same logical source show distinct comments/replies/status; era-only source and selected-text anchors read effective prose; opening/switching creates no rows.
- [x] Real local mention targets navigate in the same project/era and produce backlinks; foreign/missing targets reject mutation without losing text.
- [x] Normal dashboard and margin share thread controls, search replies/mentions and open/resolved/all filters, with a clear local-context label.
- [x] Legacy text/image/reference notes and single-reference row remain compatible; delete/project cleanup retains the existing child cascade.
- [x] Existing wh_annotate/wh_list_annotations gain optional era scope; native thread get/reply/edit/resolve/delete/Undo tools use the same service and CAS. Root wires manifest/index exports.
- [x] ZIP and normal project/full JSON retain replies, status, revisions, mentions and anchors. JSON clone remaps era/annotation/reference/target/source identities; unavailable legacy-engine sources are retained as orphans instead of linking into the original project.
- [x] Isolated functional tests cover legacy/anchors/reanchor/mentions/foreign scope/conflicts/Undo/portability; actual CSS1440/640 normal UI lifecycle; full native MCP transport; scoped lint/type checks. No production app/model/data.

## Files and coordination

Own src/engines/annotations/** and src/services/aiBridge/tools/annotations.ts; new local bridge/manifest/portability/scope helpers stay in annotations. No changes to documentHistory while its independent review runs. JSON monolith src/db/operations.ts is in that review: coordinate root wiring of exported comment portability helpers rather than editing it concurrently. AnnotationSource context uses the existing EnginePaneContext/worldEra hooks, with explicit props for surfaces outside a provider. Anchor adapter registry itself need not change; normal annotation consumers call the effective helper. Root owns global tool manifest/index registration. Product is Operate mode; preserve existing dark workspace tokens and reusable controls, read impeccable craft floor before UI edits, verify desktop/narrow in two bounded visual rounds.

## Status

Architecture audit and plan complete before implementation. Proposed change is additive on existing rows and flows; no core schema migration needed.


## Verification and freeze

W16 implemented additively in the existing annotations aggregate, with no database migration or online collaboration claim. Root wired normal JSON/full JSON and global MCP registration; ZIP uses the existing strategy plus structural preflight. Annotations remain exact Base/era-context records rather than copied document variants. Local mention picker exposes effective Codex entities; structured API mentions also accept validated local engine/entity targets.

- `electron scripts/run-focused-browser-tests.cjs tests/comment-threads.browser.ts testCommentThreads 250000`: PASS4groups, including timeline-event clone identity, source catalog excluding retained variant history, Base deletion preserving own-era source/comments, and exact project/era draft cleanup.
- `electron tests/comment-threads-transport.cjs`: PASS actual native stdio→HTTP→executor→IPC→IndexedDB registered tools. Create/quoted anchor/list/get, Base/era distinction, era-only local mentions, reply/edit/remove, resolve/Undo, stale CAS, foreign target rejection, thread delete/Undo and readonly switch exercised.
- `electron tests/comment-threads.runner.cjs`: PASS3groups, real Tailwind CSS1440/640, two simultaneous Base/era margin panels, normal dashboard creation on Timeline, mention navigation, reply edit/remove/Undo, existing delete dialog and thread Undo, stale CAS draft preservation, deliberate retry and era-switch draft recovery. No horizontal overflow. Desktop/narrow visually inspected; controls and long rows wrap. A captured transient link-loading frame after Undo was a test synchronization issue; assertions now await restored links before capture.
- Scoped ESLint: PASS. Renderer typecheck PASS.

No production app/model/data used. Eight thread handlers exported from annotations/bridge.ts and definitions from annotations/bridgeManifest.ts, already registered by root. JSON seam is annotations/portability.ts (`decodeAnnotationData`, `exportAnnotationData`, `annotationSourceIds`, `cloneAnnotationData`). Existing tools/annotations.ts accepts optional eraId. Draft cleanup adds only the exact annotation journal prefix in hooks/localDraftStore.ts. `_shared/deleteEntityAnnotations.ts` now filters Base/explicit era, while deleteProject retains its whole-project cascade.

Remaining declared scope: this is local discussion, with actual local document references and backlinks; no collaborator account identity, network messages or notifications are implied. Drafts survive navigation/conflicts in their existing local journal; a comment deleted elsewhere must be restored before its comment-specific draft can be resumed. Existing reference inline creation remains Base-only; named-era picker never silently writes Base.

## P2 receipt replay correction — plan before code

Fresh independent `testClosureThreadDeleteReplay` reproduces FAIL: delete revision0 → Undo → reply revision2 → delete → reuse the first delete receipt resurrects revision1 without the reply. Previous freeze did not cover receipt replay after a second deletion. Preserve that failed result; no earlier report is rewritten as passing it.

Give every thread Undo receipt a unique session identity. Issue receipts transactionally and record their identity/scope in a session registry. Undo checks availability inside the existing serialized RW transaction and consumes the identity only on successful outer commit. An aborted mutation must not leave an issued receipt; an aborted Undo must keep its receipt usable. This adds no history table, permissions or second comment pipeline. Current revision CAS/reanchor semantics remain unchanged. Session receipts are intentionally not project backup data.

Acceptance: rerun the independent reproduction unchanged; add deterministic edit/delete replay and concurrent-consumption/rollback-retry coverage, including a delete with reference whose later restore write fails. Run existing thread functional, normal UI and native transport suites. Record exact new evidence and scope in a separate fix report for parent/reviewer.

### P2 correction verified

Unique receiptId now binds each edit/delete Undo to its issued session metadata. Inside the existing RW transaction it is reserved for one consumer; outer commit consumes it, outer abort releases it, and aborting receipt issuance removes it. No comment snapshots/history are copied into the registry. Independent repro unchanged PASS after observed FAIL; new3groups cover real reference-key ConstraintError rollback/retry, cloned/concurrent receipt consumption and outer transaction rollback. Existing thread4groups, normal UI3groups and actual native transport PASS; native now also replays a consumed receipt after a later reply/delete and verifies rejection/latest receipt preserves both replies. Renderer tsc, scoped lint/diff PASS. New native comments fixture depends only on its actual project/chapter/Codex inputs, not unrelated document-image/worldgen/ink fixtures which timed out before rendererReady. Separate report preserves both failures and evidence: work/worldcraft1041-comments-receipt-fix.md.

### Additional P2 orphan restoration — plan before code

Unchanged independent testClosureOrphanCommentDeleteUndo fails annotation_source_missing: normal JSON import deliberately retains a legacy unavailable source as isOrphaned=true; dashboard deletion succeeds but its Undo rejects. Preserve this new failure separately. Deletion receipt metadata must remember whether the original row was already orphaned and its exact source identity. Only that same issued orphan may restore without requiring a source to exist; restore keeps isOrphaned=true and normal scope/reference checks. Creating a new comment still requires an owned source, and changing receipt source identity cannot use the orphan exception. Test independent repro unchanged plus altered-source rejection, reference/transaction rollback and existing normal UI/native flows.

Additional orphan P2 verified: unchanged independent repro FAIL in wh-focused-5XJSnT → PASS; exact source tuple of an already orphaned deleted row is bound to receipt metadata. Restore keeps orphan flag/text/replies without requiring a vanished source. Altered source receipt rejects without consuming original; normal new foreign-source orphan creation still rejects. Prior replay/rollback/concurrency3groups, thread4groups, UI3groups and full native transport remain PASS. Latest UI profile wh-comment-threads-ui-jy5uKC. Separate appended report preserves initial failure and limits.
