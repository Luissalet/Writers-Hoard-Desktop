// ============================================================================
// AI runtime — shared contracts (pure data, no DOM, no Dexie, no Node)
// ============================================================================
//
// Imported by the renderer (settings page, copilot dock, image studio), by the
// Electron main process (connection store, inference gateway, agent loop) and
// by the tests. Nothing in this folder may touch `window`, `db` or `electron`;
// that is what lets one type describe a request on both sides of the IPC.

// Type-only, and therefore erased: `recipe.ts` imports `AiImageRequest` from
// here, so a value import either way would be a real cycle.
import type { Recipe } from './recipe';

/**
 * Wire protocol a connection speaks. `sdcpp` is the managed local image
 * server (stable-diffusion.cpp) — never user-created, always the builtin.
 */
export type AiConnectionKind = 'openai-compatible' | 'ollama' | 'sdcpp';

export type AiModelType = 'chat' | 'image';

export type AiCapability =
  | 'chat'
  | 'streaming'
  | 'tools'
  | 'vision'
  | 'thinking'
  | 'image-generation'
  | 'image-editing';

/** Where a server lives, derived from its host — drives the privacy badge. */
export type AiLocality = 'embedded' | 'loopback' | 'lan' | 'remote';

export type AiConnectionStatus = 'unknown' | 'online' | 'loading' | 'offline' | 'error';

/** What the renderer sees. Never carries a secret — only that one exists. */
export interface AiConnectionSummary {
  id: string;
  name: string;
  kind: AiConnectionKind;
  /** Normalised origin + base path, e.g. "http://192.168.1.20:1234/v1". */
  baseUrl: string;
  enabled: boolean;
  hasSecret: boolean;
  /** "sk-…a1b2" — enough to recognise a key, never enough to use it. */
  secretHint?: string;
  locality: AiLocality;
  /** Kinds of model this server is expected to serve. */
  modelTypes: AiModelType[];
  /** Models the user typed in by hand when /models is missing or incomplete. */
  pinnedModels: string[];
  /** Plain HTTP to a non-local host is refused unless the user opts in. */
  allowInsecureRemote?: boolean;
  /**
   * Synthesised by main, not stored: the embedded/system Ollama the app
   * already manages. Cannot be deleted or renamed from the settings page.
   */
  builtin?: boolean;
  status: AiConnectionStatus;
  latencyMs?: number;
  lastCheckedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/** Fields the settings page may write. Everything else is main's business. */
export interface AiConnectionInput {
  id?: string;
  name: string;
  kind: AiConnectionKind;
  /** Anything the user typed: "192.168.1.20:1234", "http://host/v1", … */
  baseUrl: string;
  enabled?: boolean;
  modelTypes?: AiModelType[];
  pinnedModels?: string[];
  allowInsecureRemote?: boolean;
}

export interface AiModelDescriptor {
  connectionId: string;
  id: string;
  type: AiModelType;
  capabilities: AiCapability[];
  /** Display label when the server gives one; otherwise the id. */
  label?: string;
  family?: string;
  contextWindow?: number;
  sizeBytes?: number;
  parameterCountB?: number;
  /** MoE models: parameters active per token, which is what speed tracks. */
  activeParameterCountB?: number;
  quantization?: string;
  /** Present on local servers: the weights are on disk. */
  installed?: boolean;
  /** True when the entry was pinned by hand rather than reported by the server. */
  pinned?: boolean;
  /** Generation speed this machine has actually seen from the model, tok/s. */
  measuredTokensPerSecond?: number;
  measuredAt?: number;
  /** Image models: the resolution the weights were trained at. */
  nativeWidth?: number;
  nativeHeight?: number;
}

export interface AiRouteSelection {
  connectionId: string;
  modelId: string;
}

export interface AiDefaults {
  chat?: AiRouteSelection;
  image?: AiRouteSelection;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type AiChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
  /** Assistant turns that asked for tools. */
  toolCalls?: AiToolCall[];
  /** Tool turns: which call this answers. */
  toolCallId?: string;
  /** Tool turns: the tool's name (Ollama wants it, OpenAI ignores it). */
  name?: string;
}

/** JSON-schema function description, provider-neutral. */
export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON schema object; serialised as-is into the provider's tool format. */
  parameters: object;
}

export interface AiChatRequest {
  connectionId: string;
  modelId: string;
  messages: AiChatMessage[];
  tools?: AiToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /** Ollama only: context window to allocate. Ignored elsewhere. */
  contextTokens?: number;
  /** Thinking-family models: ask for a direct answer (faster). Default true. */
  disableThinking?: boolean;
  /**
   * Ollama only: unload the model as soon as this answer is done
   * (`keep_alive: 0`). For a text→image hand-off on one GPU, so the diffusion
   * model that runs next finds the VRAM free instead of falling back to CPU.
   * Costs a reload (seconds) on the next text request; use it only when an
   * image generation follows immediately. Ignored elsewhere.
   */
  releaseAfter?: boolean;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Time spent generating, ms — the server's figure when it reports one. */
  evalDurationMs?: number;
  /** completionTokens over evalDuration: the speed the fit badge shows. */
  tokensPerSecond?: number;
  /** True when tokens were counted here from characters, not by the server. */
  approximate?: boolean;
}

/** What one connection+model has actually done on this machine. */
export interface ModelSpeedMetric {
  /** Exponentially smoothed generation speed. */
  tokensPerSecond: number;
  samples: number;
  lastAt: number;
  /** Last sample's size, so a reader can judge how solid the number is. */
  lastCompletionTokens: number;
  approximate?: boolean;
}

/**
 * One streamed event. `requestId` is attached by the IPC layer; adapters emit
 * the bare event.
 */
export type AiStreamEvent =
  | { type: 'started'; connectionId: string; modelId: string }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; call: AiToolCall }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'done'; finishReason: 'stop' | 'tool-calls' | 'length' | 'unknown' }
  | { type: 'cancelled' }
  | { type: 'error'; code: AiErrorCode; message: string };

export type AiErrorCode =
  | 'no-connection'
  | 'connection-disabled'
  | 'no-model'
  | 'unreachable'
  | 'unauthorized'
  | 'bad-request'
  | 'tools-unsupported'
  | 'model-missing'
  | 'timeout'
  | 'cancelled'
  | 'policy'
  | 'server-error'
  | 'bad-response';

export interface AiCompleteResult {
  ok: boolean;
  content?: string;
  usage?: AiUsage;
  code?: AiErrorCode;
  error?: string;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * One LoRA applied to a generation. `name` is the file's name without its
 * extension, as the local runtime lists it; the weight is the usual 0..1.5
 * multiplier. Only the managed stable-diffusion.cpp server honours these.
 */
export interface AiLoraSelection {
  name: string;
  weight: number;
  /**
   * The file name with its extension. stable-diffusion.cpp resolves
   * `lora[].path` against its own listing of `--lora-model-dir`, and that
   * listing is keyed by the relative path INCLUDING the extension — a stem
   * alone resolves to nothing and the server rejects the whole request. The
   * main-process adapter fills this in from the folder it just scanned, so a
   * caller that only knows the display name still works.
   */
  fileName?: string;
}

export interface AiImageRequest {
  connectionId: string;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  /** Variants in one call. Servers that only do one get n sequential calls. */
  n: number;
  seed?: number;
  steps?: number;
  guidance?: number;
  quality?: string;
  /** img2img: a reference/init image as a data URL. Only local SD models use it. */
  initImage?: string;
  /** img2img denoise strength in [0,1]: lower stays closer to the reference. */
  strength?: number;
  /** LoRAs to apply, by name and weight. Local runtime only; ignored elsewhere. */
  loras?: AiLoraSelection[];

  // -- Local stable-diffusion.cpp only. Every field below maps to a key the
  // server's own parser reads (`SDGenerationParams::from_json_str`); a remote
  // provider adapter ignores them.

  /**
   * Reference images as data URLs, in order — the server's `ref_images`.
   * Only a Kontext-style model conditions on them (`ImageCatalogModel.refImages`);
   * everything else accepts the array and quietly ignores it.
   */
  refImages?: string[];
  /**
   * Index the references by position so the prompt can say "the first image".
   * Off by default, which is how the runtime behaves without it.
   */
  increaseRefIndex?: boolean;
  /** Keep reference images at their own size instead of resizing them to the output. */
  disableAutoResizeRefImage?: boolean;
  /** ControlNet hint image (pose skeleton, edge map, depth map) as a data URL. */
  controlImage?: string;
  /**
   * Catalogue id of the ControlNet the server should be holding. It is a
   * context option, not a request field: naming a different one restarts the
   * server, so it is only worth setting alongside `controlImage`.
   */
  controlNetModel?: string;
  /** How hard the hint pulls, 0..1. See `clampControlStrength` for the band. */
  controlStrength?: number;
  /** Inpainting mask as a data URL: white is repainted. Needs `initImage`. */
  maskImage?: string;
  /**
   * Second pass at a larger size. `upscaler` is either one of the built-in
   * names or the stem — no extension — of a model in the upscalers folder;
   * the server resolves an unknown name as a file and refuses the job when it
   * cannot find one.
   */
  hiresFix?: {
    upscaler: string;
    scale: number;
    steps?: number;
    denoisingStrength?: number;
    tileSize?: number;
    /** Exact output size, overriding `scale`. Sent as `target_width`/`target_height`. */
    targetWidth?: number;
    targetHeight?: number;
    /** Sigma schedule for the second pass alone. */
    customSigmas?: number[];
  };
  /** Sampler name; unknown names are dropped rather than sent. */
  sampler?: string;
  /** Scheduler name; unknown names are dropped rather than sent. */
  scheduler?: string;
  /**
   * Sigma schedule given outright. It REPLACES the scheduler rather than
   * tuning it, so naming both is meaningless and the scheduler is dropped.
   */
  customSigmas?: number[];
  /** Layers of the text encoder to stop short of. Unset means the model's own. */
  clipSkip?: number;
  /** Ancestral noise (`sample_params.eta`). Only the ancestral samplers read it. */
  eta?: number;
  /** Timestep shift for the flow-matching models (`sample_params.flow_shift`). */
  flowShift?: number;
  /** `sample_params.shifted_timestep`, for the models that take one. */
  shiftedTimestep?: number;
  /**
   * `guidance.distilled_guidance`. Overrides the catalogue default, which is
   * otherwise the only thing that ever sets it.
   */
  distilledGuidance?: number;
  /** `guidance.img_cfg`: how hard an instruction-edit model holds the input image. */
  imageGuidance?: number;
  /**
   * Skip-Layer Guidance. `layers` is required because the runtime's own
   * default ({7, 8, 9}) is a SD3-shaped guess, and applying it to another
   * architecture degrades the image rather than improving it.
   */
  skipLayerGuidance?: {
    layers: number[];
    layerStart?: number;
    layerEnd?: number;
    scale?: number;
  };
  /**
   * Extra sampler arguments — Adaptive Projected Guidance among them. They
   * travel as one `key=value` string; see `formatExtraSampleArgs`.
   */
  extraSampleArgs?: SdExtraSampleArgsInput;
  /** Inference cache mode, e.g. `easycache`. An invalid one is refused by the server. */
  cacheMode?: string;
  /** `key=value` options for that cache mode. */
  cacheOption?: string;
  /** Tile geometry for the VAE decode. Tiling itself is already on at launch. */
  vaeTiling?: {
    enabled?: boolean;
    tileSizeX?: number;
    tileSizeY?: number;
    targetOverlap?: number;
    relSizeX?: number;
    relSizeY?: number;
  };
}

/**
 * The structured form of `sample_params.extra_sample_args`. Declared here
 * rather than imported so this module stays free of every other one; the
 * serializer that owns the wire spelling is `formatExtraSampleArgs` in
 * ./sdServer.ts, and the two are pinned together by the tests.
 */
export interface SdExtraSampleArgsInput {
  apgEta?: number;
  apgMomentum?: number;
  apgNormThreshold?: number;
  apgNormThresholdSmoothing?: number;
  slgUncond?: boolean;
  noiseClipStd?: number;
  noiseScaleStart?: number;
  noiseScaleEnd?: number;
  gamma?: number;
}

export interface AiGeneratedImage {
  base64: string;
  mimeType: string;
  seed?: number;
  revisedPrompt?: string;
  /**
   * The A1111 `parameters` line the runtime embedded in the file, read back out
   * of the PNG. It is the runtime's own account of what it did, which is worth
   * more than the app's account of what it asked for — the two differ whenever
   * the server clamped or substituted something.
   */
  parameters?: string;
  /**
   * The recipe for this exact image, already written into its PNG.
   *
   * Per image rather than per result because a batch is seeded seed, seed+1, …
   * and a recipe that named the wrong seed would reproduce a different picture
   * than the one it is attached to. `base64` already carries the same record in
   * a `writershoard` chunk, so a file exported from the Gallery keeps it.
   */
  recipe?: Recipe;
}

export interface AiImageResult {
  ok: boolean;
  images?: AiGeneratedImage[];
  code?: AiErrorCode;
  error?: string;
}

// ---------------------------------------------------------------------------
// Hardware and fit
// ---------------------------------------------------------------------------

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';

export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
  vramTotalBytes: number | null;
  vramFreeBytes: number | null;
}

export interface HardwareProfile {
  platform: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalBytes: number;
  ramFreeBytes: number;
  gpus: GpuInfo[];
  /** What the numbers were read with; the UI says so next to the estimate. */
  source: 'nvidia-smi' | 'os-only' | 'wmi';
  /** GPU memory figures are exact from nvidia-smi and a guess from anything else. */
  gpuConfidence: 'measured' | 'estimated' | 'none';
  detectedAt: number;
}

export type FitLabel = 'perfect' | 'good' | 'tight' | 'no-fit';

export interface FitEstimate {
  label: FitLabel;
  /** Weights + KV cache + runtime overhead, bytes. */
  totalBytes: number;
  weightsBytes: number;
  kvCacheBytes: number;
  contextTokens: number;
  placement: 'gpu' | 'split' | 'cpu' | 'none';
  /** Where the numbers came from: `measured` when the runtime reported the size. */
  confidence: 'measured' | 'estimated';
  /** Rough tokens/s band, only to set expectations. */
  speedHint: 'fast' | 'ok' | 'slow' | 'unusable';
  /** Tokens per second behind the hint: measured on this machine, or the bandwidth estimate. */
  tokensPerSecond?: number;
  speedSource: 'measured' | 'estimated';
}

// ---------------------------------------------------------------------------
// Probe results
// ---------------------------------------------------------------------------

export interface AiProbeResult {
  ok: boolean;
  latencyMs?: number;
  /** Server version string when the protocol exposes one. */
  version?: string;
  models?: AiModelDescriptor[];
  /** The server answered but has no /models route: usable only with pinned ids. */
  modelsRouteMissing?: boolean;
  code?: AiErrorCode;
  error?: string;
}

export interface AiDiscoveredServer {
  kind: AiConnectionKind;
  baseUrl: string;
  label: string;
  latencyMs: number;
  modelCount: number;
  /** Already saved as a connection (or is the builtin one). */
  known: boolean;
}
