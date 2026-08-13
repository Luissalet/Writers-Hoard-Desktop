import { useCallback, useEffect, useRef, useState } from 'react';

export interface DebouncedFieldOptions {
  /** How long to wait after the last keystroke before writing. */
  delayMs?: number;
}

export interface DebouncedField {
  /** Bind to the input's `value`. */
  value: string;
  /** Bind to the input's `onChange` (pass the new string, not the event). */
  onChange: (next: string) => void;
  /** Bind to the input's `onBlur` — commits immediately. */
  onBlur: () => void;
  /** Commit right now (Ctrl+S handlers, explicit Save buttons). */
  flush: () => void;
  /** True while there are keystrokes not yet written. */
  dirty: boolean;
}

/**
 * A text field whose keystrokes are buffered locally and written once the
 * author pauses.
 *
 * Five engines used to call their `editItem` on **every keystroke**. Each call
 * is a Dexie write followed by a full `refresh()` of the table, and the input
 * was `value`-bound to the row coming back from that refresh. Two things went
 * wrong, both of them daily annoyances rather than edge cases:
 *
 *  • **Characters got dropped.** A refresh that resolves after you typed the
 *    next letter reinstates the older string, and the caret jumps to the end.
 *  • **The list reordered under you.** `character-arc` and `relationships` sort
 *    by `updatedAt desc`, so typing a title made the row you were editing hop
 *    to the top of the list on every letter.
 *
 * The remote value is adopted whenever it changes *and* the field is clean, so
 * external edits (a restore, another window, an AI action) still land. While
 * the field is dirty the author's typing wins — a refresh can never overwrite
 * it mid-word.
 *
 * Pending text is always flushed on blur and on unmount, so navigating away or
 * closing a modal never loses the last few characters.
 */
export function useDebouncedField(
  remoteValue: string,
  commit: (value: string) => void,
  options: DebouncedFieldOptions = {},
): DebouncedField {
  const { delayMs = 400 } = options;

  const [value, setValue] = useState(remoteValue);
  const [seenRemote, setSeenRemote] = useState(remoteValue);
  const [dirty, setDirty] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the unmount cleanup never closes over a stale render.
  const pending = useRef<string | null>(null);
  const commitRef = useRef(commit);
  // Synced in an effect rather than assigned during render: writing to a ref
  // while rendering is exactly what `react-hooks/refs` forbids, and the timer
  // and the unmount cleanup are the only readers — both run after commit.
  useEffect(() => {
    commitRef.current = commit;
  });

  // Render-adjust rather than an effect: adopting the remote value is derived
  // state, and setState inside an effect is exactly the cascading-render
  // pattern the React Compiler lint rejects.
  if (remoteValue !== seenRemote) {
    setSeenRemote(remoteValue);
    if (!dirty) setValue(remoteValue);
  }

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    setDirty(false);
    commitRef.current(next);
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      setDirty(true);
      pending.current = next;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const queued = pending.current;
        pending.current = null;
        if (queued === null) return;
        setDirty(false);
        commitRef.current(queued);
      }, delayMs);
    },
    [delayMs],
  );

  // Never lose the tail of a sentence to a navigation or a closing modal.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      const queued = pending.current;
      pending.current = null;
      if (queued !== null) commitRef.current(queued);
    };
  }, []);

  return { value, onChange, onBlur: flush, flush, dirty };
}
