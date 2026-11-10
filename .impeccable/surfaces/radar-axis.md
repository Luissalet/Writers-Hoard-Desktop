---
version: 1
slug: "radar-axis"
primary_target: "src/engines/radar/RadarEditor.tsx"
related_targets:
  - "src/engines/radar/RadarGraphic.tsx"
  - "src/engines/radar/RadarEngine.tsx"
---

# Radar axis editing

Mode: Operate. Extend the incumbent radar editor and its charcoal/gold controls. PRODUCT.md, DESIGN.md and the worldbuilding surface remain authoritative. No new palette, typography, raster, renderer or document format.

## Direction contract

THESIS: Insert an axis where it belongs and reorder by identity while retaining the existing buttons and saved values.

OWN-WORLD: Keep the current vector chart, compact sans labels, charcoal surfaces, gold focus and normal form controls.

STORY: Find a gap, add a measure, or move its handle; inspect the same series and explicitly save or discard the draft.

FIRST VIEWPORT: The chart remains dominant. Gap controls appear at hover/focus; handles sit beside axis names and existing arrows.

FORM: Code-led extension of the incumbent editor; no composition roll or replacement world. Escape cancels an uncommitted drag; read-only charts have no author gestures.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Acceptance

Preserve stable IDs, axis styles/scales, raw outliers, series/bindings and the normal Save/Discard/CAS flow. Confirm keyboard and pointer cancellation, changed-structure rejection, Base/era service scope, portables and actual desktop/narrow reflow. No new persistent Undo contract is claimed. A fresh independent review of actual rendered captures and documentation closes this extension; source labels or test counts alone do not.

Keep the preset-category input within the existing 200-character document limit so ordinary typing cannot create invalid metadata that blocks axis editing.

Keep dense gap targets separate: the editable plot has a minimum width based on its axis count and scrolls horizontally inside its own bounds on narrow screens. A normal center click must select that gap's stable anchor at every supported axis count; read-only graphics retain their existing sizing.
