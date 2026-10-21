import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import type { Scene, SceneCast } from '@/engines/dialog-scene/types';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import { appendConversationTurn, conversationDraftStore } from '@/engines/dialog-scene/conversation/authoring';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
export async function testConversationAuthoring() {
  const P = `conversation-authoring-${Date.now()}`, S = `${P}-scene`, Q = `${P}-foreign`;
  const project: Project = { id: P, title: 'Dialogue QA', mode: 'custom', type: 'standalone', description: '', color: '#d5b575', status: 'draft', enabledEngines: ['dialog-scene'], engineOrder: ['dialog-scene'], createdAt: 1, updatedAt: 1 };
  const scene: Scene = { id: S, projectId: P, title: 'The harbor', order: 0, tags: [], createdAt: 1, updatedAt: 1 };
  const character: CodexEntry = { id: `${P}-character`, projectId: P, title: 'Ágata', type: 'character', content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const cast: SceneCast = { id: `${P}-cast`, sceneId: S, characterId: character.id, characterName: character.title, color: '#d5b575' };
  const root = createRoot(document.getElementById('root')!);
  const wait = async (test: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(); }); } throw Error('Conversation UI did not settle'); };
  const render = async () => { await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'authoring-pane', visible: true }}><SceneEditor scene={scene} scenes={[scene]} onBack={() => undefined} onUpdateScene={async () => undefined} /></EnginePaneContext.Provider></MemoryRouter>); await pause(); }); };
  const composer = () => document.querySelector<HTMLElement>('[data-testid="conversation-composer"]')!;
  const change = async (node: HTMLSelectElement | HTMLTextAreaElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.scenes.put(scene); await db.codexEntries.bulkPut([character, { ...character, id: Q, projectId: Q, title: 'Foreign' }]); await db.sceneCasts.put(cast);
    await render(); await wait(() => !!composer()?.querySelector(`option[value="cast:${cast.id}"]`));
    const select = composer().querySelector('select')!, text = composer().querySelector('textarea')!;
    await change(select, `cast:${cast.id}`); await act(async () => { select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }); assert(document.activeElement === text, 'Enter on speaker must focus turn text');
    await change(text, 'El faro todavía está encendido.');
    await act(async () => { text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })); await pause(); }); assert(await db.dialogBlocks.where('sceneId').equals(S).count() === 0, 'Shift+Enter must not submit');
    await act(async () => { text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); await pause(); }); assert(await db.dialogBlocks.where('sceneId').equals(S).count() === 0, 'IME composition must not submit');
    await act(async () => { text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await pause(); });
    await wait(async () => await db.dialogBlocks.where('sceneId').equals(S).count() === 1); await wait(() => !!document.querySelector('[data-dialog-block-id] textarea'));
    const first = (await db.dialogBlocks.where('sceneId').equals(S).toArray())[0]; assert(first.characterId === character.id && first.characterName === 'Ágata' && first.content === 'El faro todavía está encendido.', 'Speaker stable identity and accented prose must survive the UI operation');
    await wait(() => document.activeElement === select); assert(text.value === '', 'Successful turn must clear the composer and return to speaker');
    await change(text, 'Unsubmitted recovery line'); await act(async () => { root.render(null); await pause(); }); await render(); await wait(() => composer()?.querySelector('textarea')?.value === 'Unsubmitted recovery line');
    assert(conversationDraftStore(P).get(`${S}:authoring-pane`)?.content === 'Unsubmitted recovery line', 'Recovery draft must remain pane scoped');
    await act(async () => { const reply = await runBridgeTool('wh_append_conversation_turn', { sceneId: S, content: 'La niebla se levanta.' }); assert(reply.ok, `Native conversation tool failed: ${reply.error}`); await pause(); });
    await act(async () => { const [a, b] = await Promise.all([appendConversationTurn(S, { speaker: `entry:${character.id}`, content: 'Second' }), appendConversationTurn(S, { speaker: '', content: 'Third' })]); assert(a.order !== b.order, 'Concurrent appends must read current order atomically'); await pause(); });
    let rejected = false; try { await appendConversationTurn(S, { speaker: `entry:${Q}`, content: 'Foreign' }); } catch { rejected = true; } assert(rejected && await db.dialogBlocks.where('sceneId').equals(S).count() === 4, 'Foreign speaker cannot append a turn');
    assert((await db.dialogBlocks.where('sceneId').equals(S).toArray()).some(block => block.type === 'action' && block.content === 'La niebla se levanta.'), 'Native action turn must be the same ordinary authored document');
    return ['Keyboard-first conversation authoring inside actual scene editor: stable speakers, Enter/Shift+Enter/IME, duplicate suppression, mounted refresh, focus, pane recovery, atomic concurrent ordering and native MCP dispatch'];
  } finally { await act(async () => root.unmount()); conversationDraftStore(P).clear(); await db.dialogBlocks.where('sceneId').equals(S).delete(); await db.sceneCasts.where('sceneId').equals(S).delete(); await db.scenes.delete(S); await db.codexEntries.bulkDelete([character.id, Q]); await db.projects.delete(P); }
}
