import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRendererRequestHandler, resolveRendererFile } from '../electron/rendererServer';
import { sameCounts } from '../electron/originMigrationScripts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(port: number, urlPath: string, host: string, method = 'GET'): Promise<{ status: number; body: string; type?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, type: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function runRendererServerTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];
  const root = path.join(temporaryDirectory, 'renderer-root');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>wh</title>');
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'export {}');
  await fs.writeFile(path.join(temporaryDirectory, 'secret.txt'), 'outside');

  assert(resolveRendererFile(root, '/') === path.join(root, 'index.html'), '/ is not index.html');
  assert(resolveRendererFile(root, '/../secret.txt') === null, 'traversal resolved');
  assert(resolveRendererFile(root, '/%2e%2e/secret.txt') === null, 'encoded traversal resolved');
  assert(resolveRendererFile(root, '/assets/app.js?v=1') === path.join(root, 'assets', 'app.js'), 'query not stripped');

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const host = `127.0.0.1:${port}`;
  const handler = createRendererRequestHandler(root, host);
  server.on('request', (req, res) => { void handler(req, res); });
  try {
    const index = await request(port, '/', host);
    assert(index.status === 200 && index.body.includes('<title>wh</title>'), `index returned ${index.status}`);
    assert(index.type?.startsWith('text/html'), `index type ${index.type}`);
    const js = await request(port, '/assets/app.js', host);
    assert(js.status === 200 && js.type?.startsWith('text/javascript'), `script returned ${js.status} ${js.type}`);
    const rebound = await request(port, '/', `evil.example:${port}`);
    assert(rebound.status === 421, `foreign Host returned ${rebound.status}`);
    const escape = await request(port, '/..%2fsecret.txt', host);
    assert(escape.status === 403 || escape.status === 404, `escape returned ${escape.status}`);
    const post = await request(port, '/', host, 'POST');
    assert(post.status === 405, `POST returned ${post.status}`);
    const dir = await request(port, '/assets', host);
    assert(dir.status === 404, `directory returned ${dir.status}`);
    const blank = await request(port, '/__wh_blank', host);
    assert(blank.status === 200 && blank.body.includes('<title>wh</title>'), `blank page returned ${blank.status}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  passed.push('packaged renderer server: files under the build only, exact Host, read-only');

  const before = { databases: { WritersHoardDB: { projects: 5, writings: 12 } }, records: 17, localStorageKeys: 2 };
  assert(sameCounts(before, { ...before, databases: { WritersHoardDB: { projects: 5, writings: 12, extra: 0 } } }), 'equal copy rejected');
  assert(!sameCounts(before, { ...before, databases: { WritersHoardDB: { projects: 5, writings: 11 } } }), 'short copy accepted');
  assert(!sameCounts(before, { ...before, databases: {} }), 'missing database accepted');
  assert(!sameCounts(before, { ...before, localStorageKeys: 1 }), 'lost localStorage accepted');
  passed.push('origin migration only accepts a copy with every store count intact');
  return passed;
}