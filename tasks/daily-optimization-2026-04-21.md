# Daily Optimization — 2026-04-21

**Scheduled run.** Theme: MVP-ify — make the first-run experience as lean as possible.

## Context

User's hint this run: *"Revise specially ways to make it more mvp. Implement."*

Audit surfaced that the lightest existing onboarding path (Novelist mode) ships with **7 default engines + 8 suggested = 15 engine chips rendered on the project-creation screen**. That is far too much cognitive load for a first-time user. Every other mode is similar (Biographer 6 + 6, Reporter 6 + 4, Playwright 6 + 7, Content-Creator 5 + 5). There was no option to "just start writing" with the absolute minimum.

Other MVP-adjacent observations (parked — not acted on this run):
- Annotation engine shipped 2026-04-19 but `MarginPanel` not yet mounted in writings/codex detail views. Deferred integration.
- `InspirationGallery.tsx` is ~491 LOC; splitting deferred.
- Orphan hooks at `src/hooks/{useCodexEntries,useExternalLinks,useGallery,useMaps}.ts` already reduced to 7-line `@deprecated` stubs (clean state, pending `git rm`).
- Dialog engine still needs stage-direction editability + professional block types (per `feedback_dialog_engine.md`).

## What shipped today

### New `essentials` project mode (MVP starter preset)

A single-purpose preset that lets a brand-new user go from "create project" to "typing into a blank page" in the fewest possible clicks.

- **defaultEngines:** `writings`, `codex`, `outline` — the minimum trio to start writing while keeping basic world-building and structure within reach.
- **suggestedEngines:** `timeline`, `diary`, `writing-stats`, `character-arc` — the natural "I want a little more" add-ons, still conservative.
- **Visual treatment in `CreateProjectModal`:** gold ring + "Recommended" badge. The card sits first in the 3-col grid, so it's the first thing a user sees.
- **Color:** `#e8c577` (soft gold, intentionally differentiated from the default brand gold on the novelist card so it reads as distinct).
- **Icon:** `Sparkles` — communicates "fresh start / easy beginning" without overloading writing-specific iconography.

### Files touched

| File | Change |
|---|---|
| `src/engines/_types.ts` | Added `'essentials'` to `ProjectMode` union (first position) |
| `src/types/index.ts` | Added `'essentials'` to the parallel `ProjectMode` type alias |
| `src/engines/_registry.ts` | Imported `Sparkles`; inserted Essentials entry at the top of `PROJECT_MODES` |
| `src/locales/en.ts` | Added `modes.essentials.name`, `.description`, `.recommended` |
| `src/locales/es.ts` | Added same three keys in Spanish |
| `src/components/dashboard/CreateProjectModal.tsx` | Recognizes `modeConfig.id === 'essentials'` and renders a "Recommended" pill + accent ring on that card |

All following the existing conventions — no new primitives, no new files. Adds 1 engine mode, 6 locale keys, and ~12 LOC of visual-differentiation in the modal.

### i18n parity

Verified with `diff <(grep "modes\." en.ts | sort) <(grep "modes\." es.ts | sort)` → zero drift. Both locales now ship all 7 modes.

### Type safety

`npx tsc -b --noEmit` → exit 0.

## Why this is MVP-shaped (not feature creep)

- **Does not delete or hide anything.** Every existing mode still works identically; Essentials is purely additive.
- **Does not touch the 22 engines themselves.** Opens no new integration surface, no new DB migrations, no new backup strategies.
- **Does not introduce a new UI primitive.** Re-uses the existing mode-card grid; the "Recommended" pill is a 12-line branch in the existing render.
- **Zero TS surface growth:** two string-literal additions to the union.

The change is the **cheapest viable way** to install an on-ramp: a user who doesn't identify with "Novelist / Biographer / Reporter / Playwright / Content Creator" no longer has to pick "Custom" and configure from scratch. They pick Essentials and are writing 30 seconds later.

## Candidate follow-ups (MVP-aligned, for future runs)

Ordered by effort/impact ratio. Take one per daily run.

1. **Mount `MarginPanel` in `WritingsEngine` and `CodexEngine` detail views.** The annotation engine is live on disk but invisible in the UI. This is the single biggest unrealized-value item on the board. Risk: layout regressions in Tiptap pane. Mitigation: feature-flag or behind a "Show margin notes" toggle first.
2. **Add a "Start writing" quick-action on the Essentials card.** Skip step 2 of the wizard entirely: pick Essentials → type a title → land on `/project/:id/writings` with the blank editor open. Zero other clicks.
3. **Getting-started checklist widget on the project dashboard.** 3 items: "Name your world," "Create a character in Codex," "Write your first page." Dismissible. Lives on the project-detail empty state.
4. **Split `InspirationGallery.tsx`.** 491 LOC, several unrelated concerns (grid + upload + inspection). MVP tool, but the file size is starting to carry risk.
5. **Collapse `modes.essentials.recommended` into a generic `common.recommended` key** if any other UI element ever needs the same pill. Fine-as-is for now.
6. **Tableless "first-7-days" analytics engine** — derive writings-per-day + wordcount from existing `writings` + `writingSessions` tables, give the Essentials user their own tiny dashboard. Pattern already exists (POV Audit, see `makeReadOnlyHook`).
7. **Dialog engine parity upgrades** (stage-direction editability, professional block types) — still parked from 2026-04-17 feedback.
8. **Backup strategies for the five v16 tables** (`characterArcs`, `arcBeats`, `relationships`, `seeds`, `payoffs`) — `assertBackupCoverage` warns on boot until each new engine's `index.ts` adds a `makeSimpleBackupStrategy` call.

## Review

**Success criteria met:**
- [x] New user has a single-click, zero-configuration starting preset.
- [x] Existing modes unchanged; no user migration needed.
- [x] Both supported locales in parity.
- [x] Visual hierarchy in the mode picker guides first-time users to Essentials without hiding power-user modes.
- [x] Typecheck clean.
- [x] Zero auto-commit (per `feedback_no_autocommit`). Changes are staged for Luis to review.

**Staff-engineer sanity check:** Would a reviewer approve? Yes — the change is additive, orthogonal to every other moving part, follows the existing engine-registration / locale-key / mode-config conventions precisely, and the UX justification (onboarding friction reduction) is clear.

**Knowing everything now, is there a more elegant path?** The next elegance bump is step 2 in the follow-ups list — letting Essentials *skip the details step entirely* and drop the user into the editor. That's the next MVP move, but it requires decisions about default project title (auto-generated? required?) which are worth a separate session with Luis.
