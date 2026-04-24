// ============================================
// Dev-mode assertion: every engine's tables are covered by a backup path
// ============================================
//
// Invoked once from src/engines/index.ts after all engines have registered.
// Warns in the console if any engine's `EngineDefinition.tables` key is not
// covered by either:
//   1. A registered `BackupStrategy` (via `registerBackupStrategy`), or
//   2. The hard-coded `legacyTables` block in `src/services/zipBackup.ts`.
//
// We keep the legacy list in lockstep with the one in zipBackup.ts so the
// warning is accurate. If zipBackup's legacy list changes, update both.
//
// Prevents the class of bug that hit us on 2026-04-18 where 18/33 Dexie
// tables were silently dropped on backup/restore because engines added
// after the original backup code never got wired in.

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

export interface BackupCoverageReport {
  /** Tables declared by an engine but not covered anywhere. */
  uncovered: Array<{ engineId: string; table: string }>;
  /** Tables covered by a strategy AND the legacy list (harmless but noisy). */
  doubleCovered: Array<{ engineId: string; table: string }>;
}

export function checkBackupCoverage(): BackupCoverageReport {
  const strategyTables = new Set(
    getAllBackupStrategies().flatMap((s) => s.tables),
  );
  const legacySet = new Set(LEGACY_BACKUP_TABLES);

  const uncovered: BackupCoverageReport['uncovered'] = [];
  const doubleCovered: BackupCoverageReport['doubleCovered'] = [];

  for (const engine of getAllEngines()) {
    const tables = Object.keys(engine.tables ?? {});
    for (const table of tables) {
      const inStrategy = strategyTables.has(table);
      const inLegacy = legacySet.has(table);
      if (!inStrategy && !inLegacy) {
        uncovered.push({ engineId: engine.id, table });
      } else if (inStrategy && inLegacy) {
        doubleCovered.push({ engineId: engine.id, table });
      }
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
    // eslint-disable-next-line no-console
    console.warn(
      '[backup-coverage] %d engine table(s) are not covered by any BackupStrategy ' +
        'or the legacy list in zipBackup.ts — these will be silently dropped ' +
        'on backup/restore:\n%s',
      uncovered.length,
      uncovered.map((u) => `  • ${u.engineId} → ${u.table}`).join('\n'),
    );
  }

  if (doubleCovered.length > 0) {
    // eslint-disable-next-line no-console
    console.info(
      '[backup-coverage] %d table(s) are double-covered (in both a strategy and ' +
        'the legacy list). Harmless, but consider removing one side:\n%s',
      doubleCovered.length,
      doubleCovered.map((u) => `  • ${u.engineId} → ${u.table}`).join('\n'),
    );
  }
}
