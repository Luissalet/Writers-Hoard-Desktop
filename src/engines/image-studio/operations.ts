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
import type { ImageGenerationInfo, InspirationImage } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { generateImage as gatewayGenerate, type ImageHandle } from '@/services/aiRuntime/client';
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
 * Fields the AI-runtime branch is adding to `AiImageRequest`. Declared here as
 * optional so the studio can write them today: an intersection with them is
 * legal whether or not the real request type has grown them yet.
 */
interface WidenedImageRequest {
  sampler?: string;
  scheduler?: string;
  /** Identity/face reference images, as data URLs, in attachment order. */
  referenceImages?: string[];
  /** ControlNet conditioning: a pinned pose and how hard to hold it. */
  controlNets?: { image: string; weight: number }[];
}

/**
 * Whether a given field is ALREADY on `AiImageRequest`.
 *
 * This is the feature detection, and it maintains itself. Today `sampler` is
 * not on the request, so `FieldOnRequest<'sampler'>` is `false` and the table
 * below must say `false`; the parameters column reads it and refuses the field
 * with a reason instead of offering a knob whose value is dropped on the way to
 * the server. The day the runtime branch adds `sampler`, this type flips to
 * `true`, the `false` below stops compiling, and whoever merges is told exactly
 * which line to change — which is the opposite of a comment that goes stale.
 */
type FieldOnRequest<K extends string> = K extends keyof AiImageRequest ? true : false;

export const REQUEST_SUPPORTS: {
  guidance: FieldOnRequest<'guidance'>;
  loras: FieldOnRequest<'loras'>;
  initImage: FieldOnRequest<'initImage'>;
  sampler: FieldOnRequest<'sampler'>;
  scheduler: FieldOnRequest<'scheduler'>;
  referenceImages: FieldOnRequest<'referenceImages'>;
  controlNets: FieldOnRequest<'controlNets'>;
} = {
  guidance: true,
  loras: true,
  initImage: true,
  sampler: false,
  scheduler: false,
  referenceImages: false,
  controlNets: false,
};

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
  /** LoRAs to apply. Only the managed local runtime can load them. */
  loras?: AiLoraSelection[];
  /** Guidance scale. Ignored by a distilled model, which runs at a fixed one. */
  guidance?: number;
  sampler?: string;
  scheduler?: string;
  /** Identity references, as data URLs, in the order the prompt names them. */
  referenceImages?: string[];
  controlNets?: { image: string; weight: number }[];
  /** The visual references this generation was resolved from, for the recipe. */
  visualRefIds?: string[];
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

export function startGeneration(options: GenerateAndSaveOptions): ImageHandle {
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
  if (REQUEST_SUPPORTS.referenceImages && options.referenceImages?.length) {
    request.referenceImages = options.referenceImages;
  }
  if (REQUEST_SUPPORTS.controlNets && options.controlNets?.length) {
    request.controlNets = options.controlNets;
  }
  return gatewayGenerate(request);
}

export async function saveGenerated(
  options: GenerateAndSaveOptions,
  result: AiImageResult,
): Promise<GenerateAndSaveResult> {
  if (!result.ok || !result.images?.length) {
    return { ok: false, images: [], code: result.code, error: result.error ?? 'no images' };
  }
  const rows: InspirationImage[] = [];
  const now = Date.now();
  for (const image of result.images) {
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
      createdAt: now,
      // Written whether or not `ImageGenerationInfo` has grown these yet: an
      // extra key on a stored row is harmless, and a recipe that cannot say
      // what cfg it ran at cannot be iterated on honestly. `readRecipe` reads
      // them back defensively for exactly the same reason.
      cfg: options.guidance,
      sampler: options.sampler,
      scheduler: options.scheduler,
      loras: options.loras?.length ? options.loras.map((lora) => ({ name: lora.name, weight: lora.weight })) : undefined,
      visualRefIds: options.visualRefIds?.length ? options.visualRefIds : undefined,
    };
    const row: InspirationImage = {
      id: generateId('img'),
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
    await db.inspirationImages.add(row);
    rows.push(row);
  }
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
  await db.inspirationImages.delete(id);
}
