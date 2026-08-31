// ============================================================================
// Copilot — the right-hand dock, one conversation per project
// ============================================================================
//
// Mounted by MainLayout on every route; renders nothing outside a project.
// The project comes from the URL, so switching projects switches threads and
// context — messages never mix. Width is remembered per machine; below a
// certain window width the dock floats over the content instead of pushing
// it. Closing the dock never cancels a run; the Cancel button does.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  ChevronDown,
  Eye,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useProject } from '@/hooks/useProjects';
import { useLocaleStore } from '@/stores/localeStore';
import { useCopilotStore, COPILOT_DOCK_MAX_WIDTH, COPILOT_DOCK_MIN_WIDTH } from '@/stores/copilotStore';
import { useAiRuntimeStore, selectChatModels } from '@/stores/aiRuntimeStore';
import { ConfirmDialog } from '@/engines/_shared';
import type { ActionPolicy } from '@/services/aiRuntime/toolPolicy';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import { fitForDescriptor, pickBestChatModel } from '@/services/aiRuntime/pickModel';
import { DEFAULT_CONTEXT_TOKENS } from '@/services/aiRuntime/constants';
import FitBadge from '@/components/ai-settings/FitBadge';
import { createThread, deleteThread, saveProjectSettings, updateThread } from '@/services/copilot/threads';
import { answerApproval, cancelCopilotTurn, sendCopilotTurn } from '@/services/copilot/runner';
import CopilotMessage from './CopilotMessage';
import { useProjectAiSettings, useProjectThreads, useThreadMessages } from './useCopilotThread';

const OVERLAY_BREAKPOINT = 1200;

const POLICIES: Array<{ id: ActionPolicy; icon: typeof Eye }> = [
  { id: 'read-only', icon: Eye },
  { id: 'ask', icon: ShieldCheck },
  { id: 'allow', icon: Pencil },
];

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export default function CopilotDock() {
  const { id: projectId, tab } = useParams<{ id?: string; tab?: string }>();
  const desktop = typeof window !== 'undefined' && Boolean(window.electronAPI?.copilot);
  const dockOpen = useCopilotStore((s) => s.dockOpen);
  if (!projectId || !desktop) return null;
  return <DockBody key={projectId} projectId={projectId} tab={tab ?? null} open={dockOpen} />;
}

function DockBody({ projectId, tab, open }: { projectId: string; tab: string | null; open: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocaleStore((s) => s.locale);
  const { project } = useProject(projectId);
  const { setDockOpen, dockWidth, setDockWidth, activeThreadByProject, setActiveThread, runsByThread } = useCopilotStore();
  const windowWidth = useWindowWidth();
  const overlay = windowWidth < OVERLAY_BREAKPOINT;

  const threads = useProjectThreads(projectId);
  const activeThreadId = activeThreadByProject[projectId] ?? threads[0]?.id ?? null;
  const activeThread = threads.find((th) => th.id === activeThreadId) ?? null;
  const messages = useThreadMessages(activeThreadId);
  const run = activeThreadId ? runsByThread[activeThreadId] : undefined;
  const { settings } = useProjectAiSettings(projectId);

  const runtime = useAiRuntimeStore();
  const chatModels = useMemo(() => selectChatModels(runtime), [runtime]);

  // How each offered model runs on this machine, and which local one is best —
  // the same ranking the settings page shows, so the per-project choice is not
  // made blind. Pure and cheap; recomputed only when the model set changes.
  const fitByModel = useMemo(() => {
    const map = new Map<string, ReturnType<typeof fitForDescriptor>>();
    for (const { model } of chatModels) map.set(`${model.connectionId}::${model.id}`, fitForDescriptor(model, runtime.hardware, DEFAULT_CONTEXT_TOKENS));
    return map;
  }, [chatModels, runtime.hardware]);
  const bestLocalKey = useMemo(() => {
    const localModels = chatModels
      .filter(({ connection }) => connection.locality === 'embedded' || connection.locality === 'loopback')
      .map(({ model }) => model);
    const best = pickBestChatModel(localModels, runtime.hardware, { contextTokens: DEFAULT_CONTEXT_TOKENS });
    return best ? `${best.model.connectionId}::${best.model.id}` : null;
  }, [chatModels, runtime.hardware]);

  // Route: thread → project → global default.
  const route: AiRouteSelection | undefined = activeThread?.route ?? settings?.chatRoute ?? runtime.defaults.chat;
  const routeConnection = route ? runtime.connections.find((c) => c.id === route.connectionId) : undefined;
  const policy: ActionPolicy = activeThread?.policy ?? settings?.defaultPolicy ?? 'ask';

  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [pendingConsent, setPendingConsent] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load what the header needs once the dock is open. Hardware drives the fit
  // badges and the "best model" star in the picker, so it is loaded too.
  useEffect(() => {
    if (!open) return;
    void runtime.loadConnections();
    void runtime.loadDefaults();
    void runtime.loadHardware();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open || !route) return;
    void runtime.loadModels(route.connectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, route?.connectionId]);
  const connectionKey = runtime.connections.map((c) => `${c.id}:${c.enabled ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!pickerOpen) return;
    for (const entry of connectionKey.split('|')) {
      const [connectionId, enabled] = entry.split(':');
      if (connectionId && enabled === '1') void runtime.loadModels(connectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, connectionKey]);

  // Keep the newest message in view while streaming.
  const liveLength = run?.buffer.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, liveLength, activeThreadId]);

  const ensureThread = useCallback(async (): Promise<string> => {
    if (activeThread) return activeThread.id;
    const created = await createThread(projectId, { policy, route });
    setActiveThread(projectId, created.id);
    return created.id;
  }, [activeThread, policy, projectId, route, setActiveThread]);

  const send = useCallback(
    async (text: string, consented = false) => {
      const clean = text.trim();
      if (!clean || !route || !project) return;
      if (!consented && routeConnection?.locality === 'remote' && !settings?.remoteConsent) {
        setPendingConsent(clean);
        return;
      }
      const threadId = await ensureThread();
      setDraft('');
      await sendCopilotTurn({
        projectId,
        threadId,
        text: clean,
        route,
        policy,
        briefing: {
          projectTitle: project.title,
          projectDescription: project.description,
          projectMode: project.mode,
          enabledEngines: project.enabledEngines,
          openEngine: tab && tab !== 'overview' ? tab : null,
          locale,
        },
      });
    },
    [ensureThread, locale, policy, project, projectId, route, routeConnection?.locality, settings?.remoteConsent, tab],
  );

  const setPolicy = async (next: ActionPolicy) => {
    if (activeThread) await updateThread(activeThread.id, { policy: next });
    await saveProjectSettings(projectId, { defaultPolicy: next });
  };

  const chooseRoute = async (next: AiRouteSelection) => {
    setPickerOpen(false);
    if (activeThread) await updateThread(activeThread.id, { route: next });
    await saveProjectSettings(projectId, { chatRoute: next });
  };

  // Resize by dragging the left edge.
  const onResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const onMove = (e: MouseEvent) => setDockWidth(startWidth + (startX - e.clientX));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const busy = Boolean(run);
  const canSend = Boolean(route) && !busy && draft.trim().length > 0;
  const noRoute = runtime.connectionsLoaded && !route;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setDockOpen(true)}
        title={t('copilot.open')}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1 rounded-l-lg border border-r-0 border-border bg-surface px-1.5 py-3 text-text-muted hover:text-accent-gold hover:border-accent-gold/40 transition"
      >
        <Bot size={16} />
        {busy && <Loader2 size={12} className="animate-spin text-accent-gold" />}
      </button>
    );
  }

  const localityKey = routeConnection?.locality === 'remote' ? 'remote' : routeConnection?.locality === 'lan' ? 'lan' : 'local';

  return (
    <aside
      className={`${overlay ? 'absolute right-0 top-0 bottom-0 z-30 shadow-2xl' : 'relative'} h-full flex flex-col border-l border-border bg-surface`}
      style={{ width: dockWidth, minWidth: COPILOT_DOCK_MIN_WIDTH, maxWidth: COPILOT_DOCK_MAX_WIDTH }}
      aria-label={t('copilot.title')}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent-gold/40 transition"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Bot size={16} className="text-accent-gold flex-shrink-0" />
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setThreadsOpen((v) => !v)}
            className="flex items-center gap-1 max-w-full text-sm text-text-primary hover:text-accent-gold transition"
            title={t('copilot.threads')}
          >
            <span className="truncate">{activeThread?.title || t('copilot.newThread')}</span>
            <ChevronDown size={12} className="flex-shrink-0 text-text-dim" />
          </button>
          {threadsOpen && (
            <div className="absolute left-0 top-full mt-1 z-40 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-elevated shadow-xl p-1">
              <button
                type="button"
                onClick={() => {
                  setThreadsOpen(false);
                  void createThread(projectId, { policy, route }).then((created) => setActiveThread(projectId, created.id));
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-accent-gold hover:bg-accent-gold/10"
              >
                <MessageSquarePlus size={12} />
                {t('copilot.newThread')}
              </button>
              {threads.map((th) => (
                <div key={th.id} className="flex items-center group">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveThread(projectId, th.id);
                      setThreadsOpen(false);
                    }}
                    className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded text-xs truncate ${
                      th.id === activeThreadId ? 'text-accent-gold bg-accent-gold/10' : 'text-text-muted hover:text-text-primary hover:bg-surface'
                    }`}
                  >
                    {th.title || t('copilot.untitled')}
                    {runsByThread[th.id] && <Loader2 size={10} className="inline ml-1 animate-spin" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(th.id)}
                    title={t('copilot.deleteThread')}
                    className="p-1 text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger transition"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {threads.length === 0 && <p className="px-2 py-1.5 text-[11px] text-text-dim">{t('copilot.noThreads')}</p>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings/ai')}
          title={t('copilot.settings')}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-elevated transition"
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          onClick={() => setDockOpen(false)}
          title={t('common.close')}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-elevated transition"
        >
          <X size={14} />
        </button>
      </div>

      {/* Model + policy strip */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border text-[11px]">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1 max-w-full px-2 py-1 rounded border border-border bg-elevated text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition"
            title={t('copilot.model')}
          >
            <span className="truncate font-mono">{route ? route.modelId : t('copilot.noModel')}</span>
            {route && (
              <span
                className={`flex-shrink-0 px-1 rounded text-[9px] uppercase tracking-wide ${
                  localityKey === 'remote' ? 'bg-warning/20 text-warning' : localityKey === 'lan' ? 'bg-yarn-blue/20 text-yarn-blue' : 'bg-success/20 text-success'
                }`}
              >
                {t(`copilot.locality.${localityKey}`)}
              </span>
            )}
            <ChevronDown size={11} className="flex-shrink-0" />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full mt-1 z-40 w-80 max-h-80 overflow-y-auto rounded-lg border border-border bg-elevated shadow-xl p-1">
              {chatModels.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-text-dim">{t('copilot.noModelsHint')}</p>
              )}
              {runtime.connections
                .filter((c) => c.enabled)
                .map((connection) => {
                  const models = chatModels.filter((m) => m.connection.id === connection.id);
                  const state = runtime.modelsByConnection[connection.id];
                  return (
                    <div key={connection.id} className="mb-1">
                      <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-text-dim flex items-center gap-1">
                        {connection.name}
                        {state?.loading && <Loader2 size={9} className="animate-spin" />}
                      </p>
                      {models.map(({ model }) => {
                        const key = `${connection.id}::${model.id}`;
                        const fit = fitByModel.get(key);
                        const noTools = !model.capabilities.includes('tools');
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => void chooseRoute({ connectionId: connection.id, modelId: model.id })}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px] ${
                              route?.connectionId === connection.id && route?.modelId === model.id
                                ? 'text-accent-gold bg-accent-gold/10'
                                : 'text-text-muted hover:text-text-primary hover:bg-surface'
                            }`}
                          >
                            <span className="font-mono truncate">{model.id}</span>
                            {key === bestLocalKey && (
                              <span className="flex-shrink-0 text-[9px] text-accent-plum-light" title={t('copilot.bestModel')}>★</span>
                            )}
                            <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                              {noTools && <span className="text-[9px] text-warning">{t('copilot.noTools')}</span>}
                              {fit && <FitBadge fit={fit} compact />}
                            </span>
                          </button>
                        );
                      })}
                      {!state?.loading && models.length === 0 && (
                        <p className="px-2 py-1 text-[10px] text-text-dim">{state?.error ?? t('copilot.noModelsOnConnection')}</p>
                      )}
                    </div>
                  );
                })}
              <button
                type="button"
                onClick={() => navigate('/settings/ai')}
                className="w-full mt-1 px-2 py-1.5 rounded text-[11px] text-accent-gold hover:bg-accent-gold/10 text-left"
              >
                {t('copilot.manageModels')}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center rounded border border-border overflow-hidden flex-shrink-0">
          {POLICIES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => void setPolicy(id)}
              title={t(`copilot.policy.${id}`)}
              className={`p-1.5 transition ${policy === id ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-dim hover:text-text-primary'}`}
            >
              <Icon size={12} />
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-4">
            <Bot size={28} className="text-accent-gold/60" />
            <p className="text-sm text-text-primary">{t('copilot.empty.title')}</p>
            <p className="text-xs text-text-dim">{t('copilot.empty.body')}</p>
            {noRoute && (
              <button
                type="button"
                onClick={() => navigate('/settings/ai')}
                className="mt-2 px-3 py-1.5 rounded-lg bg-accent-gold text-deep text-xs font-semibold hover:bg-accent-amber transition"
              >
                {t('copilot.setupModel')}
              </button>
            )}
          </div>
        )}
        {messages.map((message, index) => (
          <CopilotMessage
            key={message.id}
            message={message}
            liveText={run?.assistantMessageId === message.id ? run.buffer : undefined}
            liveReasoning={run?.assistantMessageId === message.id ? run.reasoning : undefined}
            onApprove={
              run && message.role === 'tool' && message.toolCall?.state === 'proposed'
                ? (callId, approved) => answerApproval(activeThreadId!, callId, approved)
                : undefined
            }
            // Retry only the most recent turn, only when it errored and nothing
            // is running: re-send the user message it answered.
            onRetry={
              !run && message.status === 'error' && index === messages.length - 1
                ? () => {
                    for (let i = index - 1; i >= 0; i -= 1) {
                      if (messages[i].role === 'user') {
                        void send(messages[i].content);
                        return;
                      }
                    }
                  }
                : undefined
            }
          />
        ))}
        {run?.chatOnly && messages.length > 0 && (
          <p className="text-[11px] text-warning">{t('copilot.notice.chat-only')}</p>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-2">
        {policy === 'read-only' && (
          <p className="px-1 pb-1 text-[10px] text-text-dim">{t('copilot.policy.read-only.hint')}</p>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void send(draft);
              }
            }}
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            placeholder={route ? t('copilot.placeholder') : t('copilot.placeholderNoModel')}
            disabled={!route}
            className="flex-1 resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold transition disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => activeThreadId && cancelCopilotTurn(activeThreadId)}
              title={t('copilot.cancel')}
              className="p-2 rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger/40 transition"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(draft)}
              disabled={!canSend}
              title={t('copilot.send')}
              className="p-2 rounded-lg bg-accent-gold text-deep hover:bg-accent-amber transition disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingConsent !== null}
        message={t('copilot.remoteConsent').replace('{name}', routeConnection?.name ?? '')}
        onConfirm={() => {
          const text = pendingConsent;
          setPendingConsent(null);
          void saveProjectSettings(projectId, { remoteConsent: true }).then(() => {
            if (text) void send(text, true);
          });
        }}
        onCancel={() => setPendingConsent(null)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('copilot.deleteThreadConfirm')}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (!id) return;
          if (runsByThread[id]) cancelCopilotTurn(id);
          void deleteThread(id).then(() => {
            if (activeThreadId === id) setActiveThread(projectId, null);
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  );
}
