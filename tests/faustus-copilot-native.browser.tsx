import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import App from '@/App';
import '@/services/aiBridge/dispatch';
import { useCopilotStore } from '@/stores/copilotStore';
import { useLocaleStore } from '@/stores/localeStore';
import { writerContext } from '@/services/copilot/faustusContext';

async function mount() {
  const now = Date.now();
  if (!await db.projects.get('writer-qa340')) {
    await db.projects.put({ id: 'writer-qa340', title: 'Writer copilot QA', description: 'An isolated manuscript for shared copilot integration.', mode: 'novelist', type: 'standalone', color: '#aa7733', status: 'draft', enabledEngines: ['writings', 'codex', 'outline'], engineOrder: ['writings', 'codex', 'outline'], createdAt: now, updatedAt: now });
    await db.writings.put({ id: 'chapter-qa340', projectId: 'writer-qa340', title: 'The harbour', content: '<p>La puerta estaba abierta. Ana esperaba en el puerto.</p>', wordCount: 10, status: 'draft', tags: [], order: 0, createdAt: now, updatedAt: now });
    await db.aiThreads.put({ id: 'legacy-qa340', projectId: 'writer-qa340', title: 'Previous harbour conversation', archived: false, policy: 'allow', createdAt: now, updatedAt: now });
    await db.aiMessages.put({ id: 'legacy-message340', threadId: 'legacy-qa340', projectId: 'writer-qa340', role: 'user', content: 'We are writing a story in the harbour.', status: 'complete', createdAt: now });
  }
  await db.writings.update('chapter-qa340', { tags: [] });
  await useLocaleStore.getState().setLocale('es');
  useCopilotStore.setState({ dockOpen: true });
  window.location.hash = '#/project/writer-qa340/writings?writing=chapter-qa340';
  createRoot(document.getElementById('root')!).render(<App />);
  const qa = {
    async snapshot() {
      const panel = document.querySelector('faustus-chat') as HTMLElement & { sessionId: string | null; busy: boolean; draft: string } | null;
      const info = await window.electronAPI!.faustus.getInfo();
      return { embedLoaded: Boolean(panel), sessionId: panel?.sessionId, busy: panel?.busy, draft: panel?.draft, shadowText: panel?.shadowRoot?.textContent?.slice(-18000), visibleText: document.body.innerText, writing: await db.writings.get('chapter-qa340'), context: await writerContext(info.data_space_id, 'writer-qa340', 'writings', 'es'), viewport: { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }, legacyRows: await db.aiMessages.where('threadId').equals('legacy-qa340').toArray() };
    },
    async send(text: string) { const panel = document.querySelector('faustus-chat') as HTMLElement & { send(text: string): Promise<void> }; if (!panel) throw new Error('Panel is unavailable.'); void panel.send(text); return { admitted: true }; },
    select(start: number, end: number) {
      const editor = document.querySelector('.ProseMirror') as HTMLElement;
      const text = editor?.querySelector('p')?.firstChild;
      if (!text) throw new Error('Native editor text is unavailable.');
      editor.focus();
      const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return selection.toString();
    },
    async undo(index: number) { return window.electronAPI!.aiBridge.undo(index); },
    undoButton(index: number) {
      const panel = document.querySelector('faustus-chat');
      const buttons = [...(panel?.shadowRoot?.querySelectorAll('button') ?? [])];
      const button = buttons.find((candidate) => {
        if (candidate.textContent !== 'Deshacer') return false;
        for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
          const text = parent.textContent || '';
          if ((text.match(/"audit_index"/g) || []).length === 1 && new RegExp(`"audit_index"\\s*:\\s*${index}(?:\\s|,)`).test(text)) return true;
        }
        return false;
      });
      if (!button) throw new Error(`Undo button for ${index} is unavailable.`);
      button.click(); return { clicked: true, index };
    },
    newConversation() {
      const select = document.querySelector('faustus-chat')?.shadowRoot?.querySelector('select');
      if (!select) throw new Error('Conversation selector is unavailable.');
      select.selectedIndex = 0; select.dispatchEvent(new Event('change')); return { selected: true };
    },
    selectConversation(sessionId: string) {
      const select = document.querySelector('faustus-chat')?.shadowRoot?.querySelector('select');
      if (!select || ![...select.options].some((option) => option.value === sessionId)) throw new Error('The canonical conversation is not listed.');
      select.value = sessionId; select.dispatchEvent(new Event('change')); return { selected: sessionId };
    },
    closeDock() { useCopilotStore.getState().setDockOpen(false); },
    openDock() { useCopilotStore.getState().setDockOpen(true); },
  };
  Object.assign(window, { __writerQa: qa });
}
void mount().catch((error) => { Object.assign(window, { __writerQaError: String(error.stack || error) }); });
