import type { WorldFolderImportReceipt, WorldFolderReferenceKind } from './types';
export const WORLD_FOLDER_IMPORT_ID_PREFIX = 'world-folder-import';
const kinds = new Set(['codex','writings','tables','timeline','media']);
const formats = new Set(['obsidian','notion','worldanvil','campfire']);
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export function validateWorldFolderImports(value: unknown): asserts value is WorldFolderImportReceipt[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw Error('world_folder_receipts_invalid');
  const ids = new Set<string>();
  for (const row of value) {
    if (!object(row) || row.version !== 1 || !text(row.id) || ids.has(row.id) || !formats.has(String(row.format)) || row.eraId !== undefined && !text(row.eraId) || !Array.isArray(row.files) || !Array.isArray(row.refs)) throw Error('world_folder_receipts_invalid');
    ids.add(row.id);
    const paths = new Set<string>(), refs = new Set<string>();
    for (const file of row.files) {
      if (!object(file) || !text(file.path) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(String(file.sha256))) throw Error('world_folder_receipts_invalid');
      paths.add(file.path);
    }
    for (const ref of row.refs) {
      if (!object(ref) || !kinds.has(String(ref.kind)) || !text(ref.id) || !text(ref.path) || refs.has(`${ref.kind}:${ref.id}`)) throw Error('world_folder_receipts_invalid');
      refs.add(`${ref.kind}:${ref.id}`);
    }
  }
}
export function validateWorldFolderImportsProject(project: { worldFolderImports?: unknown; worldEras?: readonly {id:string}[] }): void {
  validateWorldFolderImports(project.worldFolderImports);
  for(const row of project.worldFolderImports??[])if(row.eraId&&!project.worldEras?.some(era=>era.id===row.eraId))throw Error('world_folder_receipt_era_missing');
}
export function remapWorldFolderImports(value: WorldFolderImportReceipt[] | undefined, remap: (id:string, kind:WorldFolderReferenceKind | 'era' | 'import')=>string): WorldFolderImportReceipt[] | undefined {
  validateWorldFolderImports(value);
  return value?.map(row => ({ ...row, id: remap(row.id,'import'), ...(row.eraId ? {eraId:remap(row.eraId,'era')} : {}), files: row.files.map(file=>({...file})), refs: row.refs.map(ref=>({...ref,id:remap(ref.id,ref.kind)})) }));
}
