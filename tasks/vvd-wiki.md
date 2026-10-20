# VVD parity: portable world wiki

- [x] Inspect Codex, world-bible export, sanitizer, local maps and gallery storage.
- [x] Add a self-contained HTML wiki with navigation, accent-insensitive full-text search, type/tag filters, relation links, local images and map pins.
- [x] Expose explicit selection and HTML download in the Codex UI in Spanish and English.
- [x] Verify hostile content, project boundaries, no network dependencies, actual exported navigation/search and UI download.

Scope: an additive offline publishing format, with existing project data and rich-text sanitizer. No server, new database schema, remote assets or editing of the source project. Existing printable world bible remains available.

Design: extend Writer's charcoal/gold desktop controls. Export uses an editorial light reading surface with a persistent contents column and readable serif prose; responsive native controls and print fallback.

Verification: dedicated Electron suite passes 7 groups, including a real saved file:// with networking disabled, actual UI download, script/URL injection cases, desktop and narrow layout checks. Visual QA inspected both PNG captures. Focused ESLint passes. Renderer typecheck is coordinated by the root because other agents are editing shared types/search.
