import { db } from '@/db';

/**
 * Standard Dexie reorder: fetches all items for the given scope, maps each
 * to its new position in `orderedIds`, then batches updates via Promise.all.
 */
export async function reorderItems(
  tableName: string,
  scopeField: string,
  scopeId: string,
  orderedIds: string[],
): Promise<void> {
  const items = (await db.table(tableName).where(scopeField).equals(scopeId).toArray()) as {
    id: string;
  }[];
  await Promise.all(
    items.map(item =>
      db.table(tableName).update(item.id, { order: orderedIds.indexOf(item.id), updatedAt: Date.now() }),
    ),
  );
}
