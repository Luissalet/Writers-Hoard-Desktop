import type { WorldSpatialStyle } from '../core/spatialEntities';
import { normalizePlaceImage, placeImageBytes } from '../core/placeImage';
import type { Ctx } from './symbols';
import { symbolScale } from '../core/placeStyle';

export interface DecodedPlaceImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose?: () => void;
}

export interface PlaceImageAdapter {
  decode(bytes: Uint8Array, mime: string): Promise<DecodedPlaceImage>;
  canvas(width: number, height: number): { canvas: CanvasImageSource; ctx: Ctx; dispose?: () => void };
}

export interface PlaceImagePainter {
  readonly errors: readonly string[];
  has(style: WorldSpatialStyle): boolean;
  draw(ctx: Ctx, style: WorldSpatialStyle, radius: number, ink?: string): boolean;
  dispose(): void;
}

/** A readable image frame in logical canvas pixels; callers keep DPR outside. */
export function placeImageRadius(style: WorldSpatialStyle, legacyRadius: number, painter?: PlaceImagePainter, pixelScale = 1): number {
  return painter?.has(style) ? Math.max(legacyRadius, 8 * symbolScale(style) * pixelScale) : legacyRadius;
}

const generations = new WeakMap<PlaceImagePainter, number>();
let generation = 0;
/** A prepared lease is a new texture input, including a replacement for a failed decode. */
export function placeImageGeneration(painter?: PlaceImagePainter): number {
  if (!painter) return 0;
  let id = generations.get(painter);
  if (id === undefined) { id = ++generation; generations.set(painter, id); }
  return id;
}

/** Resources belong to this lease; no global bitmap cache or transferred ownership. */
export async function preparePlaceImages(
  styles: Iterable<WorldSpatialStyle>,
  adapter: PlaceImageAdapter,
  options: { signal?: AbortSignal; strict?: boolean } = {},
): Promise<PlaceImagePainter> {
  const images = new Map<string, DecodedPlaceImage>();
  const aliases = new Map<string, string>();
  const tints = new Map<DecodedPlaceImage, Map<string, ReturnType<PlaceImageAdapter['canvas']>>>();
  const errors: string[] = [];
  let disposed = false;
  const check = () => { if (options.signal?.aborted) throw new DOMException('Image preparation cancelled', 'AbortError'); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const image of images.values()) image.dispose?.();
    for (const colors of tints.values()) for (const surface of colors.values()) surface.dispose?.();
    images.clear(); aliases.clear(); tints.clear();
  };
  const resolve = (style: WorldSpatialStyle) => {
    const descriptor = style.iconImage;
    if (disposed || !descriptor || (descriptor.mode !== 'colour' && descriptor.mode !== 'inked')) return undefined;
    return images.get(aliases.get(descriptor.dataUrl) ?? '');
  };
  try {
    for (const style of styles) {
      check();
      if (style.iconImage == null) continue;
      try {
        const descriptor = normalizePlaceImage(style.iconImage);
        if (!descriptor) continue;
        aliases.set(style.iconImage.dataUrl, descriptor.dataUrl);
        if (images.has(descriptor.dataUrl)) continue;
        const mime = descriptor.dataUrl.slice(5, descriptor.dataUrl.indexOf(';'));
        const decoded = await adapter.decode(placeImageBytes(descriptor), mime);
        if (options.signal?.aborted || !(decoded.width > 0 && decoded.height > 0)
          || !Number.isFinite(decoded.width) || !Number.isFinite(decoded.height)) {
          decoded.dispose?.();
          check();
          throw new Error('The image has no readable dimensions');
        }
        images.set(descriptor.dataUrl, decoded);
      } catch (error) {
        check();
        const message = error instanceof Error ? error.message : String(error);
        if (options.strict) throw error;
        errors.push(message);
      }
    }
    check();
    return {
      errors,
      has: style => !!resolve(style),
      draw(ctx, style, radius, ink = style.color ?? '#493e30') {
        const image = resolve(style);
        if (!image || !(radius > 0)) return false;
        let source = image.image;
        if (style.iconImage?.mode === 'inked') {
          let colors = tints.get(image);
          if (!colors) { colors = new Map(); tints.set(image, colors); }
          let surface = colors.get(ink);
          if (!surface) {
            surface = adapter.canvas(image.width, image.height);
            surface.ctx.drawImage(image.image, 0, 0);
            surface.ctx.globalCompositeOperation = 'source-in';
            surface.ctx.fillStyle = ink;
            surface.ctx.fillRect(0, 0, image.width, image.height);
            surface.ctx.globalCompositeOperation = 'source-over';
            colors.set(ink, surface);
          }
          source = surface.canvas;
        }
        const scale = radius * 2 / Math.max(image.width, image.height);
        const width = image.width * scale, height = image.height * scale;
        ctx.drawImage(source, -width / 2, -height / 2, width, height);
        return true;
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}

/** Local bytes only. Both the window and the existing worker can own this adapter. */
export function webPlaceImageAdapter(): PlaceImageAdapter {
  return {
    async decode(bytes, mime) {
      const blob = new Blob([new Uint8Array(bytes).buffer], { type: mime });
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
      }
      if (typeof Image === 'undefined') throw new Error('No local image decoder is available');
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The image could not be decoded')); image.src = url; });
        return { image, width: image.naturalWidth, height: image.naturalHeight };
      } finally { URL.revokeObjectURL(url); }
    },
    canvas(width, height) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d') as Ctx | null;
      if (!ctx) throw new Error('No image drawing surface is available');
      return { canvas, ctx, dispose: () => { canvas.width = 0; canvas.height = 0; } };
    },
  };
}
