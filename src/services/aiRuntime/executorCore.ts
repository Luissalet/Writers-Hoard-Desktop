// ============================================================================
// AI runtime — the tool executor, with its dependencies injected (pure)
// ============================================================================
//
// The one door every tool call goes through, whoever sent it: the MCP port,
// the copilot's agent loop or an internal feature. Lookup, argument
// validation, project scope, permission, approval, relay, audit line, and the
// stripping of the audit envelope — all here, once. The Electron main process
// wires the real relay and audit log in electron/aibridge/executor.ts; the
// critical tests wire fakes and prove that a bridge call and a copilot call
// produce the same relay and the same audit line.

import { getBridgeTool, type BridgeTool } from '@/services/aiBridge/manifest';
import {
  applyProjectScope,
  decidePermission,
  validateToolArgs,
  type ExecutionContext,
} from './toolPolicy';

export interface RelayResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

export interface AuditLine {
  at: number;
  tool: string;
  client?: string;
  origin?: ExecutionContext['origin'];
  conversationId?: string;
  projectId?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  kind?: 'create' | 'update' | 'delete' | 'undo';
  table?: string;
  ok: boolean;
  error?: string;
}

export interface ExecutorDeps {
  /** Whether the bridge's global write switch is on. */
  writesEnabled: () => Promise<boolean>;
  /** Run the handler where the data lives; never throws. */
  relay: (tool: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<RelayResult>;
  /** Append one audit line; resolves its index, or null when the disk said no. */
  audit: (line: AuditLine) => Promise<number | null>;
  now?: () => number;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ExecuteOptions {
  /**
   * Called before a write runs when the context's policy is "ask". Resolve
   * false (or reject) to refuse the call. Absent means "no one to ask": the
   * call is refused, never silently allowed.
   */
  approve?: (tool: BridgeTool, args: Record<string, unknown>) => Promise<boolean>;
}

export interface ExecuteResult extends RelayResult {
  /** Audit line number of a logged write — what undo is addressed by. */
  auditIndex?: number;
  /** The arguments actually sent, after coercion and scoping. */
  args?: Record<string, unknown>;
}

export function createToolExecutor(deps: ExecutorDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function executeTool(
    call: ToolCall,
    ctx: ExecutionContext,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const tool = getBridgeTool(call.tool);
    if (!tool) {
      return {
        ok: false,
        code: 'unknown-tool',
        error: `No tool named "${call.tool}". Call GET /api/tools for the catalogue.`,
      };
    }

    const validated = validateToolArgs(tool.schema, call.args ?? {});
    if (!validated.ok) return { ok: false, code: validated.code, error: validated.error };

    const scoped = applyProjectScope(tool, validated.args, ctx);
    if (!scoped.ok) return { ok: false, code: scoped.code, error: scoped.error };
    const args = scoped.args;

    const verdict = decidePermission(tool, ctx, await deps.writesEnabled());
    if (!verdict.allowed) return { ok: false, code: verdict.code, error: verdict.error, args };

    if (verdict.needsApproval) {
      let approved = false;
      try {
        approved = options.approve ? await options.approve(tool, args) : false;
      } catch {
        approved = false;
      }
      if (!approved) {
        return {
          ok: false,
          code: 'rejected',
          error: 'The user declined this change. Do not retry it; ask what they would prefer instead.',
          args,
        };
      }
    }

    const outcome = await deps.relay(tool.name, args, tool.timeoutMs);
    if (!tool.writes) return { ...outcome, args };

    const audit =
      outcome.result && typeof outcome.result === 'object'
        ? ((outcome.result as Record<string, unknown>).__audit as Record<string, unknown> | undefined)
        : undefined;
    // What the call did, read off the result rather than declared by each of
    // forty handlers: every create result says `created`, every delete says
    // `deleted`, and anything else that wrote is an update.
    const shape = (outcome.result ?? {}) as Record<string, unknown>;
    const kind = shape.created === true ? 'create' : shape.deleted === true ? 'delete' : 'update';
    const auditIndex = await deps.audit({
      at: now(),
      tool: tool.name,
      client: ctx.clientLabel,
      origin: ctx.origin,
      conversationId: ctx.conversationId,
      ok: outcome.ok,
      error: outcome.error,
      kind: outcome.ok ? kind : undefined,
      table: typeof audit?.table === 'string' ? audit.table : undefined,
      projectId: typeof audit?.projectId === 'string' ? audit.projectId : undefined,
      entityId: typeof audit?.entityId === 'string' ? audit.entityId : undefined,
      summary: typeof audit?.summary === 'string' ? audit.summary : undefined,
      before: audit?.before,
    });
    // The audit envelope is bookkeeping, not an answer: never show it to the model.
    if (outcome.result && typeof outcome.result === 'object') {
      delete (outcome.result as Record<string, unknown>).__audit;
    }
    return { ...outcome, args, auditIndex: auditIndex ?? undefined };
  };
}
