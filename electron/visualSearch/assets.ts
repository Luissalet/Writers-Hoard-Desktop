import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { TEXT, VISION, VISUAL_MODEL } from './models';
import type { VisualSearchStatus } from '../../src/services/visualSearch/types';
const assets = [
  { model: TEXT, file: 'config.json', bytes: 572, hash: 'edc12f518bfc445dedfe8a7c58374ea659525e0b6e67814686bd6cd57f90f8b3' },
  { model: TEXT, file: 'tokenizer_config.json', bytes: 371, hash: '8f66d0ad85be46afc77e0bbf48312cff326ddb9e7290926df96a8228d69a814e' },
  { model: TEXT, file: 'tokenizer.json', bytes: 1961847, hash: '5b4e1a8171c81dfd666ae40265b9530c6e0b3d53923fe8ac493dcc84229adf81' },
  { model: TEXT, file: 'onnx/model_quint8_avx2.onnx', bytes: 135377779, hash: 'fbc8fbeaa5237d96bd1bf430057c70d34de8334a463e933a5faa305f6caeed9c' },
  { model: VISION, file: 'config.json', bytes: 4524, hash: '493ef57ff783e42d1530c91b53469b7fdf8db8a9c1408e86998fcb7899a4f495' },
  { model: VISION, file: 'preprocessor_config.json', bytes: 520, hash: '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f' },
  { model: VISION, file: 'onnx/vision_model_quantized.onnx', bytes: 89117001, hash: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299' },
  { model: TEXT, file: '2_Dense/model.safetensors', local: 'dense.safetensors', bytes: 1572984, hash: 'd12568dc7300970a4d3dbb49068ad16cd89b99840b74b026f8e48071e9414f74' },
];
async function valid(file: string, bytes: number, hash: string) {
  try { if ((await stat(file)).size !== bytes) return false; const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex') === hash; } catch { return false; }
}
/** Explicit preparation downloads only these fixed assets. Inference never fetches. */
export async function ensureVisualAssets(directory: string, download: boolean, progress: (status: VisualSearchStatus) => void) {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0); let complete = 0, last = -1;
  const report = (loaded: number) => { const percentage = Math.floor((complete + loaded) / total * 100); if (percentage !== last) { last = percentage; progress({ state: 'preparing', model: VISUAL_MODEL, progress: percentage }); } };
  for (const asset of assets) {
    const file = path.join(directory, asset.local ?? path.join('models', asset.model.id, asset.model.revision, asset.file));
    if (!await valid(file, asset.bytes, asset.hash)) {
      if (!download) throw Error('visual_model_assets_missing_or_damaged');
      await mkdir(path.dirname(file), { recursive: true });
      const response = await fetch(`https://huggingface.co/${asset.model.id}/resolve/${asset.model.revision}/${asset.file}`);
      if (!response.ok || !response.body) throw Error(`visual_model_download_${response.status}`);
      const temporary = `${file}.partial`, handle = await open(temporary, 'w'), digest = createHash('sha256'); let length = 0;
      try { for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { await handle.writeFile(chunk); digest.update(chunk); length += chunk.length; report(length); } }
      finally { await handle.close(); }
      if (length !== asset.bytes || digest.digest('hex') !== asset.hash) throw Error('visual_model_download_incomplete');
      await rename(temporary, file);
    }
    complete += asset.bytes; report(0);
  }
}
