# Table calculations — task1041/X04/X05

## Primary contract and actual gap

Checked20October2026: https://docs.beta.vvd.world/docs/formulas. Tables can author named row calculations over card properties; a row-only calculation becomes a type property automatically. Whole-column references support set calculations (SUM/AVERAGE/COUNT), which remain local to the table. Identity bindings survive renames. Whole/decimal/percent/text are display/result shapes; wrong numeric shape shows VALUE errors. Empty authored input yields an empty result. Dependencies/cycles are visible, calculated cells read-only, and calculated values participate in sort/filter/group/CSV. No cross-card or cross-table references are required by this contract.

Existing tables have manual records, A1 formula sheets, and live category views. Existing Codex has type property definitions, inert arithmetic/decision/text evaluator with identity bindings, dependency/cycle handling and shared uncached projection. Missing: concrete template/type view, calculation authoring from a table with type promotion, whole-column aggregates, result formatting, common effective table projection, normal/native APIs for these operations. Root six decimal/manual-table tools are frozen and must remain compatible.

## Smallest compatible design

- Add optional codexTemplateId to WorldTable. Legacy codexType category views retain their exact behavior; a concrete template view includes exact templateId cards and starts with its effective definitions. New cards carry the selected template.
- Add optional calculation specification to DataColumn (formula, immutable row/column reference bindings, result type). Row-only calculations in a concrete type table are saved atomically to CodexTemplate using existing bindPropertyFormulas/saveCodexTemplate and linked by property identity. Aggregate and manual-table calculations stay in their table. No output cache is stored or copied into card fields.
- Extend/export the existing inert Codex parser/evaluator for an optional whole-column lookup. Existing property formulas reject aggregate references; table projections pass a column lookup. Keep only the implemented arithmetic, decision, text and numeric functions; no full spreadsheet-library claim.
- Add optional resultType to CodexPropertyDefinition; projection returns raw value/fields plus separate displayValue. Whole/decimal/percent rendering never changes numeric inputs for Radar or API calculations. Card/edit/wiki rendering uses the shared formatter.
- Reusable operations perform table-version and template-revision CAS in one relevant rw transaction. Validate references within the mutation so deleted/out-of-project values cannot slip through a prior UI check. No global serialization of readonly queries.
- Normal UI exposes concrete source selection, Add calculation, formula bar/token insertion at cursor, result type, Enter save/Escape cancel, and persistent errors. Cancelling a new formula writes no column. Heading clicks insert a row token while formula authoring; explicit token controls insert whole columns. Existing sheets and type/category controls remain.
- MCP extends normal table bridge/manifest with concrete-view creation and calculation save/remove; get/export use the exact same projection and expose raw and display values separately. Root registers global seams.
- Clone remaps template/column bindings with the metadata cloner; property IDs remain paired with their definitions. JSON/ZIP/era/history portability use existing metadata aggregates, no separate formula storage.

## Success before implementation

- [x] Existing manual tables, decimal values, A1 sheets and category live views retain behavior/tests.
- [x] Concrete type table excludes unrelated same-category cards; editing input updates type calculations on card/wiki/API with no table open.
- [x] Row-only table calculation promotes automatically, stable across property/column renames; aggregate stays local and uses all saved/effective rows regardless view filter/sort.
- [x] Dependencies, empty inputs, cycles, missing/deleted refs and invalid result shape display errors; calculated cells reject writes.
- [x] Percent/whole formatting is presentation only; raw numeric value remains available to derived consumers.
- [x] CAS rejects concurrent table/template changes atomically without partial promotion; era-local table calculations leave Base table intact and shared type changes are explicit.
- [x] JSON/ZIP clone retains effective results and remaps identities, including own-era tables.
- [x] Normal UI1440/640 lifecycle and native MCP transport pass, with meaningful functional tests and scoped lint/type checks.

## Ownership

Root ceded tables UI/operations/new leaves and froze six existing tools. Proposed necessary small edits: codex/properties.ts and templateTypes.ts, normal property value renderers, worldMetadata.ts and worldEras/portability.ts for identity remap. No maps/localSDK/Canvas/tree/history core edits. Root owns global manifest/index and shared readers unless coordinated.


## Frozen implementation and evidence

Implemented in normal TablesEngine, tables/calculations.ts, projection.ts, additive table/type definitions and the existing Codex parser/projector. Three new tools extend the registered TABLE_TOOLS/TABLE_HANDLERS: wh_table_create_type_view, wh_table_save_calculation, wh_table_remove_column. wh_table_get returns raw table rows, displayRows and calculatedColumnIds; CSV includes displayed calculated values. Root schema supports optional Codex resultType. No output values are persisted into cards or a duplicate formula cache.

projectWorldTable(table, effectiveEntries, templates) is a pure synchronous API returning columns, raw rows, displayRows and calculatedColumnIds. It handles concrete type versus legacy category selection, effective type columns, local formula dependencies, aggregate memoization during that projection, blank results and errors. Sheets keep their existing sheetValues implementation. A adopted the shared projection for document image export; root owns embedded tool/reader/wiki integration.

- `electron scripts/run-focused-browser-tests.cjs tests/table-calculations.browser.ts testTableCalculations 250000`: PASS4groups. Concrete type distinction, automatic property promotion visible on a closed card, template/table CAS with no partial changes, local sum/share/count/scientific values, lazy decisions, blank input, aggregate of calculated column with empty rows, rename identity, percent raw/display, cycle/value/name/division/ref errors, calculated write rejection, in-transaction foreign reference rejection, Base/era isolation, normal JSON clone including own-era table and project ZIP roundtrip.
- `electron scripts/run-codex-properties-ui.cjs tests/table-calculations-ui.browser.tsx testTableCalculationsUi`: PASS3groups. Native mouse/keyboard creates concrete source, heading inserts row token at cursor, Enter saves, Escape writes no new column/property, local aggregate percent, actual price edit updates both card property and set aggregate without touching prose. Real CSS1440/640, no window overflow; grid scroll stays inside its area. Screenshots inspected in two bounded rounds; final files C:/Users/luism/AppData/Local/Temp/wh-codex-properties-ui-mrbzti/table-calculations-{1440,640}.png.
- `electron tests/table-calculations-transport.cjs`: PASS native stdio→HTTP→executor→IPC→registered normal handlers→IndexedDB. New type view/save/remove tools, closed-card formula read, local aggregate raw/display/CSV, stale CAS atomicity, full template result-format roundtrip, deleted-column REF while shared card formula remains, and era-local table creation.
- Existing `testVvdTables`:5groups PASS; existing `testCodexPropertiesDepth`:9groups PASS; existing `testTableDecimalUi`:3groups PASS at1440/640. Old category live-table read-only assertion now accepts semantic output or disabled input, preserving the actual requirement. Legacy harness emits existing act warnings; no product errors in successful paths. Expected invalid/stale bridge calls log their rejected errors.
- Renderer and Electron typechecks PASS; scoped ESLint PASS; conformance PASS34engines/63engine tables/5650locale keys.

Scope is the explicit offline contract, not a full spreadsheet library claim. Supported functions reuse the existing inert arithmetic, comparisons, lazy IF/IFS, text and numeric functions; SUM/AVERAGE/COUNT and MIN/MAX support whole-column bindings. Whole/decimal/percent/text rendering keeps numeric source values raw; percent presentation rounds to two places. Whole-column names with spaces use [Name] tokens generated by UI. No cross-card or cross-table references. Category views/manual records retain row calculations locally because they have no single concrete type. Removing a type-backed column only hides it in that table. A type property is not silently converted into an aggregate: create a separate local aggregate column instead. Existing missing/dangling legacy references remain readable; new/changed references validate atomically.

No commits, production app, real data, network model or history/store core changes. worldMetadata changes are restricted to dataTables identity/binding clone seams; edition remap and richContent history fix are preserved.


## Independent closure P2 correction

Reviewer reproduced local aggregate/title dependencies being promoted into shared properties with missing bindings. `saveTableCalculation` now promotes only when all row dependencies resolve to persistent type properties (or the new formula self-reference), and no whole-column dependency exists. Name/title and local calculated columns remain in the table. Both unchanged independent exports in tests/functional-closure-independent.browser.ts (`testClosureTableLocalDependency`, `testClosureTableTitleDependency`) PASS, as does original testTableCalculations4groups. Reviewer fixture was not edited.
