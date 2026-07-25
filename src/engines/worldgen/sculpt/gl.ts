// ============================================
// Sculpt view — WebGL terrain editor
// ============================================
// The cartographic renderer draws a finished map: paper grain, hand-drawn
// coastline, thousands of relief and forest symbols, lettering. It costs a few
// hundred milliseconds a frame and it is *supposed* to — that is a publication
// view.
//
// Editing needs the opposite trade. So the terrain lives in a GPU texture and the
// whole picture — sea depth, hillshade, biome tint, contour lines, brush ring — is
// one fragment shader. A brush stroke uploads only the rectangle it touched, which
// is a few kilobytes, and the frame costs microseconds. Nothing is re-derived, no
// component re-renders, nothing flashes.
//
// The data contract is untouched: this is a VIEW. A finished stroke still becomes
// one `WorldEdit` in the session's list, so undo, serialisation and "a world is a
// seed plus an edit list" all keep working exactly as before.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
uniform vec4 uView;   // x, y, w, h  in cell coordinates
uniform vec2 uGrid;   // world width, height in cells
void main() {
  // aPos is a full-screen triangle pair in clip space.
  vUV = (aPos * 0.5 + 0.5);
  // Flip in the UV, not in the position: flipping the position while sampling
  // from the unflipped UV renders the world upside down.
  vUV = vec2(vUV.x, 1.0 - vUV.y);
  vec2 cell = uView.xy + vUV * uView.zw;
  vUV = cell / uGrid;
  gl_Position = vec4(aPos.x, aPos.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uHeight;
uniform sampler2D uBiome;
uniform vec3 uPalette[32];
uniform vec2 uGrid;
uniform vec4 uView;
uniform vec2 uBrush;        // cell coordinates of the pointer
uniform float uBrushR;      // brush radius in cells
uniform float uBrushOn;
uniform float uContour;     // contour interval in km, 0 = off
uniform float uShade;       // hillshade strength

float h(vec2 uv) {
  // Wrap in x, clamp in y: the world is a cylinder.
  vec2 t = vec2(fract(uv.x), clamp(uv.y, 0.0005, 0.9995));
  return texture(uHeight, t).r;
}

void main() {
  vec2 texel = 1.0 / uGrid;
  float e = h(vUV);

  vec3 col;
  if (e <= 0.0) {
    // Sea: a depth ramp with a shelf break, so the continental shelf reads.
    float d = clamp(-e / 4.0, 0.0, 1.0);
    vec3 shallow = vec3(0.53, 0.68, 0.78);
    vec3 deep = vec3(0.16, 0.26, 0.42);
    col = mix(shallow, deep, pow(d, 0.45));
    // A pale rim in the first cells offshore: the eye needs the coastline.
    float rim = smoothstep(0.06, 0.0, -e);
    col = mix(col, vec3(0.72, 0.83, 0.87), rim * 0.65);
  } else {
    int b = int(texture(uBiome, vec2(fract(vUV.x), clamp(vUV.y, 0.0005, 0.9995))).r * 255.0 + 0.5);
    col = uPalette[clamp(b, 0, 31)];
  }

  // Hillshade from central differences. On land it is the whole reason the
  // surface reads as terrain while you are pushing it around.
  if (e > 0.0 && uShade > 0.0) {
    float hx = h(vUV + vec2(texel.x, 0.0)) - h(vUV - vec2(texel.x, 0.0));
    float hy = h(vUV + vec2(0.0, texel.y)) - h(vUV - vec2(0.0, texel.y));
    vec3 n = normalize(vec3(-hx * 40.0, -hy * 40.0, 1.0));
    vec3 sun = normalize(vec3(-0.55, -0.7, 0.62));
    float lam = clamp(dot(n, sun), 0.0, 1.0);
    col *= mix(1.0, 0.45 + 1.15 * lam, uShade);
  }

  // Contour lines: this is a heightmap editor, and contours are how you read
  // one. Screen-space derivative keeps them one pixel wide at every zoom.
  if (e > 0.0 && uContour > 0.0) {
    float f = e / uContour;
    float w = fwidth(f);
    float line = 1.0 - smoothstep(0.0, w * 1.2, abs(fract(f) - 0.5) - 0.5 + w * 1.2);
    col = mix(col, col * 0.72, clamp(line, 0.0, 1.0) * 0.55);
  }

  // Brush ring, in cell space so it tracks the terrain rather than the screen.
  if (uBrushOn > 0.5) {
    vec2 cell = vUV * uGrid;
    vec2 d = cell - uBrush;
    d.x -= uGrid.x * floor(d.x / uGrid.x + 0.5);   // wrap the seam
    float dist = length(d);
    float px = uView.z / max(1.0, float(textureSize(uHeight, 0).x)) ;
    float thick = max(uBrushR * 0.02, uView.z * 0.0016);
    float ring = 1.0 - smoothstep(thick, thick * 2.2, abs(dist - uBrushR));
    col = mix(col, vec3(1.0), ring * 0.85);
    float inner = 1.0 - smoothstep(uBrushR * 0.94, uBrushR, dist);
    col = mix(col, col * 1.06 + 0.04, inner * 0.18);
    if (px < 0.0) col *= 1.0;   // keep px referenced; the compiler is picky
  }

  fragColor = vec4(col, 1.0);
}`;

export interface SculptGLOptions {
  width: number;
  height: number;
  /** Biome id → rgb 0–1, 32 entries. */
  palette: [number, number, number][];
}

export interface ViewRect { x: number; y: number; w: number; h: number }

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`sculpt shader: ${log}`);
  }
  return sh;
}

/**
 * A WebGL2 terrain view over a world's elevation and biome grids.
 *
 * Deliberately owns no world state: the caller keeps the authoritative typed
 * arrays and tells this object which rectangle changed. That is what lets the
 * same instance serve a live brush stroke and a committed edit without either
 * knowing about the other.
 */
export class SculptGL {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texH: WebGLTexture;
  private texB: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  readonly gridW: number;
  readonly gridH: number;

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, opts: SculptGLOptions) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    this.gridW = opts.width;
    this.gridH = opts.height;

    // R32F sampling needs no extension in WebGL2; linear filtering of it does,
    // and we do not want linear anyway — the cells ARE the data.
    gl.getExtension('EXT_color_buffer_float');

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`sculpt link: ${gl.getProgramInfoLog(prog)}`);
    }
    this.prog = prog;
    gl.useProgram(prog);

    for (const name of ['uView', 'uGrid', 'uHeight', 'uBiome', 'uBrush', 'uBrushR', 'uBrushOn', 'uContour', 'uShade']) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    const pal = new Float32Array(32 * 3);
    opts.palette.slice(0, 32).forEach((c, i) => { pal[i * 3] = c[0]; pal[i * 3 + 1] = c[1]; pal[i * 3 + 2] = c[2]; });
    gl.uniform3fv(gl.getUniformLocation(prog, 'uPalette'), pal);
    gl.uniform1i(this.u.uHeight!, 0);
    gl.uniform1i(this.u.uBiome!, 1);
    gl.uniform2f(this.u.uGrid!, opts.width, opts.height);
    gl.uniform1f(this.u.uContour!, 0.25);
    gl.uniform1f(this.u.uShade!, 1);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.texH = this.makeTex(gl.R32F, gl.RED, gl.FLOAT, 0);
    this.texB = this.makeTex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1);
  }

  private makeTex(internal: number, format: number, type: number, unit: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, this.gridW, this.gridH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    void format; void type;
    return tex;
  }

  /** Full upload. Only on load and after a regeneration. */
  uploadAll(elevation: Float32Array, biome: Uint8Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texH);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RED, gl.FLOAT, elevation);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridW, this.gridH, gl.RED, gl.UNSIGNED_BYTE, biome);
  }

  /**
   * Upload one rectangle of the grid. This is the whole performance story: a
   * brush stroke touches a few thousand cells, so a stroke costs a few kilobytes
   * of PCIe traffic instead of a 2 MB texture and a 400 ms redraw.
   *
   * `x0` may be negative or past the right edge; the rect is split at the seam.
   */
  uploadRect(
    elevation: Float32Array,
    biome: Uint8Array | null,
    x0: number,
    y0: number,
    w: number,
    h: number,
  ): void {
    const gl = this.gl;
    const W = this.gridW, H = this.gridH;
    const yy = Math.max(0, y0);
    const hh = Math.min(H, y0 + h) - yy;
    if (hh <= 0 || w <= 0) return;

    // Split into runs that do not cross the seam, then send each as a tight
    // block copied out of the full-width source rows.
    let start = ((x0 % W) + W) % W;
    let left = Math.min(w, W);
    while (left > 0) {
      const run = Math.min(left, W - start);
      const hBuf = new Float32Array(run * hh);
      const bBuf = biome ? new Uint8Array(run * hh) : null;
      for (let r = 0; r < hh; r++) {
        const src = (yy + r) * W + start;
        hBuf.set(elevation.subarray(src, src + run), r * run);
        if (bBuf) bBuf.set(biome!.subarray(src, src + run), r * run);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texH);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, start, yy, run, hh, gl.RED, gl.FLOAT, hBuf);
      if (bBuf) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texB);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, start, yy, run, hh, gl.RED, gl.UNSIGNED_BYTE, bBuf);
      }
      left -= run;
      start = 0;
    }
  }

  setBrush(x: number, y: number, radius: number, on: boolean): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uBrush!, x, y);
    gl.uniform1f(this.u.uBrushR!, radius);
    gl.uniform1f(this.u.uBrushOn!, on ? 1 : 0);
  }

  setStyle(contourKm: number, shade: number): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform1f(this.u.uContour!, contourKm);
    gl.uniform1f(this.u.uShade!, shade);
  }

  draw(view: ViewRect): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    // Deliberately NOT black. If the shader runs and samples nothing, the result
    // must look different from "no draw ever happened", or the two get diagnosed
    // as the same bug — which is what has already happened twice.
    gl.clearColor(0.35, 0.06, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texH);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.uniform4f(this.u.uView!, view.x, view.y, view.w, view.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texH);
    gl.deleteTexture(this.texB);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }
}
