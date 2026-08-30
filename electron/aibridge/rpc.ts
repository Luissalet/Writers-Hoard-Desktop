// ============================================================================
// AI bridge — main → renderer request/response channel
// ============================================================================
//
// Every piece of user data lives in Dexie/IndexedDB inside the renderer, so a
// tool call arriving at the local HTTP port cannot be served here: it has to
// be relayed to the main window and answered from there.
//
// Electron gives us `handle`/`invoke` in the renderer→main direction only, and
// `webContents.send` with no way back. This module builds the missing half:
//
//   main      mainWindow.webContents.send('aibridge:request', { id, tool, args })
//   renderer  ipcRenderer.invoke('aibridge:reply', { id, ok, result, error })
//   main      resolveBridgeReply() settles the promise `callRenderer` returned
//
// Both channels are declared in electron/security.ts for the 'main' role only.
// An unlisted channel fails closed, so adding a channel here without adding it
// there produces a silent, permanent "Forbidden IPC sender".

import type { BrowserWindow } from 'electron';

/** Shape every bridge tool call resolves to, success or failure. */
export interface BridgeCallResult {
  ok: boolean;
  result?: unknown;
  /** Human-readable, safe to show a model. */
  error?: string;
  /** Machine-readable: 'app-closed' | 'timeout' | 'unknown-tool' | 'writes-disabled' | 'tool-error' | 'bad-args'. */
  code?: string;
}

interface PendingCall {
  resolve: (value: BridgeCallResult) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 45_000;

const pending = new Map<string, PendingCall>();
let sequence = 0;
let resolveWindow: (() => BrowserWindow | null) | null = null;

/** Wire the resolver once, from main.ts, so this module never imports state. */
export function setBridgeWindowResolver(resolver: () => BrowserWindow | null): void {
  resolveWindow = resolver;
}

function settle(id: string, value: BridgeCallResult): void {
  const call = pending.get(id);
  if (!call) return;
  clearTimeout(call.timer);
  pending.delete(id);
  call.resolve(value);
}

/**
 * Ask the main window to run one tool and wait for its answer.
 * Never throws: transport failures come back as `{ ok: false, code }`.
 */
export function callRenderer(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BridgeCallResult> {
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const win = resolveWindow?.() ?? null;
  if (!win || win.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      code: 'app-closed',
      error: 'Writers Hoard is not open. Its data lives inside the app, so it must be running for this tool to work.',
    });
  }

  const id = `wh-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
  return new Promise<BridgeCallResult>((resolve) => {
    const timer = setTimeout(() => {
      settle(id, {
        ok: false,
        code: 'timeout',
        error: `The app did not answer within ${Math.round(budget / 1000)}s. It may still be starting up.`,
      });
    }, budget);
    pending.set(id, { resolve, timer });
    try {
      win.webContents.send('aibridge:request', { id, tool, args });
    } catch (err) {
      settle(id, { ok: false, code: 'app-closed', error: String(err) });
    }
  });
}

/** Called from the `aibridge:reply` IPC handler once the sender is trusted. */
export function resolveBridgeReply(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const { id, ok, result, error, code } = payload as Record<string, unknown>;
  if (typeof id !== 'string') return;
  settle(id, {
    ok: ok === true,
    result,
    error: typeof error === 'string' ? error : undefined,
    code: typeof code === 'string' ? code : undefined,
  });
}

/** Fail every in-flight call at once — the window went away mid-flight. */
export function rejectAllPendingCalls(reason: string): void {
  for (const id of [...pending.keys()]) {
    settle(id, { ok: false, code: 'app-closed', error: reason });
  }
}

/** Diagnostics for /api/health. */
export function pendingCallCount(): number {
  return pending.size;
}
