import { useSyncExternalStore } from 'react';
import { getUndoJournal, subscribeUndoJournal, type UndoEntry } from './undoJournal';

/** The newest reversible operation of this project, or undefined. Re-renders when the journal changes. */
export function useLastUndoable(projectId: string): UndoEntry | undefined {
  const entries = useSyncExternalStore(subscribeUndoJournal, getUndoJournal, getUndoJournal);
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at].projectId === projectId) return entries[at];
  return undefined;
}
