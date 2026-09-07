// ============================================
// Close guard — answering "the window is closing" honestly
// ============================================
//
// The chapter editor used to hold the window with `beforeunload` +
// `preventDefault()`. That is the browser gesture for "leave site?"; an
// Electron renderer has no such prompt, so the call cancelled the close and
// put NOTHING on screen. The writer pressed the X, the window sat there, and
// they pressed it again. While a save kept failing — quota exhausted, the row
// deleted underneath the editor — the X could not close the window at all, and
// the only way out was a force-kill: the one exit that beats the recovery
// journal the whole veto existed to protect.
//
// So the veto lives in the main process now (electron/main.ts), and this is
// the renderer's half of the conversation:
//
//   • `reportUnsavedWork` tells main whether anything is at risk. While
//     nothing is, main never intercepts a close at all — the X stays instant.
//   • a registered guard gets asked, once per close, to flush. Answering
//     `true` lets the window go; answering `false` means the guard has put a
//     dialog in front of the writer and owns the question from there.
//   • `closeAppWindow` is how that dialog finishes the job.
//
// The contract that matters: a guard may delay the close, but the writer is
// never left watching a button do nothing. A guard that answers `false`
// without showing anything, or that never answers at all, is a bug — and main
// escalates to a native dialog rather than trusting us about it.

import type { ShutdownWarning } from '@/electron-env';

/**
 * Asked once per attempted close. Resolve `true` when the window may go
 * (including "there was nothing to save"), `false` only when the writer is
 * now looking at a question about it.
 */
export type CloseGuard = () => boolean | Promise<boolean>;

const guards = new Set<CloseGuard>();
const warnings = new Map<string, ShutdownWarning>();
let unsubscribe: (() => void) | null = null;

/**
 * Every guard runs, and every one is awaited, even after one has already
 * refused: a guard's job is to flush, and skipping the flush of chapter two
 * because chapter one raised a dialog would lose exactly the words we are
 * here to keep.
 */
export async function runCloseGuards(
  toRun: Iterable<CloseGuard> = guards,
): Promise<boolean> {
  const verdicts = await Promise.all(
    [...toRun].map(async (guard) => {
      try {
        return await guard();
      } catch {
        // A guard that threw has decided nothing. Refusing here would hold the
        // window on the strength of a bug; main's dialog is the safety net.
        return true;
      }
    }),
  );
  return verdicts.every(Boolean);
}

function install(): void {
  // `shutdown` is tested separately from `electronAPI` itself, because the two
  // can disagree: the web build has no bridge at all, and a desktop build whose
  // preload predates this namespace has a bridge without it. Reading through an
  // absent namespace threw during render and took the whole writings engine
  // down with it — a close-the-window convenience is never worth that, so its
  // absence has to mean "no guard", not "no editor".
  const shutdown = window.electronAPI?.shutdown;
  if (!shutdown?.onRequest || unsubscribe) return;
  unsubscribe = shutdown.onRequest((requestId) => {
    void runCloseGuards().then((proceed) => {
      window.electronAPI?.shutdown?.reply?.(requestId, proceed);
    });
  });
}

function uninstall(): void {
  unsubscribe?.();
  unsubscribe = null;
}

/** Register a guard for as long as its owner is mounted. */
export function registerCloseGuard(guard: CloseGuard): () => void {
  guards.add(guard);
  install();
  return () => {
    guards.delete(guard);
    if (guards.size === 0) {
      uninstall();
      // Nothing is left to hold the window, so nothing may claim it is.
      warnings.clear();
      window.electronAPI?.shutdown?.setWarning?.(null);
    }
  };
}

/**
 * Tell the main process whether there is unsaved text — and hand it the words
 * to use if this renderer stops answering. Main has no `t()`; translating here
 * is what keeps those strings in the locale files with every other string.
 *
 * Call it on the transition, not on every keystroke: it is a report about a
 * state, not an event.
 */
export function reportUnsavedWork(
  warning: ShutdownWarning | null,
  ownerId = 'default',
): void {
  if (warning) warnings.set(ownerId, warning);
  else warnings.delete(ownerId);

  // Several editors can own buffered work at once (for example a chapter
  // body plus a debounced metadata field). Clearing one warning must not erase
  // the other owner's safety net in the main process.
  const activeWarning = [...warnings.values()].at(-1) ?? null;
  window.electronAPI?.shutdown?.setWarning?.(activeWarning);
}

/**
 * Close the window now — the writer said so in the renderer's own dialog.
 * A no-op in the browser build, where there is no window to close and the
 * native `beforeunload` prompt is still the right (and visible) answer.
 */
export function closeAppWindow(): void {
  window.electronAPI?.shutdown?.closeNow?.();
}

/**
 * The writer read the dialog and chose to stay. Ending the round is the point:
 * the next press of the X asks the guards again, so it retries the save rather
 * than escalating straight past it.
 */
export function keepAppWindow(): void {
  window.electronAPI?.shutdown?.keepOpen?.();
}
