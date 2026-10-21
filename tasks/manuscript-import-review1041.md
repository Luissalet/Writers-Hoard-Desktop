# DOCX manuscript import and review — proposed contract (1041)

Status: compatible A+B+C+D implementation frozen, 2026-10-20. Original audit below remains historical evidence; closure and limitations are appended. This is a Writer product gap; no verified VVD contract establishes Word review/import fidelity.

## Success criteria before implementation

A user opens a local DOCX, sees file-specific conversion findings and chapter previews, chooses new drafts or explicit existing targets, and applies the reviewed plan atomically in Base or a named era. Compatible tracked insertions/deletions remain decidable in the normal revision UI/MCP. Importable comments become ordinary scoped threads; unrepresentable comments remain available in the preserved document and are counted specifically. The exact original file survives close/reopen and project/full JSON/ZIP/clone. A stale target or failed child/source write leaves all manuscript targets unchanged. No online service or another repository is required.

## Verified source state

| Path | Existing behavior | Material gap |
| --- | --- | --- |
| `manuscriptImport.ts` | File validation; DOCX/MD/TXT/paste; pure blocks, split by heading/literal separator/file; rename/exclude preview | No file diagnostics, review policy, original bytes, target mapping or era argument |
| `manuscriptDocx.ts` | JSZip/chunked paragraph scan; heading localisation/outline, bold/italic, quotes, line breaks and plain note bodies | Explicitly drops tables as structure, lists/numbering, comments, images/objects, many formats; ignores deleted text while retaining insertions; truncated tail can return partial text |
| `manuscriptPersist.ts` | Sanitise before one Base `writings` transaction; new IDs/bulkAdd, append chapter numbers | Create-only; no plan hash/CAS, source receipt, era writes or comments |
| `ManuscriptImportModal.tsx` | Adjustable split, rename, exclusion and count before deliberate commit | Parent passes only projectId, including from a named-era workspace; no content/loss preview or replacement targets |
| `DocumentTools.tsx` | Native openBytes; exportHtml(includeRevisions:true); page preview; complete native download; explicit apply with editor Undo | Session is local component memory and closes at unmount. Ignores returned revision warnings. Apply is current chapter/editor only, not manuscript batch. Does not persist original |
| `native/PROTOCOL.md`, `native/apps/document-engine/src/lib.rs` | Owned bundled offline engine, sessions, inspect, HTML with revisions and embedded images, native writer.json with assets/passthrough, atomic in-memory command batches | Sessions are deliberately nondurable. Native archive is not byte-identical original. HTML is not lossless DOCX |
| `native/crates/engine/src/cmd/review.rs` | Comments with author/date/parent/resolved/body; review.comments returns start anchor; full inspect includes inline start/end objects | HTML exporter has no comment interchange; start-only command is insufficient for exact ranges. Native positions are UTF-8 bytes + story/path, not UTF-16 or ProseMirror |
| Writings revision extensions/projection and `docs/editor-revisions/README.md` | Existing insertion/deletion and paragraph-boundary attributes, identity/author/source/date, normal accept/reject, final/original projections | Formatting changes, move linkage, nested incompatible revisions and trailing paragraph revisions have concrete native warnings; do not promise all Word change kinds |
| `annotations/operations.ts`, `threads.ts` | Scoped threads/replies/resolve/CAS/Undo; range context/fuzzy reanchor; orphan recovery | Local reply model lacks foreign author/date provenance. Foreign range conversion and split-boundary treatment need an explicit adapter |

Important correction: native exportHtml embeds images, as well as returning an assets map. Ignoring that map alone does **not** prove image loss in DocumentTools. The simplified manuscript reader explicitly drops them.

## Smallest coherent implementation

1. Keep the existing importer and split controls. Add a typed inspected-source result: source identity/hash, rich blocks, diagnostics, revision summary, comments and original bytes. On desktop, use a dedicated temporary native session opened from those bytes, inspect/export with revisions, then close it. Preserve supported rich blocks from the existing HTML/editor schema instead of rebuilding them as plain paragraphs. MD/TXT/paste keep their current path. The simple DOCX scanner can remain a fallback with explicit detected losses; it must not masquerade as review-preserving import.
2. Add a pure plan over the inspected source and split settings. Each row has source block span, title, include flag and action `create` or `replace {writingId, expectedUpdatedAt, expectedDocumentVersion?}`. Default stays create-only. Do not infer replacement from matching titles. Show actual content excerpt and diagnostics by chapter. Plan digest covers source bytes/hash, projection/schema version, split rules, selected rows, actions and scope; names alone are insufficient.
3. Commit through one normal Writings batch operation, shared by UI and MCP. Perform native parse/hash/sanitising outside IndexedDB. Within one RW transaction validate project/era, all target membership and versions, all source/comment payloads and ID absence **before** any write. Then store source/receipt, create chapters and protect replacements with the normal preimage snapshot/monotonic stamp path. Preserve synopsis/tags/dates/integrations/history and existing thread IDs unless explicitly changed. Preserve Base and sibling-era rows. Announce/touch only after successful outer commit; do not introduce another floating touchProject path.
4. Use `eraWritingOperations(scope)` / `eraSnapshotOperations(scope)` and the existing document version APIs. Named-era replacements need the effective document token as well as updatedAt so an inherited ancestor change cannot be hidden by equal timestamps. The current protected replacement path may save a rejected candidate; plan-wide CAS preflight must run first and throw within the outer transaction, so rejection does not leave a partial import or false safety history. Do not implement fifteen-kind generic replacement here.
5. Extend the existing native HTML projection narrowly with comment boundary metadata + a typed comment manifest (or a dedicated projection action using the same exporter). Convert boundaries while building the imported rich blocks, then remove import-only markers before persistence. Do not reconstruct Word offsets with text search or treat inspect JSON as a second editor model. Reuse existing revision attributes and the normal schema; do not invent another review format.

### Comment policy

- Preserve source comment identity, author, raw date, parent and resolved state in optional import provenance; new local IDs remain unique. Replies use ordinary local threads. Existing annotations on replacement targets stay intact and are reanchored with the existing context resolver; unmatched anchors become recoverable orphans, never silently deleted.
- Convert only ranges with a proven mapping to an included chapter. Native UTF-8 byte offsets require explicit conversion to the exact imported text convention (notes/images/tables/revisions can change offsets).
- A range crossing a chapter boundary must be reported specifically. Minimal version anchors the thread to the start chapter with the represented portion and retains full source range in provenance; it must not claim an exact full range. Comments entirely in excluded chapters, unsupported stories or unmappable regions stay in the preserved source, with explicit counts and source access. Do not attach them to unrelated prose.
- Comment body can use the existing text-thread representation; rich formatting remains in the source document. Do not claim exact Word-thread interchange until an export adapter exists.

### Original file and persistence

There is **no suitable existing persistent source store** for this contract. `referenceDocuments` is a personal Judge library and intentionally omits originals from project backups; media accepts audio/video only; documentArchives is deleted-world-document recovery; worldEraAssets/history assets have specific reference/cleanup ownership. Using any of them as a generic DOCX attachment would violate their lifecycle.

Recommended minimal addition: one project-owned `manuscriptSources` table (new ordinary additive DB version), indexed by projectId/source hash, storing immutable original Blob and optional native review archive Blob plus format/name/hash. A source may be referenced by receipts from multiple eras without copying bytes. Exact raw original is mandatory; native writer.json is needed only for persisted native review edits, and is labelled separately. Initial import can recreate native state from the exact original without storing a duplicate archive. Store immutable commit receipts/mappings on the source row or a small owned receipt table if concurrent append/CAS proves clearer; do not put base64 manuscripts inside Project metadata.

Optional `Writing.manuscriptSource` receipt contains sourceId, commitId, source chapter/block span and imported content hash, scoped by the writing itself. Reimport creates a new source/version; never mutates old original bytes. Source removal must not break extant receipts; no automatic cleanup policy is introduced here.

Reuse the backup registry and existing Blob codecs/normal JSON/full/ZIP seams, not a parallel backup container. Project and full JSON encode bytes explicitly; ZIP stores raw binaries plus manifest; clone remaps source/commit/writing/era IDs but keeps byte hashes. Preflight validates source ownership/hash/receipt references before any import write. Project delete owns its sources. This requires root-owned DB/types/metadata/JSON/ZIP seams; it cannot honestly be delivered as a leaf-only UI change.

## Normal API / MCP proposal

Reuse current `wh_document_*` for native opening/inspection/review/render/archive. They currently operate sessions only; `wh_document_import` explicitly does **not** create persisted manuscript chapters. Existing `wh_create_writing` is a one-chapter Markdown path and is not the missing reviewed batch importer.

- `inspectManuscriptImport(input, splitOptions, scope)` -> typed projection/findings/plan. Query has no world writes; any temporary native session is private, closed on success/error/cancellation. No session handle is the durable source. Input bytes must be retained by the caller until Apply; changing them invalidates the plan.
- `applyManuscriptImport({sourceBytes, sourceName, scope, splitOptions, rows, expectedPlanDigest})` -> committed sourceId/commitId, created/replaced IDs and versions, imported/unmapped comment counts. Recompute/validate the exact plan from bytes before the transaction; user/MCP can neither smuggle HTML nor silently alter loss policy. This is a normal mutating tool, with engine-enabled/scope checks inherited from the existing product.
- `readManuscriptSource` / `exportManuscriptSource` query returns metadata or original/native bytes; `open...` creates a normal native session from preserved bytes for review. Download/Open source buttons call these same operations. Native review edits become a new explicit archive revision, not a silent overwrite of the original.
- Final names/schemas to root before shared registration. Keep read-only plan/source tools separate from mutating Apply/archive-save. No new permissions, server, runtime model or external adapter.

## UI and routes proposed — approval before code

Owned leafs/new: `src/engines/writings/manuscriptReview/{types,inspect,plan,persist,sourceStore,portability}.ts`; existing manuscriptImport/Docx/Persist and components ManuscriptImportModal/ManuscriptChapterList; small `WritingsView` prop seam (eraId + normal refresh); `components/editor/documents/DocumentTools.tsx` only findings/source affordance; new bridge leaf + tests.

Native seam: `native/apps/document-engine/src/lib.rs`, `native/crates/formats/src/html.rs` and associated tests for typed comments projection; existing review/model APIs remain authoritative. Source-store seam: root-owned `src/db/index.ts`, `src/types/index.ts`, Writings backup registration, JSON/full import/export, worldMetadata/clone and project deletion. Annotation optional provenance needs `annotations/types.ts` and portability validation; normal thread operations remain intact. No history middleware, Q05/Q16 drafts, Reader/Wiki or publication rendering edits planned.

Progressive UI: current file/split/chapters flow, with one concise findings summary and expandable concrete details; row target selector default New draft; stale target conflict retains plan. Original/source access remains next to affected findings. Normal revision controls remain the editor of accepted imports. Do not create another full document-editor window.

## Verification gate (not yet executed)

1. Synthetic OOXML fixture matrix: headings/style inheritance, lists/restarts, tables/merged cells, local raster/notes, insert/delete/paragraph changes with Unicode/foreign IDs; unsupported formatting/moves/nesting produce exact diagnostics and keep raw bytes.
2. Comment start/end/reply/resolved/foreign date plus astral/combining text, table cells, notes, excluded chapter, duplicate text and cross-chapter ranges. No accidental text-search anchoring; unmatched count equals retained-source-only comments.
3. Plan rename/exclude/split/create/explicit replace; content excerpts and source-chapter counts reflect actual persisted HTML. Plan digest rejects changed bytes/settings/actions.
4. Base + inherited/named/sibling era; target edited/deleted/moved during preview; project/ancestor changed after preview; all CAS conflicts leave all targets/history/source rows unchanged. Failure at second chapter/comment/source write rolls back the first.
5. Compatible imported revisions survive normal save/reopen/Undo and accept/reject; original/final projections differ as expected. No change in canonical/parallel-draft history behavior.
6. Original byte SHA equality after editor/app/native process closes, project/full JSON, ZIP and clone. Native reviewed archive opens offline separately; source deletion in original project does not remove cloned bytes. Invalid binary/receipt import is atomic.
7. Normal UI at1440/640 with corrected CSS-inline runner; actual file picker, findings, targets, Apply, conflict retry, source download and revision/thread controls. No runtime stubs for the delivery gate.
8. Native external stdio -> HTTP -> executor -> IPC -> real renderer/IDB for prepare/apply/source export and revision/comment operations; owned bundled native document executable. Existing documents/revisions/manuscript/annotations/era/backup critical regressions.

## Cost / boundary

Medium-to-large bounded feature, not a toolbar patch: (A) rich inspected plan and era/CAS batch, (B) source-store + portable codecs/root seams, (C) narrow native comment mapping + provenance, (D) UI/MCP/atomicity/roundtrip QA. A+B can ship first only if they explicitly report comments as retained in source, not imported threads. C closes compatible comment adoption. No universal Word fidelity, edit-all-object promises, DOCX tracked-format changes, source-to-Word comment reexport or native undo-history persistence is implied.

## Implemented closure (2026-10-20)

A+B+C+D implemented for the bounded compatible contract. Source table44 is additive after history43. Source metadata types/cloners are pure leafs; no renderer reader is pulled into Electron through persisted types. Exact originals have source receipts and the existing JSON/full/ZIP/clone/project-delete lifecycle. ZIP uses raw binary entries plus a manifest, preflight hash validation and the existing Writings backup strategy.

The normal importer now uses rich native projection, with explicit create/replace destinations and one atomic scoped write. Native comment boundaries use the existing bookmark exporter in a copy. Exact text/range normalization and unique boundary counts are required; unmatched/cross-chapter/excluded comments and deeper unsupported replies remain source-only. Direct replies and author/raw date/resolved provenance use ordinary local thread data. Compatible revision marks use the existing schema and normal controls. Native source pages/default layout remain in the original.

Additional approved seams: tools/revisions.ts + manifestRevisions.ts now use normal scoped Writings operations and effective-era CAS; NoteCard displays original author/raw date in ES/EN; published-edition clone remaps the optional manuscriptSource metadata only, preserving frozen HTML exactly. Root owns global registration and the transport96MiB adjustment; old32/64MiB manuscript limits remain. Browser-only simplified DOCX import is retained with concrete findings and source preservation.

Evidence (projectless work/worldcraft1041-manuscript-review-*.log): core6, edges5, UI2 at1440/640 (six inspected PNG), fallback1, real43→44 migration1; external stdio→HTTP→executor→IPC→renderer/IDB is part of core. Large transport1 sends62MiB binary/82.7MiB base64 to the real native parser, receives semantic invalid-ZIP error rather than413 and writes nothing. Native library21 PASS; document service14 PASS with the actual rebuilt binary; stable old regression groups55 PASS. Renderer/Electron typechecks, scoped ESLint and diff checks recorded in the delivery report.

Historical failures retained: the first ZIP test passed an export-download void result rather than an archive File (test construction); native keyboard title selection needed stable modal geometry/selection acknowledgement; mock-only old export test cannot replace a contextBridge-frozen API in the real preload runner (normal no-preload runner passes). The general document-history fixture now iterates16 kinds but lacks its new local-tool metadata fixture and crashes on `[undefined]`; this is reported to root/C and is not counted as PASS. A diagnostic read initially counted unused native styles and footnote separator objects: corrected to effective body-run/object findings in Rust, with negative default-style and positive actual smallCaps oracles. Initial false-positive screenshot states are superseded, not product claims.

Final implementation report and source hashes: work/worldcraft1041-docx-import-review-depth.md and work/worldcraft1041-docx-import-review-source-hashes.json. No Word application/corpus test, universal fidelity or VVD Word-review equivalence is claimed. No commits.

## Independent P2 literal-marker correction, 2026-10-20

Before changing code: the independent normal TXT inspect/plan oracle reproduces literal private-use text being removed by a global marker regex. Limit recognition to this inspected source’s exact escaped prefix and declared comment identities; use the same recognizer for inspect text/word counts and plan offsets/content. Preserve foreign or marker-looking authored text. Repeat the unchanged independent oracle plus compatible-comment/revision core and edge suites; retain the initial FAIL in the closure report.

Correction result: unchanged independent literal TXT oracle PASS, raw sentinel/code/footnote2 PASS, final core6/edges5 PASS. Both the pre-existing Markdown deletion and plan cross-source regex were corrected; original FAIL remains linked in the projectless closure report.

## Independent DOCX-1 / DOCX-2 correction plan (accepted by root)

Success before code: repeat the frozen image-only and zero-word-table native DOCX oracles without findings; persist admitted image/table HTML exactly, while title-only/blank chunks remain absent and intentional exclusion still works. Replace only the splitter’s word-count-as-empty assumption with a check for admitted nonverbal image/table content. Do not alter the inspector, source bytes, DB or D2 document-host semantics.

For revision visibility, add a dedicated `components/editor/revisionMarks.css` imported by the existing TiptapEditor (import-only seam coordinated with D2). Pending insertions use underline and pending deletions use strikethrough, with restrained backgrounds; neither operation relies on color alone. Keep original text/marks/selection and normal accept/reject/Undo intact. Repeat the unchanged independent appearance oracle with real CSS, core/edges and native UI1440/640, inspecting the same body screenshots. Preserve original FAIL logs and independent fixtures/hashes.

DOCX-1/2 result: three frozen oracles hash-identical, no findings; persistence2/core6/edges5/UI2 PASS with real native engine/CSS. Six newly inspected P2 screenshots preserve old screenshots unchanged. Scoped sources and logs recorded in work/worldcraft1041-docx-p2-correction-proof.json; no Reader/wiki/DB/D2 semantics touched.
