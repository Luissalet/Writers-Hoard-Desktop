import { bindPropertyFormulas } from '@/engines/codex/properties';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import type { Project } from '@/types';
import { eraDocumentKinds, type WorldEraAsset, type WorldEraVariant } from '@/services/worldEras/types';
import { eraDocumentVersion, validateEraDocument } from '@/services/worldEras/adapters';
import { decodeEraValue, worldDocumentCloner, type CloneDocumentBase } from '@/services/worldEras/portability';
import { decodeHistoryAssets } from './assets';
import type { DocumentHistoryEntry } from './types';
export async function decodeDocumentHistory(value: unknown, projectId: string, assets: WorldEraAsset[]): Promise<DocumentHistoryEntry[]> {
 const rows = decodeEraValue(value ?? []); if (!Array.isArray(rows)) throw Error('document_history_invalid');
 const seen = new Set<string>(), byId = new Map(assets.map(row => [row.id,row]));
 for (const row of rows as DocumentHistoryEntry[]) {
  if (!row?.id || seen.has(row.id) || row.projectId !== projectId || !eraDocumentKinds.includes(row.kind) || !row.entityId || !Number.isFinite(row.createdAt) || !['edit','manual','pre-restore'].includes(row.reason) || typeof row.title !== 'string' || !Array.isArray(row.assetIds) || row.assetIds.some(id => !byId.has(id))) throw Error('document_history_invalid');
  const references=new Set<string>(); const visit=(value:unknown)=>{if(value instanceof Blob)return;if(Array.isArray(value)){value.forEach(visit);return;}if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if((key==='__worldEraAssetId'||key==='__documentHistoryAsset')&&typeof child==='string')references.add(child);else visit(child);}};visit(row.document);
  if(references.size!==new Set(row.assetIds).size || row.assetIds.some(id=>!references.has(id)))throw Error('document_history_asset_references_invalid');
  if(row.codexPropertyDefinitions!==undefined){if(row.kind!=='codex'||!Array.isArray(row.codexPropertyDefinitions))throw Error('document_history_dependencies_invalid');bindPropertyFormulas({...row.document.root,propertyDefinitions:row.codexPropertyDefinitions} as unknown as CodexTemplate);}
  seen.add(row.id); const document = await decodeHistoryAssets(projectId,row.document,{get:async id=>byId.get(id)});
  validateEraDocument(projectId,row.kind,row.entityId,document); if(await eraDocumentVersion(document)!==row.version) throw Error('document_history_version_invalid');
 }
 return rows as DocumentHistoryEntry[];
}
export async function cloneDocumentHistory(rows: DocumentHistoryEntry[], variants: WorldEraVariant[], project: Project, targetProjectId: string, remap: (id:string,prefix:string)=>string, base: CloneDocumentBase, assets: WorldEraAsset[]): Promise<DocumentHistoryEntry[]> {
 const clone = worldDocumentCloner([...variants,...rows],project,targetProjectId,remap,base,assets);
 const targetAssets = new Map(assets.map(row=>[remap(row.id,'era-asset'),{...row,id:remap(row.id,'era-asset'),projectId:targetProjectId}]));
 return Promise.all(rows.map(async row=>{ const document=clone(row.kind,row.document), hydrated=await decodeHistoryAssets(targetProjectId,document,{get:async id=>targetAssets.get(id)});return {...row,id:remap(row.id,'history'),projectId:targetProjectId,entityId:document.root.id,document,assetIds:row.assetIds.map(id=>remap(id,'era-asset')),version:await eraDocumentVersion(hydrated)}; }));
}
