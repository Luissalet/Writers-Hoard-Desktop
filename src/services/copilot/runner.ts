// ============================================================================
// Copilot — one user turn, end to end (renderer)
// ============================================================================
//
// Persists the user's message, replays the thread to main, and turns the
// event stream back into Dexie rows: one assistant row per model turn, one
// tool row per call (with its card state), notices attached to the turn they
// belong to. Reloading the app mid-run leaves rows marked "cancelled" rather
// than a spinner that never stops.

import { runCopilot } from '@/services/aiRuntime/client';
import type { CopilotEvent } from '@/services/aiRuntime/copilot';
import { threadTitleFrom } from '@/services/aiRuntime/prompts';
import type { ActionPolicy } from '@/services/aiRuntime/toolPolicy';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MAX_TOOLS } from '@/services/aiRuntime/constants';
import { useCopilotStore } from '@/stores/copilotStore';
import { generateId } from '@/utils/idGenerator';
import {
  addMessage,
  getThread,
  historyFromMessages,
  listMessages,
  updateMessage,
  updateThread,
} from './threads';
import type { AiMessage, AiToolCallRecord } from './types';

export interface SendTurnOptions {
  projectId: string;
  threadId: string;
  text: string;
  route: AiRouteSelection;
  policy: ActionPolicy;
  briefing: {
    projectTitle: string;
    projectDescription?: string;
    projectMode?: string;
    enabledEngines: string[];
    openEngine?: string | null;
    openDocument?: { engineId: string; id: string; title?: string } | null;
    locale: string;
  };
  toolsMode?: 'auto' | 'off';
}

/** A retry takes its text from the stored user row, so it cannot be given one. */
export type RetryTurnOptions = Omit<SendTurnOptions, 'text'>;

const NOTICE_TEXT: Record<string, string> = {
  'chat-only': 'chat-only',
  'tools-dropped': 'tools-dropped',
  'limit-rounds': 'limit-rounds',
  'limit-calls': 'limit-calls',
};

// A run is only recorded in the store after several awaits (thread lookup, the
// user row). A synchronous guard closes that gap so a fast double-send, a double
// Enter, or a repeated retry click cannot start two concurrent runs on one
// thread before the first registers. Released once setup finishes (the run is
// then in runsByThread and guards itself) or if setup throws.
const startingByThread = new Set<string>();

/** One turn at a time per thread — a live run, or one a few awaits from being one. */
function threadBusy(threadId: string): boolean {
  return Boolean(useCopilotStore.getState().runsByThread[threadId]) || startingByThread.has(threadId);
}

export async function sendCopilotTurn(options: SendTurnOptions): Promise<void> {
  if (threadBusy(options.threadId)) return;
  startingByThread.add(options.threadId);
  try {
    await beginCopilotTurn(options);
  } finally {
    startingByThread.delete(options.threadId);
  }
}

/** What a retry would replay, and what it would throw away first. */
export interface CopilotRetryPlan {
  /** The stored user row whose answer failed. It is replayed, never copied. */
  userMessageId: string;
  text: string;
  /** The failed answer and every tool row that belonged to that same turn. */
  dropIds: string[];
  /** Assistant row the Retry control hangs off, when the turn left one behind. */
  anchorMessageId: string | null;
}

/**
 * Whether the last turn of a thread ended badly enough to be worth running
 * again, decided from the STORED rows alone — so it works just as well on a
 * thread reopened days later as on one that failed a second ago.
 *
 * A turn is the last user row plus everything after it. It ended badly when:
 *   • its last assistant row errored (the 15-minute limit arrives as one) or
 *     was cancelled — including a row a reload settled as cancelled;
 *   • it left no assistant row at all (stopped before the model answered);
 *   • or it ends on a tool card that was rejected or failed, or on one whose
 *     answer never came — a cancel during a tool call leaves exactly that, and
 *     it is the case that used to offer the reader nothing whatsoever.
 *
 * A turn that ends on a finished tool card but whose assistant row DID speak is
 * left alone: the model answered and then had nothing to add, and a Retry there
 * would offer to delete a real answer.
 *
 * Anything still streaming belongs to a live run, which settles itself.
 */
export function planCopilotRetry(messages: AiMessage[]): CopilotRetryPlan | null {
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      userIndex = i;
      break;
    }
  }
  if (userIndex < 0) return null;
  const user = messages[userIndex];
  if (!user.content.trim()) return null;
  const tail = messages.slice(userIndex + 1);
  if (tail.some((message) => message.status === 'streaming')) return null;
  let lastAssistant: AiMessage | null = null;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    if (tail[i].role === 'assistant') {
      lastAssistant = tail[i];
      break;
    }
  }
  const failedVisibly = lastAssistant?.status === 'error' || lastAssistant?.status === 'cancelled';
  const lastRow = tail[tail.length - 1];
  const endedOnTool = lastRow?.role === 'tool';
  const toolStopped = lastRow?.toolCall?.state === 'rejected' || lastRow?.toolCall?.state === 'failed';
  const spoke = Boolean(lastAssistant?.content.trim());
  const endedBadly = !lastAssistant || failedVisibly || (endedOnTool && (toolStopped || !spoke));
  if (!endedBadly) return null;
  return {
    userMessageId: user.id,
    text: user.content,
    dropIds: tail.map((message) => message.id),
    // Only a row that SHOWS the failure carries the control. A turn cut between
    // a tool call and the answer ends on the tool card, and hanging Retry off
    // the assistant row above it would put the button before the failure.
    anchorMessageId: failedVisibly && lastAssistant ? lastAssistant.id : null,
  };
}

/**
 * Run the last turn again from the same history.
 *
 * The user's message is NOT sent a second time: the row that is already there
 * is replayed, the failed answer and its tool rows are deleted, and the model
 * sees exactly the conversation it saw the first time.
 */
export async function retryCopilotTurn(options: RetryTurnOptions): Promise<void> {
  if (threadBusy(options.threadId)) return;
  startingByThread.add(options.threadId);
  try {
    const plan = planCopilotRetry(await listMessages(options.threadId));
    if (!plan) return;
    if (plan.dropIds.length) {
      const { db } = await import('@/db');
      await db.aiMessages.bulkDelete(plan.dropIds);
      useCopilotStore.getState().bumpData();
    }
    await beginCopilotTurn({ ...options, text: plan.text }, plan.userMessageId);
  } finally {
    startingByThread.delete(options.threadId);
  }
}

async function beginCopilotTurn(options: SendTurnOptions, replayUserMessageId?: string): Promise<void> {
  const thread = await getThread(options.threadId);
  if (!thread) return;
  const stored = await listMessages(options.threadId);
  // A retry replays a user row that is already stored, so the history is
  // everything BEFORE it: the agent loop appends `message` as the user turn
  // itself, and leaving the row in would ask the same question twice.
  let previous = stored;
  if (replayUserMessageId) {
    const index = stored.findIndex((message) => message.id === replayUserMessageId);
    if (index < 0) return;
    previous = stored.slice(0, index);
  }
  const { history, usedTools } = historyFromMessages(previous);

  if (!replayUserMessageId) {
    await addMessage({
      threadId: options.threadId,
      projectId: options.projectId,
      role: 'user',
      content: options.text,
      status: 'complete',
    });
  }
  if (!thread.title) await updateThread(thread.id, { title: threadTitleFrom(options.text) });
  await updateThread(thread.id, { route: options.route, policy: options.policy });

  // The row deltas stream into. Created lazily per model turn so a run with
  // three rounds leaves three assistant rows in order, interleaved with tools.
  let assistantId: string | null = null;
  const toolRows = new Map<string, string>(); // callId → message id

  const ensureAssistant = async (): Promise<string> => {
    if (assistantId) return assistantId;
    const id = generateId('msg');
    assistantId = id;
    await addMessage({
      id,
      threadId: options.threadId,
      projectId: options.projectId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      route: options.route,
    });
    useCopilotStore.getState().patchRun(options.threadId, { assistantMessageId: id, buffer: '', reasoning: '' });
    return id;
  };

  const upsertTool = async (record: AiToolCallRecord): Promise<void> => {
    const existing = toolRows.get(record.callId);
    if (existing) {
      await updateMessage(existing, { toolCall: record, content: record.resultText ?? '', status: 'complete' });
      return;
    }
    const row = await addMessage({
      threadId: options.threadId,
      projectId: options.projectId,
      role: 'tool',
      content: record.resultText ?? '',
      status: 'complete',
      toolCall: record,
    });
    toolRows.set(record.callId, row.id);
  };

  const toolState = new Map<string, AiToolCallRecord>();

  const finish = async (status: AiMessage['status'], error?: string): Promise<void> => {
    const run = useCopilotStore.getState().runsByThread[options.threadId];
    if (assistantId) {
      const content = run?.buffer ?? '';
      if (!content && status === 'complete') {
        // A trailing empty placeholder (turn ended on tool results): drop it.
        const { db } = await import('@/db');
        await db.aiMessages.delete(assistantId);
      } else {
        await updateMessage(assistantId, { content, status, error });
      }
    } else if (status === 'error' && error) {
      await addMessage({
        threadId: options.threadId,
        projectId: options.projectId,
        role: 'assistant',
        content: '',
        status: 'error',
        error,
        route: options.route,
      });
    }
    // Any card still waiting is over.
    for (const [callId, record] of toolState) {
      if (record.state === 'proposed' || record.state === 'running') {
        await upsertTool({ ...record, state: status === 'cancelled' ? 'rejected' : 'failed', ok: false, error: error ?? 'cancelled' });
        toolState.set(callId, record);
      }
    }
    useCopilotStore.getState().endRun(options.threadId);
    useCopilotStore.getState().bumpData();
  };

  const handle = runCopilot(
    {
      threadId: options.threadId,
      projectId: options.projectId,
      route: options.route,
      policy: options.policy,
      briefing: options.briefing,
      history,
      message: options.text,
      usedTools,
      toolsMode: options.toolsMode ?? 'auto',
      maxTools: DEFAULT_MAX_TOOLS,
      contextTokens: DEFAULT_CONTEXT_TOKENS,
    },
    (event: CopilotEvent) => {
      void handleEvent(event);
    },
  );

  useCopilotStore.getState().startRun({
    runId: handle.runId,
    threadId: options.threadId,
    projectId: options.projectId,
    handle,
    assistantMessageId: null,
    buffer: '',
    reasoning: '',
    startedAt: Date.now(),
    pendingApprovals: [],
    toolNames: [],
    chatOnly: false,
  });

  // Events arrive in order; each handler awaits its Dexie work before the
  // next is processed, so rows never race each other.
  let chain: Promise<void> = Promise.resolve();
  function handleEvent(event: CopilotEvent): Promise<void> {
    chain = chain.then(() => process(event)).catch((err) => {
      console.error('[copilot] event handling failed', err);
    });
    return chain;
  }

  async function process(event: CopilotEvent): Promise<void> {
    const state = useCopilotStore.getState();
    switch (event.type) {
      case 'started':
        state.patchRun(options.threadId, { toolNames: event.tools, chatOnly: event.chatOnly });
        await ensureAssistant();
        break;
      case 'delta':
        await ensureAssistant();
        state.appendBuffer(options.threadId, event.text, 'content');
        break;
      case 'reasoning':
        await ensureAssistant();
        state.appendBuffer(options.threadId, event.text, 'reasoning');
        break;
      case 'assistant-message': {
        const id = await ensureAssistant();
        await updateMessage(id, {
          content: event.content,
          toolCalls: event.toolCalls,
          status: 'complete',
        });
        // Next round streams into a fresh row.
        assistantId = null;
        state.patchRun(options.threadId, { assistantMessageId: null, buffer: '', reasoning: '' });
        if (!event.content && !event.toolCalls?.length) {
          const { db } = await import('@/db');
          await db.aiMessages.delete(id);
        }
        break;
      }
      case 'tool-proposed': {
        const record: AiToolCallRecord = { callId: event.callId, tool: event.tool, args: event.args, risk: event.risk, state: 'proposed' };
        toolState.set(event.callId, record);
        await upsertTool(record);
        state.patchRun(options.threadId, { pendingApprovals: [...(state.runsByThread[options.threadId]?.pendingApprovals ?? []), event.callId] });
        break;
      }
      case 'tool-running': {
        const record: AiToolCallRecord = { ...(toolState.get(event.callId) ?? { callId: event.callId, tool: event.tool, args: event.args, risk: event.risk }), state: 'running' };
        toolState.set(event.callId, record);
        await upsertTool(record);
        const run = state.runsByThread[options.threadId];
        if (run?.pendingApprovals.includes(event.callId)) {
          state.patchRun(options.threadId, { pendingApprovals: run.pendingApprovals.filter((c) => c !== event.callId) });
        }
        break;
      }
      case 'tool-result': {
        const previousRecord = toolState.get(event.callId);
        const record: AiToolCallRecord = {
          ...(previousRecord ?? { callId: event.callId, tool: event.tool, args: {}, risk: 'read' }),
          state: event.ok ? 'done' : event.code === 'rejected' ? 'rejected' : 'failed',
          ok: event.ok,
          code: event.code,
          error: event.error,
          summary: event.summary,
          resultText: event.resultText.slice(0, 4000),
          auditIndex: event.auditIndex,
        };
        toolState.set(event.callId, record);
        await upsertTool(record);
        const run = state.runsByThread[options.threadId];
        if (run?.pendingApprovals.includes(event.callId)) {
          state.patchRun(options.threadId, { pendingApprovals: run.pendingApprovals.filter((c) => c !== event.callId) });
        }
        break;
      }
      case 'notice': {
        const id = await ensureAssistant();
        await updateMessage(id, { notice: NOTICE_TEXT[event.code] ?? event.code });
        break;
      }
      case 'usage':
        // The last model round's figures ride on the assistant row: the dock
        // shows them as "tok/s" under the answer.
        if (assistantId) await updateMessage(assistantId, { usage: event.usage });
        break;
      case 'done':
        await finish('complete');
        break;
      case 'cancelled':
        await finish('cancelled');
        break;
      case 'error':
        await finish('error', event.message);
        break;
      default:
        break;
    }
    // A streamed token stores nothing: the live row is drawn from the run's
    // buffer, so bumping here would only re-run every thread query per token.
    if (event.type !== 'delta' && event.type !== 'reasoning') {
      useCopilotStore.getState().bumpData();
    }
  }
}

export function cancelCopilotTurn(threadId: string): void {
  useCopilotStore.getState().runsByThread[threadId]?.handle.cancel();
}

export function answerApproval(threadId: string, callId: string, approved: boolean): void {
  useCopilotStore.getState().runsByThread[threadId]?.handle.approve(callId, approved);
}
