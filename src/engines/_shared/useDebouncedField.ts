import { useCallback, useEffect, useRef, useState } from 'react';
import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';

let nextFieldId = 0;

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
  flush: () => Promise<boolean>;
  /** Retry the last rejected value without losing newer text. */
  retry: () => Promise<boolean>;
  /** True while there are keystrokes not yet confirmed by storage. */
  dirty: boolean;
  saving: boolean;
  error: Error | null;
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
  commit: (value: string) => void | Promise<void>,
  options: DebouncedFieldOptions = {},
): DebouncedField {
  const { delayMs = 400 } = options;

  const [value, setValue] = useState(remoteValue);
  const [seenRemote, setSeenRemote] = useState(remoteValue);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the unmount cleanup never closes over a stale render.
  const pending = useRef<string | null>(null);
  const failedValue = useRef<string | null>(null);
  const valueRef = useRef(remoteValue);
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const fieldIdRef = useRef(`debounced-field:${++nextFieldId}`);
  const commitRef = useRef(commit);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const retryRef = useRef<() => Promise<boolean>>(async () => true);
  // Synced in an effect rather than assigned during render: writing to a ref
  // while rendering is exactly what `react-hooks/refs` forbids, and the timer
  // and the unmount cleanup are the only readers — both run after commit.
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Render-adjust rather than an effect: adopting the remote value is derived
  // state, and setState inside an effect is exactly the cascading-render
  // pattern the React Compiler lint rejects.
  if (remoteValue !== seenRemote) {
    setSeenRemote(remoteValue);
    if (!dirty) {
      setValue(remoteValue);
      valueRef.current = remoteValue;
    }
  }

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next === null) return queueRef.current;

    const task = queueRef.current.then(async () => {
      if (mountedRef.current) setSaving(true);
      const operation = Promise.resolve().then(() => commitRef.current(next));
      try {
        await trackPendingWrite(
          operation,
          () => retryRef.current(),
          fieldIdRef.current,
        );
        failedValue.current = null;
        if (mountedRef.current) {
          setError(null);
          if (pending.current === null) setDirty(false);
        }
        return true;
      } catch (reason) {
        // A newer buffered value contains the complete field and supersedes
        // this one. Otherwise keep the rejected value as the retry payload.
        if (pending.current === null) failedValue.current = next;
        if (mountedRef.current) {
          setDirty(true);
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
        return false;
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    });
    queueRef.current = task;
    return task;
  }, []);

  const retry = useCallback(async (): Promise<boolean> => {
    if (pending.current === null) pending.current = failedValue.current ?? valueRef.current;
    if (mountedRef.current) setDirty(true);
    return flushRef.current();
  }, []);

  useEffect(() => {
    flushRef.current = flush;
    retryRef.current = retry;
  }, [flush, retry]);

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      valueRef.current = next;
      setDirty(true);
      pending.current = next;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flushRef.current();
      }, delayMs);
    },
    [delayMs],
  );

  // Make dirty/in-flight fields visible to the global close coordinator. Clean
  // fields register nothing, so the global `dirty` count is truthful.
  useEffect(() => {
    if (!dirty && !saving && !error) return;
    return registerPendingFlusher(fieldIdRef.current, () => flushRef.current());
  }, [dirty, error, saving]);

  // Never lose the tail of a sentence to a navigation or a closing modal.
  // StrictMode (and `npm run dev:desktop` is how this app is run) mounts,
  // unmounts and remounts: without re-arming here the field stayed "unmounted"
  // for life, so a save never cleared `dirty`, never showed `saving` and never
  // surfaced its `error` — the same reset every other shared hook performs.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      void flushRef.current();
    };
  }, []);

  const onBlur = useCallback(() => {
    void flushRef.current();
  }, []);

  return { value, onChange, onBlur, flush, retry, dirty, saving, error };
}
