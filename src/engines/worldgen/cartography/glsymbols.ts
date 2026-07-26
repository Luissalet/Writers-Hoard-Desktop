// ============================================
// Cartography — instanced symbol layer
// ============================================
// After the base pass moved to the GPU, the remaining cost of a cartographic
// redraw is the symbols: roughly three thousand mountains, hills and trees, each
// one a handful of canvas2D paths with a fill, a stroke and internal shading.
// That is ~190 ms of the ~250 ms that was left, and it is the last thing standing
// between a wheel turn and an instant map.
//
// The fix is the one every sprite renderer has used since the nineties: draw each
// distinct shape ONCE into an atlas, then issue a single instanced draw for all
// three thousand placements.
//
// STATUS: the geometry is now CALIBRATED. `harness/symbol-calib.ts` renders each
// symbol both ways and compares ink coverage, width and height; the `INK` table
// below is the result, and with it every symbol matches the canvas2D one to
// within a few per cent. That closes the half of the objection that could be
// settled here.
//
// It is still OFF BY DEFAULT, for the half that cannot: the only GPU in this
// container is a software rasteriser, so the speed claim — the entire reason for
// the layer — remains unverified on real hardware. It is exposed as a switch in
// the carta toolbar so it can be turned on and compared directly against the
// canvas2D path, which is the only measurement that would actually settle it.
//
// This costs continuous variation — a symbol becomes one of N pre-rendered
// variants instead of a fresh random shape — and that is the right trade here,
// because it is also what the reference does. Wonderdraft ships a finite set of
// hand-drawn mountains and nobody has ever looked at one and thought "that range
// only has twenty-four different peaks in it". Twenty-four is plenty; the eye
// reads the SKYLINE, which comes from position, size and overlap, not from every
// peak being unique.

import { createRng } from '../core/rng';
import type { CartoTheme } from './theme';
import {
  drawBroadleaf, drawCactus, drawConifer, drawDune, drawMarsh, drawMountain, drawPalm,
  type Ctx,
} from './symbols';

export type SymbolKind = 'mountain' | 'hill' | 'conifer' | 'broadleaf' | 'palm' | 'cactus' | 'dune' | 'marsh';

/** How many pre-rendered variants each kind gets. */
const VARIANTS: Record<SymbolKind, number> = {
  mountain: 24, hill: 16, conifer: 10, broadleaf: 10, palm: 8, cactus: 8, dune: 8, marsh: 8,
};

/** Snow levels baked into the mountain variants: none, dusted, capped. */
const SNOW_LEVELS = 3;

export interface AtlasEntry {
  /** First cell index for this kind. */
  base: number;
  count: number;
}

export interface SymbolAtlas {
  canvas: HTMLCanvasElement;
  /** Cell size in atlas pixels. */
  cell: number;
  cols: number;
  rows: number;
  entries: Record<SymbolKind, AtlasEntry>;
  /** Where the symbol's ground line sits inside its cell, 0–1 from the top. */
  baseline: number;
}

/**
 * Render the symbol vocabulary into one texture.
 *
 * Each cell holds one variant drawn at a generous size; the instanced pass scales
 * it down, so the atlas is effectively a mip-0 that stays crisp at every zoom the
 * map supports. Symbols are drawn standing on the cell's baseline because that is
 * the anchor the placement pass uses — a mountain is positioned by its feet.
 */
export function buildSymbolAtlas(
  theme: CartoTheme,
  seed: string,
  cell = 128,
): SymbolAtlas {
  const kinds = Object.keys(VARIANTS) as SymbolKind[];
  let total = 0;
  const entries = {} as Record<SymbolKind, AtlasEntry>;
  for (const k of kinds) {
    const n = k === 'mountain' || k === 'hill' ? VARIANTS[k] * SNOW_LEVELS : VARIANTS[k];
    entries[k] = { base: total, count: n };
    total += n;
  }
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  const baseline = 0.92;

  const place = (index: number) => {
    const cx = (index % cols) * cell;
    const cy = Math.floor(index / cols) * cell;
    ctx.save();
    ctx.translate(cx + cell / 2, cy + cell * baseline);
    return () => ctx.restore();
  };

  for (const kind of kinds) {
    const e = entries[kind];
    const variantCount = kind === 'mountain' || kind === 'hill' ? VARIANTS[kind] : e.count;
    for (let v = 0; v < variantCount; v++) {
      const snowSteps = kind === 'mountain' || kind === 'hill' ? SNOW_LEVELS : 1;
      for (let s = 0; s < snowSteps; s++) {
        const idx = e.base + v * snowSteps + s;
        const done = place(idx);
        const rng = createRng(seed, `atlas:${kind}:${v}`);
        const h = cell * 0.78;
        try {
          // Each variant is drawn to FILL its cell in both axes. The instance
          // then stretches that cell to the width and height the placement asked
          // for, which restores the per-symbol proportions — and is why a
          // twenty-four-cell atlas still produces peaks of every width.
          //
          // Without this the natural width of a wide mountain (up to 2.5× the
          // cell) was simply clipped, and every range came out as a row of
          // squashed tents.
          drawAtlasCell(ctx, kind, rng, theme, cell, h, s / Math.max(1, SNOW_LEVELS - 1));
        } finally {
          done();
        }
      }
    }
  }
  return { canvas, cell, cols, rows, entries, baseline };
}

// ---------------------------------------------------------------------------

const VERT = `#version 300 es
in vec2 aCorner;        // unit quad, 0..1
in vec4 aRect;          // x, y (baseline centre, px), w, h
in float aCellIndex;
in float aAlpha;
out vec2 vUV;
out float vAlpha;
uniform vec2 uOut;
uniform vec2 uAtlasGrid;   // cols, rows
void main() {
  // The instance is anchored at its FEET: the placement pass positions a
  // mountain by the point it stands on, not by its middle.
  vec2 p = vec2(aRect.x + (aCorner.x - 0.5) * aRect.z,
                aRect.y + (aCorner.y - 1.0) * aRect.w);
  vec2 clip = (p / uOut) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float col = mod(aCellIndex, uAtlasGrid.x);
  float row = floor(aCellIndex / uAtlasGrid.x);
  vUV = (vec2(col, row) + aCorner) / uAtlasGrid;
  vAlpha = aAlpha;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
out vec4 fragColor;
uniform sampler2D uAtlas;
void main() {
  vec4 c = texture(uAtlas, vUV);
  if (c.a < 0.004) discard;
  fragColor = vec4(c.rgb, c.a * vAlpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`symbol shader: ${log}`);
  }
  return sh;
}

/**
 * The per-kind drawing step, exported so it can be MEASURED.
 *
 * It used to be an inline switch inside the atlas builder, and that is how the
 * first calibration pass went wrong: the harness could not call the builder —
 * it needs a DOM canvas — so it re-implemented what it believed the builder did,
 * measured its own re-implementation, and produced a correction table for a
 * function that does not exist. Two of the eight numbers were wrong because the
 * model was wrong, not because the atlas was.
 *
 * A measurement is only worth what the thing it measured is. Pulling this out
 * means the calibration harness and the atlas call the same code.
 */
export function drawAtlasCell(
  ctx: Ctx,
  kind: SymbolKind,
  rng: () => number,
  theme: CartoTheme,
  cell: number,
  h: number,
  snow: number,
): void {
  switch (kind) {
    case 'mountain':
    case 'hill': {
      const isHill = kind === 'hill';
      const ratio = isHill ? 1.7 + rng() * 0.8 : 2.3 + rng() * 2.2;
      const natW = h * ratio * 0.55;
      // Each variant is drawn to FILL its cell in both axes. The instance then
      // stretches that cell to the width and height the placement asked for,
      // which restores the per-symbol proportions — and is why a twenty-four-cell
      // atlas still produces peaks of every width.
      ctx.scale((cell * 0.98) / natW, (cell * 0.9) / h);
      drawMountain(ctx, rng, theme, {
        w: natW,
        h,
        snow,
        // The atlas cannot know the terrain colour under each future placement,
        // so the silhouette is filled with the theme's land tone. The base pass
        // already put the biome wash underneath.
        fill: theme.land.base,
      }, isHill);
      break;
    }
    // The rest are authored by height with a natural width near their height,
    // so a plain fit is enough — except the two made of strokes, which are drawn
    // without distortion because scaling a stroke scales its weight.
    case 'conifer': ctx.scale(1.25, 1.05); drawConifer(ctx, rng, theme, h); break;
    case 'broadleaf': ctx.scale(1.15, 1.05); drawBroadleaf(ctx, rng, theme, h); break;
    case 'palm': ctx.scale(1.05, 1.02); drawPalm(ctx, rng, theme, h); break;
    case 'cactus': ctx.scale(1.6, 1.05); drawCactus(ctx, rng, theme, h); break;
    case 'dune': drawDune(ctx, rng, theme, h * 0.9); break;
    case 'marsh': drawMarsh(ctx, rng, theme, h * 0.9); break;
  }
}

/**
 * How much bigger the atlas cell has to be drawn than the symbol's nominal size,
 * so the INK ends up the same as the canvas2D symbol's.
 *
 * Measured, not guessed. Every variant is stretched to fill its cell, so drawing
 * the cell at the nominal height would give ink exactly that tall — but the
 * direct symbols do not respect their nominal height either: a mountain's ink is
 * 1.14 times its `h` and a dune's is 0.26. `harness/symbol-calib.ts` renders both
 * and reports the ratios; these are those ratios.
 *
 * Before this table the atlas produced everything 15 % too tall and everything
 * except mountains 44 % too wide, which is precisely the "peaks come out too
 * heavy" that kept the layer switched off — except that it was not the peaks,
 * and it was not weight, it was every symbol and it was scale.
 */
const INK: Record<SymbolKind, { w: number; h: number; uniform?: boolean }> = {
  mountain: { w: 2.01, h: 1.15 },
  hill: { w: 1.20, h: 1.13 },
  conifer: { w: 1.04, h: 1.22 },
  broadleaf: { w: 1.10, h: 1.23 },
  palm: { w: 1.22, h: 1.25 },
  cactus: { w: 0.80, h: 1.21 },
  // Drawn at UNIFORM scale, in a square cell, because they are made of strokes
  // rather than of filled shapes. A dune is two thin curves and is four times
  // wider than tall; stretching its cell to that aspect stretches the STROKE
  // WIDTH with it, and the measurement caught it — the ink came out 2.7 times
  // heavier than the direct symbol while the box matched perfectly. A filled
  // outline does not care about anisotropic scale; a stroke does.
  dune: { w: 1.44, h: 0.41, uniform: true },
  marsh: { w: 1.43, h: 1.15, uniform: true },
};

/**
 * Turn a nominal placement into the cell rectangle that reproduces the direct
 * symbol's ink. `w` is honoured as an explicit width when the caller sets one
 * (mountains vary in span); otherwise it comes from the measured aspect.
 */
export function inkRect(s: SymbolInstance): { w: number; h: number } {
  const k = INK[s.kind];
  if (k.uniform) {
    // A square cell drawn at a square size: both the atlas draw and the instance
    // draw stay uniform, so the ink keeps both its aspect and its stroke weight.
    const side = s.h * Math.max(k.w, k.h);
    return { w: side, h: side };
  }
  return { w: s.w > 0 ? s.w : s.h * k.w, h: s.h * k.h };
}

/** True when this kind must be drawn into its atlas cell without distortion. */
export function isUniformKind(kind: SymbolKind): boolean {
  return INK[kind].uniform === true;
}

/** One placement, in output pixels, ready for the instance buffer. */
export interface SymbolInstance {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: SymbolKind;
  /** 0–1, picks the variant deterministically. */
  variant: number;
  /** 0–1, picks the snow step for mountains and hills. */
  snow: number;
  alpha: number;
}

/**
 * Instanced symbol renderer.
 *
 * Draws every symbol on the sheet in one call. The instances must arrive sorted
 * back-to-front by their baseline: instanced draws render in buffer order, so the
 * painter's algorithm the map depends on is simply the order of this array.
 */
export class SymbolGL {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instBuf: WebGLBuffer;
  private tex: WebGLTexture;
  private uOut: WebGLUniformLocation | null;
  private uGrid: WebGLUniformLocation | null;
  private data = new Float32Array(0);
  readonly canvas: HTMLCanvasElement;

  readonly atlas: SymbolAtlas;

  // Explicit fields, not constructor parameter properties: `erasableSyntaxOnly`.
  constructor(canvas: HTMLCanvasElement, atlas: SymbolAtlas) {
    this.canvas = canvas;
    this.atlas = atlas;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`symbol link: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    gl.useProgram(prog);
    this.uOut = gl.getUniformLocation(prog, 'uOut');
    this.uGrid = gl.getUniformLocation(prog, 'uAtlasGrid');
    gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
    gl.uniform2f(this.uGrid, atlas.cols, atlas.rows);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aCorner = gl.getAttribLocation(prog, 'aCorner');
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const stride = 6 * 4;
    const aRect = gl.getAttribLocation(prog, 'aRect');
    gl.enableVertexAttribArray(aRect);
    gl.vertexAttribPointer(aRect, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(aRect, 1);
    const aCell = gl.getAttribLocation(prog, 'aCellIndex');
    gl.enableVertexAttribArray(aCell);
    gl.vertexAttribPointer(aCell, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(aCell, 1);
    const aAlpha = gl.getAttribLocation(prog, 'aAlpha');
    gl.enableVertexAttribArray(aAlpha);
    gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(aAlpha, 1);
    this.vao = vao;

    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    // No mipmaps: a mountain 18 px tall sampled from a mipped 128 px cell turns
    // into a soft blob, and the hand-drawn ink line is exactly what must stay
    // crisp. Supersampling the atlas is the correct fix, not mip filtering.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private cellFor(inst: SymbolInstance): number {
    const e = this.atlas.entries[inst.kind];
    const snowSteps = inst.kind === 'mountain' || inst.kind === 'hill' ? SNOW_LEVELS : 1;
    const variants = e.count / snowSteps;
    const v = Math.min(variants - 1, Math.floor(inst.variant * variants));
    const s = Math.min(snowSteps - 1, Math.floor(inst.snow * snowSteps));
    return e.base + v * snowSteps + s;
  }

  draw(instances: SymbolInstance[], w: number, h: number): number {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!instances.length) return 0;

    const need = instances.length * 6;
    if (this.data.length < need) this.data = new Float32Array(need * 2);
    const d = this.data;
    for (let i = 0; i < instances.length; i++) {
      const s = instances[i];
      const o = i * 6;
      const r = inkRect(s);
      d[o] = s.x; d[o + 1] = s.y; d[o + 2] = r.w; d[o + 3] = r.h;
      d[o + 4] = this.cellFor(s);
      d[o + 5] = s.alpha;
    }

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, need), gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform2f(this.uOut, w, h);
    gl.enable(gl.BLEND);
    // The atlas is straight (non-premultiplied) alpha, straight out of canvas2D.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.length);
    return instances.length;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.instBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }
}
