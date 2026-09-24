// ============================================================================
// Image studio — generate through the gateway, keep the result in Gallery
// ============================================================================
//
// Tableless engine: `inspirationImages` is the canonical store, tagged with
// `source: 'generated'` and full provenance, so a picture made here shows up
// in Gallery, in backups and in the AI bridge's `wh_list_images` like any
// other. Shared by the studio UI and the `wh_generate_image` tool so both
// produce identical rows.

import { db } from '@/db';
import { deleteInspirationImage } from '@/db/operations';
import type { ImageGenerationInfo, InspirationImage } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { generateImage as gatewayGenerate, type ImageHandle } from '@/services/aiRuntime/client';
import { recipeHash, type ImageRecipeRow } from '@/services/aiRuntime/recipe';
import { formatLoraToken } from '@/services/aiRuntime/sdServer';
import type { AiImageRequest, AiImageResult, AiLoraSelection, AiRouteSelection } from '@/services/aiRuntime/types';

export const IMAGE_STUDIO_ENGINE_ID = 'image-studio';

/** The same widening, on the row this writes. See `services/visualRef/recipe`. */
interface WidenedGenerationInfo {
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  loras?: { name: string; weight: number }[];
  visualRefIds?: string[];
  composer?: { subjects: string; scene: string; style: string };
  /** CLIP layers skipped. An SD1 anime checkpoint is a different picture at −2. */
  clipSkip?: number;
  /** What this cell of an X/Y/Z grid varied, for the label under the picture. */
  gridLabel?: string;
  /** The pass chain as it ran, serialised. See `studio/passes`. */
  passChain?: string;
  /** The wildcard picks, so a prompt with `{a|b}` in it can still be reproduced. */
  wildcards?: { token: string; choice: string }[];
}

/** Common aspect presets, all multiples of 64 as diffusion models prefer. */
export const IMAGE_SIZE_PRESETS: ReadonlyArray<{ id: string; width: number; height: number; labelKey: string }> = [
  { id: 'square', width: 1024, height: 1024, labelKey: 'square' },
  { id: 'landscape', width: 1152, height: 896, labelKey: 'landscape' },
  { id: 'portrait', width: 896, height: 1152, labelKey: 'portrait' },
  { id: 'wide', width: 1344, height: 768, labelKey: 'wide' },
  { id: 'tall', width: 768, height: 1344, labelKey: 'tall' },
  { id: 'cover', width: 1024, height: 1792, labelKey: 'cover' },
  { id: 'banner', width: 1792, height: 1024, labelKey: 'banner' },
  { id: 'small', width: 512, height: 512, labelKey: 'small' },
];

/**
 * Fields the studio wants to send that `AiImageRequest` has no room for yet.
 * Declared here as optional so the studio can be written against them today:
 * an intersection with them is legal whether or not the real request type has
 * grown them, and the table below is what decides whether one is ever set.
 */
interface WidenedImageRequest {
  /** CLIP layers to skip. −2 is the anime-checkpoint convention on SD1. */
  clipSkip?: number;
  /** The face/hand pass: detect, crop, re-diffuse, paste back. */
  detailer?: {
    detector: string;
    prompt?: string;
    denoisingStrength?: number;
    padding?: number;
    maskBlur?: number;
    confidence?: number;
  };
  /** A hand-written sigma schedule, replacing the scheduler's. */
  sigmas?: number[];
  /** Skip-layer guidance: which layers to skip, and over which part of the run. */
  slg?: { layers: number[]; scale: number; start: number; end: number };
  /** Adaptive projected guidance. */
  apg?: { eta: number; normThreshold: number; momentum: number };
  /** Inference cache mode, trading a little fidelity for a lot of speed. */
  cacheMode?: string;
}

/**
 * Whether a given field is ALREADY on `AiImageRequest`.
 *
 * This is the feature detection, and it maintains itself. A field the request
 * cannot carry is written here as `false`; the parameters column reads it and
 * refuses the knob with a reason instead of offering one whose value is dropped
 * on the way to the server. The day the runtime branch adds the field, this
 * type flips to `true`, the `false` below stops compiling, and whoever merges
 * is told exactly which line to change — which is the opposite of a comment
 * that goes stale.
 *
 * It has already earned its keep once: `sampler` and `scheduler` landed on the
 * request, these two lines stopped compiling, and the samplers went live.
 */
type FieldOnRequest<K extends string> = K extends keyof AiImageRequest ? true : false;

export const REQUEST_SUPPORTS: {
  guidance: FieldOnRequest<'guidance'>;
  loras: FieldOnRequest<'loras'>;
  initImage: FieldOnRequest<'initImage'>;
  strength: FieldOnRequest<'strength'>;
  sampler: FieldOnRequest<'sampler'>;
  scheduler: FieldOnRequest<'scheduler'>;
  /** The runtime named it `refImages`, not `referenceImages`. */
  refImages: FieldOnRequest<'refImages'>;
  controlImage: FieldOnRequest<'controlImage'>;
  maskImage: FieldOnRequest<'maskImage'>;
  hiresFix: FieldOnRequest<'hiresFix'>;
  clipSkip: FieldOnRequest<'clipSkip'>;
  detailer: FieldOnRequest<'detailer'>;
  // The studio's names and the request's names are not the same words. Point
  // each check at the field the request actually declares, or this stops being
  // a compile-time fact and becomes a comment that happens to be true.
  sigmas: FieldOnRequest<'customSigmas'>;
  slg: FieldOnRequest<'skipLayerGuidance'>;
  apg: FieldOnRequest<'extraSampleArgs'>;
  cacheMode: FieldOnRequest<'cacheMode'>;
} = {
  guidance: true,
  loras: true,
  initImage: true,
  strength: true,
  sampler: true,
  scheduler: true,
  refImages: true,
  controlImage: true,
  maskImage: true,
  hiresFix: true,
  clipSkip: true,
  sigmas: true,
  slg: true,
  apg: true,
  cacheMode: true,
  // The one that is NOT waiting on plumbing. The pinned runtime has no native
  // detailer pass at all: `ad_model`, `ad_prompt` and `extra_ad_args` occur
  // nowhere in the parser, the CLI, or the public header at commit 92a3b73.
  // Flipping this would offer a control the server discards in silence.
  detailer: false,
};

export type RequestSupportMap = typeof REQUEST_SUPPORTS;

/** A second pass at a larger size, as the request carries it. */
export interface HiresPassRequest {
  upscaler: string;
  scale: number;
  steps?: number;
  denoisingStrength?: number;
  tileSize?: number;
}

export interface GenerateAndSaveOptions {
  projectId: string;
  route: AiRouteSelection;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  n: number;
  seed?: number;
  steps?: number;
  quality?: string;
  /** img2img: reference image as a data URL, and its denoise strength (0..1). */
  initImage?: string;
  strength?: number;
  /** Inpainting mask as a data URL: white is repainted. Needs `initImage`. */
  maskImage?: string;
  /** LoRAs to apply. Only the managed local runtime can load them. */
  loras?: AiLoraSelection[];
  /** Guidance scale. Ignored by a distilled model, which runs at a fixed one. */
  guidance?: number;
  sampler?: string;
  scheduler?: string;
  /** CLIP layers to skip; refused until the request grows a field for it. */
  clipSkip?: number;
  /** Identity references, as data URLs, in the order the prompt names them. */
  referenceImages?: string[];
  /** ControlNet conditioning: a pinned pose and how hard to hold it. */
  controlNets?: { image: string; weight: number }[];
  /**
   * The ControlNet the local server must hold for `controlNets` to mean
   * anything (catalogue id or installed file name). sd.cpp refuses a control
   * image without one; see `studio/controlNet.ts` for how it is chosen.
   */
  controlNetModel?: string;
  /** The second pass, when the chain has an enabled hires pass. */
  hires?: HiresPassRequest;
  /** The visual references this generation was resolved from, for the recipe. */
  visualRefIds?: string[];
  /** Gallery ids of the conditioning images, so the row can point back at them. */
  refImageIds?: string[];
  controlImageId?: string;
  /** The composer's slots as typed, so «iterate on this» can put them back. */
  composer?: { subjects: string; scene: string; style: string };
  /** The chain as it ran, serialised, and the wildcard picks that fixed the text. */
  passChain?: string;
  wildcards?: { token: string; choice: string }[];
  /**
   * The stamp every picture of ONE batch shares.
   *
   * The results grid groups by it, and a batch of four issued as four calls
   * would otherwise land as four batches of one — the grid would say the
   * writer pressed generate four times, which is not what happened and makes
   * a contact sheet impossible to read.
   */
  stamp?: number;
  /** "steps 30 · cfg 7": what this cell of an X/Y/Z grid varied. */
  gridLabel?: string;
  collectionId?: string;
  tags?: string[];
}

export interface GenerateAndSaveResult {
  ok: boolean;
  images: InspirationImage[];
  code?: string;
  error?: string;
}

/** Downscale a data URL to a thumbnail (longest edge `maxEdge`). */
export async function makeThumbnail(dataUrl: string, maxEdge = 320): Promise<string | undefined> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return undefined;
  }
}

/**
 * The options as they go on the wire.
 *
 * Exported because the studio needs to be able to SHOW what it is about to
 * send without sending it — the X/Y/Z preview and the resolved-prompt
 * disclosure both read this, and a preview built by a second code path is a
 * preview of something else.
 */
export function buildImageRequest(options: GenerateAndSaveOptions): AiImageRequest {
  const request: AiImageRequest & Partial<WidenedImageRequest> = {
    connectionId: options.route.connectionId,
    modelId: options.route.modelId,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt || undefined,
    width: options.width,
    height: options.height,
    n: options.n,
    seed: options.seed,
    steps: options.steps,
    quality: options.quality,
    initImage: options.initImage,
    strength: options.strength,
    loras: options.loras?.length ? options.loras : undefined,
    guidance: options.guidance,
  };
  // Only set what the request can carry. A field written here that the gateway
  // does not know is dropped between the studio and the server without a word,
  // and the parameters column would go on showing a knob that does nothing.
  if (REQUEST_SUPPORTS.sampler && options.sampler) request.sampler = options.sampler;
  if (REQUEST_SUPPORTS.scheduler && options.scheduler) request.scheduler = options.scheduler;
  if (REQUEST_SUPPORTS.refImages && options.referenceImages?.length) {
    request.refImages = options.referenceImages;
  }
  // One hint image, not an array: `--control-net` builds the context with a
  // single ControlNet, so a second pose has nowhere to go and pretending
  // otherwise would drop it silently.
  const control = options.controlNets?.[0];
  if (REQUEST_SUPPORTS.controlImage && control) {
    request.controlImage = control.image;
    request.controlStrength = control.weight;
    if (options.controlNetModel) request.controlNetModel = options.controlNetModel;
  }
  if (REQUEST_SUPPORTS.maskImage && options.maskImage) request.maskImage = options.maskImage;
  if (REQUEST_SUPPORTS.hiresFix && options.hires) request.hiresFix = options.hires;
  if (REQUEST_SUPPORTS.clipSkip && options.clipSkip !== undefined) request.clipSkip = options.clipSkip;
  return request;
}

export function startGeneration(options: GenerateAndSaveOptions): ImageHandle {
  return gatewayGenerate(buildImageRequest(options));
}

export async function saveGenerated(
  options: GenerateAndSaveOptions,
  result: AiImageResult,
): Promise<GenerateAndSaveResult> {
  if (!result.ok || !result.images?.length) {
    return { ok: false, images: [], code: result.code, error: result.error ?? 'no images' };
  }
  const rows: InspirationImage[] = [];
  const recipeRows: ImageRecipeRow[] = [];
  const now = Date.now();
  // One stamp for the whole batch, so the grid groups the pictures of one
  // press together however many calls it took to make them.
  const stamp = options.stamp ?? now;
  for (const image of result.images) {
    const imageId = generateId('img');
    let storedRecipe: ImageRecipeRow | undefined;
    if (image.recipe) {
      const hash = recipeHash(image.recipe);
      if (image.recipe.hash !== undefined && image.recipe.hash !== hash) {
        throw new Error(`Image recipe "${image.recipe.id}" failed its integrity check.`);
      }
      // Keep the runtime's recipe field-for-field at every semantic field. The
      // remaining properties are only the Dexie row's ownership/link metadata,
      // and the recomputed hash is authoritative for both sides of the link.
      storedRecipe = {
        ...image.recipe,
        projectId: options.projectId,
        imageId,
        updatedAt: now,
        hash,
      };
      recipeRows.push(storedRecipe);
    }
    const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
    const generation: ImageGenerationInfo & Partial<WidenedGenerationInfo> = {
      prompt: options.prompt,
      negativePrompt: options.negativePrompt || undefined,
      connectionId: options.route.connectionId,
      modelId: options.route.modelId,
      seed: image.seed ?? options.seed,
      width: options.width,
      height: options.height,
      quality: options.quality,
      steps: options.steps,
      createdAt: stamp,
      // Written whether or not `ImageGenerationInfo` has grown these yet: an
      // extra key on a stored row is harmless, and a recipe that cannot say
      // what cfg it ran at cannot be iterated on honestly. `readRecipe` reads
      // them back defensively for exactly the same reason.
      cfg: options.guidance,
      sampler: options.sampler,
      scheduler: options.scheduler,
      loras: options.loras?.length ? options.loras.map((lora) => ({ name: lora.name, weight: lora.weight })) : undefined,
      visualRefIds: options.visualRefIds?.length ? options.visualRefIds : undefined,
      composer: options.composer,
      clipSkip: options.clipSkip,
      passChain: options.passChain,
      gridLabel: options.gridLabel,
      wildcards: options.wildcards?.length ? options.wildcards : undefined,
      refImageIds: options.refImageIds?.length ? options.refImageIds : undefined,
      controlImageId: options.controlImageId,
      controlNetModel: options.controlNets?.length ? options.controlNetModel : undefined,
      controlStrength: options.controlNets?.[0]?.weight,
      strength: options.strength,
      hiresUpscaler: options.hires?.upscaler,
      hiresScale: options.hires?.scale,
      parameters: image.parameters,
      ...(storedRecipe ? {
        recipeId: storedRecipe.id,
        recipeHash: storedRecipe.hash,
      } : {}),
    };
    const row: InspirationImage = {
      id: imageId,
      projectId: options.projectId,
      collectionId: options.collectionId,
      imageData: dataUrl,
      thumbnailData: await makeThumbnail(dataUrl),
      tags: [...new Set(['generated', ...(options.tags ?? [])])],
      // The LoRA rides in the note, not in `generation.prompt`: the prompt stays
      // the clean text the author wrote (and the one "reuse" pastes back), while
      // the row still says which weights made this picture.
      notes: [
        image.revisedPrompt ? `${options.prompt}\n\n(${image.revisedPrompt})` : options.prompt,
        ...(options.loras ?? []).map((lora) => formatLoraToken(lora.name, lora.weight)),
      ].join(' '),
      createdAt: now,
      source: 'generated',
      generation,
    };
    rows.push(row);
  }

  // One transaction for the complete batch: a duplicate recipe id, quota
  // error or failed image write rolls every row back. `add` is intentional —
  // replacing an existing recipe would silently re-point its `imageId` while
  // the older Gallery row kept linking to it.
  await db.transaction('rw', [db.inspirationImages, db.imageRecipes], async () => {
    if (recipeRows.length) await db.imageRecipes.bulkAdd(recipeRows);
    await db.inspirationImages.bulkAdd(rows);
  });
  return { ok: true, images: rows };
}

export async function generateAndSave(options: GenerateAndSaveOptions): Promise<GenerateAndSaveResult> {
  const handle = startGeneration(options);
  return saveGenerated(options, await handle.result);
}

export async function listGeneratedImages(projectId: string, limit = 60): Promise<InspirationImage[]> {
  const rows = await db.inspirationImages
    .where('projectId')
    .equals(projectId)
    .filter((img) => img.source === 'generated')
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function deleteGeneratedImage(id: string): Promise<void> {
  await deleteInspirationImage(id);
}
