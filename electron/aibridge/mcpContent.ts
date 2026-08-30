// ============================================================================
// AI bridge — MCP content blocks
// ============================================================================
//
// Split out of mcpStdio.ts on purpose: that module starts reading stdin the
// moment it is imported, so the pure part lives here where a test can reach it.

/** A picture a tool wants the model to actually see. */
export interface BridgeMedia {
  base64: string;
  mimeType: string;
  label?: string;
}

/**
 * Build the `content` array of an MCP tool result.
 *
 * Text carries the JSON a model reads. A `_media` array in the result becomes
 * real image blocks — that is what lets a vision model LOOK at a clipping
 * instead of reading its filename. The `_media` key never reaches the text
 * block: base64 in the JSON would be pure noise in the model's context.
 */
export function buildToolResult(payload: unknown, isError = false): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  let body = payload;

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = { ...(payload as Record<string, unknown>) };
    const media = record._media;
    delete record._media;
    body = record;
    if (Array.isArray(media)) {
      for (const entry of media as BridgeMedia[]) {
        if (entry && typeof entry.base64 === 'string' && entry.base64) {
          content.push({
            type: 'image',
            data: entry.base64,
            mimeType: entry.mimeType || 'image/jpeg',
          });
        }
      }
    }
  }

  content.push({ type: 'text', text: JSON.stringify(body, null, 2) });
  return { content, isError };
}
