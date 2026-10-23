import {manuscriptMetadata} from '../manuscripts';
import {structuralWritingOwner} from '../manuscriptStore';
import type {ManuscriptSourceReceipt} from './sourceTypes';
import { db } from '@/db';
import { bytesFromBase64, base64FromBytes } from '@/services/documents/client';
import { assertWorldEra } from '@/services/worldEras/store';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { inspectManuscriptFile } from './inspect';
import { planManuscriptImport } from './plan';
import { applyManuscriptImport } from './persist';
import { MAX_SOURCE_BYTES, MAX_TOTAL_BYTES, ManuscriptImportError } from '../manuscriptImport';
import type { ImportChoice, ImportSplit } from './types';
const scopeFor = (args: ToolArgs) => ({ projectId: requireString(args, 'projectId'), eraId: optString(args, 'eraId') });
async function scopeChecked(args: ToolArgs) { const scope = scopeFor(args); assertRowInScope(args, scope.projectId); await assertWorldEra(scope); return scope; }
const REFUSALS: Record<string, string> = {
  'scanned-pdf': 'Este PDF es una imagen escaneada: necesita OCR. No se ha importado nada.',
  protected: 'El fichero está protegido (contraseña o DRM) y no se puede leer.',
  'invalid-pdf': 'El fichero no es un PDF legible.',
  'invalid-epub': 'El fichero no es un ePub legible.',
  unsupported: 'Formato no admitido: se leen .docx, .epub, .pdf, .md y .txt.',
  'too-large': 'El archivo supera el límite de importación del manuscrito.',
  'no-text': 'No se ha encontrado texto en el archivo.',
};
/** Most pasted pieces one call may carry; each one becomes a source file. */
export const MAX_PASTED_ITEMS = 200;
async function inspect(args: ToolArgs) {
  const pasted = args.pasted === undefined ? [] : args.pasted;
  if (!Array.isArray(pasted) || pasted.some(row => !row || typeof (row as { text?: unknown }).text !== 'string' || (row as { name?: unknown }).name !== undefined && typeof (row as { name?: unknown }).name !== 'string')) throw new BridgeError('bad-args', 'Texto pegado inválido.');
  if (pasted.length > MAX_PASTED_ITEMS) throw new BridgeError('bad-args', `Demasiados textos pegados (máximo ${MAX_PASTED_ITEMS}).`);
  const given = args.files === undefined ? [] : args.files;
  if (!Array.isArray(given) || !given.length && !pasted.length) throw new BridgeError('bad-args', 'Indica archivos locales o texto pegado.');
  const sources = [], files: File[] = []; let total = 0;
  for (const row of given) { if (!row || typeof row.name !== 'string' || typeof row.dataBase64 !== 'string') throw new BridgeError('bad-args', 'Archivo inválido.'); const bytes = bytesFromBase64(row.dataBase64); total += bytes.length; if (bytes.length > MAX_SOURCE_BYTES || total > MAX_TOTAL_BYTES) throw new BridgeError('bad-args', 'El archivo supera el límite de importación del manuscrito.'); files.push(new File([bytes], row.name)); }
  const used = new Set(files.map(file => file.name));
  for (const [index, row] of (pasted as { name?: string; text: string }[]).entries()) {
    const base = Array.from(row.name ?? '').map(char => (char.charCodeAt(0) < 32 ? '-' : char)).join('').replace(/[\\/:*?"<>|]/g, '-').replace(/\.(?:md|markdown|txt)$/i, '').trim().slice(0, 80) || `pegado${pasted.length > 1 ? `-${index + 1}` : ''}`;
    let name = `${base}.md`, copy = 2; while (used.has(name)) name = `${base}-${copy++}.md`;
    used.add(name);
    const pastedBytes = new TextEncoder().encode(row.text).length;
    total += pastedBytes;
    if (pastedBytes > MAX_SOURCE_BYTES || total > MAX_TOTAL_BYTES) throw new BridgeError('bad-args', 'El archivo supera el límite de importación del manuscrito.');
    files.push(new File([row.text], name, { type: 'text/markdown' }));
  }
  for (const file of files) {
    try { sources.push(await inspectManuscriptFile(file)); }
    catch (error) { if (error instanceof ManuscriptImportError) throw new BridgeError(error.code, `${REFUSALS[error.code] ?? error.message}${error.detail ? ` (${error.detail})` : ` (${file.name})`}`); throw error; }
  }
  return sources;
}
export async function whManuscriptInspect(args: ToolArgs) { const scope = await scopeChecked(args); const sources = await inspect(args); const plan = await planManuscriptImport(sources, args.split as ImportSplit, scope, args.choices as ImportChoice[] | undefined,optString(args,'manuscriptId')??'main'); return { sources: sources.map(({ name, sha256, findings }) => ({ name, sha256, findings })), ...plan, chapters: plan.chapters.map(({ blocks: _blocks, ...chapter }) => { void _blocks; return chapter; }) }; }
export async function whManuscriptApply(args: ToolArgs) { const scope = await scopeChecked(args); await assertEngineEnabled(scope.projectId, 'writings'); return applyManuscriptImport(scope, await inspect(args), args.split as ImportSplit, args.choices as ImportChoice[] ?? [], requireString(args, 'expectedDigest'),optString(args,'manuscriptId')??'main'); }
/** Source bytes stay world-owned; an explicit filter follows their chapter receipts. */
async function sourceReceiptMatches(args:ToolArgs,scope:{projectId:string;eraId?:string}){
 const manuscriptId=optString(args,'manuscriptId');
 if(manuscriptId!==undefined){const project=await db.projects.get(scope.projectId);if(!project)throw new BridgeError('not-found','No existe el mundo.');manuscriptMetadata(project,manuscriptId);}
 const owners=new Map<string,Promise<string|undefined>>();
 return async(receipt:ManuscriptSourceReceipt)=>{
  if(receipt.eraId!==scope.eraId)return false;
  if(manuscriptId===undefined)return true;
  for(const id of receipt.writingIds){let owner=owners.get(id);if(!owner){owner=structuralWritingOwner(scope.projectId,id);owners.set(id,owner);}if(await owner===manuscriptId)return true;}
  return false;
 };
}
export async function whManuscriptSources(args: ToolArgs) {
 const scope=await scopeChecked(args),matches=await sourceReceiptMatches(args,scope),result=[];
 for(const {original:_original,...row} of await db.manuscriptSources.where('projectId').equals(scope.projectId).toArray()){
  void _original;const receipts=[];for(const receipt of row.receipts)if(await matches(receipt))receipts.push(receipt);
  if(receipts.length)result.push({...row,receipts});
 }
 return result;
}
export async function whManuscriptSourceExport(args: ToolArgs) {
 const scope=await scopeChecked(args),matches=await sourceReceiptMatches(args,scope),row=await db.manuscriptSources.get(requireString(args,'sourceId'));
 let matching=false;if(row?.projectId===scope.projectId)for(const receipt of row.receipts)if(await matches(receipt)){matching=true;break;}
 if(!row||!matching)throw new BridgeError('not-found','La fuente no pertenece a este ámbito.');
 return {sourceId:row.id,fileName:row.name,format:row.format,sha256:row.sha256,mimeType:row.original.type||'application/octet-stream',dataBase64:base64FromBytes(new Uint8Array(await row.original.arrayBuffer()))};
}
export const MANUSCRIPT_REVIEW_HANDLERS = { wh_manuscript_import_inspect: whManuscriptInspect, wh_manuscript_import_apply: whManuscriptApply, wh_manuscript_sources: whManuscriptSources, wh_manuscript_source_export: whManuscriptSourceExport };
