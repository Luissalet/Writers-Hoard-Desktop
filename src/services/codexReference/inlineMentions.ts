import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { CodexEntry } from '@/types';
import { createMentionIndex } from './indexedMentions';
import type { WordGloss } from '@/engines/dictionary/glosses';
import { codexTextLinkTarget } from '@/components/editor/codexBlocks/inlineLinks';

export const inlineMentionsKey = new PluginKey<DecorationSet>('codexInlineMentions');
export const OPEN_CODEX_REFERENCE = 'wh:open-codex-reference';
export interface OpenCodexReferenceDetail { projectId: string; entryId: string; scopeId?: string; handled: boolean }

/** Transient annotations use the shared indexed matcher and never alter saved prose. */
export function createInlineMentionsPlugin(entries: CodexEntry[], open: (id: string) => void, dictionaryMatches?: (text: string) => WordGloss[], preferences: { autoLinkMentions: boolean; animateNewLinks: boolean } = { autoLinkMentions: true, animateNewLinks: false }): Plugin<DecorationSet> {
  const index = createMentionIndex(entries);
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const decorate = (doc: ProseMirrorNode, existing?: DecorationSet) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, position, parent) => {
      if (!node.isText || !node.text || parent?.type.name === 'codeBlock' || node.marks.some(mark => mark.type.name === 'code')) return;
      const link = node.marks.find(mark => mark.type.name === 'link');
      if (link) {
        const owner = entries[0]?.projectId, id = owner && codexTextLinkTarget(String(link.attrs.href ?? ''), owner), entry = id ? entryMap.get(id) : undefined;
        if (entry && entry.projectId === owner) decorations.push(Decoration.inline(position, position + node.nodeSize, { class: 'wh-codex-mention', 'data-wh-codex-mention': entry.id, role: 'link', tabindex: '0', title: entry.title }));
        return;
      }
      if (!preferences.autoLinkMentions) return;
      const dictionary = dictionaryMatches?.(node.text) ?? [];
      for (const match of index.find(node.text)) {
        if (match.ambiguous || match.entryIds.length !== 1 || dictionary.some(word => word.from < match.to && word.to > match.from)) continue;
        const id = match.entryIds[0]; const entry = entryMap.get(id)!;
        const from = position + match.from, to = position + match.to;
        const animate = preferences.animateNewLinks && existing && !existing.find(from, to).some(decoration => decoration.from === from && decoration.to === to);
        decorations.push(Decoration.inline(position + match.from, position + match.to, {
          class: `wh-codex-mention${animate ? ' wh-codex-mention-animated' : ''}`, 'data-wh-codex-mention': id, role: 'link', tabindex: '0', title: entry.title,
          style: 'text-decoration:underline dotted; text-underline-offset:0.2em; cursor:pointer;',
        }));
      }
    });
    return DecorationSet.create(doc, decorations);
  };
  const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wh-codex-mention]')?.dataset.whCodexMention : undefined;
  return new Plugin({
    key: inlineMentionsKey,
    state: { init: (_, state) => decorate(state.doc), apply: (transaction, previous) => transaction.docChanged ? decorate(transaction.doc, previous.map(transaction.mapping, transaction.doc)) : previous },
    props: {
      decorations: state => inlineMentionsKey.getState(state),
      handleClick: (_view, _position, event) => { const id = target(event); if (!id) return false; event.preventDefault(); open(id); return true; },
      handleDOMEvents: {
        click: (_view, event) => { const id = target(event); if (!id) return false; event.preventDefault(); open(id); return true; },
        keydown: (_view, event) => { const id = target(event); if (event.key !== 'Enter' || !id) return false; event.preventDefault(); open(id); return true; },
      },
    },
  });
}
