# Character sheets: offline play and authoring

Six existing presets remain independent. CoC 7e adds a compact Play tab; other presets keep their existing authoring, resources and dice.

## Paper and ink

Every preset also has an optional **Paper** tab. It is an original complete
vector document; the existing editable form tabs remain available. Draw with
pen or marker, choose colour/width, erase earlier ink, and undo the latest ink
operation. Pen events retain pressure. **Done** returns to ordinary scrolling;
**Save sheet** commits the drawing with the existing draft/conflict workflow.

The surface `paper-v1` is 1000 logical units wide and scales uniformly with the
window. Coordinates stay on the paper; editing text can move that text beneath
existing marks. Height includes complete rows/details and ink below the text.
No licensed paper/template or reference asset is included.

Optional `ink.version=1` stores ordered strokes inside existing sheet JSON v1.
Erasers mask earlier ink only, so later writing remains visible. Undo removes
the latest operation, including an eraser, and survives save/reload. Ink does
not change traits, resources, rolls or rule calculations. Base/era variants,
JSON import/export, project JSON clone and project ZIP preserve it.

Normal ReadingView, standalone Reader/wiki and Library PNG use the same complete
SVG paper renderer, including ink. The paper replaces the older truncated
trait/resource reader summary. Typed validated sheet data is rendered afresh;
cached arbitrary HTML is not trusted.

`wh_sheet_ink_action` accepts `projectId`, optional `eraId`, `sheetId`, current
`revision`, and `action:draw|erase|undo`. Strokes use `points:[{x,y,pressure?}]`,
`width:1..24`, hex `color`, and draw `tool:pen|marker`. x is 0..1000, y is
nonnegative. The operation uses the same normal validation/CAS/save. Existing
`wh_sheet_get`, update, import and export also retain ink.

## CoC workflow

1. Create a CoC sheet, name it, and edit characteristics/skills in Traits & skills. Automatic secondary values update while editing; no initialization button is required.
2. Use Play for percentile rolls (normal/half/fifth), current HP/MP/SAN/Luck, damage, recovery, SAN loss and pending CON/INT checks. Successful eligible skills receive one development mark. Combat, SAN and Luck rolls cannot be pushed.
3. A failed characteristic/skill check can be pushed once with a justification agreed with the Keeper. Original and pushed rolls remain linked in Dice & history. The Keeper resolves narrative consequences.
4. Resolve marked skills during development: d100 above the rating or above 95 adds d10, then clears the mark. Credit Rating and Cthulhu Mythos cannot be marked.
5. Select 1920s/Modern; Modern enables Electronics and Computer Use in Play. Switching back preserves their authored values. Pulp changes HP to floor((CON+SIZ)/5) and omits age reduction to MOV; other Pulp talents, optional Luck rules and combat variations remain authored notes.
6. Expand Calculated values to override/reset one value. A manual override persists across characteristic changes. Current played resources are preserved, clamped to the new maximum when necessary. A resource already full follows a growing maximum. SAN current is never reset merely because POW changes.
7. Save to commit the draft. Local recovery, save-as-new, CAS conflict handling, portable JSON, project clone and Document archive retain CoC state and roll history.

HP single-hit thresholds drive major wound, unconscious/dying/dead states. Pending CON checks resolve consciousness or survival per round; first aid stabilization is explicit. SAN loss of 5 queues INT (success causes temporary insanity for d10 hours); losing one fifth of the day-start SAN triggers indefinite insanity; zero marks permanent insanity. Start new day resets only the daily tracker, preserving current SAN and conditions. Keeper condition adjustments are explicit.

## API and projection

`cocRules.ts` exports pure rules and `resolveCocSheet`; UI and native operations consume those same rules. `bridge.ts` / `bridgeManifest.ts` expose normal `wh_sheet_*` CRUD, JSON, ink and CoC action tools. Writes use saveSheet/deleteSheet and expected revisions; reads project calculated values without database migration writes. The document tool block projects resolved sheet paper read-only.

The optional `coc.version=1` state remains inside the existing portable sheet JSON v1. Old sheets adopt automation where values match the rules; differing authored maxima/skills/MOV/build/damage bonus become persistent overrides. Legacy custom era text is retained.

## Rules references and boundaries

- [Chaosium rules wiki: wounds and healing](https://cthulhuwiki.chaosium.com/rules/hit-points-wounds-and-healing.html)
- [Chaosium rules wiki: sanity](https://cthulhuwiki.chaosium.com/rules/sanity.html)
- [Chaosium rules wiki: development](https://cthulhuwiki.chaosium.com/rules/rewards-of-success.html)
- [Chaosium investigator sheet documentation](https://www.chaosium.com/40th-anniversary-investigator-sheets/)
- [Chaosium licensed compendium: Pulp attributes and movement table](https://app.roll20.net/compendium/coc/Rules%3AStep%20Two%20%28Generate%20Characteristics%29)

This is a playable sheet with explicit supported rule actions, not a replacement for the rulebooks or Keeper. It does not adjudicate opposed rolls, bonus/penalty dice, Pulp talents, treatment schedules, spell effects or a complete insanity narrative. The skill mastery SAN reward is not automated; adjust current SAN when the Keeper grants it.

## 5e stat blocks

New stat blocks use the original compact paper and CR-based XP. The supported CR values are 0, 1/8, 1/4, 1/2 and integers 1–30, from the [official Basic Rules XP table](https://www.dndbeyond.com/sources/dnd/br-2024/how-to-use-a-monster). CR0 defaults to 10 XP; its explicit selector also supports 0. Unsupported CR values have no automatic XP. The existing proficiency calculation and its override remain unchanged.

Optional `statBlockXp:{version:1,zeroCrXp:0|10,override?:number}` selects this calculation; an integer manual override is explicit. The recorded `numbers.experience` is never overwritten. Without this metadata, old sheets retain their exact recorded XP, including zero. Use CR XP opts in; Use recorded XP opts out. The editor, paper and `wh_sheet_get.derived.statBlock` consume the same pure projection.

Optional `paperLayout:'record'|'stat-block'` selects paper. Absence keeps the former record, with its exact former geometry. New stat blocks choose compact paper; older sheets change only through the visible Paper layout selector. Ink remains at its stored paper coordinates; switching back restores the record layout. Full forms and HP/resource controls remain available. Compact paper retains custom values and unknown narrative sections, without generating spells, monster features or additional rule adjudication.

The compact paper is shared by normal ReadingView/tool previews, offline Reader/wiki and native PNG output. Portable sheet JSON, project clone, full JSON and ZIP carry both optional fields. No storage migration is required. Native update/ink/CoC-action audit Undo keeps an opaque session receipt, refuses changed versions or another project/era, and restores complete sheet metadata. Reverting a first era variant restores inheritance from Base; reverting an existing variant retains its former content. Receipts expire when the renderer session ends.

## Optional 5e (2014) character workflow

Play adds an explicit SRD5.1 class preview for `5e-character`. Choose one of the twelve core classes and level1–20, inspect the previous/proposed fields and select which calculations to link. Save commits the normal draft. Opening a legacy sheet, importing it or reading its paper does not activate this profile. [Sources, licence and boundaries](FIVE-E-SOURCES.md) distinguish this profile from the separate revised-rules stat block.

Linked HP maxima, hit dice and slots follow later level/Constitution edits. A manual maximum detaches that calculation, even when a single edit changes both level and maximum to the newly calculated number. The small `fiveE.applied` ledger records only the last automatic outputs so normal draft reconciliation followed by Save does not mistake its own result for a manual override. It does not duplicate the level, Constitution score or played HP. Growing capacity preserves spent uses; a decrease that would discard played uses stays manual until explicitly applied. No class change heals, rests or resets a resource. HP30/18, custom resource labels/marked semantics, deleted resources, prepared spells and ink remain authored data.

Play and Rows share ordinary spell rows with optional `fiveESpell:{version:1,level:0..9,prepared:boolean}`. Add spell or convert a row explicitly; free-text section names never imply conversion. Casting ability uses a stable ability ID; missing traits produce unavailable derived values. DC/attack overrides are explicit and can be reset.

`wh_sheet_5e_preview` is read-only. `wh_sheet_5e_action` supports `configure`, `resource`, `upsert-spell`, `prepare-spell` and `casting-override`, through the same sheet writer, revision/CAS, era context and receipt Undo as normal edits. Configure requires nonempty explicit `fields`; `recordClass` is a separate choice. The action preserves unselected fields and a repeated unchanged action produces no new revision/receipt. Get adds `derived.fiveE`. JSON, project clone/backup and the common complete paper carry the optional state and prepared metadata; Reader/wiki and native PNG consume that same paper.

Author QA: `five-e-rules.browser.ts` (rules/manual data), `five-e-preview-selection.browser.tsx` (stale consent and Spanish limit recovery), `five-e-depth.browser.ts` (writer/era/portability), `five-e-depth-ui.browser.tsx` (native input1440/640), and `five-e-depth-transport.cjs` (external native MCP plus offline exports). These are private-profile fixtures; independent review is still required before integration.

## Verification

`node scripts/run-rpg-sheets-tests.mjs`

`node node_modules/electron/cli.js scripts/run-focused-browser-tests.cjs tests/rpg-sheets.browser.tsx testRpgSheets 120000`

`node node_modules/electron/cli.js tests/coc-depth.runner.cjs`

Unset ELECTRON_RUN_AS_NODE before Electron runs. The depth runner uses its own temporary profile, disables network, builds current application CSS, checks actual registered native dispatch, archive/clone/recovery, captures desktop/narrow screenshots and sends native mouse/keyboard input. It never uses the real application profile.
