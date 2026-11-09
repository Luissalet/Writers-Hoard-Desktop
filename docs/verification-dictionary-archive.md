# Base dictionary archival through the bridge — task2327

`wh_dictionary_archive({projectId?,dictionaryId,expectedVersion})` archives one Shared base language through the normal `removeDictionary` operation. The complete language, words, identities, script mapping and settings remain in Document archive. The response names `scope: "base"`, the project, dictionary and exact `archiveId`. Read the current version using `wh_dictionary_get` or `wh_dictionary_search` first.

Restoration already exists: use `wh_archive_restore({projectId,ids:[archiveId]})` or the Archive UI. Undo of the archive call restores that same durable copy through the normal archive restore operation. It does not restore a Project snapshot or replace later sibling languages, project prose or manuscript content. An occupied language ID leaves both newer content and the archived copy intact. A consumed Undo receipt does not select a later archive of the same language.

This action targets Base. A supplied `eraId` is retained by normal argument coercion so the handler can refuse it with the existing era APIs explained, rather than silently treating it as Base. Use `wh_world_era_document_hide`, `wh_world_era_versions` and `wh_world_era_document_restore` for an era. The action adds no second era archive or restore API, permission, confirmation or operational service.

## Storage and receipt

Languages are embedded in `Project.dictionaries`, not separate Dexie rows. `wh_delete`'s row registry and generic row Undo are therefore not used. The handler resolves the normal project, reads the Base dictionary and compares its content version inside a transaction. It calls the existing removal/archive operation and identifies the single new archive by an ID-set difference inside that same transaction. It does not infer the copy from a timestamp or the newest archive after the transaction.

The audit entry records the owner, language identity and archive ID. Its Undo branch matches that receipt's project, source ID and kind, then delegates to `restoreArchivedDocument`. The existing restore validates dependencies and ID availability, restores only the metadata item and consumes the receipt after success. A failure creating the archive rolls back removal.

## Verification and attribution

The original `testDictionaryArchive` reached the public dispatcher after creating two languages with existing tools. The expected archive call failed with `unknown-tool`, and the test checked that Project and archive data stayed exact. The Source-before receipt pins the unchanged product and this actual failure. SourceGO was then recorded by Root before implementation.

The focused suite passes nine scenarios: public complete snapshot and sibling preservation; catalogue and existing project scoping; stale word version, wrong project and supplied era/null target without effects; archive-write failure rollback; Unicode words/override/senses and public list/restore/search; Base archival preserving existing era hide/restore; Undo preserving later work; consumed/wrong-owner/wrong-entity receipts; occupied ID retaining its copy and normal retry; and omitted project ID using the active project. Some related assertions are grouped in one reported scenario. All use a private focused renderer and the normal dispatcher, not genuine stdio transport.

The existing `testDocumentArchive` retains its eight prior scenarios and invokes the new suite, with17 reported passes. Its original assertions were not weakened. The Source-before test is retained separately, so extending the fixture does not rewrite the original RED. Expected injected failure and occupied-ID exceptions are logged, not suppressed.

Preparation failures remain separate: PowerShell treated an existing esbuild warning on stderr as `NativeCommandError`; the next Python wrapper wrote the functional failure and exit1 correctly, then failed printing that warning's Unicode triangle to a cp1252 console. A later corrected UTF-8 wrapper preserves those earlier files. The first post-change run also failed a real test expectation: it assumed unknown schema keys would be rejected, but the existing coercer drops them. Declaring `eraId` locally preserves the supplied target for the handler's explicit Base refusal. The global argument policy was not changed. Existing `import.meta` build warnings remain in the logs.

`verify:quick` completed with exit0 after the final runtime changes: renderer and Electron types, shipping lint and conformance (34 engines,64 engine tables,6723 locale keys). Babel's existing large-generated-file notices remain in the log. No general gate or unchanged product test was repeated merely for this documentation.

Evidence: `E:/Development/IA/Research/writer-parity-20261109/dictionary-archive2327`, including `PROPOSAL.md`, `CONSUMERS.md`, `BEFORE.json`, `before-test.ts`, `before-source-r1.log`, `SOURCE-GO.md`, `green-r1.log`, `green-r2.log`, `archive-r1.log`, `quick-r1.log` and the final cut/check receipts. Independent review and real bridge/Brave acceptance are attributed by their final receipts, not inferred from the focused runner. README, FAUSTUS, task-list and external continuity updates are coordinated after acceptance with the separate visual Dictionary work; they are not claimed complete by this source cut.

Root's prior real UI archive/restore in Base and an era is a baseline only. Acceptance of the new transport requires archiving through the real bridge, exporting that private library through normal project ZIP, importing it in Brave and restoring the same copy through normal UI. The intermediate ZIP is explicit; the hidden Native library and Brave are different private databases. No direct MCP-to-Brave connection is claimed. This increment does not establish full parity.
