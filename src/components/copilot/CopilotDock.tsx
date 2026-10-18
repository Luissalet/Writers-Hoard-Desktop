/** Writer hosts the shared Faustus panel and contributes its native context. */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import FaustusMark from './FaustusMark';
import { fictionContext } from '@/engines/fiction/context';
import { api as fictionApi } from '@/engines/fiction/native/lib/api';
import { getView } from '@/engines/fiction/native/lib/copilot-context';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import { useCopilotStore, COPILOT_DOCK_MIN_WIDTH, COPILOT_DOCK_MAX_WIDTH } from '@/stores/copilotStore';
import { useCopilotHandoffStore } from '@/stores/copilotHandoffStore';
import { db } from '@/db';
import { getSetting, setSetting } from '@/db/operations';
import { createFaustusFetch } from '@/services/copilot/faustusTransport';
import { writerContext } from '@/services/copilot/faustusContext';
import { legacyConversationImport } from '@/services/copilot/faustusHistory';
import type { WriterHoardContext } from '@/services/copilot/faustusProtocol';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';

interface FaustusPanel extends HTMLElement {
  server: string;
  theme: 'dark' | 'light';
  locale: string;
  session: string | null;
  sessionId: string | null;
  fetch: typeof fetch;
  contextProvider: () => Promise<WriterHoardContext>;
  appendDraft(text: string): void;
  loadHistory(): Promise<void>;
  openReference?: (reference: { kind?: string; object_id?: string }) => void;
  onToolUndo?: (receipt: Record<string, unknown>) => Promise<void>;
}

let panelLoad: Promise<void> | null = null;
function loadPanel(url: string): Promise<void> {
  if (customElements.get('faustus-chat')) return Promise.resolve();
  return panelLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = url;
    script.onload = () => {
      if (customElements.get('faustus-chat')) resolve();
      else { panelLoad = null; script.remove(); reject(new Error('The Faustus panel version is incompatible.')); }
    };
    script.onerror = () => { panelLoad = null; script.remove(); reject(new Error('Faustus panel is unavailable.')); };
    document.head.appendChild(script);
  });
}

export default function CopilotDock() {
  const { id, tab } = useParams<{ id?: string; tab?: string }>();
  const { pathname } = useLocation();
  const [fictionOpen, setFictionOpen] = useState(false);
  const [worldId, setWorldId] = useState<string | null>(null);
  const setDockOpen = useCopilotStore(state => state.setDockOpen);
  useEffect(() => {
    const refresh = () => setWorldId(getView().worldId);
    window.addEventListener('hoard:copilot-context-changed', refresh);
    return () => window.removeEventListener('hoard:copilot-context-changed', refresh);
  }, []);
  if ((pathname === '/fiction' || tab === 'fiction') && window.electronAPI?.faustus) {
    if (!fictionOpen) return <button type="button" aria-label="Faustus" title="Faustus" onClick={() => { setDockOpen(true); setFictionOpen(true); }} className="fixed bottom-5 right-5 z-30 rounded-lg border border-border bg-surface p-3"><FaustusMark /></button>;
    return <WriterDock key={`fiction:${worldId}`} projectId={worldId || 'fiction-library'} engine="fiction" fiction onClose={() => setFictionOpen(false)} />;
  }
  if (!id || !window.electronAPI?.faustus) return null;
  return <WriterDock key={id} projectId={id} engine={tab && tab !== 'overview' ? tab : null} />;
}

function WriterDock({ projectId, engine, fiction = false, onClose }: { projectId: string; engine: string | null; fiction?: boolean; onClose?: () => void }) {
  const { t } = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
  const { dockOpen, setDockOpen, dockWidth, setDockWidth } = useCopilotStore();
  const pendingHandoff = useCopilotHandoffStore((state) => state.pending);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<FaustusPanel | null>(null);
  const current = useRef({ projectId, engine, locale });
  useEffect(() => { current.current = { projectId, engine, locale }; }, [projectId, engine, locale]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => { const update = () => setWindowWidth(window.innerWidth); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const bridge = window.electronAPI!.faustus;
    void (async () => {
      const info = await bridge.getInfo();
      if (fiction) info.data_space_id = (await fictionApi.identity()).data_space_id;
      await loadPanel(info.embed_url);
      const transport = createFaustusFetch(bridge);
      const contextProvider = async () => {
        const view = current.current;
        const context = fiction || view.engine === 'fiction'
          ? await fictionContext(info.data_space_id, view.locale)
          : await writerContext(info.data_space_id, view.projectId, view.engine, view.locale);
        if (info.tool_server_id) context.origin.tool_server_id = info.tool_server_id;
        return context;
      };
      const context = await contextProvider();
      // Imports are idempotent at Faustus. Originals stay in Writer's backups.
      const threads = fiction ? [] : await db.aiThreads.where('projectId').equals(projectId).toArray();
      for (const thread of threads) {
        const messages = await db.aiMessages.where('threadId').equals(thread.id).toArray();
        const response = await transport(`${info.server}/api/hoard-copilot/imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(legacyConversationImport(context, thread, messages)) });
        if (!response.ok) throw new Error(`Faustus could not import conversation (${response.status}).`);
        await response.json();
      }
      const query = new URLSearchParams({ app_id: fiction ? 'scheherazade' : 'writer', data_space_id: info.data_space_id, external_project_id: projectId });
      const response = await transport(`${info.server}/api/hoard-copilot/conversations?${query}`);
      if (!response.ok) throw new Error(`Faustus is unavailable (${response.status}).`);
      const result = await response.json() as { conversations: Array<{ session_id: string }> };
      const viewKey = `faustus.active.${info.data_space_id}.${projectId}`;
      const saved = await getSetting(viewKey);
      const sessionId = result.conversations.find((row) => row.session_id === saved)?.session_id ?? result.conversations[0]?.session_id ?? null;
      if (cancelled) return;
      const element = document.createElement('faustus-chat') as FaustusPanel;
      element.server = info.server;
      element.fetch = transport;
      element.contextProvider = contextProvider;
      element.session = sessionId;
      element.theme = 'dark';
      element.locale = current.current.locale;
      element.style.cssText = 'display:flex; flex:1; min-height:0; width:100%; height:100%;';
      element.openReference = (reference) => {
        if (reference.kind && reference.object_id) getAnchorAdapter(reference.kind)?.navigateToEntity(reference.object_id, projectId);
      };
      element.onToolUndo = async (receipt) => {
        const index = receipt.audit_index ?? receipt.auditIndex;
        if (typeof index !== 'number') throw new Error('Writer undo receipt is unavailable.');
        const result = await window.electronAPI!.aiBridge.undo(index);
        if (!result.ok) throw new Error(result.error || 'Writer could not undo this change.');
      };
      const remember = () => { if (element.sessionId) void setSetting(viewKey, element.sessionId); };
      element.addEventListener('faustus:turn-start', remember);
      element.addEventListener('faustus:session-change', remember);
      cleanup = () => { element.removeEventListener('faustus:turn-start', remember); element.removeEventListener('faustus:session-change', remember); element.remove(); };
      panel.current = element;
      container.current?.replaceChildren(element);
      if (sessionId) await element.loadHistory();
      if (!cancelled) { setLoading(false); setError(''); }
    })().catch((failure) => { if (!cancelled) { setError(String(failure instanceof Error ? failure.message : failure)); setLoading(false); } });
    return () => { cancelled = true; cleanup?.(); panel.current = null; };
  }, [projectId, attempt, fiction]);

  useEffect(() => {
    if (!pendingHandoff || !panel.current || loading) return;
    const handoff = useCopilotHandoffStore.getState().take();
    if (handoff) { setDockOpen(true); panel.current.appendDraft(`${handoff.quote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`); }
  }, [pendingHandoff, loading, setDockOpen]);

  const resize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const move = (next: MouseEvent) => setDockWidth(startWidth + startX - next.clientX);
    const end = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  };
  return <>
    {!dockOpen && <button type="button" onClick={() => setDockOpen(true)} aria-label="Faustus" title="Faustus" className="fixed right-0 top-1/2 z-30 rounded-l-lg border border-border bg-surface p-2 text-text-muted"><FaustusMark size={24} /></button>}
    <aside hidden={!dockOpen} aria-label={t('copilot.title')} className={`${!dockOpen ? 'hidden' : 'flex'} ${windowWidth < 1200 ? 'absolute right-0 top-0 bottom-0 z-30 shadow-2xl' : 'relative'} h-full flex-col border-l border-border bg-surface`} style={{ width: Math.min(dockWidth, windowWidth), minWidth: Math.min(COPILOT_DOCK_MIN_WIDTH, windowWidth), maxWidth: COPILOT_DOCK_MAX_WIDTH }}>
      <div role="separator" aria-orientation="vertical" onMouseDown={resize} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent-gold/40" />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2"><FaustusMark size={20} /><span className="flex-1 text-sm">Faustus</span><button type="button" title={t('common.close')} onClick={() => { setDockOpen(false); onClose?.(); }}><X size={16} /></button></div>
      {loading && <div role="status" className="p-3"><Loader2 size={18} className="animate-spin" /></div>}
      {error && <div role="alert" className="p-3 text-sm text-warning"><p>{error}</p><button type="button" className="mt-2 underline" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1); }}>{t('copilot.retry')}</button></div>}
      <div ref={container} className="flex flex-1 min-h-0" />
    </aside>
  </>;
}
