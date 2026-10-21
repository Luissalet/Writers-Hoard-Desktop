# Daggerheart class workflow — 1041

## Evidence and scope before implementation

Root authenticated DaggerPC 0.1.9: nine core classes; choosing Wizard at level 4
filled Evasion 11 and the titles Prestidigitation, Strange Patterns and Not This
Time. Root manually set HP 7 and Hope 3 to test contiguous tracks/fullscreen;
those values are **not** evidence of automatic level-based HP. DaggerNPC tier 4,
HP 3 and Stress 2 were also authored/observed. No additional adversary rules are
inferred from these gestures. R01/R02 are separate 5e variants, unaffected by
this Daggerheart change; existing 5e/statblock/CoC tests remain regression gates.

Actual Writer before: types.ts supplies blank freeform class/subclass/domains,
generic Evasion 10, level/tier/proficiency numbers and editable resources.
RowsPanel has authored rows but no class dataset. ResourcePanel has numbers,
increment/decrement and progress, without contiguous slot buttons. SheetEditor
has a CoC Play tab only. Complete authoring, duality rolls, damage application,
sheet CAS/drafts/Base/era/receipts, paper/ink/JSON already exist and remain.

Primary sources checked 2026-10-21:

- https://www.daggerheart.com/srd/ identifies SRD 2.0, 25 August 2026.
- https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf
  distinguishes nine core classes from four Hope & Fear classes (pp.7–8), and
  gives class data on pp.10,14,19,20,22,24,25,28,30 (PDF page numbers).
- https://darringtonpress.com/license/ and linked current DPCGL 2.0:
  https://darringtonpress.com/wp-content/uploads/2026/08/DPCGL_2.0_AUG_26_2026.pdf

Facts to encode, not prose transcription: Bard 10/5, Druid 10/6, Guardian 9/7,
Ranger 12/6, Rogue 12/6, Seraph 9/7, Sorcerer 10/6, Warrior 11/6, Wizard 11/5
(starting Evasion/HP). Domains and class/Hope feature titles come from the same
current class entries. No class item, subclass, spell, ancestry, expansion,
level-up or combat-effect catalogue is included. Feature rows contain titles,
original short reference notes and exact source links/page provenance.

Repository currently links SRD sources but no full DH attribution notice was
found. Record source/version/modification provenance and factual scope. DPCGL
recognizes SRD 2.0 but public permitted-format/VTT restrictions remain; adding
attribution is **not** a claim of general distribution permission. The license
excludes private non-commercial play from public Sharing. No proprietary
illustration, copied paper/card, logo or long rule prose is introduced.

## Ownership

This author owns bounded changes inside character-sheets: types, SheetEditor,
StatsPanel if needed, ResourcePanel/RowsPanel only where required, local helper
and Play UI leaves, bridge/bridgeManifest, source notes, scoped tests and runner.
Existing generic paper needs no geometry change: stored class fields/rows already
flow into complete paper, Reader/wiki/PNG. Root owns global manifest/index and
undo.ts. No tree, map, generic Reader/export, portability implementation or
root metadata changes. README update is deferred to the final documentation pass.

## Contract

1. Add an original Daggerheart Play tab for PC/adversary, retaining every full
   form tab. PC has the nine-core selector, current metrics and feature list;
   adversary exposes its existing authored tier/attack/thresholds and resources,
   with no fabricated class application. Existing dice/damage actions remain.
2. Selecting a class only previews differences. A visible Apply action commits
   explicitly selected fields to the existing draft: class, domains, Evasion,
   optional starting HP, feature references. Custom nonempty/changed values are
   unchecked by default. HP starting capacity is explicit; changing class or
   level never resets played HP, Stress, Hope, armor, traits or advancement.
   Preview shows any requested HP clamp before applying it.
3. Optional versioned per-sheet Daggerheart class metadata records source class,
   applied field baselines and generated-row snapshots. No migration/read write.
   Class replacement removes only earlier generated rows that are still exact
   snapshots; edited rows and all unrelated/unknown rows survive. Matching
   authored feature names are retained instead of overwritten. Reapply is
   idempotent where the data is already equivalent. No refs to outside entities.
4. Compact resource slot rows represent exact current counts, contiguous from
   the first slot, with accessible native buttons and numeric status. Existing
   resource max/current editors stay available. Custom large/fractional maxima
   retain numeric controls rather than fabricating/truncating slots. PC HP7,
   Hope3 and adversary HP3/Stress2 are persisted authored data. No resource count
   is inferred from level or class.
5. A shared pure helper powers preview/apply/resource changes and derived read
   projection. Normal `wh_sheet_daggerheart_preview` reads current sheet plus
   nine-core source data/differences. Normal `wh_sheet_daggerheart_action`
   supports explicit apply-class fields and resource current, validates preset,
   revision and arguments, then uses existing write/save/receipt transaction.
   Existing sheet get adds derived.daggerheart without rewriting stored data.
   No-op is explicit and creates no revision/audit receipt. Root adds the new
   action name to the existing receipt Undo allowlist; host arrays already
   register SHEET_TOOLS/SHEET_HANDLERS.
6. Optional class metadata remains in portable sheet JSON v1, Project JSON clone,
   full JSON/ZIP and era documents. Validation rejects malformed class metadata
   before writes. Existing sheets lacking it remain byte-equivalent until an
   explicit author action. Base/first-era/inherited/own-era/stale/scope and
   normal API Undo retain current contracts.

## Success and gates

- Independent source fixture verifies all nine starting values and exact Wizard
  feature/Hope names against current primary pages. Pure tests cover safe defaults,
  preview cancellation/no mutation, custom Evasion/HP/row preservation, repeated
  apply/no duplicates, class switch with edited rows, invalid metadata/arguments.
- Real CSS/native pointer and keyboard at1440/640: select Wizard at level4,
  preview/apply Evasion11/features while authored HP7/Hope3 remain; custom18
  stays until an explicit checked replacement; cancel creates no draft; contiguous
  tracks, save/reopen, adversary tier4 HP3/Stress2. One bounded visual batch,
  one material fix if necessary, final confirmation only.
- Actual external native MCP: registered preview/action, shared results, stale
  CAS/preset/project scope, Base and two era provenance cases, normal receipt
  Undo newer-write refusal/single-use/outer-abort behavior. No fake direct-only
  transport. Standalone JSON/clone/full/ZIP plus paper/native PNG retain data
  and source titles; old paper/ink coordinates and legacy sheets are unchanged.
- Existing RPG/statblock/CoC scoped regression tests, lint and app typecheck.
  Freeze source hashes and logs/captures in a separate report/provenance for
  independent review. No commit, push or product/reference parity claim.

Root authorized this bounded implementation after the initial source/license
findings, with minimum mechanics/titles/links and explicit overwrite preview.

## Executed bounded verification

- Core3 and actual external native4 groups PASS; desktop/narrow native UI2 PASS.
- Rerun RPG pure5, six-preset UI6, statblock3 (including exact former paper SHA)
  and CoC8 regressions PASS; scoped lint and app TypeScript PASS.
- Root clarified NPC3/2 are capacities, with1mark each. Final fixture/UI/native
  paper now test exactly those capacities and marks. Wizard startingHP5 is an
  explicit selected action, preserves2marks, and real receiptUndo restores7.
- Native common executor logs even noChange writes; no new sheet revision or
  sheet receipt is created. Its generic audit handle refuses Undo without a
  receipt. No global executor change was introduced.
- Prior receipt remains stale after any newer revision, even after Undoing that
  newer edit. Tests respect this existing version-bound contract rather than
  assuming multi-level content-based Undo.

One bounded functional fix after visual batch: an explicit Apply on a sheet
withoutHP or with500authoredrows had a pure validation rejection but no local
UI error. The dedicated unchanged native limit oracle reproduced FAIL, then
PASS for both cases after a local message/catch; no draft write or lost preview.
This does not change the successful-flow rendering or any rule/helper result.
