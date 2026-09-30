// ============================================================================
// Writers Hoard — Wikidata lookups for investigation enrichment (main process)
// ============================================================================
//
// The Investigation engine can match a codex entry to a Wikidata item and copy
// a few public facts from it. The request is made from main, like the real
// atlas geocoder, for the same reasons: the API etiquette asks for an
// identifying User-Agent and serial, polite requests, and only main can keep
// that promise for the whole app. The renderer never builds a URL: it names an
// operation and main builds the one request that operation allows, against the
// one host it allows. Nothing is cached and nothing but the typed query or an
// item id leaves the machine. Whether an entry MAY be looked up (private
// people never) is decided in the renderer before it asks; see
// src/engines/inquiry/enrichment.ts.

import { net } from 'electron';
import type { WikidataResponse } from '@/engines/inquiry/wikidata';

const ENDPOINT = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'WritersHoard/0.1 (local desktop app; https://github.com/Luissalet/Writers-Hoard-Releases)';
const MIN_INTERVAL_MS = 250;
const TIMEOUT_MS = 12_000;
const MAX_QUERY_LENGTH = 200;
const MAX_LABEL_IDS = 50;
/** A large item (a country) carries a lot of claims; past this it is not an item. */
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const QID = /^Q[1-9]\d{0,12}$/;
const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

export interface WikidataDeps {
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
}

const defaultDeps: WikidataDeps = {
  fetch: (url, init) => net.fetch(url, init),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs: TIMEOUT_MS,
};

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function bad(error: string): WikidataResponse {
  return { ok: false, code: 'bad-request', error };
}

function language(raw: unknown): string {
  return typeof raw === 'string' && LANGUAGE.test(raw) ? raw : 'en';
}

/** The single URL an operation may use, or an error string. Exported for the security tests. */
export function buildWikidataUrl(raw: unknown): { url: string } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The request must be an object.' };
  const request = raw as Record<string, unknown>;
  const url = new URL(ENDPOINT);
  const lang = language(request.language);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  if (request.op === 'search') {
    const query = typeof request.query === 'string' ? request.query.replace(/\s+/g, ' ').trim() : '';
    if (!query || query.length > MAX_QUERY_LENGTH) return { error: `The query must be 1 to ${MAX_QUERY_LENGTH} characters.` };
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', query);
    url.searchParams.set('language', lang);
    url.searchParams.set('uselang', lang);
    url.searchParams.set('type', 'item');
    url.searchParams.set('limit', '7');
    return { url: url.toString() };
  }
  if (request.op === 'entity') {
    if (typeof request.qid !== 'string' || !QID.test(request.qid)) return { error: 'The item id must look like Q42.' };
    url.searchParams.set('action', 'wbgetentities');
    url.searchParams.set('ids', request.qid);
    url.searchParams.set('props', 'labels|descriptions|aliases|claims');
    url.searchParams.set('languages', lang === 'en' ? 'en' : `${lang}|en`);
    return { url: url.toString() };
  }
  if (request.op === 'labels') {
    const ids = Array.isArray(request.qids) ? request.qids : [];
    if (!ids.length || ids.length > MAX_LABEL_IDS || !ids.every(id => typeof id === 'string' && QID.test(id))) {
      return { error: `Between 1 and ${MAX_LABEL_IDS} item ids like Q42 are needed.` };
    }
    url.searchParams.set('action', 'wbgetentities');
    url.searchParams.set('ids', [...new Set(ids as string[])].join('|'));
    url.searchParams.set('props', 'labels');
    url.searchParams.set('languages', lang === 'en' ? 'en' : `${lang}|en`);
    return { url: url.toString() };
  }
  return { error: 'Unknown operation.' };
}

async function readBounded(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > MAX_BODY_BYTES ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(out);
}

async function run(url: string, deps: WikidataDeps): Promise<WikidataResponse> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await deps.sleep(wait);
  lastRequestAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      // A redirect would carry the query and the User-Agent to another host.
      redirect: 'error',
    });
    if (!response.ok) return { ok: false, code: 'http', error: `Wikidata answered HTTP ${response.status}.` };
    const text = await readBounded(response);
    if (text === null) return { ok: false, code: 'too-large', error: 'Wikidata answered with something far larger than an item.' };
    try {
      const data = JSON.parse(text) as unknown;
      if (data && typeof data === 'object' && 'error' in data) {
        const info = (data as { error?: { info?: unknown } }).error?.info;
        return { ok: false, code: 'http', error: typeof info === 'string' ? info.slice(0, 300) : 'Wikidata reported an error.' };
      }
      return { ok: true, data };
    } catch {
      return { ok: false, code: 'http', error: 'Wikidata answered with something that is not JSON.' };
    }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, code: 'timeout', error: `No answer from Wikidata within ${Math.round(deps.timeoutMs / 1000)} s.` };
    return { ok: false, code: 'network', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** One Wikidata request, queued behind any other so the app stays serial and polite. */
export function wikidataRequest(raw: unknown, deps: WikidataDeps = defaultDeps): Promise<WikidataResponse> {
  const built = buildWikidataUrl(raw);
  if ('error' in built) return Promise.resolve(bad(built.error));
  const next = queue.then(() => run(built.url, deps));
  queue = next.catch(() => undefined);
  return next;
}

export const WIKIDATA_USER_AGENT = USER_AGENT;
