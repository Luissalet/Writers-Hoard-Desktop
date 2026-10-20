import { Mark } from '@tiptap/core';

export const WikiHidden = Mark.create({
  name: 'wikiHidden', excludes: 'wikiSpoiler',
  parseHTML: () => [{ tag: 'span[data-wh-wiki-hidden="true"]' }],
  renderHTML: () => ['span', { 'data-wh-wiki-hidden': 'true', class: 'wh-wiki-hidden' }, 0],
});
export const WikiSpoiler = Mark.create({
  name: 'wikiSpoiler', excludes: 'wikiHidden',
  parseHTML: () => [{ tag: 'span[data-wh-wiki-spoiler="true"]' }],
  renderHTML: () => ['span', { 'data-wh-wiki-spoiler': 'true', class: 'wh-wiki-spoiler' }, 0],
});
