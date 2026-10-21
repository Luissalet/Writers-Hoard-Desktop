---
version: 1
slug: "src-engines-character-sheets-fiveeplaypanel-tsx"
primary_target: "src/engines/character-sheets/FiveEPlayPanel.tsx"
related_targets: []
---

# Optional 5e (2014) Play

Mode: Operate. Extend the existing RPG editor, preserving its charcoal/gold theme, ordinary Field/NumberField/buttons, tab structure and editable vector paper. PRODUCT.md, DESIGN.md and `.impeccable/design.json` remain the visual authority. This addition has no separate visual world, official sheet artwork or logo.

The task is to apply selected single-class calculations while retaining authored values and played counters. The profile/version/source appears beside the current class, level and casting summary. A class preview precedes writing: each checkbox names its current/proposed value, warns about authored data or lost capacity, and is bound to those displayed values. Save remains the ordinary sheet draft boundary. Cancellation is local and does not mutate the sheet.

HP and used/available slot controls reuse existing resource semantics. Spell rows share the ordinary row editor and stable IDs; prepared marks are real checkboxes plus text in exports. Disclosure holds casting overrides and the attribution rather than hiding the main play state. Missing resources and the existing500-resource limit have visible recovery while preserving the preview.

Required inspected sizes:1440×1000 and640×1000, English native input; Spanish limit recovery at both sizes using targeted DOM events and actual application CSS. Scrolling is ordinary editor scrolling; the existing shell contracts at640. Preview captures are intentionally scrolled to the complete decision/action region; prepared captures show the spell controls; they are state evidence, not full-page hero comparisons. Complete Reader/wiki paper is independently checked via native PNG compositor.

No global typography/theme changes. Maintain all legacy fields/tabs/rows and explicit manual controls. No colour-only state, implicit rest/heal, spell catalogue, subclass or multiclass engine. Proof and bounded finish-review inputs are in `.impeccable/review/five-e1041/`; author QA alone is not a ship verdict.
