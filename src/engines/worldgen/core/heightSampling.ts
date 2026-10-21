/** Monotone Hermite reconstruction preserves stored heights and linear ramps,
 * with continuous slopes and no invented peaks. Every surface consumer shares it. */
function slope(a: number, b: number): number { return a * b <= 0 ? 0 : 2 * a * b / (a + b); }
function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const delta = c - b, m0 = slope(b - a, delta), m1 = slope(delta, d - c), t2 = t * t, t3 = t2 * t;
  return b * (2 * t3 - 3 * t2 + 1) + m0 * (t3 - 2 * t2 + t) + c * (-2 * t3 + 3 * t2) + m1 * (t3 - t2);
}
function row(values: Float32Array, y: number, x0: number, x1: number, x2: number, x3: number, f: number): number {
  return cubic(values[y+x0], values[y+x1], values[y+x2], values[y+x3], f);
}
export function sampleWorldHeight(values: Float32Array, width: number, height: number, u: number, v: number): number {
  const tx = u * width - .5, ty = v * height - .5, ix = Math.floor(tx), iy = Math.floor(ty), fx = tx - ix;
  const x1 = ((ix % width) + width) % width, x0 = (x1 + width - 1) % width, x2 = (x1 + 1) % width, x3 = (x1 + 2) % width;
  const y0 = Math.min(height - 1, Math.max(0, iy - 1)) * width, y1 = Math.min(height - 1, Math.max(0, iy)) * width;
  const y2 = Math.min(height - 1, Math.max(0, iy + 1)) * width, y3 = Math.min(height - 1, Math.max(0, iy + 2)) * width;
  return cubic(row(values,y0,x0,x1,x2,x3,fx), row(values,y1,x0,x1,x2,x3,fx), row(values,y2,x0,x1,x2,x3,fx), row(values,y3,x0,x1,x2,x3,fx), ty-iy);
}

/** Same arithmetic and longitude wrap/latitude clamp as sampleWorldHeight.
 * Explicit fetches avoid optional float filtering and generic sampler arguments. */
export const WORLD_HEIGHT_GLSL = `
float heightSlope(float a, float b) { return a * b <= 0.0 ? 0.0 : 2.0 * a * b / (a + b); }
float heightCubic(vec4 h, float t) {
  float delta = h.z - h.y;
  float m0 = heightSlope(h.y - h.x, delta), m1 = heightSlope(delta, h.w - h.z);
  float t2 = t * t, t3 = t2 * t;
  return h.y * (2.0*t3 - 3.0*t2 + 1.0) + m0 * (t3 - 2.0*t2 + t)
       + h.z * (-2.0*t3 + 3.0*t2) + m1 * (t3 - t2);
}
float heightRow(ivec4 x, int y, float f) {
  return heightCubic(vec4(texelFetch(uHeight,ivec2(x.x,y),0).r, texelFetch(uHeight,ivec2(x.y,y),0).r,
                         texelFetch(uHeight,ivec2(x.z,y),0).r, texelFetch(uHeight,ivec2(x.w,y),0).r),f);
}
float sampleWorldHeightTexture(vec2 uv) {
  vec2 t = uv * uGrid - 0.5, f = fract(t);
  ivec2 i = ivec2(floor(t)); int gw = int(uGrid.x), gh = int(uGrid.y);
  int x = ((i.x % gw) + gw) % gw;
  ivec4 xs = ivec4((x+gw-1)%gw,x,(x+1)%gw,(x+2)%gw);
  vec4 rows = vec4(heightRow(xs,clamp(i.y-1,0,gh-1),f.x), heightRow(xs,clamp(i.y,0,gh-1),f.x),
                   heightRow(xs,clamp(i.y+1,0,gh-1),f.x), heightRow(xs,clamp(i.y+2,0,gh-1),f.x));
  return heightCubic(rows,f.y);
}
`;
