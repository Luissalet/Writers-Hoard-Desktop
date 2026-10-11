# World bible

Project tools → Publishing includes a world bible panel. Choose Codex entries,
timelines, maps and relationships, inspect the sandboxed preview, then save HTML
or PDF. Existing manuscript publishing tools remain available below it.

The compiler reads a consistent snapshot of existing project tables. It writes
no new records. The UI exports its exact preview snapshot, even if rows change
while the native save dialog is open. An omitted ID selection means all; an empty array means none.
Unknown and foreign IDs fail rather than widening the selection. Secret
relationships are excluded by default, with an explicit opt-in. This exclusion
does not redact secrets the author wrote in Codex prose or other fields.

HTML is standalone: index, links to selected entries, localized standard labels (custom field names preserved),
saved images, map pins, chronology, directed relationships, source IDs,
timestamps and imported-source references. Unselected link targets are marked
outside the selection rather than creating broken links. Only embedded raster
images survive; remote images are omitted and a restrictive CSP blocks remote
resources. The document can be read offline without the application.

PDF uses the existing desktop exporter and native save dialog. Browser users
can save HTML; PDF remains visible with an explanation of its availability.
Cancellation and errors are shown explicitly.

## Native bridge and MCP

- `wh_build_world_bible` is read-only and returns `html`, `filename`, `counts`,
  `generatedAt` and `projectId`.
- `wh_export_world_bible` requires `format: html|pdf`; it uses the normal export
  flow and returns success/cancellation/error. It is gated by the bridge write
  permission because it creates an external artifact, though project rows are
  unchanged.

Both accept `projectId`, `sections`, `entryIds`, `timelineIds`, `mapIds`,
`relationshipIds`, `includeSecrets` and `locale: es|en`. Project scoping and
catalogue filtering use the existing bridge contracts. The tools belong to the
`story` group and span several engines.

## Limits

This compiles records saved in the selected project. Shared-universe canon from
other books is not expanded. Generated worlds must first be saved as a Maps
entry; this export does not regenerate terrain. Timeline ordering follows the
author's existing event order and displays saved dates; it does not infer dates.
This is a reference export, not the neutral `hoard.world/1` interchange format.
It does not replace backups or change manuscript publishing.

## Verification

Run `npx electron scripts/run-world-bible-tests.cjs` for browser/UI assertions,
real stdio MCP requests through the native HTTP/renderer relay, native PDF
generation and HTML/PDF artifacts in a temporary isolated profile. The runner
uses synthetic data, an OS-assigned bridge port and no models. It does not start
the user's bridge on 8766. Native save destination selection is supplied by the
test runner, so it does not claim manual save-dialog interaction.

For visual review, start Vite in this isolated checkout on a separate port and
open `/tests/world-bible.preview.html`. It seeds synthetic reference records
under `qa-world-bible`; use a fresh browser origin/profile rather than the
author's running app. This fixture mounts the same product panel and styles.
