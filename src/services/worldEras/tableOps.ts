import type { TableOps } from '@/engines/_shared/makeTableOps';
import { listEraRows, mutateEraRows, readEraRow } from './store';
import type { EraRow, WorldEraScope } from './types';
/** Same CRUD contract, with explicit storage context and unchanged Base operations. */
export function scopedTableOps<T extends { id: string }>(scope: WorldEraScope | undefined, table: string, scopeField: string, base: TableOps<T>): TableOps<T> {
  if (!scope?.eraId) return base;
  return {
    getAll: async id => (await listEraRows<T & Record<string, unknown>>(scope, table)).filter(row => row[scopeField] === id),
    getOne: id => readEraRow<T>(scope, table, id),
    create: async row => { await mutateEraRows(scope, [{ table, id: row.id, row: row as unknown as EraRow }]); return row.id; },
    update: async (id, changes) => { await mutateEraRows(scope, [{ table, id, changes }]); },
    delete: async id => { await mutateEraRows(scope, [{ table, id, remove: true }]); },
  };
}
