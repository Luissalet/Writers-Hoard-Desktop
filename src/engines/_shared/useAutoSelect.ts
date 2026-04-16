import { useEffect } from 'react';

/**
 * Automatically sets the active ID to the first item in the list
 * whenever the list changes and no item is currently selected.
 */
export function useAutoSelect<T extends { id: string }>(
  items: T[],
  activeId: string,
  setActive: (id: string) => void,
): void {
  useEffect(() => {
    if (items.length > 0 && !activeId) {
      setActive(items[0].id);
    }
  }, [items, activeId, setActive]);
}
