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
import { ollamaBase } from '@/services/aiRuntime/urlPolicy';

/** Headroom the diffusion server needs beyond its weights (activations, VAE). */
const IMAGE_HEADROOM = 1_000_000_000;
const PS_TIMEOUT_MS = 2_000;
const UNLOAD_TIMEOUT_MS = 8_000;
const SETTLE_MAX_MS = 6_000;
const SETTLE_STEP_MS = 300;

interface OllamaPs {
  models?: Array<{ name?: string; model?: string; size_vram?: number }>;
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

async function localOllamaBases(): Promise<string[]> {
  // listConnections() starts with the embedded Ollama; a stored one that
  // points at the same port dedups through the Set.
  const bases = new Set<string>();
  let connections: AiConnectionSummary[];
  try {
    connections = await listConnections();
  } catch {
    connections = [builtinConnection()];
  }
  for (const c of connections) {
    if (c.kind !== 'ollama' || !c.enabled || c.status === 'offline') continue;
    if (c.locality !== 'loopback' && c.locality !== 'embedded') continue;
    bases.add(ollamaBase(c.baseUrl));
  }
  return [...bases];
}

async function loadedModels(base: string): Promise<string[]> {
  try {
    const ps = await requestJson<OllamaPs>(`${base}/api/ps`, { connectTimeoutMs: PS_TIMEOUT_MS });
    return (ps.models ?? [])
      .map((m) => m.name ?? m.model ?? '')
      .filter((name) => name.length > 0);
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

  const bases = await localOllamaBases();
  if (!bases.length) return { released: [], freeBefore, skipped: 'no-local-ollama' };

  const released: RoomReport['released'] = [];
  for (const base of bases) {
    const models = await loadedModels(base);
    if (!models.length) continue;
    const dropped: string[] = [];
    for (const model of models) {
      try {
        await unload(base, model);
        dropped.push(model);
      } catch (err) {
        console.warn(`[ai] could not unload ${model} from ${base}:`, err instanceof Error ? err.message : err);
      }
    }
    if (dropped.length) released.push({ baseUrl: base, models: dropped });
  }
  if (!released.length) return { released, freeBefore, skipped: 'nothing-loaded' };

  // Unloading is asynchronous on Ollama's side: poll until /api/ps is empty.
  const deadline = Date.now() + SETTLE_MAX_MS;
  while (Date.now() < deadline) {
    const still = await Promise.all(released.map((r) => loadedModels(r.baseUrl)));
    if (still.every((list) => list.length === 0)) break;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
  }
  return { released, freeBefore };
}
