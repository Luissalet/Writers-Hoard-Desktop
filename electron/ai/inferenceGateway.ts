// ============================================================================
// AI runtime — inference gateway (main process)
// ============================================================================
//
// The only place in the app that talks to a model server. The renderer hands
// it a connection ID and a model ID, never a URL and never a key; it resolves
// the adapter, enforces the transport policy, keeps a short model cache per
// connection, tracks every in-flight request so it can be cancelled (and is
// aborted on quit), and normalises errors into codes the UI can translate.

import type {
  AiChatRequest,
  AiCompleteResult,
  AiConnectionSummary,
  AiDiscoveredServer,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiProbeResult,
  AiStreamEvent,
} from '@/services/aiRuntime/types';
import {
  LOCAL_DETECT_TARGETS,
  isTransportAcceptable,
  normaliseBaseUrl,
  sameServer,
} from '@/services/aiRuntime/urlPolicy';
import { catalogEntry } from '@/services/aiRuntime/catalog';
import { startOllama } from '../ollama';
import {
  BUILTIN_OLLAMA_ID,
  BUILTIN_SD_ID,
  getConnection,
  getModelOverrides,
  getSecret,
  listConnections as listStoredConnections,
} from './connectionStore';
import { ollamaAdapter } from './adapters/ollama';
import { openAiCompatibleAdapter } from './adapters/openAiCompatible';
import { sdcppAdapter } from './adapters/sdcpp';
import { getAllModelMetrics, recordModelUsage } from './modelMetrics';
import { invalidateVramReport } from './vramRoom';
import type { AdapterContext, ProviderAdapter } from './adapters/types';
import { AdapterError } from './adapters/http';

const MODEL_CACHE_MS = 60_000;
const CHAT_HARD_LIMIT_MS = 15 * 60_000;

interface StatusRecord {
  status: AiConnectionSummary['status'];
  latencyMs?: number;
  lastCheckedAt: number;
  lastError?: string;
}

const modelCache = new Map<string, { at: number; models: AiModelDescriptor[] }>();
const statusCache = new Map<string, StatusRecord>();
const inFlight = new Map<string, { controller: AbortController; kind: 'chat' | 'image' | 'probe' }>();
let sequence = 0;

function adapterFor(connection: AiConnectionSummary): ProviderAdapter {
  if (connection.kind === 'sdcpp') return sdcppAdapter;
  return connection.kind === 'ollama' ? ollamaAdapter : openAiCompatibleAdapter;
}

function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
}

async function resolveContext(connectionId: string): Promise<AdapterContext> {
  const connection = await getConnection(connectionId);
  if (!connection) throw new AdapterError('no-connection', `No connection "${connectionId}". Add one in AI settings.`);
  if (!connection.enabled) throw new AdapterError('connection-disabled', `Connection "${connection.name}" is switched off.`);
  // The managed image server is loopback by construction and starts on demand.
  if (connection.id === BUILTIN_SD_ID) return { connection, secret: null };
  const normalised = normaliseBaseUrl(connection.baseUrl);
  if (!normalised.ok) throw new AdapterError('policy', `Connection "${connection.name}" has an invalid address.`);
  if (!isTransportAcceptable(normalised, connection.allowInsecureRemote)) {
    throw new AdapterError(
      'policy',
      `Connection "${connection.name}" uses plain HTTP to a remote host. Use https, or allow insecure remote HTTP for it in AI settings.`,
    );
  }
  if (connection.id === BUILTIN_OLLAMA_ID) {
    const started = await startOllama();
    if (!started.ok) {
      throw new AdapterError(
        started.error === 'runtime-missing' ? 'unreachable' : 'unreachable',
        started.error === 'runtime-missing'
          ? 'The local AI runtime is not installed. Download it in AI settings → Local models.'
          : `The local AI runtime is not running (${started.error ?? 'unknown'}).`,
      );
    }
    // The base URL may have been resolved by the start; re-read it.
    const fresh = await getConnection(connectionId);
    if (fresh) return { connection: fresh, secret: null };
  }
  return { connection, secret: await getSecret(connectionId) };
}

function noteStatus(id: string, record: Partial<StatusRecord> & { status: StatusRecord['status'] }): void {
  statusCache.set(id, { ...statusCache.get(id), ...record, lastCheckedAt: Date.now() });
}

/** Connections with their last known status folded in. */
export async function listConnections(): Promise<AiConnectionSummary[]> {
  const rows = await listStoredConnections();
  return rows.map((row) => {
    const cached = statusCache.get(row.id);
    return cached ? { ...row, ...cached } : row;
  });
}

export async function probeConnection(connectionId: string): Promise<AiProbeResult> {
  const controller = new AbortController();
  const id = newRequestId('probe');
  inFlight.set(id, { controller, kind: 'probe' });
  noteStatus(connectionId, { status: 'loading' });
  try {
    const ctx = await resolveContext(connectionId);
    const result = await adapterFor(ctx.connection).probe(ctx, controller.signal);
    if (result.ok) {
      noteStatus(connectionId, { status: 'online', latencyMs: result.latencyMs, lastError: undefined });
      if (result.models) modelCache.set(connectionId, { at: Date.now(), models: await decorate(connectionId, result.models) });
    } else {
      noteStatus(connectionId, { status: result.code === 'unreachable' || result.code === 'timeout' ? 'offline' : 'error', latencyMs: result.latencyMs, lastError: result.error });
    }
    return result;
  } catch (err) {
    const e = err instanceof AdapterError ? err : new AdapterError('unreachable', String(err));
    noteStatus(connectionId, { status: e.code === 'unreachable' || e.code === 'timeout' ? 'offline' : 'error', lastError: e.message });
    return { ok: false, code: e.code, error: e.message };
  } finally {
    inFlight.delete(id);
  }
}

/** Pinned models, hand-set capability overrides and measured speed folded into a list. */
async function decorate(connectionId: string, models: AiModelDescriptor[]): Promise<AiModelDescriptor[]> {
  const connection = await getConnection(connectionId);
  const overrides = await getModelOverrides();
  const metrics = await getAllModelMetrics();
  const out = [...models];
  const seen = new Set(out.map((m) => m.id));
  for (const pinned of connection?.pinnedModels ?? []) {
    if (seen.has(pinned)) continue;
    seen.add(pinned);
    const type = /dall-e|gpt-image|stable|sdxl|flux|diffusion|imagen/i.test(pinned) ? 'image' : 'chat';
    out.push({
      connectionId,
      id: pinned,
      type,
      capabilities: type === 'image' ? ['image-generation'] : ['chat', 'streaming', 'tools'],
      pinned: true,
    });
  }
  return out.map((model) => {
    const metric = metrics[`${connectionId}::${model.id}`];
    if (metric) {
      model = { ...model, measuredTokensPerSecond: metric.tokensPerSecond, measuredAt: metric.lastAt };
    }
    const override = overrides[`${connectionId}::${model.id}`];
    if (!override) return withCatalogFacts(model);
    const caps = new Set(model.capabilities);
    if (override.tools === true) caps.add('tools');
    if (override.tools === false) caps.delete('tools');
    if (override.vision === true) caps.add('vision');
    if (override.vision === false) caps.delete('vision');
    let type = model.type;
    if (override.image === true) {
      type = 'image';
      caps.add('image-generation');
    }
    return withCatalogFacts({ ...model, type, capabilities: [...caps] });
  });
}

/** Installed Ollama models gain the catalogue's layer/MoE facts for the fit. */
function withCatalogFacts(model: AiModelDescriptor): AiModelDescriptor {
  const entry = catalogEntry(model.id);
  if (!entry) return model;
  return {
    ...model,
    parameterCountB: model.parameterCountB ?? entry.paramsB,
    activeParameterCountB: model.activeParameterCountB ?? entry.activeParamsB,
    contextWindow: model.contextWindow ?? entry.contextWindow,
    family: model.family ?? entry.family,
  };
}

export async function listModels(connectionId: string, refresh = false): Promise<AiModelDescriptor[]> {
  const cached = modelCache.get(connectionId);
  if (!refresh && cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.models;
  const controller = new AbortController();
  const id = newRequestId('models');
  inFlight.set(id, { controller, kind: 'probe' });
  try {
    const ctx = await resolveContext(connectionId);
    const models = await decorate(connectionId, await adapterFor(ctx.connection).listModels(ctx, controller.signal));
    modelCache.set(connectionId, { at: Date.now(), models });
    noteStatus(connectionId, { status: 'online', lastError: undefined });
    return models;
  } catch (err) {
    const e = err instanceof AdapterError ? err : new AdapterError('unreachable', String(err));
    noteStatus(connectionId, { status: e.code === 'unreachable' || e.code === 'timeout' ? 'offline' : 'error', lastError: e.message });
    // A server without /models still has whatever the user pinned.
    if (e.code === 'bad-request' && e.status === 404) {
      const models = await decorate(connectionId, []);
      modelCache.set(connectionId, { at: Date.now(), models });
      return models;
    }
    if (cached) return cached.models;
    throw e;
  } finally {
    inFlight.delete(id);
  }
}

export function invalidateModels(connectionId?: string): void {
  if (connectionId) modelCache.delete(connectionId);
  else modelCache.clear();
}

/**
 * Start a streaming chat. Events go to `sink`; the returned id cancels it.
 * Never throws: setup failures arrive as an `error` event too, so the caller
 * has exactly one path to handle.
 */
export function startChat(
  request: AiChatRequest,
  sink: (event: AiStreamEvent) => void,
  requestId?: string,
): string {
  const id = requestId && !inFlight.has(requestId) ? requestId : newRequestId('chat');
  const controller = new AbortController();
  inFlight.set(id, { controller, kind: 'chat' });
  let hitHardLimit = false;
  const hardStop = setTimeout(() => {
    hitHardLimit = true;
    controller.abort('timeout');
  }, CHAT_HARD_LIMIT_MS);
  const hardLimitEvent = (): AiStreamEvent => ({
    type: 'error',
    code: 'timeout',
    message: 'The answer ran past the 15-minute limit and was stopped.',
  });
  // Every finished answer teaches the fit badge how fast this model really is.
  const measuringSink = (event: AiStreamEvent): void => {
    if (event.type === 'usage' && event.usage.tokensPerSecond) {
      void recordModelUsage(request.connectionId, request.modelId, event.usage).then(() => invalidateModels(request.connectionId));
    }
    // The adapter reports any abort as a cancel; only the user's Stop is one.
    sink(hitHardLimit && event.type === 'cancelled' ? hardLimitEvent() : event);
  };
  void (async () => {
    try {
      const ctx = await resolveContext(request.connectionId);
      await adapterFor(ctx.connection).chat(ctx, request, measuringSink, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        sink(hitHardLimit ? hardLimitEvent() : { type: 'cancelled' });
      } else {
        const e = err instanceof AdapterError ? err : new AdapterError('unreachable', String(err));
        sink({ type: 'error', code: e.code, message: e.message });
      }
    } finally {
      clearTimeout(hardStop);
      inFlight.delete(id);
      // `releaseAfter` asked the server to drop the model the moment this answer
      // ended (keep_alive 0), so whatever was measured about GPU memory is now
      // out of date — including the reading the image studio's contention
      // warning is drawn from.
      if (request.releaseAfter) invalidateVramReport();
    }
  })();
  return id;
}

/** One-shot completion for the classic features (summary, characters…). */
export function complete(request: AiChatRequest): Promise<AiCompleteResult> {
  return new Promise((resolve) => {
    let content = '';
    let usage: AiCompleteResult['usage'];
    let settled = false;
    const finish = (result: AiCompleteResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    startChat({ ...request, tools: undefined }, (event) => {
      switch (event.type) {
        case 'delta':
          content += event.text;
          break;
        case 'usage':
          usage = event.usage;
          break;
        case 'done':
          finish({ ok: true, content, usage });
          break;
        case 'cancelled':
          finish({ ok: false, code: 'cancelled', error: 'Cancelled.' });
          break;
        case 'error':
          finish({ ok: false, code: event.code, error: event.message });
          break;
        default:
          break;
      }
    });
  });
}

export function cancelRequest(requestId: string): boolean {
  const entry = inFlight.get(requestId);
  if (!entry) return false;
  entry.controller.abort('cancelled');
  return true;
}

// ---------------------------------------------------------------------------
// Images — one job at a time; a local diffusion server is one GPU
// ---------------------------------------------------------------------------

let imageQueue: Promise<unknown> = Promise.resolve();

export function startImageGeneration(
  request: AiImageRequest,
  done: (result: AiImageResult) => void,
  requestId?: string,
): string {
  const id = requestId && !inFlight.has(requestId) ? requestId : newRequestId('image');
  const controller = new AbortController();
  inFlight.set(id, { controller, kind: 'image' });
  const job = imageQueue.then(async (): Promise<AiImageResult> => {
    if (controller.signal.aborted) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    try {
      const ctx = await resolveContext(request.connectionId);
      const adapter = adapterFor(ctx.connection);
      if (!adapter.generateImage) {
        return { ok: false, code: 'bad-request', error: `Connection "${ctx.connection.name}" (${ctx.connection.kind}) cannot generate images. Use an OpenAI-compatible image server.` };
      }
      return await adapter.generateImage(ctx, request, controller.signal);
    } catch (err) {
      const e = err instanceof AdapterError ? err : new AdapterError('unreachable', String(err));
      return { ok: false, code: controller.signal.aborted ? 'cancelled' : e.code, error: e.message };
    }
  });
  imageQueue = job.then(
    () => undefined,
    () => undefined,
  );
  void job.then((result) => {
    inFlight.delete(id);
    done(result);
  });
  return id;
}

// ---------------------------------------------------------------------------
// Discovery — a manual, loopback-only sweep of well-known ports
// ---------------------------------------------------------------------------

export async function discoverLocalServers(): Promise<AiDiscoveredServer[]> {
  const known = await listStoredConnections();
  const results = await Promise.all(
    LOCAL_DETECT_TARGETS.map(async (target): Promise<AiDiscoveredServer | null> => {
      const baseUrl = `http://127.0.0.1:${target.port}`;
      const connection: AiConnectionSummary = {
        id: `probe-${target.port}`,
        name: target.label,
        kind: target.kind,
        baseUrl,
        enabled: true,
        hasSecret: false,
        locality: 'loopback',
        modelTypes: ['chat'],
        pinnedModels: [],
        status: 'unknown',
        createdAt: 0,
        updatedAt: 0,
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), 2500);
      try {
        const result = await adapterFor(connection).probe({ connection, secret: null }, controller.signal);
        if (!result.ok || result.modelsRouteMissing) return null;
        return {
          kind: target.kind,
          baseUrl,
          label: target.label,
          latencyMs: result.latencyMs ?? 0,
          modelCount: result.models?.length ?? 0,
          known: known.some((c) => sameServer(c.baseUrl, baseUrl)),
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.filter((r): r is AiDiscoveredServer => r !== null);
}

/** will-quit: nothing keeps streaming into a window that is gone. */
export function shutdownGateway(): void {
  for (const { controller } of inFlight.values()) controller.abort('shutdown');
  inFlight.clear();
}

export function inFlightCount(kind?: 'chat' | 'image' | 'probe'): number {
  if (!kind) return inFlight.size;
  let count = 0;
  for (const entry of inFlight.values()) if (entry.kind === kind) count += 1;
  return count;
}
