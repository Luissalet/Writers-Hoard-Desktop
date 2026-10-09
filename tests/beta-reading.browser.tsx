// Beta reading in the real screen, with a real package opened as a reader would:
// create a package from two chapters, open the generated page, comment on a
// selection and on a whole chapter, react, download the response, import it
// in the app, edit the chapter and watch the comments move or become orphans.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/beta-reading.browser.tsx testBetaReading 250000 --no-sandbox
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import BetaReadingEngine from '@/engines/beta-reading/components/BetaReadingEngine';
import { installNavigator } from '@/engines/_shared/anchoring/navigation';
import { ToastHost } from '@/components/common/toast';
import { createPackage, renderStoredPackage } from '@/services/betaReading/store';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTestId = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const toasts = () => [...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => node.textContent ?? '');

const PARAGRAPHS = [
  'La lluvia caía sobre el puerto y nadie salió a mirar el mar aquella noche.',
  'Marta subió los ciento doce escalones con la linterna apagada, contando en voz baja.',
  'En lo alto el viento arrancó la puerta de sus goznes y la luz se apagó para siempre.',
];

export async function testBetaReading(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `beta-ui-${Date.now()}`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;
  const render = async (element: ReactNode) => {
    await act(async () => { root ??= createRoot(host); root.render(<StrictMode><MemoryRouter><ToastHost />{element}</MemoryRouter></StrictMode>); await pause(80); });
    await act(async () => { await pause(150); });
  };
  const click = async (target: Element | null | undefined, label: string) => {
    assert(target, `Missing ${label}`);
    await act(async () => { (target as HTMLElement).click(); await pause(120); });
  };
  const waitFor = async (what: string, test: () => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await act(async () => { await pause(50); });
    }
    throw new Error(`Timed out waiting for ${what}. Toasts: ${JSON.stringify(toasts())}`);
  };

  // Downloads: capture the Blob and the file name instead of letting the window open a save dialog.
  const downloads: Array<{ name: string; blob: Blob }> = [];
  const captured = new Map<string, Blob>();
  const realCreate = URL.createObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob: Blob | MediaSource) => { const url = `blob:test/${captured.size}`; captured.set(url, blob as Blob); return url; };
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    const blob = captured.get(this.href);
    if (blob && this.download) downloads.push({ name: this.download, blob });
  };
  const navigations: string[] = [];
  installNavigator(path => { navigations.push(path); });

  try {
    const engines = ['writings', 'beta-reading'];
    await db.projects.add({ id: P, title: 'Mi novela <beta>', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
    const writing = (id: string, title: string, chapter: number, content: string) => ({
      id, projectId: P, title, status: 'draft' as const, content, wordCount: 30, chapter, tags: [], createdAt: now + chapter, updatedAt: now + chapter,
    });
    const A = `${P}-a`;
    const B = `${P}-b`;
    await db.writings.bulkAdd([
      writing(A, 'El faro', 1, PARAGRAPHS.map(text => `<p>${text}</p>`).join('')),
      writing(B, 'La costa', 2, '<p>Un segundo capítulo que espera a su lector para contarle algo.</p>'),
    ]);

    // ---- Create a package from the screen ----------------------------------------------------------
    await render(<BetaReadingEngine projectId={P} />);
    await waitFor('the chapter list', () => Boolean(byTestId(`beta-pick-${A}`)));
    await click(byTestId('beta-create'), 'create button without a selection');
    await waitFor('the pick-some error', () => toasts().some(text => /al menos un cap|at least one/i.test(text)));
    assert((await db.betaPackages.count()) === 0, 'nothing was created without a selection');
    await click(byTestId(`beta-pick-${A}`), 'chapter A checkbox');
    await click(byTestId(`beta-pick-${B}`), 'chapter B checkbox');
    await click(byTestId('beta-create'), 'create button');
    await waitFor('the package row', () => allByTestId('beta-package').length === 1);
    const stored = (await db.betaPackages.where('projectId').equals(P).toArray())[0];
    assert(stored.version === 1 && stored.chapters.length === 2, 'a version 1 package of two chapters was stored');
    assert(downloads.length === 1 && downloads[0].name.endsWith('.html'), `the page was offered as a download: ${JSON.stringify(downloads.map(item => item.name))}`);
    const html = await downloads[0].blob.text();
    assert(html === renderStoredPackage(stored).html, 'the download is exactly what the stored package renders to');
    assert(allByTestId('beta-chapter-status').every(node => node.dataset.changed === 'false'), 'a fresh package shows no changes');
    passed.push('UI: picking chapters creates a versioned package, stores it and offers the single HTML file');

    // ---- Open the generated page as a reader would --------------------------------------------------
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;border:0;background:#fff';
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await new Promise<void>(resolve => { frame.onload = () => resolve(); });
    await pause(200);
    const win = frame.contentWindow as Window & typeof globalThis;
    const doc = frame.contentDocument!;
    assert(doc.getElementById('wh-manifest') && doc.querySelectorAll('article').length === 2, 'the page rendered both chapters');
    assert(doc.querySelectorAll('.b').length === 4, 'every paragraph is a numbered block');
    assert(!doc.querySelector('script[src], link[href], img[src^="http"]'), 'the page loads nothing from outside');

    const frameBlobs = new Map<string, Blob>();
    const frameDownloads: Array<{ name: string; blob: Blob }> = [];
    win.URL.createObjectURL = (blob: Blob | MediaSource) => { const url = `blob:frame/${frameBlobs.size}`; frameBlobs.set(url, blob as Blob); return url; };
    win.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      const blob = frameBlobs.get(this.href);
      if (blob && this.download) frameDownloads.push({ name: this.download, blob });
    };

    const status = () => doc.getElementById('wh-status')!.textContent ?? '';
    const select = async (paragraph: number, phrase: string) => {
      const block = doc.querySelector(`article[data-chapter="${A}"] .b[data-p="${paragraph}"]`)!;
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let text: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node as Text).data.includes(phrase)) { text = node as Text; break; }
      }
      assert(text, `the phrase "${phrase}" is in one text node of the page`);
      const at = text.data.indexOf(phrase);
      const range = doc.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + phrase.length);
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await pause(200);
    };

    // Downloading without a name is refused.
    (doc.getElementById('wh-export') as HTMLButtonElement).click();
    await pause(50);
    assert(frameDownloads.length === 0 && /nombre|name/i.test(status()), `a response needs the reader's name first: ${status()}`);
    const nameInput = doc.getElementById('wh-reader-name') as HTMLInputElement;
    nameInput.value = 'Lucía Beta';
    nameInput.dispatchEvent(new win.Event('change'));

    // No selection yet: nothing to comment on.
    assert((doc.getElementById('wh-add-comment') as HTMLButtonElement).disabled, 'the comment button waits for a selection');

    await select(0, 'nadie salió a mirar el mar');
    const add = doc.getElementById('wh-add-comment') as HTMLButtonElement;
    assert(!add.disabled, 'selecting text enables the comment button');
    add.click();
    await pause(60);
    assert(!(doc.getElementById('wh-composer') as HTMLElement).hidden, 'the composer opened');
    assert(doc.getElementById('wh-composer-quote')!.textContent === 'nadie salió a mirar el mar', 'the composer shows the quote');
    (doc.getElementById('wh-comment-text') as HTMLTextAreaElement).value = 'Gran imagen de apertura.';
    (doc.getElementById('wh-comment-save') as HTMLButtonElement).click();
    await pause(60);
    assert(doc.querySelectorAll('mark[data-c]').length >= 1 && doc.querySelector('mark')!.textContent === 'nadie salió a mirar el mar', 'the quote is highlighted');

    await select(1, 'Marta subió los ciento doce escalones');
    (doc.getElementById('wh-add-comment') as HTMLButtonElement).click();
    await pause(60);
    (doc.getElementById('wh-comment-text') as HTMLTextAreaElement).value = '¿Por qué doce?';
    (doc.getElementById('wh-comment-save') as HTMLButtonElement).click();
    await pause(60);

    (doc.querySelector(`article[data-chapter="${B}"] .whole`) as HTMLButtonElement).click();
    await pause(60);
    (doc.getElementById('wh-comment-text') as HTMLTextAreaElement).value = 'En conjunto, quiero más.';
    (doc.getElementById('wh-comment-save') as HTMLButtonElement).click();
    await pause(60);

    (doc.querySelector(`article[data-chapter="${A}"] .wh-react[data-reaction="love"]`) as HTMLButtonElement).click();
    await pause(40);
    assert(doc.querySelector(`article[data-chapter="${A}"] .wh-react[data-reaction="love"]`)!.getAttribute('aria-pressed') === 'true', 'a reaction toggles on');
    assert(doc.getElementById('wh-count')!.textContent === '3', 'three comments are listed in the page');

    // A third comment is removed again.
    (doc.querySelector('#wh-list .comment button.link') as HTMLButtonElement).click();
    await pause(40);
    assert(doc.getElementById('wh-count')!.textContent === '2' && doc.querySelectorAll('mark[data-c]').length === 1, 'removing a comment also removes its highlight');
    // …so put it back, the way a reader would.
    await select(0, 'nadie salió a mirar el mar');
    (doc.getElementById('wh-add-comment') as HTMLButtonElement).click();
    await pause(60);
    (doc.getElementById('wh-comment-text') as HTMLTextAreaElement).value = 'Gran imagen de apertura.';
    (doc.getElementById('wh-comment-save') as HTMLButtonElement).click();
    await pause(60);
    assert(doc.getElementById('wh-count')!.textContent === '3', 'the comment is back');

    (doc.getElementById('wh-export') as HTMLButtonElement).click();
    await pause(80);
    assert(frameDownloads.length === 1 && /^beta-.*\.json$/.test(frameDownloads[0].name), `the response was downloaded: ${JSON.stringify(frameDownloads.map(item => item.name))}`);
    const responseText = await frameDownloads[0].blob.text();
    const response = JSON.parse(responseText) as {
      format: string; packageId: string; packageVersion: number; reader: string;
      reactions: Record<string, string[]>;
      comments: Array<{ chapterId: string; quote: string; prefix: string; suffix: string; paragraph: number; text: string }>;
    };
    assert(response.format === 'writers-hoard.beta-response' && response.packageId === stored.id && response.packageVersion === 1, 'the response names the package it answers');
    assert(response.reader === 'Lucía Beta' && response.comments.length === 3, 'the response has the reader and three comments');
    const first = response.comments.find(item => item.text === 'Gran imagen de apertura.')!;
    assert(first.quote === 'nadie salió a mirar el mar' && first.prefix === 'La lluvia caía sobre el puerto y ' && first.suffix === ' aquella noche.' && first.paragraph === 0 && first.chapterId === A, `the anchor carries quote and context: ${JSON.stringify(first)}`);
    const whole = response.comments.find(item => item.text === 'En conjunto, quiero más.')!;
    assert(whole.chapterId === B && whole.quote === '', 'a chapter-level comment has no quote');
    assert(JSON.stringify(response.reactions) === JSON.stringify({ [A]: ['love'] }), 'the reaction travels with the response');
    frame.remove();
    passed.push('Reader page: a selection and a whole chapter are commented, highlighted, reacted to and downloaded as the response JSON');

    // ---- Import in the app --------------------------------------------------------------------------
    const input = byTestId('beta-import-input') as HTMLInputElement;
    const feed = async (text: string, name: string) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type: 'application/json' }));
      await act(async () => {
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await pause(300);
      });
    };
    await feed(responseText, 'lucia.json');
    await waitFor('three imported comments', () => allByTestId('beta-comment').length === 3);
    assert(allByTestId('beta-status').every(node => /anclad|attached/i.test(node.textContent ?? '')), 'a fresh response attaches whole');
    assert(toasts().some(text => text.includes('Lucía Beta') && text.includes('3')), `the import toast: ${JSON.stringify(toasts())}`);
    assert(/Lucía Beta/.test(byTestId('beta-readers')?.textContent ?? ''), 'the reader is listed');
    await feed(responseText, 'lucia-again.json');
    await waitFor('the second import toast', () => toasts().filter(text => text.includes('Lucía Beta')).length >= 2);
    assert(allByTestId('beta-comment').length === 3 && (await db.betaComments.where('projectId').equals(P).count()) === 3, 'importing the same file again adds nothing');
    assert(toasts().some(text => /0 nuevos|0 new/.test(text) && /3 ya estaban|3 already/.test(text)), `the toast says nothing was new: ${JSON.stringify(toasts())}`);
    await feed('{"hello":1}', 'basura.json');
    await waitFor('the refusal toast', () => toasts().some(text => text.includes('basura.json')));
    assert((await db.betaComments.where('projectId').equals(P).count()) === 3, 'a file that is not a response stores nothing');
    passed.push('UI: the response is imported once, re-importing adds nothing, a foreign file is refused with its name');

    // ---- The chapter changes: moved, orphaned, and the diff indicator ------------------------------------
    await db.writings.update(A, {
      content: `<p>${PARAGRAPHS[0]}</p><p>Marta subió los ciento trece escalones con la linterna apagada, contando en voz baja.</p><p>Arriba todo era silencio.</p>`,
      updatedAt: Date.now(),
    });
    await db.writings.update(B, { content: '<p>Un segundo capítulo sin la frase que importaba.</p>', updatedAt: Date.now() });
    await waitFor('the chapter-changed indicator', () => allByTestId('beta-chapter-changed').length >= 1);
    const statusOfText = (needle: string) => allByTestId('beta-comment').find(card => card.textContent?.includes(needle))?.dataset.status;
    await waitFor('the reworded quote to read as moved', () => statusOfText('¿Por qué doce?') === 'moved');
    assert(statusOfText('Gran imagen de apertura.') === 'attached', 'the untouched quote stays attached');
    assert(statusOfText('En conjunto, quiero más.') === 'attached', 'a whole-chapter comment stays attached');
    assert(byTestId('beta-chapter-changed')!.textContent?.includes('+') , 'the changed chapter shows a word-level summary');
    assert(allByTestId('beta-chapter-status').some(node => node.dataset.changed === 'true' && /palabras|words/.test(node.textContent ?? '')), 'the package lists the change too');
    await db.writings.update(A, {
      content: `<p>${PARAGRAPHS[0]}</p><p>Todo estaba en silencio.</p>`,
      updatedAt: Date.now(),
    });
    await waitFor('the orphaned group', () => Boolean(byTestId('beta-orphaned')));
    assert(statusOfText('¿Por qué doce?') === 'orphaned' && byTestId('beta-orphaned')!.textContent!.includes('¿Por qué doce?'), 'a comment whose text is gone is shown apart, not dropped');
    assert((await db.betaComments.where('projectId').equals(P).count()) === 3, 'orphaned comments are kept');
    passed.push('UI: editing the chapter re-attaches comments as moved or orphaned and shows what changed since the package');

    // ---- Resolve / reopen / delete with undo / jump ---------------------------------------------------------
    const card = (needle: string) => allByTestId('beta-comment').find(item => item.textContent?.includes(needle))!;
    await click(card('Gran imagen de apertura.').querySelector('[data-testid="beta-toggle-resolved"]'), 'resolve');
    await waitFor('resolved', () => statusOfText('Gran imagen de apertura.') === 'resolved');
    const filter = byTestId('beta-filter-status') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(filter, 'resolved');
      filter.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(100);
    });
    assert(allByTestId('beta-comment').length === 1, 'the status filter narrows the list');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(filter, '');
      filter.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(100);
    });
    await click(card('Gran imagen de apertura.').querySelector('[data-testid="beta-toggle-resolved"]'), 'reopen');
    await waitFor('reopened', () => statusOfText('Gran imagen de apertura.') === 'attached');

    await click(card('Gran imagen de apertura.').querySelector('[data-testid="beta-delete"]'), 'delete');
    await waitFor('the undo bar', () => Boolean(byTestId('beta-undo')));
    assert(allByTestId('beta-comment').length === 2 && (await db.betaComments.where('projectId').equals(P).count()) === 2, 'the comment is gone');
    await click(byTestId('beta-undo-button'), 'undo');
    await waitFor('the comment back', () => allByTestId('beta-comment').length === 3);
    assert(!byTestId('beta-undo'), 'the undo bar closes');

    const jump = [...card('Gran imagen de apertura.').querySelectorAll('button')].find(button => /Ir a la cita|Go to the quote/.test(button.textContent ?? ''));
    await click(jump, 'jump');
    assert(navigations.at(-1) === `/project/${P}/writings?writing=${encodeURIComponent(A)}`, `jumping goes to the chapter: ${navigations.at(-1)}`);
    passed.push('UI: resolve, reopen, filter, delete with undo and jump to the chapter');

    // ---- A package for the changed chapter is version 2 ------------------------------------------------------------
    const second = await createPackage(P, [A]);
    assert(second.row.version === 2, 'the next package is version 2');
    passed.push('Service: package versions are monotonic per project');
  } finally {
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    root?.unmount();
    document.querySelectorAll('iframe').forEach(item => item.remove());
    await db.betaComments.where('projectId').equals(P).delete();
    await db.betaResponses.where('projectId').equals(P).delete();
    await db.betaPackages.where('projectId').equals(P).delete();
    await db.writings.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
