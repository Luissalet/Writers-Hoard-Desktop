# Daggerheart adversary editor

## Normal use

In Character Sheets, open a **Daggerheart adversary** and choose **Play** (**Partida**). The Tier selector offers 1, 2, 3 and 4 and displays party level 1, 2–4, 5–7 and 8–10 respectively. A previously saved free-text adversary type remains a selected option until the author explicitly chooses another value. An older tier outside 1–4 stays visible until replaced; opening the sheet does not normalize or save it. The combat fields include difficulty, major and severe thresholds, attack modifier, standard attack, range and damage, alongside description and motives/tactics. HP and Stress still use their existing contiguous marks and resource capacities.

Add an **Experience** with a name and signed integer modifier, or a **Feature** with a name, Passive/Action/Reaction and text. Save explicitly in the current Base or era. Existing generic rows remain in their ordinary editor; there is no automatic conversion into typed rows. The player-character class path is separate.

Paper shows the party-level range, signed experience modifiers and feature categories. The ordinary details and rows still contain authored text. Portable sheet JSON keeps the row IDs and typed values. The extra Paper sections follow the existing content. Drawing, erasing and undoing ink keep the content at the same coordinates; the ink layer can extend the overall paper height.

## MCP contract

Read `wh_sheet_get` with `projectId`, `sheetId` and `eraId` for an era. Reuse the returned stored `sheet`, keep the sheet ID, preset and existing row IDs, apply the change and send the full sheet to `wh_sheet_update` with the current revision and the same project and era. Tier and type use `numbers.tier` and `details.adversaryType`. On a Daggerheart adversary only, optional `rows[].daggerheartAdversary` accepts exactly one of:

- `{ "kind": "experience", "modifier": -2 }`: a signed safe integer.
- `{ "kind": "feature", "category": "reaction" }`: `passive`, `action` or `reaction`. The row's `name` and `detail` carry the name and text.

Rows without this field stay generic. Invalid metadata or a stale revision refuses the update. The existing sheet writer, era handling, normal Undo and JSON export/import are used; there is no additional tool or implicit conversion. An era edit does not overwrite Base.

## Observed reference and limits

`REFERENCE-DAGGERHEART-ADVERSARY-r1.md` records the public VVD Daggerheart Adversary 0.1.3 demo: Tier 3/Horde displayed levels 5–7, HP 4 and Stress 3 supplied their respective slots, and the third HP and second Stress buttons set contiguous marks. The experience modifier and feature category were distinct fields; Reaction was exercised. The group ranges were checked against the official SRD during the reference pass. The demo reset on reload; its world-writing actions were not used. `BRAVE2950-r1.md` records the previous Writer baseline: it already supported identical marks, numeric tier and a free-text type, but not a tier range or typed experience/feature controls in Play.

This delivery covers authors entering local adversaries. It does not add a compendium, adversary or environment catalogue, domain cards, automatic feature effects or full rules/SDK parity.

## Attributed verification

Receipts are in `Research/writer-parity-20261110/sdk-nonadditive-reference/`.

- Earlier r1: four scoped Brave checks and a separate real Brave wide/narrow/player-character UI observation. The two-key Electron Native r1 receipt `native2985/run-20261112T015746Z-a04c31b8/RESULT.json` records 12 IPC replies, stale and invalid rejection, era Undo and transport cleanup; SHA-256 `3b931d4e07a38cd4715dab23d2e5764697693e9bd303bb36286dad17383cfa35`. These are historical r1 observations, not final-source runs.
- `BRAVE-RED2985-r2.md`: on candidate r1, drawing or erasing ink displaced the feature heading in the real renderer. This is separate from #2950's earlier missing-editor baseline.
- `BRAVE-GREEN2985-r2.md`: five final Brave checks cover opening the older Tier 6 and free-text type without writing, typed edits and exact preservation of the generic row, JSON and EN/ES Paper, the same heading coordinate through draw/erase/Undo, and scoped MCP edit plus stale/invalid refusal. The recorded visual pass used r1 Play code identical to r2: the document fit the available 2107px and 703px widths, save/reopen kept the authored data and the player-character control kept its manual Evasion override. That earlier visual pass does not recheck r2 ink. Two older UI functions timed out without their native event controller and are excluded from the pass count.
- `NATIVE2985-r2.md` and `native2985/run-20261112T020325Z-f809e1d0/RESULT.json`: two real MCP stdio keys and production Electron IPC, with 13 tool calls and one HTTP Undo (14 IPC replies). Base and inherited/independent Past, stale and invalid rejection, JSON export, era Undo and the live view were checked. A real bridge stroke left the feature heading and rows unchanged. Both keys revoked with HTTP 401 and no IPC; the sessions ended, the port closed, the 89 fixture tables were empty and the profile was retired. SHA-256 `2eb5344dcabc201c2c95fcef568bc5be9016e7d22161f20ca0857afef109831a`. `NATIVE-INPUTS2985-r2.log` confirms seven of the eight frozen paths in the packaged runtime or focal fixture; the existing native UI test selector was reviewed separately.
- `VERIFY-QUICK2985-r2.log` and `BUILD2985-r2.log` both ended with exit 0. Conformance reported 34 engines, 64 engine tables and zero known warnings; production build completed in 2m 1s.
- `MERGE2985-RESULT-r1.json`: #2985 was approved at exact submission revision 1 and fast-forwarded from `fc643c1a4a6312ea604c44fc2a28a25e947724e2` to `28d029bb6dbcf703f420f44ae5556e99d8c28a6d`. Root verified the eight paths and preserved unrelated work. `MANUAL2985-r1.json` separately verifies Root's 232-character manual update. No push.
