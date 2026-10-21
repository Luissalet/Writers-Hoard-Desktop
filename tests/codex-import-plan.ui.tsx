import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { saveWorldEra, listEraRows } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import CodexFolderImportPanel from '@/engines/genealogy/components/CodexFolderImportPanel';
import '@/styles/genealogy.css';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw Error('Import UI handshake timed out'); }
async function settle(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await act(async () => { await pause(); }); } throw Error('Import UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect(), point = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseDown', ...point }, { type: 'mouseUp', ...point }]); }
const keys = (keyCode: string) => [{ type: 'keyDown', keyCode }, { type: 'keyUp', keyCode }];

export async function testCodexImportPlanLayout() {
  const P = `import-plan-${Date.now()}`, eraId = 'later', host = document.getElementById('root')!, root = createRoot(host), results: string[] = [];
  const project: Project = { id: P, title: 'Synthetic import review', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['codex', 'genealogy'], createdAt: 1, updatedAt: 1, codexTemplates: [{ id: 'harbor', name: 'Puerto', category: 'location', content: '', fields: { berths: '2', total: '' }, propertyDefinitions: [{ id: 'berths', key: 'berths', label: 'Berths', kind: 'number' }, { id: 'total', key: 'total', label: 'Total', kind: 'number', formula: '=@[Berths]*7' }], revision: 0, createdAt: 1, updatedAt: 1 }] };
  try {
    useLocaleStore.setState({ locale: 'es' }); await db.projects.put(project);
    await saveWorldEra(P, { id: eraId, name: 'Later age', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    for (const width of [1440, 640]) {
      const n = ++sequence; await act(async () => { channel.__want = { w: width, h: 1000, n }; await wait(() => channel.__sizeAck === n); });
      await act(async () => { root.render(<EnginePaneContext.Provider value={{ instanceId: `import-${width}`, projectId: P, eraId, visible: true, primary: true }}><main className="min-h-screen bg-deep p-6 text-text-primary"><h1 className="mb-4 text-xl">Importación de documentos</h1><CodexFolderImportPanel key={width} projectId={P} onChanged={() => undefined} /></main></EnginePaneContext.Provider>); await pause(); });
      const transfer = new DataTransfer(); transfer.items.add(new File(['# Lighthouse\n\nThe original harbor manuscript.'], `Harbor-${width}.md`, { type: 'text/markdown' })); transfer.items.add(new File(['# Unfinished\n\nKeep this source outside the import.'], `Draft-${width}.md`, { type: 'text/markdown' }));
      await act(async () => { const input = host.querySelector<HTMLInputElement>('[data-testid="codex-import-files"]')!; input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
      await settle(() => !host.querySelector<HTMLButtonElement>('[data-testid="codex-import-preview"]')!.disabled);
      await click(host.querySelector<HTMLButtonElement>('[data-testid="codex-import-preview"]')!);
      await settle(() => host.querySelectorAll('[data-testid="codex-import-plan-row"]').length === 2);
      const [first, second] = [...host.querySelectorAll<HTMLElement>('[data-testid="codex-import-plan-row"]')];
      const title = first.querySelector<HTMLInputElement>('input[type="text"]')!; await click(title); await native([{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }, { type: 'text', text: 'El puerto viejo' }]);
      const template = first.querySelectorAll<HTMLSelectElement>('select')[1]; await click(template); await native([...keys('HOME'), ...keys('DOWN'), ...keys('ENTER')]);
      await click(second.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
      await settle(() => template.value === 'harbor' && title.value === 'El puerto viejo' && host.querySelector('[data-testid="codex-import-apply"]')?.textContent?.includes('(1)') === true);
      assert(first.querySelector('select')?.value === 'location', 'Template must set its category in the review plan');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Editable plan has horizontal overflow');
      const shot = `import-plan-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      await click(host.querySelector<HTMLButtonElement>('[data-testid="codex-import-apply"]')!);
      await settle(() => host.querySelector('[data-testid="codex-import-status"]')?.textContent?.includes('1') === true);
      const entries = await listEraRows<CodexEntry>({ projectId: P, eraId }, 'codexEntries'), imported = entries.find(row => row.fields.__importSourcePath === `Harbor-${width}.md`);
      assert(imported?.title === 'El puerto viejo' && imported.type === 'location' && imported.templateId === 'harbor', 'Normal import did not apply edited destination fields');
      assert(imported.content.includes('original harbor manuscript') && imported.fields.__importSourceContent.includes('# Lighthouse'), 'Import plan lost original prose or provenance');
      const response = await runBridgeTool('wh_get_codex_entry', { projectId: P, eraId, id: imported.id }); assert(response.ok && (response.result as CodexEntry).fields.total === '14', 'Imported template formula is not operational');
      assert(await db.codexEntries.where('projectId').equals(P).count() === 0 && !entries.some(row => row.fields.__importSourcePath === `Draft-${width}.md`), 'Era plan wrote Base or imported excluded source');
      await click(host.querySelector<HTMLButtonElement>('[data-testid="codex-import-undo"]')!);
      await settle(() => !host.querySelector('[data-testid="codex-import-undo"]'));
      assert(!(await listEraRows<CodexEntry>({ projectId: P, eraId }, 'codexEntries')).some(row => row.id === imported.id), 'Scoped import undo left its card visible');
      results.push(`Actual CSS ${width}px: native title/template/exclusion, atomic era import, formula/provenance and scoped undo`);
    }
    return results;
  } finally { await act(async () => root.unmount()); await deleteProject(P); }
}
