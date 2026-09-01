// ============================================================================
// AI runtime — making room on the GPU before a diffusion model loads (main)
// ============================================================================
//
// One card, two residents. Ollama keeps the last chat model loaded for half an
// hour; stable-diffusion.cpp loads the image model when its server starts. When
// both do not fit, whichever comes second spills to the CPU and a fifteen-second
// picture takes minutes — physics, not a bug (docs/AI-BRIDGE.md §19). What CAN
// be done is to ask Ollama to drop what it holds right before the image model
// loads, when the free memory says it would not fit beside it.
//
// Only LOCAL Ollama servers are asked (loopback, or the embedded one): a server
// on another machine has its own card. The next chat request reloads the model
// — seconds — which is the trade the reader makes by generating an image.
// Measured free memory comes from nvidia-smi; without a measurement (other
// vendors, no driver tool) the resident models are dropped whenever any are
// loaded, because guessing wrong costs minutes and guessing right costs seconds.

import { requestJson } from './adapters/http';
import { builtinConnection, listConnections } from './connectionStore';
import { detectHardware } from './hardware';
import type { AiConnectionSummary } from '@/services/aiRuntime/types';
import type { SdResidentModel, SdVramReport } from '@/services/aiRuntime/sdServer';
import { IMAGE_VRAM_HEADROOM } from '@/services/aiRuntime/sdServer';
import { ollamaBase } from '@/services/aiRuntime/urlPolicy';

/** Headroom the diffusion server needs beyond its weights (activations, VAE). */
const IMAGE_HEADROOM = IMAGE_VRAM_HEADROOM;
const PS_TIMEOUT_MS = 2_000;
const UNLOAD_TIMEOUT_MS = 8_000;
const SETTLE_MAX_MS = 6_000;
const SETTLE_STEP_MS = 300;
/**
 * How long a room report is reused. `sd:status` is invoked whenever the studio
 * or the dock looks, and every miss costs an nvidia-smi spawn plus one /api/ps
 * per local server; a couple of seconds is fresh enough for a warning and still
 * bounds that to one round per look.
 */
const REPORT_TTL_MS = 2_500;

interface OllamaPs {
  models?: Array<{ name?: string; model?: string; size_vram?: number }>;
}

interface LocalOllama {
  connectionId: string;
  connectionName: string;
  baseUrl: string;
}

interface LoadedModel {
  modelId: string;
  sizeVramBytes: number | null;
}

export interface RoomReport {
  /** Model names asked to unload, by server base URL. */
  released: Array<{ baseUrl: string; models: string[] }>;
  /** Free GPU memory before, when it could be measured. */
  freeBefore: number | null;
  /** Why nothing was done, when nothing was. */
  skipped?: 'enough-room' | 'nothing-loaded' | 'no-local-ollama';
}

function primaryFreeBytes(gpus: Array<{ vramFreeBytes: number | null; vramTotalBytes: number | null }>): number | null {
  let best: number | null = null;
  for (const gpu of gpus) {
    if (gpu.vramFreeBytes === null) continue;
    if (best === null || gpu.vramFreeBytes > best) best = gpu.vramFreeBytes;
  }
  return best;
}

async function localOllamaServers(): Promise<LocalOllama[]> {
  // listConnections() starts with the embedded Ollama; a stored one that
  // points at the same port dedups through the Map.
  const servers = new Map<string, LocalOllama>();
  let connections: AiConnectionSummary[];
  try {
    connections = await listConnections();
  } catch {
    connections = [builtinConnection()];
  }
  for (const c of connections) {
    if (c.kind !== 'ollama' || !c.enabled || c.status === 'offline') continue;
    if (c.locality !== 'loopback' && c.locality !== 'embedded') continue;
    const baseUrl = ollamaBase(c.baseUrl);
    if (!servers.has(baseUrl)) servers.set(baseUrl, { connectionId: c.id, connectionName: c.name, baseUrl });
  }
  return [...servers.values()];
}

async function loadedModels(base: string): Promise<LoadedModel[]> {
  try {
    const ps = await requestJson<OllamaPs>(`${base}/api/ps`, { connectTimeoutMs: PS_TIMEOUT_MS });
    return (ps.models ?? [])
      .map((m) => ({
        modelId: m.name ?? m.model ?? '',
        sizeVramBytes: typeof m.size_vram === 'number' && m.size_vram > 0 ? m.size_vram : null,
      }))
      .filter((m) => m.modelId.length > 0);
  } catch {
    return [];
  }
}

async function unload(base: string, model: string): Promise<void> {
  // keep_alive 0 with no prompt is Ollama's documented "unload now".
  await requestJson(`${base}/api/generate`, {
    body: { model, keep_alive: 0 },
    connectTimeoutMs: UNLOAD_TIMEOUT_MS,
  });
}

/**
 * Drop resident Ollama models when `vramNeeded` bytes would not fit beside
 * them, then wait (briefly) until the server reports them gone, so the image
 * server that starts next actually finds the memory free.
 */
export async function makeRoomForImageModel(vramNeeded: number): Promise<RoomReport> {
  const hardware = await detectHardware(true).catch(() => null);
  const freeBefore = hardware ? primaryFreeBytes(hardware.gpus) : null;
  if (freeBefore !== null && freeBefore >= vramNeeded + IMAGE_HEADROOM) {
    return { released: [], freeBefore, skipped: 'enough-room' };
  }

  const servers = await localOllamaServers();
  if (!servers.length) return { released: [], freeBefore, skipped: 'no-local-ollama' };

  const released: RoomReport['released'] = [];
  for (const server of servers) {
    const models = await loadedModels(server.baseUrl);
    if (!models.length) continue;
    const dropped: string[] = [];
    for (const model of models) {
      try {
        await unload(server.baseUrl, model.modelId);
        dropped.push(model.modelId);
      } catch (err) {
        console.warn(`[ai] could not unload ${model.modelId} from ${server.baseUrl}:`, err instanceof Error ? err.message : err);
      }
    }
    if (dropped.length) released.push({ baseUrl: server.baseUrl, models: dropped });
  }
  if (!released.length) return { released, freeBefore, skipped: 'nothing-loaded' };

  // Unloading is asynchronous on Ollama's side: poll until /api/ps is empty.
  const deadline = Date.now() + SETTLE_MAX_MS;
  while (Date.now() < deadline) {
    const still = await Promise.all(released.map((r) => loadedModels(r.baseUrl)));
    if (still.every((list) => list.length === 0)) break;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
  }
  invalidateVramReport();
  return { released, freeBefore };
}

// ---------------------------------------------------------------------------
// The same measurement, as a report — so the reader is warned BEFORE the wait
// ---------------------------------------------------------------------------
//
// `makeRoomForImageModel` decides for itself, seconds before sd-server starts.
// This is the same two questions asked out loud (how much is free, and who is
// holding it) so the studio and the copilot can say "qwen3-coder:30b has the
// card" instead of letting a seven-second picture take four minutes.

let cachedReport: SdVramReport | null = null;
let reportInFlight: Promise<SdVramReport> | null = null;
/**
 * Bumped by every invalidation. A measurement that started BEFORE the card
 * changed hands must not be stored after it: the reader unloads a model, a
 * reading already in flight comes back describing the world one second ago, and
 * the warning they just acted on would stay on screen for the whole TTL.
 */
let reportGeneration = 0;

/** The last report, without measuring again. Null until something asks for one. */
export function cachedVramReport(): SdVramReport | null {
  return cachedReport;
}

/**
 * Throw the last measurement away. Called when something this process did
 * changed who is on the card — an unload, a model dropped to make room — so the
 * next reader measures instead of repeating what was true a second ago.
 */
export function invalidateVramReport(): void {
  cachedReport = null;
  reportGeneration += 1;
}

/** Free VRAM and the chat models resident on this machine, memoised briefly. */
export function readVramReport(): Promise<SdVramReport> {
  if (cachedReport && Date.now() - cachedReport.at < REPORT_TTL_MS) return Promise.resolve(cachedReport);
  if (reportInFlight) return reportInFlight;
  const generation = reportGeneration;
  reportInFlight = (async (): Promise<SdVramReport> => {
    // Forced: the 30-second hardware cache would still show the memory a model
    // held after the reader has just unloaded it, and this figure is read
    // precisely to answer "did that free the card?".
    const hardware = await detectHardware(true).catch(() => null);
    const gpus = hardware?.gpus ?? [];
    const measured = hardware?.gpuConfidence === 'measured' && gpus.some((gpu) => gpu.vramFreeBytes !== null);
    const resident: SdResidentModel[] = [];
    for (const server of await localOllamaServers()) {
      for (const model of await loadedModels(server.baseUrl)) {
        resident.push({
          connectionId: server.connectionId,
          connectionName: server.connectionName,
          modelId: model.modelId,
          sizeVramBytes: model.sizeVramBytes,
        });
      }
    }
    const report: SdVramReport = {
      at: Date.now(),
      measured,
      freeBytes: measured ? primaryFreeBytes(gpus) : null,
      totalBytes: gpus.reduce<number | null>((best, gpu) => (gpu.vramTotalBytes && (best === null || gpu.vramTotalBytes > best) ? gpu.vramTotalBytes : best), null),
      resident,
    };
    if (generation === reportGeneration) cachedReport = report;
    return report;
  })().finally(() => {
    reportInFlight = null;
  });
  return reportInFlight;
}
