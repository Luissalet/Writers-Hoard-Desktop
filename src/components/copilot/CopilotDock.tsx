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
  RotateCcw,
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
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';
import { useCopilotHandoffStore } from '@/stores/copilotHandoffStore';
import { ConfirmDialog, useDeepLinkParam } from '@/engines/_shared';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { getEngine } from '@/engines/_registry';
import type { ActionPolicy } from '@/services/aiRuntime/toolPolicy';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import { fitForDescriptor, pickBestChatModel } from '@/services/aiRuntime/pickModel';
import { BUILTIN_SD_ID, DEFAULT_CONTEXT_TOKENS } from '@/services/aiRuntime/constants';
import { imageCatalogEntry } from '@/services/aiRuntime/imageCatalog';
import { detectVramContention } from '@/services/aiRuntime/sdServer';
import FitBadge from '@/components/ai-settings/FitBadge';
import { createThread, deleteThread, saveProjectSettings, updateThread } from '@/services/copilot/threads';
import { answerApproval, cancelCopilotTurn, planCopilotRetry, retryCopilotTurn, sendCopilotTurn } from '@/services/copilot/runner';
import CopilotMessage from './CopilotMessage';
import { useProjectAiSettings, useProjectThreads, useThreadMessages } from './useCopilotThread';

const OVERLAY_BREAKPOINT = 1200;

/** Tool calls that end up on the graphics card, and so meet the same physics. */
const IMAGE_TOOLS = new Set(['wh_generate_image']);

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

/** The record the writer has open in the current tab, as the URL spells it. */
interface OpenDocument {
  engineId: string;
  id: string;
  title?: string;
}

/**
 * How each engine names the record it has open, broad → precise.
 *
 * Not new plumbing: these are the very parameters the anchor adapters already
 * write when global search, Cmd+K or an annotation backlink jumps to a record,
 * and that `useDeepLinkParam` already reads on the other side. Engines with no
 * deep link of their own get the fallback adapter, which uses `?entity=`.
 */
const DOC_PARAMS: Record<string, readonly [string, string]> = {
  writings: ['writing', 'writing'],
  codex: ['entry', 'entry'],
  seeds: ['seed', 'seed'],
  notes: ['note', 'note'],
  outline: ['outline', 'beat'],
  biography: ['bio', 'bio'],
  'character-arc': ['arc', 'arc'],
  'real-atlas': ['place', 'place'],
  maps: ['map', 'pin'],
  board: ['node', 'node'],
  worldgen: ['place', 'region'],
};
const FALLBACK_DOC_PARAMS: readonly [string, string] = ['entity', 'entity'];

/**
 * What the writer has open, one level below the tab.
 *
 * The dock is mounted by MainLayout, above whatever engine is rendering, and
 * sees no more of it than the address bar does — which is enough, because
 * every jump to a record goes through a deep link. The title comes from the
 * anchor adapter, the same lookup the margin notes use for their chips.
 */
function useOpenDocument(engineId: string | null): OpenDocument | null {
  const [broadParam, preciseParam] = (engineId && DOC_PARAMS[engineId]) || FALLBACK_DOC_PARAMS;
  const broadId = useDeepLinkParam(broadParam);
  const preciseId = useDeepLinkParam(preciseParam);
  const documentId = engineId ? preciseId ?? broadId : null;
  const [resolved, setResolved] = useState<OpenDocument | null>(null);

  useEffect(() => {
    if (!engineId || !documentId) {
      // Deferred: clearing synchronously inside the effect cascades a render.
      queueMicrotask(() => setResolved(null));
      return;
    }
    const adapter = getAnchorAdapter(engineId);
    if (!adapter) {
      // No adapter for this engine: the id is still worth handing over — a
      // read tool can fail cleanly on it — but there is no title to name it by.
      queueMicrotask(() => setResolved({ engineId, id: documentId }));
      return;
    }
    let cancelled = false;
    void adapter
      .getEntityTitle(documentId)
      .then((title) => {
        // A null title means the adapter looked and found nothing: a stale
        // link. Better to report nothing open than to name a record that isn't.
        if (!cancelled) setResolved(title ? { engineId, id: documentId, title } : null);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [engineId, documentId]);

  // Never hand back a title resolved for a record the writer has already left.
  return resolved && resolved.engineId === engineId && resolved.id === documentId ? resolved : null;
}

/**
 * The three things worth asking first, taken from what is actually on screen.
 *
 * The empty state used to DESCRIBE three things you could ask and offer no way
 * to ask any of them, leaving the first prompt to a local 7B model to be
 * composed from scratch — the moment a writer decides whether this is useful.
 * These only fill the composer; nothing is sent until they press send.
 */
function startersFor(
  t: (key: string) => string,
  engineId: string | null,
  openDocument: OpenDocument | null,
): string[] {
  const phrases = (prefix: string, suffixes: readonly string[]): string[] =>
    suffixes.map((suffix) => t(`${prefix}.${suffix}`));
  const about = (prefix: string, suffixes: readonly string[], title: string): string[] =>
    phrases(prefix, suffixes).map((phrase) => phrase.replace('{title}', title));
  const openTitle = openDocument?.title;
  if (openTitle && engineId === 'writings') {
    return about('copilot.starter.writing', ['summary', 'loose', 'cast'], openTitle);
  }
  if (openTitle) return about('copilot.starter.record', ['summary', 'gaps', 'mentions'], openTitle);
  if (engineId === 'writings') return phrases('copilot.starter.writings', ['list', 'recap', 'next']);
  if (engineId === 'codex') return phrases('copilot.starter.codex', ['list', 'thin', 'add']);
  if (engineId && getEngine(engineId)) {
    const engineName = t(`engines.${engineId}.name`);
    return phrases('copilot.starter.engine', ['contents', 'gaps', 'next']).map((phrase) =>
      phrase.replace('{engine}', engineName),
    );
  }
  return phrases('copilot.starter.project', ['tour', 'next', 'note']);
}

/** A passage quoted into the draft: material to talk about, not an instruction. */
function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
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

  // What is on screen under the tab, and the three openers that follow from it.
  const openEngine = tab && tab !== 'overview' ? tab : null;
  const openDocument = useOpenDocument(openEngine);
  const starters = startersFor(t, openEngine, openDocument);

  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  // What the remote-server consent dialog is standing in front of. A retry can
  // reach a remote model too — the route may have changed since the turn it is
  // replaying — so it asks through the same gate instead of around it.
  const [pendingConsent, setPendingConsent] = useState<{ kind: 'send'; text: string } | { kind: 'retry' } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Bumped when something outside the dock puts text in the composer. The
  // composer may not exist yet at that moment — a hand-off can arrive with the
  // dock closed — so the focus waits for the render that mounts it.
  const [focusRequest, setFocusRequest] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Held for the whole turn, set before the first await. The runner's own
  // anti-double-send is keyed on a threadId, and on a brand-new project there
  // is no thread yet — so two quick Enters each created one and started a
  // generation against it.
  const sendingRef = useRef(false);

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

  // A passage handed over from wherever the writer was reading it — the
  // editor's selection menu. It lands in the composer as a quote and stops
  // there: deliberately NOT sent, so they read it back and say what they want
  // done with it. Subscribing (not a mount-only effect) so a second selection
  // handed over while the dock is already open is picked up too.
  const pendingHandoff = useCopilotHandoffStore((s) => s.pending);
  useEffect(() => {
    if (!pendingHandoff) return;
    const handoff = useCopilotHandoffStore.getState().take();
    if (!handoff) return;
    setDockOpen(true);
    setDraft((current) => `${current.trim() ? `${current.trimEnd()}\n\n` : ''}${quoteBlock(handoff.quote)}\n\n`);
    setFocusRequest((n) => n + 1);
  }, [pendingHandoff, setDockOpen]);

  // Put the caret after the quote, once the composer is actually on screen.
  useEffect(() => {
    if (focusRequest === 0) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusRequest, open]);

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

  // The same briefing for a first send and for a retry: replaying a turn must
  // put the model back in the situation it failed in, not a slightly different one.
  const briefing = useMemo(
    () => ({
      projectTitle: project?.title ?? '',
      projectDescription: project?.description,
      projectMode: project?.mode,
      enabledEngines: project?.enabledEngines ?? [],
      openEngine,
      openDocument,
      locale,
    }),
    [locale, project?.title, project?.description, project?.mode, project?.enabledEngines, openEngine, openDocument],
  );

  const send = useCallback(
    async (text: string, consented = false) => {
      const clean = text.trim();
      if (!clean || !route || !project) return;
      if (!consented && routeConnection?.locality === 'remote' && !settings?.remoteConsent) {
        setPendingConsent({ kind: 'send', text: clean });
        return;
      }
      if (sendingRef.current) return;
      sendingRef.current = true;
      setDraft('');
      try {
        const threadId = await ensureThread();
        await sendCopilotTurn({ projectId, threadId, text: clean, route, policy, briefing });
      } finally {
        sendingRef.current = false;
      }
    },
    [briefing, ensureThread, policy, project, projectId, route, routeConnection?.locality, settings?.remoteConsent],
  );

  // Retry: the turn that ended in an error, a timeout or a cancel is run again
  // from the rows on disk — so it works on a thread reopened days later, and the
  // reader's own message is replayed, never duplicated.
  // Not while this thread is running: mid-turn the rows momentarily look like a
  // turn that stopped between a tool call and its answer (they are exactly that,
  // until the tool comes back), and a Retry offered next to a live approval card
  // would be an invitation to break the turn the reader is answering.
  const retryPlan = useMemo(() => (run ? null : planCopilotRetry(messages)), [run, messages]);
  const startRetry = useCallback(() => {
    if (!route || !project || !activeThreadId) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    void retryCopilotTurn({ projectId, threadId: activeThreadId, route, policy, briefing }).finally(() => {
      sendingRef.current = false;
    });
  }, [activeThreadId, briefing, policy, project, projectId, route]);
  const retry = useCallback(() => {
    if (routeConnection?.locality === 'remote' && !settings?.remoteConsent) {
      setPendingConsent({ kind: 'retry' });
      return;
    }
    startRetry();
  }, [routeConnection?.locality, settings?.remoteConsent, startRetry]);

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

  // One card, two residents: a copilot answer leaves its chat model loaded, and
  // the image tool it calls next needs the same memory. Warn on the card that is
  // about to run — with the same wording and the same way out as the studio.
  const sdStatus = useImageRuntimeStore((s) => s.status);
  const refreshSdRuntime = useImageRuntimeStore((s) => s.refresh);
  const imageRoute = settings?.imageRoute ?? runtime.defaults.image;
  const imageEntry = imageRoute?.connectionId === BUILTIN_SD_ID ? imageCatalogEntry(imageRoute.modelId) : undefined;
  const imageCallId = messages.find(
    (message) =>
      message.role === 'tool' &&
      message.toolCall &&
      IMAGE_TOOLS.has(message.toolCall.tool) &&
      (message.toolCall.state === 'proposed' || message.toolCall.state === 'running'),
  )?.id ?? null;
  useEffect(() => {
    if (!imageCallId || !imageEntry) return;
    void refreshSdRuntime();
  }, [imageCallId, imageEntry, refreshSdRuntime]);
  const imageContention = useMemo(
    () => (imageCallId ? detectVramContention(sdStatus?.vram, imageEntry) : null),
    [imageCallId, imageEntry, sdStatus?.vram],
  );

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
            {route && (
              <div className="mt-1 w-full max-w-xs space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-text-dim text-left">{t('copilot.starter.label')}</p>
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => {
                      setDraft(starter);
                      setFocusRequest((n) => n + 1);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg border border-border bg-elevated text-[11px] text-text-muted hover:text-text-primary hover:border-accent-gold/40 transition"
                  >
                    {starter}
                  </button>
                ))}
                <p className="text-[10px] text-text-dim text-left">{t('copilot.starter.hint')}</p>
              </div>
            )}
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
        {messages.map((message) => (
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
            onRetry={retryPlan?.anchorMessageId === message.id ? retry : undefined}
            retryDisabled={busy}
            vramContention={imageCallId === message.id ? imageContention : undefined}
          />
        ))}
        {/* A turn stopped between a tool call and the answer leaves no assistant
            row to hang the control off — and used to offer nothing at all. */}
        {retryPlan && retryPlan.anchorMessageId === null && messages.length > 0 && (
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            title={t('copilot.retryHint')}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-accent-gold hover:bg-accent-gold/10 transition disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <RotateCcw size={11} />
            {t('copilot.retry')}
          </button>
        )}
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
          const pending = pendingConsent;
          setPendingConsent(null);
          if (!pending) return;
          void saveProjectSettings(projectId, { remoteConsent: true }).then(() => {
            if (pending.kind === 'send') void send(pending.text, true);
            else startRetry();
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
