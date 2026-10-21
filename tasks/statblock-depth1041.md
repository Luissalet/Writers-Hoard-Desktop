# 5e stat block depth —1041: contract before implementation

Status: **root approved implementation, with CR0 default10 for new sheets; explicit0 remains available**.

## Evidence and gap

Root's authenticated live reference, opened individually here:
`C:/Users/luism/Documents/Codex/2026-10-20/fun-with-qwen-image-2-x20/outputs/vvd-reference/statblock-cr17-live.png`.
Changing the reference preview from CR0 to17 visibly gives XP18000 and PB+6. Root did not create a world document. The preview lists traits/actions/bonus/reactions/legendary/lair/mythic authoring. This is evidence for the observed operation and list, not every upstream rule or an asset licence.

Primary source browsed before planning:
[D&D Beyond Basic Rules: How to Use a Monster](https://www.dndbeyond.com/sources/dnd/br-2024/how-to-use-a-monster), “Experience Points by Challenge Rating” and “Proficiency Bonus by Challenge Rating”. It specifies fractional CR1/8,1/4,1/2, integer CR1–30, and two legitimate XP values for CR0. CR17 is18000XP/PB+6. This implementation uses the numeric table and existing Writer mechanics; it copies no monster prose, reference paper, illustration or proprietary lettering.

Current Writer already has six presets, typed full sheet forms, CR-based PB (and manual PB override), named skills/saves, resources, authored narrative rows, Save/revision CAS, Base/era, generic history/Undo, JSON and fixed-coordinate ink. XP is only the freely authored `numbers.experience`; paper is one complete generic record containing all default tables. Preserve these functions and values.

## Proposed additive data/XP contract — approval requested

1. Add optional `paperLayout: 'record' | 'stat-block'` to CharacterSheet. **Absent means the current record layout**, for every existing/imported sheet. `createSheet('5e-stat-block')` explicitly chooses `stat-block`; other presets keep their current defaults. Stat-block layout is valid only for that preset. Existing sheets opt in through a normal Paper selector and Save; neither loading nor a read migrates them.
2. Add optional stat-block-only `statBlockXp: {version:1;zeroCrXp:0|10;override?:number}`. Newly created5e stat blocks receive `{version:1,zeroCrXp:10}`, as root explicitly approved to match the authenticated preview. The zero choice is always explicit in the UI when CR0 is selected;0 remains available under the official rule.
3. **Legacy XP compatibility:** when statBlockXp is absent, effective XP remains the existing `numbers.experience`, including an authored0. The new automatic CR result is still readable separately. “Use CR XP” explicitly adds statBlockXp without modifying numbers.experience. With config present, effective XP is its override when supplied, otherwise the table result. Enabling a manual override seeds it from the current effective result; disabling removes only the optional override. `numbers.experience` is never overwritten/deleted, remains editable in the full form, and is labelled as the recorded legacy value when automatic mode is active.
4. A pure `statBlockDerived(sheet)` in a small character-sheets leaf returns raw CR, supported CR/automaticXP (or null), effectiveXP/source (`legacy|cr|override`), zero-choice and existing `sheetProficiency(sheet)`. Use exact membership in `[0,1/8,1/4,1/2,1…30]`; no rounding unsupported decimals or clamping CRs into the ladder. Invalid/unsupported CR retains its authored value, has no automatic XP, and shows that limitation. An explicit manual XP can remain usable. Do not tighten old sheet validation to reject previously valid authored CR or experience.
5. The new override is an explicit nonnegative integer using the existing sheet numeric bound, not an unlimited arbitrary expression. Legacy experience remains subject only to its existing validation. PB continues to use the existing function/override; this task neither changes PB rules nor manufactures other monster rules.
6. The pure projection serves StatsPanel, compact paper and additive `derived.statBlock` on wh_sheet_get (and create/update results where practical). `.sheet` remains the normal stored editable sheet; computed XP never becomes a cached number in storage or JSON. Existing wh_sheet_update uses its normal revision and full sheet to author config/layout. No new service, global active era or independent revision store.

Root accepted item3: preserve old manually authored effective XP until the user opts into CR calculation, instead of silently changing old sheets to automatic XP. Root selected10 as the initial CR0 value, with0 available explicitly.

## Compact original paper

Keep the legacy record renderer intact behind its existing branch. Only an explicit `stat-block` layout calls a new local stat-block renderer. Both use the same original1000-unit continuous SVG paper, escaped authored strings, wrapping and existing ink renderer. The paper’s art, type and structure are Writer's own; no source screenshot/raster is shipped.

- Title and authored size/type/alignment; AC, current/max HP, temporary HP, authored hit-dice text, speed and existing initiative result. HP/resource tracks show stored current/max and marked semantics, not a new damage system.
- Six canonical abilities in one horizontal strip, with score and existing abilityModifier. Authored extra traits remain in a labelled additional section. Retain configured save/skill bonuses from the existing mechanic; no invented proficiencies or guessed expertise.
- CR, effectiveXP with its source/override and PB. Defences, senses, languages, gear/other authored nonempty details use compact labelled lines. No spells, classes, spell lists or creature abilities are generated.
- Narrative groups in familiar task order: Traits/Features, Actions, Bonus actions, Reactions, Legendary actions, Lair actions, Mythic actions, then other authored sections. Accept ES/EN aliases for grouping only; retain original section text/content and within-group order. Every row is included, including its expression and quantity when present. Add those section suggestions to the existing RowsPanel, with no separate action engine.
- Existing full forms, raw numbers/details, all resources/skills/rows/rolls remain available. The compact paper suppresses empty/default character-only scaffolding, while keeping authored nonempty/custom material and roll history in later compact sections rather than losing them. The existing Record layout remains the exhaustive tabular view. No first-N content cutoff.
- Paper layout selector lives outside the scaled paper in SheetPaper. Changing it dirties the ordinary draft and is saved/discarded through existing controls. With ink present, a visible explanation says the text layout changes while ink stays at fixed coordinates; do not relocate, erase or resample any old stroke. Switching back to record must reproduce its prior content geometry and exact ink operation data. This is an explicit user action, without a new approval gate.
- Normal Reader/wiki/portable/PNG paths already call sheetPaper; use that shared entry point to carry the selected layout. Do not edit general ReaderExport, maps or independent consumers.

## Owned paths and implementation sequence

After root approval only:

1. Add pure XP projection/table and its meaningful tests; add optional validated fields and new-preset defaults in types.ts, retaining old imports/exports.
2. Wire the normal StatsPanel controls/results and additive bridge get/update metadata; update bridgeManifest descriptions/schema without central registration changes.
3. Add the compact local renderer, branch paper.ts without altering the legacy branch, add explicit layout control in SheetPaper and row section suggestions in RowsPanel.
4. Run native UI, transport and artifacts, inspect desktop/narrow together once; batch material corrections at most once and confirm once. No generic polish hunt or another detector.
5. Record evidence and limitations; freeze sources for root's independent review and broad integration. No commits by this subtask.

Candidate new leaves: `src/engines/character-sheets/statBlock.ts` (table/projection) and `statBlockPaper.ts` (specific SVG composition), keeping legacy paper.ts small. Existing owned seams: types.ts, StatsPanel.tsx, SheetPaper.tsx, RowsPanel.tsx, bridge.ts, bridgeManifest.ts and their character-sheet docs/tests. No DB schema migration, general ReaderExport or map edits.

## Success criteria before code

- [x] Every official XP ladder entry tested against an independent expected table, including fractions, CR0 choices,17/30; unsupported values return no fabricated table result. PB transitions stay unchanged and manual XP/PB overrides behave explicitly.
- [x] Legacy sheet without new fields retains numbers.experience and effective XP; enabling/disabling automatic/override never destroys that value. New defaults do not mutate existing imported records.
- [x] Legacy paper/ink geometry stays unchanged without explicit opt-in, including long content/low ink strokes. A fixed fixture has the same SVG outside the pre-existing random mask prefix and the same decoded pixels/ink operations; layout roundtrip restores it.
- [x] Actual1440/640 CharacterSheetsEngine native pointer/keyboard edits CR/fractions/zero-choice/override, switches paper deliberately, saves/reopens and retains full form controls. Long rows wrap; paper has all final-content markers and no window overflow.
- [x] Actual external stdio→HTTP→executor→IPC sheet_get/update sees the same derived projection; stale revision and malformed new config reject without changes. Named-era updates leave Base intact; ordinary audit Undo/history retains complete layout/config/ink.
- [x] Per-sheet export/import, project JSON/clone/fullJSON/ZIP preserve optional metadata and old authored experience; profile/source IDs remain normal existing semantics.
- [x] Normal ReadingView and a fresh standalone Reader/wiki with HTTP blocked show the compact paper; native document PNG uses the same layout/ink and includes all authored final markers/tiles. Existing record preset and ink regressions remain intact.
- [x] Relevant RPG/CoC/sheet/ink regressions, scoped lint and renderer/electron checks complete with exact evidence. No global parity claim, hardware pen trial or fabricated monster rules.


Implementation complete in scoped paths. Evidence: .impeccable/statblock-depth-{transport,ui,typecheck,lint,functional}.log, statblock-{rpg-regression,coc-regression,rpg-logic}.log. The native audit Undo seam was specifically ceded by root and uses local opaque receipts with transactional version/scope checks; first era variant Undo restores Base inheritance. Post-freeze report and hashes: projectless work/worldcraft1041-statblock-depth.md. No commits; awaiting root independent review/integration.
