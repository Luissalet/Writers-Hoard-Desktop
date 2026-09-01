// ============================================================================
// Copilot — hooks over the thread tables
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { AiMessage, AiProjectSettings, AiThread } from '@/services/copilot/types';
import {
  getProjectSettings,
  listMessages,
  listThreads,
  settleStaleMessages,
  subscribeCopilotData,
} from '@/services/copilot/threads';
import { useCopilotStore } from '@/stores/copilotStore';

const EMPTY_THREADS: AiThread[] = [];
const EMPTY_MESSAGES: AiMessage[] = [];

/** Stand-in version while a turn streams — constant, so nothing reloads. */
const STREAMING = -1;

/**
 * `dataVersion` is bumped after EVERY copilot event, `delta` and `reasoning`
 * included. A streamed token changes no stored row, yet each one re-ran
 * `listThreads` / `listMessages` / `getProjectSettings` and handed React three
 * brand-new results — so the whole conversation reconciled once per token, and
 * the longer the thread the worse it got.
 *
 * Every write that really does touch a row notifies `subscribeCopilotData`,
 * which these hooks already listen to, so the version can simply be ignored
 * while a turn is in flight. `endRun` runs before the turn's final bump, so
 * the settled rows are always reloaded once the turn is over.
 *
 * The live streaming row is unaffected: it is drawn from the run's buffer in
 * the store, not from these hooks.
 */
function useSettledDataVersion(): number {
  return useCopilotStore((s) =>
    Object.keys(s.runsByThread).length > 0 ? STREAMING : s.dataVersion,
  );
}

export function useProjectThreads(projectId: string | undefined): AiThread[] {
  const [threads, setThreads] = useState<AiThread[]>(EMPTY_THREADS);
  const version = useSettledDataVersion();
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = () => {
      void listThreads(projectId).then((rows) => {
        if (alive) setThreads(rows);
      });
    };
    load();
    const unsubscribe = subscribeCopilotData(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [projectId, version]);
  return projectId ? threads : EMPTY_THREADS;
}

export function useThreadMessages(threadId: string | null): AiMessage[] {
  const [messages, setMessages] = useState<AiMessage[]>(EMPTY_MESSAGES);
  const version = useSettledDataVersion();
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = () => {
      void listMessages(threadId).then((rows) => {
        if (alive) setMessages(rows);
      });
    };
    void settleStaleMessages(threadId).then(load);
    const unsubscribe = subscribeCopilotData(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [threadId, version]);
  return threadId ? messages : EMPTY_MESSAGES;
}

export function useProjectAiSettings(projectId: string | undefined): {
  settings: AiProjectSettings | null;
  reload: () => void;
} {
  const [settings, setSettings] = useState<AiProjectSettings | null>(null);
  const version = useSettledDataVersion();
  const reload = useCallback(() => {
    if (!projectId) return;
    void getProjectSettings(projectId).then(setSettings);
  }, [projectId]);
  useEffect(() => {
    reload();
    // saveProjectSettings notifies the same channel as the thread tables.
    return subscribeCopilotData(reload);
  }, [reload, version]);
  return { settings: projectId ? settings : null, reload };
}
