import { useCallback, useEffect, useState } from 'react';
import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Note } from './types';

export const useNotes = makeEntityHook<Note>({
  fetchFn: ops.getNotes,
  createFn: ops.createNote,
  updateFn: ops.updateNote,
  deleteFn: ops.deleteNote,
});

/**
 * Inbox counter for the sidebar. Refreshes on the `wh:notes-changed` event
 * that every capture path dispatches, so the badge is correct no matter which
 * surface created the note (composer, in-app shortcut, or the floating
 * quick-capture window relaying through IPC).
 */
export function useInboxNoteCount(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    void ops.countInboxNotes().then(setCount).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('wh:notes-changed', refresh);
    return () => window.removeEventListener('wh:notes-changed', refresh);
  }, [refresh]);

  return count;
}

/** Tell every mounted notes surface that the table changed. */
export function notifyNotesChanged(): void {
  window.dispatchEvent(new Event('wh:notes-changed'));
}
