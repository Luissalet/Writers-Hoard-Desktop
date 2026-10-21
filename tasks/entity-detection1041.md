# Local entity detection and mention preferences — task 1041

## Plan and success criteria

- [x] Read common criteria, Writer workflow and incumbent Operate surface.
- [x] Distinguish new-entity detection from existing-card name/alias matching.
- [x] Pin a multilingual CPU NER model, hashes, license and provenance.
- [x] Prove real Spanish, English and Unicode inference with network fetch blocked.
- [x] Verify WordPiece source alignment and complete token-budgeted long documents.
- [x] Add explicit preparation/progress/error/retry and lazy CPU worker lifetime.
- [x] Add three independent project preferences, shared across Base and all eras.
- [x] Keep manual links when auto mentions are disabled; animation respects reduced motion.
- [x] Show new candidates in normal editor prose and controls; type is editable.
- [x] Create cards explicitly through the shared product service, preserving prose and Base.
- [x] Reject source edits/navigation/cancellation and known/ambiguous names without duplicates.
- [x] Verify real native IPC, model, IndexedDB, Tiptap, keyboard and CSS at 1440/640.
- [x] Root bridge/MCP transport through the actual stdio, HTTP, executor, preload, IPC and CPU worker; audit Undo in Base and era.
- [x] Root project archive integration verification: explicit clear versus legacy absence, JSON/full JSON/ZIP and clone revision0; independent cross-scope and late-result checks.

## Design

Use the existing “References and document tools” group. A native disclosure
contains independent switches and a bounded result list. Transient dashed
underlines identify suggestions; name/alias links retain their existing dotted
underline. No generative model, inferred biography, prose replacement or undo
entry is introduced. Auto links are readonly annotations; their serialization
contract intentionally differs from a persisted semantic link.

## Verification

`node tests/entity-detection-native.cjs <isolated-prepared-model-directory>`
passes five real CPU inference cases with fetch throwing NETWORK_BLOCKED in
each worker: Spanish, English, Unicode, a long document beyond one model
window, and a fresh worker. `scripts/run-focused-browser-tests.cjs` passes
testEntityDetection (three groups), testEntityDetectionUi (one group), and the
two incumbent testInlineMentions groups. `scripts/run-entity-detection-ui.cjs`
passes three native integration/layout groups with real CPU inference and IPC.

Evidence and limitations are in
`.impeccable/review/entity-detection1041/EVIDENCE.md`. These scoped checks do
not establish universal model accuracy or whole-product parity.

Independent review reproduced a CJK boundary issue in source alignment. Using tokenizer basic-unit boundaries preserves Chinese names while still refusing partial Latin WordPieces. Original failing cases, repaired pure Unicode checks and five real offline CPU reruns are retained in the task evidence. Nine classifier operations also passed actual external stdio→HTTP→IPC→CPU transport, including Base/era candidate Undo. Packaged dependency resolution remains a root release check.
