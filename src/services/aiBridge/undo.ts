// ============================================================================
// AI bridge — undoing a logged change
// ============================================================================
//
// The audit log records what each write did and what the row looked like
// before. This turns one of those lines back:
//
//   create → delete the row, through the engine's own cascade operation
//   update → put the recorded fields back
//   delete → reinsert the row (its cascaded children do NOT come back)
//
// It is deliberately honest about the last case. Restoring a deleted scene
// brings the scene back but not its dialog; saying so is better than a green
// tick that hides it.

import { db } from '@/db';
import { DELETABLE } from './tools/deletion';
import { BridgeError, type ToolArgs } from './tools/shared';

export interface UndoResult {
  undone: boolean;
  kind: string;
  entityId: string;
  what: string;
  /** Set when the reversal is partial, and why. */
  caveat?: string;
}

/**
 * Which table holds this id, found by asking each of them.
 *
 * Cheaper than it looks — a primary-key `get` on ~45 tables — and far more
 * reliable than guessing from an id prefix, which only holds for rows the
 * bridge created: plenty of the user's own rows are bare UUIDs.
 */
async function findTable(id: string): Promise<string | null> {
  for (const table of db.tables) {
    try {
      if (await table.get(id)) return table.name;
    } catch {
      // A table whose primary key is not a string simply never matches.
    }
  }
  return null;
}

/** The registry entry whose table this is, when there is one. */
function specForTable(table: string): { type: string; remove: (id: string) => Promise<void> } | null {
  for (const [type, spec] of Object.entries(DELETABLE)) {
    if (spec.table === table) return { type, remove: spec.remove };
  }
  return null;
}

export async function undoAuditEntry(args: ToolArgs): Promise<UndoResult> {
  const entry = args.entry as Record<string, unknown> | undefined;
  if (!entry) throw new BridgeError('bad-args', 'No audit entry was passed to undo.');

  const kind = String(entry.kind ?? '');
  const entityId = typeof entry.entityId === 'string' ? entry.entityId : '';
  const summary = typeof entry.summary === 'string' ? entry.summary : 'that change';
  if (!entityId) {
    throw new BridgeError(
      'cannot-undo',
      'That entry records no entity, so there is nothing to put back. Bulk imports are not reversible this way.',
    );
  }

  if (kind === 'create') {
    const table = await findTable(entityId);
    if (!table) {
      throw new BridgeError('not-found', 'It is already gone — nothing left to undo.');
    }
    const spec = specForTable(table);
    // Prefer the engine's own delete: it takes the children with it.
    if (spec) await spec.remove(entityId);
    else await db.table(table).delete(entityId);
    return { undone: true, kind, entityId, what: summary };
  }

  const before = entry.before as Record<string, unknown> | undefined;
  if (!before || typeof before !== 'object') {
    throw new BridgeError(
      'cannot-undo',
      'That entry did not record what the row looked like before, so there is nothing to restore.',
    );
  }

  if (kind === 'update') {
    const table = await findTable(entityId);
    if (!table) {
      throw new BridgeError('not-found', 'That row has since been deleted, so there is nothing to restore it onto.');
    }
    await db.table(table).update(entityId, { ...before, updatedAt: Date.now() });
    const restored = Object.keys(before).join(', ');
    return {
      undone: true,
      kind,
      entityId,
      what: summary,
      // The log keeps the fields a handler thought were worth recording, not
      // the whole row, so say which ones actually went back.
      caveat: `Restored: ${restored}. Any other field the change touched was not recorded and stays as it is.`,
    };
  }

  if (kind === 'delete') {
    const table = typeof entry.table === 'string' ? entry.table : null;
    if (!table) {
      throw new BridgeError('cannot-undo', 'That deletion did not record which table the row came from.');
    }
    if (await db.table(table).get(entityId)) {
      throw new BridgeError('bad-args', 'It is already back — nothing to undo.');
    }
    await db.table(table).put(before);
    return {
      undone: true,
      kind,
      entityId,
      what: summary,
      caveat: 'The row itself is back. Anything that was deleted along with it is not: those rows were never recorded.',
    };
  }

  throw new BridgeError('cannot-undo', `Entries of kind "${kind || 'unknown'}" cannot be undone.`);
}
