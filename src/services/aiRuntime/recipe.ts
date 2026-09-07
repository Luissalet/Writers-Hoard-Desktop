// ============================================================================
// The Recipe — everything needed to make one picture again, two years later
// ============================================================================
//
// A generated image without a recipe is a dead end: the writer can look at it
// and cannot ask it for a sibling. This record is what makes "iterate on this",
// "compare these two" and "regenerate at a larger size" possible, and it has to
// keep working after the model has been re-quantised, the LoRA folder
// reorganised and the runtime upgraded twice.
//
// Three rules follow from that:
//
//  1. It records what the runtime WAS ASKED FOR *and* what identified the
//     assets — a model id alone is a name, and names get reused. The SHA-256
//     is what makes a recipe survive somebody re-downloading "sd15-q8" and
//     getting different weights.
//  2. It records the RESOLVED prompt as well as the written one. A prompt full
//     of wildcards resolves differently every run; without the resolved text
//     the recipe reproduces the dice, not the picture.
//  3. Nothing here is a promise about the future. `version` is on the record
//     itself so a reader two versions along knows what it is holding, and
//     every field added after v1 must be optional.
//
// Pure data and pure functions: no Dexie, no Electron, no DOM. The renderer
// writes recipes, the main process reads them back off a PNG, and the tests
// pin both.

import type { AiImageRequest, SdExtraSampleArgsInput } from './types';

/** Bumped only when a reader would misread an older record, never for additions. */
export const RECIPE_VERSION = 1;

// ---- The parts -------------------------------------------------------------

/**
 * The written text and the text that actually reached the encoder.
 *
 * They differ whenever a wildcard, a character reference or a style preset was
 * expanded. Storing only the written form would make the recipe reproduce the
 * roll of the dice rather than the picture; storing only the resolved form
 * would lose the author's intent and make the recipe uneditable.
 */
export interface RecipePrompt {
  positive: string;
  negative?: string;
  resolvedPositive: string;
  resolvedNegative?: string;
}

/** One weights file, identified by content rather than by name. */
export interface RecipeAsset {
  /** Catalogue id where there is one; otherwise the file name. */
  id: string;
  label?: string;
  fileName?: string;
  /** Lower-case hex SHA-256. Absent when the file was never verified. */
  sha256?: string;
  sizeBytes?: number;
}

export interface RecipeModel extends RecipeAsset {
  family?: string;
  /**
   * The individual weights files when the model is a set of them (a diffusion
   * model plus its VAE and text encoders). A FLUX recipe that recorded only
   * the diffusion model's digest would replay against the wrong text encoder
   * without noticing.
   */
  files?: RecipeAsset[];
}

export interface RecipeLora extends RecipeAsset {
  weight: number;
}

/**
 * How the noise was turned into an image. Every field the runtime reads and
 * the studio can set, so that two recipes differing in one of them are two
 * different recipes.
 */
export interface RecipeSampling {
  sampler: string;
  scheduler?: string;
  steps: number;
  /** Text guidance (`txt_cfg`). */
  cfg: number;
  distilledGuidance?: number;
  imageGuidance?: number;
  eta?: number;
  flowShift?: number;
  shiftedTimestep?: number;
  clipSkip?: number;
  /** Given outright, this replaces `scheduler` rather than tuning it. */
  customSigmas?: number[];
  skipLayerGuidance?: {
    layers: number[];
    layerStart?: number;
    layerEnd?: number;
    scale?: number;
  };
  extraSampleArgs?: SdExtraSampleArgsInput;
  cacheMode?: string;
  cacheOption?: string;
}

/**
 * Which noise. `rngMode` is part of the identity because the same integer seed
 * produces a different image under `cuda` than under `std_default`, and the
 * runtime's default has changed between releases before.
 */
export interface RecipeSeed {
  seed: number;
  rngMode?: string;
  /** Position in the batch this image came from, when it came from one. */
  batchIndex?: number;
  batchCount?: number;
}

export interface RecipeSize {
  width: number;
  height: number;
}

/**
 * An image this one was conditioned on. Only the Gallery id and a digest — the
 * bytes stay in the Gallery, so a recipe stays a few hundred bytes however
 * many references it names.
 */
export interface RecipeImageRef {
  /** Gallery row id (`inspirationImages`). */
  imageId: string;
  sha256?: string;
}

export interface RecipeInputs {
  /** img2img seed image, and how far the model was allowed to move from it. */
  initImage?: RecipeImageRef;
  strength?: number;
  /** Inpainting mask: white is repainted. */
  maskImage?: RecipeImageRef;
  controlImage?: RecipeImageRef;
  /** Catalogue id of the ControlNet the server held, and how hard it pulled. */
  controlNet?: string;
  controlStrength?: number;
  /** Multi-reference conditioning, in the order sent. */
  refImages?: RecipeImageRef[];
  increaseRefIndex?: boolean;
  disableAutoResizeRefImage?: boolean;
}

/**
 * One step of the chain that produced the final file.
 *
 * A picture is rarely one pass any more: a base render, then a hires second
 * pass, then perhaps a straight upscale. Recording them as a list rather than
 * as flags means a chain that grows a step later still reads, and a reader can
 * see the order things happened in.
 */
export type RecipePass =
  | { kind: 'base' }
  | {
      kind: 'hires';
      upscaler: string;
      scale?: number;
      targetWidth?: number;
      targetHeight?: number;
      steps?: number;
      denoisingStrength?: number;
      customSigmas?: number[];
      tileSize?: number;
    }
  | { kind: 'upscale'; upscaler: string; scale?: number };

/**
 * Which program made it. `runtimeProfileHash` is the launch-time identity of
 * the server (see electron/ai/sdRuntime.ts): two recipes agreeing on every
 * request field can still differ because one ran against a server built with a
 * ControlNet and the other did not.
 */
export interface RecipeBackend {
  /** `sdcpp` for the managed local server; other backends name themselves. */
  kind: string;
  version?: string;
  connectionId: string;
  runtimeProfileHash?: string;
}

/**
 * Everything needed to make this picture again.
 *
 * `id` and `createdAt` are the row's identity, NOT the picture's, and are
 * excluded from `recipeHash` — two writers who set the same knobs must get the
 * same hash, or deduplication and "compare recipes" both stop working.
 */
export interface Recipe {
  version: typeof RECIPE_VERSION;
  id: string;
  createdAt: number;
  prompt: RecipePrompt;
  model: RecipeModel;
  loras: RecipeLora[];
  sampling: RecipeSampling;
  seed: RecipeSeed;
  size: RecipeSize;
  inputs: RecipeInputs;
  passes: RecipePass[];
  backend: RecipeBackend;
  /** Set once the record has been hashed, so a stored row need not rehash. */
  hash?: string;
}

/**
 * A recipe as it sits in Dexie.
 *
 * Project-scoped like every other user table, so `deleteProject`'s generic
 * sweep — which picks up any table carrying a `projectId` index — takes these
 * with it and no orphan recipe outlives the project it belonged to.
 */
export interface ImageRecipeRow extends Recipe {
  projectId: string;
  /** Gallery row (`inspirationImages`) this recipe produced, when it produced one. */
  imageId?: string;
  updatedAt: number;
}

// ---- Canonical form and hashing --------------------------------------------

/**
 * Metadata attached to the Dexie row, not settings sent to the runtime.
 *
 * This list is deliberately applied only to the root object. An `id` nested
 * under `model`, a LoRA, a model file or an input image identifies an asset and
 * therefore changes the picture; recursively dropping names such as `id`
 * makes two materially different recipes compare equal.
 */
const RECIPE_ROW_METADATA = [
  'id',
  'projectId',
  'imageId',
  'createdAt',
  'updatedAt',
  'hash',
] as const;
const RECIPE_ROW_METADATA_SET = new Set<string>(RECIPE_ROW_METADATA);

/**
 * JSON with every object's keys in sorted order and every `undefined` dropped.
 *
 * Two recipes built by different code paths put their keys in different orders
 * and spell "absent" as either a missing key or an explicit `undefined`. If any
 * of that reached the hash, the same settings would hash two ways and the
 * whole record would be useless as an identity.
 *
 * Arrays keep their order: `[7, 8, 9]` and `[9, 8, 7]` are different skip-layer
 * sets and different reference-image orders.
 *
 * `dropRootRowMetadata` is kept for callers of the original helper, but is
 * intentionally shallow. Nested identity always remains semantic.
 */
export function canonicalJson(value: unknown, dropRootRowMetadata = false): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    // -0 and 0 are the same setting; JSON.stringify disagrees.
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined &&
        !(dropRootRowMetadata && RECIPE_ROW_METADATA_SET.has(key)))
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  // A function or a symbol cannot describe a picture; treat it as absent
  // rather than throwing inside what callers use as a pure accessor.
  return 'null';
}

/** The semantic root of a recipe, with only row metadata removed. */
function semanticRecipeProjection(recipe: Recipe): Record<string, unknown> {
  const semantic = { ...recipe } as Record<string, unknown>;
  for (const key of RECIPE_ROW_METADATA) delete semantic[key];
  return semantic;
}

// SHA-256 over UTF-8, in about forty lines. Implemented here rather than taken
// from WebCrypto because `crypto.subtle.digest` is asynchronous and a recipe's
// identity is wanted synchronously — in a render, in a Dexie key, in a test —
// and because this module must run unchanged in the renderer, in the Electron
// main process and in the esbuild-bundled test harness.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Lower-case hex SHA-256 of a string's UTF-8 bytes. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  // Message + 0x80 + zero padding to 56 mod 64 + an eight-byte length.
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // JavaScript numbers hold the bit length exactly up to 2^53, which is far
  // more text than any recipe: write the high word from the float, not a
  // BigInt, so this stays allocation-free.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  let out = '';
  for (const word of h) out += word.toString(16).padStart(8, '0');
  return out;
}

/**
 * The identity of the settings, not of the row.
 *
 * Stable across key order and across a field spelled `undefined` in one record
 * and missing in the other; unstable across any change that would change the
 * picture. Root row identity, ownership, timestamps and a previously stored
 * `hash` are excluded, so hashing before and after storing the result agrees.
 */
export function recipeHash(recipe: Recipe): string {
  return sha256Hex(canonicalJson(semanticRecipeProjection(recipe)));
}

// ---- Request ⇄ recipe ------------------------------------------------------

/**
 * The request that would make this picture again.
 *
 * Deliberately NOT resolved against what is installed: this returns what the
 * recipe asked for, and the caller checks whether the model and the LoRAs are
 * still there. A function that quietly swapped in the nearest installed model
 * would make every stored recipe untrustworthy, because no reader could tell
 * a faithful replay from a substituted one.
 *
 * Image inputs come back as Gallery IDS, not bytes: the caller resolves them
 * (and discovers a deleted reference) before generating.
 */
export function recipeToRequest(recipe: Recipe): AiImageRequest {
  const hires = recipe.passes.find((pass): pass is Extract<RecipePass, { kind: 'hires' }> => pass.kind === 'hires');
  const sampling = recipe.sampling;
  const request: AiImageRequest = {
    connectionId: recipe.backend.connectionId,
    modelId: recipe.model.id,
    prompt: recipe.prompt.resolvedPositive,
    width: recipe.size.width,
    height: recipe.size.height,
    n: 1,
    seed: recipe.seed.seed,
    steps: sampling.steps,
    guidance: sampling.cfg,
    sampler: sampling.sampler,
  };
  if (recipe.prompt.resolvedNegative) request.negativePrompt = recipe.prompt.resolvedNegative;
  if (sampling.scheduler) request.scheduler = sampling.scheduler;
  if (sampling.customSigmas) request.customSigmas = sampling.customSigmas;
  if (sampling.clipSkip !== undefined) request.clipSkip = sampling.clipSkip;
  if (sampling.eta !== undefined) request.eta = sampling.eta;
  if (sampling.flowShift !== undefined) request.flowShift = sampling.flowShift;
  if (sampling.shiftedTimestep !== undefined) request.shiftedTimestep = sampling.shiftedTimestep;
  if (sampling.distilledGuidance !== undefined) request.distilledGuidance = sampling.distilledGuidance;
  if (sampling.imageGuidance !== undefined) request.imageGuidance = sampling.imageGuidance;
  if (sampling.skipLayerGuidance) request.skipLayerGuidance = sampling.skipLayerGuidance;
  if (sampling.extraSampleArgs) request.extraSampleArgs = sampling.extraSampleArgs;
  if (sampling.cacheMode) request.cacheMode = sampling.cacheMode;
  if (sampling.cacheOption) request.cacheOption = sampling.cacheOption;
  if (recipe.loras.length) {
    request.loras = recipe.loras.map((lora) => ({
      name: lora.label ?? lora.id,
      weight: lora.weight,
      ...(lora.fileName ? { fileName: lora.fileName } : {}),
    }));
  }
  const inputs = recipe.inputs;
  if (inputs.strength !== undefined) request.strength = inputs.strength;
  if (inputs.controlNet) request.controlNetModel = inputs.controlNet;
  if (inputs.controlStrength !== undefined) request.controlStrength = inputs.controlStrength;
  if (inputs.increaseRefIndex) request.increaseRefIndex = true;
  if (inputs.disableAutoResizeRefImage) request.disableAutoResizeRefImage = true;
  if (hires) {
    request.hiresFix = {
      upscaler: hires.upscaler,
      scale: hires.scale ?? 2,
      ...(hires.steps !== undefined ? { steps: hires.steps } : {}),
      ...(hires.denoisingStrength !== undefined ? { denoisingStrength: hires.denoisingStrength } : {}),
      ...(hires.tileSize !== undefined ? { tileSize: hires.tileSize } : {}),
      ...(hires.targetWidth !== undefined ? { targetWidth: hires.targetWidth } : {}),
      ...(hires.targetHeight !== undefined ? { targetHeight: hires.targetHeight } : {}),
      ...(hires.customSigmas !== undefined ? { customSigmas: hires.customSigmas } : {}),
    };
  }
  return request;
}

/**
 * What the request alone cannot know.
 *
 * The seed when the caller left it random, the digests of the files that were
 * actually loaded, the prompt after expansion, and the Gallery ids of the
 * images that were sent as bytes — a request carries data URLs, and a recipe
 * must not, or every stored recipe would weigh a megabyte.
 */
export interface RecipeContext {
  id: string;
  createdAt?: number;
  /** The seed the runtime really used, which a request may have left unset. */
  seed: number;
  rngMode?: string;
  batchIndex?: number;
  resolvedPrompt?: string;
  resolvedNegativePrompt?: string;
  model?: Partial<RecipeModel>;
  /** Digests by LoRA name, for the ones that could be identified. */
  loraAssets?: Record<string, Pick<RecipeAsset, 'sha256' | 'sizeBytes' | 'fileName'>>;
  backendKind?: string;
  backendVersion?: string;
  runtimeProfileHash?: string;
  /** Gallery ids for the images the request carried as data URLs. */
  initImageId?: string;
  maskImageId?: string;
  controlImageId?: string;
  refImageIds?: string[];
}

/** The recipe for a request that has just been run. */
export function requestToRecipe(request: AiImageRequest, context: RecipeContext): Recipe {
  const sampling: RecipeSampling = {
    sampler: request.sampler ?? '',
    steps: request.steps ?? 0,
    cfg: request.guidance ?? 0,
  };
  if (request.scheduler) sampling.scheduler = request.scheduler;
  if (request.customSigmas) sampling.customSigmas = request.customSigmas;
  if (request.clipSkip !== undefined) sampling.clipSkip = request.clipSkip;
  if (request.eta !== undefined) sampling.eta = request.eta;
  if (request.flowShift !== undefined) sampling.flowShift = request.flowShift;
  if (request.shiftedTimestep !== undefined) sampling.shiftedTimestep = request.shiftedTimestep;
  if (request.distilledGuidance !== undefined) sampling.distilledGuidance = request.distilledGuidance;
  if (request.imageGuidance !== undefined) sampling.imageGuidance = request.imageGuidance;
  if (request.skipLayerGuidance) sampling.skipLayerGuidance = request.skipLayerGuidance;
  if (request.extraSampleArgs) sampling.extraSampleArgs = request.extraSampleArgs;
  if (request.cacheMode) sampling.cacheMode = request.cacheMode;
  if (request.cacheOption) sampling.cacheOption = request.cacheOption;

  const inputs: RecipeInputs = {};
  if (context.initImageId) inputs.initImage = { imageId: context.initImageId };
  if (request.strength !== undefined) inputs.strength = request.strength;
  if (context.maskImageId) inputs.maskImage = { imageId: context.maskImageId };
  if (context.controlImageId) inputs.controlImage = { imageId: context.controlImageId };
  if (request.controlNetModel) inputs.controlNet = request.controlNetModel;
  if (request.controlStrength !== undefined) inputs.controlStrength = request.controlStrength;
  if (context.refImageIds?.length) inputs.refImages = context.refImageIds.map((imageId) => ({ imageId }));
  if (request.increaseRefIndex) inputs.increaseRefIndex = true;
  if (request.disableAutoResizeRefImage) inputs.disableAutoResizeRefImage = true;

  const passes: RecipePass[] = [{ kind: 'base' }];
  const hires = request.hiresFix;
  if (hires?.upscaler) {
    passes.push({
      kind: 'hires',
      upscaler: hires.upscaler,
      ...(hires.scale !== undefined ? { scale: hires.scale } : {}),
      ...(hires.steps !== undefined ? { steps: hires.steps } : {}),
      ...(hires.denoisingStrength !== undefined ? { denoisingStrength: hires.denoisingStrength } : {}),
      ...(hires.tileSize !== undefined ? { tileSize: hires.tileSize } : {}),
      ...(hires.targetWidth !== undefined ? { targetWidth: hires.targetWidth } : {}),
      ...(hires.targetHeight !== undefined ? { targetHeight: hires.targetHeight } : {}),
      ...(hires.customSigmas !== undefined ? { customSigmas: hires.customSigmas } : {}),
    });
  }

  const recipe: Recipe = {
    version: RECIPE_VERSION,
    id: context.id,
    createdAt: context.createdAt ?? Date.now(),
    prompt: {
      positive: request.prompt,
      ...(request.negativePrompt ? { negative: request.negativePrompt } : {}),
      resolvedPositive: context.resolvedPrompt ?? request.prompt,
      ...(context.resolvedNegativePrompt ?? request.negativePrompt
        ? { resolvedNegative: context.resolvedNegativePrompt ?? request.negativePrompt }
        : {}),
    },
    model: { id: request.modelId, ...context.model },
    loras: (request.loras ?? []).map((lora) => {
      const asset = context.loraAssets?.[lora.name];
      return {
        id: lora.name,
        label: lora.name,
        weight: lora.weight,
        ...(lora.fileName ? { fileName: lora.fileName } : {}),
        ...(asset ?? {}),
      };
    }),
    sampling,
    seed: {
      seed: context.seed,
      ...(context.rngMode ? { rngMode: context.rngMode } : {}),
      ...(context.batchIndex !== undefined ? { batchIndex: context.batchIndex } : {}),
      ...(request.n > 1 ? { batchCount: request.n } : {}),
    },
    size: { width: request.width, height: request.height },
    inputs,
    passes,
    backend: {
      kind: context.backendKind ?? 'sdcpp',
      connectionId: request.connectionId,
      ...(context.backendVersion ? { version: context.backendVersion } : {}),
      ...(context.runtimeProfileHash ? { runtimeProfileHash: context.runtimeProfileHash } : {}),
    },
  };
  recipe.hash = recipeHash(recipe);
  return recipe;
}

// ---- PNG round trip --------------------------------------------------------

/**
 * The `writershoard` chunk's payload: an envelope, not a bare recipe.
 *
 * The envelope exists so a reader can tell OUR record from somebody else's
 * chunk of the same name before trusting a single field of it, and so a future
 * shape can be recognised rather than half-parsed.
 */
export const RECIPE_ENVELOPE_KIND = 'writers-hoard.image.recipe';

export interface RecipeEnvelope extends Record<string, unknown> {
  kind: typeof RECIPE_ENVELOPE_KIND;
  version: number;
  recipe: Recipe;
}

/** The record to hand `writePngMetadata` as `writersHoard`. */
export function recipeEnvelope(recipe: Recipe): RecipeEnvelope {
  return { kind: RECIPE_ENVELOPE_KIND, version: RECIPE_VERSION, recipe };
}

/**
 * Where a recovered recipe came from, because they are not equally
 * trustworthy: `writers-hoard` is the record we wrote and is complete; `sdcpp`
 * is the runtime's own JSON, which knows the settings but not the Gallery;
 * `a1111` is a flat line parsed by guesswork. A caller that shows the reader
 * "restored from this file" should say which, and must not present the last
 * two as though the app had made the picture itself.
 */
export type RecipeSource = 'writers-hoard' | 'sdcpp' | 'a1111';

export interface RecoveredRecipe {
  recipe: Recipe;
  source: RecipeSource;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // A1111 writes floats through std::to_string, so "7.000000" is normal.
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isRecipeShaped(value: unknown): value is Recipe {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Recipe>;
  return (
    typeof r.version === 'number' &&
    typeof r.prompt === 'object' && r.prompt !== null &&
    typeof r.model === 'object' && r.model !== null &&
    typeof r.sampling === 'object' && r.sampling !== null &&
    Array.isArray(r.loras) &&
    Array.isArray(r.passes)
  );
}

/** An empty recipe to fill in, so every reconstruction has the same shape. */
function blankRecipe(connectionId: string): Recipe {
  return {
    version: RECIPE_VERSION,
    id: '',
    createdAt: 0,
    prompt: { positive: '', resolvedPositive: '' },
    model: { id: '' },
    loras: [],
    sampling: { sampler: '', steps: 0, cfg: 0 },
    seed: { seed: -1 },
    size: { width: 0, height: 0 },
    inputs: {},
    passes: [{ kind: 'base' }],
    backend: { kind: 'sdcpp', connectionId },
  };
}

/**
 * A recipe out of stable-diffusion.cpp's own `SDCPP: {…}` JSON.
 *
 * Field names follow `build_sdcpp_image_metadata_json` in
 * examples/common/common.cpp at the pinned build — `sampling` carries the
 * sample params, `models.model` the weights file's BASENAME (not a digest, and
 * not a catalogue id), and `loras[]` names with multipliers.
 */
function fromSdcppRecord(record: Record<string, unknown>, connectionId: string): Recipe | null {
  if (record.schema !== 'sdcpp.image.params/v1') return null;
  const recipe = blankRecipe(connectionId);
  const prompt = record.prompt as Record<string, unknown> | undefined;
  if (prompt) {
    const positive = typeof prompt.positive === 'string' ? prompt.positive : '';
    recipe.prompt.positive = positive;
    // The runtime records only what it was given, which is already resolved:
    // whatever the studio expanded is invisible from here, so the two are the
    // same text and the recipe must not pretend otherwise.
    recipe.prompt.resolvedPositive = positive;
    if (typeof prompt.negative === 'string' && prompt.negative) {
      recipe.prompt.negative = prompt.negative;
      recipe.prompt.resolvedNegative = prompt.negative;
    }
  }
  const sampling = record.sampling as Record<string, unknown> | undefined;
  if (sampling) {
    if (typeof sampling.sample_method === 'string') recipe.sampling.sampler = sampling.sample_method;
    if (typeof sampling.scheduler === 'string') recipe.sampling.scheduler = sampling.scheduler;
    const steps = num(sampling.sample_steps);
    if (steps !== undefined) recipe.sampling.steps = steps;
    const eta = num(sampling.eta);
    if (eta !== undefined) recipe.sampling.eta = eta;
    const flowShift = num(sampling.flow_shift);
    if (flowShift !== undefined) recipe.sampling.flowShift = flowShift;
    const guidance = sampling.guidance as Record<string, unknown> | undefined;
    if (guidance) {
      const cfg = num(guidance.txt_cfg);
      if (cfg !== undefined) recipe.sampling.cfg = cfg;
      const img = num(guidance.img_cfg);
      if (img !== undefined) recipe.sampling.imageGuidance = img;
      const distilled = num(guidance.distilled_guidance);
      if (distilled !== undefined) recipe.sampling.distilledGuidance = distilled;
      const slg = guidance.slg as Record<string, unknown> | undefined;
      if (slg && Array.isArray(slg.layers) && slg.layers.length) {
        recipe.sampling.skipLayerGuidance = {
          layers: slg.layers.filter((n): n is number => typeof n === 'number'),
          ...(num(slg.layer_start) !== undefined ? { layerStart: num(slg.layer_start) } : {}),
          ...(num(slg.layer_end) !== undefined ? { layerEnd: num(slg.layer_end) } : {}),
          ...(num(slg.scale) !== undefined ? { scale: num(slg.scale) } : {}),
        };
      }
    }
  }
  const seed = num(record.seed);
  if (seed !== undefined) recipe.seed.seed = seed;
  if (typeof record.rng === 'string') recipe.seed.rngMode = record.rng;
  const width = num(record.width);
  const height = num(record.height);
  if (width !== undefined) recipe.size.width = width;
  if (height !== undefined) recipe.size.height = height;
  const clipSkip = num(record.clip_skip);
  // The runtime spells "unspecified" as <= 0; carrying that through as a real
  // setting would make a replay ask for a CLIP-skip nobody chose.
  if (clipSkip !== undefined && clipSkip > 0) recipe.sampling.clipSkip = clipSkip;
  const strength = num(record.strength);
  if (strength !== undefined) recipe.inputs.strength = strength;
  const controlStrength = num(record.control_strength);
  if (controlStrength !== undefined) recipe.inputs.controlStrength = controlStrength;

  const models = record.models as Record<string, unknown> | undefined;
  if (models && typeof models.model === 'string') recipe.model = { id: models.model, label: models.model };
  else if (models && typeof models.diffusion_model === 'string') {
    recipe.model = { id: models.diffusion_model, label: models.diffusion_model };
  }
  if (Array.isArray(record.loras)) {
    for (const entry of record.loras) {
      if (!entry || typeof entry !== 'object') continue;
      const lora = entry as Record<string, unknown>;
      if (typeof lora.name !== 'string') continue;
      recipe.loras.push({ id: lora.name, label: lora.name, weight: num(lora.multiplier) ?? 1 });
    }
  }
  const hires = record.hires as Record<string, unknown> | undefined;
  if (hires?.enabled === true && typeof hires.upscaler === 'string') {
    recipe.passes.push({
      kind: 'hires',
      upscaler: hires.upscaler,
      ...(num(hires.scale) !== undefined ? { scale: num(hires.scale) } : {}),
      ...(num(hires.steps) ? { steps: num(hires.steps) } : {}),
      ...(num(hires.denoising_strength) !== undefined ? { denoisingStrength: num(hires.denoising_strength) } : {}),
      ...(num(hires.target_width) ? { targetWidth: num(hires.target_width) } : {}),
      ...(num(hires.target_height) ? { targetHeight: num(hires.target_height) } : {}),
    });
  }
  const generator = record.generator as Record<string, unknown> | undefined;
  if (generator && typeof generator.version === 'string') recipe.backend.version = generator.version;
  return recipe;
}

/** A recipe out of the flat A1111 line: everything it can carry, and no more. */
function fromA1111(
  parsed: { prompt: string; negativePrompt?: string; fields: Record<string, string> },
  connectionId: string,
): Recipe {
  const recipe = blankRecipe(connectionId);
  const f = parsed.fields;
  recipe.prompt.positive = parsed.prompt;
  recipe.prompt.resolvedPositive = parsed.prompt;
  if (parsed.negativePrompt) {
    recipe.prompt.negative = parsed.negativePrompt;
    recipe.prompt.resolvedNegative = parsed.negativePrompt;
  }
  // "Sampler" is `euler_a karras` — the scheduler is appended with a space
  // unless custom sigmas replaced it. Splitting on the LAST space is right
  // because no sampler name in the table contains one and every scheduler
  // name is a single token.
  const sampler = f.Sampler ?? '';
  const space = sampler.lastIndexOf(' ');
  if (space > 0) {
    recipe.sampling.sampler = sampler.slice(0, space);
    recipe.sampling.scheduler = sampler.slice(space + 1);
  } else if (sampler) {
    recipe.sampling.sampler = sampler;
  }
  recipe.sampling.steps = num(f.Steps) ?? 0;
  recipe.sampling.cfg = num(f['CFG scale']) ?? 0;
  const guidance = num(f.Guidance);
  if (guidance !== undefined) recipe.sampling.distilledGuidance = guidance;
  const eta = num(f.Eta);
  if (eta !== undefined) recipe.sampling.eta = eta;
  const clipSkip = num(f['Clip skip']);
  if (clipSkip !== undefined && clipSkip > 0) recipe.sampling.clipSkip = clipSkip;
  const seed = num(f.Seed);
  if (seed !== undefined) recipe.seed.seed = seed;
  if (f.RNG) recipe.seed.rngMode = f.RNG;
  const size = /^(\d+)x(\d+)$/.exec(f.Size ?? '');
  if (size) {
    recipe.size.width = Number(size[1]);
    recipe.size.height = Number(size[2]);
  }
  if (f.Model) recipe.model = { id: f.Model, label: f.Model };
  if (f['Hires upscale']) {
    recipe.passes.push({
      kind: 'hires',
      upscaler: f['Hires upscale'],
      ...(num(f['Hires scale']) !== undefined ? { scale: num(f['Hires scale']) } : {}),
      ...(num(f['Hires steps']) ? { steps: num(f['Hires steps']) } : {}),
      ...(num(f['Denoising strength']) !== undefined ? { denoisingStrength: num(f['Denoising strength']) } : {}),
    });
  }
  return recipe;
}

/**
 * The recipe a PNG carries, whoever wrote it.
 *
 * Preference order is trust order: our own envelope first, then the runtime's
 * structured JSON, then the flat A1111 line. Returns null when the file says
 * nothing about how it was made — which is the honest answer for a photograph,
 * and must not be a thrown exception, because this runs on whatever the reader
 * drags into the window.
 *
 * `parseParameters` and `readRecord` are injected so this module never has to
 * import the PNG reader; callers pass the two functions from
 * services/imageMetadata.ts.
 */
export function recoverRecipe(
  metadata: { parameters?: string; writersHoard?: Record<string, unknown> },
  helpers: {
    parseParameters: (text: string) => { prompt: string; negativePrompt?: string; fields: Record<string, string> };
    readRecord: (parameters: string) => Record<string, unknown> | undefined;
  },
  connectionId = '',
): RecoveredRecipe | null {
  const envelope = metadata.writersHoard;
  if (envelope && envelope.kind === RECIPE_ENVELOPE_KIND && isRecipeShaped(envelope.recipe)) {
    return { recipe: envelope.recipe, source: 'writers-hoard' };
  }
  // A file written by an older build that stored the recipe unwrapped still
  // reads: it is our own record either way, and refusing it would lose a
  // reader's history for the sake of an envelope added later.
  if (isRecipeShaped(envelope)) return { recipe: envelope, source: 'writers-hoard' };
  const parameters = metadata.parameters;
  if (!parameters) return null;
  const record = helpers.readRecord(parameters);
  if (record) {
    const recipe = fromSdcppRecord(record, connectionId);
    if (recipe) return { recipe, source: 'sdcpp' };
  }
  const parsed = helpers.parseParameters(parameters);
  // A line with neither a prompt nor a single recognised setting is not a
  // recipe; handing back an empty one would let the studio claim it restored
  // something.
  if (!parsed.prompt && !Object.keys(parsed.fields).length) return null;
  return { recipe: fromA1111(parsed, connectionId), source: 'a1111' };
}

// ---- Comparing -------------------------------------------------------------

export interface RecipeDiffEntry {
  /** Dotted path into the recipe, e.g. `sampling.steps` or `loras.0.weight`. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface RecipeDiff {
  identical: boolean;
  changes: RecipeDiffEntry[];
}

function walk(before: unknown, after: unknown, path: string, out: RecipeDiffEntry[]): void {
  if (before === after) return;
  const bothObjects =
    before !== null && after !== null && typeof before === 'object' && typeof after === 'object' &&
    Array.isArray(before) === Array.isArray(after);
  if (!bothObjects) {
    // A value replaced by one of another shape is one change, not a subtree of
    // them: "the LoRA list became empty" reads better than nine removals.
    if (canonicalJson(before) !== canonicalJson(after)) out.push({ path, before, after });
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) walk(before[i], after[i], `${path}.${i}`, out);
    return;
  }
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (RECIPE_ROW_METADATA_SET.has(key) && !path) continue;
    walk(a[key], b[key], path ? `${path}.${key}` : key, out);
  }
}

/**
 * What changed between two recipes, by name.
 *
 * Root row identity, ownership, timestamps and `hash` are skipped, so comparing a
 * recipe with a copy of itself made a day later reports no changes — which is
 * the honest answer to "did anything about this picture change".
 */
export function diffRecipes(before: Recipe, after: Recipe): RecipeDiff {
  const changes: RecipeDiffEntry[] = [];
  walk(before, after, '', changes);
  return { identical: changes.length === 0, changes };
}

// ---- Replay safety ---------------------------------------------------------

export interface RecipeAvailability {
  /** Catalogue ids of the image models installed right now. */
  installedModelIds: readonly string[];
  /** LoRA file names present in the LoRA folder. */
  installedLoraFileNames?: readonly string[];
}

export interface RecipeReplayCheck {
  ok: boolean;
  missingModel?: string;
  /** Installed models of the same family, nearest first — an OFFER, never a swap. */
  suggestedModels: string[];
  missingLoras: string[];
}

/**
 * Whether this recipe can be replayed faithfully, and what is missing if not.
 *
 * This function never substitutes anything. It reports, and the caller shows
 * the reader what is gone and what could stand in — because a recipe that
 * silently replays against a different model produces an image that disagrees
 * with its own record, and one of those is enough to make a writer stop
 * trusting every recipe they have stored.
 */
export function checkRecipeReplay(recipe: Recipe, available: RecipeAvailability): RecipeReplayCheck {
  const installed = new Set(available.installedModelIds);
  const missingModel = installed.has(recipe.model.id) ? undefined : recipe.model.id;
  const loraFiles = available.installedLoraFileNames ? new Set(available.installedLoraFileNames) : null;
  const missingLoras = loraFiles
    ? recipe.loras.filter((lora) => lora.fileName && !loraFiles.has(lora.fileName)).map((lora) => lora.label ?? lora.id)
    : [];
  return {
    ok: !missingModel && missingLoras.length === 0,
    ...(missingModel ? { missingModel } : {}),
    // Ordering is the caller's to refine with family knowledge; what matters
    // here is that the list is a suggestion the user picks from by hand.
    suggestedModels: missingModel ? [...available.installedModelIds] : [],
    missingLoras,
  };
}
