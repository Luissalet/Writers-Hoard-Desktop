# Local tool source SDK

Writer’s Hoard can compile trusted React tools into the desktop app. This is a source-extension workflow for developers who can review TypeScript and rebuild the app. It is **not** VVD Workshop compatibility, an app store, a binary plugin loader, or a sandbox for downloaded code. No account, server or network API is required.

The client exposes scoped JSON storage, effective world documents, local media, search, contextual navigation and the product's normal tool operations. React source itself runs with application-code trust: inspect it and its dependencies as carefully as any other source change. These helpers are not a JavaScript sandbox. No downloaded HTML, runtime `eval`, iframe or remote import is part of this SDK.

## Create and run a tool

From the repository, with the normal Node dependencies already installed:

```sh
node scripts/create-local-tool.mjs --id me.world-notes --name "World notes"
npm run typecheck:renderer
npm run dev
```

The CLI creates `src/engines/local/installed/me.world-notes/module.tsx` plus a README and a runnable `module.test.ts` author fixture. It refuses existing destinations, traversal and symlink installation paths. The module is a working local notebook: save notes, reload the saved version, and query only the current project’s Codex. The same verified scaffold is the runnable example; its template is `scripts/templates/local-tool.tsx.txt`.

Only `installed/*/module.tsx` modules explicitly present in the source tree enter Vite’s eager build glob. The installed directory ships empty. Scaffolding and registration do not enable a tool in any project: after recompiling/restarting, open the project’s engine manager and enable its translated name manually. Desktop packaging uses the normal `npm run build:desktop` workflow and required platform dependencies. A rebuilt app must pass its normal gates. Installing/removing source is a developer action; project backups never install code.

## Typed local API

Import `defineLocalTool`, `LocalToolProps`, `LocalToolJson` and `LocalToolSnapshot` from `@/engines/local/sdk`. Export one default definition with a lowercase developer namespace such as `me.world-notes`, English/Spanish name and description, safe JSON initial state, synchronous type guard, and React component. The engine ID is `local-tool-me.world-notes`; the namespace is also its storage key. Duplicate namespaces and builtin engine collisions are refused before any registry mutations.

The component receives a stable, frozen client for its project, namespace and the pane's optional `eraId`:

```ts
const snapshot = await client.read(); // missing state returns initial data, revision null
const next = await client.save({version: 1, notes: 'A local idea'}, snapshot.revision);
const cards = await client.queryCodex({query: 'harbor', type: 'location', limit: 20});
```

Saving is one Dexie transaction: it compares the expected namespace revision and merges only that namespace into the latest Project row. First creation requires `null`; existing or cloned records require their returned revision, including zero. An era inherits Base until that namespace is saved in the era; the first override compares the inherited revision. Only that namespace is stored in `WorldEra.localToolStates`, preserving Base, siblings, appearance and other metadata. Snapshots include `provenance: 'base' | 'variant'`. A conflict, validation/storage failure, missing project or budget failure rejects without clearing existing state. Read values are detached copies. Do not retry with a guessed revision or discard a user draft automatically. The example retains failed-save text and offers an explicit “Discard own draft and reload saved” action. It requires explicit Save before leaving; production tools with buffered edits should integrate the app’s `registerPendingFlusher`, close guards and recovery journals, with failure UI appropriate to their editor.

`queryCodex` uses the current project and era, including formula results. Foreign IDs in `ids` return no foreign cards. Limits: 1–50 cards (default20), query200 characters, up to100 requested IDs. These bounded projections contain ID, title, category, at most20 tags and24 short text fields; large fields are truncated and marked. Render values as React text; never inject them into HTML.

`world.list(kind)` and `world.read(kind,id)` expose the real document aggregate and its CAS `version` for all16 kinds: dialog-scene, codex, writings, maps, worldgen, board, timeline, notes, dictionary, tables, genealogy, character-sheets, radar, model-viewer, media and local-tool. Codex reads additionally return `projection.fields` with current formulas; the raw document stays suitable for editing. Media/model documents can contain local Blobs: keep bytes out of JSON operation results and tool state.

In a named era, `world.variants.save(kind,document,version)` and `.hide(kind,id,version)` reuse the normal era document operations. **`variants` is absent in Base.** Base authoring uses `client.callTool(name,args)` and existing product schemas/handlers, discovered through `client.tools()`. For example, `await client.callTool('wh_update_codex_entry',{id:cardId,title:'Harbor'})`. Project ownership, enabled engines, domain validation and normal archive behavior remain the product's responsibility. The client supplies the current project/era rather than allowing caller arguments to change context. In an era, a writing tool without era support is refused rather than silently writing Base; enabling an engine is project-wide.

`media.list()` reads effective local assets and `media.import(file)` uses the normal scoped import. `search(query,limit?)` uses project content search. `openDocument(kind,id)` checks existence and uses the built-in anchor/world navigation adapter with the pane's era. None of these local flows requires a server. Normal tools that themselves use online capabilities retain their own requirements; `callTool` does not turn those capabilities into offline tools.

## Named operations and native MCP

A definition can optionally include operations. Each has a stable lowercase `id`, bilingual `description`, `writes`, an object `inputSchema` and async `run(input,client)` returning JSON. Existing definitions without operations work unchanged:

```ts
operations: [{
  id: 'append', description: {en: 'Append a note.', es: 'Añadir una nota.'}, writes: true,
  inputSchema: {type: 'object', properties: {
    text: {type: 'string', minLength: 1}, revision: {type: ['integer', 'null'], minimum: 0},
  }, required: ['text', 'revision'], additionalProperties: false},
  run: async (input, client) => {
    const before = await client.read();
    const next = await client.save({version: 1, notes: before.data.notes + String(input.text)}, input.revision as number | null);
    return {revision: next.revision, notes: next.data.notes};
  },
}]
```

Schemas are returned in full by `wh_local_tool_describe`. The supported validation vocabulary is types (including nullable unions/integer), nested object properties/required/additionalProperties, arrays/items/uniqueItems/minItems/maxItems, enum/const, number bounds, Unicode string lengths/pattern, and anyOf/oneOf/allOf. Descriptive title/description/default/examples/readOnly/writeOnly/deprecated/$schema annotations are accepted. Unsupported assertion keywords, including `$ref` and `format`, are refused when registering a definition. This is the product's explicit schema vocabulary, not a complete JSON Schema implementation.

The ordinary native MCP transport exposes sixteen static tools: `wh_local_tool_list`, `wh_local_tool_describe`, `wh_local_tool_read`, `wh_local_tool_save`, `wh_local_tool_query`, `wh_local_tool_call`, `wh_local_tool_pin`, `wh_local_tool_state_apply`, `wh_local_tool_state_undo`, `wh_local_tool_state_redo` `wh_local_tool_reference_resolve`, `wh_local_tool_document_list`, `wh_local_tool_document_query`, `wh_local_tool_document_create`, `wh_local_tool_document_rename` and `wh_local_tool_document_archive`. Read/save/query/call accept `projectId`, `namespace` and optional `eraId`; operations additionally take `operation` and object `input`. Save takes `data` and nullable `expectedRevision`. `wh_enable_engine` accepts an actually registered `local-tool-*` engine; an invented ID is rejected. The default installation contains no source tools.

Use query for `writes:false`, call for `writes:true`. Queries receive a read-only client: namespace save, variant writes, media import and writing `callTool` invocations reject. Calls require the existing native writes switch and an enabled source engine. Writing operations run in one database transaction; an exception or invalid JSON return rolls back database edits. Keep them to local database work and await every edit. Network/filesystem effects, navigation and arbitrary trusted source code cannot be rolled back by this transaction. Input schema validation happens before running the operation. Operation implementations remain renderer-side; Electron's generic manifest is pure data and never imports React or source functions.

## Distribute and select local source releases

The scaffold includes `local-tool.source.json`. Keep its `files` array explicit: include your own `module.tsx`, imported local sources and assets. Do not include the app, dependencies or project data. For example:

```json
{"namespace":"me.world-notes","version":"1.0.0","files":["module.tsx"]}
```

Run the normal source-package CLI:

```sh
node scripts/local-tool-packages.mjs pack --source src/engines/local/installed/me.world-notes --output world-notes.source.json
node scripts/local-tool-packages.mjs check --package world-notes.source.json
node scripts/local-tool-packages.mjs install --package world-notes.source.json
npm run typecheck:renderer
npm run build:desktop
```

`install` also accepts `--root APP_SOURCE_DIRECTORY` for another application source checkout. It writes only an immutable `src/engines/local/installed/<namespace>/versions/<contentHash>/` release directory. The manifest records the API/format version, human release label, SHA256 file hashes and byte lengths. Content identity is deterministic; identical input produces the same hash. Check/install reject changed bytes, unsafe/duplicate paths and unexpected files, and never overwrite a different existing release. The Vite build verifies installed releases before compiling them. Checking a package validates its bytes and paths, not the correctness of arbitrary TypeScript: run the author test and normal build too.

New source requires rebuilding and reopening the application. Installation alone does not execute it, enable an engine, select a project version or change authored data. All compiled release modules are eagerly imported as trusted application source; a project pin selects the rendered component and operation implementation, not a sandbox for top-level source effects. These are source packages, not runtime binary plugins or VVD-compatible packages.

Open **Engine Manager → Local tool versions**, choose a compiled version, and press **Apply version**. This applies immediately and separately from the manager's engine-order Save Changes. Each project keeps its own hash pin, shared across its eras; Base/era state stays separately scoped. UI and native operations resolve exactly the same pin. Installing another release does not update existing pins. Missing pinned code is reported as unavailable; no latest-version fallback runs. An unpinned tool uses its legacy development module only when that module exists; a packaged-only tool requires a selection.

Native discovery uses `wh_local_tool_list({projectId})` to expose compiled release manifests, development availability, pin revision and status. `wh_local_tool_describe({namespace,projectId})` describes the selected implementation; `{namespace,contentHash}` inspects an exact compiled candidate without selecting it. Apply or deliberately roll back with:

```json
{"projectId":"project-id","namespace":"me.world-notes","contentHash":"<64 lowercase SHA256 characters>","expectedRevision":null}
```

Pass this to `wh_local_tool_pin`. `expectedRevision:null` is valid only before any pin record exists. Later writes use the returned pin revision. Setting `contentHash:null` returns to a compiled development module and retains a monotonic revision tombstone, so clearing/reselecting cannot accept an old request. A conflicting selection retains the user's candidate; **Reload saved** explicitly adopts the current revision before another attempt. An already mounted source client cannot save after its selected release changes.

Before a selection commits, the target state validator checks every stored Base and own-era payload for that namespace. An incompatible release is refused with the old pin and all authored data retained. State version migration is an explicit author operation, never a reset performed by the selector. Selecting an older compatible compiled hash is the rollback path. Pin changes do not enable engines. A failed outer database operation rolls back the pin as well.

Project/full JSON and ZIP carry pin metadata and authored state, not source packages. Legacy imports without pin metadata retain existing metadata when replacing a project; an explicit empty object replaces the collection. A clone preserves hashes and null tombstones and resets their revisions to zero. Importing a backup never installs or executes source code: the destination build must contain the selected release.

## Declared state identities and scoped Undo

Existing state remains opaque safe JSON. A source can opt in to a portable `codec` on its definition:

```ts
codec: {version: 1, fields: {
  notes: {kind: 'prose'},
  title: {kind: 'scalar'},
  labels: {kind: 'map'},
  linked: {kind: 'reference'},
  bookmarks: {kind: 'map', referenceValues: true},
  items: {kind: 'list', idKey: 'id', referenceKey: 'document'},
}}
```

Initialize map/list fields as objects/arrays in your state. A reference is `{kind,documentId}` using a normal world document kind; nullable references are allowed. The list's `idKey` identifies an item independently of its position. Optional `referenceKey` declares a reference inside each item; map `referenceValues:true` declares reference values. Other item text, scalar JSON and prose are opaque. Definitions with no codec keep the original `save(data,revision)` API and have no `client.state` actions.

The initial state, every read and every write still use the author validator. A successful explicit save of a codec source also stores its descriptor in `Project.localToolContracts`, after validating all stored Base/own-era payloads for that namespace. Opening a tool does not create a descriptor or copy state. Once a descriptor is stored, a source without a codec cannot save a payload that breaks its declared identities. Codecs travel without source in project/full JSON and ZIP; cloning remaps only declared document references in Base/era payloads. Stable local list IDs and opaque strings remain byte-identical. Legacy imports with no descriptors preserve an existing collection; an explicit empty object replaces it.

```ts
const observed = await client.read();
const change = await client.state!.apply(observed, [
  {type: 'set', field: 'notes', value: 'Authored text'},
  {type: 'map-set', field: 'labels', key: 'status', value: 'draft'},
  {type: 'list-insert', field: 'items', item: {id: 'stable-id', text: 'First'}, afterId: null},
]);
const undone = await client.state!.undo(change.receiptId!);
await client.state!.redo(undone.receiptId!);
```

`set`/`unset` change scalar, prose or reference fields. `map-set`/`map-delete` change one key. `list-insert` supplies an item and stable `afterId` (null means beginning); `list-update` replaces one item with the same ID; `list-delete` removes it; `list-move` supplies its ID and destination `afterId`. Deleted anchors, duplicate IDs, invalid shape and unknown fields refuse. Item updates compare the whole item. Order conflicts refuse rather than guessing how a later move should be discarded.

Apply reads the latest namespace inside the normal Project write transaction and compares touched identities against the supplied snapshot. Disjoint fields/map keys/list items combine even if the namespace revision advanced. A conflicting identity leaves the caller's draft and saved data intact. Whole `save` retains exact namespace CAS. **Prose uses scalar CAS; there is no character-level CRDT, presence or arbitrary rich-text patch merge.**

Successful actions return a session receipt. Undo/Redo use the same identity merge, preserving later disjoint edits and refusing overlapping ones. Receipts are bound to project, era, namespace, codec and selected release; each successful direction consumes one receipt and returns a fresh opposite receipt. A receipt from an aborted outer operation does not become available; an aborted Undo can retry its original receipt. They do not reverse arbitrary `callTool`, media imports, network/filesystem effects or a whole Project. There is no additional durable history or generic global Undo promise. A no-op returns a null receipt.

`useLocalToolState(client)` in `@/engines/local/useLocalToolState` provides loaded snapshot, busy/error, apply/reload and Undo/Redo stacks. The normal example `@/engines/local/examples/linkedNotebookDefinition` combines the hook, editable notes, stable items and document picker; it is not installed/enabled by default. Its failed save retains the local text and offers explicit discard/reload. Authors with buffered edits should still use the product's existing pending-write/recovery lifecycle as appropriate.

Native methods use the same source/pin and engine checks: `wh_local_tool_state_apply({projectId,eraId?,namespace,baseline,actions})`, `wh_local_tool_state_undo/redo({...,receiptId})`. Describe includes the codec. Read-only operation clients reject actions and Undo/Redo just as they reject save.

## Local references and document drops

`client.refs.resolve({kind,documentId})` reads current effective title/provenance and availability; a removed document returns `available:false`. `client.refs.open(reference)` uses normal pane navigation with the current era. `wh_local_tool_reference_resolve` exposes the same metadata path. Stored labels are never the reference identity.

The normal Library document icon emits `application/x-writers-hoard-document+json`. `writeLocalToolDocumentDrag` and `decodeLocalToolDocumentDrag` from `@/engines/local/references` provide the same strictly checked payload for source tools. It includes source project/era; `client.refs.acceptDrag(text)` refuses foreign projects and resolves against the destination era, so dropping a Base reference in an era reads that era's variant. Missing documents remain unavailable. A source can use `useLocalToolReferenceDrop` for normal React drag events and `LocalToolReferencePicker` for the equivalent native keyboard selection/Open flow. The picker refreshes effective metadata after ordinary product data-change events. HTML5 local document transfer is the supported drag channel; this does not claim a global touch/pointer morph system, arbitrary extension document embeds or a generic document host.

The memory author kit shares codec validation, three-way merge, scoped reference resolution and commit/abort receipt behavior with production. Its explicit fixture/index/domain limitations still apply; it does not simulate every production history/asset adapter.

## Author test kit (no app or database boot)

New scaffolds include `module.test.ts`. Run the ordinary author test from the repository:

```sh
node scripts/test-local-tool.mjs --id me.world-notes
```

The command compiles the selected trusted source test and awaits its exported `testLocalToolScaffold()` function. A rejected assertion exits unsuccessfully. It does not register/enable a tool or write project data. The generated test uses the same public kit you can import into your own runner:

```ts
import {createFakeLocalToolHost} from '@/engines/local/testing';
import tool from './module';

const host = createFakeLocalToolHost(tool, {
  projects: [{id: 'test-world', updatedAt: 1, worldEras: [{id: 'past'}]}],
});
const client = host.createClient({projectId: 'test-world'});
const saved = await client.save(tool.initialState, null);
const past = host.createClient({projectId: 'test-world', eraId: 'past'});
// This reads the same Base state until the first own-era save.
const inherited = await past.read();
```

Render the real `tool.component` with `{projectId, client}`; no provider or application registry is required. The kit imports no IndexedDB, application boot, native bridge or network code. Normal tools still run with application trust; the kit is an injected test host, not a sandbox for arbitrary source code.

`host.runOperation(scope,id,input,writes)` uses the same exported operation runner as `wh_local_tool_query/call`: identical input schema checks, JSON result validation and read/write route checks. State validation/CAS and Codex field/formula projection are pure helpers shared with the production client. Writing memory operations commit atomically; a throw or invalid result discards state/variant changes. Concurrent writes serialize, while outside reads see the last committed snapshot and do not wait behind an in-progress writer. Queries receive a read-only client. `host.inspect()` returns detached project/document fixtures; `host.commands` records requested navigation, searches, configured tool calls and media imports for assertions, including requests from operations that later fail.

Optional fixtures supply:

- `documents`: real aggregate `{projectId, eraId?, kind, id, document?, hidden?, version?, revision?}` records. Named-era records overlay Base; tombstones hide only that era. `world.list/read` return detached aggregates, and Codex reads evaluate the real shared projector. Version strings are opaque **fixture-only CAS tokens**, not production hashes. Variant edits test identity, ownership and CAS against these fixtures; the memory host does not replace each engine's full domain validation or production history/assets pipeline.
- `index`: explicit content-index rows with scope, title/snippet/text and optional tags/type/status/day. Searches apply Writer's actual accent folding, query grammar, facets and exclusions in fixture order. These are authored index snapshots, not the production database crawler/ranking or automatic reindexing after every arbitrary document mutation.
- `media`: explicit scoped assets containing real Blobs. Listing preserves those bytes; the kit does not generate a pretend audio/image result.

`overrides.tools` is an explicit list of `{tool, run(args,client)}` handlers and full input schemas. It supplies the fake tool catalog; missing tools fail by name. Calls pin project/era to the client's scope, validate input and pass a transaction-bound client to the author handler. Writing calls are refused on read-only clients. Optional `navigate`, `search` and `importMedia` callbacks let an author record or implement those capabilities deliberately. Importing media without a supplied handler fails; a callback's external effects cannot be rolled back. No default domain-write handler fabricates success.

This kit covers the scoped client, declarative state actions/Undo and explicit source-document fixtures. It does not compile release pins or replace production archive/history/assets/domain validation, and provides no CRDT rich-text merge or online collaboration. The normal native tools remain the integration route; no fake host is installed into user projects.

## State, backup and lifecycle contract

`Project.localToolStates[namespace]` and optional era overrides store `{revision, updatedAt, data}`. JSON values only: reject functions, undefined, BigInt, Blob/Date/class instances, accessors, sparse arrays, symbols, cycles, nonfinite numbers, prototype-sensitive keys and nesting deeper than32. Each serialized record is at most2MiB, all stored Base and era tool state in a project at most20MiB, up to128 namespaces per collection. Inherited state is not copied or counted again. Validation also bounds JSON nodes. Budgets measure UTF-8 JSON bytes; do not store model/image/audio files here. Operation inputs/results are JSON under the normal transport limit, not the2MiB state budget.

The SDK does not invent a schema for opaque `data`; the synchronous type guard validates every read/save. Version your own payload (the example uses `version:1`). For migrations, accept old and new payloads in a transitional guard, transform explicitly, then save with the observed revision. Rejected old payloads remain stored rather than being silently reset.

ZIP export/restore carries tool state even if its source module is absent and validates it before replacing data. Legacy JSON project cloning copies safe opaque data with revision zero under the same namespace. **Strings that resemble entity IDs are not automatically remapped.** Opt-in codec reference fields are remapped; prose and untyped opaque state remain exact. A tool must tolerate missing references; all subsequent SDK queries remain inside the new project. Store ordinary authored data where possible, and reselect entity references deliberately. Project deletion removes its tool state with the Project row. Disabling or uninstalling a source module retains state so reinstating the reviewed module recovers it. Legacy namespace state has no separate deletion journal. Documental source definitions use the normal Archive and History described below.

Extension engines use the ordinary engine manager and metadata backup path, with no new database table. The six generic MCP methods do not install code or create dynamic native tool names. Missing source definitions leave stored state intact.

## Verification

```sh
node scripts/test-local-tool-cli.mjs
node tests/local-tool-author-scaffold.mjs
node tests/local-tool-author-kit.node.cjs
npx electron tests/local-tool-author-transport.cjs
npx electron scripts/run-local-tool-build-test.cjs
npx electron tests/local-tool-native.runner.cjs
npx electron scripts/run-focused-browser-tests.cjs tests/local-tool-sdk.browser.tsx testLocalToolSdk 250000
node scripts/check-conformance.mjs
```

The tests use synthetic local source code and isolated data. They do not activate a tool in a user project, download code or modify accounts.


## Independent source documents (D1)

Opt in with `document: {defaultTitle: {en: 'Untitled notebook', es: 'Cuaderno sin título'}}` in a source definition. The real example is `src/engines/local/examples/documentNotebookDefinition.ts`. Once compiled/enabled, its normal engine lists, creates, opens, renames and archives separate documents. No legacy namespace state is copied or migrated. “Project state (legacy)” retains the previous route. Each document has a real stable ID, namespace, title, JSON data, optional codec, revision/timestamps and a portable generation token; it lives in `Project.sourceToolDocuments`. Named eras use the existing per-document overlay and zero-copy inheritance. Source code/packages never enter project backups.

The bound component receives `client.documentId`; `client.read()` returns the same ID/title plus opaque `document.version` and `document.lineage`. Missing/archived documents fail read/save rather than being recreated. Whole-document writes compare both values read:

```ts
const before = await client.read();
await client.save(nextData, before.revision, before.document?.version);
```

For an independent document the third argument is required. Existing namespace clients preserve their two-argument save. Declared state actions use this token internally and merge disjoint fields/map keys/stable items. They also compare document lineage: normal era reinherit/hide/version restore and normal Base History/Archive restore invalidate old actions/Undo receipts even if restored bytes match. Receipts remain session scoped and one-use; they do not undo arbitrary side effects. Scalar prose still has CAS, not CRDT.

Native read/save/query/call/state/ref tools accept optional `documentId`. `wh_local_tool_document_list` returns effective portable records even when that namespace's source is absent. `create` requires a selected compiled documental definition and enabled engine. `rename`/`archive` take `documentId`, `expectedRevision` and `expectedVersion` from `read().document.version`; they preserve data and sibling instances. `wh_local_tool_save` takes `expectedDocumentVersion` whenever documentId is present. UI and native calls use the same writer. Pins validate current Base, retained own-era roots/history (including hidden/reinherited variants), normal Base History/Archive documents and legacy namespace states; an incompatible or non-documental release refuses without changing data.

Library, title/declared scalar/prose search, references, metadata JSON/full/ZIP, clone, normal History and Archive use these same IDs. Clone remaps only codec-declared references and generation, resetting document revision to0; stable local list IDs and opaque prose remain unchanged. Opening/listing does not write. History offers a readonly field preview without executing source code. A missing module keeps data portable and inspectable. The source example flushes pending notes before document navigation and refuses navigation on an overlapping remote edit or an unsubmitted item; the draft remains visible.

D1 was the independent-document milestone. D2 below adds editable embeds/fullscreen, owned/world blocks and portable source previews. The manuscript dock remains D3. These host capabilities do not claim CRDT, remote runtime or Workshop API compatibility.

D1 checks: `npx electron tests/local-tool-documents.transport.cjs`, `npx electron scripts/run-codex-properties-ui.cjs tests/local-tool-documents.browser.tsx testSourceToolDocuments`, and the same runner with `tests/local-tool-documents.ui.browser.tsx testSourceToolDocumentsUi`. The latter exercises actual product CSS and native input at1440/640 in an isolated profile. Headless fixtures can set `projects[].sourceToolDocuments` and call `host.createClient(scope, readOnly, documentId)` / `host.runOperation(scope,id,input,writes,documentId)`; source CRUD/history semantics are verified against the real application, not fabricated in the memory kit.


## Document hosts and inline blocks (D2)

`document.embed: 'interactive'` explicitly opts a compiled source into the embedded editor; the default is a readonly preview. The component receives `LocalToolProps.context`, which reports `view: 'editor' | 'embed' | 'fullscreen'`, `canEdit` and the actual document identity. All three views bind to the same `documentId` and normal scoped client. Pristine peer views observe committed writes; a local draft is retained until Save or explicit Discard. Changing project, era, document, release or owner ends the old host lifetime. Delayed callbacks refuse after that boundary. Fullscreen and return to preview flush pending state and retain the editor if Save fails.

A safe declarative `preview` describes labels/fields and is persisted with new source documents. `sourceDocumentPreview` and `localToolBlockPreview` render escaped semantic data without executing a source module. A missing module still yields saved data, including readonly JSON fallback for older records. Reader, wiki and PNG use the same pure preview; captured publications supply their captured documents and never fall back to a live database. The source document is the sixteenth normal PNG kind. Source packages/code never enter JSON/ZIP.

The real compiled example is `src/engines/local/examples/initiativeDefinition.ts`: independent encounter documents, an interactive owned initiative block and a world card list. It remains opt-in. A definition's `blocks` entries use `defineLocalToolBlock` with a stable key, localized name, codec/state for `scope: 'host'`, or declarative `world: {kind, fields}` for `scope: 'world'`. Normal Tiptap insertion offers these registered declarations. An owned block stores its envelope inside its Codex/Writing owner's HTML; it creates neither an independent document nor namespace state. World blocks have no own payload and read the effective world. The client binds actions/Undo/Redo to that atom and cannot mutate an unrelated owner after retargeting. Scalar prose uses CAS; it has no CRDT or presence.

Normal native tools `wh_local_tool_block_types/list/read/insert/apply/remove/undo/redo` require explicit project/era and `{kind:'codex'|'writings', documentId}` owner. Mutations compare the complete owner version read. In a combined Book the owner is the actual chapter containing the atom. Each operation patches only the atom's HTML span; surrounding prose bytes and other chapters remain unchanged. Open editors prepare their normal journal/save flow first; external completion patches just the atom and advances the same owner's baseline without an extra autosave. Pending source or focused editor drafts block deletion of their reference atom. Receipt audit contains only owner/receipt identity; native `/api/undo` delegates to the same one-use scoped receipt with outer-commit/abort semantics.

Linked Codex, Map, Board, Timeline and relationship-tree references offer focused inline editing of the referenced document. They mount one real editor rather than an engine's collection. Existing nine semantic previews and modal access remain. Map marker/event forms capture their baseline before editing and compare only modified fields. Vector features and named layers merge stable identities and changed fields; visibility merges map keys. Conflicts preserve the winning data and pending draft. Rejected pin drag positions remain in the existing local draft journal. Background upload, ordinary add/delete controls and other standalone interactions retain their existing domain operations; D2 is not a claim that every interaction in those engines has acquired a new merge policy.

Rich-content JSON/project/full/ZIP validation rejects foreign owner scopes before replacement. Clone remaps the atom identity and only codec-declared references (revision resets to0), including Board richContent, own-era and retained history. Opaque source prose and stable local item IDs remain exact. Release pin validation includes retained/restorable owned atom payloads as well as D1 documents.

D2 checks use the normal Electron CSS runner with `tests/local-tool-{host.ui,focused.ui,focused-conflicts,focused-vectors,book,block-lifetime,blocks.portability}.browser.*`, service `local-tool-blocks.browser.ts`, and real stdio/HTTP/executor/IPC transport `tests/local-tool-blocks.transport.cjs`. `tasks/local-sdk-host1041.md` records exact results and the source proof. The lateral block compositor, persisted order/heights and chapter/general dock remain D3; no D2 test closes those gaps.


D2 lifetime correction: a document host emits a client for each committed host setup. Readonly changes, retargeting, source changes and unmount permanently revoke that emitted client; reopening the same document creates a fresh one. StrictMode cleanup does not revive a client from its earlier setup. Concurrent editor/embed/fullscreen hosts each own their lease, so closing one does not revoke the others. This UI lease is an optional in-memory `isCurrent` callback, never project metadata or a new backend permission. Native/headless clients retain their normal independent lifecycle. Document save/state actions check it both before work and before their own RW completes, so revocation during that transaction rolls back. Delegated domain tools check before dispatch; this does not reverse a domain commit or external effect that already completed outside that transaction.

## Structured source-document queries

The optional portable `index` describes fields and document references in authored `data`. The ordinary Initiative example uses it to find saved trackers by participant name and minimum initiative and open a result. Those are document conditions: a matching name and initiative need not belong to the same participant.

```ts
index: {version: 1, fields: {
  participant: {path: '$.combatants[*].name', type: 'string[]', mode: 'all'},
  initiative: {path: '$.combatants[*].initiative', type: 'number[]', mode: 'all'},
  round: {path: '$.round', type: 'number'},
}, refs: [{kind: 'codex', path: '$.combatants[*].cardId'}]}

const rows = await client.queryDocuments({
  namespace: 'examples.initiative',
  where: {participant: {contains: 'Nora'}, initiative: {gte: 10}},
});
```

`LocalToolIndexSpec`, `LocalToolDocumentQuery`, `LocalToolIndexRow`, `evaluateLocalToolIndex` and `queryLocalToolIndexRows` are SDK exports. `useLocalToolIndex(client, query)` from `@/engines/local/useLocalToolIndex` subscribes to ordinary product changes, sequences asynchronous reads and returns `{rows, loading, error}`. Native `wh_local_tool_document_query` accepts the same query plus project/era. Describe includes the selected descriptor. Queries are read-only and require no custom operation.

Selectors support `$`, `.name` (arrays auto-unwrap), `[*]`, `.**` (self and descendants), and filters such as `? (@.kind == "battle")` or `? (@ != null)`. Filters compare a current scalar or named property with JSON string, finite number, boolean or null, using `==`/`!=`. Names are ASCII identifiers allowing `_`/`-`. Numeric subscripts, wildcard properties, arbitrary functions and filter ordering comparisons are rejected. Limits are32fields,16reference paths, two recursive-descent occurrences in total and512characters/path. These are the selector forms published in the researched [primary reference](https://docs.beta.vvd.world/workshop/reference/tools#search-and-the-index), implemented locally; package/database compatibility is not implied.

Types are `string`, `number`, `boolean` and their `[]` forms. There is no coercion. `mode:'all'` projects all typed matches as an array; default `first` retains the first (a one-element array for array types). Absent scalar fields are omitted; absent array fields are empty. Document title is result metadata, not an automatically indexed `title` field. Prose stays opaque unless explicitly selected as string data.

Writer's explicit `where` operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`. Fields and operators combine with AND. All operators on one array field must match the same member; empty arrays match no value predicate. `exists` tests projected presence, so an empty array is present. Number/string types stay distinct, string ordering is JavaScript lexical order, and substring matching is case-sensitive. `{reference:{kind,documentId}}` finds declared references. Rows include ID, namespace, title, update time, provenance, fields and deduplicated references. Sorting is title/ID; pagination uses `offset` and `limit` (default100, maximum500). No aggregate or total-count guarantee is implied.

Queries read current effective roots, including era hiding/overrides, without a second projection cache. A compiled project-selected release supplies its descriptor, including an intentional absence of an index; only unavailable source uses the document's last saved portable descriptor. Creation/save stores it; a successful explicit save by a compiled source without an index removes the old descriptor, while merely reading/selecting never rewrites authored data. Normal content search includes its projected list/scalar values alongside the existing codec prose/scalar body; pin changes refresh that search. Legacy documents without an index keep their existing state/search and gain no structured row automatically.

Descriptors survive normal JSON/ZIP, era/history/archive and clone flows. Clone remaps declared reference paths using Writer logical IDs, preserving opaque text and stable local item IDs. References are queryable edges, not a new durable graph service. Backup import still installs no source code. No server, SQL, account, network, model or payment is needed. Automatic codec-derived index schemas, upstream undocumented `IndexWhere` operators and online collaboration are not claimed.

`useLocalToolState` also routes Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y to the focused document, owned block or legacy tool. Native text-field Undo remains native; the action stack belongs to the current source surface. It does not reverse arbitrary tool calls or effects elsewhere.

Verification: `tests/local-tool-index.browser.tsx` / `testLocalToolIndex` covers the real scoped client, ordinary dispatcher/MCP handler, normal search, actual Initiative form/live filter, era isolation/hiding, ZIP restore, product clone, release selection and the shared author-kit evaluator. Native transport and Browser evidence are recorded separately.

## Live world document reads

The additive SDK exports `useLocalToolWorldList(client, kind)` and `useLocalToolWorldRead(client, kind, id)` read the same public `client.world.list/read` methods used by headless operations. List returns `{rows, loading, error, retry}`; read returns `{document, loading, error, retry}`, where a missing document is `undefined`. The client may be the restricted world-block client; that type now includes its optional `subscribe` method. The existing `WorldCardList` uses the list hook and offers visible read errors, Retry and the original Open action.

A stable client observes later local commits. Production subscription combines existing project change announcements with committed Dexie storage mutations, coalescing duplicate notifications in one event task. Global commit notifications can cause another scoped read; all returned rows still come from the client's project/era. Reads, aborted transactions and merely mounted views do not announce successful mutations. Teardown removes both subscriptions and pending notification delivery. No polling or network is involved.

Results carry client/query identity: changing project, era, kind or document ID never renders the previous binding's rows for a frame. Sequence checks ignore late responses; retry clears the failure on a successful new read. Existing clients without `subscribe` retain an initial read and explicit retry. No framework for online presence, remote subscriptions, CRDT or the whole upstream query API is implied.

The memory author kit now supplies the same optional public subscription. A successful transaction publishes only when that project's committed memory changed; reads, pending transaction drafts and aborted operations produce no event. Subscribers see the committed snapshot, and unsubscribe stops delivery. This reuses its existing serialized transactions and fake tool boundary. Domain adapters remain explicit fixtures, including the kit's existing lack of arbitrary Base document write APIs; no results are fabricated.

Verification: `tests/local-tool-world-live.browser.tsx` exports `testWorldCardListLive`, `testLocalToolWorldQueryRaces` and `testLocalToolWorldFakeCommits`. It mounts the real block with real/fake clients, exercises normal Codex creation/rename/archive, registered MCP list/get comparison, era variant/hide/reinherit, rollback/commit coalescing/teardown, late requests and scope frames, visible retry/navigation, and confirmed-only author transactions. `tests/local-tool-author-kit.node.cjs` retains its no-DB/no-network/headless check; the structured index and its live hook remain unchanged.
