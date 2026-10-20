import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { DialogBlock, Scene } from '@/engines/dialog-scene/types';
import { buildConversation, filterConversation } from '@/engines/dialog-scene/conversation/model';
import ConversationPreview from '@/engines/dialog-scene/conversation/ConversationPreview';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { flushPendingWrites, retryFailedWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import { updateScene } from '@/engines/dialog-scene/operations';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
export async function testConversationPreview(): Promise<string[]> {
  const P = `conversation-${Date.now()}`, S = `${P}-scene`, root = createRoot(document.getElementById('root')!), passed: string[] = [];
  const scene: Scene = { id: S, projectId: P, title: 'The last chart', order: 0, sceneNumber: 1, tags: [], setting: 'Harbour · Dawn', createdAt: 1, updatedAt: 1 };
  const block = (id: string, order: number, type: DialogBlock['type'], content: string, characterName = '', extra: Partial<DialogBlock> = {}): DialogBlock => ({ id: `${P}-${id}`, sceneId: S, projectId: P, type, content, characterName, characterColor: characterName === 'Nora' ? '#4a9e6d' : '#d5b575', order, createdAt: 1, updatedAt: 1, ...extra });
  const blocks = [block('action', 0, 'action', 'The harbour was silent.'), block('nora', 1, 'dialog', 'The border has moved.', 'Nora', { characterId: 'nora', parenthetical: 'quietly' }), block('eneas', 2, 'dialog', 'That is impossible.', 'Eneas', { dualGroupId: 'parallel' }), block('together', 3, 'dialog', 'Look at the chart.', 'Nora', { characterId: 'nora', dualGroupId: 'parallel' }), block('note', 4, 'note', '<img src=x onerror="window.__badConversation=1">'), block('transition', 5, 'transition', 'FADE OUT.'), block('blank', 6, 'dialog', '', 'Nora'), block('foreign', 7, 'dialog', 'Other project secret', 'Spy', { projectId: `${P}-other` })];
  let opened = '', failedWrite: (() => never) | undefined;
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = document.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (id: string) => act(async () => { node<HTMLButtonElement>(id).click(); await pause(80); });
  const change = async (control: HTMLSelectElement | HTMLTextAreaElement, value: string) => act(async () => { const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  const waitFor = async (test: () => boolean | Promise<boolean>, message: string) => { for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const renderPreview = async (visible = true) => act(async () => { root.render(<EnginePaneContext.Provider value={{ instanceId: 'test-conversation-pane', visible }}><ConversationPreview scene={scene} blocks={blocks} cast={[]} onSource={id => { opened = id; }} /></EnginePaneContext.Provider>); await pause(); });
  try {
    useLocaleStore.setState({ locale: 'en' });
    const before = JSON.stringify(blocks), model = buildConversation(P, S, [...blocks].reverse(), []);
    assert(model.turns.length === 5 && model.turns[2].simultaneous && model.turns[2].blocks.length === 2 && model.turns[0].blocks[0].type === 'action', 'Authored order is restored; explicit simultaneous dialogue reveals together');
    assert(model.speakers.length === 2 && model.speakers[0].name === 'Nora' && model.speakers[0].count === 2, 'Cast comes from authored nonempty dialogue and excludes foreign rows');
    const filtered = filterConversation(model.turns, { dialogue: true, narration: false, notes: false, speakers: new Set(['name:eneas']) });
    assert(filtered.length === 1 && filtered[0].simultaneous && filtered[0].blocks[0].content === 'That is impossible.', 'Character filter keeps original simultaneous provenance without inventing new turns');
    assert(JSON.stringify(blocks) === before, 'Projection and filters never mutate authored blocks');
    passed.push('Conversation model: project/scene isolation, stable authored order, nonempty cast, explicit simultaneous groups and read-only filters');

    await renderPreview();
    assert(node('conversation-count').textContent?.includes('0/4') && !document.querySelector('[data-testid^="conversation-block-"]'), 'Playback begins before the first saved turn, with author notes hidden');
    await click('conversation-next'); assert(node(`conversation-block-${P}-action`).dataset.alignment === 'center', 'Action is shown as narration');
    await click('conversation-next'); assert(node(`conversation-block-${P}-nora`).dataset.alignment === 'right' && node(`conversation-block-${P}-nora`).textContent?.includes('(quietly)'), 'Dialogue uses the chosen speaker side and preserves parentheticals');
    await click('conversation-next'); assert(document.querySelectorAll('[data-testid^="conversation-block-"]').length === 4 && node(`conversation-turn-${P}-eneas`).textContent?.includes('Simultaneous'), 'An authored dual pair appears in one step');
    await click('conversation-previous'); assert(!document.querySelector(`[data-testid="conversation-block-${P}-eneas"]`), 'Back removes the complete simultaneous step');
    await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    assert(node('conversation-count').textContent?.includes('4/4') && node('conversation-log').textContent?.includes('End of scene'), 'End reveals all selected source blocks');
    await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
    await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    assert(node('conversation-count').textContent?.includes('1/4'), 'Right arrow advances an authored step');
    await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    assert(node('conversation-count').textContent?.includes('0/4'), 'Left arrow retreats an authored step');
    await click('conversation-filter-notes');
    await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    assert(node(`conversation-block-${P}-note`).textContent?.includes('<img') && !node('conversation-log').querySelector('img'), 'Untrusted note markup remains literal text, with no HTML execution');
    await click(`conversation-source-${P}-note`); assert(opened === `${P}-note`, 'Source action names the exact authored block');
    await click('conversation-filter-dialogue'); assert(node('conversation-count').textContent?.includes('0/3'), 'Changing dialogue/narration/note filters resets the preview without editing text');
    await click('conversation-filter-dialogue'); await click('conversation-speaker-id:nora');
    assert(node('conversation-count').textContent?.includes('0/4'), 'Cast inclusion filters actual matching lines and retains narration');
    await click('conversation-phone'); assert(node('conversation-device').className.includes('max-w-4xl'), 'Phone layout can expand to a full-width reading view');
    passed.push('Conversation UI: step/back/restart, keyboard start/end, speaker side and cast/type filters, simultaneous dialogue, safe literal text and direct source IDs');

    await change(node<HTMLSelectElement>('conversation-delay'), '800'); await act(async () => { node('conversation-log').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    await act(async () => { await pause(900); }); assert(node('conversation-count').textContent?.includes('1/4'), 'Timed playback reveals one authored step');
    await click('conversation-play'); const paused = node('conversation-count').textContent; await act(async () => { await pause(900); }); assert(node('conversation-count').textContent === paused, 'Pause cancels its pending reveal');
    await click('conversation-play'); await renderPreview(false); await act(async () => { await pause(900); });
    assert(node('conversation-count').textContent === paused && node('conversation-play').getAttribute('aria-pressed') === 'false', 'Hiding the containing workspace pane pauses playback and clears its timer');
    await renderPreview(true); await act(async () => { await pause(850); }); assert(node('conversation-count').textContent === paused, 'Returning to a pane does not silently restart playback');
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      await click('conversation-play');
      await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert(node('conversation-play').getAttribute('aria-pressed') === 'false', 'Hiding the browser window pauses timed playback');
    } finally { if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor); else Reflect.deleteProperty(document, 'hidden'); await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); }
    await act(async () => { node<HTMLSelectElement>('conversation-delay').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); }); assert(node('conversation-play').getAttribute('aria-pressed') === 'false', 'Keyboard playback never steals Space from form controls');
    const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout, timers = new Set<number>();
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => { const id = nativeSetTimeout(() => { timers.delete(id); if (typeof handler === 'function') handler(...args); }, timeout); if (timeout === 800) timers.add(id); return id; }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); nativeClearTimeout(id); }) as typeof window.clearTimeout;
    try { await click('conversation-play'); assert(timers.size === 1, 'Exactly one playback timer is owned'); await act(async () => { root.render(null); }); assert(timers.size === 0, 'Unmount cleans up the playback timer'); }
    finally { window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout; }
    passed.push('Conversation playback: timed progression, pause, hidden-pane cancellation, explicit resume, non-interfering keyboard controls and unmount timer cleanup');

    await db.projects.put({ id: P, title: 'Conversation test', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['dialog-scene'], engineOrder: ['dialog-scene'], createdAt: 1, updatedAt: 1 });
    await db.scenes.put(scene); await db.dialogBlocks.bulkPut(blocks);
    await act(async () => { root.render(<MemoryRouter><SceneEditor scene={scene} scenes={[scene]} onUpdateScene={changes => updateScene(S, changes)} onBack={() => undefined} /></MemoryRouter>); await pause(180); });
    await waitFor(() => !!document.querySelector(`[data-dialog-block-id="${P}-nora"] textarea`), 'Actual scene dialogue did not load');
    const content = document.querySelector<HTMLTextAreaElement>(`[data-dialog-block-id="${P}-nora"] textarea`)!;
    await change(content, 'Fresh unsaved dialogue.');
    failedWrite = () => { throw new Error('Expected scene write failure'); }; db.dialogBlocks.hook('updating', failedWrite);
    await click('conversation-open');
    assert(!document.querySelector('[data-testid="conversation-preview"]') && content.value === 'Fresh unsaved dialogue.', 'Preview refuses to open after a failed buffered edit save and keeps the editor draft');
    db.dialogBlocks.hook('updating').unsubscribe(failedWrite); failedWrite = undefined;
    await act(async () => { await retryFailedWrites(); assert((await flushPendingWrites()).ok, 'Buffered scene retry failed'); await pause(); });
    await click('conversation-open'); await waitFor(() => !!document.querySelector('[data-testid="conversation-preview"]'), 'Actual scene preview failed to mount');
    const savedBeforePreview = JSON.stringify(await db.dialogBlocks.where('sceneId').equals(S).sortBy('order'));
    await click('conversation-next'); await click('conversation-next'); assert(node(`conversation-block-${P}-nora`).textContent?.includes('Fresh unsaved dialogue.'), 'Preview reads newly flushed scene data rather than stale props');
    assert(!node('conversation-log').textContent?.includes('Other project secret'), 'Foreign rows sharing a malformed scene pointer cannot enter the preview');
    await click(`conversation-source-${P}-nora`); await waitFor(() => !document.querySelector('[data-testid="conversation-preview"]'), 'Source action failed to close preview');
    assert(JSON.stringify(await db.dialogBlocks.where('sceneId').equals(S).sortBy('order')) === savedBeforePreview, 'Preview playback/filter/navigation never rewrites source blocks');
    passed.push('Scene integration: flush-before-open with failed-save preservation/retry, fresh source capture, foreign-row guard and unchanged source data on playback/navigation');
    return passed;
  } finally {
    if (failedWrite) db.dialogBlocks.hook('updating').unsubscribe(failedWrite);
    await act(async () => { root.unmount(); }); await db.dialogBlocks.where('sceneId').equals(S).delete(); await db.scenes.delete(S); await db.projects.delete(P);
  }
}
