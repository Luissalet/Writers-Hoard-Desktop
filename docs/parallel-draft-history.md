# Alternative drafts, history and local editions

Each alternative draft belongs to one chapter and one Base/era scope. Successful
text replacements preserve that alternative's previous text in the same
transaction, including an empty draft. Renaming keeps its identity. Saving
identical text adds no version; stale or failed saves add no committed history.
Existing conflict-recovery snapshots remain available separately.

Open an alternative's history from its pane to inspect a version and restore it.
The list contains metadata; selecting a version loads its body. Restore checks
the chapter, draft, project, era and observed current version, then performs the
normal save. Consequently the replaced text is itself recoverable. Ordinary
chapter history excludes alternative-history rows. Canonical chapter restore
cannot consume an alternative-history row.

The local publication dialog lets each selected chapter use its canonical text or
an explicit alternative. Publishing captures that text and records its draft
identity, name and source version without promoting it into the chapter. A source
change before commit refuses the stale publication. The resulting standalone
Reader edition keeps frozen HTML/assets after the source is renamed or deleted.
Republishing starts with the earlier edition's choices and appends another edition.

JSON, full JSON and ZIP carry histories and edition choices. Cloning remaps
semantic draft references, including references to deleted originals, while
preserving immutable edition bytes. An unavailable alternative is reported; it
does not silently fall back to canonical prose.

The seven `wh_parallel_draft_*` operations expose listing, read, create, save,
history listing, history read and restore through the normal MCP bridge. Writes
use the same CAS path and session Undo receipts. Read the registered manifest for
exact operation names and required versions. Publication accepts optional
`chapterDraftIds` alongside the normal chapter selection.
