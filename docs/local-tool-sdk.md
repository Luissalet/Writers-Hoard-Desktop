# Local tool source SDK

Writer’s Hoard can compile trusted React tools into the desktop app. This is a source-extension workflow for developers who can review TypeScript and rebuild the app. It is **not** VVD Workshop compatibility, an app store, a binary plugin loader, or a sandbox for downloaded code. No account, server or network API is required.

The supplied API exposes project-scoped JSON storage and bounded read-only Codex projections. It exposes no network, HTML execution, filesystem or global database methods. React source itself runs with application-code trust: inspect it and its dependencies as carefully as any other source change. Never install unknown source on the assumption that these helpers restrict the rest of JavaScript. No downloaded HTML, runtime `eval`, iframe or remote import is part of this SDK.

## Create and run a tool

From the repository, with the normal Node dependencies already installed:

```sh
node scripts/create-local-tool.mjs --id me.world-notes --name "World notes"
npm run typecheck:renderer
npm run dev
```

The CLI creates `src/engines/local/installed/me.world-notes/module.tsx` plus a README. It refuses existing destinations, traversal and symlink installation paths. The module is a working local notebook: save notes, reload the saved version, and query only the current project’s Codex. The same verified scaffold is the runnable example; its template is `scripts/templates/local-tool.tsx.txt`.

Only `installed/*/module.tsx` modules explicitly present in the source tree enter Vite’s eager build glob. The installed directory ships empty. Scaffolding and registration do not enable a tool in any project: after recompiling/restarting, open the project’s engine manager and enable its translated name manually. Desktop packaging uses the normal `npm run build:desktop` workflow and required platform dependencies. A rebuilt app must pass its normal gates. Installing/removing source is a developer action; project backups never install code.

## Typed local API

Import `defineLocalTool`, `LocalToolProps`, `LocalToolJson` and `LocalToolSnapshot` from `@/engines/local/sdk`. Export one default definition with a lowercase developer namespace such as `me.world-notes`, English/Spanish name and description, safe JSON initial state, synchronous type guard, and React component. The engine ID is `local-tool-me.world-notes`; the namespace is also its storage key. Duplicate namespaces and builtin engine collisions are refused before any registry mutations.

The component receives a stable, frozen client for its project and namespace:

```ts
const snapshot = await client.read(); // missing state returns initial data, revision null
const next = await client.save({version: 1, notes: 'A local idea'}, snapshot.revision);
const cards = await client.queryCodex({query: 'harbor', type: 'location', limit: 20});
```

Saving is one Dexie transaction: it compares the expected namespace revision and merges only that namespace into the latest Project row. First creation requires `null`; existing or cloned records require their returned revision, including zero. Concurrent changes to another namespace or project metadata survive. A conflict, validation/storage failure, missing project or budget failure rejects without clearing existing state. Read values are detached copies. Do not retry with a guessed revision or discard a user draft automatically. The example retains failed-save text and offers an explicit “Discard own draft and reload saved” action. It requires explicit Save before leaving; production tools with buffered edits should integrate the app’s `registerPendingFlusher`, close guards and recovery journals, with failure UI appropriate to their editor.

Queries always use `client.projectId`; callers cannot provide another project ID. Foreign IDs in `ids` return no foreign cards. Limits: 1–50 cards (default20), query200 characters, up to100 requested IDs. Returned projections contain ID, title, category, at most20 tags and24 short text fields; large fields are truncated and marked. Prose, image bytes and mutation of Codex cards are not exposed. Render values as React text; never inject them into HTML.

## State, backup and lifecycle contract

`Project.localToolStates[namespace]` stores `{revision, updatedAt, data}`. JSON values only: reject functions, undefined, BigInt, Blob/Date/class instances, accessors, sparse arrays, symbols, cycles, nonfinite numbers, prototype-sensitive keys and nesting deeper than32. Each serialized record is at most2MiB, all tool state in a project at most20MiB, up to128 namespaces. Validation also bounds JSON nodes. Budgets measure UTF-8 JSON bytes; do not store model/image/audio files here.

The SDK does not invent a schema for opaque `data`; the synchronous type guard validates every read/save. Version your own payload (the example uses `version:1`). For migrations, accept old and new payloads in a transitional guard, transform explicitly, then save with the observed revision. Rejected old payloads remain stored rather than being silently reset.

ZIP export/restore carries tool state even if its source module is absent and validates it before replacing data. Legacy JSON project cloning copies safe opaque data with revision zero under the same namespace. **Strings that resemble entity IDs are not automatically remapped.** A tool must tolerate unresolved references after a clone; all subsequent SDK queries remain inside the new project. Store ordinary authored data where possible, and reselect entity references deliberately. Project deletion removes its tool state with the Project row. Disabling or uninstalling a source module retains state so reinstating the reviewed module recovers it. The SDK has no separate store or deletion journal.

Built-in MCP schemas, categories, presets and engine counts remain unchanged with the default empty installation. Extension engines use the ordinary engine manager and metadata backup path, with no new database table or schema. This SDK does not add MCP methods or make local extensions remotely installable.

## Verification

```sh
node scripts/test-local-tool-cli.mjs
npx electron scripts/run-local-tool-build-test.cjs
npx electron scripts/run-focused-browser-tests.cjs tests/local-tool-sdk.browser.tsx testLocalToolSdk 250000
node scripts/check-conformance.mjs
```

The tests use synthetic local source code and isolated data. They do not activate a tool in a user project, download code or modify accounts.
