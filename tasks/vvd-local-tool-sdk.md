# Local developer tool SDK

- [x] Inspect the existing React registry, project-scoped storage, clone/ZIP boundaries and conformance.
- [x] Define safe JSON state with revision CAS, namespace isolation and 2MiB/20MiB budgets; no database migration.
- [x] Adapt explicitly installed source modules into the registry, empty by default, without enabling tools in any project.
- [x] Add a no-overwrite scaffold CLI, runnable local example and developer guide explaining trust/rebuild/portability limits.
- [x] Verify hostile JSON, scoped reads, concurrent writes/limits, actual registry/component, ZIP/clone/project deletion and CLI safety.
- [x] Verify eager-glob behavior using an isolated synthetic source module; preserve builtin conformance/MCP and static checks.

This is a source-extension SDK for trusted application developers, not VVD Workshop compatibility or a sandbox/store. Its API exposes local project state and bounded Codex projections. It does not expose network, HTML execution, global database queries, filesystem access or account actions. Installed React source is application code and must be reviewed with the same trust as the rest of the app.

## Verified result

- Browser persistence/registry/component/portability suite: 6 groups pass; included in `scripts/run-vvd-tests.cjs`.
- Actual no-overwrite CLI, quoted-name TSX compilation, Windows junction refusal and empty default installation: 4 groups pass.
- Real Vite production transform with a freshly scaffolded isolated source module and its rendered save flow: 2 groups pass. The eager glob loads the module once and leaves project enablement unchanged; no network request occurs.
- Renderer/Electron TypeScript and builtin conformance pass in the combined gates. Scoped source/CLI ESLint passes; the project intentionally excludes browser fixture files from ESLint.
- No database migration, default tool activation, new builtin engine or MCP endpoint. The installed source directory remains empty. Opaque cloned references are deliberately not guessed/remapped; tools must reselect them within the new project. Example notes require explicit Save before leaving, as documented.
