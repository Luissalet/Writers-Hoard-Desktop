# Reusable named Codex option lists — task1041/C11

## Source and actual gap

Verified20October2026 https://vvd.world/whats-new,6September2026, Select/number/date properties: colored multiselect options and saved option lists can be reused. Current typed multiselect and per-option colors already work; only named reusable lists are missing. Preserve those widgets and the normal template/property editor, without duplicating select controls or adding a service framework.

## Approved contract

Project.codexOptionLists is optional. Each CodexOptionList has id/name/options/optional optionColors/revision/createdAt/updatedAt. It is a shared project library, like Codex types, and is explicitly labelled shared across every era. All normal operations accept projectId+optional eraId, validate an explicitly named era and declare their shared scope. No active-era global, fake project IDs or new era overlay/default copying.

Save/delete use per-list CAS. Apply uses list revision and template revision in one relevant transaction and calls existing saveCodexTemplate. Applying copies presets and optionColors into one existing multiselect property; id/key/kind/formula/bindings/prose remain. The library is not an ongoing link, and editing/deleting it never migrates a property or card. Values already authored outside the copied list are retained; normal UI and native API warn with a useful preview/count, not a new permission flow.

PropertyDefinitionEditor gains a compact reusable-list section to save current options/colors under a name, select and apply a saved list, update/rename a saved list from current options deliberately, and delete a saved list. Applying inside an unsaved template updates its normal draft; the existing template Save commits it. Existing template conflict handling remains. Explicit copy/help explains detached semantics and retained values.

Pure leaf optionListTypes exports validator and portable key. Root owns Project type, worldMetadata remap(id only/revision0), normal JSON/full/ZIP validator/carrying seams; optional absence in legacy full restore preserves existing library where appropriate. No reference from a property to a saved list is persisted.

## Success before implementation

- [x] Save/list/rename/update/delete reusable lists with colors and stable list IDs; stale CAS leaves winning list unchanged.
- [x] Apply exact options/colors to another existing property; property identity/fn/prose survive, other properties untouched, selected card values never removed.
- [x] Library edits/deletion do not alter applied properties or cards; Base/two-era callers see the same explicitly shared library and invalid era rejects.
- [x] UI normal template editor can save current list, apply to another property, edit/delete named list, show retained-value warning and survive save errors without losing draft.
- [x] MCP list/save/delete/apply through normal shared operations, CAS and existing template service; actual stdio/HTTP/IPC route tested.
- [x] Project/full/legacy JSON, ZIP, clone preserve list content/colors and isolate/remap identities.
- [x] Actual CSS1440/640 native workflow captures; meaningful functional/UI/native tests and lint/type checks. No real data, production restart or model.

## Ownership

Own new Codex option-list leaves and PropertyDefinitionEditor/CodexTemplateManager. Calculations and history remain frozen. Root owns types/index.ts, worldMetadata/operations/zipBackup and global tool wiring. Use the current source and preserve root/A changes to display value/image exports.


## Evidence and frozen scope

Implemented with small engine leaves optionListTypes.ts/optionLists.ts, the existing PropertyDefinitionEditor/CodexTemplateManager plus OptionListControls.tsx. Root wired Project/validators/normal and full JSON/ZIP/clone and the four native tools from optionListBridge.ts + optionListBridgeManifest.ts. No calculation/history sources, global era defaults, separate reply/list engine, new services or ongoing property-to-list linkage.

- `electron scripts/run-focused-browser-tests.cjs tests/codex-option-lists.browser.ts testCodexOptionLists 250000`: PASS4groups. Save/list/update/delete across Base/two eras, invalid era/name/color/duplicate validation, list/template stale CAS, exact color copy, stable property identity/formula/prose, retained Base/own-era authored values and no later silent migration. Normal project clone remaps list ID/revision0 and preserves literals. Full JSON and project/full ZIP verify both missing legacy field preserves the existing catalog and explicit[] replaces it. Malformed project JSON rejects without changing the winning catalog.
- `electron scripts/run-codex-properties-ui.cjs tests/codex-option-lists-ui.browser.tsx testCodexOptionListsUi`: PASS3groups. Native mouse/keyboard in the normal template manager saves current colored options, copies into another property, shows retained-value warning and commits via normal Save template. Concurrent library write preserves winning list and rejected UI name draft. Rename/update/delete do not migrate applied property/card values. Actual CSS1440/640, no horizontal window overflow, two bounded visual rounds. Final captures saved at tasks/evidence/codex-option-lists-1440.png and codex-option-lists-640.png for general visual review.
- `electron tests/codex-option-lists-transport.cjs`: PASS real stdio→HTTP→executor→IPC→registered normal handlers→IndexedDB. All4tools, shared Base/era library response, null-creation revision schema, list+template CAS, retained-value report, list rename/update/delete and unchanged saved card/property values. Expected stale/invalid-era calls log their rejection.
- Existing testCodexPropertiesDepth:9groups PASS (typed fields, formulas/dependencies, sync, clone, MCP, card form, live tables, retirement).
- Scoped ESLint, Electron typecheck and conformance PASS (34engines/63tables/5650locale keys). Renderer check before final UI copy passed; final renderer check reports only concurrent root-owned undo.ts errors at99/100/101(undefined entry) and112(entityIds outside UndoResult). No C11 source errors reported; root informed, no edits to its WIP leaf.

MCP exports CODEX_OPTION_LIST_HANDLERS and CODEX_OPTION_LIST_TOOLS. Service list/save/delete/apply all validate optional explicit era yet declare shared-project scope; UI copies to the in-progress template and normal Save persists it. Applying a list deliberately replaces suggestion/color definitions only. Unlisted selections remain authored values and are reported; editing a list never changes already copied property definitions. Empty named lists are allowed as reusable empty suggestions. No production app/data/network model touched and no commits.

Transport fixture is minimal synthetic Codex project with the full real engine/manifest/dispatch initialization. The older reused world-authoring fixture recently gained sheet-ink font fetching and fails under older file:// harnesses; C11 does not exercise that unrelated fixture or stub any product functionality.
