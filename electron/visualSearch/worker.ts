import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AutoModel, AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import { TEXT, VISION, VISUAL_MODEL } from './models';
import { ensureVisualAssets } from './assets';
import type { VisualSearchStatus } from '../../src/services/visualSearch/types';

const directory = String(workerData.directory);
const modelDirectory = path.join(directory, 'models');
env.cacheDir = modelDirectory;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
let textModel: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
let visionModel: Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
let projection: Float32Array;
let loaded = false;
const marker = path.join(directory, 'ready.json');
const projectionPath = path.join(directory, 'dense.safetensors');
const sendStatus = (status: VisualSearchStatus) => parentPort!.postMessage({ status });
const unit = (values: ArrayLike<number>): number[] => {
  const vector = Array.from(values), norm = Math.hypot(...vector);
  if (vector.length !== 512 || !norm || !Number.isFinite(norm) || vector.some(value => !Number.isFinite(value))) throw Error('visual_embedding_invalid');
  return vector.map(value => value / norm);
};
async function atomic(file: string, value: string | Uint8Array) { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.partial`; await writeFile(temporary, value); await rename(temporary, file); }
async function dense(): Promise<Float32Array> {
  const data = await readFile(projectionPath);
  const headerSize = Number(data.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerSize) || headerSize <= 0 || headerSize + 8 >= data.length) throw Error('visual_projection_header');
  const header = JSON.parse(data.subarray(8, 8 + headerSize).toString('utf8'));
  const weight = header['linear.weight'];
  if (weight?.dtype !== 'F32' || String(weight.shape) !== '512,768' || !Array.isArray(weight.data_offsets) || weight.data_offsets[1] - weight.data_offsets[0] !== 512 * 768 * 4) throw Error('visual_projection_shape');
  const bytes = data.subarray(8 + headerSize + weight.data_offsets[0], 8 + headerSize + weight.data_offsets[1]);
  if (bytes.length !== 512 * 768 * 4) throw Error('visual_projection_truncated');
  return Float32Array.from({ length: 512 * 768 }, (_, index) => bytes.readFloatLE(index * 4));
}
async function load(allowDownload: boolean): Promise<void> {
  if (loaded) return;
  await mkdir(directory, { recursive: true });
  await ensureVisualAssets(directory, allowDownload, sendStatus);
  const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1 };
  try {
    projection = await dense();
    // v4 tokenizer metadata discovery does not forward revision/cache options.
    // A concrete pinned cache directory keeps offline discovery entirely local.
    const textSource = path.join(modelDirectory, TEXT.id, TEXT.revision);
    const visionSource = path.join(modelDirectory, VISION.id, VISION.revision);
    tokenizer = await AutoTokenizer.from_pretrained(textSource, { revision: TEXT.revision, local_files_only: true });
    textModel = await AutoModel.from_pretrained(textSource, { revision: TEXT.revision, model_file_name: 'model_quint8_avx2', dtype: 'fp32', device: 'cpu', local_files_only: true, session_options });
    processor = await AutoProcessor.from_pretrained(visionSource, { revision: VISION.revision, local_files_only: true });
    visionModel = await CLIPVisionModelWithProjection.from_pretrained(visionSource, { revision: VISION.revision, dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
    loaded = true;
    // The marker is a completed preparation receipt, never a substitute for loading files.
    await atomic(marker, JSON.stringify({ model: VISUAL_MODEL }));
    sendStatus({ state: 'ready', model: VISUAL_MODEL });
  } finally { env.allowRemoteModels = false; }
}
async function status(): Promise<VisualSearchStatus> {
  try { return { state: JSON.parse(await readFile(marker, 'utf8')).model === VISUAL_MODEL ? 'ready' : 'missing', model: VISUAL_MODEL }; }
  catch { return { state: 'missing', model: VISUAL_MODEL }; }
}
async function run(action: string, value: unknown) {
  if (action === 'status') return status();
  if (action === 'prepare') { await load(true); return status(); }
  await load(false);
  if (action === 'text') {
    if (typeof value !== 'string' || !value.trim()) throw Error('visual_query_missing');
    const inputs = await tokenizer(value, { padding: true, truncation: true, max_length: 128 });
    const output = await textModel(inputs), hidden = output.last_hidden_state;
    if (!hidden || hidden.dims.length !== 3 || hidden.dims[0] !== 1 || hidden.dims[2] !== 768) throw Error(`visual_text_shape:${JSON.stringify(Object.fromEntries(Object.entries(output).map(([key, tensor]) => [key, (tensor as { dims?: unknown }).dims])))}`);
    const mean = new Float64Array(768), mask = inputs.attention_mask.data; let count = 0;
    for (let token = 0; token < hidden.dims[1]; token++) if (Number(mask[token])) { count++; for (let i = 0; i < 768; i++) mean[i] += Number(hidden.data[token * 768 + i]); }
    const result = new Float64Array(512);
    for (let out = 0; out < 512; out++) for (let i = 0; i < 768; i++) result[out] += projection[out * 768 + i] * mean[i] / count;
    return unit(result);
  }
  if (action === 'image') {
    if (!(value instanceof Uint8Array)) throw Error('visual_image_bytes_invalid');
    const hash = createHash('sha256').update(value).digest('hex'), cache = path.join(directory, 'vectors', hash + '.json');
    try { const saved = JSON.parse(await readFile(cache, 'utf8')); if (saved.model === VISUAL_MODEL) return { hash, model: VISUAL_MODEL, vector: unit(saved.vector), cached: true }; } catch { /* Recompute missing, stale or damaged derived data. */ }
    const image = await RawImage.fromBlob(new Blob([Uint8Array.from(value).buffer]));
    const output = await visionModel(await processor(image)), vector = unit(output.image_embeds.data);
    await atomic(cache, JSON.stringify({ model: VISUAL_MODEL, vector }));
    return { hash, model: VISUAL_MODEL, vector, cached: false };
  }
  throw Error('visual_action_unknown');
}
let queue = Promise.resolve();
parentPort!.on('message', ({ id, action, value }) => {
  queue = queue.then(async () => {
    try { parentPort!.postMessage({ id, result: await run(action, value) }); }
    catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  });
});
