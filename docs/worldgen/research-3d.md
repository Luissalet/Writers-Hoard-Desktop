# Investigación — 3D
> Recopilado automáticamente durante la sesión del 2026-07-24 para el motor `worldgen` de Writers Hoard.


---

<!-- fuente: stylized-3d-threejs.md -->

All research in. Here's the report.

---

# Stylized 3D Fantasy World Map in three.js — Implementation Reference

**Target stack:** TypeScript + three.js r160+ (WebGL2), Electron, 2048×1024 heightmap, flat-map ⇄ globe, painterly/cartographic NPR look.

---

## 0. Architecture at a glance

The single most important structural decision: **write one shared GLSL module** (`world.glsl.ts`) exporting `sampleHeight()`, `terrainNormal()`, `skyGradient()`, `aerialPerspective()`, `cloudShadow()`, and inject it into terrain, water, vegetation, and city materials alike. Everything looking like one painting comes from every surface calling the *same* sky/fog/cloud functions, not from tuning five materials to match.

| Layer | Technique | Draw calls | Tris | GPU ms (1660 @1080p) |
|---|---|---|---|---|
| Terrain | CDLOD quadtree, 1 shared grid + VTF, instanced | **1** | ~1.0 M | 0.8–1.4 |
| Vegetation | InstancedMesh per (tile × LOD tier) | 50–110 | ~2.0 M | 2.5–4.0 |
| City | `mergeGeometries` per district + `THREE.LOD` | ~63 | ~0.4 M | 0.4–0.8 |
| Water | 1 ocean plane + river ribbons, depth prepass | 4–10 | ~50 k | 0.6–1.2 |
| Sky/clouds | Gradient dome + billboard sprites | 2–5 | ~5 k | 0.3–0.7 |
| Post (NPR) | pmndrs, Kuwahara @half-res | 5 passes | — | 4.0–5.5 |
| **Total** | | **~150–200** | **~3.5 M** | **~9–14 ms** |

---

## 1. TERRAIN MESH

### 1.1 The four options, with real numbers for 2048×1024

| Approach | Verts | Tris | Geometry VRAM | Draw calls | Culling | LOD pop |
|---|---|---|---|---|---|---|
| **A.** Single `PlaneGeometry(W,H,2047,1023)` | 2,097,152 | 4,188,162 | **117 MB** (67 MB attrs + 50 MB Uint32 index) | 1 | none | n/a |
| **B.** Single low-res plane + vertex displacement | 262,144 | 522,242 | 8 MB | 1 | none | n/a (no detail near camera) |
| **C.** Static chunk grid + `THREE.LOD` per chunk | 128 chunks × 16,641 | ~1.2 M visible | ~70 MB | 20–40 | per chunk | **visible pops** |
| **D. CDLOD quadtree, one shared grid + VTF, instanced** | 4,225 (shared) | ~1.0 M visible | **330 KB** | **1** | per node | **none (geomorph)** |

**Take Option A seriously as a 30-minute prototype** — 4.2 M tris is ~1.5–2.5 ms on a GTX 1660 and it genuinely works. What kills it in production is not the GPU: it's that `PlaneGeometry` builds those typed arrays on the CPU (~1–2 s, 117 MB of JS heap before upload), `computeVertexNormals()` on 4.2 M tris takes 3–5 s, and you pay full cost when zoomed into one corner. Ship it as the baseline you diff against.

**Option D is the answer.** CDLOD ([Strugar 2009, source + paper](https://github.com/fstrugar/CDLOD)) is "a quadtree of regular grids" where "the LOD function is the same across the whole rendered mesh and is based on the precise three-dimensional distance between the observer and the terrain." The three properties that matter here:

1. **Every node draws the identical `BufferGeometry`** — a unit grid in [0,1]². Only uniforms/instance attributes differ (origin, scale, morph constants). Geometry VRAM for the *entire terrain* is one 65×65 grid: 4,225 verts × 8 B (a `vec2` position — you don't even need y, normal, or uv) = 34 KB, plus 8,192 tris × 3 × 2 B Uint16 = 48 KB. **82 KB.**
2. **Height comes from a vertex texture fetch**, so the mesh carries no elevation data at all. `2048×1024 R16F` = 4 MB.
3. **Geomorphing removes popping entirely** by sliding odd-indexed vertices onto their even (parent-LOD) neighbours as the node approaches its range boundary.

Because every node is the same geometry, **make the whole terrain one `InstancedBufferGeometry`** — one draw call for the entire planet.

### 1.2 Grid sizing

Pick the grid so the index buffer stays Uint16 (`< 65,536` verts):

| Grid (quads/side) | Verts | Tris/node | Nodes typically selected | Total tris |
|---|---|---|---|---|
| 32×32 | 1,089 | 2,048 | 250–400 | 0.5–0.8 M |
| **64×64** | **4,225** | **8,192** | **100–200** | **0.8–1.6 M** ✅ |
| 128×128 | 16,641 | 32,768 | 60–140 | 2.0–4.6 M ❌ |

**Use 64×64.** 128×128 nodes give you fewer instances but blow the triangle budget, and CDLOD's whole point is that node count adapts — you don't save draw calls with bigger nodes when you're already at 1.

### 1.3 The quadtree, LOD ranges, and morph constants (TypeScript)

```ts
const LOD_COUNT = 6;
const GRID = 64;                    // quads per side
const DETAIL_BALANCE = 2.0;         // each level's range ~2x the previous
const MORPH_START_RATIO = 0.66;     // CDLOD default

// --- LOD range distribution (CDLOD LODSelection) ---
function buildRanges(near: number, visibility: number): Float32Array {
  let total = 0, bal = 1.0;
  for (let i = 0; i < LOD_COUNT; i++) { total += bal; bal *= DETAIL_BALANCE; }
  const sect = (visibility - near) / total;
  const ranges = new Float32Array(LOD_COUNT);
  let prev = near; bal = 1.0;
  for (let i = 0; i < LOD_COUNT; i++) {
    ranges[i] = prev + sect * bal; prev = ranges[i]; bal *= DETAIL_BALANCE;
  }
  return ranges;
}

// --- morph constants per level: morphK = 1 - clamp(mc.x - dist*mc.y, 0, 1) ---
function buildMorphConsts(ranges: Float32Array): Float32Array {
  const mc = new Float32Array(LOD_COUNT * 2);
  for (let i = 0; i < LOD_COUNT; i++) {
    const end = ranges[i];
    const prevEnd = i > 0 ? ranges[i - 1] : 0;
    const start = prevEnd + (end - prevEnd) * MORPH_START_RATIO;
    mc[i * 2 + 0] = end / (end - start);
    mc[i * 2 + 1] = 1.0 / (end - start);
  }
  return mc;
}
```

Node AABBs need per-node **min/max height**, so build a min/max mip pyramid of the heightmap once at load (6 levels over 2048×1024, ~3 ms in JS). Store as two `Float32Array`s per level.

```ts
type Node = { x: number; y: number; size: number; lvl: number; hMin: number; hMax: number };

// Returns nodes to draw. Classic CDLOD recursion.
function lodSelect(n: Node, lvl: number, cam: THREE.Vector3, frustum: THREE.Frustum,
                   ranges: Float32Array, out: Node[], parentInFrustum = false): 'SELECTED'|'OUT_OF_RANGE' {
  const box = nodeBox(n);                              // THREE.Box3 in world space
  if (!sphereIntersectsBox(cam, ranges[lvl], box)) return 'OUT_OF_RANGE';
  // frustum test can be skipped once a parent was fully inside
  const inFrustum = parentInFrustum || frustum.intersectsBox(box);
  if (!inFrustum) return 'SELECTED';                   // culled, but "handled"

  if (lvl === 0) { out.push(n); return 'SELECTED'; }

  // Does any part need a finer level?
  if (!sphereIntersectsBox(cam, ranges[lvl - 1], box)) { out.push(n); return 'SELECTED'; }

  for (const c of children(n)) {
    if (lodSelect(c, lvl - 1, cam, frustum, ranges, out, inFrustum) === 'OUT_OF_RANGE') {
      out.push({ ...c, lvl });                         // child out of finer range → draw at THIS level
    }
  }
  return 'SELECTED';
}
```

That last line is the whole trick — a node whose child fell outside the finer range gets drawn as a quarter-node at the coarser level, which is what keeps the mesh watertight without stitching strips.

### 1.4 One draw call: instanced patches

```ts
// Shared unit grid: vec2 positions in [0,1]^2, Uint16 index.
function makeGrid(n: number): THREE.InstancedBufferGeometry {
  const verts = new Float32Array((n + 1) * (n + 1) * 2);
  let p = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { verts[p++] = i / n; verts[p++] = j / n; }
  const idx = new Uint16Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('gridPos', new THREE.BufferAttribute(verts, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const MAX_NODES = 512;
const geo = makeGrid(GRID);
// per-instance: xy = node origin in UV space, z = node size in UV, w = lod level
geo.setAttribute('iNode', new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 4), 4));

const terrain = new THREE.Mesh(geo, terrainMaterial);
terrain.frustumCulled = false;                 // we cull in the quadtree ourselves
scene.add(terrain);

// per frame, after lodSelect():
const arr = (geo.getAttribute('iNode') as THREE.InstancedBufferAttribute).array as Float32Array;
for (let i = 0; i < selected.length; i++) {
  const n = selected[i];
  arr[i*4+0] = n.x; arr[i*4+1] = n.y; arr[i*4+2] = n.size; arr[i*4+3] = n.lvl;
}
geo.getAttribute('iNode').needsUpdate = true;
geo.instanceCount = selected.length;
```

`lodSelect` on a 6-level tree costs ~0.15–0.4 ms of JS for 150 selected nodes. Throttle it to run only when the camera moves >2 units or rotates >0.01 rad — on a mostly-static map view it runs a few times per second.

### 1.5 The vertex shader — geomorph + VTF + flat/globe projection

Set `material.glslVersion = THREE.GLSL3` so you get `textureLod()` in the vertex stage. WebGL2 guarantees `maxVertexTextures ≥ 16`; assert `renderer.capabilities.maxVertexTextures > 0` anyway.

```glsl
in vec2 gridPos;      // [0,1]^2
in vec4 iNode;        // xy = origin (UV), z = size (UV), w = lod level

uniform sampler2D uHeight;      // R16F, LinearFilter
uniform vec2  uMorphConsts[6];
uniform float uHeightScale;     // world units per unit of heightmap value
uniform vec2  uWorldSize;       // e.g. vec2(4096.0, 2048.0)
uniform float uSphereMix;       // 0 = flat map, 1 = globe
uniform float uRadius;
uniform vec3  uCamPos;

out vec2 vUv;
out vec3 vWorldPos;

const float PI = 3.14159265;

float sampleH(vec2 uv) { return textureLod(uHeight, uv, 0.0).r * uHeightScale; }

// CDLOD morph: slide odd-indexed grid vertices onto their even (parent) neighbours.
vec2 morphVertex(vec2 g, float morphK) {
  const float N = 64.0;                       // GRID
  vec2 frac = fract(g * N * 0.5) * 2.0 / N;   // 0 for even index, 1/N for odd
  return g - frac * morphK;
}

vec3 project(vec2 uv, float h) {
  vec3 flat3 = vec3((uv.x - 0.5) * uWorldSize.x, h, (0.5 - uv.y) * uWorldSize.y);
  if (uSphereMix < 0.001) return flat3;
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (0.5 - uv.y) * PI;
  float r   = uRadius + h;
  vec3 sph  = vec3(r * cos(lat) * sin(lon), r * sin(lat), r * cos(lat) * cos(lon));
  return mix(flat3, sph, uSphereMix);
}

void main() {
  // pass 1: unmorphed position, to measure distance
  vec2 uv0  = iNode.xy + gridPos * iNode.z;
  vec3 wp0  = project(uv0, sampleH(uv0));
  float d   = distance(uCamPos, wp0);

  // pass 2: morph and re-sample
  vec2 mc   = uMorphConsts[int(iNode.w)];
  float k   = 1.0 - clamp(mc.x - d * mc.y, 0.0, 1.0);
  vec2 g    = morphVertex(gridPos, k);
  vUv       = iNode.xy + g * iNode.z;
  vWorldPos = project(vUv, sampleH(vUv));

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
```

Why this is seamless with **no mip pyramid**: at `morphK = 1` the vertex lands exactly on the parent grid's vertex position, so its texture fetch returns exactly the parent's height. Geometry and elevation converge together. Two VTFs per vertex is the only cost.

**Heightmap texture format — the one gotcha.** Use `THREE.HalfFloatType`. `R16F` is linearly filterable in WebGL2 core; `R32F` (`THREE.FloatType`) requires the `OES_texture_float_linear` extension and will silently fall back to `NearestFilter` on some Intel drivers, giving you a visibly faceted terrain.

```ts
const h = new THREE.DataTexture(halfFloatArray, 2048, 1024, THREE.RedFormat, THREE.HalfFloatType);
h.minFilter = h.magFilter = THREE.LinearFilter;
h.wrapS = THREE.RepeatWrapping;      // longitude wraps on a globe
h.wrapT = THREE.ClampToEdgeWrapping;
h.needsUpdate = true;
```

Half-float in [0,1] gives ~2⁻¹² relative steps ≈ 0.24 m per 1000 m of range — fine for a stylized map. If you need more, store 16-bit unsigned in RG8 and unpack manually (losing hardware filtering).

### 1.6 Normals — compute them, don't store them

Compute in the **fragment** shader from heightmap central differences. This gives full-resolution normals regardless of how coarse the mesh LOD is under that pixel — distant low-poly terrain still shows crisp relief.

```glsl
uniform vec2 uTexel;        // vec2(1.0/2048.0, 1.0/1024.0)
uniform vec2 uWorldTexel;   // world units per heightmap texel, vec2(2.0, 2.0)

vec3 terrainNormal(vec2 uv) {
  float hL = textureLod(uHeight, uv - vec2(uTexel.x, 0.0), 0.0).r * uHeightScale;
  float hR = textureLod(uHeight, uv + vec2(uTexel.x, 0.0), 0.0).r * uHeightScale;
  float hD = textureLod(uHeight, uv - vec2(0.0, uTexel.y), 0.0).r * uHeightScale;
  float hU = textureLod(uHeight, uv + vec2(0.0, uTexel.y), 0.0).r * uHeightScale;
  float dhdx = (hR - hL) / (2.0 * uWorldTexel.x);
  float dhdz = (hU - hD) / (2.0 * uWorldTexel.y);
  return normalize(vec3(-dhdx, 1.0, -dhdz));
}
```

4 fetches per pixel. **Optimisation:** bake a normal map offline into `RG8` (store xz, reconstruct `y = sqrt(1 - x² - z²)`) — 2048×1024 RG8 = 4 MB, 1 fetch instead of 4, and you can pre-filter it with mips to kill specular aliasing on distant slopes. Do this as soon as the look is locked.

### 1.7 Keeping the globe version working

The `uSphereMix` uniform above already does 90% of it — you can **animate a flat map unfolding into a globe** for free, which is a genuinely strong feature for this app. The remaining work:

- **Quadtree root split.** A 2:1 map means the root node is non-square. Start with **two 1024×1024 root nodes** side by side so every node is square in UV and the LOD ranges behave.
- **Node bounds must be computed in the projected space.** In globe mode a node's AABB is not the flat box — build a bounding sphere from the node's lat/lon corners plus `hMax`, or just recompute the 8 projected corners at selection time (cheap: 150 nodes × 8 = 1200 `project()` calls in JS, ~0.05 ms).
- **Horizon culling** (the big win on a globe — cheaper and more effective than frustum culling). With everything relative to planet centre, a point `P` is hidden if `dot(P, camPos) < R²`. Test the node's farthest point:
  ```ts
  const hidden = nodeFarPoint.dot(camPos) < radius * radius;
  ```
- **Pole pinching.** Equirectangular texel density scales by `1/cos(lat)` — 5.7× compression at 80°. Clamp latitude to ±89.5° and cap with a small polar disc mesh, and cull polar nodes aggressively (they contribute almost no screen area).
- **If pole distortion becomes unacceptable, move to a cube-sphere**: 6 quadtrees, offline-resample the equirect heightmap into 6 face textures. Use the *spherified* cube rather than naive normalize — naive normalize makes centre-of-face cells "roughly four times as large as the smallest cells" ([Catlike Coding](https://catlikecoding.com/unity/tutorials/cube-sphere/)):
  ```glsl
  vec3 spherify(vec3 p) {   // p in [-1,1]^3 on the cube surface
    vec3 p2 = p * p;
    return p * sqrt(1.0 - p2.yzx * 0.5 - p2.zxy * 0.5 + p2.yzx * p2.zxy / 3.0);
  }
  ```
- **Precision.** Keep `uRadius` in the 1,000–8,000 range. Float32 world coordinates hold up fine at fantasy-planet scale; you only need double-precision / origin-rebasing at Earth scale (6.4 M).

### 1.8 Shadows from a VTF-displaced terrain — the gotcha

three.js renders shadow maps with `MeshDepthMaterial`, which knows nothing about your displacement. Terrain will cast a **flat** shadow unless you supply a matching depth material:

```ts
terrain.customDepthMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: TERRAIN_VS,                       // the exact same VS as above
  fragmentShader: `
    #include <packing>
    void main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`,
  uniforms: terrainMaterial.uniforms,             // share the uniform object, not a copy
});
```

Same applies to vegetation wind (§3.5) and to any instanced geometry.

---

## 2. TERRAIN SHADING — and making 3D read as a MAP

### 2.1 Material choice

Use `MeshStandardMaterial` + `onBeforeCompile` for tier 1 so you inherit three.js shadows, fog, and lights for free; migrate to a custom `ShaderMaterial` once the look is locked. [`three-custom-shader-material`](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) is the pragmatic middle ground — it lets you write `csm_DiffuseColor` / `csm_Position` against a real `MeshStandardMaterial` without string-replacing chunks.

Pack all terrain layer textures into a **`THREE.DataArrayTexture`** (`sampler2DArray`) so 8 materials cost one sampler binding instead of eight:

```ts
const layers = new THREE.DataArrayTexture(data, 1024, 1024, 8);  // grass, rock, sand, snow, ...
layers.format = THREE.RGBAFormat;
layers.minFilter = THREE.LinearMipmapLinearFilter;
layers.magFilter = THREE.LinearFilter;
layers.wrapS = layers.wrapT = THREE.RepeatWrapping;
layers.needsUpdate = true;
// GLSL: uniform sampler2DArray tLayers;  texture(tLayers, vec3(uv, float(layer)))
```

### 2.2 Procedural weights from height + slope + moisture

For a procedurally generated world, computing weights in the shader beats a baked splatmap — zero texture memory, and it updates instantly when the generator re-runs.

```glsl
uniform sampler2D uMoisture;   // R8, 2048x1024
uniform float uSeaLevel, uSnowLine;

struct Weights { float sand, grass, forestFloor, rock, snow; };

Weights terrainWeights(float h, float slope, float moist) {
  Weights w;
  w.rock        = smoothstep(0.42, 0.72, slope);
  w.snow        = smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, h)
                * (1.0 - smoothstep(0.55, 0.82, slope));
  w.sand        = (1.0 - smoothstep(uSeaLevel + 2.0, uSeaLevel + 16.0, h))
                * (1.0 - smoothstep(0.30, 0.55, slope));
  w.forestFloor = smoothstep(0.45, 0.75, moist) * (1.0 - w.rock);
  w.grass       = 1.0;                                   // base layer
  return w;
}
// slope = 1.0 - N.y  (flat = 0, vertical = 1)
```

### 2.3 Height-blend, not linear blend

Linear alpha blending of splat weights looks wrong — "the transition is smooth but unnatural. Stones look evenly soiled by sand" ([Mishkinis, *Advanced Terrain Texture Splatting*](https://www.gamedeveloper.com/programming/advanced-terrain-texture-splatting)). Store a height/depth value in each layer texture's alpha and blend by it. The N-layer generalisation:

```glsl
const float BLEND_DEPTH = 0.2;

vec3 heightBlendN(vec4 tex[5], float w[5]) {
  float ma = -1e9;
  for (int i = 0; i < 5; i++) ma = max(ma, tex[i].a + w[i]);
  ma -= BLEND_DEPTH;
  vec3  sum = vec3(0.0);
  float den = 0.0;
  for (int i = 0; i < 5; i++) {
    float b = max(tex[i].a + w[i] - ma, 0.0);
    sum += tex[i].rgb * b;
    den += b;
  }
  return sum / max(den, 1e-4);
}
```

This is the single biggest quality-per-line-of-code win in terrain shading. Sand now settles *into* the cracks between stones instead of fogging them.

### 2.4 Triplanar, gated by slope

Full triplanar is 3× the texture fetches. Because the Y projection *is* the top-down projection you already have, gate the extra X/Z work on slope:

```glsl
vec3 triplanarAlbedo(vec3 wp, vec3 N, int layer, float scale) {
  vec3 b = pow(abs(N), vec3(4.0));            // sharpness 4 — smooth, no black corners
  b /= dot(b, vec3(1.0));

  vec3 cy = texture(tLayers, vec3(wp.xz * scale, float(layer))).rgb;
  if (b.x + b.z < 0.02) return cy;            // near-flat: skip 2 of 3 samples

  vec3 cx = texture(tLayers, vec3(wp.zy * scale, float(layer))).rgb;
  vec3 cz = texture(tLayers, vec3(wp.xy * scale, float(layer))).rgb;
  return cx * b.x + cy * b.y + cz * b.z;
}
```

Note `pow(abs(N), 4)` rather than the `max(abs(N) - 0.2, 0)` form: subtraction sharpens corners disproportionately and goes black above ~0.55, since a 45° normal component is 0.577 ([Ben Golus](https://bgolus.medium.com/normal-mapping-for-a-triplanar-shader-10bf39dca05a)).

**Triplanar normal mapping — use Whiteout blend.** The naive approach (mesh tangents with projected UVs) produces normals that appear inverted or rotated depending on view angle. Whiteout is 5 instructions and is ground-truth on axis-aligned surfaces:

```glsl
vec3 triplanarNormal(vec3 wp, vec3 N, int layer, float scale) {
  vec3 b = pow(abs(N), vec3(4.0)); b /= dot(b, vec3(1.0));
  vec3 tx = texture(tNormals, vec3(wp.zy * scale, float(layer))).xyz * 2.0 - 1.0;
  vec3 ty = texture(tNormals, vec3(wp.xz * scale, float(layer))).xyz * 2.0 - 1.0;
  vec3 tz = texture(tNormals, vec3(wp.xy * scale, float(layer))).xyz * 2.0 - 1.0;
  // Whiteout blend
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
}
```

Also worth knowing: at 45° exactly, triplanar breaks — accept it, or dial sharpness down.

### 2.5 Making it READ AS A MAP — the core of this project

This is where the app earns its identity. Four layers, all driven by one `uMapness` uniform.

**(a) Auto-drive `uMapness` from camera height.** As you zoom out, the render should *become* a map. As you zoom in, it becomes a landscape.

```ts
terrainMat.uniforms.uMapness.value = THREE.MathUtils.smoothstep(camera.position.y, 800, 2500);
```

**(b) Blend the 2D cartographic texture over the 3D relief — with soft light, not multiply.** You already generate the Wonderdraft-style 2D map; render it to a `tCarto` texture (4096×2048). Multiply darkens and desaturates; soft light preserves the map's hue and saturation while adding form. This is exactly what relief-shading cartography does.

```glsl
vec3 softLight(vec3 base, vec3 blend) {
  return mix(2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
             sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
             step(0.5, blend));
}

// classic Swiss relief hillshade: NW light, softened toward a sky term
vec3  L      = normalize(vec3(-0.7071, 0.7071, -0.7071));   // 315° az, 45° alt
float lamb   = max(dot(N, L), 0.0);
float sky    = 0.5 + 0.5 * N.y;
float shade  = mix(sky, lamb, 0.65);

vec3 carto  = texture(tCarto, vUv).rgb;
vec3 mapCol = softLight(carto, vec3(shade));

vec3 albedo = mix(pbrAlbedo, mapCol, uMapness);
```

**(c) Hypsometric tints + contour lines.** A 1D gradient LUT (256×1 RGB) indexed by normalised elevation gives you authored map palettes with one texture swap.

```glsl
uniform sampler2D uHypso;        // 256x1 gradient
uniform float uContourInterval;  // world units, e.g. 50.0
uniform float uLineWidthPx;      // 1.4

vec3 hypso = texture(uHypso, vec2(clamp(h / uMaxHeight, 0.0, 1.0), 0.5)).rgb;
albedo = mix(albedo, albedo * hypso * 1.6, uMapness * uHypsoAmount);

// antialiased contours, with automatic moiré suppression
float c  = h / uContourInterval;
float df = fwidth(c);
float f  = abs(fract(c - 0.5) - 0.5);
float contour = 1.0 - smoothstep(0.0, df * uLineWidthPx, f);
contour *= 1.0 - smoothstep(0.5, 1.5, df);        // fade out when lines get denser than a pixel
float major = step(mod(floor(c + 0.5), 5.0), 0.5); // index contour every 5th
albedo = mix(albedo, uInkColor, contour * (0.25 + 0.45 * major) * uMapness);
```

The `1.0 - smoothstep(0.5, 1.5, df)` line is not optional — without it, steep terrain turns into a shimmering moiré field the moment contours pack tighter than one pixel.

**(d) Ink coastlines and ridge lines, drawn in the terrain shader.** Doing this here rather than in post gives you *world-space* line placement — lines that sit on the terrain, follow it in perspective, and don't smear when the Kuwahara filter runs. Post-process Sobel (§6.4) then handles silhouettes and object outlines; the two are complementary.

```glsl
// --- coastline: the sea-level contour ---
float d = h - uSeaLevel;
float wCoast = max(fwidth(d) * uCoastPx, uMinCoastWorld);   // screen-width floor + world-width floor
float coast  = 1.0 - smoothstep(0.0, wCoast, abs(d));

// --- ridge/valley lines: Laplacian of height (convex = ridge) ---
float lap = hL + hR + hD + hU - 4.0 * hC;
float ridge  = smoothstep(uRidgeT0, uRidgeT1, -lap * uRidgeGain) * smoothstep(0.25, 0.60, slope);
float valley = smoothstep(uRidgeT0, uRidgeT1,  lap * uRidgeGain) * smoothstep(0.15, 0.45, slope);

// --- hachures: hatch strokes running downhill on steep ground ---
vec2  grad     = normalize(vec2(dhdx, dhdz) + 1e-6);
vec2  hatchUv  = vec2(dot(vWorldPos.xz, vec2(-grad.y, grad.x)), dot(vWorldPos.xz, grad));
float hatch    = smoothstep(0.45, 0.55, fract(hatchUv.x * uHatchFreq))
               * smoothstep(0.55, 0.85, slope);

float ink = clamp(coast * 1.0 + ridge * 0.6 + valley * 0.35 + hatch * 0.30, 0.0, 1.0);
albedo = mix(albedo, uInkColor, ink * uMapness * uInkStrength);
```

Use a warm sepia `uInkColor = vec3(0.16, 0.11, 0.08)`, never pure black — flat black is the clearest tell that a line is procedural.

**(e) Paper grain on the terrain itself** (distinct from the screen-space paper in post): a very low-amplitude world-space triplanar grain gives the surface tooth without looking like a decal.

```glsl
float grain = texture(tPaperGrain, vWorldPos.xz * 0.35).r;
albedo *= mix(1.0, 0.90 + 0.20 * grain, 0.35 * uMapness);
```

### 2.6 Two things that will bite you

- **Texture repetition.** At map scale a 1024² tiling texture repeats hundreds of times and reads as a grid. Fade detail textures to a flat biome colour beyond ~500 world units (`smoothstep` on view distance) — this is a perf win *and* pushes the far field toward the map look, which is exactly what you want. For the near field, stochastic/hex-tiling (3 samples + a blend) kills repetition properly.
- **Specular aliasing on distant slopes.** Computing normals from a non-mipped heightmap gives full-frequency normals at every distance, which shimmers. Bake the normal map with mips (§1.6) and let mip selection do the filtering.

---

## 3. VEGETATION

### 3.1 Which instancing class

| Class | Mechanism | Use for |
|---|---|---|
| `THREE.InstancedMesh` | `drawElementsInstanced` — 1 geometry, N transforms, 1 draw call | **Grass, one tree species per LOD tier, rocks.** Default. |
| `THREE.InstancedBufferGeometry` + `ShaderMaterial` | Same GL path, you own the attribute layout | Grass, when you want 16 B/blade instead of a 64 B mat4 |
| `THREE.BatchedMesh` | `WEBGL_multi_draw` — N different geometries, 1 draw call, **per-object culling + sorting** | Buildings, mixed species. Not grass. |

`BatchedMesh` ["performs worse if you render a lot of instances (more than 100k)"](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221). Rule: **>10 k identical → InstancedMesh; <10 k varied → BatchedMesh.**

```ts
const trees = new THREE.InstancedMesh(treeGeo, treeMat, MAX);
trees.count = actualCount;                              // render fewer than allocated — free culling
trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
trees.setMatrixAt(i, m.compose(pos, q, s));
trees.setColorAt(i, tint.setHSL(0.25 + rng()*0.04, 0.4, 0.35 + rng()*0.2));
trees.instanceMatrix.needsUpdate = true;
trees.instanceColor!.needsUpdate = true;
trees.computeBoundingSphere();   // MUST call after setMatrixAt, or culling uses a stale sphere
```

For grass, drop the mat4 — 16 B/blade vs 64 B is 8 MB vs 32 MB at 500 k blades, and measurably less vertex-attribute bandwidth:

```ts
const geo = new THREE.InstancedBufferGeometry().copy(bladeGeo as any);
geo.instanceCount = N;
geo.setAttribute('iXZRS', new THREE.InstancedBufferAttribute(new Float32Array(N*4), 4)); // x,z,rot,scale
geo.setAttribute('iVar',  new THREE.InstancedBufferAttribute(new Float32Array(N*4), 4)); // hue,height,phase,stiff
```

### 3.2 Budgets that hold at 60 fps

Measured reference points: [1.5 M grass blades at 0.2 ms CPU / 3 ms GPU, 145 fps on an RTX 2060](https://discourse.threejs.org/t/interactive-grass-with-multi-player-physics-and-wind-fps-friendly-and-suitable-for-games/87994); [1 M+ blades at 60 fps on an M1](https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808); working ceiling quoted by maintainers ~[3 M triangles/frame](https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286).

| Asset | Tris each | Visible | Tris | Draw calls |
|---|---|---|---|---|
| Trees LOD0 (0–60 m) | 1,200 | 250 | 300 k | 4–8 |
| Trees LOD1 (60–180 m) | 250 | 1,500 | 375 k | 8–16 |
| Trees LOD2 cross-quads (180–500 m) | 6 | 15,000 | 90 k | 8–16 |
| Trees LOD3 canopy blobs (>500 m) | 40 | 400 blobs | 16 k | 2–4 |
| Grass (0–45 m) | 4 | 250,000 | 1.0 M | 16–36 |
| Bushes/rocks | 80 | 3,000 | 240 k | 6–12 |
| **Total** | | | **~2.0 M** | **~50–110** |

**The binding constraint for grass is fill rate, not triangles.** 250 k quads at 45 m radius covering 5–40 px each gives 4–8× overdraw = 16–33 Mpx of alpha-tested fragments ≈ 2–4 ms on a 1660. **Halve the grass radius before you halve the blade count.**

### 3.3 Distribution from the biome mask

Read the mask once on the CPU via `OffscreenCanvas.getImageData()`. Then:

- **Trees → Poisson disk.** Only Poisson guarantees minimum trunk separation, and clustering is brutally visible on silhouettes. Use [Bridson's algorithm](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf) with the [Extreme Learning improvement](https://extremelearning.com.au/an-improved-version-of-bridsons-algorithm-n-for-poisson-disc-sampling/) — sample the *inner ring* at `k` evenly-spaced angles instead of a uniform annulus: **~20× faster, ~40% denser**.

```ts
export function poisson(w: number, h: number, rAt: (x:number,y:number)=>number, rMin: number, k = 8) {
  const cell = rMin / Math.SQRT2;
  const gw = Math.ceil(w/cell), gh = Math.ceil(h/cell);
  const grid = new Int32Array(gw*gh).fill(-1);
  const pts: number[] = [], active: number[] = [];
  const emit = (x:number,y:number) => {
    const id = pts.length/2; pts.push(x,y);
    grid[((y/cell)|0)*gw + ((x/cell)|0)] = id; active.push(id);
  };
  const ok = (x:number,y:number,r:number) => {
    if (x<0||y<0||x>=w||y>=h) return false;
    const gx=(x/cell)|0, gy=(y/cell)|0, span=Math.ceil(r/cell);
    for (let j=Math.max(0,gy-span); j<=Math.min(gh-1,gy+span); j++)
      for (let i=Math.max(0,gx-span); i<=Math.min(gw-1,gx+span); i++) {
        const id = grid[j*gw+i]; if (id < 0) continue;
        const dx = pts[id*2]-x, dy = pts[id*2+1]-y;
        if (dx*dx+dy*dy < r*r) return false;
      }
    return true;
  };
  emit(Math.random()*w, Math.random()*h);
  while (active.length) {
    const ai = (Math.random()*active.length)|0, p = active[ai];
    const px = pts[p*2], py = pts[p*2+1], r = rAt(px,py), seed = Math.random();
    let placed = false;
    for (let j=0;j<k;j++) {
      const t = 2*Math.PI*(seed + j/k);
      const x = px + (r+1e-6)*Math.cos(t), y = py + (r+1e-6)*Math.sin(t);
      if (ok(x,y,rAt(x,y))) { emit(x,y); placed = true; break; }
    }
    if (!placed) { active[ai] = active[active.length-1]; active.pop(); }
  }
  return new Float32Array(pts);
}
// variable radius from the biome mask: dense forest → small radius
const rAt = (x:number,y:number) => {
  const forest = mask[(((y/h*MASK)|0)*MASK + ((x/w*MASK)|0))*4] / 255;
  return THREE.MathUtils.lerp(9.0, 2.6, forest*forest);
};
```

- **Grass → jittered grid.** 250 k Poisson points cost 200–400 ms in JS; a jittered grid costs ~3 ms and nobody sees the difference under a 20 cm blade. There is [no jitter value that gives even angular distribution without distance outliers](https://www.redblobgames.com/x/1830-jittered-grid/) — irrelevant for grass, fatal for trees. Cheapest of all: threshold a 256² blue-noise texture against the density mask.

### 3.4 Representation, and the FlowScape painterly forest

| Representation | Cost | Distance |
|---|---|---|
| Full model, trunk + leaf cards | 800–2000 tri | 0–60 m |
| Decimated model | 150–350 tri | 60–180 m |
| **Cross-quads** (2–3 intersecting painted quads) | 4–6 tri | 180–500 m |
| Single billboard | 2 tri | 500 m+ |
| [Octahedral impostor](https://shaderbits.com/blog/octahedral-impostors) (6×6…12×12 baked atlas, 3-frame blend) | 2 tri + 1–3 fetches | replaces LOD1/2 |

For a map camera that rarely dips below the horizon, use **hemi-octahedral** impostors (upper hemisphere only, half the atlas) — or honestly skip impostors: cross-quads plus good canopy art get you 90% there for 5% of the pipeline work.

**The painterly recipe, in priority order:**
1. **One 2048²–4096² atlas** with 8–16 painted canopy blobs + 4–8 grass clumps, alpha-cut. All foliage shares one material → one draw call per chunk per tier.
2. **Per-instance hue/value jitter** via `setColorAt` (±0.04 hue, ±0.2 lightness). This single trick breaks the wallpaper repetition and is why painted forests read as hand-made.
3. **Per-instance atlas frame** via a `float iAtlasIndex` instanced attribute, offsetting UVs in the vertex shader — 16 variants, still one draw call.
4. **Canopy blob meshes** for the far tier: one lumpy 40–80 tri hull per grove, same canopy art, never animated. Replaces 400 billboards with 1 mesh and gives a far better silhouette.
5. **Vertical gradient in the fragment shader** — darken canopy bottoms, tint tops with sky colour. Combined with `HemisphereLight`, this *is* the painterly read.
6. Fog matched to sky colour at 250–600 m so LOD swaps are invisible.

### 3.5 Wind in the vertex shader

Use the Crysis formulation — it preserves length and separates trunk bend from leaf flutter ([GPU Gems 3, ch. 16](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)). Vertex colour channels: **R = leaf-edge stiffness, G = per-leaf phase, B = leaf stiffness, A = baked AO**.

```ts
foliageMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', /* glsl */`
      #include <common>
      uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
      vec4 smoothCurve(vec4 x){ return x*x*(3.0-2.0*x); }
      vec4 triangleWave(vec4 x){ return abs(fract(x+0.5)*2.0-1.0); }
      vec4 smoothTriangleWave(vec4 x){ return smoothCurve(triangleWave(x)); }

      // GPU Gems 3 main bending: bend xz by ~h^4, then renormalize to the original
      // radius so branches never stretch.
      vec3 mainBending(vec3 p, vec2 dir, float bendScale){
        float len = length(p);
        float bf = p.y * bendScale; bf += 1.0; bf *= bf; bf = bf*bf - bf;
        vec3 np = p; np.xz += dir * bf;
        return normalize(np) * len;
      }
      vec3 detailBending(vec3 p, vec3 n, float edgeAtten, float phase,
                         float branchPhase, float time, float amp){
        phase += branchPhase;
        float vtxPhase = dot(p, vec3(phase));
        vec2 wavesIn = time + vec2(vtxPhase, branchPhase);
        vec4 waves = fract(wavesIn.xxyy * vec4(1.975,0.793,0.375,0.193)) * 2.0 - 1.0;
        waves = smoothTriangleWave(waves);
        vec2 waveSum = waves.xz + waves.yw;
        p += waveSum.x * edgeAtten * n * amp;
        p.y += waveSum.y * amp * 0.5;
        return p;
      }`)
    .replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        float objPhase = dot(instanceMatrix[3].xyz, vec3(0.37, 0.0, 0.61));
      #else
        float objPhase = 0.0;
      #endif
      transformed = detailBending(transformed, objectNormal, color.r * color.b,
                                  color.g * 6.28, objPhase, uTime * 2.0, uWindStrength * 0.12);
      transformed = mainBending(transformed,
                     uWindDir * uWindStrength * (0.6 + 0.4*sin(uTime*0.7 + objPhase)), 0.06);`);
};
foliageMat.customProgramCacheKey = () => 'foliage-wind-v1';
```

**Critical ordering fact:** `transformed` inside `begin_vertex` is in *instance-local* space — three.js applies `instanceMatrix` later inside `project_vertex`. So bend in local space and read the instance origin from `instanceMatrix[3].xyz`. Chunk names (`common`, `begin_vertex`, `beginnormal_vertex`, `project_vertex`, `worldpos_vertex`, `fog_vertex`) are stable in r160+ ([ShaderChunk.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk.js)). **Inject the same code into `customDepthMaterial` or shadows won't sway.**

Grass wants something simpler — a cubic tip bend masked by `uv.y`, gusted by scrolling noise:

```glsl
float h = uv.y;
float gust = texture2D(uNoise, worldXZ*0.01 + uTime*vec2(0.02,0.011)).r;
float bend = (h*h) * (0.35 + 0.9*gust) * uWindStrength;
transformed.xz += uWindDir * bend;
transformed.y  -= bend * bend * 0.5;     // cheap arc-length compensation
```

### 3.6 Per-instance LOD (you can't use `THREE.LOD`)

`THREE.LOD` is per-*object*. The standard workaround is **one `InstancedMesh` per tier, re-bucketed when the camera moves** — this [nearly doubled framerate on Quest 2 in one reported case](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html):

```ts
update(cam: THREE.Camera) {
  if (cam.position.distanceToSquared(this.lastCam) < 4) return;     // 2 m throttle
  this.lastCam.copy(cam.position);
  const n = this.tiers.map(() => 0);
  for (const item of this.all) {
    const d = cam.position.distanceTo(item.pos);
    const t = d < 60 ? 0 : d < 180 ? 1 : d < 500 ? 2 : -1;
    if (t < 0) continue;
    this.tiers[t].setMatrixAt(n[t]++, item.matrix);
  }
  this.tiers.forEach((m, t) => {
    m.count = n[t];                       // shrink the draw; don't rebuild the buffer
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  });
}
```

Alternative: GPU-side collapse (`gl_Position = vec4(0,0,2,1)` pushes the vertex behind the far plane) — zero CPU, but vertices are still fetched, so only worth it when draw-call-bound. Or use [`@three.ez/instanced-mesh`](https://github.com/agargaro/instanced-mesh), which gives per-instance frustum culling, BVH raycasting and a real `addLevel()` API, [demoed at 1 M instances with 4 LOD tiers](https://discourse.threejs.org/t/instancedmesh-lod-1-million-instances/70748).

### 3.7 Frustum culling — the trap

**`InstancedMesh` is culled as a single object against one `boundingSphere`.** One InstancedMesh covering a 4 km map has a 2 km sphere and is *never* culled. Chunk spatially:

```ts
const TILE = 64;   // metres — 64 m for trees, 24–32 m for grass
// 4 km map = 62×62 tiles, but only ~20 within a 500 m view distance → ~20 draw calls, not 3844
tileMesh.frustumCulled = true;
tileMesh.computeBoundingSphere();
```

Also: instances are **not depth-sorted**, so an instanced field can be *slower* than separate meshes when fragment-bound — [three.js #30352](https://github.com/mrdoob/three.js/issues/30352) measured 5,000 spheres at ~60 fps as Meshes vs ~30 fps as one InstancedMesh with `MeshStandardMaterial`. Sort tiles front-to-back via `renderOrder` and keep the foliage fragment shader cheap.

### 3.8 Alpha and shadows

Alpha *blending* is unfixable for foliage — leaf cards intersect, so no polygon sort is correct. Use cutout + alpha-to-coverage ([Ben Golus](https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f)):

```ts
mat.transparent = false;        // stays in the opaque queue → depth-sorted, z-prepass friendly
mat.alphaTest = 0.4;
mat.alphaToCoverage = true;     // needs MSAA
mat.side = THREE.DoubleSide;
mat.forceSinglePass = true;
```

Two gotchas: (1) using `EffectComposer` bypasses the default framebuffer's MSAA — set `composer.renderTarget1.samples = 4`; (2) mip-mapped alpha fades, so distant foliage thins and vanishes. Fix both before `#include <alphatest_fragment>`:

```glsl
float mip = textureQueryLod(map, vMapUv).x;
diffuseColor.a *= 1.0 + max(0.0, mip) * 0.25;                    // Golus mipScale
diffuseColor.a = (diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5;
```

Shadow rules that matter: `castShadow = true` **only on LOD0 tiles**; **grass never casts** (fake it by darkening the ground shader with the density mask); alpha-tested casters need `customDepthMaterial` with the same `map` + `alphaTest` + wind injection; use [`examples/jsm/csm/CSM.js`](https://threejs.org/examples/webgl_shadowmap_csm.html) with 3×1024² cascades rather than one 4096²; and set `renderer.shadowMap.autoUpdate = false`, flipping `needsUpdate` only when the sun moves — a static-sun map renders shadows **once**.

---

## 4. WATER

### 4.1 Scene depth — the exact setup

```ts
const opaqueRT = new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  generateMipmaps: false, stencilBuffer: false,
});
opaqueRT.depthTexture = new THREE.DepthTexture(w, h);
opaqueRT.depthTexture.format = THREE.DepthFormat;
opaqueRT.depthTexture.type   = THREE.UnsignedIntType;   // DEPTH_COMPONENT24 — best default.
// UnsignedShortType bands visibly past far/near ≈ 5000; FloatType is ~2x bandwidth.
opaqueRT.depthTexture.minFilter = opaqueRT.depthTexture.magFilter = THREE.NearestFilter;
```

Render the opaque scene *without* water into it, using **layers** rather than `visible = false` so instanced/LOD bookkeeping stays intact:

```ts
const LAYER_WATER = 1;
water.layers.set(LAYER_WATER);
camera.layers.enableAll(); camera.layers.disable(LAYER_WATER);
renderer.setRenderTarget(opaqueRT); renderer.clear(); renderer.render(scene, camera);
camera.layers.enableAll();
renderer.setRenderTarget(null); renderer.render(scene, camera);
```

Cost: ~0.4–0.9 ms on a 200 k-tri scene at 1080p. Linearise with `#include <packing>`, which provides `perspectiveDepthToViewZ` / `viewZToOrthographicDepth` ([packing.glsl.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/packing.glsl.js)). Work in **view-space metres** so foam distances are authorable in world units.

```glsl
#include <packing>
vec2  screenUV = gl_FragCoord.xy / uResolution;
float sZ = perspectiveDepthToViewZ(texture2D(tDepth, screenUV).x, uNear, uFar);  // negative
float waterDepth = max(vViewZ - sZ, 0.0);
```

### 4.2 Depth colour ramp — quantised

Exponential (Beer-Lambert) beats a linear `mix` ([Catlike Coding](https://catlikecoding.com/unity/tutorials/flow/looking-through-water/)). **Quantising `t` — not the colour — is the single highest-value stylisation knob**: 4–6 bands reads exactly like a Wonderdraft bathymetric map.

```glsl
float t = 1.0 - exp2(-uDepthDensity * waterDepth);      // uDepthDensity ~0.06
#ifdef QUANTIZE
  float s = t * uBands;                                  // uBands 4..6
  t = (floor(s) + smoothstep(0.42, 0.58, fract(s))) / uBands;   // soft edge = no aliasing
#endif
vec3 waterCol = mix(uShallow, uDeep, t);
```

### 4.3 Shoreline foam — three layers

```glsl
float edge = 1.0 - smoothstep(0.0, uFoamDistance, waterDepth);     // uFoamDistance ~2.5

vec2 nUv0 = vWorldPos.xz*0.09 + vec2(uTime*0.020, uTime*0.013);
vec2 nUv1 = vWorldPos.xz*0.17 - vec2(uTime*0.011, uTime*0.024);
float n = texture2D(tFoamNoise, nUv0).r*0.6 + texture2D(tFoamNoise, nUv1).r*0.4;

float f = clamp(waterDepth / uFoamDistance, 0.0, 1.0);
f -= 0.35 * (1.0 - f) * sin((1.0 - f) * 14.0 - uTime * 2.0);       // inward-travelling stripes

float foamSoft  = 1.0 - step(0.55 + n*0.30 - 0.15, f);
float foamSharp = step(0.65, (1.0 - smoothstep(0.0, uFoamDistance*0.22, waterDepth)) + n*0.25);
float foam = clamp(foamSoft*0.65 + foamSharp, 0.0, 1.0);
waterCol = mix(waterCol, uFoamColor, foam * edge);
```

Sources: [Alexander Ameye](https://ameye.dev/notes/stylized-water-shader), [Harry Alisavakis](https://halisavakis.com/my-take-on-shaders-stylized-water-shader/).

### 4.4 Ripples: scrolling normals vs flow maps

**Ocean → scrolling primes.** `Water.js` sums four samples at prime-ratio scales; the prime denominators are what kill visible looping ([Water.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water.js)):

```glsl
vec2 uv0 = (uv/103.0) + vec2(time/17.0, time/29.0);
vec2 uv1 =  uv/107.0  - vec2(time/-19.0, time/31.0);
vec2 uv2 =  uv/vec2(8907.0,9803.0) + vec2(time/101.0, time/97.0);
vec2 uv3 =  uv/vec2(1091.0,1027.0) - vec2(time/109.0, time/-113.0);
vec4 noise = texture2D(normalSampler,uv0)+texture2D(normalSampler,uv1)
           + texture2D(normalSampler,uv2)+texture2D(normalSampler,uv3);
vec3 surfaceNormal = normalize((noise*0.5-1.0).xzy * vec3(1.5,1.0,1.5));
```

The ocean example uses `textureWidth/Height: 512, waterColor: 0x001e0f, distortionScale: 3.7`.

**Rivers → flow maps.** RG stores direction, neutral `(0.5,0.5)`, decode `flow = rg*2-1`; must be sampled **linear, not sRGB** ([VFXDoc](https://vfxdoc.readthedocs.io/en/latest/articles/flowmaps/)). The two-phase cycling trick prevents "the texture coordinates becom[ing] so distorted that the normal maps will be stretched" ([Graphics Runner](http://graphicsrunner.blogspot.com/2010/08/water-using-flow-maps.html)), and [`Water2.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js) already implements it:

```js
// cycle = 0.15, halfCycle = 0.075
config.value.x += flowSpeed * delta;
config.value.y  = config.value.x + halfCycle;
if (config.value.x >= cycle) { config.value.x = 0; config.value.y = halfCycle; }
else if (config.value.y >= cycle) { config.value.y -= cycle; }
```
```glsl
vec4 n0 = texture2D(tNormalMap0, vUv*config.w + flow*config.x);
vec4 n1 = texture2D(tNormalMap1, vUv*config.w + flow*config.y);
float flowLerp = abs(config.z - config.x) / config.z;      // triangle wave 1→0→1
vec4 normalColor = mix(n0, n1, flowLerp);
vec3 normal = normalize(vec3(normalColor.r*2.0-1.0, normalColor.b, normalColor.g*2.0-1.0));
```
Note the **`.r,.b,.g` swizzle** — `Water2` uses Z-up unpacking because the plane lies in XZ.

**Bake the river flow map from your polyline** in the same loop that builds the ribbon: `flowRG = dTangent.xz * 0.5 + 0.5`.

### 4.5 Toon + cartographic water

```glsl
vec3 N = surfaceNormal, V = normalize(uEye - vWorldPos), L = normalize(uSunDir);
float spec = pow(max(dot(N, normalize(L+V)), 0.0), uShininess);   // 64..256
spec = smoothstep(uSpecCut - 0.02, uSpecCut + 0.02, spec);        // cel step, uSpecCut ~0.55
spec *= step(0.45, n);                                            // break the blob into sparkles

float rim = (1.0 - smoothstep(0.0, uRimWidth, waterDepth))
          * pow(1.0 - max(dot(N,V),0.0), 1.5);

float ink = texture2D(tInkRipples, vWorldPos.xz*0.05 + vec2(uTime*0.006,0.0)).r;
float lines = step(0.72, ink) * (1.0 - t);                        // drawn ripples, shallow only

// CARTOGRAPHIC: world-space parchment that does NOT swim with the ripples.
// This is the trick that sells "map".
vec3 parchment = texture2D(tOceanPaper, vWorldPos.xz * uPaperScale).rgb;
waterCol *= mix(vec3(1.0), parchment, uPaperAmount);               // 0.25..0.5
```

For **drawn coastline strokes**, don't do it in the water shader — generate the coastline as a ribbon from the marching-squares contour of the heightmap at sea level (or use the terrain-shader coastline from §2.5d), so ink stays clean and controllable through zoom.

### 4.6 Reflections — use the fake

| Option | Cost | Verdict |
|---|---|---|
| `CubeCamera` + `WebGLCubeRenderTarget` | 6 full scene renders per update | Only if baked once, or one face per frame |
| `Reflector` / `Water.js` mirror | **1 extra full scene render**; +25–40% at 512², +40–100% at 1024². Uses [Lengyel oblique near-plane clipping](http://www.terathon.com/lengyel/Lengyel-Oblique.pdf) | Hero close-ups only, gated on camera distance |
| `SSRPass` | 4–8 ms, needs depth+normal prepass, **smears at grazing angles** | **Avoid** — grazing is exactly a map camera's angle |
| **Fake: sky gradient × Schlick fresnel** | ~0 ms | **Recommended** |

```glsl
float schlick(vec3 N, vec3 V, float F0) {   // F0 = 0.02 for water
  return F0 + (1.0-F0) * pow(1.0 - max(dot(N,V), 0.0), 5.0);
}
vec3 skyRefl = skyGradient(reflect(-V, N));      // the SAME function the skybox uses
col = mix(col, skyRefl, schlick(N,V,0.02) * uReflectAmount);   // 0.35..0.6
```

Sharing `skyGradient()` between sky, water, and fog is what makes the reflection *free* and coherent.

### 4.7 Rivers as ribbon meshes

```ts
function buildRiverRibbon(nodes: RiverNode[], sampleHeight: (x:number,z:number)=>number,
  opts = { samples: 256, widthPerOrder: 0.9, minWidth: 0.6, uvTileLength: 12, yEpsilon: 0.08 }) {
  // centripetal Catmull-Rom avoids cusps on tight meanders
  const curve = new THREE.CatmullRomCurve3(nodes.map(n=>n.pos), false, 'centripetal', 0.5);
  const P = curve.getSpacedPoints(opts.samples);      // ARC-LENGTH uniform — critical
  const UP = new THREE.Vector3(0,1,0);
  const pos:number[]=[], uv:number[]=[], idx:number[]=[]; let arc = 0;

  for (let i = 0; i <= opts.samples; i++) {
    const p = P[i], prev = P[Math.max(i-1,0)], next = P[Math.min(i+1,opts.samples)];
    if (i > 0) arc += p.distanceTo(prev);
    const dA = new THREE.Vector3().subVectors(p,prev).setY(0).normalize();
    const dB = new THREE.Vector3().subVectors(next,p).setY(0).normalize();
    const nA = new THREE.Vector3().crossVectors(UP,dA).normalize();
    const nB = new THREE.Vector3().crossVectors(UP,dB).normalize();
    const m  = new THREE.Vector3().addVectors(nA,nB).normalize();
    const miter = Math.min(1/Math.max(m.dot(nB), 0.25), 4.0);      // clamp or you get hairpin spikes
    const order = nodes[Math.min(Math.floor(i/opts.samples*(nodes.length-1)), nodes.length-1)].order;
    const halfW = 0.5 * Math.max(opts.minWidth, opts.widthPerOrder*Math.sqrt(order)) * miter;
    for (const s of [-1, 1]) {
      const x = p.x + m.x*halfW*s, z = p.z + m.z*halfW*s;
      pos.push(x, sampleHeight(x,z) + opts.yEpsilon, z);
      uv.push(s*0.5+0.5, arc / opts.uvTileLength);                 // UV.y = arc length → scrolls downstream
    }
    if (i > 0) { const a = (i-1)*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
  }
  /* build BufferGeometry */
}
```

Four points that matter:
- **`getSpacedPoints`, not `getPoints`.** Catmull-Rom isn't arc-length parameterised; unequal spacing makes `UV.y` and therefore scroll speed non-uniform.
- **Miter clamp at ~4×**, else hairpins spike. Above the clamp, bevel instead.
- **Carve, don't float.** `yEpsilon` alone z-fights on steep banks. Before meshing, run `h = min(h, riverBedH + falloff)` over heightmap texels within `halfW*2.5` of the polyline. You get free banks for the foam band too.
- **Not `TubeGeometry`** for surface rivers — Frenet frames twist through inflection points and your normal map spins. Reserve it for 3D channels.

**Waterfalls:** split where `|dy/ds| > tan(35°)`, emit a vertical quad strip scrolling `UV.y` at 1.0–2.0 (vs ~0.1 for the river), wobble `uv.x += sin(uv.y*12.0 + t*3.0)*0.05` ([Cyanilux](https://www.cyanilux.com/tutorials/waterfall-shader-breakdown/)), foam mask at top and base. At the river mouth, fade river alpha to 0 over ~3 river-widths while the ocean foam band picks it up — the two overlap and the seam disappears.

---

## 5. ATMOSPHERE

### 5.1 Sky — use a gradient, not Preetham

[`Sky.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js) is Preetham on a `BackSide` box scaled to 10000. Defaults: `turbidity 2, rayleigh 1, mieCoefficient 0.005, mieDirectionalG 0.8`. Warm painterly preset: `turbidity 8–14`, **`rayleigh 1.2–2.0` (lower = warmer — the best "illustrated" knob)**, `mieCoefficient 0.012–0.030`, sun elevation 4°–12°, `toneMappingExposure 0.35–0.6`.

Preetham's concrete limitations: luminance-only fit valid **only for a ground observer** ([Scratchapixel](https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky.html)); no ground albedo and no multiple scattering, so the horizon is too dark and too saturated; breaks below the horizon (Sky.js hacks it with `vSunfade` and an `EE = 1000.0` cutoff at `cutoffAngle = 1.611`); absolute units entirely dependent on your tonemapper; and being a `BackSide` box it must be excluded from depth prepasses and Reflector passes. Hosek-Wilkie fixes horizon behaviour and adds ground albedo but costs a per-frame CPU coefficient fit.

**For a stylized map, use a 3-stop gradient** — ~10 ALU, art-directable, palette-matchable to your parchment:

```glsl
vec3 skyGradient(vec3 d) {
  float t  = smoothstep(-0.02, 0.42, d.y);
  vec3 sky = mix(uHorizon, uZenith, pow(t, uZenithBias));            // uZenithBias 0.6..1.4
  sky      = mix(uGround, sky, smoothstep(-0.12, 0.0, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  sky += uSunColor * pow(sd, 420.0) * 3.0;                            // disc
  sky += uSunColor * pow(sd, 6.0) * 0.22 * (1.0 - t);                 // horizon bloom — sells sunset
  return sky;
}
```

Make this a shared GLSL function used by the sky dome, the water's fake reflection, and the fog colour. That coherence is most of the "one painting" effect.

### 5.2 Sun position → one LUT drives everything

Cheap parameterisation (what `webgl_shaders_ocean` does):
```ts
sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevationDeg),
                                 THREE.MathUtils.degToRad(azimuthDeg));
```
Real solar position via [NOAA equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF) if you want a plausible in-world calendar.

**The highest-leverage system in this document:** build a **256×4 gradient LUT PNG** (row 0 = sun colour, 1 = ambient, 2 = fog, 3 = horizon), indexed by `u = saturate(sunDir.y*0.5 + 0.5)` so `u = 0.5` is sunrise/sunset and golden hour gets a dense region. Decode once per frame:

```ts
function applyTimeOfDay(sunDir: THREE.Vector3) {
  const u = Math.round(THREE.MathUtils.clamp(sunDir.y*0.5 + 0.5, 0, 1) * 255);
  const px = (r: number) => { const i = (r*256 + u)*4;
    return new THREE.Color(lut[i]/255, lut[i+1]/255, lut[i+2]/255).convertSRGBToLinear(); };
  dirLight.color.copy(px(0));
  dirLight.intensity = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.18) * 3.0;
  dirLight.position.copy(sunDir).multiplyScalar(500);
  hemi.color.copy(px(1)); hemi.groundColor.copy(px(3));
  (scene.fog as THREE.FogExp2).color.copy(px(2));
  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uHorizon.value.copy(px(3));
  skyMat.uniforms.uSunColor.value.copy(px(0));
  waterMat.uniforms.uSunDir.value.copy(sunDir);
}
```

One texture edit re-times the entire world.

### 5.3 Fog — and why three.js's is flat

`THREE.Fog` → `smoothstep(near, far, vFogDepth)`. `THREE.FogExp2` → `1 - exp(-density² · depth²)` (note it's density² *and* depth² — squared-exponential, not Beer-Lambert). **The gotcha:** in every three.js material the chunk order is `<tonemapping_fragment>` → `<colorspace_fragment>` → `<fog_fragment>`, so **fog is mixed in output sRGB space, after tonemapping**. That's exactly why three.js fog looks flat and washes highlights. Do it yourself, before tonemapping.

Exponential height fog, the analytic integral from [IQ's "Better Fog"](https://iquilezles.org/articles/fog/):

```glsl
vec3 applyHeightFog(vec3 col, vec3 ro, vec3 rd, float t, vec3 fogCol) {
  float ry = rd.y, fogAmount;
  if (abs(ry) < 1e-4) fogAmount = uFogA * exp(-ro.y*uFogB) * t;          // analytic limit
  else fogAmount = (uFogA/uFogB) * exp(-ro.y*uFogB) * (1.0 - exp(-t*ry*uFogB)) / ry;
  return mix(col, fogCol, 1.0 - exp(-fogAmount));
}
```
**Guard `ry ≈ 0`** — a near-horizontal map camera hits it constantly and you get NaN bands.

### 5.4 Aerial perspective — the biggest single contributor to the painterly look

Two ideas combined: IQ's sun-direction fog tint, and **per-channel densities** so blue thickens first. A single fog colour cannot express the real deep-blue → pale-blue → white progression of distant mountains ([runevision](https://blog.runevision.com/2025/06/notes-on-atmospheric-perspective-and.html)).

```glsl
uniform vec3  uAerialDensity;   // vec3(0.0021, 0.0026, 0.0035) — blue thickens first
uniform float uDesat;           // 0.55
uniform float uLiftBlacks;      // 0.25

vec3 aerialPerspective(vec3 col, float dist, vec3 rd, vec3 sunDir, vec3 sunCol) {
  vec3 f = 1.0 - exp(-dist * uAerialDensity);
  vec3 fogCol = skyGradient(rd);                                  // SAME function as the sky
  fogCol = mix(fogCol, sunCol, pow(max(dot(rd,sunDir),0.0), 8.0) * 0.85);
  float k = max(max(f.r, f.g), f.b);
  col = mix(col, vec3(dot(col, vec3(0.2126,0.7152,0.0722))), k * uDesat);
  col = mix(col, col*(1.0-uLiftBlacks) + fogCol*uLiftBlacks, k);   // lift blacks / kill contrast
  return mix(col, fogCol, f);
}
```

Inject by replacing `#include <tonemapping_fragment>` with your call *followed by* the original include.

### 5.5 God rays — use mesh shafts

three.js's [`GodRaysShader.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/shaders/GodRaysShader.js) does 3 passes × 6 taps with step sizes `1.0, 1/6, 1/36` — an effective **216-sample ray for 18 fetches** — at `godrayRenderTargetResolutionMultiplier = 1/4` (480×270 at 1080p). Total ~0.5–1.2 ms.

But **for a map view use mesh shafts instead**: a cone or 3–5 crossed quads from the sun, `AdditiveBlending`, `depthWrite: false`, with soft-particle depth fade so they don't cut into terrain ([NVIDIA](https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf)):

```glsl
#include <packing>
float sceneZ = perspectiveDepthToViewZ(texture2D(tDepth, gl_FragCoord.xy/uResolution).x, uNear, uFar);
float soft = clamp((vViewZ - sceneZ) / uSoftness, 0.0, 1.0);              // uSoftness ~4.0
float rim  = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), 1.6);
float fall = 1.0 - vUv.y;
gl_FragColor = vec4(uShaftColor * uIntensity * soft * rim * fall * fall, 1.0);
```

**~0.1 ms, fully art-directable, and it works when the sun is offscreen** — which the radial-blur version cannot do.

### 5.6 Clouds — do the shadows, skip the volumetrics

- **Billboards:** one `InstancedMesh` of camera-facing quads (billboard in the VS so you keep instancing), `depthWrite: false`, soft-particle fade, sorted back-to-front. 300–800 quads ≈ 0.4–1.0 ms at 1080p if overdraw stays under ~4×.
- **Raymarched:** [Maxime Heckel's parameters](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) — `MAX_STEPS 50, MAX_STEPS_LIGHTS 6, MARCH_SIZE 0.16, ABSORPTION 0.9`, dithered start via blue noise. **3–8 ms at 960×540 on a GTX 1060.** Budget-breaking. High-quality toggle only.
- **Cloud shadows on terrain — do this one.** Two fetches, ~0.05 ms, and it does more for atmosphere than everything else combined.

```glsl
float cloudShadow(vec3 worldPos) {
  // Walk from the surface up the sun ray to a virtual cloud plane, then read XZ.
  // This is what gives the correct oblique offset at low sun — with no shadow map.
  float t = (uCloudPlaneY - worldPos.y) / max(uSunDir.y, 0.15);
  vec2 uv = (worldPos.xz + uSunDir.xz * t) * uCloudScale + uCloudWind * uTime * uCloudScale;
  float n  = texture2D(tCloudNoise, uv).r;
  float n2 = texture2D(tCloudNoise, uv*2.17 + vec2(0.37,-0.21)).r;    // non-integer 2nd octave
  n = n*0.62 + n2*0.38;
  return mix(1.0 - uCloudStrength, 1.0, smoothstep(uCloudCover, uCloudCover + 0.22, n));
}
```

Inject so it multiplies **direct light only** — that's what keeps shadowed ground from going muddy:

```ts
shader.fragmentShader = shader.fragmentShader
  .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    float cs = cloudShadow(vWorldPosCS);
    reflectedLight.directDiffuse  *= cs;
    reflectedLight.directSpecular *= cs;`);
```

Feed the same noise + wind into the water shader's specular and shadows sweep the ocean too.

### 5.7 What actually gives FlowScape its mood

**Documented, in the dev's own words:**
- **DOF is a depth-buffer post effect and he says so:** *"In realtime engines, this is a trick, where it will make a greyscale image from front to the back of the scene (depthmap) and use that to blur different objects. Its not perfect and has artifacts, especially with anti aliasing"* ([Steam thread](https://steamcommunity.com/app/1043390/discussions/0/1636416951447722282/)). Users get **Camera FOV, Aperture, Focus Distance**. Wide-aperture DOF on a foreground element is FlowScape's #1 signature.
- **"Colored fog and sun shafts"** ([Aug 1 2019 devlog](https://pixelforest.itch.io/flowscape/devlog)) — "sun shafts" is verbatim Unity Standard Assets naming.
- **"Oceans and Volumetric Fog"** (Sep 15 2019); **"Sun lines up with the reflection"** (Sep 19 2019) — a real view-dependent specular, not a static cubemap.
- **Ambient Occlusion** that "darken[s] the corner light, add[s] contrast" ([Fox Render Farm](https://www.foxrenderfarm.com/share/Function-Introduction-of-3D-Landscape-Creation-Tool-Flowscape/)).
- **Skies are image-based**: 24 skyboxes + Sky Rotation, plus a Sun/Moon toggle with direction and height sliders ([Steam](https://store.steampowered.com/app/1043390/FlowScape/)). Not a procedural atmosphere.
- Water exposes a **Fresnel** slider directly. 300+ models, 24 4K terrain textures, DirectX 11, 1–4 GB VRAM. An **"Adaptive quality"** toggle.

**Inferred (high confidence):** Unity built-in RP + Post Processing Stack v2 — the effect names, DX11-only, and 1 GB VRAM floor all point there. Chain is almost certainly AO → bloom → DOF → colour grading LUT → vignette → tonemap, with **bloom set aggressively high** (that soft glow on every highlight is the second signature after DOF). Vegetation is alpha-tested cross-planes and billboards, not real geometry — which is why 300+ models run on 1 GB. One directional light + ambient, no baked GI. AA is post-process, which is precisely why it fights the depth-based DOF.

**Steal, in priority order:** (1) heavy bloom on a *small number* of deliberately bright elements; (2) strong aerial perspective + coloured fog keyed to sun direction; (3) cloud shadows sweeping the terrain; (4) subtle DOF blurring only extreme foreground and far background; (5) mesh light shafts. **Explicitly skip:** raymarched clouds, SSR, per-frame planar reflections.

---

## 6. NPR POST-PROCESSING

### 6.1 Composer setup and the colour rule

The r152+ rule: **all intermediate targets stay Linear-sRGB; conversion to display sRGB happens exactly once, in `OutputPass`, at the end** ([Color Management](https://threejs.org/manual/en/color-management.html)). The docs note that "if a pass requires sRGB input (e.g. like FXAA), the pass must follow OutputPass" ([OutputPass.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/postprocessing/OutputPass.js)).

```ts
const renderer = new THREE.WebGLRenderer({
  antialias: false,            // MSAA is wasted — post reads a texture, not the default FB
  powerPreference: 'high-performance', stencil: false, alpha: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // or NeutralToneMapping for a flatter map look
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  colorSpace: THREE.LinearSRGBColorSpace, samples: 0, depthBuffer: true,
});
const composer = new EffectComposer(renderer, rt);
```

### 6.2 Pass order — and why

```
1  RenderPass                        (scene → linear HDR)
2  G-buffer (MRT: viewNormal + linear depth)
3  GTAOPass
4  Anisotropic Kuwahara              (HALF RES: tensor → blurH → blurV → filter → upsample)
5  UnrealBloomPass
6  Ink/outline composite             (reads G-buffer + colour)
7  Tilt-shift
8  LUTPass
9  OutputPass                        (tone map + linear→sRGB, ONE conversion)
10 SMAAPass                          (needs sRGB input → after OutputPass)
11 Paper + grain + vignette + CA     (one merged sRGB pass, 1:1 pixels, last)
```

- **AO before Kuwahara.** Kuwahara turns AO into painterly dirt in the crevices — exactly the inked wash you want. Reversed, Kuwahara's flat regions defeat GTAO's normal-derived horizon search.
- **Kuwahara before outlines, unconditionally.** Kuwahara is variance-*minimising*: a 1–2 px dark ink line inside the kernel is a maximum-variance feature and the filter **discards the sector containing it**. Ink drawn before Kuwahara is erased or smeared into mush. Your edges come from depth+normals, so Kuwahara never touches the edge signal.
- **Bloom before ink.** Bloom applied after the composite bleeds bright terrain over lines and erodes them. Legibility wins.
- **DOF after ink** — distant coastlines *should* lose their ink weight; that's the diorama trick. Sharp lines over blurred terrain read as a UI overlay, not a drawing.
- **AA last.** Note pmndrs sequences AA early ([Effect Merging](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging)); for an ink pipeline that's wrong, because the 1 px ink is generated after their SMAA slot and never gets antialiased.
- **Paper absolutely last.** Any pass after it resamples fibre into grey mush. Real map paper is *in front of* the ink.

### 6.3 Kuwahara — the expensive one

Basic 4-quadrant costs `4(r+1)²` samples and quantises orientation to 90° (visible blockiness). Generalized (Papari) uses 8 Gaussian-weighted sectors and a soft weighted blend `wᵢ = 1/(1 + (hardness·σᵢ²)^(q/2))`, removing sector-switch flicker. **Anisotropic** (Kyprianidis) deforms the disc to an ellipse aligned to the structure tensor with `a = ((α+A)/α)r, b = (α/(α+A))r` — so `a·b = r²` and **sample count is invariant to anisotropy, ≈ πr²** ([NPAR 2011](https://www.kyprianidis.com/p/npar2011/jkyprian-npar2011.pdf); paper params `q=8, w=0.02, σ_r=0.4, α≈1`).

Four `ShaderPass` stages. Stages 1–3 build the tensor field (Sobel 6 taps → separable Gaussian 11+11 taps → eigen-decompose):

```glsl
// stage 3: eigen-decomposition of the smoothed tensor (Jxx, Jyy, Jxy)
float disc = sqrt(g.y*g.y - 2.0*g.x*g.y + g.x*g.x + 4.0*g.z*g.z);
float lambda1 = 0.5*(g.y + g.x + disc);
float lambda2 = 0.5*(g.y + g.x - disc);
vec2  v = vec2(lambda1 - g.x, -g.z);
vec2  t = length(v) > 0.0 ? normalize(v) : vec2(0.0, 1.0);
float phi = -atan(t.y, t.x);
float A   = (lambda1 + lambda2 > 0.0) ? (lambda1 - lambda2)/(lambda1 + lambda2) : 0.0;
gl_FragColor = vec4(t, phi, A);     // TFM buffer
```

Stage 4, ported from [Acerola's `AnisotropicKuwahara.shader`](https://github.com/GarrettGunnell/Post-Processing/blob/main/Assets/Kuwahara%20Filter/AnisotropicKuwahara.shader):

```glsl
uniform sampler2D tDiffuse, tTFM;
uniform vec2 uTexel;
uniform float uAlpha, uZeta, uZeroCrossing, uHardness, uQ;   // 1.0, 0.1..2/r, 0.58, 8.0, 8.0
uniform int uKernelSize;
#define MAX_R 16

void main() {
  vec4 t = texture2D(tTFM, vUv);
  float r = float(uKernelSize) * 0.5;
  float a = r * clamp((uAlpha + t.w)/uAlpha, 0.1, 2.0);
  float b = r * clamp(uAlpha/(uAlpha + t.w), 0.1, 2.0);
  float cp = cos(t.z), sp = sin(t.z);
  mat2 SR = mat2(0.5/a, 0.0, 0.0, 0.5/b) * mat2(cp, sp, -sp, cp);
  int max_x = int(sqrt(a*a*cp*cp + b*b*sp*sp));
  int max_y = int(sqrt(a*a*sp*sp + b*b*cp*cp));
  float sinZC = sin(uZeroCrossing);
  float eta = (uZeta + cos(uZeroCrossing)) / (sinZC*sinZC);

  vec4 m[8]; vec3 s[8];
  for (int k=0;k<8;++k){ m[k]=vec4(0.0); s[k]=vec3(0.0); }

  for (int y=-MAX_R; y<=MAX_R; ++y) { if (y<-max_y||y>max_y) continue;
  for (int x=-MAX_R; x<=MAX_R; ++x) { if (x<-max_x||x>max_x) continue;
    vec2 v = SR * vec2(float(x), float(y));
    if (dot(v,v) > 0.25) continue;                          // outside ellipse
    vec3 c = clamp(texture2D(tDiffuse, vUv + vec2(float(x),float(y))*uTexel).rgb, 0.0, 1.0);
    float w[8]; float sum = 0.0; float z, vxx, vyy;
    vxx = uZeta - eta*v.x*v.x; vyy = uZeta - eta*v.y*v.y;
    z=max(0.0, v.y+vxx); w[0]=z*z; sum+=w[0];
    z=max(0.0,-v.x+vyy); w[2]=z*z; sum+=w[2];
    z=max(0.0,-v.y+vxx); w[4]=z*z; sum+=w[4];
    z=max(0.0, v.x+vyy); w[6]=z*z; sum+=w[6];
    v = 0.7071067 * vec2(v.x - v.y, v.x + v.y);             // rotate 45° for odd sectors
    vxx = uZeta - eta*v.x*v.x; vyy = uZeta - eta*v.y*v.y;
    z=max(0.0, v.y+vxx); w[1]=z*z; sum+=w[1];
    z=max(0.0,-v.x+vyy); w[3]=z*z; sum+=w[3];
    z=max(0.0,-v.y+vxx); w[5]=z*z; sum+=w[5];
    z=max(0.0, v.x+vyy); w[7]=z*z; sum+=w[7];
    float g = exp(-3.125*dot(v,v)) / sum;
    for (int k=0;k<8;++k){ float wk = w[k]*g; m[k] += vec4(c*wk, wk); s[k] += c*c*wk; }
  }}

  vec4 outCol = vec4(0.0);
  for (int k=0;k<8;++k) {
    m[k].rgb /= m[k].w;
    s[k] = abs(s[k]/m[k].w - m[k].rgb*m[k].rgb);
    float wgt = 1.0/(1.0 + pow(uHardness*1000.0*(s[k].r+s[k].g+s[k].b), 0.5*uQ));
    outCol += vec4(m[k].rgb*wgt, wgt);
  }
  gl_FragColor = vec4(clamp(outCol.rgb/outCol.w, 0.0, 1.0), 1.0);
}
```

**Cost — this is the number that decides your architecture:**

| r | samples/px | worst-case iters/px | ALU/px | 1080p | 1440p |
|---|---|---|---|---|---|
| 4 | 50 | 289 | ~5,000 | 10.4 GOP | 18.4 GOP |
| **6** | **113** | **625** | **~11,300** | **23.4 GOP** | **41.7 GOP** |
| 8 | 201 | 1089 | ~20,100 | 41.7 GOP | 74.1 GOP |

At r=6 **full res**: ~5–8 ms on a GTX 1660, 8–12 ms on M1, 15–25 ms on Iris Xe. **That alone blows the frame budget.**

**Non-negotiable mitigation: run the entire 4-stage chain at half resolution and bilinear-upsample** → 1.3–2.0 ms at 1080p on a 1660. Halve `r` too (r=3 at half res ≈ r=6 apparent) for another 4× → ~0.4 ms. Combined 16×. This is the single highest-leverage optimisation in the whole pipeline. The tensor stages can run at *quarter* res — orientation is a low-frequency field.

### 6.4 Edge detection on depth + normals

**G-buffer:** use MRT — `new THREE.WebGLRenderTarget(w, h, { count: 2, type: HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) })`, `rt.textures[0]` colour, `[1]` view normal. One geometry pass, **zero extra draw calls**. The alternative (`scene.overrideMaterial = new THREE.MeshNormalMaterial()`, which is what `GTAOPass` does internally) **doubles your draw calls** and silently drops alpha-tested foliage cutouts. If you're running `GTAOPass`, hand it your existing textures via `parameters.depthTexture` / `parameters.normalTexture` so it skips its own pass.

**Roberts cross beats Sobel here** — 4 taps vs 8, and for 1 px ink the response is indistinguishable ([Ameye](https://ameye.dev/notes/edge-detection-outlines/)):

```glsl
float robertsCross(vec3 s[4]) {
  vec3 d1 = s[1] - s[2], d2 = s[0] - s[3];
  return sqrt(dot(d1,d1) + dot(d2,d2));
}
```

**The grazing-angle problem:** a ground plane at a shallow angle has huge per-pixel depth deltas even though it's flat, so a fixed threshold paints the whole foreground black. Scale the threshold by how edge-on the surface is, and by depth so line density stays constant as you zoom ([Roystan](https://roystan.net/articles/outline-shader/)):

```glsl
float NdotV = 1.0 - dot(viewNormal, -viewSpaceDir);
float nt01  = clamp((NdotV - uDepthNormalThreshold)/(1.0 - uDepthNormalThreshold), 0.0, 1.0);
float depthThreshold = uDepthThreshold * depth0 * (nt01 * uDepthNormalThresholdScale + 1.0);
```
Values: `uDepthThreshold ≈ 1/200`, `uDepthNormalThreshold ≈ 0.5`, `uDepthNormalThresholdScale ≈ 7.0`, normal threshold `≈ 1/4`.

**`OutlinePass` vs a full-screen pass:** `OutlinePass` allocates ~7 render targets, does 8–10 fullscreen draws, and re-renders the scene twice ([OutlinePass.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/postprocessing/OutlinePass.js)). **Use it for hover/selection highlights on map pins, never for base ink** — a global Roberts pass is one draw at ~0.2 ms/1080p.

### 6.5 Making the line look inked

```glsl
vec2 wob = (texture2D(tNoise, vUv*uNoiseScale).rg - 0.5) * uWobble * uTexel;   // uWobble ≈ 2.5 px
float widthMod = 0.75 + 0.5 * texture2D(tNoise, vUv*uNoiseScale*0.23 + 0.37).b;
float e = edgeMagnitude(vUv + wob) * widthMod;
float fibre = texture2D(tPaper, gl_FragCoord.xy / uPaperSize).r;
float ink = smoothstep(uT0, uT1, e) * mix(1.0, fibre, uFibreBite);   // uFibreBite ≈ 0.55
ink = step(uDryBrush, ink) * ink;                                    // uDryBrush ≈ 0.18
vec3 inkColor = mix(vec3(0.14,0.10,0.08), vec3(0.26,0.19,0.13), fibre);   // NEVER pure black
gl_FragColor = vec4(mix(sceneColor, inkColor, ink * uInkStrength), 1.0);
```

### 6.6 Paper overlay — screen-space, and why

- **Screen-space (`gl_FragCoord.xy / uPaperSize`):** the paper is *the sheet you're looking at*; pan the camera and fibre stays put. Correct for "illustrated map" — the world moves behind the paper. Also the only option that keeps 1:1 pixel tiling.
- **World/triplanar:** paper crawls over mountains in perspective. Reads as *textured 3D model*, not drawing. Use only as faint terrain grain (§2.5e), never as the final overlay.

```glsl
vec3 blendOverlay(vec3 base, vec3 blend) {      // preserves darks and lights; fibre hits mid-tones
  return mix(2.0*base*blend, 1.0 - 2.0*(1.0-base)*(1.0-blend), step(0.5, base));
}
vec2 puv = gl_FragCoord.xy / uPaperSize;
gl_FragColor = vec4(mix(c, blendOverlay(c, texture2D(tPaper, puv).rgb), uPaperStrength), 1.0);
```

**The 1:1 rule:** `RepeatWrapping`, `generateMipmaps = false`, divide `gl_FragCoord` by the texture's *true* pixel size. Any scaling turns fibre into bilinear grey mush that reads as noise. 2048² tile at 1080p repeats less than once per axis.

### 6.7 Cross-hatching

Six tone levels packed into the RGB of **two** textures — 2 fetches instead of 6 ([Kyle Halladay](https://kylehalladay.com/blog/tutorial/2017/02/21/Pencil-Sketch-Effect.html)):

```glsl
vec3 hatching(vec2 uv, float intensity) {
  vec3 h0 = texture2D(tHatchA, uv).rgb, h1 = texture2D(tHatchB, uv).rgb;
  vec3 overbright = max(vec3(0.0), vec3(intensity - 1.0));
  vec3 wA = clamp(intensity*6.0 + vec3( 0.0,-1.0,-2.0), 0.0, 1.0);
  vec3 wB = clamp(intensity*6.0 + vec3(-3.0,-4.0,-5.0), 0.0, 1.0);
  wA.xy -= wA.yz; wA.z -= wB.x; wB.xy -= wB.yz;      // only 2 adjacent levels nonzero, sum = 1
  h0 *= wA; h1 *= wB;
  return overbright + h0.r+h0.g+h0.b + h1.r+h1.g+h1.b;
}
```
Apply **only where slope is steep** (`1.0 - viewNormal.z` from the G-buffer) → engraved mountains, clean plains. 2 taps + ~20 ALU, effectively free.

### 6.8 LUT, bloom, vignette

```ts
const lutPass = new LUTPass({ intensity: 0.85 });
new LUTCubeLoader().load('/luts/parchment_32.cube', (r) => { lutPass.lut = r.texture3D; });
```
`LUTPass` uses `sampler3D` (`Data3DTexture`) exclusively — no 2D-strip fallback. **32³ is right** (128 KB, indistinguishable from 64³ for stylised grading). Authoring: screenshot un-graded, grade over a Neutral LUT strip in Resolve/Lightroom, export `.cube`.

`UnrealBloomPass` runs **13 fullscreen draws** (1 high-pass + 5 mips × H/V + composite + blend, mip weights `[1.0, 0.8, 0.6, 0.4, 0.2]`), but mips sum to only ~1/3 of full res → **~0.6–1.0 ms at 1080p**. The 13 target binds cost more CPU than the fragments do. Painterly values: **`strength 0.35, radius 0.9, threshold 0.85`** — low strength + high radius = atmospheric haze, not sci-fi glow.

Merge vignette + grain + CA into one pass (3 taps + ~35 ALU ≈ 0.25 ms; as three separate `ShaderPass`es it's ~0.9 ms):

```glsl
vec2 d = vUv - 0.5; float r2 = dot(d,d);
vec2 off = d * r2 * uCA;                                        // uCA ≈ 0.010
vec3 c = vec3(texture2D(tDiffuse, vUv+off).r, texture2D(tDiffuse, vUv).g,
              texture2D(tDiffuse, vUv-off).b);
c *= mix(1.0, smoothstep(0.85, 0.28, length(d)*1.414), uVignette);   // smoothstep, not pow — no banding
float n = fract(sin(dot(vUv*uTime, vec2(12.9898,78.233)))*43758.5453);
float lum = dot(c, vec3(0.2126,0.7152,0.0722));
c += (n-0.5) * uGrain * (1.0 - abs(lum*2.0-1.0));               // luminance-weighted, shadows stay clean
```

### 6.9 Tilt-shift, not DOF

`BokehPass` **re-renders the entire scene** with `MeshDepthMaterial` — on a 900-call scene that's +900 draw calls, 4–6 ms CPU. pmndrs `DepthOfFieldEffect` is far better (CoC pass + Kawase blur, `resolutionScale: 0.5` default, reuses composer depth) at ~1.5–2.5 ms.

But **tilt-shift is both cheaper and more correct for a map**. A fantasy map is viewed from a fixed high oblique angle, so **screen-Y *is* depth** — the correlation is near-perfect and monotonic. Depth-driven DOF produces the same image while costing depth fetches and near/far-field separation. Tilt-shift additionally *is* the literal optical technique behind [miniature faking](https://en.wikipedia.org/wiki/Miniature_faking) — you get the diorama read by definition. And it never has the depth-discontinuity halo that would ruin your ink lines.

```glsl
float t = clamp((abs(vUv.y - uFocusY) - uBandWidth)/(1.0 - uBandWidth), 0.0, 1.0);
float blur = t * t * uMaxBlur;                                  // quadratic ramp
if (blur < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }   // early-out ~40% of screen
vec3 acc = vec3(0.0);
for (int i = 0; i < 13; ++i) acc += texture2D(tDiffuse, vUv + P[i]*blur*uTexel).rgb;  // 13-tap Poisson
gl_FragColor = vec4(acc / 13.0, 1.0);
```
**~0.2 ms real at 1080p — 7–10× cheaper than `DepthOfFieldEffect`.** (The `const vec2 P[13]` initialiser needs `THREE.GLSL3`; otherwise use a `uniform vec2 uPoisson[13]`.)

### 6.10 Use pmndrs/postprocessing — for the cheap effects

`EffectPass` merges its `Effect`s into **one** fragment shader chaining `mainImage()` calls in-register ([Effect Merging](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging)). One 1080p RGBA16F fullscreen pass moves 2.07 Mpx × 8 B × 2 = **33 MB**; on a 192 GB/s GTX 1660 that's ~0.28 ms real. Merging 6 trivial effects eliminates 5 round-trips:

- GTX 1660 @1080p: **save ~1.4 ms** (8.4% of frame)
- Apple M1 @1080p: **save ~2.8 ms** (17%)
- GTX 1660 @1440p: **save ~2.5 ms** (15%)

Plus 5 fewer FBO binds per frame (~0.05–0.1 ms each through ANGLE).

**Constraint:** only one *convolution* effect per `EffectPass`. So Kuwahara stays as dedicated passes — correct anyway.

```ts
class PaperEffect extends Effect {
  constructor(tex: Texture, strength = 0.45) {
    super('PaperEffect', paperFrag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.NONE,                     // no extra input taps → mergeable
      uniforms: new Map([
        ['uPaper', new Uniform(tex)],
        ['uPaperSize', new Uniform(new Vector2(tex.image.width, tex.image.height))],
        ['uStrength', new Uniform(strength)],
      ]),
    });
  }
}
composer.addPass(new EffectPass(camera, new SMAAEffect()));                     // convolution: own pass
composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 0.35 }))); // convolution: own pass
composer.addPass(new EffectPass(camera,                                         // ALL merged into ONE shader
  new TiltShiftEffect({ focusArea: 0.35, feather: 0.4, bias: 0.06 }),
  new LUT3DEffect(lut3D), new ToneMappingEffect(),
  new PaperEffect(paperTex, 0.45),
  new VignetteEffect({ darkness: 0.45, offset: 0.32 }),
  new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true }),
  new ChromaticAberrationEffect(),
));
```

---

## 7. CITY IN 3D

### 7.1 Footprint → geometry

`ExtrudeGeometry` calls `THREE.ShapeUtils.triangulateShape()` → `THREE.Earcut.triangulate()`. It **requires CCW outer / CW holes** and fails silently ("Probably Hole outside Shape!") on self-intersecting or duplicate-point rings — run dedupe + `ShapeUtils.isClockWise()` normalisation on every footprint first.

But `ExtrudeGeometry`'s default UVs are useless for tiling brick. **Write your own wall builder** — ~40 lines, giving arc-length UVs, correct outward normals, and a slot for per-vertex AO:

```ts
function buildWalls(ring: THREE.Vector2[], y0: number, y1: number, uvScale = 2.0) {
  const pos:number[]=[], nrm:number[]=[], uv:number[]=[], idx:number[]=[];
  let arc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i+1) % ring.length];
    const ex = b.x-a.x, ez = b.y-a.y, len = Math.hypot(ex, ez);
    if (len < 1e-5) continue;
    const nx = ez/len, nz = -ex/len;                    // outward normal for a CCW ring
    const u0 = arc/uvScale, u1 = (arc+len)/uvScale, v0 = y0/uvScale, v1 = y1/uvScale;
    const base = pos.length/3;
    pos.push(a.x,y0,a.y,  b.x,y0,b.y,  b.x,y1,b.y,  a.x,y1,a.y);
    for (let k=0;k<4;k++) nrm.push(nx, 0, nz);
    uv.push(u0,v0, u1,v0, u1,v1, u0,v1);
    idx.push(base,base+1,base+2, base,base+2,base+3);
    arc += len;
  }
  /* build BufferGeometry */
}
```

Because `u` is **cumulative arc length in world metres / uvScale**, brick tiles at a constant real-world size on every wall regardless of footprint shape. Snap the final `arc` to `Math.round(arc/uvScale)*uvScale` to kill the wrap seam.

### 7.2 Roofs

- **Flat/parapet:** `ShapeUtils.triangulateShape()` cap at `y = h` + a 0.3 m band above.
- **Pyramid:** centroid apex, fan `[i, i+1, apex]`. One line, reads great on towers.
- **Gable:** minimum-area bounding rectangle (rotating calipers over the convex hull, ~30 lines), ridge down the long axis, two sloped quads + two gable ends. **Covers 90% of medieval houses, which are rectangles.**
- **Hip (correct):** straight skeleton — offset every edge inward at a uniform rate, lift by `offset·tan(pitch)`. [`straight-skeleton`](https://github.com/StrandedKitty/straight-skeleton) (CGAL→Wasm, handles holes, needs `await SkeletonBuilder.init()`). Robust but slow — **bake it offline**.
- **Hip (cheap substitute, recommended):** inset the ring by `d` with clipper-lib, lift by `d·tan(pitch)`. Exact for convex, fine for mildly concave, degenerate for spiky — detect via offset-ring area > 0 and fall back to pyramid. **A 5,000-building stylized city does not need mathematically correct hips.**

### 7.3 Batching 5,000 buildings

Stylized medieval building ≈ 150–350 tris (call it 300). 5,000 × 300 = **1.5 M tris**.

| Strategy | Draw calls | VRAM | Per-building variation | Culling |
|---|---|---|---|---|
| One Mesh each | **5,000** ❌ | — | total | per building |
| `mergeGeometries()`, whole city | 1 | ~66 MB | total | **none** ❌ |
| **`mergeGeometries()` per district (~80 bldgs)** | **~63** ✅ | ~66 MB | **total, incl. baked vertex AO** | **per district** ✅ |
| `InstancedMesh`, 20 archetypes | 20 ✅ | ~2 MB | colour only | per archetype ❌ |
| `BatchedMesh`, 20 geometries | 1 ✅ | ~2 MB | colour + `setVisibleAt` | **per instance** ✅ |

**Recommendation: merge per district.** ~63 calls is well inside budget, you get **per-vertex baked AO** (the biggest visual win, impossible with instancing), and district-granularity culling is exactly right. Use `mergeGeometries(geoms, false)` with one `vertexColors: true` material; verify with `BufferGeometryUtils.estimateBytesUsed()`.

Use `BatchedMesh` instead only if buildings appear/disappear at runtime (construction, editor mode). Use `InstancedMesh` for repeated props — barrels, carts, lamp posts, wall towers.

### 7.4 Lighting stylized buildings

Since r155 three.js uses physical light units, so intensities are higher than old tutorials suggest:

```ts
const sun  = new THREE.DirectionalLight(0xfff0d0, 3.0);            // warm key
sun.position.set(-60, 90, 40); sun.castShadow = true;
const hemi = new THREE.HemisphereLight(0x9fc8ff, 0xd9b48a, 1.6);   // cool sky / bounced ground
```
`HemisphereLight` is the classic stylized 2-tone rig — sky colour on roofs, ground colour on eaves and under-arches, readable form at zero shadow cost.

**Baked AO in vertex colours** — the two effects that actually sell stylized architecture are **cavity darkening where walls meet ground** and **streets darkening between tall buildings**:

```ts
function vertexAO(v: THREE.Vector3): number {
  const contact = THREE.MathUtils.smoothstep(v.y, 0.0, 2.5);
  let occ = 0, n = 0;
  for (let r = 2; r <= 12; r += 2) for (let a = 0; a < 8; a++) {
    const th = a/8 * Math.PI * 2;
    const hh = sampleHeightGrid(v.x + Math.cos(th)*r, v.z + Math.sin(th)*r);   // 2 m city height field
    occ += THREE.MathUtils.clamp((hh - v.y)/r, 0, 1) * (1/r);
    n += 1/r;
  }
  return THREE.MathUtils.clamp((0.55 + 0.45*contact) * (1.0 - 0.75*(occ/n)), 0.25, 1.0);
}
```
~50 ms for 5,000 buildings at generation time. Higher quality: [`geo-ambient-occlusion`](https://github.com/wwwtyro/geo-ambient-occlusion), run offline per district and cached.

**Rim light** (makes buildings pop against fog): `outgoingLight += uRimColor * pow(1.0 - max(dot(viewNormal, vec3(0,0,1)), 0.0), 3.0) * 0.35;`

**Emissive windows at night:** don't use per-window emissive materials. Build a *second* merged geometry of window quads offset 2 cm from the wall, `MeshBasicMaterial({ vertexColors: true, toneMapped: false })`, warm orange ±30% brightness, ~15% dark. Because `toneMapped = false` pushes those pixels above 1.0, **only the windows bloom** under a `threshold 0.9` bloom pass. One merged mesh, one draw call, one boolean to fade with the day/night cycle.

### 7.5 City LOD

| Distance | Representation | Tris |
|---|---|---|
| 0–150 m | Full district merge (walls, roofs, chimneys, windows) | ~300/bldg |
| 150–400 m | Merge without props/windows, roof → 4 tris | ~60/bldg |
| 400–1200 m | **Town blob**: one extruded silhouette per district at median height + roof-coloured cap | ~200/district |
| >1200 m | One camera-facing textured quad per town (bake the blob to a 512² atlas at load) | 2 |

Districts *are* per-object, so the built-in `THREE.LOD` works here:
```ts
district.addLevel(fullMesh, 0, 0.15);      // hysteresis 15% kills boundary flicker
district.addLevel(midMesh, 150, 0.15);
district.addLevel(blobMesh, 400, 0.15);
district.addLevel(impostor, 1200, 0.15);
```

**Switch on projected size, not a magic distance** — a fantasy-map camera zooms a lot. Swap when the town projects below ~120 px: `screenPx = (worldWidth/distance) * (viewportHeight / (2·tan(fov/2)))`; solve for distance and the thresholds adapt to any FOV/resolution automatically.

---

## 8. PERFORMANCE BUDGET

### 8.1 The real frame budget

60 fps = 16.67 ms wall clock, but Chromium's compositor takes a cut. **Budget 13.5–14 ms of actual work**, leaving ~2.5 ms for compositing, GC, and the Electron main-process tick. On Windows, ANGLE→D3D11 re-validates and re-emits state per draw, adding roughly **20–40% CPU per draw call** vs native GL.

Targets on **GTX 1660 / RTX 3050 @1080p**: 3.5–4.5 ms geometry+shadows, 4–5 ms post, 2 ms CPU, ~2 ms slack. **M1/M2** is bandwidth-bound (68–100 GB/s unified) — halve the full-res post budget, go half-res everywhere. **Iris Xe** is the floor: assume 1.5–2× M1 cost; ship a tier that drops Kuwahara to quarter-res r=3 and disables bloom mips 3–4.

```ts
// main process, BEFORE app.whenReady()
app.commandLine.appendSwitch('use-angle', 'd3d11');   // 'gl'|'d3d11'|'d3d11on12'|'vulkan'|'metal'
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force_high_performance_gpu');
// dev only: app.commandLine.appendSwitch('disable-frame-rate-limit');
```

Backend names are from Chromium's [`gl_switches.cc`](https://chromium.googlesource.com/chromium/src/+/main/ui/gl/gl_switches.cc). **Ship `d3d11` as default with a `gl` opt-in.** `gl` sometimes wins on NVIDIA for shader-heavy fragment work (no HLSL round-trip) but breaks on many Intel drivers. **Measure your Kuwahara shader both ways** — a 200-tap unrolled loop is exactly where the HLSL translator's register allocation falls off a cliff.

### 8.2 Concrete budgets

| Resource | Safe | Ceiling | Note |
|---|---|---|---|
| Draw calls | **< 150** | 400 | ~8–20 µs CPU each through ANGLE; 400 calls ≈ 3.2–8 ms of **pure CPU**. [Above 500 "even powerful GPUs struggle"](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| Triangles | 1.5 M | 4 M | 1660 chews 4 M in ~1.5 ms — you hit the draw-call wall first |
| Texture VRAM | 400 MB | 900 MB | Iris Xe shares system RAM; budget 350 MB |
| Render-target VRAM | 60 MB | 120 MB | 1080p RGBA16F = 16.6 MB each; composer 2 + G-buffer 2 + depth + bloom mips + Kuwahara ×4 ≈ 95 MB. **At 1440p that's 170 MB** |
| Shader programs | < 60 | 120 | Each first-use compile is a 20–150 ms stall |

### 8.3 Top 5 framerate killers, ranked

1. **Full-screen post at native res — specifically Kuwahara.** By a wide margin. r=6 @1080p = 23.4 GOP/frame, 5–8 ms on a 1660, 15–25 ms on Iris Xe. Fix: half-res + halved radius (16×), plus pmndrs merging (another 1.4–2.8 ms). **Recovery: 6–10 ms.**
2. **Unbatched draw calls from scattered props.** 3,000 `Mesh` objects = 24–60 ms of CPU alone. `InstancedMesh` per type takes it to ~20. One cited real case went **9,000 → 300 calls (−97%)**. **Recovery: 10–40 ms.**
3. **Shadow maps.** `calls += casters × cascades`. A shadowed `PointLight` costs `objects × 6`; two of them over 10 objects = **+120 draw calls**. Fix: one `DirectionalLight`, 2048² desktop / 1024² fallback, 1–2 cascades, tightly fitted camera, and `shadow.autoUpdate = false` — a static-sun map makes shadows **free after frame 1**. **Recovery: 2–6 ms.**
4. **Overdraw from alpha-tested foliage + transparent water.** Alpha-test disables early-Z on ANGLE's D3D path; canopy easily hits 8–12× overdraw. Fix: tighten foliage cards to the actual silhouette (−40% overdraw), render opaque front-to-back, `alphaTest` over `transparent: true`, single water layer. **Recovery: 1.5–4 ms.**
5. **Large uncompressed textures + JS GC.** `uncompressedSize = w × h × 4 × 1.333` — **a 2048² RGBA8 texture is 22.4 MB of VRAM regardless of its 200 KB PNG size** ([Don McCurdy](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)). Thirty of those = 672 MB. GC: `new Vector3()` per frame across 500 objects = 30 k allocations/s → a 5–15 ms major GC spike every few seconds.

**Honourable mention: shader recompilation stalls.** Each new material/light-count/define combination triggers a 20–150 ms ANGLE compile **on the main thread**. Warm everything at load with `renderer.compileAsync(scene, camera)` (uses `KHR_parallel_shader_compile`) and watch `renderer.info.programs.length` stop growing.

### 8.4 Diagnostics

```ts
hud.textContent =
  `calls ${info.render.calls}  tris ${(info.render.triangles/1000).toFixed(0)}k  ` +
  `progs ${info.programs?.length ?? 0}  geo ${info.memory.geometries}  tex ${info.memory.textures}  ` +
  `gpu ${gpuMs.toFixed(2)}ms  cpu ${cpuMs.toFixed(2)}ms`;
```

The rule is **stability, not magnitude** — these must plateau. Climbing `memory.textures` is a leak; climbing `programs.length` means you're minting materials per frame.

For real GPU time use **`EXT_disjoint_timer_query_webgl2`**, wrapping each composer pass. This is the only honest way to know whether your Kuwahara is 2 ms or 9 ms on a given machine — `performance.now()` around `composer.render()` measures command *submission*, not execution. Use **`WEBGL_debug_renderer_info`** (`UNMASKED_RENDERER_WEBGL` → `"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0)"`) to pick a quality tier at first launch. **spector.js** captures the full GL command stream — how you find the pass binding a target 13 times. `chrome://gpu` inside the Electron window confirms which ANGLE backend is actually active.

### 8.5 Mitigations with numbers

| Mitigation | Gain |
|---|---|
| **KTX2/Basis via `THREE.KTX2Loader`** | 2048² RGBA8 22.4 MB → BC7/ASTC ~5.6 MB, ETC1S ~2.8 MB. **4–8×**. 30 textures: 672 MB → 84–168 MB. Also faster uploads (no CPU decode) |
| Instancing / merging | 3,000 props → ~20 calls; 24–60 ms CPU saved |
| **Half-res post + upsample** | 4× fewer fragments; Kuwahara 6 ms → 1.5 ms |
| `setPixelRatio(min(dpr, 1.5))` | On a 2× panel: **1.78× fragment reduction** (4.0 → 2.25 px per CSS px). Don't go below 1.0 — the paper texture needs real pixels |
| Dynamic resolution | Rolling median GPU ms > 15 for 30 frames → `composer.setSize(w*0.85, h*0.85)`, recover in 0.05 steps. Hard fps floor without a settings menu. **Rescale the scene render, not the paper pass** |
| 1 cascade @2048² vs 4 | 4× fewer shadow draws; static sun → free |
| `antialias: false` | Default-FB MSAA is never used when rendering to a target. Reclaims 30–60 MB and ~0.4 ms of pointless resolve |
| `powerPreference: 'high-performance'` + `force_high_performance_gpu` | On hybrid laptops, **3–5×** (discrete vs Iris Xe) |
| `renderer.compileAsync()` at load | Converts 60 × 20–150 ms of hitches into one loading-screen wait |

### 8.6 WebGPU — honest read

`WebGPURenderer` is usable in 2026 (Chrome/Edge 113+, Firefox 141+, Safari 26+; r171+ ships zero-config WebGPU with automatic WebGL2 fallback). Electron gets it as Chromium.

What it actually buys **this** app: draw-call overhead 2–10× better — but if you've instanced down to 150 calls that's worth 1–2 ms. Compute shaders for GPU culling and indirect draw — again, not where you're bound. Particles at 1 M+ vs ~50 k — the one genuinely compelling case, if you want live weather and drifting fog volumes.

**The honest cost is TSL migration.** Every shader here is raw GLSL; WebGPU needs WGSL via TSL. For a project with *this many* custom shaders (4 Kuwahara stages, Roberts edge, ink composite, paper, hatching, tilt-shift, terrain VS/FS, water, sky, wind): **1–2 weeks including testing**, not the "1–2 days" quoted for projects with a couple of custom shaders. And **pmndrs/postprocessing does not blanket-support WebGPU** — which undercuts the §6.10 recommendation.

**Verdict: build on WebGL2 + pmndrs now.** Structure each effect as an isolated shader string + uniform map (the pmndrs `Effect` subclass pattern already forces this), so a future TSL port is mechanical rather than archaeological. Revisit when you're either draw-call-bound after instancing or want GPU-driven weather at a scale WebGL can't reach.

---

## 9. Suggested build order

1. **Terrain skeleton** — Option A single displaced plane + `MeshStandardMaterial`. One afternoon. This is your correctness baseline.
2. **Swap to CDLOD** (§1.3–1.5) with the flat/globe `uSphereMix`. Verify with `renderer.info.render.calls === 1` and no visible morph popping.
3. **Terrain shading + `uMapness`** (§2.5). The moment `softLight(carto, hillshade)` lands, the project has its identity. Get this before anything else.
4. **Sky gradient + time-of-day LUT + aerial perspective + cloud shadows** (§5.1–5.4, 5.6c). Five shared GLSL functions; biggest mood-per-line ratio in the whole stack.
5. **Water** — ocean plane with depth ramp + foam (§4.1–4.3), rivers after.
6. **Vegetation** — one InstancedMesh tier first, then tiles, then LOD buckets.
7. **NPR post** — order from §6.2, but bring up **tilt-shift + paper + vignette + LUT first** (cheap, huge look delta), and add Kuwahara last, at half res, behind a quality toggle.
8. **City** — merge per district; skip roofs beyond gable/pyramid until it looks right.

Two things to instrument from day one: the `renderer.info` HUD (§8.4) and an `EXT_disjoint_timer_query_webgl2` per-pass timer. Every millisecond number in this document is a starting budget — the only ones that matter are the ones your scene reports on your target GPU.

agentId: ae5f3598bbe5d606f (use SendMessage with to: 'ae5f3598bbe5d606f', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 187847
tool_uses: 20
duration_ms: 2154106</usage>

---

<!-- fuente: stylized-3d.md -->

All research in. Here's the report.

---

# Stylized 3D Fantasy World Map in three.js — Implementation Reference

**Target stack:** TypeScript + three.js r160+ (WebGL2), Electron, 2048×1024 heightmap, flat-map ⇄ globe, painterly/cartographic NPR look.

---

## 0. Architecture at a glance

The single most important structural decision: **write one shared GLSL module** (`world.glsl.ts`) exporting `sampleHeight()`, `terrainNormal()`, `skyGradient()`, `aerialPerspective()`, `cloudShadow()`, and inject it into terrain, water, vegetation, and city materials alike. Everything looking like one painting comes from every surface calling the *same* sky/fog/cloud functions, not from tuning five materials to match.

| Layer | Technique | Draw calls | Tris | GPU ms (1660 @1080p) |
|---|---|---|---|---|
| Terrain | CDLOD quadtree, 1 shared grid + VTF, instanced | **1** | ~1.0 M | 0.8–1.4 |
| Vegetation | InstancedMesh per (tile × LOD tier) | 50–110 | ~2.0 M | 2.5–4.0 |
| City | `mergeGeometries` per district + `THREE.LOD` | ~63 | ~0.4 M | 0.4–0.8 |
| Water | 1 ocean plane + river ribbons, depth prepass | 4–10 | ~50 k | 0.6–1.2 |
| Sky/clouds | Gradient dome + billboard sprites | 2–5 | ~5 k | 0.3–0.7 |
| Post (NPR) | pmndrs, Kuwahara @half-res | 5 passes | — | 4.0–5.5 |
| **Total** | | **~150–200** | **~3.5 M** | **~9–14 ms** |

---

## 1. TERRAIN MESH

### 1.1 The four options, with real numbers for 2048×1024

| Approach | Verts | Tris | Geometry VRAM | Draw calls | Culling | LOD pop |
|---|---|---|---|---|---|---|
| **A.** Single `PlaneGeometry(W,H,2047,1023)` | 2,097,152 | 4,188,162 | **117 MB** (67 MB attrs + 50 MB Uint32 index) | 1 | none | n/a |
| **B.** Single low-res plane + vertex displacement | 262,144 | 522,242 | 8 MB | 1 | none | n/a (no detail near camera) |
| **C.** Static chunk grid + `THREE.LOD` per chunk | 128 chunks × 16,641 | ~1.2 M visible | ~70 MB | 20–40 | per chunk | **visible pops** |
| **D. CDLOD quadtree, one shared grid + VTF, instanced** | 4,225 (shared) | ~1.0 M visible | **330 KB** | **1** | per node | **none (geomorph)** |

**Take Option A seriously as a 30-minute prototype** — 4.2 M tris is ~1.5–2.5 ms on a GTX 1660 and it genuinely works. What kills it in production is not the GPU: it's that `PlaneGeometry` builds those typed arrays on the CPU (~1–2 s, 117 MB of JS heap before upload), `computeVertexNormals()` on 4.2 M tris takes 3–5 s, and you pay full cost when zoomed into one corner. Ship it as the baseline you diff against.

**Option D is the answer.** CDLOD ([Strugar 2009, source + paper](https://github.com/fstrugar/CDLOD)) is "a quadtree of regular grids" where "the LOD function is the same across the whole rendered mesh and is based on the precise three-dimensional distance between the observer and the terrain." The three properties that matter here:

1. **Every node draws the identical `BufferGeometry`** — a unit grid in [0,1]². Only uniforms/instance attributes differ (origin, scale, morph constants). Geometry VRAM for the *entire terrain* is one 65×65 grid: 4,225 verts × 8 B (a `vec2` position — you don't even need y, normal, or uv) = 34 KB, plus 8,192 tris × 3 × 2 B Uint16 = 48 KB. **82 KB.**
2. **Height comes from a vertex texture fetch**, so the mesh carries no elevation data at all. `2048×1024 R16F` = 4 MB.
3. **Geomorphing removes popping entirely** by sliding odd-indexed vertices onto their even (parent-LOD) neighbours as the node approaches its range boundary.

Because every node is the same geometry, **make the whole terrain one `InstancedBufferGeometry`** — one draw call for the entire planet.

### 1.2 Grid sizing

Pick the grid so the index buffer stays Uint16 (`< 65,536` verts):

| Grid (quads/side) | Verts | Tris/node | Nodes typically selected | Total tris |
|---|---|---|---|---|
| 32×32 | 1,089 | 2,048 | 250–400 | 0.5–0.8 M |
| **64×64** | **4,225** | **8,192** | **100–200** | **0.8–1.6 M** ✅ |
| 128×128 | 16,641 | 32,768 | 60–140 | 2.0–4.6 M ❌ |

**Use 64×64.** 128×128 nodes give you fewer instances but blow the triangle budget, and CDLOD's whole point is that node count adapts — you don't save draw calls with bigger nodes when you're already at 1.

### 1.3 The quadtree, LOD ranges, and morph constants (TypeScript)

```ts
const LOD_COUNT = 6;
const GRID = 64;                    // quads per side
const DETAIL_BALANCE = 2.0;         // each level's range ~2x the previous
const MORPH_START_RATIO = 0.66;     // CDLOD default

// --- LOD range distribution (CDLOD LODSelection) ---
function buildRanges(near: number, visibility: number): Float32Array {
  let total = 0, bal = 1.0;
  for (let i = 0; i < LOD_COUNT; i++) { total += bal; bal *= DETAIL_BALANCE; }
  const sect = (visibility - near) / total;
  const ranges = new Float32Array(LOD_COUNT);
  let prev = near; bal = 1.0;
  for (let i = 0; i < LOD_COUNT; i++) {
    ranges[i] = prev + sect * bal; prev = ranges[i]; bal *= DETAIL_BALANCE;
  }
  return ranges;
}

// --- morph constants per level: morphK = 1 - clamp(mc.x - dist*mc.y, 0, 1) ---
function buildMorphConsts(ranges: Float32Array): Float32Array {
  const mc = new Float32Array(LOD_COUNT * 2);
  for (let i = 0; i < LOD_COUNT; i++) {
    const end = ranges[i];
    const prevEnd = i > 0 ? ranges[i - 1] : 0;
    const start = prevEnd + (end - prevEnd) * MORPH_START_RATIO;
    mc[i * 2 + 0] = end / (end - start);
    mc[i * 2 + 1] = 1.0 / (end - start);
  }
  return mc;
}
```

Node AABBs need per-node **min/max height**, so build a min/max mip pyramid of the heightmap once at load (6 levels over 2048×1024, ~3 ms in JS). Store as two `Float32Array`s per level.

```ts
type Node = { x: number; y: number; size: number; lvl: number; hMin: number; hMax: number };

// Returns nodes to draw. Classic CDLOD recursion.
function lodSelect(n: Node, lvl: number, cam: THREE.Vector3, frustum: THREE.Frustum,
                   ranges: Float32Array, out: Node[], parentInFrustum = false): 'SELECTED'|'OUT_OF_RANGE' {
  const box = nodeBox(n);                              // THREE.Box3 in world space
  if (!sphereIntersectsBox(cam, ranges[lvl], box)) return 'OUT_OF_RANGE';
  // frustum test can be skipped once a parent was fully inside
  const inFrustum = parentInFrustum || frustum.intersectsBox(box);
  if (!inFrustum) return 'SELECTED';                   // culled, but "handled"

  if (lvl === 0) { out.push(n); return 'SELECTED'; }

  // Does any part need a finer level?
  if (!sphereIntersectsBox(cam, ranges[lvl - 1], box)) { out.push(n); return 'SELECTED'; }

  for (const c of children(n)) {
    if (lodSelect(c, lvl - 1, cam, frustum, ranges, out, inFrustum) === 'OUT_OF_RANGE') {
      out.push({ ...c, lvl });                         // child out of finer range → draw at THIS level
    }
  }
  return 'SELECTED';
}
```

That last line is the whole trick — a node whose child fell outside the finer range gets drawn as a quarter-node at the coarser level, which is what keeps the mesh watertight without stitching strips.

### 1.4 One draw call: instanced patches

```ts
// Shared unit grid: vec2 positions in [0,1]^2, Uint16 index.
function makeGrid(n: number): THREE.InstancedBufferGeometry {
  const verts = new Float32Array((n + 1) * (n + 1) * 2);
  let p = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { verts[p++] = i / n; verts[p++] = j / n; }
  const idx = new Uint16Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('gridPos', new THREE.BufferAttribute(verts, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const MAX_NODES = 512;
const geo = makeGrid(GRID);
// per-instance: xy = node origin in UV space, z = node size in UV, w = lod level
geo.setAttribute('iNode', new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 4), 4));

const terrain = new THREE.Mesh(geo, terrainMaterial);
terrain.frustumCulled = false;                 // we cull in the quadtree ourselves
scene.add(terrain);

// per frame, after lodSelect():
const arr = (geo.getAttribute('iNode') as THREE.InstancedBufferAttribute).array as Float32Array;
for (let i = 0; i < selected.length; i++) {
  const n = selected[i];
  arr[i*4+0] = n.x; arr[i*4+1] = n.y; arr[i*4+2] = n.size; arr[i*4+3] = n.lvl;
}
geo.getAttribute('iNode').needsUpdate = true;
geo.instanceCount = selected.length;
```

`lodSelect` on a 6-level tree costs ~0.15–0.4 ms of JS for 150 selected nodes. Throttle it to run only when the camera moves >2 units or rotates >0.01 rad — on a mostly-static map view it runs a few times per second.

### 1.5 The vertex shader — geomorph + VTF + flat/globe projection

Set `material.glslVersion = THREE.GLSL3` so you get `textureLod()` in the vertex stage. WebGL2 guarantees `maxVertexTextures ≥ 16`; assert `renderer.capabilities.maxVertexTextures > 0` anyway.

```glsl
in vec2 gridPos;      // [0,1]^2
in vec4 iNode;        // xy = origin (UV), z = size (UV), w = lod level

uniform sampler2D uHeight;      // R16F, LinearFilter
uniform vec2  uMorphConsts[6];
uniform float uHeightScale;     // world units per unit of heightmap value
uniform vec2  uWorldSize;       // e.g. vec2(4096.0, 2048.0)
uniform float uSphereMix;       // 0 = flat map, 1 = globe
uniform float uRadius;
uniform vec3  uCamPos;

out vec2 vUv;
out vec3 vWorldPos;

const float PI = 3.14159265;

float sampleH(vec2 uv) { return textureLod(uHeight, uv, 0.0).r * uHeightScale; }

// CDLOD morph: slide odd-indexed grid vertices onto their even (parent) neighbours.
vec2 morphVertex(vec2 g, float morphK) {
  const float N = 64.0;                       // GRID
  vec2 frac = fract(g * N * 0.5) * 2.0 / N;   // 0 for even index, 1/N for odd
  return g - frac * morphK;
}

vec3 project(vec2 uv, float h) {
  vec3 flat3 = vec3((uv.x - 0.5) * uWorldSize.x, h, (0.5 - uv.y) * uWorldSize.y);
  if (uSphereMix < 0.001) return flat3;
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (0.5 - uv.y) * PI;
  float r   = uRadius + h;
  vec3 sph  = vec3(r * cos(lat) * sin(lon), r * sin(lat), r * cos(lat) * cos(lon));
  return mix(flat3, sph, uSphereMix);
}

void main() {
  // pass 1: unmorphed position, to measure distance
  vec2 uv0  = iNode.xy + gridPos * iNode.z;
  vec3 wp0  = project(uv0, sampleH(uv0));
  float d   = distance(uCamPos, wp0);

  // pass 2: morph and re-sample
  vec2 mc   = uMorphConsts[int(iNode.w)];
  float k   = 1.0 - clamp(mc.x - d * mc.y, 0.0, 1.0);
  vec2 g    = morphVertex(gridPos, k);
  vUv       = iNode.xy + g * iNode.z;
  vWorldPos = project(vUv, sampleH(vUv));

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
```

Why this is seamless with **no mip pyramid**: at `morphK = 1` the vertex lands exactly on the parent grid's vertex position, so its texture fetch returns exactly the parent's height. Geometry and elevation converge together. Two VTFs per vertex is the only cost.

**Heightmap texture format — the one gotcha.** Use `THREE.HalfFloatType`. `R16F` is linearly filterable in WebGL2 core; `R32F` (`THREE.FloatType`) requires the `OES_texture_float_linear` extension and will silently fall back to `NearestFilter` on some Intel drivers, giving you a visibly faceted terrain.

```ts
const h = new THREE.DataTexture(halfFloatArray, 2048, 1024, THREE.RedFormat, THREE.HalfFloatType);
h.minFilter = h.magFilter = THREE.LinearFilter;
h.wrapS = THREE.RepeatWrapping;      // longitude wraps on a globe
h.wrapT = THREE.ClampToEdgeWrapping;
h.needsUpdate = true;
```

Half-float in [0,1] gives ~2⁻¹² relative steps ≈ 0.24 m per 1000 m of range — fine for a stylized map. If you need more, store 16-bit unsigned in RG8 and unpack manually (losing hardware filtering).

### 1.6 Normals — compute them, don't store them

Compute in the **fragment** shader from heightmap central differences. This gives full-resolution normals regardless of how coarse the mesh LOD is under that pixel — distant low-poly terrain still shows crisp relief.

```glsl
uniform vec2 uTexel;        // vec2(1.0/2048.0, 1.0/1024.0)
uniform vec2 uWorldTexel;   // world units per heightmap texel, vec2(2.0, 2.0)

vec3 terrainNormal(vec2 uv) {
  float hL = textureLod(uHeight, uv - vec2(uTexel.x, 0.0), 0.0).r * uHeightScale;
  float hR = textureLod(uHeight, uv + vec2(uTexel.x, 0.0), 0.0).r * uHeightScale;
  float hD = textureLod(uHeight, uv - vec2(0.0, uTexel.y), 0.0).r * uHeightScale;
  float hU = textureLod(uHeight, uv + vec2(0.0, uTexel.y), 0.0).r * uHeightScale;
  float dhdx = (hR - hL) / (2.0 * uWorldTexel.x);
  float dhdz = (hU - hD) / (2.0 * uWorldTexel.y);
  return normalize(vec3(-dhdx, 1.0, -dhdz));
}
```

4 fetches per pixel. **Optimisation:** bake a normal map offline into `RG8` (store xz, reconstruct `y = sqrt(1 - x² - z²)`) — 2048×1024 RG8 = 4 MB, 1 fetch instead of 4, and you can pre-filter it with mips to kill specular aliasing on distant slopes. Do this as soon as the look is locked.

### 1.7 Keeping the globe version working

The `uSphereMix` uniform above already does 90% of it — you can **animate a flat map unfolding into a globe** for free, which is a genuinely strong feature for this app. The remaining work:

- **Quadtree root split.** A 2:1 map means the root node is non-square. Start with **two 1024×1024 root nodes** side by side so every node is square in UV and the LOD ranges behave.
- **Node bounds must be computed in the projected space.** In globe mode a node's AABB is not the flat box — build a bounding sphere from the node's lat/lon corners plus `hMax`, or just recompute the 8 projected corners at selection time (cheap: 150 nodes × 8 = 1200 `project()` calls in JS, ~0.05 ms).
- **Horizon culling** (the big win on a globe — cheaper and more effective than frustum culling). With everything relative to planet centre, a point `P` is hidden if `dot(P, camPos) < R²`. Test the node's farthest point:
  ```ts
  const hidden = nodeFarPoint.dot(camPos) < radius * radius;
  ```
- **Pole pinching.** Equirectangular texel density scales by `1/cos(lat)` — 5.7× compression at 80°. Clamp latitude to ±89.5° and cap with a small polar disc mesh, and cull polar nodes aggressively (they contribute almost no screen area).
- **If pole distortion becomes unacceptable, move to a cube-sphere**: 6 quadtrees, offline-resample the equirect heightmap into 6 face textures. Use the *spherified* cube rather than naive normalize — naive normalize makes centre-of-face cells "roughly four times as large as the smallest cells" ([Catlike Coding](https://catlikecoding.com/unity/tutorials/cube-sphere/)):
  ```glsl
  vec3 spherify(vec3 p) {   // p in [-1,1]^3 on the cube surface
    vec3 p2 = p * p;
    return p * sqrt(1.0 - p2.yzx * 0.5 - p2.zxy * 0.5 + p2.yzx * p2.zxy / 3.0);
  }
  ```
- **Precision.** Keep `uRadius` in the 1,000–8,000 range. Float32 world coordinates hold up fine at fantasy-planet scale; you only need double-precision / origin-rebasing at Earth scale (6.4 M).

### 1.8 Shadows from a VTF-displaced terrain — the gotcha

three.js renders shadow maps with `MeshDepthMaterial`, which knows nothing about your displacement. Terrain will cast a **flat** shadow unless you supply a matching depth material:

```ts
terrain.customDepthMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: TERRAIN_VS,                       // the exact same VS as above
  fragmentShader: `
    #include <packing>
    void main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`,
  uniforms: terrainMaterial.uniforms,             // share the uniform object, not a copy
});
```

Same applies to vegetation wind (§3.5) and to any instanced geometry.

---

## 2. TERRAIN SHADING — and making 3D read as a MAP

### 2.1 Material choice

Use `MeshStandardMaterial` + `onBeforeCompile` for tier 1 so you inherit three.js shadows, fog, and lights for free; migrate to a custom `ShaderMaterial` once the look is locked. [`three-custom-shader-material`](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) is the pragmatic middle ground — it lets you write `csm_DiffuseColor` / `csm_Position` against a real `MeshStandardMaterial` without string-replacing chunks.

Pack all terrain layer textures into a **`THREE.DataArrayTexture`** (`sampler2DArray`) so 8 materials cost one sampler binding instead of eight:

```ts
const layers = new THREE.DataArrayTexture(data, 1024, 1024, 8);  // grass, rock, sand, snow, ...
layers.format = THREE.RGBAFormat;
layers.minFilter = THREE.LinearMipmapLinearFilter;
layers.magFilter = THREE.LinearFilter;
layers.wrapS = layers.wrapT = THREE.RepeatWrapping;
layers.needsUpdate = true;
// GLSL: uniform sampler2DArray tLayers;  texture(tLayers, vec3(uv, float(layer)))
```

### 2.2 Procedural weights from height + slope + moisture

For a procedurally generated world, computing weights in the shader beats a baked splatmap — zero texture memory, and it updates instantly when the generator re-runs.

```glsl
uniform sampler2D uMoisture;   // R8, 2048x1024
uniform float uSeaLevel, uSnowLine;

struct Weights { float sand, grass, forestFloor, rock, snow; };

Weights terrainWeights(float h, float slope, float moist) {
  Weights w;
  w.rock        = smoothstep(0.42, 0.72, slope);
  w.snow        = smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, h)
                * (1.0 - smoothstep(0.55, 0.82, slope));
  w.sand        = (1.0 - smoothstep(uSeaLevel + 2.0, uSeaLevel + 16.0, h))
                * (1.0 - smoothstep(0.30, 0.55, slope));
  w.forestFloor = smoothstep(0.45, 0.75, moist) * (1.0 - w.rock);
  w.grass       = 1.0;                                   // base layer
  return w;
}
// slope = 1.0 - N.y  (flat = 0, vertical = 1)
```

### 2.3 Height-blend, not linear blend

Linear alpha blending of splat weights looks wrong — "the transition is smooth but unnatural. Stones look evenly soiled by sand" ([Mishkinis, *Advanced Terrain Texture Splatting*](https://www.gamedeveloper.com/programming/advanced-terrain-texture-splatting)). Store a height/depth value in each layer texture's alpha and blend by it. The N-layer generalisation:

```glsl
const float BLEND_DEPTH = 0.2;

vec3 heightBlendN(vec4 tex[5], float w[5]) {
  float ma = -1e9;
  for (int i = 0; i < 5; i++) ma = max(ma, tex[i].a + w[i]);
  ma -= BLEND_DEPTH;
  vec3  sum = vec3(0.0);
  float den = 0.0;
  for (int i = 0; i < 5; i++) {
    float b = max(tex[i].a + w[i] - ma, 0.0);
    sum += tex[i].rgb * b;
    den += b;
  }
  return sum / max(den, 1e-4);
}
```

This is the single biggest quality-per-line-of-code win in terrain shading. Sand now settles *into* the cracks between stones instead of fogging them.

### 2.4 Triplanar, gated by slope

Full triplanar is 3× the texture fetches. Because the Y projection *is* the top-down projection you already have, gate the extra X/Z work on slope:

```glsl
vec3 triplanarAlbedo(vec3 wp, vec3 N, int layer, float scale) {
  vec3 b = pow(abs(N), vec3(4.0));            // sharpness 4 — smooth, no black corners
  b /= dot(b, vec3(1.0));

  vec3 cy = texture(tLayers, vec3(wp.xz * scale, float(layer))).rgb;
  if (b.x + b.z < 0.02) return cy;            // near-flat: skip 2 of 3 samples

  vec3 cx = texture(tLayers, vec3(wp.zy * scale, float(layer))).rgb;
  vec3 cz = texture(tLayers, vec3(wp.xy * scale, float(layer))).rgb;
  return cx * b.x + cy * b.y + cz * b.z;
}
```

Note `pow(abs(N), 4)` rather than the `max(abs(N) - 0.2, 0)` form: subtraction sharpens corners disproportionately and goes black above ~0.55, since a 45° normal component is 0.577 ([Ben Golus](https://bgolus.medium.com/normal-mapping-for-a-triplanar-shader-10bf39dca05a)).

**Triplanar normal mapping — use Whiteout blend.** The naive approach (mesh tangents with projected UVs) produces normals that appear inverted or rotated depending on view angle. Whiteout is 5 instructions and is ground-truth on axis-aligned surfaces:

```glsl
vec3 triplanarNormal(vec3 wp, vec3 N, int layer, float scale) {
  vec3 b = pow(abs(N), vec3(4.0)); b /= dot(b, vec3(1.0));
  vec3 tx = texture(tNormals, vec3(wp.zy * scale, float(layer))).xyz * 2.0 - 1.0;
  vec3 ty = texture(tNormals, vec3(wp.xz * scale, float(layer))).xyz * 2.0 - 1.0;
  vec3 tz = texture(tNormals, vec3(wp.xy * scale, float(layer))).xyz * 2.0 - 1.0;
  // Whiteout blend
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
}
```

Also worth knowing: at 45° exactly, triplanar breaks — accept it, or dial sharpness down.

### 2.5 Making it READ AS A MAP — the core of this project

This is where the app earns its identity. Four layers, all driven by one `uMapness` uniform.

**(a) Auto-drive `uMapness` from camera height.** As you zoom out, the render should *become* a map. As you zoom in, it becomes a landscape.

```ts
terrainMat.uniforms.uMapness.value = THREE.MathUtils.smoothstep(camera.position.y, 800, 2500);
```

**(b) Blend the 2D cartographic texture over the 3D relief — with soft light, not multiply.** You already generate the Wonderdraft-style 2D map; render it to a `tCarto` texture (4096×2048). Multiply darkens and desaturates; soft light preserves the map's hue and saturation while adding form. This is exactly what relief-shading cartography does.

```glsl
vec3 softLight(vec3 base, vec3 blend) {
  return mix(2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
             sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
             step(0.5, blend));
}

// classic Swiss relief hillshade: NW light, softened toward a sky term
vec3  L      = normalize(vec3(-0.7071, 0.7071, -0.7071));   // 315° az, 45° alt
float lamb   = max(dot(N, L), 0.0);
float sky    = 0.5 + 0.5 * N.y;
float shade  = mix(sky, lamb, 0.65);

vec3 carto  = texture(tCarto, vUv).rgb;
vec3 mapCol = softLight(carto, vec3(shade));

vec3 albedo = mix(pbrAlbedo, mapCol, uMapness);
```

**(c) Hypsometric tints + contour lines.** A 1D gradient LUT (256×1 RGB) indexed by normalised elevation gives you authored map palettes with one texture swap.

```glsl
uniform sampler2D uHypso;        // 256x1 gradient
uniform float uContourInterval;  // world units, e.g. 50.0
uniform float uLineWidthPx;      // 1.4

vec3 hypso = texture(uHypso, vec2(clamp(h / uMaxHeight, 0.0, 1.0), 0.5)).rgb;
albedo = mix(albedo, albedo * hypso * 1.6, uMapness * uHypsoAmount);

// antialiased contours, with automatic moiré suppression
float c  = h / uContourInterval;
float df = fwidth(c);
float f  = abs(fract(c - 0.5) - 0.5);
float contour = 1.0 - smoothstep(0.0, df * uLineWidthPx, f);
contour *= 1.0 - smoothstep(0.5, 1.5, df);        // fade out when lines get denser than a pixel
float major = step(mod(floor(c + 0.5), 5.0), 0.5); // index contour every 5th
albedo = mix(albedo, uInkColor, contour * (0.25 + 0.45 * major) * uMapness);
```

The `1.0 - smoothstep(0.5, 1.5, df)` line is not optional — without it, steep terrain turns into a shimmering moiré field the moment contours pack tighter than one pixel.

**(d) Ink coastlines and ridge lines, drawn in the terrain shader.** Doing this here rather than in post gives you *world-space* line placement — lines that sit on the terrain, follow it in perspective, and don't smear when the Kuwahara filter runs. Post-process Sobel (§6.4) then handles silhouettes and object outlines; the two are complementary.

```glsl
// --- coastline: the sea-level contour ---
float d = h - uSeaLevel;
float wCoast = max(fwidth(d) * uCoastPx, uMinCoastWorld);   // screen-width floor + world-width floor
float coast  = 1.0 - smoothstep(0.0, wCoast, abs(d));

// --- ridge/valley lines: Laplacian of height (convex = ridge) ---
float lap = hL + hR + hD + hU - 4.0 * hC;
float ridge  = smoothstep(uRidgeT0, uRidgeT1, -lap * uRidgeGain) * smoothstep(0.25, 0.60, slope);
float valley = smoothstep(uRidgeT0, uRidgeT1,  lap * uRidgeGain) * smoothstep(0.15, 0.45, slope);

// --- hachures: hatch strokes running downhill on steep ground ---
vec2  grad     = normalize(vec2(dhdx, dhdz) + 1e-6);
vec2  hatchUv  = vec2(dot(vWorldPos.xz, vec2(-grad.y, grad.x)), dot(vWorldPos.xz, grad));
float hatch    = smoothstep(0.45, 0.55, fract(hatchUv.x * uHatchFreq))
               * smoothstep(0.55, 0.85, slope);

float ink = clamp(coast * 1.0 + ridge * 0.6 + valley * 0.35 + hatch * 0.30, 0.0, 1.0);
albedo = mix(albedo, uInkColor, ink * uMapness * uInkStrength);
```

Use a warm sepia `uInkColor = vec3(0.16, 0.11, 0.08)`, never pure black — flat black is the clearest tell that a line is procedural.

**(e) Paper grain on the terrain itself** (distinct from the screen-space paper in post): a very low-amplitude world-space triplanar grain gives the surface tooth without looking like a decal.

```glsl
float grain = texture(tPaperGrain, vWorldPos.xz * 0.35).r;
albedo *= mix(1.0, 0.90 + 0.20 * grain, 0.35 * uMapness);
```

### 2.6 Two things that will bite you

- **Texture repetition.** At map scale a 1024² tiling texture repeats hundreds of times and reads as a grid. Fade detail textures to a flat biome colour beyond ~500 world units (`smoothstep` on view distance) — this is a perf win *and* pushes the far field toward the map look, which is exactly what you want. For the near field, stochastic/hex-tiling (3 samples + a blend) kills repetition properly.
- **Specular aliasing on distant slopes.** Computing normals from a non-mipped heightmap gives full-frequency normals at every distance, which shimmers. Bake the normal map with mips (§1.6) and let mip selection do the filtering.

---

## 3. VEGETATION

### 3.1 Which instancing class

| Class | Mechanism | Use for |
|---|---|---|
| `THREE.InstancedMesh` | `drawElementsInstanced` — 1 geometry, N transforms, 1 draw call | **Grass, one tree species per LOD tier, rocks.** Default. |
| `THREE.InstancedBufferGeometry` + `ShaderMaterial` | Same GL path, you own the attribute layout | Grass, when you want 16 B/blade instead of a 64 B mat4 |
| `THREE.BatchedMesh` | `WEBGL_multi_draw` — N different geometries, 1 draw call, **per-object culling + sorting** | Buildings, mixed species. Not grass. |

`BatchedMesh` ["performs worse if you render a lot of instances (more than 100k)"](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221). Rule: **>10 k identical → InstancedMesh; <10 k varied → BatchedMesh.**

```ts
const trees = new THREE.InstancedMesh(treeGeo, treeMat, MAX);
trees.count = actualCount;                              // render fewer than allocated — free culling
trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
trees.setMatrixAt(i, m.compose(pos, q, s));
trees.setColorAt(i, tint.setHSL(0.25 + rng()*0.04, 0.4, 0.35 + rng()*0.2));
trees.instanceMatrix.needsUpdate = true;
trees.instanceColor!.needsUpdate = true;
trees.computeBoundingSphere();   // MUST call after setMatrixAt, or culling uses a stale sphere
```

For grass, drop the mat4 — 16 B/blade vs 64 B is 8 MB vs 32 MB at 500 k blades, and measurably less vertex-attribute bandwidth:

```ts
const geo = new THREE.InstancedBufferGeometry().copy(bladeGeo as any);
geo.instanceCount = N;
geo.setAttribute('iXZRS', new THREE.InstancedBufferAttribute(new Float32Array(N*4), 4)); // x,z,rot,scale
geo.setAttribute('iVar',  new THREE.InstancedBufferAttribute(new Float32Array(N*4), 4)); // hue,height,phase,stiff
```

### 3.2 Budgets that hold at 60 fps

Measured reference points: [1.5 M grass blades at 0.2 ms CPU / 3 ms GPU, 145 fps on an RTX 2060](https://discourse.threejs.org/t/interactive-grass-with-multi-player-physics-and-wind-fps-friendly-and-suitable-for-games/87994); [1 M+ blades at 60 fps on an M1](https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808); working ceiling quoted by maintainers ~[3 M triangles/frame](https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286).

| Asset | Tris each | Visible | Tris | Draw calls |
|---|---|---|---|---|
| Trees LOD0 (0–60 m) | 1,200 | 250 | 300 k | 4–8 |
| Trees LOD1 (60–180 m) | 250 | 1,500 | 375 k | 8–16 |
| Trees LOD2 cross-quads (180–500 m) | 6 | 15,000 | 90 k | 8–16 |
| Trees LOD3 canopy blobs (>500 m) | 40 | 400 blobs | 16 k | 2–4 |
| Grass (0–45 m) | 4 | 250,000 | 1.0 M | 16–36 |
| Bushes/rocks | 80 | 3,000 | 240 k | 6–12 |
| **Total** | | | **~2.0 M** | **~50–110** |

**The binding constraint for grass is fill rate, not triangles.** 250 k quads at 45 m radius covering 5–40 px each gives 4–8× overdraw = 16–33 Mpx of alpha-tested fragments ≈ 2–4 ms on a 1660. **Halve the grass radius before you halve the blade count.**

### 3.3 Distribution from the biome mask

Read the mask once on the CPU via `OffscreenCanvas.getImageData()`. Then:

- **Trees → Poisson disk.** Only Poisson guarantees minimum trunk separation, and clustering is brutally visible on silhouettes. Use [Bridson's algorithm](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf) with the [Extreme Learning improvement](https://extremelearning.com.au/an-improved-version-of-bridsons-algorithm-n-for-poisson-disc-sampling/) — sample the *inner ring* at `k` evenly-spaced angles instead of a uniform annulus: **~20× faster, ~40% denser**.

```ts
export function poisson(w: number, h: number, rAt: (x:number,y:number)=>number, rMin: number, k = 8) {
  const cell = rMin / Math.SQRT2;
  const gw = Math.ceil(w/cell), gh = Math.ceil(h/cell);
  const grid = new Int32Array(gw*gh).fill(-1);
  const pts: number[] = [], active: number[] = [];
  const emit = (x:number,y:number) => {
    const id = pts.length/2; pts.push(x,y);
    grid[((y/cell)|0)*gw + ((x/cell)|0)] = id; active.push(id);
  };
  const ok = (x:number,y:number,r:number) => {
    if (x<0||y<0||x>=w||y>=h) return false;
    const gx=(x/cell)|0, gy=(y/cell)|0, span=Math.ceil(r/cell);
    for (let j=Math.max(0,gy-span); j<=Math.min(gh-1,gy+span); j++)
      for (let i=Math.max(0,gx-span); i<=Math.min(gw-1,gx+span); i++) {
        const id = grid[j*gw+i]; if (id < 0) continue;
        const dx = pts[id*2]-x, dy = pts[id*2+1]-y;
        if (dx*dx+dy*dy < r*r) return false;
      }
    return true;
  };
  emit(Math.random()*w, Math.random()*h);
  while (active.length) {
    const ai = (Math.random()*active.length)|0, p = active[ai];
    const px = pts[p*2], py = pts[p*2+1], r = rAt(px,py), seed = Math.random();
    let placed = false;
    for (let j=0;j<k;j++) {
      const t = 2*Math.PI*(seed + j/k);
      const x = px + (r+1e-6)*Math.cos(t), y = py + (r+1e-6)*Math.sin(t);
      if (ok(x,y,rAt(x,y))) { emit(x,y); placed = true; break; }
    }
    if (!placed) { active[ai] = active[active.length-1]; active.pop(); }
  }
  return new Float32Array(pts);
}
// variable radius from the biome mask: dense forest → small radius
const rAt = (x:number,y:number) => {
  const forest = mask[(((y/h*MASK)|0)*MASK + ((x/w*MASK)|0))*4] / 255;
  return THREE.MathUtils.lerp(9.0, 2.6, forest*forest);
};
```

- **Grass → jittered grid.** 250 k Poisson points cost 200–400 ms in JS; a jittered grid costs ~3 ms and nobody sees the difference under a 20 cm blade. There is [no jitter value that gives even angular distribution without distance outliers](https://www.redblobgames.com/x/1830-jittered-grid/) — irrelevant for grass, fatal for trees. Cheapest of all: threshold a 256² blue-noise texture against the density mask.

### 3.4 Representation, and the FlowScape painterly forest

| Representation | Cost | Distance |
|---|---|---|
| Full model, trunk + leaf cards | 800–2000 tri | 0–60 m |
| Decimated model | 150–350 tri | 60–180 m |
| **Cross-quads** (2–3 intersecting painted quads) | 4–6 tri | 180–500 m |
| Single billboard | 2 tri | 500 m+ |
| [Octahedral impostor](https://shaderbits.com/blog/octahedral-impostors) (6×6…12×12 baked atlas, 3-frame blend) | 2 tri + 1–3 fetches | replaces LOD1/2 |

For a map camera that rarely dips below the horizon, use **hemi-octahedral** impostors (upper hemisphere only, half the atlas) — or honestly skip impostors: cross-quads plus good canopy art get you 90% there for 5% of the pipeline work.

**The painterly recipe, in priority order:**
1. **One 2048²–4096² atlas** with 8–16 painted canopy blobs + 4–8 grass clumps, alpha-cut. All foliage shares one material → one draw call per chunk per tier.
2. **Per-instance hue/value jitter** via `setColorAt` (±0.04 hue, ±0.2 lightness). This single trick breaks the wallpaper repetition and is why painted forests read as hand-made.
3. **Per-instance atlas frame** via a `float iAtlasIndex` instanced attribute, offsetting UVs in the vertex shader — 16 variants, still one draw call.
4. **Canopy blob meshes** for the far tier: one lumpy 40–80 tri hull per grove, same canopy art, never animated. Replaces 400 billboards with 1 mesh and gives a far better silhouette.
5. **Vertical gradient in the fragment shader** — darken canopy bottoms, tint tops with sky colour. Combined with `HemisphereLight`, this *is* the painterly read.
6. Fog matched to sky colour at 250–600 m so LOD swaps are invisible.

### 3.5 Wind in the vertex shader

Use the Crysis formulation — it preserves length and separates trunk bend from leaf flutter ([GPU Gems 3, ch. 16](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-16-vegetation-procedural-animation-and-shading-crysis)). Vertex colour channels: **R = leaf-edge stiffness, G = per-leaf phase, B = leaf stiffness, A = baked AO**.

```ts
foliageMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', /* glsl */`
      #include <common>
      uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
      vec4 smoothCurve(vec4 x){ return x*x*(3.0-2.0*x); }
      vec4 triangleWave(vec4 x){ return abs(fract(x+0.5)*2.0-1.0); }
      vec4 smoothTriangleWave(vec4 x){ return smoothCurve(triangleWave(x)); }

      // GPU Gems 3 main bending: bend xz by ~h^4, then renormalize to the original
      // radius so branches never stretch.
      vec3 mainBending(vec3 p, vec2 dir, float bendScale){
        float len = length(p);
        float bf = p.y * bendScale; bf += 1.0; bf *= bf; bf = bf*bf - bf;
        vec3 np = p; np.xz += dir * bf;
        return normalize(np) * len;
      }
      vec3 detailBending(vec3 p, vec3 n, float edgeAtten, float phase,
                         float branchPhase, float time, float amp){
        phase += branchPhase;
        float vtxPhase = dot(p, vec3(phase));
        vec2 wavesIn = time + vec2(vtxPhase, branchPhase);
        vec4 waves = fract(wavesIn.xxyy * vec4(1.975,0.793,0.375,0.193)) * 2.0 - 1.0;
        waves = smoothTriangleWave(waves);
        vec2 waveSum = waves.xz + waves.yw;
        p += waveSum.x * edgeAtten * n * amp;
        p.y += waveSum.y * amp * 0.5;
        return p;
      }`)
    .replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        float objPhase = dot(instanceMatrix[3].xyz, vec3(0.37, 0.0, 0.61));
      #else
        float objPhase = 0.0;
      #endif
      transformed = detailBending(transformed, objectNormal, color.r * color.b,
                                  color.g * 6.28, objPhase, uTime * 2.0, uWindStrength * 0.12);
      transformed = mainBending(transformed,
                     uWindDir * uWindStrength * (0.6 + 0.4*sin(uTime*0.7 + objPhase)), 0.06);`);
};
foliageMat.customProgramCacheKey = () => 'foliage-wind-v1';
```

**Critical ordering fact:** `transformed` inside `begin_vertex` is in *instance-local* space — three.js applies `instanceMatrix` later inside `project_vertex`. So bend in local space and read the instance origin from `instanceMatrix[3].xyz`. Chunk names (`common`, `begin_vertex`, `beginnormal_vertex`, `project_vertex`, `worldpos_vertex`, `fog_vertex`) are stable in r160+ ([ShaderChunk.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk.js)). **Inject the same code into `customDepthMaterial` or shadows won't sway.**

Grass wants something simpler — a cubic tip bend masked by `uv.y`, gusted by scrolling noise:

```glsl
float h = uv.y;
float gust = texture2D(uNoise, worldXZ*0.01 + uTime*vec2(0.02,0.011)).r;
float bend = (h*h) * (0.35 + 0.9*gust) * uWindStrength;
transformed.xz += uWindDir * bend;
transformed.y  -= bend * bend * 0.5;     // cheap arc-length compensation
```

### 3.6 Per-instance LOD (you can't use `THREE.LOD`)

`THREE.LOD` is per-*object*. The standard workaround is **one `InstancedMesh` per tier, re-bucketed when the camera moves** — this [nearly doubled framerate on Quest 2 in one reported case](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html):

```ts
update(cam: THREE.Camera) {
  if (cam.position.distanceToSquared(this.lastCam) < 4) return;     // 2 m throttle
  this.lastCam.copy(cam.position);
  const n = this.tiers.map(() => 0);
  for (const item of this.all) {
    const d = cam.position.distanceTo(item.pos);
    const t = d < 60 ? 0 : d < 180 ? 1 : d < 500 ? 2 : -1;
    if (t < 0) continue;
    this.tiers[t].setMatrixAt(n[t]++, item.matrix);
  }
  this.tiers.forEach((m, t) => {
    m.count = n[t];                       // shrink the draw; don't rebuild the buffer
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  });
}
```

Alternative: GPU-side collapse (`gl_Position = vec4(0,0,2,1)` pushes the vertex behind the far plane) — zero CPU, but vertices are still fetched, so only worth it when draw-call-bound. Or use [`@three.ez/instanced-mesh`](https://github.com/agargaro/instanced-mesh), which gives per-instance frustum culling, BVH raycasting and a real `addLevel()` API, [demoed at 1 M instances with 4 LOD tiers](https://discourse.threejs.org/t/instancedmesh-lod-1-million-instances/70748).

### 3.7 Frustum culling — the trap

**`InstancedMesh` is culled as a single object against one `boundingSphere`.** One InstancedMesh covering a 4 km map has a 2 km sphere and is *never* culled. Chunk spatially:

```ts
const TILE = 64;   // metres — 64 m for trees, 24–32 m for grass
// 4 km map = 62×62 tiles, but only ~20 within a 500 m view distance → ~20 draw calls, not 3844
tileMesh.frustumCulled = true;
tileMesh.computeBoundingSphere();
```

Also: instances are **not depth-sorted**, so an instanced field can be *slower* than separate meshes when fragment-bound — [three.js #30352](https://github.com/mrdoob/three.js/issues/30352) measured 5,000 spheres at ~60 fps as Meshes vs ~30 fps as one InstancedMesh with `MeshStandardMaterial`. Sort tiles front-to-back via `renderOrder` and keep the foliage fragment shader cheap.

### 3.8 Alpha and shadows

Alpha *blending* is unfixable for foliage — leaf cards intersect, so no polygon sort is correct. Use cutout + alpha-to-coverage ([Ben Golus](https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f)):

```ts
mat.transparent = false;        // stays in the opaque queue → depth-sorted, z-prepass friendly
mat.alphaTest = 0.4;
mat.alphaToCoverage = true;     // needs MSAA
mat.side = THREE.DoubleSide;
mat.forceSinglePass = true;
```

Two gotchas: (1) using `EffectComposer` bypasses the default framebuffer's MSAA — set `composer.renderTarget1.samples = 4`; (2) mip-mapped alpha fades, so distant foliage thins and vanishes. Fix both before `#include <alphatest_fragment>`:

```glsl
float mip = textureQueryLod(map, vMapUv).x;
diffuseColor.a *= 1.0 + max(0.0, mip) * 0.25;                    // Golus mipScale
diffuseColor.a = (diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5;
```

Shadow rules that matter: `castShadow = true` **only on LOD0 tiles**; **grass never casts** (fake it by darkening the ground shader with the density mask); alpha-tested casters need `customDepthMaterial` with the same `map` + `alphaTest` + wind injection; use [`examples/jsm/csm/CSM.js`](https://threejs.org/examples/webgl_shadowmap_csm.html) with 3×1024² cascades rather than one 4096²; and set `renderer.shadowMap.autoUpdate = false`, flipping `needsUpdate` only when the sun moves — a static-sun map renders shadows **once**.

---

## 4. WATER

### 4.1 Scene depth — the exact setup

```ts
const opaqueRT = new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  generateMipmaps: false, stencilBuffer: false,
});
opaqueRT.depthTexture = new THREE.DepthTexture(w, h);
opaqueRT.depthTexture.format = THREE.DepthFormat;
opaqueRT.depthTexture.type   = THREE.UnsignedIntType;   // DEPTH_COMPONENT24 — best default.
// UnsignedShortType bands visibly past far/near ≈ 5000; FloatType is ~2x bandwidth.
opaqueRT.depthTexture.minFilter = opaqueRT.depthTexture.magFilter = THREE.NearestFilter;
```

Render the opaque scene *without* water into it, using **layers** rather than `visible = false` so instanced/LOD bookkeeping stays intact:

```ts
const LAYER_WATER = 1;
water.layers.set(LAYER_WATER);
camera.layers.enableAll(); camera.layers.disable(LAYER_WATER);
renderer.setRenderTarget(opaqueRT); renderer.clear(); renderer.render(scene, camera);
camera.layers.enableAll();
renderer.setRenderTarget(null); renderer.render(scene, camera);
```

Cost: ~0.4–0.9 ms on a 200 k-tri scene at 1080p. Linearise with `#include <packing>`, which provides `perspectiveDepthToViewZ` / `viewZToOrthographicDepth` ([packing.glsl.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/packing.glsl.js)). Work in **view-space metres** so foam distances are authorable in world units.

```glsl
#include <packing>
vec2  screenUV = gl_FragCoord.xy / uResolution;
float sZ = perspectiveDepthToViewZ(texture2D(tDepth, screenUV).x, uNear, uFar);  // negative
float waterDepth = max(vViewZ - sZ, 0.0);
```

### 4.2 Depth colour ramp — quantised

Exponential (Beer-Lambert) beats a linear `mix` ([Catlike Coding](https://catlikecoding.com/unity/tutorials/flow/looking-through-water/)). **Quantising `t` — not the colour — is the single highest-value stylisation knob**: 4–6 bands reads exactly like a Wonderdraft bathymetric map.

```glsl
float t = 1.0 - exp2(-uDepthDensity * waterDepth);      // uDepthDensity ~0.06
#ifdef QUANTIZE
  float s = t * uBands;                                  // uBands 4..6
  t = (floor(s) + smoothstep(0.42, 0.58, fract(s))) / uBands;   // soft edge = no aliasing
#endif
vec3 waterCol = mix(uShallow, uDeep, t);
```

### 4.3 Shoreline foam — three layers

```glsl
float edge = 1.0 - smoothstep(0.0, uFoamDistance, waterDepth);     // uFoamDistance ~2.5

vec2 nUv0 = vWorldPos.xz*0.09 + vec2(uTime*0.020, uTime*0.013);
vec2 nUv1 = vWorldPos.xz*0.17 - vec2(uTime*0.011, uTime*0.024);
float n = texture2D(tFoamNoise, nUv0).r*0.6 + texture2D(tFoamNoise, nUv1).r*0.4;

float f = clamp(waterDepth / uFoamDistance, 0.0, 1.0);
f -= 0.35 * (1.0 - f) * sin((1.0 - f) * 14.0 - uTime * 2.0);       // inward-travelling stripes

float foamSoft  = 1.0 - step(0.55 + n*0.30 - 0.15, f);
float foamSharp = step(0.65, (1.0 - smoothstep(0.0, uFoamDistance*0.22, waterDepth)) + n*0.25);
float foam = clamp(foamSoft*0.65 + foamSharp, 0.0, 1.0);
waterCol = mix(waterCol, uFoamColor, foam * edge);
```

Sources: [Alexander Ameye](https://ameye.dev/notes/stylized-water-shader), [Harry Alisavakis](https://halisavakis.com/my-take-on-shaders-stylized-water-shader/).

### 4.4 Ripples: scrolling normals vs flow maps

**Ocean → scrolling primes.** `Water.js` sums four samples at prime-ratio scales; the prime denominators are what kill visible looping ([Water.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water.js)):

```glsl
vec2 uv0 = (uv/103.0) + vec2(time/17.0, time/29.0);
vec2 uv1 =  uv/107.0  - vec2(time/-19.0, time/31.0);
vec2 uv2 =  uv/vec2(8907.0,9803.0) + vec2(time/101.0, time/97.0);
vec2 uv3 =  uv/vec2(1091.0,1027.0) - vec2(time/109.0, time/-113.0);
vec4 noise = texture2D(normalSampler,uv0)+texture2D(normalSampler,uv1)
           + texture2D(normalSampler,uv2)+texture2D(normalSampler,uv3);
vec3 surfaceNormal = normalize((noise*0.5-1.0).xzy * vec3(1.5,1.0,1.5));
```

The ocean example uses `textureWidth/Height: 512, waterColor: 0x001e0f, distortionScale: 3.7`.

**Rivers → flow maps.** RG stores direction, neutral `(0.5,0.5)`, decode `flow = rg*2-1`; must be sampled **linear, not sRGB** ([VFXDoc](https://vfxdoc.readthedocs.io/en/latest/articles/flowmaps/)). The two-phase cycling trick prevents "the texture coordinates becom[ing] so distorted that the normal maps will be stretched" ([Graphics Runner](http://graphicsrunner.blogspot.com/2010/08/water-using-flow-maps.html)), and [`Water2.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js) already implements it:

```js
// cycle = 0.15, halfCycle = 0.075
config.value.x += flowSpeed * delta;
config.value.y  = config.value.x + halfCycle;
if (config.value.x >= cycle) { config.value.x = 0; config.value.y = halfCycle; }
else if (config.value.y >= cycle) { config.value.y -= cycle; }
```
```glsl
vec4 n0 = texture2D(tNormalMap0, vUv*config.w + flow*config.x);
vec4 n1 = texture2D(tNormalMap1, vUv*config.w + flow*config.y);
float flowLerp = abs(config.z - config.x) / config.z;      // triangle wave 1→0→1
vec4 normalColor = mix(n0, n1, flowLerp);
vec3 normal = normalize(vec3(normalColor.r*2.0-1.0, normalColor.b, normalColor.g*2.0-1.0));
```
Note the **`.r,.b,.g` swizzle** — `Water2` uses Z-up unpacking because the plane lies in XZ.

**Bake the river flow map from your polyline** in the same loop that builds the ribbon: `flowRG = dTangent.xz * 0.5 + 0.5`.

### 4.5 Toon + cartographic water

```glsl
vec3 N = surfaceNormal, V = normalize(uEye - vWorldPos), L = normalize(uSunDir);
float spec = pow(max(dot(N, normalize(L+V)), 0.0), uShininess);   // 64..256
spec = smoothstep(uSpecCut - 0.02, uSpecCut + 0.02, spec);        // cel step, uSpecCut ~0.55
spec *= step(0.45, n);                                            // break the blob into sparkles

float rim = (1.0 - smoothstep(0.0, uRimWidth, waterDepth))
          * pow(1.0 - max(dot(N,V),0.0), 1.5);

float ink = texture2D(tInkRipples, vWorldPos.xz*0.05 + vec2(uTime*0.006,0.0)).r;
float lines = step(0.72, ink) * (1.0 - t);                        // drawn ripples, shallow only

// CARTOGRAPHIC: world-space parchment that does NOT swim with the ripples.
// This is the trick that sells "map".
vec3 parchment = texture2D(tOceanPaper, vWorldPos.xz * uPaperScale).rgb;
waterCol *= mix(vec3(1.0), parchment, uPaperAmount);               // 0.25..0.5
```

For **drawn coastline strokes**, don't do it in the water shader — generate the coastline as a ribbon from the marching-squares contour of the heightmap at sea level (or use the terrain-shader coastline from §2.5d), so ink stays clean and controllable through zoom.

### 4.6 Reflections — use the fake

| Option | Cost | Verdict |
|---|---|---|
| `CubeCamera` + `WebGLCubeRenderTarget` | 6 full scene renders per update | Only if baked once, or one face per frame |
| `Reflector` / `Water.js` mirror | **1 extra full scene render**; +25–40% at 512², +40–100% at 1024². Uses [Lengyel oblique near-plane clipping](http://www.terathon.com/lengyel/Lengyel-Oblique.pdf) | Hero close-ups only, gated on camera distance |
| `SSRPass` | 4–8 ms, needs depth+normal prepass, **smears at grazing angles** | **Avoid** — grazing is exactly a map camera's angle |
| **Fake: sky gradient × Schlick fresnel** | ~0 ms | **Recommended** |

```glsl
float schlick(vec3 N, vec3 V, float F0) {   // F0 = 0.02 for water
  return F0 + (1.0-F0) * pow(1.0 - max(dot(N,V), 0.0), 5.0);
}
vec3 skyRefl = skyGradient(reflect(-V, N));      // the SAME function the skybox uses
col = mix(col, skyRefl, schlick(N,V,0.02) * uReflectAmount);   // 0.35..0.6
```

Sharing `skyGradient()` between sky, water, and fog is what makes the reflection *free* and coherent.

### 4.7 Rivers as ribbon meshes

```ts
function buildRiverRibbon(nodes: RiverNode[], sampleHeight: (x:number,z:number)=>number,
  opts = { samples: 256, widthPerOrder: 0.9, minWidth: 0.6, uvTileLength: 12, yEpsilon: 0.08 }) {
  // centripetal Catmull-Rom avoids cusps on tight meanders
  const curve = new THREE.CatmullRomCurve3(nodes.map(n=>n.pos), false, 'centripetal', 0.5);
  const P = curve.getSpacedPoints(opts.samples);      // ARC-LENGTH uniform — critical
  const UP = new THREE.Vector3(0,1,0);
  const pos:number[]=[], uv:number[]=[], idx:number[]=[]; let arc = 0;

  for (let i = 0; i <= opts.samples; i++) {
    const p = P[i], prev = P[Math.max(i-1,0)], next = P[Math.min(i+1,opts.samples)];
    if (i > 0) arc += p.distanceTo(prev);
    const dA = new THREE.Vector3().subVectors(p,prev).setY(0).normalize();
    const dB = new THREE.Vector3().subVectors(next,p).setY(0).normalize();
    const nA = new THREE.Vector3().crossVectors(UP,dA).normalize();
    const nB = new THREE.Vector3().crossVectors(UP,dB).normalize();
    const m  = new THREE.Vector3().addVectors(nA,nB).normalize();
    const miter = Math.min(1/Math.max(m.dot(nB), 0.25), 4.0);      // clamp or you get hairpin spikes
    const order = nodes[Math.min(Math.floor(i/opts.samples*(nodes.length-1)), nodes.length-1)].order;
    const halfW = 0.5 * Math.max(opts.minWidth, opts.widthPerOrder*Math.sqrt(order)) * miter;
    for (const s of [-1, 1]) {
      const x = p.x + m.x*halfW*s, z = p.z + m.z*halfW*s;
      pos.push(x, sampleHeight(x,z) + opts.yEpsilon, z);
      uv.push(s*0.5+0.5, arc / opts.uvTileLength);                 // UV.y = arc length → scrolls downstream
    }
    if (i > 0) { const a = (i-1)*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
  }
  /* build BufferGeometry */
}
```

Four points that matter:
- **`getSpacedPoints`, not `getPoints`.** Catmull-Rom isn't arc-length parameterised; unequal spacing makes `UV.y` and therefore scroll speed non-uniform.
- **Miter clamp at ~4×**, else hairpins spike. Above the clamp, bevel instead.
- **Carve, don't float.** `yEpsilon` alone z-fights on steep banks. Before meshing, run `h = min(h, riverBedH + falloff)` over heightmap texels within `halfW*2.5` of the polyline. You get free banks for the foam band too.
- **Not `TubeGeometry`** for surface rivers — Frenet frames twist through inflection points and your normal map spins. Reserve it for 3D channels.

**Waterfalls:** split where `|dy/ds| > tan(35°)`, emit a vertical quad strip scrolling `UV.y` at 1.0–2.0 (vs ~0.1 for the river), wobble `uv.x += sin(uv.y*12.0 + t*3.0)*0.05` ([Cyanilux](https://www.cyanilux.com/tutorials/waterfall-shader-breakdown/)), foam mask at top and base. At the river mouth, fade river alpha to 0 over ~3 river-widths while the ocean foam band picks it up — the two overlap and the seam disappears.

---

## 5. ATMOSPHERE

### 5.1 Sky — use a gradient, not Preetham

[`Sky.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js) is Preetham on a `BackSide` box scaled to 10000. Defaults: `turbidity 2, rayleigh 1, mieCoefficient 0.005, mieDirectionalG 0.8`. Warm painterly preset: `turbidity 8–14`, **`rayleigh 1.2–2.0` (lower = warmer — the best "illustrated" knob)**, `mieCoefficient 0.012–0.030`, sun elevation 4°–12°, `toneMappingExposure 0.35–0.6`.

Preetham's concrete limitations: luminance-only fit valid **only for a ground observer** ([Scratchapixel](https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky.html)); no ground albedo and no multiple scattering, so the horizon is too dark and too saturated; breaks below the horizon (Sky.js hacks it with `vSunfade` and an `EE = 1000.0` cutoff at `cutoffAngle = 1.611`); absolute units entirely dependent on your tonemapper; and being a `BackSide` box it must be excluded from depth prepasses and Reflector passes. Hosek-Wilkie fixes horizon behaviour and adds ground albedo but costs a per-frame CPU coefficient fit.

**For a stylized map, use a 3-stop gradient** — ~10 ALU, art-directable, palette-matchable to your parchment:

```glsl
vec3 skyGradient(vec3 d) {
  float t  = smoothstep(-0.02, 0.42, d.y);
  vec3 sky = mix(uHorizon, uZenith, pow(t, uZenithBias));            // uZenithBias 0.6..1.4
  sky      = mix(uGround, sky, smoothstep(-0.12, 0.0, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  sky += uSunColor * pow(sd, 420.0) * 3.0;                            // disc
  sky += uSunColor * pow(sd, 6.0) * 0.22 * (1.0 - t);                 // horizon bloom — sells sunset
  return sky;
}
```

Make this a shared GLSL function used by the sky dome, the water's fake reflection, and the fog colour. That coherence is most of the "one painting" effect.

### 5.2 Sun position → one LUT drives everything

Cheap parameterisation (what `webgl_shaders_ocean` does):
```ts
sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevationDeg),
                                 THREE.MathUtils.degToRad(azimuthDeg));
```
Real solar position via [NOAA equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF) if you want a plausible in-world calendar.

**The highest-leverage system in this document:** build a **256×4 gradient LUT PNG** (row 0 = sun colour, 1 = ambient, 2 = fog, 3 = horizon), indexed by `u = saturate(sunDir.y*0.5 + 0.5)` so `u = 0.5` is sunrise/sunset and golden hour gets a dense region. Decode once per frame:

```ts
function applyTimeOfDay(sunDir: THREE.Vector3) {
  const u = Math.round(THREE.MathUtils.clamp(sunDir.y*0.5 + 0.5, 0, 1) * 255);
  const px = (r: number) => { const i = (r*256 + u)*4;
    return new THREE.Color(lut[i]/255, lut[i+1]/255, lut[i+2]/255).convertSRGBToLinear(); };
  dirLight.color.copy(px(0));
  dirLight.intensity = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.18) * 3.0;
  dirLight.position.copy(sunDir).multiplyScalar(500);
  hemi.color.copy(px(1)); hemi.groundColor.copy(px(3));
  (scene.fog as THREE.FogExp2).color.copy(px(2));
  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uHorizon.value.copy(px(3));
  skyMat.uniforms.uSunColor.value.copy(px(0));
  waterMat.uniforms.uSunDir.value.copy(sunDir);
}
```

One texture edit re-times the entire world.

### 5.3 Fog — and why three.js's is flat

`THREE.Fog` → `smoothstep(near, far, vFogDepth)`. `THREE.FogExp2` → `1 - exp(-density² · depth²)` (note it's density² *and* depth² — squared-exponential, not Beer-Lambert). **The gotcha:** in every three.js material the chunk order is `<tonemapping_fragment>` → `<colorspace_fragment>` → `<fog_fragment>`, so **fog is mixed in output sRGB space, after tonemapping**. That's exactly why three.js fog looks flat and washes highlights. Do it yourself, before tonemapping.

Exponential height fog, the analytic integral from [IQ's "Better Fog"](https://iquilezles.org/articles/fog/):

```glsl
vec3 applyHeightFog(vec3 col, vec3 ro, vec3 rd, float t, vec3 fogCol) {
  float ry = rd.y, fogAmount;
  if (abs(ry) < 1e-4) fogAmount = uFogA * exp(-ro.y*uFogB) * t;          // analytic limit
  else fogAmount = (uFogA/uFogB) * exp(-ro.y*uFogB) * (1.0 - exp(-t*ry*uFogB)) / ry;
  return mix(col, fogCol, 1.0 - exp(-fogAmount));
}
```
**Guard `ry ≈ 0`** — a near-horizontal map camera hits it constantly and you get NaN bands.

### 5.4 Aerial perspective — the biggest single contributor to the painterly look

Two ideas combined: IQ's sun-direction fog tint, and **per-channel densities** so blue thickens first. A single fog colour cannot express the real deep-blue → pale-blue → white progression of distant mountains ([runevision](https://blog.runevision.com/2025/06/notes-on-atmospheric-perspective-and.html)).

```glsl
uniform vec3  uAerialDensity;   // vec3(0.0021, 0.0026, 0.0035) — blue thickens first
uniform float uDesat;           // 0.55
uniform float uLiftBlacks;      // 0.25

vec3 aerialPerspective(vec3 col, float dist, vec3 rd, vec3 sunDir, vec3 sunCol) {
  vec3 f = 1.0 - exp(-dist * uAerialDensity);
  vec3 fogCol = skyGradient(rd);                                  // SAME function as the sky
  fogCol = mix(fogCol, sunCol, pow(max(dot(rd,sunDir),0.0), 8.0) * 0.85);
  float k = max(max(f.r, f.g), f.b);
  col = mix(col, vec3(dot(col, vec3(0.2126,0.7152,0.0722))), k * uDesat);
  col = mix(col, col*(1.0-uLiftBlacks) + fogCol*uLiftBlacks, k);   // lift blacks / kill contrast
  return mix(col, fogCol, f);
}
```

Inject by replacing `#include <tonemapping_fragment>` with your call *followed by* the original include.

### 5.5 God rays — use mesh shafts

three.js's [`GodRaysShader.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/shaders/GodRaysShader.js) does 3 passes × 6 taps with step sizes `1.0, 1/6, 1/36` — an effective **216-sample ray for 18 fetches** — at `godrayRenderTargetResolutionMultiplier = 1/4` (480×270 at 1080p). Total ~0.5–1.2 ms.

But **for a map view use mesh shafts instead**: a cone or 3–5 crossed quads from the sun, `AdditiveBlending`, `depthWrite: false`, with soft-particle depth fade so they don't cut into terrain ([NVIDIA](https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf)):

```glsl
#include <packing>
float sceneZ = perspectiveDepthToViewZ(texture2D(tDepth, gl_FragCoord.xy/uResolution).x, uNear, uFar);
float soft = clamp((vViewZ - sceneZ) / uSoftness, 0.0, 1.0);              // uSoftness ~4.0
float rim  = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDirW))), 1.6);
float fall = 1.0 - vUv.y;
gl_FragColor = vec4(uShaftColor * uIntensity * soft * rim * fall * fall, 1.0);
```

**~0.1 ms, fully art-directable, and it works when the sun is offscreen** — which the radial-blur version cannot do.

### 5.6 Clouds — do the shadows, skip the volumetrics

- **Billboards:** one `InstancedMesh` of camera-facing quads (billboard in the VS so you keep instancing), `depthWrite: false`, soft-particle fade, sorted back-to-front. 300–800 quads ≈ 0.4–1.0 ms at 1080p if overdraw stays under ~4×.
- **Raymarched:** [Maxime Heckel's parameters](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) — `MAX_STEPS 50, MAX_STEPS_LIGHTS 6, MARCH_SIZE 0.16, ABSORPTION 0.9`, dithered start via blue noise. **3–8 ms at 960×540 on a GTX 1060.** Budget-breaking. High-quality toggle only.
- **Cloud shadows on terrain — do this one.** Two fetches, ~0.05 ms, and it does more for atmosphere than everything else combined.

```glsl
float cloudShadow(vec3 worldPos) {
  // Walk from the surface up the sun ray to a virtual cloud plane, then read XZ.
  // This is what gives the correct oblique offset at low sun — with no shadow map.
  float t = (uCloudPlaneY - worldPos.y) / max(uSunDir.y, 0.15);
  vec2 uv = (worldPos.xz + uSunDir.xz * t) * uCloudScale + uCloudWind * uTime * uCloudScale;
  float n  = texture2D(tCloudNoise, uv).r;
  float n2 = texture2D(tCloudNoise, uv*2.17 + vec2(0.37,-0.21)).r;    // non-integer 2nd octave
  n = n*0.62 + n2*0.38;
  return mix(1.0 - uCloudStrength, 1.0, smoothstep(uCloudCover, uCloudCover + 0.22, n));
}
```

Inject so it multiplies **direct light only** — that's what keeps shadowed ground from going muddy:

```ts
shader.fragmentShader = shader.fragmentShader
  .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    float cs = cloudShadow(vWorldPosCS);
    reflectedLight.directDiffuse  *= cs;
    reflectedLight.directSpecular *= cs;`);
```

Feed the same noise + wind into the water shader's specular and shadows sweep the ocean too.

### 5.7 What actually gives FlowScape its mood

**Documented, in the dev's own words:**
- **DOF is a depth-buffer post effect and he says so:** *"In realtime engines, this is a trick, where it will make a greyscale image from front to the back of the scene (depthmap) and use that to blur different objects. Its not perfect and has artifacts, especially with anti aliasing"* ([Steam thread](https://steamcommunity.com/app/1043390/discussions/0/1636416951447722282/)). Users get **Camera FOV, Aperture, Focus Distance**. Wide-aperture DOF on a foreground element is FlowScape's #1 signature.
- **"Colored fog and sun shafts"** ([Aug 1 2019 devlog](https://pixelforest.itch.io/flowscape/devlog)) — "sun shafts" is verbatim Unity Standard Assets naming.
- **"Oceans and Volumetric Fog"** (Sep 15 2019); **"Sun lines up with the reflection"** (Sep 19 2019) — a real view-dependent specular, not a static cubemap.
- **Ambient Occlusion** that "darken[s] the corner light, add[s] contrast" ([Fox Render Farm](https://www.foxrenderfarm.com/share/Function-Introduction-of-3D-Landscape-Creation-Tool-Flowscape/)).
- **Skies are image-based**: 24 skyboxes + Sky Rotation, plus a Sun/Moon toggle with direction and height sliders ([Steam](https://store.steampowered.com/app/1043390/FlowScape/)). Not a procedural atmosphere.
- Water exposes a **Fresnel** slider directly. 300+ models, 24 4K terrain textures, DirectX 11, 1–4 GB VRAM. An **"Adaptive quality"** toggle.

**Inferred (high confidence):** Unity built-in RP + Post Processing Stack v2 — the effect names, DX11-only, and 1 GB VRAM floor all point there. Chain is almost certainly AO → bloom → DOF → colour grading LUT → vignette → tonemap, with **bloom set aggressively high** (that soft glow on every highlight is the second signature after DOF). Vegetation is alpha-tested cross-planes and billboards, not real geometry — which is why 300+ models run on 1 GB. One directional light + ambient, no baked GI. AA is post-process, which is precisely why it fights the depth-based DOF.

**Steal, in priority order:** (1) heavy bloom on a *small number* of deliberately bright elements; (2) strong aerial perspective + coloured fog keyed to sun direction; (3) cloud shadows sweeping the terrain; (4) subtle DOF blurring only extreme foreground and far background; (5) mesh light shafts. **Explicitly skip:** raymarched clouds, SSR, per-frame planar reflections.

---

## 6. NPR POST-PROCESSING

### 6.1 Composer setup and the colour rule

The r152+ rule: **all intermediate targets stay Linear-sRGB; conversion to display sRGB happens exactly once, in `OutputPass`, at the end** ([Color Management](https://threejs.org/manual/en/color-management.html)). The docs note that "if a pass requires sRGB input (e.g. like FXAA), the pass must follow OutputPass" ([OutputPass.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/postprocessing/OutputPass.js)).

```ts
const renderer = new THREE.WebGLRenderer({
  antialias: false,            // MSAA is wasted — post reads a texture, not the default FB
  powerPreference: 'high-performance', stencil: false, alpha: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // or NeutralToneMapping for a flatter map look
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  colorSpace: THREE.LinearSRGBColorSpace, samples: 0, depthBuffer: true,
});
const composer = new EffectComposer(renderer, rt);
```

### 6.2 Pass order — and why

```
1  RenderPass                        (scene → linear HDR)
2  G-buffer (MRT: viewNormal + linear depth)
3  GTAOPass
4  Anisotropic Kuwahara              (HALF RES: tensor → blurH → blurV → filter → upsample)
5  UnrealBloomPass
6  Ink/outline composite             (reads G-buffer + colour)
7  Tilt-shift
8  LUTPass
9  OutputPass                        (tone map + linear→sRGB, ONE conversion)
10 SMAAPass                          (needs sRGB input → after OutputPass)
11 Paper + grain + vignette + CA     (one merged sRGB pass, 1:1 pixels, last)
```

- **AO before Kuwahara.** Kuwahara turns AO into painterly dirt in the crevices — exactly the inked wash you want. Reversed, Kuwahara's flat regions defeat GTAO's normal-derived horizon search.
- **Kuwahara before outlines, unconditionally.** Kuwahara is variance-*minimising*: a 1–2 px dark ink line inside the kernel is a maximum-variance feature and the filter **discards the sector containing it**. Ink drawn before Kuwahara is erased or smeared into mush. Your edges come from depth+normals, so Kuwahara never touches the edge signal.
- **Bloom before ink.** Bloom applied after the composite bleeds bright terrain over lines and erodes them. Legibility wins.
- **DOF after ink** — distant coastlines *should* lose their ink weight; that's the diorama trick. Sharp lines over blurred terrain read as a UI overlay, not a drawing.
- **AA last.** Note pmndrs sequences AA early ([Effect Merging](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging)); for an ink pipeline that's wrong, because the 1 px ink is generated after their SMAA slot and never gets antialiased.
- **Paper absolutely last.** Any pass after it resamples fibre into grey mush. Real map paper is *in front of* the ink.

### 6.3 Kuwahara — the expensive one

Basic 4-quadrant costs `4(r+1)²` samples and quantises orientation to 90° (visible blockiness). Generalized (Papari) uses 8 Gaussian-weighted sectors and a soft weighted blend `wᵢ = 1/(1 + (hardness·σᵢ²)^(q/2))`, removing sector-switch flicker. **Anisotropic** (Kyprianidis) deforms the disc to an ellipse aligned to the structure tensor with `a = ((α+A)/α)r, b = (α/(α+A))r` — so `a·b = r²` and **sample count is invariant to anisotropy, ≈ πr²** ([NPAR 2011](https://www.kyprianidis.com/p/npar2011/jkyprian-npar2011.pdf); paper params `q=8, w=0.02, σ_r=0.4, α≈1`).

Four `ShaderPass` stages. Stages 1–3 build the tensor field (Sobel 6 taps → separable Gaussian 11+11 taps → eigen-decompose):

```glsl
// stage 3: eigen-decomposition of the smoothed tensor (Jxx, Jyy, Jxy)
float disc = sqrt(g.y*g.y - 2.0*g.x*g.y + g.x*g.x + 4.0*g.z*g.z);
float lambda1 = 0.5*(g.y + g.x + disc);
float lambda2 = 0.5*(g.y + g.x - disc);
vec2  v = vec2(lambda1 - g.x, -g.z);
vec2  t = length(v) > 0.0 ? normalize(v) : vec2(0.0, 1.0);
float phi = -atan(t.y, t.x);
float A   = (lambda1 + lambda2 > 0.0) ? (lambda1 - lambda2)/(lambda1 + lambda2) : 0.0;
gl_FragColor = vec4(t, phi, A);     // TFM buffer
```

Stage 4, ported from [Acerola's `AnisotropicKuwahara.shader`](https://github.com/GarrettGunnell/Post-Processing/blob/main/Assets/Kuwahara%20Filter/AnisotropicKuwahara.shader):

```glsl
uniform sampler2D tDiffuse, tTFM;
uniform vec2 uTexel;
uniform float uAlpha, uZeta, uZeroCrossing, uHardness, uQ;   // 1.0, 0.1..2/r, 0.58, 8.0, 8.0
uniform int uKernelSize;
#define MAX_R 16

void main() {
  vec4 t = texture2D(tTFM, vUv);
  float r = float(uKernelSize) * 0.5;
  float a = r * clamp((uAlpha + t.w)/uAlpha, 0.1, 2.0);
  float b = r * clamp(uAlpha/(uAlpha + t.w), 0.1, 2.0);
  float cp = cos(t.z), sp = sin(t.z);
  mat2 SR = mat2(0.5/a, 0.0, 0.0, 0.5/b) * mat2(cp, sp, -sp, cp);
  int max_x = int(sqrt(a*a*cp*cp + b*b*sp*sp));
  int max_y = int(sqrt(a*a*sp*sp + b*b*cp*cp));
  float sinZC = sin(uZeroCrossing);
  float eta = (uZeta + cos(uZeroCrossing)) / (sinZC*sinZC);

  vec4 m[8]; vec3 s[8];
  for (int k=0;k<8;++k){ m[k]=vec4(0.0); s[k]=vec3(0.0); }

  for (int y=-MAX_R; y<=MAX_R; ++y) { if (y<-max_y||y>max_y) continue;
  for (int x=-MAX_R; x<=MAX_R; ++x) { if (x<-max_x||x>max_x) continue;
    vec2 v = SR * vec2(float(x), float(y));
    if (dot(v,v) > 0.25) continue;                          // outside ellipse
    vec3 c = clamp(texture2D(tDiffuse, vUv + vec2(float(x),float(y))*uTexel).rgb, 0.0, 1.0);
    float w[8]; float sum = 0.0; float z, vxx, vyy;
    vxx = uZeta - eta*v.x*v.x; vyy = uZeta - eta*v.y*v.y;
    z=max(0.0, v.y+vxx); w[0]=z*z; sum+=w[0];
    z=max(0.0,-v.x+vyy); w[2]=z*z; sum+=w[2];
    z=max(0.0,-v.y+vxx); w[4]=z*z; sum+=w[4];
    z=max(0.0, v.x+vyy); w[6]=z*z; sum+=w[6];
    v = 0.7071067 * vec2(v.x - v.y, v.x + v.y);             // rotate 45° for odd sectors
    vxx = uZeta - eta*v.x*v.x; vyy = uZeta - eta*v.y*v.y;
    z=max(0.0, v.y+vxx); w[1]=z*z; sum+=w[1];
    z=max(0.0,-v.x+vyy); w[3]=z*z; sum+=w[3];
    z=max(0.0,-v.y+vxx); w[5]=z*z; sum+=w[5];
    z=max(0.0, v.x+vyy); w[7]=z*z; sum+=w[7];
    float g = exp(-3.125*dot(v,v)) / sum;
    for (int k=0;k<8;++k){ float wk = w[k]*g; m[k] += vec4(c*wk, wk); s[k] += c*c*wk; }
  }}

  vec4 outCol = vec4(0.0);
  for (int k=0;k<8;++k) {
    m[k].rgb /= m[k].w;
    s[k] = abs(s[k]/m[k].w - m[k].rgb*m[k].rgb);
    float wgt = 1.0/(1.0 + pow(uHardness*1000.0*(s[k].r+s[k].g+s[k].b), 0.5*uQ));
    outCol += vec4(m[k].rgb*wgt, wgt);
  }
  gl_FragColor = vec4(clamp(outCol.rgb/outCol.w, 0.0, 1.0), 1.0);
}
```

**Cost — this is the number that decides your architecture:**

| r | samples/px | worst-case iters/px | ALU/px | 1080p | 1440p |
|---|---|---|---|---|---|
| 4 | 50 | 289 | ~5,000 | 10.4 GOP | 18.4 GOP |
| **6** | **113** | **625** | **~11,300** | **23.4 GOP** | **41.7 GOP** |
| 8 | 201 | 1089 | ~20,100 | 41.7 GOP | 74.1 GOP |

At r=6 **full res**: ~5–8 ms on a GTX 1660, 8–12 ms on M1, 15–25 ms on Iris Xe. **That alone blows the frame budget.**

**Non-negotiable mitigation: run the entire 4-stage chain at half resolution and bilinear-upsample** → 1.3–2.0 ms at 1080p on a 1660. Halve `r` too (r=3 at half res ≈ r=6 apparent) for another 4× → ~0.4 ms. Combined 16×. This is the single highest-leverage optimisation in the whole pipeline. The tensor stages can run at *quarter* res — orientation is a low-frequency field.

### 6.4 Edge detection on depth + normals

**G-buffer:** use MRT — `new THREE.WebGLRenderTarget(w, h, { count: 2, type: HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) })`, `rt.textures[0]` colour, `[1]` view normal. One geometry pass, **zero extra draw calls**. The alternative (`scene.overrideMaterial = new THREE.MeshNormalMaterial()`, which is what `GTAOPass` does internally) **doubles your draw calls** and silently drops alpha-tested foliage cutouts. If you're running `GTAOPass`, hand it your existing textures via `parameters.depthTexture` / `parameters.normalTexture` so it skips its own pass.

**Roberts cross beats Sobel here** — 4 taps vs 8, and for 1 px ink the response is indistinguishable ([Ameye](https://ameye.dev/notes/edge-detection-outlines/)):

```glsl
float robertsCross(vec3 s[4]) {
  vec3 d1 = s[1] - s[2], d2 = s[0] - s[3];
  return sqrt(dot(d1,d1) + dot(d2,d2));
}
```

**The grazing-angle problem:** a ground plane at a shallow angle has huge per-pixel depth deltas even though it's flat, so a fixed threshold paints the whole foreground black. Scale the threshold by how edge-on the surface is, and by depth so line density stays constant as you zoom ([Roystan](https://roystan.net/articles/outline-shader/)):

```glsl
float NdotV = 1.0 - dot(viewNormal, -viewSpaceDir);
float nt01  = clamp((NdotV - uDepthNormalThreshold)/(1.0 - uDepthNormalThreshold), 0.0, 1.0);
float depthThreshold = uDepthThreshold * depth0 * (nt01 * uDepthNormalThresholdScale + 1.0);
```
Values: `uDepthThreshold ≈ 1/200`, `uDepthNormalThreshold ≈ 0.5`, `uDepthNormalThresholdScale ≈ 7.0`, normal threshold `≈ 1/4`.

**`OutlinePass` vs a full-screen pass:** `OutlinePass` allocates ~7 render targets, does 8–10 fullscreen draws, and re-renders the scene twice ([OutlinePass.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/postprocessing/OutlinePass.js)). **Use it for hover/selection highlights on map pins, never for base ink** — a global Roberts pass is one draw at ~0.2 ms/1080p.

### 6.5 Making the line look inked

```glsl
vec2 wob = (texture2D(tNoise, vUv*uNoiseScale).rg - 0.5) * uWobble * uTexel;   // uWobble ≈ 2.5 px
float widthMod = 0.75 + 0.5 * texture2D(tNoise, vUv*uNoiseScale*0.23 + 0.37).b;
float e = edgeMagnitude(vUv + wob) * widthMod;
float fibre = texture2D(tPaper, gl_FragCoord.xy / uPaperSize).r;
float ink = smoothstep(uT0, uT1, e) * mix(1.0, fibre, uFibreBite);   // uFibreBite ≈ 0.55
ink = step(uDryBrush, ink) * ink;                                    // uDryBrush ≈ 0.18
vec3 inkColor = mix(vec3(0.14,0.10,0.08), vec3(0.26,0.19,0.13), fibre);   // NEVER pure black
gl_FragColor = vec4(mix(sceneColor, inkColor, ink * uInkStrength), 1.0);
```

### 6.6 Paper overlay — screen-space, and why

- **Screen-space (`gl_FragCoord.xy / uPaperSize`):** the paper is *the sheet you're looking at*; pan the camera and fibre stays put. Correct for "illustrated map" — the world moves behind the paper. Also the only option that keeps 1:1 pixel tiling.
- **World/triplanar:** paper crawls over mountains in perspective. Reads as *textured 3D model*, not drawing. Use only as faint terrain grain (§2.5e), never as the final overlay.

```glsl
vec3 blendOverlay(vec3 base, vec3 blend) {      // preserves darks and lights; fibre hits mid-tones
  return mix(2.0*base*blend, 1.0 - 2.0*(1.0-base)*(1.0-blend), step(0.5, base));
}
vec2 puv = gl_FragCoord.xy / uPaperSize;
gl_FragColor = vec4(mix(c, blendOverlay(c, texture2D(tPaper, puv).rgb), uPaperStrength), 1.0);
```

**The 1:1 rule:** `RepeatWrapping`, `generateMipmaps = false`, divide `gl_FragCoord` by the texture's *true* pixel size. Any scaling turns fibre into bilinear grey mush that reads as noise. 2048² tile at 1080p repeats less than once per axis.

### 6.7 Cross-hatching

Six tone levels packed into the RGB of **two** textures — 2 fetches instead of 6 ([Kyle Halladay](https://kylehalladay.com/blog/tutorial/2017/02/21/Pencil-Sketch-Effect.html)):

```glsl
vec3 hatching(vec2 uv, float intensity) {
  vec3 h0 = texture2D(tHatchA, uv).rgb, h1 = texture2D(tHatchB, uv).rgb;
  vec3 overbright = max(vec3(0.0), vec3(intensity - 1.0));
  vec3 wA = clamp(intensity*6.0 + vec3( 0.0,-1.0,-2.0), 0.0, 1.0);
  vec3 wB = clamp(intensity*6.0 + vec3(-3.0,-4.0,-5.0), 0.0, 1.0);
  wA.xy -= wA.yz; wA.z -= wB.x; wB.xy -= wB.yz;      // only 2 adjacent levels nonzero, sum = 1
  h0 *= wA; h1 *= wB;
  return overbright + h0.r+h0.g+h0.b + h1.r+h1.g+h1.b;
}
```
Apply **only where slope is steep** (`1.0 - viewNormal.z` from the G-buffer) → engraved mountains, clean plains. 2 taps + ~20 ALU, effectively free.

### 6.8 LUT, bloom, vignette

```ts
const lutPass = new LUTPass({ intensity: 0.85 });
new LUTCubeLoader().load('/luts/parchment_32.cube', (r) => { lutPass.lut = r.texture3D; });
```
`LUTPass` uses `sampler3D` (`Data3DTexture`) exclusively — no 2D-strip fallback. **32³ is right** (128 KB, indistinguishable from 64³ for stylised grading). Authoring: screenshot un-graded, grade over a Neutral LUT strip in Resolve/Lightroom, export `.cube`.

`UnrealBloomPass` runs **13 fullscreen draws** (1 high-pass + 5 mips × H/V + composite + blend, mip weights `[1.0, 0.8, 0.6, 0.4, 0.2]`), but mips sum to only ~1/3 of full res → **~0.6–1.0 ms at 1080p**. The 13 target binds cost more CPU than the fragments do. Painterly values: **`strength 0.35, radius 0.9, threshold 0.85`** — low strength + high radius = atmospheric haze, not sci-fi glow.

Merge vignette + grain + CA into one pass (3 taps + ~35 ALU ≈ 0.25 ms; as three separate `ShaderPass`es it's ~0.9 ms):

```glsl
vec2 d = vUv - 0.5; float r2 = dot(d,d);
vec2 off = d * r2 * uCA;                                        // uCA ≈ 0.010
vec3 c = vec3(texture2D(tDiffuse, vUv+off).r, texture2D(tDiffuse, vUv).g,
              texture2D(tDiffuse, vUv-off).b);
c *= mix(1.0, smoothstep(0.85, 0.28, length(d)*1.414), uVignette);   // smoothstep, not pow — no banding
float n = fract(sin(dot(vUv*uTime, vec2(12.9898,78.233)))*43758.5453);
float lum = dot(c, vec3(0.2126,0.7152,0.0722));
c += (n-0.5) * uGrain * (1.0 - abs(lum*2.0-1.0));               // luminance-weighted, shadows stay clean
```

### 6.9 Tilt-shift, not DOF

`BokehPass` **re-renders the entire scene** with `MeshDepthMaterial` — on a 900-call scene that's +900 draw calls, 4–6 ms CPU. pmndrs `DepthOfFieldEffect` is far better (CoC pass + Kawase blur, `resolutionScale: 0.5` default, reuses composer depth) at ~1.5–2.5 ms.

But **tilt-shift is both cheaper and more correct for a map**. A fantasy map is viewed from a fixed high oblique angle, so **screen-Y *is* depth** — the correlation is near-perfect and monotonic. Depth-driven DOF produces the same image while costing depth fetches and near/far-field separation. Tilt-shift additionally *is* the literal optical technique behind [miniature faking](https://en.wikipedia.org/wiki/Miniature_faking) — you get the diorama read by definition. And it never has the depth-discontinuity halo that would ruin your ink lines.

```glsl
float t = clamp((abs(vUv.y - uFocusY) - uBandWidth)/(1.0 - uBandWidth), 0.0, 1.0);
float blur = t * t * uMaxBlur;                                  // quadratic ramp
if (blur < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }   // early-out ~40% of screen
vec3 acc = vec3(0.0);
for (int i = 0; i < 13; ++i) acc += texture2D(tDiffuse, vUv + P[i]*blur*uTexel).rgb;  // 13-tap Poisson
gl_FragColor = vec4(acc / 13.0, 1.0);
```
**~0.2 ms real at 1080p — 7–10× cheaper than `DepthOfFieldEffect`.** (The `const vec2 P[13]` initialiser needs `THREE.GLSL3`; otherwise use a `uniform vec2 uPoisson[13]`.)

### 6.10 Use pmndrs/postprocessing — for the cheap effects

`EffectPass` merges its `Effect`s into **one** fragment shader chaining `mainImage()` calls in-register ([Effect Merging](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging)). One 1080p RGBA16F fullscreen pass moves 2.07 Mpx × 8 B × 2 = **33 MB**; on a 192 GB/s GTX 1660 that's ~0.28 ms real. Merging 6 trivial effects eliminates 5 round-trips:

- GTX 1660 @1080p: **save ~1.4 ms** (8.4% of frame)
- Apple M1 @1080p: **save ~2.8 ms** (17%)
- GTX 1660 @1440p: **save ~2.5 ms** (15%)

Plus 5 fewer FBO binds per frame (~0.05–0.1 ms each through ANGLE).

**Constraint:** only one *convolution* effect per `EffectPass`. So Kuwahara stays as dedicated passes — correct anyway.

```ts
class PaperEffect extends Effect {
  constructor(tex: Texture, strength = 0.45) {
    super('PaperEffect', paperFrag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.NONE,                     // no extra input taps → mergeable
      uniforms: new Map([
        ['uPaper', new Uniform(tex)],
        ['uPaperSize', new Uniform(new Vector2(tex.image.width, tex.image.height))],
        ['uStrength', new Uniform(strength)],
      ]),
    });
  }
}
composer.addPass(new EffectPass(camera, new SMAAEffect()));                     // convolution: own pass
composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 0.35 }))); // convolution: own pass
composer.addPass(new EffectPass(camera,                                         // ALL merged into ONE shader
  new TiltShiftEffect({ focusArea: 0.35, feather: 0.4, bias: 0.06 }),
  new LUT3DEffect(lut3D), new ToneMappingEffect(),
  new PaperEffect(paperTex, 0.45),
  new VignetteEffect({ darkness: 0.45, offset: 0.32 }),
  new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true }),
  new ChromaticAberrationEffect(),
));
```

---

## 7. CITY IN 3D

### 7.1 Footprint → geometry

`ExtrudeGeometry` calls `THREE.ShapeUtils.triangulateShape()` → `THREE.Earcut.triangulate()`. It **requires CCW outer / CW holes** and fails silently ("Probably Hole outside Shape!") on self-intersecting or duplicate-point rings — run dedupe + `ShapeUtils.isClockWise()` normalisation on every footprint first.

But `ExtrudeGeometry`'s default UVs are useless for tiling brick. **Write your own wall builder** — ~40 lines, giving arc-length UVs, correct outward normals, and a slot for per-vertex AO:

```ts
function buildWalls(ring: THREE.Vector2[], y0: number, y1: number, uvScale = 2.0) {
  const pos:number[]=[], nrm:number[]=[], uv:number[]=[], idx:number[]=[];
  let arc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i+1) % ring.length];
    const ex = b.x-a.x, ez = b.y-a.y, len = Math.hypot(ex, ez);
    if (len < 1e-5) continue;
    const nx = ez/len, nz = -ex/len;                    // outward normal for a CCW ring
    const u0 = arc/uvScale, u1 = (arc+len)/uvScale, v0 = y0/uvScale, v1 = y1/uvScale;
    const base = pos.length/3;
    pos.push(a.x,y0,a.y,  b.x,y0,b.y,  b.x,y1,b.y,  a.x,y1,a.y);
    for (let k=0;k<4;k++) nrm.push(nx, 0, nz);
    uv.push(u0,v0, u1,v0, u1,v1, u0,v1);
    idx.push(base,base+1,base+2, base,base+2,base+3);
    arc += len;
  }
  /* build BufferGeometry */
}
```

Because `u` is **cumulative arc length in world metres / uvScale**, brick tiles at a constant real-world size on every wall regardless of footprint shape. Snap the final `arc` to `Math.round(arc/uvScale)*uvScale` to kill the wrap seam.

### 7.2 Roofs

- **Flat/parapet:** `ShapeUtils.triangulateShape()` cap at `y = h` + a 0.3 m band above.
- **Pyramid:** centroid apex, fan `[i, i+1, apex]`. One line, reads great on towers.
- **Gable:** minimum-area bounding rectangle (rotating calipers over the convex hull, ~30 lines), ridge down the long axis, two sloped quads + two gable ends. **Covers 90% of medieval houses, which are rectangles.**
- **Hip (correct):** straight skeleton — offset every edge inward at a uniform rate, lift by `offset·tan(pitch)`. [`straight-skeleton`](https://github.com/StrandedKitty/straight-skeleton) (CGAL→Wasm, handles holes, needs `await SkeletonBuilder.init()`). Robust but slow — **bake it offline**.
- **Hip (cheap substitute, recommended):** inset the ring by `d` with clipper-lib, lift by `d·tan(pitch)`. Exact for convex, fine for mildly concave, degenerate for spiky — detect via offset-ring area > 0 and fall back to pyramid. **A 5,000-building stylized city does not need mathematically correct hips.**

### 7.3 Batching 5,000 buildings

Stylized medieval building ≈ 150–350 tris (call it 300). 5,000 × 300 = **1.5 M tris**.

| Strategy | Draw calls | VRAM | Per-building variation | Culling |
|---|---|---|---|---|
| One Mesh each | **5,000** ❌ | — | total | per building |
| `mergeGeometries()`, whole city | 1 | ~66 MB | total | **none** ❌ |
| **`mergeGeometries()` per district (~80 bldgs)** | **~63** ✅ | ~66 MB | **total, incl. baked vertex AO** | **per district** ✅ |
| `InstancedMesh`, 20 archetypes | 20 ✅ | ~2 MB | colour only | per archetype ❌ |
| `BatchedMesh`, 20 geometries | 1 ✅ | ~2 MB | colour + `setVisibleAt` | **per instance** ✅ |

**Recommendation: merge per district.** ~63 calls is well inside budget, you get **per-vertex baked AO** (the biggest visual win, impossible with instancing), and district-granularity culling is exactly right. Use `mergeGeometries(geoms, false)` with one `vertexColors: true` material; verify with `BufferGeometryUtils.estimateBytesUsed()`.

Use `BatchedMesh` instead only if buildings appear/disappear at runtime (construction, editor mode). Use `InstancedMesh` for repeated props — barrels, carts, lamp posts, wall towers.

### 7.4 Lighting stylized buildings

Since r155 three.js uses physical light units, so intensities are higher than old tutorials suggest:

```ts
const sun  = new THREE.DirectionalLight(0xfff0d0, 3.0);            // warm key
sun.position.set(-60, 90, 40); sun.castShadow = true;
const hemi = new THREE.HemisphereLight(0x9fc8ff, 0xd9b48a, 1.6);   // cool sky / bounced ground
```
`HemisphereLight` is the classic stylized 2-tone rig — sky colour on roofs, ground colour on eaves and under-arches, readable form at zero shadow cost.

**Baked AO in vertex colours** — the two effects that actually sell stylized architecture are **cavity darkening where walls meet ground** and **streets darkening between tall buildings**:

```ts
function vertexAO(v: THREE.Vector3): number {
  const contact = THREE.MathUtils.smoothstep(v.y, 0.0, 2.5);
  let occ = 0, n = 0;
  for (let r = 2; r <= 12; r += 2) for (let a = 0; a < 8; a++) {
    const th = a/8 * Math.PI * 2;
    const hh = sampleHeightGrid(v.x + Math.cos(th)*r, v.z + Math.sin(th)*r);   // 2 m city height field
    occ += THREE.MathUtils.clamp((hh - v.y)/r, 0, 1) * (1/r);
    n += 1/r;
  }
  return THREE.MathUtils.clamp((0.55 + 0.45*contact) * (1.0 - 0.75*(occ/n)), 0.25, 1.0);
}
```
~50 ms for 5,000 buildings at generation time. Higher quality: [`geo-ambient-occlusion`](https://github.com/wwwtyro/geo-ambient-occlusion), run offline per district and cached.

**Rim light** (makes buildings pop against fog): `outgoingLight += uRimColor * pow(1.0 - max(dot(viewNormal, vec3(0,0,1)), 0.0), 3.0) * 0.35;`

**Emissive windows at night:** don't use per-window emissive materials. Build a *second* merged geometry of window quads offset 2 cm from the wall, `MeshBasicMaterial({ vertexColors: true, toneMapped: false })`, warm orange ±30% brightness, ~15% dark. Because `toneMapped = false` pushes those pixels above 1.0, **only the windows bloom** under a `threshold 0.9` bloom pass. One merged mesh, one draw call, one boolean to fade with the day/night cycle.

### 7.5 City LOD

| Distance | Representation | Tris |
|---|---|---|
| 0–150 m | Full district merge (walls, roofs, chimneys, windows) | ~300/bldg |
| 150–400 m | Merge without props/windows, roof → 4 tris | ~60/bldg |
| 400–1200 m | **Town blob**: one extruded silhouette per district at median height + roof-coloured cap | ~200/district |
| >1200 m | One camera-facing textured quad per town (bake the blob to a 512² atlas at load) | 2 |

Districts *are* per-object, so the built-in `THREE.LOD` works here:
```ts
district.addLevel(fullMesh, 0, 0.15);      // hysteresis 15% kills boundary flicker
district.addLevel(midMesh, 150, 0.15);
district.addLevel(blobMesh, 400, 0.15);
district.addLevel(impostor, 1200, 0.15);
```

**Switch on projected size, not a magic distance** — a fantasy-map camera zooms a lot. Swap when the town projects below ~120 px: `screenPx = (worldWidth/distance) * (viewportHeight / (2·tan(fov/2)))`; solve for distance and the thresholds adapt to any FOV/resolution automatically.

---

## 8. PERFORMANCE BUDGET

### 8.1 The real frame budget

60 fps = 16.67 ms wall clock, but Chromium's compositor takes a cut. **Budget 13.5–14 ms of actual work**, leaving ~2.5 ms for compositing, GC, and the Electron main-process tick. On Windows, ANGLE→D3D11 re-validates and re-emits state per draw, adding roughly **20–40% CPU per draw call** vs native GL.

Targets on **GTX 1660 / RTX 3050 @1080p**: 3.5–4.5 ms geometry+shadows, 4–5 ms post, 2 ms CPU, ~2 ms slack. **M1/M2** is bandwidth-bound (68–100 GB/s unified) — halve the full-res post budget, go half-res everywhere. **Iris Xe** is the floor: assume 1.5–2× M1 cost; ship a tier that drops Kuwahara to quarter-res r=3 and disables bloom mips 3–4.

```ts
// main process, BEFORE app.whenReady()
app.commandLine.appendSwitch('use-angle', 'd3d11');   // 'gl'|'d3d11'|'d3d11on12'|'vulkan'|'metal'
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force_high_performance_gpu');
// dev only: app.commandLine.appendSwitch('disable-frame-rate-limit');
```

Backend names are from Chromium's [`gl_switches.cc`](https://chromium.googlesource.com/chromium/src/+/main/ui/gl/gl_switches.cc). **Ship `d3d11` as default with a `gl` opt-in.** `gl` sometimes wins on NVIDIA for shader-heavy fragment work (no HLSL round-trip) but breaks on many Intel drivers. **Measure your Kuwahara shader both ways** — a 200-tap unrolled loop is exactly where the HLSL translator's register allocation falls off a cliff.

### 8.2 Concrete budgets

| Resource | Safe | Ceiling | Note |
|---|---|---|---|
| Draw calls | **< 150** | 400 | ~8–20 µs CPU each through ANGLE; 400 calls ≈ 3.2–8 ms of **pure CPU**. [Above 500 "even powerful GPUs struggle"](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| Triangles | 1.5 M | 4 M | 1660 chews 4 M in ~1.5 ms — you hit the draw-call wall first |
| Texture VRAM | 400 MB | 900 MB | Iris Xe shares system RAM; budget 350 MB |
| Render-target VRAM | 60 MB | 120 MB | 1080p RGBA16F = 16.6 MB each; composer 2 + G-buffer 2 + depth + bloom mips + Kuwahara ×4 ≈ 95 MB. **At 1440p that's 170 MB** |
| Shader programs | < 60 | 120 | Each first-use compile is a 20–150 ms stall |

### 8.3 Top 5 framerate killers, ranked

1. **Full-screen post at native res — specifically Kuwahara.** By a wide margin. r=6 @1080p = 23.4 GOP/frame, 5–8 ms on a 1660, 15–25 ms on Iris Xe. Fix: half-res + halved radius (16×), plus pmndrs merging (another 1.4–2.8 ms). **Recovery: 6–10 ms.**
2. **Unbatched draw calls from scattered props.** 3,000 `Mesh` objects = 24–60 ms of CPU alone. `InstancedMesh` per type takes it to ~20. One cited real case went **9,000 → 300 calls (−97%)**. **Recovery: 10–40 ms.**
3. **Shadow maps.** `calls += casters × cascades`. A shadowed `PointLight` costs `objects × 6`; two of them over 10 objects = **+120 draw calls**. Fix: one `DirectionalLight`, 2048² desktop / 1024² fallback, 1–2 cascades, tightly fitted camera, and `shadow.autoUpdate = false` — a static-sun map makes shadows **free after frame 1**. **Recovery: 2–6 ms.**
4. **Overdraw from alpha-tested foliage + transparent water.** Alpha-test disables early-Z on ANGLE's D3D path; canopy easily hits 8–12× overdraw. Fix: tighten foliage cards to the actual silhouette (−40% overdraw), render opaque front-to-back, `alphaTest` over `transparent: true`, single water layer. **Recovery: 1.5–4 ms.**
5. **Large uncompressed textures + JS GC.** `uncompressedSize = w × h × 4 × 1.333` — **a 2048² RGBA8 texture is 22.4 MB of VRAM regardless of its 200 KB PNG size** ([Don McCurdy](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)). Thirty of those = 672 MB. GC: `new Vector3()` per frame across 500 objects = 30 k allocations/s → a 5–15 ms major GC spike every few seconds.

**Honourable mention: shader recompilation stalls.** Each new material/light-count/define combination triggers a 20–150 ms ANGLE compile **on the main thread**. Warm everything at load with `renderer.compileAsync(scene, camera)` (uses `KHR_parallel_shader_compile`) and watch `renderer.info.programs.length` stop growing.

### 8.4 Diagnostics

```ts
hud.textContent =
  `calls ${info.render.calls}  tris ${(info.render.triangles/1000).toFixed(0)}k  ` +
  `progs ${info.programs?.length ?? 0}  geo ${info.memory.geometries}  tex ${info.memory.textures}  ` +
  `gpu ${gpuMs.toFixed(2)}ms  cpu ${cpuMs.toFixed(2)}ms`;
```

The rule is **stability, not magnitude** — these must plateau. Climbing `memory.textures` is a leak; climbing `programs.length` means you're minting materials per frame.

For real GPU time use **`EXT_disjoint_timer_query_webgl2`**, wrapping each composer pass. This is the only honest way to know whether your Kuwahara is 2 ms or 9 ms on a given machine — `performance.now()` around `composer.render()` measures command *submission*, not execution. Use **`WEBGL_debug_renderer_info`** (`UNMASKED_RENDERER_WEBGL` → `"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0)"`) to pick a quality tier at first launch. **spector.js** captures the full GL command stream — how you find the pass binding a target 13 times. `chrome://gpu` inside the Electron window confirms which ANGLE backend is actually active.

### 8.5 Mitigations with numbers

| Mitigation | Gain |
|---|---|
| **KTX2/Basis via `THREE.KTX2Loader`** | 2048² RGBA8 22.4 MB → BC7/ASTC ~5.6 MB, ETC1S ~2.8 MB. **4–8×**. 30 textures: 672 MB → 84–168 MB. Also faster uploads (no CPU decode) |
| Instancing / merging | 3,000 props → ~20 calls; 24–60 ms CPU saved |
| **Half-res post + upsample** | 4× fewer fragments; Kuwahara 6 ms → 1.5 ms |
| `setPixelRatio(min(dpr, 1.5))` | On a 2× panel: **1.78× fragment reduction** (4.0 → 2.25 px per CSS px). Don't go below 1.0 — the paper texture needs real pixels |
| Dynamic resolution | Rolling median GPU ms > 15 for 30 frames → `composer.setSize(w*0.85, h*0.85)`, recover in 0.05 steps. Hard fps floor without a settings menu. **Rescale the scene render, not the paper pass** |
| 1 cascade @2048² vs 4 | 4× fewer shadow draws; static sun → free |
| `antialias: false` | Default-FB MSAA is never used when rendering to a target. Reclaims 30–60 MB and ~0.4 ms of pointless resolve |
| `powerPreference: 'high-performance'` + `force_high_performance_gpu` | On hybrid laptops, **3–5×** (discrete vs Iris Xe) |
| `renderer.compileAsync()` at load | Converts 60 × 20–150 ms of hitches into one loading-screen wait |

### 8.6 WebGPU — honest read

`WebGPURenderer` is usable in 2026 (Chrome/Edge 113+, Firefox 141+, Safari 26+; r171+ ships zero-config WebGPU with automatic WebGL2 fallback). Electron gets it as Chromium.

What it actually buys **this** app: draw-call overhead 2–10× better — but if you've instanced down to 150 calls that's worth 1–2 ms. Compute shaders for GPU culling and indirect draw — again, not where you're bound. Particles at 1 M+ vs ~50 k — the one genuinely compelling case, if you want live weather and drifting fog volumes.

**The honest cost is TSL migration.** Every shader here is raw GLSL; WebGPU needs WGSL via TSL. For a project with *this many* custom shaders (4 Kuwahara stages, Roberts edge, ink composite, paper, hatching, tilt-shift, terrain VS/FS, water, sky, wind): **1–2 weeks including testing**, not the "1–2 days" quoted for projects with a couple of custom shaders. And **pmndrs/postprocessing does not blanket-support WebGPU** — which undercuts the §6.10 recommendation.

**Verdict: build on WebGL2 + pmndrs now.** Structure each effect as an isolated shader string + uniform map (the pmndrs `Effect` subclass pattern already forces this), so a future TSL port is mechanical rather than archaeological. Revisit when you're either draw-call-bound after instancing or want GPU-driven weather at a scale WebGL can't reach.

---

## 9. Suggested build order

1. **Terrain skeleton** — Option A single displaced plane + `MeshStandardMaterial`. One afternoon. This is your correctness baseline.
2. **Swap to CDLOD** (§1.3–1.5) with the flat/globe `uSphereMix`. Verify with `renderer.info.render.calls === 1` and no visible morph popping.
3. **Terrain shading + `uMapness`** (§2.5). The moment `softLight(carto, hillshade)` lands, the project has its identity. Get this before anything else.
4. **Sky gradient + time-of-day LUT + aerial perspective + cloud shadows** (§5.1–5.4, 5.6c). Five shared GLSL functions; biggest mood-per-line ratio in the whole stack.
5. **Water** — ocean plane with depth ramp + foam (§4.1–4.3), rivers after.
6. **Vegetation** — one InstancedMesh tier first, then tiles, then LOD buckets.
7. **NPR post** — order from §6.2, but bring up **tilt-shift + paper + vignette + LUT first** (cheap, huge look delta), and add Kuwahara last, at half res, behind a quality toggle.
8. **City** — merge per district; skip roofs beyond gable/pyramid until it looks right.

Two things to instrument from day one: the `renderer.info` HUD (§8.4) and an `EXT_disjoint_timer_query_webgl2` per-pass timer. Every millisecond number in this document is a starting budget — the only ones that matter are the ones your scene reports on your target GPU.

agentId: ae5f3598bbe5d606f (use SendMessage with to: 'ae5f3598bbe5d606f', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 187847
tool_uses: 20
duration_ms: 2154106</usage>