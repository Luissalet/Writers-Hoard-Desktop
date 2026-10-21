import { assetBytes, type ModelAsset } from './portable';

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!);

/** Only the canonical self-contained GLB travels into a public reader. */
export function readerModel(asset: ModelAsset): ModelAsset {
  const bytes = assetBytes(asset);
  if (bytes.byteLength !== asset.size || typeof asset.name !== 'string' || typeof asset.id !== 'string') throw new Error('invalid_model');
  return { id: asset.id, name: asset.name, size: asset.size, dataUrl: asset.dataUrl, createdAt: asset.createdAt };
}

export function modelReaderMarkup(asset: ModelAsset, locale: 'es'|'en'): string {
  const model = readerModel(asset);
  return `<div data-wh-model-reader="true" data-locale="${locale}"><template data-wh-model-data>${esc(JSON.stringify(model))}</template><div data-model-controls></div><div data-model-surface></div><p data-model-status role="status">${locale === 'es' ? 'Cargando modelo…' : 'Loading model…'}</p></div>`;
}
