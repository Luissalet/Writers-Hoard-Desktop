# Local published editions

Open **Published editions** in Writings. Name an edition and select chapters in the manuscript's displayed order. Publishing captures their current rich prose, Reader presentation and supported local references into a standalone HTML Reader. The history records the source era, chapter timestamps and publication time. Publishing again appends an edition; previous editions stay unchanged.

Open an edition to read its frozen HTML, or download that exact file. It opens offline without Writer, its database or a bridge connection. A publication uses the existing Reader's projections and export limits; it does not turn unsupported tool projections into new interactive editors.

**Restore as new drafts** creates editable Writing documents in the current Base/era context, preserving the original drafts and edition. Restored documents receive new ids and no chapter numbers or remote Google Docs bindings. Rich local references remain ordinary references. When a referenced source has actually disappeared, the result lists its kind/id; the frozen Reader remains available with the delivered content. Restoring does not recreate other engines' documents. The interface restores the opened edition; API/MCP callers may select individual captured chapters.

Publication checks both its history revision and a fingerprint of captured sources, including actual local Blob bytes. A source edit during capture rejects the append, allowing a fresh retry. No partially captured edition is stored. JSON and ZIP preserve editions; cloning remaps editable snapshot references and Reader audio ids while keeping the frozen HTML bytes and digest unchanged. Import validates metadata structure; opening an artifact additionally verifies its SHA-256 digest.

Native MCP tools:

- `wh_published_edition_list`: metadata and current revision; optional era filter.
- `wh_published_edition_read`: snapshots and digest; `includeHtml:true` includes the file.
- `wh_published_edition_publish`: ordered `chapterIds`, title, locale, optional source `eraId` and `supersedesEditionId`, required `expectedRevision`.
- `wh_published_edition_restore`: edition id, optional captured `chapterIds`, destination `eraId` (omit for Base), required `expectedRevision`. Returns new drafts, actual missing references and the ordinary Undo receipt.

Read/list tools are queries; publish/restore use the existing write switch. Undo of a restored named-era selection hides every newly created draft atomically in that era. Publication history itself is append-only through these APIs. There is no hosting or remote publishing dependency.
