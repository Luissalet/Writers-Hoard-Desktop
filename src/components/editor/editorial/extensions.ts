import { Extension, Node, type AnyExtension } from '@tiptap/core';
import { EDITORIAL_ATTRIBUTES as A, normalizeEditorialStyle, normalizeEditorialSection, normalizeEditorialCitation, parseEditorialAttribute, serializeEditorialMetadata } from './model';

const StyleDefinition = Node.create({
  name: 'editorialStyleDefinition', group: 'block', atom: true, selectable: false,
  addAttributes: () => ({ definition: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: `div[${A.styleDefinition}]`, getAttrs: element => { const definition = parseEditorialAttribute(element, A.styleDefinition, normalizeEditorialStyle); return definition ? { definition } : false; } }],
  renderHTML: ({ node }) => ['div', { [A.styleDefinition]: serializeEditorialMetadata(normalizeEditorialStyle(node.attrs.definition)), hidden: 'hidden', 'aria-hidden': 'true' }],
});
const Section = Node.create({
  name: 'editorialSection', group: 'block', atom: true,
  addAttributes: () => ({ config: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: `div[${A.section}]`, getAttrs: element => { const config = parseEditorialAttribute(element, A.section, normalizeEditorialSection); return config ? { config } : false; } }],
  renderHTML: ({ node }) => ['div', { [A.section]: serializeEditorialMetadata(normalizeEditorialSection(node.attrs.config)), class: 'wh-editorial-section', contenteditable: 'false' }],
  onCreate() {
    const document = this.editor.view.dom.ownerDocument;
    if (document.getElementById('wh-editorial-section-css')) return;
    const style = document.createElement('style'); style.id = 'wh-editorial-section-css';
    style.textContent = '.ProseMirror .wh-editorial-section{border-top:1px dashed var(--color-border,#888);min-height:1.5em;color:var(--color-text-secondary,#888)}.ProseMirror .wh-editorial-section::before{content:"§"}';
    document.head.appendChild(style);
  },
});
const Citation = Node.create({
  name: 'editorialCitation', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ citation: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: `span[${A.citation}]`, getAttrs: element => { const citation = parseEditorialAttribute(element, A.citation, normalizeEditorialCitation); return citation ? { citation } : false; } }],
  renderHTML: ({ node }) => ['span', { [A.citation]: serializeEditorialMetadata(normalizeEditorialCitation(node.attrs.citation)), class: 'wh-editorial-citation' }, String(node.attrs.citation?.label ?? '')],
  renderText: ({ node }) => String(node.attrs.citation?.label ?? ''),
});
const Attributes = Extension.create({
  name: 'editorialAttributes',
  addGlobalAttributes: () => [
    { types: ['paragraph', 'heading'], attributes: {
      editorialStyleId: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute(A.styleId), renderHTML: (attrs: Record<string, unknown>) => typeof attrs.editorialStyleId === 'string' && attrs.editorialStyleId ? { [A.styleId]: attrs.editorialStyleId } : {} },
      editorialBibliography: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute(A.bibliography), renderHTML: (attrs: Record<string, unknown>) => typeof attrs.editorialBibliography === 'string' && attrs.editorialBibliography ? { [A.bibliography]: attrs.editorialBibliography } : {} },
    } },
  ],
  onCreate() {
    const document = this.editor.view.dom.ownerDocument; if (document.getElementById('wh-editorial-css')) return;
    const style = document.createElement('style'); style.id = 'wh-editorial-css';
    style.textContent = '.ProseMirror [data-wh-editorial-style]{display:none}.wh-editorial-section{border-top:1px dashed var(--color-border,#888);color:var(--color-text-muted,#888);height:1.5em;margin:.5em 0}.wh-editorial-citation{color:var(--color-accent-gold,#a88544)}@media print{.wh-editorial-section{display:none}}';
    document.head.appendChild(style);
  },
});
export function createEditorialExtensions(): AnyExtension[] { return [StyleDefinition, Section, Citation, Attributes]; }
