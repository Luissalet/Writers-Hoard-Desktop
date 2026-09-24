// ============================================================================
// AI bridge — local HTTP port (main process)
// ============================================================================
//
//   GET  /api/health        { ok, appOpen, enabled, writesEnabled, version }
//   GET  /api/tools         { tools: [...] }   — works even with no window open
//   GET  /api/instructions  { instructions }   — briefing for a fresh model
//   POST /api/call          { tool, args } -> { ok, result } | { ok:false, error, code }
//
// The Hoard family contract (what the Hoard Hub's proxy, rules and audit
// speak, see HoardLink/docs/FAMILY.md) rides on the same port:
//   GET  /api/health        also answers without a token — only version and
//                           switches, never content — with a `hoard_link` block
//   GET  /api/agent/tools   { tools, instructions }        (alias of /api/tools)
//   POST /api/agent/call    { name, arguments, caller } -> the tool's result,
//                           4xx with { ok:false, error } when it fails
// and every call posts an `agent.call` event to the hub (family.ts).
//
// Bound to 127.0.0.1 like the media server, but hardened well beyond it,
// because this port can rewrite the user's manuscript:
//
//   • a Bearer token is mandatory on every route;
//   • any request carrying an `Origin` header is refused outright. An MCP
//     adapter or a CLI sends none; a web page always does. That single rule
//     closes the "a random site you visited fires blind writes at localhost"
//     hole that CORS alone does not cover for simple requests;
//   • the whole port is off until the user turns it on in Settings, and
//     writing is a second, separate switch.

import http from 'node:http';
import {
  BRIDGE_TOOLS,
  BRIDGE_INSTRUCTIONS,
  getBridgeTool,
  selectTools,
} from '@/services/aiBridge/manifest';
import { callRenderer, pendingCallCount, type BridgeCallResult } from './rpc';
import { executeTool } from './executor';
import { emitFamilyEvent, familyHealthBlock } from './family';
import {
  appendAudit,
  getAuditRecord,
  getBridgeConfig,
  getBridgeToken,
  readAudit,
  tokenMatches,
  undoneIndices,
} from './state';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WH_AIBRIDGE_PORT || 8766);
/** Generous enough for a long chapter, small enough to bound abuse. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const AI_BRIDGE_URL = `http://${HOST}:${PORT}`;
export const AI_BRIDGE_PORT = PORT;

let server: http.Server | null = null;
let appVersion = '';
/** Set by main so /api/health can report whether a window is actually up. */
let hasWindow: () => boolean = () => false;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // Nothing here is ever meant to be read by a browser.
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    // Decode once at the end: a multibyte character split across two chunks
    // must not be decoded per-chunk, or each half becomes U+FFFD and accented
    // prose (á, é, í, ñ …) is silently corrupted on the way into the manuscript.
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isLoopback(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Bearer token, no Origin, loopback only. Returns an error code or null. */
async function authorize(req: http.IncomingMessage): Promise<string | null> {
  if (!isLoopback(req)) return 'not-loopback';
  // A browser cannot omit Origin on a cross-origin request; a tool never sends one.
  if (req.headers.origin) return 'browser-origin-refused';
  const header = req.headers.authorization ?? '';
  const presented = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? '';
  if (!presented) return 'missing-token';
  const expected = await getBridgeToken();
  return tokenMatches(presented, expected) ? null : 'bad-token';
}

async function handleCall(rawBody: string): Promise<{ status: number; body: unknown }> {
  let parsed: { tool?: unknown; args?: unknown; client?: unknown };
  try {
    parsed = JSON.parse(rawBody || '{}') as typeof parsed;
  } catch {
    return { status: 400, body: { ok: false, code: 'bad-json', error: 'Body is not valid JSON.' } };
  }

  const toolName = typeof parsed.tool === 'string' ? parsed.tool : '';
  const tool = getBridgeTool(toolName);
  const client = typeof parsed.client === 'string' ? parsed.client.slice(0, 60) : undefined;
  if (!tool) {
    emitFamilyEvent('agent.call', { tool: toolName, ok: false, ms: 0, caller: client ?? '', error: 'unknown tool' });
    return {
      status: 404,
      body: {
        ok: false,
        code: 'unknown-tool',
        error: `Unknown tool "${toolName}". Call GET /api/tools for the catalogue.`,
      },
    };
  }

  const args =
    parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
      ? (parsed.args as Record<string, unknown>)
      : {};
  const started = Date.now();

  // The route is a transport. Policy, scope, audit and the relay itself live
  // in the executor, shared with the in-app copilot (tasks/lessons.md #23).
  const { auditIndex: _auditIndex, args: _sent, ...outcome } = await executeTool(
    { tool: toolName, args },
    { origin: 'bridge', clientLabel: client },
  );
  void _auditIndex;
  void _sent;
  const status = outcome.code === 'writes-disabled' ? 403 : 200;
  emitFamilyEvent('agent.call', {
    tool: toolName,
    ok: outcome.ok !== false,
    ms: Date.now() - started,
    caller: client ?? '',
    ...(outcome.ok === false ? { error: String(outcome.error ?? outcome.code ?? 'failed').slice(0, 200) } : {}),
  });
  return { status, body: outcome satisfies BridgeCallResult };
}

/**
 * Turn one logged change back, addressed by its line number in the log.
 *
 * Shared by the HTTP route and the settings panel's undo button so both take
 * exactly the same path, including refusing to undo the same line twice.
 */
export async function undoBridgeChange(index: number): Promise<BridgeCallResult> {
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, code: 'bad-args', error: 'Pass the audit line number as `index`.' };
  }
  const record = await getAuditRecord(index);
  if (!record) return { ok: false, code: 'not-found', error: `No audit entry #${index}.` };
  if ((await undoneIndices()).includes(index)) {
    return { ok: false, code: 'already-undone', error: `Entry #${index} was already undone.` };
  }

  const outcome = await callRenderer('__undo', { entry: record }, 45_000);
  // The undo is itself a change, so it goes in the log — which is also how the
  // "already undone" check knows.
  await appendAudit({
    at: Date.now(),
    tool: '__undo',
    kind: 'undo',
    undoOf: index,
    ok: outcome.ok,
    error: outcome.error,
    entityId: record.entityId,
    projectId: record.projectId,
    summary: outcome.ok ? `undid #${index}: ${record.summary ?? record.tool}` : undefined,
  });
  return outcome;
}

/**
 * The family contract's call: `{ name, arguments, caller }` in, the tool's own
 * result out (the hub's proxy unwraps `{ ok, result }`), a 4xx with
 * `{ ok:false, error, code }` when the tool is unknown or fails. The
 * `agent.call` event is posted by handleCall, once per call whatever the route.
 */
async function handleFamilyCall(rawBody: string): Promise<{ status: number; body: unknown }> {
  let parsed: { name?: unknown; tool?: unknown; arguments?: unknown; args?: unknown; caller?: unknown };
  try {
    parsed = JSON.parse(rawBody || '{}') as typeof parsed;
  } catch {
    return { status: 400, body: { ok: false, code: 'bad-json', error: 'Body is not valid JSON.' } };
  }
  const name = typeof parsed.name === 'string' ? parsed.name : typeof parsed.tool === 'string' ? parsed.tool : '';
  const caller = typeof parsed.caller === 'string' ? parsed.caller.slice(0, 60) : 'family';
  if (!getBridgeTool(name)) {
    emitFamilyEvent('agent.call', { tool: name, ok: false, ms: 0, caller, error: 'unknown tool' });
    return { status: 404, body: { ok: false, code: 'unknown-tool', error: `Unknown tool "${name}". Call GET /api/agent/tools for the catalogue.` } };
  }
  const args = parsed.arguments ?? parsed.args;
  const inner = JSON.stringify({ tool: name, args: args && typeof args === 'object' ? args : {}, client: caller });
  const { status, body } = await handleCall(inner);
  const outcome = body as { ok?: boolean; result?: unknown; error?: string; code?: string };
  if (status >= 400 || outcome.ok === false) {
    return { status: status >= 400 ? status : 400, body: { ok: false, code: outcome.code ?? 'failed', error: outcome.error ?? 'The tool failed.' } };
  }
  return { status: 200, body: { ok: true, tool: name, result: outcome.result } };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '/').split('?')[0];

  // Health is the one route the family probes without a token (the hub, Faustus's
  // discovery): loopback and no-Origin still apply, and it says nothing about content.
  if (req.method === 'GET' && url === '/api/health' && isLoopback(req) && !req.headers.origin) {
    const config = await getBridgeConfig();
    sendJson(res, 200, {
      ok: true,
      appOpen: hasWindow(),
      enabled: config.enabled,
      writesEnabled: config.writesEnabled,
      inFlight: pendingCallCount(),
      version: appVersion,
      service: 'writers-hoard-ai-bridge',
      hoard_link: familyHealthBlock(),
    });
    return;
  }

  const denied = await authorize(req);
  if (denied) {
    sendJson(res, denied === 'browser-origin-refused' ? 403 : 401, {
      ok: false,
      code: denied,
      error: 'Unauthorized. The bridge needs the token shown in Writers Hoard → Settings → AI bridge.',
    });
    return;
  }

  const config = await getBridgeConfig();
  if (!config.enabled) {
    sendJson(res, 503, {
      ok: false,
      code: 'bridge-disabled',
      error: 'The AI bridge is switched off in Writers Hoard (Settings → AI bridge).',
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/agent/tools') {
    // The family's shape: the whole catalogue plus the briefing, in one answer.
    sendJson(res, 200, {
      ok: true,
      tools: selectTools({ groups: [], writesEnabled: config.writesEnabled }),
      instructions: BRIDGE_INSTRUCTIONS,
      writesEnabled: config.writesEnabled,
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/tools') {
    // ?groups=writing,story narrows the catalogue for a client without tool
    // retrieval. 'core' is always served, so the result is never unusable.
    const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const groups = (query.get('groups') ?? '').split(',').filter(Boolean);
    const tools = selectTools({ groups, writesEnabled: config.writesEnabled });
    sendJson(res, 200, {
      ok: true,
      tools,
      writesEnabled: config.writesEnabled,
      total: BRIDGE_TOOLS.length,
      groups: [...new Set(BRIDGE_TOOLS.map((tool) => tool.group).filter(Boolean))],
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/audit') {
    const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const limit = Math.max(1, Math.min(500, Number(query.get('limit')) || 30));
    const [entries, undone] = await Promise.all([readAudit(limit), undoneIndices()]);
    sendJson(res, 200, {
      ok: true,
      entries: entries.map((entry) => ({ ...entry, undone: undone.includes(entry.index) })),
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/instructions') {
    sendJson(res, 200, { ok: true, instructions: BRIDGE_INSTRUCTIONS });
    return;
  }

  // Diagnostics, not a model capability: creates its own throwaway project,
  // exercises the whole surface and deletes it again. Safe against a real
  // installation, which is the point — it is how a change gets verified
  // without asking a human to click through the app.
  if (req.method === 'POST' && url === '/api/selftest') {
    if (!config.writesEnabled) {
      sendJson(res, 403, {
        ok: false,
        code: 'writes-disabled',
        error: 'The self-test writes to a scratch project, so it needs writing switched on.',
      });
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    } catch {
      body = {};
    }
    const outcome = await callRenderer('__selftest', body, 120_000);
    sendJson(res, 200, outcome);
    return;
  }

  // Remove a scratch project a --keep run left behind. Refuses anything that
  // is not one, so it can never be pointed at real work.
  if (req.method === 'POST' && url === '/api/selftest/cleanup') {
    if (!config.writesEnabled) {
      sendJson(res, 403, {
        ok: false,
        code: 'writes-disabled',
        error: 'The cleanup deletes scratch projects, so it needs writing switched on.',
      });
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    } catch {
      body = {};
    }
    const outcome = await callRenderer('__selftest_cleanup', body, 60_000);
    const removed = (outcome.result as { deleted?: unknown[] } | undefined)?.deleted;
    // No `kind`: a cascading multi-project delete has nothing to put back, and
    // a kind would offer the settings panel an undo button that cannot work.
    await appendAudit({
      at: Date.now(),
      tool: '__selftest_cleanup',
      origin: 'bridge',
      ok: outcome.ok,
      error: outcome.error,
      summary: outcome.ok
        ? `removed ${Array.isArray(removed) ? removed.length : 0} self-test scratch project(s)`
        : undefined,
    });
    sendJson(res, 200, outcome);
    return;
  }

  // Turn one logged change back. Addressed by its line number in the log, so
  // the caller cannot hand-craft a payload that reverts something else.
  if (req.method === 'POST' && url === '/api/undo') {
    if (!config.writesEnabled) {
      sendJson(res, 403, { ok: false, code: 'writes-disabled', error: 'Writing is switched off.' });
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    } catch {
      body = {};
    }
    sendJson(res, 200, await undoBridgeChange(Number(body.index)));
    return;
  }

  if (req.method === 'POST' && url === '/api/call') {
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { ok: false, code: 'body-too-large', error: 'Request body too large.' });
      return;
    }
    const { status, body } = await handleCall(rawBody);
    sendJson(res, status, body);
    return;
  }

  if (req.method === 'POST' && url === '/api/agent/call') {
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { ok: false, code: 'body-too-large', error: 'Request body too large.' });
      return;
    }
    const { status, body } = await handleFamilyCall(rawBody);
    sendJson(res, status, body);
    return;
  }

  sendJson(res, 404, { ok: false, code: 'no-route', error: `No route for ${req.method} ${url}.` });
}

export interface StartAiBridgeOptions {
  version: string;
  hasWindow: () => boolean;
}

/** Resolves once listening. Rejects if the port is taken — non-fatal for the app. */
export function startAiBridge(options: StartAiBridgeOptions): Promise<void> {
  appVersion = options.version;
  hasWindow = options.hasWindow;
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const instance = http.createServer((req, res) => {
      void handle(req, res).catch((err) => {
        console.error('[aibridge] handler failed', err);
        try {
          sendJson(res, 500, { ok: false, code: 'internal', error: String(err) });
        } catch {
          res.destroy();
        }
      });
    });
    // Claimed synchronously: assigning only in the listen callback let two
    // concurrent enable calls both pass the `if (server)` guard, and the
    // loser's error handler then discarded the handle that actually bound.
    server = instance;
    instance.on('error', (err) => {
      if (server === instance) server = null;
      reject(err);
    });
    instance.listen(PORT, HOST, () => {
      console.log(`[aibridge] listening on ${AI_BRIDGE_URL}`);
      resolve();
    });
  });
}

export function stopAiBridge(): void {
  server?.close();
  server = null;
}

/**
 * Bring the listener in line with the user's switch: bound while the bridge is
 * on, absent while it is off. Called at boot and whenever Settings toggles it.
 */
export async function syncAiBridge(options: StartAiBridgeOptions): Promise<void> {
  const { enabled } = await getBridgeConfig();
  if (enabled && !server) {
    await startAiBridge(options);
  } else if (!enabled && server) {
    stopAiBridge();
  }
}

export function isAiBridgeRunning(): boolean {
  return server !== null;
}
