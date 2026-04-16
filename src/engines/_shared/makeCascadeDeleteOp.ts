import { db } from '@/db';

/**
 * Defines a child table to cascade-delete when a parent record is deleted.
 */
export interface CascadeRule {
  /** Child table name */
  table: string;
  /** The foreign key field on the child table that references the parent */
  foreignKey: string;
}

/**
 * Options for creating a cascade delete operation.
 */
export interface CascadeDeleteOptions {
  /** Parent table name */
  tableName: string;
  /** Child tables to cascade-delete from */
  cascades: CascadeRule[];
}

/**
 * Factory that generates a cascade delete operation for Dexie (IndexedDB).
 *
 * Standardizes the pattern of deleting a parent record and all its child records
 * in a single transaction.
 *
 * @example
 * const deleteBiography = makeCascadeDeleteOp({
 *   tableName: 'biographies',
 *   cascades: [
 *     { table: 'biographyFacts', foreignKey: 'biographyId' }
 *   ]
 * });
 *
 * await deleteBiography(id);
 */
export function makeCascadeDeleteOp(options: CascadeDeleteOptions): (id: string) => Promise<void> {
  const { tableName, cascades } = options;

  return async (id: string): Promise<void> => {
    // Collect all tables involved in the transaction
    const tableNames = [tableName, ...cascades.map(c => c.table)];

    await db.transaction('rw', tableNames, async () => {
      // Delete the parent record
      await db.table(tableName).delete(id);

      // Delete all child records
      for (const cascade of cascades) {
        await db.table(cascade.table).where(cascade.foreignKey).equals(id).delete();
      }
    });
  };
}
