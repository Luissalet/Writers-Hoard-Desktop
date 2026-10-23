import { bytesFromBase64 } from '@/services/documents/client';
import { sha256Hex } from '@/services/judge/text';
import { MAX_MEDIA_BYTES } from '@/engines/media/types';
import { MAX_SOURCE_BYTES } from '@/engines/writings/manuscriptImport';
import { readZipEntryBytes, ZipLimitError, type ZipBudget } from '@/services/zipEntryLimits';
import type { WorldFolderFile } from './types';

/** One entry of an archive may be as big as the biggest file the import accepts; every archive together shares one allowance. */
export const MAX_ZIP_ENTRY_BYTES = Math.max(MAX_SOURCE_BYTES, MAX_MEDIA_BYTES);
export const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 5000;
export interface FolderSource { path: string; bytes: Uint8Array<ArrayBuffer>; sha256: string }
export function folderPath(value: string): string {
  const path = value.replaceAll('\\','/').replace(/^(?:\.\/)+/,'');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(part=>part==='..'||part==='') || Array.from(path).some(char=>char.charCodeAt(0)<32)) throw Error('world_folder_path_invalid');
  return path.split('/').filter(part=>part!=='.').join('/');
}
export function relativeFolderPath(from:string, target:string): string | undefined {
  let decoded:string; try { decoded=decodeURIComponent(target); } catch { return; }
  if (/^[a-z][\w+.-]*:|^\//i.test(decoded)) return;
  const parts=from.split('/').slice(0,-1);
  for (const part of decoded.replaceAll('\\','/').split('/')) { if (!part||part==='.') continue; if(part==='..'){if(!parts.length)return;parts.pop();}else parts.push(part); }
  return parts.join('/');
}
/** Local ZIP intake shares the same manifest as ordinary folder/file input. */
export interface ArchiveSkip { path: string }
export async function readFolderSources(files: readonly WorldFolderFile[], encryptedArchives?: ArchiveSkip[]): Promise<FolderSource[]> {
  if (!Array.isArray(files)||!files.length) throw Error('world_folder_files_required');
  const entries:{path:string;bytes:Uint8Array<ArrayBuffer>}[]=[],budget:ZipBudget={remaining:MAX_ZIP_TOTAL_BYTES};
  for(const file of files){
    if(!file||typeof file.path!=='string'||typeof file.dataBase64!=='string')throw Error('world_folder_file_invalid');
    const path=folderPath(file.path),bytes=Uint8Array.from(bytesFromBase64(file.dataBase64));
    if(/\.zip$/i.test(path)){
      const {default:JSZip}=await import('jszip');
      let zip:Awaited<ReturnType<typeof JSZip.loadAsync>>;
      try{zip=await JSZip.loadAsync(bytes);}catch(error){if(encryptedArchives&&/encrypted/i.test(error instanceof Error?error.message:String(error))){encryptedArchives.push({path});continue;}throw error;}
      const records=Object.values(zip.files).filter(entry=>!entry.dir);
      if(records.length>MAX_ZIP_ENTRIES)throw Error(`world_folder_zip_too_many_entries:${path}`);
      // One entry at a time, each checked against its declared size and counted while it inflates, so a bomb never gets fully expanded.
      for(const entry of records){
        const entryPath=folderPath((entry as typeof entry & {unsafeOriginalName?:string}).unsafeOriginalName??entry.name);
        try{entries.push({path:entryPath,bytes:Uint8Array.from(await readZipEntryBytes(entry,MAX_ZIP_ENTRY_BYTES,budget))});}
        catch(error){if(error instanceof ZipLimitError)throw Error(`world_folder_zip_too_large:${entryPath}`);throw error;}
      }
    }else entries.push({path,bytes});
  }
  const paths=new Set<string>();
  for(const entry of entries){if(paths.has(entry.path))throw Error(`world_folder_duplicate_path:${entry.path}`);paths.add(entry.path);}
  return Promise.all(entries.map(async entry=>({...entry,sha256:await sha256Hex(entry.bytes)})));
}
