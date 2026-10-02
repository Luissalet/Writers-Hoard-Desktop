// ============================================================================
// Writers Hoard — searching the user's other local apps through the hub (main)
// ============================================================================
//
// The Investigation engine can ask the reading library and the saved-pages app
// for documents on a topic. It goes through the local Hoard hub
// (`POST <hub>/api/apps/<app>/call`), authenticated with this app's own bridge
// token, so no app needs another's port or token. Like the Wikidata lookups
// the renderer never builds a request: it names an app and a query, and main
// builds the one call that is allowed — two apps, one tool each, a bounded
// query and limit. Private people are taken out of the query BEFORE it gets
// here (src/engines/inquiry/familySearch.ts); main only checks its shape.
//
// Everything fails softly: a hub that is not running answers
// `hub_unreachable`, never an exception.

import http from 'node:http';
import https from 'node:https';
import {
  FAMILY_APPS, FAMILY_DEFAULT_LIMIT, FAMILY_MAX_LIMIT, FAMILY_MAX_QUERY, FAMILY_TOOLS,
  type FamilyApp, type FamilySearchResponse,
} from '../src/engines/inquiry/familySearch';

const TIMEOUT_MS = 20_000;
/** The hub is told to give up a little earlier than this side does. */
const HUB_TIMEOUT_S = 15;
const MAX_BODY_BYTES = 1024 * 1024;

export interface FamilyPostResult {
  /** null when nothing answered. */
  status: number | null;
  body: string;
  /** Set when the connection failed or the answer was too large. */
  failure?: 'refused' | 'timeout' | 'too-large';
  message?: string;
}

export interface FamilyDeps {
  hubUrl: () => string;
  token: () => Promise<string>;
  post: (url: URL, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<FamilyPostResult>;
  timeoutMs: number;
}

export function defaultHubUrl(): string {
  return (process.env.HOARD_HUB_URL || 'http://127.0.0.1:8810').replace(/\/+$/, '');
}

export function nodePost(url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<FamilyPostResult> {
  return new Promise(resolve => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (result: FamilyPostResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'POST', timeout: timeoutMs,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_BODY_BYTES) {
          finish({ status: res.statusCode ?? null, body: '', failure: 'too-large' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish({ status: res.statusCode ?? null, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', error => finish({ status: null, body: '', failure: 'refused', message: error.message }));
    });
    req.on('timeout', () => { finish({ status: null, body: '', failure: 'timeout' }); req.destroy(); });
    req.on('error', error => finish({ status: null, body: '', failure: 'refused', message: error.message }));
    req.end(body);
  });
}

function makeDefaultDeps(): FamilyDeps {
  return {
    hubUrl: defaultHubUrl,
    // Imported lazily: state.ts reads the bridge token from userData, which the
    // tests of this module must not touch.
    token: async () => (await import('./aibridge/state')).getBridgeToken(),
    post: nodePost,
    timeoutMs: TIMEOUT_MS,
  };
}

function bad(error: string): FamilySearchResponse {
  return { ok: false, code: 'bad-request', error };
}

/** The one call an app may be asked for, or an error string. Exported for the security tests. */
export function buildFamilyCall(raw: unknown): { app: FamilyApp; path: string; body: string } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The request must be an object.' };
  const request = raw as Record<string, unknown>;
  const app = request.app;
  if (typeof app !== 'string' || !(FAMILY_APPS as readonly string[]).includes(app)) {
    return { error: `The app must be one of: ${FAMILY_APPS.join(', ')}.` };
  }
  const q = typeof request.q === 'string' ? request.q.replace(/\s+/g, ' ').trim() : '';
  if (!q || q.length > FAMILY_MAX_QUERY) return { error: `The query must be 1 to ${FAMILY_MAX_QUERY} characters.` };
  const limitRaw = request.limit === undefined ? FAMILY_DEFAULT_LIMIT : request.limit;
  if (typeof limitRaw !== 'number' || !Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > FAMILY_MAX_LIMIT) {
    return { error: `The limit must be a whole number from 1 to ${FAMILY_MAX_LIMIT}.` };
  }
  const family = app as FamilyApp;
  return {
    app: family,
    path: `/api/apps/${family}/call`,
    body: JSON.stringify({ tool: FAMILY_TOOLS[family], arguments: { q, limit: limitRaw }, timeout_s: HUB_TIMEOUT_S }),
  };
}

function describe(body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'detail', 'message']) {
      if (typeof record[key] === 'string' && record[key]) return (record[key] as string).slice(0, 300);
    }
  }
  return '';
}

/** One search of one family app, through the hub. Never throws. */
export async function familySearch(raw: unknown, deps: FamilyDeps = makeDefaultDeps()): Promise<FamilySearchResponse> {
  const built = buildFamilyCall(raw);
  if ('error' in built) return bad(built.error);
  let hub: URL;
  try {
    hub = new URL(built.path, `${deps.hubUrl()}/`);
  } catch {
    return { ok: false, code: 'hub_unreachable', error: 'The hub address is not a valid URL (HOARD_HUB_URL).' };
  }
  if (hub.protocol !== 'http:' && hub.protocol !== 'https:') {
    return { ok: false, code: 'hub_unreachable', error: 'The hub address must be http or https (HOARD_HUB_URL).' };
  }
  let token = '';
  try {
    token = await deps.token();
  } catch {
    return { ok: false, code: 'unauthorized', error: 'This app has no bridge token to identify itself to the hub with.' };
  }
  const result = await deps.post(hub, { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, built.body, deps.timeoutMs);
  if (result.failure === 'timeout') return { ok: false, code: 'timeout', error: `The hub did not answer within ${Math.round(deps.timeoutMs / 1000)} s.` };
  if (result.failure === 'too-large') return { ok: false, code: 'too-large', error: 'The hub answered with far more than a list of hits.' };
  if (result.status === null) {
    return { ok: false, code: 'hub_unreachable', error: `The hub is not running at ${hub.origin}${result.message ? ` (${result.message})` : ''}.` };
  }
  let body: unknown;
  try {
    body = JSON.parse(result.body) as unknown;
  } catch {
    body = undefined;
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, code: 'unauthorized', error: 'The hub refused this app\'s token.' };
  }
  if (result.status === 404) {
    return { ok: false, code: 'app_unavailable', error: describe(body) || `The hub does not know an app called "${built.app}".` };
  }
  if (result.status >= 400 || (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false)) {
    return { ok: false, code: 'app_unavailable', error: describe(body) || `The app answered HTTP ${result.status}.` };
  }
  if (body === undefined) return { ok: false, code: 'bad_response', error: 'The hub answered with something that is not JSON.' };
  // The proxy wraps the tool's own answer as { ok, result }; accept a bare answer too.
  const data = body && typeof body === 'object' && 'result' in (body as object) ? (body as { result: unknown }).result : body;
  return { ok: true, data };
}
