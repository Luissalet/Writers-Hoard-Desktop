// ============================================================================
// AI bridge — asking the human before deleting
// ============================================================================
//
// A bridge tool runs outside React, so it cannot render a dialog. It puts a
// request in here and awaits the promise; BridgeConfirmHost, mounted once in
// the layout, renders the app's ConfirmDialog for whatever is pending.
//
// Never `window.confirm`: a native dialog can auto-resolve as TRUE when the
// tab wakes from sleep, and that already destroyed a user's Timeline once
// (tasks/lessons.md). A deletion asked for by a model is exactly the case
// where that must not happen.

export interface BridgeConfirmRequest {
  id: string;
  title: string;
  message: string;
  /** Resolved by the host component; false on timeout or when no UI answers. */
  settle: (confirmed: boolean) => void;
}

type Listener = (pending: BridgeConfirmRequest | null) => void;

const queue: BridgeConfirmRequest[] = [];
const listeners = new Set<Listener>();
let sequence = 0;

/** How long a request waits before it gives up and denies. */
const ANSWER_WINDOW_MS = 120_000;

function notify(): void {
  const head = queue[0] ?? null;
  for (const listener of listeners) listener(head);
}

export function subscribeBridgeConfirm(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask the person at the keyboard. Resolves false if nobody answers in time,
 * so an unattended app denies rather than deletes.
 */
export function requestBridgeConfirmation(details: {
  title: string;
  message: string;
  /** Overridable so a test does not have to wait two minutes to prove denial. */
  timeoutMs?: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const id = `confirm-${(sequence += 1)}`;

    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const index = queue.findIndex((entry) => entry.id === id);
      if (index !== -1) queue.splice(index, 1);
      notify();
      resolve(confirmed);
    };

    const timer = setTimeout(() => finish(false), details.timeoutMs ?? ANSWER_WINDOW_MS);
    queue.push({ id, title: details.title, message: details.message, settle: finish });
    notify();
  });
}

/** Diagnostics: how many requests are waiting for a human right now. */
export function pendingConfirmations(): number {
  return queue.length;
}
