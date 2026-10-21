import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { makeEntityHook, type EntityHookOptions } from '@/engines/_shared/makeEntityHook';
import { getEraProject, listEraRows, mutateEraRows } from './store';
import type { EraRow, WorldEraScope } from './types';
export function useWorldEraScope(projectId?: string): WorldEraScope {
  const pane = useEnginePane(), owner = projectId ?? pane?.projectId ?? '', eraId = pane?.eraId;
  return useMemo(() => ({ projectId: owner, eraId }), [owner, eraId]);
}
export function useEraProject(projectId: string) {
  const scope = useWorldEraScope(projectId);
  return useLiveQuery(async () => await db.projects.get(projectId) ? getEraProject(scope) : undefined, [scope]);
}
export function useEraRows<T>(table: string, projectId?: string): T[] {
  const scope = useWorldEraScope(projectId);
  return useLiveQuery(() => scope.projectId ? listEraRows<T>(scope, table) : [], [scope, table]) ?? [];
}
/** Bind an optional final era parameter, including calls that omit an optional baseline. */
export function bindEraOperation<A extends unknown[], R>(operation: (...args: A) => R, eraId: string | undefined, eraArgument: number): (...args: A) => R {
  return (...args: A) => { const scoped: unknown[] = [...args]; scoped.length = eraArgument; scoped.push(eraId); return operation(...scoped as A); };
}
/** Reuse existing lifecycle hooks while making the storage target explicit per pane. */
export function useEraEntities<T extends { id: string }>(scopeId: string, table: string, scopeField: string, base: EntityHookOptions<T>, projectId?: string, compare?: (a: T, b: T) => number) {
  const scope = useWorldEraScope(projectId ?? (scopeField === 'projectId' ? scopeId : undefined));
  const hook = useMemo(() => makeEntityHook<T>({
    ...base,
    fetchFn: async id => {
      if (!scope.eraId) return base.fetchFn(id);
      const rows = (await listEraRows<T & Record<string, unknown>>(scope, table)).filter(row => row[scopeField] === id);
      return compare ? rows.sort(compare) : rows;
    },
    createFn: async row => { if (!scope.eraId) return base.createFn(row); await mutateEraRows(scope, [{ table, id: row.id, row: row as unknown as EraRow }]); return row.id; },
    updateFn: async (id, changes) => { if (!scope.eraId) return base.updateFn(id, changes); await mutateEraRows(scope, [{ table, id, changes }]); },
    deleteFn: async id => { if (!scope.eraId) return base.deleteFn(id); await mutateEraRows(scope, [{ table, id, remove: true }]); },
  }), [scope, table, scopeField, base, compare]);
  return hook(scopeId);
}
