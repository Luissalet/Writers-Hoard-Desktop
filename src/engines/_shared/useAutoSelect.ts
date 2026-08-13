import { useEffect, useRef } from 'react';

/**
 * Automatically sets the active ID to the first item in the list
 * whenever the list changes and no item is currently selected.
 *
 * It also recovers from a *dangling* selection: deleting the selected item used
 * to leave the engine pointing at an id that no longer existed, rendering an
 * empty panel with no way back short of a remount.
 *
 * The `seen` ref is what makes that safe. An id is only treated as dangling
 * once it has actually been observed in the list, so an optimistic selection
 * ("I just created this, select it") is never overridden during the render or
 * two before the fetch catches up.
 */
export function useAutoSelect<T extends { id: string }>(
  items: T[],
  activeId: string,
  setActive: (id: string) => void,
): void {
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (items.length === 0) return;

    if (items.some((item) => item.id === activeId)) {
      seen.current = activeId;
      return;
    }

    if (!activeId || seen.current === activeId) {
      seen.current = items[0].id;
      setActive(items[0].id);
    }
  }, [items, activeId, setActive]);
}
