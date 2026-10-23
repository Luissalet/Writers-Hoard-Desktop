# Five live table-filter differences — Writer1095

Baseline `e75aabe22ba63cb73708d117e7aa60bbb859def9`, following the reviewed source-index/Undo/CoC delivery. This is a small additive change to the existing table query, not a new table engine or new MCP endpoint.

## Observed reference and Writer difference

On23October2026, Browser controlled the real authenticated Brave tab1069624653 and opened VVD Table0.1.37's live preview. No tool was installed in the real world and no map/card data was edited. Numeric sorting of the sample population produced900,1750,2450,3200,8100. A lower bound2000 kept2450,3200,8100. The inclusive upper bound2450 kept900,1750,2450; grouping the result by allegiance showed one group with two rows and one with one row. Prefix G selected Greyvale, suffix ford selected Rillford, and excluding Rill retained the other four records.

Writer's isolated Browser project imported a synthetic CSV through Import CSV, explicitly choosing Number for Population. It reproduced numeric ordering, but its real filter selector lacked inclusive bounds, negative containment, prefix and suffix. This observed difference produced the five additions below. The reference's advertised card-linked row editing remains a separate live comparison; its descriptive text is not proof that it was exercised.

## Implementation

Three production files only: `tableEdits.ts` adds `notContains`, `startsWith`, `endsWith`, `gte`, `lte`; `copy.ts` supplies EN/ES labels; `bridgeManifest.ts` imports the same pure operator list for the existing `wh_table_query` schema. The UI and bridge validator already consume that list. All nine old operators remain.

Text matches existing contains behavior: case folding without stripping accents or trimming spaces. Inclusive comparisons use the existing numeric comparator for two nonblank finite numeric strings and its natural text fallback otherwise; blanks do not silently become zero. Equality boundaries2450,02450 and0 are covered. Filtering is read-only and does not persist a new view, change cells, add limits or alter formulas.

## Verification and limits

Author RED: normal CSV import followed by registered `wh_table_query` rejects the absent operation; actual UI lacks its option. GREEN: the same real stored-table/dispatcher cases pass2groups; actual TablesEngine EN/ES passes2groups. Legacy table-edits5groups and plain-Node manifest2groups pass. The independent reviewer repeated all11groups on the frozen sources and found no actionable issue. Root additionally repeated the original table engine5groups and all-card-types2groups, including actual Codex record updates through three-way merge. Renderer types and ESLint3sources pass. Reports/logs: `_stage/table-next/RESULT.md`, `REVIEW-independent.md`, `operators-red.log`, `ui-red.log`, `review-*.log`, `root-vvd-tables.log`, `root-all-types.log`.

Actual Writer Browser after reload: >=2450 returns2450/3200/8100; <=2450 returns900/1750/2450, including the boundary in each case. Prefix ha selects Harbor, suffix ord selects Ford, and negative containment or selects Watch/Deep. The imported data remain intact. Captures: `_stage/table-next/vvd-table-filter.png`, `writer-inclusive-filter.png`, `writer-text-filter.png`. Desktop1280×720 only; lower table rows use the incumbent scroll area, so AX results complement the screenshots.

The existing real stdio host initializes and lists931tools but retains the old nine-operator schema. `review-mcp-existing-result.json` explicitly records `finalSourceCertified:false`. The final new operators are verified through the product's registered dispatcher, exact normal schema and UI, **not** claimed as a successful call through that cached stdio instance. No rejected host restart/new-host action was retried. The previously recorded full781groups/178suites and critical396 belong to the preceding delivery; the11+7focused group invocations here are separate, overlapping area tests, not a new full run.

Exact source commit, CAS review and clean-main build/integration receipts are recorded in Ágora1195. No push, model, external paid API, installed app update or task closure.
