// ============================================================================
// AI bridge — the Hoard family (main process)
// ============================================================================
//
// What makes this port a member of the family of local Hoard apps: a
// `hoard_link` block in /api/health so the hub's audit sees the app is on the
// contract, and one `agent.call` event per tool call posted to the hub's bus
// (fire-and-forget: the hub being absent never slows or fails a call).
//
//   HOARD_HUB_URL   where the hub listens (default http://127.0.0.1:8810)
//   HOARD_EVENTS=0  never post anything
//
// The bearer token is the bridge's own (`<userData>/aibridge/token`): the hub
// records the event's source from it, so this app can only speak for itself.

import http from 'node:http';
import { getBridgeToken } from './state';
import { defaultHubUrl, nodePost, type FamilyDeps } from '../familySearch';
import type { FamilyCallResponse, FamilyRefsRequest } from '../../src/services/familyBridge/protocol';

export const FAMILY_APP_ID = 'writer';
export const FAMILY_VERSION = '0.4.0';
const MAX_DATA_BYTES = 16 * 1024;

function hubUrl(): string {
  return (process.env.HOARD_HUB_URL || 'http://127.0.0.1:8810').replace(/\/+$/, '');
}

function eventsEnabled(): boolean {
  const raw = (process.env.HOARD_EVENTS ?? '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

const stats = { sent: 0, dropped: 0, lastError: '' };

/** Post one event to the hub's bus. Never throws, never waits. */
export function emitFamilyEvent(type: string, data: Record<string, unknown> = {}): void {
  if (!eventsEnabled()) return;
  void (async () => {
    let token = '';
    try {
      token = await getBridgeToken();
    } catch {
      return;
    }
    let payload = JSON.stringify({ type, source: FAMILY_APP_ID, data });
    if (Buffer.byteLength(payload) > MAX_DATA_BYTES) {
      payload = JSON.stringify({ type, source: FAMILY_APP_ID, data: { truncated: true } });
    }
    const target = new URL('/api/events', hubUrl());
    const req = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'POST',
        timeout: 3000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        if (res.statusCode === 200) stats.sent += 1;
        else {
          stats.dropped += 1;
          stats.lastError = `HTTP ${res.statusCode}`;
        }
        res.resume();
      },
    );
    req.on('error', (err) => {
      stats.dropped += 1;
      stats.lastError = err.message;
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  })();
}

/** The block every family app adds to its /api/health answer. */
export function familyHealthBlock(): Record<string, unknown> {
  return {
    version: FAMILY_VERSION,
    family: FAMILY_VERSION,
    events: eventsEnabled(),
    app: FAMILY_APP_ID,
    hub: hubUrl(),
    sent: stats.sent,
    dropped: stats.dropped,
  };
}

// ---------------------------------------------------------------------------
// Calling another family app through the hub
// ---------------------------------------------------------------------------
//
// `POST <hub>/api/apps/<app>/call` with this app's own bridge token. The hub
// answers `{ ok, app, tool, status, result | error }`. Nothing here throws:
// a hub that is not running, an app that is stopped, a tool that refuses and
// a slow answer all come back as a typed `{ ok: false, code, error }`, so the
// caller can tell the person what to start instead of showing a stack trace.
// Which app and tool may be asked is decided one layer up (electron/familyCall.ts).

const CALL_TIMEOUT_S = 60;
const MAX_CALL_TIMEOUT_S = 300;
const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

export interface CallAppOptions {
  /** Seconds the hub may wait for the app (default 60, at most 300). */
  timeoutS?: number;
  /** Replaced by the tests; the defaults talk to the real hub. */
  deps?: Partial<FamilyDeps>;
}

function realDeps(over: Partial<FamilyDeps> | undefined, timeoutMs: number): FamilyDeps {
  return {
    hubUrl: defaultHubUrl,
    token: getBridgeToken,
    post: nodePost,
    timeoutMs,
    ...over,
  };
}

/** The most useful sentence an error body holds: `error`, `detail` or `message`, as text or as an object. */
function messageOf(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value.slice(0, 300);
    if (value && typeof value === 'object') {
      const nested = messageOf(value);
      if (nested) return nested;
    }
  }
  return '';
}

/** One POST to the hub, with the bridge token. Shared by callApp and refsLink. */
async function hubPost(
  path: string,
  payload: unknown,
  timeoutMs: number,
  over: Partial<FamilyDeps> | undefined,
): Promise<{ failure: FamilyCallResponse & { ok: false } } | { status: number; body: unknown }> {
  const deps = realDeps(over, timeoutMs);
  let hub: URL;
  try {
    hub = new URL(path, `${deps.hubUrl()}/`);
  } catch {
    return { failure: { ok: false, code: 'hub_unreachable', error: 'The hub address is not a valid URL (HOARD_HUB_URL).' } };
  }
  if (hub.protocol !== 'http:' && hub.protocol !== 'https:') {
    return { failure: { ok: false, code: 'hub_unreachable', error: 'The hub address must be http or https (HOARD_HUB_URL).' } };
  }
  let token = '';
  try {
    token = await deps.token();
  } catch {
    return { failure: { ok: false, code: 'unauthorized', error: "This app has no bridge token to identify itself to the hub with." } };
  }
  const result = await deps.post(
    hub,
    { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify(payload),
    deps.timeoutMs,
  );
  if (result.failure === 'timeout') {
    return { failure: { ok: false, code: 'timeout', error: `The hub did not answer within ${Math.round(deps.timeoutMs / 1000)} s.` } };
  }
  if (result.failure === 'too-large') {
    return { failure: { ok: false, code: 'too-large', error: 'The hub answered with far more than an app should return.' } };
  }
  if (result.status === null) {
    return { failure: { ok: false, code: 'hub_unreachable', error: `The Hoard hub is not running at ${hub.origin}${result.message ? ` (${result.message})` : ''}.` } };
  }
  let body: unknown;
  try {
    body = JSON.parse(result.body) as unknown;
  } catch {
    body = undefined;
  }
  if (result.status === 401 || result.status === 403) {
    return { failure: { ok: false, code: 'unauthorized', error: "The hub refused this app's token." } };
  }
  if (body === undefined) {
    return { failure: { ok: false, code: 'bad_response', error: `The hub answered HTTP ${result.status} with something that is not JSON.` } };
  }
  return { status: result.status, body };
}

/**
 * Call one tool of another family app. Never throws.
 *
 * `args` is sent as the tool's `arguments`. A tool's own refusal (`ok:false`
 * inside the answer) is `tool_failed` with the app's wording; an app the hub
 * cannot reach is `app_unavailable`.
 */
export async function callApp(
  app: string,
  tool: string,
  args: Record<string, unknown>,
  options: CallAppOptions = {},
): Promise<FamilyCallResponse> {
  const timeoutS = Math.min(MAX_CALL_TIMEOUT_S, Math.max(1, Math.round(options.timeoutS ?? CALL_TIMEOUT_S)));
  const answer = await hubPost(
    `/api/apps/${encodeURIComponent(app)}/call`,
    { tool, arguments: args, timeout_s: timeoutS },
    (timeoutS + 5) * 1000,
    options.deps,
  );
  if ('failure' in answer) return { ...answer.failure, app, tool };
  const { status, body } = answer;
  if (status === 404) {
    return { ok: false, code: 'app_unavailable', app, tool, error: messageOf(body) || `The hub does not know an app called "${app}", or it is not running.` };
  }
  const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const innerStatus = typeof envelope.status === 'number' ? envelope.status : undefined;
  if (status >= 500 || envelope.ok === false || (innerStatus !== undefined && innerStatus >= 400 && !('result' in envelope && envelope.result))) {
    const text = messageOf(body);
    const unreachable = status === 502 || status === 503 || status === 504 || /not running|unreachable|refused|offline|timed out/i.test(text);
    return { ok: false, code: unreachable ? 'app_unavailable' : 'tool_failed', app, tool, error: text || `${app} answered HTTP ${innerStatus ?? status}.` };
  }
  if (status >= 400) {
    return { ok: false, code: 'tool_failed', app, tool, error: messageOf(body) || `${app} answered HTTP ${status}.` };
  }
  // The hub wraps the tool's own answer as { ok, result }; accept a bare answer too.
  const result = 'result' in envelope ? envelope.result : body;
  if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false) {
    return { ok: false, code: 'tool_failed', app, tool, error: messageOf(result) || `${app} refused ${tool}.` };
  }
  if (Buffer.byteLength(JSON.stringify(result ?? null)) > MAX_ANSWER_BYTES) {
    return { ok: false, code: 'too-large', app, tool, error: 'The app answered with far more than expected.' };
  }
  return { ok: true, app, tool, result };
}

/**
 * Tell the hub that two records are the same thing in two apps
 * (`POST <hub>/api/refs`). Fire-and-forget in spirit: a failure is returned,
 * never thrown, and the caller treats it as a hint that did not land.
 */
export async function refsLink(
  request: FamilyRefsRequest,
  options: { deps?: Partial<FamilyDeps> } = {},
): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const answer = await hubPost(
    '/api/refs',
    {
      from: request.from,
      to: request.to,
      rel: request.rel,
      from_label: request.fromLabel ?? '',
      to_label: request.toLabel ?? '',
    },
    10_000,
    options.deps,
  );
  if ('failure' in answer) return { ok: false, code: answer.failure.code, error: answer.failure.error };
  if (answer.status >= 400) return { ok: false, code: 'app_unavailable', error: messageOf(answer.body) || `The hub answered HTTP ${answer.status}.` };
  return { ok: true };
}
