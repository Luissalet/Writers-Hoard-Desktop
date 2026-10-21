import type { Writing } from '@/types';
import { useMemo } from 'react';
import { makeEntityHook } from '../_shared/makeEntityHook';
import { useEraWritingOperations } from '@/services/worldEras/writings';

/**
 * Writings CRUD. Migrated onto `makeEntityHook` (2026-07-11) so it inherits the
 * initial-load-only `loading` semantics + stale-fetch guard. This is what stops
 * the flagship editor from unmounting (kicking the user back to the list) on
 * every save/status-change — previously this hook was a hand-rolled duplicate
 * that flipped `loading=true` on each refresh.
 */
export function useWritings(projectId: string) {
  const operations = useEraWritingOperations(projectId);
  const useWritingsEntity = useMemo(() => makeEntityHook<Writing>({ fetchFn: operations.getWritings, createFn: operations.createWriting, updateFn: operations.updateWriting, deleteFn: operations.deleteWriting }), [operations]);
  const { items, hasLoaded, loading, refetching, error, refresh, addItem, editItem, removeItem } = useWritingsEntity(projectId);
  return {
    writings: items,
    hasLoaded,
    loading,
    refetching,
    error,
    refresh,
    addWriting: addItem,
    editWriting: editItem,
    removeWriting: removeItem,
  };
}
