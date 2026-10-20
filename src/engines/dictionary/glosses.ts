import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { nativeWord, type WorldDictionary } from './types';

export const dictionaryGlossKey = new PluginKey<DecorationSet>('dictionaryGlosses');

export interface WordGloss { from: number; to: number; wordId: string; title: string }

export function createGlossMatcher(dictionaries: WorldDictionary[]): (text: string) => WordGloss[] {
  const terms = new Map<string, { id: string; title: string }>();
  for (const dictionary of dictionaries.filter(item => item.detectInManuscript)) {
    for (const word of dictionary.words) {
      const title = [dictionary.name, [word.word, nativeWord(word, dictionary.scriptMapping), word.pronunciation, word.partOfSpeech].filter(Boolean).join(' · '), word.meaning].join('\n');
      for (const spelling of new Set([word.word.trim(), nativeWord(word, dictionary.scriptMapping).trim()])) {
        if (!spelling || spelling.length > 300) continue;
        const key = spelling.toLowerCase();
        const existing = terms.get(key);
        terms.set(key, { id: existing?.id ?? word.id, title: existing ? `${existing.title}\n\n${title}` : title });
      }
    }
  }
  if (!terms.size) return () => [];
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...terms.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return text => {
    pattern.lastIndex = 0;
    const result: WordGloss[] = [];
    for (const match of text.matchAll(pattern)) {
      const term = terms.get(match[0].toLowerCase());
      if (term) result.push({ from: match.index, to: match.index + match[0].length, wordId: term.id, title: term.title });
    }
    return result;
  };
}

/** Read-only decorations: never persist markup, change the document, or poll a server. */
export function createDictionaryGlossPlugin(dictionaries: WorldDictionary[], onOpen: (wordId: string) => void): Plugin<DecorationSet> {
  const match = createGlossMatcher(dictionaries);
  const decorate = (doc: ProseMirrorNode) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos, parent) => {
      if (!node.isText || !node.text || parent?.type.name === 'codeBlock' || node.marks.some(mark => ['link', 'code'].includes(mark.type.name))) return;
      for (const gloss of match(node.text)) decorations.push(Decoration.inline(pos + gloss.from, pos + gloss.to, {
        class: 'dictionary-gloss', 'data-dictionary-word': gloss.wordId, title: gloss.title, role: 'link', tabindex: '0',
        style: 'text-decoration: underline dotted; text-underline-offset: 0.2em; cursor: help;',
      }));
    });
    return DecorationSet.create(doc, decorations);
  };
  const targetWord = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-dictionary-word]')?.dataset.dictionaryWord : undefined;
  return new Plugin({
    key: dictionaryGlossKey,
    state: { init: (_, state) => decorate(state.doc), apply: (transaction, value) => transaction.docChanged ? decorate(transaction.doc) : value },
    props: {
      decorations: state => dictionaryGlossKey.getState(state),
      handleClick: (_view, _pos, event) => { const id = targetWord(event.target); if (!id) return false; event.preventDefault(); onOpen(id); return true; },
      handleDOMEvents: { keydown: (_view, event) => { const id = targetWord(event.target); if (!id || event.key !== 'Enter') return false; event.preventDefault(); onOpen(id); return true; } },
    },
  });
}
