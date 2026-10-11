import type { BridgeTool, BridgeToolSchema } from '../schema';
import { CODEX_IMPORT_FORMATS, CodexImportError, type CodexFolderInput, type createCodexFolderImporter } from '../../../engines/genealogy/codexFolderImport.ts';

const schema: BridgeToolSchema = {
  type: 'object', required: ['projectId', 'format', 'files'], additionalProperties: false,
  properties: {
    projectId: { type: 'string', description: 'Project receiving the codex entries.' },
    format: { type: 'string', enum: [...CODEX_IMPORT_FORMATS], description: 'Export format.' },
    files: { type: 'array', items: { type: 'object', required: ['path', 'text'], properties: { path: { type: 'string' }, text: { type: 'string' } } }, description: 'Uploaded Markdown or JSON documents with relative source paths and complete text.' },
  },
};
export const CODEX_FOLDER_IMPORT_TOOLS: BridgeTool[] = [
  { name: 'wh_codex_import_preview', writes: false, schema, description: 'Preview a folder export from Obsidian, Notion, World Anvil or Campfire as codex documents. Preserves Markdown bodies and explicit metadata, reports additions/duplicates/conflicts per source path. Read-only; does not infer family links.' },
  { name: 'wh_codex_import_apply', writes: true, schema, description: 'Import the valid new documents from a folder export into the codex in one atomic transaction. Reimporting identical source paths/text does not duplicate entries; changed sources are conflicts and are never overwritten. Returns applyId for session-only undo.' },
  { name: 'wh_codex_import_undo', writes: true, description: 'Undo one folder import from this session. Removes only the entries it created, atomically, and refuses if any imported entry was edited or deleted later. Receipts expire when the app renderer restarts.', schema: { type: 'object', required: ['projectId', 'applyId'], properties: { projectId: { type: 'string' }, applyId: { type: 'string' } }, additionalProperties: false } },
];

export function createCodexFolderImportHandlers(importer: ReturnType<typeof createCodexFolderImporter>, resolveProject: (args: Record<string, unknown>, writes: boolean) => Promise<string>) {
  function input(args: Record<string, unknown>): CodexFolderInput {
    if (!CODEX_IMPORT_FORMATS.includes(args.format as CodexFolderInput['format']) || !Array.isArray(args.files)) throw new CodexImportError('bad-args', 'Pass format and files:[{path,text}].');
    return { format: args.format as CodexFolderInput['format'], files: args.files as CodexFolderInput['files'] };
  }
  const safely = async (run: () => Promise<unknown>) => {
    try { return await run(); }
    catch (error) {
      if (error instanceof CodexImportError) return { ok: false, code: error.code, error: error.message };
      throw error;
    }
  };
  return {
    wh_codex_import_preview: (args: Record<string, unknown>) => safely(async () => ({ ok: true, preview: await importer.preview(await resolveProject(args, false), input(args)) })),
    wh_codex_import_apply: (args: Record<string, unknown>) => safely(async () => importer.apply(await resolveProject(args, true), input(args))),
    wh_codex_import_undo: (args: Record<string, unknown>) => safely(async () => {
      if (typeof args.applyId !== 'string' || !args.applyId) throw new CodexImportError('bad-args', 'Pass the applyId returned by this session.');
      return importer.undo(await resolveProject(args, true), args.applyId);
    }),
  };
}
