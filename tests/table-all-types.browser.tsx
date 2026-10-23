// A live table of every Codex card, whatever its type: rows are the cards,
// a Type column, read-only cells; in the table view and through the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TablesEngine from '@/engines/tables/TablesEngine';
import { projectWorldTable } from '@/engines/tables/projection';
import type { WorldTable } from '@/engines/tables/types';
import { readWorldDocument } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { CodexEntry, Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testTableAllTypes(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'table-all-types';
  const card = (id: string, title: string, type: CodexEntry['type']) => ({ id, projectId: P, type, title, content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry);
  const cards = [card('c1', 'Marta', 'character'), card('c2', 'Puerto Sal', 'location'), card('c3', 'La Orden', 'faction')];
  const view: WorldTable = { id: 'all', title: 'Todo', mode: 'table', codexAllTypes: true, columns: [{ id: 'n', name: 'Nombre', kind: 'text', field: 'title' }, { id: 't', name: 'Tipo', kind: 'text', field: '__type' }], rows: [] };
  const projected = projectWorldTable(view, cards, []);
  assert(projected.rows.map(r => `${r.cells.n}:${r.cells.t}`).join() === 'Marta:character,Puerto Sal:location,La Orden:faction', `Rows: ${JSON.stringify(projected.rows)}`);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await db.projects.put({ id: P, title: 'Puerto', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['tables', 'codex'], createdAt: 1, updatedAt: 1 } as Project);
    await db.codexEntries.bulkPut(cards);
    const made = await runBridgeTool('wh_table_create_cards_view', { projectId: P, title: 'Todas las fichas' });
    assert(made.ok, JSON.stringify(made));
    const id = (made.result as { table: WorldTable }).table.id;
    const query = await runBridgeTool('wh_table_query', { projectId: P, tableId: id, conditions: [{ columnId: (made.result as { table: WorldTable }).table.columns[1].id, op: 'equals', value: 'location' }] });
    assert(query.ok && (query.result as { rows: Array<{ cells: Record<string, string> }> }).rows.map(r => r.cells.Nombre).join() === 'Puerto Sal', `Query: ${JSON.stringify(query.result).slice(0, 300)}`);
    const version = (await readWorldDocument({ projectId: P }, 'tables', id))!.version;
    const edit = await runBridgeTool('wh_table_edit', { projectId: P, tableId: id, expectedVersion: version, action: 'insert-row' });
    assert(!edit.ok, 'Read-only');
    passed.push('Bridge: wh_table_create_cards_view makes a live table of every card with Nombre and Tipo; wh_table_query with Tipo = location gives Puerto Sal; rows cannot be added to it');
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><TablesEngine projectId={P} /></MemoryRouter>); await pause(500); });
    for (let i = 0; i < 40 && document.querySelectorAll('tbody tr[data-row-id]').length < 3; i++) await act(async () => { await pause(100); });
    const text = document.querySelector('tbody')?.textContent ?? '';
    const editable = document.querySelectorAll('tbody textarea, tbody input:not([type="checkbox"]), tbody select');
    assert(/Marta/.test(text) && /Personaje/.test(text) && /Lugar/.test(text), `View: ${text.slice(0, 300)}`);
    assert(editable.length === 0 && document.querySelector('[data-testid="table-all-types-note"]'), 'Cells read-only, a note instead of "Añadir fila"');
    passed.push('Table view: "Todas las fichas" lists Marta, Puerto Sal and La Orden with their type, cells read only, and a note to change a card from the card instead of "Añadir fila"');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
