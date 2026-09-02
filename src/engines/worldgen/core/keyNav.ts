// ============================================
// World Generator — The camera from the keyboard
// ============================================
// The 2D map had Home (the whole world) and Backspace (where you came from) and
// nothing in between: every metre of travel was a drag or a wheel. The arrows
// and +/- are the keys every map on the planet answers to, and the reason they
// were missing is that nobody had written down what one press should DO — how
// far, how much — in a place a test could read. This is that place.
//
// Pure: a key in, a displacement out. The map owns the view and the clamping.

export interface KeyNudge {
  /** Screen pixels to add to the view's origin. Positive moves the sheet right. */
  dx: number;
  /** Screen pixels to add to the view's origin. Positive moves the sheet down. */
  dy: number;
  /** Factor to multiply the scale by, about the middle of the canvas. 1 = none. */
  zoom: number;
}

/**
 * One arrow press moves a fifth of the shorter side of the canvas: enough to
 * see the ground move, small enough that four presses do not lose the place
 * the reader was looking at. Shift makes it a leap — most of a screen — for
 * crossing a continent without holding the key down.
 */
export const KEY_PAN_FRACTION = 0.2;
export const KEY_PAN_LEAP = 4;
/** One notch of +/-: the same ratio as about eight wheel clicks of 20 px. */
export const KEY_ZOOM_STEP = 1.3;

const PAN_KEYS: Record<string, [number, number]> = {
  // Looking WEST means the sheet slides east under the eye: the origin grows.
  ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

/**
 * What a key does to the camera, or null when it is not a camera key.
 *
 * `=` counts as `+` because that is the unshifted key on every keyboard the
 * map is likely to meet, and `Add`/`Subtract` are the numeric pad's names.
 */
export function keyboardNudge(key: string, shift: boolean, cw: number, ch: number): KeyNudge | null {
  const pan = PAN_KEYS[key];
  if (pan) {
    const step = Math.max(1, Math.min(cw, ch)) * KEY_PAN_FRACTION * (shift ? KEY_PAN_LEAP : 1);
    return { dx: pan[0] * step, dy: pan[1] * step, zoom: 1 };
  }
  if (key === '+' || key === '=' || key === 'Add') return { dx: 0, dy: 0, zoom: KEY_ZOOM_STEP };
  if (key === '-' || key === '_' || key === 'Subtract') return { dx: 0, dy: 0, zoom: 1 / KEY_ZOOM_STEP };
  return null;
}
