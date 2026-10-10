// "Consultar" in the real WritingsView and BookEditor, against the app's own
// compiled CSS, at the window sizes where it used to go wrong.
//
//   npm run test:reference:ui
//
// What it proves, with real layout (not a simulation):
//   * the docked/drawer switch follows the editor's own two-column grid (1024px,
//     1440px in page mode): there is no width where the panel sits underneath a
//     long chapter;
//   * at 940x600 and 390px opening the panel puts it inside the viewport at
//     once, with no scrolling and no horizontal overflow;
//   * focus mode and the whole-book editor get a temporary consult drawer that
//     keeps the selection, closes with Escape without leaving focus mode, and
//     shares its state, pins and entities with the bridge tools;
//   * width and the docked preference survive a remount.
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { db } from '@/db';
import type { CodexEntry, Writing } from '@/types';
import { t } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { getReferenceUi, setReferenceConsult } from '@/engines/writings/components/referencePrefs';
import WritingsView from '@/engines/writings/components/WritingsView';

declare global {
  interface Window {
    __want?: { w: number; h: number; n: number } | null;
    __sizeAck?: number;
    __shot?: { name: string } | null;
    __shotDone?: string;
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rowIds = () => [...document.querySelectorAll('[data-testid="reference-row"]')].map((row) => row.getAttribute('data-entry-id') ?? '');
const PANEL = 'reference-panel';

let sizeCounter = 0;
async function setViewport(w: number, h: number): Promise<void> {
  sizeCounter += 1;
  const n = sizeCounter;
  window.__want = { w, h, n };
  const end = Date.now() + 8000;
  // Inside act: the resize flips matchMedia, and the panel's state follows.
  await act(async () => {
    while (window.__sizeAck !== n) {
      if (Date.now() > end) throw new Error(`The window never resized to ${w}x${h}`);
      await pause(20);
    }
    await pause(150);
    const settle = Date.now() + 4000;
    while (Math.abs(window.innerWidth - w) > 1 && Date.now() < settle) await pause(30);
  });
  assert(Math.abs(window.innerWidth - w) <= 1, `expected a ${w}px window, got ${window.innerWidth}`);
}
async function shot(name: string): Promise<void> {
  window.__shotDone = undefined;
  window.__shot = { name };
  const end = Date.now() + 8000;
  while (window.__shotDone !== name) {
    if (Date.now() > end) return;
    await pause(20);
  }
}
const inViewport = (rect: DOMRect) =>
  rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
const noHorizontalScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1;
/** Which elements poke out past the right edge, for a failure message. */
const overflowReport = () =>
  `scrollWidth ${document.documentElement.scrollWidth} > ${window.innerWidth}: ` +
  [...document.querySelectorAll<HTMLElement>('body *')]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
    .slice(0, 6)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}@${Math.round(el.getBoundingClientRect().right)}`)
    .join(' | ');

const paragraph = (i: number) =>
  `<p>Párrafo ${i}. La lluvia caía sobre el puerto y nadie salió a mirar el mar aquella noche, mientras las barcas dormían amarradas y el viento recorría los muelles vacíos sin encontrar a nadie.</p>`;

export async function testReferenceLayout(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `reference-layout-${Date.now()}`;
  const W1 = `${P}-one`;
  const W2 = `${P}-two`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;

  const entry = (id: string, type: CodexEntry['type'], title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({
    id: `${P}-${id}`, projectId: P, type, title, fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra,
  });
  const chapter = (id: string, title: string, n: number, html: string): Writing => ({
    id, projectId: P, title, status: 'draft', content: html, wordCount: 900, chapter: n, tags: [], createdAt: now, updatedAt: now,
  });

  const mount = async (path: string) => {
    const rows = await db.writings.where('projectId').equals(P).toArray();
    await act(async () => {
      root ??= createRoot(host);
      root.render(
        <StrictMode>
          <MemoryRouter initialEntries={[path]}>
            <WritingsView
              projectId={P}
              writings={rows}
              onAdd={async () => undefined}
              onEdit={async () => undefined}
              onDelete={async () => undefined}
              onRefresh={async () => undefined}
            />
          </MemoryRouter>
        </StrictMode>,
      );
      await pause(300);
    });
    await act(async () => { await pause(300); });
  };
  const unmount = async () => {
    await act(async () => { root?.unmount(); root = null; await pause(60); });
  };
  const waitFor = async (what: string, test: () => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await act(async () => { await pause(40); });
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const click = async (target: Element | null | undefined, label: string) => {
    assert(target, `Missing ${label}`);
    await act(async () => { (target as HTMLElement).click(); await pause(120); });
  };
  const key = async (target: EventTarget, init: KeyboardEventInit) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await pause(100); });
  };
  const editorOf = () => (document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
  const call = async (name: string, args: Record<string, unknown>) => {
    const handler = TOOL_HANDLERS[name];
    assert(handler, `no bridge tool ${name}`);
    return await act(async () => handler(args)) as Record<string, unknown>;
  };
  const toggle = () => byTestId('reference-toggle');

  window.localStorage.removeItem('writers-hoard:reference:panel');
  await useAppStore.getState().setReading({ layout: 'flow' });
  try {
    const engines = ['writings', 'codex'];
    await db.projects.add({ id: P, title: 'Reference layout', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
    await db.codexEntries.bulkAdd([
      entry('ana', 'character', 'Ana Ruiz', { fields: { Aliases: 'Anita' }, content: '<p>Cartógrafa del puerto.</p>' }),
      entry('faro', 'location', 'El Faro', { content: '<p>Torre blanca sobre el acantilado.</p>' }),
      entry('marta', 'character', 'Marta', { content: '<p>La hermana de Ana.</p>' }),
      entry('ghost', 'character', 'Carmelo Ghost', { content: '<p>Solo aparece en una idea suelta.</p>' }),
    ]);
    const longChapter = `<p>Anita llegó al faro.</p>${Array.from({ length: 90 }, (_, i) => paragraph(i + 1)).join('')}<p>Marta esperaba al final.</p>`;
    await db.writings.bulkAdd([chapter(W1, 'Capítulo uno', 1, longChapter), chapter(W2, 'Capítulo dos', 2, '<p>Marta cerró la puerta de El Faro.</p>'),
      // An idea outside the manuscript (no chapter number): it names Carmelo Ghost, but it is not book text.
      { ...chapter(`${P}-idea`, 'Idea suelta', 0, '<p>Carmelo Ghost espera fuera del manuscrito.</p>'), chapter: undefined, status: 'idea' as const }]);

    // ---- wide window: docked in the side column ------------------------------------------------------------
    await setViewport(1280, 800);
    await mount(`/project/${P}/writings?writing=${W1}`);
    await waitFor('the chapter editor', () => Boolean(editorOf()) && Boolean(toggle()));
    assert(getComputedStyle(toggle()!).position !== 'fixed', 'at 1280 the closed panel is the docked header, not a floating button');
    await click(toggle(), 'docked toggle');
    await waitFor('the docked mentions', () => rowIds().length === 2);
    let panel = byTestId(PANEL)!;
    assert(panel.getAttribute('data-mode') === 'column', 'at 1280 the panel is docked in the column');
    const editorRect = (document.querySelector('.ProseMirror') as HTMLElement).getBoundingClientRect();
    assert(panel.getBoundingClientRect().left >= editorRect.right - 2, 'the docked panel sits beside the text, not under it');
    assert(editorRect.height > window.innerHeight * 2, `the test chapter must be long (height ${Math.round(editorRect.height)})`);
    await act(async () => { window.scrollTo(0, 100000); await pause(200); });
    panel = byTestId(PANEL)!;
    assert(inViewport(panel.getBoundingClientRect()) || (panel.getBoundingClientRect().top >= 0 && panel.getBoundingClientRect().top < window.innerHeight), 'the docked panel stays in view at the end of a long chapter (sticky)');
    await shot('docked-1280');
    await act(async () => { window.scrollTo(0, 0); await pause(100); });
    passed.push('1280px: docked beside the text and still in view at the end of a 90-paragraph chapter');

    // ---- the docked/drawer switch follows the editor grid (1024, and 1440 in page mode) ------------------------
    await setViewport(1023, 700);
    await waitFor('drawer at 1023', () => !byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating');
    await setViewport(1024, 700);
    await waitFor('column at 1024', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column');
    await setViewport(1000, 700);
    await waitFor('drawer at 1000', () => !byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating');
    const floating1000 = toggle()!.getBoundingClientRect();
    assert(inViewport(floating1000), 'the floating button is inside the viewport at 1000px');
    await act(async () => { window.scrollTo(0, 100000); await pause(150); });
    assert(inViewport(toggle()!.getBoundingClientRect()), 'and still inside it at the end of the chapter');
    await act(async () => { window.scrollTo(0, 0); await pause(100); });
    passed.push('breakpoints: column from 1024px (the editor grid), drawer with a floating button below it (the old 940px gap is gone)');

    await useAppStore.getState().setReading({ layout: 'page' });
    await setViewport(1280, 800);
    await waitFor('drawer in page mode at 1280', () => !byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating');
    await setViewport(1440, 800);
    await waitFor('column in page mode at 1440', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column');
    await useAppStore.getState().setReading({ layout: 'flow' });
    await setViewport(1280, 800);
    await waitFor('column again in flow mode', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column');
    passed.push('page mode moves the switch to 1440px, where the sheet and the column fit side by side');

    // ---- 940x600: the panel opens inside the viewport, no scrolling ------------------------------------------------
    await setViewport(940, 600);
    await waitFor('drawer at 940', () => !byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating');
    assert(noHorizontalScroll(), `no horizontal scroll at 940x600 (${overflowReport()})`);
    const ed = editorOf()!;
    await act(async () => { ed.commands.setTextSelection({ from: 3, to: 9 }); ed.view.focus(); await pause(60); });
    const sel = { from: ed.state.selection.from, to: ed.state.selection.to };
    const scrollBefore = window.scrollY;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => { toggle()!.dispatchEvent(down); toggle()!.click(); await pause(150); });
    assert(down.defaultPrevented, 'the button does not steal focus');
    await waitFor('the open drawer', () => Boolean(byTestId(PANEL)) && rowIds().length === 2);
    const drawer = byTestId(PANEL)!;
    assert(drawer.getAttribute('data-mode') === 'drawer', 'at 940 the open panel is a drawer');
    assert(inViewport(drawer.getBoundingClientRect()), `the open panel is inside the 940x600 viewport: ${JSON.stringify(drawer.getBoundingClientRect())}`);
    assert(window.scrollY === scrollBefore, 'opening the panel did not scroll the page');
    assert(ed.state.selection.from === sel.from && ed.state.selection.to === sel.to, 'the selection survived opening');
    assert(noHorizontalScroll(), 'no horizontal scroll with the drawer open');
    await shot('drawer-940x600');
    await key(ed.view.dom, { key: 'Escape' });
    assert(!byTestId(PANEL), 'Escape from the text closes the drawer');
    assert(ed.state.selection.from === sel.from, 'and the selection is still there');
    passed.push('940x600: floating button -> drawer inside the viewport, no scroll, no horizontal overflow, selection kept, Escape closes');

    // ---- 390px (phone width) ---------------------------------------------------------------------------------------
    await setViewport(390, 700);
    await waitFor('floating button at 390', () => !byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating');
    assert(noHorizontalScroll(), `no horizontal scroll at 390px (${overflowReport()})`);
    assert(inViewport(toggle()!.getBoundingClientRect()), 'the floating button fits a 390px window');
    await click(toggle(), 'floating button at 390');
    await waitFor('the 390 drawer', () => Boolean(byTestId(PANEL)));
    const phone = byTestId(PANEL)!.getBoundingClientRect();
    assert(inViewport(phone) && phone.width <= 390 - 12, `the drawer fits a 390px window with a margin: ${phone.width}`);
    assert(noHorizontalScroll(), 'no horizontal scroll with the drawer open at 390px');
    await shot('drawer-390');
    await click(byTestId('reference-close'), 'drawer close button');
    assert(!byTestId(PANEL), 'the close button closes the drawer');
    passed.push('390px: the floating button and the drawer fit the window with no horizontal overflow');

    // ---- focus mode: temporary consult over the page --------------------------------------------------------------------
    await setViewport(1280, 800);
    await waitFor('docked again', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column');
    const focusButton = document.querySelector<HTMLButtonElement>(`button[aria-label="${t('writings.focusMode')}"]`);
    assert(focusButton && focusButton.getAttribute('aria-pressed') === 'false', 'the focus button is named and reports aria-pressed=false');
    await click(focusButton, 'focus mode button');
    await waitFor('focus mode', () => Boolean(document.querySelector('[data-focus-mode]')));
    const exitButton = document.querySelector<HTMLButtonElement>(`button[aria-label="${t('writings.exitFocusMode')}"]`);
    assert(exitButton?.getAttribute('aria-pressed') === 'true', 'in focus mode the same button reports aria-pressed=true');
    assert(!byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating', 'focus mode has no docked column: just the floating button');
    const focusEditor = editorOf()!;
    await act(async () => { focusEditor.commands.setTextSelection({ from: 3, to: 9 }); focusEditor.view.focus(); await pause(60); });
    const focusSel = { from: focusEditor.state.selection.from, to: focusEditor.state.selection.to };
    await key(window, { key: 'r', ctrlKey: true, altKey: true });
    await waitFor('consult drawer in focus mode', () => byTestId(PANEL)?.getAttribute('data-temporary') === 'true');
    assert(!byTestId('reference-backdrop'), 'no backdrop: the text stays editable behind the drawer');
    await waitFor('the consult rows', () => rowIds().length === 2);
    assert(focusEditor.state.selection.from === focusSel.from && focusEditor.state.selection.to === focusSel.to, 'the selection survived opening the consult');
    // Typing still reaches the text while the drawer is open.
    await act(async () => { focusEditor.commands.insertContentAt(focusEditor.state.doc.content.size, '<p>Fin.</p>'); await pause(80); });
    assert(focusEditor.getText().includes('Fin.'), 'the text is editable with the drawer open');
    await act(async () => { focusEditor.commands.setTextSelection({ from: focusSel.from, to: focusSel.to }); focusEditor.view.focus(); await pause(30); });
    await shot('focus-consult-1280');
    await key(focusEditor.view.dom, { key: 'Escape' });
    assert(!byTestId(PANEL) && document.querySelector('[data-focus-mode]'), 'Escape closes the drawer and focus mode stays');
    assert(focusEditor.state.selection.from === focusSel.from, 'the selection is intact');
    await key(focusEditor.view.dom, { key: 'Escape' });
    await waitFor('leaving focus mode', () => !document.querySelector('[data-focus-mode]'));
    passed.push('focus mode: named aria-pressed button, floating consult, no backdrop, selection kept, first Escape closes the drawer and the second leaves focus mode');

    // ---- the bridge drives the same panel -------------------------------------------------------------------------
    await waitFor('docked panel after focus mode', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column' && rowIds().length === 2);
    const mentions = (await call('wh_chapter_references', { writingId: W1 })).mentions as Array<{ id: string }>;
    assert([...rowIds()].sort().join() === mentions.map((m) => m.id).sort().join(), 'the UI rows and wh_chapter_references list the same entities');
    await call('wh_pin_reference', { writingId: W1, entryId: `${P}-marta`, pinned: true });
    await waitFor('the bridge pin on screen', () => rowIds()[0] === `${P}-marta`);
    assert(document.querySelector(`[data-entry-id="${P}-marta"] [data-testid="reference-pin"]`)?.getAttribute('aria-pressed') === 'true', 'the pin set by the tool shows pressed in the UI');
    await click(document.querySelector(`[data-entry-id="${P}-marta"] [data-testid="reference-pin"]`), 'unpin in the UI');
    const afterUi = (await call('wh_chapter_references', { writingId: W1 })).pinned as unknown[];
    assert(afterUi.length === 0, 'unpinning in the UI is seen by the tool');
    await call('wh_reference_prefs', { width: 450 });
    await waitFor('width from the tool', () => byTestId('reference-resize')?.getAttribute('aria-valuenow') === '450');
    await call('wh_reference_prefs', { open: false });
    await waitFor('collapsed by the tool', () => toggle()?.getAttribute('aria-expanded') === 'false');
    await call('wh_reference_prefs', { open: true });
    await waitFor('opened by the tool', () => toggle()?.getAttribute('aria-expanded') === 'true');
    await setViewport(940, 600);
    await waitFor('drawer at 940 again', () => toggle()?.getAttribute('data-mode') === 'floating');
    await call('wh_reference_consult', { open: true });
    await waitFor('consult opened by the tool', () => Boolean(byTestId(PANEL)) && byTestId(PANEL)!.getAttribute('data-mode') === 'drawer');
    assert(getReferenceUi().consult === true, 'the store says consult is open');
    const search = (await call('wh_reference_search', { projectId: P, query: 'torre' })).codex as Array<{ id: string }>;
    assert(search.length === 1 && search[0].id === `${P}-faro`, 'wh_reference_search finds what the panel search finds');
    await call('wh_reference_consult', { open: false });
    await waitFor('consult closed by the tool', () => !byTestId(PANEL));
    passed.push('MCP parity: consult, docked preference, width, pins and entities go through the same state and rows as the screen');

    // ---- preferences survive a remount ---------------------------------------------------------------------------------
    await setViewport(1280, 800);
    await unmount();
    setReferenceConsult(false);
    await mount(`/project/${P}/writings?writing=${W1}`);
    await waitFor('docked panel after remount', () => byTestId(PANEL)?.getAttribute('data-mode') === 'column');
    assert(byTestId('reference-resize')?.getAttribute('aria-valuenow') === '450', 'the width set through the tool comes back after a remount');
    assert(toggle()?.getAttribute('aria-expanded') === 'true', 'and so does the docked preference');
    const resize = byTestId('reference-resize')!;
    await key(resize, { key: 'ArrowRight' });
    assert(byTestId('reference-resize')?.getAttribute('aria-valuenow') === '430', 'the resize separator works by keyboard');
    assert(JSON.parse(window.localStorage.getItem('writers-hoard:reference:panel') ?? '{}').width === 430, 'and the new width is stored');
    passed.push('preferences and width survive a remount; the separator is keyboard-operable');

    // ---- the whole-book editor ---------------------------------------------------------------------------------------------
    await click(document.querySelector(`button[title="${t('writings.book.hint')}"]`), 'whole book button');
    await waitFor('the book editor', () => Boolean(editorOf()) && document.querySelectorAll('.wh-chapter-heading').length >= 2, 10000);
    assert(!byTestId(PANEL) && toggle()?.getAttribute('data-mode') === 'floating', 'the book has no side column: floating button only');
    const bookEditor = editorOf()!;
    await act(async () => { bookEditor.commands.setTextSelection({ from: 5, to: 12 }); bookEditor.view.focus(); await pause(60); });
    const bookSel = { from: bookEditor.state.selection.from, to: bookEditor.state.selection.to };
    await click(toggle(), 'book consult button');
    await waitFor('the book consult', () => byTestId(PANEL)?.getAttribute('data-temporary') === 'true' && rowIds().length === 3);
    assert(byTestId('reference-toggle')?.textContent?.includes(t('writings.reference.scopeBook')), 'the drawer says it is about the whole book when every chapter is loaded');
    assert(bookEditor.state.selection.from === bookSel.from && bookEditor.state.selection.to === bookSel.to, 'the book selection survived');
    assert(!byTestId('reference-backdrop'), 'no backdrop over the book');
    const bookMentions = (await call('wh_chapter_references', { projectId: P, scope: 'book' })).mentions as Array<{ id: string }>;
    assert([...rowIds()].sort().join() === bookMentions.map((m) => m.id).sort().join(), 'the book rows and the book-scope tool list the same entities');
    assert(!bookMentions.some((m) => m.id === `${P}-ghost`) && !rowIds().includes(`${P}-ghost`), 'an entry named only in an unnumbered idea is not a book mention, in the tool or on screen');
    assert((await call('wh_chapter_references', { writingId: `${P}-idea` })).mentions as unknown[] && ((await call('wh_chapter_references', { writingId: `${P}-idea` })).mentions as Array<{ id: string }>).some((m) => m.id === `${P}-ghost`), 'the idea keeps its own mentions');
    await click(document.querySelector(`[data-entry-id="${P}-marta"] [data-testid="reference-pin"]`), 'pin in the book');
    assert((await db.referencePins.get(`book:${P}`))?.entryIds.join() === `${P}-marta`, 'the book pin is stored under its own scope');
    assert(!(await db.referencePins.get(W1)), 'and not under a chapter');
    await shot('book-consult-1280');
    await key(bookEditor.view.dom, { key: 'Escape' });
    assert(!byTestId(PANEL), 'Escape closes the book consult');
    assert(bookEditor.state.selection.from === bookSel.from, 'the book selection is intact');
    await setViewport(390, 700);
    await waitFor('book at 390', () => toggle()?.getAttribute('data-mode') === 'floating');
    assert(noHorizontalScroll() && inViewport(toggle()!.getBoundingClientRect()), 'the book at 390px has no overflow and a reachable button');
    passed.push('whole-book editor: temporary consult with its own pins, selection kept, Escape, same entities as the tool; fits 390px');

    // ---- a loaded range is not "the whole book" ------------------------------------------------------------------------
    await setViewport(1280, 800);
    const fromSelect = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === W2) && el.closest('label')?.textContent?.includes(t('writings.book.range.from')));
    assert(fromSelect, 'the range "from" select exists');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(fromSelect, W2);
      fromSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(100);
    });
    await waitFor('the book reloaded on chapter 2 only', () => document.querySelectorAll('.wh-chapter-heading').length === 1 && Boolean(editorOf()), 10000);
    await click(toggle(), 'range consult button');
    await waitFor('the ranged consult', () => byTestId(PANEL)?.getAttribute('data-temporary') === 'true');
    const rangeTitle = byTestId('reference-toggle')?.textContent ?? '';
    assert(rangeTitle.includes(t('writings.reference.scopeRange').replace('{from}', '2').replace('{to}', '2')), `the drawer names the loaded range, got "${rangeTitle}"`);
    assert(!rangeTitle.includes(t('writings.reference.scopeBook')), 'a loaded range is not called the whole book');
    await waitFor('the ranged rows follow chapter 2', () => rowIds().length === 2 && !rowIds().includes(`${P}-ana`));
    assert(rowIds().sort().join() === `${P}-faro,${P}-marta`, `the ranged UI lists only what chapter 2 mentions, got ${[...rowIds()].join()}`);
    const wholeBook = (await call('wh_chapter_references', { projectId: P, scope: 'book' })) as { mentions: Array<{ id: string }>; coverage: string };
    assert(wholeBook.mentions.some((m) => m.id === `${P}-ana`) && wholeBook.coverage.includes('range'), 'the tool still covers every numbered chapter and says the UI reads only the loaded range');
    passed.push('the whole-book drawer names the loaded chapter range instead of claiming the whole book; the tool states its wider coverage and excludes unnumbered ideas');
  } finally {
    await unmount();
    setReferenceConsult(false);
    window.localStorage.removeItem('writers-hoard:reference:panel');
    await useAppStore.getState().setReading({ layout: 'flow' });
    await db.referencePins.where('projectId').equals(P).delete();
    await db.writingSnapshots.where('projectId').equals(P).delete();
    await db.writings.where('projectId').equals(P).delete();
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
