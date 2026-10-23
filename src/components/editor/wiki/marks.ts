import { Extension, Mark } from '@tiptap/core';

export const WikiHidden = Mark.create({
  name: 'wikiHidden', excludes: 'wikiSpoiler',
  parseHTML: () => [{ tag: 'span[data-wh-wiki-hidden="true"]' }],
  renderHTML: () => ['span', { 'data-wh-wiki-hidden': 'true', class: 'wh-wiki-hidden' }, 0],
});
/** The blocks a whole paragraph, heading, quote, list or story block can be kept out of the wiki as. */
export const WIKI_HIDDEN_BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'callout', 'checklist', 'toggleBlock', 'messageBubble', 'letterBlock', 'emailBlock', 'prepCheck', 'prepEncounter', 'prepHandout', 'image'] as const;
/** A whole block kept out of the published wiki: the same marker the wiki already removes. */
export const WikiHiddenBlock = Extension.create({
  name: 'wikiHiddenBlock',
  addGlobalAttributes() {
    return [{ types: [...WIKI_HIDDEN_BLOCK_TYPES], attributes: { wikiHidden: { default: false, parseHTML: element => element.getAttribute('data-wh-wiki-hidden') === 'true' && element.tagName !== 'SPAN', renderHTML: attributes => (attributes.wikiHidden ? { 'data-wh-wiki-hidden': 'true', class: 'wh-wiki-hidden-block' } : {}) } } }];
  },
});
export const WikiSpoiler = Mark.create({
  name: 'wikiSpoiler', excludes: 'wikiHidden',
  parseHTML: () => [{ tag: 'span[data-wh-wiki-spoiler="true"]' }],
  renderHTML: () => ['span', { 'data-wh-wiki-spoiler': 'true', class: 'wh-wiki-spoiler' }, 0],
});
