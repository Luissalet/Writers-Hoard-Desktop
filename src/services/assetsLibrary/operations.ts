// ============================================================================
// Assets library — rename, delete, download and replace, each through the
// engine that owns the kind (never a bare table write). What can be taken back
// goes in the undo journal.
// ============================================================================

import { db } from '@/db';
import type { ImageRecipeRow } from '@/services/aiRuntime/recipe';
import { createInspirationImage, deleteInspirationImage, updateInspirationImage } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { deleteLocalMedia, importLocalMedia, updateLocalMedia } from '@/engines/media/operations';
import { mediaAsset, saveMediaAsset } from '@/engines/media/scope';
import { mediaFilename } from '@/engines/media/types';
import { originalModelDownload, removeModelAsset, renameModelAsset } from '@/engines/model-viewer/model';
import { t } from '@/i18n/useTranslation';
import { recordArchiveUndo, recordUndoable, UndoStaleError } from '@/services/undoJournal';
import type { InspirationImage } from '@/types';
import { dataUrlMime, type LibraryAsset } from './catalog';
import { findAssetUsage, placeNames, type AssetPlace } from './usage';

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

// ---------------------------------------------------------------- download

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };
const safeName = (name: string) => [...name].map(char => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char)).join('').trim() || 'asset';

function dataUrlBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: dataUrlMime(dataUrl) });
}

/** The bytes and a sensible file name for one asset, as stored. */
export async function assetFile(projectId: string, asset: LibraryAsset): Promise<{ blob: Blob; filename: string }> {
  if (asset.kind === 'image') {
    const image = await db.inspirationImages.get(asset.id);
    if (!image || image.projectId !== projectId) throw new Error('missing_asset');
    const source = image.imageDataOriginal || image.imageData;
    const mime = dataUrlMime(source);
    const extension = IMAGE_EXTENSIONS[mime] ?? 'png';
    const name = safeName(asset.name);
    return { blob: dataUrlBlob(source), filename: new RegExp(`\\.${extension}$`, 'i').test(name) ? name : `${name}.${extension}` };
  }
  if (asset.kind === 'model') {
    const model = (await db.projects.get(projectId))?.modelAssets?.find(row => row.id === asset.id);
    if (!model) throw new Error('missing_asset');
    const original = await originalModelDownload(model);
    return { blob: original.blob, filename: safeName(original.name) };
  }
  const row = await mediaAsset(projectId, asset.id);
  if (!row) throw new Error('missing_asset');
  return { blob: row.blob, filename: mediaFilename(row) };
}

/** Hand the file to the browser's download. */
export function saveAssetFile(file: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadAsset(projectId: string, asset: LibraryAsset): Promise<string> {
  const file = await assetFile(projectId, asset);
  saveAssetFile(file);
  return file.filename;
}

// ------------------------------------------------------------------ rename

/** Current stored name of an asset, or null when it is gone. */
async function currentName(projectId: string, asset: LibraryAsset): Promise<string | null> {
  if (asset.kind === 'image') { const row = await db.inspirationImages.get(asset.id); return row ? row.name?.trim() ?? '' : null; }
  if (asset.kind === 'model') return (await db.projects.get(projectId))?.modelAssets?.find(row => row.id === asset.id)?.name ?? null;
  return (await mediaAsset(projectId, asset.id))?.title ?? null;
}

/** Write a name through the owning engine; returns the name as stored. */
async function writeName(projectId: string, asset: LibraryAsset, name: string): Promise<string> {
  if (asset.kind === 'image') {
    await updateInspirationImage(asset.id, { name });
    notifyDataChanged({ source: 'other', table: 'inspirationImages', projectId, entityId: asset.id });
    return name;
  }
  if (asset.kind === 'model') {
    const stored = await renameModelAsset(projectId, asset.id, name);
    notifyDataChanged({ source: 'other', table: 'projects', projectId, entityId: asset.id });
    return stored;
  }
  const row = await mediaAsset(projectId, asset.id);
  if (!row) throw new Error('missing_asset');
  const base = { title: row.title, notes: row.notes, tags: row.tags, linkedEntryIds: row.linkedEntryIds };
  await updateLocalMedia(projectId, asset.id, { ...base, title: name }, base);
  return name;
}

/** Rename one asset in its own store; the previous name can be restored from the undo toast. */
export async function renameAsset(projectId: string, asset: LibraryAsset, name: string): Promise<string> {
  const typed = name.trim();
  if (!typed) throw new Error('name_required');
  const before = await currentName(projectId, asset);
  if (before === null) throw new Error('missing_asset');
  const applied = await writeName(projectId, asset, typed);
  if (applied !== asset.name) {
    recordUndoable({
      projectId, kind: 'rename', label: `${asset.name} → ${applied}`,
      notice: fill(t('assetsLibrary.renamedNotice'), { from: asset.name, to: applied }),
      undo: async () => {
        if ((await currentName(projectId, asset)) !== applied) throw new UndoStaleError();
        // An image that never had a name goes back to having none.
        if (asset.kind === 'image' && before === '') { await updateInspirationImage(asset.id, { name: undefined }); notifyDataChanged({ source: 'undo', table: 'inspirationImages', projectId, entityId: asset.id }); }
        else await writeName(projectId, asset, before);
      },
    });
  }
  return applied;
}

// ------------------------------------------------------------------ delete

export interface DeleteReport {
  deleted: string[];
  /** Assets left alone because something uses them and `force` was not given. */
  refused: Array<{ asset: LibraryAsset; places: AssetPlace[] }>;
  failed: string[];
}

interface Restore { label: string; run: () => Promise<void> }

async function removeOne(projectId: string, asset: LibraryAsset): Promise<Restore | null> {
  if (asset.kind === 'image') {
    const row = await db.inspirationImages.get(asset.id);
    if (!row || row.projectId !== projectId) throw new Error('missing_asset');
    const recipes: ImageRecipeRow[] = await db.imageRecipes.where('imageId').equals(asset.id).toArray();
    await deleteInspirationImage(asset.id);
    notifyDataChanged({ source: 'other', table: 'inspirationImages', projectId, entityId: asset.id });
    return { label: asset.name, run: () => restoreImage(row, recipes, projectId) };
  }
  if (asset.kind === 'model') {
    await removeModelAsset(projectId, asset.id);
    notifyDataChanged({ source: 'other', table: 'projects', projectId, entityId: asset.id });
    return null;
  }
  const row = await mediaAsset(projectId, asset.id);
  if (!row) throw new Error('missing_asset');
  await deleteLocalMedia(projectId, asset.id);
  return {
    label: asset.name,
    run: async () => {
      if (await mediaAsset(projectId, asset.id)) throw new UndoStaleError();
      await saveMediaAsset(projectId, row, null);
      notifyDataChanged({ source: 'undo', table: 'localMediaAssets', projectId, entityId: asset.id });
    },
  };
}

async function restoreImage(row: InspirationImage, recipes: ImageRecipeRow[], projectId: string): Promise<void> {
  if (await db.inspirationImages.get(row.id)) throw new UndoStaleError();
  await db.transaction('rw', [db.inspirationImages, db.imageRecipes], async () => {
    await createInspirationImage(row);
    if (recipes.length) await db.imageRecipes.bulkPut(recipes);
  });
  notifyDataChanged({ source: 'undo', table: 'inspirationImages', projectId, entityId: row.id });
}

/**
 * Delete assets through their engines. Anything something uses is refused
 * unless `force` is set (the person has read the "Se usa en N sitios" warning).
 * Pictures and sounds are journalled for undo; models leave an archive receipt.
 */
export async function deleteAssets(projectId: string, assets: readonly LibraryAsset[], options: { force?: boolean } = {}): Promise<DeleteReport> {
  const report: DeleteReport = { deleted: [], refused: [], failed: [] };
  const restores: Restore[] = [];
  const models: LibraryAsset[] = [];
  const since = Date.now();
  for (const asset of assets) {
    if (!options.force) {
      const places = await findAssetUsage(projectId, asset);
      if (places.length) { report.refused.push({ asset, places }); continue; }
    }
    try {
      const restore = await removeOne(projectId, asset);
      report.deleted.push(asset.id);
      if (restore) restores.push(restore);
      if (asset.kind === 'model') models.push(asset);
    } catch {
      report.failed.push(asset.id);
    }
  }
  if (restores.length) {
    const label = restores.length === 1 ? restores[0].label : fill(t('assetsLibrary.deletedMany'), { count: String(restores.length) });
    recordUndoable({
      projectId, kind: 'asset', label,
      notice: restores.length === 1 ? fill(t('assetsLibrary.deletedOne'), { name: label }) : label,
      undo: async () => { for (const restore of restores) await restore.run(); },
    });
  }
  if (models.length) await recordArchiveUndo({ projectId, sourceIds: models.map(model => model.id), since, title: models[0].name }).catch(() => 0);
  return report;
}

/** The sentence shown before deleting something that is in use. */
export function usageWarning(places: readonly AssetPlace[]): string {
  const names = placeNames(places);
  return fill(t(names.length === 1 ? 'assetsLibrary.usedOne' : 'assetsLibrary.usedMany'), { count: String(places.length), names: names.join(', ') });
}

// ------------------------------------------------------ compressed results

const MEDIA_EXTENSION = /\.(mp3|mp4|m4a|aac|ogg|wav|webm|mov|flac)$/i;

/** Add the compressed bytes as a NEW sound or video next to the original. */
export async function saveCompressedCopy(projectId: string, asset: LibraryAsset, result: { bytes: ArrayBuffer; mime: string; ext: string }): Promise<string> {
  const original = await mediaAsset(projectId, asset.id);
  if (!original) throw new Error('missing_asset');
  const base = original.title.replace(MEDIA_EXTENSION, '');
  const title = `${base} (${t('assetsLibrary.compressedSuffix')}).${result.ext}`;
  const created = await importLocalMedia(projectId, new File([result.bytes], title, { type: result.mime }));
  await updateLocalMedia(projectId, created.id, { title, notes: original.notes, tags: original.tags, linkedEntryIds: original.linkedEntryIds });
  return created.id;
}

/** Swap the bytes of the original for the compressed ones, keeping its id so every place that uses it still works. */
export async function replaceWithCompressed(projectId: string, asset: LibraryAsset, result: { bytes: ArrayBuffer; mime: string; ext: string }): Promise<void> {
  const original = await mediaAsset(projectId, asset.id);
  if (!original) throw new Error('missing_asset');
  const now = Math.max(Date.now(), original.updatedAt + 1);
  const next = { ...original, blob: new Blob([result.bytes], { type: result.mime }), mime: result.mime, size: result.bytes.byteLength, title: MEDIA_EXTENSION.test(original.title) ? original.title.replace(MEDIA_EXTENSION, `.${result.ext}`) : original.title, updatedAt: now };
  await saveMediaAsset(projectId, next, original);
  notifyDataChanged({ source: 'other', table: 'localMediaAssets', projectId, entityId: asset.id });
  recordUndoable({
    projectId, kind: 'asset', label: original.title,
    notice: fill(t('assetsLibrary.replacedNotice'), { name: original.title }),
    undo: async () => {
      const current = await mediaAsset(projectId, asset.id);
      if (!current || current.updatedAt !== now) throw new UndoStaleError();
      await saveMediaAsset(projectId, { ...original, updatedAt: Math.max(Date.now(), now + 1) }, current);
      notifyDataChanged({ source: 'undo', table: 'localMediaAssets', projectId, entityId: asset.id });
    },
  });
}
