import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

    const second = await post('publish', { ...input, projectId: 'project-b', slug: 'second-world' }, origin);
    assert.equal(second.status, 200);
    const secondRow = await second.json() as { url: string };
    const library = await post('list', {}, origin);
    assert.equal(library.status, 200, 'The library must find published links without an open project');
    const addresses = await library.json() as { slug: string; projectId: string; profileId: string; revision: number }[];
    assert.deepEqual(addresses.map(address => address.projectId), ['project-a', 'project-b']);
    const [firstAddress] = addresses;
    const withdraw = { ...firstAddress, expectedRevision: firstAddress.revision };
    assert.equal((await post('withdraw', { ...withdraw, projectId: 'project-b' }, origin)).status, 409);
    assert.equal((await post('withdraw', withdraw, origin)).status, 200);
    assert.equal((await request(row.url)).status, 404);
    assert.equal(await (await request(secondRow.url)).text(), htmlA);
  } finally {
    await new Promise<void>(resolve => editor.close(() => resolve()));
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});


test('publication covers follow the edition address, even across audience changes and cold recovery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'writer-wiki-cover-test-'));
  const file = path.join(directory, 'sites.sqlite');
  const prior = new DatabaseSync(file);
  prior.exec(`CREATE TABLE wiki_addresses (
    slug TEXT PRIMARY KEY, projectId TEXT NOT NULL, profileId TEXT NOT NULL,
    editionId TEXT NOT NULL, audience TEXT NOT NULL, sha256 TEXT NOT NULL,
    revision INTEGER NOT NULL, active INTEGER NOT NULL, token TEXT, html TEXT NOT NULL
  )`);
  prior.prepare('INSERT INTO wiki_addresses VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('covered', owner.projectId, owner.profileId, 'a', 'public', sha(htmlA), 1, 1, null, htmlA);
  prior.close();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=';
  const coverImage = 'data:image/png;base64,' + png;
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Frozen B</title></head><body>Edition B</body></html>';
  const input = { ...owner, ...edition('b', html), slug: 'covered', audience: 'unlisted' as const };
  let host = createWikiHost({ file, port: 0 });
  try {
    await host.resume();
    const [old] = host.list(owner);
    assert.equal(old.revision, 1);
    assert.equal(await (await request(old.url!)).text(), htmlA);
    assert.equal(old.coverUrl, undefined);
    const hidden = await host.publish({ ...input, expectedRevision: 1, coverImage });
    assert.equal(hidden.sha256, sha(html));
    assert.equal(hidden.coverUrl, hidden.url + '/cover');
    assert.equal((await request(old.url + '/cover')).status, 404);
    assert.equal((await request(hidden.coverUrl!.replace(/\/u\/[^/]+/, '/u/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status, 404);
    const metadata = await request(hidden.url!);
    const served = await metadata.text();
    assert.equal(served.replace(`<meta property="og:image" content="${hidden.coverUrl}">`, ''), html);
    assert.notEqual(served, html);
    assert.equal(metadata.headers.get('etag'), '"' + sha(served) + '"');
    const image = await request(hidden.coverUrl!);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
    const head = await request(hidden.coverUrl!, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await request(hidden.coverUrl!, 'POST')).status, 405);
    await assert.rejects(host.publish({ ...input, expectedRevision: 2, coverImage: 'data:image/png;base64,PHN2Zz4=' }), /wiki_host_cover_invalid/);
    await assert.rejects(host.publish({ ...input, expectedRevision: 1, coverImage: null }), /wiki_host_conflict/);
    const retained = await host.publish({ ...input, expectedRevision: 2 });
    assert.equal(retained.coverUrl, hidden.coverUrl);
    await host.close();
    host = createWikiHost({ file, port: Number(new URL(hidden.url!).port) });
    await host.resume();
    assert.deepEqual(host.list(owner), [retained]);
    assert.equal((await request(retained.coverUrl!)).status, 200);
    const publicLink = await host.publish({ ...input, expectedRevision: 3, audience: 'public' });
    assert.equal(publicLink.coverUrl, old.url + '/cover');
    assert.equal((await request(hidden.coverUrl!)).status, 404);
    assert.equal((await request(publicLink.coverUrl!)).status, 200);
    const removed = await host.publish({ ...input, expectedRevision: 4, audience: 'public', coverImage: null });
    assert.equal(removed.coverUrl, undefined);
    assert.equal(await (await request(removed.url!)).text(), html);
    assert.equal((await request(publicLink.coverUrl!)).status, 404);
    const restored = await host.publish({ ...input, expectedRevision: 5, coverImage });
    host.withdraw({ ...owner, slug: input.slug, expectedRevision: 6 });
    assert.equal((await request(restored.coverUrl!)).status, 404);
    await host.close();
    host = createWikiHost({ file, port: Number(new URL(hidden.url!).port) });
    await host.resume();
    assert.equal((await request(restored.coverUrl!)).status, 404);
  } finally {
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
