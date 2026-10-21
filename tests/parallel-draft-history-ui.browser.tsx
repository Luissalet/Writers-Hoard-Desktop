import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Writing } from '@/types';
import { createParallelDraft, loadPaneDocument, savePaneDocument } from '@/engines/writings/parallelDrafts';
import ParallelDraftWorkspace from '@/engines/writings/components/ParallelDraftWorkspace';
import PublishedEditionsModal from '@/services/publishedEditions/PublishedEditionsModal';
import { useLocaleStore } from '@/stores/localeStore';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
let sequence = 0;
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function luminance(color: string) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0,0,1,1); const values = [...context.getImageData(0,0,1,1).data].slice(0,3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; }
async function wait(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 400; i++) { if (await check()) return; await pause(); } throw Error('Native draft UI did not settle'); }
async function settle(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 400; i++) { if (await check()) return; await act(async () => { await pause(); }); } throw Error('Draft product state did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
const keys = (keyCode: string, modifiers?: string[]) => [{ type: 'keyDown', keyCode, modifiers }, { type: 'keyUp', keyCode, modifiers }];
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
export async function testParallelDraftHistoryUi() {
  const P = `draft-history-ui-${Date.now()}`, W = `${P}-chapter`, host = document.getElementById('root')!, root = createRoot(host), passed: string[] = [];
  const project: Project = { id: P, title: 'The Tide Archive', mode: 'custom', type: 'standalone', color: '#776644', description: '', status: 'draft', enabledEngines: ['writings','codex'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: W, projectId: P, title: 'El puerto al amanecer', content: '<p>El capítulo principal conserva la llegada al puerto.</p>', wordCount: 10, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 };
  try {
    useLocaleStore.setState({ locale: 'es' }); await db.projects.put(project); await db.writings.put(writing);
    const canonical = await loadPaneDocument(P, { writingId: W }), a = await createParallelDraft(canonical, 'Llegada en silencio'), b = await createParallelDraft(canonical, 'Llegada con tormenta');
    await savePaneDocument(await loadPaneDocument(P, { writingId: W, draftId: a.id }), '<p>Una campana de niebla recibió a la viajera.</p>');
    await savePaneDocument(await loadPaneDocument(P, { writingId: W, draftId: a.id }), '<p>Texto reciente de la alternativa silenciosa.</p>');
    await savePaneDocument(await loadPaneDocument(P, { writingId: W, draftId: b.id }), '<p>El temporal sacudió los mástiles antes del amanecer.</p>');
    for (const width of [1440, 640]) {
      const n = ++sequence; await act(async () => { channel.__want = { w: width, h: 1000, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ projectId: P, instanceId: `draft-ui-${width}`, primary: true, visible: true }}><main className="min-h-screen bg-deep p-4 text-text-primary"><ParallelDraftWorkspace projectId={P} start={{ writingId: W, draftId: a.id }} onClose={async () => {}} /></main></EnginePaneContext.Provider></MemoryRouter>); await pause(); });
      Object.assign(window,{__testStage:`history ${width}: wait loaded session`}); await settle(() => !!button('Historial del borrador') && !button('Historial del borrador')!.disabled); await click(button('Historial del borrador')!);
      await settle(() => !!document.querySelector('[role="dialog"] select'));
      const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
      await settle(() => select.options.length >= 3); await click(select); await native([...keys('HOME'), ...keys('DOWN'), ...keys('ENTER')]);
      await settle(() => !!document.querySelector('[data-draft-history-preview]'));
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Draft history overflows horizontally');
      const shot = `parallel-draft-history-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      await click(button('Restaurar en este borrador')!); await settle(() => !document.querySelector('[role="dialog"]'));
      assert((await db.writings.get(W))!.content === writing.content && (await loadPaneDocument(P, { writingId: W, draftId: b.id })).content.includes('El temporal'), 'Native history restore changed another draft');
      await act(async () => root.render(<div />)); await act(async () => { root.render(<main className="min-h-screen bg-deep text-text-primary"><PublishedEditionsModal key={width} projectId={P} writings={[writing]} onClose={() => {}} /></main>); await pause(); });
      await settle(() => !!document.querySelector('select[aria-label^="Borrador para publicar"]'));
      const draft = document.querySelector<HTMLSelectElement>('select[aria-label^="Borrador para publicar"]')!; await settle(() => draft.options.length === 3);
      const draftIndex = [...draft.options].findIndex(option => option.value === a.id); assert(draftIndex > 0, 'Named alternative missing from native selector'); await click(draft); await native([...keys('HOME'), ...Array.from({length:draftIndex},()=>keys('DOWN')).flat(), ...keys('ENTER')]);
      const title = document.querySelector<HTMLInputElement>('input[required]')!; await click(title); await native([{ type: 'text', text: `Edición silenciosa ${width}` }]);
      assert(draft.value === a.id, 'Native publication selector did not choose named alternative');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Publication draft selector overflows');
      const publishShot = `parallel-draft-publication-${width}`; await act(async () => { channel.__shot = { name: publishShot }; await wait(() => channel.__shotDone === publishShot); });
      const publishStyle = getComputedStyle(button('Publicar selección')!), fore = luminance(publishStyle.color), back = luminance(publishStyle.backgroundColor); assert((Math.max(fore, back) + .05) / (Math.min(fore, back) + .05) >= 4.5, 'Primary publication action contrast is below 4.5:1');
      const expected = (await loadPaneDocument(P, { writingId: W, draftId: a.id })).content;
      await click(button('Publicar selección')!); await settle(async () => (await db.projects.get(P))!.publishedEditions?.length === passed.length + 1);
      const edition = (await db.projects.get(P))!.publishedEditions!.at(-1)!;
      assert(edition.chapters[0].sourceDraftId === a.id && edition.chapters[0].writing.content === expected && (await db.writings.get(W))!.content === writing.content, 'Native publication selected/promoted wrong source');
      passed.push(`Native ${width}px: own-draft history selection/restore and named publication selection retain canonical and other draft prose`);
      await act(async () => root.render(<div />));
    }
    return passed;
  } finally { await act(async () => root.unmount()); await deleteProject(P); }
}
