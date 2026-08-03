// ============================================
// Sculpt — the 3D surface
// ============================================
// A heightfield you can turn around and push on, on a plane or on the globe.
//
// The whole design turns on one decision: THE GEOMETRY NEVER CHANGES. The grid
// is built once and the height comes from a texture the vertex shader reads.
// A brush stroke rewrites a rectangle of that texture and nothing else — no
// vertex buffer to re-upload, no normals to recompute, no bounding volume to
// refresh. That is what makes the ground move under the pointer at sixty frames
// a second instead of a second and a half after you let go.
//
// It also makes plane and globe the same object. They differ by one line of the
// vertex shader — where the displacement points — so the surface, the brush, the
// lighting and the picking are shared, and the globe is not a second
// implementation that drifts out of step with the first.
//
// The second decision is the UV WINDOW. A fixed grid spread over a whole world
// gives you two world cells per quad, which is invisible at full zoom and a mess
// of facets the moment you lean in to shape a range — and leaning in is the whole
// activity. So the grid is not nailed to the world: it is stretched over whatever
// square of the world the camera can currently see. The same million triangles
// then buy a hundred times the detail when you are close, and the fallback when
// the footprint cannot be worked out (looking at the horizon, over a pole) is the
// whole world, which is exactly the old behaviour.

import * as THREE from 'three';

export type SculptShape = 'plane' | 'globe';

/** Scene units, matched to Terrain3D so the two views feel like one place. */
export const SIZE_X = 240;
export const R_GLOBE = SIZE_X / (2 * Math.PI);
const Y_PER_KM = 0.24;
export const GLOBE_RELIEF = 0.55;
export const MIN_UV_WINDOW = 0.0005;

export function elevKmToY(exaggeration: number, worldWidth: number): number {
  return Y_PER_KM * exaggeration * (SIZE_X / worldWidth);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function bilinearWrapped(
  values: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const tx = u * width - 0.5;
  const ty = v * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const ax = ((x0 % width) + width) % width;
  const bx = (((x0 + 1) % width) + width) % width;
  const ay = Math.min(height - 1, Math.max(0, y0));
  const by = Math.min(height - 1, Math.max(0, y0 + 1));
  const a = values[ay * width + ax] * (1 - fx) + values[ay * width + bx] * fx;
  const b = values[by * width + ax] * (1 - fx) + values[by * width + bx] * fx;
  return a * (1 - fy) + b * fy;
}

function bilinearClamped(
  values: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const tx = u * width - 0.5;
  const ty = v * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const ax = Math.min(width - 1, Math.max(0, x0));
  const bx = Math.min(width - 1, Math.max(0, x0 + 1));
  const ay = Math.min(height - 1, Math.max(0, y0));
  const by = Math.min(height - 1, Math.max(0, y0 + 1));
  const a = values[ay * width + ax] * (1 - fx) + values[ay * width + bx] * fx;
  const b = values[by * width + ax] * (1 - fx) + values[by * width + bx] * fx;
  return a * (1 - fy) + b * fy;
}

/** Keep a close camera outside the same displaced surface the shader draws. */
export function clampCameraToSurface(
  position: THREE.Vector3,
  shape: SculptShape,
  elevationKm: number,
  yMul: number,
  clearance: number,
): boolean {
  const safeClearance = Math.max(0.001, clearance);
  if (shape === 'plane') {
    const minimumY = Math.max(0, elevationKm * yMul) + safeClearance;
    if (position.y >= minimumY) return false;
    position.y = minimumY;
    return true;
  }
  const minimumRadius = R_GLOBE
    + Math.max(0, elevationKm * yMul * GLOBE_RELIEF)
    + safeClearance;
  const radius = position.length();
  if (radius >= minimumRadius) return false;
  if (radius < 1e-7) position.set(0, minimumRadius, 0);
  else position.multiplyScalar(minimumRadius / radius);
  return true;
}

const HEIGHT_FN = /* glsl */`
// Bilinear read of an R32F texture with NEAREST filtering.
//
// R32F is not linearly filterable without an extension, and asking for LINEAR
// anyway yields an incomplete texture that samples as zero — which shows up as
// a flat grey world and took an afternoon to find the first time. Doing the
// interpolation by hand costs four fetches and cannot fail.
float baseHeightAt(vec2 uv) {
  vec2 t = uv * uGrid - 0.5;
  vec2 f = fract(t);
  ivec2 i = ivec2(floor(t));
  int gw = int(uGrid.x);
  int gh = int(uGrid.y);
  int ax = ((i.x % gw) + gw) % gw;
  int bx = (((i.x + 1) % gw) + gw) % gw;
  int ay = clamp(i.y, 0, gh - 1);
  int by = clamp(i.y + 1, 0, gh - 1);
  float h00 = texelFetch(uHeight, ivec2(ax, ay), 0).r;
  float h10 = texelFetch(uHeight, ivec2(bx, ay), 0).r;
  float h01 = texelFetch(uHeight, ivec2(ax, by), 0).r;
  float h11 = texelFetch(uHeight, ivec2(bx, by), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float detailHeightAt(vec2 localUV) {
  vec2 t = localUV * uDetailGrid - 0.5;
  vec2 f = fract(t);
  ivec2 i = ivec2(floor(t));
  ivec2 hi = ivec2(uDetailGrid) - ivec2(1);
  ivec2 a = clamp(i, ivec2(0), hi);
  ivec2 b = clamp(i + ivec2(1), ivec2(0), hi);
  float h00 = texelFetch(uDetailHeight, ivec2(a.x, a.y), 0).r;
  float h10 = texelFetch(uDetailHeight, ivec2(b.x, a.y), 0).r;
  float h01 = texelFetch(uDetailHeight, ivec2(a.x, b.y), 0).r;
  float h11 = texelFetch(uDetailHeight, ivec2(b.x, b.y), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float heightAtDisp(vec2 uv, float disp) {
  float base = baseHeightAt(uv);
  if (uDetailOn < 0.5 || disp <= 0.001) return base;
  float wrappedX = uv.x - uDetailOrigin.x;
  wrappedX -= round(wrappedX);
  vec2 localUV = vec2(
    wrappedX / max(1e-7, uDetailSize.x),
    (uv.y - uDetailOrigin.y) / max(1e-7, uDetailSize.y)
  );
  if (localUV.x < 0.0 || localUV.x > 1.0 || localUV.y < 0.0 || localUV.y > 1.0) {
    return base;
  }
  // Blend across a small gutter so a newly arrived patch cannot make a seam.
  vec2 edgeCells = min(localUV * uDetailGrid, (1.0 - localUV) * uDetailGrid);
  float blend = smoothstep(0.0, 3.0, min(edgeCells.x, edgeCells.y));
  return mix(base, detailHeightAt(localUV), blend * disp);
}

float heightAt(vec2 uv) {
  return heightAtDisp(uv, 1.0);
}

/** Where a world uv sits in the scene, on whichever shape is showing. */
vec3 placeAt(vec2 uv, float e) {
  if (uShape < 0.5) {
    return vec3((uv.x - 0.5) * uSizeX, e * uYMul, (uv.y - 0.5) * uSizeZ);
  }
  float lon = (uv.x - 0.5) * 6.2831853;
  float lat = (0.5 - uv.y) * 3.14159265;
  float r = uRadius + e * uYMul * uGlobeRelief;
  float cl = cos(lat);
  return vec3(r * cl * cos(lon), r * sin(lat), r * cl * sin(lon));
}
`;

const VERT = /* glsl */`
precision highp float;
precision highp sampler2D;

uniform sampler2D uHeight;
uniform sampler2D uDetailHeight;
uniform vec2  uGrid;         // world grid size in cells
uniform vec2  uDetailGrid;
uniform vec2  uDetailOrigin;
uniform vec2  uDetailSize;
uniform float uDetailOn;
uniform float uDetailDisp;
uniform float uYMul;         // km → scene units
uniform float uShape;        // 0 = plane, 1 = globe
uniform float uRadius;
uniform float uSizeX;
uniform float uSizeZ;
uniform float uGlobeRelief;
uniform vec2  uUVMin;        // the window of the world this grid covers
uniform vec2  uUVSize;

out vec2 vUV;
out float vElev;
out vec3 vWorld;

${HEIGHT_FN}

void main() {
  vec2 w = uUVMin + uv * uUVSize;
  vUV = w;
  // Displacement is BAND-LIMITED to what this mesh can carry (uDetailDisp is
  // computed CPU-side from canon cells per vertex). Point-sampling a ~150 m
  // field with vertices 30 cells apart aliased into a spike field; the
  // fragment's canon-resolution normals draw the ridges the mesh cannot.
  float e = heightAtDisp(w, uDetailDisp);
  vElev = e;
  vec3 p = placeAt(w, e);
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler2D;

uniform sampler2D uHeight;
uniform sampler2D uDetailHeight;
uniform sampler2D uBiome;
uniform sampler2D uAlbedo;   // the finished map raster, when a skin is showing
uniform vec3  uPalette[48];
uniform vec2  uGrid;
uniform vec2  uDetailGrid;
uniform vec2  uDetailOrigin;
uniform vec2  uDetailSize;
uniform float uDetailOn;
/** The canonical patch's own colours, for the close range. The world raster
 *  magnified a hundredfold is a blur; this is drawn from the patch's cover. */
uniform sampler2D uDetailAlbedo;
uniform float uDetailAlbedoOn;
uniform float uYMul;
uniform float uShape;
uniform float uRadius;
uniform float uSizeX;
uniform float uSizeZ;
uniform float uGlobeRelief;
uniform vec2  uUVMin;
uniform vec2  uUVSize;
uniform vec3  uSun;
uniform vec2  uBrush;        // in cells
uniform float uBrushR;       // in cells
uniform float uBrushOn;
uniform float uBrushInner;   // 0–1 of the radius, the hard core
uniform int   uTip;          // 0 round · 1 square · 2 ragged · 3 ridge
uniform float uTipAngle;     // radians
uniform float uTipJitter;
uniform float uTipAspect;
uniform float uContour;      // km between contour lines, 0 = none
uniform float uSea;
uniform float uClay;         // 0 = the world's colours, 1 = clay
uniform float uAlbedoOn;     // 1 = take the colour from uAlbedo
uniform float uFlatLight;    // 1 = the skin already carries its own shading
uniform float uDetail;       // 0–1 how much invented close-range relief
uniform float uCavity;       // strength of the crease darkening
uniform vec3  uCam;          // camera position, for the headlight
uniform float uHeadlight;    // 0 = fixed sun, 1 = light from the camera
uniform vec2  uMirror;       // 1 where that axis is mirrored, for the guide line
uniform float uShadow;       // 0–1 strength of the cast shadow

in vec2 vUV;
in float vElev;
in vec3 vWorld;
out vec4 outColor;

${HEIGHT_FN}

// ---------------------------------------------------------------------------
// Close-range detail
// ---------------------------------------------------------------------------
// A world cell is about forty kilometres. Lean in and there is nothing left to
// show — not because the renderer is coarse but because the DATA ends, and a
// magnified texel is the honest picture of that. So the last two orders of
// magnitude are invented.
//
// Three properties make invented detail acceptable rather than a lie:
//   · it is a pure function of position, so it does not swim when the camera
//     moves, and the same crag is in the same place every time you come back;
//   · it is sampled in SCENE space, not in uv, so it does not tear at the
//     antimeridian and does not stretch into slivers at the poles;
//   · it fades in with the uv window, so at map scale it contributes nothing
//     and cannot contradict the shape the generator actually computed.
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise3(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

/**
 * Cast shadow, marched across the height field.
 *
 * Two dozen fetches along the light direction, asking at each step whether the
 * terrain is above the ray. It is the single thing that makes relief read as
 * relief rather than as a shaded drawing of relief — a range with no shadow
 * behind it could be a valley, and your eye keeps asking. Plane only: on the
 * globe the ray leaves the parameterisation and the honest thing is to skip it.
 */
float sunShadow(vec2 uv, float e) {
  if (uShadow <= 0.001 || uShape > 0.5 || uHeadlight > 0.5) return 1.0;
  vec3 L = normalize(uSun);
  if (L.y < 0.05) return 1.0;
  // Step in world uv, matched to the scene scale so the ray rises correctly.
  vec2 dir = vec2(L.x / uSizeX, L.z / uSizeZ);
  float dl = length(vec2(L.x, L.z));
  if (dl < 1e-4) return 1.0;
  float reach = 0.055;                       // how far a peak may shade, in uv
  float shade = 0.0;
  for (int k = 1; k <= 14; k++) {
    float t = float(k) / 14.0;
    float march = t * t * reach;              // dense near the point, sparse far
    vec2 s = uv + dir * (march / max(1e-5, dl));
    float rayY = e * uYMul + (march * uSizeX * L.y / max(1e-5, dl));
    // One nearest fetch, not the bilinear read.
    //
    // The shadow ray asks "is anything in the way", and a shadow edge half a cell
    // off is invisible; four fetches per step to place it exactly would make this
    // function alone cost more than the rest of the shader put together. Fourteen
    // steps at one fetch each instead of twenty at four is five times cheaper for
    // a difference nobody can see.
    float terrY = texelFetch(uHeight, ivec2(
      ((int(floor(s.x * uGrid.x)) % int(uGrid.x)) + int(uGrid.x)) % int(uGrid.x),
      clamp(int(floor(s.y * uGrid.y)), 0, int(uGrid.y) - 1)), 0).r * uYMul;
    shade = max(shade, clamp((terrY - rayY) * 3.0 / max(0.02, march * uSizeX), 0.0, 1.0));
  }
  return 1.0 - shade * uShadow;
}

// The value noise the ragged head is cut with. Bit for bit the CPU's lattice()
// in sculpt/ops.ts — which is only possible because that one now uses a real
// 32-bit multiply. Sampled at the CELL, like the CPU, so the wobble sits still
// while the pointer moves over it.
float tipLattice(ivec2 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}

float tipNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tipLattice(i);
  float b = tipLattice(i + ivec2(1, 0));
  float c = tipLattice(i + ivec2(0, 1));
  float dd = tipLattice(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, dd, f.x), f.y);
}

/** Distance in the head's own metric: === r is the rim. */
float tipDist(vec2 d, vec2 cell, float r) {
  float ca = cos(uTipAngle), sa = sin(uTipAngle);
  if (uTip == 1) {
    vec2 q = vec2(d.x * ca + d.y * sa, -d.x * sa + d.y * ca);
    return max(abs(q.x), abs(q.y));
  }
  if (uTip == 3) {
    vec2 q = vec2((d.x * ca + d.y * sa) / max(1.0, uTipAspect), -d.x * sa + d.y * ca);
    return length(q);
  }
  if (uTip == 2) {
    float freq = 1.0 / max(2.5, r * 0.9);
    vec2 g = floor(cell + 0.5);
    return length(d) + (tipNoise(g * freq) - 0.5) * r * uTipJitter * 0.9;
  }
  return length(d);
}

void main() {
  float e = vElev;
  bool underwater = e <= uSea;
  vec2 texel = 1.0 / uGrid;

  // THE LIGHTING RESOLUTION FOLLOWS THE DATA. These central differences used
  // to step ±1 WORLD cell always — ±20 km — even inside the canonical detail
  // patch, so every ridge the patch carried was displaced into the silhouette
  // and then lit as if it were not there. That gap is exactly what the old
  // screen-space noise was papered over. Inside the patch (past its blend
  // gutter, and only at ranges where a ~150 m step is resolvable) the taps
  // narrow to the patch's own cell.
  float inD = 0.0;
  vec2 dlp = vec2(0.0);
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  if (uDetailOn > 0.5) {
    float wx0 = vUV.x - uDetailOrigin.x;
    wx0 -= round(wx0);
    dlp = vec2(wx0 / max(1e-7, uDetailSize.x),
               (vUV.y - uDetailOrigin.y) / max(1e-7, uDetailSize.y));
    if (dlp.x > 0.0 && dlp.x < 1.0 && dlp.y > 0.0 && dlp.y < 1.0) {
      vec2 ec = min(dlp * uDetailGrid, (1.0 - dlp) * uDetailGrid);
      // Gated PER PIXEL, not per frame: an oblique close view spans half a
      // continent in its frustum, but the ground under this pixel is what
      // decides whether a 150 m lighting step is resolvable here.
      float pxUnits = max(1e-7, (length(dpx) + length(dpy)) * 0.5);
      float canonUnits = (uDetailSize.x / uDetailGrid.x) * uSizeX;
      float resolvable = 1.0 - smoothstep(2.0 * canonUnits, 8.0 * canonUnits, pxUnits);
      inD = smoothstep(3.0, 6.0, min(ec.x, ec.y)) * resolvable;
    }
    texel = mix(texel, uDetailSize / uDetailGrid, inD);
  }

  // ---- form first ---------------------------------------------------------
  // The normal comes from the HEIGHT FIELD, not from a vertex attribute.
  //
  // Vertex normals would have to be recomputed and re-uploaded on every brush
  // move — the single most expensive thing a sculpt view can do — and they would
  // be wrong between vertices anyway. Central differences on the texture give a
  // normal at full grid resolution no matter how coarse the mesh is, which is
  // why a 1024-wide mesh can carry a 4096-wide world without looking it.
  float hxp = heightAt(vUV + vec2(texel.x, 0.0));
  float hxm = heightAt(vUV - vec2(texel.x, 0.0));
  float hyp = heightAt(vUV + vec2(0.0, texel.y));
  float hym = heightAt(vUV - vec2(0.0, texel.y));
  float hx = hxp - hxm;
  float hy = hyp - hym;
  vec3 n;
  if (uShape < 0.5) {
    n = normalize(vec3(-hx * uYMul / (uSizeX * texel.x * 2.0), 1.0,
                       -hy * uYMul / (uSizeZ * texel.y * 2.0)));
  } else {
    vec3 up = normalize(vWorld);
    float lat = (0.5 - vUV.y) * 3.14159265;
    float cl = max(0.08, cos(lat));
    float lon = (vUV.x - 0.5) * 6.2831853;
    vec3 east = normalize(vec3(-sin(lon), 0.0, cos(lon)));
    vec3 north = normalize(cross(east, up));
    float du = hx * uYMul * uGlobeRelief / (uSizeX * texel.x * 2.0 * cl);
    float dv = hy * uYMul * uGlobeRelief / (uSizeZ * texel.y * 2.0);
    n = normalize(up - east * du + north * dv);
  }

  // Cavity: the discrete Laplacian of the height field. Positive in a hollow,
  // negative on a ridge. It is the single cheapest thing that makes a sculpt
  // read as a solid object rather than as a shaded picture of one — every
  // sculpting program has it and it is why their clay looks like clay.
  float lap = (hxp + hxm + hyp + hym) * 0.25 - heightAt(vUV);
  float cav = clamp(lap * uYMul / max(1e-5, uSizeX * texel.x) * 6.0, -1.0, 1.0);

  // ---- invented relief, only once you are close ---------------------------
  //
  // The bump is applied to the NORMAL, not to the position: displacing vertices
  // would need a mesh fine enough to carry it, which is the thing we do not
  // have. The gradient comes from screen-space derivatives of one noise sample
  // (Mikkelsen's formula for bump mapping a surface with no uv parameterisation
  // to differentiate) — a single fbm evaluation per pixel instead of the six a
  // finite-difference gradient would cost, and correct on the globe as well as
  // on the plane because it never mentions uv at all.
  float micro = 0.0;
  float microGate = 1.0;
  // The fade range is measured, not guessed. At a uv window of 0.34 the grid is
  // already down to about one world cell per triangle — a close view by any
  // reasonable definition — and the first version faded the detail fully OUT by
  // then, so the thing existed and was never once visible. It ramps in from half
  // the world in view and is at full strength by a tenth of it.
  // In from a regional window (~2400 km), full below ~320 km — the old ramp
  // held it at full strength across half the planet, which read as film grain.
  float dAmt = uDetail * (1.0 - smoothstep(0.008, 0.06, uUVSize.x));
  if (dAmt > 0.004) {
    // THE FREQUENCY FOLLOWS THE PIXEL, not the world.
    //
    // A fixed frequency was the first version and it was worth nothing: at a
    // close camera one period of it was a fifth of a pixel, so every fetch was
    // uncorrelated with its neighbour, the screen-space gradient averaged to
    // noise, and the visible result was exactly nothing. Detail you cannot
    // resolve is not detail. So the feature size is pinned to about three
    // pixels — quantised to whole octaves, because a frequency that slides
    // continuously with the camera makes the ground crawl when you zoom, while
    // doubling it keeps every octave landing on the same positions it had
    // before.
    float px = max(1e-7, (length(dpx) + length(dpy)) * 0.5);
    float f = exp2(floor(log2(1.0 / (px * 3.0))));
    // And a floor on the invented feature size: about a hundredth of a world
    // cell, a few hundred metres. Below that this stops being terrain and
    // becomes film grain over it.
    float cellUnits = uSizeX / uGrid.x;
    f = min(f, 1.0 / max(1e-5, cellUnits * 0.010));
    float m = fbm3(vWorld * f);
    micro = m - 0.5;
    // The slope the bump adds is amplitude × frequency, so the amplitude has to
    // fall as the frequency rises or the ground turns to gravel the moment you
    // lean in. Water gets a fraction of it: a swell, not a scree slope.
    float amp = (underwater ? 0.16 : 1.0) * dAmt * 0.34 / max(1e-4, f);
    // THE GROUND DECIDES. Un-gated noise was the whole complaint: a salt flat,
    // a floodplain and a cordillera all got the same crinkle. The amplitude now
    // follows the same law the regional amplifier uses — local slope plus a
    // share of height above the sea — so plains stay plains. And where the
    // canonical patch is bound, invention is allowed only BELOW the data's own
    // resolution: wavelengths the patch already carries are its to draw.
    float slopeS = uYMul * length(vec2(hx / (uSizeX * texel.x * 2.0),
                                       hy / (uSizeZ * texel.y * 2.0)));
    float relief = clamp(slopeS * 1.2 + max(0.0, e) * 0.35, 0.0, 1.6) / 1.6;
    microGate = 0.12 + 0.88 * relief;
    if (inD > 0.5) {
      float canonUnits = (uDetailSize.x / uDetailGrid.x) * uSizeX;
      microGate *= 1.0 - smoothstep(0.5 * canonUnits, 1.5 * canonUnits, 1.0 / f);
    }
    amp *= microGate;
    vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    if (abs(det) > 1e-9) {
      vec3 grad = (dFdx(m) * r1 + dFdy(m) * r2) / det;
      n = normalize(n - grad * amp);
    }
  }

  // ---- colour -------------------------------------------------------------
  vec3 col;
  if (uAlbedoOn > 0.5) {
    // A finished map — the satellite raster or the drawn carta — laid over the
    // relief. Its own coastlines, rivers and ice are already in it, so none of
    // the elevation-driven colouring below applies.
    col = texture(uAlbedo, vec2(fract(vUV.x), clamp(vUV.y, 0.0005, 0.9995))).rgb;
  } else if (uClay > 0.5) {
    // Clay: one material, no map. When you are shaping a coastline the biome
    // colours are noise — they tell you what grows there, and you are not asking
    // about that. Water still reads, because a coastline you cannot see is not
    // a coastline you can sculpt.
    col = underwater ? vec3(0.34, 0.42, 0.52) : vec3(0.78, 0.74, 0.70);
  } else if (underwater) {
    float d = clamp((uSea - e) / 4.0, 0.0, 1.0);
    col = mix(vec3(0.53, 0.68, 0.78), vec3(0.16, 0.26, 0.42), pow(d, 0.45));
    col = mix(col, vec3(0.72, 0.83, 0.87), smoothstep(0.06, 0.0, uSea - e) * 0.6);
  } else {
    int b = int(texture(uBiome, vec2(fract(vUV.x), clamp(vUV.y, 0.0005, 0.9995))).r * 255.0 + 0.5);
    col = uPalette[clamp(b, 0, 47)];
  }
  // Close range: the canonical patch's own colours take over from whichever
  // skin is showing (except clay — clay is deliberately colourless).
  if (uDetailAlbedoOn > 0.5 && inD > 0.0 && uClay < 0.5) {
    col = mix(col, texture(uDetailAlbedo, dlp).rgb, inD);
  }

  // ---- light --------------------------------------------------------------
  vec3 L = mix(normalize(uSun), normalize(uCam - vWorld), uHeadlight);
  float lam = clamp(dot(n, L), 0.0, 1.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 V = normalize(uCam - vWorld);
  // A broad specular sheen, which is what tells you a surface is curving away.
  float spec = pow(clamp(dot(reflect(-L, n), V), 0.0, 1.0), 22.0) * (uClay > 0.5 ? 0.28 : 0.12);
  // Fresnel rim: separates the silhouette from the background at a glance.
  float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0) * 0.22;
  float sh = underwater ? 1.0 : sunShadow(vUV, e);

  // The colour break-up that goes with the invented relief. Without it a slope
  // reads as one flat wash lit two ways, which is a plastic model of a hill.
  col *= 1.0 + micro * 0.55 * dAmt * microGate;

  // A drawn map is a picture with its own light already in it, and a satellite
  // raster is close to albedo. So the skins take a flatter, mostly ambient lamp
  // and let the bump and the cavity do the shaping; the clay takes the full sun.
  float lightMix = 1.0 - uFlatLight * 0.55;
  col *= (0.30 + 0.70 * uFlatLight * 0.55) + (0.92 * lam * sh + 0.18 * sky) * lightMix;
  col *= 1.0 - max(0.0, cav) * uCavity;              // hollows darken
  col += vec3(1.0) * max(0.0, -cav) * uCavity * 0.35; // ridges catch the light
  col += spec * sh + rim * vec3(0.55, 0.65, 0.8);

  if (!underwater && uContour > 0.0) {
    float f = e / uContour;
    float w = fwidth(f);
    float line = 1.0 - smoothstep(0.0, w * 1.3, abs(fract(f) - 0.5) - 0.5 + w * 1.3);
    col = mix(col, col * 0.72, clamp(line, 0.0, 1.0) * 0.45);
  }

  // ---- the brush, measured in cells ---------------------------------------
  //
  // Two rings, not one: the outer is where the brush stops, the inner is where it
  // stops being at full strength. Softness is otherwise a number you set and then
  // discover the effect of, which is how you end up re-doing a coastline.
  //
  // And the ring is the shape of the HEAD, not a circle. tipDist() below is the
  // same metric stampDisc() culls with in sculpt/ops.ts — including the noise
  // on the ragged rim, cell for cell — so the outline you aim with and the paint
  // you get are the same figure, not two drawings of the same intention.
  if (uBrushOn > 0.5) {
    vec2 cell = vUV * uGrid;
    vec2 d = cell - uBrush;
    d.x -= uGrid.x * floor(d.x / uGrid.x + 0.5);      // the seam
    float dist = tipDist(d, cell, uBrushR);
    float thick = max(uBrushR * 0.035, 0.5);
    float ring = 1.0 - smoothstep(thick, thick * 2.4, abs(dist - uBrushR));
    col = mix(col, vec3(1.0), ring * 0.9);
    float ri = uBrushR * uBrushInner;
    if (ri > 1.0 && uBrushInner < 0.98) {
      float inner = 1.0 - smoothstep(thick * 0.7, thick * 1.9, abs(dist - ri));
      col = mix(col, vec3(1.0, 0.86, 0.55), inner * 0.5);
    }
    col = mix(col, col * 1.10 + 0.05,
              (1.0 - smoothstep(uBrushR * 0.88, uBrushR, dist)) * 0.20);
  }

  // Mirror guides, so symmetry is a thing you can see rather than infer.
  if (uMirror.x > 0.5) {
    float dx = abs(fract(vUV.x + 0.5) - 0.5);
    col = mix(col, vec3(0.95, 0.55, 0.35), (1.0 - smoothstep(0.0006, 0.0018, dx)) * 0.7);
  }
  if (uMirror.y > 0.5) {
    float dy = abs(vUV.y - 0.5);
    col = mix(col, vec3(0.95, 0.55, 0.35), (1.0 - smoothstep(0.0012, 0.0036, dy)) * 0.7);
  }

  outColor = vec4(col, 1.0);
}
`;

export interface SurfaceOptions {
  worldWidth: number;
  worldHeight: number;
  /** Mesh resolution in vertices across. */
  mesh: number;
  palette: [number, number, number][];
}

/** The square of the world the grid is currently stretched over. */
export interface UVWindow { u: number; v: number; size: number }

export const FULL_WINDOW: UVWindow = { u: 0.5, v: 0.5, size: 1 };

/** A deterministic high-resolution height patch covering part of the world. */
export interface TerrainDetailPatch {
  elevation: Float32Array;
  width: number;
  height: number;
  /** Normalized top-left world coordinate. `u` may cross the wrap seam. */
  u: number;
  v: number;
  uSize: number;
  vSize: number;
}

/**
 * The sculptable surface: one mesh, one material, two textures.
 *
 * `uploadAll` replaces everything; `patch` replaces a rectangle. Both are the
 * same call the 2D view makes, so a stroke costs the same here as there and the
 * two views are interchangeable from the brush's point of view.
 */
export class SculptSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private heightTex: THREE.DataTexture;
  private biomeTex: THREE.DataTexture;
  private detailHeightTex: THREE.DataTexture;
  private detailPatch: TerrainDetailPatch | null = null;
  private detailAlbedoTex: THREE.CanvasTexture | null = null;
  /** How much of the detail patch the MESH may carry (0–1); see updateDetailDisp. */
  private detailDisp = 1;
  /** A 1×1 stand-in so the albedo sampler is always bound to something. */
  private blankTex: THREE.DataTexture;
  private albedoTex: THREE.Texture | null = null;
  private W: number;
  private H: number;
  private heights: Float32Array;
  private meshResolution: number;
  private window: UVWindow = { ...FULL_WINDOW };

  constructor(opts: SurfaceOptions) {
    this.W = opts.worldWidth;
    this.H = opts.worldHeight;
    this.meshResolution = Math.max(16, Math.round(opts.mesh));
    this.heights = new Float32Array(this.W * this.H);

    this.blankTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this.blankTex.needsUpdate = true;

    this.heightTex = new THREE.DataTexture(
      this.heights, this.W, this.H, THREE.RedFormat, THREE.FloatType,
    );
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.wrapS = THREE.RepeatWrapping;
    this.heightTex.needsUpdate = true;

    this.biomeTex = new THREE.DataTexture(
      new Uint8Array(this.W * this.H), this.W, this.H, THREE.RedFormat, THREE.UnsignedByteType,
    );
    this.biomeTex.magFilter = THREE.NearestFilter;
    this.biomeTex.minFilter = THREE.NearestFilter;
    this.biomeTex.wrapS = THREE.RepeatWrapping;
    this.biomeTex.needsUpdate = true;

    this.detailHeightTex = new THREE.DataTexture(
      new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType,
    );
    this.detailHeightTex.magFilter = THREE.NearestFilter;
    this.detailHeightTex.minFilter = THREE.NearestFilter;
    this.detailHeightTex.needsUpdate = true;

    const pal: THREE.Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const c = opts.palette[i] ?? [0.5, 0.5, 0.5];
      pal.push(new THREE.Vector3(c[0], c[1], c[2]));
    }

    const sizeZ = SIZE_X * (this.H / this.W);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHeight: { value: this.heightTex },
        uDetailHeight: { value: this.detailHeightTex },
        uBiome: { value: this.biomeTex },
        uAlbedo: { value: this.blankTex },
        uPalette: { value: pal },
        uGrid: { value: new THREE.Vector2(this.W, this.H) },
        uDetailGrid: { value: new THREE.Vector2(1, 1) },
        uDetailOrigin: { value: new THREE.Vector2(0, 0) },
        uDetailSize: { value: new THREE.Vector2(1, 1) },
        uDetailOn: { value: 0 },
        uDetailDisp: { value: 1 },
        uDetailAlbedo: { value: this.blankTex },
        uDetailAlbedoOn: { value: 0 },
        uYMul: { value: elevKmToY(30, this.W) },
        uShape: { value: 0 },
        uRadius: { value: R_GLOBE },
        uSizeX: { value: SIZE_X },
        uSizeZ: { value: sizeZ },
        uGlobeRelief: { value: GLOBE_RELIEF },
        uUVMin: { value: new THREE.Vector2(0, 0) },
        uUVSize: { value: new THREE.Vector2(1, 1) },
        uSun: { value: new THREE.Vector3(-0.55, 0.72, 0.42) },
        uBrush: { value: new THREE.Vector2(0, 0) },
        uBrushR: { value: 8 },
        uBrushOn: { value: 0 },
        uBrushInner: { value: 0.45 },
        uTip: { value: 0 },
        uTipAngle: { value: 0 },
        uTipJitter: { value: 0.5 },
        uTipAspect: { value: 2.6 },
        uContour: { value: 0.25 },
        uSea: { value: 0 },
        uClay: { value: 0 },
        uAlbedoOn: { value: 0 },
        uFlatLight: { value: 0 },
        uDetail: { value: 0.6 },
        uCavity: { value: 0.55 },
        uCam: { value: new THREE.Vector3(0, 100, 100) },
        uHeadlight: { value: 0 },
        uMirror: { value: new THREE.Vector2(0, 0) },
        uShadow: { value: 0.65 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(buildGrid(this.meshResolution), this.material);
    this.mesh.frustumCulled = false;
  }

  setShape(shape: SculptShape): void {
    this.material.uniforms.uShape.value = shape === 'globe' ? 1 : 0;
  }

  setExaggeration(exag: number): void {
    this.material.uniforms.uYMul.value = elevKmToY(exag, this.W);
  }

  /**
   * Where the brush is and how big, in WORLD CELLS.
   *
   * Cells, not uv: the ring has to be a circle on the ground and stay one when
   * the grid is stretched over a window, and a radius in uv is neither.
   */
  setBrush(
    cellX: number, cellY: number, radiusCells: number, softness: number, on: boolean,
    tip?: { kind: string; angle: number; jitter: number; aspect: number },
  ): void {
    (this.material.uniforms.uBrush.value as THREE.Vector2).set(cellX, cellY);
    this.material.uniforms.uBrushR.value = Math.max(0.6, radiusCells);
    this.material.uniforms.uBrushInner.value = Math.min(1, Math.max(0, 1 - softness));
    this.material.uniforms.uBrushOn.value = on ? 1 : 0;
    const KIND: Record<string, number> = { round: 0, square: 1, ragged: 2, ridge: 3 };
    this.material.uniforms.uTip.value = tip ? (KIND[tip.kind] ?? 0) : 0;
    this.material.uniforms.uTipAngle.value = tip?.angle ?? 0;
    this.material.uniforms.uTipJitter.value = tip?.jitter ?? 0.5;
    this.material.uniforms.uTipAspect.value = tip?.aspect ?? 2.6;
  }

  /** Clay or the world's own colours, and how hard the creases read. */
  setShading(clay: boolean, cavity: number, headlight: boolean, shadow: number): void {
    this.material.uniforms.uClay.value = clay ? 1 : 0;
    this.material.uniforms.uCavity.value = cavity;
    this.material.uniforms.uHeadlight.value = headlight ? 1 : 0;
    this.material.uniforms.uShadow.value = shadow;
  }

  /**
   * Drape a finished map over the relief, or take it off.
   *
   * `flatLight` says the picture already contains its own light — true of the
   * drawn carta, whose every mountain symbol is shaded from the upper left, and
   * true enough of the satellite raster, which is rendered unshaded but is a
   * material colour rather than a clay. Lighting either one at full strength
   * shades it twice and the result looks like a photograph of a relief model.
   *
   * The texture is owned by the caller: this class binds and unbinds it, and
   * never disposes it, because the same raster is shared with the 2D views.
   */
  setAlbedo(tex: THREE.Texture | null, flatLight = true): void {
    this.albedoTex = tex;
    this.material.uniforms.uAlbedo.value = tex ?? this.blankTex;
    this.material.uniforms.uAlbedoOn.value = tex ? 1 : 0;
    this.material.uniforms.uFlatLight.value = tex && flatLight ? 1 : 0;
    this.material.needsUpdate = true;
  }

  get hasAlbedo(): boolean { return !!this.albedoTex; }

  /** How much invented relief the close-up gets. 0 turns it off entirely. */
  setDetail(amount: number): void {
    this.material.uniforms.uDetail.value = Math.min(1, Math.max(0, amount));
  }

  setContour(km: number): void {
    this.material.uniforms.uContour.value = km;
  }

  /** Azimuth and elevation in degrees. */
  setSun(azimuthDeg: number, elevationDeg: number): void {
    const a = (azimuthDeg * Math.PI) / 180, e = (elevationDeg * Math.PI) / 180;
    (this.material.uniforms.uSun.value as THREE.Vector3)
      .set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
  }

  setCamera(p: THREE.Vector3): void {
    (this.material.uniforms.uCam.value as THREE.Vector3).copy(p);
  }

  setMirror(x: boolean, y: boolean): void {
    (this.material.uniforms.uMirror.value as THREE.Vector2).set(x ? 1 : 0, y ? 1 : 0);
  }

  /** Stretch the grid over this square of the world. */
  setWindow(w: UVWindow): void {
    const size = Math.min(1, Math.max(MIN_UV_WINDOW, w.size));
    // v is clamped so the grid never runs off the poles; u wraps and does not care.
    const v = size >= 1 ? 0.5 : Math.min(1 - size / 2, Math.max(size / 2, w.v));
    this.window = { u: w.u, v, size };
    (this.material.uniforms.uUVMin.value as THREE.Vector2).set(w.u - size / 2, v - size / 2);
    (this.material.uniforms.uUVSize.value as THREE.Vector2).set(size, size);
    this.updateDetailDisp();
  }

  /** Swap the grid for a denser or coarser one. Textures are untouched. */
  setMesh(n: number): void {
    const next = Math.max(16, Math.round(n));
    if (next === this.meshResolution) return;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildGrid(next);
    this.meshResolution = next;
    old.dispose();
    this.updateDetailDisp();
  }

  get uvWindow(): UVWindow { return this.window; }
  get yMul(): number { return this.material.uniforms.uYMul.value as number; }
  get shapeIsGlobe(): boolean { return (this.material.uniforms.uShape.value as number) > 0.5; }
  /** World cells per mesh quad — the number that says how faceted this looks. */
  cellsPerQuad(meshAcross: number): number {
    return (this.window.size * this.W) / meshAcross;
  }

  uploadAll(elevation: Float32Array, biome: Uint8Array): void {
    this.heights.set(elevation);
    this.heightTex.needsUpdate = true;
    (this.biomeTex.image.data as Uint8Array).set(biome);
    this.biomeTex.needsUpdate = true;
  }

  /**
   * Supply the same close-range elevation field used by the regional map.
   *
   * Replacing the patch is a texture upload; geometry remains pooled and the
   * shader blends across the patch gutter to avoid visible tile seams.
   */
  /**
   * The close-range skin: a canvas of the canonical patch's cover and water,
   * draped only inside the patch (and only when it is bound). Null restores
   * the plain skins.
   */
  setDetailAlbedo(source: HTMLCanvasElement | null): void {
    this.detailAlbedoTex?.dispose();
    this.detailAlbedoTex = null;
    if (!source) {
      this.material.uniforms.uDetailAlbedo.value = this.blankTex;
      this.material.uniforms.uDetailAlbedoOn.value = 0;
      return;
    }
    const tex = new THREE.CanvasTexture(source);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.detailAlbedoTex = tex;
    this.material.uniforms.uDetailAlbedo.value = tex;
    this.material.uniforms.uDetailAlbedoOn.value = 1;
  }

  /**
   * Band-limit the patch DISPLACEMENT to the mesh's sampling rate.
   *
   * A 384-vertex window across thousands of canon cells point-samples the
   * ~150 m field once every dozens of cells, and pointwise sampling of a field
   * with real relief at that scale is a spike storm, not terrain. Fade the
   * geometric displacement out as cells-per-vertex grows; the fragment shader
   * keeps lighting the full-resolution field wherever a pixel can resolve it,
   * so the ridges stay VISIBLE — they just stop pretending to be geometry the
   * mesh cannot express.
   */
  private updateDetailDisp(): void {
    const p = this.detailPatch;
    let disp = 1;
    if (p) {
      const canonUv = p.uSize / Math.max(1, p.width);
      const perVertex = (this.window.size / Math.max(16, this.meshResolution)) / Math.max(1e-9, canonUv);
      const t = Math.min(1, Math.max(0, (perVertex - 2) / 4));
      disp = 1 - t * t * (3 - 2 * t);
    }
    this.detailDisp = disp;
    this.material.uniforms.uDetailDisp.value = disp;
  }

  setDetailPatch(patch: TerrainDetailPatch | null): void {
    this.detailHeightTex.dispose();
    this.detailPatch = patch;
    if (!patch) {
      this.detailHeightTex = new THREE.DataTexture(
        new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType,
      );
      this.detailHeightTex.needsUpdate = true;
      this.material.uniforms.uDetailHeight.value = this.detailHeightTex;
      this.material.uniforms.uDetailOn.value = 0;
      this.updateDetailDisp();
      return;
    }
    this.detailHeightTex = new THREE.DataTexture(
      patch.elevation,
      patch.width,
      patch.height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.detailHeightTex.magFilter = THREE.NearestFilter;
    this.detailHeightTex.minFilter = THREE.NearestFilter;
    this.detailHeightTex.needsUpdate = true;
    this.material.uniforms.uDetailHeight.value = this.detailHeightTex;
    (this.material.uniforms.uDetailGrid.value as THREE.Vector2).set(patch.width, patch.height);
    (this.material.uniforms.uDetailOrigin.value as THREE.Vector2).set(patch.u, patch.v);
    (this.material.uniforms.uDetailSize.value as THREE.Vector2).set(patch.uSize, patch.vSize);
    this.material.uniforms.uDetailOn.value = 1;
    this.updateDetailDisp();
  }

  /**
   * Replace a rectangle.
   *
   * three.js has no partial-upload path on DataTexture, so this copies the rows
   * into the backing array and marks the texture dirty. The full re-upload of a
   * 2048×1024 float texture is 8 MB, which is a millisecond of PCIe and not
   * worth the WebGL surgery it would take to avoid — the expensive thing was
   * never the upload, it was rebuilding geometry, and there is none to rebuild.
   */
  patch(elevation: Float32Array, biome: Uint8Array | null, x0: number, y0: number, w: number, h: number): void {
    const W = this.W;
    for (let y = y0; y < y0 + h; y++) {
      if (y < 0 || y >= this.H) continue;
      for (let x = x0; x < x0 + w; x++) {
        const xx = ((x % W) + W) % W;
        const i = y * W + xx;
        this.heights[i] = elevation[i];
        if (biome) (this.biomeTex.image.data as Uint8Array)[i] = biome[i];
      }
    }
    this.heightTex.needsUpdate = true;
    if (biome) this.biomeTex.needsUpdate = true;
  }

  /** Height in km at a world cell, from the copy the GPU is reading. */
  heightAtCell(x: number, y: number): number {
    return this.heightAtUV(x / this.W, y / this.H);
  }

  /**
   * Height in km at normalized world coordinates, matching `heightAt()` in the
   * vertex shader. Camera collision, labels and picking must see the same
   * regional relief as the GPU or a close camera can enter a peak that the CPU
   * believes does not exist.
   */
  heightAtUV(u: number, v: number): number {
    const base = bilinearWrapped(this.heights, this.W, this.H, u, v);
    const patch = this.detailPatch;
    if (!patch) return base;
    let wrappedX = u - patch.u;
    wrappedX -= Math.round(wrappedX);
    const localU = wrappedX / Math.max(1e-7, patch.uSize);
    const localV = (v - patch.v) / Math.max(1e-7, patch.vSize);
    if (localU < 0 || localU > 1 || localV < 0 || localV > 1) return base;
    const detail = bilinearClamped(
      patch.elevation,
      patch.width,
      patch.height,
      localU,
      localV,
    );
    const edgeX = Math.min(localU * patch.width, (1 - localU) * patch.width);
    const edgeY = Math.min(localV * patch.height, (1 - localV) * patch.height);
    const blend = smoothstep(0, 3, Math.min(edgeX, edgeY));
    return base + (detail - base) * blend * this.detailDisp;
  }

  dispose(): void {
    this.detailAlbedoTex?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.heightTex.dispose();
    this.biomeTex.dispose();
    this.detailHeightTex.dispose();
    this.blankTex.dispose();
  }
}

/**
 * A plain uv grid, square in both directions.
 *
 * Square because the window it gets stretched over is square: an n × n/2 grid was
 * right when the window was always the whole 2:1 world and wrong the moment it
 * stopped being. Positions are placeholders; the vertex shader owns them.
 */
function buildGrid(n: number): THREE.BufferGeometry {
  const N = Math.max(16, Math.round(n));
  const v = N + 1;
  const pos = new Float32Array(v * v * 3);
  const uv = new Float32Array(v * v * 2);
  for (let j = 0; j < v; j++) {
    for (let i = 0; i < v; i++) {
      const k = j * v + i;
      uv[k * 2] = i / N;
      uv[k * 2 + 1] = j / N;
      pos[k * 3] = (i / N - 0.5) * SIZE_X;
      pos[k * 3 + 2] = (j / N - 0.5) * SIZE_X;
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let o = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * v + i, b = a + 1, c = a + v, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SIZE_X);
  return g;
}

// ---------------------------------------------------------------------------
// Where the camera is looking
// ---------------------------------------------------------------------------

/**
 * The square of world the camera can see, or the whole thing when that cannot be
 * worked out.
 *
 * Four corner rays are dropped onto the base surface — the y = 0 plane, or the
 * sphere at sea level. If any of them misses, the view contains horizon or empty
 * space and there is no bounded footprint, so the answer is the whole world. That
 * fallback is not a failure case, it is the common case at full zoom, and it is
 * exactly the behaviour the view had before windows existed.
 */
export function visibleWindow(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  shape: SculptShape,
  worldWidth: number,
  worldHeight: number,
  pad = 1.35,
): UVWindow {
  const sizeZ = SIZE_X * (worldHeight / worldWidth);
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const us: number[] = [];
  const vs: number[] = [];

  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      origin.copy(camera.position);
      dir.set(nx, ny, 0.5).unproject(camera).sub(origin).normalize();
    } else {
      origin.set(nx, ny, -1).unproject(camera);
      dir.set(nx, ny, 1).unproject(camera).sub(origin).normalize();
    }
    let t: number;
    if (shape === 'plane') {
      if (Math.abs(dir.y) < 1e-4) return { ...FULL_WINDOW };
      t = -origin.y / dir.y;
      if (t <= 0) return { ...FULL_WINDOW };
      p.copy(dir).multiplyScalar(t).add(origin);
      us.push(p.x / SIZE_X + 0.5);
      vs.push(p.z / sizeZ + 0.5);
    } else {
      const b = origin.dot(dir);
      const c = origin.lengthSq() - R_GLOBE * R_GLOBE;
      const disc = b * b - c;
      if (disc <= 0) return { ...FULL_WINDOW };
      t = -b - Math.sqrt(disc);
      if (t <= 0) return { ...FULL_WINDOW };
      p.copy(dir).multiplyScalar(t).add(origin);
      const r = p.length();
      const lat = Math.asin(Math.min(1, Math.max(-1, p.y / r)));
      const v = 0.5 - lat / Math.PI;
      // Near a pole the longitude of a point stops meaning anything for a
      // bounding box — every meridian is a step away — so do not try.
      if (v < 0.06 || v > 0.94) return { ...FULL_WINDOW };
      us.push(Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5);
      vs.push(v);
    }
  }

  // Unwrap the longitudes around the first corner so a footprint over the seam
  // stays one interval instead of spanning the world.
  const a = us[0];
  const un = us.map((u) => {
    let x = u;
    while (x - a > 0.5) x -= 1;
    while (x - a < -0.5) x += 1;
    return x;
  });
  const u0 = Math.min(...un), u1 = Math.max(...un);
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  const size = Math.max(u1 - u0, v1 - v0) * pad;
  if (!Number.isFinite(size) || size >= 1) return { ...FULL_WINDOW };
  return {
    u: (u0 + u1) / 2,
    v: (v0 + v1) / 2,
    size: Math.max(MIN_UV_WINDOW, size),
  };
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/**
 * Which world cell is under a ray.
 *
 * Analytic, not `THREE.Raycaster`. The mesh is a million triangles and its
 * vertices live only in the shader — the CPU copy is a flat grid — so a
 * raycaster would be both slow and wrong. Marching the ray against the height
 * field is a few dozen texture reads from an array already in memory, it is
 * correct by construction on both shapes, and it is the same code path for
 * hovering and for painting.
 */
export function pickCell(
  surface: SculptSurface,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  shape: SculptShape,
  worldWidth: number,
  worldHeight: number,
): { x: number; y: number } | null {
  const yMul = surface.yMul;
  const sizeZ = SIZE_X * (worldHeight / worldWidth);

  const toCell = (p: THREE.Vector3): { x: number; y: number } | null => {
    if (shape === 'plane') {
      const u = p.x / SIZE_X + 0.5;
      const v = p.z / sizeZ + 0.5;
      if (v < 0 || v > 1) return null;
      return { x: (((u % 1) + 1) % 1) * worldWidth, y: v * worldHeight };
    }
    const r = p.length();
    if (r < 1e-4) return null;
    const lat = Math.asin(Math.min(1, Math.max(-1, p.y / r)));
    const lon = Math.atan2(p.z, p.x);
    const u = lon / (Math.PI * 2) + 0.5;
    const v = 0.5 - lat / Math.PI;
    return { x: (((u % 1) + 1) % 1) * worldWidth, y: Math.min(worldHeight - 1, Math.max(0, v * worldHeight)) };
  };

  /** Signed distance above the surface: positive outside, negative inside. */
  const above = (p: THREE.Vector3): number => {
    const c = toCell(p);
    if (!c) return 1;
    const e = surface.heightAtCell(c.x, c.y);
    if (shape === 'plane') return p.y - e * yMul;
    return p.length() - (R_GLOBE + e * yMul * GLOBE_RELIEF);
  };

  // Bracket the search: a slab for the plane, the outer sphere for the globe.
  let t0 = 0;
  let t1: number;
  if (shape === 'plane') {
    if (Math.abs(dir.y) < 1e-6) return null;
    const top = 40, bottom = -40;
    const ta = (top - origin.y) / dir.y;
    const tb = (bottom - origin.y) / dir.y;
    t0 = Math.max(0, Math.min(ta, tb));
    t1 = Math.max(ta, tb);
    if (t1 <= 0) return null;
  } else {
    const R = R_GLOBE + 40;
    const b = origin.dot(dir);
    const c = origin.lengthSq() - R * R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(0, -b - s);
    t1 = -b + s;
  }

  const p = new THREE.Vector3();
  const STEPS = 192;
  let prevT = t0;
  const startAbove = above(p.copy(dir).multiplyScalar(t0).add(origin));
  if (startAbove < 0) return toCell(p);       // started underground
  for (let k = 1; k <= STEPS; k++) {
    const t = t0 + ((t1 - t0) * k) / STEPS;
    const a = above(p.copy(dir).multiplyScalar(t).add(origin));
    if (a < 0) {
      // Bisect for a clean hit; twelve halvings is far below one cell.
      let lo = prevT, hi = t;
      for (let q = 0; q < 12; q++) {
        const mid = (lo + hi) / 2;
        if (above(p.copy(dir).multiplyScalar(mid).add(origin)) < 0) hi = mid;
        else lo = mid;
      }
      return toCell(p.copy(dir).multiplyScalar(hi).add(origin));
    }
    prevT = t;
  }
  return null;
}
