import { db } from '@/db';

export interface TableOpsOptions<T> {
  /** Dexie table name */
  tableName: string;
  /** Foreign-key field used to query by scope (e.g. 'projectId', 'biographyId') */
  scopeField: string;
  /** Optional in-memory sort applied after the Dexie query */
  sortFn?: (a: T, b: T) => number;
}

export interface TableOps<T> {
  getAll: (scopeId: string) => Promise<T[]>;
  getOne: (id: string) => Promise<T | undefined>;
  create: (item: T) => Promise<string>;
  update: (id: string, changes: Partial<T>) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

/**
 * Generates the 5 standard Dexie CRUD operations for a table.
 * `update` always stamps `updatedAt: Date.now()`.
 *
 * For entities that need cascade delete, write that function manually
 * and use the other 4 generated ops.
 */
export function makeTableOps<T>(options: TableOpsOptions<T>): TableOps<T> {
  const { tableName, scopeField, sortFn } = options;

  return {
    async getAll(scopeId: string): Promise<T[]> {
      const items = await db.table(tableName).where(scopeField).equals(scopeId).toArray();
      return sortFn ? items.sort(sortFn) : items;
    },

    getOne(id: string): Promise<T | undefined> {
      return db.table(tableName).get(id);
    },

    async create(item: T): Promise<string> {
      return (await db.table(tableName).add(item)) as string;
    },

    async update(id: string, changes: Partial<T>): Promise<void> {
      await db.table(tableName).update(id, { ...changes, updatedAt: Date.now() });
    },

    async delete(id: string): Promise<void> {
      await db.table(tableName).delete(id);
    },
  };
}
