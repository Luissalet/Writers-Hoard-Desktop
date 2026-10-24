import {remapBannerLink} from '@/engines/timeline/bannerStyles';
import { cloneManuscriptWritingSource } from '@/engines/writings/manuscriptReview/portability';
import { remapSourceToolDocument, type SourceToolDocument } from '@/engines/local/documents/types';
import {remapToolDockLayout,type ToolDockValue} from '@/engines/writings/toolDock/types';
import {worldDocumentPrefixes as prefixes} from './documentPrefixes';
import type { Project } from '@/types';
import { projectToolIds, remapWorldMetadata, remapWorldRichContent } from '@/services/worldMetadata';
import { eraAdapters, eraDocumentVersion, validateEraDocument } from './adapters';
import { eraDocumentKinds, type EraDocumentKind, type EraRow, type WorldEraVariant, type WorldEraAsset } from './types';

/** JSON and ZIP use the same recursive binary codec, including retained versions. */
export async function encodeEraValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer()); let raw = '';
    for (let index = 0; index < bytes.length; index += 8192) raw += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { __whEraBlob: 1, mime: value.type, base64: btoa(raw) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeEraValue));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await encodeEraValue(child)])));
  return value;
}
export function decodeEraValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeEraValue);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (object.__whEraBlob === 1 && typeof object.base64 === 'string' && typeof object.mime === 'string') return new Blob([Uint8Array.from(atob(object.base64), char => char.charCodeAt(0))], { type: object.mime });
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, decodeEraValue(child)]));
  }
  return value;
}
export async function decodeEraAssets(value: unknown, projectId: string): Promise<WorldEraAsset[]> {
  const rows = decodeEraValue(value ?? []); if (!Array.isArray(rows)) throw new Error('world_era_assets_invalid');
  const ids = new Set<string>(), hashes = new Set<string>();
  for (const asset of rows as WorldEraAsset[]) {
    if (!asset?.id || asset.projectId !== projectId || ids.has(asset.id) || hashes.has(asset.sha256) || !asset.payload || typeof asset.payload !== 'object' || Array.isArray(asset.payload) || asset.sha256 !== await eraDocumentVersion({ root: { id: 'binary', ...asset.payload }, children: {} })) throw new Error('world_era_asset_invalid');
    ids.add(asset.id); hashes.add(asset.sha256);
  }
  return rows as WorldEraAsset[];
}
export function decodeEraVariants(value: unknown, projectId: string, assets: WorldEraAsset[] = []): WorldEraVariant[] {
  const rows = decodeEraValue(value ?? []);
  if (!Array.isArray(rows)) throw new Error('world_era_variants_invalid');
  const keys = new Set<string>(), ids = new Set<string>();
  for (const row of rows as WorldEraVariant[]) {
    const key = JSON.stringify([row?.eraId, row?.kind, row?.entityId]);
    if (!row || !row.id || ids.has(row.id) || row.projectId !== projectId || !row.eraId || !row.entityId || !eraDocumentKinds.includes(row.kind) || !Number.isSafeInteger(row.revision) || row.revision < 1 || keys.has(key)) throw new Error('world_era_variant_invalid');
    keys.add(key); ids.add(row.id);
    for (const state of [row, ...row.history ?? []]) if (state.document) {
      const assetId = state.document.root.__worldEraAssetId, asset = typeof assetId === 'string' ? assets.find(item => item.id === assetId && item.projectId === projectId) : undefined;
      if (assetId && !asset) throw new Error('world_era_asset_missing');
      validateEraDocument(projectId, row.kind, row.entityId, asset ? { ...state.document, root: { ...state.document.root, ...asset.payload } } : state.document);
    }
  }
  return rows as WorldEraVariant[];
}
const childPrefixes: Record<string, string> = { dialogBlocks: 'block', sceneCasts: 'cast', writingSnapshots: 'wsnap', mapPins: 'pin', worldWaypoints: 'waypoint', boardNodes: 'bnode', boardEdges: 'bedge', boardLayers: 'blayer', boardViews: 'bview', timelineEvents: 'evt', timelineConnections: 'tconn' };
export interface CloneDocumentSource { kind: EraDocumentKind; document?: import('./types').EraDocument; history?: { document?: import('./types').EraDocument }[] }
export type CloneDocumentBase = { scenes?:{id:string}[];generatedWorlds?:{id:string}[];codexEntries?: { id: string }[]; writings?: { id: string }[]; localMediaAssets?: { id: string }[]; worldMaps?: { id: string }[]; boards?: { id: string }[]; timelines?: { id: string }[] };
/** One semantic remapper for Base/era/history roots, children, rich content and asset references. */
export function worldDocumentCloner(sources: CloneDocumentSource[], project: Project, targetProjectId: string, remap: (id: string, prefix: string) => string, base: CloneDocumentBase, assets: WorldEraAsset[] = []) {
  const ids = new Map<string, string>([[project.id, targetProjectId]]);
  const known = (id: string, prefix: string) => { const next = remap(id, prefix); ids.set(id, next); return next; };
  for (const era of project.worldEras ?? []) known(era.id, 'era');
  for (const template of project.codexTemplates ?? []) known(template.id, 'template');
  for (const asset of assets) known(asset.id, 'era-asset');
  const allRoots = (kind: EraDocumentKind): EraRow[] => sources.filter(row => row.kind === kind).flatMap(row => [row.document, ...row.history?.map(state => state.document) ?? []].flatMap(document => document ? [document.root] : []));
  for (const kind of eraDocumentKinds) for (const root of allRoots(kind)) known(root.id, prefixes[kind]);
  for (const [table, prefix] of Object.entries({ codexEntries: 'codex', writings: 'wr', localMediaAssets: 'media', worldMaps: 'map', scenes: 'scene', generatedWorlds: 'world', boards: 'board', timelines: 'tl', notes: 'note' })) for (const row of (base as Record<string, { id: string }[]>)[table] ?? []) known(row.id, prefix);
  for (const [table, prefix] of Object.entries(childPrefixes)) for (const row of (base as Record<string, { id: string }[]>)[table] ?? []) known(row.id, prefix);
  for (const variant of sources) for (const document of [variant.document, ...variant.history?.map(state => state.document) ?? []]) for (const [table, children] of Object.entries(document?.children ?? {})) for (const row of children) known(row.id, childPrefixes[table]);
  const codexIds = new Set([...(base.codexEntries ?? []).map(row => row.id), ...allRoots('codex').map(row => row.id)]), mediaIds = new Set([...(base.localMediaAssets ?? []).map(row => row.id), ...allRoots('media').map(row => row.id)]), writingIds = new Set([...(base.writings ?? []).map(row => row.id), ...allRoots('writings').map(row => row.id)]);
  const projectWithVariants = { ...project };
  for (const kind of eraDocumentKinds) {
    const field = eraAdapters[kind].metadata;
    if (field) {
      const roots = [...(project[field] as EraRow[] | undefined) ?? [], ...allRoots(kind)];
      // This aggregate is a reference catalogue, not several versions of a document.
      Object.assign(projectWithVariants, { [field]: kind === 'local-tool' ? [...new Map(roots.map(row => [row.id, row])).values()] : roots });
    }
  }
  const tools = projectToolIds(projectWithVariants, {writings:[...base.writings??[],...allRoots('writings')],scenes:[...base.scenes??[],...allRoots('dialog-scene')],generatedWorlds:[...base.generatedWorlds??[],...allRoots('worldgen')],worldMaps: [...base.worldMaps ?? [], ...allRoots('maps')], boards: [...base.boards ?? [], ...allRoots('board')], timelines: [...base.timelines ?? [], ...allRoots('timeline')] });
  const referenceFields = new Set(['id', 'projectId', 'eraId', '__worldEraAssetId', '__documentHistoryAsset', 'templateId', 'writingId', 'sourceDraftId', 'sceneId', 'characterId', 'mapId', 'worldId', 'sourceWorldId', 'originWorldId', 'boardId', 'timelineId', 'layerId', 'layerIds', 'memberNodeIds', 'entityId', 'entryId', 'linkedEntryId', 'linkedEntryIds', 'targetId', 'sourceId', 'targetEntityId', 'sourceEntityId', 'sourceEventId', 'targetEventId', 'timelineEventId', 'referenceFields']);
  const rewrite = (value: unknown, key = ''): unknown => {
    if(key==='toolDock')return remapToolDockLayout(value as ToolDockValue,remap);
    if (typeof value === 'string' && key === 'sourceDraftId') return remap(value, 'wsnap');
    if (typeof value === 'string' && key === 'sourceEntityId' && value.includes('::')) { const split = value.indexOf('::'); return `${ids.get(value.slice(0, split)) ?? value.slice(0, split)}${value.slice(split)}`; }
    if (typeof value === 'string') return referenceFields.has(key) ? ids.get(value) ?? value : ['content', 'html', 'body', 'richContent'].includes(key) ? remapWorldRichContent(value, project.id, targetProjectId, remap, codexIds, mediaIds, tools) : value;
    if (value instanceof Blob) return value;
    if (Array.isArray(value)) return value.map(child => rewrite(child, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, child]) => [key === 'positions' ? ids.get(field) ?? field : field, rewrite(child, key === 'referenceFields' ? key : field)]));
    return value;
  };
  return (kind: EraDocumentKind, document: import('./types').EraDocument): import('./types').EraDocument => {
    // Tool-owned JSON is opaque except for its explicit reference codec.
    if (kind === 'local-tool') return { root: remapSourceToolDocument(document.root as unknown as SourceToolDocument, remap) as unknown as EraRow, children: {} };
    const field = eraAdapters[kind].metadata;
    const root = rewrite(field ? (remapWorldMetadata({ ...projectWithVariants, [field]: [document.root] }, remap, codexIds, mediaIds, writingIds, tools)[field] as EraRow[])[0] : document.root) as EraRow;
    if(kind==='writings'&&typeof document.root.manuscriptId==='string')root.manuscriptId=remap(document.root.manuscriptId,'manuscript');
    if (kind === 'writings' && document.root.manuscriptSource) root.manuscriptSource = cloneManuscriptWritingSource(document.root.manuscriptSource as import('@/engines/writings/manuscriptReview/types').ManuscriptWritingSource, remap);
    const children=rewrite(document.children) as Record<string,EraRow[]>;
    if(kind==='timeline'){
      // Preset IDs are local keys, even when their literal equals a document ID.
      if('bannerPresets' in document.root)root.bannerPresets=structuredClone(document.root.bannerPresets);
      if(document.children.timelineEvents)children.timelineEvents=document.children.timelineEvents.map((original,index)=>{
        const copied=children.timelineEvents[index];
        if('bannerPreset' in original)copied.bannerPreset=remapBannerLink(original as unknown as import('@/types').TimelineEvent,remap).bannerPreset;
        return copied;
      });
    }
    return {root,children};
  };
}
/** IDs stay shared between a cloned Base and every era; era-only roots also remap. */
export function cloneEraVariants(variants: WorldEraVariant[], project: Project, targetProjectId: string, remap: (id: string, prefix: string) => string, base: CloneDocumentBase, assets: WorldEraAsset[] = []): WorldEraVariant[] {
  const clone = worldDocumentCloner(variants, project, targetProjectId, remap, base, assets);
  return variants.map(variant => {
    const state = (item: typeof variant | NonNullable<WorldEraVariant['history']>[number]) => ({ ...item, document: item.document ? clone(variant.kind, item.document) : undefined });
    return { ...state(variant), id: remap(variant.id, 'era-variant'), projectId: targetProjectId, eraId: remap(variant.eraId, 'era'), entityId: remap(variant.entityId, prefixes[variant.kind]), history: variant.history?.map(state) } as WorldEraVariant;
  });
}
