// ============================================================================
// Copilot — persisted conversation types (Dexie v27)
// ============================================================================
//
// Threads belong to a project; deleting the project deletes them (every
// table with a `projectId` index or key is swept by deleteProject). Messages keep
// what the user needs to read the conversation back and what the model needs
// to continue it — never a whole chapter a tool returned, never a key.

import type { ActionPolicy } from '@/services/aiRuntime/toolPolicy';
import type { AiRouteSelection, AiToolCall, AiUsage } from '@/services/aiRuntime/types';

export interface AiThread {
  id: string;
  projectId: string;
  title: string;
  /** Route the thread last used; the picker falls back to the project default. */
  route?: AiRouteSelection;
  policy: ActionPolicy;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AiMessageRole = 'user' | 'assistant' | 'tool';

export type AiMessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled';

/** What a tool call did, as the card shows it and the audit log can find it. */
export interface AiToolCallRecord {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  state: 'proposed' | 'running' | 'done' | 'failed' | 'rejected';
  ok?: boolean;
  code?: string;
  error?: string;
  summary?: string;
  /** Text the model saw, capped — enough to continue the thread later. */
  resultText?: string;
  auditIndex?: number;
  undone?: boolean;
}

export interface AiMessage {
  id: string;
  threadId: string;
  projectId: string;
  role: AiMessageRole;
  /** Markdown for user/assistant turns; the result text for tool turns. */
  content: string;
  status: AiMessageStatus;
  createdAt: number;
  /** Assistant turns: the model that produced them. */
  route?: AiRouteSelection;
  /** Assistant turns: calls the model asked for (mirrors the provider shape). */
  toolCalls?: AiToolCall[];
  /** Tool turns: the card. */
  toolCall?: AiToolCallRecord;
  error?: string;
  /** Free-text notice such as "chat-only" shown under the turn. */
  notice?: string;
  /** Assistant turns: tokens and measured speed of the round that produced them. */
  usage?: AiUsage;
}

export interface AiProjectSettings {
  projectId: string;
  chatRoute?: AiRouteSelection;
  imageRoute?: AiRouteSelection;
  defaultPolicy: ActionPolicy;
  /** The user explicitly allowed sending this project's text to remote servers. */
  remoteConsent: boolean;
  updatedAt: number;
}
