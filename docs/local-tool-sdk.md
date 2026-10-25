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

The eager build globs compile explicitly present development `installed/*/module.tsx` modules and immutable installed releases under `installed/*/versions/*/module.tsx`. The source tree includes the two compiled `examples.evolving-owned` releases used below; compiled availability does not select a project version, enable an engine or create authored data. Scaffolding and registration do not enable a tool in any project: after recompiling/restarting, open the project’s engine manager and enable its translated name manually. Desktop packaging uses the normal `npm run build:desktop` workflow and required platform dependencies. A rebuilt app must pass its normal gates. Installing/removing source is a developer action; project backups never install code.

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

The ordinary native MCP transport exposes sixteen static tools: `wh_local_tool_list`, `wh_local_tool_describe`, `wh_local_tool_read`, `wh_local_tool_save`, `wh_local_tool_query`, `wh_local_tool_call`, `wh_local_tool_pin`, `wh_local_tool_state_apply`, `wh_local_tool_state_undo`, `wh_local_tool_state_redo` `wh_local_tool_reference_resolve`, `wh_local_tool_document_list`, `wh_local_tool_document_query`, `wh_local_tool_document_create`, `wh_local_tool_document_rename` and `wh_local_tool_document_archive`. Read/save/query/call accept `projectId`, `namespace` and optional `eraId`; operations additionally take `operation` and object `input`. Save takes `data` and nullable `expectedRevision`. `wh_enable_engine` accepts an actually registered `local-tool-*` engine; an invented ID is rejected. Compiled examples are available in the build, but packaged-only examples require an explicit project version selection and manual engine enablement; they do not create or upgrade user blocks automatically.

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

Initialize map/list fields as objects/arrays in your state. A reference is `{kind,documentId}` using a normal world document kind; nullable references are allowed. The list's `idKey` identifies an item independently of its position. Optional `referenceKey` declares a reference inside each item; map `referenceValues:true` declares reference values. Other item text, scalar JSON and prose without format remain opaque; opt-in rich prose declares semantic links through the stored codec. Definitions with no codec keep the original `save(data,revision)` API and have no `client.state` actions.

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

Rich-content JSON/project/full/ZIP validation rejects foreign owner scopes before replacement. Clone remaps the atom identity and only codec-declared references (revision resets to0), including Board richContent, own-era and retained history. Opaque legacy source prose and stable local item IDs remain exact; the later opt-in rich field remaps only its admitted semantic links. Release pin validation includes retained/restorable owned atom payloads as well as D1 documents.

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

## Native packaged resources and slot overrides

Source `d542365` is integrated FF-only from f44e387 after independent CAS15 approval. Final main verify:quick/shipping lint passed; Vite28.92s, Electron and Node937/schema2PASS passed (root session2655 exit0, clean main and merge lock released). The Google manual update/readback is complete; its separate receipt records588 UTF-16 units,198 paragraphs,197 others and styles preserved. This is Writer's additive API, inspired by the reference's `appAssets` contract, not a claim of identical upstream signatures. [Evidence and final receipts](../tasks/vvd1095/verification-sdk-assets.md).

Add optional `assets` and `assetFiles` to an existing definition. Each slot declares `path`, `kind` (`audio|image|font|video|data`) and optional JSON `meta`, `replaceable`, MIME `accept` and `aliases`. Aliases must be unambiguous. The local loader path must appear in a compiled release's file manifest; actual bytes/size are verified. Example definition fields:

```ts
import {localAssetFile} from '@/engines/local/sdk';

assets: {
  portrait: {path: 'assets/portrait.svg', kind: 'image', accept: ['image/*']},
  tick: {path: 'assets/tick.wav', kind: 'audio', aliases: ['click']},
},
assetFiles: {
  'assets/portrait.svg': localAssetFile(new URL('./assets/portrait.svg', import.meta.url).href),
  'assets/tick.wav': localAssetFile(new URL('./assets/tick.wav', import.meta.url).href),
},
```

These are fields of `defineLocalTool({...})`, not a complete definition. URLs come only from compiled source; `localAssetFile` decodes bundled data URLs locally and fetches only the renderer's own origin. It does not fetch a URL persisted by a user or require another server. Importing a backup never executes its package code. A missing compiled release/file stays unavailable.

`client.assets` methods:

| Method | Contract |
|---|---|
| `list()` | Detached slot manifest; no state created. |
| `resolve(ref)` | Resolve a typed local ref to `Blob`, `kind`, `mime`, `version`, `ref`, `slot`, `origin`, or `null`. |
| `slot(slot, overrides?)` | Resolve document override → effective installation override → shipped default. Returns `origin: document|installation|default`; a present unavailable/invalid override does not silently fall through. |
| `validate(slot, refOrNull)` | Validate replacement and return canonical `slot` plus its `aliases` for the caller's normal state action. |
| `choices(kind)` | Project images, effective audio/video media, or immutable project font/data files; returns ref/title, not bytes. |
| `import(file, kind)` | Import a `File` as `font` or `data`; returns `LocalAssetFileInfo` (id/projectId/kind/title/mime/size/sha256/createdAt/ref), without Blob. Project+kind+SHA+MIME deduplication preserves the original title. |
| `installation.read()` / `.set(slot, refOrNull, version)` | Read CAS token and effective/own selections; set or Revert the current Base/era layer. Readonly or revoked clients reject writes. |

Refs are `{kind:'image',id}`, `{kind:'media',id}`, `{kind:'file',id}` for imported font/data, or `{kind:'source',namespace,slot,releaseHash?}`. An omitted hash follows the effective project pin; an explicit hash selects exactly that compiled release of the same namespace, even if another release is the current pin. There is no fallback to an uncompiled release. The current client lease remains checked. No temporary URL or Blob belongs in JSON state.

A document or owned block can declare its optional selection map:

```ts
initialState: {assetOverrides: {}},
codec: {version: 1, fields: {
  assetOverrides: {kind: 'map', assetReferenceValues: true},
}},
preview: {version: 1, fields: [], assets: [{
  namespace: 'me.tool', slot: 'portrait', overridesField: 'assetOverrides',
}]},
```

In its React component, `useLocalToolAsset(client, 'portrait', overrides)` returns `{asset,url,loading,error}`; render `url` as an image. The hook owns/revokes its ObjectURLs, ignores late former-binding results and observes commits. Use `assets.validate` to canonicalize a chosen slot and remove its aliases through the existing `state.apply` map actions; those actions keep normal document/block Undo receipts. The shipped `examples/AssetPad.tsx` shows both selectors, Revert and explicit `useSound` Play/Stop. Its audio volume is15%; mounting never plays.

Installation selections reuse portable project/era state; eras store only their differences and Revert restores inheritance. **Installation offers CAS+Revert, without Undo.** Font/data retain shipped Blob defaults and also accept local project-file import/choices. Era overrides store selections, not duplicate file bytes. No new permission or global media store is introduced. The author kit shares resolution/cascade logic and accepts explicit fixture media/images/assetFiles.

Declarative readonly previews resolve captured bytes without mounting authored controls or writing state. Captures include only referenced gallery images, including nested draft blocks, and never fall back to live DB when a snapshot exists. Images obey `includeImages`/image exclusions independently of `includeMedia`; `includeMedia:false` omits font/data and other media, without suppressing admitted gallery images. JSON/ZIP/clone remap file/image/media reference domains separately. Normal SVG/raster preview frames are96×96; wiki resanitizes SVG with its own full-width/max360px frame. Global manuscript SVG policy is unchanged. Asset-backed audio still uses the existing gesture-gated SDK graph; native MCP play does not start or queue it.

Verification:18 author groups +6 independent groups +10 relevant legacy groups,34 distinct focused groups, not a global suite. Root's normal Brave imports/selection/Revert/save/reopen and readonly96px evidence are separate from dispatcher tests; no final-source stdio or hardware-listening claim. See the linked verification for source receipts, final integration/build and the separate manual receipt.

## Measured audio levels and stereo pan

Source `fcf94f61a99a7541ac4029916e023f7405e3a14d` is approved CAS20 after a fresh review/vote and integrated FF-only into main from07f6777. Thirteen committed routes comprise the11-path author freeze, independent oracle and runner registration of11 exports. Final review:29 distinct groups (7 author +4 independent +18 legacy). Root's normal Brave flow is verified separately. Manual update/readback is complete (415 UTF-16 units,198 paragraphs,197 other texts and styles preserved; both locks released). Exact-main session58713 exited0: verify:quick34 engines/64 tables/6515 locale keys/22 locale files/0 warnings, shipping lint0, renderer/Electron types PASS, Vite43.33s, Electron PASS, Node937 tools/schema2 checks PASS and the original Node author-kit four scenarios plus headless assertion PASS. Main is clean and the merge lock released. MEMORY and the documentation commit/integration remain pending. These are Writer's own signatures, not matching upstream parameters. [Evidence and current gates](../tasks/vvd1095/verification-sdk-audio-levels.md).

`LocalToolAudio` adds `supportsPan`, `getLevels(handleId)` and optional `pan` in play/update; state includes its current pan. Range is finite[-1,1], default0, left/centre/right. The existing default-centre output is retained. Backends without stereo capability keep default playback but explicitly reject nonzero pan. This is stereo panning, without3D position, listener, distance or HRTF.

```ts
const id = await client.audio?.play(
  {kind: 'media', id: localAudioId},
  {bus: 'music', loop: true, volume: 0.15, pan: 0},
); // call from a real user gesture; null/undefined is not a started voice
if (id) {
  client.audio?.update(id, {pan: -1});
  const levels = client.audio?.getLevels(id);
  // levels?.left.rms / .peak, levels?.right.rms / .peak
}
```

`getLevels` returns `{rms,peak,left:{rms,peak},right:{rms,peak}} | null`. Values are digital linear PCM amplitude from the voice **after effective gain/bus/duck and pan**, not the configured gain or an analysis of the original file. RMS is the square-root mean square over the current sample window; peak is its maximum absolute sample. Aggregate RMS uses the two channel powers and aggregate peak is the larger channel peak. Internal values may exceed1; the API does not normalize away clipping. Copies are detached. They do not measure speaker loudness, physical audio delivery or SPL.

An active silent/zero-gain voice returns measured zeros. Unknown, stopped, foreign-owner, revoked or unavailable handles return null; the production backend also returns null while its context is suspended. Reads never create/resume AudioContext, start playback or queue a future play. A caller may read only its own handles. Inert/recording backends return null unless they explicitly supply test measurements; volume is never fabricated into a measured signal.

For a normal React meter, import `useLocalToolAudioLevels` from the SDK and pass the actual ID returned by play:

```ts
const levels = useLocalToolAudioLevels(client.audio, activeHandleId);
// null means no active measurement, not measured silence
```

This opt-in hook samples while that handle is active and the view is visible. Retargeting/unmount removes its RAF/subscription; the first frame of a new binding never shows the old samples. It does not stop other playback. `examples/SoundPad.tsx` uses the normal Local sounds Owned block: low-volume music loop, L/R metrics, pan and Stop. These controls are runtime only: saving the parent retains the block, reopening starts Stopped at15%/pan0 without autoplay. Readonly previews remain inert.

Native agent correspondence reuses `wh_local_audio_status` with optional `includeLevels:true`, returning per-handle `levels` or null in the same project/era; without it the levels field is absent. `wh_local_audio_control` adds `action:'pan'`, required `handleId` and finite `pan`. It changes that existing scoped voice only. Native play remains `started:false`, `queued:false`, `gesture-required` for both media and source-slot refs. No final-source stdio or hardware evidence follows from a dispatcher test. The linked verification separates29 focused groups, real OfflineAudioContext/Analyser checks, controlled backend-state tests, root Browser, CAS20/manual receipts and the final main verification still in progress.

## Project font/data files and font loading

Feature source `c2b7cb0dba116485264a8ae86e48635c82706e72` is carried by delivery `416be426337f22f128c5f4d0875167d48738e05c`, approved CAS23 and verified on main. It extends the resource baseline above without replacing its historical receipts. [Detailed verification](../tasks/vvd1095/verification-sdk-asset-files.md).

```ts
// The File comes from a normal file input; the slot must accept its kind/MIME.
const imported = await client.assets.import(file, 'font');
const installation = await client.assets.installation.read();
await client.assets.installation.set('font', imported.ref, installation.version);
```

Import and selection are separate UI operations. A refused/stale selection retains the draft and imported choice; explicitly reselect or Revert using the newly observed token, without an automatic CAS retry. Document/Owned choices use the declared `assetOverrides` map and native state/block Undo/Redo receipts. Installation has CAS+Revert, without Undo; Undo does not delete immutable file bytes. Readonly/query imports reject. An editable Owned host has a separately leased import capability; its general world/media facilities remain readonly.

```tsx
import {useLocalToolAsset, useLocalToolFontFace} from '@/engines/local/sdk';

const resource = useLocalToolAsset(client, 'font', overrides);
const face = useLocalToolFontFace(resource.asset);
// At the top level of the existing component; show loading/error as appropriate.
return <span style={face.family ? {fontFamily: `"${face.family}", sans-serif`} : undefined}>AA AA</span>;
```

`useLocalToolFontFace(assetOrNull)` returns `family/loading/error`. Each caller owns its FontFace; cleanup removes only that face and late former bindings cannot publish after retarget/unmount. The public import stays headless-safe; the effect performs browser work. It creates no ObjectURL (the asset hook owns its own URLs). Loading, an error or a system fallback does not prove that the requested font rendered.

AssetPad's normal Document/Installation pickers import, explicitly select, save/reopen and Revert both kinds. Its procedural TTF covers only A and space; this is a developer sample, not a general writing font. Its JSON example reads a labels list; data resources themselves remain opaque bytes, never evaluated as code. Inventory admission uses 50MiB/file and 500MiB/project, without changing Dictionary's separate 512KiB contract. No new inventory editor, deletion or garbage collection is provided.

Project/full JSON and ZIP preserve actual file bytes and preflight size/MIME/SHA before writes; old backups without files remain accepted. Duplicate/clone keep file/image/media remap domains distinct even for equal literal IDs. Captured readonly previews use only their admitted snapshot/accessor, without live-DB fallback or authored controls. Missing bytes stay unavailable. Reader/wiki emit generated font CSS only for markers surviving final sanitization and add `font-src data:` to CSP only when that CSS is nonempty; author CSS is not admitted. Published retains frozen HTML. The existing wiki SVG frame and manuscript SVG policy remain unchanged.

These are Writer's own additive signatures. The primary [AssetManifest](https://docs.beta.vvd.world/workshop/reference/sdk#assetmanifest) and [useAsset](https://docs.beta.vvd.world/workshop/reference/sdk#useasset) describe typed slots/cascade; no upstream font/data picker was observed. The native hook uses [CSS Font Loading](https://drafts.csswg.org/css-font-loading/#fontface-interface). No binary SDK equivalence, universal font coverage, new stdio proof, hardware/audio autoplay or external paid service is claimed.

## Opt-in rich prose fields

`{kind:'prose',format:'rich'}` stores a rich HTML string using the same state budgets. Without format, prose remains opaque/literal, including text that looks like HTML. Do not change the format of an existing Owned field to opt it in. A new block key remains valid; alternatively, the additive Owned contract below permits adding a new rich field while preserving every existing field descriptor. The example `examples.rich-prose` supplies its own Source document and Owned `briefing`; it does not enable itself in user projects or modify Initiative.

```tsx
import {LocalToolRichProseEditor,type LocalToolProps} from '@/engines/local/sdk';
type Briefing={briefing:string};
function BriefingField({client,context}:LocalToolProps<Briefing>){
  return <LocalToolRichProseEditor client={client} context={context} field="briefing"/>;
}
// In the definition:
// codec:{version:1,fields:{briefing:{kind:'prose',format:'rich'}}}
// initialState:{briefing:'<p>Write a briefing.</p>'}
```

The public wrapper remains Node-pure. The normal application supplies an ephemeral stable `context.renderRichProse` factory which mounts the native host component. Source tools can import the public SDK and their REAL module through the normal author CLI; they do not import RichProseEditor/Tiptap/DB privately. Missing host capability reports unavailable rather than faking DOM in the memory host. Rebuild and enable the example explicitly, then run `node scripts/test-local-tool.mjs --id examples.rich-prose` for its data-only author scenario.

The additive sdk-prose profile admits core headings/lists/emphasis/quotation/code, safe links and copied local raster files. Slash commands are filtered; the scoped Codex picker inserts text links. This is not the full HTML editor: no operational Source/Tool/Media/preparation/editorial widgets, SVG, arbitrary CSS, checklists, footnotes or forms inside the field. Imported markup is sanitized for projection without rewriting stored data on read. The default full editor and literal prose retain their behavior.

Save/Discard are explicit. Baseline is captured at the first edit; disjoint changes use the existing merge and conflict preserves the draft. `useLocalToolState.apply(actions, baseline?)` accepts an optional captured baseline and retains its existing receipt/Undo path. The editor registers pending work only for draft/reading/busy. Parent guards are scoped to their own editor. Owned Save updates its atom; save the parent document afterwards. In the dock, Save/Discard the child before leaving: the first parent exit may remain blocked, and there is no global autoflush of another pane. Ctrl+Z inside text remains native; receipt Undo/Redo applies outside it. Late FileReader/save results cannot retarget another owner/era/field.

The saved codec drives Source/Owned/dock/Reader/wiki/documentImage HTML previews even without the module. `includeImages` governs raster separately from `includeMedia`. Wiki converts only admitted same-project Codex targets; excluded/foreign links retain readable selected text. Search derives plain text only for the rich field. Clone/import uses host semantic-link remap callbacks; the pure kernel imports no DOM/DB. A rich remap without its callback fails before mutation; literal legacy prose does not acquire that requirement.

Published editions keep frozen chapter/Reader HTML/hash, not a historical copy of every Source tool. Editable snapshots remap links; restore inspects the current captured target world and reports missing references, without reconstructing a deleted briefing from published HTML. Folder-import Undo also sees rich codec references in Source/Owned/dock/Base/era. General SDK coverage remains partial; no character CRDT, online collaboration or new stdio session follows from this field. [Final evidence and limits](../tasks/vvd1095/verification-sdk-rich-prose.md).

## Add fields to an existing Owned block

An Owned declaration may opt in with `codecEvolution:'additive'`. Without it, the existing strict JSON descriptor check remains. Additions must preserve each stored field's kind, prose format, list identity/reference key and flags; removing or changing an existing field is refused. The author validator must accept both the real stored data and the editable view, and the declared initial state must validate. This option does not migrate standalone Source state.

```ts
const notebook = defineLocalToolBlock({
  key: 'notebook', scope: 'host', codecEvolution: 'additive',
  name: {en: 'Notebook', es: 'Cuaderno'},
  // Keep every old field descriptor. New fields may be optional in the guard.
  codec: {version: 1, fields: {
    notes: {kind: 'prose'},
    objectives: {kind: 'list', idKey: 'id'},
    labels: {kind: 'map'},
    briefing: {kind: 'prose', format: 'rich'},
  }},
  initialState, validateState, component: Notebook,
});
```

Import `defineLocalToolBlock` from `@/engines/local/sdk`; the fragment assumes your own valid initialState, type guard and component. In an older compatible block, missing newly added lists/maps appear as `[]`/`{}`; other new fields use their declared initial values. Nonempty list/map creation seeds belong only to fresh blocks. Existing opaque values are retained and validated, never replaced by a convenient default. Reordering descriptor keys or changing only preview does not itself trigger adoption.

Selection, read, mount and cancel preserve the RAW envelope. The editable client shows the projected view while `snapshot.block.version` remains the complete RAW token. Native reads/baselines and readonly captures remain RAW. The first semantic data effect saves data, codec and preview together, including preview absence. A pending net-zero UI action has no receipt or adoption. An equal direct `client.save` retains its ordinary revision/write behavior but preserves the old body, and creates no state receipt. Native block/dock no-ops retain their normal revision, receipt and audit behavior without adoption. Explicit replacement or `unset` is not silently refilled afterwards.

Use `client.state.apply` for scoped action Undo/Redo. The first evolution receipt shares the existing runtime receipt map and restores the complete prior envelope, including codec/preview and absent fields. It checks the current body except its increasing revision, then writes with current CAS; stale metadata/owner/release and overlapping changes refuse. Normal non-evolution actions keep their existing inverses. Receipt availability follows the existing commit/abort boundary. A Tiptap receipt confirms the parent draft, so save the parent afterwards; it does not certify a database commit or arbitrary nesting of the UI port inside an outer database transaction.

Normal example: enable `examples.evolving-owned` in Engine Manager and explicitly select v1, insert Owned “Evolving notebook” and save its parent. Select v2, then reopen that same block. Existing prose remains; new lists/maps start empty. Add an objective or label, use its scoped Undo/Redo, save rich child changes, save the parent and reopen. The two compiled releases are v1 `6e9497a1dc78416297de1001a7293ea70836553c42d7c8a30ad73d0ff2e1e78e` and v2 `108a6673ba6f038994341dbf03078ef15797d74e937ad6d321aba3a5b98a782c`. Engine enablement and version selection are separate explicit controls. Source notes in this example retain their prior contract.

Captures, history/Archive, hidden eras and frozen Published readers retain their stored descriptor/data/preview. JSON/Duplicate/ZIP remap declared identities in editable snapshots, including historical plain Owned hosts, without regenerating frozen reader HTML/hash or recovering deleted source. The primary [field documentation](https://docs.beta.vvd.world/workshop/reference/sdk#field) and [defineDocumentCodec](https://docs.beta.vvd.world/workshop/reference/sdk#definedocumentcodec) distinguish field additions from format migration. Writer's per-envelope opt-in is its own JSON/CAS contract: upstream `defineBlock` uses a host document codec and collaborative prose. Official CLI scaffold execution does not prove upstream runtime, binary compatibility or character collaboration. [Evidence, delivery status and limits](../tasks/vvd1095/verification-sdk-owned-evolution.md).


## Own locale catalogs and host language

A definition may add optional `locales:{defaultLocale,catalogs}`. Import the hooks and pure constructors from the public SDK; names/descriptions/default titles retain their existing EN/ES contracts. For example, add this declaration to your own tool:

```ts
locales: {
  defaultLocale: 'en',
  catalogs: {
    en: {hello: 'Hello {name}', items: {'0': 'No items', one: '{count} item', other: '{count} items'}},
    es: {hello: 'Hola {name}', items: {'0': 'Sin elementos', one: '{count} elemento', other: '{count} elementos'}},
  },
},
```

Inside its component, pass the received client rather than importing application stores:

```tsx
import {useLocalToolT, type LocalToolProps} from '@/engines/local/sdk';

function Summary({client}: LocalToolProps<{notes: string}>) {
  const messages = useLocalToolT(client);
  return <p>{messages('hello', {name: 'Nora'})} · {messages.plural('items', 0)}</p>;
}
```

Use a local binding such as `messages` for tool-owned catalogs. The repository's static global-key scanner treats literal `t('key')` calls as application-global copy; own catalog keys are separate and do not belong in the global dictionaries.

`useLocalToolLocale(client)` returns the immutable locale snapshot; `useLocalToolT(client)` returns a callable translator with `.plural(key,count,params?)`, `.number(number,options?)`, `.date(Date|number|string,options?)` and `.locale`. For non-React code use `resolveLocalToolLocale({locale,defaultLocale,catalogs})` then `createLocalToolTranslator(snapshot)`. `client.locale` is an optional readonly port: `declaration`, `getSnapshot():string`, `subscribe(changed):unsubscribe`; no preference setter. Source, Owned and the public world-block client type can pass it. Without a client/port the hooks explicitly remain fixed English. The normal app settings still offer EN/ES; the pure helper can resolve other valid catalog language tags.

Lookup is per key: exact language → base language → declared default → key. Empty/whitespace messages inherit; literal keys precede dotted traversal. Named interpolation preserves `0` and `false`, while absent/null values keep their placeholder. Plural lookup tries exact numeric string (including `'0'`), the supplying catalog language's Intl category, then `other` before falling back to another catalog. Number/date formatting uses the requested locale and caller options; invalid values/options return readable input text rather than silently inventing zero or an epoch date. Specify `timeZone:'UTC'` where exact dates matter. Results depend on runtime Intl/ICU support.

Partial/empty catalogs or a missing default translation are valid; invalid JSON/container/message shapes are not. Preparation clones and deeply freezes its own finite tree without freezing caller input or retaining mutable aliases. Hooks prepare by port identity and derive by locale, without cloning the catalog on every render/getSnapshot. This is package-owned UI copy, never translation of authored notes, HTML or state. No global string registration, Provider, persistent catalog collection or database dependency enters the public pure constructors/author kit. In the memory host, `createFakeLocalToolHost(definition,fixtures,{locale:'en'})` and host-only `setLocale('es')` exercise the same port without changing authored state.

The normal `examples.localized-notebook` is compiled source, not automatically enabled. Enable Localized notebook / Libreta traducida in Engine Manager, create/open its source document, type and switch the normal Settings language, then Save explicitly. For an Owned example, save the Codex card first, reopen its editor, place the cursor in the body and use Source blocks. Save the child's briefing and then Save Changes in the parent. A refused insertion now reports that prerequisite; a message does not claim a block was inserted. Reopen verifies authored words, not translated copies. The existing author command is `node scripts/test-local-tool.mjs --id examples.localized-notebook`.

`wh_local_tool_describe` reports default/supported locale metadata only when declared; `includeLocaleCatalogs:true` explicitly requests own JSON catalogs. Selected/exact-hash releases retain their existing resolution; no new tool/permission. Catalogs belong to compiled source packages, not project data backups. Reader/wiki/Published keep their captured authored projections when live code changes or is absent. [Verification, evidence boundaries and delivery status](../tasks/vvd1095/verification-sdk-locale.md). These are additive Writer signatures, not universal upstream compatibility.

## Optional tutorials for Source and legacy editors

Declare `tours?: readonly LocalToolTourSpec[]` on `defineLocalTool`. Each tour has `id`, positive integer `revision`, `title` and ordered `steps`; each step has `id`, `target`, `title`, `body` and optional `advanceOn`. Text is `{en,es}` or `{key}` from the tool's own locale catalogs, with their existing fallback. Targets are `data-tour` values inside that mounted tool root. Descriptors are captured as detached, deeply frozen finite JSON; the author input is not frozen.

```tsx
import type {LocalToolClient, LocalToolHostContext, LocalToolTourSpec} from '@/engines/local/sdk';

const tours: readonly LocalToolTourSpec[] = [{
  id: 'first-count', revision: 1,
  title: {en: 'Using the counter', es: 'Uso del contador'},
  steps: [
    {id: 'meet', target: 'counter',
     title: {en: 'Your counter', es: 'Tu contador'},
     body: {en: 'Each document has its own count.', es: 'Cada documento tiene su cuenta.'}},
    {id: 'increment', target: 'increment',
     title: {en: 'Increment once', es: 'Incrementa una vez'},
     body: {en: 'Press Increment.', es: 'Pulsa Incrementar.'},
     advanceOn: {type: 'event' as const, name: 'incremented'}}
  ]
}]; // pass tours in the ordinary defineLocalTool definition

async function increment(client: LocalToolClient<{count:number}>, context?: LocalToolHostContext) {
  const before = await client.read();
  await client.state!.apply(before, [{type: 'set', field: 'count', value: before.data.count + 1}]);
  context?.tutorial?.signal('incremented'); // after the real action commits
}
```

The ordinary editable Source-document and legacy hosts add **Help/Ayuda** when tours are declared. No autooffer or implicit document save occurs. `context.tutorial` is optional and instance-bound:

- `show(id,{resume?})` resolves `{shown:boolean,reason?:'unavailable'|'cancelled'|'missing'}`; it does not queue UI without a mounted host.
- `signal(name)` reports a confirmed author action to the currently armed step in this instance. Signals from another root or an abandoned step cannot advance it; earlier signals are not queued.
- `getSnapshot()` returns detached `{available,active?:{id,step},tours:[{id,revision,status,step}]}`.
- `subscribe(changed)` returns an unsubscribe. Retarget/unmount revokes the old port and releases its listeners.

Omitted `advanceOn` and `{type:'manual'}` use Next/Finish. `{type:'event',name}` and `{type:'element-appears',target}` wait for the matching signal or visible element in this root. They have no Next/Finish bypass, including controller/ArrowRight; Back, Skip and Escape remain available. Conditions are armed before progress persistence waits. The host lease includes the selected release, client, project, era, document and instance; hide/pin/retarget/unmount/StrictMode cancels it. A language change updates labels without resetting the step. Opening fullscreen revokes the underlying tutorial; fullscreen, Owned/world blocks, readonly and exports do not receive this port.

Progress uses the existing app-wide settings row, separate from authored data and world backups. Its canonical key includes namespace, tour ID/revision and the ordered step ID/target/condition tuples. Text, locale and package hash are excluded: copy/repack keeps progress, while a structural change starts separately even if revision is unchanged. Omitted/manual are equivalent only for this key; describe preserves the exact declaration. Previous records and the nine global tutorials remain intact.

Enable **Guided counter / Contador guiado** through Engine Manager after compiling its source, then create/open a Counter document and press Help. Next reaches the action step; Increment saves the real count and then finishes. To exercise the legacy host, use its existing legacy view. No compiled example is enabled automatically. The normal author command is `node scripts/test-local-tool.mjs --id examples.guided-counter`.

`createFakeLocalToolHost` exposes inert `host.tutorial` and `host.tutorialCommands`; show/signal records intention and show returns unavailable rather than fabricating an overlay. Pure descriptor helpers, fake and real author module remain usable without DOM/DB. `wh_local_tool_describe` returns detached `tours` only when declared. With `projectId` and `includeTutorialState:true`, optional `eraId` selects matching currently mounted editor snapshots; an exact candidate cannot borrow the selected release's state. No new MCP tool or headless show operation is added. [Verification, reference boundaries and delivery status](../tasks/vvd1095/verification-sdk-tours.md).
