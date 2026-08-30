// ============================================================================
// AI bridge — tool schema vocabulary (pure data, no DOM, no Dexie)
// ============================================================================
//
// Shared by manifest.ts and manifestEngines.ts. Imported by the renderer, by
// the Electron main process and by the standalone MCP adapter, so it may not
// touch `db`, `window` or React.

export interface BridgeToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Toolsets a client can subscribe to. With every engine wired the catalogue is
 * large; a model with tool retrieval (Odysseus) copes, but one that receives
 * the whole list every turn does not. A client narrows it with
 * `WH_BRIDGE_GROUPS=writing,story` or `GET /api/tools?groups=…`.
 * 'core' is always served.
 */
export type BridgeToolGroup =
  | 'core'
  | 'writing'
  | 'story'
  | 'people'
  | 'script'
  | 'visual'
  | 'research'
  | 'analysis';

export interface BridgeTool {
  /** Stable public name. Prefixed `wh_` so it never collides with other servers. */
  name: string;
  /** One sentence for tool retrieval, then the detail a caller needs. */
  description: string;
  /** True when the tool mutates data — gated by the "writes enabled" switch. */
  writes: boolean;
  /** Assigned at assembly time; see BridgeToolGroup. */
  group?: BridgeToolGroup;
  /**
   * Engine this tool belongs to, assigned at assembly time.
   *
   * More than documentation: a project only shows the engines in its
   * `enabledEngines`, and its own global search only looks at those, so a row
   * written into a disabled engine is invisible to the writer by every route
   * they have. Every write tool that carries this must refuse when the engine
   * is off — `tests/ai-bridge.ts` derives that list from here and proves it.
   * Absent on tools that span engines (search, delete) or none (context).
   */
  engineId?: string;
  /**
   * Override the 45s default when a tool legitimately takes longer — listing
   * an Instagram collection paces its requests 6-12s apart on purpose, so a
   * few dozen posts is a multi-minute call, not a hang.
   */
  timeoutMs?: number;
  schema: BridgeToolSchema;
}

// --- schema helpers, kept dependency-free ----------------------------------

export const s = (
  description: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ type: 'string', description, ...extra });

export const n = (
  description: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ type: 'number', description, ...extra });

export const b = (description: string): Record<string, unknown> => ({
  type: 'boolean',
  description,
});

export const arr = (description: string): Record<string, unknown> => ({
  type: 'array',
  items: { type: 'string' },
  description,
});

export const PROJECT_ID = s(
  'Project to act on. Omit to use the project the user currently has open in the app.',
);

export const MARKDOWN_NOTE =
  'Markdown. Supported: headings (#..######), **bold**, *italic*, `code`, [links](url), ![images](url), - and 1. lists, > quotes, --- rules. Anything else is stored as plain paragraphs.';

/** Stamp a group onto a family of tools at assembly time. */
export function grouped(group: BridgeToolGroup, tools: BridgeTool[]): BridgeTool[] {
  return tools.map((tool) => ({ ...tool, group }));
}

/**
 * Stamp an engine onto a family of tools, leaving alone any tool that already
 * declares its own — a family can straddle two engines (pov-audit and
 * writing-stats ship together).
 */
export function inEngine(engineId: string, tools: BridgeTool[]): BridgeTool[] {
  return tools.map((tool) => ({ ...tool, engineId: tool.engineId ?? engineId }));
}
