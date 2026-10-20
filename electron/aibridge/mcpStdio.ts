// ============================================================================
// Writers Hoard — MCP stdio adapter
// ============================================================================
//
// A standalone Node process, NOT part of Electron. An MCP client (Odysseus,
// Claude Desktop, OpenCode, Cowork...) spawns it, speaks JSON-RPC 2.0 over
// stdin/stdout, and this translates each call into an HTTP request against the
// bridge port inside the running app.
//
//   node <app>/dist-electron/aibridge/mcpStdio.cjs
//     env WH_BRIDGE_TOKEN=<token from Settings → AI bridge>
//     env WH_BRIDGE_URL=http://127.0.0.1:8766   (optional)
//
// It must never import from 'electron': there is no Electron runtime here.
// The tool catalogue is compiled in from the same manifest the app serves, so
// `tools/list` still answers while Writers Hoard is closed — the call itself
// then fails with a plain "the app is not open", which a model can act on.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRIDGE_INSTRUCTIONS, BRIDGE_TOOLS, selectTools } from '@/services/aiBridge/manifest';
import { toolAnnotations } from '@/services/aiRuntime/toolPolicy';
import { buildToolResult } from './mcpContent';
import { publishingCompatContext, publishingCompatIdentity, publishingCompatModule, publishingCompatTools } from '../publishing/compat';

const SERVER_NAME = 'writers-hoard';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL = '2025-06-18';
const BASE_URL = process.env.WH_BRIDGE_URL || 'http://127.0.0.1:8766';
const moduleArgument = process.argv.indexOf('--publishing-module');
const selectedModule = moduleArgument < 0 ? process.env.WH_PUBLISHING_MODULE : process.argv[moduleArgument + 1];
if (moduleArgument >= 0 && !selectedModule) throw new Error('--publishing-module requires a module name.');
const COMPAT_MODULE = selectedModule ? publishingCompatModule(selectedModule) : '';

/**
 * Where Electron would keep this app's userData, per platform. Two names are
 * tried: `app.getName()` falls back to package.json's `name` in development
 * and can be the productName in a packaged build, and guessing wrong here
 * would silently produce an empty token.
 */
function defaultTokenFiles(): string[] {
  const names = ['writers-hoard', 'Writers Hoard'];
  const base = (name: string): string => {
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, name);
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', name);
    }
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, name);
  };
  return names.map((name) => path.join(base(name), 'aibridge', 'token'));
}

function resolveToken(): string {
  const direct = process.env.WH_BRIDGE_TOKEN?.trim();
  if (direct) return direct;
  const explicit = process.env.WH_BRIDGE_TOKEN_FILE?.trim();
  for (const file of explicit ? [explicit] : defaultTokenFiles()) {
    try {
      const token = fs.readFileSync(file, 'utf8').trim();
      if (token) return token;
    } catch {
      // try the next candidate
    }
  }
  return '';
}

const TOKEN = resolveToken();

interface BridgeResponse {
  status: number;
  body: Record<string, unknown>;
  mayHaveArrived?: boolean;
}

/** One request to the app's bridge port. Never throws; failures come back typed. */
function request(
  method: 'GET' | 'POST',
  route: string,
  payload?: unknown,
  timeoutMs = 60_000,
  identity: Record<string, string> = {},
): Promise<BridgeResponse> {
  return new Promise((resolve) => {
    const url = new URL(route, BASE_URL);
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    let connected = false;
    let settled = false;
    const finish = (response: BridgeResponse): void => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const lost = (error: Error): void => finish({
      status: 0, mayHaveArrived: connected,
      body: { ok: false, code: connected ? 'response-lost' : 'unreachable', error: error.message },
    });
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        // pathname alone silently drops ?groups=… — the filter has to survive.
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...identity,
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        connected = true;
        // Decode with a StringDecoder so a multibyte character split across two
        // chunks is not corrupted (per-chunk `+= chunk` would U+FFFD each half).
        res.setEncoding('utf8');
        let raw = '';
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (!res.complete) {
            lost(new Error('Bridge response ended before completion'));
            return;
          }
          try {
            finish({ status: res.statusCode ?? 0, body: JSON.parse(raw || '{}') });
          } catch {
            lost(new Error('Bridge returned invalid JSON'));
          }
        });
        res.on('aborted', () => lost(new Error('Bridge response was aborted')));
        res.on('error', lost);
        res.on('close', () => {
          if (!res.complete) lost(new Error('Bridge response closed before completion'));
        });
      },
    );
    // A failed connection means nothing reached the owner. Once connected,
    // bytes may have reached it even when no response headers arrive.
    req.on('socket', (socket) => {
      if (!socket.connecting) connected = true;
      else socket.once('connect', () => { connected = true; });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', lost);
    if (data) req.write(data);
    req.end();
  });
}

function transportFailure(response: BridgeResponse, name: string, readOnly: boolean): Record<string, unknown> {
  if (!response.mayHaveArrived) {
    return { error: 'Writers Hoard is not running. Open it explicitly.', code: 'app-closed' };
  }
  if (!readOnly) {
    return { error: response.body.error, code: 'outcome_unknown', tool: name, outcome_unknown: true,
      reconcile_action: 'read_current_state_before_retry',
      message: 'The write may have completed, but its response was lost. Check its native state before retrying; it was not replayed.' };
  }
  return { error: response.body.error, code: 'transport-error', tool: name, outcome_unknown: false };
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing: newline-delimited messages, as MCP's stdio transport says
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: JsonRpcId, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id: JsonRpcId, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Tool results travel as content blocks — see mcpContent.ts. */
const toolResult = buildToolResult;
function compatToolResult(body: unknown, isError = false): Record<string, unknown> {
  return { ...toolResult(body, isError), ...(body && typeof body === 'object' && !Array.isArray(body) ? { structuredContent: body } : {}) };
}

/**
 * Toolsets this client wants, e.g. WH_BRIDGE_GROUPS=writing,story. Unset means
 * the whole catalogue — right for a client with tool retrieval, heavy for one
 * that ships every schema on every turn.
 */
const GROUPS = (process.env.WH_BRIDGE_GROUPS ?? '')
  .split(',')
  .map((group) => group.trim())
  .filter(Boolean);

/** The catalogue, trimmed to what the app currently permits when reachable. */
async function listTools(): Promise<unknown[]> {
  if (COMPAT_MODULE) return publishingCompatTools(COMPAT_MODULE);
  const query = GROUPS.length ? `?groups=${encodeURIComponent(GROUPS.join(','))}` : '';
  const live = await request('GET', `/api/tools${query}`);
  const served = (live.body as { tools?: unknown }).tools;
  // App closed: fall back to the compiled catalogue, filtered the same way, so
  // a client still registers the right tools and only the CALL fails.
  const tools: typeof BRIDGE_TOOLS = Array.isArray(served)
    ? (served as typeof BRIDGE_TOOLS)
    : selectTools({ groups: GROUPS });
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
    // MCP tool annotations: a client with a "read-only tools run without
    // asking" setting (Odysseus has one) gets to classify ours correctly.
    annotations: toolAnnotations(tool),
  }));
}

async function callTool(name: string, args: Record<string, unknown>, meta: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (COMPAT_MODULE && !publishingCompatTools(COMPAT_MODULE).some(tool => tool.name === name)) {
    return toolResult({ error: `Unknown tool in ${COMPAT_MODULE}: ${name}`, code: 'unknown-tool' }, true);
  }
  if (!TOKEN) {
    return toolResult(
      {
        error:
          'No bridge token. Set WH_BRIDGE_TOKEN in this MCP server\'s environment to the token shown in Writers Hoard, under Settings, AI bridge.',
      },
      true,
    );
  }
  if (COMPAT_MODULE) {
    // A mounted native route checks that this exact module is ON before it
    // can start a worker. Discovery and calls to an OFF module never enable it.
    const native = publishingCompatTools(COMPAT_MODULE).find(tool => tool.name === name)!;
    const schema = native.inputSchema as Record<string, unknown>;
    const budget = Number(('x-timeout-s' in native ? native['x-timeout-s'] : undefined) || schema['x-timeout-s'] || 180);
    const wait = typeof args.wait_s === 'number' ? args.wait_s : 0;
    const response = await request('POST', `/compat/${COMPAT_MODULE}/api/agent/call`,
      { name, arguments: args, ...publishingCompatContext(meta) }, Math.max(budget, Math.max(0, wait) + 90) * 1000, publishingCompatIdentity(meta));
    if (response.status === 0) {
      const annotations = 'annotations' in native ? native.annotations as { readOnlyHint?: boolean } : undefined;
      return compatToolResult(transportFailure(response, name, annotations?.readOnlyHint === true), true);
    }
    const body = response.body;
    return compatToolResult(body, response.status >= 400 || body.ok === false);
  }
  // Give the socket the tool's own budget plus a margin, so a deliberately
  // slow tool (an Instagram listing) is not cut off by the transport while the
  // app is still working on it.
  const declared = BRIDGE_TOOLS.find((tool) => tool.name === name)?.timeoutMs ?? 45_000;
  const response = await request(
    'POST',
    '/api/call',
    { tool: name, args, client: 'mcp-stdio' },
    declared + 30_000,
  );
  const body = response.body as { ok?: boolean; result?: unknown; error?: string; code?: string; auditIndex?: number };

  if (response.status === 0) {
    const declaredTool = BRIDGE_TOOLS.find((tool) => tool.name === name);
    return toolResult(transportFailure(response, name, declaredTool ? toolAnnotations(declaredTool).readOnlyHint : false), true);
  }
  if (body.ok === true) {
    const result = body.result ?? {};
    if (typeof body.auditIndex === 'number' && result && typeof result === 'object' && !Array.isArray(result)) {
      return toolResult({ ...result, _undo: { app_id: 'writer', audit_index: body.auditIndex } });
    }
    return toolResult(result);
  }
  return toolResult({ error: body.error ?? 'The tool call failed.', code: body.code }, true);
}

export async function handleRpc(message: Record<string, unknown>): Promise<void> {
  const id = (message.id ?? null) as JsonRpcId;
  const method = String(message.method ?? '');
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Notifications carry no id and must never be answered.
  if (message.id === undefined) return;

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      reply(id, {
        protocolVersion: requested || DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: COMPAT_MODULE ? `${SERVER_NAME}-${COMPAT_MODULE}` : SERVER_NAME, version: SERVER_VERSION },
        // Handed to the model verbatim: this is the briefing that means nobody
        // has to explain the app in a prompt.
        instructions: BRIDGE_INSTRUCTIONS,
      });
      return;
    }
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: await listTools() });
      return;
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args =
        params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      const meta = params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
        ? params._meta as Record<string, unknown> : {};
      const token = meta.progressToken;
      let progress = 0;
      const beat = COMPAT_MODULE && (typeof token === 'string' || typeof token === 'number') ? setInterval(() => {
        progress += 10;
        send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress, message: name + ' is running' } });
      }, 10_000) : undefined;
      try { reply(id, await callTool(name, args, meta)); }
      finally { if (beat) clearInterval(beat); }
      return;
    }
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

/** One JSON-RPC line is bounded; a client streaming without a newline must not grow the buffer without limit. */
const MAX_RPC_LINE_BYTES = 8 * 1024 * 1024;

/** Read newline-delimited JSON-RPC from stdin until the client hangs up. */
function main(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          void handleRpc(JSON.parse(line) as Record<string, unknown>);
        } catch {
          fail(null, -32700, 'Parse error');
        }
      }
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_RPC_LINE_BYTES) {
      buffer = '';
      fail(null, -32700, 'Parse error');
    }
  });
  process.stdin.on('end', () => process.exit(0));
  // stdout is the protocol channel: anything logged there corrupts it.
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[wh-mcp] ${String(err)}\n`);
  });
}

// Guarded so the critical tests can import handleRpc without starting a reader.
if (process.env.WH_MCP_NO_AUTOSTART !== '1') main();
