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

Read/list tools are queries; publish/restore use the existing write switch. Undo of a restored named-era selection hides every newly created draft atomically in that era. Publication history itself is append-only through these APIs.

## Reading links

An open edition has **Reading link for this edition**. Choose a path and a public or private-link audience and Writer's built-in host serves that frozen Reader at `/read/<path>` (the same host and optional standalone reader as wiki links, port 5184 by default). The response is the edition's HTML byte for byte: its chapters only, no other manuscript and no world canon. Editing drafts afterwards does not change what is served. **Use this path** on another edition of the same manuscript and era, then **Move the link to this edition**, keeps the address and serves the new edition. Another manuscript, another era or a stale address revision cannot take the address. **Withdraw link** makes it answer 404; the local edition stays. Home lists every reading link under **Published reading links**, including links whose project is no longer in the library, and can withdraw them.

The owner of an address is derived from the stored edition (writing scope, manuscript id and source era), never from a caller-supplied id. Reading and wiki addresses share one registry but use separate keys, so `/read/faro` and `/wiki/faro` can coexist and wiki tools never list reading addresses.

- `wh_published_edition_host_list`: addresses of the project, of one edition's owner (`editionId`) or of the whole registry (`allProjects:true`), with the recorded `ownerKey`, decoded `owner`, revision, audience and URL.
- `wh_published_edition_host_publish`: `editionId`, `slug`, `audience` (`public` or `unlisted`) and `expectedRevision` (0 for a new path).
- `wh_published_edition_host_withdraw`: recorded `ownerKey`, `slug` and current `expectedRevision`.

Tests: `node --test tests/published-editions-hosting.node.cjs` (registry, routes, CAS, tokens, coexistence with wiki slugs, cold restart and the standalone reader). There is no remote publishing dependency.
