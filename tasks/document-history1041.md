# Document edit history — task1041

## Verified gap and source

Primary source: https://vvd.world/whats-new,27February2026 (revision history while editing cards/maps/canvases/graphs, browse/restore from header, undo restore) and the August tool-history changelog section (every document in any tool). Current source does not contain a literal15August heading; use its actual text/date on final attribution. Daily/weekly/monthly snapshots are described upstream but are outside this delivery until actually implemented and tested.

Existing Writings snapshots cover manuscript prose and have their own UI; map versions cover deliberate map snapshots; documentArchive covers deletes; WorldEraVariants covers own variants. None proves edit history for every Base document. Preserve all four; do not relabel archive as history.

## Success before implementation

- [x] Native reusable history for all15 era-adapter document kinds, including metadata documents, Base edits and child-only edits.
- [x] Opening a Base/era pane, listing/previewing history or reading SDK/MCP data creates no saved version.
- [x] One preimage per logical aggregate per successful transaction; nested mutations never expose partial intermediate documents; rollback saves neither mutation nor history.
- [x] Binary bytes immutable/deduplicated with actual-content identity; no50MiB Blob copies per metadata edit. Voice recording checkpoints create no per-second history.
- [x] Restore validates project/kind/ID/children and CAS against current full aggregate; preserves IDs, retained writing snapshots and domain defaults. Displaced present remains recoverable and restore can be undone without erasing later edits.
- [x] Accessible normal Library/history UI, metadata-only version lists, selected-version preview and explicit restore/undo; native MCP list/get/save-version/restore/undo.
- [x] Clone, project JSON, full database and ZIP restore retain history and binary references, remapping semantic IDs consistently with Base/eras.
- [x] Prototype proves direct writes, domain transactions, nested transactions, rollback, Dexie.waitFor/Blob hashing and post-commit notifications before core integration.
- [x] Read-only transactions remain unchanged; only relevant rw transactions expand scope. SDK read/query/write/browser/native MCP regressions remain responsive.
- [ ] Full lint/typecheck and functional/UI/native tests; root arranges fresh independent review before integration.

## Proposed contract

Reuse15 document aggregate adapters and existing immutable asset table. Store history preimages separately from Base and world-era variants. A history entry describes project/kind/logicalID, timestamp, title, prior content hash, transaction grouping and an immutable aggregate/asset reference. A current-document read computes the CAS token from authored root/children; Writings immutable snapshot rows are retained separately and do not trigger capture or get rewound on restore. Lists return metadata only; a selected version hydrates bytes on demand.

Prototype a DBCore middleware boundary that intercepts only relevant rw mutations. Expand the native rw store scope to the required aggregate/history/assets tables, retaining the logical public transaction contract. Before the first semantic mutation of an existing aggregate in that transaction, capture its preimage in the same transaction; root creation marks the aggregate as new and does not capture partial construction. Later child/root writes in the same transaction reuse that capture. Ignore cache tables, timestamp-only writes, writing snapshot-only writes and provisional media recording checkpoints. Read-only operations do not expand or serialize with unrelated work.

Capture/import/clone/project-deletion suppression must be explicit and scoped to a transaction/operation, never a global active-era or database swap. Import validation happens before writes. Project deletion must clear all history/assets and not accidentally create orphan versions during cleanup. Restore writes the original source tables/metadata, preserving document identity and children, and captures the displaced current document as a normal new restore point. CAS and Undo reject a newer present instead of overwriting it.

## Coordination and risk

Root approved a bounded prototype before core edits. Root owns derived consumers/global MCP registrations and requests no new map-render/localSDK/Appearance/tree-UI edits. Agent B owns current worldMetadata/ZIP/localSDK changes: wait for his exact-path freeze before editing those files. Material risks are raw-IDB/Dexie transaction lifetime, recursion from history writes, binary hashing and relevant-rw serialization. Prove those with real isolated IndexedDB/Electron, including SDK native queries, before adoption. No production app/model or real project data is used.

## Status

Product implemented and frozen for independent review. DB43 is additive and migrates without reading/copying existing documents. Relevant rw mutations capture one prior logical aggregate in the same native transaction; new-root construction, timestamp/revision-only changes, Writings opening snapshots and provisional recording checkpoints do not create edit history. Source requests and binary asset/history writes run from an active native IDB request callback below Dexie cache/observability. The callback gate fixes implicit Collection.delete after asynchronous Blob hashing as well as explicit/nested operations; native keepalive alone was insufficient. Readonly and unrelated rw scope is unchanged. Histories share immutable era assets, including identical audio used inside another document. Post-commit history notifications never expose a closing transaction or rolled-back state.

Library now lists Conversation and Worldgen as well as the other13 document kinds, offers per-document history in Base and an explicit Shared-base history index (including removed documents). Preview renders authored prose/properties/owned elements, without IDs or binary envelopes. Named eras retain their existing own-version UI/tools. Codex history separately retains inherited property definitions as dependency metadata; restoring after type retirement keeps formulas live while its authored preimage and hash remain immutable. Shared-base restore is explicit, checks the actual current aggregate hash and retains the displaced present. A receipt can undo restore; a receipt with historyId:null undoes restoration of a previously missing document. A newer edit is never overwritten by that receipt. Identity collisions with another document/project are rejected atomically. Writings immutable recovery snapshots remain outside this rewind.

Five native tools registered by root: wh_document_history_list/get/save/restore/undo. List without kind/entityId discovers project histories; with both it returns metadata/current token. Get hydrates only the selected version using the established portable Blob envelope. JSON clone remaps semantic IDs/children/references/assets through the shared world-document remapper, retaining Conversation/Worldgen folder placements. Full JSON and full project ZIP carry history and shared assets. Pre-history full JSON imports preserve existing history assets even when replacing the older era-asset table. Import/clone/project-delete/ZIP suppression is transaction scoped; restore suppresses automatic duplication only for its own logical document.

No scheduled daily/weekly/monthly snapshots are implemented or claimed.

### Evidence in isolated synthetic profiles

- PASS `electron scripts/run-focused-browser-tests.cjs tests/document-history-prototype.browser.ts testDocumentHistoryPrototype 250000`: direct/nested child/root writes, relevant rw only, rollback, equal-size changed binary, caught partial bulk failure, child range deletion.
- PASS `electron tests/document-history.runner.cjs --functional`: all15 Base kinds capture/browse/CAS restore/Undo; no creation/read/timestamp history; rollback; metadata binary dedup; normal project JSON clone, full JSON, pre-history full JSON and full project ZIP; voice checkpoints.
- PASS `electron scripts/run-focused-browser-tests.cjs tests/document-history-large.browser.ts testDocumentHistoryLargeBinary 250000`:50MiB immutable audio shared across metadata edits and a nested map reference, bytes intact,71-character CAS token; stale Undo rejection; post-commit-only notifications; unrelated rw and Writings opening snapshot unaffected; first Blob capture through implicit Collection.delete; concurrent aggregate captures share one asset.
- PASS `electron tests/document-history.runner.cjs`: normal Library preview/restore/Undo/manual retention, external edit refresh and open/close lifecycle. Actual product Tailwind CSS1440×900 and640×900, inspected screenshots. Final screenshots: `C:/Users/luism/AppData/Local/Temp/wh-document-history-ui-w0Zu8w/history-desktop.png` and `history-narrow.png`. Two bounded visual rounds; the second replaced internal JSON preview with authored content/properties.
- PASS `electron scripts/run-focused-browser-tests.cjs tests/document-history-codex.browser.ts testDocumentHistoryCodexDependencies 250000`: type retirement followed by restoring a prior Base card retains live formulas21→35 and leaves the original preimage/hash unchanged.
- PASS `electron tests/document-history-transport.cjs`: actual stdio→HTTP→executor→IPC→registered handlers→IndexedDB, catalog/index, metadata-only list/get/manual retain, CAS restore/Undo, null restore of removed document, stale refusal and restoring inherited live formulas21→35 after native type retirement. No virtual-module external or blank runtime stubs.
- PASS `electron tests/local-tool-native.runner.cjs`: full SDK source enable/schema/UI/native state/CAS/query policy/failed-operation rollback; effective15-kind reads and formulas; WAV import followed by queries; normal Base/era writes and source JSON/ZIP. Final profile: `C:/Users/luism/AppData/Local/Temp/writer-sdk-native-C13qeT`.
- PASS existing `testWorldEras`7 groups and `testWorldEraAdapters`6 groups after the callback-gate fix, including normal clone/ZIP and own binary/history/defaults.
- Shipping lint PASS with0 exact baseline fingerprints; conformance PASS. Renderer and electron type checks PASS after root's NodeChange narrowing fix. Independent review is arranged by root.


### Independent-review correction (separate from comment-thread work)

Reviewer demonstrated P2: BoardNode.richContent HTML retained source-project Codex block pointers through JSON clone and history restore. Shared worldDocumentCloner now includes richContent in the same semantic rich-HTML remapping used for content/html/body. No comments changes were mixed into this correction. Own15-kind fixture now asserts cloned Board history markup targets the cloned project/card. Reviewer's frozen testIndependentHistoryRichContent is rerun unchanged; the cloner is frozen again after this surgical correction.


## Independent boot-registry check20October

Root extracted the immutable EraAdapter layout into worldEras/registry.ts after an adapters-before-db boot cycle. Reviewed source read-only: registry imports types only, all15layouts/owned children remain, capture obtains registry values from the pure leaf. No hash/middleware changes in this patch or this verification.

New independent fresh-renderer test tests/history-import-order.browser.ts:
- testHistoryAdaptersFirst: PASS.
- testHistoryDatabaseFirst: PASS.
Both dynamically import the requested first module before any DB import in their test bundle, then prove registry reexport identity,15kinds/child layout, Base prose and metadata preimages, deduplicated Blob history, and failed-transaction rollback.

Existing testDocumentHistory:4groups PASS (all15kinds, restore/Undo/CAS, nested rollback, readonly scope, dedup, clone/fullJSON/ZIP, voice checkpoints). testDocumentHistoryCodexDependencies PASS and independent richContent fixture PASS.

The frozen testIndependentHistory currently fails its final clone assertion because it chooses `rows.find(title==='roundtrip')` among two legitimate same-title preimages: before adding its pin(0children) and before editing root(1child). No review fixture/product source modified here. Independent testHistoryCloneChildStages PASS proves both stages survive normal JSON clone, with child IDs/owner/parent remapped in the stage containing the child. Root/reviewer informed to select a known source version/content instead of an ambiguous title. All prior steps in that frozen suite reached its final clone assertion, including12parallel rounds/rollback/era/Base restore/Undo.
