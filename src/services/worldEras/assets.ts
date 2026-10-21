import { db } from '@/db';
import { eraDocumentVersion } from './adapters';
import type { EraDocument, EraDocumentKind, EraRow, WorldEraScope } from './types';
const assetField = '__worldEraAssetId';
export function resolveEraDocumentAssetPayload(projectId:string,document:EraDocument,asset:import('./types').WorldEraAsset|undefined):EraDocument{
 const id=document.root[assetField];if(typeof id!=='string')return document;
 if(!asset||asset.id!==id||asset.projectId!==projectId)throw Error('world_era_asset_missing');
 const root={...document.root,...asset.payload};delete root[assetField];return{...document,root};
}
export function eraDocumentAssetId(document:EraDocument):string|undefined{const id=document.root[assetField];return typeof id==='string'?id:undefined;}
/** Mutable document metadata references immutable local bytes across own versions. */
export async function storeEraDocumentAssets(scope: WorldEraScope, kind: EraDocumentKind, document: EraDocument): Promise<EraDocument> {
  const fields = kind === 'media' ? ['blob'] : kind === 'model-viewer' ? ['dataUrl', 'sourceFiles'] : [];
  const payload = Object.fromEntries(fields.filter(field => document.root[field] !== undefined).map(field => [field, document.root[field]]));
  if (!Object.keys(payload).length) return document;
  const sha256 = await eraDocumentVersion({ root: { id: 'binary', ...payload }, children: {} });
  let asset = await db.worldEraAssets.where('[projectId+sha256]').equals([scope.projectId, sha256]).first();
  if (!asset) { asset = { id: crypto.randomUUID(), projectId: scope.projectId, sha256, payload }; await db.worldEraAssets.add(asset); }
  const root: EraRow = { ...document.root, [assetField]: asset.id }; fields.forEach(field => delete root[field]);
  return { ...document, root };
}
export async function resolveEraDocumentAssets(projectId: string, document: EraDocument): Promise<EraDocument> {
  const id = document.root[assetField]; if (typeof id !== 'string') return document;
  return resolveEraDocumentAssetPayload(projectId,document,await db.worldEraAssets.get(id));
}
/** Provisional recording checkpoints may replace their previous bytes. Published history keeps its assets. */
export async function releaseUnreferencedEraAsset(projectId: string, id: unknown): Promise<void> {
  if (typeof id !== 'string') return;
  if (await db.documentHistory.where('assetIds').equals(id).count()) return;
  const variants = await db.worldEraVariants.where('projectId').equals(projectId).toArray();
  if (variants.some(row => [row, ...row.history ?? []].some(state => state.document?.root[assetField] === id))) return;
  const asset = await db.worldEraAssets.get(id); if (asset?.projectId === projectId) await db.worldEraAssets.delete(id);
}
