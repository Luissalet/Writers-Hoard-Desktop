# Mixed project document library

- [x] Catalog existing project-owned Codex, writings, maps, boards, timelines, notes, local media and metadata tools without moving source records.
- [x] Add nested folders and document placements/order in optional Project metadata; CAS each action and validate cycles, missing parents and foreign/missing source documents.
- [x] Add always-present Library modal with search/type filters, folder tree, multi-selection moves, accessible ordering and explicit main/companion opening.
- [x] Remap only imported sources/folder references in JSON clones; preserve original IDs/metadata in ZIP backups.
- [x] Prove original source bytes unchanged by organization, concurrent-action rejection, project scope, ordering and JSON/ZIP roundtrips; inspect current CSS.

Scope: organizational references only. Folder changes never delete or rename the underlying documents. Disabled engines remain visible in the library and offer engine management. Ordering uses explicit accessible controls; drag-and-drop and saved workspace tabs are outside this change.

Catalog: Codex, writings, maps, boards, timelines, project notes, local media, dictionaries, tables, authored relation trees, character sheets, radar charts and local 3D models. Sources removed elsewhere appear as counted stale references with an explicit cleanup action. Results paginate in batches of 100 and display visible/total counts. Folder removal reparents immediate children and placements; original content is never deleted. JSON cloning drops placements for sources absent from that legacy format (notably notes); ZIP preserves full project identities and notes.

Validation: `testWorkspaceLibrary` passes five focused groups covering thirteen source classes, hierarchy/malformed imports, cycle/foreign/missing guards, actual concurrent CAS, unchanged canonical metadata/text/media bytes, actual JSON cloning and ZIP restore, real forms/search/moves/error recovery and integrated flush-guarded companion opening. `testProjectWorkspace` three regression groups and scoped ESLint pass. Renderer typecheck at completion reports only concurrent genealogy `relationTrees.ts:112` work, owned by the audit agent.

Current CSS verified with `scripts/run-workspace-library-qa.cjs` using real ProjectDetail, Sidebar, writing editor and nested library. Inspected `work/workspace-library-{desktop,narrow,folder,companion}.png` and `work/project-ambience-{desktop,narrow}.png` at 1440/720. Trusted opening preserves the primary editor and existing local ambient player; native WAV metadata loads without autoplay. Corresponding screenshots copied to `.impeccable/review/`.
