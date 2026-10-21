import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { ENTITY_ASSETS, ENTITY_MODEL, ENTITY_MODEL_KEY } from './models';
import type { EntityDetectionStatus } from '../../src/services/entityDetection/types';

async function valid(file: string, bytes: number, hash: string) {
  try { if ((await stat(file)).size !== bytes) return false; const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex') === hash; } catch { return false; }
}
/** Explicit preparation only. Every later load verifies local assets and never fetches. */
export async function ensureEntityAssets(directory: string, download: boolean, progress: (status: EntityDetectionStatus) => void) {
  const total = ENTITY_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0); let complete = 0, last = -1;
  const report = (loaded: number) => { const percentage = Math.floor((complete + loaded) / total * 100); if (percentage !== last) { last = percentage; progress({ state: 'preparing', model: ENTITY_MODEL_KEY, progress: percentage }); } };
  for (const asset of ENTITY_ASSETS) {
    const file = path.join(directory, asset.file);
    if (!await valid(file, asset.bytes, asset.hash)) {
      if (!download) throw Error('entity_model_assets_missing_or_damaged');
      await mkdir(path.dirname(file), { recursive: true });
      const response = await fetch(`https://huggingface.co/${ENTITY_MODEL.id}/resolve/${ENTITY_MODEL.revision}/${asset.file}`);
      if (!response.ok || !response.body) throw Error(`entity_model_download_${response.status}`);
      const temporary = `${file}.partial`, handle = await open(temporary, 'w'), digest = createHash('sha256'); let length = 0;
      try { for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { await handle.writeFile(chunk); digest.update(chunk); length += chunk.length; report(length); } } finally { await handle.close(); }
      if (length !== asset.bytes || digest.digest('hex') !== asset.hash) throw Error('entity_model_download_incomplete');
      await rename(temporary, file);
    }
    complete += asset.bytes; report(0);
  }
}
