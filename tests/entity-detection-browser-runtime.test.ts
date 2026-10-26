import { BrowserEntityDetectionRuntime, type EntityWorkerReply, type EntityWorkerRequest } from '../src/services/entityDetection/browserRuntime';
import { ENTITY_ASSETS, ENTITY_MODEL_KEY } from '../src/services/entityDetection/modelManifest';
import { createEntityOfflineCache, entityAssetCacheKey, entityBlobMatches, matchEntityImportFiles, prepareEntityBrowserAssets, readEntityBrowserStatus } from '../src/services/entityDetection/browserAssets';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function rejects(promise: Promise<unknown>, expression: RegExp) {
  try { await promise; } catch (cause) { assert(expression.test(String(cause)), `Wrong rejection: ${String(cause)}`); return; }
  throw Error(`Expected rejection ${expression}`);
}
const pause = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
class SyntheticWorker {
  onmessage: ((event: MessageEvent<EntityWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: EntityWorkerRequest[] = [];
  terminated = 0;
  postMessage(request: EntityWorkerRequest) {
    this.requests.push(request);
    if (request.action === 'dispose') queueMicrotask(() => this.reply({ disposed: true }));
  }
  terminate() { this.terminated++; }
  reply(data: EntityWorkerReply) { this.onmessage?.({ data } as MessageEvent<EntityWorkerReply>); }
}

/** Synthetic worker driver only; these tests do not run a classifier or supply model claims. */
export async function testEntityBrowserRuntimeSynthetic() {
  const workers: SyntheticWorker[] = [], runtimes: BrowserEntityDetectionRuntime[] = [];
  let statusCalls = 0;
  const create = (idleMs = 100000) => {
    const runtime = new BrowserEntityDetectionRuntime({ worker: () => { const worker = new SyntheticWorker(); workers.push(worker); return worker as unknown as Worker; }, status: async () => { statusCalls++; return { state: 'missing', model: ENTITY_MODEL_KEY }; }, idleMs });
    runtimes.push(runtime); return runtime;
  };
  try {
    const runtime = create();
    assert((await runtime.status()).state === 'missing' && !workers.length && statusCalls === 1, 'Readiness created a synthetic worker');
    assert((await runtime.detect('  ')).length === 0 && !workers.length, 'Blank text created work');
    await rejects(runtime.detect(null as unknown as string), /entity_text_invalid/);
    await rejects(runtime.detect('a', { jobId: ' ' }), /entity_job_id_invalid/);

    const a = runtime.detect('owner A', { jobId: 'A' }), aRejected = rejects(a, /entity_operation_cancelled/);
    const b = runtime.detect('owner B', { jobId: 'B' });
    const c = runtime.detect('owner C', { jobId: 'C' }), cRejected = rejects(c, /entity_operation_cancelled/);
    assert(Number(workers.length) === 1 && workers[0].requests.length === 1, 'Jobs ran concurrently in the same worker');
    await rejects(runtime.detect('duplicate', { jobId: 'A' }), /entity_job_id_active/);
    assert((await runtime.cancel('C')).cancelled && !workers[0].terminated, 'Cancelling queued owner killed active sibling');
    const oldReply = workers[0].onmessage;
    assert((await runtime.cancel('A')).cancelled && workers[0].terminated === 1, 'Cancelling active owner did not terminate work');
    await Promise.all([aRejected, cRejected]);
    assert(Number(workers.length) === 2 && workers[1].requests.length === 1 && 'id' in workers[1].requests[0] && workers[1].requests[0].id === 'B', 'Queued sibling was dropped after active cancellation');
    oldReply?.(new MessageEvent<EntityWorkerReply>('message', { data: { id: 'A', result: [] } }));
    workers[1].reply({ id: 'B', result: [] });
    assert((await b).length === 0 && !(await runtime.cancel('A')).cancelled && !(await runtime.cancel('unknown')).cancelled, 'Late/finished/unknown cancellation altered a settled job');

    const d = runtime.detect('failing driver', { jobId: 'D' }), dRejected = rejects(d, /synthetic_worker_failure/);
    const e = runtime.detect('queued retry driver', { jobId: 'E' });
    workers[1].onerror?.({ message: 'synthetic_worker_failure' } as ErrorEvent);
    await dRejected;
    assert(workers[1].terminated === 1 && Number(workers.length) === 3, 'Worker error did not recreate a worker for the queued owner');
    workers[2].reply({ id: 'E', result: [] });
    await e;

    const f = runtime.detect('close active', { jobId: 'F' }), fRejected = rejects(f, /entity_browser_worker_closed/);
    const g = runtime.detect('close queued', { jobId: 'G' }), gRejected = rejects(g, /entity_browser_worker_closed/);
    await runtime.close(); await Promise.all([fRejected, gRejected]);
    assert(workers[2].terminated === 1 && !(await runtime.cancel('G')).cancelled, 'Close leaked pending owners');

    const idle = create(5), h = idle.detect('idle driver', { jobId: 'H' });
    const last = workers.at(-1)!;
    last.reply({ id: 'H', result: [] }); await h; await pause(30);
    assert(last.requests.at(-1)?.action === 'dispose' && last.terminated === 1, 'Idle worker was not disposed and released');
    return ['Synthetic driver: status/blank input create no worker; active/queued/duplicate IDs, cancellation ownership, late replies, errors/retry, close and idle disposal; no inference exercised'];
  } finally { await Promise.all(runtimes.map(runtime => runtime.close())); }
}

class SyntheticCache {
  rows = new Map<string, Response>();
  async match(request: RequestInfo | URL) { return this.rows.get(String(request))?.clone(); }
  async put(request: RequestInfo | URL, response: Response) { this.rows.set(String(request), response.clone()); }
}

/** Tiny synthetic bytes only: integrity and offline-adapter negatives, never positive model readiness. */
export async function testEntityBrowserAssetsSynthetic() {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => { if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); };
  const cache = new SyntheticCache();
  let fetchCalls = 0;
  replace('location', { protocol: 'https:', origin: 'https://synthetic-entity.test', href: 'https://synthetic-entity.test/app/' });
  replace('isSecureContext', true);
  replace('caches', { open: async () => cache });
  replace('fetch', async () => { fetchCalls++; throw Error('SYNTHETIC_NETWORK_MUST_NOT_RUN'); });
  try {
    const bytes = new Blob(['small synthetic integrity fixture']);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    assert(await entityBlobMatches(bytes, { bytes: bytes.size, hash }), 'SHA helper rejected matching synthetic bytes');
    assert(!await entityBlobMatches(new Blob(['Small synthetic integrity fixture']), { bytes: bytes.size, hash }), 'SHA helper accepted equal-length corrupt synthetic bytes');
    assert(!await entityBlobMatches(bytes, { bytes: bytes.size + 1, hash }), 'SHA helper ignored exact size');
    assert((await readEntityBrowserStatus()).state === 'missing' && !fetchCalls, 'Empty Browser cache attempted a download or falsely reported ready');

    const files = ENTITY_ASSETS.map(asset => new File(['deliberately not a model asset'], asset.file.split('/').at(-1)!));
    assert(matchEntityImportFiles(files).size === 4, 'Four exact manifest names were not matched');
    await rejects(Promise.resolve().then(() => matchEntityImportFiles(files.slice(1))), /import_files_missing/);
    await rejects(Promise.resolve().then(() => matchEntityImportFiles([...files, files[0]])), /import_files_invalid/);
    await rejects(Promise.resolve().then(() => matchEntityImportFiles([new File(['x'], 'foreign.onnx'), ...files.slice(1)])), /import_files_invalid/);
    await rejects(prepareEntityBrowserAssets({ download: false, files }), /entity_model_import_corrupt/);
    assert(!cache.rows.size && !fetchCalls, 'Corrupt import wrote an asset or fetched replacement weights');

    const offline = createEntityOfflineCache(cache as unknown as Cache);
    const optional = await offline.fetch('/__writers-entity/optional-missing.json');
    assert(optional.status === 404 && !fetchCalls, 'Offline adapter fetched an optional miss');
    await rejects(offline.put(entityAssetCacheKey(ENTITY_ASSETS[0]), new Response('corrupt synthetic content')), /entity_model_cache_write_invalid/);
    const first = ENTITY_ASSETS[0], key = entityAssetCacheKey(first);
    await cache.put(key, new Response('synthetic adapter payload, not a validated model'));
    assert(await (await offline.fetch(key)).text() === 'synthetic adapter payload, not a validated model' && !fetchCalls, 'Offline adapter failed to resolve its own cache key');
    assert((await readEntityBrowserStatus()).state === 'missing', 'Corrupt cached synthetic bytes became a ready model');
    replace('location', { protocol: 'file:', origin: 'null', href: 'file:///synthetic-test.html' });
    const unsupported = await readEntityBrowserStatus();
    assert(unsupported.state === 'error' && unsupported.detail === 'entity_browser_secure_context_required', 'file:// got an artificial Browser-storage fallback');
    return ['Synthetic bytes: size/SHA matching, missing cache, exact file names/duplicates, corrupt import refusal, cache-only optional404, corruption remains missing and file:// explicit error; no model imported or executed'];
  } finally {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}
