import wasmFactorySource from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?raw';
import wasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { ENTITY_ASSETS, ENTITY_MODEL, ENTITY_MODEL_KEY } from './modelManifest';
import type { EntityDetectionStatus } from './types';

export interface EntityBrowserAsset { file: string; bytes: number; hash: string; url: string; source?: string }
export const ENTITY_BROWSER_CACHE = `writers-entity-${ENTITY_MODEL.revision}-ort-1.31.0-dev.20260914-8d85527a0`;
export const ENTITY_LOCAL_MODEL_PATH = `/__writers-entity/${ENTITY_MODEL.revision}/models/`;
const modelAssets: EntityBrowserAsset[] = ENTITY_ASSETS.map(asset => ({ ...asset, url: `https://huggingface.co/${ENTITY_MODEL.id}/resolve/${ENTITY_MODEL.revision}/${asset.file}` }));
const runtimeAssets: EntityBrowserAsset[] = [
  { file: 'runtime/ort.asyncify.mjs', bytes: 53057, hash: '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611', url: `/__writers-entity/${ENTITY_MODEL.revision}/runtime/ort.asyncify.mjs`, source: wasmFactorySource },
  { file: 'runtime/ort.asyncify.wasm', bytes: 26861777, hash: '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082', url: wasmBinaryUrl },
];
export const ENTITY_BROWSER_ASSETS = [...modelAssets, ...runtimeAssets];
export const ENTITY_WASM_URLS = { mjs: runtimeAssets[0].url, wasm: wasmBinaryUrl };

export function assertEntityBrowserStorage(): void {
  if (!['http:', 'https:'].includes(location.protocol) || !globalThis.isSecureContext) throw Error('entity_browser_secure_context_required');
  if (!globalThis.caches || !globalThis.crypto?.subtle) throw Error('entity_browser_cache_unavailable');
}
export function entityAssetCacheKey(asset: Pick<EntityBrowserAsset, 'file'>): string {
  return new URL(`/__writers-entity/${ENTITY_MODEL.revision}/${asset.file}`, location.origin).href;
}
export function entityRequestedAsset(request: string): EntityBrowserAsset | undefined {
  const url = new URL(request, location.href).href;
  return ENTITY_BROWSER_ASSETS.find(asset => url === entityAssetCacheKey(asset) || url === new URL(asset.url, location.href).href || modelAssets.includes(asset) && url === new URL(`${ENTITY_LOCAL_MODEL_PATH}${ENTITY_MODEL.id}/${asset.file}`, location.origin).href);
}
export async function entityBlobMatches(blob: Blob, asset: Pick<EntityBrowserAsset, 'bytes' | 'hash'>): Promise<boolean> {
  if (blob.size !== asset.bytes) return false;
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') === asset.hash;
}
export async function openEntityBrowserCache(): Promise<Cache> {
  assertEntityBrowserStorage();
  return caches.open(ENTITY_BROWSER_CACHE);
}
export async function entityCachedAssetValid(cache: Pick<Cache, 'match'>, asset: EntityBrowserAsset): Promise<boolean> {
  const response = await cache.match(entityAssetCacheKey(asset));
  return Boolean(response?.ok && await entityBlobMatches(await response.blob(), asset));
}
/** A cache marker alone never proves readiness; this does not create a worker. */
export async function readEntityBrowserStatus(): Promise<EntityDetectionStatus> {
  try {
    const cache = await openEntityBrowserCache();
    for (const asset of ENTITY_BROWSER_ASSETS) if (!await entityCachedAssetValid(cache, asset)) return { state: 'missing', model: ENTITY_MODEL_KEY };
    return { state: 'ready', model: ENTITY_MODEL_KEY };
  } catch (cause) {
    return { state: 'error', model: ENTITY_MODEL_KEY, detail: cause instanceof Error ? cause.message : String(cause) };
  }
}
/** Files are structured-cloned into the worker; no base64 or project media row. */
export function matchEntityImportFiles(files: readonly File[]): Map<string, File> {
  const selected = new Map<string, File>();
  for (const file of files) {
    const asset = modelAssets.find(asset => asset.file.split('/').at(-1) === file.name);
    if (!asset || selected.has(asset.file)) throw Error('entity_model_import_files_invalid');
    selected.set(asset.file, file);
  }
  if (selected.size !== modelAssets.length) throw Error('entity_model_import_files_missing');
  return selected;
}
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw Error('entity_operation_cancelled');
}
async function downloadEntityAsset(asset: EntityBrowserAsset, signal: AbortSignal | undefined, progress: (loaded: number) => void): Promise<Blob> {
  // Vite transforms .mjs requests in development even when an imported ?url
  // points at that file. ?raw preserves this installed factory's exact bytes
  // in the app module, then Transformers imports the verified cached factory.
  if (asset.source !== undefined) { const blob = new Blob([asset.source]); progress(blob.size); return blob; }
  const response = await fetch(new URL(asset.url, location.href), { signal });
  if (!response.ok || !response.body) throw Error(`entity_model_download_${response.status}`);
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  try {
    while (true) {
      checkCancelled(signal);
      const next = await reader.read();
      if (next.done) break;
      loaded += next.value.byteLength;
      if (loaded > asset.bytes) throw Error('entity_model_download_incomplete');
      chunks.push(next.value.slice());
      progress(loaded);
    }
    return new Blob(chunks);
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally { reader.releaseLock(); }
}
export async function prepareEntityBrowserAssets(options: { files?: readonly File[]; download: boolean; signal?: AbortSignal; progress?: (status: EntityDetectionStatus) => void }): Promise<EntityDetectionStatus> {
  const cache = await openEntityBrowserCache(), selected = options.files ? matchEntityImportFiles(options.files) : undefined;
  const total = ENTITY_BROWSER_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
  let complete = 0;
  const progress = (loaded = 0) => options.progress?.({ state: 'preparing', model: ENTITY_MODEL_KEY, progress: Math.floor((complete + loaded) / total * 100) });
  for (const asset of ENTITY_BROWSER_ASSETS) {
    checkCancelled(options.signal);
    const imported = selected?.get(asset.file);
    if (imported || !await entityCachedAssetValid(cache, asset)) {
      // Import may acquire the shipped runtime from this application's origin,
      // but never fetches missing model weights as a side effect.
      if (!imported && !options.download && !runtimeAssets.includes(asset)) throw Error('entity_model_assets_missing_or_damaged');
      const blob = imported ?? await downloadEntityAsset(asset, options.signal, loaded => progress(loaded));
      if (!await entityBlobMatches(blob, asset)) throw Error(imported ? 'entity_model_import_corrupt' : 'entity_model_download_incomplete');
      checkCancelled(options.signal);
      await cache.put(entityAssetCacheKey(asset), new Response(blob, { headers: { 'Content-Type': asset.file.endsWith('.mjs') ? 'text/javascript' : asset.file.endsWith('.wasm') ? 'application/wasm' : asset.file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': String(asset.bytes) } }));
    }
    complete += asset.bytes;
    progress();
  }
  checkCancelled(options.signal);
  return { state: 'ready', model: ENTITY_MODEL_KEY };
}
/** No fetch fallback: optional misses return404 to Transformers, required misses fail there. */
export function createEntityOfflineCache(cache: Cache) {
  const match = async (request: string): Promise<Response | undefined> => {
    const asset = entityRequestedAsset(request);
    return asset ? (await cache.match(entityAssetCacheKey(asset))) ?? undefined : undefined;
  };
  return {
    match,
    async put(request: string, response: Response): Promise<void> {
      const asset = entityRequestedAsset(request);
      if (!asset || !await entityBlobMatches(await response.clone().blob(), asset)) throw Error('entity_model_cache_write_invalid');
      await cache.put(entityAssetCacheKey(asset), response);
    },
    async fetch(request: RequestInfo | URL): Promise<Response> {
      const response = await match(request instanceof Request ? request.url : String(request));
      return response ?? new Response(null, { status: 404, statusText: 'Prepared entity asset unavailable' });
    },
  };
}
