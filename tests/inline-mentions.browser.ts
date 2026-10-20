import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createInlineMentionsPlugin } from '@/services/codexReference/inlineMentions';
import type { CodexEntry } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testInlineMentions(): Promise<string[]> {
  const entry = (id: string, title: string, aliases = ''): CodexEntry => ({ id, title, fields: { aliases }, projectId: 'synthetic', type: 'character', content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
  const host = document.createElement('div'); document.body.append(host);
  const entries = [entry('ana', 'Ana Ruiz', '["Anita","Ána"]'), entry('other', 'Otra Ana', '["Ána"]'), entry('port', 'Puerto del Sol')];
  const editor = new Editor({ element: host, extensions: [StarterKit.configure({ trailingNode: false })], content: '<p>Anita Ána ANITA Puerto del Sol. <code>Anita</code> <a href="https://example.com">Anita</a></p><pre><code>Anita</code></pre>' });
  try {
    const original = editor.getHTML(); let opened = '';
    editor.registerPlugin(createInlineMentionsPlugin(entries, id => { opened = id; }, text => text.includes('Puerto del Sol') ? [{ from: text.indexOf('Puerto del Sol'), to: text.indexOf('Puerto del Sol') + 14 }] as never : []));
    let links = host.querySelectorAll<HTMLElement>('[data-wh-codex-mention]');
    assert(links.length === 2 && [...links].every(link => link.dataset.whCodexMention === 'ana'), 'Unique aliases match case-insensitively; ambiguous aliases, dictionary overlaps, code and links remain untouched');
    links[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(opened === 'ana' && editor.getHTML() === original, 'Keyboard navigation must preserve prose and serialization');
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Anita</p>');
    links = host.querySelectorAll('[data-wh-codex-mention]'); assert(links.length === 3, 'Typing recomputes annotations');
    editor.commands.undo(); assert(editor.getHTML() === original && host.querySelectorAll('[data-wh-codex-mention]').length === 2, `Native undo restores only the author edit: ${editor.getHTML()} vs ${original}; count ${host.querySelectorAll('[data-wh-codex-mention]').length}`);
    return ['Inline Codex mentions: aliases/ambiguity/whole matches and dictionary/code/link exclusions', 'Inline Codex mentions: keyboard navigation, live recomputation, original HTML and independent undo'];
  } finally { editor.destroy(); host.remove(); }
}
