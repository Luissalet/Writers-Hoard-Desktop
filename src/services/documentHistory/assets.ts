import { db } from '@/db';
import type { WorldEraAsset, EraDocument, EraDocumentKind } from '@/services/worldEras/types';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
export interface HistoryAssetAccess { pending?: Map<string, Promise<string>>; get(id: string): Promise<WorldEraAsset | undefined>; find(projectId: string, hash: string): Promise<WorldEraAsset | undefined>; put(asset: WorldEraAsset): Promise<void> }
export const databaseHistoryAssets: HistoryAssetAccess = { get: id => db.worldEraAssets.get(id), find: (projectId, hash) => db.worldEraAssets.where('[projectId+sha256]').equals([projectId, hash]).first(), put: async row => { await db.worldEraAssets.put(row); } };
const binaryRef = '__documentHistoryAsset';
const pendingAssets = new WeakMap<HistoryAssetAccess, Map<string, Promise<string>>>();
/** Reuse the era asset format for media/models and deduplicate nested image/blob values too. */
export async function encodeHistoryAssets(projectId: string, kind: EraDocumentKind, input: EraDocument, access: HistoryAssetAccess): Promise<{ document: EraDocument; assetIds: string[] }> {
  const ids = new Set<string>();
  const asset = async (payload: Record<string, unknown>) => {
    const sha256 = await eraDocumentVersion({ root: { id: 'binary', ...payload }, children: {} }), token = JSON.stringify([projectId,sha256]);
    const pending = access.pending ?? pendingAssets.get(access) ?? new Map<string,Promise<string>>(); pendingAssets.set(access,pending);
    let operation = pending.get(token); if (!operation) { operation = (async()=>{let found=await access.find(projectId,sha256);if(!found){found={id:crypto.randomUUID(),projectId,sha256,payload};await access.put(found);}return found.id;})();pending.set(token,operation); }
    try { const id=await operation;ids.add(id);return id; } finally { if(pending.get(token)===operation)pending.delete(token); }
  };
  const root = { ...input.root };
  const fields = kind === 'media' ? ['blob'] : kind === 'model-viewer' ? ['dataUrl', 'sourceFiles'] : [];
  const payload = Object.fromEntries(fields.filter(field => root[field] !== undefined).map(field => [field, root[field]]));
  if (Object.keys(payload).length) { const id = await asset(payload); root.__worldEraAssetId = id; for (const field of fields) delete root[field]; }
  const walk = async (value: unknown): Promise<unknown> => {
    if (value instanceof Blob) return { [binaryRef]: await asset({ blob: value }), __documentHistoryAssetField: 'blob' };
    if (typeof value === 'string' && /^data:[^,]*,/i.test(value)) return { [binaryRef]: await asset({ value }) };
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await walk(child)])));
    return value;
  };
  return { document: await walk({ root, children: input.children }) as EraDocument, assetIds: [...ids] };
}
export async function decodeHistoryAssets(projectId: string, input: EraDocument, access: Pick<HistoryAssetAccess, 'get'> = databaseHistoryAssets): Promise<EraDocument> {
  const get = async (id: string) => { const row = await access.get(id); if (!row || row.projectId !== projectId) throw Error('document_history_asset_missing'); return row.payload; };
  const walk = async (value: unknown): Promise<unknown> => {
    if (value instanceof Blob) return value;
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === 'object') { const object = value as Record<string, unknown>; if (typeof object[binaryRef] === 'string') { const field = object.__documentHistoryAssetField ?? 'value'; if (field !== 'value' && field !== 'blob') throw Error('document_history_asset_field_invalid'); return (await get(object[binaryRef]))[field]; } return Object.fromEntries(await Promise.all(Object.entries(object).map(async ([key, child]) => [key, await walk(child)]))); }
    return value;
  };
  let root = { ...input.root }; if (typeof root.__worldEraAssetId === 'string') { root = { ...root, ...await get(root.__worldEraAssetId) }; delete root.__worldEraAssetId; }
  return walk({ root, children: input.children }) as Promise<EraDocument>;
}
