// Hand-off buttons in the real Codex list and Storyboard engine: what a person clicks, and the toast they read.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/family-ui.browser.tsx testFamilyUi 120000 --no-sandbox
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import CodexEntryList from '@/components/codex/CodexEntryList';
import StoryboardEngine from '@/engines/storyboard/StoryboardEngine';
import { ToastHost } from '@/components/common/toast';
import { setFamilyTransport } from '@/services/familyBridge/client';
import type { FamilyCallRequest, FamilyCallResponse } from '@/services/familyBridge/protocol';
import fixture from './fixtures/scheherazade-world.json';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const toasts = () => [...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => ({ role: node.getAttribute('role'), text: node.textContent ?? '' }));

export async function testFamilyUi(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  const P = `family-ui-${Date.now()}`;
  const now = Date.now();
  const passed: string[] = [];
  let root: Root | null = null;
  const render = async (element: ReactNode) => {
    await act(async () => { root ??= createRoot(host); root.render(<StrictMode><MemoryRouter><ToastHost />{element}</MemoryRouter></StrictMode>); await pause(60); });
    await act(async () => { await pause(120); });
  };
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const click = async (target: HTMLElement | null | undefined, label: string) => {
    assert(target, `Missing ${label}`);
    await act(async () => { target.click(); await pause(80); });
  };
  const waitFor = async (what: string, test: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return;
      await act(async () => { await pause(40); });
    }
    throw new Error(`Timed out waiting for ${what}. Toasts: ${JSON.stringify(toasts())}`);
  };

  const calls: FamilyCallRequest[] = [];
  let answer: (request: FamilyCallRequest) => FamilyCallResponse = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true } });
  setFamilyTransport(async request => { calls.push(request); return answer(request); }, async () => ({ ok: true }));
  try {
    const engines = ['codex', 'relationships', 'timeline', 'storyboard'];
    await db.projects.add({ id: P, title: 'Mi novela', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
    const entry = (id: string, type: CodexEntry['type'], title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, projectId: P, type, title, fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra });
    const ana = entry(`${P}-ana`, 'character', 'Ana Ruiz', { avatar: PNG_URL, fields: { physicalDescription: 'Alta' } });
    const faro = entry(`${P}-faro`, 'location', 'El Faro');
    await db.codexEntries.bulkAdd([ana, faro]);

    // ---- Codex list: the world buttons and the character button ----------------------------------------
    const list = (entries: CodexEntry[]) => <CodexEntryList projectId={P} entries={entries} onAdd={async () => {}} onEdit={async () => {}} onDelete={async () => {}} />;
    await render(list([ana, faro]));
    assert(byTestId('send-world-to-scheherazade') && byTestId('bring-world-from-scheherazade'), 'the codex toolbar has both Scheherazade buttons');
    assert(byTestId('send-world-to-scheherazade')!.textContent?.includes('Scheherazade') && byTestId('bring-world-from-scheherazade')!.textContent?.includes('Scheherazade'), 'the buttons name the app');

    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, world: { id: 'w1', name: 'Mi mundo' }, world_created: true, counts: { created: 2 }, items: [], world_ref: 'hoard://scheherazade/world/w1' } });
    await click(byTestId('send-world-to-scheherazade'), 'send world button');
    await waitFor('the success toast', () => toasts().some(item => item.role === 'status' && item.text.includes('Mi mundo')));
    assert(calls.length === 1 && calls[0].tool === 'world_import' && (calls[0].args as { data: { characters: unknown[]; places: unknown[] } }).data.characters.length === 1, 'the click sent this project\'s world');
    assert(toasts().some(item => item.text.includes('2')), 'the toast says how many records were new');

    answer = request => ({ ok: false, code: 'hub_unreachable', error: 'The Hoard hub is not running at http://127.0.0.1:8810.', app: request.app, tool: request.tool });
    await click(byTestId('send-world-to-scheherazade'), 'send world button again');
    await waitFor('the error toast', () => toasts().some(item => item.role === 'alert' && item.text.includes('Start the Hoard hub and Scheherazade')));
    assert(!(byTestId('send-world-to-scheherazade') as HTMLButtonElement).disabled, 'the button is usable again after a failure');
    passed.push('UI: "Send to Scheherazade" in the codex toolbar sends the world and toasts the result or what to start');

    answer = request => request.tool === 'world_export'
      ? { ok: true, app: 'scheherazade', tool: 'world_export', result: { ok: true, ...JSON.parse(JSON.stringify(fixture)) } }
      : { ok: true, app: request.app, tool: request.tool, result: { ok: true } };
    await click(byTestId('bring-world-from-scheherazade'), 'bring world button');
    const input = byTestId('scheherazade-world-id') as HTMLInputElement | null;
    assert(input, 'the bring button asks which world');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Archipiélago');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(40);
    });
    const submit = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[type="submit"]')][0];
    await click(submit, 'bring submit');
    await waitFor('the import toast', () => toasts().some(item => item.role === 'status' && item.text.includes('Archipiélago')));
    assert(calls.at(-1)?.tool === 'world_export' && calls.at(-1)?.args.world_id === 'Archipiélago', 'the named world was asked for');
    const afterImport = await db.codexEntries.where('projectId').equals(P).toArray();
    assert(afterImport.length === 2 + 6 && afterImport.some(row => row.title === 'Kraken'), `the world is in the codex: ${afterImport.map(row => row.title).join(', ')}`);
    assert(toasts().some(item => item.text.includes('10 ')), 'the toast counts the new records');
    await waitFor('the dialog to close', () => !document.querySelector('[role="dialog"]'));
    passed.push('UI: "Bring from Scheherazade" asks for the world, imports it into the codex and toasts the counts');

    // ---- Character detail: Prospero ---------------------------------------------------------------------
    await render(list([ana, faro]));
    const card = [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.includes('Ana Ruiz'));
    await click(card, 'Ana\'s card');
    assert(byTestId('send-character-to-prospero'), 'a character\'s detail has the Prospero button');
    calls.length = 0;
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, character_id: 'c77' } });
    await click(byTestId('send-character-to-prospero'), 'send character button');
    await waitFor('the cast toast', () => toasts().some(item => item.role === 'status' && item.text.includes('Ana Ruiz')));
    assert(calls[0]?.tool === 'cast_import_character' && (calls[0].args as { name: string }).name === 'Ana Ruiz' && calls[0].files?.length === 1, 'the click sent the character with the portrait');
    const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(row => row.getAttribute('aria-label') === 'Close' || row.getAttribute('aria-label') === 'Cerrar');
    await click(close, 'close');
    await render(list([ana, faro]));
    const faroCard = [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.includes('El Faro'));
    await click(faroCard, 'the location\'s card');
    assert(!byTestId('send-character-to-prospero'), 'a location has no Prospero button');
    passed.push('UI: a character\'s detail sends it to Prospero\'s cast with its portrait; locations have no such button');

    // ---- Storyboard engine ------------------------------------------------------------------------------
    await unmount();
    await db.storyboards.add({ id: `${P}-sb`, projectId: P, title: 'Escena del faro', columns: 3, createdAt: now, updatedAt: now });
    await db.storyboardPanels.bulkAdd([
      { id: `${P}-p1`, storyboardId: `${P}-sb`, projectId: P, order: 0, subtitle: 'Apertura', duration: '8s', imageData: PNG_URL, tags: [], createdAt: now, updatedAt: now },
      { id: `${P}-p2`, storyboardId: `${P}-sb`, projectId: P, order: 1, subtitle: 'Cierre', tags: [], createdAt: now, updatedAt: now },
    ]);
    await render(<StoryboardEngine projectId={P} />);
    await waitFor('the storyboard button', () => Boolean(byTestId('send-storyboard-to-prospero')));
    calls.length = 0;
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, production_id: 'p5' } });
    await click(byTestId('send-storyboard-to-prospero'), 'send storyboard button');
    await waitFor('the production toast', () => toasts().some(item => item.role === 'status' && item.text.includes('Escena del faro')));
    const shots = (calls[0].args as { shots: Array<{ text: string; duration_s?: number; image?: string }> }).shots;
    assert(calls[0].tool === 'production_from_storyboard' && shots.length === 2 && shots[0].duration_s === 8 && shots[0].image === '@file:shot-1' && !shots[1].image && calls[0].files?.length === 1, 'the click sent the storyboard as shots');
    assert(toasts().some(item => item.text.includes('2')), 'the toast counts the shots');
    answer = request => ({ ok: false, code: 'app_unavailable', error: 'app "prospero" is not running', app: request.app, tool: request.tool });
    await click(byTestId('send-storyboard-to-prospero'), 'send storyboard button again');
    await waitFor('the error toast', () => toasts().some(item => item.role === 'alert' && item.text.includes('Prospero is not running')));
    passed.push('UI: the storyboard view sends its panels to Prospero as a production draft and toasts the shot count or the reason');

    // ---- Outside the desktop app there is nothing to click ----------------------------------------------
    await unmount();
    const realAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 Chrome/130 Safari/537', configurable: true });
    try {
      await render(list([ana, faro]));
      assert(!byTestId('send-world-to-scheherazade') && !byTestId('bring-world-from-scheherazade'), 'the web build shows no Scheherazade buttons');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userAgent;
      if (realAgent) Object.defineProperty(Navigator.prototype, 'userAgent', realAgent);
    }
    passed.push('UI: the buttons only exist in the desktop app');
  } finally {
    setFamilyTransport(null);
    await unmount();
  }
  return passed;
}
