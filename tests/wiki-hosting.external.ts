import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createWikiHost } from '../electron/wikiHosting/server';

const sha = (html: string) => createHash('sha256').update(html).digest('hex');
const owner = { projectId: 'project-a', profileId: 'profile-a' };
const a = '<!doctype html><title>Older edition</title><p>Version A</p>';
const b = '<!doctype html><html><head><title>Newer edition</title></head><body>Version B</body></html>';
const cover = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const request = (url: string, method = 'GET') => fetch(url, { method, headers: { Connection: 'close' } });

async function freePort() {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  assert(address && typeof address === 'object');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return address.port;
}

function start(cli: string, directory: string, port: number, cwd: string) {
  const child = spawn(process.execPath, [cli], {
    cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WH_WIKI_HOST_DATA_DIR: directory, WH_WIKI_HOST_PORT: String(port), WH_WIKI_HOST_PUBLIC_ORIGIN: '' },
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
  child.stderr.on('data', text => { stderr += text; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Reader did not announce its address: ' + stderr)), 6000);
    child.stdout.on('data', text => {
      stdout += text;
      if (stdout.includes(`Writer wiki reader: http://127.0.0.1:${port} (`)) { clearTimeout(timer); resolve(); }
    });
    void closed.then(({ code }) => { clearTimeout(timer); reject(Error(`Reader exited (${code}): ${stderr}`)); }, reject);
  });
  void ready.catch(() => undefined);
  return {
    child, ready, closed, stderr: () => stderr,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      return closed;
    },
  };
}

test('standalone bundled Node reader keeps the same addresses across writer and reader restarts', { timeout: 18000 }, async () => {
  const cli = process.env.WH_WIKI_HOST_TEST_CLI;
  assert(cli && path.isAbsolute(cli) && existsSync(cli), 'Set WH_WIKI_HOST_TEST_CLI to the built writer-wiki-host.cjs.');
  const root = await mkdtemp(path.join(tmpdir(), 'writer-wiki-reader-test-'));
  const directory = path.join(root, 'registry with spaces');
  const file = path.join(directory, 'sites.sqlite');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const url = base + '/wiki/standalone';
  let cliRun = start(cli, directory, port, root);
  let editor = createWikiHost({ file, port, externalReader: true });
  try {
    await cliRun.ready;
    assert.equal((await request(url)).status, 404);
    assert.equal(existsSync(directory), false);
    const conflicting = start(cli, directory, port, root);
    try {
      const clash = await Promise.race([
        conflicting.closed,
        conflicting.ready.then(() => { throw Error('The second reader took an occupied port'); }),
      ]);
      assert.equal(clash.code, 1);
      assert.match(conflicting.stderr(), /EADDRINUSE/);
    } finally { await conflicting.stop(); }
    assert.equal(existsSync(directory), false);

    await mkdir(directory);
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE wiki_addresses (
      slug TEXT PRIMARY KEY, projectId TEXT NOT NULL, profileId TEXT NOT NULL,
      editionId TEXT NOT NULL, audience TEXT NOT NULL, sha256 TEXT NOT NULL,
      revision INTEGER NOT NULL, active INTEGER NOT NULL, token TEXT, html TEXT NOT NULL
    )`);
    old.prepare('INSERT INTO wiki_addresses VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('standalone', owner.projectId, owner.profileId, 'a', 'public', sha(a), 1, 1, null, a);
    old.close();
    const legacyBytes = await readFile(file);
    assert.equal(await (await request(url)).text(), a);
    assert.equal((await request(url + '/cover')).status, 404);
    assert.deepEqual(await readFile(file), legacyBytes, 'The reader must not migrate the registry');

    const publish = { ...owner, slug: 'standalone', editionId: 'b', sha256: sha(b), html: b };
    const second = await editor.publish({ ...publish, audience: 'public', expectedRevision: 1, coverImage: 'data:image/png;base64,' + cover });
    assert.equal(second.url, url);
    assert.equal(cliRun.child.exitCode, null);
    const publicResponse = await request(url);
    const publicHtml = await publicResponse.text();
    assert.equal(publicHtml.replace(`<meta property="og:image" content="${second.coverUrl}">`, ''), b);
    assert.equal(publicResponse.headers.get('etag'), '"' + sha(publicHtml) + '"');
    assert.equal((await request(url + '/cover', 'HEAD')).headers.get('content-type'), 'image/png');
    await editor.close();
    assert.equal(await (await request(url)).text(), publicHtml, 'Closing Writer must leave the reader available');
    await cliRun.stop();
    await assert.rejects(request(url));
    cliRun = start(cli, directory, port, root);
    await cliRun.ready;
    assert.equal(await (await request(url)).text(), publicHtml);
    assert.deepEqual(Buffer.from(await (await request(second.coverUrl!)).arrayBuffer()), Buffer.from(cover, 'base64'));

    editor = createWikiHost({ file, port, externalReader: true });
    const hidden = await editor.publish({ ...publish, audience: 'unlisted', expectedRevision: 2 });
    assert.equal((await request(url)).status, 404);
    assert.equal((await request(url + '/cover')).status, 404);
    assert.equal((await request(hidden.coverUrl!.replace(/\/u\/[^/]+/, '/u/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status, 404);
    assert.equal((await request(hidden.url!)).status, 200);
    assert.equal((await request(hidden.coverUrl!)).status, 200);
    assert.equal((await request(base + '/__wh_wiki_host', 'POST')).status, 404);
    assert.equal((await request(base + '/api/execute')).status, 404);
    editor.withdraw({ ...owner, slug: hidden.slug, expectedRevision: 3 });
    await editor.close();
    assert.equal((await request(hidden.url!)).status, 404);
    assert.equal((await request(hidden.coverUrl!)).status, 404);
  } finally {
    await editor.close();
    await cliRun.stop();
    await rm(file, { force: true });
    if (existsSync(directory)) await rmdir(directory);
    await rmdir(root);
  }
});
