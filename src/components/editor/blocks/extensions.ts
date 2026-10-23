// Writing blocks: callouts (note, info, question, tip, warning), checklists
// and toggles. Stored as plain semantic HTML (aside / ul+li / details) with
// data attributes, so the reader, the wiki and every export keep them.
import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const CALLOUT_KINDS = ['note', 'info', 'question', 'tip', 'warning', 'readaloud', 'sidebar'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];
const isCalloutKind = (value: unknown): value is CalloutKind => (CALLOUT_KINDS as readonly unknown[]).includes(value);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writingBlocks: {
      setCallout: (kind: CalloutKind) => ReturnType;
      setChecklist: () => ReturnType;
      setToggle: () => ReturnType;
      setMessage: (side: 'sent' | 'received') => ReturnType;
      setLetter: () => ReturnType;
      setEmail: (attrs?: { from?: string; to?: string; subject?: string; date?: string }) => ReturnType;
      insertColumnBreak: () => ReturnType;
      setTextEffect: (effect: TextEffectName | null) => ReturnType;
      setAttributedQuote: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'note', parseHTML: element => { const value = element.getAttribute('data-wh-callout'); return isCalloutKind(value) ? value : 'note'; }, renderHTML: attributes => ({ 'data-wh-callout': isCalloutKind(attributes.kind) ? attributes.kind : 'note' }) } };
  },
  parseHTML: () => [{ tag: 'aside[data-wh-callout]' }],
  renderHTML: ({ HTMLAttributes, node }) => ['aside', mergeAttributes(HTMLAttributes, { class: `wh-callout wh-callout-${isCalloutKind(node.attrs.kind) ? node.attrs.kind : 'note'}` }), 0],
  addCommands() {
    return { setCallout: (kind: CalloutKind) => ({ commands }) => commands.wrapIn(this.name, { kind }) };
  },
});

export const CheckItem = Node.create({
  name: 'checkItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes() {
    return { checked: { default: false, keepOnSplit: false, parseHTML: element => element.getAttribute('data-checked') === 'true', renderHTML: attributes => ({ 'data-checked': attributes.checked ? 'true' : 'false' }) } };
  },
  parseHTML: () => [{ tag: 'ul[data-wh-checklist] > li', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes, { class: 'wh-check-item' }), 0],
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    };
  },
  addProseMirrorPlugins() {
    // A click on the box at the start of an item ticks it.
    return [new Plugin({
      key: new PluginKey('whCheckItemToggle'),
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            const item = (event.target as HTMLElement | null)?.closest?.('li.wh-check-item') as HTMLElement | null;
            if (!item || !view.editable) return false;
            const box = item.getBoundingClientRect();
            if (event.clientX - box.left > 22) return false;
            const pos = view.posAtDOM(item, 0) - 1;
            const node = pos >= 0 ? view.state.doc.nodeAt(pos) : null;
            if (!node || node.type.name !== 'checkItem') return false;
            event.preventDefault();
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
            return true;
          },
        },
      },
    })];
  },
});

export const Checklist = Node.create({
  name: 'checklist',
  group: 'block list',
  content: 'checkItem+',
  parseHTML: () => [{ tag: 'ul[data-wh-checklist]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['ul', mergeAttributes(HTMLAttributes, { 'data-wh-checklist': 'true', class: 'wh-checklist' }), 0],
  addCommands() {
    return { setChecklist: () => ({ commands }) => commands.toggleList(this.name, 'checkItem') };
  },
});

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML: () => [{ tag: 'details[data-wh-toggle] > summary' }],
  renderHTML: ({ HTMLAttributes }) => ['summary', mergeAttributes(HTMLAttributes), 0],
});

export const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'toggleSummary block+',
  defining: true,
  parseHTML: () => [{ tag: 'details[data-wh-toggle]' }],
  // Kept open so its content can be written; a reader folds it with a click.
  renderHTML: ({ HTMLAttributes }) => ['details', mergeAttributes(HTMLAttributes, { 'data-wh-toggle': 'true', class: 'wh-toggle', open: 'open' }), 0],
  addProseMirrorPlugins() {
    // A click on the title places the caret instead of folding the block while writing.
    return [new Plugin({ key: new PluginKey('whToggleSummary'), props: { handleDOMEvents: { click: (_view, event) => { if ((event.target as HTMLElement | null)?.closest?.('details.wh-toggle > summary')) event.preventDefault(); return false; } } } })];
  },
  addCommands() {
    return {
      setToggle: () => ({ state, chain }) => {
        const { $from } = state.selection;
        const title = $from.parent.textContent;
        const node = { type: this.name, content: [{ type: 'toggleSummary', content: title ? [{ type: 'text', text: title }] : [] }, { type: 'paragraph' }] };
        // The line it is made from becomes its title.
        return $from.parent.type.name === 'paragraph' && $from.depth > 0
          ? chain().insertContentAt({ from: $from.before(), to: $from.after() }, node).run()
          : chain().insertContent(node).run();
      },
    };
  },
});

/** A text message in a chat, sent (right) or received (left), with who sends it. */
export const MessageBubble = Node.create({
  name: 'messageBubble',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      side: { default: 'received', parseHTML: element => (element.getAttribute('data-wh-message') === 'sent' ? 'sent' : 'received'), renderHTML: attributes => ({ 'data-wh-message': attributes.side === 'sent' ? 'sent' : 'received' }) },
      sender: { default: '', parseHTML: element => (element.getAttribute('data-wh-sender') ?? '').slice(0, 60), renderHTML: attributes => (attributes.sender ? { 'data-wh-sender': String(attributes.sender).slice(0, 60) } : {}) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-wh-message]' }],
  renderHTML: ({ HTMLAttributes, node }) => ['div', mergeAttributes(HTMLAttributes, { class: `wh-message wh-message-${node.attrs.side === 'sent' ? 'sent' : 'received'}` }), 0],
  addCommands() {
    return { setMessage: (side: 'sent' | 'received') => ({ commands }) => commands.wrapIn(this.name, { side }) };
  },
});

/** A letter or a note in the story, set apart on its own paper. */
export const LetterBlock = Node.create({
  name: 'letterBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-wh-letter]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-wh-letter': 'true', class: 'wh-letter' }), 0],
  addCommands() {
    return { setLetter: () => ({ commands }) => commands.wrapIn(this.name) };
  },
});

const headerText = (value: unknown) => Array.from(String(value ?? ''), char => (char.charCodeAt(0) < 32 ? ' ' : char)).join('').slice(0, 120);
/** An email in the story: who sent it, to whom, the subject and the date over its body. */
export const EmailBlock = Node.create({
  name: 'emailBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    const field = (name: string) => ({ default: '', parseHTML: (element: HTMLElement) => headerText(element.getAttribute(`data-wh-${name}`)), renderHTML: (attributes: Record<string, unknown>) => (attributes[name] ? { [`data-wh-${name}`]: headerText(attributes[name]) } : {}) });
    return { from: field('from'), to: field('to'), subject: field('subject'), date: field('date') };
  },
  parseHTML: () => [{ tag: 'div[data-wh-email]' }],
  // The header is drawn from the attributes (CSS), so the body stays the only editable text.
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-wh-email': 'true', class: 'wh-email' }), 0],
  addCommands() {
    return { setEmail: (attrs?: { from?: string; to?: string; subject?: string; date?: string }) => ({ commands }) => commands.wrapIn(this.name, attrs ?? {}) };
  },
});

/** Text effects for the screen: glow, shake, wave, rainbow, pulse, and blur (shown on hover). Print and Word set the text plain. */
export const TEXT_EFFECTS = ['glow', 'shake', 'wave', 'rainbow', 'pulse', 'blur'] as const;
export type TextEffectName = typeof TEXT_EFFECTS[number];
const isTextEffect = (value: unknown): value is TextEffectName => (TEXT_EFFECTS as readonly unknown[]).includes(value);
export const TextEffect = Mark.create({
  name: 'textEffect',
  addAttributes() {
    return { effect: { default: 'glow', parseHTML: element => { const value = element.getAttribute('data-wh-effect'); return isTextEffect(value) ? value : 'glow'; }, renderHTML: attributes => ({ 'data-wh-effect': isTextEffect(attributes.effect) ? attributes.effect : 'glow' }) } };
  },
  parseHTML: () => [{ tag: 'span[data-wh-effect]' }],
  renderHTML: ({ HTMLAttributes, mark }) => ['span', mergeAttributes(HTMLAttributes, { class: `wh-effect wh-effect-${isTextEffect(mark.attrs.effect) ? mark.attrs.effect : 'glow'}` }), 0],
  addCommands() {
    return { setTextEffect: (effect: TextEffectName | null) => ({ commands }) => (effect && isTextEffect(effect) ? commands.setMark(this.name, { effect }) : commands.unsetMark(this.name)) };
  },
});

/** A spell, magic item or creature box filled from a Codex card (see engines/codex/rulesCards). Its text is ordinary, editable prose; the card id and slot mapping let it be filled again. */
export const RulesCard = Node.create({
  name: 'rulesCard', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return {
      layout: { default: 'spell', parseHTML: element => { const value = element.getAttribute('data-wh-rules-card'); return value === 'item' || value === 'creature' ? value : 'spell'; }, renderHTML: attributes => ({ 'data-wh-rules-card': attributes.layout }) },
      entry: { default: '', parseHTML: element => (element.getAttribute('data-wh-entry') ?? '').slice(0, 200), renderHTML: attributes => (attributes.entry ? { 'data-wh-entry': attributes.entry } : {}) },
      slots: { default: '{}', parseHTML: element => { const value = element.getAttribute('data-wh-slots') ?? '{}'; try { return value.length <= 4000 && JSON.parse(value) && typeof JSON.parse(value) === 'object' ? value : '{}'; } catch { return '{}'; } }, renderHTML: attributes => ({ 'data-wh-slots': attributes.slots }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-wh-rules-card]' }],
  renderHTML: ({ HTMLAttributes, node }) => ['div', mergeAttributes(HTMLAttributes, { class: `wh-rules-card wh-rules-card-${node.attrs.layout}` }), 0],
});

/** In a two-column page (a sourcebook), what follows starts at the top of the next column. */
export const ColumnBreak = Node.create({
  name: 'columnBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-wh-column-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-wh-column-break': 'true', class: 'wh-column-break' })],
  addCommands() { return { insertColumnBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) }; },
});

/** Who said it: the line under a quote, set right with a dash. */
export const QuoteAttribution = Node.create({
  name: 'quoteAttribution',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML: () => [{ tag: 'p[data-wh-attribution]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['p', mergeAttributes(HTMLAttributes, { 'data-wh-attribution': 'true', class: 'wh-attribution' }), 0],
  addCommands() {
    return {
      setAttributedQuote: () => ({ state, chain }) => {
        const { $from } = state.selection;
        const text = $from.parent.textContent;
        const node = { type: 'blockquote', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }, { type: this.name }] };
        return $from.parent.type.name === 'paragraph' && $from.depth > 0 ? chain().insertContentAt({ from: $from.before(), to: $from.after() }, node).run() : chain().insertContent(node).run();
      },
    };
  },
});

export function createWritingBlockExtensions(): AnyExtension[] {
  return [Callout, Checklist, CheckItem, ToggleBlock, ToggleSummary, MessageBubble, LetterBlock, EmailBlock, ColumnBreak, RulesCard, TextEffect, QuoteAttribution, ImageLayout];
}


/** 'page' spans every column of a two-column page; elsewhere it is the full width. */
export const IMAGE_WIDTHS = ['25', '50', '75', '100', 'page'] as const;
export const IMAGE_FRAMES = ['none', 'border', 'rounded', 'polaroid'] as const;
/** Width and frame of an image in a chapter, kept as data on the <img>. */
export const ImageLayout = Extension.create({
  name: 'whImageLayout',
  addGlobalAttributes() {
    return [{ types: ['image'], attributes: {
      width: { default: null, parseHTML: element => { const value = element.getAttribute('data-wh-width'); return (IMAGE_WIDTHS as readonly (string | null)[]).includes(value) ? value : null; }, renderHTML: attributes => (attributes.width ? { 'data-wh-width': attributes.width } : {}) },
      frame: { default: null, parseHTML: element => { const value = element.getAttribute('data-wh-frame'); return (IMAGE_FRAMES as readonly (string | null)[]).includes(value) && value !== 'none' ? value : null; }, renderHTML: attributes => (attributes.frame ? { 'data-wh-frame': attributes.frame } : {}) },
    } }];
  },
});
