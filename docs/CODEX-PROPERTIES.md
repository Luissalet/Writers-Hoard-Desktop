# Codex properties and synchronization

Codex templates can define text, number, ISO date (`YYYY-MM-DD`), hexadecimal color and multiple-selection properties. Values remain strings in the existing `fields` map. A multiple selection is stored as a JSON string array, for example `["Trader","Guide"]`. Presets suggest reusable choices. Invalid imported values remain visible with `#VALUE!` so the author can correct them; they are not silently rewritten.

In **Templates and types**, expand **Type, name and calculation** below a field to change its display name, type, presets or calculation. The property's `id` and storage `key` stay stable when its display name changes. Overriding an inherited default retains the inherited property's identity and type. Existing ordinary fields remain compatible and acquire deterministic legacy identities when a template is saved.

## Calculations

Use `@[Display name]` to read another property on the same card. The initial `=` is optional for card properties. Examples:

```text
=CEILING(@[Price] * @[Quantity] * @[Tax], 1)
=IF(@[HP] <= 0, "Defeated", "Alive")
=IFS(@[Level] > 10, "Expert", TRUE, "Apprentice")
=CONCATENATE(UPPER(@[Code]), " ", TRIM(@[Name]))
```

Supported operators are `+ - * / ^ & = <> != < > <= >=`; parentheses and unary signs work. Functions are `IF`, `IFS`, `AND`, `OR`, `NOT`, `ABS`, `ROUND`, `CEILING`, `FLOOR`, `MIN`, `MAX`, `SUM`, `AVERAGE`, `AVG`, `COUNT`, `CONCATENATE`, `CONCAT`, `UPPER`, `LOWER`, `TRIM`, and `LEN`. `TRUE` and `FALSE` are literals. `IF` and `IFS` evaluate the selected branch only. A declared circular dependency is still reported even when its branch is not selected.

Function arguments are scalar expressions from the same card. Whole-column aggregates, cross-card references and the complete spreadsheet function catalogue are not implemented by this property interpreter. The existing spreadsheet cell/range interpreter remains separate.

Formulas bind names to property identities on save. Renaming a display name changes the formula shown in the editor while preserving the binding. Dependencies calculate in their required order. Missing inputs leave the result empty; a zero input remains a real zero. Errors appear as `#VALUE!`, `#DIV/0!`, `#NAME?`, `#REF!`, `#NUM!`, `#FORMULA!`, `#N/A!` or `#CIRCULAR!` rather than an apparently successful blank value. Numeric properties require numeric calculation results.

`projectCodexEntry(entry, templates)` is the common read projection. It returns stable-key `fields` and per-property labels, values, statuses and a `calculated` flag. The card form, card detail, live Codex tables, wiki and native bridge use this projection. Results are computed from current definitions and raw inputs, without storing a result cache. Calculated values are read-only; edit their inputs or formula. When a template is retired, affected cards retain its effective property definitions, so formulas continue computing and can be reused when creating a new template from the card.

## Updating existing cards

Saving a template does not replace existing card inputs or body blocks. From a saved template, open **Sync existing cards**, choose the scope and prepare a preview:

- Default behavior adds missing input fields and fills bodies containing no text, media or tool content. Existing empty field values are preserved as authored choices.
- **Reset selected values** explicitly resets only the selected stable keys.
- Body handling can keep, fill empty, append default blocks or replace the whole body.
- Including subtypes uses each card's effective inherited defaults.

The preview lists fields added, reset and preserved, plus body changes. Applying rechecks the card data and all template revisions in the write transaction. If something changed after preview, no partial updates are applied; generate another preview. Updating definitions, dependencies and calculated values does not require synchronization because the read projection already uses the current schema.

## Native API / MCP

- `wh_codex_templates`: raw and effective templates, including property identities and formula bindings.
- `wh_save_codex_template`: create with `expectedRevision: null`; edit with the current revision. The complete typed schema, defaults, inheritance, references and presentation are supported.
- `wh_delete_codex_template`: retire with the expected revision while preserving cards and their live property definitions.
- `wh_preview_codex_sync`: obtain a complete synchronization preview.
- `wh_apply_codex_sync`: pass that preview unchanged, with its project id, to apply it.
- `wh_create_codex_entry` accepts `templateId` and applies inherited defaults.
- `wh_get_codex_entry` returns projected fields/properties and separate `storedFields`; `wh_list_codex` also returns projected values. Updating a calculated field directly reports an argument error.

## Verification

```powershell
.\node_modules\.bin\electron.cmd scripts/run-focused-browser-tests.cjs tests/codex-properties-depth.browser.tsx testCodexPropertiesDepth 180000
.\node_modules\.bin\electron.cmd scripts/run-codex-properties-ui.cjs
```

These tests use isolated Electron profiles and synthetic records. They cover raw data compatibility, typed values, renames, inherited identity, chained dependencies, cycles, visible errors, cloning, retiring and recreating types, sync conflicts, native renderer bridge handlers, wiki and table projections, and real GUI authoring/preview/apply. The layout runner compiles the actual product stylesheet and captures desktop and narrow desktop windows; it does not establish mobile app support or model quality.
