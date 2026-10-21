import type { BridgeTool, BridgeToolSchema } from '../schema';
import { CODEX_IMPORT_FORMATS, CodexImportError, type CodexFolderInput, type createCodexFolderImporter } from '../../../engines/genealogy/codexFolderImport.ts';

const schema: BridgeToolSchema = {
  type: 'object', required: ['projectId', 'format', 'files'], additionalProperties: false,
  properties: {
    projectId: { type: 'string', description: 'Project receiving the codex entries.' },
    eraId: { type: 'string', description: 'Optional named era. The plan, import and undo stay in this context.' },
    format: { type: 'string', enum: [...CODEX_IMPORT_FORMATS], description: 'Export format.' },
    files: { type: 'array', items: { type: 'object', required: ['path', 'text'], properties: { path: { type: 'string' }, text: { type: 'string' } } }, description: 'Uploaded Markdown or JSON documents with relative source paths and complete text.' },
    decisions: { type: 'array', description: 'Optional edited plan from preview. IDs are its stable addition IDs. Omitted rows keep detected values; include:false skips a source. Original source text is retained.', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, include: { type: 'boolean' }, title: { type: 'string' }, type: { type: 'string', enum: ['character','location','item','faction','concept','magic','custom'] }, templateId: { type: 'string' } }, additionalProperties: false } },
  },
};
export const CODEX_FOLDER_IMPORT_TOOLS: BridgeTool[] = [
  { name: 'wh_codex_import_preview', writes: false, schema, description: 'Previsualiza documentos de una carpeta exportada al Códex sin guardar cambios.\nPreview a folder export from Obsidian, Notion, World Anvil or Campfire as codex documents. Preserves Markdown bodies and explicit metadata, reports additions/duplicates/conflicts per source path. Read-only; does not infer family links.' },
  { name: 'wh_codex_import_apply', writes: true, schema, description: 'Importa documentos nuevos al Códex mediante una transacción atómica y permite deshacerlos.\nImport the valid new documents from a folder export into the codex in one atomic transaction. Reimporting identical source paths/text does not duplicate entries; changed sources are conflicts and are never overwritten. Returns applyId for session-only undo.' },
  { name: 'wh_codex_import_undo', writes: true, description: 'Deshace una importación de carpeta de esta sesión conservando las entradas editadas después.\nUndo one folder import from this session. Removes only the entries it created, atomically, and refuses if any imported entry was edited or deleted later. Receipts expire when the app renderer restarts.', schema: { type: 'object', required: ['projectId', 'applyId'], properties: { projectId: { type: 'string' }, eraId: { type: 'string' }, applyId: { type: 'string' } }, additionalProperties: false } },
];

export function createCodexFolderImportHandlers(importer: ReturnType<typeof createCodexFolderImporter> | ((args: Record<string, unknown>) => ReturnType<typeof createCodexFolderImporter>), resolveProject: (args: Record<string, unknown>, writes: boolean) => Promise<string>) {
  const forArgs = (args: Record<string, unknown>) => typeof importer === 'function' ? importer(args) : importer;
  function input(args: Record<string, unknown>): CodexFolderInput {
    if (!CODEX_IMPORT_FORMATS.includes(args.format as CodexFolderInput['format']) || !Array.isArray(args.files)) throw new CodexImportError('bad-args', 'Pass format and files:[{path,text}].');
    if (args.decisions !== undefined && !Array.isArray(args.decisions)) throw new CodexImportError('bad-args', 'decisions must be an array from the import preview.');
    return { format: args.format as CodexFolderInput['format'], files: args.files as CodexFolderInput['files'], decisions: args.decisions as CodexFolderInput['decisions'] };
  }
  const safely = async (run: () => Promise<unknown>) => {
    try { return await run(); }
    catch (error) {
      if (error instanceof CodexImportError) return { ok: false, code: error.code, error: error.message };
      throw error;
    }
  };
  return {
    wh_codex_import_preview: (args: Record<string, unknown>) => safely(async () => ({ ok: true, preview: await forArgs(args).preview(await resolveProject(args, false), input(args)) })),
    wh_codex_import_apply: (args: Record<string, unknown>) => safely(async () => forArgs(args).apply(await resolveProject(args, true), input(args))),
    wh_codex_import_undo: (args: Record<string, unknown>) => safely(async () => {
      const projectId = await resolveProject(args, true);
      if (typeof args.applyId !== 'string' || !args.applyId) throw new CodexImportError('bad-args', 'Pass the applyId returned by this session.');
      return forArgs(args).undo(projectId, args.applyId);
    }),
  };
}
