# Writer publishing workspace

Writer retains its document editor, origin5174/IndexedDB and independent fiction worker. Library, reading, paperwork and publishing are four independently controlled native modules. Initial catalogue/status is cold; API/MCP/UI share the existing401 publishing tools and native IDs/formats. Real profiles/tokens/conversations are not migrated by source changes. Cicero remains separate; Borges belongs to Writer, not Hypatia. Home/Cook and People/Dorian remain separate.

931 CAS5: failed shutdown retains app/resources and worker; ON/new native requests are rejected until explicit Retry OFF succeeds. Four factories expose cleanup checkpoints; EOF retries only cleanup. Kafka owned client closure propagates failure without editing SDK; editorial sessions remain retained through complete joins. Native DOM stays mounted while an owner is retained.

Synthetic source and frozen-worker checks exercise all four factories. --worker-only reconstructs the frozen worker without Rust builds; native binary hashes are preserved. See docs/PUBLISHING.md and tasks/submission931-cas5.md for evidence and limits. Root owns independent review, CUA, real migration, aliases, installation/activation and publication. No installed app, personal data/model/Hub or original source repository was changed.


HTTPX closure: is_closed is not proof of released resources. The owned wrapper snapshots actual default/proxy transports and HTTPcore connections before a pool can consume its list, then checkpoints each physical close. Tests cover a real SDK twin poisoned by early HTTPX CLOSED, two failing OFFs, a held third close with consumer cancellation, and an actual HTTPcore/HTTP11 pool path. SDK files remain unchanged.

CAS6 corrects repeated completed physical cleanup: after success, a connection is removed by identity from its pool under the pool lock; failed connections stay owned. The final transport close does not invoke completed connection closes again. CAS5 remains historical; final package/test evidence is recorded separately in tasks/submission931-cas6.md.

## Local world-authoring tool context (2026-10-21)

Use [WORLD_AUTHORING](docs/WORLD_AUTHORING.md) for current capabilities and limits;
this extension preserves the native publishing factories and their lifecycle
above. UI and MCP reuse scoped product operations. Read the current project,
document and optional era before writing; omitting `eraId` means Shared base.
Do not infer a pane's scope from another open pane, guess revisions after a
conflict, or overwrite an author's unsaved draft to make a retry succeed.

Maps: read before writing. `wh_get_world_presentation` and
`wh_get_world_travel_settings` return revisions to pass as `expectedRevision`;
`wh_list_labels`, `wh_list_stamps` and `wh_list_map_versions` return the keys and
ids that `wh_update_label`, `wh_move_place`/`wh_rename_place`/`wh_remove_place`
and `wh_link_map_version` take. A painted label or stamp key is where it was
first placed (`label:x,y`, `stamp:x,y`, with `#n` for a second one in the same
cell), never its current position. The reader's-eye fog is separate from the
world: paint it with `wh_paint_reader_fog` (seen/heard/hide, optional chapter),
check what the reader knows with `wh_reader_view` before describing a place as
known, and render it with `wh_render_world_map` `readerView`/`readerChapter`.

For Library creation, read `wh_workspace_library_get`, then pass `folderId` and
`expectedLibraryRevision` to `wh_create_codex_entry`. An empty folder ID means
Unfiled; omitting placement options keeps ordinary card creation. A conflict
requires a fresh read and explicit review, not an unfiled fallback.

The `wh_writing_tool_dock_*` family reads/applies layout and block operations and
Undo/Redo with observed versions and receipts. Its owner is the real Project or
chapter; the dock is authoring metadata, not manuscript or exported reader prose.
`wh_project_duplicate_preview` returns the source version and asset findings.
`wh_project_duplicate` needs that version and a stable caller operation ID;
reuse it after interruption and inspect `complete`/`unfinished` rather than
creating another destination. `wh_project_duplicate_undo` preserves edited copies
and shared originals. It does not upgrade legacy JSON clone coverage.

Local source tools execute trusted built React code, not downloaded arbitrary
JavaScript. Recognition/search needs prepared cached models; text generation
uses the configured global runtime. Neither these tools nor this documentation
activates a module or model. The 21 October composed source checks pass: 210 groups across 44 suites with
0 failures, 383 critical checks, renderer/Electron builds, shipping lint with
0 debt and conformance (34 engines, 64 tables, 5650 keys, 22 locale files).
The production entry is 1589.09 kB, below the blocking 1600 kB budget; lazy/total
size advisories remain. Production dependency audit reports 0 vulnerabilities.
Native document-service tests pass 14 with 0 skipped; directory packaging,
packaged startup smoke and CPU dependency checks pass. D3, W01, the bounded 5e
profile, map M1/M2/M3 corrections, Archive and legacy-tool corrections have
independent SHIP verdicts within their reviewed contracts.

These are composed checks, not a global `verify:release` result. The inherited
full development audit still reports 13 findings, and the optional `resources/bin`
packaging warning remains. QA, manual and repository documentation are complete;
Git integration remains pending.
Installation, the real user profile and total feature parity are not certified.

Composed evidence: `D:/LocalAI/projectlesswork/worldcraft1041-vvd-suite-corrected-final.log`
and `worldcraft1041-critical-final-composed.log`; build, budget, packaging and
audit logs are alongside them. CPU checks load packaged dependencies without
model inference, model downloads or GPU activation.

The manual update used requiredRevisionId and exact content readback; see
`tasks/evidence/worldcraft1041-manual-verification.json` and the remaining limits
in [final verification](tasks/worldcraft1041-final-verification.md).
