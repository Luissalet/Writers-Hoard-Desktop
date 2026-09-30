import { isIpcChannelAllowedForRole } from '../electron/security';
import { buildWikidataUrl, WIKIDATA_USER_AGENT, wikidataRequest, type WikidataDeps } from '../electron/wikidata';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deps(handler: (url: string, init: Parameters<WikidataDeps['fetch']>[1]) => Promise<Response>, timeoutMs = 2000): WikidataDeps {
  return { fetch: handler, sleep: async () => undefined, timeoutMs };
}

/** Main-process half of the Wikidata lookups: what may be asked, of whom, and how failures surface. */
export async function runWikidataMainTests(): Promise<string[]> {
  const passed: string[] = [];

  assert(isIpcChannelAllowedForRole('wikidata:request', 'main'), 'the main window has no Wikidata channel');
  assert(!isIpcChannelAllowedForRole('wikidata:request', 'quick-note'), 'the quick-note window can reach Wikidata');

  const search = buildWikidataUrl({ op: 'search', query: '  Ada   Lovelace ', language: 'es' });
  assert('url' in search, 'a plain search must be accepted');
  const searchUrl = new URL(search.url);
  assert(searchUrl.origin === 'https://www.wikidata.org' && searchUrl.pathname === '/w/api.php', 'requests go to wikidata.org only');
  assert(searchUrl.searchParams.get('action') === 'wbsearchentities' && searchUrl.searchParams.get('search') === 'Ada Lovelace', 'the query is whitespace-normalised');
  assert(searchUrl.searchParams.get('language') === 'es', 'a language tag is kept');
  assert(new URL((buildWikidataUrl({ op: 'search', query: 'x', language: 'javascript:alert(1)' }) as { url: string }).url).searchParams.get('language') === 'en', 'a malformed language falls back to English');
  for (const bad of [null, 'x', {}, { op: 'search' }, { op: 'search', query: '' }, { op: 'search', query: 'a'.repeat(201) },
    { op: 'entity', qid: 'Q42; drop' }, { op: 'entity', qid: 'P42' }, { op: 'entity', qid: 'Q0' }, { op: 'entity' },
    { op: 'labels', qids: [] }, { op: 'labels', qids: ['Q1', 'nope'] }, { op: 'labels', qids: Array.from({ length: 51 }, (_v, i) => `Q${i + 1}`) },
    { op: 'fetch', url: 'https://evil.example/' }]) {
    assert('error' in buildWikidataUrl(bad), `request should have been refused: ${JSON.stringify(bad)}`);
  }
  const labels = buildWikidataUrl({ op: 'labels', qids: ['Q1', 'Q2', 'Q1'], language: 'en' }) as { url: string };
  assert(new URL(labels.url).searchParams.get('ids') === 'Q1|Q2', 'label ids are de-duplicated');
  const entity = buildWikidataUrl({ op: 'entity', qid: 'Q42', language: 'es' }) as { url: string };
  assert(new URL(entity.url).searchParams.get('languages') === 'es|en', 'entity labels fall back to English');
  passed.push('Wikidata: only three operations, only wikidata.org, ids and queries validated');

  const seen: Array<{ url: string; headers: Record<string, string>; redirect: string }> = [];
  const ok = await wikidataRequest({ op: 'search', query: 'Ada', language: 'en' }, deps(async (url, init) => {
    seen.push({ url, headers: init.headers, redirect: init.redirect });
    return new Response(JSON.stringify({ search: [] }), { status: 200 });
  }));
  assert(ok.ok && seen.length === 1, 'a good answer is returned');
  assert(seen[0].headers['User-Agent'] === WIKIDATA_USER_AGENT && WIKIDATA_USER_AGENT.includes('WritersHoard'), 'requests identify the app');
  assert(seen[0].redirect === 'error', 'redirects are refused so the query cannot travel to another host');
  const badRequest = await wikidataRequest({ op: 'nope' }, deps(async () => { throw new Error('must not be called'); }));
  assert(!badRequest.ok && badRequest.code === 'bad-request', 'an invalid request never reaches the network');

  const http = await wikidataRequest({ op: 'search', query: 'x', language: 'en' }, deps(async () => new Response('busy', { status: 503 })));
  assert(!http.ok && http.code === 'http' && http.error.includes('503'), 'an HTTP error is surfaced with its status');
  const notJson = await wikidataRequest({ op: 'search', query: 'x', language: 'en' }, deps(async () => new Response('<html>portal</html>', { status: 200 })));
  assert(!notJson.ok && notJson.code === 'http', 'a captive-portal page is an API error, not a network one');
  const apiError = await wikidataRequest({ op: 'entity', qid: 'Q1', language: 'en' }, deps(async () => new Response(JSON.stringify({ error: { info: 'Bad things' } }), { status: 200 })));
  assert(!apiError.ok && apiError.error === 'Bad things', 'an API-level error is surfaced');
  const huge = await wikidataRequest({ op: 'entity', qid: 'Q1', language: 'en' }, deps(async () => new Response('{}', { status: 200, headers: { 'content-length': String(5 * 1024 * 1024) } })));
  assert(!huge.ok && huge.code === 'too-large', 'an oversized body is refused before it is read');
  const network = await wikidataRequest({ op: 'search', query: 'x', language: 'en' }, deps(async () => { throw new Error('ECONNREFUSED'); }));
  assert(!network.ok && network.code === 'network' && network.error.includes('ECONNREFUSED'), 'a network failure is surfaced');
  const slow = await wikidataRequest({ op: 'search', query: 'x', language: 'en' }, deps((_url, init) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), 40));
  assert(!slow.ok && slow.code === 'timeout', 'a silent server times out');
  // The queue survives a failure: the next request still runs.
  const after = await wikidataRequest({ op: 'search', query: 'x', language: 'en' }, deps(async () => new Response(JSON.stringify({ search: [] }), { status: 200 })));
  assert(after.ok, 'a failed request must not poison the queue');
  passed.push('Wikidata: polite identified requests, no redirects, bounded body, timeouts, HTTP/API/network errors surfaced, queue survives failures');

  return passed;
}
