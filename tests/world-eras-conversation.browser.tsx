import Dexie from 'dexie';
import { onDataChanged } from '@/engines/_shared/dataChanged';
import { readWorldDocument } from '@/services/worldEras/store';
import { clearProjectDraftStores, createLocalDraftStore } from '@/hooks/localDraftStore';
import { flushPendingWrites } from '@/services/pendingWrites';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import '@/engines/dialog-scene';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import type { Scene, DialogBlock } from '@/engines/dialog-scene/types';
import { dialogSceneOperations } from '@/engines/dialog-scene/scopedOperations';
import { appendConversationTurn, conversationDraftStore } from '@/engines/dialog-scene/conversation/authoring';
import { importScript } from '@/engines/dialog-scene/importPersist';
import { buildFountain } from '@/engines/dialog-scene/fountainExport';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { saveWorldEra, saveEraDocument, getEraProject, listEraRows } from '@/services/worldEras/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { createSheet } from '@/engines/character-sheets/types';
import { saveSheet } from '@/engines/character-sheets/operations';
import { useLocaleStore } from '@/stores/localeStore';
import type { EraRow } from '@/services/worldEras/types';
const P = 'synthetic-era-conversation', S = 'shared-conversation', scope = { projectId: P, eraId: 'past' };
const scene: Scene = { id: S, projectId: P, title: 'Shared harbour', order: 0, sceneNumber: 1, tags: [], createdAt: 1, updatedAt: 1 };
const entry: CodexEntry = { id: 'era-only-speaker', projectId: P, title: 'Ágata in the past', type: 'character', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
const baseBlock: DialogBlock = { id: 'base-turn', projectId: P, sceneId: S, type: 'action', content: 'Shared sea fog', characterName: '', characterColor: '', order: 0, createdAt: 1, updatedAt: 1 };
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
async function setup() { useLocaleStore.setState({ locale: 'en' }); await db.projects.put({ id: P, title: 'Era conversation', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex', 'dialog-scene', 'character-sheets'], createdAt: 1, updatedAt: 1 } satisfies Project); await db.scenes.put(scene); await db.dialogBlocks.put(baseBlock); await saveWorldEra(P, { id: scope.eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null); await saveEraDocument(scope, 'codex', { root: entry as unknown as EraRow, children: {} }, null); }
async function cleanup(owner = P) { const scenes = await db.scenes.where('projectId').equals(owner).primaryKeys(); if (scenes.length) await db.sceneCasts.where('sceneId').anyOf(scenes).delete(); for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(owner).delete(); await db.projects.delete(owner); localStorage.clear(); }
export async function testWorldEraConversation(): Promise<string[]> {
  let clone: string | undefined;
  try {
    await setup(); const operations = dialogSceneOperations(scope);
    await saveSheet(P, { ...createSheet('custom', 'Speaker sheet'), id: 'own-speaker-sheet', linkedEntryId: entry.id }, null, scope.eraId);
    await operations.addCastMember({ id: 'own-cast', sceneId: S, characterId: entry.id, characterName: entry.title, color: '#335577' });
    const [a, b] = await Promise.all([appendConversationTurn(S, { speaker: 'cast:own-cast', content: 'Ancient accented turn: todavía.' }, scope), appendConversationTurn(S, { speaker: '', content: 'Ancient action' }, scope)]);
    assert(a.order !== b.order && a.characterId === entry.id && (await operations.getDialogBlocks(S)).length === 3 && (await db.dialogBlocks.where('sceneId').equals(S).count()) === 1 && !(await db.sceneCasts.where('sceneId').equals(S).count()), 'Turn/cast escaped era or lost atomic order');
    assert((await getEraProject(scope)).characterSheets?.[0].linkedEntryId === entry.id && !(await db.projects.get(P))?.characterSheets?.length, 'Speaker sheet escaped context');
    const native = await runBridgeTool('wh_append_conversation_turn', { ...scope, sceneId: S, speaker: 'cast:own-cast', content: 'Native own turn' }); assert(native.ok, JSON.stringify(native));
    const turn = native.result as DialogBlock;
    await undoAuditEntry({ entry: { tool: 'wh_append_conversation_turn', kind: 'create', table: 'dialogBlocks', projectId: P, eraId: scope.eraId, entityId: turn.id } });
    assert(!(await operations.getDialogBlocks(S)).some(row => row.id === turn.id) && (await db.dialogBlocks.where('sceneId').equals(S).count()) === 1, 'Undo escaped scene aggregate or deleted Base');
    await importScript(P, { scenes: [{ title: 'Imported ancient scene', blocks: [{ type: 'dialog', characterName: entry.title, content: 'Imported era prose' }] }] }, scope.eraId);
    const rows = await operations.getScenes(P), blocks = await listEraRows<DialogBlock>(scope, 'dialogBlocks');
    assert(rows.length === 2 && (await db.scenes.where('projectId').equals(P).count()) === 1 && buildFountain({ projectTitle: 'Past', scenes: rows, blocks }).includes('Imported era prose'), 'Contextual script import/export escaped era');
    const nativeScene = await runBridgeTool('wh_create_scene', { ...scope, title: 'Native only ancient' }); assert(nativeScene.ok, JSON.stringify(nativeScene));
    clone = await importProjectData(await exportProjectData(P)); const cloned = (await db.projects.get(clone))!, clonedScope = { projectId: clone, eraId: cloned.worldEras![0].id };
    const clonedScenes = await dialogSceneOperations(clonedScope).getScenes(clone), clonedScene = clonedScenes.find(row => row.title === scene.title)!;
    const clonedCast = await dialogSceneOperations(clonedScope).getSceneCast(clonedScene.id), clonedCharacters = await listEraRows<CodexEntry>(clonedScope, 'codexEntries');
    assert(clonedCast[0].sceneId === clonedScene.id && clonedCast[0].characterId === clonedCharacters[0].id && clonedCast[0].characterId !== entry.id && clonedScenes.some(row => row.title === 'Native only ancient'), 'Clone broke cast/card identity or omitted era-only scenes');
    const archive = await createProjectZipArchive(P); await importProjectZip(new File([archive.blob], 'era-conversations.zip', { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert((await dialogSceneOperations(scope).getSceneCast(S))[0].characterId === entry.id && (await dialogSceneOperations(scope).getDialogBlocks(S)).some(row => row.content === 'Ancient accented turn: todavía.') && (await db.dialogBlocks.where('sceneId').equals(S).count()) === 1, 'Full project ZIP lost own cast/prose or changed Base');
    return ['Conversation scope preserves inherited scene, own cast/card/sheet and atomic turn ordering; Undo only removes own turn', 'Normal scene/script import, Fountain export, registered authoring and JSON clone retain era-only conversation and stable speaker identities'];
  } finally { await cleanup(); if (clone) await cleanup(clone); }
}
export async function testWorldEraConversationUi(): Promise<string[]> {
  await setup(); const root = createRoot(document.getElementById('root')!);
  const wait = async (test: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(); }); } throw Error('Contextual conversation UI did not settle'); };
  const input = async (field: HTMLTextAreaElement | HTMLSelectElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  const render = async () => act(async () => { root.render(<MemoryRouter><main className="grid grid-cols-1 xl:grid-cols-2">{[scope, { projectId: P, eraId: undefined }].map(current => <EnginePaneContext.Provider key={current.eraId ?? 'base'} value={{ instanceId: current.eraId ?? 'base', projectId: P, eraId: current.eraId, visible: true }}><section data-conversation-pane={current.eraId ?? 'base'}><SceneEditor scene={scene} scenes={[scene]} onBack={() => {}} onUpdateScene={changes => dialogSceneOperations(current).updateScene(S, changes)} /></section></EnginePaneContext.Provider>)}</main></MemoryRouter>); await pause(); });
  try {
    await render();
    const own = document.querySelector<HTMLElement>('[data-conversation-pane="past"]')!, base = document.querySelector<HTMLElement>('[data-conversation-pane="base"]')!;
    await wait(() => !!own.querySelector(`[data-testid="conversation-composer"] option[value="entry:${entry.id}"]`));
    assert(!base.querySelector(`[data-testid="conversation-composer"] option[value="entry:${entry.id}"]`), 'Base composer sees era-only character');
    await act(async () => { [...own.querySelectorAll<HTMLButtonElement>('button')].find(row => /add character/i.test(row.title))!.click(); await pause(); });
    const castSelect = [...own.querySelectorAll<HTMLSelectElement>('select')].find(field => !!field.querySelector(`option[value="${entry.id}"]`))!;
    await input(castSelect, entry.id);
    await act(async () => { [...own.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === 'Add')!.click(); await pause(); });
    await wait(async () => (await dialogSceneOperations(scope).getSceneCast(S)).length === 1);
    const ownCast = (await dialogSceneOperations(scope).getSceneCast(S))[0];
    assert(ownCast.characterId === entry.id && (await db.sceneCasts.where('sceneId').equals(S).count()) === 0, 'Normal cast bar wrote shared Base or lost era card');
    const composer = own.querySelector<HTMLElement>('[data-testid="conversation-composer"]')!, select = composer.querySelector('select')!, text = composer.querySelector('textarea')!;
    await wait(() => !!select.querySelector(`option[value="cast:${ownCast.id}"]`));
    await input(select, `cast:${ownCast.id}`); await input(text, 'Ancient UI turn: mañana.');
    await act(async () => { [...composer.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.includes('Add turn'))!.click(); await pause(); });
    await wait(() => own.textContent?.includes('Ancient UI turn: mañana.') ?? false);
    assert(!base.textContent?.includes('Ancient UI turn: mañana.') && (await db.dialogBlocks.where('sceneId').equals(S).count()) === 1, 'Two normal scene editors share authored era turn');
    await input(text, 'Unsaved ancient draft');
    await act(async () => { root.render(null); await pause(); }); await render();
    await wait(() => document.querySelector<HTMLTextAreaElement>('[data-conversation-pane="past"] [data-testid="conversation-composer"] textarea')?.value === 'Unsaved ancient draft');
    assert(!document.querySelector<HTMLTextAreaElement>('[data-conversation-pane="base"] [data-testid="conversation-composer"] textarea')?.value, 'Recovery escaped era');
    const ownAgain = document.querySelector<HTMLElement>('[data-conversation-pane="past"]')!;
    await wait(() => !ownAgain.querySelector<HTMLButtonElement>('[data-testid="conversation-open"]')!.disabled);
    await act(async () => { ownAgain.querySelector<HTMLButtonElement>('[data-testid="conversation-open"]')!.click(); await pause(250); });
    await wait(() => !!document.querySelector('[data-testid="conversation-preview"]'));
    await act(async () => { document.querySelector<HTMLElement>('[data-testid="conversation-log"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await pause(); });
    assert(document.querySelector('[data-testid="conversation-log"]')?.textContent?.includes('Ancient UI turn: mañana.'), 'Preview loaded Base instead of era turn');
    if ((window as unknown as { __sizeAck?: number }).__sizeAck !== undefined) {
      for (const width of [1440, 640]) {
        (window as unknown as { __want: unknown }).__want = { w: width, h: 1000, n: width + 2000 };
        for (let i = 0; i < 100 && (window as unknown as { __sizeAck: number }).__sizeAck !== width + 2000; i++) await pause(30);
        assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Contextual Conversation overflows viewport');
        (window as unknown as { __shot: unknown }).__shot = { name: `world-eras-conversation-${width}` };
        for (let i = 0; i < 100 && (window as unknown as { __shotDone: string }).__shotDone !== `world-eras-conversation-${width}`; i++) await pause(30);
      }
    }
    assert(conversationDraftStore(P, scope.eraId).get(`${S}:past`)?.content === 'Unsaved ancient draft' && !conversationDraftStore(P).get(`${S}:past`), 'Journal namespace lost');
    return ['Two normal SceneEditor panes compose with an era-only character, preserve local recovery and open the effective conversation preview while Base stays unchanged'];
  } finally { await act(async () => root.unmount()); await cleanup(); }
}

export async function testWorldEraDraftCleanup(): Promise<string[]> {
  const P = 'cleanup-era-project', other = `${P}-other`, accept = (value: unknown): value is { text: string } => !!value && typeof value === 'object' && 'text' in value;
  const base = createLocalDraftStore(`wh.codex-drafts.v1.${P}`, accept), own = createLocalDraftStore(`wh.conversation-drafts.v1.${P}.era:ancient`, accept), board = createLocalDraftStore(`wh.board-era-drafts.v1.${P}.era:ancient`, accept), sibling = createLocalDraftStore(`wh.conversation-drafts.v1.${other}.era:ancient`, accept);
  const cold = `wh.world-sheets-drafts.v1.${P}.era:unopened`, coldOther = `wh.world-sheets-drafts.v1.${other}.era:unopened`;
  try {
    for (const store of [base, own, board, sibling]) store.set('draft', { text: 'Retained writing' }); await flushPendingWrites();
    localStorage.setItem(cold, JSON.stringify([['draft', { text: 'Cold storage' }]])); localStorage.setItem(coldOther, JSON.stringify([['draft', { text: 'Other project cold storage' }]]));
    clearProjectDraftStores(P); await flushPendingWrites();
    assert(base.size === 0 && own.size === 0 && board.size === 0 && !localStorage.getItem(cold), 'Deletion retained own Base/era/cold journals');
    assert(sibling.size === 1 && localStorage.getItem(coldOther) && localStorage.getItem(`wh.conversation-drafts.v1.${other}.era:ancient`), 'Similar project prefix was cleared');
    own.set('new', { text: 'Reopened owner' }); await flushPendingWrites(); assert(createLocalDraftStore(`wh.conversation-drafts.v1.${P}.era:ancient`, accept) === own, 'Cleanup detached live owner and stale retries');
    return ['Project draft cleanup clears Base, era, Board and unopened persisted journals while preserving a similarly named project and live owner identity'];
  } finally { clearProjectDraftStores(P); clearProjectDraftStores(other); await flushPendingWrites(); }
}

export async function testWorldEraNotificationLifecycle(): Promise<string[]> {
  await setup(); let calls = 0, leakedTransaction = false;
  const stop = onDataChanged(change => { if (change.projectId === P) { calls++; leakedTransaction ||= !!Dexie.currentTransaction; } });
  try {
    await db.transaction('rw', db.tables, async () => {
      let current = (await readWorldDocument(scope, 'codex', entry.id))!;
      current = await saveEraDocument(scope, 'codex', { ...current.document, root: { ...current.document.root, title: 'Intermediate' } }, current.version);
      assert(calls === 0, 'Nested save announced uncommitted state');
      await saveEraDocument(scope, 'codex', { ...current.document, root: { ...current.document.root, title: 'Committed last' } }, current.version);
      assert(calls === 0, 'Nested aggregate announced before outer commit');
    });
    assert(calls === 1 && !leakedTransaction, 'Committed transaction must announce once outside Dexie context');
    try { await db.transaction('rw', db.tables, async () => { const current = (await readWorldDocument(scope, 'codex', entry.id))!; await saveEraDocument(scope, 'codex', { ...current.document, root: { ...current.document.root, title: 'Rolled back' } }, current.version); throw Error('Synthetic rollback'); }); } catch { /* Expected domain rollback. */ }
    assert(calls === 1 && (await readWorldDocument(scope, 'codex', entry.id))!.document.root.title === 'Committed last', 'Rollback announced or persisted a rejected candidate');
    return ['Nested era saves notify once only after outer commit, outside its Dexie transaction; rollback preserves winner and emits no stale refetch'];
  } finally { stop(); await cleanup(); }
}
