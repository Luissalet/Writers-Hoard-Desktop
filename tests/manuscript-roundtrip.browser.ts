// Focused gate:
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs tests/manuscript-roundtrip.browser.ts runManuscriptRoundTripTests 120000 --no-sandbox
//
// The manuscript's Markdown exporter is also the AI bridge's reader: what it
// drops, a model that reads a chapter and writes it back drops for good.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import FindReplaceBar from '@/components/editor/FindReplaceBar';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

/** html → Markdown must read as `markdown`, and come back as the same html. */
function roundTrip(html: string, markdown: string, label: string): void {
  const written = htmlToMarkdown(html);
  assertEqual(written, markdown, `${label}: Markdown export`);
  assertEqual(markdownToTiptapHtml(written), html, `${label}: read back`);
}

function testMarkdownRoundTrip(): string {
  roundTrip(
    '<p>a <s>gone</s> b</p>',
    'a ~~gone~~ b',
    'strikethrough',
  );
  assertEqual(htmlToMarkdown('<p><del>x</del> <strike>y</strike></p>'), '~~x~~ ~~y~~', '<del>/<strike> lost their strike');
  roundTrip(
    '<pre><code class="language-js">const a = 1;\n\n\n  if (a &lt; 2) b();</code></pre><p>after <code>x</code></p>',
    '```js\nconst a = 1;\n\n\n  if (a < 2) b();\n```\n\nafter `x`',
    'fenced code block with language',
  );
  roundTrip(
    '<pre><code>plain\n*not emphasis*</code></pre>',
    '```\nplain\n*not emphasis*\n```',
    'fenced code block without language',
  );
  roundTrip(
    '<blockquote><p>one<br>two<br>three</p></blockquote>',
    '> one\n> two\n> three',
    'line breaks inside a blockquote',
  );
  roundTrip(
    '<p>typed &amp;lt;b&amp;gt; literally</p>',
    'typed &lt;b&gt; literally',
    'an escaped entity typed as text',
  );
  assertEqual(
    htmlToMarkdown('<blockquote><pre><code>q1\nq2</code></pre></blockquote>'),
    '> ```\n> q1\n> q2\n> ```',
    'a code block inside a quote lost the quote on its later lines',
  );
  return 'Markdown export keeps strikethrough, fenced code and quoted line breaks, and reads them back';
}

function editorWith(content: string): Editor {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content });
  // StarterKit's trailing node appends its paragraph on the first transaction
  // — in the app, long before anyone opens the find bar. Settle it here, or
  // the bar would open on a document that changes under it.
  editor.view.dispatch(editor.state.tr);
  return editor;
}

/** Open the real find bar on `editor`, searching `query`, and press Replace (or Replace all) with nothing typed. */
async function replaceWithNothing(editor: Editor, query: string, all: boolean): Promise<void> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(FindReplaceBar, {
      editor, initialQuery: query, anchor: 0, showReplace: true, focusToken: 0,
      onToggleReplace: () => undefined, onClose: () => undefined,
    }));
  });
  const replaceField = host.querySelectorAll('input')[1];
  const buttons = replaceField?.parentElement?.querySelectorAll('button');
  if (!buttons || buttons.length !== 2) throw new Error('the replace row did not render its two buttons');
  await act(async () => buttons[all ? 1 : 0].click());
  await act(async () => root.unmount());
  host.remove();
}

/**
 * The bar writes an empty replacement through `insertText("")`, which is
 * ProseMirror's `deleteRange`. That widens a range to whole nodes only when
 * the emptied node could not stay: a paragraph, heading or list item's text
 * can be empty, so only the text goes. Guarded here through the real bar.
 */
async function testEmptyReplacementKeepsBlocks(): Promise<string> {
  const paragraph = editorWith('<p>before</p><p>delete me</p><p>after</p>');
  await replaceWithNothing(paragraph, 'delete me', false);
  assertEqual(paragraph.getHTML(), '<p>before</p><p></p><p>after</p>', 'emptying a paragraph removed the paragraph');
  paragraph.destroy();

  const item = editorWith('<ul><li><p>one</p></li><li><p>gone</p></li><li><p>three</p></li></ul>');
  await replaceWithNothing(item, 'gone', false);
  assertEqual(item.getHTML(), '<ul><li><p>one</p></li><li><p></p></li><li><p>three</p></li></ul><p></p>', 'emptying a list item removed the item');
  item.destroy();

  const all = editorWith('<ul><li><p>one</p></li><li><p>gone</p></li></ul><h2>gone</h2><blockquote><p>gone</p></blockquote><p>gone</p>');
  await replaceWithNothing(all, 'gone', true);
  assertEqual(
    all.getHTML(),
    '<ul><li><p>one</p></li><li><p></p></li></ul><h2></h2><blockquote><p></p></blockquote><p></p>',
    'Replace all with nothing removed a block',
  );
  all.destroy();
  return 'Replace with nothing empties the matched text and leaves its paragraph, heading or list item';
}

export async function runManuscriptRoundTripTests(): Promise<string[]> {
  return [testMarkdownRoundTrip(), await testEmptyReplacementKeepsBlocks()];
}
