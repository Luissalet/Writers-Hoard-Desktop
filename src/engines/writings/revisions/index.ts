import { Extension, Mark, type AnyExtension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep, AddMarkStep, RemoveMarkStep, Mapping, canJoin } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';
import { REVISION_ATTRIBUTES, revisionMetadataFromElement, revisionHtmlAttributes, normalizeRevisionMetadata, type RevisionMetadata, type RevisionTracking, type RevisionSummary, type RevisionProposalInput, type RevisionResolveInput, type RevisionOperationResult, type RevisionScope } from './model';
export * from './model';

interface TrackingState extends RevisionTracking { lastInput?: { id: string; at: number } }
export const revisionPluginKey = new PluginKey<TrackingState>('whRevisionTracking');
const OWN_TRANSACTION = 'whRevisionOperation';
const INSERTION = 'whRevisionInsertion';
const DELETION = 'whRevisionDeletion';
const BOUNDARY = 'whRevisionBreak';
const revisionId = () => crypto.randomUUID();
const isRevisionMark = (name: string) => name === INSERTION || name === DELETION;

function revisionMark(name: string, kind: RevisionMetadata['kind']) {
  return Mark.create({
    name, inclusive: false, clearable: false, excludes: `${INSERTION} ${DELETION}`,
    addAttributes: () => ({
      id: { default: '', rendered: false }, author: { default: '', rendered: false },
      source: { default: '', rendered: false }, createdAt: { default: 0, rendered: false },
    }),
    parseHTML: () => [{ tag: `span[${REVISION_ATTRIBUTES.kind}="${kind}"]`, getAttrs: element => {
      const meta = revisionMetadataFromElement(element); return meta?.kind === kind ? meta : false;
    } }],
    renderHTML: ({ mark }) => ['span', { ...revisionHtmlAttributes({ ...mark.attrs, kind }), class: `wh-revision-${kind}` }, 0],
  });
}

function supportedRange(doc: PmNode, from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > doc.content.size) return false;
  const start = doc.resolve(from); const end = doc.resolve(to);
  if (!start.parent.isTextblock || !end.parent.isTextblock || !start.parent.type.allowsMarkType(doc.type.schema.marks[DELETION]) || !end.parent.type.allowsMarkType(doc.type.schema.marks[DELETION])) return false;
  if (start.sameParent(end)) return true;
  if (start.depth !== end.depth || start.depth === 0 || start.node(start.depth - 1) !== end.node(end.depth - 1)) return false;
  for (let index = start.index(start.depth - 1); index <= end.index(end.depth - 1); index++) {
    const node = start.node(start.depth - 1).child(index);
    if (!node.isTextblock || !node.type.allowsMarkType(doc.type.schema.marks[DELETION])) return false;
  }
  return true;
}

function validPositions(doc: PmNode, from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > doc.content.size) return false;
  return [from, to].every(position => {
    const resolved = doc.resolve(position); const before = resolved.nodeBefore?.text; const after = resolved.nodeAfter?.text;
    if (!before || !after) return true;
    const left = before.charCodeAt(before.length - 1); const right = after.charCodeAt(0);
    return !(left >= 0xD800 && left <= 0xDBFF && right >= 0xDC00 && right <= 0xDFFF);
  });
}

function failure(reason: NonNullable<RevisionOperationResult['reason']>, message: string): RevisionOperationResult { return { ok: false, ids: [], reason, message }; }
function addRevision(tr: Transaction, from: number, to: number, meta: RevisionMetadata) {
  const mark = tr.doc.type.schema.marks[meta.kind === 'insertion' ? INSERTION : DELETION].create(meta);
  tr.addMark(from, to, mark);
}
function proposalMetadata(input: RevisionProposalInput, kind: RevisionMetadata['kind']): RevisionMetadata {
  return { id: input.id ?? revisionId(), author: input.author, source: input.source, createdAt: input.createdAt ?? Date.now(), kind };
}

export function describeRevisionDocument(doc: PmNode, scope?: RevisionScope): RevisionSummary[] {
  const groups = new Map<string, RevisionSummary>();
  const include = (meta: RevisionMetadata, from: number, to: number, text: string, boundary = false) => {
    if (scope && (from < scope.from || to > scope.to)) return;
    let group = groups.get(meta.id);
    if (!group) { group = { ...meta, from, to, originalText: '', proposedText: '', deletedText: '', insertedText: '', ranges: [] }; groups.set(meta.id, group); }
    group.from = Math.min(group.from, from); group.to = Math.max(group.to, to);
    group.ranges.push({ from, to, kind: meta.kind, ...(boundary ? { boundary: true } : {}) });
    if (meta.kind === 'deletion') group.deletedText += text; else group.insertedText += text;
  };
  doc.descendants((node, position) => {
    const boundary = normalizeRevisionMetadata(node.attrs[BOUNDARY]);
    if (boundary) include(boundary, position, position + 1, '\n', true);
    if (node.isInline) for (const mark of node.marks) {
      if (isRevisionMark(mark.type.name)) {
        const meta = normalizeRevisionMetadata({ ...mark.attrs, kind: mark.type.name === INSERTION ? 'insertion' : 'deletion' });
        if (meta) include(meta, position, position + node.nodeSize, node.isText ? node.text! : node.type.name === 'footnote' ? '[footnote]' : '\uFFFC');
      }
    }
  });
  return [...groups.values()].map(group => ({ ...group, originalText: group.deletedText, proposedText: group.insertedText, kind: group.ranges.some(range => range.kind === 'insertion') && group.ranges.some(range => range.kind === 'deletion') ? 'replacement' : group.ranges[0].kind }));
}
export function describeRevisions(editor: Editor, scope?: RevisionScope): RevisionSummary[] { return describeRevisionDocument(editor.state.doc, scope); }

/** Original document nodes stay in place; replacement text is plain text. */
export function proposeRevision(editor: Editor, input: RevisionProposalInput): RevisionOperationResult {
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== input.currentUpdatedAt) return failure('stale-source', 'The writing changed after this proposal was prepared. Refresh its source before proposing again.');
  if (!validPositions(editor.state.doc, input.from, input.to)) return failure('invalid-range', 'Use document positions inside the current writing without splitting a Unicode character.');
  if (!supportedRange(editor.state.doc, input.from, input.to)) return failure('structure', 'Choose text within compatible paragraphs. Chapter boundaries, table cells and block objects are separate editing scopes.');
  if (typeof input.text !== 'string') return failure('invalid-range', 'Replacement text must be plain text.');
  const existing = describeRevisions(editor);
  if (existing.some(group => group.ranges.some(range => range.from < input.to && range.to > input.from) || (input.from === input.to && group.from < input.from && group.to > input.from) || (input.id && group.id === input.id))) return failure('overlapping-revision', 'Resolve the existing proposal in this range before proposing another replacement.');
  if (input.from === input.to && !input.text) return failure('invalid-range', 'The proposal has neither original text nor new text.');
  const meta = proposalMetadata(input, 'deletion');
  if (!normalizeRevisionMetadata(meta)) return failure('invalid-range', 'The proposal metadata is invalid.');
  const $from = editor.state.doc.resolve(input.from); const $to = editor.state.doc.resolve(input.to);
  // Capture the source formatting before adding deletion metadata. At a caret,
  // explicit toolbar/stored formatting wins. Selection inheritance follows
  // ProseMirror's non-inclusive link rules rather than extending links outside
  // their original context.
  const inherited = (input.from === input.to && editor.state.storedMarks ? editor.state.storedMarks : $from.marksAcross($to) ?? $from.marks()).filter(item => !isRevisionMark(item.type.name));
  const tr = closeHistory(editor.state.tr).setMeta(OWN_TRANSACTION, true);
  if (input.from < input.to) {
    addRevision(tr, input.from, input.to, meta);
    tr.doc.nodesBetween(input.from, input.to, (node, pos) => {
      if (node.isTextblock && pos > input.from && pos < input.to) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [BOUNDARY]: meta });
    });
  }
  const lines = input.text.split(/\r\n|\r|\n/);
  const insertedMeta = { ...meta, kind: 'insertion' as const };
  const mark = editor.schema.marks[INSERTION].create(insertedMeta);
  const current = tr.doc.resolve(input.to).parent;
  const paragraph = editor.schema.nodes.paragraph;
  const content = Fragment.fromArray(lines.map(line => paragraph.create({ ...current.attrs, [BOUNDARY]: null }, line ? editor.schema.text(line, [...inherited, mark]) : undefined)));
  if (input.text) {
    tr.replaceRange(input.to, input.to, new Slice(content, 1, 1));
    const end = tr.mapping.map(input.to, 1);
    tr.doc.nodesBetween(input.to, end, (node, pos) => {
      if (node.isTextblock && pos > input.to && pos < end) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [BOUNDARY]: insertedMeta });
    });
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, tr.mapping.map(input.to, 1)))));
  editor.view.dispatch(tr);
  return { ok: true, ids: [meta.id] };
}

/** Selection chooses whole IDs, so replacement originals and candidates resolve together. */
export function prepareResolve(state: EditorState, input: RevisionResolveInput): { transaction: Transaction | null; result: RevisionOperationResult } {
  const refused = (reason: NonNullable<RevisionOperationResult['reason']>, message: string) => ({ transaction: null, result: failure(reason, message) });
  const scope = input.scopeFrom !== undefined && input.scopeTo !== undefined ? { from: input.scopeFrom, to: input.scopeTo } : input.ids && input.from !== undefined && input.to !== undefined ? { from: input.from, to: input.to } : undefined;
  if (scope && (!Number.isInteger(scope.from) || !Number.isInteger(scope.to) || scope.from < 0 || scope.to < scope.from || scope.to > state.doc.content.size)) return refused('invalid-range', 'The revision scope is invalid.');
  if (!input.ids && (input.from !== undefined || input.to !== undefined) && !validPositions(state.doc, input.from!, input.to!)) return refused('invalid-range', 'The revision selection is invalid.');
  const groups = describeRevisionDocument(state.doc, scope);
  const selected = groups.filter(group => input.ids ? input.ids.includes(group.id) : input.from !== undefined && input.to !== undefined ? group.ranges.some(range => input.from === input.to ? range.from <= input.from! && range.to >= input.to! : range.from < input.to! && range.to > input.from!) : true);
  if (!selected.length) return refused('not-found', 'No revisions match this selection.');
  if (!['accept', 'reject'].includes(input.decision)) return refused('invalid-range', 'Choose accept or reject.');
  const tr = closeHistory(state.tr).setMeta(OWN_TRANSACTION, true);
  const ranges = selected.flatMap(group => group.ranges).sort((a, b) => b.from - a.from || b.to - a.to);
  const removeKind = input.decision === 'accept' ? 'deletion' : 'insertion';
  for (const range of ranges) {
    const from = tr.mapping.map(range.from, 1); const to = tr.mapping.map(range.to, -1);
    if (range.boundary) {
      const node = tr.doc.nodeAt(from);
      if (node?.attrs[BOUNDARY]) tr.setNodeMarkup(from, undefined, { ...node.attrs, [BOUNDARY]: null });
      if (range.kind === removeKind && canJoin(tr.doc, from)) tr.join(from);
    } else if (to > from) {
      if (range.kind === removeKind) tr.delete(from, to);
      else tr.removeMark(from, to, state.schema.marks[range.kind === 'insertion' ? INSERTION : DELETION]);
    }
  }
  return { transaction: tr, result: { ok: true, ids: selected.map(group => group.id) } };
}

export function resolveRevisions(editor: Editor, input: RevisionResolveInput): RevisionOperationResult {
  const prepared = prepareResolve(editor.state, input);
  if (prepared.transaction) editor.view.dispatch(prepared.transaction);
  return prepared.result;
}

/** A new persistent document value, using the live schema, without a DOM/editor or source write. */
export function projectRevisionDocument(doc: PmNode, decision: 'accept' | 'reject'): PmNode {
  return prepareResolve(EditorState.create({ doc, schema: doc.type.schema }), { decision }).transaction?.doc ?? doc;
}

export function getRevisionTracking(editor: Editor): RevisionTracking {
  const state = revisionPluginKey.getState(editor.state);
  return state ? { enabled: state.enabled, author: state.author, source: state.source, ...(state.warning ? { warning: state.warning } : {}) } : { enabled: false, author: '', source: '' };
}
export function setRevisionTracking(editor: Editor, config: Omit<RevisionTracking, 'warning'>): void {
  editor.view.dispatch(editor.state.tr.setMeta(revisionPluginKey, { ...config, warning: undefined }).setMeta('addToHistory', false));
}

function markedDeletedSlice(slice: Slice, meta: RevisionMetadata, editor: Editor): Slice {
  const transform = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach(node => {
      if (node.isInline && node.marks.some(mark => mark.type.name === INSERTION)) return;
      if (node.isInline && !node.marks.some(mark => mark.type.name === DELETION)) nodes.push(node.mark([...node.marks, editor.schema.marks[DELETION].create(meta)]));
      else nodes.push(node.copy(transform(node.content)));
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(transform(slice.content), slice.openStart, slice.openEnd);
}

export function createRevisionExtensions(): AnyExtension[] {
  return [revisionMark(INSERTION, 'insertion'), revisionMark(DELETION, 'deletion'), Extension.create({
    name: 'whRevisions',
    addGlobalAttributes: () => [{ types: ['paragraph', 'heading'], attributes: { [BOUNDARY]: {
      default: null, parseHTML: (element: HTMLElement) => revisionMetadataFromElement(element, true), renderHTML: (attrs: Record<string, unknown>) => revisionHtmlAttributes(attrs[BOUNDARY], true),
    } } }],
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [new Plugin<TrackingState>({
        key: revisionPluginKey,
        state: { init: () => ({ enabled: false, author: '', source: '' }), apply: (tr, prior) => tr.getMeta(revisionPluginKey) ?? (tr.getMeta(OWN_TRANSACTION) || tr.getMeta('history$') ? { ...prior, lastInput: undefined } : prior) },
        appendTransaction(transactions, oldState, newState) {
          const config = revisionPluginKey.getState(newState);
          if (!config?.enabled || transactions.some(tr => tr.getMeta(OWN_TRANSACTION) || tr.getMeta('history$') || tr.getMeta('preventUpdate') || tr.getMeta('addToHistory') === false)) return null;
          const changed = transactions.filter(tr => tr.docChanged);
          const entries = changed.flatMap(tr => tr.steps.map((step, index) => ({ step, doc: tr.docs[index] })) );
          const replacements = entries.filter(item => item.step instanceof ReplaceStep);
          if (!replacements.length) return null;
          const inlineStep = (item: typeof entries[number]) => {
            const step = item.step as ReplaceStep;
            return supportedRange(item.doc, step.from, step.to) && item.doc.resolve(step.from).sameParent(item.doc.resolve(step.to)) && !step.slice.openStart && !step.slice.openEnd && step.slice.content.content.every(node => node.isInline);
          };
          const marksOnly = entries.every(item => item.step instanceof ReplaceStep || item.step instanceof AddMarkStep || item.step instanceof RemoveMarkStep);
          // An input can insert several fragments and then apply character marks.
          // Map each surviving fragment through the later original steps; all
          // fragments share one ID and no document reconstruction is necessary.
          if (replacements.length > 1 && marksOnly && replacements.every(item => inlineStep(item) && (item.step as ReplaceStep).from === (item.step as ReplaceStep).to)) {
            const now = Date.now(); const meta = { id: revisionId(), kind: 'insertion' as const, author: config.author, source: config.source, createdAt: now };
            const tr = newState.tr.setMeta(OWN_TRANSACTION, true).setMeta(revisionPluginKey, { ...config, lastInput: { id: meta.id, at: now }, warning: undefined });
            for (const item of replacements) {
              const step = item.step as ReplaceStep;
              const mapping = new Mapping(entries.slice(entries.indexOf(item) + 1).map(entry => entry.step.getMap()));
              const from = mapping.map(step.from, -1); const to = mapping.map(step.from + step.slice.size, 1);
              if (to > from) addRevision(tr, from, to, meta);
            }
            return tr;
          }
          // Structural edits retain the normal editing flow and announce its scope.
          // No reconstruction, rollback or business gate is imposed on typing.
          if (replacements.length !== 1 || !marksOnly) return newState.tr.setMeta(OWN_TRANSACTION, true).setMeta('addToHistory', false).setMeta(revisionPluginKey, { ...config, lastInput: undefined, warning: 'This structural edit was kept normally; only text replacement inside a paragraph is tracked automatically.' });
          const { step: generic, doc } = replacements[0]; const step = generic as ReplaceStep;
          if (!inlineStep(replacements[0])) return newState.tr.setMeta(OWN_TRANSACTION, true).setMeta('addToHistory', false).setMeta(revisionPluginKey, { ...config, lastInput: undefined, warning: 'This structural edit was kept normally; text edits inside a paragraph are tracked.' });
          const priorMark = doc.resolve(step.from).nodeBefore?.marks.find(mark => mark.type.name === INSERTION) ?? doc.resolve(step.from).nodeAfter?.marks.find(mark => mark.type.name === INSERTION);
          const prior = priorMark && normalizeRevisionMetadata({ ...priorMark.attrs, kind: 'insertion' });
          const now = Date.now();
          const reuse = prior && prior.author === config.author && prior.source === config.source && prior.id === config.lastInput?.id && now - config.lastInput.at <= 500;
          const meta: RevisionMetadata = { id: reuse ? prior.id : revisionId(), kind: 'deletion', author: config.author, source: config.source, createdAt: reuse ? prior.createdAt : now };
          const tr = newState.tr.setMeta(OWN_TRANSACTION, true).setMeta(revisionPluginKey, { ...config, lastInput: { id: meta.id, at: now }, warning: undefined });
          const deleted = markedDeletedSlice(doc.slice(step.from, step.to), meta, editor);
          if (step.slice.size) addRevision(tr, step.from, step.from + step.slice.size, { ...meta, kind: 'insertion' });
          if (deleted.size) tr.replace(step.from, step.from, deleted);
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, tr.mapping.map(newState.selection.to, 1)))));
          // The appended transaction joins the user's edit in ProseMirror history.
          void oldState;
          return tr;
        },
      })];
    },
  })];
}
