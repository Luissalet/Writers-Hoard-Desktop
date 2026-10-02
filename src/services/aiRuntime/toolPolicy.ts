// ============================================================================
// AI runtime — one permission and scope policy for every tool transport (pure)
// ============================================================================
//
// The executor in the main process asks these three questions before a tool
// call reaches a handler, whoever sent it: the MCP port, the copilot dock or
// an internal feature. Keeping the answers here, with no Electron or Dexie in
// sight, is what lets the critical tests prove that the copilot and the MCP
// reach the very same verdicts.

import { SCOPE_KEY, type BridgeTool, type BridgeToolSchema } from '@/services/aiBridge/schema';

/** Who is asking. The HTTP port carries both external clients and the MCP adapter. */
export type ToolOrigin = 'bridge' | 'copilot' | 'feature';

/** The copilot's per-conversation permission level. */
export type ActionPolicy = 'read-only' | 'ask' | 'allow';

export interface ExecutionContext {
  origin: ToolOrigin;
  /** The project a copilot conversation belongs to. Injected and enforced. */
  projectId?: string;
  conversationId?: string;
  /** Free-text label for the audit line ("mcp-stdio", "copilot", "odysseus"). */
  clientLabel?: string;
  actionPolicy?: ActionPolicy;
}

export type PermissionVerdict =
  | { allowed: true; needsApproval: boolean }
  | { allowed: false; code: 'writes-disabled' | 'read-only' | 'policy'; error: string };

/**
 * Whether the call may proceed at all, and whether a human must say yes first.
 *
 * - The bridge keeps its own global write switch: nothing about the copilot
 *   changes the contract external clients already rely on.
 * - A read-only conversation cannot write, full stop.
 * - "Ask" conversations run reads freely and put every write in front of the
 *   user — except wh_delete, whose handler already opens the app's own
 *   confirmation dialog; asking twice would train people to click through.
 * - "Allow" conversations run reversible writes on their own. Deletion still
 *   asks, inside the handler, because it cannot be undone.
 */
export function decidePermission(
  tool: BridgeTool,
  ctx: ExecutionContext,
  bridgeWritesEnabled: boolean,
): PermissionVerdict {
  if (!tool.writes) return { allowed: true, needsApproval: false };
  if (ctx.origin === 'bridge') {
    if (!bridgeWritesEnabled) {
      return {
        allowed: false,
        code: 'writes-disabled',
        error: 'Writing is switched off in Writers Hoard (Settings → AI bridge). Reading still works.',
      };
    }
    return { allowed: true, needsApproval: false };
  }
  if (ctx.origin === 'feature') {
    return { allowed: false, code: 'policy', error: 'Internal features may only read.' };
  }
  const policy = ctx.actionPolicy ?? 'ask';
  if (policy === 'read-only') {
    return {
      allowed: false,
      code: 'read-only',
      error: 'This conversation is read-only. Tell the user what you would change instead, or ask them to switch the conversation to "ask before changing".',
    };
  }
  const asksItself = tool.name === 'wh_delete';
  return { allowed: true, needsApproval: policy === 'ask' && !asksItself };
}

export type ScopeVerdict =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; code: 'scope'; error: string };

/**
 * Pin a copilot call to its conversation's project.
 *
 * Every call gets BOTH pins. `projectId` is filled in when the model left it
 * out and refused when the model named a different one: a chat opened in
 * project A is not permission to write into project B. SCOPE_KEY rides along
 * for the handler to check against whatever row it loads by id
 * (`assertRowInScope`), because a `projectId` in the arguments says nothing
 * about a `placeId` or `parentId` next to it — ids travel, and a tool that
 * takes both (wh_atlas_places_near) used to answer for the other project's
 * row as long as `projectId` was absent or agreed with the conversation.
 * Tools whose schema has no `projectId` ignore the extra key; those that
 * resolve one read the pinned value, which is the point.
 */
export function applyProjectScope(
  tool: BridgeTool,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): ScopeVerdict {
  if (ctx.origin !== 'copilot' || !ctx.projectId) return { ok: true, args };
  const takesProject = Object.prototype.hasOwnProperty.call(tool.schema.properties, 'projectId');
  const given = args.projectId;
  if (takesProject && typeof given === 'string' && given && given !== ctx.projectId) {
    return {
      ok: false,
      code: 'scope',
      error: `This conversation belongs to project "${ctx.projectId}"; it cannot act on project "${given}". Ask the user to open that project and continue there.`,
    };
  }
  return { ok: true, args: { ...args, projectId: ctx.projectId, [SCOPE_KEY]: ctx.projectId } };
}

export type ArgsVerdict =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; code: 'bad-args'; error: string };

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * `project_id` for `projectId`. The other apps of the family speak snake_case
 * and a model that has read their tool lists writes it here too, so a key the
 * schema does not know but whose camelCase form it does is read as that key.
 * The exact key always wins when both are sent.
 */
function withCamelAliases(
  props: Record<string, Record<string, unknown>>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(input)) {
    if (props[key] || !key.includes('_')) continue;
    const camel = key.replace(/_+([a-zA-Z0-9])/g, (_match, ch: string) => ch.toUpperCase());
    if (camel === key || !props[camel] || input[camel] !== undefined) continue;
    out ??= { ...input };
    out[camel] = input[key];
    delete out[key];
  }
  return out ?? input;
}

/**
 * Structural check against the tool's JSON schema, before the handler runs.
 *
 * Lenient where a small model is sloppy and it is harmless — numeric strings
 * become numbers, "true"/"false" become booleans, unknown keys are dropped —
 * and strict where the handler would otherwise misbehave: a missing required
 * field, a wrong type that cannot be coerced, a value outside an enum.
 */
export function validateToolArgs(
  schema: BridgeToolSchema,
  input: Record<string, unknown>,
): ArgsVerdict {
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  input = withCamelAliases(props, input);

  for (const key of schema.required ?? []) {
    const value = input[key];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      problems.push(`"${key}" is required`);
    }
  }

  for (const [key, raw] of Object.entries(input)) {
    const spec = props[key];
    if (!spec) continue; // unknown key: dropped, never fatal
    if (raw === undefined || raw === null) continue;
    const expected = typeof spec.type === 'string' ? spec.type : undefined;
    let value: unknown = raw;
    if (expected === 'number' && typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) {
      value = Number(raw);
    } else if (expected === 'boolean' && (raw === 'true' || raw === 'false')) {
      value = raw === 'true';
    } else if (expected === 'string' && typeof raw === 'number') {
      value = String(raw);
    } else if (expected === 'array' && typeof raw === 'string') {
      // "a, b, c" for a string array is the commonest small-model slip.
      value = raw.split(',').map((part) => part.trim()).filter(Boolean);
    }
    if (expected && expected !== typeOf(value) && !(expected === 'integer' && typeof value === 'number')) {
      problems.push(`"${key}" must be a ${expected}, got ${typeOf(raw)}`);
      continue;
    }
    if (expected === 'array' && Array.isArray(value)) {
      const items = spec.items as { type?: string } | undefined;
      if (items?.type === 'string') value = value.map((item) => String(item));
    }
    const allowed = Array.isArray(spec.enum) ? (spec.enum as unknown[]) : null;
    if (allowed && !allowed.includes(value)) {
      problems.push(`"${key}" must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}`);
      continue;
    }
    out[key] = value;
  }

  if (problems.length) {
    return { ok: false, code: 'bad-args', error: `Bad arguments: ${problems.join('; ')}.` };
  }
  return { ok: true, args: out };
}

/**
 * Risk class shown on a tool card and used to pick an icon. Derived from the
 * manifest rather than declared per tool, so it cannot go stale.
 */
export function toolRisk(tool: BridgeTool): 'read' | 'write' | 'destructive' | 'external' {
  if (!tool.writes) return 'read';
  if (tool.name === 'wh_delete') return 'destructive';
  if (
    tool.name === 'wh_generate_image'
    || tool.name === 'wh_download_snapshot_media'
    // These four reach another app (Prospero's or Scheherazade's Hoard) through the hub.
    || tool.name === 'wh_character_to_prospero'
    || tool.name === 'wh_storyboard_to_prospero'
    || tool.name === 'wh_world_to_scheherazade'
    || tool.name === 'wh_world_from_scheherazade'
  ) return 'external';
  return 'write';
}

/** MCP tool annotations, derived the same way so the adapter can emit them. */
export function toolAnnotations(tool: BridgeTool): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
} {
  const risk = toolRisk(tool);
  return {
    readOnlyHint: risk === 'read',
    destructiveHint: risk === 'destructive',
    idempotentHint: risk === 'read',
  };
}
