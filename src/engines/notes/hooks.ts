import { useCallback, useEffect, useState } from 'react';
import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Note } from './types';

const useNotesBase = makeEntityHook<Note>({
  fetchFn: ops.getNotes,
  createFn: ops.createNote,
  updateFn: ops.updateNote,
  deleteFn: ops.deleteNote,
});

/**
 * Notes board for a scope, kept live against out-of-band captures.
 *
 * `captureNote()` writes straight to Dexie — the global Ctrl+Shift+N window and
 * the IPC relay never go through this hook. Without the `wh:notes-changed`
 * subscription the sidebar badge went up while the notes tab you were looking
 * at showed nothing new until it was remounted.
 */
export function useNotes(scopeId: string): ReturnType<typeof useNotesBase> {
  const result = useNotesBase(scopeId);
  const { refresh } = result;

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener('wh:notes-changed', onChanged);
    return () => window.removeEventListener('wh:notes-changed', onChanged);
  }, [refresh]);

  return result;
}

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
