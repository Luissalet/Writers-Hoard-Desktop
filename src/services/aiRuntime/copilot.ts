// ============================================================================
// AI runtime — copilot run contract (pure)
// ============================================================================
//
// Shared by the renderer (dock, runner) and the main process (agent loop).

import type { AiChatMessage, AiRouteSelection, AiToolCall, AiUsage } from './types';
import type { ActionPolicy } from './toolPolicy';
import type { CopilotBriefing } from './prompts';

export interface CopilotRunRequest {
  /** Chosen by the renderer so it can subscribe before the run starts. */
  runId: string;
  threadId: string;
  projectId: string;
  route: AiRouteSelection;
  policy: ActionPolicy;
  briefing: Omit<CopilotBriefing, 'policy' | 'toolsAvailable' | 'offeredTools' | 'projectId'>;
  /** Earlier turns of the thread, oldest first, already trimmed by the caller. */
  history: AiChatMessage[];
  message: string;
  usedTools?: string[];
  /** 'auto' asks the model list; 'off' forces a plain conversation. */
  toolsMode?: 'auto' | 'off';
  maxTools?: number;
  contextTokens?: number;
}

export type CopilotEvent =
  | { type: 'started'; connectionId: string; modelId: string; tools: string[]; chatOnly: boolean }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'assistant-message'; content: string; toolCalls?: AiToolCall[] }
  | { type: 'tool-proposed'; callId: string; tool: string; args: Record<string, unknown>; risk: string }
  | { type: 'tool-running'; callId: string; tool: string; args: Record<string, unknown>; risk: string }
  | {
      type: 'tool-result';
      callId: string;
      tool: string;
      ok: boolean;
      code?: string;
      error?: string;
      resultText: string;
      summary?: string;
      auditIndex?: number;
    }
  | { type: 'notice'; code: 'chat-only' | 'tools-dropped' | 'limit-rounds' | 'limit-calls' }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'done'; finishReason: string; rounds: number; toolCalls: number }
  | { type: 'cancelled' }
  | { type: 'error'; code: string; message: string };
