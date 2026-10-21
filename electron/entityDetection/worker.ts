import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureEntityAssets } from './assets';
import { ENTITY_MODEL_KEY } from './models';
import { alignEntityTokens, entityChunks, type NerToken } from '../../src/services/entityDetection/alignment';
import type { EntitySpan } from '../../src/services/entityDetection/types';

const directory: string = workerData.directory;
let classifier: Awaited<ReturnType<typeof load>> | undefined;
async function load() {
  await ensureEntityAssets(directory, false, () => {});
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  // Absolute local path avoids metadata discovery against a remote model id.
  return pipeline('token-classification', path.resolve(directory), { device: 'cpu', dtype: 'q8', local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
}
async function detect(text: string): Promise<EntitySpan[]> {
  classifier ??= await load(); const model = classifier;
  const tokenize = (value: string) => model.tokenizer.tokenize(value, { add_special_tokens: false });
  const found = new Map<string, EntitySpan>();
  for (const chunk of entityChunks(text, value => tokenize(value).length)) {
    const raw = await model(chunk.text, { aggregation_strategy: 'none' }) as NerToken[];
    for (const span of alignEntityTokens(chunk.text, tokenize, raw)) {
      const next = { ...span, from: chunk.from + span.from, to: chunk.from + span.to }, key = `${next.from}:${next.to}:${next.label}`;
      if ((found.get(key)?.score ?? -1) < next.score) found.set(key, next);
    }
  }
  // Prefer the full entity when an overlapping chunk classified its tail.
  const ranked = [...found.values()].sort((a, b) => b.text.length - a.text.length || b.score - a.score), result: EntitySpan[] = [];
  for (const span of ranked) if (!result.some(other => other.from < span.to && other.to > span.from)) result.push(span);
  return result.sort((a, b) => a.from - b.from);
}
let queue = Promise.resolve();
parentPort!.on('message', ({ id, action, value }) => {
  queue = queue.then(async () => {
    try {
      let result;
      if (action === 'prepare') {
        await ensureEntityAssets(directory, true, status => parentPort!.postMessage({ status }));
        classifier ??= await load(); await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'ready.json'), JSON.stringify({ model: ENTITY_MODEL_KEY }));
        result = { state: 'ready', model: ENTITY_MODEL_KEY };
      } else if (action === 'detect' && typeof value === 'string') result = await detect(value);
      else throw Error('entity_operation_invalid');
      parentPort!.postMessage({ id, result });
    } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  });
});
