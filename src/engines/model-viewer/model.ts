import { getEraProject, updateEraProjectMetadata } from '@/services/worldEras/store';
import { archiveEraMetadata } from '@/services/worldEras/metadata';
import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { updateProject } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import type { Project } from '@/types';
import { assetBytes, modelStoredBytes, sourceFileBytes, validateGlb, MAX_MODEL_BYTES, MAX_PROJECT_MODEL_BYTES, ModelError, type ModelAsset, type ModelSourceFile } from './portable';
export { assetBytes, modelStoredBytes, sourceFileBytes, validateGlb, MAX_MODEL_BYTES, MAX_PROJECT_MODEL_BYTES, ModelError, type ModelAsset, type ModelSourceFile, type ModelErrorCode } from './portable';

export async function modelDataUrl(bytes: ArrayBuffer, mime = 'application/octet-stream'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new ModelError('failed'));
    reader.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

export async function assetFromFile(file: File): Promise<ModelAsset> { return assetFromFiles([file]); }

/** Import one model plus the local buffers, materials and images selected with it. */
export async function assetFromFiles(files: readonly File[]): Promise<ModelAsset> {
  if (!files.length) throw new ModelError('invalid');
  const models = files.filter(file => /\.(glb|gltf|fbx|obj|stl|ply)$/i.test(file.name));
  if (models.length !== 1) throw new ModelError('invalid');
  const file = models[0];
  if (files.reduce((sum, item) => sum + item.size, 0) > MAX_MODEL_BYTES) throw new ModelError('size');
  if (file.size > MAX_MODEL_BYTES) throw new ModelError('size');
  const sourceFormat = file.name.split('.').pop()!.toLowerCase();
  const sourceBytes = await file.arrayBuffer();
  let bytes = sourceBytes;
  let sourceFiles: ModelSourceFile[] | undefined;
  if (sourceFormat !== 'glb') {
    const { convertModelFiles } = await import('./importers');
    sourceFiles = await Promise.all(files.map(async item => ({ name: item.webkitRelativePath || item.name, dataUrl: await modelDataUrl(await item.arrayBuffer(), item.type || 'application/octet-stream'), size: item.size })));
    bytes = await convertModelFiles(file.name, sourceFiles);
  }
  validateGlb(bytes);
  const dataUrl = await modelDataUrl(bytes, 'model/gltf-binary');
  return { id: generateId('model'), name: file.name, dataUrl, size: bytes.byteLength, createdAt: Date.now(), ...(sourceFiles ? { sourceFiles, sourceFormat } : {}) };
}

export async function originalModelDownload(asset: ModelAsset): Promise<{ blob: Blob; name: string }> {
  if (!asset.sourceFiles?.length) return { blob: new Blob([assetBytes(asset)], { type: 'model/gltf-binary' }), name: asset.name };
  modelStoredBytes(asset);
  if (asset.sourceFiles.length === 1) { const file = asset.sourceFiles[0]; return { blob: new Blob([sourceFileBytes(file)]), name: file.name.split('/').pop()! }; }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const file of asset.sourceFiles) { if (zip.file(file.name)) throw new ModelError('invalid'); zip.file(file.name, sourceFileBytes(file)); }
  return { blob: await zip.generateAsync({ type: 'blob' }), name: `${asset.name.replace(/\.[^.]+$/, '')}-source.zip` };
}

export async function addModelAsset(projectId: string, asset: ModelAsset, eraId?: string): Promise<void> {
  if (assetBytes(asset).byteLength !== asset.size) throw new ModelError('invalid');
  // Read the latest project inside the write transaction: two imports cannot
  // overwrite each other or unrelated recent project edits.
  await db.transaction('rw', eraId ? db.tables : [db.projects], async () => {
    const project = await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId));
    if (!project) throw new ModelError('save');
    const assets = project.modelAssets ?? [];
    if (assets.some(model => model.id === asset.id)) throw new ModelError('save');
    if (assets.reduce((size, model) => size + modelStoredBytes(model), modelStoredBytes(asset)) > MAX_PROJECT_MODEL_BYTES) throw new ModelError('capacity');
    await (eraId ? (changes: Partial<Project>) => updateEraProjectMetadata({ projectId, eraId }, changes) : (changes: Partial<Project>) => updateProject(projectId, changes))( { modelAssets: [...assets, asset] });
  });
}

export async function removeModelAsset(projectId: string, id: string, eraId?: string): Promise<void> {
  if (eraId) return archiveEraMetadata({ projectId, eraId }, 'model-viewer', id);
  await archiveMetadataWithMutation('model-viewer',projectId,id,()=>db.transaction('rw', eraId ? db.tables : [db.projects], async () => {
    const project = await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId));
    if (!project) throw new ModelError('save');
    await (eraId ? (changes: Partial<Project>) => updateEraProjectMetadata({ projectId, eraId }, changes) : (changes: Partial<Project>) => updateProject(projectId, changes))( { modelAssets: (project.modelAssets ?? []).filter(asset => asset.id !== id) });
  }));
}

/** Give a stored model a new file name; its bytes and id stay. The extension is kept when the new name has none. */
export async function renameModelAsset(projectId: string, id: string, name: string): Promise<string> {
  await db.transaction('rw', [db.projects], async () => {
    const project = await db.projects.get(projectId);
    const asset = project?.modelAssets?.find(model => model.id === id);
    if (!project || !asset) throw new ModelError('save');
    const typed = name.trim();
    if (!typed) throw new ModelError('invalid');
    const extension = /\.[a-z0-9]{2,5}$/i.exec(asset.name)?.[0] ?? '';
    const next = extension && !/\.[a-z0-9]{2,5}$/i.test(typed) ? `${typed}${extension}` : typed;
    await updateProject(projectId, { modelAssets: (project.modelAssets ?? []).map(model => model.id === id ? { ...model, name: next } : model) });
  });
  return (await db.projects.get(projectId))!.modelAssets!.find(model => model.id === id)!.name;
}
