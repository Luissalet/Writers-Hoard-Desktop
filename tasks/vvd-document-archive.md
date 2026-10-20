# Recoverable local document archive

Evidence read 20 October 2026: VVD World Info https://vvd.crisp.help/en/article/world-info-gmmftq/ and Saving https://vvd.crisp.help/en/article/saving-1ceh8lh/ describe searchable deleted documents, restore and permanent deletion. Existing Hoard writings had temporary memory undo; the other core document deletes cascaded physically.

- [x] Inspect canonical delete/undo paths and agree bounded design with root.
- [x] Add v40 project-scoped archive records and mutation capture, preserving v39 media.
- [x] Wrap five core document deletion paths atomically with durable archive; retain cascade semantics.
- [x] Implement CAS restore/collision/reference guards and explicit permanent forget.
- [x] Add actual archive UI, project scoping/search and portable ZIP strategy.
- [x] Cover exact cascades, edited link conflicts, archive failure rollback, cross-scope references, undo reconciliation and ZIP.

Only changed fields of shared rows are retained, so archiving a linked card does not duplicate media Blob bytes or overwrite unrelated later edits. Primary-key collisions or changed affected fields refuse the whole restore. Project deletion removes its archive rows through the existing project-scoped sweep.

Completed scope: Codex/maps/boards/timelines/writings plus dictionary/table/relation tree/model/RPG/radar metadata documents (11 kinds). Existing root deletion entry points now archive; sub-items (individual pins, events, words, graph nodes) retain their existing deletion behavior. The archive shelf streams metadata only, retaining no archived manuscript/model bodies in its React list. Shared-row restoration checks only affected semantic fields and advances updatedAt; unrelated later edits survive.

Verified: eight focused browser groups; real v39 to v40 DB migration preserves Project/media bytes; archive creation/final consume injected failures roll back; all five core cascades and writing parallel versions/Undo; missing dependencies, changed links, foreign/occupied IDs refuse atomically; project metadata restores preserve later fields and sibling docs; model GLB bytes and formula expressions survive; poisoned nested ZIP rejected before replacement; real project ZIP restores recovery payload; actual UI archive/restore/confirmed permanent forget and project cleanup. Source ESLint and scoped diff whitespace checks pass. Full critical runner passed383 checks after repairing two planning fixture Router wrappers (tests5+6 also pass). Latest source tsc only caught root in-progress ReadingView unused imports/state, no archive/calendar/manuscript error. Conformance only in-progress character-sheets/radar static definitions; auditor notified.

Current compiled CSS screenshots inspected at1280 and720 with no overflow: C:\Users\luism\AppData\Local\Temp\wh-archive-Jt9mhX\archive-desktop.png and archive-narrow.png. ProjectWorkspace always-present Archive action is owned by map agent so recovery remains reachable without enabling the archive engine. Radar delete wrapper supplied by audit agent. No automatic expiry or background deletion.

