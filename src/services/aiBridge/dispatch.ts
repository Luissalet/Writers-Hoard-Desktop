// ============================================================================
// AI bridge — renderer side of the main↔renderer channel
// ============================================================================
//
// The local HTTP port lives in the main process, but every byte of user data
// lives here, in Dexie. Main relays each tool call over 'aibridge:request';
// this module runs it and answers on 'aibridge:reply'.
//
// Wired at MODULE scope with a window-keyed guard, exactly like the Ollama
// listeners in stores/aiStore.ts: StrictMode mounts and unmounts effects
// twice in development, and a double subscription here would answer every
// call twice (tasks/lessons.md #19).

import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { getBridgeTool } from './manifest';
import { BridgeError, type ToolArgs } from './tools/shared';
import { INTERNAL_HANDLERS, TOOL_HANDLERS } from './tools';

declare global {
  interface Window {
    __whAiBridgeWired?: boolean;
  }
}

export interface BridgeRequest {
  id: string;
  tool: string;
  args: ToolArgs;
}

export interface BridgeReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

/**
 * Run one tool call. Exported so tests can exercise the dispatch path without
 * an Electron bridge in the room.
 */
export async function runBridgeTool(tool: string, args: ToolArgs): Promise<BridgeReply> {
  const handler = TOOL_HANDLERS[tool] ?? INTERNAL_HANDLERS[tool];
  if (!handler) {
    return {
      id: '',
      ok: false,
      code: 'unknown-tool',
      error: `No handler for "${tool}".`,
    };
  }
  try {
    const result = await handler(args ?? {});
    announceWrite(tool, result);
    return { id: '', ok: true, result };
  } catch (err) {
    if (err instanceof BridgeError) {
      return { id: '', ok: false, code: err.code, error: err.message };
    }
    console.error(`[aibridge] ${tool} failed`, err);
    return {
      id: '',
      ok: false,
      code: 'tool-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * A write that succeeded changed a table no mounted list was watching: say so
 * on the window, with what the audit envelope knows (the executor in main
 * strips `__audit` from what the model sees; here it is still attached).
 * Undo is a write too, and its result names the entity it put back.
 */
function announceWrite(tool: string, result: unknown): void {
  if (tool !== '__undo' && getBridgeTool(tool)?.writes !== true) return;
  const shape = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const audit = (shape.__audit && typeof shape.__audit === 'object' ? shape.__audit : {}) as Record<string, unknown>;
  const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  notifyDataChanged({
    source: tool === '__undo' ? 'undo' : 'ai',
    tool,
    table: str(audit.table),
    entityId: str(audit.entityId) ?? str(shape.entityId),
    projectId: str(audit.projectId),
  });
}

const bridge = typeof window !== 'undefined' ? window.electronAPI?.aiBridge : undefined;

if (bridge && !window.__whAiBridgeWired) {
  window.__whAiBridgeWired = true;

  bridge.onRequest((request) => {
    void (async () => {
      const reply = await runBridgeTool(request.tool, request.args);
      await bridge.reply({ ...reply, id: request.id });
    })();
  });
}
