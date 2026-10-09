// The Writings "Consultar" panel against a real TipTap editor and a real database:
// matching by name and alias, debounce, preview without losing the selection,
// pins that survive a remount, the width preference and the narrow drawer.
//
//   npm run test:reference
import { act, StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import ReferencePanel from '@/engines/writings/components/ReferencePanel';
import { useReferencePrefs } from '@/engines/writings/components/referencePrefs';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rowNames = () =>
  [...document.querySelectorAll('[data-testid="reference-row"]')].map(
    (row) => row.querySelector('.font-semibold')?.textContent ?? '',
  );

let liveEditor: Editor | null = null;

function Harness({ projectId, writingId, html, narrowBreakpoint }: { projectId: string; writingId: string; html: string; narrowBreakpoint: number }) {
  const prefs = useReferencePrefs();
  const [content, setContent] = useState(html);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mount) return;
    const instance = new Editor({
      element: mount,
      extensions: [StarterKit],
      content: html,
      onUpdate: ({ editor: e }) => setContent(e.getHTML()),
    });
    liveEditor = instance;
    setEditor(instance);
    return () => {
      instance.destroy();
      liveEditor = null;
    };
    // The editor is built once per mount, like the chapter editor's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount]);
  return (
    <div>
      <div ref={setMount} data-testid="harness-editor" />
      <ReferencePanel
        projectId={projectId}
        writingId={writingId}
        content={content}
        editor={editor}
        prefs={prefs}
        narrowBreakpoint={narrowBreakpoint}
      />
    </div>
  );
}

export async function testCodexReferencePanel(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `reference-${Date.now()}`;
  const W = `${P}-chapter`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;
  const render = async (narrowBreakpoint: number, html: string) => {
    await act(async () => {
      root ??= createRoot(host);
      root.render(<StrictMode><Harness projectId={P} writingId={W} html={html} narrowBreakpoint={narrowBreakpoint} /></StrictMode>);
      await pause(120);
    });
    await act(async () => { await pause(150); });
  };
  const unmount = async () => {
    await act(async () => { root?.unmount(); root = null; await pause(); });
  };
  const waitFor = async (what: string, test: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await act(async () => { await pause(40); });
    }
    throw new Error(`Timed out waiting for ${what}. Rows: ${JSON.stringify(rowNames())}`);
  };
  const click = async (target: HTMLElement | null | undefined, label: string) => {
    assert(target, `Missing ${label}`);
    await act(async () => { target.click(); await pause(60); });
  };
  const key = async (target: Element, init: KeyboardEventInit) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await pause(60); });
  };

  window.localStorage.removeItem('writers-hoard:reference:panel');
  window.localStorage.removeItem(`writers-hoard:reference:pins:${W}`);
  try {
    const engines = ['writings', 'codex'];
    await db.projects.add({ id: P, title: 'Reference test', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
    const entry = (id: string, type: CodexEntry['type'], title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id: `${P}-${id}`, projectId: P, type, title, fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra });
    await db.codexEntries.bulkAdd([
      entry('ana', 'character', 'Ana Ruiz', { fields: { Aliases: 'Anita', Edad: '31' }, content: '<p>Cartógrafa del puerto.</p><p>Odia el mar.</p>' }),
      entry('faro', 'location', 'El Faro', { content: '<p>Torre blanca sobre el acantilado.</p>' }),
      entry('marta', 'character', 'Marta', { content: '<p>La hermana de Ana.</p>' }),
    ]);

    // ---- closed by default, opens by shortcut, lists what the chapter mentions ------------------------
    await render(1, '<p>Anita subió hasta el faro de noche.</p>');
    assert(byTestId('reference-toggle')?.getAttribute('aria-expanded') === 'false', 'the panel starts collapsed');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, altKey: true, bubbles: true })); await pause(80); });
    assert(byTestId('reference-toggle')?.getAttribute('aria-expanded') === 'true', 'Ctrl+Alt+R opens the panel');
    await waitFor('the mentioned entries', () => rowNames().length === 2);
    assert(rowNames().includes('Ana Ruiz') && rowNames().includes('El Faro') && !rowNames().includes('Marta'), `rows are the two mentioned entries, got ${rowNames()}`);
    assert(/mencionado|mentioned/.test(byTestId('reference-list')?.textContent ?? ''), 'rows say "mentioned", nothing stronger');
    assert(document.querySelector('[data-testid="reference-row"] button[aria-label]'), 'rows have aria-labels');
    passed.push('panel opens with Ctrl+Alt+R and lists the entries mentioned by name or alias (Anita -> Ana Ruiz)');

    // ---- typing a third name adds it after the debounce -----------------------------------------------
    const editor = liveEditor!;
    await act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size, ' Marta esperaba.'); await pause(100); });
    assert(!rowNames().includes('Marta'), 'the new name is not matched before the debounce');
    await waitFor('Marta after the debounce', () => rowNames().includes('Marta'), 3000);
    passed.push('typing a third name adds its entry after the debounce');

    // ---- preview keeps the editor selection -----------------------------------------------------------
    await act(async () => { editor.commands.setTextSelection({ from: 2, to: 6 }); editor.view.focus(); await pause(40); });
    const before = { from: editor.state.selection.from, to: editor.state.selection.to };
    const faroRow = document.querySelector<HTMLElement>(`[data-entry-id="${P}-faro"] button`);
    await act(async () => {
      faroRow!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      faroRow!.click();
      await pause(80);
    });
    const preview = byTestId('reference-preview');
    assert(preview && /Torre blanca/.test(preview.textContent ?? ''), 'the full entry opens inside the panel');
    assert(editor.state.selection.from === before.from && editor.state.selection.to === before.to, 'opening the preview kept the editor selection');
    await key(document.activeElement ?? preview, { key: 'Escape' });
    assert(!byTestId('reference-preview'), 'Escape closes the preview');
    assert(editor.view.hasFocus(), 'focus returns to the editor');
    assert(editor.state.selection.from === before.from && editor.state.selection.to === before.to, 'the selection survived Escape');
    passed.push('preview opens in the panel, Escape closes it, focus returns to the editor and the selection is intact');

    // ---- search reaches entries the chapter does not mention -----------------------------------------
    const search = byTestId('reference-search') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'puerto');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(60);
    });
    assert(byTestId('reference-results')?.textContent?.includes('Ana Ruiz'), 'search finds entries by their body text');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(60);
    });
    passed.push('the search box looks up entries beyond the mentioned ones');

    // ---- pins come first and survive a remount --------------------------------------------------------
    await waitFor('rows back', () => rowNames().length >= 3);
    const order = rowNames();
    const last = order[order.length - 1];
    const lastRow = [...document.querySelectorAll('[data-testid="reference-row"]')].find((row) => row.querySelector('.font-semibold')?.textContent === last)!;
    await click(lastRow.querySelector<HTMLElement>('[data-testid="reference-pin"]'), 'pin button');
    assert(rowNames()[0] === last, `the pinned entry moves first (${rowNames()})`);
    assert(lastRow.querySelector('[data-testid="reference-pin"]')?.getAttribute('aria-pressed') === 'true' || document.querySelector('[data-testid="reference-pin"][aria-pressed="true"]'), 'the pin button reports aria-pressed');
    await unmount();
    await render(1, '<p>Anita subió hasta el faro de noche. Marta esperaba.</p>');
    await waitFor('rows after remount', () => rowNames().length >= 3);
    assert(rowNames()[0] === last, 'the pin persists after a remount');
    passed.push('pins sort first, expose aria-pressed and persist per chapter across a remount');

    // ---- width persists -------------------------------------------------------------------------------
    const separator = byTestId('reference-resize');
    assert(separator, 'a resize separator exists in column mode');
    const width0 = Number(separator.getAttribute('aria-valuenow'));
    await key(separator, { key: 'ArrowLeft' });
    assert(Number(byTestId('reference-resize')!.getAttribute('aria-valuenow')) === width0 + 20, 'ArrowLeft widens the panel');
    assert(JSON.parse(window.localStorage.getItem('writers-hoard:reference:panel') ?? '{}').width === width0 + 20, 'the width is stored');
    passed.push('panel width is adjustable by keyboard and persisted');

    // ---- narrow window: overlay drawer ----------------------------------------------------------------
    await unmount();
    await render(99999, '<p>Anita subió.</p>');
    const drawer = byTestId('reference-panel');
    assert(drawer?.getAttribute('data-mode') === 'drawer' && drawer.getAttribute('role') === 'dialog', 'a narrow window shows the panel as a drawer');
    assert(byTestId('reference-backdrop'), 'the drawer has a backdrop');
    await key(byTestId('reference-search')!, { key: 'Escape' });
    assert(!byTestId('reference-backdrop') && JSON.parse(window.localStorage.getItem('writers-hoard:reference:panel') ?? '{}').open === false, 'Escape closes the drawer and the choice persists');
    passed.push('below 940px the panel is an overlay drawer that Escape closes');
  } finally {
    await unmount();
    window.localStorage.removeItem('writers-hoard:reference:panel');
    window.localStorage.removeItem(`writers-hoard:reference:pins:${W}`);
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
