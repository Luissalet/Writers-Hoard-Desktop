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
import { getReferenceUi, setReferenceConsult, useReferencePrefs } from '@/engines/writings/components/referencePrefs';
import { migrateLocalPins, readPins } from '@/services/codexReference/pins';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';

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

interface HarnessProps {
  projectId: string;
  writingId: string;
  html: string;
  narrowBreakpoint: number;
  mode?: 'docked' | 'temporary';
  /** Leave content out so the panel reads the text from the editor, as the whole-book editor does. */
  fromEditor?: boolean;
}

function Harness({ projectId, writingId, html, narrowBreakpoint, mode, fromEditor }: HarnessProps) {
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
        content={fromEditor ? undefined : content}
        editor={editor}
        prefs={prefs}
        mode={mode}
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
  const render = async (narrowBreakpoint: number, html: string, extra: Partial<HarnessProps> = {}) => {
    await act(async () => {
      root ??= createRoot(host);
      root.render(<StrictMode><Harness projectId={P} writingId={W} html={html} narrowBreakpoint={narrowBreakpoint} {...extra} /></StrictMode>);
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

    const mention: OpenCodexReferenceDetail = { projectId: P, entryId: `${P}-faro`, scopeId: `${W}-other`, handled: false };
    await act(async () => { window.dispatchEvent(new CustomEvent(OPEN_CODEX_REFERENCE, { detail: mention })); await pause(); });
    assert(!mention.handled && !byTestId('reference-preview'), 'A mention belongs only to its editor scope');
    mention.scopeId = W;
    await act(async () => { window.dispatchEvent(new CustomEvent(OPEN_CODEX_REFERENCE, { detail: mention })); await pause(); });
    assert(mention.handled && byTestId('reference-preview')?.textContent?.includes('Torre blanca'), 'Scoped inline mention opens the local panel and consumes navigation');
    await key(document.activeElement ?? byTestId('reference-preview')!, { key: 'Escape' });
    assert(editor.state.selection.from === before.from && editor.state.selection.to === before.to, 'Inline mention preview preserves manuscript selection');
    passed.push('inline mention events open only their project/editor panel and preserve the manuscript selection');

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
    const pinRow = await db.referencePins.get(W);
    assert(pinRow && pinRow.projectId === P && pinRow.entryIds.length === 1, 'the pin is a referencePins row of the project');
    assert(window.localStorage.getItem(`writers-hoard:reference:pins:${W}`) === null, 'nothing is kept in localStorage any more');
    passed.push('pins sort first, expose aria-pressed and persist per chapter across a remount, as project data');

    // ---- pins survive a project backup and restore ------------------------------------------------------
    const pinnedIds = [...pinRow.entryIds];
    const archive = await createProjectZipArchive(P);
    await db.referencePins.delete(W);
    assert(!(await db.referencePins.get(W)), 'the pin row is gone before the restore');
    await importProjectZip(new File([archive.blob], 'reference-project.zip'), { replaceProjectIds: [P] });
    const restoredPins = await db.referencePins.get(W);
    assert(restoredPins && restoredPins.entryIds.join() === pinnedIds.join(), `the pin came back from the backup, got ${JSON.stringify(restoredPins)}`);
    assert((await readPins(P, W)).join() === pinnedIds.join(), 'readPins reads the restored pin');
    passed.push('pins are exported with the project backup and restored by an import');

    // ---- localStorage pins from before move into the table once ------------------------------------------
    const W2 = `${P}-old-chapter`;
    await db.writings.add({ id: W2, projectId: P, title: 'Old chapter', status: 'draft', content: '<p>x</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now });
    window.localStorage.setItem(`writers-hoard:reference:pins:${W2}`, JSON.stringify([`${P}-ana`, 7]));
    window.localStorage.setItem('writers-hoard:reference:pins:no-such-chapter', JSON.stringify([`${P}-faro`]));
    const moved = await migrateLocalPins();
    assert(moved === 1, `one chapter's pins moved, got ${moved}`);
    assert((await db.referencePins.get(W2))?.entryIds.join() === `${P}-ana`, 'the old pins arrived (junk dropped)');
    assert(window.localStorage.getItem(`writers-hoard:reference:pins:${W2}`) === null && window.localStorage.getItem('writers-hoard:reference:pins:no-such-chapter') === null, 'the old keys are gone, including that of a chapter that no longer exists');
    assert((await migrateLocalPins()) === 0, 'the migration runs once');
    const W3 = `${P}-lazy`;
    window.localStorage.setItem(`writers-hoard:reference:pins:${W3}`, JSON.stringify([`${P}-faro`]));
    assert((await readPins(P, W3)).join() === `${P}-faro`, 'reading a scope adopts its old pins');
    assert(window.localStorage.getItem(`writers-hoard:reference:pins:${W3}`) === null && (await db.referencePins.get(W3)), 'and moves them to the table');
    await db.referencePins.bulkDelete([W2, W3]);
    passed.push('old localStorage pins are migrated to project data once, by scan or on first read');

    // ---- the pin write never touches the chapter row --------------------------------------------------------
    const chapterBefore = await db.writings.get(W2);
    const { setPinned } = await import('@/services/codexReference/pins');
    await setPinned(P, W2, `${P}-faro`, true);
    const chapterAfter = await db.writings.get(W2);
    assert(chapterAfter?.updatedAt === chapterBefore?.updatedAt && chapterAfter?.content === chapterBefore?.content, 'pinning leaves the chapter row alone (no revision bump)');
    await db.referencePins.delete(W2);
    await db.writings.delete(W2);
    passed.push('pinning writes its own table and never the chapter row');

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
    // Narrow: the docked preference is still "open" from before, but a drawer is a consult, so it starts closed
    // and the only thing on screen is the floating button (never an in-flow header at the end of the chapter).
    assert(getReferenceUi().open === true, 'the docked preference is still open');
    assert(!byTestId('reference-panel') && byTestId('reference-toggle')?.getAttribute('data-mode') === 'floating', 'narrow and closed: only the floating button');
    await click(byTestId('reference-toggle'), 'floating button');
    const drawer = byTestId('reference-panel');
    assert(drawer?.getAttribute('data-mode') === 'drawer' && drawer.getAttribute('role') === 'dialog', 'a narrow window shows the panel as a drawer');
    assert(byTestId('reference-backdrop'), 'the docked drawer has a backdrop');
    await key(byTestId('reference-search')!, { key: 'Escape' });
    assert(!byTestId('reference-backdrop') && !byTestId('reference-panel') && getReferenceUi().consult === false, 'Escape closes the drawer');
    assert(getReferenceUi().open === true, 'closing the consult does not change the docked preference');
    passed.push('below the editor grid breakpoint the panel is a drawer behind a floating button, and Escape closes it without touching the docked preference');

    // ---- temporary consult (focus mode / whole book): over the text, no backdrop, text from the editor --------
    await unmount();
    await render(1, '<p>Anita subió al faro. Marta esperaba.</p>', { mode: 'temporary', fromEditor: true });
    assert(!byTestId('reference-panel') && byTestId('reference-toggle')?.getAttribute('data-mode') === 'floating', 'temporary mode shows only the floating button, even on a wide window');
    const book = liveEditor!;
    await act(async () => { book.commands.setTextSelection({ from: 3, to: 9 }); book.view.focus(); await pause(40); });
    const selection = { from: book.state.selection.from, to: book.state.selection.to };
    const floating = byTestId('reference-toggle')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => { floating.dispatchEvent(down); floating.click(); await pause(100); });
    assert(down.defaultPrevented, 'pressing the button does not take focus from the editor');
    assert(byTestId('reference-panel')?.getAttribute('data-temporary') === 'true' && !byTestId('reference-backdrop'), 'the temporary drawer has no backdrop');
    assert(book.state.selection.from === selection.from && book.state.selection.to === selection.to, 'opening the consult kept the selection');
    await waitFor('mentions read from the editor text', () => rowNames().includes('Ana Ruiz') && rowNames().includes('Marta'));
    assert(getReferenceUi().open === true && JSON.parse(window.localStorage.getItem('writers-hoard:reference:panel') ?? '{}').open === true, 'the temporary consult is not a preference');
    // Typing in the editor while the drawer is open keeps matching live.
    await act(async () => { book.commands.insertContentAt(book.state.doc.content.size, ' El Faro.'); await pause(50); });
    await waitFor('the editor text is re-read', () => rowNames().includes('El Faro'), 3000);
    await act(async () => { book.commands.setTextSelection({ from: selection.from, to: selection.to }); book.view.focus(); await pause(30); });
    // Escape typed in the text closes the drawer (capture phase), selection intact.
    await key(book.view.dom, { key: 'Escape' });
    assert(!byTestId('reference-panel') && getReferenceUi().consult === false, 'Escape from the text closes the consult drawer');
    assert(book.state.selection.from === selection.from && book.state.selection.to === selection.to, 'the selection survived');
    // The bridge-side setter opens the very same drawer.
    await act(async () => { setReferenceConsult(true); await pause(60); });
    assert(byTestId('reference-panel'), 'setReferenceConsult(true) opens the drawer the screen shows');
    await act(async () => { setReferenceConsult(false); await pause(60); });
    assert(!byTestId('reference-panel'), 'setReferenceConsult(false) closes it');
    passed.push('temporary consult: floating button, no backdrop, selection kept, text read from the editor, Escape from the text, same state as the bridge');

    // ---- notes and library beyond the codex, read-only ---------------------------------------------------------
    await db.notes.add({ id: `${P}-note`, projectId: P, kind: 'quote', text: 'Cartas del puerto\nLlegan de noche.', source: 'Diario', tags: ['mar'], pinned: false, createdAt: now, updatedAt: now });
    await db.citations.add({ id: `${P}-cite`, projectId: P, title: 'Guía del puerto viejo', authors: ['R. Costa'], accessedAt: '2026-10-09', notes: 'Muelles y almacenes.', writingIds: [], tags: [], createdAt: now, updatedAt: now });
    await unmount();
    await render(1, '<p>Anita subió.</p>');
    const search2 = byTestId('reference-search') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search2, 'puerto');
      search2.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(400);
    });
    await waitFor('note and citation results', () => document.querySelectorAll('[data-testid="reference-source-row"]').length === 2);
    const kinds = [...document.querySelectorAll('[data-testid="reference-source-row"]')].map((row) => row.getAttribute('data-source-kind')).sort().join();
    assert(kinds === 'citation,note', `both a note and a citation are offered, got ${kinds}`);
    assert(!document.querySelector('[data-testid="reference-source-row"] [data-testid="reference-pin"]'), 'sources are not pinnable');
    await click(document.querySelector('[data-source-kind="note"] button'), 'note row');
    const sourcePreview = byTestId('reference-source-preview');
    assert(sourcePreview && /Llegan de noche/.test(sourcePreview.textContent ?? '') && /Diario/.test(sourcePreview.textContent ?? ''), 'the note opens in the panel with its text and source');
    assert(!sourcePreview.querySelector('input, textarea, [contenteditable="true"]'), 'the preview has no editing controls');
    await key(document.activeElement ?? sourcePreview, { key: 'Escape' });
    assert(!byTestId('reference-source-preview'), 'Escape closes the source preview');
    assert((await db.notes.get(`${P}-note`))?.updatedAt === now && (await db.citations.get(`${P}-cite`))?.updatedAt === now, 'looking things up wrote nothing');
    passed.push('search reaches the project notes and library with a read-only preview');
  } finally {
    await db.notes.where('projectId').equals(P).delete();
    await db.citations.where('projectId').equals(P).delete();
    await db.referencePins.where('projectId').equals(P).delete();
    await db.writings.where('projectId').equals(P).delete();
    await unmount();
    window.localStorage.removeItem('writers-hoard:reference:panel');
    window.localStorage.removeItem(`writers-hoard:reference:pins:${W}`);
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
