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

export function useProjectThreads(projectId: string | undefined): AiThread[] {
  const [threads, setThreads] = useState<AiThread[]>(EMPTY_THREADS);
  const version = useCopilotStore((s) => s.dataVersion);
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
  const version = useCopilotStore((s) => s.dataVersion);
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
  const version = useCopilotStore((s) => s.dataVersion);
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
