// ============================================================================
// AI runtime store — connections, models, hardware and defaults (renderer)
// ============================================================================
//
// A thin cache over the main-process gateway for the settings page, the
// copilot's model picker and the image studio. Nothing here talks HTTP; every
// action is an IPC call by connection id.

import { create } from 'zustand';
import type {
  AiConnectionInput,
  AiConnectionSummary,
  AiDefaults,
  AiDiscoveredServer,
  AiModelDescriptor,
  AiProbeResult,
  AiRouteSelection,
  HardwareProfile,
} from '@/services/aiRuntime/types';
import { aiApi } from '@/services/aiRuntime/client';
import { BUILTIN_OLLAMA_ID } from '@/services/aiRuntime/constants';

interface ModelsState {
  models: AiModelDescriptor[];
  loading: boolean;
  error: string | null;
  code?: string;
  loadedAt: number;
}

interface AiRuntimeState {
  available: boolean;
  connections: AiConnectionSummary[];
  connectionsLoaded: boolean;
  modelsByConnection: Record<string, ModelsState>;
  hardware: HardwareProfile | null;
  defaults: AiDefaults;
  discovering: boolean;
  discovered: AiDiscoveredServer[];

  loadConnections: () => Promise<void>;
  saveConnection: (input: AiConnectionInput) => Promise<{ ok: true; connection: AiConnectionSummary } | { ok: false; code: string; error: string }>;
  deleteConnection: (id: string) => Promise<void>;
  setSecret: (id: string, secret: string) => Promise<{ ok: boolean; error?: string }>;
  probe: (id: string) => Promise<AiProbeResult>;
  loadModels: (connectionId: string, refresh?: boolean) => Promise<AiModelDescriptor[]>;
  loadHardware: (force?: boolean) => Promise<void>;
  loadDefaults: () => Promise<void>;
  setDefault: (kind: 'chat' | 'image', route: AiRouteSelection | null) => Promise<void>;
  setModelOverride: (connectionId: string, modelId: string, override: { tools?: boolean; vision?: boolean; image?: boolean } | null) => Promise<void>;
  discoverLocal: () => Promise<AiDiscoveredServer[]>;
}

const EMPTY_MODELS: ModelsState = { models: [], loading: false, error: null, loadedAt: 0 };

export const useAiRuntimeStore = create<AiRuntimeState>((set, get) => ({
  available: aiApi() !== null,
  connections: [],
  connectionsLoaded: false,
  modelsByConnection: {},
  hardware: null,
  defaults: {},
  discovering: false,
  discovered: [],

  loadConnections: async () => {
    const api = aiApi();
    if (!api) {
      set({ connections: [], connectionsLoaded: true });
      return;
    }
    const connections = await api.listConnections();
    set({ connections, connectionsLoaded: true });
  },

  saveConnection: async (input) => {
    const api = aiApi();
    if (!api) return { ok: false, code: 'unavailable', error: 'desktop only' };
    const result = await api.saveConnection(input);
    if (result.ok) await get().loadConnections();
    return result;
  },

  deleteConnection: async (id) => {
    const api = aiApi();
    if (!api) return;
    await api.deleteConnection(id);
    set((s) => {
      const next = { ...s.modelsByConnection };
      delete next[id];
      return { modelsByConnection: next };
    });
    await Promise.all([get().loadConnections(), get().loadDefaults()]);
  },

  setSecret: async (id, secret) => {
    const api = aiApi();
    if (!api) return { ok: false, error: 'desktop only' };
    const result = await api.setSecret(id, secret);
    if (result.ok) await get().loadConnections();
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  probe: async (id) => {
    const api = aiApi();
    if (!api) return { ok: false, code: 'unreachable', error: 'desktop only' };
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, status: 'loading' } : c)),
    }));
    const result = await api.probe(id);
    if (result.ok && result.models) {
      set((s) => ({
        modelsByConnection: {
          ...s.modelsByConnection,
          [id]: { models: result.models ?? [], loading: false, error: null, loadedAt: Date.now() },
        },
      }));
    }
    await get().loadConnections();
    return result;
  },

  loadModels: async (connectionId, refresh = false) => {
    const api = aiApi();
    if (!api) return [];
    const current = get().modelsByConnection[connectionId] ?? EMPTY_MODELS;
    if (!refresh && current.loadedAt && Date.now() - current.loadedAt < 60_000) return current.models;
    set((s) => ({
      modelsByConnection: { ...s.modelsByConnection, [connectionId]: { ...current, loading: true, error: null } },
    }));
    const result = await api.listModels(connectionId, refresh);
    set((s) => ({
      modelsByConnection: {
        ...s.modelsByConnection,
        [connectionId]: {
          models: result.ok ? result.models : current.models,
          loading: false,
          error: result.ok ? null : result.error ?? 'error',
          code: result.ok ? undefined : result.code,
          loadedAt: result.ok ? Date.now() : current.loadedAt,
        },
      },
      // Fold the probe's status into the row IN PLACE. Re-listing connections
      // here handed every effect keyed on `connections` a fresh array, and one
      // of them called loadModels again: an IPC storm that starved the
      // renderer of resources until a reload failed (2026-08-31).
      connections: s.connections.map((c) =>
        c.id === connectionId
          ? {
              ...c,
              // Mirror the gateway's own bookkeeping so the row never says
              // "untested" next to a fresh error.
              status: result.ok ? 'online' : result.code === 'unreachable' || result.code === 'timeout' ? 'offline' : 'error',
              lastError: result.ok ? undefined : result.error,
            }
          : c,
      ),
    }));
    return result.ok ? result.models : current.models;
  },

  loadHardware: async (force = false) => {
    const api = aiApi();
    if (!api) return;
    if (!force && get().hardware) return;
    set({ hardware: await api.hardware(force) });
  },

  loadDefaults: async () => {
    const api = aiApi();
    if (!api) return;
    set({ defaults: await api.getDefaults() });
  },

  setDefault: async (kind, route) => {
    const api = aiApi();
    if (!api) return;
    set({ defaults: await api.setDefault(kind, route) });
  },

  setModelOverride: async (connectionId, modelId, override) => {
    const api = aiApi();
    if (!api) return;
    await api.setModelOverride(connectionId, modelId, override);
    await get().loadModels(connectionId, true);
  },

  discoverLocal: async () => {
    const api = aiApi();
    if (!api) return [];
    set({ discovering: true });
    try {
      const discovered = await api.discoverLocal();
      set({ discovered });
      return discovered;
    } finally {
      set({ discovering: false });
    }
  },
}));

/** All chat-capable models across enabled connections, for pickers. */
export function selectChatModels(state: AiRuntimeState): Array<{ connection: AiConnectionSummary; model: AiModelDescriptor }> {
  const out: Array<{ connection: AiConnectionSummary; model: AiModelDescriptor }> = [];
  for (const connection of state.connections) {
    if (!connection.enabled) continue;
    for (const model of state.modelsByConnection[connection.id]?.models ?? []) {
      if (model.type === 'chat') out.push({ connection, model });
    }
  }
  return out;
}

export function selectImageModels(state: AiRuntimeState): Array<{ connection: AiConnectionSummary; model: AiModelDescriptor }> {
  const out: Array<{ connection: AiConnectionSummary; model: AiModelDescriptor }> = [];
  for (const connection of state.connections) {
    if (!connection.enabled) continue;
    for (const model of state.modelsByConnection[connection.id]?.models ?? []) {
      if (model.type === 'image') out.push({ connection, model });
    }
  }
  return out;
}

export function findConnection(state: AiRuntimeState, id: string | undefined): AiConnectionSummary | undefined {
  return id ? state.connections.find((c) => c.id === id) : undefined;
}

export { BUILTIN_OLLAMA_ID };
