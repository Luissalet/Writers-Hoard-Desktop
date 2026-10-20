import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { updateProject } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import type { Project } from '@/types';

export type ModelAsset = NonNullable<Project['modelAssets']>[number];
export const MAX_MODEL_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_MODEL_BYTES = 100 * 1024 * 1024;
export type ModelErrorCode = 'invalid' | 'size' | 'capacity' | 'external' | 'unsupported' | 'webgl' | 'contextLost' | 'failed' | 'save';
export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode) { super(code); this.name = 'ModelError'; this.code = code; }
}

const REQUIRED_EXTENSIONS = new Set([
  'KHR_lights_punctual', 'KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular',
  'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_emissive_strength',
  'KHR_materials_dispersion', 'KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_mesh_gpu_instancing', 'EXT_texture_webp', 'EXT_texture_avif',
]);
const DECODERS = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate before GLTFLoader sees any bytes. No external fetch is permitted. */
export function validateGlb(bytes: ArrayBuffer): Record<string, unknown> {
  if (bytes.byteLength > MAX_MODEL_BYTES) throw new ModelError('size');
  if (bytes.byteLength < 20) throw new ModelError('invalid');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new ModelError('invalid');
  let offset = 12;
  let json: Record<string, unknown> | undefined;
  let binaryLength = 0;
  let sawBinary = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new ModelError('invalid');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength || (!json && type !== 0x4e4f534a)) throw new ModelError('invalid');
    if (type === 0x4e4f534a) {
      if (json || length > 4 * 1024 * 1024) throw new ModelError('invalid');
      try { const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(offset + 8, offset + 8 + length))); if (!record(value)) throw new Error(); json = value; }
      catch { throw new ModelError('invalid'); }
    } else if (type === 0x004e4942) {
      if (sawBinary) throw new ModelError('invalid');
      sawBinary = true; binaryLength = length;
    }
    offset += 8 + length;
  }
  if (!json || !record(json.asset) || json.asset.version !== '2.0') throw new ModelError('invalid');
  const required = json.extensionsRequired ?? [];
  if (!Array.isArray(required) || required.some(extension => typeof extension !== 'string' || !REQUIRED_EXTENSIONS.has(extension))) throw new ModelError('unsupported');
  const used = json.extensionsUsed ?? [];
  if (!Array.isArray(used) || used.some(extension => typeof extension !== 'string' || DECODERS.has(extension))) throw new ModelError('unsupported');
  // Some extension payloads also contain URIs. Walk every object, rather than
  // validating only the top-level images/buffers arrays.
  const stack: unknown[] = [json];
  let visited = 0;
  while (stack.length) {
    const value = stack.pop();
    if (++visited > 200000) throw new ModelError('invalid');
    if (Array.isArray(value)) { for (const child of value) stack.push(child); continue; }
    if (!record(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      if (name === 'uri' && (typeof child !== 'string' || !/^data:(?:application\/octet-stream|image\/(?:png|jpeg|webp|avif));base64,[a-z0-9+/=\s]+$/i.test(child))) throw new ModelError('external');
      else if (child && typeof child === 'object') stack.push(child);
    }
  }
  const buffers = json.buffers ?? [];
  if (!Array.isArray(buffers) || buffers.some(buffer => !record(buffer) || !Number.isSafeInteger(buffer.byteLength) || (buffer.byteLength as number) < 0)) throw new ModelError('invalid');
  if (buffers.some((buffer, i) => !buffer.uri && (i !== 0 || !sawBinary || buffer.byteLength > binaryLength || binaryLength - buffer.byteLength > 3))) throw new ModelError('invalid');
  const images = json.images ?? [];
  if (!Array.isArray(images) || images.some(image => !record(image) || (image.mimeType && !/^image\/(png|jpeg|webp|avif)$/.test(String(image.mimeType))))) throw new ModelError('unsupported');
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  if (!Array.isArray(nodes) || nodes.length > 20000 || !Array.isArray(meshes) || meshes.length > 10000) throw new ModelError('invalid');
  const accessors = json.accessors ?? [];
  if (!Array.isArray(accessors) || accessors.some(accessor => !record(accessor) || !Number.isSafeInteger(accessor.count) || (accessor.count as number) < 0 || (accessor.count as number) > 2000000)) throw new ModelError('invalid');
  // Cycles or extreme depth otherwise recurse inside GLTFLoader before a
  // useful error can be shown. Shared child nodes are still valid.
  const state = new Uint8Array(nodes.length);
  for (let start = 0; start < nodes.length; start++) {
    if (state[start]) continue;
    const pending: Array<[number, number, boolean]> = [[start, 0, false]];
    while (pending.length) {
      const [index, depth, exiting] = pending.pop()!;
      if (exiting) { state[index] = 2; continue; }
      if (state[index] === 1 || depth > 256) throw new ModelError('invalid');
      if (state[index] === 2) continue;
      const node = nodes[index];
      if (!record(node)) throw new ModelError('invalid');
      const children = node.children ?? [];
      if (!Array.isArray(children) || children.some(child => !Number.isSafeInteger(child) || child < 0 || child >= nodes.length)) throw new ModelError('invalid');
      state[index] = 1; pending.push([index, depth, true]);
      for (const child of children) pending.push([child, depth + 1, false]);
    }
  }
  return json;
}

export async function assetFromFile(file: File): Promise<ModelAsset> {
  if (!/\.glb$/i.test(file.name)) throw new ModelError('invalid');
  if (file.size > MAX_MODEL_BYTES) throw new ModelError('size');
  const bytes = await file.arrayBuffer();
  validateGlb(bytes);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new ModelError('failed'));
    reader.readAsDataURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  });
  return { id: generateId('model'), name: file.name, dataUrl, size: bytes.byteLength, createdAt: Date.now() };
}

export function assetBytes(asset: ModelAsset): ArrayBuffer {
  if (asset.dataUrl.length > Math.ceil(MAX_MODEL_BYTES * 4 / 3) + 100) throw new ModelError('size');
  const match = /^data:model\/gltf-binary;base64,([a-z0-9+/=]+)$/i.exec(asset.dataUrl);
  if (!match) throw new ModelError('invalid');
  let binary: string;
  try { binary = atob(match[1]); } catch { throw new ModelError('invalid'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
  validateGlb(bytes);
  return bytes;
}

export async function addModelAsset(projectId: string, asset: ModelAsset): Promise<void> {
  // Read the latest project inside the write transaction: two imports cannot
  // overwrite each other or unrelated recent project edits.
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new ModelError('save');
    const assets = project.modelAssets ?? [];
    if (assets.reduce((size, model) => size + model.size, asset.size) > MAX_PROJECT_MODEL_BYTES) throw new ModelError('capacity');
    await updateProject(projectId, { modelAssets: [...assets, asset] });
  });
}

export async function removeModelAsset(projectId: string, id: string): Promise<void> {
  await archiveMetadataWithMutation('model-viewer',projectId,id,()=>db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new ModelError('save');
    await updateProject(projectId, { modelAssets: (project.modelAssets ?? []).filter(asset => asset.id !== id) });
  }));
}
