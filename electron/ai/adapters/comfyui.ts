// ============================================================================
// AI adapter — ComfyUI, the user's own install (main process)
// ============================================================================
//
// The Bench. Image generation only, over ComfyUI's legacy HTTP + WebSocket
// API, which every install speaks with nothing extra installed. Everything
// interesting — resolving bindings, pruning the occurrences a recipe does not
// use, checking that the node packs a template needs are present — lives in
// `src/services/aiRuntime/comfy` where it is pure and testable; this file is
// the wiring: Electron's `net.fetch`, a WebSocket when the runtime has one,
// the template assets, and the mapping from an `AiImageRequest` onto a recipe.

import { createHash } from 'node:crypto';
import { net } from 'electron';
import type {
  AiChatRequest,
  AiConnectionSummary,
  AiGeneratedImage,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiProbeResult,
  AiStreamEvent,
} from '@/services/aiRuntime/types';
import {
  ComfyError,
  bytesToBase64,
  checkTemplate,
  chooseTemplateId,
  comfySamplerName,
  comfySchedulerName,
  createComfyClient,
  createTemplateRegistry,
  extensionFor,
  intentFromRequest,
  listCheckpoints,
  listControlNets,
  listDetectors,
  listLoras,
  listSamplers,
  listSchedulers,
  listUpscaleModels,
  missingModelMessage,
  parseDataUrl,
  planSubmission,
  readComfyExtras,
  type ComfyClient,
  type ComfyObjectInfo,
  type ComfyProgress,
  type ComfyRecipe,
  type ComfySocket,
  type ComfySocketHandlers,
  type ComfySystemStats,
  type TemplateAvailability,
} from '@/services/aiRuntime/comfy';
import txt2imgAsset from '../../../resources/comfy-templates/txt2img.json';
import hiresAsset from '../../../resources/comfy-templates/hires.json';
import regionalAsset from '../../../resources/comfy-templates/regional.json';
import inpaintAsset from '../../../resources/comfy-templates/inpaint.json';
import upscaleAsset from '../../../resources/comfy-templates/ultimate-upscale.json';
import detailerAsset from '../../../resources/comfy-templates/detailer.json';
import controlnetAsset from '../../../resources/comfy-templates/multi-controlnet.json';
import type { AdapterContext, ProviderAdapter } from './types';

/**
 * The connection kind this adapter serves. It is a literal rather than a
 * member of `AiConnectionKind` because widening that union lives in a file
 * this work does not own; the gateway's `adapterFor` gains one line when it is.
 */
export const COMFYUI_KIND = 'comfyui';

/** The curated set, in the order the settings page should offer it. */
const TEMPLATES = createTemplateRegistry([
  txt2imgAsset,
  hiresAsset,
  regionalAsset,
  inpaintAsset,
  upscaleAsset,
  detailerAsset,
  controlnetAsset,
]);

const OBJECT_INFO_TTL_MS = 60_000;
/** A 4-tile Ultimate SD Upscale on a mid-range card is genuinely long. */
const JOB_TIMEOUT_MS = 30 * 60_000;
const CONNECT_TIMEOUT_MS = 15_000;

interface CachedInfo {
  at: number;
  info: ComfyObjectInfo;
}

const objectInfoCache = new Map<string, CachedInfo>();
const clientIds = new Map<string, string>();

type ProgressListener = (event: { connectionId: string; progress: ComfyProgress }) => void;
let progressListener: ProgressListener | null = null;

/**
 * Main wires this to broadcast a progress bar. It is a setter rather than an
 * import so this adapter keeps no dependency on the IPC layer.
 */
export function setComfyProgressListener(listener: ProgressListener | null): void {
  progressListener = listener;
}

/**
 * One client id per connection, stable for the life of the process: ComfyUI
 * keys its WebSocket session and its `client_id` targeting on it, so a fresh
 * one per request would make every reconnect a new session.
 */
function clientIdFor(connection: AiConnectionSummary): string {
  const existing = clientIds.get(connection.id);
  if (existing) return existing;
  const id = createHash('sha1').update(`writers-hoard:${connection.id}`).digest('hex').slice(0, 32);
  clientIds.set(connection.id, id);
  return id;
}

function openSocket(url: string, handlers: ComfySocketHandlers): ComfySocket | null {
  // Node exposes a global WebSocket from 22.4; an older runtime simply has no
  // socket and the client falls back to polling /history, which is why this is
  // allowed to return null instead of throwing.
  if (typeof WebSocket === 'undefined') return null;
  try {
    const socket = new WebSocket(url);
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') handlers.onMessage(event.data);
    });
    socket.addEventListener('close', () => handlers.onClose());
    socket.addEventListener('error', () => handlers.onClose());
    return {
      close(): void {
        try {
          socket.close();
        } catch {
          // already closing
        }
      },
    };
  } catch {
    return null;
  }
}

function clientFor(ctx: AdapterContext): ComfyClient {
  return createComfyClient({
    baseUrl: ctx.connection.baseUrl,
    clientId: clientIdFor(ctx.connection),
    fetch: (url, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), CONNECT_TIMEOUT_MS);
      const signals: AbortSignal[] = [controller.signal];
      if (init?.signal) signals.push(init.signal);
      const combined = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      const body = init?.body;
      return net
        .fetch(url, {
          method: init?.method ?? 'GET',
          headers: init?.headers,
          ...(body === undefined ? {} : { body: typeof body === 'string' ? body : new Uint8Array(body) }),
          signal: combined,
          redirect: 'manual',
        })
        .finally(() => clearTimeout(timer));
    },
    openSocket,
  });
}

async function objectInfoFor(ctx: AdapterContext, signal?: AbortSignal): Promise<ComfyObjectInfo> {
  const cached = objectInfoCache.get(ctx.connection.id);
  if (cached && Date.now() - cached.at < OBJECT_INFO_TTL_MS) return cached.info;
  const info = await clientFor(ctx).objectInfo(signal);
  objectInfoCache.set(ctx.connection.id, { at: Date.now(), info });
  return info;
}

function descriptors(connectionId: string, info: ComfyObjectInfo): AiModelDescriptor[] {
  return listCheckpoints(info).map((id) => ({
    connectionId,
    id,
    type: 'image',
    capabilities: ['image-generation', 'image-editing'],
    label: id.replace(/\.[^.]+$/, '').replace(/^.*[\\/]/, ''),
    installed: true,
  }));
}

async function listModels(ctx: AdapterContext, signal?: AbortSignal): Promise<AiModelDescriptor[]> {
  return descriptors(ctx.connection.id, await objectInfoFor(ctx, signal));
}

async function probe(ctx: AdapterContext, signal?: AbortSignal): Promise<AiProbeResult> {
  const started = Date.now();
  try {
    const info = await clientFor(ctx).objectInfo(signal);
    objectInfoCache.set(ctx.connection.id, { at: Date.now(), info });
    return { ok: true, latencyMs: Date.now() - started, models: descriptors(ctx.connection.id, info) };
  } catch (err) {
    const error = err instanceof ComfyError ? err : new ComfyError('unreachable', String(err));
    return {
      ok: false,
      latencyMs: Date.now() - started,
      code: error.code,
      // Naming the address is the whole point: "ComfyUI is not running" with
      // no URL sends people to check the wrong machine.
      error: `${error.message} (tried ${ctx.connection.baseUrl})`,
    };
  }
}

async function chat(_ctx: AdapterContext, _request: AiChatRequest, emit: (event: AiStreamEvent) => void): Promise<void> {
  emit({ type: 'error', code: 'bad-request', message: 'ComfyUI generates images; it does not answer chat.' });
}

/** Which templates this install can actually run, for the settings page. */
export async function comfyTemplateAvailability(ctx: AdapterContext, signal?: AbortSignal): Promise<TemplateAvailability[]> {
  const info = await objectInfoFor(ctx, signal);
  return TEMPLATES.all.map((template) => checkTemplate(template, info));
}

/** VRAM, for the same contention warning the bundled runtime feeds. */
export async function comfySystemStats(ctx: AdapterContext, signal?: AbortSignal): Promise<ComfySystemStats> {
  return clientFor(ctx).systemStats(signal);
}

/** The model folders of THAT install: checkpoints, LoRAs, ControlNets, upscalers, detectors. */
export async function comfyModelFolders(ctx: AdapterContext, signal?: AbortSignal): Promise<Record<string, string[]>> {
  const info = await objectInfoFor(ctx, signal);
  return {
    checkpoints: listCheckpoints(info),
    loras: listLoras(info),
    controlNets: listControlNets(info),
    upscaleModels: listUpscaleModels(info),
    detectors: listDetectors(info),
  };
}

/**
 * Uploads are named by the hash of their content. A fresh name per submission
 * would change a node input and cost the whole downstream branch its cache
 * entry, which is the same trap as regenerating node ids.
 */
async function uploadDataUrl(client: ComfyClient, dataUrl: string, signal: AbortSignal): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const digest = createHash('sha1').update(parsed.bytes).digest('hex').slice(0, 24);
  const fileName = `wh-${digest}.${extensionFor(parsed.contentType)}`;
  const result = await client.uploadImage({
    bytes: parsed.bytes,
    fileName,
    contentType: parsed.contentType,
    signal,
  });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

async function generateImage(ctx: AdapterContext, request: AiImageRequest, signal: AbortSignal): Promise<AiImageResult> {
  const client = clientFor(ctx);
  let promptId: string | null = null;
  try {
    const info = await objectInfoFor(ctx, signal);
    // The checkpoint is checked before anything is uploaded: it is the one
    // failure that makes every other step pointless.
    const checkpoints = listCheckpoints(info);
    if (!checkpoints.includes(request.modelId)) {
      return { ok: false, code: 'model-missing', error: missingModelMessage('checkpoint', request.modelId, checkpoints) };
    }

    const extras = readComfyExtras(request);
    const templateId = extras.templateId ?? chooseTemplateId(intentFromRequest(request, extras));
    if (signal.aborted) return { ok: false, code: 'cancelled', error: 'Cancelled.' };

    const sourceImage = request.initImage ? await uploadDataUrl(client, request.initImage, signal) : null;
    const maskImage = request.maskImage ? await uploadDataUrl(client, request.maskImage, signal) : null;
    const regions: NonNullable<ComfyRecipe['regions']> = [];
    for (const region of extras.regions) {
      const mask = await uploadDataUrl(client, region.maskDataUrl, signal);
      if (!mask) return { ok: false, code: 'bad-request', error: 'A region mask was not a readable image.' };
      regions.push({ prompt: region.prompt, mask, strength: region.strength });
    }
    const controls: NonNullable<ComfyRecipe['controls']> = [];
    for (const control of extras.controls) {
      const image = await uploadDataUrl(client, control.imageDataUrl, signal);
      if (!image) return { ok: false, code: 'bad-request', error: 'A ControlNet hint was not a readable image.' };
      controls.push({
        model: control.model,
        image,
        strength: control.strength,
        startPercent: control.startPercent,
        endPercent: control.endPercent,
      });
    }

    // Pick the seed here when the caller left it random, so the Gallery row
    // records a number that reproduces the picture.
    const seed = request.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const recipe: ComfyRecipe = {
      templateId,
      checkpoint: request.modelId,
      prompt: request.prompt,
      negativePrompt: request.negativePrompt ?? '',
      width: request.width,
      height: request.height,
      batchSize: Math.max(1, Math.min(8, request.n)),
      seed,
      steps: request.steps ?? 25,
      cfg: request.guidance ?? 6,
      samplerName: comfySamplerName(request.sampler, listSamplers(info)),
      scheduler: comfySchedulerName(request.scheduler, listSchedulers(info)),
      denoise: request.strength ?? 1,
      filenamePrefix: 'WritersHoard/wh',
      loras: (request.loras ?? []).map((lora) => ({ name: lora.fileName ?? lora.name, weight: lora.weight })),
      guidance: extras.guidance,
      growMaskBy: 6,
      ...(regions.length ? { regions } : {}),
      ...(controls.length ? { controls } : {}),
      ...(extras.detail.length ? { detail: extras.detail } : {}),
      ...(sourceImage ? { sourceImage } : {}),
      ...(maskImage ? { maskImage } : {}),
      ...(request.hiresFix
        ? {
            hires: {
              width: Math.round(request.width * request.hiresFix.scale),
              height: Math.round(request.height * request.hiresFix.scale),
              steps: request.hiresFix.steps ?? 15,
              denoise: request.hiresFix.denoisingStrength ?? 0.5,
            },
          }
        : {}),
      ...(extras.upscale ? { upscale: extras.upscale } : {}),
      ...(extras.crop ? { crop: extras.crop } : {}),
      ...(extras.workWidth ? { workWidth: extras.workWidth } : {}),
      ...(extras.workHeight ? { workHeight: extras.workHeight } : {}),
    };

    const plan = planSubmission(TEMPLATES, info, recipe);
    if (!plan.ok) return { ok: false, code: plan.code, error: plan.error };

    if (signal.aborted) return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    promptId = await client.submit(plan.graph, signal);
    const connectionId = ctx.connection.id;
    const entry = await client.awaitResult(promptId, {
      signal,
      timeoutMs: JOB_TIMEOUT_MS,
      onProgress: (progress) => progressListener?.({ connectionId, progress }),
    });

    const refs = Object.values(entry.outputs).flatMap((output) => output.images ?? []);
    if (!refs.length) {
      return { ok: false, code: 'bad-response', error: 'ComfyUI finished the workflow without producing an image.' };
    }
    const images: AiGeneratedImage[] = [];
    for (const ref of refs) {
      const bytes = await client.view(ref, signal);
      // A ComfyUI batch shares one seed and differs by batch index, so every
      // image reproduces from this seed and its position — unlike
      // stable-diffusion.cpp, which increments the seed per image.
      images.push({ base64: bytesToBase64(bytes), mimeType: 'image/png', seed });
    }
    return { ok: true, images };
  } catch (err) {
    if (signal.aborted) {
      if (promptId) await client.cancel(promptId);
      return { ok: false, code: 'cancelled', error: 'Cancelled.' };
    }
    const error = err instanceof ComfyError ? err : new ComfyError('unreachable', err instanceof Error ? err.message : String(err));
    return { ok: false, code: error.code, error: error.message };
  }
}

export const comfyuiAdapter: ProviderAdapter = { probe, listModels, chat, generateImage };
