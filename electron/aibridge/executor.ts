// ============================================================================
// AI bridge — the one door every tool call goes through (main process)
// ============================================================================
//
// Before this module, the HTTP route did the lookup, the write switch, the
// relay and the audit line inline, and the copilot would have had to copy all
// of it — the exact divergence tasks/lessons.md #23 forbids. Now the route,
// the MCP adapter (through the route) and the copilot's agent loop all call
// `executeTool` and get the same verdicts, the same audit trail and the same
// undo handle. The logic itself lives in src/services/aiRuntime/executorCore
// (pure, tested in the critical suite); this file only wires the real relay,
// the real switch and the real audit log.

import { createToolExecutor } from '@/services/aiRuntime/executorCore';
import { callRenderer } from './rpc';
import { appendAudit, getBridgeConfig } from './state';

export type { ExecuteOptions, ExecuteResult, ToolCall } from '@/services/aiRuntime/executorCore';

export const executeTool = createToolExecutor({
  writesEnabled: async () => (await getBridgeConfig()).writesEnabled,
  relay: (tool, args, timeoutMs) => callRenderer(tool, args, timeoutMs),
  audit: (line) => appendAudit(line),
});
