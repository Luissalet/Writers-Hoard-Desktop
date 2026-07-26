---
name: update-project-graph
description: >
  Keep the project knowledge graph in memory up to date after code changes.
  MUST trigger at the END of any session or task where you modified files under src/,
  especially src/engines/, src/stores/, src/db/, src/hooks/, src/components/, src/services/,
  src/types/, src/pages/, or src/config/. Also trigger when the user says "update the project graph",
  "refresh architecture", "rescan the project", or anything about keeping project knowledge current.
  This is a post-task housekeeping step — run it after your main work is done, not before.
---

# Update Project Knowledge Graph

You maintain a layered knowledge graph of the Writers Hoard codebase in memory files.
After making code changes, check whether those changes affect the knowledge graph
and update it if they do. This keeps future sessions from working with stale context.

## The Knowledge Graph Files

Three memory files at `/sessions/festive-cool-keller/mnt/.auto-memory/`:

| File | What it tracks |
|------|---------------|
| `project_architecture.md` | Tech stack, app structure, routing, stores, database schema (table list), services, hooks, shared layer, engine system overview, project modes |
| `project_engine_catalog.md` | All engines profiled: purpose, key files, hooks used, maturity status (complete vs WIP) |
| `MEMORY.md` | Index pointing to these files (keep in sync) |

## When to Update

After completing your main task, check: did any of your changes touch these areas?

**Architecture map triggers:**
- New/removed/renamed stores in `src/stores/`
- Dexie schema version bump or table changes in `src/db/`
- New/removed hooks in `src/hooks/`
- New/removed services in `src/services/`
- Route changes in `src/pages/` or `App.tsx`
- New dependencies in `package.json`
- Changes to `src/config/`
- Changes to `src/shared/`
- Changes to `src/types/index.ts` (new domain types)

**Engine catalog triggers:**
- Any file added/removed/renamed in `src/engines/*/`
- New engine registered in `src/engines/_registry.ts`
- Engine moved from thin-wrapper to self-contained pattern (or vice versa)
- Project mode presets changed in registry
- Engine status changed (WIP → complete, or new engine added)

**If none of these were touched, skip the update.** Don't rescan just because you edited a CSS class.

## How to Update

### Step 1: Read the current memory files

Read `project_architecture.md` and/or `project_engine_catalog.md` — whichever is relevant to your changes.

### Step 2: Identify what's stale

Compare what the memory file says against what you just changed. You know exactly which files you touched and what the diff was — use that, not guesses.

### Step 3: Edit the memory files

Use the Edit tool to make targeted updates. Common patterns:

- **Added a new engine**: Add its profile to `project_engine_catalog.md` following the existing format. Update the engine count in `project_architecture.md`. If it changed project mode presets, update those too.
- **Changed DB schema**: Update the table list and version in `project_architecture.md` under the Database section.
- **Added a new store**: Add it to the State Layer section in `project_architecture.md`.
- **New service**: Add to the Services section.
- **Engine matured from WIP to complete**: Move it between sections in `project_engine_catalog.md`, update its status and file list, adjust the migration pattern note.
- **New hook**: Add to the Domain Hooks list.
- **New shared utility**: Add to the Shared Layer section.

### Step 4: Keep MEMORY.md accurate

If you changed the engine count or any description in the index entries, update `MEMORY.md` to match.

## Critical Rules

These rules exist because past updates introduced subtle errors that compounded over time.

### Only state facts from the change you made
Every piece of information you add to the knowledge graph must come from the actual code change you just made. If the prompt says "added a research engine with useResearchSessions and useResearchNotes hooks", those are the only details you know about that engine. Do not invent additional details like what database tables it uses, what its UI looks like, or what its "purpose" is beyond what's directly stated. A brief, factual profile based on what you know is far better than a rich-sounding one that's partly fabricated.

### Don't touch files unrelated to the change
If you changed the DB schema but not any engines, do not edit `project_engine_catalog.md` at all. If you added an engine but didn't change the DB schema, don't modify the Database section. Each memory file section is independent — only edit sections directly affected by what you changed.

### Count by reading, not by arithmetic
When updating counts (engine totals, table counts, hook counts), count the actual items listed in the file after your edit. Don't do mental math like "it was 14, I added 1, so it's 15" — off-by-one errors compound. After editing, recount the list and use that number.

### No editorial commentary
The knowledge graph is a reference document, not a changelog. When you remove a hook from the central hooks list because it moved into an engine, just remove it — don't add "(moved to X engine)" or "Note: this was migrated." When you update an engine's status from WIP to Complete, just write "Complete" — don't add "Migrated from thin wrapper" or similar. If someone reads the file cold, they should see the current state, not a narrative of what changed. Every parenthetical note, migration comment, or explanatory aside you're tempted to add — delete it.

### Preserve existing format exactly
Match the heading levels, bold labels, spacing, and structure of the existing entries. Don't introduce new sections (like "Cross-Cutting Hooks") unless the change genuinely requires a new category. When adding an engine profile, copy the format of an adjacent entry.

## Full Rescan (Manual Trigger Only)

If the user explicitly asks for a full rescan ("rescan the project", "rebuild the knowledge graph"), then do a comprehensive pass:

1. Use subagents in parallel to scan each layer (stores, db, hooks, engines, services, etc.)
2. Rewrite the memory files from scratch with current state
3. This is the exception to the "surgical edits" rule — but only when the user asks for it
