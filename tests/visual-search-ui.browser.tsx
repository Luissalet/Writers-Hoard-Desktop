import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import GalleryEngine from '@/engines/gallery/GalleryEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { searchVisualImages } from '@/services/visualSearch/search';
import { useLocaleStore } from '@/stores/localeStore';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const channel = window as unknown as { __visualFixtures?: string[]; __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
const pause = () => new Promise(resolve => setTimeout(resolve, 40)); let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 400; i++) { if (check()) return; await pause(); } throw Error('Visual UI handshake timed out'); }
async function settle(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 400; i++) { if (await check()) return; await act(async () => { await pause(); }); } throw Error('Visual UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
const keys = (keyCode: string, modifiers?: string[]) => [{ type: 'keyDown', keyCode, modifiers }, { type: 'keyUp', keyCode, modifiers }];
export async function testVisualSearchUi() {
  await wait(() => !!channel.__visualFixtures);
  const P = `visual-search-${Date.now()}`, F = `${P}-foreign`, [map, page] = channel.__visualFixtures!, host = document.getElementById('root')!, root = createRoot(host), results: string[] = [];
  let mounted = false;
  try {
    useLocaleStore.setState({ locale: 'es' });
    await db.projects.bulkPut([P, F].map(id => ({ id, title: 'Synthetic visual search', mode: 'custom', type: 'standalone', enabledEngines: ['gallery', 'codex'], createdAt: 1, updatedAt: 1 })));
    await db.inspirationImages.bulkPut([{ id: 'IMG4821', projectId: P, imageData: map, notes: '', tags: [], createdAt: 1 }, { id: 'IMG4822', projectId: P, imageData: page, notes: '', tags: [], createdAt: 2 }, { id: 'foreign-image', projectId: F, imageData: map, notes: '', tags: [], createdAt: 1 }]);
    for (const width of [1440, 640]) {
      const n = ++sequence;
      await act(async () => { channel.__want = { w: width, h: 1000, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `visual-${width}`, projectId: P, primary: true, visible: true }}><main className="min-h-screen bg-deep p-5 text-text-primary"><GalleryEngine projectId={P} /></main></EnginePaneContext.Provider></MemoryRouter>); mounted = true; await pause(); });
      await settle(() => !!host.querySelector('select[aria-label="Modo de búsqueda de imágenes"]') && host.querySelectorAll('img').length === 2);
      await click(host.querySelector<HTMLSelectElement>('select[aria-label="Modo de búsqueda de imágenes"]')!); await native([...keys('HOME'), ...keys('DOWN'), ...keys('ENTER')]);
      const search = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Buscar por contenido');
      await settle(() => !!search());
      const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
      await click(input); await native([...keys('A', ['control']), { type: 'text', text: 'un mapa de montañas y costas' }]);
      await click(search()!); await settle(() => !search()?.disabled && host.querySelector('img')?.getAttribute('src') === map);
      assert(host.querySelectorAll('img').length === 2, 'Content search must rank the project images, not leak foreign images');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Visual search overflows horizontally');
      const shot = `visual-search-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      await click(input); await native([...keys('A', ['control']), { type: 'text', text: 'una página de un libro con texto' }]);
      await click(search()!); await settle(() => !search()?.disabled && host.querySelector('img')?.getAttribute('src') === page);
      results.push(`Native ${width}px Gallery: opaque untagged map/book images rank by pixels for two Spanish queries through real preload/IPC/CPU worker`);
      await act(async () => root.render(<div />));
    }
    const tool = async (name: string, args: Record<string, unknown> = {}) => { const result = await runBridgeTool(name, args); assert(result.ok, JSON.stringify(result)); return result.result; };
    const status = await tool('wh_visual_search_status') as { state: string }; assert(status.state === 'ready', 'Normal registered status not ready');
    const matches = await tool('wh_visual_search_images', { projectId: P, query: 'a page of a book with text' }) as { matches: { id: string }[] }; assert(matches.matches[0].id === 'IMG4822' && matches.matches.length === 2, 'MCP ranking disagrees with actual UI or includes foreign image');
    const images = await db.inspirationImages.where('projectId').equals(P).toArray();
    let foreignRejected = false; try { await searchVisualImages(P, 'map', [...images, (await db.inspirationImages.get('foreign-image'))!]); } catch { foreignRejected = true; } assert(foreignRejected, 'Foreign supplied candidates were accepted');
    const old = await window.electronAPI!.visualSearch.image(map), fresh = await window.electronAPI!.visualSearch.image(page); assert(old.hash !== fresh.hash && old.cached && fresh.cached, 'Image-byte identity/cached lookup failed');
    await db.inspirationImages.update('IMG4821', { imageData: page });
    const replaced = await tool('wh_visual_search_images', { projectId: P, query: 'a map' }) as { matches: { score: number }[] }; assert(Math.abs(replaced.matches[0].score - replaced.matches[1].score) < 1e-8, 'Replacing image bytes kept the old visual embedding');
    const retained = await db.inspirationImages.get('IMG4821'); assert(retained?.notes === '' && retained.tags.length === 0 && !('vector' in retained), 'Search wrote derived data or invented metadata into authored images');
    results.push('Registered MCP/status use the same pixel ranking; project scope, byte replacement invalidation and derived-cache separation pass');
    return results;
  } finally { if (mounted) await act(async () => root.unmount()); await deleteProject(P); await deleteProject(F); }
}
