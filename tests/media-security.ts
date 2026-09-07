import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MEDIA_AUTH_HEADER,
  createMediaRequestHandler,
  createMediaServerToken,
} from '../electron/media/server';
import {
  MediaDownloadCancelledError,
  MediaDownloadQueue,
} from '../electron/media/downloadQueue';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function listen(
  handler: ReturnType<typeof createMediaRequestHandler>,
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    void handler(req, res).catch((error) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function responseSnapshot(response: Response, body: string): string {
  return `${response.status}\n${[...response.headers.entries()].flat().join('\n')}\n${body}`;
}

export async function runMediaSecurityTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];
  const token = createMediaServerToken();
  const secondToken = createMediaServerToken();
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), 'media token is not 256-bit base64url');
  assert(token !== secondToken, 'media token was reused instead of generated per start');

  const fixture = path.join(temporaryDirectory, 'fake-media.bin');
  const bytes = Buffer.from('deterministic media fixture');
  await fs.writeFile(fixture, bytes);
  const queue = new MediaDownloadQueue();
  let downloadStarts = 0;
  let cleanups = 0;
  let running = 0;
  let maxRunning = 0;
  const handler = createMediaRequestHandler({
    authToken: token,
    isPackaged: false,
    rendererDevOrigin: 'http://localhost:5174',
    queue,
    download: async (_url, _format, signal) => {
      assert(!signal.aborted, 'HTTP download executor started already aborted');
      downloadStarts += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      running -= 1;
      return {
        filePath: fixture,
        filename: 'fixture.bin',
        sizeBytes: bytes.byteLength,
        cleanup: async () => { cleanups += 1; },
      };
    },
  });
  const { server, baseUrl } = await listen(handler);

  try {
    const missing = await fetch(`${baseUrl}/api/health`);
    const missingBody = await missing.text();
    assert(missing.status === 401, `missing token returned ${missing.status}`);
    assert(missing.headers.get('access-control-allow-origin') === null, 'originless request gained CORS');

    const nullOrigin = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'null' } });
    const nullOriginBody = await nullOrigin.text();
    assert(nullOrigin.status === 401, `null origin without token returned ${nullOrigin.status}`);
    assert(nullOrigin.headers.get('access-control-allow-origin') === 'null', 'null-origin denial lacks exact CORS');

    const wrongToken = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const wrong = await fetch(`${baseUrl}/api/health`, {
      headers: { [MEDIA_AUTH_HEADER]: wrongToken },
    });
    const wrongBody = await wrong.text();
    assert(wrong.status === 401, `incorrect token returned ${wrong.status}`);

    const forbidden = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://example.com', [MEDIA_AUTH_HEADER]: token },
    });
    const forbiddenBody = await forbidden.text();
    assert(forbidden.status === 403, `forbidden origin returned ${forbidden.status}`);
    assert(forbidden.headers.get('access-control-allow-origin') === null, 'forbidden origin was reflected');

    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:5174', [MEDIA_AUTH_HEADER]: token },
    });
    const allowedBody = await allowed.text();
    assert(allowed.status === 200, `valid token + exact origin returned ${allowed.status}`);
    assert(
      allowed.headers.get('access-control-allow-origin') === 'http://localhost:5174',
      'exact development origin was not echoed',
    );

    for (const snapshot of [
      responseSnapshot(missing, missingBody),
      responseSnapshot(nullOrigin, nullOriginBody),
      responseSnapshot(wrong, wrongBody),
      responseSnapshot(forbidden, forbiddenBody),
      responseSnapshot(allowed, allowedBody),
    ]) {
      assert(!snapshot.includes(token), 'media token leaked into an HTTP response');
    }
    assert(downloadStarts === 0, 'auth/origin probes launched a download');
    passed.push('media HTTP requires an ephemeral 256-bit token even for absent/null Origin');

    const preflight = await fetch(`${baseUrl}/api/download`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': `${MEDIA_AUTH_HEADER}, Content-Type`,
      },
    });
    assert(preflight.status === 204, `valid preflight returned ${preflight.status}`);
    assert(preflight.headers.get('access-control-allow-methods') === 'POST', 'preflight widened methods');
    assert(
      preflight.headers.get('access-control-allow-headers') === `Content-Type, ${MEDIA_AUTH_HEADER}`,
      'preflight did not return the exact private-header allowlist',
    );
    assert(!responseSnapshot(preflight, '').includes(token), 'preflight leaked the token');

    const widened = await fetch(`${baseUrl}/api/download`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': `${MEDIA_AUTH_HEADER}, Content-Type, X-Extra`,
      },
    });
    assert(widened.status === 403, `preflight with an extra header returned ${widened.status}`);
    assert(downloadStarts === 0, 'preflight executed the download operation');
    passed.push('media CORS preflight is route-exact and never executes an operation');

    const releaseIpc = deferred();
    const ipcStarted = deferred();
    const ipcJob = queue.enqueue(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      ipcStarted.resolve();
      await releaseIpc.promise;
      running -= 1;
      return 'ipc-result';
    });
    await ipcStarted.promise;

    const httpJob = fetch(`${baseUrl}/api/download`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5174',
        'Content-Type': 'application/json',
        [MEDIA_AUTH_HEADER]: token,
      },
      body: JSON.stringify({ url: 'https://example.com/video', format: 'video' }),
    });
    await waitFor(() => queue.pendingCount === 1, 'HTTP job to enter the shared queue');
    assert(downloadStarts === 0, 'HTTP bypassed an active IPC queue slot');
    releaseIpc.resolve();
    assert(await ipcJob === 'ipc-result', 'IPC-labelled queue job did not finish');
    const downloaded = await httpJob;
    assert(downloaded.status === 200, `queued HTTP download returned ${downloaded.status}`);
    assert(Buffer.from(await downloaded.arrayBuffer()).equals(bytes), 'HTTP stream changed fake bytes');
    await waitFor(() => cleanups === 1, 'HTTP fixture cleanup');
    assert(downloadStarts === 1 && maxRunning === 1, 'HTTP and IPC jobs ran concurrently');
    passed.push('HTTP and IPC downloads share one concurrency-one process lane');
  } finally {
    await close(server);
  }

  const cancellationQueue = new MediaDownloadQueue();
  const releaseActive = deferred();
  const activeStarted = deferred();
  const active = cancellationQueue.enqueue(async () => {
    activeStarted.resolve();
    await releaseActive.promise;
  });
  await activeStarted.promise;
  const pendingController = new AbortController();
  let pendingStarted = false;
  const pending = cancellationQueue.enqueue(async () => {
    pendingStarted = true;
  }, pendingController.signal);
  await waitFor(() => cancellationQueue.pendingCount === 1, 'cancellable pending job');
  pendingController.abort();
  let cancellation: unknown;
  try {
    await pending;
  } catch (error) {
    cancellation = error;
  }
  assert(cancellation instanceof MediaDownloadCancelledError, 'pending cancellation lost its typed error');
  assert(!pendingStarted, 'a cancelled pending job invoked its executor');
  releaseActive.resolve();
  await active;

  const recoveryQueue = new MediaDownloadQueue();
  const failure = recoveryQueue.enqueue(async () => { throw new Error('expected failure'); });
  const afterFailure = recoveryQueue.enqueue(async () => 'released');
  await failure.catch(() => undefined);
  assert(await afterFailure === 'released', 'a failed job did not release the next queue slot');
  assert(recoveryQueue.activeCount === 0 && recoveryQueue.pendingCount === 0, 'queue stayed occupied');
  passed.push('pending cancellation never starts work and errors release the next queue slot');

  return passed;
}
