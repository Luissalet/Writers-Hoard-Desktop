import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import TablesEngine from '@/engines/tables/TablesEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { saveWorldEra, getEraProject } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldTable } from '@/engines/tables/types';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
const pause = () => new Promise(resolve => setTimeout(resolve, 40)); let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw Error('Decimal UI handshake timed out'); }
async function settle(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 200; i++) { if (await check()) return; await act(async () => { await pause(); }); } throw Error('Decimal UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
export async function testTableDecimalUi() {
  const P = `decimal-ui-${Date.now()}`, scope = { projectId: P, eraId: 'later' }, host = document.getElementById('root')!, root = createRoot(host), results: string[] = []; let mounted = false;
  const tool = async <T,>(name: string, args: Record<string, unknown>) => { const result = await runBridgeTool(name, { ...scope, ...args }); assert(result.ok, JSON.stringify(result)); return result.result as T; };
  try {
    useLocaleStore.setState({ locale: 'es' });
    await db.projects.put({ id: P, title: 'Synthetic prices', type: 'standalone', mode: 'custom', enabledEngines: ['tables', 'codex'], createdAt: 1, updatedAt: 1 });
    await saveWorldEra(P, { id: 'later', name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const created = await tool<{ table: WorldTable }>('wh_table_create', { title: 'Precios del puerto', columns: [{ name: 'Producto', kind: 'text' }, { name: 'Coste', kind: 'number' }], rows: [['Sal', '1.25']] });
    const tableId = created.table.id, column = created.table.columns[1], row = created.table.rows[0];
    const get = () => tool<{ table: WorldTable; version: string }>('wh_table_get', { tableId });
    const initial = await get();
    await tool('wh_table_append_row', { tableId, expectedVersion: initial.version, values: ['Aceite', '3.125'] });
    assert(!(await runBridgeTool('wh_table_append_row', { ...scope, tableId, expectedVersion: initial.version, values: ['Stale', '9'] })).ok, 'Stale append accepted');
    for (const width of [1440, 640]) {
      const n = ++sequence;
      await act(async () => { channel.__want = { w: width, h: 1000, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `table-${width}`, projectId: P, eraId: 'later', primary: true, visible: true }}><main className="min-h-screen bg-deep p-4 text-text-primary"><TablesEngine key={width} projectId={P} /></main></EnginePaneContext.Provider></MemoryRouter>); mounted = true; await pause(); });
      await settle(() => !!host.querySelector('input[aria-label="B1 Coste"]'));
      await click(host.querySelector<HTMLInputElement>('input[aria-label="B1 Coste"]')!);
      const value = width === 1440 ? '2.75' : '-0.125';
      await native([{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }, { type: 'text', text: value }, { type: 'keyDown', keyCode: 'ENTER' }, { type: 'keyUp', keyCode: 'ENTER' }]);
      await settle(async () => (await getEraProject(scope)).dataTables?.find(table => table.id === tableId)?.rows[0].cells[column.id] === value);
      assert((await get()).table.rows[0].cells[column.id] === value, 'MCP did not read the actual UI decimal');
      assert((await tool<{ csv: string }>('wh_table_export_csv', { tableId })).csv.includes(value), 'CSV lost authored decimal');
      window.scrollTo(0, 0); assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Decimal table overflows the window');
      const shot = `table-decimals-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      results.push(`Native ${width}px: decimal/negative input commits through normal UI; MCP/CSV read the same authored value`);
    }
    const read = await get();
    await tool('wh_table_save_cell', { tableId, rowId: row.id, columnId: column.id, value: '.5e1', expected: read.table.rows[0].cells[column.id] });
    assert((await get()).table.rows[0].cells[column.id] === '.5e1', 'MCP lost exponent spelling');
    assert(!(await runBridgeTool('wh_table_save_cell', { ...scope, tableId, rowId: row.id, columnId: column.id, value: 'NaN', expected: '.5e1' })).ok, 'Nonfinite input accepted');
    assert((await tool<{ tables: unknown[] }>('wh_tables_list', {})).tables.length === 1 && !(await db.projects.get(P))?.dataTables?.length, 'Era table leaked into Base');
    results.push('All six registered table tools use effective era rows, optimistic CAS and typed validation; Base remains intact');
    return results;
  } finally { if (mounted) await act(async () => root.unmount()); await deleteProject(P); }
}
