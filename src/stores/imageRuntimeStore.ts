// ============================================================================
// Local image runtime store — status and progress of the managed sd-server
// ============================================================================
//
// Mirrors `electron/ai/sdRuntime.ts` for the settings page: one status
// snapshot pushed by main, one progress record per download in flight.
// Every action is an IPC call; nothing here knows a URL or a path.

import { create } from 'zustand';
import type { SdBackend, SdOpResult, SdProgress, SdRuntimeStatus } from '@/services/aiRuntime/sdServer';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import { useAiRuntimeStore } from './aiRuntimeStore';

declare global {
  interface Window {
    __whImageRuntimeWired?: boolean;
  }
}

interface ImageRuntimeState {
  available: boolean;
  status: SdRuntimeStatus | null;
  /** Keyed by runtime backend or model id. */
  progress: Record<string, SdProgress>;
  /** Last failure per key, cleared on the next attempt. */
  errors: Record<string, string>;

  refresh: () => Promise<void>;
  installRuntime: (backend?: SdBackend) => Promise<SdOpResult>;
  cancelInstall: () => Promise<void>;
  removeRuntime: () => Promise<SdOpResult>;
  downloadModel: (id: string) => Promise<SdOpResult>;
  cancelDownload: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<SdOpResult>;
  stopServer: () => Promise<void>;
}

function sdApi(): NonNullable<Window['electronAPI']>['sd'] | null {
  return typeof window !== 'undefined' ? window.electronAPI?.sd ?? null : null;
}

const UNAVAILABLE: SdOpResult = { ok: false, error: 'desktop-only' };
let statusRequest = 0;
let statusPushRevision = 0;

export const useImageRuntimeStore = create<ImageRuntimeState>((set, get) => ({
  available: sdApi() !== null,
  status: null,
  progress: {},
  errors: {},

  refresh: async () => {
    const api = sdApi();
    if (!api) return;
    const request = ++statusRequest;
    const pushRevision = statusPushRevision;
    const status = await api.status();
    if (request === statusRequest && pushRevision === statusPushRevision) set({ status });
  },

  installRuntime: async (backend) => {
    const api = sdApi();
    if (!api) return UNAVAILABLE;
    const key = backend ?? get().status?.backends[0] ?? 'vulkan';
    set((s) => ({ errors: { ...s.errors, [key]: '' } }));
    const result = await api.installRuntime(backend);
    // 'busy' is a concurrent-click reject, not a failure of this row — the other
    // click is doing the work; surfacing it would leave a sticky false error.
    if (!result.ok && result.error !== 'cancelled' && result.error !== 'busy') set((s) => ({ errors: { ...s.errors, [key]: result.error ?? 'error' } }));
    set((s) => {
      const next = { ...s.progress };
      delete next[key];
      return { progress: next };
    });
    await get().refresh();
    await useAiRuntimeStore.getState().loadModels(BUILTIN_SD_ID, true);
    return result;
  },

  cancelInstall: async () => {
    await sdApi()?.cancelInstall();
  },

  removeRuntime: async () => {
    const api = sdApi();
    if (!api) return UNAVAILABLE;
    const result = await api.removeRuntime();
    await get().refresh();
    return result;
  },

  downloadModel: async (id) => {
    const api = sdApi();
    if (!api) return UNAVAILABLE;
    set((s) => ({ errors: { ...s.errors, [id]: '' } }));
    const result = await api.downloadModel(id);
    // 'busy' is a concurrent-click reject, not a failure of this row (the other
    // click is downloading); surfacing it would leave a sticky false error.
    if (!result.ok && result.error !== 'cancelled' && result.error !== 'busy') set((s) => ({ errors: { ...s.errors, [id]: result.error ?? 'error' } }));
    set((s) => {
      const next = { ...s.progress };
      delete next[id];
      return { progress: next };
    });
    await get().refresh();
    await useAiRuntimeStore.getState().loadModels(BUILTIN_SD_ID, true);
    return result;
  },

  cancelDownload: async (id) => {
    await sdApi()?.cancelDownload(id);
  },

  deleteModel: async (id) => {
    const api = sdApi();
    if (!api) return UNAVAILABLE;
    const result = await api.deleteModel(id);
    await get().refresh();
    await useAiRuntimeStore.getState().loadModels(BUILTIN_SD_ID, true);
    return result;
  },

  stopServer: async () => {
    const api = sdApi();
    if (!api) return;
    const request = ++statusRequest;
    const pushRevision = statusPushRevision;
    const status = await api.stop();
    if (request === statusRequest && pushRevision === statusPushRevision) set({ status });
  },
}));

// One module-scope subscription per push channel (guarded against HMR).
if (typeof window !== 'undefined' && window.electronAPI?.sd && !window.__whImageRuntimeWired) {
  window.__whImageRuntimeWired = true;
  window.electronAPI.sd.onStatus((status) => {
    statusPushRevision += 1;
    useImageRuntimeStore.setState({ status });
  });
  window.electronAPI.sd.onProgress((progress) =>
    useImageRuntimeStore.setState((s) => ({ progress: { ...s.progress, [progress.id]: progress } })),
  );
}
