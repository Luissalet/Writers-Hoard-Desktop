// ============================================================================
// "Something else wrote to Dexie" — the one window event every list hook obeys
// ============================================================================
//
// The entity hooks (makeEntityHook, makeGraphHook, makeReadOnlyHook) fetch
// once per scope and refetch after their OWN writes. Anything that writes
// around them — the AI bridge answering an external client, the copilot
// acting on a request, an undo — changed the table but not the screen: the
// writer asked for a codex entry, the model made it, and the Codex tab kept
// showing the old list until it was remounted. The notes engine solved this
// for itself with `wh:notes-changed`; this is the same idea for everyone.
//
// The detail names what changed when the writer knows (the audit envelope
// carries table and entity); hooks may use it to skip a refetch that cannot
// concern them, and refetch when in doubt. Refetching is a handful of Dexie
// reads, and a model writes a few times a minute at most.

export const DATA_CHANGED_EVENT = 'wh:data-changed';

export interface DataChangedDetail {
  /** Who wrote: `ai` for a bridge/copilot tool, `undo` for a reverted change. */
  source: 'ai' | 'undo' | 'import' | 'other';
  /** Tool name for AI writes. */
  tool?: string;
  /** Dexie table the writer touched, when it said. */
  table?: string;
  entityId?: string;
  projectId?: string;
}

/** Tell every mounted list that a table changed under it. Safe to call anywhere. */
export function notifyDataChanged(detail: DataChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DataChangedDetail>(DATA_CHANGED_EVENT, { detail }));
}

/**
 * Subscribe to the event; returns the unsubscribe. Kept out of React so the
 * three hook factories and any store can share it.
 */
export function onDataChanged(listener: (detail: DataChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<DataChangedDetail>).detail ?? { source: 'other' });
  };
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
}
