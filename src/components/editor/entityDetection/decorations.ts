import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import type { EntitySpan } from '@/services/entityDetection/types';
export const entityCandidatesKey = new PluginKey<DecorationSet>('entityCandidates');
export interface EntitySnapshot { text: string; segments: Array<{ from: number; to: number; position: number }>; doc: Node }
export function entitySnapshot(doc: Node): EntitySnapshot {
  let text = '', previousEnd = -1; const segments: EntitySnapshot['segments'] = [];
  doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text) return;
    if (previousEnd !== position && text) text += '\n';
    const from = text.length; text += node.text; previousEnd = position + node.nodeSize;
    if (parent?.type.name !== 'codeBlock' && !node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) segments.push({ from, to: text.length, position });
  }); return { text, segments, doc };
}
export function createEntityCandidatesPlugin(open: (index: number) => void) {
  return new Plugin<DecorationSet>({
    key: entityCandidatesKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        const update = transaction.getMeta(entityCandidatesKey) as { snapshot: EntitySnapshot; candidates: EntitySpan[] } | undefined;
        if (!update) return transaction.docChanged ? DecorationSet.empty : previous;
        if (update.snapshot.doc !== transaction.doc) return DecorationSet.empty;
        const marks: Decoration[] = [];
        update.candidates.forEach((candidate, index) => {
          for (const segment of update.snapshot.segments) {
            const from = Math.max(candidate.from, segment.from), to = Math.min(candidate.to, segment.to);
            if (to > from) marks.push(Decoration.inline(segment.position + from - segment.from, segment.position + to - segment.from, { class: 'wh-entity-candidate', 'data-wh-entity-candidate': String(index), role: 'button', tabindex: '0', title: candidate.text }));
          }
        }); return DecorationSet.create(transaction.doc, marks);
      },
    },
    props: {
      decorations: state => entityCandidatesKey.getState(state),
      handleDOMEvents: {
        click: (_view, event) => { const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wh-entity-candidate]') : null; if (!element) return false; event.preventDefault(); open(Number(element.dataset.whEntityCandidate)); return true; },
        keydown: (_view, event) => { const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wh-entity-candidate]') : null; if (!element || !['Enter', ' '].includes(event.key)) return false; event.preventDefault(); open(Number(element.dataset.whEntityCandidate)); return true; },
      },
    },
  });
}
