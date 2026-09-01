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
  const request: AiImageRequest = {
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
  };
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
    const generation: ImageGenerationInfo = {
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
