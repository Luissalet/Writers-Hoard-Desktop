import { getEraProject } from '@/services/worldEras/store';
import { BridgeError, optBoolean, optString, requireString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { addModelAsset, assetBytes, assetFromFiles, modelDataUrl, modelStoredBytes, originalModelDownload, removeModelAsset, sourceFileBytes, type ModelAsset } from './model';
import { editModelAnimationPresentation, readModelAnimationPresentation } from './animationActions';
import type { AnimationPresentationAction } from './animationPresentation';
import { WorldEraConflict } from '@/services/worldEras/types';

const metadata = (asset: ModelAsset) => ({ id: asset.id, name: asset.name, format: asset.sourceFormat ?? 'glb', size: asset.size, storedBytes: modelStoredBytes(asset), createdAt: asset.createdAt, sourceFiles: asset.sourceFiles?.map(file => ({ name: file.name, size: file.size })) ?? [] });
async function model(args: ToolArgs): Promise<{ projectId: string; asset: ModelAsset }> {
  const projectId = resolveProjectId(args), id = requireString(args, 'modelId');
  const asset = (await getEraProject({ projectId, eraId: optString(args, 'eraId') }))?.modelAssets?.find(item => item.id === id);
  if (!asset) throw new BridgeError('not-found', 'No model with that ID exists in this project.');
  return { projectId, asset };
}
export const MODEL_HANDLERS = {
  async wh_model_animation_get(args: ToolArgs) {
    const scope = { projectId: resolveProjectId(args), eraId: optString(args, 'eraId') };
    try { return await readModelAnimationPresentation(scope, requireString(args, 'modelId')); }
    catch (error) { if (error instanceof Error && error.message === 'model_animation_missing') throw new BridgeError('not-found', 'Model not found in this project and era.'); throw error; }
  },
  async wh_model_animation_action(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'model-viewer'), scope = { projectId, eraId: optString(args, 'eraId') }, modelId = requireString(args, 'modelId');
    const action = requireString(args, 'action'), expectedVersion = requireString(args, 'expectedVersion');
    let change: AnimationPresentationAction;
    if (action === 'rename' && typeof args.label === 'string' && args.position === undefined && typeof args.index === 'number') change = { action, index: args.index, label: args.label };
    else if (action === 'move' && typeof args.position === 'number' && typeof args.index === 'number' && args.label === undefined) change = { action, index: args.index, position: args.position };
    else if (action === 'reset' && args.index === undefined && args.position === undefined && args.label === undefined) change = { action };
    else throw new BridgeError('bad-args', 'Use rename with index/label, move with index/position, or reset without clip arguments.');
    try {
      const result = await editModelAnimationPresentation(scope, modelId, change, expectedVersion);
      return result.receiptId ? withAudit(result, { projectId, entityId: modelId, kind: 'update', summary: 'Updated animation presentation', before: { __modelAnimationReceipt: result.receiptId } }) : result;
    } catch (error) {
      if (error instanceof WorldEraConflict) throw new BridgeError('conflict', 'Model changed; read its current version before reapplying.');
      if (error instanceof Error && error.message === 'model_animation_missing') throw new BridgeError('not-found', 'Model not found in this project and era.');
      if (error instanceof Error && /^model_animation_.+_invalid$/.test(error.message)) throw new BridgeError('bad-args', 'Invalid clip index, position or presentation.');
      throw error;
    }
  },
  async wh_model_list(args: ToolArgs) {
    const projectId = resolveProjectId(args), project = await getEraProject({ projectId, eraId: optString(args, 'eraId') });
    if (!project) throw new BridgeError('not-found', 'Project not found.');
    return { projectId, models: (project.modelAssets ?? []).map(metadata) };
  },
  async wh_model_get(args: ToolArgs) {
    const { projectId, asset } = await model(args);
    return { projectId, model: optBoolean(args, 'includeData') ? { ...asset, ...metadata(asset), sourceFiles: asset.sourceFiles ?? [] } : metadata(asset) };
  },
  async wh_model_import(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'model-viewer');
    if (!Array.isArray(args.files) || !args.files.length) throw new BridgeError('bad-args', 'files must contain one model and its local resources.');
    const files = args.files.map(value => {
      if (!value || typeof value !== 'object') throw new BridgeError('bad-args', 'Every file needs name and dataUrl.');
      const row = value as Record<string, unknown>;
      const name = requireString(row, 'name'), dataUrl = requireString(row, 'dataUrl');
      let size: number;
      try { size = atob(dataUrl.split(',')[1] ?? '').length; } catch { throw new BridgeError('bad-args', 'Invalid base64 file.'); }
      const source = { name, dataUrl, size };
      const file = new File([sourceFileBytes(source)], name.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: name }); return file;
    });
    const asset = await assetFromFiles(files); await addModelAsset(projectId, asset, optString(args, 'eraId'));
    return withAudit({ projectId, model: metadata(asset) }, { projectId, entityId: asset.id, kind: 'create', summary: `Imported 3D model ${asset.name}` });
  },
  async wh_model_export(args: ToolArgs) {
    const { projectId, asset } = await model(args);
    const format = optString(args, 'format') ?? 'glb';
    if (format !== 'glb' && format !== 'original') throw new BridgeError('bad-args', 'format must be glb or original.');
    const result = format === 'original' ? await originalModelDownload(asset) : { blob: new Blob([assetBytes(asset)], { type: 'model/gltf-binary' }), name: asset.name.replace(/\.[^.]+$/, '') + '.glb' };
    return { projectId, name: result.name, dataUrl: await modelDataUrl(await result.blob.arrayBuffer(), result.blob.type || 'application/octet-stream'), size: result.blob.size };
  },
  async wh_model_remove(args: ToolArgs) {
    await resolveProjectForEngine(args, 'model-viewer');
    const { projectId, asset } = await model(args); await removeModelAsset(projectId, asset.id, optString(args, 'eraId'));
    return withAudit({ projectId, modelId: asset.id, archived: true }, { projectId, entityId: asset.id, kind: 'delete', summary: `Archived 3D model ${asset.name}` });
  },
};
