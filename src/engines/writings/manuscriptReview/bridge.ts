import { db } from '@/db';
import { bytesFromBase64, base64FromBytes } from '@/services/documents/client';
import { assertWorldEra } from '@/services/worldEras/store';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { inspectManuscriptFile } from './inspect';
import { planManuscriptImport } from './plan';
import { applyManuscriptImport } from './persist';
import { MAX_SOURCE_BYTES, MAX_TOTAL_BYTES } from '../manuscriptImport';
import type { ImportChoice, ImportSplit } from './types';
const scopeFor = (args: ToolArgs) => ({ projectId: requireString(args, 'projectId'), eraId: optString(args, 'eraId') });
async function scopeChecked(args: ToolArgs) { const scope = scopeFor(args); assertRowInScope(args, scope.projectId); await assertWorldEra(scope); return scope; }
async function inspect(args: ToolArgs) {
  if (!Array.isArray(args.files) || !args.files.length) throw new BridgeError('bad-args', 'Indica archivos locales.');
  const sources = [], files: File[] = []; let total = 0;
  for (const row of args.files) { if (!row || typeof row.name !== 'string' || typeof row.dataBase64 !== 'string') throw new BridgeError('bad-args', 'Archivo inválido.'); const bytes = bytesFromBase64(row.dataBase64); total += bytes.length; if (bytes.length > MAX_SOURCE_BYTES || total > MAX_TOTAL_BYTES) throw new BridgeError('bad-args', 'El archivo supera el límite de importación del manuscrito.'); files.push(new File([bytes], row.name)); }
  for (const file of files) sources.push(await inspectManuscriptFile(file));
  return sources;
}
export async function whManuscriptInspect(args: ToolArgs) { const scope = await scopeChecked(args); const sources = await inspect(args); const plan = await planManuscriptImport(sources, args.split as ImportSplit, scope, args.choices as ImportChoice[] | undefined); return { sources: sources.map(({ name, sha256, findings }) => ({ name, sha256, findings })), ...plan, chapters: plan.chapters.map(({ blocks: _blocks, ...chapter }) => { void _blocks; return chapter; }) }; }
export async function whManuscriptApply(args: ToolArgs) { const scope = await scopeChecked(args); await assertEngineEnabled(scope.projectId, 'writings'); return applyManuscriptImport(scope, await inspect(args), args.split as ImportSplit, args.choices as ImportChoice[] ?? [], requireString(args, 'expectedDigest')); }
export async function whManuscriptSources(args: ToolArgs) { const scope = await scopeChecked(args); return (await db.manuscriptSources.where('projectId').equals(scope.projectId).toArray()).filter(row => row.receipts.some(receipt => receipt.eraId === scope.eraId)).map(({ original: _original, ...row }) => { void _original; return { ...row, receipts: row.receipts.filter(receipt => receipt.eraId === scope.eraId) }; }); }
export async function whManuscriptSourceExport(args: ToolArgs) { const scope = await scopeChecked(args), row = await db.manuscriptSources.get(requireString(args, 'sourceId')); if (!row || row.projectId !== scope.projectId || !row.receipts.some(receipt => receipt.eraId === scope.eraId)) throw new BridgeError('not-found', 'La fuente no pertenece a este ámbito.'); return { sourceId: row.id, fileName: row.name, format: row.format, sha256: row.sha256, mimeType: row.original.type || 'application/octet-stream', dataBase64: base64FromBytes(new Uint8Array(await row.original.arrayBuffer())) }; }
export const MANUSCRIPT_REVIEW_HANDLERS = { wh_manuscript_import_inspect: whManuscriptInspect, wh_manuscript_import_apply: whManuscriptApply, wh_manuscript_sources: whManuscriptSources, wh_manuscript_source_export: whManuscriptSourceExport };
