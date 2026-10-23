// Named picture frames for the crop dialog: the shape a picture will be shown
// in, the size that looks sharp there, and whether a chosen area is too small.
import { centerCrop, makeAspectCrop, type Crop } from 'react-image-crop';

export type MediaFrameId = 'free' | 'avatar' | 'card-portrait' | 'card-landscape' | 'banner' | 'cover' | 'wallpaper';

export interface MediaFrame {
  id: MediaFrameId;
  /** width / height; undefined means any shape. */
  aspect?: number;
  /** Pixels that look sharp in this frame; undefined means no advice. */
  recommended?: { width: number; height: number };
}

export const MEDIA_FRAMES: readonly MediaFrame[] = [
  { id: 'free' },
  { id: 'avatar', aspect: 1, recommended: { width: 512, height: 512 } },
  { id: 'card-portrait', aspect: 3 / 4, recommended: { width: 600, height: 800 } },
  { id: 'card-landscape', aspect: 4 / 3, recommended: { width: 800, height: 600 } },
  { id: 'banner', aspect: 3, recommended: { width: 1500, height: 500 } },
  { id: 'cover', aspect: 2 / 3, recommended: { width: 1200, height: 1800 } },
  { id: 'wallpaper', aspect: 16 / 9, recommended: { width: 1920, height: 1080 } },
];

export function getMediaFrame(id: MediaFrameId): MediaFrame {
  return MEDIA_FRAMES.find(frame => frame.id === id) ?? MEDIA_FRAMES[0];
}

/** A centred selection that fills the picture in the frame's shape; the usual 90% box for the free frame. */
export function frameCrop(id: MediaFrameId, displayedWidth: number, displayedHeight: number): Crop {
  const aspect = getMediaFrame(id).aspect;
  if (!aspect || displayedWidth <= 0 || displayedHeight <= 0) return { unit: '%', x: 5, y: 5, width: 90, height: 90 };
  return centerCrop(makeAspectCrop({ unit: '%', width: 90 }, aspect, displayedWidth, displayedHeight), displayedWidth, displayedHeight);
}

/**
 * Pixels of the ORIGINAL picture the selection really covers. The dialog's
 * zoom stretches the picture before cutting, so a zoom above 1 fills the same
 * selection with fewer real pixels.
 */
export function sourcePixels(selection: { width: number; height: number }, natural: { width: number; height: number }, displayed: { width: number; height: number }, zoom: number): { width: number; height: number } {
  if (displayed.width <= 0 || displayed.height <= 0 || zoom <= 0) return { width: 0, height: 0 };
  return {
    width: Math.round(selection.width * (natural.width / displayed.width) / zoom),
    height: Math.round(selection.height * (natural.height / displayed.height) / zoom),
  };
}

/** True when the area has fewer pixels than the frame recommends, so it may look soft. */
export function isTooSmall(id: MediaFrameId, pixels: { width: number; height: number }): boolean {
  const recommended = getMediaFrame(id).recommended;
  return Boolean(recommended) && (pixels.width < recommended!.width || pixels.height < recommended!.height);
}
