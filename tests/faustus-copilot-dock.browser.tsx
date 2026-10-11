import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CopilotDock from '@/components/copilot/CopilotDock';
import { db } from '@/db';
import { useCopilotStore } from '@/stores/copilotStore';
import { useCopilotHandoffStore } from '@/stores/copilotHandoffStore';
import type { FaustusFetchEvent, FaustusHostBridge } from '@/services/copilot/faustusProtocol';
import { getSetting } from '@/db/operations';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

export async function testFaustusCopilotDock(): Promise<string[]> {
  const now = Date.now();
  await db.projects.put({ id: 'dock-project', title: 'Novel', description: '', mode: 'novelist', type: 'standalone', color: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  await db.aiThreads.put({ id: 'old-thread', projectId: 'dock-project', title: 'Previous conversation', archived: false, policy: 'allow', createdAt: now, updatedAt: now });
  await db.aiMessages.put({ id: 'old-msg', threadId: 'old-thread', projectId: 'dock-project', role: 'user', content: 'Previously asked', status: 'complete', createdAt: now });
  const requests: Array<{ url: string; body?: unknown }> = [];
  const listeners = new Set<(event: FaustusFetchEvent) => void>();
  const bridge: FaustusHostBridge = {
    getInfo: async () => ({ server: 'http://127.0.0.1:7000', embed_url: '/unused-in-test', data_space_id: 'dock-space' }),
    request: async (request) => {
      requests.push({ url: request.url, body: request.body ? JSON.parse(new TextDecoder().decode(request.body)) : undefined });
      const payload = request.url.endsWith('/imports') ? { session_id: 'shared-session', imported: 1 } : { conversations: [{ session_id: 'shared-session' }, { session_id: 'second-shared-session' }] };
      for (const listener of listeners) listener({ id: request.id, type: 'chunk', chunk: new TextEncoder().encode(JSON.stringify(payload)) });
      for (const listener of listeners) listener({ id: request.id, type: 'end' });
      return { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] };
    },
    cancel: async () => {},
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { faustus: bridge } });
  class PanelFixture extends HTMLElement {
    session: string | null = null;
    get sessionId() { return this.session; }
    draft = '';
    historyLoads = 0;
    appendDraft(text: string) { this.draft += text; }
    async loadHistory() { this.historyLoads += 1; }
  }
  if (!customElements.get('faustus-chat')) customElements.define('faustus-chat', PanelFixture);
  useCopilotStore.setState({ dockOpen: true });
  const rootNode = document.createElement('div'); document.body.appendChild(rootNode);
  const root = createRoot(rootNode);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/project/dock-project/writings?writing=chapter']}><Routes><Route path="/project/:id/:tab" element={<CopilotDock />} /></Routes></MemoryRouter>); });
  for (let i = 0; i < 100 && !rootNode.querySelector('faustus-chat'); i++) await act(pause);
  const panel = rootNode.querySelector('faustus-chat') as PanelFixture;
  assert(panel?.session === 'shared-session' && panel.historyLoads === 1, 'Dock must continue the imported canonical conversation.');
  const imported = requests.find((row) => row.url.endsWith('/imports'))?.body as { source_thread_id: string; messages: Array<{ source_id: string; content: string }> };
  assert(imported.source_thread_id === 'old-thread' && imported.messages[0]?.source_id === 'old-msg', 'Import must preserve legacy identities.');
  assert((await db.aiMessages.get('old-msg'))?.content === 'Previously asked', 'Original history must remain unchanged.');
  await act(async () => { useCopilotHandoffStore.getState().request({ quote: 'A selected paragraph' }); });
  assert(panel.draft === '> A selected paragraph\n\n', 'Selection handoff must land in the shared composer.');
  assert(!requests.some((row) => row.url.includes('chat_stream')), 'Handoff cannot send a turn by itself.');
  await act(async () => { useCopilotStore.getState().setDockOpen(false); });
  assert(rootNode.querySelector('faustus-chat') === panel, 'Closing the dock must retain its shared session and draft.');
  await act(async () => {
    panel.session = 'second-shared-session';
    panel.dispatchEvent(new CustomEvent('faustus:session-change', { detail: { sessionId: 'second-shared-session' } }));
  });
  assert(await getSetting('faustus.active.dock-space.dock-project') === 'second-shared-session', 'Selecting a conversation must persist its SID without sending a turn.');
  await act(async () => { root.unmount(); });
  assert(!requests.some((row) => row.url.includes('/stop')), 'Leaving the editor cannot cancel remote work.');
  assert(listeners.size === 0, 'Completed host requests must release subscriptions.');
  const reopened = createRoot(rootNode);
  await act(async () => { reopened.render(<MemoryRouter initialEntries={['/project/dock-project/writings?writing=chapter']}><Routes><Route path="/project/:id/:tab" element={<CopilotDock />} /></Routes></MemoryRouter>); });
  for (let i = 0; i < 100 && !rootNode.querySelector('faustus-chat'); i++) await act(pause);
  const restoredPanel = rootNode.querySelector('faustus-chat') as PanelFixture;
  assert(restoredPanel?.session === 'second-shared-session', 'Reload must restore the selected conversation even when no turn was sent.');
  await act(async () => { reopened.unmount(); });
  rootNode.remove();
  await db.projects.delete('dock-project'); await db.aiThreads.delete('old-thread'); await db.aiMessages.delete('old-msg');
  return ['shared panel mount and canonical import', 'original conversations preserved', 'selection handoff draft without a send', 'close retains panel and unmount never sends stop', 'conversation selection persists across reload without a turn'];
}
