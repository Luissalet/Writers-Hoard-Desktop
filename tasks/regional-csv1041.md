# Regional CSV —1041 plan and acceptance

Q17 is frozen first. Primary contract: [VVD changelog September14,2026](https://vvd.world/whats-new), semicolons, decimal commas and older Excel encodings. This is a manufacturer announcement, not an authenticated import experiment by this agent.

Extend the existing Tables parser/normal operation, not a second importer. Existing parseCsv/importCsv/tableCsv defaults stay compatible. Add quote-aware delimiter detection for comma/semicolon/tab; ambiguous input requires an explicit selector. Read bytes using fatal UTF8/BOM UTF16LE/BE detection; undecodable bytes require an explicit legacy encoding, avoiding silently guessing Chinese as1252. Offer explicit windows1252 and GB18030 through the browser's normal TextDecoder; no downloaded library. Export UTF8/BOM UTF16LE/windows1252, rejecting unrepresentable characters rather than corrupting them.

Preview keeps original cell text. Only columns explicitly marked number normalize decimal commas, and only with a non-comma delimiter. No thousands-separator guessing, prose rewriting or formula auto-execution. Reuse existing quote/newline/escaped-quote parser and width validation; malformed/missing cells leave storage untouched. Sheet import is an explicit mode; imported source text remains source text until an explicit type selection.

Normal UI: file selector → preview/options (encoding, delimiter, decimal style, table/sheet, per-column text/number) → import through addTable with effective era. Export options use the existing projected/computed rows. Native query preview/import mutation/export share the exact codec/parser. Preserve calculation/projection, existing CAS and JSON/ZIP shapes. No table replacement on import, no new revision model.

Acceptance before freeze:

- [x] UTF8/UTF16LE/BE/1252/explicit Chinese bytes; unsupported/ambiguous encodings explain selection; export actual byte roundtrip.
- [x] Quoted delimiters/newlines/escaped quotes, malformed records/unequal widths, empty cells, mixed prose/decimal columns and comma delimiter restrictions.
- [x] UI1440/640 native pointer/keyboard file import/preview/options and exported bytes; actual MCP external route, Base/era isolation, existing cell CAS, malformed no partial writes, JSON clone.
- [x] Existing table/calculation suites, scoped tsc/lint/diff and durable report/canonical captures. No real profile/servers, commits, other engines or shared manifest/index changes.

Own src/engines/tables CSV seams and tests. Root owns global wiring if needed; TABLE_TOOLS/HANDLERS arrays already registered normally.

## Freeze evidence

Functional3groups, actual external native transport1group, normal UI1440/640 2groups and previous Tables/Calculations9groups PASS. Source ESLint/scoped whitespace PASS. Final renderer tsc reports only concurrent Board graph/merge.ts parameter-property TS1294 (two), no CSV errors; parent handles aggregate. Byte-level inspection of the actual UI download confirms UTF16LE BOM, numeric3,75, original Müller €, text commas and quoted newline. No OS chooser/native select-popup proof claimed: fixture File enters normal change handler and option selection uses ordinary change events; import/export/cell input use native pointer/keyboard. All six final screenshots inspected. See work/worldcraft1041-regional-csv-depth.md.
