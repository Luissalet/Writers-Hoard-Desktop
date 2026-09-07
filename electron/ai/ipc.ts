// ============================================================================
// AI runtime — IPC surface (main process)
// ============================================================================
//
// Every channel here is declared for the 'main' role in electron/security.ts
// and mirrored in electron/preload.ts + src/electron-env.d.ts. Request bodies
// are validated for shape before they touch the gateway; secrets only ever
// travel renderer → main (setSecret) and never back.
//
// Streams: the renderer picks the request id and subscribes to the push
// channel BEFORE invoking, so no event can be lost to the invoke round trip.

import { ipcMain, type BrowserWindow } from 'electron';
import type {
  AiChatRequest,
  AiConnectionInput,
  AiDefaults,
  AiImageRequest,
  AiLoraSelection,
  AiRouteSelection,
} from '@/services/aiRuntime/types';
import { clampLoraWeight, isSdLoraName } from '@/services/aiRuntime/sdServer';
import {
  BUILTIN_SD_ID,
  deleteConnection,
  getDefaults,
  isLegacyMigrated,
  markLegacyMigrated,
  saveConnection,
  setBuiltinSdResolver,
  setDefault,
  setModelOverride,
  setSecret,
} from './connectionStore';
import {
  cancelSdCompanionDownload,
  cancelSdModelDownload,
  cancelSdRuntimeInstall,
  deleteSdCompanion,
  deleteSdModel,
  downloadSdCompanion,
  downloadSdModel,
  getSdRuntimeStatus,
  initSdRuntime,
  installSdRuntime,
  isSdRuntimeInstalled,
  removeSdRuntime,
  stopSdServer,
} from './sdRuntime';
import { sdBackendsFor, type SdBackend } from './sdRuntimeManifest';
import { detectHardware } from './hardware';
import {
  cancelRequest,
  complete,
  discoverLocalServers,
  invalidateModels,
  listConnections,
  listModels,
  probeConnection,
  startChat,
  startImageGeneration,
} from './inferenceGateway';
import {
  answerCopilotApproval,
  cancelCopilotRun,
  runCopilotTurn,
  type CopilotRunRequest,
} from './agentLoop';

type Assert = (event: Electron.IpcMainInvokeEvent, channel: string) => void;

const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRoute(value: unknown): AiRouteSelection | null {
  if (!isRecord(value)) return null;
  const { connectionId, modelId } = value;
  if (typeof connectionId !== 'string' || typeof modelId !== 'string') return null;
  if (!ID_RE.test(connectionId) || modelId.length > 200) return null;
  return { connectionId, modelId };
}

function asChatRequest(value: unknown): AiChatRequest | null {
  if (!isRecord(value)) return null;
  const route = asRoute(value);
  if (!route || !Array.isArray(value.messages)) return null;
  const messages = value.messages.filter(
    (m): m is AiChatRequest['messages'][number] =>
      isRecord(m) && typeof m.role === 'string' && typeof m.content === 'string',
  );
  return {
    connectionId: route.connectionId,
    modelId: route.modelId,
    messages,
    tools: Array.isArray(value.tools) ? (value.tools as AiChatRequest['tools']) : undefined,
    maxTokens: typeof value.maxTokens === 'number' ? value.maxTokens : undefined,
    temperature: typeof value.temperature === 'number' ? value.temperature : undefined,
    contextTokens: typeof value.contextTokens === 'number' ? value.contextTokens : undefined,
    disableThinking: typeof value.disableThinking === 'boolean' ? value.disableThinking : undefined,
    releaseAfter: value.releaseAfter === true ? true : undefined,
  };
}

/**
 * LoRAs the renderer asked for, bounded like every other new field (lesson #54):
 * at most four, each a name the server's prompt parser can round-trip and a
 * weight inside a sane range. Anything else is dropped, not corrected.
 */
function asLoras(value: unknown): AiLoraSelection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AiLoraSelection[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = item.name;
    if (!isSdLoraName(name)) continue;
    out.push({ name, weight: clampLoraWeight(item.weight) });
    if (out.length === 4) break;
  }
  return out.length ? out : undefined;
}

function asImageRequest(value: unknown): AiImageRequest | null {
  if (!isRecord(value)) return null;
  const route = asRoute(value);
  if (!route || typeof value.prompt !== 'string' || !value.prompt.trim()) return null;
  const dim = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(64, Math.min(4096, Math.round(v / 8) * 8)) : fallback;
  return {
    connectionId: route.connectionId,
    modelId: route.modelId,
    prompt: value.prompt.slice(0, 4000),
    negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt.slice(0, 2000) : undefined,
    width: dim(value.width, 1024),
    height: dim(value.height, 1024),
    n: typeof value.n === 'number' ? Math.max(1, Math.min(4, Math.floor(value.n))) : 1,
    seed: typeof value.seed === 'number' && Number.isFinite(value.seed) ? Math.floor(value.seed) : undefined,
    steps: typeof value.steps === 'number' ? Math.max(1, Math.min(150, Math.floor(value.steps))) : undefined,
    guidance: typeof value.guidance === 'number' ? value.guidance : undefined,
    quality: typeof value.quality === 'string' ? value.quality.slice(0, 20) : undefined,
    // img2img: a bounded image data URL and a clamped denoise strength. Anything
    // else falls through to plain txt2img (fail-closed).
    initImage:
      typeof value.initImage === 'string' &&
      value.initImage.startsWith('data:image/') &&
      value.initImage.length <= 32 * 1024 * 1024
        ? value.initImage
        : undefined,
    strength:
      typeof value.strength === 'number' && Number.isFinite(value.strength)
        ? Math.max(0, Math.min(1, value.strength))
        : undefined,
    loras: asLoras(value.loras),
  };
}

/** The record open inside the tab, when the renderer could name one. */
function asOpenDocument(value: unknown): CopilotRunRequest['briefing']['openDocument'] {
  if (!isRecord(value)) return null;
  if (typeof value.engineId !== 'string' || typeof value.id !== 'string') return null;
  if (!value.engineId || !value.id) return null;
  return {
    engineId: value.engineId,
    id: value.id,
    title: typeof value.title === 'string' ? value.title : undefined,
  };
}

function asCopilotRequest(value: unknown): CopilotRunRequest | null {
  if (!isRecord(value)) return null;
  const route = asRoute(value.route);
  if (!route) return null;
  if (typeof value.runId !== 'string' || !ID_RE.test(value.runId)) return null;
  if (typeof value.threadId !== 'string' || typeof value.projectId !== 'string') return null;
  if (typeof value.message !== 'string') return null;
  const policy = value.policy === 'read-only' || value.policy === 'allow' ? value.policy : 'ask';
  const briefing = isRecord(value.briefing) ? value.briefing : {};
  return {
    runId: value.runId,
    threadId: value.threadId,
    projectId: value.projectId,
    route,
    policy,
    briefing: {
      projectTitle: typeof briefing.projectTitle === 'string' ? briefing.projectTitle : 'Project',
      projectDescription: typeof briefing.projectDescription === 'string' ? briefing.projectDescription : undefined,
      editorialContext: typeof briefing.editorialContext === 'string' ? briefing.editorialContext.slice(0, 16000) : undefined,
      projectMode: typeof briefing.projectMode === 'string' ? briefing.projectMode : undefined,
      enabledEngines: Array.isArray(briefing.enabledEngines) ? briefing.enabledEngines.filter((e): e is string => typeof e === 'string') : [],
      openEngine: typeof briefing.openEngine === 'string' ? briefing.openEngine : null,
      openDocument: asOpenDocument(briefing.openDocument),
      locale: typeof briefing.locale === 'string' ? briefing.locale : 'es',
    },
    history: Array.isArray(value.history)
      ? value.history.filter((m): m is CopilotRunRequest['history'][number] => isRecord(m) && typeof m.role === 'string' && typeof m.content === 'string')
      : [],
    message: value.message,
    usedTools: Array.isArray(value.usedTools) ? value.usedTools.filter((t): t is string => typeof t === 'string') : [],
    toolsMode: value.toolsMode === 'off' ? 'off' : 'auto',
    maxTools: typeof value.maxTools === 'number' ? value.maxTools : undefined,
    contextTokens: typeof value.contextTokens === 'number' ? value.contextTokens : undefined,
  };
}

export interface AiIpcDeps {
  assertIpcSender: Assert;
  /** The main window, when it exists — where push events go. */
  window: () => BrowserWindow | null;
}

export function registerAiIpc({ assertIpcSender, window }: AiIpcDeps): void {
  const push = (channel: string, payload: unknown): void => {
    const win = window();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  initSdRuntime(push);
  setBuiltinSdResolver(isSdRuntimeInstalled);

  // ---- connections ---------------------------------------------------------
  ipcMain.handle('ai:listConnections', (event) => {
    assertIpcSender(event, 'ai:listConnections');
    return listConnections();
  });
  ipcMain.handle('ai:saveConnection', async (event, input: unknown) => {
    assertIpcSender(event, 'ai:saveConnection');
    if (!isRecord(input) || typeof input.name !== 'string' || typeof input.baseUrl !== 'string') {
      return { ok: false, code: 'bad-url', error: 'Invalid connection.' };
    }
    // Every kind a user can create has to survive this line. It used to
    // collapse anything unrecognised to openai-compatible, which silently
    // turned a ComfyUI connection into one that talks the wrong protocol to
    // the right port and fails with a confusing error.
    const kind = input.kind === 'ollama' ? 'ollama'
      : input.kind === 'comfyui' ? 'comfyui'
      : 'openai-compatible';
    const result = await saveConnection({
      id: typeof input.id === 'string' ? input.id : undefined,
      name: input.name,
      kind,
      baseUrl: input.baseUrl,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
      modelTypes: Array.isArray(input.modelTypes)
        ? input.modelTypes.filter((t): t is 'chat' | 'image' => t === 'chat' || t === 'image')
        : undefined,
      pinnedModels: Array.isArray(input.pinnedModels) ? input.pinnedModels.filter((m): m is string => typeof m === 'string') : undefined,
      allowInsecureRemote: typeof input.allowInsecureRemote === 'boolean' ? input.allowInsecureRemote : undefined,
    } satisfies AiConnectionInput);
    if (result.ok) invalidateModels(result.connection.id);
    return result;
  });
  ipcMain.handle('ai:deleteConnection', async (event, id: unknown) => {
    assertIpcSender(event, 'ai:deleteConnection');
    if (typeof id !== 'string') return false;
    invalidateModels(id);
    return deleteConnection(id);
  });
  ipcMain.handle('ai:setSecret', (event, payload: unknown) => {
    assertIpcSender(event, 'ai:setSecret');
    if (!isRecord(payload) || typeof payload.id !== 'string') {
      return { ok: false, code: 'not-found', error: 'Invalid request.' };
    }
    return setSecret(payload.id, typeof payload.secret === 'string' ? payload.secret : '');
  });
  ipcMain.handle('ai:probe', (event, id: unknown) => {
    assertIpcSender(event, 'ai:probe');
    if (typeof id !== 'string') return { ok: false, code: 'no-connection', error: 'Invalid id.' };
    return probeConnection(id);
  });
  ipcMain.handle('ai:listModels', async (event, payload: unknown) => {
    assertIpcSender(event, 'ai:listModels');
    if (!isRecord(payload) || typeof payload.connectionId !== 'string') {
      return { ok: false, code: 'no-connection', error: 'Invalid request.', models: [] };
    }
    try {
      return { ok: true, models: await listModels(payload.connectionId, payload.refresh === true) };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { ok: false, code: e.code ?? 'unreachable', error: e.message ?? String(err), models: [] };
    }
  });
  ipcMain.handle('ai:discoverLocal', (event) => {
    assertIpcSender(event, 'ai:discoverLocal');
    return discoverLocalServers();
  });
  ipcMain.handle('ai:hardware', (event, force: unknown) => {
    assertIpcSender(event, 'ai:hardware');
    return detectHardware(force === true);
  });
  ipcMain.handle('ai:getDefaults', (event) => {
    assertIpcSender(event, 'ai:getDefaults');
    return getDefaults();
  });
  ipcMain.handle('ai:setDefault', (event, payload: unknown): Promise<AiDefaults> => {
    assertIpcSender(event, 'ai:setDefault');
    if (!isRecord(payload) || (payload.kind !== 'chat' && payload.kind !== 'image')) return getDefaults();
    return setDefault(payload.kind, asRoute(payload.route));
  });
  ipcMain.handle('ai:setModelOverride', async (event, payload: unknown) => {
    assertIpcSender(event, 'ai:setModelOverride');
    if (!isRecord(payload) || typeof payload.connectionId !== 'string' || typeof payload.modelId !== 'string') return;
    const override = isRecord(payload.override)
      ? {
          tools: typeof payload.override.tools === 'boolean' ? payload.override.tools : undefined,
          vision: typeof payload.override.vision === 'boolean' ? payload.override.vision : undefined,
          image: typeof payload.override.image === 'boolean' ? payload.override.image : undefined,
        }
      : null;
    await setModelOverride(`${payload.connectionId}::${payload.modelId}`, override);
    invalidateModels(payload.connectionId);
  });
  ipcMain.handle('ai:legacyMigrated', async (event, mark: unknown) => {
    assertIpcSender(event, 'ai:legacyMigrated');
    if (mark === true) await markLegacyMigrated();
    return isLegacyMigrated();
  });

  // ---- inference -----------------------------------------------------------
  ipcMain.handle('ai:chat', (event, payload: unknown) => {
    assertIpcSender(event, 'ai:chat');
    if (!isRecord(payload) || typeof payload.requestId !== 'string' || !ID_RE.test(payload.requestId)) {
      return { ok: false, error: 'Invalid request id.' };
    }
    const request = asChatRequest(payload.request);
    const requestId = payload.requestId;
    if (!request) {
      push('ai:stream', { requestId, event: { type: 'error', code: 'bad-request', message: 'Invalid chat request.' } });
      return { ok: false, error: 'Invalid chat request.' };
    }
    startChat(request, (streamEvent) => push('ai:stream', { requestId, event: streamEvent }), requestId);
    return { ok: true, requestId };
  });
  ipcMain.handle('ai:complete', (event, payload: unknown) => {
    assertIpcSender(event, 'ai:complete');
    const request = asChatRequest(payload);
    if (!request) return { ok: false, code: 'bad-request', error: 'Invalid chat request.' };
    return complete(request);
  });
  ipcMain.handle('ai:cancel', (event, requestId: unknown) => {
    assertIpcSender(event, 'ai:cancel');
    return typeof requestId === 'string' ? cancelRequest(requestId) : false;
  });
  ipcMain.handle('ai:generateImage', (event, payload: unknown) => {
    assertIpcSender(event, 'ai:generateImage');
    if (!isRecord(payload) || typeof payload.requestId !== 'string' || !ID_RE.test(payload.requestId)) {
      return { ok: false, error: 'Invalid request id.' };
    }
    const request = asImageRequest(payload.request);
    const requestId = payload.requestId;
    if (!request) return { ok: false, error: 'Invalid image request.' };
    startImageGeneration(request, (result) => push('ai:image-done', { requestId, result }), requestId);
    return { ok: true, requestId };
  });

  // ---- local image runtime -------------------------------------------------
  const SD_ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
  ipcMain.handle('sd:status', (event) => {
    assertIpcSender(event, 'sd:status');
    return getSdRuntimeStatus();
  });
  ipcMain.handle('sd:installRuntime', async (event, backend: unknown) => {
    assertIpcSender(event, 'sd:installRuntime');
    const wanted = typeof backend === 'string' && (sdBackendsFor() as string[]).includes(backend) ? (backend as SdBackend) : sdBackendsFor()[0];
    if (!wanted) return { ok: false, error: 'unsupported-platform' };
    const result = await installSdRuntime(wanted);
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  ipcMain.handle('sd:cancelInstall', (event) => {
    assertIpcSender(event, 'sd:cancelInstall');
    cancelSdRuntimeInstall();
  });
  ipcMain.handle('sd:removeRuntime', async (event) => {
    assertIpcSender(event, 'sd:removeRuntime');
    const result = await removeSdRuntime();
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  ipcMain.handle('sd:downloadModel', async (event, id: unknown) => {
    assertIpcSender(event, 'sd:downloadModel');
    if (typeof id !== 'string' || !SD_ID_RE.test(id)) return { ok: false, error: 'unknown-model' };
    const result = await downloadSdModel(id);
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  ipcMain.handle('sd:cancelDownload', (event, id: unknown) => {
    assertIpcSender(event, 'sd:cancelDownload');
    if (typeof id === 'string') cancelSdModelDownload(id);
  });
  ipcMain.handle('sd:deleteModel', async (event, id: unknown) => {
    assertIpcSender(event, 'sd:deleteModel');
    if (typeof id !== 'string' || !SD_ID_RE.test(id)) return { ok: false, error: 'unknown-model' };
    const result = await deleteSdModel(id);
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  // Companions — a ControlNet or an ESRGAN. They are pinned, downloaded and
  // deleted exactly as a model is, and share its id shape, because they are
  // the same kind of asset: a file the app fetches by digest into a folder it
  // owns. The only difference is that a request never names one — the server
  // is LAUNCHED with it — which is why installing one can cost a restart.
  ipcMain.handle('sd:downloadCompanion', async (event, id: unknown) => {
    assertIpcSender(event, 'sd:downloadCompanion');
    if (typeof id !== 'string' || !SD_ID_RE.test(id)) return { ok: false, error: 'unknown-companion' };
    const result = await downloadSdCompanion(id);
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  ipcMain.handle('sd:cancelCompanionDownload', (event, id: unknown) => {
    assertIpcSender(event, 'sd:cancelCompanionDownload');
    if (typeof id === 'string') cancelSdCompanionDownload(id);
  });
  ipcMain.handle('sd:deleteCompanion', async (event, id: unknown) => {
    assertIpcSender(event, 'sd:deleteCompanion');
    if (typeof id !== 'string' || !SD_ID_RE.test(id)) return { ok: false, error: 'unknown-companion' };
    const result = await deleteSdCompanion(id);
    invalidateModels(BUILTIN_SD_ID);
    return result;
  });
  ipcMain.handle('sd:stop', async (event) => {
    assertIpcSender(event, 'sd:stop');
    await stopSdServer();
    return getSdRuntimeStatus();
  });

  // ---- copilot -------------------------------------------------------------
  ipcMain.handle('copilot:run', (event, payload: unknown) => {
    assertIpcSender(event, 'copilot:run');
    const request = asCopilotRequest(payload);
    if (!request) return { ok: false, error: 'Invalid copilot request.' };
    void runCopilotTurn(request, (copilotEvent) => push('copilot:event', { runId: request.runId, event: copilotEvent }));
    return { ok: true, runId: request.runId };
  });
  ipcMain.handle('copilot:cancel', (event, runId: unknown) => {
    assertIpcSender(event, 'copilot:cancel');
    return typeof runId === 'string' ? cancelCopilotRun(runId) : false;
  });
  ipcMain.handle('copilot:approve', (event, payload: unknown) => {
    assertIpcSender(event, 'copilot:approve');
    if (!isRecord(payload) || typeof payload.runId !== 'string' || typeof payload.callId !== 'string') return false;
    return answerCopilotApproval(payload.runId, payload.callId, payload.approved === true);
  });
}
