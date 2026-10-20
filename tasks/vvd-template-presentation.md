# Codex type presentation

- [x] Define independent optional inheritance and strict icon-name/hex-color/layout/visibility validation; legacy presentation stays unchanged.
- [x] Expose appearance controls through existing icon catalog and type manager, preserving administrative access to hidden types.
- [x] Apply portrait/landscape/none and type icon/color to Codex forms/list/detail without changing stored avatar data.
- [x] Hide new type/reference choices while preserving current selections, All cards, existing links and the seven broad categories.
- [x] Verify pure/API inheritance, parent retirement and CAS, actual manager/form/list/reference flows and real clone/ZIP roundtrips.
- [x] Run existing template/hierarchy/portability regression suites and focused static checks.

Metadata fields: icon?, color?, imageLayout? ('portrait'|'landscape'|'none'), hiddenFromPickers?. Undefined properties inherit independently; no ancestor override keeps legacy category icon/color and square avatar. Visibility false is an explicit child override. Hiding images only changes presentation and never deletes avatar/avatarOriginal bytes.

Verification: focused presentation suite6 groups, existing templates4, hierarchy5 and world-portability3 pass. Renderer TypeScript and focused source ESLint pass. Real UI tests choose an existing catalog icon, save style/visibility through the manager, preserve selected hidden types/references, save image-hidden entries without altering their avatar originals, and verify portrait/landscape/no-image cards and details. Actual project clone and ZIP restoration retain every new property and remap hierarchy IDs; parent retirement folds inherited appearance into direct children without changing existing cards. Current-CSS captures inspected at1280px and720px: .impeccable/review/template-cards-{desktop,narrow}.png and template-manager-{desktop,narrow}.png. All remain accessible in navigation; no enum changes, schema changes, image-byte deletion or migration.
