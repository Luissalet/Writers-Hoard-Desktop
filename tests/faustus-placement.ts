import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveFaustusServer } from '../electron/ai/faustusPlacement';

function serve(routes: Record<string, unknown>): Promise<{ origin: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = routes[req.url || ''];
      res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
    server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }));
  });
}

const spark = await serve({ '/api/health': { status: 'healthy' } });
const placed = (location: string, running = false) => ({ '/api/placement': { location, job: { running }, urls: { faustus: `${spark.origin}/` } } });
const fetchOnlyHub = (_hub: string): typeof fetch => (input, init) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:7000')) return Promise.reject(new Error('refused'));   // nothing on this PC
  return fetch(url, init);
};
try {
  const onSparks = await serve(placed('sparks'));
  const env = { HOARD_HUB_URL: onSparks.origin } as NodeJS.ProcessEnv;
  assert.equal(await resolveFaustusServer(env, fetchOnlyHub(onSparks.origin)), spark.origin);                 // placed on a Spark: follows it
  onSparks.close();

  const onPc = await serve(placed('pc'));
  assert.equal(await resolveFaustusServer({ HOARD_HUB_URL: onPc.origin } as NodeJS.ProcessEnv, fetchOnlyHub(onPc.origin)), 'http://127.0.0.1:7000');
  onPc.close();

  const moving = await serve(placed('sparks', true));
  assert.equal(await resolveFaustusServer({ HOARD_HUB_URL: moving.origin } as NodeJS.ProcessEnv, fetchOnlyHub(moving.origin)), 'http://127.0.0.1:7000');
  moving.close();

  assert.equal(await resolveFaustusServer({ HOARD_HUB_URL: 'http://127.0.0.1:2' } as NodeJS.ProcessEnv, fetchOnlyHub('')), 'http://127.0.0.1:7000');   // silent Hub
  assert.equal(await resolveFaustusServer({ WH_FAUSTUS_URL: 'http://example.test:9/' } as NodeJS.ProcessEnv), 'http://example.test:9');            // pinned wins
  console.log('faustus-placement ok');
} finally { spark.close(); }
