import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction, type Command } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { wrapInList, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { BLOCK_KEYS, INLINE_KEYS } from '@/components/editor/advanced/model';
import { normalizeEditorialStyle, normalizeEditorialSection, normalizeEditorialCitation, editorialReferenceNotices, editorialBibliographyText, citationFromReference, type EditorialScope, type EditorialResult, type NamedEditorialStyle, type EditorialSection, type EditorialCitation, type EditorialReference } from '@/components/editor/editorial/model';
export * from '@/components/editor/editorial/model';
export { createEditorialExtensions } from '@/components/editor/editorial/extensions';

export interface EditorialDescription {
  styles: NamedEditorialStyle[];
  sections: (EditorialSection & { position: number })[];
  citations: (EditorialCitation & { from: number; to: number })[];
}
export type EditorialOperation =
  | { kind: 'upsertStyle'; style: NamedEditorialStyle }
  | { kind: 'applyStyle'; id: string; from?: number; to?: number }
  | { kind: 'removeStyle'; id: string }
  | { kind: 'setSection'; section: EditorialSection }
  | { kind: 'insertCitation'; citation: EditorialCitation; range?: EditorialScope }
  | { kind: 'removeCitation'; id: string }
  | { kind: 'refreshReferences'; references: readonly EditorialReference[] }
  | { kind: 'bibliography'; references?: readonly EditorialReference[] }
  | { kind: 'list'; list: { kind: 'ordered' | 'bullet'; start?: number; level?: number }; range?: EditorialScope };
const fail = (reason: string): { result: EditorialResult; transaction: null } => ({ result: { ok: false, changed: false, reason }, transaction: null });
function scopeFor(doc: PmNode, scope?: EditorialScope): EditorialScope | null {
  const result = scope ?? { from: 0, to: doc.content.size };
  return Number.isInteger(result.from) && Number.isInteger(result.to) && result.from >= 0 && result.to >= result.from && result.to <= doc.content.size ? result : null;
}
const contained = (node: PmNode, pos: number, scope: EditorialScope) => pos >= scope.from && pos + node.nodeSize <= scope.to;
function inScope(doc: PmNode, scope: EditorialScope, visit: (node: PmNode, pos: number) => void) {
  doc.nodesBetween(scope.from, scope.to, (node, pos) => { if (contained(node, pos, scope)) visit(node, pos); });
}
export function describeEditorialDocument(doc: PmNode, requested?: EditorialScope): EditorialDescription {
  const scope = scopeFor(doc, requested); const result: EditorialDescription = { styles: [], sections: [], citations: [] };
  if (!scope) return result;
  inScope(doc, scope, (node, pos) => {
    if (node.type.name === 'editorialStyleDefinition') { const style = normalizeEditorialStyle(node.attrs.definition); if (style) result.styles.push(style); }
    if (node.type.name === 'editorialSection') { const section = normalizeEditorialSection(node.attrs.config); if (section) result.sections.push({ ...section, position: pos }); }
    if (node.type.name === 'editorialCitation') { const citation = normalizeEditorialCitation(node.attrs.citation); if (citation) result.citations.push({ ...citation, from: pos, to: pos + node.nodeSize }); }
  });
  return result;
}
export const describeEditorial = (editor: Editor, scope?: EditorialScope) => describeEditorialDocument(editor.state.doc, scope);
export const describeEditorialReferences = (editor: Editor, references: readonly EditorialReference[], scope?: EditorialScope) => editorialReferenceNotices(describeEditorial(editor, scope).citations, references);
function blockInsertion(doc: PmNode, scope: EditorialScope) { const resolved = doc.resolve(scope.from); return resolved.parent.type === doc.type || !resolved.parent.inlineContent; }
function validInlineRange(doc: PmNode, range: EditorialScope, scope: EditorialScope) {
  if (!scopeFor(doc, range) || range.from < scope.from || range.to > scope.to) return false;
  const a = doc.resolve(range.from); const b = doc.resolve(range.to);
  if (!a.parent.inlineContent || !a.sameParent(b)) return false;
  // A ProseMirror position is UTF-16; never split a surrogate pair.
  for (const resolved of [a, b]) {
    const before = resolved.nodeBefore?.isText ? resolved.nodeBefore.text!.charCodeAt(resolved.nodeBefore.text!.length - 1) : NaN;
    const after = resolved.nodeAfter?.isText ? resolved.nodeAfter.text!.charCodeAt(0) : NaN;
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return false;
  }
  return true;
}
function applyStyleToBlock(tr: Transaction, node: PmNode, pos: number, style: NamedEditorialStyle) {
  let type = node.type; const attrs: Record<string, unknown> = { ...node.attrs, editorialStyleId: style.id };
  for (const key of BLOCK_KEYS) if (key in style.format) attrs[key] = style.format[key];
  if (style.headingLevel !== undefined) {
    type = style.headingLevel ? tr.doc.type.schema.nodes.heading : tr.doc.type.schema.nodes.paragraph;
    if (style.headingLevel) attrs.level = style.headingLevel; else delete attrs.level;
  }
  tr.setNodeMarkup(pos, type, attrs, node.marks);
  const from = pos + 1; const to = pos + node.nodeSize - 1;
  for (const key of ['bold', 'italic', 'underline'] as const) if (style[key] !== undefined) {
    const mark = tr.doc.type.schema.marks[key]; if (mark) { if (style[key]) tr.addMark(from, to, mark.create()); else tr.removeMark(from, to, mark); }
  }
  const markType = tr.doc.type.schema.marks.advancedTextStyle;
  const keys = INLINE_KEYS.filter(key => key in style.format);
  if (markType && keys.length) {
    const segments: { from: number; to: number; attrs: Record<string, unknown> }[] = [];
    tr.doc.nodesBetween(from, to, (child, position) => {
      if (!child.isText) return;
      const attrs = { ...child.marks.find(mark => mark.type === markType)?.attrs };
      for (const key of keys) attrs[key] = style.format[key];
      segments.push({ from: position, to: position + child.nodeSize, attrs });
    });
    for (const segment of segments) {
      tr.removeMark(segment.from, segment.to, markType);
      if (INLINE_KEYS.some(key => segment.attrs[key] !== null && segment.attrs[key] !== undefined && segment.attrs[key] !== 'inherit')) tr.addMark(segment.from, segment.to, markType.create(segment.attrs));
    }
  }
}
/** Pure transaction preparation is shared by live editors and headless callers. */
export function prepareEditorialOperation(state: EditorState, operation: EditorialOperation, requested?: EditorialScope): { transaction: Transaction | null; result: EditorialResult } {
  const scope = scopeFor(state.doc, requested); if (!scope) return fail('Invalid document scope.');
  const tr = state.tr; const schema = state.schema;
  if (operation.kind === 'upsertStyle') {
    const style = normalizeEditorialStyle(operation.style); if (!style) return fail('A style requires an id and a name.');
    if (style.headingLevel && !schema.nodes.heading) return fail('Heading styles are unavailable in this document schema.');
    let found = false;
    inScope(tr.doc, scope, (node, pos) => {
      if (node.type.name === 'editorialStyleDefinition' && node.attrs.definition?.id === style.id) { tr.setNodeMarkup(pos, undefined, { definition: style }); found = true; }
      if (['paragraph', 'heading'].includes(node.type.name) && node.attrs.editorialStyleId === style.id) applyStyleToBlock(tr, node, pos, style);
    });
    if (!found) { if (!schema.nodes.editorialStyleDefinition || !blockInsertion(tr.doc, scope)) return fail('Place style definitions at a chapter body boundary.'); tr.insert(scope.from, schema.nodes.editorialStyleDefinition.create({ definition: style })); }
  } else if (operation.kind === 'applyStyle') {
    const style = describeEditorialDocument(tr.doc, scope).styles.find(item => item.id === operation.id); if (!style) return fail('The style is not defined in this chapter.');
    const from = operation.from ?? state.selection.from; const to = operation.to ?? state.selection.to;
    if (!scopeFor(tr.doc, { from, to }) || from < scope.from || to > scope.to) return fail('The selection is outside this chapter.');
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (['paragraph', 'heading'].includes(node.type.name) && contained(node, pos, scope)) applyStyleToBlock(tr, node, pos, style);
    });
  } else if (operation.kind === 'removeStyle') {
    const deletes: { from: number; to: number }[] = [];
    inScope(tr.doc, scope, (node, pos) => {
      if (node.type.name === 'editorialStyleDefinition' && node.attrs.definition?.id === operation.id) deletes.push({ from: pos, to: pos + node.nodeSize });
      if (node.attrs.editorialStyleId === operation.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, editorialStyleId: null });
    });
    for (const range of deletes.reverse()) tr.delete(range.from, range.to);
  } else if (operation.kind === 'setSection') {
    const section = normalizeEditorialSection(operation.section); if (!section) return fail('Page dimensions must be finite and positive, with nonnegative margins leaving a text area.');
    let found = false;
    inScope(tr.doc, scope, (node, pos) => { if (node.type.name === 'editorialSection' && node.attrs.config?.id === section.id) { tr.setNodeMarkup(pos, undefined, { config: section }); found = true; } });
    if (!found) { if (!schema.nodes.editorialSection || !blockInsertion(tr.doc, scope)) return fail('Place the section at a chapter body boundary.'); tr.insert(scope.from, schema.nodes.editorialSection.create({ config: section })); }
  } else if (operation.kind === 'insertCitation') {
    const citation = normalizeEditorialCitation(operation.citation); const range = operation.range ?? { from: state.selection.from, to: state.selection.to };
    if (!citation || !schema.nodes.editorialCitation) return fail('A citation requires an id, a source id and literal display text.');
    if (!validInlineRange(tr.doc, range, scope)) return fail('Select text or an insertion point within one paragraph of this chapter.');
    const marks = state.storedMarks ?? state.doc.resolve(range.from).marks();
    tr.replaceWith(range.from, range.to, schema.nodes.editorialCitation.create({ citation }, null, marks));
  } else if (operation.kind === 'removeCitation') {
    const deletes: { from: number; to: number }[] = [];
    inScope(tr.doc, scope, (node, pos) => { if (node.type.name === 'editorialCitation' && node.attrs.citation?.id === operation.id) deletes.push({ from: pos, to: pos + node.nodeSize }); });
    for (const range of deletes.reverse()) tr.delete(range.from, range.to);
  } else if (operation.kind === 'refreshReferences') {
    const references = new Map(operation.references.map(reference => [reference.id, reference]));
    inScope(tr.doc, scope, (node, pos) => {
      if (node.type.name !== 'editorialCitation') return;
      const citation = normalizeEditorialCitation(node.attrs.citation); const source = citation && references.get(citation.sourceId); if (!citation || !source) return;
      tr.setNodeMarkup(pos, undefined, { citation: citationFromReference(source, citation) }, node.marks);
    });
  } else if (operation.kind === 'bibliography') {
    const citations = describeEditorialDocument(tr.doc, scope).citations;
    const text = editorialBibliographyText(citations, operation.references);
    const sourceIds = [...new Set(citations.map(citation => citation.sourceId))];
    const deletes: { from: number; to: number }[] = [];
    inScope(tr.doc, scope, (node, pos) => { if (node.attrs.editorialBibliography) deletes.push({ from: pos, to: pos + node.nodeSize }); });
    for (const range of deletes.reverse()) tr.delete(range.from, range.to);
    const position = tr.mapping.map(scope.to, -1);
    if (tr.doc.resolve(position).parent.inlineContent) return fail('Place the bibliography at a chapter body boundary.');
    const paragraphs = text.map((entry, index) => schema.nodes.paragraph.create({ editorialBibliography: sourceIds[index] }, entry ? schema.text(entry) : null));
    if (paragraphs.length) tr.insert(position, paragraphs);
  } else if (operation.kind === 'list') {
    const range = operation.range ?? { from: state.selection.from, to: state.selection.to };
    if (!scopeFor(tr.doc, range) || range.from < scope.from || range.to > scope.to) return fail('The selection is outside this chapter.');
    const { start, level } = operation.list;
    if (start !== undefined && !Number.isSafeInteger(start)) return fail('A list start must be a safe integer.');
    if (level !== undefined && (!Number.isSafeInteger(level) || level < 1)) return fail('A list level must be a positive safe integer.');
    const type = operation.list.kind === 'ordered' ? schema.nodes.orderedList : schema.nodes.bulletList; const item = schema.nodes.listItem;
    if (!type || !item) return fail('Lists are unavailable in this document schema.');
    const a = tr.doc.resolve(range.from); const b = tr.doc.resolve(range.to);
    if (!a.parent.inlineContent || !b.parent.inlineContent) return fail('Select list text within this chapter.');
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
    const execute = (command: Command) => {
      const current = EditorState.create({ doc: tr.doc, schema, selection: tr.selection, storedMarks: tr.storedMarks });
      return command(current, next => { for (const step of next.steps) tr.step(step); tr.setSelection(next.selection.getBookmark().resolve(tr.doc)); });
    };
    let listDepth = 0;
    for (let depth = tr.selection.$from.depth; depth > 0; depth--) if (['orderedList', 'bulletList'].includes(tr.selection.$from.node(depth).type.name)) { listDepth = depth; break; }
    if (listDepth) {
      const pos = tr.selection.$from.before(listDepth); const node = tr.doc.nodeAt(pos)!;
      if (!contained(node, pos, scope)) return fail('The enclosing list crosses the chapter scope.');
      if (range.to > pos + node.nodeSize - 1) return fail('Select items within one enclosing list.');
    } else if (!execute(wrapInList(type, type === schema.nodes.orderedList ? { start: 1 } : undefined))) return fail('This selection cannot become a list without changing its structure.');
    if (level !== undefined) {
      const depth = () => { let count = 0; for (let d = tr.selection.$from.depth; d > 0; d--) if (tr.selection.$from.node(d).type === item) count++; return count; };
      while (depth() !== level) if (!execute(depth() < level ? sinkListItem(item) : liftListItem(item))) return fail('A nested list needs a preceding item at the requested level.');
    }
    // Start and kind describe the resulting selected list, not its former parent.
    for (let depth = tr.selection.$from.depth; depth > 0; depth--) {
      const node = tr.selection.$from.node(depth);
      if (!['orderedList', 'bulletList'].includes(node.type.name)) continue;
      tr.setNodeMarkup(tr.selection.$from.before(depth), type, type === schema.nodes.orderedList ? { start: start ?? node.attrs.start ?? 1 } : {});
      break;
    }
    // A range inside a list may change enclosing nodes, but never another chapter.
    let mappedScope = { ...scope };
    for (const step of tr.steps) {
      let safe = true; const map = step.getMap(); map.forEach((from, to) => { if (from < mappedScope.from || to > mappedScope.to) safe = false; });
      if (!safe) return fail('The list operation would cross the chapter scope.');
      mappedScope = { from: map.map(mappedScope.from, -1), to: map.map(mappedScope.to, 1) };
    }
  }
  const changed = !state.doc.eq(tr.doc);
  if (!changed) return { transaction: null, result: { ok: true, changed: false } };
  // Prevent revision tracking from treating metadata, bibliography or style edits as typing.
  tr.setMeta('whRevisionOperation', true);
  return { transaction: closeHistory(tr), result: { ok: true, changed: true } };
}
export function executeEditorialOperation(editor: Editor, operation: EditorialOperation, scope?: EditorialScope): EditorialResult {
  if (!editor.isEditable) return { ok: false, changed: false, reason: 'The document is read-only.' };
  const prepared = prepareEditorialOperation(editor.state, operation, scope);
  if (prepared.transaction) editor.view.dispatch(prepared.transaction);
  return prepared.result;
}
export const upsertEditorialStyle = (editor: Editor, style: NamedEditorialStyle, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'upsertStyle', style }, scope);
export const applyEditorialStyle = (editor: Editor, input: { id: string; from?: number; to?: number }, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'applyStyle', ...input }, scope);
export const removeEditorialStyle = (editor: Editor, id: string, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'removeStyle', id }, scope);
export const setEditorialSection = (editor: Editor, section: EditorialSection, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'setSection', section }, scope);
export const insertEditorialCitation = (editor: Editor, citation: EditorialCitation, range?: EditorialScope, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'insertCitation', citation, range }, scope);
export const removeEditorialCitation = (editor: Editor, id: string, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'removeCitation', id }, scope);
export const refreshEditorialReferences = (editor: Editor, references: readonly EditorialReference[], scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'refreshReferences', references }, scope);
export const generateEditorialBibliography = (editor: Editor, references?: readonly EditorialReference[], scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'bibliography', references }, scope);
export const configureEditorialList = (editor: Editor, list: { kind: 'ordered' | 'bullet'; start?: number; level?: number }, range?: EditorialScope, scope?: EditorialScope) => executeEditorialOperation(editor, { kind: 'list', list, range }, scope);
