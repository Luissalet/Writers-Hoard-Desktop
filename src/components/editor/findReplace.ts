import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Find & replace inside the open document.
 *
 * Every match is a ProseMirror decoration, so searching never touches the
 * document: it cannot dirty a chapter, cannot enter the undo history, and
 * cannot reach `onChange`. Only Replace writes, and it writes one transaction.
 *
 * Matching is accent-insensitive unless asked otherwise — the writers here
 * work in Spanish, and typing "cancion" must find "canción". Folding with
 * NFD + combining-mark removal changes string length (é → e + ́ ), so the
 * folded text carries a per-character map back to document positions instead
 * of pretending the two strings line up.
 */

export interface SearchMatch {
  from: number;
  to: number;
}

export interface MatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Off by default: with it off, "cancion" finds "canción". */
  matchDiacritics: boolean;
}

const MATCH_CLASS = 'wh-find-match';
export const CURRENT_CLASS = 'wh-find-current';

/** Not typable in a text field, so no query can ever span a block boundary. */
const BLOCK_SEPARATOR = '\u0000';
const COMBINING_MARKS = /\p{M}/gu;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

interface DocumentIndex {
  /** Folded text of the whole document. */
  text: string;
  /** Document position where the source character behind text[i] starts. */
  start: number[];
  /** Document position just after that source character. */
  end: number[];
}

function fold(character: string, options: MatchOptions): string {
  let folded = character;
  if (!options.matchDiacritics) folded = folded.normalize('NFD').replace(COMBINING_MARKS, '');
  if (!options.caseSensitive) folded = folded.toLowerCase();
  return folded;
}

function foldQuery(query: string, options: MatchOptions): string {
  let folded = '';
  for (const character of query) folded += fold(character, options);
  return folded;
}

function buildIndex(doc: ProseMirrorNode, options: MatchOptions): DocumentIndex {
  let text = '';
  const start: number[] = [];
  const end: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const raw = node.text ?? '';
      let offset = 0;
      // By code point, not by code unit: a folded character can be one, none
      // (a lone combining mark) or several (İ lowercases to two), and each
      // piece has to remember where in the document it came from.
      for (const character of raw) {
        const from = pos + offset;
        const to = from + character.length;
        const folded = fold(character, options);
        for (let piece = 0; piece < folded.length; piece += 1) {
          start.push(from);
          end.push(to);
        }
        text += folded;
        offset += character.length;
      }
      return false;
    }
    // A paragraph break is not nothing: without a separator, "the" ending one
    // paragraph and "end" opening the next would match "theend".
    if ((node.isBlock || node.isLeaf) && text.length > 0 && !text.endsWith(BLOCK_SEPARATOR)) {
      text += BLOCK_SEPARATOR;
      start.push(pos);
      end.push(pos);
    }
    return true;
  });

  return { text, start, end };
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  options: MatchOptions,
): SearchMatch[] {
  const needle = foldQuery(query, options);
  if (!needle) return [];

  const index = buildIndex(doc, options);
  const matches: SearchMatch[] = [];
  let at = index.text.indexOf(needle);

  while (at !== -1) {
    const stop = at + needle.length;
    const whole =
      !isWordCharacter(index.text[at - 1]) && !isWordCharacter(index.text[stop]);
    if (!options.wholeWord || whole) {
      matches.push({ from: index.start[at], to: index.end[stop - 1] });
      // Matches never overlap: replacing overlapping ranges would corrupt the
      // text. A hit rejected by the whole-word test advances a single
      // character instead, so a candidate starting inside it is still seen.
      at = index.text.indexOf(needle, stop);
    } else {
      at = index.text.indexOf(needle, at + 1);
    }
  }

  return matches;
}

interface SearchDecorationMeta {
  matches: SearchMatch[];
  current: number;
}

export const searchPluginKey = new PluginKey<DecorationSet>('whFindReplace');

function decorate(doc: ProseMirrorNode, meta: SearchDecorationMeta): DecorationSet {
  if (meta.matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    meta.matches.map((match, position) =>
      Decoration.inline(match.from, match.to, {
        class: position === meta.current ? `${MATCH_CLASS} ${CURRENT_CLASS}` : MATCH_CLASS,
      }),
    ),
  );
}

/** Hand a fresh set of matches to the plugin. Carries no document change. */
export function searchDecorations(
  tr: Transaction,
  matches: SearchMatch[],
  current: number,
): Transaction {
  return tr.setMeta(searchPluginKey, { matches, current } satisfies SearchDecorationMeta);
}

export function createSearchPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: searchPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, value) {
        const meta = tr.getMeta(searchPluginKey) as SearchDecorationMeta | undefined;
        if (meta) return decorate(tr.doc, meta);
        // Between an edit and the recount that follows it, keep the existing
        // highlights on the text they were drawn over.
        return tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
      },
    },
    props: {
      decorations: (state) => searchPluginKey.getState(state) ?? DecorationSet.empty,
    },
  });
}
