// ============================================================================
// AI runtime — managed stable-diffusion.cpp server: fit, arguments, payloads
// ============================================================================
//
// Everything about the local image server that can be decided without I/O:
// whether a catalogue model would run on this GPU, the command line the
// server is launched with for a given model, and the body of a generation
// job on its native async API. Main runs it; the tests pin it.

import type { AiImageRequest, FitEstimate, HardwareProfile, SdExtraSampleArgsInput } from './types';
import type { ImageCatalogModel, ImageCompanionKind, ImageFileRole } from './imageCatalog';
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
 * extension — what the reader sees — while `fileName` is what the server is
 * told: it resolves `lora[].path` against the listing of `--lora-model-dir`,
 * and that listing carries the extension.
 */
export interface SdLoraFile {
  name: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * A ControlNet or an ESRGAN sitting in its folder. Both are pointed at by
 * launch arguments rather than by a request field, so which one is installed
 * is part of the server's identity, not of a job.
 */
export interface SdCompanionFile {
  kind: ImageCompanionKind;
  /** Catalogue id when the app downloaded it; null for a file dropped in by hand. */
  catalogId: string | null;
  /** File name without its extension — `hires.upscaler` names an upscaler this way. */
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
  /** ControlNet and upscaler files present, refreshed with every status read. */
  companions?: SdCompanionFile[];
  /** Absolute paths of the folders companions are installed into. */
  controlNetsDir?: string | null;
  upscalersDir?: string | null;
  /** The ControlNet the running server was built with, if any. */
  loadedControlNet?: string | null;
  /** Catalogue companion id being downloaded, if any. */
  downloadingCompanion?: string | null;
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
 * What may name a LoRA.
 *
 * The colon and the angle brackets are refused because `formatLoraToken`
 * writes the `<lora:NAME:WEIGHT>` notation into the Gallery note, and a name
 * carrying either would produce a note no reader could parse back. The wire
 * format does not care — the server takes the name in a JSON string field —
 * so this is a display constraint, not a protocol one.
 */
export function isSdLoraName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 96 && !/[<>:\r\n]/.test(value);
}

/** Weights outside this range are a typo, not an intention. */
export function clampLoraWeight(weight: unknown): number {
  const value = typeof weight === 'number' && Number.isFinite(weight) ? weight : 1;
  return Math.round(Math.max(-2, Math.min(2, value)) * 100) / 100;
}

/**
 * The `<lora:NAME:WEIGHT>` spelling. No longer a wire format — this build's
 * server refuses to parse it out of a prompt — but still the notation readers
 * recognise, so the Gallery note that records which weights made a picture is
 * written in it.
 */
export function formatLoraToken(name: string, weight: number): string {
  return `<lora:${name}:${clampLoraWeight(weight).toFixed(2)}>`;
}

/** Extensions stable-diffusion.cpp looks for when it resolves a LoRA name. */
export const SD_LORA_EXTENSIONS = ['.safetensors', '.ckpt'] as const;

// ---- The server's own vocabulary -------------------------------------------
//
// `sample_method`, `scheduler` and `hires.upscaler` are parsed by name, and a
// name the server does not know is DROPPED — the request still succeeds, with
// the default quietly in its place. So an unknown name must never leave here:
// a picture generated with the wrong sampler and labelled with the right one
// is a lie the Gallery would then repeat forever.
//
// Both tables are `sample_method_to_str` / `scheduler_to_str` in
// src/stable-diffusion.cpp at the pinned build.

export const SD_SAMPLERS = [
  'euler', 'euler_a', 'heun', 'dpm2', 'dpm++2s_a', 'dpm++2m', 'dpm++2mv2',
  'ipndm', 'ipndm_v', 'lcm', 'ddim_trailing', 'tcd', 'res_multistep', 'res_2s',
  'er_sde', 'euler_cfg_pp', 'euler_a_cfg_pp', 'euler_ge',
] as const;

export const SD_SCHEDULERS = [
  'discrete', 'karras', 'exponential', 'ays', 'gits', 'sgm_uniform', 'simple',
  'smoothstep', 'kl_optimal', 'lcm', 'bong_tangent', 'ltx2',
] as const;

/**
 * Upscalers every build knows without a file on disk (`hires_upscaler_to_str`).
 * Anything else must be the stem of a model in `--hires-upscalers-dir`, and the
 * server refuses the whole request when it cannot find it.
 */
export const SD_BUILTIN_HIRES_UPSCALERS = [
  'None', 'Latent', 'Latent (nearest)', 'Latent (nearest-exact)',
  'Latent (antialiased)', 'Latent (bicubic)', 'Latent (bicubic antialiased)',
  'Lanczos', 'Nearest',
] as const;

export function isSdSampler(value: unknown): value is string {
  return typeof value === 'string' && (SD_SAMPLERS as readonly string[]).includes(value);
}

export function isSdScheduler(value: unknown): value is string {
  return typeof value === 'string' && (SD_SCHEDULERS as readonly string[]).includes(value);
}

/**
 * Inference-cache modes (`cache_mode`), from `initialize_cache_params` in
 * examples/common/common.cpp. Unlike a sampler name, an unknown one here is
 * NOT dropped: the function returns false and the server refuses the whole
 * job. Validating is the difference between an unavailable feature and a
 * generation that fails with "invalid generation parameters".
 */
export const SD_CACHE_MODES = [
  'disabled', 'easycache', 'ucache', 'dbcache', 'taylorseer', 'cache-dit', 'spectrum',
] as const;

export function isSdCacheMode(value: unknown): value is string {
  return typeof value === 'string' && (SD_CACHE_MODES as readonly string[]).includes(value);
}

/**
 * `sample_params.extra_sample_args` is a STRING, not an object — the server
 * reads it with `is_string()` and hands it to `parse_key_value_args`
 * (src/core/util.cpp), which splits on `,` or `;` and trims each `key=value`.
 *
 * Only the keys below exist at the pinned build; the parsers ignore anything
 * else without complaint, which is why the studio must not invent one.
 * Adaptive Projected Guidance takes the four `apg_*` keys, Skip-Layer Guidance
 * takes `slg_uncond`, `noise_*` belong to `lcm` and `gamma` to `euler_ge`.
 */
export type SdExtraSampleArgs = SdExtraSampleArgsInput;

const EXTRA_SAMPLE_ARG_KEYS: ReadonlyArray<readonly [keyof SdExtraSampleArgs, string]> = [
  ['apgEta', 'apg_eta'],
  ['apgMomentum', 'apg_momentum'],
  ['apgNormThreshold', 'apg_norm_threshold'],
  ['apgNormThresholdSmoothing', 'apg_norm_threshold_smoothing'],
  ['slgUncond', 'slg_uncond'],
  ['noiseClipStd', 'noise_clip_std'],
  ['noiseScaleStart', 'noise_scale_start'],
  ['noiseScaleEnd', 'noise_scale_end'],
  ['gamma', 'gamma'],
];

/**
 * The `key=value` line for those arguments, or '' when there is nothing to say.
 *
 * A comma is the separator, so no value may contain one; every value here is a
 * number or a bool, so none can. `parse_strict_float` rejects a value with any
 * trailing text, which is why a non-finite number is dropped rather than
 * written as "NaN" — the server would log a warning and ignore that one key,
 * leaving the studio claiming a setting that never applied.
 */
export function formatExtraSampleArgs(args: SdExtraSampleArgs | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  for (const [key, wire] of EXTRA_SAMPLE_ARG_KEYS) {
    const value = args[key];
    if (typeof value === 'boolean') parts.push(`${wire}=${value ? 'true' : 'false'}`);
    else if (typeof value === 'number' && Number.isFinite(value)) parts.push(`${wire}=${value}`);
  }
  return parts.join(',');
}

/**
 * A custom sigma array the server will accept: finite, descending-ish numbers.
 * The runtime reads `custom_sigmas` as a plain float array and uses it INSTEAD
 * of the scheduler, so an array with a NaN in it would poison the whole
 * denoising loop rather than fall back.
 */
export function isSdSigmaArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 1000 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  );
}

/**
 * Skip-layer indices. The server reads `slg.layers` as `std::vector<int>`;
 * a non-integer would be a JSON type error and cost the whole request.
 */
export function isSdLayerArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1000)
  );
}

/**
 * Steps the server will honour verbatim.
 *
 * routes_sdcpp.cpp calls `resolve_and_validate(…, strict = true)`, and strict
 * clamps `sample_steps` to 1..100. Clamping to the same number here is what
 * makes a recipe true: asking for 150 and recording 150 would describe a
 * picture the runtime actually made with 100, and every later replay of that
 * recipe would quietly disagree with the image beside it.
 *
 * `batch_count` has a protocol ceiling of 8 under the same clamp. The studio
 * keeps its own lower ceiling of 4 — a product choice about how long a writer
 * should wait, not a protocol limit — so it is deliberately not raised here.
 */
export const SD_MAX_STEPS = 100;

/**
 * ControlNet strength, clamped to the band practitioners actually work in.
 *
 * 0.4–0.7 holds the pose and leaves the prompt in charge of everything else.
 * At 0.9 the hint stops being a hint: it drags the reference's clothing, hair
 * and lighting along with the skeleton, and the character stops being the one
 * that was asked for. This is craft, not API — the server accepts any number —
 * so the ceiling is here on purpose. Do not "improve" it to 1.0.
 */
export const SD_CONTROL_STRENGTH_DEFAULT = 0.55;
export const SD_CONTROL_STRENGTH_MIN = 0.1;
export const SD_CONTROL_STRENGTH_MAX = 0.9;

export function clampControlStrength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SD_CONTROL_STRENGTH_DEFAULT;
  return Math.max(SD_CONTROL_STRENGTH_MIN, Math.min(SD_CONTROL_STRENGTH_MAX, value));
}

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
   * Folder the server resolves `lora[].path` against. Passed ONLY when the
   * folder actually holds a LoRA: a build that did not know the flag would
   * refuse to start, and no reader who never touched LoRAs should ever meet it.
   */
  loraDir?: string;
  /**
   * Absolute path of the ControlNet to build the context with. ControlNet is a
   * CONTEXT option, not a request field, so the model is fixed for the life of
   * the process: changing it means restarting the server.
   */
  controlNetPath?: string;
  /**
   * Folder `hires.upscaler` resolves a model name against. Same rule as the
   * LoRA folder: only passed when something is actually in it.
   */
  hiresUpscalersDir?: string;
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
  if (launch.controlNetPath) args.push('--control-net', launch.controlNetPath);
  if (launch.hiresUpscalersDir) args.push('--hires-upscalers-dir', launch.hiresUpscalersDir);
  if (launch.threads && launch.threads > 0) args.push('--threads', String(launch.threads));
  return args;
}

/**
 * Body of `POST /sdcpp/v1/img_gen`: the request, with the model's defaults for
 * anything unset.
 *
 * Every key below is one the server's own parser reads
 * (`SDGenerationParams::from_json_str`, examples/common/common.cpp at the
 * pinned build). Keys it does not read are worse than useless: the request
 * still succeeds, so the studio would report a reference image or a mask that
 * never reached the model.
 *
 * What is deliberately NOT here, having been looked for and not found at this
 * commit — each one would have been accepted by the server and silently
 * dropped, and the studio would have claimed it worked:
 *
 *  - ADetailer (`ad_model`, `ad_prompt`, `extra_ad_args`): the strings do not
 *    occur anywhere in the runtime's source. There is no detect-and-inpaint
 *    pass to drive.
 *  - IP-Adapter (`ip_adapter_image`, `ip_adapter_strength`): likewise absent.
 *  - `guidance_schedule`: not a key any parser reads.
 *  - PhotoMaker and PuLID: `SDGenerationParams` has the fields, but
 *    `from_json_str` never reads them — they are set from the command line
 *    only, so they belong to the runtime profile, not to a job.
 *  - `upscale_repeats`: parsed here, acted on by the CLI alone.
 */
export function buildSdJobPayload(request: AiImageRequest, entry: ImageCatalogModel): Record<string, unknown> {
  const steps = request.steps ?? entry.defaults.steps;
  const cfg = request.guidance ?? entry.defaults.cfg;
  const guidance: Record<string, unknown> = {
    txt_cfg: cfg,
    distilled_guidance: request.distilledGuidance ?? entry.defaults.distilledGuidance ?? (entry.family === 'flux' ? 1 : 3.5),
  };
  const sampleParams: Record<string, unknown> = {
    sample_method: isSdSampler(request.sampler) ? request.sampler : entry.defaults.sampler,
    sample_steps: Math.max(1, Math.min(SD_MAX_STEPS, Math.floor(steps))),
    guidance,
    ...(isSdScheduler(request.scheduler)
      ? { scheduler: request.scheduler }
      : entry.defaults.scheduler
        ? { scheduler: entry.defaults.scheduler }
        : {}),
  };
  const payload: Record<string, unknown> = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt ?? '',
    width: snap(request.width),
    height: snap(request.height),
    seed: request.seed === undefined ? -1 : request.seed,
    batch_count: Math.max(1, Math.min(4, Math.floor(request.n || 1))),
    sample_params: sampleParams,
    output_format: 'png',
    // On, so every PNG carries the settings that made it. The server writes an
    // A1111-compatible `parameters` tEXt chunk (see src/services/imageMetadata.ts),
    // which is what makes "iterate on this image" possible from a file the app
    // has never seen.
    embed_image_metadata: true,
  };
  // LoRA: this build REFUSES to read `<lora:NAME:WEIGHT>` out of a prompt on
  // any server API — routes_sdcpp.cpp passes an empty LoRA directory to
  // `resolve_and_validate` with the comment "Intentionally disable
  // prompt-embedded LoRA tag parsing for server APIs". A token left in the
  // prompt is therefore not ignored, it is ENCODED: it reaches the text encoder
  // as literal words. The structured field is the only path that works.
  // `path` is resolved against the server's listing of `--lora-model-dir`,
  // which carries the extension, so the file name is what goes on the wire.
  const loras = (request.loras ?? []).filter((lora) => isSdLoraName(lora.name));
  if (loras.length) {
    payload.lora = loras.map((lora) => ({
      path: lora.fileName ?? lora.name,
      multiplier: clampLoraWeight(lora.weight),
    }));
  }
  // img2img: seed generation from a reference image. `init_image` is a data URL
  // and `strength` (0..1, lower = closer to the reference) sit at the top level,
  // matching the sd-server's native img_gen schema.
  if (request.initImage) {
    payload.init_image = request.initImage;
    payload.strength = Math.max(0, Math.min(1, request.strength ?? 0.75));
    // Inpainting only means anything over an init image: on its own a mask has
    // nothing to preserve, and the server would repaint the whole frame.
    if (request.maskImage) payload.mask_image = request.maskImage;
  }
  // Multi-reference conditioning. Only a Kontext-style model reads these; for
  // anything else the array is accepted and dropped, so refuse to send it and
  // let the caller find out here rather than from a picture that ignored it.
  const refImages = (request.refImages ?? []).filter((image) => typeof image === 'string' && image.length > 0);
  if (refImages.length && entry.refImages) {
    payload.ref_images = refImages;
    if (request.increaseRefIndex) payload.increase_ref_index = true;
    if (request.disableAutoResizeRefImage) payload.auto_resize_ref_image = false;
  }
  if (request.controlImage) {
    payload.control_image = request.controlImage;
    payload.control_strength = clampControlStrength(request.controlStrength);
  }
  const hires = request.hiresFix;
  if (hires && typeof hires.upscaler === 'string' && hires.upscaler.length) {
    payload.hires = {
      enabled: true,
      upscaler: hires.upscaler,
      scale: Math.max(1, Math.min(4, hires.scale)),
      ...(hires.steps && hires.steps > 0 ? { steps: Math.min(SD_MAX_STEPS, Math.floor(hires.steps)) } : {}),
      ...(typeof hires.denoisingStrength === 'number'
        ? { denoising_strength: Math.max(0, Math.min(1, hires.denoisingStrength)) }
        : {}),
      ...(hires.tileSize && hires.tileSize > 0 ? { upscale_tile_size: Math.floor(hires.tileSize) } : {}),
      // `target_width` / `target_height`, NOT the CLI's `target_w` / `target_h`.
      // The server reads the long spelling and would ignore the short one
      // without a word, leaving the studio to report a resolution the second
      // pass never rendered at.
      ...(hires.targetWidth && hires.targetHeight
        ? { target_width: snap(hires.targetWidth), target_height: snap(hires.targetHeight) }
        : {}),
      ...(isSdSigmaArray(hires.customSigmas) ? { custom_sigmas: hires.customSigmas } : {}),
    };
  }

  // ---- everything below is read by `from_json_str` and was previously unsent -

  // CLIP-skip. The server's "unspecified" is <= 0, so only a real layer count
  // is worth sending; 0 would be indistinguishable from not asking.
  if (typeof request.clipSkip === 'number' && Number.isInteger(request.clipSkip) && request.clipSkip > 0) {
    payload.clip_skip = request.clipSkip;
  }

  // `eta`, `flow_shift` and `shifted_timestep` live INSIDE `sample_params`.
  // At the top level the parser never looks for them and the request would
  // succeed having ignored all three.
  if (typeof request.eta === 'number' && Number.isFinite(request.eta)) sampleParams.eta = request.eta;
  if (typeof request.flowShift === 'number' && Number.isFinite(request.flowShift)) sampleParams.flow_shift = request.flowShift;
  if (typeof request.shiftedTimestep === 'number' && Number.isInteger(request.shiftedTimestep)) {
    sampleParams.shifted_timestep = request.shiftedTimestep;
  }
  // Custom sigmas REPLACE the scheduler rather than tune it, so the scheduler
  // key is dropped: leaving both is not an error, but it would make the recipe
  // read as though a schedule that had no effect was the one in force.
  if (isSdSigmaArray(request.customSigmas)) {
    sampleParams.custom_sigmas = request.customSigmas;
    delete sampleParams.scheduler;
  }
  const extraSampleArgs = formatExtraSampleArgs(request.extraSampleArgs);
  if (extraSampleArgs) sampleParams.extra_sample_args = extraSampleArgs;

  // Image guidance: only the instruction-edit models read it, but the field is
  // parsed for every model, so sending it costs nothing where it is ignored.
  if (typeof request.imageGuidance === 'number' && Number.isFinite(request.imageGuidance)) {
    guidance.img_cfg = request.imageGuidance;
  }
  // Skip-Layer Guidance. `layers` is the only part with no usable default —
  // the runtime ships {7,8,9} — so the block is sent only when a layer list
  // makes it meaningful, and `scale` 0 disables it however it is spelled.
  const slg = request.skipLayerGuidance;
  if (slg && isSdLayerArray(slg.layers)) {
    guidance.slg = {
      layers: slg.layers,
      ...(typeof slg.layerStart === 'number' && Number.isFinite(slg.layerStart) ? { layer_start: slg.layerStart } : {}),
      ...(typeof slg.layerEnd === 'number' && Number.isFinite(slg.layerEnd) ? { layer_end: slg.layerEnd } : {}),
      ...(typeof slg.scale === 'number' && Number.isFinite(slg.scale) ? { scale: slg.scale } : {}),
    };
  }

  // Inference cache: a wrong `cache_mode` is refused outright by the server
  // (`initialize_cache_params` returns false), unlike a wrong sampler name.
  if (isSdCacheMode(request.cacheMode) && request.cacheMode !== 'disabled') {
    payload.cache_mode = request.cacheMode;
    if (typeof request.cacheOption === 'string' && request.cacheOption.length) {
      payload.cache_option = request.cacheOption;
    }
  }

  // Tiled VAE, for a decode that would otherwise not fit on the card. The
  // launch line already passes `--vae-tiling`, so this block is how a job
  // overrides the tile geometry rather than how tiling is turned on.
  const tiling = request.vaeTiling;
  if (tiling) {
    const params: Record<string, unknown> = { enabled: tiling.enabled !== false };
    if (tiling.tileSizeX && tiling.tileSizeX > 0) params.tile_size_x = Math.floor(tiling.tileSizeX);
    if (tiling.tileSizeY && tiling.tileSizeY > 0) params.tile_size_y = Math.floor(tiling.tileSizeY);
    if (typeof tiling.targetOverlap === 'number' && Number.isFinite(tiling.targetOverlap)) {
      params.target_overlap = tiling.targetOverlap;
    }
    if (typeof tiling.relSizeX === 'number' && Number.isFinite(tiling.relSizeX)) params.rel_size_x = tiling.relSizeX;
    if (typeof tiling.relSizeY === 'number' && Number.isFinite(tiling.relSizeY)) params.rel_size_y = tiling.relSizeY;
    payload.vae_tiling_params = params;
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
