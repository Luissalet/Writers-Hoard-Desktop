// ============================================
// AI bridge — the project's assets library (read only)
// ============================================
// One list over pictures, sounds, videos and 3D models, and the places that
// use one of them. Nothing here writes: deleting goes through the Assets tab,
// where a person reads the "Se usa en N sitios" warning first.

import { db } from '@/db';
import { ASSET_KINDS, ASSET_SORTS, filterAssets, listProjectAssets, type AssetKind, type AssetSort } from '@/services/assetsLibrary/catalog';
import { findAssetUsage } from '@/services/assetsLibrary/usage';
import { usageWarning } from '@/services/assetsLibrary/operations';
import { BridgeError } from './bridgeError';
import { optNumber, optString, requireString, resolveProjectId, type ToolArgs } from './shared';

export async function whListAssets(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const kind = optString(args, 'kind') ?? 'all';
  if (kind !== 'all' && !ASSET_KINDS.includes(kind as AssetKind)) throw new BridgeError('bad-args', `kind is all or one of ${ASSET_KINDS.join(', ')}.`);
  const sort = optString(args, 'sort') ?? 'date-desc';
  if (!ASSET_SORTS.includes(sort as AssetSort)) throw new BridgeError('bad-args', `sort is one of ${ASSET_SORTS.join(', ')}.`);
  const limit = Math.min(500, Math.max(1, Math.floor(optNumber(args, 'limit') ?? 100)));
  const all = await listProjectAssets(projectId, optString(args, 'eraId'));
  const rows = filterAssets(all, { kind: kind as AssetKind | 'all', query: optString(args, 'query'), sort: sort as AssetSort });
  return {
    projectId,
    total: rows.length,
    returned: Math.min(rows.length, limit),
    assets: rows.slice(0, limit).map(asset => ({ id: asset.id, kind: asset.kind, name: asset.name, size: asset.size, createdAt: asset.createdAt, mime: asset.mime, tags: asset.tags })),
  };
}

export async function whAssetUsage(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const assetId = requireString(args, 'assetId');
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const asset = (await listProjectAssets(projectId)).find(row => row.id === assetId);
  if (!asset) throw new BridgeError('not-found', `No picture, sound, video or model "${assetId}" in this project; use wh_list_assets.`);
  const places = await findAssetUsage(projectId, asset);
  return {
    assetId, kind: asset.kind, name: asset.name, usedIn: places.length,
    places: places.map(place => ({ kind: place.kind, id: place.id, name: place.name })),
    ...(places.length ? { warning: usageWarning(places) } : {}),
  };
}
