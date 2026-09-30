import { isIpcChannelAllowedForRole } from '../electron/security';
import { buildFamilyCall, familySearch, type FamilyDeps, type FamilyPostResult } from '../electron/familySearch';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deps(answer: (url: URL, headers: Record<string, string>, body: string) => FamilyPostResult | Promise<FamilyPostResult>, extra: Partial<FamilyDeps> = {}): FamilyDeps {
  return { hubUrl: () => 'http://127.0.0.1:8810', token: async () => 'test-token', post: async (url, headers, body) => answer(url, headers, body), timeoutMs: 1000, ...extra };
}

const json = (status: number, value: unknown): FamilyPostResult => ({ status, body: JSON.stringify(value) });

/** Main-process half of the family library search: what may be asked, of whom, and how every failure surfaces. */
export async function runFamilySearchMainTests(): Promise<string[]> {
  const passed: string[] = [];

  assert(isIpcChannelAllowedForRole('family:search', 'main'), 'the main window has no family search channel');
  assert(!isIpcChannelAllowedForRole('family:search', 'quick-note'), 'the quick-note window can search the family');

  const borges = buildFamilyCall({ app: 'borges', q: '  Suez   canal ', limit: 3 });
  assert('app' in borges && borges.path === '/api/apps/borges/call', 'the call goes to the hub proxy of the named app');
  const body = JSON.parse((borges as { body: string }).body) as { tool: string; arguments: { q: string; limit: number }; timeout_s: number };
  assert(body.tool === 'library_search' && body.arguments.q === 'Suez canal' && body.arguments.limit === 3, 'borges is asked for library_search with a normalised query');
  const links = buildFamilyCall({ app: 'links', q: 'x' });
  assert('app' in links && JSON.parse(links.body).tool === 'search_links' && JSON.parse(links.body).arguments.limit === 5, 'links is asked for search_links with the default limit');
  for (const bad of [null, 'x', {}, { app: 'writer', q: 'x' }, { app: 'borges' }, { app: 'borges', q: '' }, { app: 'borges', q: 'a'.repeat(201) },
    { app: 'borges', q: 'x', limit: 0 }, { app: 'borges', q: 'x', limit: 11 }, { app: 'borges', q: 'x', limit: 2.5 }, { app: 'borges', q: 'x', limit: '3' },
    { app: '../../etc', q: 'x' }, { app: 'borges', q: 'x', tool: 'delete_everything' }]) {
    const built = buildFamilyCall(bad);
    // An unknown extra key is ignored, never forwarded: the only tools are the two fixed ones.
    if (typeof bad === 'object' && bad && 'tool' in bad) assert('app' in built && !JSON.parse(built.body).tool.includes('delete'), 'a caller-chosen tool is never forwarded');
    else assert('error' in built, `request should have been refused: ${JSON.stringify(bad)}`);
  }
  passed.push('Family search: two apps, one fixed tool each, query and limit validated, no caller-chosen tool');

  const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const ok = await familySearch({ app: 'borges', q: 'canal' }, deps((url, headers, sent) => {
    seen.push({ url: url.href, headers, body: sent });
    return json(200, { ok: true, app: 'borges', tool: 'library_search', result: { items: [{ id: '7', title: 'A' }] } });
  }));
  assert(ok.ok && Array.isArray((ok.data as { items: unknown[] }).items), 'the proxy envelope is unwrapped to the tool answer');
  assert(seen[0].url === 'http://127.0.0.1:8810/api/apps/borges/call', 'the call goes to the hub address');
  assert(seen[0].headers.Authorization === 'Bearer test-token', 'the call carries the bridge token');
  const bare = await familySearch({ app: 'links', q: 'canal' }, deps(() => json(200, [{ id: '1' }])));
  assert(bare.ok && Array.isArray(bare.data), 'a bare answer is accepted too');

  const refusedInput = await familySearch({ app: 'nope', q: 'x' }, deps(() => { throw new Error('must not be called'); }));
  assert(!refusedInput.ok && refusedInput.code === 'bad-request', 'an invalid request never reaches the network');
  const down = await familySearch({ app: 'borges', q: 'x' }, deps(() => ({ status: null, body: '', failure: 'refused', message: 'ECONNREFUSED' })));
  assert(!down.ok && down.code === 'hub_unreachable' && down.error.includes('not running') && down.error.includes('ECONNREFUSED'), 'a hub that is not running is named');
  const timeout = await familySearch({ app: 'borges', q: 'x' }, deps(() => ({ status: null, body: '', failure: 'timeout' })));
  assert(!timeout.ok && timeout.code === 'timeout', 'a silent hub times out');
  const large = await familySearch({ app: 'borges', q: 'x' }, deps(() => ({ status: 200, body: '', failure: 'too-large' })));
  assert(!large.ok && large.code === 'too-large', 'an oversized answer is refused');
  const denied = await familySearch({ app: 'borges', q: 'x' }, deps(() => json(401, { error: 'bad token' })));
  assert(!denied.ok && denied.code === 'unauthorized', 'a refused token is surfaced');
  const missing = await familySearch({ app: 'links', q: 'x' }, deps(() => json(404, { error: 'app "links" is not running' })));
  assert(!missing.ok && missing.code === 'app_unavailable' && missing.error.includes('not running'), 'an app the hub cannot reach is surfaced with its reason');
  const toolFailed = await familySearch({ app: 'links', q: 'x' }, deps(() => json(200, { ok: false, error: 'index is rebuilding' })));
  assert(!toolFailed.ok && toolFailed.code === 'app_unavailable' && toolFailed.error === 'index is rebuilding', 'a tool error inside a 200 is an error');
  const html = await familySearch({ app: 'links', q: 'x' }, deps(() => ({ status: 200, body: '<html>hi</html>' })));
  assert(!html.ok && html.code === 'bad_response', 'a non-JSON answer is a bad response');
  const noToken = await familySearch({ app: 'links', q: 'x' }, deps(() => json(200, {}), { token: async () => { throw new Error('no file'); } }));
  assert(!noToken.ok && noToken.code === 'unauthorized', 'a missing token is surfaced, nothing is sent');
  const badHub = await familySearch({ app: 'links', q: 'x' }, deps(() => json(200, {}), { hubUrl: () => 'file:///etc' }));
  assert(!badHub.ok && badHub.code === 'hub_unreachable', 'a hub address that is not http(s) is refused');
  passed.push('Family search: hub token sent, envelope unwrapped, hub down / timeout / oversize / 401 / 404 / tool error / bad JSON / bad hub address all surface as typed failures');

  return passed;
}
