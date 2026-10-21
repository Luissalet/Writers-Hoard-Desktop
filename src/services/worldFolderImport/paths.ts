import { bytesFromBase64 } from '@/services/documents/client';
import { sha256Hex } from '@/services/judge/text';
import type { WorldFolderFile } from './types';
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
export async function readFolderSources(files: readonly WorldFolderFile[]): Promise<FolderSource[]> {
  if (!Array.isArray(files)||!files.length) throw Error('world_folder_files_required');
  const entries:{path:string;bytes:Uint8Array<ArrayBuffer>}[]=[];
  for(const file of files){
    if(!file||typeof file.path!=='string'||typeof file.dataBase64!=='string')throw Error('world_folder_file_invalid');
    const path=folderPath(file.path),bytes=Uint8Array.from(bytesFromBase64(file.dataBase64));
    if(/\.zip$/i.test(path)){
      const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(bytes);
      const records=Object.values(zip.files).filter(entry=>!entry.dir);
      const decoded=await Promise.all(records.map(async entry=>({path:folderPath((entry as typeof entry & {unsafeOriginalName?:string}).unsafeOriginalName??entry.name),bytes:Uint8Array.from(await entry.async('uint8array'))})));
      entries.push(...decoded);
    }else entries.push({path,bytes});
  }
  const paths=new Set<string>();
  for(const entry of entries){if(paths.has(entry.path))throw Error(`world_folder_duplicate_path:${entry.path}`);paths.add(entry.path);}
  return Promise.all(entries.map(async entry=>({...entry,sha256:await sha256Hex(entry.bytes)})));
}
