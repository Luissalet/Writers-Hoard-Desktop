# Reviewed local folder import

Open the existing folder import panel in Genealogy, then expand **Import chapters, tables and timelines**. Choose the export source and a local folder, files, or ZIP. Nothing is created until **Review import** and **Create reviewed documents**. The pane inherits the active project/era.

Markdown becomes a Codex document by default. Choose a new chapter or a Codex category/template, rename it, inspect its content, or exclude it. A selected subtype uses its effective inherited properties and calculations. Each Markdown file creates one chapter here. Use **Import manuscript** in Writings for DOCX review, heading/separator chapter splitting or explicit replacement of an existing chapter; that separate flow retains compatible revisions/comments and original files.

CSV becomes a table by default. Encoding, quote-aware delimiter, numeric decimal convention, column types and table/sheet mode use the normal Tables codec. Only explicitly numeric columns normalize decimal commas. You can instead choose Codex records or a new timeline and map the relevant columns by position. Codex record titles come from the mapped title column, not the file title. Review rows and uncheck unwanted records. Timeline dates use exact ISO dates/ranges or an explicit literal-text mode. Missing mapped titles and invalid dates are specific blocking findings. No guessed world dates, Excel serial dates or inferred Notion database relationships.

Nested paths remain significant. Relative Markdown links and Obsidian wiki links resolve against the selected manifest; one exact path wins, and an ambiguous basename is reported. Labels, inline/fenced code and authored Unicode remain text. Local admitted raster attachments referenced by included prose become embedded data images. Audio/video use ordinary Local Media and media blocks. Missing/excluded/unsupported attachments are listed. Remote images are reported and retained as text instead of fetched. HTTP links are retained without fetching their targets.

The plan is bound to source bytes, choices and relevant effective context. Edit a choice, then refresh the review before Apply. All selected destinations are created in one transaction; existing documents are not replaced. The corresponding engines must already be enabled through normal project settings. The importer never enables them automatically.

`Project.worldFolderImports` stores minimal source path/hash and created document references. An unchanged reimport is reported as already imported; changed sources or unavailable/different previous destinations are conflicts. This is not a replacement/sync workflow. Rename a genuinely distinct source path or use the normal document editor/manuscript replacement flow rather than overwriting a previous import implicitly.

**Undo batch** lasts for this session. It checks exact resulting versions and later authored references before removing anything. A conflict preserves the whole batch. Undo works after switching an engine off, consumes its receipt only on commit, and does not alter unrelated or sibling-era work. Normal document history and immutable manuscript originals remain recoverable; originals follow the existing project-deletion lifecycle. Their retention is not a second vault archive.

Normal project/full JSON, ZIP and clone carry authored content, source provenance, original chapter files and ordinary media. Clone remaps declared document/era identities and semantic links; source paths, hashes and opaque cells stay unchanged. Unsupported files are not installed, executed or silently archived.

## Native API / MCP

The same service backs the UI and these normal tools:

- `wh_world_folder_import_preview`: query, no authored writes.
- `wh_world_folder_import_apply`: recompute and atomically apply the matching `expectedDigest`.
- `wh_world_folder_import_undo`: recover one unconsumed session `receiptId` in its original project/era.

Preview/apply use `{projectId,eraId?,format,files:[{path,dataBase64}],decisions?}`. A file may be a local ZIP; its nested entries become the same relative manifest. `format` is `obsidian`, `notion`, `worldanvil` or `campfire`; the latter two retain the existing bounded Codex JSON reader. Decisions identify a source `path` and may set `include`, `target`, `title`, Codex `type`/`templateId`, CSV options/column mapping, or zero-based `excludedRows`. Apply also requires the returned digest. The pure manifest exposes the complete input schema.

The operation is local. No hosted application, remote parser, model or source-code plugin is required. It does not promise universal Obsidian/Notion interchange, arbitrary original attachment archival, imported live queries or all-to-all format conversion.

## Pasted text, PDF, Library folder and skip reasons

- **Paste text.** The panel has a *Paste text* box. A line holding only `---8<---` ends one document and starts the next. Each piece becomes a virtual `pasted.md` (`pasted-2.md`, or the chosen name) that goes through the same reader and is hashed into the plan digest like a file. Bridge: the `pasted` argument.
- **PDF.** A `.pdf` is read through its text layer; paragraphs are rebuilt from line positions and a line is a heading only when it is clearly bigger than the body text. A PDF with no text layer is not imported: the review says *this PDF is a scanned image: it needs OCR*. Password-protected PDFs are reported as protected. ePub is read by **Import manuscript** in Writings, not here.
- **Skipped files.** Every file that produced nothing appears under *Skipped files and why* with one reason: unsupported type, empty, too large, duplicate, encrypted, scanned image (needs OCR) or unreadable. The bridge returns the same `reason` on each finding.
- **Select by type.** Groups by destination and Codex category offer *Select all of this type* and *Clear all of this type*.
- **Library folder.** An optional destination folder of the document Library; created documents are filed there in the same commit, and Undo removes the placements (`libraryFolderId`).
- **Guides.** Five cards explain, in plain words and without naming products, how to export from a kind of tool, what is kept and what is dropped.

