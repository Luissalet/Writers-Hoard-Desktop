import type { Writing } from '@/types';
import { makeEntityHook } from '../_shared/makeEntityHook';
import * as ops from './operations';

/**
 * Writings CRUD. Migrated onto `makeEntityHook` (2026-07-11) so it inherits the
 * initial-load-only `loading` semantics + stale-fetch guard. This is what stops
 * the flagship editor from unmounting (kicking the user back to the list) on
 * every save/status-change — previously this hook was a hand-rolled duplicate
 * that flipped `loading=true` on each refresh.
 */
const useWritingsEntity = makeEntityHook<Writing>({
  fetchFn: ops.getWritings,
  createFn: ops.createWriting,
  updateFn: ops.updateWriting,
  deleteFn: ops.deleteWriting,
});

export function useWritings(projectId: string) {
  const { items, loading, refetching, refresh, addItem, editItem, removeItem } =
    useWritingsEntity(projectId);
  return {
    writings: items,
    loading,
    refetching,
    refresh,
    addWriting: addItem,
    editWriting: editItem,
    removeWriting: removeItem,
  };
}
