import { db } from '@/db';

/**
 * Standard Dexie reorder: inside one transaction, fetches all items for the
 * given scope and stamps each one's new position in `orderedIds`. Rows the
 * caller did not list — created after its render, by the AI bridge or another
 * window — keep the order they already have.
 */
export async function reorderItems(
  tableName: string,
  scopeField: string,
  scopeId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction('rw', [tableName], async () => {
    const items = (await db.table(tableName).where(scopeField).equals(scopeId).toArray()) as {
      id: string;
    }[];
    const updatedAt = Date.now();
    for (const item of items) {
      const order = orderedIds.indexOf(item.id);
      if (order < 0) continue;
      await db.table(tableName).update(item.id, { order, updatedAt });
    }
  });
}
