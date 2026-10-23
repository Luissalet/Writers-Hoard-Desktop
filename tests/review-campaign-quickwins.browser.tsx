import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { seedWorkspaceLibrary } from './workspace-library-data';
import { pinWorkspaceDocument } from '@/components/project/workspace/library/store';
import { readWorkspaceLibrary } from '@/components/project/workspace/library/model';
import { listWorkspaceDocuments } from '@/components/project/workspace/library/catalog';
import { workspaceDocumentKey } from '@/components/project/workspace/library/types';
import { getEraProject, saveWorldEra } from '@/services/worldEras/store';
import { clearUndoJournal, getUndoJournal, lastUndoable, undoEntry } from '@/services/undoJournal';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import WorkspaceDecoration from '@/services/workspaceAppearance/WorkspaceDecoration';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
export async function testReviewCampaignQuickWins(): Promise<string[]> {
  const results: string[] = [], projectId = 'review-quickwins-1095';
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    useLocaleStore.setState({ locale: 'en' }); await seedWorkspaceLibrary(projectId); clearUndoJournal();
    const docs = await listWorkspaceDocuments(projectId), document = docs.find(row => row.engineId === 'writings')!;
    const revision = readWorkspaceLibrary((await db.projects.get(projectId))!).revision;
    const concurrent = await Promise.allSettled([pinWorkspaceDocument(projectId, revision, document, true), pinWorkspaceDocument(projectId, revision, document, true)]);
    assert(concurrent.filter(row => row.status === 'fulfilled').length === 1 && getUndoJournal().length === 1, 'Concurrent same-revision pins must produce one change and one undo receipt');
    assert(await undoEntry(lastUndoable(projectId)!.id) === 'undone', 'Winning concurrent pin undo');
    assert(!readWorkspaceLibrary((await db.projects.get(projectId))!).placements.find(row => row.entityId === document.entityId)?.pinned, 'Concurrent pin undone');
    results.push('Independent concurrent bookmark CAS: exactly one write and one undo receipt');
    await saveWorldEra(projectId, { id: 'bookmark-era', name: 'Earlier', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const baseBefore = readWorkspaceLibrary((await db.projects.get(projectId))!);
    await pinWorkspaceDocument(projectId, baseBefore.revision, document, true, 'bookmark-era');
    const era = await getEraProject({ projectId, eraId: 'bookmark-era' });
    assert(readWorkspaceLibrary(era).placements.find(row => row.entityId === document.entityId)?.pinned, 'Era bookmark saved');
    assert(JSON.stringify(readWorkspaceLibrary((await db.projects.get(projectId))!)) === JSON.stringify(baseBefore), 'Era bookmark changed Base');
    assert(await undoEntry(lastUndoable(projectId)!.id) === 'undone', 'Era bookmark undo failed');
    const undone = readWorkspaceLibrary(await getEraProject({ projectId, eraId: 'bookmark-era' }));
    assert(!undone.placements.find(row => row.entityId === document.entityId)?.pinned && undone.revision === baseBefore.revision + 2, 'Era undo retains monotonic revision and original pin state');
    assert(JSON.stringify(readWorkspaceLibrary((await db.projects.get(projectId))!)) === JSON.stringify(baseBefore), 'Era undo changed Base');
    results.push('Independent era bookmark and undo isolate Base and advance era library revision monotonically');
    const previousMotion = useAppStore.getState().motion;
    try {
      await act(async () => { useAppStore.setState({ motion: 'system' }); root.render(<WorkspaceDecoration values={{ effect: 'rain', effectIntensity: 100 }} />); await pause(); });
      assert(host.querySelectorAll('.workspace-particles i').length === 40, 'Effect mounts expected density');
      await act(async () => { useAppStore.setState({ motion: 'reduce' }); await pause(); });
      assert(host.querySelectorAll('.workspace-particles i').length === 0, 'Application reduced-motion preference must unmount particles');
    } finally { await act(async () => { useAppStore.setState({ motion: previousMotion }); }); }
    results.push('Independent application reduced-motion preference unmounts decorative particles');
    await act(async () => { root.render(<WorkspaceLibrary projectId={projectId} enabledEngineIds={['writings','codex','notes']} onOpen={async () => true} onManage={async () => true} />); await pause(); });
    for (let i = 0; i < 80 && !host.querySelector('[data-library-document]'); i++) await act(pause);
    const row = [...host.querySelectorAll<HTMLElement>('[data-library-document]')].find(node => node.dataset.libraryDocument === workspaceDocumentKey(document)); assert(row, 'Expected row');
    await act(async () => { row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await pause(); });
    const menu = window.document.querySelector<HTMLElement>('[role="menu"]'); assert(menu && !host.contains(menu), 'Menu must portal outside clipped parent');
    assert(window.document.activeElement === menu.querySelector('button'), 'Keyboard opening focuses menu item');
    await act(async () => { window.document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(); });
    assert(!window.document.querySelector('[role="menu"]') && window.document.activeElement === row, 'Escape closes menu and restores the row focus');
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 1, clientY: innerHeight - 1 })); await pause(); });
    const edge = window.document.querySelector<HTMLElement>('[role="menu"]')!;
    assert(Number.parseFloat(edge.style.left) <= innerWidth - 190 && Number.parseFloat(edge.style.top) <= innerHeight - 60, 'Menu clamped at viewport edge');
    await act(async () => { host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await pause(); });
    assert(!window.document.querySelector('[role="menu"]'), 'Outside pointer closes menu');
    results.push('Independent keyboard/context menu: portal, item focus, Escape restoration, outside close and viewport clamp');
  } finally {
    await act(async () => root.unmount()); host.remove(); clearUndoJournal();
    for (const table of [db.writings, db.notes, db.codexEntries, db.worldEraVariants]) await table.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
  return results;
}
