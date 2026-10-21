# Regional CSV in tables and sheets

**Import CSV** opens a preview before saving a new document. Automatic detection handles UTF‑8, BOM UTF‑16LE/BE and comma, semicolon or tab separators outside quoted fields. When separators are ambiguous, choose one. If the bytes are not recognized, choose their original encoding: Windows‑1252 or GB18030, or explicit UTF‑8/UTF‑16. Encoding is a choice about the file bytes, not its language.

Columns initially use Text. Choose Number for columns whose values should become numbers, and select the numeric decimal separator. Decimal comma conversion requires semicolon or tab as the field separator. Text columns retain commas, leading zeros, spaces and quoted line breaks. The importer does not infer thousands separators. Invalid numeric values, malformed quotes or unequal row widths prevent importing the document; empty cells are valid. Table and sheet are explicit document modes.

Imported documents use the current Base or era context through the ordinary table operation. Import always creates a new document. Existing table calculations, projections and cell conflict checks are unchanged.

**Export CSV** offers field separator, numeric decimal separator and actual output encoding. UTF‑8 and UTF‑16LE include a BOM; Windows‑1252 rejects characters it cannot represent. Calculated/live values use the existing effective projection. Numeric columns export numeric negative values without a text apostrophe; the existing spreadsheet control-text protection remains for text. CSV does not preserve column types, ids or formula definitions; use project JSON/ZIP for a lossless project backup.

Native MCP uses the same parser and byte codec:

- `wh_table_preview_csv`: query; supply exactly one of Unicode `csv` or file-byte `base64`, plus optional `encoding`, `delimiter`, `decimal`, `columnKinds` and `mode`.
- `wh_table_import_csv`: mutation with those options and `title`; returns the new normal table/sheet. `eraId` selects destination context.
- `wh_table_export_csv`: query with `tableId`, optional separator/decimal/encoding; returns Unicode `csv` and actual encoded bytes as `base64`.

`delimiter` accepts `,`, `;`, tab (and `auto` for import). `columnKinds` is one `text` or `number` per column; omitted means all text. Input encodings: auto, utf‑8, utf‑16le, utf‑16be, windows‑1252, gb18030. Export encodings: utf‑8, utf‑16le, windows‑1252. Other encodings require converting the source file; no heuristic promises support for every historical Excel encoding.
