import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import type { CodexEntry, Project, Writing } from '@/types';
import { exportProjectData, importProjectData } from '@/db/operations';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { saveCodexDraft } from '@/engines/codex/operations';
import { deleteCodexTemplate, saveCodexTemplate } from '@/engines/codex/templates';
import { projectCodexEntry } from '@/engines/codex/properties';
import WorldEraToolbar from '@/services/worldEras/WorldEraToolbar';
import { eraThemeStyle } from '@/services/worldEras/theme';
import { listWorldDocuments, readWorldDocument, saveWorldEra, saveEraDocument, resetEraDocument, restoreEraVersion, hideEraDocument } from '@/services/worldEras/store';
import { eraWritingOperations, eraSnapshotOperations } from '@/services/worldEras/writings';
import { createParallelDraft, loadPaneDocument, promoteParallelDraft, savePaneDocument } from '@/engines/writings/parallelDrafts';
import { inspectWritingRecoveryDraft, writeWritingRecoveryDraft } from '@/engines/writings/recoveryJournal';
import { getAllBackupStrategies, preloadArchive } from '@/engines/_shared/backupRegistry';
import '@/services/worldEras/backup';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { useLocaleStore } from '@/stores/localeStore';
import type { EraRow } from '@/services/worldEras/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import { Clock3 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { getActiveEnginePaneScope } from '@/engines/_shared/EnginePaneContext';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const rejects = async (run: () => Promise<unknown>) => { let rejected = false; try { await run(); } catch { rejected = true; } assert(rejected, 'Expected stale write rejection'); };
const P = 'synthetic-world-eras';
const project: Project = { id: P, title: 'Synthetic eras', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex', 'writings'], engineOrder: ['codex', 'writings'], createdAt: 1, updatedAt: 1 };
const entry: CodexEntry = { id: 'era-card', projectId: P, title: 'Shared city', type: 'location', fields: { population: '120' }, content: '<p>Shared history.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
const writing: Writing = { id: 'era-writing', projectId: P, title: 'Shared chapter', content: '<p>Shared chapter prose.</p>', status: 'draft', wordCount: 4, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 };
const A = { projectId: P, eraId: 'ancient' }, B = { projectId: P, eraId: 'future' };
const era = (id: string) => ({ id, name: id, description: '', revision: 0, createdAt: 1, updatedAt: 1 });
const input = (node: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };

export async function testWorldEras(): Promise<string[]> {
  const passed: string[] = []; let cloneId: string | undefined;
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.codexEntries.put(entry); await db.writings.put(writing);
    await saveWorldEra(P, era(A.eraId), null); await saveWorldEra(P, era(B.eraId), null);
    for (const target of [A, B]) { assert((await readWorldDocument(target, 'codex', entry.id))?.provenance === 'base', 'Inherited read lost Base'); await eraSnapshotOperations(target).takeSnapshot(writing, 'auto'); }
    assert(await db.worldEraVariants.count() === 0, 'Creation/read/opening copied content');
    passed.push('Creating and reading two eras copies zero documents; inherited editor opens create no variants');
    Reflect.set(window,'__testStage','First Codex era write');const initial = (await readWorldDocument(A, 'codex', entry.id))!;
    await saveEraDocument(A, 'codex', { root: { ...entry, title: 'Ancient city' } as unknown as EraRow, children: {} }, initial.version);
    assert((await db.codexEntries.get(entry.id))?.title === 'Shared city' && (await readWorldDocument(B, 'codex', entry.id))?.document.root.title === 'Shared city', 'An era changed Base or sibling');
    await rejects(() => saveEraDocument(A, 'codex', initial.document, initial.version));
    await db.codexEntries.update(entry.id, { title: 'Current shared city' });
    assert((await readWorldDocument(A, 'codex', entry.id))?.document.root.title === 'Ancient city' && (await readWorldDocument(B, 'codex', entry.id))?.document.root.title === 'Current shared city', 'Fallback/own independence broken');
    passed.push('Same logical ID has independent own version and live Base fallback; stale CAS preserves winner');
    Reflect.set(window,'__testStage','Writing era CAS');const operations = eraWritingOperations(A); await operations.updateWritingAtVersion(writing.id, { content: '<p>Ancient prose.</p>' }, 1);
    let rejectedSnapshotId: string | undefined;
    try { await operations.updateWritingAtVersion(writing.id, { content: 'stale draft' }, 1); } catch (error) { rejectedSnapshotId = (error as { rejectedSnapshotId?: string }).rejectedSnapshotId; }
    assert(rejectedSnapshotId && (await eraSnapshotOperations(A).readSnapshot(rejectedSnapshotId))?.content === 'stale draft', 'Rejected writing candidate was not retained as a snapshot');
    Reflect.set(window,'__testStage','Parallel era draft');const opened = await loadPaneDocument(P, { writingId: writing.id }, A.eraId), draft = await createParallelDraft(opened, 'Alternate ancient');Reflect.set(window,'__testStage','Parallel era created');
    const draftDocument = await loadPaneDocument(P, { writingId: writing.id, draftId: draft.id }, A.eraId); Reflect.set(window,'__testStage','Parallel era save');const version = await savePaneDocument(draftDocument, '<p>Ancient alternative.</p>');
    Reflect.set(window,'__testStage','Parallel era promote');await promoteParallelDraft(P, draft.id, version, opened.version, A.eraId);
    assert((await operations.getWriting(writing.id))?.content === '<p>Ancient alternative.</p>' && (await db.writings.get(writing.id))?.content === writing.content && (await eraWritingOperations(B).getWriting(writing.id))?.content === writing.content, 'Parallel promotion escaped era');
    operations.expectDeletedWriting(writing.id); await operations.deleteWriting(writing.id); const undo = operations.takeLastDeletedWriting(writing.id); assert(undo, 'Era deletion lost Undo'); await operations.restoreDeletedWriting(undo);
    assert((await operations.getWriting(writing.id))?.content === '<p>Ancient alternative.</p>', 'Era undo lost prose/history');
    writeWritingRecoveryDraft(P, writing.id, writing.title, 'ancient unsaved', writing.title, writing.content, 'crashed:era:ancient');
    assert(inspectWritingRecoveryDraft(writing, 'new:era:future').kind === 'none' && inspectWritingRecoveryDraft(writing).kind === 'none', 'Recovery leaked across eras');
    assert(inspectWritingRecoveryDraft(writing, 'new:era:ancient').kind !== 'none', 'Same-era recovery failed');
    passed.push('Chapter CAS, parallel alternatives/promotion, history, Undo and crash recovery stay inside their era');
    Reflect.set(window,'__testStage','Hide/reset/history restore');const owned = (await readWorldDocument(A, 'codex', entry.id))!; await hideEraDocument(A, 'codex', entry.id, owned.version);
    assert(!await readWorldDocument(A, 'codex', entry.id) && await readWorldDocument(B, 'codex', entry.id), 'Tombstone scope broken');
    let variant = (await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P, A.eraId, 'codex', entry.id]).first())!;
    await resetEraDocument(A, 'codex', entry.id, variant.revision); assert((await readWorldDocument(A, 'codex', entry.id))?.document.root.title === 'Current shared city', 'Reinherit did not read current Base');
    variant = (await db.worldEraVariants.get(variant.id))!; await restoreEraVersion(A, 'codex', entry.id, variant.revision, 1);
    assert((await readWorldDocument(A, 'codex', entry.id))?.document.root.title === 'Ancient city', 'Own history restoration failed');
    await saveEraDocument(A, 'codex', { root: { ...entry, id: 'ancient-only', title: 'Only ancient' } as unknown as EraRow, children: {} }, null);
    assert(!(await listWorldDocuments(B, 'codex')).some(row => row.document.root.id === 'ancient-only'), 'Era-only root leaked');
    passed.push('Local tombstones, reinheritance, retained-version restoration and era-only cards preserve Base');
    Reflect.set(window,'__testStage','Template retirement');const template = await saveCodexTemplate(P, { id: 'cargo-type', name: 'Cargo', category: 'custom', fields: { crates: '3', total: '' }, content: '', propertyDefinitions: [{ id: 'crates', key: 'crates', label: 'Crates', kind: 'number' }, { id: 'total', key: 'total', label: 'Total', kind: 'number', formula: '=@[Crates]*7' }], revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const cargo = { ...entry, id: 'era-cargo', title: 'Cargo', type: 'custom', templateId: template.id, fields: { crates: '3', total: '' } };
    let cargoRead = await saveEraDocument(A, 'codex', { root: cargo as unknown as EraRow, children: {} }, null);
    cargoRead = await saveEraDocument(A, 'codex', { ...cargoRead.document, root: { ...cargoRead.document.root, title: 'Cargo current' } }, cargoRead.version);
    const staleCargo = cargoRead;
    await deleteCodexTemplate(P, template.id, template.revision);
    cargoRead = (await readWorldDocument(A, 'codex', cargo.id))!;
    assert(projectCodexEntry(cargoRead.document.root as unknown as CodexEntry).fields.total === '21', 'Retirement stripped era-only formula');
    await rejects(() => saveEraDocument(A, 'codex', staleCargo.document, staleCargo.version));
    await saveEraDocument(A, 'codex', { ...cargoRead.document, root: { ...cargoRead.document.root, fields: { crates: '4', total: '' } } }, cargoRead.version);
    assert(projectCodexEntry((await readWorldDocument(A, 'codex', cargo.id))!.document.root as unknown as CodexEntry).fields.total === '28', 'Retired formula stopped recomputing');
    let cargoVariant = (await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P, A.eraId, 'codex', cargo.id]).first())!;
    await restoreEraVersion(A, 'codex', cargo.id, cargoVariant.revision, 1);
    cargoVariant = (await db.worldEraVariants.get(cargoVariant.id))!;
    assert(projectCodexEntry(cargoVariant.document!.root as unknown as CodexEntry).fields.total === '21' && !await db.codexEntries.get(cargo.id), 'Restored retired-era history lost formulas or polluted Base');
    passed.push('Retiring a shared type preserves live formulas in era-only/current/history cards and invalidates stale CAS');
    const exported = await exportProjectData(P); cloneId = await importProjectData(exported); const clone = (await db.projects.get(cloneId))!;
    assert(clone.worldEras?.length === 2 && clone.worldEras[0].id !== A.eraId, 'Clone lost/remained linked to era definitions');
    const clonedCards = await listWorldDocuments({ projectId: cloneId, eraId: clone.worldEras[0].id }, 'codex');
    assert(clonedCards.some(row => row.document.root.title === 'Ancient city') && clonedCards.some(row => row.document.root.title === 'Only ancient') && clonedCards.every(row => row.document.root.id !== entry.id && row.document.root.projectId === cloneId), 'Clone lost own documents or identity isolation');
    const strategy = getAllBackupStrategies().find(item => item.engineId === 'world-eras')!, zip = new JSZip(), context = { zip, projectId: P, projectDir: 'project' };
    await strategy.exportProject(context); const bytes = await zip.generateAsync({ type: 'uint8array' }), roundtrip = await JSZip.loadAsync(bytes); await preloadArchive(roundtrip);
    const restored = await strategy.inspectImport({ ...context, zip: roundtrip }); assert(restored[0].rows.length >= 3, 'ZIP omitted variants');
    const before = await db.worldEraVariants.where('projectId').equals(P).toArray(); await db.worldEraVariants.where('projectId').equals(P).delete(); await strategy.importProject({ ...context, zip: roundtrip });
    assert(JSON.stringify(await db.worldEraVariants.where('projectId').equals(P).toArray()) === JSON.stringify(before), 'ZIP lost history/tombstone/identity');
    passed.push('Normal project JSON clone remaps logical/era IDs; native ZIP strategy round-trips variants and retained history');
    assert(getBridgeTool('wh_world_era_document_save'), 'Era tools not registered in normal manifest');
    const readReply = await runBridgeTool('wh_world_era_document_get', { ...A, kind: 'codex', entityId: entry.id }); assert(readReply.ok, JSON.stringify(readReply));
    const bridge = readReply.result as { document: { root: EraRow; children: Record<string, EraRow[]> }; version: string };
    const saveReply = await runBridgeTool('wh_world_era_document_save', { ...A, kind: 'codex', document: { ...bridge.document, root: { ...bridge.document.root, title: 'MCP ancient city' } }, expectedVersion: bridge.version }); assert(saveReply.ok, JSON.stringify(saveReply)); const saved = saveReply.result as { document: { root: EraRow } };
    assert(saved.document.root.title === 'MCP ancient city' && (await db.codexEntries.get(entry.id))?.title === 'Current shared city', 'Registered MCP variant mutation changed Base');
    passed.push('Registered bridge dispatch reads provenance/token and writes only explicit era variants');
    return passed;
  } finally { if (cloneId) { for (const table of [db.codexEntries, db.writings, db.worldEraVariants, db.writingSnapshots]) await table.where('projectId').equals(cloneId).delete(); await db.projects.delete(cloneId); } for (const table of [db.codexEntries, db.writings, db.worldEraVariants, db.writingSnapshots]) await table.where('projectId').equals(P).delete(); await db.projects.delete(P); localStorage.clear(); }
}

export async function testWorldErasUi(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!); const passed: string[] = [];
  useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.codexEntries.put(entry); await saveWorldEra(P, era(A.eraId), null); await saveWorldEra(P, { ...era(B.eraId), theme: { background: '#eee7dc', accent: '#6c3830' } }, null);
  function Pane({ initial }: { initial: string }) {
    const [eraId, setEraId] = React.useState(initial);
    const [current, setCurrent] = React.useState(entry);
    React.useEffect(() => { void readWorldDocument({ projectId: P, eraId }, 'codex', entry.id).then(value => { if (value) setCurrent(value.document.root as unknown as CodexEntry); }); }, [eraId]);
    return <EnginePaneContext.Provider value={{ instanceId: initial, projectId: P, eraId, visible: true }}><section data-pane={initial} style={eraThemeStyle(eraId === B.eraId ? { ...era(B.eraId), theme: { background: '#eee7dc' } } : undefined)}><WorldEraToolbar projectId={P} eraId={eraId} onChange={setEraId} /><div key={eraId} className="p-4"><CodexEntryForm projectId={P} entry={current} onCancel={() => {}} onSave={async (draft, base) => { const next = await saveCodexDraft(base!, draft, { projectId: P, eraId }); setCurrent(next); }} /></div></section></EnginePaneContext.Provider>;
  }
  try {
    await act(async () => { root.render(<MemoryRouter><main className="grid grid-cols-1 lg:grid-cols-2"><Pane initial={A.eraId} /><Pane initial={B.eraId} /></main></MemoryRouter>); await pause(500); });
    await act(async () => { await pause(400); });
    const left = document.querySelector<HTMLElement>('[data-pane="ancient"]')!, right = document.querySelector<HTMLElement>('[data-pane="future"]')!;
    await act(async () => { input(left.querySelector<HTMLInputElement>('input[placeholder="Entry name..."]')!, 'Ancient city from pane'); await pause(); });
    await act(async () => { [...left.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Save Changes')!.click(); await pause(300); });
    assert((await readWorldDocument(A, 'codex', entry.id))?.document.root.title === 'Ancient city from pane' && right.querySelector<HTMLInputElement>('input[placeholder="Entry name..."]')?.value === entry.title && (await db.codexEntries.get(entry.id))?.title === entry.title, 'Two-pane GUI save escaped context');
    passed.push('Two real Codex forms in independent era panes edit one logical card without changing sibling or Base');
    for (const width of [1440, 640]) {
      const sequence = width; (window as unknown as { __want: unknown }).__want = { w: width, h: 1000, n: sequence };
      for (let i = 0; i < 100 && (window as unknown as { __sizeAck: number }).__sizeAck !== sequence; i++) await pause(30);
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Era pane overflows viewport');
      for (const field of document.querySelectorAll<HTMLElement>('[data-testid="world-era-toolbar"] input, [data-testid="world-era-toolbar"] select, [data-testid="world-era-toolbar"] button')) { const bounds = field.getBoundingClientRect(); assert(bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Era controls overflow'); }
      (window as unknown as { __shot: unknown }).__shot = { name: `world-eras-${width}` }; for (let i = 0; i < 100 && (window as unknown as { __shotDone: string }).__shotDone !== `world-eras-${width}`; i++) await pause(30);
    }
    passed.push('Actual CSS at desktop/narrow widths keeps era controls and editor fields reachable; opposite pane themes are local');
    return passed;
  } finally { await act(async () => root.unmount()); await db.worldEraVariants.where('projectId').equals(P).delete(); await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.delete(P); localStorage.clear(); }
}
export async function testWorldWorkspaceUi(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  const engines: EngineDefinition[] = [{ id: 'writings', name: 'Writings', description: '', icon: Clock3, category: 'core', tables: {}, component: WritingsEngine }];
  const settle = async (test: () => boolean, label: string) => { for (let i = 0; i < 120; i++) { if (test()) return; await act(async () => { await pause(60); }); } throw new Error(`Waiting for ${label}`); };
  const select = (node: HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.writings.put(writing);
    await saveWorldEra(P, era(A.eraId), null); await saveWorldEra(P, era(B.eraId), null);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=${writing.id}&era=${A.eraId}`]}><ProjectWorkspace projectId={P} engines={engines}><WritingsEngine projectId={P} /></ProjectWorkspace></MemoryRouter>); await pause(300); });
    await settle(() => !!document.querySelector('[data-testid="workspace-primary"] button[title="Ctrl+S"]'), 'primary chapter');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="workspace-open"]')!.click(); await pause(200); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="workspace-duplicate-main"]')!.click(); await pause(200); });
    let pane = document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    await settle(() => !!pane.querySelector('button[title="Ctrl+S"]'), 'same logical chapter beside');
    await act(async () => { select(pane.querySelector<HTMLSelectElement>('[aria-label="Era in this pane"]')!, B.eraId); await pause(300); });
    pane = document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    await settle(() => !!pane.querySelector('button[title="Ctrl+S"]'), 'era switch retained chapter route');
    const primary = document.querySelector<HTMLElement>('[data-testid="workspace-primary"]')!;
    const primaryTitle = [...primary.querySelectorAll<HTMLInputElement>('input')].find(field => field.value === writing.title)!;
    const secondaryTitle = [...pane.querySelectorAll<HTMLInputElement>('input')].find(field => field.value === writing.title)!;
    assert(primaryTitle && secondaryTitle, 'Normal workspace did not show both chapter editors');
    await act(async () => { input(secondaryTitle, 'Future chapter in second pane'); secondaryTitle.focus(); await pause(); });
    await act(async () => { pane.querySelector<HTMLButtonElement>('button[title="Ctrl+S"]')!.click(); await pause(300); });
    assert((await eraWritingOperations(B).getWriting(writing.id))?.title === 'Future chapter in second pane' && (await eraWritingOperations(A).getWriting(writing.id))?.title === writing.title && (await db.writings.get(writing.id))?.title === writing.title, 'Normal Writings save escaped pane era');
    assert(getActiveEnginePaneScope()?.eraId === B.eraId, 'Outside-pane commands lost focused era');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="workspace-library-open"]')!.click(); await pause(300); });
    await settle(() => !!document.querySelector('[data-testid="workspace-library"]'), 'focused era library');
    assert(document.querySelector('[data-testid="workspace-library"]')?.textContent?.includes('Future chapter in second pane'), 'Library opened primary era instead of focused pane');
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click(); await pause(200); });
    await act(async () => { secondaryTitle.focus(); document.querySelector<HTMLButtonElement>('[data-testid="workspace-archive"]')!.click(); await pause(300); });
    await settle(() => !!document.querySelector('[data-testid="era-document-archive"]')?.textContent?.includes(B.eraId), 'focused era archive');
    const archive = document.querySelector<HTMLElement>('[data-testid="era-document-archive"]')!;
    assert(archive.textContent?.includes(B.eraId), 'Archive opened primary era instead of focused pane');
    await act(async () => { [...archive.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Active documents'))!.click(); await pause(150); });
    await act(async () => { [...archive.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Archive only here'))!.click(); await pause(250); });
    assert(!await eraWritingOperations(B).getWriting(writing.id) && (await eraWritingOperations(A).getWriting(writing.id))?.content === writing.content && await db.writings.get(writing.id), 'Archive action escaped focused era');
    await act(async () => { [...archive.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Archived and reinherited'))!.click(); await pause(150); });
    await act(async () => { [...archive.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Restore in this era'))!.click(); await pause(250); });
    assert((await eraWritingOperations(B).getWriting(writing.id))?.title === 'Future chapter in second pane', 'Era archive lost own prose on restore');
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click(); await pause(200); });
    await act(async () => { select(pane.querySelector<HTMLSelectElement>('[aria-label="Era in this pane"]')!, ''); await pause(300); });
    pane = document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    await settle(() => [...pane.querySelectorAll<HTMLInputElement>('input')].some(field => field.value === writing.title), 'return to Shared base');
    assert(primary.querySelector<HTMLSelectElement>('[aria-label="Era in this pane"]')?.value === A.eraId && (await db.worldEraVariants.where('projectId').equals(P).toArray()).every(row => row.eraId === B.eraId), 'Switching one pane changed another or created read copies');
    return ['Normal ProjectWorkspace duplicates one chapter, switches only its pane era, saves through Writings UI, tracks focused Library/Archive scope, archives/restores own prose and returns to Base without copies'];
  } finally { await act(async () => root.unmount()); for (const table of [db.writings, db.worldEraVariants, db.worldEraAssets, db.writingSnapshots]) await table.where('projectId').equals(P).delete(); await db.projects.delete(P); localStorage.clear(); }
}
export async function testWorldEraToolbarUi(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === label)!;
  const settle = async (test: () => boolean) => { for (let i = 0; i < 60; i++) { if (test()) return; await act(async () => { await pause(60); }); } throw Error('Era toolbar did not settle'); };
  function Toolbar() { const [id, setId] = React.useState<string>(); return <WorldEraToolbar projectId={P} eraId={id} onChange={setId} />; }
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project);
    await act(async () => { root.render(<Toolbar />); await pause(); });
    await act(async () => { button('New era').click(); await pause(); });
    await act(async () => { input(document.querySelector<HTMLInputElement>('[aria-label="Era name"]')!, 'Moon age'); input(document.querySelector<HTMLInputElement>('[aria-label="Era background"]')!, '#eee7dc'); await pause(); });
    await act(async () => { button('Save era').click(); await pause(150); });
    await settle(() => !!button('Edit era and theme'));
    let saved = (await db.projects.get(P))!.worldEras![0];
    assert(saved.name === 'Moon age' && saved.theme?.background === '#eee7dc' && await db.worldEraVariants.count() === 0, 'Era create copied content or lost theme');
    await act(async () => { button('Edit era and theme').click(); await pause(); });
    await act(async () => { input(document.querySelector<HTMLInputElement>('[aria-label="Era name"]')!, 'Preserved unsaved era title'); await pause(); });
    await act(async () => { await saveWorldEra(P, { ...saved, description: 'External change' }, saved.revision); await pause(); });
    await act(async () => { button('Save era').click(); await pause(150); });
    assert(document.querySelector<HTMLInputElement>('[aria-label="Era name"]')?.value === 'Preserved unsaved era title' && document.querySelector('[role="alert"]'), 'Definition CAS lost rejected form text');
    await act(async () => { button('Cancel').click(); await pause(); });
    await act(async () => { button('Edit era and theme').click(); await pause(); });
    await act(async () => { document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await pause(); });
    await act(async () => { button('Save era').click(); await pause(150); });
    await settle(() => !!button('Restore Moon age') && !button('Save era') && !document.querySelector<HTMLSelectElement>('[aria-label="Era in this pane"]')!.disabled);
    await act(async () => { [...document.querySelectorAll<HTMLElement>('summary')].find(row => row.textContent === 'Archived eras')!.click(); await pause(); });
    assert((await db.projects.get(P))!.worldEras![0].archived, 'Archive definition did not persist');
    await act(async () => { button('Restore Moon age').click(); await pause(); });
    await settle(() => !!button('Save era') && !button('Save era').disabled && !document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked);
    if ((window as unknown as { __sizeAck?: number }).__sizeAck !== undefined) {
      (window as unknown as { __want: unknown }).__want = { w: 640, h: 1000, n: 1640 };
      for (let i = 0; i < 100 && (window as unknown as { __sizeAck: number }).__sizeAck !== 1640; i++) await pause(30);
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Expanded era editor overflows narrow viewport');
      (window as unknown as { __shot: unknown }).__shot = { name: 'world-eras-editor-640' };
      for (let i = 0; i < 100 && (window as unknown as { __shotDone: string }).__shotDone !== 'world-eras-editor-640'; i++) await pause(30);
    }
    await act(async () => { button('Save era').click(); await pause(150); });
    await settle(() => !!button('Edit era and theme'));
    saved = (await db.projects.get(P))!.worldEras![0]; assert(!saved.archived && saved.description === 'External change' && saved.theme?.background === '#eee7dc', 'Restore lost theme/metadata');
    return ['Normal era toolbar creates themed eras with zero copies, preserves rejected edits, archives/restores definitions and fits narrow CSS'];
  } finally { await act(async () => root.unmount()); await db.projects.delete(P); localStorage.clear(); }
}
import React from 'react';
