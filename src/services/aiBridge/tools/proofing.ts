import { checkDocument, applySuggestion, type ProofingFinding } from '@/engines/writings/proofing';
import { loadPersonalWords, editPersonalWord } from '@/services/proofing/dictionary';
import { createWritingEditor, writingForEditorial, persistEditorialWriting } from './editorialDocument';
import { BridgeError, requireString, type ToolArgs } from './shared';
export async function whCheckWritingLanguage(args: ToolArgs) {
  const writing = await writingForEditorial(args, false); const editor = createWritingEditor(writing.content);
  try {
    const personalWords = await loadPersonalWords(writing.projectId);
    const report = await checkDocument(editor.state.doc, { language: 'es-ES', personalWords, grammarCheck: args.grammar === false || !window.electronAPI?.proofing ? undefined : text => window.electronAPI!.proofing!.check({ text, language: 'es' }) });
    return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt, language: 'es-ES', findings: report.findings, status: report.status, personalWords };
  } finally { editor.destroy(); }
}
export async function whApplyWritingLanguageSuggestion(args: ToolArgs) {
  const writing = await writingForEditorial(args, true);
  const finding = args.finding as ProofingFinding | undefined;
  if (!finding || typeof finding.original !== 'string' || typeof args.replacement !== 'string') throw new BridgeError('bad-args', 'Indica el hallazgo consultado y una sustitución literal.');
  const editor = createWritingEditor(writing.content);
  try {
    const result = applySuggestion(editor, finding, args.replacement);
    if (!result.ok) throw new BridgeError('conflict', result.reason ?? 'El texto ha cambiado. Compruébalo otra vez.');
    return await persistEditorialWriting(writing, editor, 'applied a manuscript language suggestion');
  } finally { editor.destroy(); }
}
export async function whManageWritingDictionary(args: ToolArgs) {
  const writing = await writingForEditorial(args, true);
  if (args.action !== 'add' && args.action !== 'remove') throw new BridgeError('bad-args', 'La acción debe ser add o remove.');
  const personalWords = await editPersonalWord(requireString(args, 'word'), args.action, writing.projectId);
  return { id: writing.id, projectId: writing.projectId, language: 'es-ES', personalWords, changed: true };
}
export const PROOFING_HANDLERS = { wh_check_writing_language: whCheckWritingLanguage, wh_apply_writing_language_suggestion: whApplyWritingLanguageSuggestion, wh_manage_writing_dictionary: whManageWritingDictionary };
