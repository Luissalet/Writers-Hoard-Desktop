import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createWikiHost } from '../electron/wikiHosting/server';
import { wikiHostingManagement } from '../electron/wikiHosting/management';

const htmlA = '<!doctype html><title>Frozen A</title><p>Antes Ω🙂</p>';
const htmlB = '<!doctype html><title>Frozen B</title><p>Después β</p>';
const sha = (html: string) => createHash('sha256').update(html).digest('hex');
const owner = { projectId: 'project-a', profileId: 'profile-a' };
const edition = (editionId: string, html: string) => ({ editionId, html, sha256: sha(html) });
// No pooled socket may be reused after deliberately restarting this origin.
const request = (url: string | URL, method = 'GET') => fetch(url, { method, headers: { Connection: 'close' } });

test('serves only the selected frozen edition, with stable links, withdrawal and cold recovery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'writer-wiki-host-test-'));
  const file = path.join(directory, 'sites.sqlite');
  let host = createWikiHost({ file, port: 0 });
  try {
    assert.deepEqual(host.list(owner), []);
    const a = await host.publish({ ...owner, ...edition('a', htmlA), slug: 'frozen-world', audience: 'public', expectedRevision: 0 });
    const first = await request(a.url!);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), htmlA);
    assert.equal(first.headers.get('etag'), '"' + sha(htmlA) + '"');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const head = await request(a.url!, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(htmlA));
    assert.equal((await request(new URL('/__wh_wiki_host', a.url))).status, 404);
    await assert.rejects(host.publish({ ...owner, ...edition('b', htmlB), slug: a.slug, audience: 'public', expectedRevision: 0 }), /wiki_host_conflict/);
    await assert.rejects(host.publish({ ...owner, ...edition('b', htmlB), slug: a.slug, audience: 'public', expectedRevision: 1, sha256: sha(htmlA) }), /wiki_host_artifact_changed/);
    await assert.rejects(host.publish({ ...owner, projectId: 'project-b', ...edition('b', htmlB), slug: a.slug, audience: 'public', expectedRevision: 1 }), /wiki_host_conflict/);
    assert.equal(await (await request(a.url!)).text(), htmlA);

    const b = await host.publish({ ...owner, ...edition('b', htmlB), slug: a.slug, audience: 'public', expectedRevision: 1 });
    assert.equal(b.url, a.url);
    assert.equal(await (await request(b.url!)).text(), htmlB);
    const hidden = await host.publish({ ...owner, ...edition('b', htmlB), slug: a.slug, audience: 'unlisted', expectedRevision: 2 });
    assert.equal((await request(a.url!)).status, 404);
    assert.equal((await request(hidden.url! + 'x')).status, 404);
    assert.equal(await (await request(hidden.url!)).text(), htmlB);
    assert.equal((await request(hidden.url!, 'POST')).status, 405);
    const updated = await host.publish({ ...owner, ...edition('a', htmlA), slug: a.slug, audience: 'unlisted', expectedRevision: 3 });
    assert.equal(updated.url, hidden.url);
    assert.equal(await (await request(updated.url!)).text(), htmlA);

    const port = Number(new URL(a.url!).port);
    await host.close();
    host = createWikiHost({ file, port });
    await host.resume();
    assert.equal(await (await request(updated.url!)).text(), htmlA);
    assert.equal(host.list(owner)[0].editionId, 'a');
    assert.deepEqual(host.list({ ...owner, profileId: 'foreign' }), []);
    assert.throws(() => host.withdraw({ ...owner, profileId: 'foreign', slug: a.slug, expectedRevision: 4 }), /wiki_host_conflict/);
    const retired = host.withdraw({ ...owner, slug: a.slug, expectedRevision: 4 });
    assert.equal(retired.active, false);
    assert.equal((await request(updated.url!)).status, 404);
    await host.close();
    host = createWikiHost({ file, port });
    await host.resume();
    assert.equal(host.list(owner)[0].active, false);
    assert.equal((await request(updated.url!)).status, 404);
    const restored = await host.publish({ ...owner, ...edition('a', htmlA), slug: a.slug, audience: 'unlisted', expectedRevision: 5 });
    assert.equal(restored.url, updated.url);
    assert.equal(await (await request(restored.url!)).text(), htmlA);
  } finally {
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});

test('management stays on the Writer origin and the reader never serves application routes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'writer-wiki-management-test-'));
  const file = path.join(directory, 'sites.sqlite');
  const host = createWikiHost({ file, port: 0 });
  let authority = '';
  const manage = wikiHostingManagement(host, () => [authority]);
  const editor = createServer((req, res) => { void manage(req, res).then(handled => { if (!handled) res.writeHead(404).end(); }); });
  try {
    await new Promise<void>(resolve => editor.listen(0, '127.0.0.1', resolve));
    const address = editor.address();
    assert(address && typeof address === 'object');
    authority = '127.0.0.1:' + address.port;
    const origin = 'http://' + authority;
    const path = origin + '/__wh_wiki_host';
    const input = { ...owner, ...edition('a', htmlA), slug: 'publish-2056', audience: 'public', expectedRevision: 0 };
    const post = (action: string, input: object, sender: string) =>
      fetch(path, { method: 'POST', headers: { Origin: sender, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ action, input }) });
    assert.equal((await post('publish', input, 'https://example.invalid')).status, 403);
    assert.equal((await request(path)).status, 405);
    const list = await post('list', owner, origin);
    assert.deepEqual(await list.json(), []);
    const result = await post('publish', input, origin);
    assert.equal(result.status, 200);
    const row = await result.json() as { url: string };
    assert.equal(await (await request(row.url)).text(), htmlA);
    assert.equal((await request(new URL('/__wh_wiki_host', row.url))).status, 404);
    assert.equal((await request(new URL('/api/execute', row.url))).status, 404);
    assert.equal((await post('publish', input, origin)).status, 409);
    const published = await post('list', { projectId: owner.projectId }, origin);
    assert.equal((await published.json() as unknown[]).length, 1);
    const foreign = await post('list', { projectId: 'foreign' }, origin);
    assert.deepEqual(await foreign.json(), []);
  } finally {
    await new Promise<void>(resolve => editor.close(() => resolve()));
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
