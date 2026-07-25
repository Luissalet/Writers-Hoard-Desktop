// ============================================
// Cartography — GPU base pass
// ============================================
// The cartographic render is two stages: a raster base (paper, sea depth ramp,
// concentric coast rings, land tone, biome washes, relief shading, snow) and a
// vector ink pass (coastline, rivers, symbols, lettering). Measured on a
// 1600×800 sheet, the base is ~250 ms and the paper alone is ~317 ms cold —
// together the majority of every redraw, and the reason panning stuttered.
//
// Every one of those is a pure function of position and a few sampled fields.
// That is the definition of a fragment shader. This module runs the whole base
// on the GPU in one pass; the ink stays on canvas2D, where the hand-drawn look
// lives, and composites on top.
//
// The world's fields are uploaded once per revision. After that a pan or a zoom
// is a uniform update and one triangle — microseconds instead of a quarter of a
// second — which is what makes the wheel feel connected to the map.

import type { WorldData } from '../core/types';
import type { CartoTheme } from './theme';
import type { CartoFields } from './render';
import type { CartoView } from './render';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vScreen;
void main() {
  vScreen = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos.x, -aPos.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vScreen;
out vec4 fragColor;

uniform sampler2D uElev;      // R32F, km
uniform sampler2D uTint;      // RGBA8: biome wash colour + coverage
uniform sampler2D uSeaDist;   // R32F, cells from a sea cell to the nearest land
uniform sampler2D uLandDist;  // R32F, cells from a land cell to the nearest sea
uniform vec2 uGrid;
uniform vec4 uView;           // x, y, w, h in cells
uniform vec2 uOut;            // output size in pixels

uniform vec3 uPaper;          // paper base colour
uniform vec3 uPaperInk;       // paper tone colour
uniform vec3 uSeaShallow;
uniform vec3 uSeaDeep;
uniform vec3 uRing;
uniform vec3 uLand;
uniform vec3 uSnow;
uniform float uRingCount;
uniform float uRingWidth;     // in cells
uniform float uShade;
uniform float uTintAmount;
uniform float uGrain;
uniform float uSeed;

vec2 wrapUV(vec2 uv) { return vec2(fract(uv.x), clamp(uv.y, 0.0005, 0.9995)); }
float elevAt(vec2 uv) { return texture(uElev, wrapUV(uv)).r; }

// Cheap value noise. The paper needs texture, not correctness, and a hash is two
// orders of magnitude cheaper than uploading a megapixel of pre-rendered grain.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 cell = uView.xy + vScreen * uView.zw;
  vec2 uv = cell / uGrid;
  float e = elevAt(uv);

  // --- paper -------------------------------------------------------------
  // Two scales, exactly as the CPU version: a broad tone lattice that gives the
  // sheet its unevenness and a fine grain on top.
  vec2 px = vScreen * uOut;
  float tone = fbm(px * 0.0055);
  float grain = vnoise(px * 0.9);
  vec3 paper = mix(uPaper, uPaperInk, tone * 0.5 + grain * uGrain);

  vec3 col;
  if (e <= 0.0) {
    float depth = clamp(-e / 5.0, 0.0, 1.0);
    col = mix(uSeaShallow, uSeaDeep, pow(depth, 0.45));
    // Concentric coast rings, from the true geodesic distance field rather than
    // a blurred alpha — that exactness is why they hug every inlet.
    float d = texture(uSeaDist, wrapUV(uv)).r;
    if (uRingCount > 0.0 && d < uRingWidth * uRingCount) {
      float band = d / uRingWidth;
      float f = abs(fract(band) - 0.5) * 2.0;
      float fade = 1.0 - band / uRingCount;
      float line = smoothstep(0.55, 1.0, f) * fade * fade;
      col = mix(col, uRing, line * 0.55);
    }
    col = mix(col, paper, 0.12);
  } else {
    col = mix(uLand, paper, 0.55);
    vec4 tint = texture(uTint, wrapUV(uv));
    col = mix(col, tint.rgb, clamp(tint.a, 0.0, 1.0) * uTintAmount);

    // Relief shading from the elevation field, NW sun, exactly the convention
    // the symbol layer assumes.
    if (uShade > 0.0) {
      vec2 t = 1.0 / uGrid;
      float hx = elevAt(uv + vec2(t.x, 0.0)) - elevAt(uv - vec2(t.x, 0.0));
      float hy = elevAt(uv + vec2(0.0, t.y)) - elevAt(uv - vec2(0.0, t.y));
      vec3 n = normalize(vec3(-hx * 26.0, -hy * 26.0, 1.0));
      float lam = clamp(dot(n, normalize(vec3(-0.6, -0.6, 0.53))), 0.0, 1.0);
      col *= mix(1.0, 0.72 + 0.5 * lam, uShade);
    }
    // Snow above the line, feathered so it does not read as a contour.
    float snow = smoothstep(2.1, 3.0, e);
    col = mix(col, uSnow, snow * 0.75);
  }

  fragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`carto base shader: ${log}`);
  }
  return sh;
}

function hexToRgb01(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export interface CartoBaseOptions {
  theme: CartoTheme;
  shading: boolean;
  biomeTint: boolean;
  coastRings: boolean;
}

/**
 * GPU renderer for the cartographic base.
 *
 * Holds the world's fields as textures and re-uploads them only when the world's
 * revision changes — which is what turns a pan from a full redraw into a uniform
 * write. The caller composites the ink pass on top of the canvas this owns.
 */
export class CartoBaseGL {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: Record<string, WebGLTexture> = {};
  private u: Record<string, WebGLUniformLocation | null> = {};
  private uploadedRev = -1;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gridW: number;
  readonly gridH: number;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, world: WorldData) {
    this.canvas = canvas;
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: false, antialias: false, depth: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    this.gridW = world.width;
    this.gridH = world.height;
    gl.getExtension('EXT_color_buffer_float');

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`carto base link: ${gl.getProgramInfoLog(prog)}`);
    }
    this.prog = prog;
    gl.useProgram(prog);
    for (const n of [
      'uElev', 'uTint', 'uSeaDist', 'uLandDist', 'uGrid', 'uView', 'uOut',
      'uPaper', 'uPaperInk', 'uSeaShallow', 'uSeaDeep', 'uRing', 'uLand', 'uSnow',
      'uRingCount', 'uRingWidth', 'uShade', 'uTintAmount', 'uGrain', 'uSeed',
    ]) this.u[n] = gl.getUniformLocation(prog, n);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.tex.elev = this.makeTex(gl.R32F, 0, gl.NEAREST);
    this.tex.tint = this.makeTex(gl.RGBA8, 1, gl.LINEAR);
    this.tex.seaDist = this.makeTex(gl.R32F, 2, gl.NEAREST);
    this.tex.landDist = this.makeTex(gl.R32F, 3, gl.NEAREST);
    gl.uniform1i(this.u.uElev!, 0);
    gl.uniform1i(this.u.uTint!, 1);
    gl.uniform1i(this.u.uSeaDist!, 2);
    gl.uniform1i(this.u.uLandDist!, 3);
    gl.uniform2f(this.u.uGrid!, this.gridW, this.gridH);
  }

  private makeTex(internal: number, unit: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, this.gridW, this.gridH);
    // R32F is NOT linearly filterable in core WebGL2 (that needs
    // OES_texture_float_linear). Asking for LINEAR on it makes the texture
    // incomplete and every sample returns zero — which showed up as a flat grey
    // ocean with no depth and no coast rings, i.e. the shader silently reading a
    // field of zeroes and dutifully colouring it in.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * Push the world's fields, but only when the revision moved. Skipping this on
   * a pan is the difference between the GPU path being a win and being a wash:
   * uploading 8 MB per frame costs more than the CPU render it replaced.
   */
  sync(world: WorldData, fields: CartoFields, tint: { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }): void {
    const rev = world.revision ?? 0;
    if (rev === this.uploadedRev) return;
    const gl = this.gl;
    const N = this.gridW * this.gridH;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.elev);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RED, gl.FLOAT, world.elevation);

    const rgba = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      rgba[i * 4] = Math.min(255, Math.max(0, tint.r[i]));
      rgba[i * 4 + 1] = Math.min(255, Math.max(0, tint.g[i]));
      rgba[i * 4 + 2] = Math.min(255, Math.max(0, tint.b[i]));
      rgba[i * 4 + 3] = Math.min(255, Math.max(0, tint.a[i] * 255));
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.tint);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.seaDist);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RED, gl.FLOAT, fields.seaDist);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.landDist);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RED, gl.FLOAT, fields.landDist);

    this.uploadedRev = rev;
  }

  draw(view: CartoView, w: number, h: number, opts: CartoBaseOptions, seed: number): void {
    const gl = this.gl;
    const c = this.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    for (const [unit, key] of [[0, 'elev'], [1, 'tint'], [2, 'seaDist'], [3, 'landDist']] as [number, string][]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[key]);
    }
    const t = opts.theme;
    gl.uniform4f(this.u.uView!, view.x, view.y, view.w, view.h);
    gl.uniform2f(this.u.uOut!, w, h);
    gl.uniform3fv(this.u.uPaper!, hexToRgb01(t.paper.base));
    gl.uniform3fv(this.u.uPaperInk!, hexToRgb01(t.paper.grain));
    gl.uniform3fv(this.u.uSeaShallow!, hexToRgb01(t.ocean.shallow));
    gl.uniform3fv(this.u.uSeaDeep!, hexToRgb01(t.ocean.deep));
    gl.uniform3fv(this.u.uRing!, hexToRgb01(t.ocean.rings.color));
    gl.uniform3fv(this.u.uLand!, hexToRgb01(t.land.base));
    gl.uniform3fv(this.u.uSnow!, hexToRgb01(t.mountains.snow));
    gl.uniform1f(this.u.uRingCount!, opts.coastRings ? t.ocean.rings.count : 0);
    // Ring spacing is authored in map pixels at scale 1, i.e. in cells.
    gl.uniform1f(this.u.uRingWidth!, Math.max(0.6, t.ocean.rings.spacing));
    gl.uniform1f(this.u.uShade!, opts.shading ? 1 : 0);
    gl.uniform1f(this.u.uTintAmount!, opts.biomeTint ? 0.85 : 0);
    gl.uniform1f(this.u.uGrain!, t.paper.grainAmount);
    gl.uniform1f(this.u.uSeed!, seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of Object.values(this.tex)) gl.deleteTexture(t);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }
}
