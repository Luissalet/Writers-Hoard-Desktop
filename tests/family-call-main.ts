import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isIpcChannelAllowedForRole } from '../electron/security';
import { callApp, refsLink } from '../electron/aibridge/family';
import { checkFamilyCall, checkFamilyRefs, familyCall, familyRefs } from '../electron/familyCall';
import type { FamilyDeps, FamilyPostResult } from '../electron/familySearch';
import { ALLOWED_CALLS, isAllowedCall } from '../src/services/familyBridge/protocol';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const json = (status: number, value: unknown): FamilyPostResult => ({ status, body: JSON.stringify(value) });

function deps(answer: (url: URL, headers: Record<string, string>, body: string) => FamilyPostResult | Promise<FamilyPostResult>, extra: Partial<FamilyDeps> = {}): Partial<FamilyDeps> {
  return { hubUrl: () => 'http://127.0.0.1:8810', token: async () => 'writer-token', post: async (url, headers, body) => answer(url, headers, body), timeoutMs: 1000, ...extra };
}

/** Main-process half of the family hand-offs: what may be called, how pictures reach another app, how every failure surfaces. */
export async function runFamilyCallMainTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];

  // ---- Who may use the channels -----------------------------------------------------------------
  for (const channel of ['family:call', 'family:link']) {
    assert(isIpcChannelAllowedForRole(channel, 'main'), `the main window has no ${channel} channel`);
    assert(!isIpcChannelAllowedForRole(channel, 'quick-note'), `the quick-note window can use ${channel}`);
  }

  // ---- The allowlist: four tools, two apps ------------------------------------------------------
  assert(Object.keys(ALLOWED_CALLS).sort().join() === 'prospero,scheherazade', 'only Prospero and Scheherazade may be called');
  assert(isAllowedCall('prospero', 'cast_import_character') && isAllowedCall('prospero', 'production_from_storyboard'), 'Prospero: cast and production');
  assert(isAllowedCall('scheherazade', 'world_export') && isAllowedCall('scheherazade', 'world_import'), 'Scheherazade: world export and import');
  for (const [app, tool] of [['prospero', 'delete_everything'], ['scheherazade', 'cast_import_character'], ['kafka', 'deadline_add'], ['../etc', 'x'], [undefined, undefined], ['prospero', 'constructor'], ['toString', 'world_import']]) {
    assert(!isAllowedCall(app, tool), `a call that is not allowed passed: ${String(app)}/${String(tool)}`);
    assert('error' in checkFamilyCall({ app, tool, args: {} }), `request should have been refused: ${String(app)}/${String(tool)}`);
  }
  for (const bad of [null, 'x', [], { app: 'prospero', tool: 'cast_import_character' }, { app: 'prospero', tool: 'cast_import_character', args: [] },
    { app: 'prospero', tool: 'cast_import_character', args: {}, files: 'no' }, { app: 'prospero', tool: 'cast_import_character', args: {}, files: [{ id: '../x', base64: PNG }] },
    { app: 'prospero', tool: 'cast_import_character', args: {}, files: [{ id: 'a', base64: PNG }, { id: 'a', base64: PNG }] },
    { app: 'prospero', tool: 'cast_import_character', args: {}, files: [{ id: 'a', base64: '' }] },
    { app: 'prospero', tool: 'cast_import_character', args: {}, timeoutS: 0 }, { app: 'prospero', tool: 'cast_import_character', args: {}, timeoutS: 999 },
    { app: 'prospero', tool: 'cast_import_character', args: { big: 'x'.repeat(9 * 1024 * 1024) } }]) {
    assert('error' in checkFamilyCall(bad), `request should have been refused: ${JSON.stringify(bad).slice(0, 80)}`);
  }
  assert('request' in checkFamilyCall({ app: 'scheherazade', tool: 'world_import', args: { data: { schema: 'hoard.world/1' } }, timeoutS: 120 }), 'a well-formed request is accepted');
  passed.push('Family call: four allowed tools on two apps, everything else refused before the network; args, files and timeout bounded');

  // ---- callApp: the hub proxy, every outcome ----------------------------------------------------
  const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const ok = await callApp('prospero', 'cast_import_character', { name: 'Ana' }, {
    timeoutS: 30,
    deps: deps((url, headers, body) => {
      seen.push({ url: url.href, headers, body });
      return json(200, { ok: true, app: 'prospero', tool: 'cast_import_character', status: 200, result: { ok: true, character_id: 'c9' } });
    }),
  });
  assert(ok.ok && (ok.result as { character_id: string }).character_id === 'c9', 'the hub envelope is unwrapped to the tool answer');
  assert(seen[0].url === 'http://127.0.0.1:8810/api/apps/prospero/call' && seen[0].headers.Authorization === 'Bearer writer-token', 'the call goes to the hub proxy with the bridge token');
  const sent = JSON.parse(seen[0].body) as { tool: string; arguments: { name: string }; timeout_s: number };
  assert(sent.tool === 'cast_import_character' && sent.arguments.name === 'Ana' && sent.timeout_s === 30, 'tool, arguments and timeout_s are what the hub expects');
  const failures: Array<[string, Parameters<typeof callApp>[3], string, string]> = [
    ['hub down', { deps: deps(() => ({ status: null, body: '', failure: 'refused', message: 'ECONNREFUSED' })) }, 'hub_unreachable', 'not running'],
    ['timeout', { deps: deps(() => ({ status: null, body: '', failure: 'timeout' })) }, 'timeout', 'did not answer'],
    ['oversize', { deps: deps(() => ({ status: 200, body: '', failure: 'too-large' })) }, 'too-large', 'far more'],
    ['401', { deps: deps(() => json(401, { error: 'bad token' })) }, 'unauthorized', 'refused'],
    ['no token', { deps: deps(() => json(200, {}), { token: async () => { throw new Error('none'); } }) }, 'unauthorized', 'no bridge token'],
    ['bad hub address', { deps: deps(() => json(200, {}), { hubUrl: () => 'ftp://x' }) }, 'hub_unreachable', 'http or https'],
    ['404', { deps: deps(() => json(404, { error: 'app "prospero" is not running' })) }, 'app_unavailable', 'not running'],
    ['502', { deps: deps(() => json(502, { error: 'connection refused by app' })) }, 'app_unavailable', 'refused'],
    ['envelope ok:false', { deps: deps(() => json(200, { ok: false, error: 'unknown tool' })) }, 'tool_failed', 'unknown tool'],
    ['tool refused inside the result', { deps: deps(() => json(200, { ok: true, result: { ok: false, error: 'name is required' } })) }, 'tool_failed', 'name is required'],
    ['400 with detail object', { deps: deps(() => json(400, { detail: { error: 'bad_document', message: 'not a world' } })) }, 'tool_failed', 'not a world'],
    ['not JSON', { deps: deps(() => ({ status: 200, body: '<html>' })) }, 'bad_response', 'not JSON'],
  ];
  for (const [label, options, code, text] of failures) {
    const answer = await callApp('prospero', 'cast_import_character', {}, options);
    assert(!answer.ok && answer.code === code && answer.error.includes(text) && answer.app === 'prospero', `${label}: expected ${code} mentioning "${text}", got ${JSON.stringify(answer)}`);
  }
  const bare = await callApp('scheherazade', 'world_export', {}, { deps: deps(() => json(200, { schema: 'hoard.world/1' })) });
  assert(bare.ok && (bare.result as { schema: string }).schema === 'hoard.world/1', 'a bare answer is accepted too');
  const link = await refsLink({ from: 'hoard://writer/codex/a', to: 'hoard://prospero/character/c', rel: 'sent_to', fromLabel: 'A', toLabel: 'A' }, {
    deps: deps((url, headers, body) => {
      seen.push({ url: url.href, headers, body });
      return json(200, { ok: true });
    }),
  });
  const linkSent = JSON.parse(seen[seen.length - 1].body) as Record<string, string>;
  assert(link.ok && seen[seen.length - 1].url === 'http://127.0.0.1:8810/api/refs' && linkSent.from === 'hoard://writer/codex/a' && linkSent.rel === 'sent_to' && linkSent.from_label === 'A', 'a ref link is POSTed to /api/refs with snake_case labels');
  const linkDown = await refsLink({ from: 'hoard://writer/codex/a', to: 'hoard://prospero/character/c', rel: 'sent_to' }, { deps: deps(() => ({ status: null, body: '', failure: 'refused' })) });
  assert(!linkDown.ok && linkDown.code === 'hub_unreachable', 'a link that did not land says so instead of throwing');
  passed.push('Family call: hub envelope unwrapped; hub down, timeout, oversize, 401, no token, bad address, 404, 502, tool refusal, 400 detail, non-JSON all typed; /api/refs link');

  // ---- Pictures: validated PNGs, private temporary files, always cleaned up ---------------------
  const tmp = path.join(temporaryDirectory, 'family-tmp');
  await fs.mkdir(tmp, { recursive: true });
  const observed: { args?: Record<string, unknown>; exists?: boolean[]; mode?: number; dirMode?: number; names?: string[] } = {};
  const spy = async (_app: string, _tool: string, args: Record<string, unknown>) => {
    observed.args = args;
    const images = args.images as string[];
    observed.exists = await Promise.all(images.map(file => fs.stat(file).then(() => true, () => false)));
    observed.mode = (await fs.stat(images[0])).mode & 0o777;
    observed.dirMode = (await fs.stat(path.dirname(images[0]))).mode & 0o777;
    observed.names = images.map(file => path.basename(file));
    assert(images.every(file => file.startsWith(tmp + path.sep)), 'pictures are written under the temporary directory');
    return { ok: true as const, app: 'prospero', tool: 'cast_import_character', result: { character_id: 'c1' } };
  };
  const done = await familyCall({
    app: 'prospero', tool: 'cast_import_character',
    args: { name: 'Ana', images: ['@file:portrait', '@file:gallery-1'], shots: [{ image: '@file:portrait' }] },
    files: [{ id: 'portrait', base64: PNG }, { id: 'gallery-1', base64: PNG }],
  }, { tmpDir: () => tmp, call: spy });
  assert(done.ok, 'the call went through');
  assert(observed.exists?.every(Boolean), 'the files exist while the call runs');
  assert(observed.names?.every(name => /^[0-9a-f]{8}-(portrait|gallery-1)\.png$/.test(name)), 'the file names are ours, not the renderer\'s');
  if (process.platform !== 'win32') assert(observed.mode === 0o600 && observed.dirMode === 0o700, `the files are private (0600 in 0700), got ${observed.mode?.toString(8)} in ${observed.dirMode?.toString(8)}`);
  assert((observed.args?.shots as Array<{ image: string }>)[0].image === (observed.args?.images as string[])[0], 'a placeholder is replaced wherever it appears');
  assert(!(await fs.readdir(tmp)).some(name => name.startsWith('writers-hoard-family-')), 'the temporary folder is gone after the call');

  const failedCall = await familyCall({ app: 'prospero', tool: 'cast_import_character', args: { images: ['@file:a'] }, files: [{ id: 'a', base64: PNG }] },
    { tmpDir: () => tmp, call: async () => { throw new Error('boom'); } });
  assert(!failedCall.ok && failedCall.error.includes('boom'), 'a throwing call is a failure, not an exception');
  assert(!(await fs.readdir(tmp)).some(name => name.startsWith('writers-hoard-family-')), 'the temporary folder is gone after a failed call too');

  const notPng = await familyCall({ app: 'prospero', tool: 'cast_import_character', args: { images: ['@file:a'] }, files: [{ id: 'a', base64: Buffer.from('<?php echo 1;').toString('base64') }] },
    { tmpDir: () => tmp, call: async () => { throw new Error('must not be called'); } });
  assert(!notPng.ok && notPng.code === 'bad-request' && /not a PNG/.test(notPng.error), 'a file that is not a PNG is refused');
  const jpeg = await familyCall({ app: 'prospero', tool: 'cast_import_character', args: {}, files: [{ id: 'a', base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]).toString('base64') }] },
    { tmpDir: () => tmp, call: async () => { throw new Error('must not be called'); } });
  assert(!jpeg.ok && /not a PNG/.test(jpeg.error), 'a JPEG is refused: pictures are converted to PNG before they cross');
  const missing = await familyCall({ app: 'prospero', tool: 'cast_import_character', args: { images: ['@file:ghost'] }, files: [] },
    { tmpDir: () => tmp, call: async () => { throw new Error('must not be called'); } });
  assert(!missing.ok && missing.code === 'bad-request' && /ghost/.test(missing.error), 'a placeholder with no file behind it is refused, never sent as text');
  const big = await familyCall({ app: 'prospero', tool: 'cast_import_character', args: {}, files: [{ id: 'a', base64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(9 * 1024 * 1024)]).toString('base64') }] },
    { tmpDir: () => tmp, call: async () => { throw new Error('must not be called'); } });
  assert(!big.ok && /MB each/.test(big.error), 'a picture over the limit is refused');
  const plain = await familyCall({ app: 'scheherazade', tool: 'world_export', args: { world_id: 'w' } }, { tmpDir: () => tmp, call: async (_a, _t, args) => ({ ok: true, app: 'scheherazade', tool: 'world_export', result: args }) });
  assert(plain.ok && (plain.result as { world_id: string }).world_id === 'w', 'a call with no pictures passes its arguments through untouched');
  assert((await fs.readdir(tmp)).length === 0, 'nothing is left behind');
  // A folder a crash left more than a day ago is swept the next time pictures are written.
  const stale = path.join(tmp, 'writers-hoard-family-stale');
  await fs.mkdir(stale);
  await fs.utimes(stale, new Date(Date.now() - 3 * 24 * 3600 * 1000), new Date(Date.now() - 3 * 24 * 3600 * 1000));
  await familyCall({ app: 'prospero', tool: 'cast_import_character', args: { images: ['@file:a'] }, files: [{ id: 'a', base64: PNG }] }, { tmpDir: () => tmp, call: async () => ({ ok: true, app: 'prospero', tool: 'cast_import_character', result: {} }) });
  assert(!(await fs.readdir(tmp)).includes('writers-hoard-family-stale'), 'a stale temporary folder is swept');
  passed.push('Family call: PNG-only private temp files (0600/0700, our own names), placeholders substituted, oversize/JPEG/missing refused, folder removed after success, failure and crash');

  // ---- Ref links --------------------------------------------------------------------------------
  for (const bad of [null, {}, { from: 'x', to: 'y', rel: 'sent_to' }, { from: 'hoard://a/b/c', to: 'http://evil/x', rel: 'sent_to' }, { from: 'hoard://a/b/c', to: 'hoard://a/b/d', rel: 'owns' },
    { from: 'hoard://a/b/c d', to: 'hoard://a/b/d', rel: 'sent_to' }]) {
    assert('error' in checkFamilyRefs(bad), `link should have been refused: ${JSON.stringify(bad)}`);
  }
  const refused = await familyRefs({ from: 'nope', to: 'nope', rel: 'sent_to' });
  assert(!refused.ok && refused.code === 'bad-request', 'a bad link never reaches the network');
  const good = checkFamilyRefs({ from: 'hoard://writer/codex/char_1', to: 'hoard://prospero/character/7', rel: 'imported_from', fromLabel: ' Ana\n Ruiz ', toLabel: 'x'.repeat(500) });
  assert('request' in good && good.request.fromLabel === 'Ana Ruiz' && good.request.toLabel?.length === 120, 'labels are flattened and bounded');
  passed.push('Family call: links need hoard:// refs on both ends and a known relation');

  return passed;
}
