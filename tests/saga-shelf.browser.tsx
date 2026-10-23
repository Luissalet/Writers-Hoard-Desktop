// A saga's books on a shelf inside its card on the Dashboard: words and last
// edit per book, each opening on its own; a search shows every match alone.
import '@/engines';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import Dashboard from '@/pages/Dashboard';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, tries = 120) { for (let i = 0; i < tries; i++) { if (check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }

function Harness() { const location = useLocation(); return <><output id="saga-route">{location.pathname}</output><Dashboard /></>; }

export async function testSagaShelf(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const base = { description: '', mode: 'custom', status: 'draft', color: '#777777', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1 } as const;
  const rows = [
    { ...base, id: 'shelf-saga', title: 'Crónicas de Sal', type: 'saga', updatedAt: 5 },
    { ...base, id: 'shelf-b1', title: 'El faro', type: 'standalone', parentId: 'shelf-saga', updatedAt: 4 },
    { ...base, id: 'shelf-b2', title: 'La marea', type: 'standalone', parentId: 'shelf-saga', updatedAt: 3 },
    { ...base, id: 'shelf-solo', title: 'Cuaderno suelto', type: 'standalone', updatedAt: 2 },
  ] as unknown as Project[];
  await db.projects.bulkPut(rows);
  await db.writings.put({ id: 'shelf-w1', projectId: 'shelf-b1', title: 'Uno', status: 'draft', content: '<p>Uno dos tres cuatro.</p>', wordCount: 4, tags: [], createdAt: 1, updatedAt: Date.now() } as never);
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  const titles = () => [...document.querySelectorAll('article h3')].map(node => node.textContent?.trim());
  try {
    await act(async () => { root.render(<MemoryRouter><Harness /></MemoryRouter>); await pause(300); });
    await until(() => titles().includes('Crónicas de Sal') && !!document.querySelector('[data-testid="project-card-books"]'), 'dashboard with shelf');
    assert(!titles().includes('El faro') && !titles().includes('La marea') && titles().includes('Cuaderno suelto'), `Top level: ${titles().join(' | ')}`);
    const shelf = document.querySelector('[data-testid="project-card-books"]')!;
    assert(/Libros de esta saga \(2\)/.test(shelf.textContent ?? '') && /El faro.*La marea/s.test(shelf.textContent ?? ''), `Shelf: ${shelf.textContent}`);
    await until(() => /4 pal\./.test(document.querySelector('[data-testid="project-card-book-shelf-b1"]')?.textContent ?? ''), 'book words');
    passed.push('Dashboard: "Crónicas de Sal" shows "Libros de esta saga (2)" with El faro (4 pal.) and La marea inside its card; the books are not repeated as cards; "Cuaderno suelto" stays on its own');
    const search = document.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'marea'); search.dispatchEvent(new Event('input', { bubbles: true })); await pause(120); });
    await until(() => titles().includes('La marea'), 'search finds the book');
    assert(titles().length === 1, `Search shows only the match: ${titles().join(' | ')}`);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, ''); search.dispatchEvent(new Event('input', { bubbles: true })); await pause(120); });
    await until(() => !!document.querySelector('[data-testid="project-card-book-shelf-b2"]'), 'shelf back');
    await act(async () => { (document.querySelector('[data-testid="project-card-book-shelf-b2"]') as HTMLButtonElement).click(); await pause(120); });
    assert(document.getElementById('saga-route')?.textContent === '/project/shelf-b2', `Route: ${document.getElementById('saga-route')?.textContent}`);
    passed.push('A search for "marea" shows "La marea" as its own card; clicking a book on the shelf opens that book (not the saga)');
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    for (const row of rows) await deleteProject(row.id);
  }
  return passed;
}
