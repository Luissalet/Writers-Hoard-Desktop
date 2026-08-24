// ============================================
// Dev-mode assertion: every Dexie table is covered by a backup path
// ============================================
//
// Invoked once from src/engines/index.ts after all engines have registered.
// Warns in the console if any table in the OPEN DEXIE SCHEMA is not covered by
// either:
//   1. A registered `BackupStrategy` (via `registerBackupStrategy`), or
//   2. The hard-coded `legacyTables` block in `src/services/zipBackup.ts`.
//
// The universe used to be "tables declared by a registered engine", which left
// the checker blind to any table that doesn't hang off an engine: the four
// project-tools tables (`entityLinks`, `citations`, `publishingProfiles`,
// `conversionReceipts`) were backed up fine but invisible to the guardrail,
// and a FUTURE engineless table would have been silently dropped with no
// warning — exactly the bug class this file exists to catch. It now iterates
// `db.tables`, so anything Dexie stores must either be backed up or appear on
// the explicit derived-cache exemption list below.
//
// We keep the legacy list in lockstep with the one in zipBackup.ts so the
// warning is accurate. If zipBackup's legacy list changes, update both.
//
// Prevents the class of bug that hit us on 2026-04-18 where 18/33 Dexie
// tables were silently dropped on backup/restore because engines added
// after the original backup code never got wired in.

import { db } from '@/db';
import { getAllEngines } from '@/engines/_registry';
import { getAllBackupStrategies } from './backupRegistry';

/**
 * Tables handled by the legacy block in `services/zipBackup.ts`.
 * Keep this list in sync with `legacyTables` there.
 */
const LEGACY_BACKUP_TABLES: string[] = [
  // On 2026-04-23 the last 6 hardcoded engines migrated to modular
  // BackupStrategies: codex, writings, yarn-board (3 tables), maps
  // (2 tables), gallery (2 tables). This list is now only the top-level
  // tables that `zipBackup.ts` still owns directly.
  'projects',
  'tags',
  'settings',
];

/**
 * Tables that are DELIBERATELY not backed up: regenerable caches of derived
 * data. Each entry must be justified here — an unlisted, uncovered table is a
 * bug, not a candidate for this list.
 */
const DERIVED_CACHE_TABLES: string[] = [
  'worldSnapshots', // worldgen render snapshots — regenerated from the seed
  'canonTiles',     // worldgen canonical tile cache
  'renderedTiles',  // worldgen rendered tile cache
];

export interface BackupCoverageReport {
  /** Tables in the Dexie schema not covered anywhere. */
  uncovered: Array<{ engineId: string; table: string }>;
  /** Tables covered by a strategy AND the legacy list (harmless but noisy). */
  doubleCovered: Array<{ engineId: string; table: string }>;
}

export function checkBackupCoverage(): BackupCoverageReport {
  const strategyTables = new Set(
    getAllBackupStrategies().flatMap((s) => s.tables),
  );
  const legacySet = new Set(LEGACY_BACKUP_TABLES);
  const cacheSet = new Set(DERIVED_CACHE_TABLES);

  // Attribution only — coverage no longer depends on an engine declaring the
  // table, but the warning is far more actionable with an owner next to it.
  const ownerByTable = new Map<string, string>();
  for (const engine of getAllEngines()) {
    for (const table of Object.keys(engine.tables ?? {})) {
      ownerByTable.set(table, engine.id);
    }
  }
  for (const strategy of getAllBackupStrategies()) {
    for (const table of strategy.tables) {
      if (!ownerByTable.has(table)) ownerByTable.set(table, strategy.engineId);
    }
  }

  const uncovered: BackupCoverageReport['uncovered'] = [];
  const doubleCovered: BackupCoverageReport['doubleCovered'] = [];

  for (const table of db.tables.map((t) => t.name)) {
    if (cacheSet.has(table)) continue;
    const inStrategy = strategyTables.has(table);
    const inLegacy = legacySet.has(table);
    const engineId = ownerByTable.get(table) ?? '(no engine)';
    if (!inStrategy && !inLegacy) {
      uncovered.push({ engineId, table });
    } else if (inStrategy && inLegacy) {
      doubleCovered.push({ engineId, table });
    }
  }

  return { uncovered, doubleCovered };
}

/**
 * Runs the coverage check and emits console warnings in dev builds.
 * No-op in production (the check is purely a developer guardrail).
 */
export function assertBackupCoverage(): void {
  if (!import.meta.env?.DEV) return;
  const { uncovered, doubleCovered } = checkBackupCoverage();

  if (uncovered.length > 0) {
    // One grouped warning so the console isn't flooded with N lines.
    console.warn(
      '[backup-coverage] %d Dexie table(s) are not covered by any BackupStrategy ' +
        'or the legacy list in zipBackup.ts — these will be silently dropped ' +
        'on backup/restore:\n%s',
      uncovered.length,
      uncovered.map((u) => `  • ${u.engineId} → ${u.table}`).join('\n'),
    );
  }

  if (doubleCovered.length > 0) {
    console.info(
      '[backup-coverage] %d table(s) are double-covered (in both a strategy and ' +
        'the legacy list). Harmless, but consider removing one side:\n%s',
      doubleCovered.length,
      doubleCovered.map((u) => `  • ${u.engineId} → ${u.table}`).join('\n'),
    );
  }
}
