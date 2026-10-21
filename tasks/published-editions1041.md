# Local published editions —1041 plan

Q19 frozen first; this plan precedes implementation. Reuse the normal manuscript/Reader pipeline and era operations. A published edition is an immutable local artifact, not a hosted site or an editable draft.

## Implemented contract

Leaf `src/services/publishedEditions/types.ts` exports `PublishedEdition`, `PublishedEditionChapter` and `PublishedEditionsProject`. Root adds `Project.publishedEditions?: PublishedEdition[]` and `Project.publishedEditionRevision?: number`. Editions are stored once on Project with explicit origin `eraId?:string` and era label; Base uses absent eraId. No DB migration/table or copied WorldEra project.

Each edition records id/title/publishedAt/locale/projectId, optional supersedesEditionId, source era identity/label, selected chapter snapshots in the requested order (normal Writing shape plus sourceUpdatedAt), frozen Reader presentation/project display metadata, source fingerprint and standalone Reader HTML/filename/content digest. Publication never replaces another edition. Existing HTML bytes remain unchanged after later edits or republishing. Source paragraphs remain ordinary rich HTML, not a second format.

Service surface:

- `listPublishedEditions(projectId, eraId?)`: list metadata, with origin explicit; UI may show all origins grouped. A separate selector controls chapter source scope.
- `getPublishedEdition(projectId, editionId)`: complete immutable artifact.
- `publishEdition({projectId, eraId?, chapterIds, title, locale, expectedRevision, supersedesEditionId?})`: build once using `buildReaderHtml` and effective project/presentation/normal chapter rows; append with edition CAS. Reject source changes during capture before persisting.
- `restorePublishedEdition({projectId, editionId, chapterIds?, targetEraId?, expectedRevision})`: create NEW draft Writing ids via normal eraWritingOperations in one transaction, preserving old drafts/edition; return new ids. No replacement/delete of source rows. Restored snapshots remain ordinary editable prose; frozen Reader HTML is separately available as the original publication. New drafts retain historical content's semantic local references, with clone remapping handled below.
- `validatePublishedEditionsProject(project:{publishedEditions?:unknown;publishedEditionRevision?:unknown})`: pure structural validation for JSON/ZIP integration. Root invokes on metadata read/write seams.
- `remapPublishedEditions(project, remap, remapContent, remapMedia?)`: remap semantic ids/project pointers in editable snapshots and origin era/supersedes ids. Do not text-replace prose or regenerate frozen HTML. Standalone artifact-local fragment ids inside frozen HTML may remain byte-identical: they resolve only inside that frozen file and never query the application DB.
- Own `PUBLISHED_EDITION_TOOLS/HANDLERS` leaf manifest/bridge exports for root registration: list/read (writes:false), publish/restore (writes:true). Generic read returns metadata by default, explicit includeHtml for artifact. Same functions serve UI and MCP.

## Verified consistency implementation

Capture raw sources using only explicit `tx.table` requests in a short real readonly IndexedDB transaction. Resolve normal era adapters/assets/calendar, hash actual Blob bytes and render the existing Reader after that transaction closes, using a typed captured-source provider with no live fallback. Commit recaptures sources in RW and compares fingerprint plus edition revision before appending. Hashing uses a Dexie continuation and waitFor; the final write stays bound to that transaction. Source races reject before storing an edition. The conservative fingerprint covers project Reader sources and necessary calendar ancestors; another source edit can require a retry.

The original live Reader-inside-R/waitFor design failed a genuinely queued independent-writer regression: ambient Dexie context escaped after hashing and later reads waited behind the writer while holding its parent R transaction. The replacement changes no DB/history middleware. The same queued-writer criterion now passes; the captured provider also renders successfully after `db.close()`.

## UI and QA criteria

- [x] Published editions button in existing WritingsView; own modal with normal ordered chapter checkboxes, title, source scope label and publish action. History lists timestamp/chapter/version/origin; open frozen Reader in an isolated readonly document and download exact HTML. Republish preselects previous chapter selection and creates another immutable edition.
- [x] Restore creates new draft ids; service/MCP supports chapter subsets, UI restores the opened edition; no existing text replaced. Works Base and named era; archived/missing originals do not prevent reading/restoring a publication.
- [x] Frozen Codex/formulas/colors, maps and local audio tested byte-identical after live sources disappear; other blocks inherit normal Reader projection limits; standalone reader opens offline without DB or bridge.
- [x] Native external stdio→HTTP→executor→IPC→renderer, CAS/races/failure rollback, cross-era/Base preservation; JSON/ZIP/clone preserve artifacts and semantic restore references. Imported malformed state rejected before partial restore.
- [x] Actual modal UI1440/640, native pointer/keyboard, source selection, publish/open/republish/restore, final screenshots inspected. HTML opened with offline profile and no DB, read-only artifact not live preview.
- [x] Appropriate writing/Reader/metadata regressions and tsc/lint. Durable report and freeze before root perimeter review. No LLM/hosting/global services, real profile or commit.

Root owns types.ts/worldMetadata.ts/zipBackup.ts shared seams and manifest/index wiring. Own new services/publishedEditions/** and modal; WritingsView only button/state/modal props. Root ceded optional captured-source seams in ReaderExport/tool preview, pure asset and calendar resolvers; the ordinary path remains unchanged. Q19/C11 remain frozen.

## Freeze verification

Native runner `tests/published-editions.runner.cjs` passes six groups including actual external stdio/HTTP/IPC publication and two-draft era Undo. A synthetic failure on the second hide rolls back the first; retrying the same audit entry hides both and preserves Base/artifact. UI native pointer/keyboard flows pass at1440/640. Existing Reader suite passes five groups. Renderer tsc, scoped source ESLint and scoped whitespace checks pass. Exact commands, artifact paths, inherited limits and retained failed experiment are in the durable Q17 report.

MCP restore uses `eraId` for its destination so the ordinary audit/Undo context carries the correct era; the service/UI input remains `targetEraId`. Root owns global type/metadata/manifest/Undo seams. No commits or integration here.
