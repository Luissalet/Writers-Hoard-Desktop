// ============================================================================
// AI runtime — managed stable-diffusion.cpp server: fit, arguments, payloads
// ============================================================================
//
// Everything about the local image server that can be decided without I/O:
// whether a catalogue model would run on this GPU, the command line the
// server is launched with for a given model, and the body of a generation
// job on its native async API. Main runs it; the tests pin it.

import type { AiImageRequest, FitEstimate, HardwareProfile } from './types';
import type { ImageCatalogModel, ImageFileRole } from './imageCatalog';
import { primaryGpuBytes } from './fit';

// ---- Runtime status, as main reports it and the settings page shows it -----

/** Vulkan is the default on every platform; CUDA 12 is the NVIDIA upgrade; CPU the fallback. */
export type SdBackend = 'vulkan' | 'cuda12' | 'cpu';

export type SdRuntimeState = 'absent' | 'downloading-runtime' | 'extracting' | 'ready' | 'starting' | 'running' | 'error';

export interface SdInstalledModel {
  id: string;
  installedBytes: number;
}

/**
 * A LoRA the runtime found in its folder. `name` is the file name without its
 * extension, which is exactly what stable-diffusion.cpp resolves inside
 * `--lora-model-dir` when it reads `<lora:NAME:WEIGHT>` out of a prompt.
 */
export interface SdLoraFile {
  name: string;
  fileName: string;
  sizeBytes: number;
}

/** One Ollama model sitting in GPU memory right now, and who to ask to drop it. */
export interface SdResidentModel {
  connectionId: string;
  connectionName: string;
  modelId: string;
  /** What the server says it occupies on the card; null when it does not say. */
  sizeVramBytes: number | null;
}

/**
 * Who is holding the card, measured just before an image model would load.
 * `measured` is false when no vendor tool answered (see electron/ai/hardware.ts):
 * the free figure is then unknown, and only the resident list is meaningful.
 */
export interface SdVramReport {
  at: number;
  measured: boolean;
  freeBytes: number | null;
  totalBytes: number | null;
  resident: SdResidentModel[];
}

export interface SdRuntimeStatus {
  supported: boolean;
  backends: SdBackend[];
  installedBackend: SdBackend | null;
  state: SdRuntimeState;
  runtimeBytes?: number;
  /** The model the server currently serves, when running. */
  loadedModelId: string | null;
  url: string | null;
  models: SdInstalledModel[];
  /** Catalogue id being downloaded, if any. */
  downloading: string | null;
  error?: string;
  version: string;
  /** LoRA files present in `lorasDir`, refreshed with every status read. */
  loras?: SdLoraFile[];
  /** Absolute path of the folder the user drops LoRA files into. */
  lorasDir?: string | null;
  /**
   * False once this runtime build has been seen to refuse the LoRA folder flag.
   * Undefined means "no reason to think otherwise" — it is only ever set by the
   * server actually failing to start with it and succeeding without.
   */
  lorasSupported?: boolean;
  /** GPU memory and resident chat models, as of `vram.at`. */
  vram?: SdVramReport | null;
}

export interface SdProgress {
  kind: 'runtime' | 'model';
  id: string;
  phase: 'downloading' | 'verifying' | 'extracting' | 'starting';
  receivedBytes: number;
  totalBytes: number;
  fileIndex: number;
  fileCount: number;
}

export interface SdOpResult {
  ok: boolean;
  error?: string;
}

/** Fixed loopback port of the managed server — never a system install's 1234. */
export const SD_SERVER_PORT = 8102;
export const SD_SERVER_URL = `http://127.0.0.1:${SD_SERVER_PORT}`;

const GPU_RESERVE = 1_000_000_000;
const RAM_SHARE = 0.75;
/** Activations need this much on the card even when the weights sit in RAM. */
const OFFLOAD_MIN_GPU = 3_500_000_000;

/**
 * Same four labels as the text fit, but the question is GPU memory at the
 * native resolution: diffusion is compute-bound, so "fits" means fast and
 * "does not fit" means minutes per image or nothing at all.
 */
export function computeImageFit(hardware: HardwareProfile, entry: Pick<ImageCatalogModel, 'vramBytes' | 'totalBytes' | 'family'>): FitEstimate {
  const gpuTotal = primaryGpuBytes(hardware);
  const gpuUsable = Math.max(0, gpuTotal - GPU_RESERVE);
  const ramBudget = hardware.ramTotalBytes * RAM_SHARE;
  const base = {
    totalBytes: entry.vramBytes,
    weightsBytes: entry.totalBytes,
    kvCacheBytes: 0,
    contextTokens: 0,
    confidence: 'estimated' as const,
    speedSource: 'estimated' as const,
  };
  if (gpuUsable <= 0 || hardware.gpuConfidence === 'none') {
    // Only the small UNet family is bearable on a CPU: about a minute a picture.
    if (entry.family === 'sd1' && entry.totalBytes * 1.5 <= ramBudget) {
      return { ...base, label: 'tight', placement: 'cpu', speedHint: 'slow' };
    }
    return { ...base, label: 'no-fit', placement: 'none', speedHint: 'unusable' };
  }
  if (entry.vramBytes <= gpuUsable * 0.9) return { ...base, label: 'perfect', placement: 'gpu', speedHint: 'fast' };
  if (entry.vramBytes <= gpuUsable) return { ...base, label: 'good', placement: 'gpu', speedHint: 'ok' };
  // Weights in RAM, streamed to the card layer by layer: works, slowly.
  if (gpuUsable >= OFFLOAD_MIN_GPU && entry.totalBytes * 1.2 <= ramBudget) {
    return { ...base, label: 'tight', placement: 'split', speedHint: 'slow' };
  }
  return { ...base, label: 'no-fit', placement: 'none', speedHint: 'unusable' };
}

// ---- VRAM contention: one card, a chat model and a diffusion model ---------

/** Headroom a diffusion model needs beyond its weights (activations, VAE). */
export const IMAGE_VRAM_HEADROOM = 1_000_000_000;

export interface VramContention {
  /** Weights plus headroom the image model wants on the card. */
  needBytes: number;
  /** Free GPU memory when it could be measured. */
  freeBytes: number | null;
  measured: boolean;
  resident: SdResidentModel[];
}

/**
 * Whether starting `entry` now would fight a resident chat model for the card.
 *
 * This is the physical trap of §19 in docs/AI-BRIDGE.md: with ~9 GB of Ollama
 * resident on a 12 GB card, sd-server's Vulkan backend gets no memory and falls
 * back to the CPU — the same picture takes minutes instead of seconds. Nothing
 * is wrong with either program; they simply do not fit together.
 *
 * Returns null when there is nothing to warn about: no measurement AND nothing
 * resident, or a measurement that says the image model fits beside what is
 * loaded. Without a measurement but with a model resident it warns, because
 * being wrong costs the reader seconds and being silent costs them minutes.
 */
export function detectVramContention(
  vram: SdVramReport | null | undefined,
  entry: Pick<ImageCatalogModel, 'vramBytes'> | undefined,
): VramContention | null {
  if (!vram || !entry) return null;
  if (!vram.resident.length) return null;
  // No graphics memory figure at all means there is no card to fight over: on
  // such a machine the image model was never going to use one either.
  if (vram.totalBytes === null) return null;
  const needBytes = entry.vramBytes + IMAGE_VRAM_HEADROOM;
  if (vram.measured && vram.freeBytes !== null && vram.freeBytes >= needBytes) return null;
  return { needBytes, freeBytes: vram.freeBytes, measured: vram.measured, resident: vram.resident };
}

// ---- LoRA ------------------------------------------------------------------

/**
 * What may name a LoRA. The server parses `<lora:NAME:WEIGHT>` out of the
 * prompt with a `[^:]+` capture, so a colon is impossible and `<`/`>` would cut
 * the token in half; anything else a file system allows is fine.
 */
export function isSdLoraName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 96 && !/[<>:\r\n]/.test(value);
}

/** Weights outside this range are a typo, not an intention. */
export function clampLoraWeight(weight: unknown): number {
  const value = typeof weight === 'number' && Number.isFinite(weight) ? weight : 1;
  return Math.round(Math.max(-2, Math.min(2, value)) * 100) / 100;
}

export function formatLoraToken(name: string, weight: number): string {
  return `<lora:${name}:${clampLoraWeight(weight).toFixed(2)}>`;
}

/** Extensions stable-diffusion.cpp looks for when it resolves a LoRA name. */
export const SD_LORA_EXTENSIONS = ['.safetensors', '.ckpt'] as const;

export interface SdServerLaunch {
  /** Absolute path of each downloaded file, by role. */
  paths: Partial<Record<ImageFileRole, string>>;
  port?: number;
  /** Stream weights from RAM (the "tight" placement). */
  offloadToCpu?: boolean;
  /** Flash attention in the diffusion model: a memory saver on CUDA, not offered elsewhere. */
  flashAttention?: boolean;
  threads?: number;
  /**
   * Folder the server resolves `<lora:NAME:WEIGHT>` against. Passed ONLY when
   * the folder actually holds a LoRA: a build that did not know the flag would
   * refuse to start, and no reader who never touched LoRAs should ever meet it.
   */
  loraDir?: string;
}

/** Arguments for `sd-server` so that it serves exactly this model on loopback. */
export function buildSdServerArgs(entry: ImageCatalogModel, launch: SdServerLaunch): string[] {
  const args: string[] = ['--listen-ip', '127.0.0.1', '--listen-port', String(launch.port ?? SD_SERVER_PORT)];
  const flagFor: Record<ImageFileRole, string> = {
    model: '--model',
    diffusion: '--diffusion-model',
    vae: '--vae',
    clip_l: '--clip_l',
    t5xxl: '--t5xxl',
  };
  for (const file of entry.files) {
    const path = launch.paths[file.role];
    if (!path) throw new Error(`missing file for role ${file.role}`);
    args.push(flagFor[file.role], path);
  }
  // VAE tiling only ever saves memory; the defaults of the catalogue entry
  // become the server's defaults for requests that omit them.
  args.push('--vae-tiling');
  if (launch.flashAttention) args.push('--diffusion-fa');
  args.push('--sampling-method', entry.defaults.sampler, '--steps', String(entry.defaults.steps), '--cfg-scale', String(entry.defaults.cfg));
  if (entry.defaults.scheduler) args.push('--scheduler', entry.defaults.scheduler);
  if (entry.family === 'flux') args.push('--guidance', '1.0');
  if (launch.offloadToCpu) args.push('--offload-to-cpu');
  if (launch.loraDir) args.push('--lora-model-dir', launch.loraDir);
  if (launch.threads && launch.threads > 0) args.push('--threads', String(launch.threads));
  return args;
}

/** Body of `POST /sdcpp/v1/img_gen`: the request, with the model's defaults for anything unset. */
export function buildSdJobPayload(request: AiImageRequest, entry: ImageCatalogModel): Record<string, unknown> {
  const steps = request.steps ?? entry.defaults.steps;
  const cfg = request.guidance ?? entry.defaults.cfg;
  // LoRA: stable-diffusion.cpp has no request field for it. The server reads
  // `<lora:NAME:WEIGHT>` out of the prompt, resolves NAME inside the folder it
  // was launched with (`--lora-model-dir`) and strips the token before the text
  // is encoded — so appending here changes the weights, never the conditioning.
  const loraTokens = (request.loras ?? [])
    .filter((lora) => isSdLoraName(lora.name))
    .map((lora) => formatLoraToken(lora.name, lora.weight));
  const payload: Record<string, unknown> = {
    prompt: loraTokens.length ? `${request.prompt} ${loraTokens.join(' ')}` : request.prompt,
    negative_prompt: request.negativePrompt ?? '',
    width: snap(request.width),
    height: snap(request.height),
    seed: request.seed === undefined ? -1 : request.seed,
    batch_count: Math.max(1, Math.min(4, Math.floor(request.n || 1))),
    sample_params: {
      sample_method: entry.defaults.sampler,
      sample_steps: Math.max(1, Math.min(150, Math.floor(steps))),
      guidance: { txt_cfg: cfg, distilled_guidance: entry.family === 'flux' ? 1 : 3.5 },
      ...(entry.defaults.scheduler ? { scheduler: entry.defaults.scheduler } : {}),
    },
    output_format: 'png',
    embed_image_metadata: false,
  };
  // img2img: seed generation from a reference image. `init_image` is a data URL
  // and `strength` (0..1, lower = closer to the reference) sit at the top level,
  // matching the sd-server's native img_gen schema.
  if (request.initImage) {
    payload.init_image = request.initImage;
    payload.strength = Math.max(0, Math.min(1, request.strength ?? 0.75));
  }
  return payload;
}

/** Diffusion latents want multiples of 64; anything else the server rounds unpredictably. */
export function snap(pixels: number): number {
  return Math.max(256, Math.min(2048, Math.round(pixels / 64) * 64));
}

/** Ids the managed server reports; the catalogue id is the model id the app uses. */
export function isBuiltinSdModelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}
