// ============================================
// Sculpt view — the renderer that cannot fail
// ============================================
// The GPU path is the one that makes sculpting feel like sculpting: a stroke
// rewrites a rectangle of a texture and the ground moves under the pointer while
// the button is still down. It is also the one that, on one particular machine,
// produced a black rectangle four fixes in a row — with no console error, a
// canvas in the DOM, a box with a size, and a frame counter that never moved.
//
// At that point the honest engineering answer stops being "find the fifth
// hypothesis" and becomes "make the failure impossible". This draws the same
// picture — sea ramp, biome tint, hillshade, contours, brush ring — with plain
// Canvas2D and an ImageData blit. It is perhaps five times slower, which on a
// half-resolution buffer is still comfortably interactive, and it works on
// anything that can draw a rectangle.
//
// The rule this encodes: a view whose only renderer can silently produce nothing
// is a view that will, on someone's machine, produce nothing.

export interface FallbackView {
  /** Source rect in world cells. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FallbackOptions {
  world: { width: number; height: number; elevation: Float32Array; biome: Uint8Array };
  palette: [number, number, number][];
  view: FallbackView;
  /** Brush position in cells and radius, or null. */
  brush: { x: number; y: number; r: number } | null;
  /** Contour interval in km; 0 for none. */
  contourKm: number;
  shade: number;
}

/**
 * Draw the terrain into a 2D canvas.
 *
 * Rendered at up to half resolution and scaled up: the picture is a shaded
 * heightmap, not lettering, so the softness is invisible and it turns a
 * per-pixel loop over four million pixels into one over a million.
 */
export function drawSculptFallback(canvas: HTMLCanvasElement, opts: FallbackOptions): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { world, view, palette } = opts;
  const CW = canvas.width, CH = canvas.height;
  if (CW < 2 || CH < 2) return false;

  // Aim for a fixed pixel BUDGET rather than a fixed divisor. A brush drag
  // redraws every frame, so the number that matters is milliseconds, and
  // milliseconds track the pixel count and not the window size. 150 000 pixels
  // is about 30 ms of this loop, which is a frame.
  const scale = Math.min(4, Math.max(1, Math.round(Math.sqrt((CW * CH) / 150_000))));
  const W = Math.max(1, Math.floor(CW / scale));
  const H = Math.max(1, Math.floor(CH / scale));
  const lo = new Uint8ClampedArray(W * H * 3);

  const gw = world.width, gh = world.height;
  const elev = world.elevation, biome = world.biome;
  const at = (cx: number, cy: number) => {
    const x = ((cx % gw) + gw) % gw;
    const y = cy < 0 ? 0 : cy >= gh ? gh - 1 : cy;
    return y * gw + x;
  };

  // Vertical exaggeration matched to the shader's `-hx * 40.0`, so switching
  // renderers does not change how steep the world looks.
  const shadeAmt = opts.shade;
  const sun = [-0.55, -0.7, 0.62];
  const sunLen = Math.hypot(sun[0], sun[1], sun[2]);
  const sx = sun[0] / sunLen, sy = sun[1] / sunLen, sz = sun[2] / sunLen;

  for (let py = 0; py < H; py++) {
    const cy = Math.floor(view.y + ((py + 0.5) / H) * view.h);
    for (let px = 0; px < W; px++) {
      const cx = Math.floor(view.x + ((px + 0.5) / W) * view.w);
      const i = at(cx, cy);
      const e = elev[i];
      let r: number, g: number, b: number;

      if (e <= 0) {
        const t = Math.pow(Math.min(1, Math.max(0, -e / 4)), 0.45);
        r = (0.53 + (0.16 - 0.53) * t) * 255;
        g = (0.68 + (0.26 - 0.68) * t) * 255;
        b = (0.78 + (0.42 - 0.78) * t) * 255;
        // The pale rim just offshore: without it the coastline disappears and
        // you cannot tell where the land you are sculpting actually ends.
        const rim = Math.min(1, Math.max(0, 1 - (-e) / 0.06));
        r += (0.72 * 255 - r) * rim * 0.65;
        g += (0.83 * 255 - g) * rim * 0.65;
        b += (0.87 * 255 - b) * rim * 0.65;
      } else {
        const c = palette[Math.min(palette.length - 1, biome[i])] ?? [0.5, 0.5, 0.5];
        r = c[0] * 255; g = c[1] * 255; b = c[2] * 255;

        if (shadeAmt > 0) {
          const hx = elev[at(cx + 1, cy)] - elev[at(cx - 1, cy)];
          const hy = elev[at(cx, cy + 1)] - elev[at(cx, cy - 1)];
          const nx = -hx * 40, ny = -hy * 40, nz = 1;
          const nl = Math.hypot(nx, ny, nz) || 1;
          const lam = Math.max(0, (nx * sx + ny * sy + nz * sz) / nl);
          const k = 1 + (0.45 + 1.15 * lam - 1) * shadeAmt;
          r *= k; g *= k; b *= k;
        }
        if (opts.contourKm > 0) {
          const f = e / opts.contourKm;
          const frac = f - Math.floor(f);
          // Fixed-width band rather than the shader's screen-space derivative:
          // one is not available here, and at this resolution the difference is
          // a line that is a shade softer.
          if (frac < 0.06) { r *= 0.78; g *= 0.78; b *= 0.78; }
        }
      }

      if (opts.brush) {
        let dx = cx - opts.brush.x;
        dx -= gw * Math.round(dx / gw);
        const dist = Math.hypot(dx, cy - opts.brush.y);
        const thick = Math.max(opts.brush.r * 0.04, view.w * 0.002);
        if (Math.abs(dist - opts.brush.r) < thick) { r = r * 0.2 + 235; g = g * 0.2 + 235; b = b * 0.2 + 235; }
        else if (dist < opts.brush.r) { r = r * 1.05 + 8; g = g * 1.05 + 8; b = b * 1.05 + 8; }
      }

      const o = (py * W + px) * 3;
      lo[o] = r;
      lo[o + 1] = g;
      lo[o + 2] = b;
    }
  }

  // Expanded here rather than by drawing a temporary canvas.
  //
  // The canvas route needed `document.createElement`, which put a DOM dependency
  // in a module whose entire job is to be the thing that still works — and made
  // it untestable outside a browser. A bilinear expansion is a dozen lines and
  // has neither problem.
  const img = ctx.createImageData(CW, CH);
  const d = img.data;
  for (let y = 0; y < CH; y++) {
    const fy = Math.min(H - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(H - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < CW; x++) {
      const fx = Math.min(W - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(W - 1, x0 + 1);
      const tx = fx - x0;
      const a = (y0 * W + x0) * 3, b2 = (y0 * W + x1) * 3;
      const c = (y1 * W + x0) * 3, e2 = (y1 * W + x1) * 3;
      const o = (y * CW + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = lo[a + k] + (lo[b2 + k] - lo[a + k]) * tx;
        const bot = lo[c + k] + (lo[e2 + k] - lo[c + k]) * tx;
        d[o + k] = top + (bot - top) * ty;
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return true;
}
