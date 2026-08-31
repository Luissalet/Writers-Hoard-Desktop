// ============================================================================
// Copilot — thread and message operations (Dexie)
// ============================================================================

import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import type { ActionPolicy } from '@/services/aiRuntime/toolPolicy';
import type { AiChatMessage, AiRouteSelection } from '@/services/aiRuntime/types';
import { useCopilotStore } from '@/stores/copilotStore';
import type { AiMessage, AiProjectSettings, AiThread } from './types';

/** How much of a thread is replayed to the model on each turn. */
const HISTORY_MESSAGE_LIMIT = 40;
const HISTORY_CHAR_BUDGET = 60_000;
const TOOL_HISTORY_CHARS = 4_000;

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}
export function subscribeCopilotData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function listThreads(projectId: string): Promise<AiThread[]> {
  const rows = await db.aiThreads.where('projectId').equals(projectId).toArray();
  return rows.filter((t) => !t.archived).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getThread(id: string): Promise<AiThread | undefined> {
  return db.aiThreads.get(id);
}

export async function createThread(
  projectId: string,
  init: { title?: string; policy: ActionPolicy; route?: AiRouteSelection },
): Promise<AiThread> {
  const now = Date.now();
  const thread: AiThread = {
    id: generateId('thr'),
    projectId,
    title: init.title ?? '',
    route: init.route,
    policy: init.policy,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.aiThreads.add(thread);
  notify();
  return thread;
}

export async function updateThread(id: string, changes: Partial<Omit<AiThread, 'id' | 'projectId'>>): Promise<void> {
  await db.aiThreads.update(id, { ...changes, updatedAt: Date.now() });
  notify();
}

export async function deleteThread(id: string): Promise<void> {
  await db.transaction('rw', db.aiThreads, db.aiMessages, async () => {
    await db.aiMessages.where('threadId').equals(id).delete();
    await db.aiThreads.delete(id);
  });
  notify();
}

export async function listMessages(threadId: string): Promise<AiMessage[]> {
  const rows = await db.aiMessages.where('threadId').equals(threadId).toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addMessage(message: Omit<AiMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): Promise<AiMessage> {
  const row: AiMessage = {
    ...message,
    id: message.id ?? generateId('msg'),
    createdAt: message.createdAt ?? Date.now(),
  };
  await db.aiMessages.add(row);
  await db.aiThreads.update(row.threadId, { updatedAt: Date.now() });
  notify();
  return row;
}

export async function updateMessage(id: string, changes: Partial<Omit<AiMessage, 'id' | 'threadId' | 'projectId'>>): Promise<void> {
  await db.aiMessages.update(id, changes);
  notify();
}

/**
 * Any turn left "streaming" by a crash or reload is finished as cancelled.
 * A live run owns its streaming row and settles it itself (complete / cancelled
 * / error) via the runner's finish(); only rows with no run in flight are
 * orphans. Guarding on the active run is essential because this is called on
 * every data refresh — including once per streamed token — so without it an
 * in-progress turn would be cancelled out from under itself on the first delta.
 */
export async function settleStaleMessages(threadId: string): Promise<void> {
  if (useCopilotStore.getState().runsByThread[threadId]) return;
  const stale = await db.aiMessages.where('threadId').equals(threadId).filter((m) => m.status === 'streaming').toArray();
  for (const row of stale) {
    await db.aiMessages.update(row.id, { status: 'cancelled' });
  }
  if (stale.length) notify();
}

export async function getProjectSettings(projectId: string): Promise<AiProjectSettings> {
  const row = await db.aiProjectSettings.get(projectId);
  return (
    row ?? {
      projectId,
      defaultPolicy: 'ask',
      remoteConsent: false,
      updatedAt: 0,
    }
  );
}

export async function saveProjectSettings(
  projectId: string,
  changes: Partial<Omit<AiProjectSettings, 'projectId' | 'updatedAt'>>,
): Promise<AiProjectSettings> {
  const current = await getProjectSettings(projectId);
  const next: AiProjectSettings = { ...current, ...changes, projectId, updatedAt: Date.now() };
  await db.aiProjectSettings.put(next);
  notify();
  return next;
}

/**
 * Rebuild the provider-shaped history from stored rows, newest turns kept,
 * within a character budget so a long thread does not blow the context.
 */
export function historyFromMessages(messages: AiMessage[]): { history: AiChatMessage[]; usedTools: string[] } {
  const usedTools = new Set<string>();
  const out: AiChatMessage[] = [];
  let chars = 0;
  const recent = messages.filter((m) => m.status !== 'streaming').slice(-HISTORY_MESSAGE_LIMIT);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i];
    let entry: AiChatMessage | null = null;
    if (m.role === 'user') {
      entry = { role: 'user', content: m.content };
    } else if (m.role === 'assistant') {
      if (!m.content && !m.toolCalls?.length) continue;
      entry = { role: 'assistant', content: m.content, toolCalls: m.toolCalls?.length ? m.toolCalls : undefined };
    } else if (m.role === 'tool' && m.toolCall) {
      usedTools.add(m.toolCall.tool);
      const text = (m.toolCall.resultText ?? m.content ?? '').slice(0, TOOL_HISTORY_CHARS);
      entry = { role: 'tool', content: text || JSON.stringify({ ok: m.toolCall.ok ?? false }), toolCallId: m.toolCall.callId, name: m.toolCall.tool };
    }
    if (!entry) continue;
    chars += entry.content.length;
    if (chars > HISTORY_CHAR_BUDGET && out.length > 0) break;
    out.unshift(entry);
  }
  // Never start the replay with an orphan tool result: providers reject it.
  while (out.length && out[0].role === 'tool') out.shift();
  // And never end an assistant tool request without its answers — drop a
  // trailing assistant turn whose tool results were cut off.
  const last = out[out.length - 1];
  if (last?.role === 'assistant' && last.toolCalls?.length) out.pop();
  return { history: out, usedTools: [...usedTools] };
}
