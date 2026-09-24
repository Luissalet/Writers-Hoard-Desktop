// ============================================================================
// Project-wide find and replace — the engine
// ============================================================================
//
// At month three a writer renames a character, or an editor says "you use
// 'suddenly' 41 times". Until now the only answer was the find bar inside the
// open chapter, thirty times over — which is the moment people give up and
// open the manuscript in Word.
//
// Three rules shape everything below.
//
//   • ONE MATCHER. The find bar's `findMatches` is the only code in the app
//     that decides what counts as a hit, and it stays that way. It reads a
//     ProseMirror document, and stored prose is HTML, so this module builds an
//     ADAPTER (`matcherDocument`) that presents parsed HTML through the two
//     properties `findMatches` actually reads. A second matcher would drift
//     from the first, and the two would disagree about "canción" on a Tuesday.
//
//   • THE CONTENT IS HTML. A string replace over
//     `<p>Marta y <strong>Marta</strong></p>` corrupts tags and matches inside
//     attributes. Here the HTML is parsed the way the DOCX exporter parses it
//     (`new DOMParser().parseFromString(html, 'text/html')`) and only TEXT
//     NODES are rewritten. Writing to `Text.data` cannot produce a tag: a
//     replacement of `<b>` is serialised back as `&lt;b&gt;`, literal text,
//     which is exactly what the writer typed. Attributes — including the
//     base64 in `<img src="data:…">` — are never read and never written by
//     the walk. The one attribute that IS prose, a footnote's body
//     (`data-footnote`), is exposed as a plain-text field of its own and
//     written back through the DOM by note id (`withFootnoteTexts`), so it
//     goes through the same matcher and the same escaping as a text node.
//
//   • NOTHING IS WRITTEN UNTIL THE WRITER SAYS SO, AND THEN ALL AT ONCE. The
//     scan streams rows through a Dexie cursor and keeps only occurrence
//     metadata; the apply pass re-reads every row inside ONE transaction,
//     checks it has not changed under the review, snapshots every writing, and
//     writes. A failure anywhere leaves the project exactly as it was.

import type { Table } from 'dexie';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { db } from '@/db';
import { findMatches, type MatchOptions } from '@/components/editor/findReplace';
import {
  extractFootnotesFromHtml,
  withFootnoteTexts,
} from '@/components/editor/footnotes/footnoteModel';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { codexEntryOps } from '@/engines/codex/operations';
import { updateEntry } from '@/engines/diary/operations';
import { updateDialogBlock } from '@/engines/dialog-scene/operations';
import { updateNote } from '@/engines/notes/operations';
import { updateBeat } from '@/engines/outline/operations';
import { updateWriting } from '@/engines/writings/operations';
import { restoreSnapshot, takeSnapshot } from '@/engines/writings/snapshots';
import { t } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import type { CodexEntry, Relation, Writing } from '@/types';
import type { DiaryEntry } from '@/engines/diary/types';
import type { DialogBlock } from '@/engines/dialog-scene/types';
import type { Note } from '@/engines/notes/types';
import type { OutlineBeat } from '@/engines/outline/types';

export type { MatchOptions };

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Occurrences listed with context for one document. The rest are counted. */
const MAX_LISTED_PER_DOCUMENT = 50;
/** Occurrences listed with context across the whole project. */
const MAX_LISTED_TOTAL = 1000;
/** Characters of context kept on each side of a listed occurrence. */
const CONTEXT_RADIUS = 60;

/**
 * How long the one-click undo stays alive. It is a convenience, not the
 * recovery story: writings keep a real version in their history panel for ever.
 */
const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Ceiling on the pre-images the undo record holds for tables that have no
 * version history of their own. A rename never comes close; a pathological
 * batch that would means the undo is dropped rather than the memory taken —
 * see `applyProjectReplace`.
 */
const UNDO_BUDGET_CHARACTERS = 2_000_000;

/**
 * The reason stamped on the version snapshot. `SnapshotReason` is a closed
 * union owned by the writings engine (`auto | manual | pre-restore | pre-ai`)
 * and there is no `pre-replace` in it. `manual` is the honest member: the
 * writer asked for this, deliberately, from a button — unlike `auto` (which
 * deduplicates and would silently skip a restore point) and `pre-ai` (which
 * would claim a model wrote the chapter).
 */
const SNAPSHOT_REASON = 'manual' as const;

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type ReplaceScopeId = 'writings' | 'codex' | 'dialog' | 'outline' | 'notes' | 'diary';

/** Order the preview lists scopes in: the manuscript first. */
export const REPLACE_SCOPES: readonly ReplaceScopeId[] = [
  'writings', 'codex', 'dialog', 'outline', 'notes', 'diary',
];

export interface ReplaceOccurrence {
  /** Stable selection key: row, field and the match's ordinal in that field. */
  key: string;
  rowKey: string;
  /** Which row inside the group this came from ('' when the group is the row). */
  rowLabel: string;
  fieldLabelKey: string;
  /** Interpolated into `fieldLabelKey` for writer-named fields. */
  fieldLabelName?: string;
  /**
   * Formatting cuts through this occurrence, so it is NOT rewritten. See
   * `rewriteField` for why guessing which half keeps the bold is worse than
   * leaving it alone.
   */
  split: boolean;
  before: string;
  match: string;
  after: string;
}

export interface ReplaceRowRef {
  scope: ReplaceScopeId;
  id: string;
  key: string;
  /** Reading order inside the group; 0 when the group is the row itself. */
  order: number;
  /** Rewritable occurrences in this row, including ones past the listing cap. */
  total: number;
  /** Guard taken at scan time over every field this row exposes. */
  fingerprint: number;
  length: number;
}

export interface ReplaceDocument {
  key: string;
  scope: ReplaceScopeId;
  title: string;
  /** Sort key inside the scope: chapter number, scene order, date… */
  order: number;
  rows: ReplaceRowRef[];
  /** Listed occurrences, capped; every one carries its line of context. */
  occurrences: ReplaceOccurrence[];
  /** Rewritable occurrences in this document, listed or not. */
  total: number;
  /** Occurrences formatting splits; never rewritten, never selectable. */
  splitTotal: number;
}

export interface ReplacePlan {
  projectId: string;
  term: string;
  options: MatchOptions;
  scopes: ReplaceScopeId[];
  documents: ReplaceDocument[];
  /** Rewritable occurrences across the project. */
  total: number;
  splitTotal: number;
  /** Rewritable occurrences with no row of their own in the preview. */
  unlisted: number;
  /** Rows the cursor walked, matched or not. */
  scanned: number;
}

export interface ReplaceSelection {
  excludedDocuments: ReadonlySet<string>;
  excludedOccurrences: ReadonlySet<string>;
}

export interface ReplaceOutcome {
  batchId: string;
  /** Occurrences actually rewritten. */
  replaced: number;
  documents: number;
  rows: number;
  /** Writings versioned before the rewrite. */
  snapshots: number;
  /** Rows whose text changed between the review and the button; left alone. */
  skippedChanged: number;
  undoAvailable: boolean;
  undoExpiresAt: number;
}

// ---------------------------------------------------------------------------
// Reading stored HTML — the same door the exporters use
// ---------------------------------------------------------------------------

/**
 * Tags whose boundary breaks a match, because ProseMirror models them as BLOCK
 * or LEAF nodes and the find bar refuses to match across those. Without this,
 * "the" ending one paragraph and "end" opening the next would match "theend" —
 * and a replace would then splice text across a tag boundary.
 *
 * Everything absent from these two sets is treated as inline (`strong`, `em`,
 * `a`, `span`, `code`, and any custom inline node a future extension adds),
 * which is exactly what makes a match findable across a mark boundary — and
 * therefore reportable instead of silently mangled.
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'ul',
]);

const LEAF_TAGS = new Set(['br', 'hr', 'img', 'iframe', 'video', 'audio']);

// ---------------------------------------------------------------------------
// The cheap gate in front of the parse
// ---------------------------------------------------------------------------

/** The entities an HTML serialiser writes into text, and what they spell. */
const TEXT_ENTITIES: Readonly<Record<string, string>> = {
  'amp;': '&', 'lt;': '<', 'gt;': '>', 'quot;': '"', '#39;': "'", 'nbsp;': '\u00a0',
};
const ENTITY = /&(#?[a-z0-9]+;?)/gi;
const TAG = /<[^>]*>/g;
const ALL_MARKS = /\p{M}/gu;

/**
 * The find bar's folding (`fold` in findReplace.ts), over a whole string. The
 * one context-sensitive lowercase rule, the Greek final sigma, is flattened on
 * both sides because the matcher folds character by character.
 */
function gateFold(value: string): string {
  return value.normalize('NFD').replace(ALL_MARKS, '').toLowerCase().replace(/ς/g, 'σ');
}

/**
 * "Could `indexField` find anything in this field?" It may say yes wrongly —
 * the matcher then finds nothing — but it must never say no where the matcher
 * would say yes, because a no skips the field without parsing it.
 *
 * The raw HTML is not the text the matcher reads: `Tom &amp; Jerry` is how
 * "Tom & Jerry" is stored, and `Mar<strong>ta</strong>` is one word the preview
 * must report as split. So tags are dropped and the entities a serialiser
 * writes are decoded; any other entity means "parse it and see".
 */
function mayMatch(field: ReplaceField, foldedTerm: string): boolean {
  if (!foldedTerm || !field.value) return false;
  let text = field.value;
  if (field.html) {
    let unknownEntity = false;
    text = text.replace(TAG, '').replace(ENTITY, (whole, name: string) => {
      const known = TEXT_ENTITIES[name.toLowerCase()];
      if (known !== undefined) return known;
      unknownEntity = true;
      return whole;
    });
    if (unknownEntity) return true;
  }
  return gateFold(text).includes(foldedTerm);
}

/** One text node of a field, with where it sits in the flat coordinate space. */
interface Piece {
  /** null for a plain-text field, which is one piece and no DOM at all. */
  node: Text | null;
  data: string;
  /** Start of this piece in the positions `findMatches` hands back. */
  base: number;
  /** Start of this piece in the readable text the preview quotes. */
  plainBase: number;
}

type WalkStep =
  | { kind: 'text'; piece: Piece }
  | { kind: 'break'; base: number };

/**
 * The only surface of a ProseMirror node that `findMatches` reads. Written out
 * so the adapter below is checked against something rather than cast blind.
 */
interface MatcherNode {
  isText: boolean;
  text?: string;
  isBlock: boolean;
  isLeaf: boolean;
}

/**
 * Present a walked field to `findMatches` as if it were a ProseMirror document.
 *
 * The walk is replayed rather than re-derived, so the positions the matcher
 * returns are positions in the piece list this module already holds. Text
 * pieces are reported as text nodes; block and leaf boundaries as the nodes
 * that make the matcher insert its block separator, in the same places
 * ProseMirror would.
 */
function matcherDocument(steps: readonly WalkStep[]): ProseMirrorNode {
  const adapter = {
    descendants(visit: (node: MatcherNode, pos: number) => boolean | void): void {
      for (const step of steps) {
        if (step.kind === 'text') {
          visit({ isText: true, text: step.piece.data, isBlock: false, isLeaf: true }, step.piece.base);
        } else {
          visit({ isText: false, isBlock: true, isLeaf: false }, step.base);
        }
      }
    },
  };
  return adapter as unknown as ProseMirrorNode;
}

interface FieldMatch {
  /** Index into `pieces` of the piece the match starts in. */
  first: number;
  /** Index into `pieces` of the piece it ends in; ≠ first means split. */
  last: number;
  start: number;
  end: number;
  plainStart: number;
  plainEnd: number;
}

interface FieldIndex {
  pieces: Piece[];
  /** Readable text of the field, for quoting a line of context. */
  plain: string;
  matches: FieldMatch[];
  /** The parsed body for an HTML field; null for a plain-text one. */
  body: HTMLElement | null;
}

function emptyIndex(): FieldIndex {
  return { pieces: [], plain: '', matches: [], body: null };
}

interface WalkState {
  steps: WalkStep[];
  pieces: Piece[];
  cursor: number;
  plain: string;
}

/**
 * Walk parsed HTML into text pieces, block breaks and a readable rendition.
 * `nodeType === 3` and `instanceof Element` mirror `publishingDocx.ts`, which
 * is the app's existing reader of stored HTML.
 */
function walkHtml(root: Node, state: WalkState): void {
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      const node = child as Text;
      const data = node.data;
      // ProseMirror has no empty text nodes; an empty one here would only add
      // an ambiguous position to the map.
      if (!data) continue;
      const piece: Piece = { node, data, base: state.cursor, plainBase: state.plain.length };
      state.pieces.push(piece);
      state.steps.push({ kind: 'text', piece });
      state.plain += data;
      // A gap of one keeps the end of a piece distinguishable from the start of
      // the next, so a match ending exactly on a boundary maps back to the
      // piece it actually ended in.
      state.cursor += data.length + 1;
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag) || LEAF_TAGS.has(tag)) {
      state.steps.push({ kind: 'break', base: state.cursor });
      state.cursor += 1;
      if (state.plain && !state.plain.endsWith('\n')) state.plain += '\n';
    }
    walkHtml(child, state);
  }
}

/** Index of the piece whose span holds `pos`. */
function locate(pieces: readonly Piece[], pos: number, isEnd: boolean): number {
  let low = 0;
  let high = pieces.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const base = pieces[mid].base;
    if (isEnd ? base < pos : base <= pos) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Locate every occurrence of `term` in one field, through the find bar's
 * matcher. HTML is parsed; plain text is presented as a single piece, so both
 * kinds of field go through exactly the same matching rules — the same
 * case-sensitive, whole-word and match-accents toggles, the same folding.
 */
function indexField(value: string, html: boolean, term: string, options: MatchOptions): FieldIndex {
  if (!value || !term) return emptyIndex();

  const state: WalkState = { steps: [], pieces: [], cursor: 0, plain: '' };
  let body: HTMLElement | null = null;

  if (html) {
    body = new DOMParser().parseFromString(value, 'text/html').body;
    walkHtml(body, state);
  } else {
    const piece: Piece = { node: null, data: value, base: 0, plainBase: 0 };
    state.pieces.push(piece);
    state.steps.push({ kind: 'text', piece });
    state.plain = value;
  }

  if (state.pieces.length === 0) return emptyIndex();

  const matches: FieldMatch[] = [];
  for (const match of findMatches(matcherDocument(state.steps), term, options)) {
    const first = locate(state.pieces, match.from, false);
    const last = locate(state.pieces, match.to, true);
    const start = match.from - state.pieces[first].base;
    const end = match.to - state.pieces[last].base;
    matches.push({
      first,
      last,
      start,
      end,
      plainStart: state.pieces[first].plainBase + start,
      plainEnd: state.pieces[last].plainBase + end,
    });
  }

  return { pieces: state.pieces, plain: state.plain, matches, body };
}

/**
 * Rewrite the accepted occurrences and hand back the new field value, or null
 * when nothing was accepted.
 *
 * A match that spans two text nodes is never rewritten. `Mar<strong>ta</strong>`
 * is one word to the reader and two nodes to the document; putting the whole
 * replacement in either node would silently move a formatting boundary, and
 * splitting it between them would need to know which half of "Clara" the writer
 * wanted bold. Neither is a decision this code can make, so those occurrences
 * are reported to the writer instead — see `ReplaceOccurrence.split`.
 */
function rewriteField(
  index: FieldIndex,
  replacement: string,
  accept: (ordinal: number) => boolean,
): string | null {
  const edits = new Map<number, Array<{ start: number; end: number }>>();
  for (let ordinal = 0; ordinal < index.matches.length; ordinal += 1) {
    const match = index.matches[ordinal];
    if (match.first !== match.last) continue;
    if (!accept(ordinal)) continue;
    const list = edits.get(match.first);
    if (list) list.push({ start: match.start, end: match.end });
    else edits.set(match.first, [{ start: match.start, end: match.end }]);
  }
  if (edits.size === 0) return null;

  for (const [pieceIndex, spans] of edits) {
    const piece = index.pieces[pieceIndex];
    // `findMatches` returns non-overlapping matches in document order, so one
    // forward pass rebuilds the node without any offset arithmetic.
    let rebuilt = '';
    let cursor = 0;
    for (const span of spans) {
      rebuilt += piece.data.slice(cursor, span.start);
      rebuilt += replacement;
      cursor = span.end;
    }
    rebuilt += piece.data.slice(cursor);
    piece.data = rebuilt;
    // Writing to `Text.data` is the whole anti-corruption story: the value is
    // character data, so the serializer escapes it. Tags, attributes and the
    // marks around this node are untouched by construction.
    if (piece.node) piece.node.data = rebuilt;
  }

  return index.body ? index.body.innerHTML : index.pieces[0].data;
}

/** Collapse the runs of whitespace a quoted line picks up from block markup. */
function tidy(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/** The line the occurrence sits on, trimmed to a readable width around it. */
function contextAround(
  plain: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } {
  const lineStart = start > 0 ? plain.lastIndexOf('\n', start - 1) + 1 : 0;
  const lineEndRaw = plain.indexOf('\n', end);
  const lineEnd = lineEndRaw < 0 ? plain.length : lineEndRaw;
  const from = Math.max(lineStart, start - CONTEXT_RADIUS);
  const to = Math.min(lineEnd, end + CONTEXT_RADIUS);
  return {
    before: `${from > lineStart ? '…' : ''}${tidy(plain.slice(from, start))}`,
    match: plain.slice(start, end),
    after: `${tidy(plain.slice(end, to))}${to < lineEnd ? '…' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// The change guard
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;

/**
 * FNV-1a over the field values a row exposes. The apply pass re-reads every row
 * and compares this before touching it, so a chapter edited in another window
 * while the writer reviewed the preview is left alone instead of having a stale
 * occurrence index applied to text that moved. Stricter than trusting
 * `updatedAt`, which is stamped by the write paths but not by the row itself.
 */
function fingerprintOf(value: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Scopes — what a table actually holds, and what of it is safe to rewrite
// ---------------------------------------------------------------------------

interface ReplaceField {
  id: string;
  labelKey: string;
  labelName?: string;
  html: boolean;
  value: string;
}

interface RowCommit {
  /** Characters the undo record would hold for this row. */
  characters: number;
  /**
   * Puts the row back exactly as it was, or null when nothing needs carrying:
   * a writing's title and body come back from its version snapshot instead.
   */
  restore: (() => Promise<void>) | null;
}

interface ReplaceRowTarget {
  fields: ReplaceField[];
  /**
   * Write the rewritten fields and hand back the way back. Called only with a
   * non-empty map, from inside the batch transaction, after `snapshot`.
   */
  commit(values: ReadonlyMap<string, string>): Promise<RowCommit>;
  /** Version snapshot before the rewrite; resolves to the snapshot id. */
  snapshot?: () => Promise<string>;
}

interface ReplaceRowView extends ReplaceRowTarget {
  scope: ReplaceScopeId;
  id: string;
  documentKey: string;
  documentTitle: string;
  documentOrder: number;
  rowLabel: string;
  rowOrder: number;
}

interface ScopeDescriptor {
  labelKey: string;
  /** Tables the apply transaction must hold for this scope. */
  tables: readonly Table[];
  each(projectId: string, visit: (row: ReplaceRowView) => void): Promise<void>;
  /** Fresh read inside the transaction, for the guard and the write. */
  get(id: string): Promise<ReplaceRowTarget | undefined>;
}

/**
 * The row's own values for the keys a patch is about to overwrite.
 *
 * The two casts are the price of one generic helper instead of six hand-written
 * copies of the same loop. They are contained here, and every call site stays
 * fully typed on both sides: a `Partial<Writing>` in, a `Partial<Writing>` out.
 */
function preimageOf<T extends object>(
  row: T,
  patch: Partial<T>,
  keys?: readonly string[],
): Partial<T> {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (keys && !keys.includes(key)) continue;
    out[key] = source[key];
  }
  return out as Partial<T>;
}

function weigh(values: object): number {
  let total = 0;
  for (const value of Object.values(values)) {
    if (typeof value === 'string') total += value.length;
  }
  return total;
}

/** Pair a pre-image with the typed write that puts it back. */
function undoWith<T extends object>(
  before: Partial<T>,
  write: (changes: Partial<T>) => Promise<void>,
): RowCommit {
  return {
    characters: weigh(before),
    restore: Object.keys(before).length > 0 ? () => write(before) : null,
  };
}

function untitled(): string {
  return t('projectReplace.untitled');
}

// --- writings ---------------------------------------------------------------

/** Field id of one footnote's body: `footnote.<note id>`. */
const FOOTNOTE_FIELD_PREFIX = 'footnote.';

/**
 * The chapter's notes as fields of their own. The walk over the body reads
 * text nodes only, and a note is an attribute, so without this a character
 * renamed everywhere would keep the old name in every footnote. Each note is
 * a plain-text field — one piece, no formatting can split a match — labelled
 * with the number the editor prints beside it.
 */
function footnoteFields(html: string): ReplaceField[] {
  return extractFootnotesFromHtml(html).map((note) => ({
    id: `${FOOTNOTE_FIELD_PREFIX}${note.id}`,
    labelKey: 'projectReplace.field.footnote',
    labelName: String(note.index),
    html: false,
    value: note.text,
  }));
}

/** The rewritten note bodies in `values`, keyed by note id. */
function footnoteValues(values: ReadonlyMap<string, string>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [id, value] of values) {
    if (id.startsWith(FOOTNOTE_FIELD_PREFIX)) texts.set(id.slice(FOOTNOTE_FIELD_PREFIX.length), value);
  }
  return texts;
}

function writingTarget(row: Writing): ReplaceRowTarget {
  const html = row.content ?? '';
  return {
    fields: [
      { id: 'title', labelKey: 'projectReplace.field.title', html: false, value: row.title ?? '' },
      { id: 'synopsis', labelKey: 'projectReplace.field.synopsis', html: false, value: row.synopsis ?? '' },
      { id: 'content', labelKey: 'projectReplace.field.body', html: true, value: html },
      ...footnoteFields(html),
    ],
    async commit(values) {
      const patch: Partial<Writing> = {};
      if (values.has('title')) patch.title = values.get('title');
      // The app stores an empty synopsis as absent; a replacement that empties
      // one should not leave `''` behind where nothing else does.
      if (values.has('synopsis')) patch.synopsis = values.get('synopsis') || undefined;
      // The body and its notes are one column. The prose rewrite, if any,
      // comes first and never touches an attribute; the notes are then written
      // back into it by id, so both land in a single write of `content`.
      const notes = footnoteValues(values);
      if (values.has('content') || notes.size > 0) {
        const content = withFootnoteTexts(values.get('content') ?? html, notes);
        patch.content = content;
        patch.wordCount = countWords(content);
      }
      // Title and body are restored by the version snapshot, which carries
      // both; the one-line synopsis is not part of a snapshot, so it is the
      // only field the in-memory undo has to hold.
      const before = preimageOf(row, patch, ['synopsis']);
      await updateWriting(row.id, patch);
      return undoWith(before, (changes) => updateWriting(row.id, changes));
    },
    snapshot: () => snapshotWriting(row),
  };
}

// --- codex ------------------------------------------------------------------

function codexTarget(row: CodexEntry): ReplaceRowTarget {
  const attributes = Object.entries(row.fields ?? {});
  const relations = row.relations ?? [];
  const fields: ReplaceField[] = [
    { id: 'title', labelKey: 'projectReplace.field.title', html: false, value: row.title ?? '' },
    { id: 'content', labelKey: 'projectReplace.field.body', html: true, value: row.content ?? '' },
  ];
  for (const [name, value] of attributes) {
    fields.push({
      id: `fields.${name}`,
      labelKey: 'projectReplace.field.attribute',
      labelName: name,
      html: false,
      value: value ?? '',
    });
  }
  relations.forEach((relation, position) => {
    // `targetTitle` is a display copy of another entry's title. Rewriting it is
    // safe — the link itself is `targetId` — and it stays consistent because
    // the entry it mirrors is in this same scope, so both sides move together.
    fields.push({
      id: `relations.${position}.targetTitle`,
      labelKey: 'projectReplace.field.relationTarget',
      html: false,
      value: relation.targetTitle ?? '',
    });
    fields.push({
      id: `relations.${position}.description`,
      labelKey: 'projectReplace.field.relation',
      html: false,
      value: relation.description ?? '',
    });
  });
  // `avatar` and `avatarOriginal` are base64, not prose. They are never listed,
  // never read and never written.

  return {
    fields,
    async commit(values) {
      const patch: Partial<CodexEntry> = {};
      if (values.has('title')) patch.title = values.get('title');
      if (values.has('content')) patch.content = values.get('content');

      let attributesChanged = false;
      const nextAttributes: Record<string, string> = { ...(row.fields ?? {}) };
      for (const [name] of attributes) {
        const id = `fields.${name}`;
        if (!values.has(id)) continue;
        nextAttributes[name] = values.get(id) ?? '';
        attributesChanged = true;
      }
      if (attributesChanged) patch.fields = nextAttributes;

      let relationsChanged = false;
      const nextRelations: Relation[] = relations.map((relation, position) => {
        const titleId = `relations.${position}.targetTitle`;
        const descriptionId = `relations.${position}.description`;
        if (!values.has(titleId) && !values.has(descriptionId)) return relation;
        relationsChanged = true;
        return {
          ...relation,
          targetTitle: values.get(titleId) ?? relation.targetTitle,
          description: values.has(descriptionId) ? values.get(descriptionId) : relation.description,
        };
      });
      if (relationsChanged) patch.relations = nextRelations;

      const before = preimageOf(row, patch);
      await codexEntryOps.update(row.id, patch);
      return undoWith(before, (changes) => codexEntryOps.update(row.id, changes));
    },
  };
}

// --- dialogue ---------------------------------------------------------------

function dialogTarget(row: DialogBlock): ReplaceRowTarget {
  return {
    // `characterName` is deliberately absent. It is a display copy of the scene
    // cast's name, and `sceneCasts` is not one of the scopes this tool offers —
    // rewriting one side of that pair would leave the cast list and the script
    // disagreeing about who is speaking. Renaming a character happens in the
    // cast, which is the one place that owns the name.
    fields: [
      { id: 'content', labelKey: 'projectReplace.field.line', html: false, value: row.content ?? '' },
      { id: 'parenthetical', labelKey: 'projectReplace.field.parenthetical', html: false, value: row.parenthetical ?? '' },
    ],
    async commit(values) {
      const patch: Partial<DialogBlock> = {};
      if (values.has('content')) patch.content = values.get('content');
      if (values.has('parenthetical')) patch.parenthetical = values.get('parenthetical') || undefined;
      const before = preimageOf(row, patch);
      await updateDialogBlock(row.id, patch);
      return undoWith(before, (changes) => updateDialogBlock(row.id, changes));
    },
  };
}

// --- outline ----------------------------------------------------------------

function outlineTarget(row: OutlineBeat): ReplaceRowTarget {
  return {
    fields: [
      { id: 'title', labelKey: 'projectReplace.field.title', html: false, value: row.title ?? '' },
      { id: 'description', labelKey: 'projectReplace.field.description', html: false, value: row.description ?? '' },
    ],
    async commit(values) {
      const patch: Partial<OutlineBeat> = {};
      if (values.has('title')) patch.title = values.get('title');
      if (values.has('description')) patch.description = values.get('description');
      const before = preimageOf(row, patch);
      await updateBeat(row.id, patch);
      return undoWith(before, (changes) => updateBeat(row.id, changes));
    },
  };
}

// --- notes ------------------------------------------------------------------

function noteTarget(row: Note): ReplaceRowTarget {
  return {
    fields: [
      { id: 'text', labelKey: 'projectReplace.field.text', html: false, value: row.text ?? '' },
      { id: 'source', labelKey: 'projectReplace.field.source', html: false, value: row.source ?? '' },
    ],
    async commit(values) {
      const patch: Partial<Note> = {};
      if (values.has('text')) patch.text = values.get('text');
      if (values.has('source')) patch.source = values.get('source') || undefined;
      const before = preimageOf(row, patch);
      await updateNote(row.id, patch);
      return undoWith(before, (changes) => updateNote(row.id, changes));
    },
  };
}

// --- diary ------------------------------------------------------------------

function diaryTarget(row: DiaryEntry): ReplaceRowTarget {
  return {
    fields: [
      { id: 'title', labelKey: 'projectReplace.field.title', html: false, value: row.title ?? '' },
      { id: 'content', labelKey: 'projectReplace.field.body', html: true, value: row.content ?? '' },
    ],
    async commit(values) {
      const patch: Partial<DiaryEntry> = {};
      if (values.has('title')) patch.title = values.get('title');
      if (values.has('content')) patch.content = values.get('content');
      const before = preimageOf(row, patch);
      await updateEntry(row.id, patch);
      return undoWith(before, (changes) => updateEntry(row.id, changes));
    },
  };
}

/**
 * The scan streams rows through a Dexie cursor and keeps only what it needs.
 * The rows themselves are never retained, which is what keeps the base64
 * columns these tables carry (`codexEntries.avatar`, `avatarOriginal`) out of
 * the plan — and the walk reads text nodes only, so the base64 inside an
 * `<img src="data:…">` never reaches the preview either.
 */
const SCOPES: Record<ReplaceScopeId, ScopeDescriptor> = {
  writings: {
    labelKey: 'projectReplace.scope.writings',
    tables: [db.writings, db.writingSnapshots],
    async each(projectId, visit) {
      await db.writings.where('projectId').equals(projectId).each((row) => {
        visit({
          scope: 'writings',
          id: row.id,
          documentKey: `writings:${row.id}`,
          documentTitle: row.title || untitled(),
          documentOrder: row.chapter ?? Number.MAX_SAFE_INTEGER,
          rowLabel: '',
          rowOrder: 0,
          ...writingTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.writings.get(id);
      return row ? writingTarget(row) : undefined;
    },
  },

  codex: {
    labelKey: 'projectReplace.scope.codex',
    tables: [db.codexEntries],
    async each(projectId, visit) {
      await db.codexEntries.where('projectId').equals(projectId).each((row) => {
        visit({
          scope: 'codex',
          id: row.id,
          documentKey: `codex:${row.id}`,
          documentTitle: row.title || untitled(),
          documentOrder: row.createdAt,
          rowLabel: '',
          rowOrder: 0,
          ...codexTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.codexEntries.get(id);
      return row ? codexTarget(row) : undefined;
    },
  },

  dialog: {
    labelKey: 'projectReplace.scope.dialog',
    tables: [db.dialogBlocks],
    async each(projectId, visit) {
      // Scenes are the document a reader thinks in, and they are small rows —
      // no body, no base64 — so titling every block costs one cheap pass.
      const scenes = new Map<string, { title: string; order: number }>();
      await db.scenes.where('projectId').equals(projectId).each((scene) => {
        scenes.set(scene.id, { title: scene.title, order: scene.order });
      });
      await db.dialogBlocks.where('projectId').equals(projectId).each((row) => {
        const scene = scenes.get(row.sceneId);
        // An orphan block shows nowhere in the app; the search index drops it
        // for the same reason.
        if (!scene) return;
        visit({
          scope: 'dialog',
          id: row.id,
          documentKey: `dialog:${row.sceneId}`,
          documentTitle: scene.title || untitled(),
          documentOrder: scene.order,
          rowLabel: row.characterName || '',
          rowOrder: row.order,
          ...dialogTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.dialogBlocks.get(id);
      return row ? dialogTarget(row) : undefined;
    },
  },

  outline: {
    labelKey: 'projectReplace.scope.outline',
    tables: [db.outlineBeats],
    async each(projectId, visit) {
      const outlines = new Map<string, string>();
      await db.outlines.where('projectId').equals(projectId).each((outline) => {
        outlines.set(outline.id, outline.title);
      });
      await db.outlineBeats.where('projectId').equals(projectId).each((row) => {
        const title = outlines.get(row.outlineId);
        if (title === undefined) return;
        visit({
          scope: 'outline',
          id: row.id,
          documentKey: `outline:${row.outlineId}`,
          documentTitle: title || untitled(),
          documentOrder: 0,
          rowLabel: row.title || '',
          rowOrder: row.order,
          ...outlineTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.outlineBeats.get(id);
      return row ? outlineTarget(row) : undefined;
    },
  },

  notes: {
    labelKey: 'projectReplace.scope.notes',
    tables: [db.notes],
    async each(projectId, visit) {
      await db.notes.where('projectId').equals(projectId).each((row) => {
        const first = row.text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
        visit({
          scope: 'notes',
          id: row.id,
          documentKey: `notes:${row.id}`,
          documentTitle: first.slice(0, 80) || untitled(),
          documentOrder: row.createdAt,
          rowLabel: '',
          rowOrder: 0,
          ...noteTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.notes.get(id);
      return row ? noteTarget(row) : undefined;
    },
  },

  diary: {
    labelKey: 'projectReplace.scope.diary',
    tables: [db.diaryEntries],
    async each(projectId, visit) {
      await db.diaryEntries.where('projectId').equals(projectId).each((row) => {
        visit({
          scope: 'diary',
          id: row.id,
          documentKey: `diary:${row.id}`,
          documentTitle: row.title || row.entryDate || untitled(),
          documentOrder: row.createdAt,
          rowLabel: '',
          rowOrder: 0,
          ...diaryTarget(row),
        });
      });
    },
    async get(id) {
      const row = await db.diaryEntries.get(id);
      return row ? diaryTarget(row) : undefined;
    },
  },
};

/** The scope label a group header shows. */
export function replaceScopeLabelKey(scope: ReplaceScopeId): string {
  return SCOPES[scope].labelKey;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function occurrenceKey(rowKey: string, fieldId: string, ordinal: number): string {
  return `${rowKey}|${fieldId}|${ordinal}`;
}

/**
 * Find every occurrence in the project, without writing anything and without
 * ever holding more than one row.
 */
export async function scanProjectReplace(input: {
  projectId: string;
  term: string;
  options: MatchOptions;
  scopes: readonly ReplaceScopeId[];
}): Promise<ReplacePlan> {
  const plan: ReplacePlan = {
    projectId: input.projectId,
    term: input.term,
    options: input.options,
    scopes: REPLACE_SCOPES.filter((scope) => input.scopes.includes(scope)),
    documents: [],
    total: 0,
    splitTotal: 0,
    unlisted: 0,
    scanned: 0,
  };
  if (!input.term) return plan;

  const folded = gateFold(input.term);
  const groups = new Map<string, ReplaceDocument>();
  let listed = 0;

  for (const scope of plan.scopes) {
    await SCOPES[scope].each(input.projectId, (row) => {
      plan.scanned += 1;

      const rowKey = `${row.scope}:${row.id}`;
      // Every field is fingerprinted, matched or not: the guard has to cover
      // everything the apply pass might rewrite, not just today's hits.
      let fingerprint = FNV_OFFSET;
      let length = 0;
      for (const field of row.fields) {
        fingerprint = fingerprintOf(field.value, fingerprint);
        length += field.value.length;
      }

      let group: ReplaceDocument | null = null;
      let rowTotal = 0;
      let rowSplit = 0;

      for (const field of row.fields) {
        if (!mayMatch(field, folded)) continue;
        const index = indexField(field.value, field.html, input.term, input.options);
        if (index.matches.length === 0) continue;

        if (!group) {
          group = groups.get(row.documentKey) ?? null;
          if (!group) {
            group = {
              key: row.documentKey,
              scope: row.scope,
              title: row.documentTitle,
              order: row.documentOrder,
              rows: [],
              occurrences: [],
              total: 0,
              splitTotal: 0,
            };
            groups.set(row.documentKey, group);
          }
        }

        for (let ordinal = 0; ordinal < index.matches.length; ordinal += 1) {
          const match = index.matches[ordinal];
          const split = match.first !== match.last;
          if (split) rowSplit += 1;
          else rowTotal += 1;
          // Past either cap the occurrence is still counted exactly — it is
          // only the line of context and the individual checkbox that stop.
          if (listed >= MAX_LISTED_TOTAL) continue;
          if (group.occurrences.length >= MAX_LISTED_PER_DOCUMENT) continue;
          group.occurrences.push({
            key: occurrenceKey(rowKey, field.id, ordinal),
            rowKey,
            rowLabel: row.rowLabel,
            fieldLabelKey: field.labelKey,
            fieldLabelName: field.labelName,
            split,
            ...contextAround(index.plain, match.plainStart, match.plainEnd),
          });
          listed += 1;
        }
      }

      if (!group) return;
      group.rows.push({
        scope: row.scope,
        id: row.id,
        key: rowKey,
        order: row.rowOrder,
        total: rowTotal,
        fingerprint,
        length,
      });
      group.total += rowTotal;
      group.splitTotal += rowSplit;
      plan.total += rowTotal;
      plan.splitTotal += rowSplit;
    });
  }

  plan.documents = [...groups.values()].sort((left, right) => {
    const scopeGap = REPLACE_SCOPES.indexOf(left.scope) - REPLACE_SCOPES.indexOf(right.scope);
    if (scopeGap !== 0) return scopeGap;
    if (left.order !== right.order) return left.order - right.order;
    return left.title.localeCompare(right.title);
  });

  for (const group of plan.documents) {
    // Dialogue blocks and outline beats reach the cursor in index order, not in
    // reading order; a preview that jumps around the scene is unreadable. The
    // sort is stable, so occurrences inside one row keep their own order.
    const order = new Map(group.rows.map((row) => [row.key, row.order] as const));
    group.occurrences.sort(
      (left, right) => (order.get(left.rowKey) ?? 0) - (order.get(right.rowKey) ?? 0),
    );
    const listedHere = group.occurrences.filter((occurrence) => !occurrence.split).length;
    plan.unlisted += group.total - listedHere;
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Selection arithmetic — one source of truth for the button and the write
// ---------------------------------------------------------------------------

function excludedInRow(
  group: ReplaceDocument,
  rowKey: string,
  selection: ReplaceSelection,
): number {
  let excluded = 0;
  for (const occurrence of group.occurrences) {
    if (occurrence.split || occurrence.rowKey !== rowKey) continue;
    if (selection.excludedOccurrences.has(occurrence.key)) excluded += 1;
  }
  return excluded;
}

/** Rewritable occurrences a row still has after the writer's exclusions. */
function countSelectedInRow(
  group: ReplaceDocument,
  row: ReplaceRowRef,
  selection: ReplaceSelection,
): number {
  if (selection.excludedDocuments.has(group.key)) return 0;
  return Math.max(0, row.total - excludedInRow(group, row.key, selection));
}

export function countSelectedInDocument(
  group: ReplaceDocument,
  selection: ReplaceSelection,
): number {
  let total = 0;
  for (const row of group.rows) total += countSelectedInRow(group, row, selection);
  return total;
}

export function countSelectedReplacements(
  plan: ReplacePlan,
  selection: ReplaceSelection,
): { occurrences: number; documents: number } {
  let occurrences = 0;
  let documents = 0;
  for (const group of plan.documents) {
    const inDocument = countSelectedInDocument(group, selection);
    if (inDocument === 0) continue;
    occurrences += inDocument;
    documents += 1;
  }
  return { occurrences, documents };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

interface UndoRecord {
  batchId: string;
  projectId: string;
  expiresAt: number;
  /** Version snapshots taken for the writings this batch rewrote. */
  snapshotIds: string[];
  /**
   * One closure per row outside `writings`, each holding that row's own
   * pre-image and the typed write that puts it back. Tables with no version
   * history of their own have nowhere else to keep it.
   */
  rows: Array<() => Promise<void>>;
  /** Tables the undo writes through, and announces a change on. */
  tables: Table[];
}

/**
 * One slot, like the writings engine's own "undo the delete": only the last
 * batch can be taken back, and only for `UNDO_WINDOW_MS`. Anything
 * older is recovered the durable way — every rewritten writing has a version in
 * its history panel, and the app never prunes those.
 */
let pendingUndo: UndoRecord | null = null;

function liveUndo(): UndoRecord | null {
  if (!pendingUndo) return null;
  if (Date.now() > pendingUndo.expiresAt) {
    pendingUndo = null;
    return null;
  }
  return pendingUndo;
}

/** Give up the one-click undo — the version history is still there. */
export function forgetReplaceUndo(batchId?: string): void {
  if (!pendingUndo) return;
  if (batchId && pendingUndo.batchId !== batchId) return;
  pendingUndo = null;
}

/**
 * Put the batch back, in one transaction. Restoring a snapshot takes a
 * `pre-restore` version of the current text first, so undoing the undo is a
 * click in the history panel.
 */
export async function undoProjectReplace(batchId: string): Promise<number> {
  const record = liveUndo();
  if (!record || record.batchId !== batchId) return 0;

  const tables = new Map(record.tables.map((table) => [table.name, table] as const));
  if (record.snapshotIds.length > 0) {
    tables.set(db.writings.name, db.writings);
    tables.set(db.writingSnapshots.name, db.writingSnapshots);
  }

  let restored = 0;
  await db.transaction('rw', [...tables.values()], async () => {
    for (const snapshotId of record.snapshotIds) {
      if (await restoreSnapshot(snapshotId)) restored += 1;
    }
    for (const restore of record.rows) {
      await restore();
      restored += 1;
    }
  });

  pendingUndo = null;
  for (const name of tables.keys()) {
    notifyDataChanged({ source: 'undo', table: name, projectId: record.projectId });
  }
  return restored;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Snapshot a writing and hand back the id of the version that was created.
 *
 * `takeSnapshot` swallows its own errors and returns nothing, so "it worked"
 * has to be established rather than assumed — rewriting a chapter whose restore
 * point silently failed to be written is the one outcome this whole feature
 * exists to prevent. Comparing the primary keys of the chapter's history before
 * and after costs two index-only reads (no snapshot bodies are loaded) and
 * answers both questions at once: did it happen, and which row is it. A miss
 * throws, which aborts the transaction and leaves the project untouched.
 */
async function snapshotWriting(writing: Writing): Promise<string> {
  const keys = () => db.writingSnapshots.where('writingId').equals(writing.id).primaryKeys();
  const before = new Set((await keys()) as string[]);
  await takeSnapshot(writing, SNAPSHOT_REASON);
  const created = ((await keys()) as string[]).find((key) => !before.has(key));
  if (!created) {
    throw new Error(`projectReplace: no version was saved for writing ${writing.id}.`);
  }
  return created;
}

/**
 * Rewrite everything the writer selected, in ONE transaction.
 *
 * Every row is re-read here rather than trusted from the scan: the preview may
 * have been open for minutes, and a chapter edited in the meantime gets its
 * fingerprint mismatched and is left completely alone rather than having stale
 * offsets applied to text that moved.
 */
export async function applyProjectReplace(
  plan: ReplacePlan,
  replacement: string,
  selection: ReplaceSelection,
): Promise<ReplaceOutcome> {
  const work: Array<{ group: ReplaceDocument; row: ReplaceRowRef }> = [];
  const tables = new Map<string, Table>();
  for (const group of plan.documents) {
    for (const row of group.rows) {
      if (countSelectedInRow(group, row, selection) === 0) continue;
      work.push({ group, row });
      for (const table of SCOPES[row.scope].tables) tables.set(table.name, table);
    }
  }

  const outcome: ReplaceOutcome = {
    batchId: generateId('replace'),
    replaced: 0,
    documents: 0,
    rows: 0,
    snapshots: 0,
    skippedChanged: 0,
    undoAvailable: false,
    undoExpiresAt: 0,
  };
  if (work.length === 0) return outcome;

  const folded = gateFold(plan.term);
  const snapshotIds: string[] = [];
  const undoRows: UndoRecord['rows'] = [];
  const touched = new Set<string>();
  let undoCharacters = 0;

  await db.transaction('rw', [...tables.values()], async () => {
    for (const item of work) {
      const target = await SCOPES[item.row.scope].get(item.row.id);
      // Gone since the scan — a deleted chapter is not an error, it is one
      // fewer chapter to rewrite.
      if (!target) {
        outcome.skippedChanged += 1;
        continue;
      }

      let fingerprint = FNV_OFFSET;
      let length = 0;
      for (const field of target.fields) {
        fingerprint = fingerprintOf(field.value, fingerprint);
        length += field.value.length;
      }
      if (fingerprint !== item.row.fingerprint || length !== item.row.length) {
        outcome.skippedChanged += 1;
        continue;
      }

      const values = new Map<string, string>();
      let replacedHere = 0;
      for (const field of target.fields) {
        if (!mayMatch(field, folded)) continue;
        const index = indexField(field.value, field.html, plan.term, plan.options);
        let accepted = 0;
        const rewritten = rewriteField(index, replacement, (ordinal) => {
          const excluded = selection.excludedOccurrences.has(
            occurrenceKey(item.row.key, field.id, ordinal),
          );
          if (!excluded) accepted += 1;
          return !excluded;
        });
        if (rewritten === null) continue;
        values.set(field.id, rewritten);
        replacedHere += accepted;
      }
      if (values.size === 0) continue;

      // The restore point comes first. If it cannot be written, `snapshot`
      // throws and the whole transaction unwinds — no chapter is ever rewritten
      // without a version of what it said before.
      if (target.snapshot) {
        snapshotIds.push(await target.snapshot());
        outcome.snapshots += 1;
      }

      const committed = await target.commit(values);
      undoCharacters += committed.characters;
      if (committed.restore) undoRows.push(committed.restore);

      outcome.replaced += replacedHere;
      outcome.rows += 1;
      touched.add(item.group.key);
    }
  });

  outcome.documents = touched.size;
  if (outcome.rows === 0) return outcome;

  // A batch whose pre-images would sit in memory unbounded gets no one-click
  // undo at all, rather than a partial one that lies about its coverage. The
  // writings are still recoverable, for ever, from the versions taken above.
  if (undoCharacters <= UNDO_BUDGET_CHARACTERS) {
    pendingUndo = {
      batchId: outcome.batchId,
      projectId: plan.projectId,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
      snapshotIds,
      rows: undoRows,
      tables: [...tables.values()],
    };
    outcome.undoAvailable = true;
    outcome.undoExpiresAt = pendingUndo.expiresAt;
  }

  for (const name of tables.keys()) {
    notifyDataChanged({ source: 'other', table: name, projectId: plan.projectId });
  }
  return outcome;
}
