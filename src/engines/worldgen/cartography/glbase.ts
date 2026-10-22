// Cartographic raster on the GPU. The ink stays in Canvas2D; this pass shares
// the export's parchment, smooth field sampling and theme parameters.
import type { WorldData } from '../core/types';
import type { CartoTheme } from './theme';
import { getCartoPaper, type CartoFields, type CartoView } from './render';

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
uniform sampler2D uGround; // elevation, sea distance, hillshade, temperature
uniform sampler2D uTint, uLake, uPaper;
uniform vec2 uGrid, uOut;
uniform vec4 uView;
uniform vec3 uPaperBase, uSeaShallow, uSeaDeep, uLand, uSnow, uShadeColor, uRing, uLakeColor;
uniform float uDeepAt, uRingCount, uRingSpacing, uRingWidth, uRingAlpha, uRingFalloff, uShade, uTintAmount;
uniform vec3 uHighland;
uniform vec3 uTerrain; // start, upper elevation, pigment strength
ivec2 cellAt(ivec2 p) {
  int w = int(uGrid.x);
  return ivec2((p.x % w + w) % w, clamp(p.y, 0, int(uGrid.y) - 1));
}
// Float textures need explicit filtering in core WebGL2. The C1 weights match
// the CPU washes and avoid visible nearest-cell blocks on a close hillside.
vec4 fieldAt(sampler2D field, vec2 cell) {
  vec2 f = cell - 0.5;
  ivec2 a = ivec2(floor(f));
  a.y = clamp(a.y, 0, int(uGrid.y) - 1);
  vec2 t = f - vec2(a);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(texelFetch(field, cellAt(a), 0), texelFetch(field, cellAt(a + ivec2(1, 0)), 0), t.x),
    mix(texelFetch(field, cellAt(a + ivec2(0, 1)), 0), texelFetch(field, cellAt(a + ivec2(1, 1)), 0), t.x), t.y);
}
void main() {
  float scale = uOut.x / uView.z;
  vec2 cell = uView.xy + vScreen * uOut / scale;
  vec4 ground = fieldAt(uGround, cell);
  float e = ground.r;
  vec3 paper = texture(uPaper, vScreen).rgb;
  float modulation = dot(paper, vec3(0.3, 0.5, 0.2)) / max(0.00001, dot(uPaperBase, vec3(0.3, 0.5, 0.2)));
  vec3 col;
  if (e <= 0.0) {
    col = mix(uSeaShallow, uSeaDeep, min(1.0, sqrt(max(0.0, -e / uDeepAt))) * 0.82);
    float d = ground.g * scale;
    for (int k = 0; k < int(uRingCount); k++) {
      float dd = abs(d - (float(k) + 1.0) * uRingSpacing);
      if (dd > uRingWidth) continue;
      float a = uRingAlpha * pow(uRingFalloff, float(k)) * (0.5 + 0.5 * cos(dd / uRingWidth * 3.141592653589793));
      col = mix(col, uRing, a);
    }
    col *= 1.0 + (modulation - 1.0) * 0.38;
  } else {
    col = mix(paper, uLand, 0.55);
    vec4 tint = fieldAt(uTint, cell);
    if (tint.a * uTintAmount > 0.002) col = mix(col, tint.rgb, tint.a * uTintAmount);
    float heightWash = clamp((e - uTerrain.x) / max(0.001, uTerrain.y - uTerrain.x), 0.0, 1.0);
    col = mix(col, uHighland, min(1.0, heightWash * heightWash * (3.0 - 2.0 * heightWash) * uTerrain.z));
    col = mix(col, uShadeColor, ground.b * uShade);
    ivec2 nearest = cellAt(ivec2(floor(cell)));
    float temperature = texelFetch(uGround, nearest, 0).a;
    float snow = clamp((-temperature - 5.0) / 10.0 + max(0.0, e - 3.0) * 0.3, 0.0, 1.0);
    if (snow > 0.0 && e > 1.6) col = mix(col, uSnow, snow * snow * (3.0 - 2.0 * snow) * 0.9);
    if (texelFetch(uLake, nearest, 0).r > 0.0) col = uLakeColor * (1.0 + (modulation - 1.0) * 0.3);
  }
  fragColor = vec4(col, 1.0);
}`;
function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`carto shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}
function color(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
export interface CartoBaseOptions { theme: CartoTheme; shading: boolean; biomeTint: boolean; coastRings: boolean; relief?: boolean; reliefAmount?: number }
type Tint = { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array };

export class CartoBaseGL {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private textures: WebGLTexture[] = [];
  private u: Record<string, WebGLUniformLocation | null> = {};
  private uploadedRev = -1;
  private uploadedTint: Tint | null = null;
  private uploadedPaper: Uint8ClampedArray | null = null;
  private world: WorldData;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gridW: number;
  readonly gridH: number;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, world: WorldData) {
    this.canvas = canvas; this.world = world;
    this.gridW = world.width; this.gridH = world.height;
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { alpha: false, antialias: false, depth: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    const prog = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const shader = compile(gl, type, source); gl.attachShader(prog, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`carto base link: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog; gl.useProgram(prog);
    for (const name of ['uGround', 'uTint', 'uLake', 'uPaper', 'uGrid', 'uView', 'uOut', 'uPaperBase', 'uSeaShallow', 'uSeaDeep', 'uLand', 'uSnow', 'uShadeColor', 'uRing', 'uLakeColor', 'uDeepAt', 'uRingCount', 'uRingSpacing', 'uRingWidth', 'uRingAlpha', 'uRingFalloff', 'uShade', 'uTintAmount', 'uHighland', 'uTerrain']) this.u[name] = gl.getUniformLocation(prog, name);
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const [unit, name] of ['uGround', 'uTint', 'uLake', 'uPaper'].entries()) {
      const texture = gl.createTexture()!; this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.u[name], unit);
    }
    gl.uniform2f(this.u.uGrid, this.gridW, this.gridH);
  }

  sync(world: WorldData, fields: CartoFields, tint: Tint): void {
    this.world = world;
    const gl = this.gl, n = this.gridW * this.gridH, revision = world.revision ?? 0;
    if (revision !== this.uploadedRev) {
      const ground = new Float32Array(n * 4);
      // The fourth channel only draws snow, so it carries the author's snowline shift.
      const snowShift = world.painted?.snowShiftC ?? 0;
      for (let i = 0; i < n; i++) { ground[i * 4] = world.elevation[i]; ground[i * 4 + 1] = fields.seaDist[i]; ground[i * 4 + 2] = fields.shade[i]; ground[i * 4 + 3] = world.temperature[i] + snowShift; }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.gridW, this.gridH, 0, gl.RGBA, gl.FLOAT, ground);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.textures[2]); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.gridW, this.gridH, 0, gl.RED, gl.UNSIGNED_BYTE, world.lake);
      this.uploadedRev = revision; this.uploadedTint = null;
    }
    // Changing the wash never uploads the physical fields again.
    if (tint !== this.uploadedTint) {
      const rgba = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { rgba[i * 4] = tint.r[i] / 255; rgba[i * 4 + 1] = tint.g[i] / 255; rgba[i * 4 + 2] = tint.b[i] / 255; rgba[i * 4 + 3] = tint.a[i]; }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.gridW, this.gridH, 0, gl.RGBA, gl.FLOAT, rgba);
      this.uploadedTint = tint;
    }
  }

  draw(view: CartoView, w: number, h: number, opts: CartoBaseOptions, _seed = 0): void {
    // Kept for callers of the original API; paper now follows the world's seed.
    void _seed;
    const gl = this.gl, theme = opts.theme;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    for (const [unit, texture] of this.textures.entries()) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); }
    // Shared LRU: the parchment does not regenerate on pan or zoom.
    const paper = getCartoPaper(this.world, theme, w, h);
    if (paper !== this.uploadedPaper) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.textures[3]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, paper);
      this.uploadedPaper = paper;
    }
    gl.uniform4f(this.u.uView, view.x, view.y, view.w, view.h); gl.uniform2f(this.u.uOut, w, h);
    const terrain = theme.terrain;
    gl.uniform3fv(this.u.uHighland, color(terrain?.highland ?? theme.land.base));
    gl.uniform3f(this.u.uTerrain, terrain?.start ?? 0, terrain?.at ?? 1, opts.relief === false ? 0 : (terrain?.alpha ?? 0) * (opts.reliefAmount ?? 1));
    for (const [name, hex] of Object.entries({ uPaperBase: theme.paper.base, uSeaShallow: theme.ocean.shallow, uSeaDeep: theme.ocean.deep, uLand: theme.land.base, uSnow: theme.land.snow, uShadeColor: theme.land.shadeColor, uRing: theme.ocean.rings.color, uLakeColor: theme.lakes.fill })) gl.uniform3fv(this.u[name], color(hex));
    for (const [name, value] of Object.entries({ uDeepAt: theme.ocean.deepAt, uRingCount: opts.coastRings ? theme.ocean.rings.count : 0, uRingSpacing: theme.ocean.rings.spacing, uRingWidth: theme.ocean.rings.width, uRingAlpha: theme.ocean.rings.alpha, uRingFalloff: theme.ocean.rings.falloff, uShade: opts.shading ? theme.land.shading : 0, uTintAmount: opts.biomeTint ? theme.land.tintAlpha : 0 })) gl.uniform1f(this.u[name], value);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose(): void {
    const gl = this.gl;
    for (const texture of this.textures) gl.deleteTexture(texture);
    gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog);
  }
}
