// ============================================================================
// Copilot store — dock state and live runs (renderer)
// ============================================================================
//
// Persisted conversation rows live in Dexie (services/copilot/threads.ts);
// this store holds what is only true right now: whether the dock is open and
// how wide, which thread each project is looking at, and the streaming buffer
// of a turn in flight. Closing the dock does not cancel a run — the Cancel
// button does.

import { create } from 'zustand';
import type { CopilotRunHandle } from '@/services/aiRuntime/client';

export interface LiveRun {
  runId: string;
  threadId: string;
  projectId: string;
  handle: CopilotRunHandle;
  /** Dexie id of the assistant row currently being streamed into. */
  assistantMessageId: string | null;
  buffer: string;
  reasoning: string;
  startedAt: number;
  /** Tool calls waiting for the user's yes/no. */
  pendingApprovals: string[];
  toolNames: string[];
  chatOnly: boolean;
}

interface CopilotState {
  dockOpen: boolean;
  dockWidth: number;
  activeThreadByProject: Record<string, string>;
  runsByThread: Record<string, LiveRun>;
  /** Bumped whenever Dexie rows changed so hooks refetch. */
  dataVersion: number;

  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDockWidth: (width: number) => void;
  setActiveThread: (projectId: string, threadId: string | null) => void;
  startRun: (run: LiveRun) => void;
  patchRun: (threadId: string, changes: Partial<LiveRun>) => void;
  appendBuffer: (threadId: string, text: string, kind: 'content' | 'reasoning') => void;
  endRun: (threadId: string) => void;
  bumpData: () => void;
}

const WIDTH_KEY = 'wh.copilot.width';
const OPEN_KEY = 'wh.copilot.open';
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / quota: a forgotten width is not a bug
  }
}

export const useCopilotStore = create<CopilotState>((set) => ({
  dockOpen: readStored(OPEN_KEY, false, (raw) => raw === '1'),
  dockWidth: readStored(WIDTH_KEY, 380, (raw) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(raw) || 380))),
  activeThreadByProject: {},
  runsByThread: {},
  dataVersion: 0,

  setDockOpen: (open) => {
    writeStored(OPEN_KEY, open ? '1' : '0');
    set({ dockOpen: open });
  },
  toggleDock: () =>
    set((s) => {
      writeStored(OPEN_KEY, s.dockOpen ? '0' : '1');
      return { dockOpen: !s.dockOpen };
    }),
  setDockWidth: (width) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    writeStored(WIDTH_KEY, String(clamped));
    set({ dockWidth: clamped });
  },
  setActiveThread: (projectId, threadId) =>
    set((s) => {
      const next = { ...s.activeThreadByProject };
      if (threadId) next[projectId] = threadId;
      else delete next[projectId];
      return { activeThreadByProject: next };
    }),
  startRun: (run) => set((s) => ({ runsByThread: { ...s.runsByThread, [run.threadId]: run } })),
  patchRun: (threadId, changes) =>
    set((s) => {
      const current = s.runsByThread[threadId];
      if (!current) return {};
      return { runsByThread: { ...s.runsByThread, [threadId]: { ...current, ...changes } } };
    }),
  appendBuffer: (threadId, text, kind) =>
    set((s) => {
      const current = s.runsByThread[threadId];
      if (!current) return {};
      const patched =
        kind === 'content'
          ? { ...current, buffer: current.buffer + text }
          : { ...current, reasoning: current.reasoning + text };
      return { runsByThread: { ...s.runsByThread, [threadId]: patched } };
    }),
  endRun: (threadId) =>
    set((s) => {
      const next = { ...s.runsByThread };
      delete next[threadId];
      return { runsByThread: next };
    }),
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));

export const COPILOT_DOCK_MIN_WIDTH = MIN_WIDTH;
export const COPILOT_DOCK_MAX_WIDTH = MAX_WIDTH;
