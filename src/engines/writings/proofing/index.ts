import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import type { SpellChecker, SpellWordResult, ProofingFinding, GrammarCheckResponse } from './types';
export * from './types';
export { createSpellChecker } from './spelling';
export interface ProofingOptions {
  language: 'es-ES'; personalWords?: readonly string[]; scope?: { from: number; to: number };
  checker?: SpellChecker; grammarCheck?: (text: string) => Promise<GrammarCheckResponse>;
}
export interface ProofingReport {
  findings: ProofingFinding[]; document: PmNode;
  status: { spelling: 'ready' | 'unavailable'; grammar: 'ready' | 'unavailable' | 'disabled'; message?: string };
}
let sharedChecker: SpellChecker | undefined;
function workerChecker(): SpellChecker {
  if (sharedChecker) return sharedChecker;
  const worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
  let id = 0; const pending = new Map<number, { resolve: (results: SpellWordResult[]) => void; reject: (error: Error) => void }>();
  worker.onmessage = event => { const message = event.data; const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.results); };
  worker.onerror = () => { for (const request of pending.values()) request.reject(new Error('The Spanish spelling worker is unavailable.')); pending.clear(); worker.terminate(); sharedChecker = undefined; };
  sharedChecker = { check: (words, personalWords = []) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.href).href;
    worker.postMessage({ id: requestId, base, words: [...words], personalWords: [...personalWords] });
  }) };
  return sharedChecker;
}
export interface ProofingTextSegment { text: string; from: number }
/** Contiguous visible prose only. Inline atoms and deleted proposals break segments. */
export function proofingTextSegments(doc: PmNode, scope = { from: 0, to: doc.content.size }): ProofingTextSegment[] {
  if (!Number.isInteger(scope.from) || !Number.isInteger(scope.to) || scope.from < 0 || scope.to < scope.from || scope.to > doc.content.size) throw new Error('Invalid proofing scope.');
  const result: ProofingTextSegment[] = [];
  doc.nodesBetween(scope.from, scope.to, (node, pos) => {
    if (!node.isTextblock) return;
    let active: ProofingTextSegment | undefined;
    node.forEach((child, offset) => {
      const from = pos + 1 + offset;
      if (!child.isText || child.marks.some(mark => mark.type.name === 'whRevisionDeletion' || mark.type.name === 'code')) { active = undefined; return; }
      const start = Math.max(from, scope.from); const end = Math.min(from + child.nodeSize, scope.to); if (start >= end) return;
      const text = child.text!.slice(start - from, end - from);
      if (active && active.from + active.text.length === start) active.text += text;
      else { active = { from: start, text }; result.push(active); }
    });
    return false;
  });
  return result;
}
export async function checkDocument(input: Editor | PmNode, options: ProofingOptions): Promise<ProofingReport> {
  const doc = 'state' in input ? input.state.doc : input;
  const report: ProofingReport = { document: doc, findings: [], status: { spelling: 'ready', grammar: options.grammarCheck ? 'ready' : 'disabled' } };
  if (options.language !== 'es-ES') throw new Error('Select the Spanish es-ES dictionary explicitly.');
  const segments = proofingTextSegments(doc, options.scope);
  const tokens: { word: string; from: number; to: number }[] = [];
  for (const segment of segments) {
    const excluded = [...segment.text.matchAll(/(?:https?:\/\/|www\.)\S+|\S+@\S+/giu)].map(match => ({ from: match.index!, to: match.index! + match[0].length }));
    for (const match of segment.text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
      const offset = match.index!; if (excluded.some(range => offset >= range.from && offset < range.to)) continue;
      tokens.push({ word: match[0], from: segment.from + offset, to: segment.from + offset + match[0].length });
    }
  }
  try {
    const checks = await (options.checker ?? workerChecker()).check(tokens.map(token => token.word), options.personalWords);
    checks.forEach((check, index) => { if (!check.correct) { const token = tokens[index]; report.findings.push({ id: `spell:${token.from}:${token.to}`, from: token.from, to: token.to, original: token.word, suggestions: check.suggestions, category: 'spelling', rule: 'HUNSPELL_ES_ES', message: 'La palabra no figura en el diccionario español.' }); } });
  } catch (error) { report.status.spelling = 'unavailable'; report.status.message = error instanceof Error ? error.message : 'Spanish spelling is unavailable.'; }
  if (options.grammarCheck) for (const segment of segments) {
    try {
      const response = await options.grammarCheck(segment.text);
      if (!response.ok) { report.status.grammar = 'unavailable'; report.status.message = response.error ?? 'Local grammar is unavailable.'; break; }
      for (const match of response.matches ?? []) {
        if (!Number.isInteger(match.offset) || !Number.isInteger(match.length) || match.offset < 0 || match.length < 0 || match.offset + match.length > segment.text.length) continue;
        // The pinned Hunspell dictionary owns spelling; LanguageTool owns contextual rules.
        // LanguageTool also labels contextual mas/más and él/el as misspelling.
        // Exclude only its dictionary rule, never contextual diacritics.
        if (/^(?:MORFOLOGIK_RULE|HUNSPELL_RULE)(?:_|$)/.test(match.rule.id)) continue;
        report.findings.push({ id: `grammar:${segment.from + match.offset}:${match.rule.id}`, from: segment.from + match.offset, to: segment.from + match.offset + match.length, original: segment.text.slice(match.offset, match.offset + match.length), suggestions: match.replacements.map(replacement => replacement.value), category: 'grammar', rule: match.rule.id, message: match.message });
      }
    } catch (error) { report.status.grammar = 'unavailable'; report.status.message = error instanceof Error ? error.message : 'Local grammar is unavailable.'; break; }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  report.findings.sort((a, b) => a.from - b.from || a.to - b.to);
  return report;
}
export function applySuggestion(editor: Editor, finding: ProofingFinding, replacement: string, options: { expectedDoc?: PmNode } = {}): { ok: boolean; changed: boolean; reason?: string } {
  const doc = editor.state.doc;
  if (!editor.isEditable) return { ok: false, changed: false, reason: 'The document is read-only.' };
  if (options.expectedDoc && !doc.eq(options.expectedDoc)) return { ok: false, changed: false, reason: 'The document has changed. Check the text again.' };
  if (!Number.isInteger(finding.from) || !Number.isInteger(finding.to) || finding.from < 0 || finding.to < finding.from || finding.to > doc.content.size || doc.textBetween(finding.from, finding.to) !== finding.original) return { ok: false, changed: false, reason: 'The suggested text has changed. Check the text again.' };
  const from = doc.resolve(finding.from); const to = doc.resolve(finding.to);
  if (!from.parent.inlineContent || !from.sameParent(to)) return { ok: false, changed: false, reason: 'The correction must stay within one paragraph.' };
  let unsupported = false;
  doc.nodesBetween(finding.from, finding.to, node => { if (node.isInline && (!node.isText || node.marks.some(mark => mark.type.name === 'whRevisionDeletion'))) unsupported = true; });
  if (unsupported) return { ok: false, changed: false, reason: 'The range contains a note, citation or deleted proposal.' };
  for (const resolved of [from, to]) {
    const before = resolved.nodeBefore?.isText ? resolved.nodeBefore.text!.charCodeAt(resolved.nodeBefore.text!.length - 1) : NaN;
    const after = resolved.nodeAfter?.isText ? resolved.nodeAfter.text!.charCodeAt(0) : NaN;
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return { ok: false, changed: false, reason: 'The range splits a Unicode character.' };
  }
  if (replacement === finding.original) return { ok: true, changed: false };
  // Replace only the differing middle: unchanged characters retain their exact
  // marks, even when a word spans bold, italic, links or revision boundaries.
  let prefix = 0; let suffix = 0;
  while (prefix < finding.original.length && prefix < replacement.length && finding.original[prefix] === replacement[prefix]) prefix++;
  while (suffix < finding.original.length - prefix && suffix < replacement.length - prefix && finding.original[finding.original.length - suffix - 1] === replacement[replacement.length - suffix - 1]) suffix++;
  if (prefix && /[\uD800-\uDBFF]/.test(finding.original[prefix - 1])) prefix--;
  if (suffix && /[\uDC00-\uDFFF]/.test(finding.original[finding.original.length - suffix])) suffix--;
  const changeFrom = finding.from + prefix; const changeTo = finding.to - suffix;
  const start = doc.resolve(changeFrom); const end = doc.resolve(changeTo);
  const marks = start.marksAcross(end) ?? start.marks();
  const inserted = replacement.slice(prefix, replacement.length - suffix);
  const tr = editor.state.tr.replaceWith(changeFrom, changeTo, inserted ? editor.schema.text(inserted, marks) : []);
  // Ordinary text transaction: enabled revision tracking can record this correction.
  editor.view.dispatch(closeHistory(tr)); return { ok: true, changed: true };
}
