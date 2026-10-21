# Native operations for source extensions

The depth inventory found that source extensions were editable in the product but absent from its MCP surface. This is a real offline gap. Existing installations and state remain compatible.

## Contract
- Keep trusted source installation and the default empty installation.
- Register optional named operations with descriptions and JSON input schemas beside each compiled tool.
- Discover/read/save tool state and invoke those same operations through native MCP.
- Give the normal client explicit era context, effective world-document reads/writes, media, search and navigation; never invent remote services.
- Preserve Base state when an era first overrides one tool namespace. Compare revisions before replacing that namespace; preserve unrelated namespaces and metadata.
- Keep schema descriptions pure for Electron. Renderer-owned operation functions never enter the native process.

## Acceptance
- [x] Existing SDK, source CLI and real Vite-build tests pass.
- [x] A synthetic installed module is enabled and edited normally, then read and invoked through the native stdio/HTTP/IPC/DB path.
- [x] Named operation schema is discoverable; invalid inputs and stale revisions preserve existing data.
- [x] Era state and world operations preserve Base and sibling eras; current Codex formulas are projected.
- [x] Backup/clone preserve extension state without installing executable code.
- [x] Documentation describes exact capabilities and remaining differences without claiming Workshop compatibility.

## Implementation and evidence

`src/engines/local/{definitions,sdk,storage,registry,manifest,bridge,operationSchema}.ts*` supplies the normal source registry/client and six pure-schema native endpoints. Base document editing uses normal `callTool`; era-only `world.variants` uses the existing CAS document store. There is no generic Base save API that fails at runtime. Project and era namespace state share the same validator/CAS; JSON/ZIP preserve opaque state without code installation.

`tests/local-tool-native.runner.cjs` drives real stdio → HTTP → executor → isolated trusted IPC → renderer handlers → IndexedDB. It covers source discovery/enable, UI/native conflict preservation, malformed arguments, failed-write rollback, read-only query clients, ownership checks,15 effective kinds and formulas, Base/named writes, media/search/context navigation, sibling and metadata preservation, native writes-off queries, JSON clone and ZIP restore. The native renderer is offline and uses only synthetic fixtures and a temporary profile. The real Vite harness uses the actual worktree SDK with a temporary scaffold/entry, rather than copying the SDK or linking dependencies.

Writing operations must await local database work. Their database edits are transactional, but external effects cannot be undone. Queries use a read-only SDK client without wrapping document reads in a broad IndexedDB transaction (Blob version hashing needs its ordinary reader lifecycle). The explicit supported schema vocabulary is documented; unsupported assertion keywords are rejected at registration.
