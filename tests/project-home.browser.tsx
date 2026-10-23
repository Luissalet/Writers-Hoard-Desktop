import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { deriveDocumentGrowth, deriveNextProjectMove, loadProjectCockpit } from '@/services/projectIntelligence';
import { quickCreateProjectDocument, quickCreateEngines } from '@/services/projectQuickCreate';
import { buildQuickCreateActions } from '@/services/commandCenter';
import { listEraRows } from '@/services/worldEras/store';
import { HOME_HANDLERS } from '@/services/aiBridge/tools/projectHome';
import { recordLibraryOpen } from '@/components/project/workspace/library/opened';
import { workspaceDocument } from '@/components/project/workspace/library/catalog';
import ProjectHomeTools, { DocumentGrowthPanel } from '@/components/project/ProjectHomeTools';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';
import GlobalSearch from '@/components/common/GlobalSearchBody';
import { useAppStore } from '@/stores/appStore';

const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const projectId = 'home-1095-test';
const input = (element: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

export async function testProjectHome(): Promise<string[]> {
  const results: string[] = [];
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    useLocaleStore.setState({ locale: 'en' });
    const month = new Date(2026, 9, 7).getTime();
    const growth = deriveDocumentGrowth([{ createdAt: month }, { createdAt: month + 1000 }, {}, { createdAt: NaN }]);
    assert(growth.months.length === 1 && growth.months[0].month === '2026-10' && growth.months[0].count === 2 && growth.undated === 2, 'Creation dates, not edit/open time; invalid and missing stay undated');
    const project = { id: projectId, title: 'Home QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#999999', enabledEngines: ['writings', 'notes', 'outline'], engineOrder: [], createdAt: month, updatedAt: month, worldEras: [{ id: 'era-home', name: 'Earlier', description: '', revision: 1, createdAt: month, updatedAt: month }] } as Project;
    await db.projects.put(project);
    assert(quickCreateEngines(project.enabledEngines, 'era-home').join(',') === 'writings,notes', 'No unscoped outline offered in an era');
    assert(buildQuickCreateActions(project, '  La cripta  ')[0].createTitle === 'La cripta', 'Palette keeps the real creation text');
    assert(buildQuickCreateActions(undefined, 'Title').length === 0 && buildQuickCreateActions(project, ' ').length === 0, 'Creation requires a project and nonempty text');
    results.push('Monthly real creation dates and explicit unknown dates; quick-create engine/scope choices');

    const writing = await quickCreateProjectDocument({ projectId }, 'writings', 'Chapter');
    const note = await quickCreateProjectDocument({ projectId }, 'notes', 'An idea');
    const outline = await quickCreateProjectDocument({ projectId }, 'outline', 'Structure');
    assert((await db.writings.get(writing.id))?.status === 'idea' && (await db.notes.get(note.id))?.text === 'An idea' && (await db.outlines.get(outline.id))?.title === 'Structure', 'All three engine operations persist');
    const eraWriting = await quickCreateProjectDocument({ projectId, eraId: 'era-home' }, 'writings', 'Earlier chapter');
    const eraNote = await quickCreateProjectDocument({ projectId, eraId: 'era-home' }, 'notes', 'Earlier idea');
    assert(!await db.writings.get(eraWriting.id) && !await db.notes.get(eraNote.id), 'Era creations never leak into base tables');
    assert((await listEraRows<{ id: string }>({ projectId, eraId: 'era-home' }, 'writings')).some(row => row.id === eraWriting.id), 'Era writing visible in era');
    assert((await listEraRows<{ id: string }>({ projectId, eraId: 'era-home' }, 'notes')).some(row => row.id === eraNote.id), 'Era note visible in era');
    let refused = false;
    try { await quickCreateProjectDocument({ projectId, eraId: 'era-home' }, 'outline', 'Must not leak'); } catch { refused = true; }
    assert(refused && (await db.outlines.where('projectId').equals(projectId).count()) === 1, 'Outline era request rejected before mutation');
    results.push('Normal create operations for writings/notes/outlines; era isolation and base-only outlines');

    recordLibraryOpen(projectId, workspaceDocument(projectId, 'writings', writing.id, 'Old title'));
    recordLibraryOpen(projectId, workspaceDocument(projectId, 'writings', 'gone-id', 'Deleted'));
    await db.writings.update(writing.id, { title: 'Current title' });
    const home = await HOME_HANDLERS.wh_project_home({ projectId }) as { documentGrowth: { months: { count: number }[] }; openedFromLibraryThisSession: { title: string }[] };
    assert(home.documentGrowth.months.reduce((n, row) => n + row.count, 0) === 3, 'Home counts only base documents');
    assert(home.openedFromLibraryThisSession.length === 1 && home.openedFromLibraryThisSession[0].title === 'Current title', 'Session-opened entries resolve titles and drop deleted entries');
    const created = await HOME_HANDLERS.wh_project_quick_create({ projectId, engineId: 'notes', text: 'From MCP' }) as { id: string; __audit: { entityId: string } };
    assert((await db.notes.get(created.id))?.text === 'From MCP' && created.__audit.entityId === created.id, 'MCP creation shares native operation and audit envelope');
    const data = await loadProjectCockpit(projectId);
    assert(deriveNextProjectMove(project.enabledEngines, { ...data, counts: { ...data.counts, unresolved: 1 } }) === 'review', 'Real unresolved items take priority');
    assert(deriveNextProjectMove(['writings'], { ...data, counts: { ...data.counts, unresolved: 0, writings: 0 } }) === 'write', 'An empty writing project has a useful first action');
    results.push('Home MCP reads actual base data, resolves opened entries and creates native notes; contextual next action');

    await act(async () => { root.render(<MemoryRouter><ProjectHomeTools projectId={projectId} data={data} onReview={() => {}} onContinue={() => {}} /><DocumentGrowthPanel growth={growth} /></MemoryRouter>); await pause(); });
    for (let i = 0; i < 40 && !host.querySelector('[aria-label="Create"] button'); i++) await act(pause);
    const next = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('home.tipNext')}"]`)!;
    assert(next && host.textContent?.includes(t('home.tip.0')), 'Manual tip starts at first');
    await act(async () => { next.click(); await pause(); });
    assert(host.textContent?.includes(t('home.tip.1')), 'Tip changes only on explicit navigation');
    const noteChip = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Create"] button')].find(button => button.textContent?.includes(t('engines.notes.name')))!;
    await act(async () => { noteChip.click(); await pause(); });
    const box = host.querySelector<HTMLInputElement>('#home-quick-create')!;
    await act(async () => { input(box, 'Keep this idea'); await pause(); });
    await db.projects.update(projectId, { enabledEngines: [] });
    await act(pause);
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); });
    assert(host.querySelector('[role="alert"]') && host.querySelector<HTMLInputElement>('#home-quick-create')?.value === 'Keep this idea', 'Failed creation preserves draft and gives a retry message');
    assert(await db.notes.where('projectId').equals(projectId).count() === 2, 'Disabled engine cannot receive a hidden note');
    results.push('Real React controls: manual tips, inline draft and failure after engine disabled preserves text');
    await db.projects.update(projectId, { enabledEngines: ['notes'] });
    await act(pause);
    const before = await db.notes.where('projectId').equals(projectId).count();
    await act(async () => { const form = host.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); });
    assert(await db.notes.where('projectId').equals(projectId).count() === before + 1, 'Two immediate submits create exactly one note');
    results.push('Retry succeeds using current enabled engines; duplicate simultaneous form submits create one document');
    await db.projects.update(projectId, { enabledEngines: ['writings', 'notes'] });
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${projectId}/overview`]}><Routes><Route path="/project/:id/*" element={<GlobalSearch />} /></Routes></MemoryRouter>); useAppStore.setState({ searchOpen: true }); await pause(); });
    for (let i = 0; i < 40 && !host.querySelector('[role="combobox"]'); i++) await act(pause);
    const queryBox = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => { input(queryBox, 'Una creación desde teclado'); await pause(); });
    for (let i = 0; i < 40 && host.querySelectorAll('[role="option"]').length !== 2; i++) await act(pause);
    assert(host.querySelectorAll('[role="option"]').length === 2, 'Palette has creation actions for enabled engines');
    const beforePalette = await db.writings.where('projectId').equals(projectId).count();
    await act(async () => { queryBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); queryBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); });
    for (let i = 0; i < 40 && useAppStore.getState().searchOpen; i++) await act(pause);
    assert(!useAppStore.getState().searchOpen && await db.writings.where('projectId').equals(projectId).count() === beforePalette + 1, 'Keyboard creation persists once then closes palette');
    assert((await db.writings.where('projectId').equals(projectId).toArray()).some(row => row.title === 'Una creación desde teclado'), 'Accents and user text survive palette creation');
    results.push('Real command palette Enter creates exactly once, keeps accents, then closes; enabled-engine actions only');
  } finally {
    await act(async () => { root.unmount(); useAppStore.setState({ searchOpen: false }); }); host.remove();
    for (const table of [db.writings, db.notes, db.outlines, db.worldEraVariants]) await table.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
  return results;
}
