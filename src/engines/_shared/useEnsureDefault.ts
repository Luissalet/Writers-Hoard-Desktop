import { useEffect, useRef } from 'react';

export interface EnsureDefaultOptions<T extends { id: string }> {
  /** Current item list from the CRUD hook */
  items: T[];
  /** Whether the CRUD hook is still loading — prevents race conditions */
  loading: boolean;
  /** Factory that returns the default item to create */
  createDefault: () => T;
  /** The CRUD hook's addItem function */
  addItem: (item: T) => Promise<void>;
  /** Called with the new item's ID after creation */
  onCreated: (id: string) => void;
}

/**
 * Ensures at least one item exists. When `items` is empty and `loading` is
 * false, creates a default item and calls `onCreated` with its ID.
 *
 * Guarded by a ref to fire only once per mount, preventing double-invocation
 * in React Strict Mode.
 */
export function useEnsureDefault<T extends { id: string }>(options: EnsureDefaultOptions<T>): void {
  const { items, loading, createDefault, addItem, onCreated } = options;
  const hasCreated = useRef(false);

  useEffect(() => {
    if (loading || items.length > 0 || hasCreated.current) return;
    hasCreated.current = true;

    const item = createDefault();
    addItem(item).then(() => onCreated(item.id));
  }, [loading, items.length]);
}
