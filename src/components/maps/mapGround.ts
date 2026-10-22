import type { MapFeature, MapPin } from '@/types';

// ============================================================================
// Replacing a classic map's ground image
// ============================================================================
//
// Shapes and pins are stored as percentages of the image, so a new image with
// another aspect ratio would silently stretch every one of them. These pure
// helpers measure that difference and, when the author asks to keep the shapes,
// move the content so the old picture sits uniformly inside the new one.

export interface GroundSize { width: number; height: number }
export type GroundFitMode = 'keep' | 'stretch';

/** Ratios within this fraction of each other count as the same shape. */
export const GROUND_SAME_SHAPE_TOLERANCE = 0.02;

function assertSize(size: GroundSize, what: string): void {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error(`Invalid ${what} image size`);
  }
}

/** Whether a new image has the shape of the old one (aspect ratios within 2%). */
export function groundFit(oldSize: GroundSize, newSize: GroundSize): { sameShape: boolean; oldRatio: number; newRatio: number } {
  assertSize(oldSize, 'old'); assertSize(newSize, 'new');
  const oldRatio = oldSize.width / oldSize.height, newRatio = newSize.width / newSize.height;
  return { sameShape: Math.abs(newRatio / oldRatio - 1) <= GROUND_SAME_SHAPE_TOLERANCE, oldRatio, newRatio };
}

const round = (value: number): number => Math.round(value * 10000) / 10000;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/** How the old picture lies inside the new one when its proportions are kept. */
function keepLayout(oldSize: GroundSize, newSize: GroundSize): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(newSize.width / oldSize.width, newSize.height / oldSize.height);
  return { scale, offsetX: (newSize.width - oldSize.width * scale) / 2, offsetY: (newSize.height - oldSize.height * scale) / 2 };
}

/** One position (percent of the old image) as a position on the new one. */
export function remapPoint(p: { x: number; y: number }, oldSize: GroundSize, newSize: GroundSize, mode: GroundFitMode): { x: number; y: number } {
  if (mode === 'stretch') return p;
  assertSize(oldSize, 'old'); assertSize(newSize, 'new');
  const { scale, offsetX, offsetY } = keepLayout(oldSize, newSize);
  return {
    x: round(clamp(((offsetX + (p.x / 100) * oldSize.width * scale) / newSize.width) * 100)),
    y: round(clamp(((offsetY + (p.y / 100) * oldSize.height * scale) / newSize.height) * 100)),
  };
}

/** Lettering size is in percent of the map width, so it shrinks or grows with the picture. */
function remapFeature(feature: MapFeature, oldSize: GroundSize, newSize: GroundSize, mode: GroundFitMode): MapFeature {
  const next: MapFeature = { ...feature, points: feature.points.map(point => remapPoint(point, oldSize, newSize, mode)) };
  if (mode === 'keep' && feature.labelStyle?.size !== undefined) {
    const factor = (oldSize.width * keepLayout(oldSize, newSize).scale) / newSize.width;
    next.labelStyle = { ...feature.labelStyle, size: round(Math.max(0.6, Math.min(8, feature.labelStyle.size * factor))) };
  }
  return next;
}

/** Every shape and pin moved to the new image; new arrays, inputs untouched. */
export function remapMapContent<P extends Pick<MapPin, 'position'>>(content: { features: MapFeature[]; pins: P[] }, oldSize: GroundSize, newSize: GroundSize, mode: GroundFitMode): { features: MapFeature[]; pins: P[] } {
  return {
    features: content.features.map(feature => remapFeature(feature, oldSize, newSize, mode)),
    pins: content.pins.map(pin => ({ ...pin, position: remapPoint(pin.position, oldSize, newSize, mode) })),
  };
}

/** What moves with the map: places (pins), zones (regions), paths and names (labels). */
export function groundCounts(features: readonly MapFeature[], pins: readonly unknown[]): { places: number; zones: number; paths: number; names: number } {
  return {
    places: pins.length,
    zones: features.filter(feature => feature.kind === 'region').length,
    paths: features.filter(feature => feature.kind === 'path').length,
    names: features.filter(feature => feature.kind === 'label').length,
  };
}

/** Decode an image to read its pixel size; rejects when it cannot be loaded or has no size. */
export function loadImageSize(source: string, timeoutMs = 15000): Promise<GroundSize> {
  return new Promise((resolve, reject) => {
    if (!source) { reject(new Error('empty image')); return; }
    const image = new Image();
    const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error('image timed out')); }, timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve({ width: image.naturalWidth, height: image.naturalHeight });
      else reject(new Error('image has no size'));
    };
    image.onerror = () => { clearTimeout(timer); reject(new Error('image could not be decoded')); };
    image.src = source;
  });
}
