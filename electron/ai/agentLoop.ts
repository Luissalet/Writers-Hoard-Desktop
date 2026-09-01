// ============================================================================
// AI runtime — the copilot's agent loop (main process)
// ============================================================================
//
// One user message in, a stream of events out. Each round: pick a small set
// of tools for the turn, stream the model, and when it asks for tools, run
// them one by one through the SAME executor the MCP port uses — policy,
// project scope, audit and undo included — feed the results back and go
// again. Bounded by rounds, calls, bytes and a no-repeat rule so a confused
// small model cannot spin.
//
// Approvals: under the "ask" policy the executor calls back here before a
// write; the loop emits `tool-proposed` and waits for the renderer's answer
// (or a timeout, which counts as no). Cancel aborts the current stream and
// fails any pending approval.

import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { buildCopilotSystemPrompt } from '@/services/aiRuntime/prompts';
import { toolRisk } from '@/services/aiRuntime/toolPolicy';
import { selectToolsForTurn } from '@/services/aiRuntime/toolSelection';
import type { CopilotEvent, CopilotRunRequest } from '@/services/aiRuntime/copilot';
import type { AiChatMessage, AiStreamEvent, AiToolCall, AiToolSpec } from '@/services/aiRuntime/types';
import { executeTool } from '../aibridge/executor';
import { cancelRequest, listModels, startChat } from './inferenceGateway';

const MAX_ROUNDS = 8;
const MAX_CALLS = 20;
/** What the model sees of a tool result; the rest is summarised away. */
const TOOL_RESULT_LIMIT = 16_000;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
/** Reply written for a call the user stopped before it could run. */
const CANCELLED_TOOL_ERROR = 'The user stopped the turn before this call ran.';

export type { CopilotEvent, CopilotRunRequest } from '@/services/aiRuntime/copilot';

interface RunState {
  cancelled: boolean;
  currentRequestId: string | null;
  approvals: Map<string, (approved: boolean) => void>;
}

const runs = new Map<string, RunState>();

function toSpecs(tools: ReturnType<typeof selectToolsForTurn>): AiToolSpec[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.schema }));
}

/** Compact JSON for the model: strips media blobs, caps the size. */
function resultTextFor(value: unknown): string {
  let text: string;
  try {
    const clone = value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : value;
    if (clone && typeof clone === 'object' && '_media' in (clone as Record<string, unknown>)) {
      const media = (clone as Record<string, unknown>)._media;
      delete (clone as Record<string, unknown>)._media;
      (clone as Record<string, unknown>)._note = `${Array.isArray(media) ? media.length : 1} image(s) omitted from this text view.`;
    }
    text = JSON.stringify(clone ?? null);
  } catch {
    text = String(value);
  }
  if (text.length <= TOOL_RESULT_LIMIT) return text;
  return `${text.slice(0, TOOL_RESULT_LIMIT)}… [truncated: ${text.length - TOOL_RESULT_LIMIT} more characters; ask for a narrower query]`;
}

function summaryFor(tool: string, ok: boolean, result: unknown, error?: string): string {
  if (!ok) return error ? error.slice(0, 160) : `${tool} failed`;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.summary === 'string') return r.summary.slice(0, 160);
    if (Array.isArray(r.hits)) return `${r.hits.length} hit(s)`;
    for (const key of Object.keys(r)) {
      if (Array.isArray(r[key])) return `${(r[key] as unknown[]).length} ${key}`;
    }
    if (typeof r.title === 'string') return r.title.slice(0, 120);
    if (r.created === true) return 'created';
    if (r.deleted === true) return 'deleted';
  }
  return 'ok';
}

function streamTurn(
  request: Parameters<typeof startChat>[0],
  state: RunState,
  emit: (event: CopilotEvent) => void,
): Promise<{ content: string; toolCalls: AiToolCall[]; finish: string; error?: { code: string; message: string } }> {
  return new Promise((resolve) => {
    let content = '';
    const toolCalls: AiToolCall[] = [];
    let settled = false;
    const finish = (value: Parameters<typeof resolve>[0]): void => {
      if (settled) return;
      settled = true;
      state.currentRequestId = null;
      resolve(value);
    };
    state.currentRequestId = startChat(request, (event: AiStreamEvent) => {
      switch (event.type) {
        case 'delta':
          content += event.text;
          emit({ type: 'delta', text: event.text });
          break;
        case 'reasoning':
          emit({ type: 'reasoning', text: event.text });
          break;
        case 'tool-call':
          toolCalls.push(event.call);
          break;
        case 'usage':
          emit({ type: 'usage', usage: event.usage });
          break;
        case 'done':
          finish({ content, toolCalls, finish: event.finishReason });
          break;
        case 'cancelled':
          finish({ content, toolCalls, finish: 'cancelled' });
          break;
        case 'error':
          finish({ content, toolCalls, finish: 'error', error: { code: event.code, message: event.message } });
          break;
        default:
          break;
      }
    });
  });
}

export async function runCopilotTurn(
  request: CopilotRunRequest,
  emit: (event: CopilotEvent) => void,
): Promise<void> {
  const state: RunState = { cancelled: false, currentRequestId: null, approvals: new Map() };
  runs.set(request.runId, state);
  const usedTools = new Set(request.usedTools ?? []);
  const failedSignatures = new Set<string>();
  let totalCalls = 0;
  let rounds = 0;

  try {
    // Does the model do tools? Ask the gateway's cache; unknown means try.
    let toolsAvailable = request.toolsMode !== 'off';
    if (toolsAvailable) {
      try {
        const models = await listModels(request.route.connectionId, false);
        const model = models.find((m) => m.id === request.route.modelId);
        if (model && !model.capabilities.includes('tools')) toolsAvailable = false;
      } catch {
        // unreachable model list: the chat itself will say
      }
    }

    const historyMessages: AiChatMessage[] = [...request.history];
    const conversation: AiChatMessage[] = [...historyMessages, { role: 'user', content: request.message }];
    let chatOnlyNoticeSent = !toolsAvailable;
    let announced = false;

    for (rounds = 1; rounds <= MAX_ROUNDS; rounds += 1) {
      if (state.cancelled) {
        emit({ type: 'cancelled' });
        return;
      }
      const selected = toolsAvailable
        ? selectToolsForTurn({
            tools: BRIDGE_TOOLS,
            message: request.message,
            openEngine: request.briefing.openEngine,
            enabledEngines: request.briefing.enabledEngines,
            readOnly: request.policy === 'read-only',
            usedTools: [...usedTools],
            max: request.maxTools ?? 16,
          })
        : [];
      const systemPrompt = buildCopilotSystemPrompt({
        ...request.briefing,
        projectId: request.projectId,
        policy: request.policy,
        toolsAvailable,
        offeredTools: selected.map((t) => t.name),
      });
      if (!announced) {
        announced = true;
        emit({
          type: 'started',
          connectionId: request.route.connectionId,
          modelId: request.route.modelId,
          tools: selected.map((t) => t.name),
          chatOnly: !toolsAvailable,
        });
        if (!toolsAvailable) emit({ type: 'notice', code: 'chat-only' });
      }

      const turn = await streamTurn(
        {
          connectionId: request.route.connectionId,
          modelId: request.route.modelId,
          messages: [{ role: 'system', content: systemPrompt }, ...conversation],
          tools: selected.length ? toSpecs(selected) : undefined,
          contextTokens: request.contextTokens,
          maxTokens: 4096,
        },
        state,
        emit,
      );

      if (turn.finish === 'cancelled' || state.cancelled) {
        emit({ type: 'cancelled' });
        return;
      }
      if (turn.error) {
        // A server that chokes on tools gets one more try as a plain chat.
        if (turn.error.code === 'tools-unsupported' && toolsAvailable) {
          toolsAvailable = false;
          if (!chatOnlyNoticeSent) {
            chatOnlyNoticeSent = true;
            emit({ type: 'notice', code: 'tools-dropped' });
          }
          rounds -= 1;
          continue;
        }
        emit({ type: 'error', code: turn.error.code, message: turn.error.message });
        return;
      }

      const assistant: AiChatMessage = {
        role: 'assistant',
        content: turn.content,
        toolCalls: turn.toolCalls.length ? turn.toolCalls : undefined,
      };
      conversation.push(assistant);
      emit({ type: 'assistant-message', content: turn.content, toolCalls: assistant.toolCalls });

      if (!turn.toolCalls.length) {
        emit({ type: 'done', finishReason: turn.finish, rounds, toolCalls: totalCalls });
        return;
      }

      for (let index = 0; index < turn.toolCalls.length; index += 1) {
        const call = turn.toolCalls[index];
        if (state.cancelled) {
          // Every call the assistant asked for still needs its answer row: a
          // stored turn whose tool_calls are only half answered is one no
          // provider will replay again.
          for (const pending of turn.toolCalls.slice(index)) {
            emit({
              type: 'tool-result',
              callId: pending.id,
              tool: pending.name,
              ok: false,
              code: 'cancelled',
              error: CANCELLED_TOOL_ERROR,
              resultText: JSON.stringify({ error: CANCELLED_TOOL_ERROR, code: 'cancelled' }),
              summary: summaryFor(pending.name, false, undefined, CANCELLED_TOOL_ERROR),
            });
          }
          emit({ type: 'cancelled' });
          return;
        }
        const tool = getBridgeTool(call.name);
        const risk = tool ? toolRisk(tool) : 'read';
        const signature = `${call.name}:${JSON.stringify(call.args ?? {})}`;
        totalCalls += 1;

        let ok = false;
        let code: string | undefined;
        let error: string | undefined;
        let result: unknown;
        let auditIndex: number | undefined;

        if (totalCalls > MAX_CALLS) {
          code = 'limit';
          error = `Tool budget exhausted (${MAX_CALLS} calls in one turn). Summarise what you have and stop.`;
          emit({ type: 'notice', code: 'limit-calls' });
        } else if (failedSignatures.has(signature)) {
          code = 'repeat';
          error = 'You already made this exact call and it failed. Do not repeat it; change the arguments or explain the problem to the user.';
        } else {
          emit({ type: 'tool-running', callId: call.id, tool: call.name, args: call.args, risk });
          const outcome = await executeTool(
            { tool: call.name, args: call.args ?? {} },
            {
              origin: 'copilot',
              projectId: request.projectId,
              conversationId: request.threadId,
              clientLabel: 'copilot',
              actionPolicy: request.policy,
            },
            {
              approve: (bridgeTool, args) =>
                new Promise<boolean>((resolve) => {
                  if (state.cancelled) {
                    resolve(false);
                    return;
                  }
                  const timer = setTimeout(() => {
                    state.approvals.delete(call.id);
                    resolve(false);
                  }, APPROVAL_TIMEOUT_MS);
                  state.approvals.set(call.id, (approved) => {
                    clearTimeout(timer);
                    state.approvals.delete(call.id);
                    if (approved) emit({ type: 'tool-running', callId: call.id, tool: call.name, args, risk });
                    resolve(approved);
                  });
                  emit({ type: 'tool-proposed', callId: call.id, tool: bridgeTool.name, args, risk });
                }),
            },
          );
          ok = outcome.ok;
          code = outcome.code;
          error = outcome.error;
          result = outcome.result;
          auditIndex = outcome.auditIndex;
          if (!ok) failedSignatures.add(signature);
          usedTools.add(call.name);
        }

        const resultText = ok ? resultTextFor(result) : JSON.stringify({ error, code });
        emit({
          type: 'tool-result',
          callId: call.id,
          tool: call.name,
          ok,
          code,
          error,
          resultText,
          summary: summaryFor(call.name, ok, result, error),
          auditIndex,
        });
        conversation.push({ role: 'tool', content: resultText, toolCallId: call.id, name: call.name });
      }
    }

    emit({ type: 'notice', code: 'limit-rounds' });
    emit({ type: 'done', finishReason: 'limit', rounds: MAX_ROUNDS, toolCalls: totalCalls });
  } catch (err) {
    if (state.cancelled) emit({ type: 'cancelled' });
    else emit({ type: 'error', code: 'internal', message: err instanceof Error ? err.message : String(err) });
  } finally {
    for (const settle of state.approvals.values()) settle(false);
    state.approvals.clear();
    runs.delete(request.runId);
  }
}

export function cancelCopilotRun(runId: string): boolean {
  const state = runs.get(runId);
  if (!state) return false;
  state.cancelled = true;
  if (state.currentRequestId) cancelRequest(state.currentRequestId);
  for (const settle of state.approvals.values()) settle(false);
  state.approvals.clear();
  return true;
}

export function answerCopilotApproval(runId: string, callId: string, approved: boolean): boolean {
  const settle = runs.get(runId)?.approvals.get(callId);
  if (!settle) return false;
  settle(approved);
  return true;
}

export function cancelAllCopilotRuns(): void {
  for (const runId of [...runs.keys()]) cancelCopilotRun(runId);
}
