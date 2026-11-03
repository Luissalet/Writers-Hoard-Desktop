import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createStandaloneWikiReader, createWikiHost } from '../electron/wikiHosting/server';
import { wikiHostingManagement } from '../electron/wikiHosting/management';

// Two frozen manuscript editions and one wiki edition with the SAME public slug.
const readA = '<!doctype html><html><head><title>Faro A</title></head><body><h1>Capítulo uno Ω</h1></body></html>';
const readB = '<!doctype html><html><head><title>Faro B</title></head><body><h1>Capítulo dos β</h1></body></html>';
const wiki = '<!doctype html><title>Wiki</title><p>Canon del mundo</p>';
const sha = (html: string) => createHash('sha256').update(html).digest('hex');
const ownerA = { projectId: 'project-a', ownerKey: JSON.stringify(['manuscript', 'novel-a', null]) };
const ownerB = { projectId: 'project-a', ownerKey: JSON.stringify(['manuscript', 'novel-b', null]) };
const wikiOwner = { projectId: 'project-a', profileId: 'profile-a' };
const read = (editionId: string, html: string) => ({ editionId, html, sha256: sha(html) });
const request = (url: string | URL, method = 'GET') => fetch(url, { method, headers: { Connection: 'close' } });

async function scratch(name: string) {
  const directory = await mkdtemp(path.join(tmpdir(), name));
  return { directory, file: path.join(directory, 'sites.sqlite') };
}

test('a manuscript edition is served under /read/ next to a wiki with the same slug', async () => {
  const { directory, file } = await scratch('writer-read-host-test-');
  let host = createWikiHost({ file, port: 0 });
  try {
    const wikiRow = await host.publish({ ...wikiOwner, editionId: 'w1', html: wiki, sha256: sha(wiki), slug: 'faro', audience: 'public', expectedRevision: 0 });
    const a = await host.readPublish({ ...ownerA, ...read('ed-a', readA), slug: 'faro', audience: 'public', expectedRevision: 0 });
    assert.equal(a.kind, 'manuscript-edition');
    assert.equal(a.slug, 'faro', 'the public slug carries no storage prefix');
    assert.match(a.url!, /\/read\/faro$/);
    const served = await request(a.url!);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), readA, 'the frozen reader HTML is served byte for byte');
    assert.equal(served.headers.get('etag'), '"' + sha(readA) + '"');
    assert.equal((await request(a.url! + '/cover')).status, 404, 'reading addresses have no cover route');
    assert.equal(await (await request(wikiRow.url!)).text(), wiki, 'the wiki with the same slug is untouched');

    // Wiki tools never see reading rows, and reading tools never see wiki rows.
    assert.deepEqual(host.list({}).map(row => row.slug), ['faro']);
    assert.deepEqual(host.list({}).map(row => row.profileId), ['profile-a']);
    assert.deepEqual(host.readList({}).map(row => [row.slug, row.ownerKey]), [['faro', ownerA.ownerKey]]);
    assert.deepEqual(host.readList({ projectId: 'project-a', ownerKey: ownerB.ownerKey }), []);
    assert.throws(() => host.readList({ ownerKey: ownerA.ownerKey }), /wiki_host_owner_invalid/);

    // CAS and ownership: stale revision, another manuscript and a changed artifact never write.
    await assert.rejects(host.readPublish({ ...ownerA, ...read('ed-b', readB), slug: 'faro', audience: 'public', expectedRevision: 0 }), /wiki_host_conflict/);
    await assert.rejects(host.readPublish({ ...ownerB, ...read('ed-b', readB), slug: 'faro', audience: 'public', expectedRevision: 1 }), /wiki_host_conflict/);
    await assert.rejects(host.readPublish({ ...ownerA, ...read('ed-b', readB), sha256: sha(readA), slug: 'faro', audience: 'public', expectedRevision: 1 }), /wiki_host_artifact_changed/);
    await assert.rejects(host.readPublish({ ...ownerA, ...read('ed-b', readB), slug: 'read:faro', audience: 'public', expectedRevision: 1 }), /wiki_host_slug_invalid/);
    assert.equal(await (await request(a.url!)).text(), readA);

    // Moving the address to edition B keeps the URL; the wiki is still byte-identical.
    const b = await host.readPublish({ ...ownerA, ...read('ed-b', readB), slug: 'faro', audience: 'public', expectedRevision: 1 });
    assert.equal(b.url, a.url);
    assert.equal(b.editionId, 'ed-b');
    assert.equal(await (await request(b.url!)).text(), readB);
    assert.equal(await (await request(wikiRow.url!)).text(), wiki);

    // Private link: the public path and any other token are 404.
    const hidden = await host.readPublish({ ...ownerA, ...read('ed-b', readB), slug: 'faro', audience: 'unlisted', expectedRevision: 2 });
    assert.match(hidden.url!, /\/read\/faro\/u\/[A-Za-z0-9_-]{32}$/);
    assert.equal((await request(a.url!)).status, 404);
    assert.equal(await (await request(hidden.url!)).text(), readB);
    assert.equal((await request(hidden.url!.replace(/u\/.*/, 'u/' + 'x'.repeat(32)))).status, 404);
    assert.equal((await request(hidden.url!.replace('/read/', '/wiki/'))).status, 404, 'a reading token never opens the wiki');
    assert.equal(hidden.url!.includes('read:'), false);

    // Cold restart from the same registry, then the standalone reader with the editor closed.
    const port = Number(new URL(a.url!).port);
    await host.close();
    host = createWikiHost({ file, port });
    await host.resume();
    assert.equal(await (await request(hidden.url!)).text(), readB);
    await host.close();
    const standalone = createStandaloneWikiReader({ file, port });
    await standalone.start();
    try {
      assert.equal(await (await request(hidden.url!)).text(), readB, 'the reader keeps serving with Writer closed');
      assert.equal(await (await request(wikiRow.url!)).text(), wiki);
    } finally { await standalone.close(); }

    host = createWikiHost({ file, port });
    await host.resume();
    await assert.rejects(Promise.resolve().then(() => host.readWithdraw({ ...ownerB, slug: 'faro', expectedRevision: 3 })), /wiki_host_conflict/);
    const withdrawn = host.readWithdraw({ ...ownerA, slug: 'faro', expectedRevision: 3 });
    assert.equal(withdrawn.active, false);
    assert.equal(withdrawn.url, null);
    assert.equal((await request(hidden.url!)).status, 404);
    assert.equal(await (await request(wikiRow.url!)).text(), wiki, 'withdrawing the reading address leaves the wiki served');
  } finally {
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});

test('reading addresses are managed on the Writer origin with their own actions', async () => {
  const { directory, file } = await scratch('writer-read-management-test-');
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
    const post = (action: string, input: object, sender = origin) => fetch(origin + '/__wh_wiki_host', {
      method: 'POST', headers: { Origin: sender, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ action, input }),
    });
    const input = { ...ownerA, ...read('ed-a', readA), slug: 'faro', audience: 'public', expectedRevision: 0 };
    assert.equal((await post('read-publish', input, 'https://example.invalid')).status, 403);
    assert.deepEqual(await (await post('read-list', {})).json(), []);
    const published = await post('read-publish', input);
    assert.equal(published.status, 200);
    const row = await published.json() as { url: string; revision: number; slug: string; ownerKey: string };
    assert.equal(await (await request(row.url)).text(), readA);
    assert.equal((await post('read-publish', input)).status, 409);
    assert.deepEqual(await (await post('list', {})).json(), [], 'wiki listing ignores reading rows');
    const library = await (await post('read-list', {})).json() as { slug: string; ownerKey: string }[];
    assert.deepEqual(library.map(entry => [entry.slug, entry.ownerKey]), [['faro', ownerA.ownerKey]]);
    assert.equal((await post('read-withdraw', { ...ownerB, slug: 'faro', expectedRevision: row.revision })).status, 409);
    assert.equal((await post('read-withdraw', { ...ownerA, slug: 'faro', expectedRevision: row.revision })).status, 200);
    assert.equal((await request(row.url)).status, 404);
  } finally {
    await new Promise<void>(resolve => editor.close(() => resolve()));
    await host.close();
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
