import { checkDocument, applySuggestion, type ProofingFinding } from '@/engines/writings/proofing';
import { loadPersonalWords, editPersonalWord } from '@/services/proofing/dictionary';
import { createWritingEditor, writingForEditorial, persistEditorialWriting } from './editorialDocument';
import { checkMarkdownDoc, DOC_KINDS, type DocInput, type DocKind } from '@/engines/docCheck';
import { getWritings } from '@/engines/writings/operations';
import { BridgeError, markdownFromHtml, optBoolean, optString, optStringArray, requireString, type ToolArgs } from './shared';
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
export async function whCheckMarkdownDocument(args: ToolArgs) {
  const rawKind = optString(args, 'kind');
  if (rawKind !== undefined && !(DOC_KINDS as readonly string[]).includes(rawKind)) throw new BridgeError('bad-args', `kind debe ser uno de ${DOC_KINDS.filter(kind => kind !== 'generated').join(', ')}.`);
  const kind = rawKind as DocKind | undefined; const disable = optStringArray(args, 'disable');
  if (args.id !== undefined) {
    const writing = await writingForEditorial(args, false); const markdown = markdownFromHtml(writing.content); let others: DocInput[] = [];
    if (optBoolean(args, 'compare') !== false) {
      const earlier = (await getWritings(writing.projectId)).filter(item => item.id !== writing.id && (item.createdAt < writing.createdAt || (item.createdAt === writing.createdAt && item.id < writing.id)));
      others = earlier.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(item => ({ id: item.id, title: item.title, markdown: markdownFromHtml(item.content) }));
    }
    const { ok: passed, ...report } = checkMarkdownDoc({ id: writing.id, title: writing.title, markdown }, { kind, others, disable });
    // `ok` is the dispatcher's success flag; the verdict of the check travels as `passed`.
    return { id: writing.id, projectId: writing.projectId, title: writing.title, updatedAt: writing.updatedAt, comparedWith: others.length, passed, ...report };
  }
  if (typeof args.markdown !== 'string') throw new BridgeError('bad-args', 'Indica id (capítulo) o markdown (texto).');
  const { ok: passed, ...report } = checkMarkdownDoc({ title: optString(args, 'title'), markdown: args.markdown }, { kind, disable });
  return { title: optString(args, 'title') ?? null, comparedWith: 0, passed, ...report };
}
export const PROOFING_HANDLERS = { wh_check_writing_language: whCheckWritingLanguage, wh_check_markdown_document: whCheckMarkdownDocument, wh_apply_writing_language_suggestion: whApplyWritingLanguageSuggestion, wh_manage_writing_dictionary: whManageWritingDictionary };
