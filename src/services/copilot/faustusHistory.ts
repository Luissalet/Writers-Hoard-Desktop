import type { AiMessage, AiThread } from './types';
import type { WriterHoardContext } from './faustusProtocol';

/** Preserve original ids, tool payloads, failures and timestamps, without deleting Dexie rows. */
export function legacyConversationImport(context: WriterHoardContext, thread: AiThread, messages: AiMessage[]) {
  return {
    context,
    source_thread_id: thread.id,
    name: thread.title || undefined,
    messages: [...messages].sort((a, b) => a.createdAt - b.createdAt).map((message) => ({
      source_id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.createdAt / 1000,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls } : {}),
      ...(message.toolCall ? { tool_call_id: message.toolCall.callId } : {}),
      metadata: { writer_status: message.status, writer_tool_call: message.toolCall, writer_error: message.error, writer_usage: message.usage, writer_notice: message.notice, writer_route: message.route },
    })),
  };
}
