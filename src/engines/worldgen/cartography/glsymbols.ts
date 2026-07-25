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
// STATUS: the module works — 2723 symbols in one instanced draw — but it is NOT
// wired into the app yet, deliberately. Its size and mip calibration against the
// canvas2D symbols is not right (peaks come out too heavy, and a mipmapped atlas
// goes soft at map zooms), and the only GPU available here is a software
// rasteriser, so the speed claim cannot be verified either. Shipping it on by
// default would trade a measured 190 ms for an unmeasured saving and a visibly
// worse map. It goes in switched off, with the harness that exercises it, and
// gets turned on when it has been calibrated against real hardware.
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
          switch (kind) {
            case 'mountain':
            case 'hill': {
              const isHill = kind === 'hill';
              const ratio = isHill ? 1.7 + rng() * 0.8 : 2.3 + rng() * 2.2;
              const natW = h * ratio * 0.55;
              ctx.scale((cell * 0.98) / natW, (cell * 0.9) / h);
              drawMountain(ctx, rng, theme, {
                w: h * ratio * 0.55,
                h,
                snow: s / (SNOW_LEVELS - 1),
                // The atlas cannot know the terrain colour under each future
                // placement, so the silhouette is filled with the theme's land
                // tone. The base pass already put the biome wash underneath.
                fill: theme.land.base,
              }, isHill);
              break;
            }
            // The rest are authored by height with a natural width near their
            // height, so a plain fit is enough.
            case 'conifer': ctx.scale(1.25, 1.05); drawConifer(ctx, rng, theme, h); break;
            case 'broadleaf': ctx.scale(1.15, 1.05); drawBroadleaf(ctx, rng, theme, h); break;
            case 'palm': ctx.scale(1.05, 1.02); drawPalm(ctx, rng, theme, h); break;
            case 'cactus': ctx.scale(1.6, 1.05); drawCactus(ctx, rng, theme, h); break;
            case 'dune': drawDune(ctx, rng, theme, h * 0.9); break;
            case 'marsh': drawMarsh(ctx, rng, theme, h * 0.9); break;
          }
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
      d[o] = s.x; d[o + 1] = s.y; d[o + 2] = s.w; d[o + 3] = s.h;
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
