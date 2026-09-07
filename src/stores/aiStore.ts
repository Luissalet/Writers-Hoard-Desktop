import { create } from 'zustand';
import type { AiConfig } from '@/types';
import type { OllamaStatus } from '@/electron-env';
import { DEFAULT_AI_CONFIG, AI_SETTINGS_KEYS } from '@/config/ai';
import * as ops from '@/db/operations';
import { testConnection } from '@/services/aiService';
import { toast } from '@/components/common/toast';
import { t } from '@/i18n/useTranslation';
import { aiApi } from '@/services/aiRuntime/client';
import { BUILTIN_OLLAMA_ID } from '@/services/aiRuntime/constants';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';

/**
 * Fold the pre-settings-page configuration into the connection registry,
 * once: the proxy URL becomes a connection and the chosen provider becomes
 * the default chat route. Legacy keys are left in place (two versions of
 * observation before they go), and the migration is idempotent — main
 * remembers it ran.
 */
async function migrateLegacyAiSettings(config: AiConfig): Promise<void> {
  const api = aiApi();
  if (!api) return;
  try {
    if (await api.legacyMigrated()) return;
    const defaults = await api.getDefaults();
    if (!defaults.chat) {
      if (config.provider === 'local') {
        await api.setDefault('chat', { connectionId: BUILTIN_OLLAMA_ID, modelId: config.localModel });
      } else if (config.baseUrl) {
        const saved = await api.saveConnection({
          name: 'CLIProxyAPI',
          kind: 'openai-compatible',
          baseUrl: config.baseUrl,
          modelTypes: ['chat'],
          pinnedModels: config.model ? [config.model] : [],
        });
        const connectionId = saved.ok ? saved.connection.id : null;
        if (connectionId && config.model) {
          await api.setDefault('chat', { connectionId, modelId: config.model });
        }
      }
    }
    await api.legacyMigrated(true);
  } catch (err) {
    console.error('[ai] legacy settings migration failed', err);
  }
}

/** Same shape as worldgen's GenerationState — the app's progress vocabulary. */
interface LocalProgress {
  running: boolean;
  stage: string;
  /** 0..1 */
  progress: number;
  error: string | null;
}

interface PullProgressState extends LocalProgress {
  tag: string | null;
  completedBytes: number;
  totalBytes: number;
}

const IDLE_PROGRESS: LocalProgress = { running: false, stage: '', progress: 0, error: null };
const IDLE_PULL: PullProgressState = { ...IDLE_PROGRESS, tag: null, completedBytes: 0, totalBytes: 0 };

/** Map main-process error codes to a user-facing message. */
function localErrorText(code: string): string {
  if (code.startsWith('no-space:')) {
    return t('settings.ai.local.noSpace').replace('{gb}', code.slice('no-space:'.length));
  }
  if (code === 'not-ready' || code === 'runtime-missing' || code === 'model-missing') {
    return t('ai.localNotReady');
  }
  return code;
}

interface AiState {
  config: AiConfig;
  isConnected: boolean;
  availableModels: string[];
  isLoading: boolean;
  error: string | null;

  /** Local runtime snapshot from main (null until first refresh). */
  localStatus: OllamaStatus | null;
  runtimeProgress: LocalProgress;
  pullProgress: PullProgressState;

  loadSettings: () => Promise<void>;
  saveSettings: (config: Partial<AiConfig>) => Promise<void>;
  checkConnection: () => Promise<void>;

  setProvider: (provider: AiConfig['provider']) => Promise<void>;
  setLocalModel: (tag: string) => Promise<void>;
  refreshLocalStatus: () => Promise<void>;
  downloadRuntime: () => Promise<void>;
  cancelRuntimeDownload: () => Promise<void>;
  pullModel: (tag: string) => Promise<void>;
  cancelPull: (tag: string) => Promise<void>;
  deleteModel: (tag: string) => Promise<void>;
}

let settingsLoadRequest = 0;
let connectionCheckRequest = 0;
let localStatusRequest = 0;
let localStatusPushRevision = 0;
let settingsWriteQueue: Promise<void> = Promise.resolve();

export const useAiStore = create<AiState>((set, get) => ({
  config: { ...DEFAULT_AI_CONFIG },
  isConnected: false,
  availableModels: [],
  isLoading: false,
  error: null,

  localStatus: null,
  runtimeProgress: { ...IDLE_PROGRESS },
  pullProgress: { ...IDLE_PULL },

  loadSettings: async () => {
    const request = ++settingsLoadRequest;
    try {
      const [baseUrl, model, enabled, provider, localModel] = await Promise.all([
        ops.getSetting(AI_SETTINGS_KEYS.BASE_URL),
        ops.getSetting(AI_SETTINGS_KEYS.MODEL),
        ops.getSetting(AI_SETTINGS_KEYS.ENABLED),
        ops.getSetting(AI_SETTINGS_KEYS.PROVIDER),
        ops.getSetting(AI_SETTINGS_KEYS.LOCAL_MODEL),
      ]);

      const config: AiConfig = {
        baseUrl: baseUrl || DEFAULT_AI_CONFIG.baseUrl,
        model: model || DEFAULT_AI_CONFIG.model,
        enabled: enabled !== undefined ? enabled === 'true' : DEFAULT_AI_CONFIG.enabled,
        provider: provider === 'local' ? 'local' : DEFAULT_AI_CONFIG.provider,
        localModel: localModel || DEFAULT_AI_CONFIG.localModel,
      };
      if (request !== settingsLoadRequest) return;
      set({ config });
      await migrateLegacyAiSettings(config);
      if (request === settingsLoadRequest) await useAiRuntimeStore.getState().loadDefaults();
    } catch {
      // Use defaults if settings can't be loaded
    }
  },

  saveSettings: (changes: Partial<AiConfig>) => {
    // Preserve invocation order, including two writes to the same key. Each
    // task merges into the state that exists WHEN it commits, so disjoint
    // concurrent changes cannot both start from one stale config snapshot.
    const task = settingsWriteQueue.then(async () => {
      if (changes.baseUrl !== undefined) {
        await ops.setSetting(AI_SETTINGS_KEYS.BASE_URL, changes.baseUrl);
      }
      if (changes.model !== undefined) {
        await ops.setSetting(AI_SETTINGS_KEYS.MODEL, changes.model);
      }
      if (changes.enabled !== undefined) {
        await ops.setSetting(AI_SETTINGS_KEYS.ENABLED, String(changes.enabled));
      }
      if (changes.provider !== undefined) {
        await ops.setSetting(AI_SETTINGS_KEYS.PROVIDER, changes.provider);
      }
      if (changes.localModel !== undefined) {
        await ops.setSetting(AI_SETTINGS_KEYS.LOCAL_MODEL, changes.localModel);
      }

      set((state) => ({ config: { ...state.config, ...changes } }));
      if (changes.baseUrl !== undefined || changes.provider !== undefined) {
        connectionCheckRequest += 1;
        set({ isConnected: false, availableModels: [], isLoading: false, error: null });
      }
    });
    settingsWriteQueue = task.catch(() => undefined);
    return task;
  },

  checkConnection: async () => {
    const request = ++connectionCheckRequest;
    const checked = get().config;
    set({ isLoading: true, error: null });
    const result = await testConnection(checked.baseUrl);
    const active = get().config;
    if (
      request !== connectionCheckRequest
      || active.baseUrl !== checked.baseUrl
      || active.provider !== checked.provider
    ) return;
    set({
      isConnected: result.connected,
      availableModels: result.models,
      isLoading: false,
      error: result.error || null,
    });
  },

  // ── Local provider (embedded Ollama, via the main process) ───────────────

  setProvider: async (provider) => {
    await get().saveSettings({ provider });
    if (provider === 'local') await get().refreshLocalStatus();
  },

  setLocalModel: async (tag) => {
    await get().saveSettings({ localModel: tag });
  },

  refreshLocalStatus: async () => {
    const request = ++localStatusRequest;
    const pushRevision = localStatusPushRevision;
    const api = window.electronAPI?.ollama;
    if (!api) {
      // Web build / no bridge: honest synthetic status, UI shows "no soportado".
      set({
        localStatus: {
          state: 'absent',
          supported: false,
          runtimeInstalled: false,
          url: null,
          models: [],
          pulling: null,
        },
      });
      return;
    }
    const status = await api.getStatus();
    if (request !== localStatusRequest || pushRevision !== localStatusPushRevision) return;
    set({ localStatus: status });
    // The ONE policy line: an installed runtime that isn't running yet gets
    // started in the background; the ollama:status push flips the UI.
    if (status.supported && status.runtimeInstalled && status.state === 'absent') {
      void api.start();
    }
  },

  downloadRuntime: async () => {
    const api = window.electronAPI?.ollama;
    if (!api) return;
    set({ runtimeProgress: { running: true, stage: 'downloading', progress: 0, error: null } });
    const res = await api.downloadRuntime();
    if (!res.ok && res.error && res.error !== 'cancelled' && res.error !== 'busy') {
      set({
        runtimeProgress: { running: false, stage: '', progress: 0, error: localErrorText(res.error) },
      });
    }
  },

  cancelRuntimeDownload: async () => {
    await window.electronAPI?.ollama?.cancelRuntimeDownload();
  },

  pullModel: async (tag) => {
    const api = window.electronAPI?.ollama;
    if (!api) return;
    set({
      pullProgress: { running: true, stage: 'preparing', progress: 0, error: null, tag, completedBytes: 0, totalBytes: 0 },
    });
    const res = await api.pullModel(tag);
    if (res.ok) {
      set({ pullProgress: { ...IDLE_PULL } });
      toast.success(t('settings.ai.local.pullDone').replace('{model}', tag));
      // Adopt the freshly pulled model when the current selection isn't
      // installed — the "one click and it works" path.
      const { config, localStatus } = get();
      const installed = new Set((localStatus?.models ?? []).map((m) => m.name));
      if (!installed.has(config.localModel)) {
        await get().setLocalModel(tag);
      }
      await get().refreshLocalStatus();
    } else if (res.error === 'cancelled') {
      set({ pullProgress: { ...IDLE_PULL } });
    } else if (res.error && res.error !== 'busy' && res.error !== 'already-pulling') {
      set({
        pullProgress: { ...IDLE_PULL, error: localErrorText(res.error), tag },
      });
    }
  },

  cancelPull: async (tag) => {
    await window.electronAPI?.ollama?.cancelPull(tag);
  },

  deleteModel: async (tag) => {
    const api = window.electronAPI?.ollama;
    if (!api) return;
    const res = await api.deleteModel(tag);
    if (res.ok) {
      toast.success(t('settings.ai.local.deleted').replace('{model}', tag));
      await get().refreshLocalStatus();
    } else if (res.error) {
      toast.error(localErrorText(res.error));
    }
  },
}));

// ── Push events from main ───────────────────────────────────────────────────
//
// Wired at MODULE scope: this runs once per page load and is therefore immune
// to StrictMode's mount/cleanup/remount of any component effect
// (tasks/lessons.md #19). The window-keyed guard keeps a dev HMR re-eval of
// this module from subscribing twice. Listeners live for the app's lifetime —
// exactly as long as main's ollama module does — so no unsubscribe is needed.

declare global {
  interface Window {
    __whOllamaWired?: boolean;
  }
}

const ollamaBridge = typeof window !== 'undefined' ? window.electronAPI?.ollama : undefined;
if (ollamaBridge && !window.__whOllamaWired) {
  window.__whOllamaWired = true;

  ollamaBridge.onStatus((status) => {
    localStatusPushRevision += 1;
    useAiStore.setState((prev) => ({
      localStatus: status,
      // A terminal state ends whatever progress was showing.
      runtimeProgress:
        status.state === 'running' || status.state === 'external'
          ? { ...IDLE_PROGRESS }
          : status.state === 'error'
            ? { running: false, stage: '', progress: 0, error: status.error ?? null }
            : prev.runtimeProgress,
    }));
  });

  ollamaBridge.onRuntimeProgress((p) => {
    useAiStore.setState({
      runtimeProgress: {
        running: true,
        stage: p.phase,
        progress:
          p.phase === 'downloading'
            ? p.totalBytes
              ? Math.min(p.receivedBytes / p.totalBytes, 1)
              : 0
            : p.phase === 'extracting'
              ? 0.9
              : 0.97,
        error: null,
      },
    });
  });

  ollamaBridge.onPullProgress((p) => {
    useAiStore.setState({
      pullProgress: {
        running: p.percent < 1,
        stage: p.status,
        progress: p.percent,
        error: null,
        tag: p.tag,
        completedBytes: p.completedBytes,
        totalBytes: p.totalBytes,
      },
    });
  });
}
