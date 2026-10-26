import { ENTITY_MODEL, ENTITY_MODEL_KEY } from './modelManifest';
import { alignEntityTokens, entityChunks, type NerToken } from './alignment';
import { createEntityOfflineCache, ENTITY_WASM_URLS, ENTITY_LOCAL_MODEL_PATH, openEntityBrowserCache, prepareEntityBrowserAssets, readEntityBrowserStatus } from './browserAssets';
import type { EntitySpan } from './types';
import type { EntityWorkerReply, EntityWorkerRequest } from './browserRuntime';

const endpoint = globalThis as unknown as { postMessage(message: EntityWorkerReply): void; onmessage: ((event: MessageEvent<EntityWorkerRequest>) => void) | null; close(): void };
let classifier: Awaited<ReturnType<typeof load>> | undefined;
async function load() {
  if ((await readEntityBrowserStatus()).state !== 'ready') throw Error('entity_model_assets_missing_or_damaged');
  const offline = createEntityOfflineCache(await openEntityBrowserCache());
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = ENTITY_LOCAL_MODEL_PATH;
  env.useFS = false;
  env.useFSCache = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = offline;
  env.fetch = offline.fetch;
  env.useWasmCache = true;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw Error('entity_browser_wasm_unavailable');
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = { ...ENTITY_WASM_URLS };
  return pipeline('token-classification', ENTITY_MODEL.id, { revision: ENTITY_MODEL.revision, device: 'wasm', dtype: 'q8', local_files_only: true });
}
async function detect(text: string): Promise<EntitySpan[]> {
  classifier ??= await load();
  const model = classifier;
  const tokenize = (value: string) => model.tokenizer.tokenize(value, { add_special_tokens: false });
  const found = new Map<string, EntitySpan>();
  for (const chunk of entityChunks(text, value => tokenize(value).length)) {
    const raw = await model(chunk.text, { aggregation_strategy: 'none' }) as NerToken[];
    for (const span of alignEntityTokens(chunk.text, tokenize, raw)) {
      const next = { ...span, from: chunk.from + span.from, to: chunk.from + span.to }, key = `${next.from}:${next.to}:${next.label}`;
      if ((found.get(key)?.score ?? -1) < next.score) found.set(key, next);
    }
  }
  const ranked = [...found.values()].sort((a, b) => b.text.length - a.text.length || b.score - a.score), result: EntitySpan[] = [];
  for (const span of ranked) if (!result.some(other => other.from < span.to && other.to > span.from)) result.push(span);
  return result.sort((a, b) => a.from - b.from);
}
endpoint.onmessage = event => {
  void (async () => {
    const request = event.data;
    if (request.action === 'dispose') { await classifier?.dispose(); endpoint.postMessage({ disposed: true }); endpoint.close(); return; }
    try {
      const result = request.action === 'detect' ? await detect(request.text!) : await prepareEntityBrowserAssets({ download: request.action === 'prepare', files: request.action === 'import' ? request.files : undefined, progress: status => endpoint.postMessage({ id: request.id, status }) });
      endpoint.postMessage({ id: request.id, result });
    } catch (cause) { endpoint.postMessage({ id: request.id, error: cause instanceof Error ? cause.message : String(cause) }); }
  })().catch(cause => {
    // Uncaught disposal errors must still terminate; pending work is owned by
    // the client and no model or document state is written here.
    endpoint.postMessage({ id: '', status: { state: 'error', model: ENTITY_MODEL_KEY, detail: String(cause) } });
    endpoint.close();
  });
};
import { pipeline, env } from '@huggingface/transformers';
