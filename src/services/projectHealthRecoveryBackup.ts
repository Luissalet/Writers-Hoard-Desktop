// Production safety boundary for Project Health repairs. Kept separate from
// the deterministic inspection core so tests never need to fake Electron.

import { backUpNow } from '@/services/autoBackup';
import { flushPendingWrites } from '@/services/pendingWrites';
import {
  ProjectHealthRepairError,
  executeProjectHealthRepairWithBackup,
  type ProjectHealthRepairPreview,
  type ProjectHealthRepairResult,
  type ProjectRepairBackupReceipt,
} from '@/services/projectHealthRecovery';

async function writeSafetyBackup(): Promise<ProjectRepairBackupReceipt> {
  const pending = await flushPendingWrites();
  if (!pending.ok) {
    throw new ProjectHealthRepairError(
      'pending-writes',
      'Pending or failed writes must be resolved before repair',
    );
  }

  const startedAt = Date.now();
  const status = await backUpNow();
  if (!status.supported) {
    throw new ProjectHealthRepairError(
      'backup-unavailable',
      'A verified desktop backup is unavailable in this build',
    );
  }
  if (
    status.unavailable
    || status.failure
    || status.lastAutomaticAt === null
    || status.lastAutomaticAt < startedAt
  ) {
    throw new ProjectHealthRepairError('backup-failed', 'Safety backup did not complete');
  }
  return {
    kind: 'full-archive',
    createdAt: status.lastAutomaticAt,
    sizeBytes: status.lastArchiveBytes ?? 0,
  };
}

/** Execute only a preview the user explicitly confirmed in the React dialog. */
export function executeProjectHealthRepair(
  preview: ProjectHealthRepairPreview,
): Promise<ProjectHealthRepairResult> {
  return executeProjectHealthRepairWithBackup(preview, writeSafetyBackup);
}
