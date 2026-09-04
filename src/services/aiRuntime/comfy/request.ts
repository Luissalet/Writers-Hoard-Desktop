// ============================================================================
// ComfyUI — reading an image request
// ============================================================================
//
// `AiImageRequest` is shared with the Studio and describes what the bundled
// runtime can do. Everything the Bench adds — masked regions, a ControlNet
// stack, a detail chain, a tiled upscale, a guidance preset — arrives on an
// optional `comfy` property and is read here defensively, so the adapter
// compiles and behaves whether or not the shared type has been widened yet.
// A malformed extra is dropped, never guessed at: a region with no mask is not
// a region.

import type { AiImageRequest } from '../types';
import type { ComfyIntent } from './build';
import type { ComfyCropRect, ComfyGuidancePreset } from './types';

const GUIDANCE: ReadonlySet<string> = new Set(['none', 'coherent', 'detailed', 'distilled-negatives']);

/** A picture the app holds, as a data URL, before it is uploaded to ComfyUI. */
export interface ComfyRegionInput {
  prompt: string;
  maskDataUrl: string;
  strength: number;
}

export interface ComfyControlInput {
  model: string;
  imageDataUrl: string;
  strength: number;
  startPercent: number;
  endPercent: number;
}

export interface ComfyDetailInput {
  detector: string;
  prompt: string;
  denoise: number;
}

export interface ComfyExtras {
  templateId?: string;
  guidance: ComfyGuidancePreset;
  regions: ComfyRegionInput[];
  controls: ComfyControlInput[];
  detail: ComfyDetailInput[];
  upscale?: { model: string; by: number; denoise: number; tileWidth: number; tileHeight: number };
  crop?: ComfyCropRect;
  workWidth?: number;
  workHeight?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function readComfyExtras(request: unknown): ComfyExtras {
  const extras = record(record(request)?.comfy);
  const empty: ComfyExtras = { guidance: 'none', regions: [], controls: [], detail: [] };
  if (!extras) return empty;

  const templateId = typeof extras.templateId === 'string' ? extras.templateId : undefined;
  const guidance = typeof extras.guidance === 'string' && GUIDANCE.has(extras.guidance)
    ? (extras.guidance as ComfyGuidancePreset)
    : 'none';

  const regions: ComfyRegionInput[] = [];
  for (const entry of Array.isArray(extras.regions) ? extras.regions : []) {
    const item = record(entry);
    const maskDataUrl = str(item?.maskDataUrl);
    if (!item || !maskDataUrl) continue;
    regions.push({ prompt: str(item.prompt), maskDataUrl, strength: clamp(num(item.strength, 1), 0, 10) });
  }

  const controls: ComfyControlInput[] = [];
  for (const entry of Array.isArray(extras.controls) ? extras.controls : []) {
    const item = record(entry);
    const model = str(item?.model);
    const imageDataUrl = str(item?.imageDataUrl);
    if (!item || !model || !imageDataUrl) continue;
    const start = clamp(num(item.startPercent, 0), 0, 1);
    const end = clamp(num(item.endPercent, 1), 0, 1);
    controls.push({
      model,
      imageDataUrl,
      strength: clamp(num(item.strength, 1), 0, 10),
      startPercent: Math.min(start, end),
      endPercent: Math.max(start, end),
    });
  }

  const detail: ComfyDetailInput[] = [];
  for (const entry of Array.isArray(extras.detail) ? extras.detail : []) {
    const item = record(entry);
    const detector = str(item?.detector);
    if (!item || !detector) continue;
    detail.push({ detector, prompt: str(item.prompt), denoise: clamp(num(item.denoise, 0.5), 0.0001, 1) });
  }

  const upscaleRaw = record(extras.upscale);
  const upscale = upscaleRaw && str(upscaleRaw.model)
    ? {
        model: str(upscaleRaw.model),
        by: clamp(num(upscaleRaw.by, 2), 0.05, 4),
        denoise: clamp(num(upscaleRaw.denoise, 0.2), 0, 1),
        tileWidth: clamp(num(upscaleRaw.tileWidth, 512), 64, 4096),
        tileHeight: clamp(num(upscaleRaw.tileHeight, 512), 64, 4096),
      }
    : undefined;

  const cropRaw = record(extras.crop);
  const crop = cropRaw
    ? {
        x: Math.max(0, Math.round(num(cropRaw.x, 0))),
        y: Math.max(0, Math.round(num(cropRaw.y, 0))),
        width: Math.max(1, Math.round(num(cropRaw.width, 0))),
        height: Math.max(1, Math.round(num(cropRaw.height, 0))),
      }
    : undefined;

  return {
    ...(templateId ? { templateId } : {}),
    guidance,
    regions: regions.slice(0, 4),
    controls: controls.slice(0, 3),
    detail: detail.slice(0, 3),
    ...(upscale ? { upscale } : {}),
    ...(crop ? { crop } : {}),
    ...(typeof extras.workWidth === 'number' ? { workWidth: Math.round(extras.workWidth) } : {}),
    ...(typeof extras.workHeight === 'number' ? { workHeight: Math.round(extras.workHeight) } : {}),
  };
}

export function intentFromRequest(request: AiImageRequest, extras: ComfyExtras): ComfyIntent {
  return {
    regions: extras.regions.length,
    controls: extras.controls.length || (request.controlImage ? 1 : 0),
    detailStages: extras.detail.length,
    hasSource: Boolean(request.initImage),
    hasMask: Boolean(request.maskImage),
    wantsUpscale: Boolean(extras.upscale),
    wantsHires: Boolean(request.hiresFix),
  };
}

/** `data:image/png;base64,…` split into a media type and its bytes. */
export function parseDataUrl(value: string): { contentType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { contentType: match[1], bytes };
  } catch {
    return null;
  }
}

/** File extension for an uploaded reference, so ComfyUI can read it back. */
export function extensionFor(contentType: string): string {
  if (/png/i.test(contentType)) return 'png';
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/webp/i.test(contentType)) return 'webp';
  return 'png';
}
