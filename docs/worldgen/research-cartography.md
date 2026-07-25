# Investigación — Cartography
> Recopilado automáticamente durante la sesión del 2026-07-24 para el motor `worldgen` de Writers Hoard.


---

<!-- fuente: parchment-synthesis.md -->

I ran ~45 fetches (20 WebFetch + ~25 direct HTTP). Here is the report.

---

# Procedurally Synthesizing Aged Parchment — Technical Source Report

**Note on Shadertoy up front:** Shadertoy is entirely unreachable from this environment. `www.shadertoy.com` returns **HTTP 403 (Cloudflare bot challenge)** to WebFetch, plain curl, `api.allorigins.win`, `api.codetabs.com` (both 522 = upstream CF), and `r.jina.ai` (returns "Performing security verification"). Wayback snapshots **do** load (200) but modern Shadertoy pages fetch shader JSON via XHR — the archived HTML contains only the empty `loadNew()` default template (`"code": "void mainImage(...) { vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4)); ... }"`), and a 2016 snapshot contains zero `mainImage` occurrences. Shadertoy's CDX API is blocked by egress policy; GitHub code search is disabled for this session. **I could not retrieve a Shadertoy parchment shader.** Section 8 substitutes two *complete, verbatim, production* paper shaders that I did obtain.

---

## 1. fBm / value-noise recipes — exact constants

### 1.1 Inigo Quilez — canonical fBm
Source: https://iquilezles.org/articles/fbm/

```glsl
float fbm( in vecN x, in float H )
{    
    float t = 0.0;
    for( int i=0; i<numOctaves; i++ )
    {
        float f = pow( 2.0, float(i) );
        float a = pow( f, -H );
        t += a*noise(f*x);
    }
    return t;
}
```
Optimized (no `pow`):
```glsl
float fbm( in vecN x, in float H )
{    
    float G = exp2(-H);
    float f = 1.0;
    float a = 1.0;
    float t = 0.0;
    for( int i=0; i<numOctaves; i++ )
    {
        t += a*noise(f*x);
        f *= 2.0;
        a *= G;
    }
    return t;
}
```
Constants: `G = exp2(-H)`; H ∈ [0,1] ⇒ G ∈ [1, 0.5]; **"Standard terrain/graphics value: G = 0.5 (equivalent to H = 1)"**; lacunarity fixed at 2 (`f *= 2.0`).

### 1.2 The Book of Shaders — verbatim
Source (markdown): https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/README.md

The tutorial's parameter block, verbatim from the README:
```glsl
// Properties
const int octaves = 1;
float lacunarity = 2.0;
float gain = 0.5;
//
// Initial values
float amplitude = 0.5;
float frequency = 1.;
//
// Loop of octaves
for (int i = 0; i < octaves; i++) {
	y += amplitude * noise(frequency*x);
	frequency *= lacunarity;
	amplitude *= gain;
}
```

**`13/2d-fbm.frag`** — https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/2d-fbm.frag (verbatim, the reference value-noise fBm):
```glsl
float random (in vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))*
        43758.5453123);
}

// Based on Morgan McGuire @morgan3d
// https://www.shadertoy.com/view/4dS3Wd
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

#define OCTAVES 6
float fbm (in vec2 st) {
    // Initial values
    float value = 0.0;
    float amplitude = .5;
    float frequency = 0.;
    //
    // Loop of octaves
    for (int i = 0; i < OCTAVES; i++) {
        value += amplitude * noise(st);
        st *= 2.;
        amplitude *= .5;
    }
    return value;
}

void main() {
    ...
    color += fbm(st*3.0);
}
```
**Base frequency multiplier `3.0`** on normalized UV. Note the classic bug/quirk: `frequency` is declared but unused.

**`13/turbulence.frag`**: `#define OCTAVES 3`, `value += amplitude * abs(snoise(st)); st *= 2.; amplitude *= .5;` — **use this for blotches** (abs() gives creases/dark veins).

**`13/ridge.frag`**: `#define OCTAVES 4`, `float lacunarity = 2.0; float gain = 0.5; float offset = 0.9; float freq = 1.0, amp = 0.5; float prev = 1.0;` with `ridge(h,offset){ h=abs(h); h=offset-h; h=h*h; return h; }` and `sum += n*amp; sum += n*amp*prev;`

### 1.3 LYGIA — library defaults
Source: https://raw.githubusercontent.com/patriciogonzalezvivo/lygia/main/generative/fbm.glsl (verbatim)
```glsl
#ifndef FBM_OCTAVES
#define FBM_OCTAVES 4
#endif
#ifndef FBM_NOISE_FNC
#define FBM_NOISE_FNC(UV) snoise(UV)
#endif
#ifndef FBM_VALUE_INITIAL
#define FBM_VALUE_INITIAL 0.0
#endif
#ifndef FBM_SCALE_SCALAR
#define FBM_SCALE_SCALAR 2.0
#endif
#ifndef FBM_AMPLITUDE_INITIAL
#define FBM_AMPLITUDE_INITIAL 0.5
#endif
#ifndef FBM_AMPLITUDE_SCALAR
#define FBM_AMPLITUDE_SCALAR 0.5
#endif
```
Tileable variant hard-codes `const float persistence = 0.5; const float lacunarity = 2.0;` and normalizes by `total / normalization`.

### 1.4 Godot Shaders fBM snippet
Source: https://godotshaders.com/snippet/fractal-brownian-motion-fbm/ (verbatim)
```glsl
float fbm(vec2 uv) {
    int octaves = 6;
    float amplitude = 0.5;
    float frequency = 3.0;
    float value = 0.0;

    for(int i = 0; i < octaves; i++) {
        value += amplitude * noise(frequency * uv);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}
```
Its `noise()` uses `vec2 blur = smoothstep(0.0, 1.0, uv_fract);` instead of the manual `f*f*(3-2f)`.

### 1.5 Paper-specific fBm variants (the important ones)

**(a) Retro Parchment Paper (Godot)** — https://godotshaders.com/shader/retro-parchment-paper/ — hand-unrolled 4-octave fBm with **irrational lacunarity to kill grid alignment**:
```glsl
float fbm(vec2 p) {
    return noise(p)*0.5+noise(p*2.1)*0.25+noise(p*4.3)*0.125+noise(p*8.7)*0.063;
}
```
Lacunarity ≈ 2.1 / 2.05 / 2.02, gain 0.5. Used at three different base frequencies in the same shader:
- **paper grain**: `noise_scale = 4.0` (range 1–10) → `fbm(UV * 4.0)`, plus a second at `4.0 * 2.5`
- **glow/fiber perturbation**: `fbm(UV * 10.0 + vec2(i*0.3))` and `fbm(UV * 15.0 + vec2(2.3, 5.1))`
- **dirt/blotches**: `dirt_scale = 8.0` (range 1–100)

**(b) Paper Design `paper-texture`** — https://github.com/paper-design/shaders (npm `@paper-design/shaders@0.0.77`, `dist/shaders/paper-texture.js`). **3 octaves, initial amplitude 0.4, lacunarity 1.99, gain 0.65:**
```glsl
float fbm(vec2 n) {
  float total = 0.0, amplitude = .4;
  for (int i = 0; i < 3; i++) {
    total += valueNoise(n) * amplitude;
    n *= 1.99;
    amplitude *= 0.65;
  }
  return total;
}
```
Used only for the large-scale `fade` mask at `fbm(.17 * patternUV + 10. * u_seed)`.

Its **roughness** (per-pixel paper tooth) is a separate 4-octave loop with lacunarity 2.1 plus an additive anisotropic ridge term:
```glsl
float roughness(vec2 p) {
  p *= .1;
  float o = 0.;
  for (float i = 0.; ++i < 4.; p *= 2.1) {
    vec4 w = vec4(floor(p), ceil(p));
    vec2 f = fract(p);
    o += mix(
    mix(randomG(w.xy), randomG(w.xw), f.y),
    mix(randomG(w.zy), randomG(w.zw), f.y),
    f.x);
    o += .2 / exp(2. * abs(sin(.2 * p.x + .5 * p.y)));
  }
  return o / 3.;
}
```

**(c) Paper Design `grain-gradient`** `fbmR`: 3 octaves, **amplitude 0.2**, **`rotate(n, 0.3)` per octave**, `n *= 1.99`, `amplitude *= 0.6`.

**(d) General guidance** — https://www.mysimulator.uk/content/articles/procedural-textures.html: "Lacunarity: `2.0`; Amplitude (persistence): `0.5`; **Rougher terrain: amplitude `0.6–0.7`; Smoother clouds: amplitude `0.4–0.45`**".

### 1.6 Recommended split for parchment (synthesized from the above)
| Layer | Octaves | Base freq (UV∈[0,1]) | Lacunarity | Gain |
|---|---|---|---|---|
| Large tone blotches | 3–4 | 1.5–3 | 1.99–2.1 | 0.5–0.65 |
| Mid mottle / stains | 4–5 | 6–10 | 2.1 | 0.5 |
| Fiber (anisotropic) | 4 | 40–120 (stretched) | 2.0 | 0.6 |
| Grain | 1 (white noise) | per-pixel | — | — |

---

## 2. Domain warping — exact constants

### 2.1 iq's canonical pattern
Source: https://iquilezles.org/articles/warp/ (verbatim)
```glsl
float pattern( in vec2 p )
{
    vec2 q = vec2( fbm( p + vec2(0.0,0.0) ),
                   fbm( p + vec2(5.2,1.3) ) );

    vec2 r = vec2( fbm( p + 4.0*q + vec2(1.7,9.2) ),
                   fbm( p + 4.0*q + vec2(8.3,2.8) ) );

    return fbm( p + 4.0*r );
}
```
Offsets: `(0.0,0.0)`, `(5.2,1.3)`, `(1.7,9.2)`, `(8.3,2.8)`. Warp scalar **`4.0`** at both levels. (The article deliberately does not include the `fbm()` body.)

### 2.2 Book of Shaders `clouds.frag` — the same warp with **warp scalar 1.0** and a rotated fBm
Source: https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/clouds.frag (verbatim)
```glsl
#define NUM_OCTAVES 5

float fbm ( in vec2 _st) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    // Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5),
                    -sin(0.5), cos(0.50));
    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(_st);
        _st = rot * _st * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 st = gl_FragCoord.xy/u_resolution.xy*3.;
    vec3 color = vec3(0.0);

    vec2 q = vec2(0.);
    q.x = fbm( st + 0.00*u_time);
    q.y = fbm( st + vec2(1.0));

    vec2 r = vec2(0.);
    r.x = fbm( st + 1.0*q + vec2(1.7,9.2)+ 0.15*u_time );
    r.y = fbm( st + 1.0*q + vec2(8.3,2.8)+ 0.126*u_time);

    float f = fbm(st+r);

    color = mix(vec3(0.101961,0.619608,0.666667),
                vec3(0.666667,0.666667,0.498039),
                clamp((f*f)*4.0,0.0,1.0));

    color = mix(color,
                vec3(0,0,0.164706),
                clamp(length(q),0.0,1.0));

    color = mix(color,
                vec3(0.666667,1,1),
                clamp(length(r.x),0.0,1.0));

    gl_FragColor = vec4((f*f*f+.6*f*f+.5*f)*color,1.);
}
```
Key transferable details: **`mat2 rot` with angle 0.5 rad and `shift = vec2(100.0)` per octave** eliminates the axis-aligned artifacts value noise otherwise produces (critical for paper, where grid artifacts read as "digital"); the final composite `(f*f*f + .6*f*f + .5*f)` is a cheap gamma-ish contrast curve. The second colour, `vec3(0.666667, 0.666667, 0.498039)` = **`#AAAA7F`**, is already a plausible aged-paper midtone.

### 2.3 Lower-cost warp
Source: https://www.mysimulator.uk/content/articles/procedural-textures.html
```glsl
vec2 fbm2(vec2 p, int oct) {
  return vec2(fbm(p, oct), fbm(p + vec2(3.7, 1.3), oct));
}
float domainWarp(vec2 p) {
  vec2  q = fbm2(p, 5);
  vec2  r = fbm2(p + q * 2.0, 5);
  return fbm(p + r * 2.0, 5);
}
```
"warp strength `k ≈ 1–4`, recommended `2.0`; 5 octaves per fBm call (15 total noise evals)". For Canvas2D at 2048², **use k = 1.0–2.0 and 3 octaves** — the 15-eval version is prohibitively slow in JS.

---

## 3. Concrete hex colours

### 3.1 "Parchment" as a named colour
https://www.figma.com/colors/parchment/ — **Primary `#F1E9D2`** = rgb(241, 233, 210).
- Shades (darkening ramp — use for stains): `#F1E9D2, #E5D6AC, #D9C486, #CDB15F, #BF9D3B, #997E30, #735E24, #4C3F18`
- Tints: `#F1E9D2, #F2EAD5, #F3ECD8, #F4EDDB, #F5EFDD, #F5F0E0, #F6F1E3, #F7F3E6`
- Tones: `#F1E9D2, #BA9A45, #B2944D, #A99056, #A18B5E, #998766, #90846F, #888277`
- Similar: Ivory `#ffffe3`, Champagne `#f7e6ca`, Beige `#ede8d0`
- Alt named value: **`#F1E9D2`** also given as "Parchment (#F1E9D2)" by bemyhex.com

### 3.2 Sepia five-stop ramps (light base → mid → dark stain → ink)
https://www.media.io/color-palette/sepia-color-palette.html — the most directly usable ones for parchment:
- **"Old Paper and Ink"**: `#FBF3E8  #E6D7C6  #C9B092  #8A6A50  #2B1F1A`
- **"Vintage Sepia Wash"**: `#F3E6D0  #D8C1A0  #B68A5A  #7A5332  #3B2417`
- **"Golden Archive"**: `#F8EBD7  #E8D2B0  #D1B07B  #A8793D  #5B3B1F`
- **"Antique Leatherbound"**: `#F1E0C8  #D4B690  #B08A5C  #7E5A3A  #3F2616`
- **"Museum Label Neutrals"**: `#FAF1E6  #E9DCCB  #CDBBA3  #9C7C5F  #4B3528`
- **"Warm Film Grain"**: `#F2E1D0  #D8BFA6  #B7936E  #7C5A44  #3A241B`
- **"Burnt Sienna Botanica"** (good burnt-edge ramp): `#F7E0CC  #E2B690  #C77C55  #8D4A2E  #3A1D12`
- **"Timberline Earth"**: `#F0E2D2  #D3BFA7  #A88A6D  #6E4F3C  #2C1F18`

### 3.3 Fantasy-map palette
https://www.schemecolor.com/old-map.php — "Old Map":
`Ming #3B727C (59,114,124)`, `Wicker #B9A37E (185,163,126)`, `Fur #D1BE9D (209,190,157)`, `Comfort Green #82A775 (130,167,117)`, `Neutral Red #B05F66 (176,95,102)`, `Corporate Brown #64513B (100,81,59)`.
→ `#D1BE9D` land base, `#B9A37E` mid, `#64513B` ink/coast lines, `#3B727C` sea.

### 3.4 Values from actual paper implementations
- **GIMP parchment base fill: `d3a96c`** — https://rpgmaps.profantasy.com/making-parchments-and-parchment-scrolls-part-1-by-sue-daniel/ (Sue Daniel/ProFantasy). Notably darker/more saturated than web "parchment" — it's meant to be lightened by the Overlay plasma layer.
- **Paper Design `paper-texture` defaults**: `colorBack = #ffffff`, `colorFront = #9fadbc` — https://shaders.paper.design/paper-texture. (`#9fadbc` is a cool grey-blue; swap for a warm `#C9B092`/`#B7936E` to get parchment instead of white paper.)
- **CSS paper-effect palette** — https://www.subframe.com/tips/css-paper-effect-examples: bases `#f8f0e0`, `#f9f7f1`, `#f8f5f0`, `#f8f3e9`; inks `#2a1a0a` (dark brown ink), `#2b2118` (deep sepia); aged tone `#b89f7a`; and the gradient `radial-gradient(circle at center, var(--parchment-color), #e8daba)`.
- **Godot Retro Parchment sepia tint vector**: `vec3(1.12, 0.95, 0.70)` applied to luminance — i.e. a pure-white pixel becomes rgb(255, 242, 179) ≈ **`#FFF2B3`**; a 0.85 luminance pixel → ≈ `#F2D5A5`.

**Recommended 5-stop working ramp** (composite of the above, warm and map-appropriate):
`#F5EDD8` (highlight) → `#E8D9B5` (base) → `#C9B092` (mid) → `#8A6A50` (stain) → `#4C3F18`/`#3A1D12` (burnt edge / ink).

---

## 4. Blotches & stains

### 4.1 Multiplied-fBm dirt (the cleanest recipe found)
https://godotshaders.com/shader/retro-parchment-paper/ — verbatim:
```glsl
float dirt1 = fbm(UV * dirt_scale);
float dirt2 = fbm(UV * dirt_scale * 2.3 + vec2(4.1, 2.7));
float dirt3 = fbm(UV * dirt_scale * 0.5 + vec2(1.2, 8.3));
float dirt = dirt1 * dirt2 * dirt3;
col -= pow(dirt, 1.5) * dirt_strength;
```
with `dirt_scale = 8.0` (hint_range 1–100), `dirt_strength = 0.4` (0–1). **Multiplying three decorrelated fBms at ratios 1 : 2.3 : 0.5** is what produces sparse, irregular islands rather than uniform mottle — the product is near zero almost everywhere and spikes only where all three coincide. `pow(dirt, 1.5)` sharpens it further, and the operation is **subtractive on linear colour**, which is effectively a multiply/darken blend.

### 4.2 Thresholded low-frequency noise → alpha mask (SVG; used by Azgaar's FMG)
Verbatim from Azgaar's Fantasy Map Generator `src/index.html` (repo: https://github.com/Azgaar/Fantasy-Map-Generator):
```xml
<filter id="splotch" name="Splotch">
  <feTurbulence type="fractalNoise" baseFrequency=".01" numOctaves="4" />
  <feColorMatrix values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -0.9 1.2" result="texture" />
  <feComposite in="SourceGraphic" in2="texture" operator="in" />
</filter>
<filter id="bluredSplotch" name="Blurred Splotch">
  <feTurbulence type="fractalNoise" baseFrequency=".01" numOctaves="4" />
  <feColorMatrix values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -0.9 1.2" result="texture" />
  <feComposite in="SourceGraphic" in2="texture" operator="in" />
  <feGaussianBlur stdDeviation="4" />
</filter>
```
This is exactly the "thresholded low-frequency noise" recipe in matrix form: the alpha row `0 0 0 -0.9 1.2` computes **`alpha_out = -0.9 * alpha_noise + 1.2`**, i.e. an inverted, biased, high-gain remap that clamps to a hard-edged blotch mask. `baseFrequency = 0.01` with `numOctaves = 4` at typical FMG canvas sizes gives blotches ~100px across. In Canvas2D the equivalent is `alpha = clamp(1.2 - 0.9 * fbm, 0, 1)` then `ctx.globalCompositeOperation = 'destination-in'` (or `'multiply'` for a stain rather than a cutout).

### 4.3 Worley/cellular speckle ("drops")
Paper Design `paper-texture.js`, verbatim:
```glsl
float drops(vec2 uv) {
  vec2 iDropsUV = floor(uv);
  vec2 fDropsUV = fract(uv);
  float dropsMinDist = 1.;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 neighbor = vec2(float(i), float(j));
      vec2 offset = randomGB(iDropsUV + neighbor);
      offset = .5 + .5 * sin(10. * u_seed + TWO_PI * offset);
      vec2 pos = neighbor + offset - fDropsUV;
      float dist = length(pos);
      dropsMinDist = min(dropsMinDist, dropsMinDist*dist);
    }
  }
  return 1. - smoothstep(.05, .09, pow(dropsMinDist, .5));
}
```
Invoked as `float drops = u_drops * drops(patternUV * 2.);` with default `drops = 0.2`, and applied as **`color -= .007 * drops;`** plus a normal-map perturbation `normal.xy += 3. * drops;`. The `smoothstep(.05, .09, ...)` band is the speckle radius; **`pow(minDist, .5)` flattens the falloff** so specks have soft, non-circular edges.

For a canonical Worley to build on: https://www.mysimulator.uk/content/articles/procedural-textures.html gives `jitter = hash21(nb) * 0.9` and returns `sqrt(vec2(F1, F2))`.

### 4.4 Blend modes actually used
- **Multiply / darken**: the dominant choice for stains (Godot: subtractive `col -=`; CSS: `mix-blend-mode: multiply` "for watercolor stains" per subframe.com).
- **Overlay**: for the mid-frequency plasma/mottle layer. GIMP recipe (ProFantasy, Sue Daniel): *"Filter: Render > Clouds > Plasma (default settings), Desaturate using Luminosity option, Blend mode: **Overlay**"*.
- **Burn**: for the fine noise layer. Same source: *"Filter: Noise > HSV Noise … Blend mode: **Burn**, Filter: Blur > Gaussian Blur with radius of **1**, Opacity: **30%**"*.
- **Overlay** for grain in SVG: `<feBlend in="SourceGraphic" in2="grey" mode="overlay"/>` — https://www.cssshowcase.com/snippets/color/noise-texture.

Canvas2D mapping: `ctx.globalCompositeOperation = 'multiply' | 'overlay' | 'soft-light' | 'color-burn'` — all four are supported and all map 1:1 to the above.

---

## 5. Fibers

### 5.1 The best technique found: gradient-magnitude of a *rotated* fBm
Paper Design, `dist/shader-utils.js` — verbatim (this is the `fiberNoise` referenced by `paper-texture`):
```glsl
float fiberRandom(vec2 p) {
  vec2 uv = floor(p) / 100.;
  return texture(u_noiseTexture, fract(uv)).b;
}

float fiberValueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = fiberRandom(i);
  float b = fiberRandom(i + vec2(1.0, 0.0));
  float c = fiberRandom(i + vec2(0.0, 1.0));
  float d = fiberRandom(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x1 = mix(a, b, u.x);
  float x2 = mix(c, d, u.x);
  return mix(x1, x2, u.y);
}

float fiberNoiseFbm(in vec2 n, vec2 seedOffset) {
  float total = 0.0, amplitude = 1.;
  for (int i = 0; i < 4; i++) {
    n = rotate(n, .7);
    total += fiberValueNoise(n + seedOffset) * amplitude;
    n *= 2.;
    amplitude *= 0.6;
  }
  return total;
}

float fiberNoise(vec2 uv, vec2 seedOffset) {
  float epsilon = 0.001;
  float n1 = fiberNoiseFbm(uv + vec2(epsilon, 0.0), seedOffset);
  float n2 = fiberNoiseFbm(uv - vec2(epsilon, 0.0), seedOffset);
  float n3 = fiberNoiseFbm(uv + vec2(0.0, epsilon), seedOffset);
  float n4 = fiberNoiseFbm(uv - vec2(0.0, epsilon), seedOffset);
  return length(vec2(n1 - n2, n3 - n4)) / (2.0 * epsilon);
}
```
**This is the key trick: fibers are the *gradient magnitude* (`length(∇fbm)`) of a 4-octave fBm that is rotated by 0.7 rad each octave.** `|∇fbm|` is near-zero at extrema and large along the "ridges" between them — producing thin, curved, filament-like strands rather than blobs. The per-octave rotation makes the strands curl instead of running along axes. Gain 0.6, lacunarity 2.0, initial amplitude 1.0, central-difference `epsilon = 0.001`.

Call site in `paper-texture.js`:
```glsl
vec2 fiberUV = 2. / u_fiberSize * patternUV;
float fiber = fiberNoise(fiberUV, vec2(0.));
fiber = .5 * u_fiber * (fiber - 1.);
...
normal.xy += fiber;          // paper-only path
normalImage += .2 * fiber;   // image-refraction path
```
Defaults (https://shaders.paper.design/paper-texture): `fiber = 0.3`, `fiberSize = 0.2` ⇒ effective frequency `2/0.2 = 10×` the pattern UV, and `patternUV = 5.*(v_imageUV-.5)*vec2(aspect,1)` — so ~50 cycles across the canvas.

### 5.2 Anisotropic-frequency alternative (cheap, good for a Canvas2D port)
Codrops, https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/ — verbatim:
```xml
<feTurbulence baseFrequency="0.01 0.4" result="NOISE" numOctaves="2" />
```
Two-value `baseFrequency` = **separate X/Y frequency**: "smaller X values create stretched horizontal patterns". `0.01 0.4` = 40:1 anisotropy — exactly the stretched-noise fiber look. In shader/JS terms: `fbm(vec2(uv.x * 1.0, uv.y * 40.0))`, then rotate the sample coordinate by a random per-region angle to vary fibre direction. Codrops' general guidance: *"values in the 0.02 to 0.2 range are useful starting points for most textures"*.

### 5.3 Multi-scale description (commercial generator)
https://texturize.app/generators/paper — "three noise passes at different scales: (1) low-frequency layer for large-scale tone variation, (2) mid-frequency FBM for mottling, (3) high-frequency noise simulating individual fibers", with a **`fiber direction` slider that "rotates the grain orientation through 360 degrees"** and `fiberDensity` which "controls the high-frequency noise amplitude". Confirms the 3-band architecture and that fiber direction is a global rotation, not per-strand.

---

## 6. Edge vignette & burn

### 6.1 The canonical polynomial vignette (no `length()`, no `sqrt`)
Godot Retro Parchment — verbatim:
```glsl
vec2 e = UV * (1.0 - UV);
float vignette = pow(clamp(e.x * e.y * 16.0, 0.0, 1.0), vignette_strength);
col *= vignette;
```
`vignette_strength = 0.7`, `hint_range(0.1, 2.0)`.

Identical idiom with constant 15.0 and exponent 0.5, from https://raw.githubusercontent.com/yigitkonur/ghostty-crt-shaders/main/shaders/paper-balanced.glsl:
```glsl
vec2 vig = uv * (1.0 - uv.yx);
float bgGlow = 0.2 * pow(clamp(vig.x * vig.y * 15.0, 0.0, 1.0), 0.5);
```
`uv.x*(1-uv.x)` peaks at 0.25, so the product peaks at 0.0625; ×16 normalizes it to exactly 1.0 at centre. **Use 16.0 for exact normalization; use 15.0 to leave a slight overall darkening.** Exponent < 1 = wide soft falloff; exponent > 1 = tight dark corners.

### 6.2 Radial vignette with inner/outer radii
https://godotshaders.com/shader/vignette/ (CC0) — verbatim:
```glsl
uniform float alpha = 1.0;
uniform float inner_radius = 0.0;
uniform float outer_radius = 1.0;

void fragment() {
	float x = abs(UV.r-.5)*2.0;
	float y = abs(UV.g-.5)*2.0;
	float q = 1.0-(1.0-sqrt(x*x+y*y)/outer_radius)/(1.0-inner_radius);
	COLOR = vec4(0, 0, 0, q*alpha);
}
```

### 6.3 Quadratic vignette with animated jitter
https://godotshaders.com/shader/old-movie-shader/ — verbatim:
```glsl
uniform float vignette_param: hint_range(1,10)=20.0;
float vignette_param2 = vignette_param + 0.5*(noise(vec2(TIME/60.0,TIME/59.0)));
float vig = -vignette_param2*((UV.x-0.5)*(UV.x-0.5)+(UV.y-0.5)*(UV.y-0.5));
```

### 6.4 Irregular burnt edge — noise-thresholded dissolve
https://godotshaders.com/shader/burning-paper/ — verbatim:
```glsl
uniform float burn : hint_range(0.0, 1.0, 0.01) = 0.0;

void fragment() {
	vec4 color = texture(tex, UV);
	float noise_value = texture(noise, UV).r * 0.5;
	if (noise_value < burn) {
		float gradient_coord = clamp(burn - noise_value, 0.01, 0.99);
		vec4 gradient_color = texture(gradient, vec2(gradient_coord, 1.0));
		color *= gradient_color;
		float gradient_intensity = (
			abs(gradient_color.r - gradient_color.g) +
			abs(gradient_color.r - gradient_color.b) +
			abs(gradient_color.b - gradient_color.g)
		) / 3.0;
		EMISSION = gradient_color.rgb * gradient_intensity * emission_strength;
	}
	ALBEDO = color.rgb;
	ALPHA = color.a;
}
```
Note `* 0.5` on the noise: it compresses the mask into [0, 0.5] so `burn` in [0,1] sweeps past all of it with margin. The **char/ember band is a 1D gradient LUT indexed by `burn - noise`** (distance past the threshold), not a hard-coded colour — for parchment, make that gradient run `#F5EDD8 → #C77C55 → #8D4A2E → #3A1D12 → transparent`.

Band-form equivalent (https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/): `if(noise > uProgress && noise < edgeWidth)` where `edgeWidth = uProgress + uEdge`.

### 6.5 Recommended composite for "noise-perturbed distance from border"
Combine 6.1 and 6.4 — the formula that actually gives irregular burnt edges rather than a soft oval:
```glsl
// d = normalized distance from nearest border, 0 at edge, 1 at centre
vec2 e = uv * (1.0 - uv);
float d = clamp(e.x * e.y * 16.0, 0.0, 1.0);
// perturb the *distance field*, not the colour
float edgeNoise = fbm(uv * 6.0);              // low freq -> big scallops
float edgeDetail = fbm(uv * 24.0);            // high freq -> ragged fibres
d += (edgeNoise - 0.5) * 0.35 + (edgeDetail - 0.5) * 0.08;
float paper = smoothstep(0.02, 0.14, d);      // alpha
float char  = 1.0 - smoothstep(0.06, 0.30, d);// burn ramp for colour
col = mix(col, BURNT_DARK, char * 0.8);
col = mix(col, EMBER,      smoothstep(0.03, 0.08, d) * (1.0 - smoothstep(0.08, 0.13, d)));
```
The two-frequency perturbation of `d` is what separates convincing torn/deckled edges from a blurry vignette: the low band makes large scallops, the high band makes fibre-scale raggedness.

---

## 7. Grain

### 7.1 Canvas2D reference implementation (grained.js)
https://raw.githubusercontent.com/sarathsaleem/grained/master/grained.js — verbatim:
```javascript
//default option values
var options = {
    animate: true,
    patternWidth: 100,
    patternHeight: 100,
    grainOpacity: 0.1,
    grainDensity: 1,
    grainWidth: 1,
    grainHeight: 1,
    grainChaos: 0.5,
    grainSpeed: 20
};

var generateNoise = function () {
    var canvas = doc.createElement('canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = options.patternWidth;
    canvas.height = options.patternHeight;
    for (var w = 0; w < options.patternWidth; w += options.grainDensity) {
        for (var h = 0; h < options.patternHeight; h += options.grainDensity) {
            var rgb = Math.random() * 256 | 0;
            ctx.fillStyle = 'rgba(' + [rgb, rgb, rgb, options.grainOpacity].join() + ')';
            ctx.fillRect(w, h, options.grainWidth, options.grainHeight);
        }
    }
    return canvas.toDataURL('image/png');
};
```
**Grain is monochrome/luminance** (`rgb` used for all three channels), full 0–255 range, with the amplitude carried entirely by **alpha = 0.1** (the published docs on https://sarathsaleem.github.io/grained/ list `grainOpacity: 0.05` — so **0.05–0.10 is the practical range**). The 100×100 tile is generated once and repeated — the right pattern for a Canvas2D map renderer: build one `OffscreenCanvas` grain tile, then `createPattern(tile, 'repeat')` and fill with `globalCompositeOperation = 'overlay'`.

### 7.2 Sub-LSB dither grain (kills banding on large gradients)
Paper Design `shader-utils.js`, `colorBandingFix` — verbatim:
```glsl
color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
```
Amplitude **±1/512 per channel** (`1/256 × ±0.5`), added identically to all three channels, coordinate pre-scaled by `0.014`. Apply this last, after all colour work — essential if your parchment base is a large smooth gradient.

### 7.3 In-shader grain amplitudes for paper specifically
Godot Retro Parchment — verbatim:
```glsl
float n  = fbm(UV * noise_scale);
float n2 = fbm(UV * noise_scale * 2.5 + vec2(3.7, 1.9));
col += (n  - 0.5) * 0.05;
col += (n2 - 0.5) * 0.025;

float lines = sin(UV.y * 500.0) * 0.015 + sin(UV.y * 180.0) * 0.007;
col += lines;
```
**±0.025 and ±0.0125 in 0–1 colour space** (i.e. ±6.4 and ±3.2 out of 255), added equally to R, G and B (luminance grain, not per-channel). The `lines` term — two incommensurate sines at 500 and 180 cycles with amplitudes 0.015/0.007 — is a cheap laid-paper/chain-line simulation; for parchment drop the 500 term and keep only a low-amplitude one.

### 7.4 SVG-filter grain (if you composite a filtered layer)
https://www.cssshowcase.com/snippets/color/noise-texture — verbatim:
```xml
<filter id="noise-filter" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.7"
               numOctaves="3" stitchTiles="stitch" result="n"/>
  <feColorMatrix type="saturate" values="0" in="n" result="grey"/>
  <feBlend in="SourceGraphic" in2="grey" mode="overlay"/>
</filter>
```
"baseFrequency: `0.7` (adjustable: **0.4 for coarse grain, 0.9 for fine**); numOctaves: `3`; feBlend mode: `overlay` (or `soft-light` for subtler)". Note `feColorMatrix type="saturate" values="0"` — **desaturating the turbulence to luminance before blending is what makes it read as grain rather than RGB confetti**. subframe.com corroborates: `baseFrequency="0.8"` for grain, "opacity ranges: `0.05` to `0.2` for subtlety".

---

## 8. Complete shader sources (verbatim)

### 8.A "Retro Parchment Paper (羊皮卷风格)" — Godot canvas_item, complete
Source: https://godotshaders.com/shader/retro-parchment-paper/ — **this is the single most directly portable parchment shader I found: base tone → dirt → contrast → sepia → grain → laid lines → vignette, in that order.**

```glsl
shader_type canvas_item;

uniform float noise_scale : hint_range(1.0, 10.0) = 4.0;
uniform float vignette_strength : hint_range(0.1, 2.0) = 0.7;
uniform float sepia_strength : hint_range(0.0, 1.0) = 0.85;
uniform float contrast : hint_range(0.5, 2.0) = 1.2;

uniform float glow_range : hint_range(1.0, 30.0) = 12.0;
uniform float glow_strength : hint_range(0.0, 1.0) = 0.75;
uniform float glow_falloff : hint_range(0.5, 4.0) = 2.0;
uniform float dirt_strength : hint_range(0.0, 1.0) = 0.4;
uniform float dirt_scale : hint_range(1.0, 100.0) = 8.0;

float rand(vec2 co) { return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453); }
float noise(vec2 p) {
    vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(rand(i),rand(i+vec2(1,0)),f.x),mix(rand(i+vec2(0,1)),rand(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p) {
    return noise(p)*0.5+noise(p*2.1)*0.25+noise(p*4.3)*0.125+noise(p*8.7)*0.063;
}

void fragment() {
    vec4 tex = texture(TEXTURE, UV);

    if (tex.a < 0.1) {
        COLOR = vec4(0.0);
    } else {
        vec2 px = TEXTURE_PIXEL_SIZE;

        float closest = 1.0;
        vec3 nearestLineColor = vec3(0.0);
        float ga = 2.399963;
        for (int i = 0; i < 32; i++) {
            float r = sqrt(float(i + 1) / 32.0);
            float angle = float(i) * ga;
            float nOffset = fbm(UV * 10.0 + vec2(float(i) * 0.3)) * 1.5;
            vec2 offset = vec2(cos(angle + nOffset), sin(angle + nOffset)) * r * px * glow_range;
            vec4 s = texture(TEXTURE, UV + offset);
            if (s.a > 0.1) {
                float b = dot(s.rgb, vec3(0.333));
                if (b < 0.45) {
                    if (r < closest) {
                        closest = r;
                        nearestLineColor = s.rgb;
                    }
                }
            }
        }

        float glowAmount = pow(1.0 - closest, glow_falloff) * glow_strength;
        float glowNoise = fbm(UV * 15.0 + vec2(2.3, 5.1));
        glowAmount *= (0.6 + glowNoise * 0.8);
        glowAmount = clamp(glowAmount, 0.0, 1.0);

        vec3 col = tex.rgb;

        col = mix(col, nearestLineColor, glowAmount);

        float dirt1 = fbm(UV * dirt_scale);
        float dirt2 = fbm(UV * dirt_scale * 2.3 + vec2(4.1, 2.7));
        float dirt3 = fbm(UV * dirt_scale * 0.5 + vec2(1.2, 8.3));
        float dirt = dirt1 * dirt2 * dirt3;
        col -= pow(dirt, 1.5) * dirt_strength;

        col = (col - 0.5) * contrast + 0.5;

        float gray = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 sepia = vec3(gray) * vec3(1.12, 0.95, 0.70);
        col = mix(col, sepia, sepia_strength);

        float n  = fbm(UV * noise_scale);
        float n2 = fbm(UV * noise_scale * 2.5 + vec2(3.7, 1.9));
        col += (n  - 0.5) * 0.05;
        col += (n2 - 0.5) * 0.025;

        float lines = sin(UV.y * 500.0) * 0.015 + sin(UV.y * 180.0) * 0.007;
        col += lines;

        vec2 e = UV * (1.0 - UV);
        float vignette = pow(clamp(e.x * e.y * 16.0, 0.0, 1.0), vignette_strength);
        col *= vignette;

        COLOR = vec4(col, tex.a);
    }
}
```
The `ga = 2.399963` (golden angle) 32-sample spiral is an ink-bleed/halo pass around dark map lines — directly relevant if you want ink to bleed into the parchment. `dot(col, vec3(0.299,0.587,0.114))` is Rec.601 luma; `× vec3(1.12, 0.95, 0.70)` is the sepia tint; `mix(col, sepia, 0.85)`.

### 8.B Paper Design `paper-texture` — complete WebGL2 fragment shader
Source: https://github.com/paper-design/shaders; extracted verbatim from npm `@paper-design/shaders@0.0.77` → `dist/shaders/paper-texture.js` (local copies at `/tmp/pq/npmp/package/dist/shaders/paper-texture.js` and `/tmp/pq/npmp/package/dist/shader-utils.js`).

Defaults (https://shaders.paper.design/paper-texture): `colorBack #ffffff`, `colorFront #9fadbc`, `contrast 0.3`, `roughness 0.4`, `fiber 0.3`, `fiberSize 0.2`, `crumples 0.3`, `crumpleSize 0.35`, `folds 0.65`, `foldCount 5`, `drops 0.2`, `fade 0`, `seed 5.8`.

```glsl
#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform vec4 u_colorFront;
uniform vec4 u_colorBack;
uniform sampler2D u_image;
uniform float u_imageAspectRatio;
uniform float u_contrast;
uniform float u_roughness;
uniform float u_fiber;
uniform float u_fiberSize;
uniform float u_crumples;
uniform float u_crumpleSize;
uniform float u_folds;
uniform float u_foldCount;
uniform float u_drops;
uniform float u_seed;
uniform float u_fade;
uniform sampler2D u_noiseTexture;

in vec2 v_imageUV;
out vec4 fragColor;

float getUvFrame(vec2 uv) {
  float aax = 2. * fwidth(uv.x);
  float aay = 2. * fwidth(uv.y);
  float left   = smoothstep(0., aax, uv.x);
  float right = 1. - smoothstep(1. - aax, 1., uv.x);
  float bottom = smoothstep(0., aay, uv.y);
  float top = 1. - smoothstep(1. - aay, 1., uv.y);
  return left * right * bottom * top;
}

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

float randomR(vec2 p) {
  vec2 uv = floor(p) / 100. + .5;
  return texture(u_noiseTexture, fract(uv)).r;
}

float valueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = randomR(i);
  float b = randomR(i + vec2(1.0, 0.0));
  float c = randomR(i + vec2(0.0, 1.0));
  float d = randomR(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x1 = mix(a, b, u.x);
  float x2 = mix(c, d, u.x);
  return mix(x1, x2, u.y);
}
float fbm(vec2 n) {
  float total = 0.0, amplitude = .4;
  for (int i = 0; i < 3; i++) {
    total += valueNoise(n) * amplitude;
    n *= 1.99;
    amplitude *= 0.65;
  }
  return total;
}

float randomG(vec2 p) {
  vec2 uv = floor(p) / 50. + .5;
  return texture(u_noiseTexture, fract(uv)).g;
}
float roughness(vec2 p) {
  p *= .1;
  float o = 0.;
  for (float i = 0.; ++i < 4.; p *= 2.1) {
    vec4 w = vec4(floor(p), ceil(p));
    vec2 f = fract(p);
    o += mix(
    mix(randomG(w.xy), randomG(w.xw), f.y),
    mix(randomG(w.zy), randomG(w.zw), f.y),
    f.x);
    o += .2 / exp(2. * abs(sin(.2 * p.x + .5 * p.y)));
  }
  return o / 3.;
}

/* fiberNoise block — see §5.1 for full body */

vec2 randomGB(vec2 p) {
  vec2 uv = floor(p) / 50. + .5;
  return texture(u_noiseTexture, fract(uv)).gb;
}
float crumpledNoise(vec2 t, float pw) {
  vec2 p = floor(t);
  float wsum = 0.;
  float cl = 0.;
  for (int y = -1; y < 2; y += 1) {
    for (int x = -1; x < 2; x += 1) {
      vec2 b = vec2(float(x), float(y));
      vec2 q = b + p;
      vec2 q2 = q - floor(q / 8.) * 8.;
      vec2 c = q + randomGB(q2);
      vec2 r = c - t;
      float w = pow(smoothstep(0., 1., 1. - abs(r.x)), pw) * pow(smoothstep(0., 1., 1. - abs(r.y)), pw);
      cl += (.5 + .5 * sin((q2.x + q2.y * 5.) * 8.)) * w;
      wsum += w;
    }
  }
  return pow(wsum != 0.0 ? cl / wsum : 0.0, .5) * 2.;
}
float crumplesShape(vec2 uv) {
  return crumpledNoise(uv * .25, 16.) * crumpledNoise(uv * .5, 2.);
}

vec2 folds(vec2 uv) {
  vec3 pp = vec3(0.);
  float l = 9.;
  for (float i = 0.; i < 15.; i++) {
    if (i >= u_foldCount) break;
    vec2 rand = randomGB(vec2(i, i * u_seed));
    float an = rand.x * TWO_PI;
    vec2 p = vec2(cos(an), sin(an)) * rand.y;
    float dist = distance(uv, p);
    l = min(l, dist);
    if (l == dist) {
      pp.xy = (uv - p.xy);
      pp.z = dist;
    }
  }
  return mix(pp.xy, vec2(0.), pow(pp.z, .25));
}

float drops(vec2 uv) { /* see §4.3 */ }

void main() {
  vec2 imageUV = v_imageUV;
  vec2 patternUV = v_imageUV - .5;
  patternUV = 5. * (patternUV * vec2(u_imageAspectRatio, 1.));

  vec2 roughnessUv = 1.5 * (gl_FragCoord.xy - .5 * u_resolution) / u_pixelRatio;
  float roughness = roughness(roughnessUv + vec2(1., 0.)) - roughness(roughnessUv - vec2(1., 0.));

  vec2 crumplesUV = fract(patternUV * .02 / u_crumpleSize - u_seed) * 32.;
  float crumples = u_crumples * (crumplesShape(crumplesUV + vec2(.05, 0.)) - crumplesShape(crumplesUV));

  vec2 fiberUV = 2. / u_fiberSize * patternUV;
  float fiber = fiberNoise(fiberUV, vec2(0.));
  fiber = .5 * u_fiber * (fiber - 1.);

  vec2 normal = vec2(0.);
  vec2 normalImage = vec2(0.);

  vec2 foldsUV = patternUV * .12;
  foldsUV = rotate(foldsUV, 4. * u_seed);
  vec2 w = folds(foldsUV);
  foldsUV = rotate(foldsUV + .007 * cos(u_seed), .01 * sin(u_seed));
  vec2 w2 = folds(foldsUV);

  float drops = u_drops * drops(patternUV * 2.);

  float fade = u_fade * fbm(.17 * patternUV + 10. * u_seed);
  fade = clamp(8. * fade * fade * fade, 0., 1.);

  w = mix(w, vec2(0.), fade);
  w2 = mix(w2, vec2(0.), fade);
  crumples = mix(crumples, 0., fade);
  drops = mix(drops, 0., fade);
  fiber *= mix(1., .5, fade);
  roughness *= mix(1., .5, fade);

  normal.xy += u_folds * min(5. * u_contrast, 1.) * 4. * max(vec2(0.), w + w2);
  normalImage.xy += u_folds * 2. * w;
  normal.xy += crumples;
  normalImage.xy += 1.5 * crumples;
  normal.xy += 3. * drops;
  normalImage.xy += .2 * drops;
  normal.xy += u_roughness * 1.5 * roughness;
  normal.xy += fiber;
  normalImage += u_roughness * .75 * roughness;
  normalImage += .2 * fiber;

  vec3 lightPos = vec3(1., 2., 1.);
  float res = dot(normalize(vec3(normal, 9.5 - 9. * pow(u_contrast, .1))), normalize(lightPos));

  vec3 fgColor = u_colorFront.rgb * u_colorFront.a;
  float fgOpacity = u_colorFront.a;
  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  float bgOpacity = u_colorBack.a;

  imageUV += .02 * normalImage;
  float frame = getUvFrame(imageUV);
  vec4 image = texture(u_image, imageUV);
  image.rgb += .6 * pow(u_contrast, .4) * (res - .7);
  frame *= image.a;

  vec3 color = fgColor * res;
  float opacity = fgOpacity * res;
  color += bgColor * (1. - opacity);
  opacity += bgOpacity * (1. - opacity);
  opacity = mix(opacity, 1., frame);
  color -= .007 * drops;
  color.rgb = mix(color, image.rgb, frame);

  fragColor = vec4(color, opacity);
}
```
**Architectural takeaway that matters most for a Canvas2D port:** every "surface" feature (roughness, fiber, crumples, folds, drops) accumulates into a 2-component `normal`, and the *only* place colour is produced is one line: `float res = dot(normalize(vec3(normal, 9.5 - 9.*pow(u_contrast,.1))), normalize(vec3(1.,2.,1.)));` followed by `color = fgColor * res`. Paper is lit, not tinted. `roughness` and `crumples` are computed as **central differences** (`f(p+δ) - f(p-δ)`), i.e. they're already slopes, which is why they can be summed directly into a normal. Replicating this single idea — accumulate a height derivative, then do one dot-product lighting pass — gets you 80% of the realism.

Also note: `randomR/randomG/randomGB` all sample a baked **128×128 RGB noise PNG** (`get-shader-noise-texture.js`, a base64 data URI) rather than computing `fract(sin(dot(...)))`. For Canvas2D, precompute an equivalent `Uint8ClampedArray` LUT once and index it — it is dramatically faster than per-pixel `Math.sin`.

---

## 9. Bonus: Azgaar's Fantasy Map Generator — what it actually does

Verbatim from `src/index.html` of https://github.com/Azgaar/Fantasy-Map-Generator. **FMG does *not* generate parchment procedurally** — it uses raster texture images plus SVG filters. The texture dropdown options are:
`folded-paper-big.jpg`, `folded-paper-small.jpg`, `gray-paper.jpg`, `soiled-paper.jpg`, `soiled-paper-vertical.jpg`, `plaster.jpg` (the code default: `.attr("data-href", "./images/textures/plaster.jpg")`), `ocean.jpg`, `antique-small.jpg`, `antique-big.jpg`, `pergamena-small.jpg`, `marble-big.jpg` (`selected`), `marble-small.jpg`, `marble-blue-small.jpg`.

The relevant filters, verbatim:
```xml
<filter id="paper" name="Paper" filterUnits="objectBoundingBox"
        primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feGaussianBlur stdDeviation="1 1" in="SourceGraphic" edgeMode="none" result="blur" />
  <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="4"
                seed="1" stitchTiles="stitch" result="turbulence" />
  <feDiffuseLighting surfaceScale="2" diffuseConstant="1" lighting-color="#707070"
                     in="turbulence" result="diffuseLighting">
    <feDistantLight azimuth="45" elevation="20" />
  </feDiffuseLighting>
  <feComposite in="diffuseLighting" in2="blur" operator="lighter" result="composite" />
  <feComposite in="composite" in2="SourceGraphic" operator="in" result="composite1" />
</filter>

<filter id="crumpled" name="Crumpled" ...>
  <feGaussianBlur stdDeviation="2 2" in="SourceGraphic" edgeMode="none" result="blur" />
  <feTurbulence type="turbulence" baseFrequency="0.05 0.05" numOctaves="4"
                seed="1" stitchTiles="stitch" result="turbulence" />
  <feDiffuseLighting surfaceScale="2" diffuseConstant="1" lighting-color="#828282"
                     in="turbulence" result="diffuseLighting">
    <feDistantLight azimuth="320" elevation="10" />
  </feDiffuseLighting>
  <feComposite in="diffuseLighting" in2="blur" operator="lighter" result="composite" />
  <feComposite in="composite" in2="SourceGraphic" operator="in" result="composite1" />
</filter>

<filter id="pencil" name="Pencil">
  <feTurbulence baseFrequency="0.03" numOctaves="6" type="fractalNoise" />
  <feDisplacementMap scale="3" in="SourceGraphic" xChannelSelector="R" yChannelSelector="G" />
</filter>
<filter id="turbulence" name="Turbulence">
  <feTurbulence baseFrequency="0.1" numOctaves="3" type="fractalNoise" />
  <feDisplacementMap scale="10" in="SourceGraphic" xChannelSelector="R" yChannelSelector="G" />
</filter>

<filter id="filter-sepia" name="Sepia">
  <feColorMatrix values="0.393 0.769 0.189 0 0  0.349 0.686 0.168 0 0  0.272 0.534 0.131 0 0  0 0 0 1 0" />
</filter>
<filter id="filter-dingy" name="Dingy">
  <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0.3 0.3 0 0  0 0 0 1 0" />
</filter>
<filter id="filter-tint" name="Tint">
  <feColorMatrix values="1.1 0 0 0 0  0 1.1 0 0 0  0 0 0.9 0 0  0 0 0 1 0" />
</filter>
```
The `filter-sepia` matrix (`0.393 0.769 0.189 / 0.349 0.686 0.168 / 0.272 0.534 0.131`) is the standard Microsoft sepia matrix — implement it directly in your `ImageData` loop. `filter-tint` (`R×1.1, G×1.1, B×0.9`) is a one-multiply warm-paper cast. `filter-dingy` (`B = 0.3G + 0.3B`) crushes blue — a very cheap "aged" pass. **`baseFrequency 0.05` with `numOctaves 4` in `userSpaceOnUse` units is FMG's calibrated paper-grain frequency**; `0.03/6 oct` for pencil jitter, `0.1/3 oct` for coarse turbulence, `0.01/4 oct` for splotches (§4.2).

---

## 10. GIMP/Photoshop recipes translated to noise operations

**Sue Daniel / ProFantasy** — https://rpgmaps.profantasy.com/making-parchments-and-parchment-scrolls-part-1-by-sue-daniel/ (verbatim values):
1. Base fill **`#d3a96c`**
2. `PLASMA` layer: Filters > Render > Clouds > Plasma (defaults) → Desaturate (Luminosity) → blend mode **Overlay**
3. `NOISE` layer: duplicate base → Desaturate (Luminosity) → Filters > Noise > HSV Noise → blend mode **Burn** → Gaussian Blur **radius 1** → opacity **30%**
4. Optional depth: New from Visible → Filters > Map > Bump Map, map type **Spherical**, depth **≈5**

**H.M. Turnbull** — https://hmturnbull.com/fantasy-writing/maps/parchment-gimp/: Solid Noise with *"Detail slider to maximum"*; Hue-Saturation *"Move the Hue slider just slightly to the left, towards red. I found a value between **-5 and -10** worked well"*; grey layer saturation *"a value of around **0.2** works well here"*.

**GIMP Solid Noise semantics** (https://docs.gimp.org/2.10/en/gimp-filter-noise-solid.html): `X size, Y size` range **0.1 to 16.0** (anisotropy control — this is your fiber-stretch knob); `Detail` = octave count, "higher values give a higher level of detail" with harder appearance, low = "more soft and cloudy"; `Turbulent` = the `abs()` variant (§1.2 turbulence.frag); `Tileable` = seamless.

Translation for your renderer: **Plasma+Overlay = domain-warped fBm composited with `globalCompositeOperation='overlay'`**; **HSV-Noise+Burn+blur1+30% = white noise → 1px box blur → `'color-burn'` at α=0.3**; **Bump Map spherical depth 5 = the `dot(normalize(vec3(∇h, k)), L)` lighting pass from §8.B**.

---

## 11. Concrete recommendation for a TS Canvas2D fantasy-map renderer

Ordered pipeline, all constants sourced above:

1. **Base fill** — `#E8D9B5` (or `#d3a96c` if you want the GIMP look and will lighten it in step 3).
2. **Large tone variation** — 3-octave fBm, freq 2.0, lac 1.99, gain 0.65 (Paper Design), **domain-warped** with iq's pattern at k=2.0 and offsets `(5.2,1.3)/(1.7,9.2)/(8.3,2.8)`. Map through the 5-stop ramp `#F5EDD8 → #E8D9B5 → #C9B092`. Composite `'overlay'` at α ≈ 0.5.
3. **Stains** — `dirt = fbm(uv*8) * fbm(uv*18.4 + (4.1,2.7)) * fbm(uv*4 + (1.2,8.3))`, apply `col -= pow(dirt,1.5)*0.4`, or as a separate `'multiply'` layer tinted `#8A6A50`. Add 3–8 hard-edged blotches via `alpha = clamp(1.2 - 0.9*fbm(uv*0.6), 0, 1)` (FMG splotch matrix) + a 4px blur.
4. **Fibers** — `length(∇fbm₄)` with per-octave `rotate(0.7)`, ε=0.001, freq ≈ 10× pattern UV, gain 0.6 (Paper Design). Scale by 0.3, composite `'soft-light'`. If too slow: anisotropic fBm at `vec2(uv.x, uv.y*40)` (Codrops 0.01/0.4 ratio).
5. **Lighting** — accumulate all of steps 2–4 as *derivatives* into a 2-component normal, then one pass: `res = dot(normalize([nx, ny, 9.5 - 9*pow(contrast,0.1)]), normalize([1,2,1]))`, `col *= res`.
6. **Sepia** — either the Rec.601 route `gray = 0.299R+0.587G+0.114B; sepia = gray * [1.12, 0.95, 0.70]; mix(col, sepia, 0.85)` (Godot), or the FMG matrix `0.393/0.769/0.189 · 0.349/0.686/0.168 · 0.272/0.534/0.131`.
7. **Edge burn** — perturb `d = clamp(uv.x*(1-uv.x)*uv.y*(1-uv.y)*16, 0, 1)` by `(fbm(uv*6)-0.5)*0.35 + (fbm(uv*24)-0.5)*0.08`, then `smoothstep(0.02, 0.14, d)` for alpha and `1-smoothstep(0.06,0.30,d)` for the char ramp toward `#3A1D12` with an ember band at `#C77C55`.
8. **Vignette** — `pow(clamp(uv.x*(1-uv.x)*uv.y*(1-uv.y)*16, 0, 1), 0.7)` multiplied in.
9. **Grain** — one 100×100 `OffscreenCanvas` tile, `rgb = Math.random()*256|0` written to all three channels, α = 0.05–0.10, `createPattern(..., 'repeat')`, `globalCompositeOperation = 'overlay'`. Then a final `±1/512` per-channel dither (`color += 1/256 * (hash(0.014*xy) - 0.5)`) to kill banding.

**Sources**

- [iq — fBm](https://iquilezles.org/articles/fbm/) · [iq — Domain warping](https://iquilezles.org/articles/warp/)
- [The Book of Shaders ch.13](https://thebookofshaders.com/13/) · [README.md](https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/README.md) · [2d-fbm.frag](https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/2d-fbm.frag) · [turbulence.frag](https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/turbulence.frag) · [ridge.frag](https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/ridge.frag) · [clouds.frag](https://raw.githubusercontent.com/patriciogonzalezvivo/thebookofshaders/master/13/clouds.frag)
- [LYGIA fbm.glsl](https://raw.githubusercontent.com/patriciogonzalezvivo/lygia/main/generative/fbm.glsl) · [GLSL Noise Algorithms gist](https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)
- [Godot Shaders — Retro Parchment Paper](https://godotshaders.com/shader/retro-parchment-paper/) · [fBM snippet](https://godotshaders.com/snippet/fractal-brownian-motion-fbm/) · [Burning paper](https://godotshaders.com/shader/burning-paper/) · [Vignette](https://godotshaders.com/shader/vignette/) · [Old movie shader](https://godotshaders.com/shader/old-movie-shader/)
- [Paper Design shaders](https://github.com/paper-design/shaders) · [paper-texture docs/defaults](https://shaders.paper.design/paper-texture) · npm `@paper-design/shaders@0.0.77`
- [Azgaar Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator)
- [Figma — Parchment #F1E9D2](https://www.figma.com/colors/parchment/) · [color-hex Parchment palette](https://www.color-hex.com/color-palette/11486) · [media.io sepia palettes](https://www.media.io/color-palette/sepia-color-palette.html) · [SchemeColor Old Map](https://www.schemecolor.com/old-map.php) · [subframe CSS paper effects](https://www.subframe.com/tips/css-paper-effect-examples)
- [Codrops — feTurbulence texture](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/) · [Codrops — dissolve effect](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/) · [cssShowcase noise texture](https://www.cssshowcase.com/snippets/color/noise-texture)
- [grained.js source](https://raw.githubusercontent.com/sarathsaleem/grained/master/grained.js) · [grained docs](https://sarathsaleem.github.io/grained/)
- [ProFantasy — Making parchments (Sue Daniel)](https://rpgmaps.profantasy.com/making-parchments-and-parchment-scrolls-part-1-by-sue-daniel/) · [Parchment in GIMP](https://hmturnbull.com/fantasy-writing/maps/parchment-gimp/) · [GIMP Solid Noise docs](https://docs.gimp.org/2.10/en/gimp-filter-noise-solid.html)
- [Procedural Textures in GLSL — Noise, fBm, Worley, Marble](https://www.mysimulator.uk/content/articles/procedural-textures.html) · [Texturize paper generator](https://texturize.app/generators/paper) · [ghostty paper-balanced.glsl](https://raw.githubusercontent.com/yigitkonur/ghostty-crt-shaders/main/shaders/paper-balanced.glsl)

agentId: aa9e46e1900b6f9a4 (use SendMessage with to: 'aa9e46e1900b6f9a4', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 222571
tool_uses: 95
duration_ms: 1093817</usage>

---

<!-- fuente: mountains-hills-symbols.md -->

I have comprehensive coverage. Here is the technical report.

---

# DRAGONS ABOUND — MOUNTAIN & HILL SYMBOL PLACEMENT AND DRAWING
## Implementable recipe extracted from heredragonsabound.blogspot.com (Scott Turner)

**Corpus note:** I enumerated the complete blog via the Blogger JSON feed (`https://heredragonsabound.blogspot.com/feeds/posts/summary?max-results=500&alt=json`) — **201 posts total, 2016-10-06 → 2022-06-11** (blog ends at "Cleanup Time", 2022-06-11; there are **no 2023 posts**). 24 posts have mountain/hill/ridge in the title. I fetched ~40 pages.

**CRITICAL UP-FRONT CAVEAT:** Turner **never publishes hex colors, stroke-width values in px, or opacity numbers for mountains anywhere in the blog.** Blog-wide search confirms this (`grep '#[0-9a-fA-F]{3,6}'` across every fetched post = zero hits). He also never uses the terms "painter's algorithm", "hachure", "ridge detection", "local maxima", or "Poisson" *for mountains* (Poisson is used, but described in the forest post). Blogger search for those terms returns zero real hits. Everything below that is a number is a number he actually wrote. Where he gives only a qualitative statement I flag it as **[qualitative]**.

---

# 1. WHERE MOUNTAINS ARE (heightmap → "mountain" locations)

## 1.1 Terrain generation — verbatim pseudo-code
Source: https://heredragonsabound.blogspot.com/2016/10/mountains.html

```
// Combine 6 octaves of noise with a 50% fall off
height[x,y] = Noise.octave(x*4,y*4,6,0.5);
```

```
// Ridged noise
height[x,y] = 1 - Math.abs(Noise.noise(x*4,y*4));
```

```
// Combine 6 octaves of ridged noise with a 50% fall off
height[x,y] = 1 - Math.abs(Noise.octave(x*4,y*4,6,0.5));
```

His note on the `*4`: *"Note that I'm multiplying the (x,y) coordinates by 4 when passing them into the noise function. This is a handy trick for starting your octaves at a higher frequency. Each doubling of the coordinates effectively shifts the noise up one octave. So in this case, I'm skipping the lowest two frequencies of noise."* (same URL)

## 1.2 The dual-threshold mountain mask — verbatim pseudo-code
Source: https://heredragonsabound.blogspot.com/2016/10/mountains.html

```
// Create the mountain mask.  Changing the frequency of the
// noise here can create different kinds of clumps
for each location "loc" on the map:
  noise[loc] = Noise.noise(x,y);
// Find the two thresholds
T = findThreshold(noise, mountainPercentage);
T2 = findThreshold(noise, hillPercentage);
// Put down the mountains/hills
for each location "loc" on the map:
  if noise[loc] > T2 then
     // Use whichever mountain algorithm you like here
     rawHeight = Noise.noise(x*4,y*4);
     // Mask this value
     actualHeight = rawHeight * Math.min(1, (noise[loc]-T2)/(T-T2));
     // And add it to the terrain
     height[loc] += actualHeight;
```

**This is the key structure: `T` = mountain threshold, `T2` = hill threshold, T2 < T. Between T2 and T the mountain height is linearly faded via `Math.min(1, (noise-T2)/(T-T2))`.** Both thresholds are found by *percentile*, not by absolute value — `findThreshold(noise, pct)` returns the value such that `pct` of the map exceeds it.

Design criteria he states (same URL):
> "Mountains should cover a reasonable percentage of the map. / Mountains should merge realistically into the neighboring terrains. / The distribution of the mountains should be a reasonable pattern."

Alternative he offers: *"if you don't like the semi-random placement from using a noise mask, and already have a base terrain, an approach that yields reasonable (if somewhat boring) placement is to locate the mountains on the highest parts of the existing terrain. And again, you can use thresholding to fade the mountains into the surrounding terrain."*

## 1.3 The symbol-level rule (the one that actually drives placement)
Source: https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html

> "Figuring out where the mountains are on the map is straightforward. Like most procedural map generation, I have a height map for the world. **I decide what percentage of the map should be mountains (this can vary, so that map might have lots of mountains or few mountains) and declare that percentage of the highest land locations "mountains".**"

**So: no ridge detection, no local maxima, no slope threshold. It is a pure percentile threshold on the heightmap.** This is the single most important thing to know — Turner never implemented ridge detection for symbol placement.

## 1.4 Mountain RANGES along fault lines (how ranges are grown)
Source: https://heredragonsabound.blogspot.com/2016/10/its-not-my-fault.html

Verbatim JS, quoted in full from the post:

```javascript
//
//  Distance from a Point to a Line Segment
//
//  This calculates the distance from (x,y) to the line defined by the
//  two points (x0, y0) and (x1, y1).  If segment is true, the line
//  is treated as a line segment.
//
function distanceFromPointToSegment(x, y, x0, y0, x1, y1, segment) {
    var d = (x1-x0)*(x1-x0)+(y1-y0)*(y1-y0);
    var t = ((x-x0)*(x1-x0)+(y-y0)*(y1-y0))/d;
    // If t < 0 || t > 1 we're off the end of the segment, and
    // the distance is just the distance to the proper endpoint. 
    if (segment && t < 0) {
    return Math.sqrt((x-x0)*(x-x0)+(y-y0)*(y-y0));
    };
    if (segment && t > 1) {
    return Math.sqrt((x-x1)*(x-x1)+(y-y1)*(y-y1));
    };
    // Otherwise calculate the perpendicular point and then
    // the distance to that point.
    var xp = x0 + t*(x1-x0);
    var yp = y0 + t*(y1-y0);
    return Math.sqrt((x-xp)*(x-xp)+(y-yp)*(y-yp));
}; 
```

Range recipe (same URL):
1. *"Randomly create a line that crosses the map and then add height to the land based upon how far away the land is from the line."* (inverse distance → slope on both sides)
2. Perturb the fault line with noise: *"We can fix this by using noise to perturb the fault line."*
3. Build a **separate, steeper/narrower mask** around the fault: *"What we need is a mask for the area around the fault line. But that's just a steeper and narrower version of the fault itself."*
4. **Apply the identical perturbation to both**: *"you just need to make sure you use the same perturbation to both the fault line and the mountains mask."*
5. Generate mountain noise and add it filtered by the mountains mask.

He calls this shape a **"tent mask"** (https://heredragonsabound.blogspot.com/2016/11/islands-are-just-mountains-up-to-their.html — *"the same tent mask that I used to create mountain ranges will serve for this purpose as well"*).

---

# 2. PLACEMENT OF SYMBOLS — the two generations of algorithm

## 2.1 Generation 1 (2017): greedy, exclusion-radius
Source: https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html — **verbatim**:

> "My initial approach for placing the mountain symbols was to **go through the map from North to South (essentially from back to front)** and when I hit a mountain location, **I check to see if there's already a mountain symbol on the map within some distance (based on the size of the symbol I would put down for this location) from this location.** If there is, I skip putting down a mountain symbol. If there isn't then I put down a mountain symbol for this location and continue on."

Then the revision:

> "This works okay, but one drawback is that it essentially picks the locations to illustrate with symbols at random. **On the theory that the big mountains are more important, I rewrote the algorithm to walk through the mountains from biggest to smallest**, so that the tallest mountains get drawn preferentially."

Density control + exclusion geometry (same URL):

> "**By varying the distance to exclude other mountains, I can control whether the mountains are sparse or dense on the map.** Dense layouts have a certain appeal -- the mountains almost form a texture"

> "**Right now, I'm calculating the exclusion distance as a circular radius around a location.** A more sophisticated approach would be to create a bounding box around the mountain, or even intersect the actual symbols. But I'm not sure that would add much value. **I'm not trying to make the mountains never overlap with each other. A certain amount of overlap is good**, and the semi-random occurrence helps create some interest as well."

**Note the ordering conflict:** the sort key changed from **y (north→south)** to **height (biggest→smallest)**. Once he sorts by height, back-to-front correctness is no longer guaranteed by iteration order — see §3.

## 2.2 Generation 2 (2019–2020): overlap-percentage rejection
Source: https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html — **verbatim, with the only hard number for density in the whole blog**:

> "The current algorithm in Dragons Abound for drawing groups **looks at each mountain location on the map in height order (tallest to smallest)**, draws an appropriately sized mountain there and then **checks how much it overlaps previously drawn mountains. If it overlaps too much, it's removed.** By tweaking the allowed amount of overlap, I can get different densities of mountains. **(Usually between 5-35% overlap.)**"

> "This creates a nice even density that is moderately attractive. **The main shortcoming is that it doesn't (except accidentally) give the impression of a mountain chain.** Often it produces what you can see in the example above, which looks like rows of horizontal mountains."

Restated at https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html:
> "mountains are drawn by looking at all the locations in the world from highest to lowest and trying to draw a mountain in each location. If a mountain is drawn and it overlaps too much with mountains that have already been drawn it is rejected and the next location is tested."

**Implementable form:**
```
mountains = all cells with height >= percentile(heightPct)
sort mountains by height DESC
for m in mountains:
    sym = makeMountain(size = f(m.height))
    place sym at m
    if overlapFraction(sym, alreadyPlaced) > maxOverlap:   // maxOverlap ∈ [0.05, 0.35]
        reject
    else:
        alreadyPlaced.push(sym)
```

## 2.3 Coastline rejection constraint
Source: https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html — **verbatim**:

> "Dragons Abound prevents this from happening by **making sure that the location of both the left foot and right foot of the mountain are on land.** ... I also have to take some care in what I use for the left and right feet of the mountain. **I was using the bounding box, but because the baseline of the mountain is an arc, the corners of the bounding box are lower than the ends of the line that defines the top of the mountain. So I had to quit using the bounding box and instead use the end points of the topline.**"

And an additional constraint: *"Both feet of the left-most hill are on land, but the left foot is on an island while the right foot is on the mainland. To fix this, I needed to tweak the check to require **both feet to be in the same land mass.**"*

Earlier statement of intent: *"mountains along the coast line get cut off by the sea. ... I'll probably address this by making sure that no mountains get placed in a way that crosses the coast line."* (https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html)

## 2.4 MOUNTAIN CHAINS (the 2019 innovation — how ranges are traced)
Source: https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html

**The core insight, verbatim:**
> "The key insight is that **the chaining connects a point on the topline of the front mountain to the end of the ridgeline of the previous mountain**"

Three cardinal chain directions (verbatim):
> "**To chain to the right you connect the left end of the topline to the previous ridgeline (red). To chain straight downward, you connect the middle of the topline to to the previous ridgeline (blue). And to chain to the left you connect the right end of the topline to the previous ridgeline (green).** But you're not limited to connecting at those three points. **You can connect at any point on the topline to create an arbitrary direction for the mountain chain.**"

> "It's difficult to calculate where on the topline you should intersect to create a chain at a given angle, but **extrapolating along the length of the topline gives a rough approximation.**"

Chain construction, verbatim: *"I do this by **drawing the mountains from back to front, and setting the origin of each mountain (which is the left end of the topline) to be the end of the previous ridgeline.**"*

Line-following variant (verbatim):
> "**My solution was to place the new mountain on the line and then slide it back and forth on the line to find a spot where the end of the previous ridgeline just touches the topline of the new mountain.** An iterative and not particularly efficient approach"
> "The advantage of this approach is that **the centerpoints of all the mountain lie along the line**, so the mountain chain follows the line perfectly."

Fade suppression inside chains (verbatim): *"the ridgelines and the toplines can fade out near the end. When this happens the lines do not meet up to form a continuous line through the whole chain. ... **it's easy enough to turn off the line fade when I'm drawing a mountain chain**"*

Upward chains require inverted intersection (https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html):
> "instead of intersecting the topline of the new mountain with the ridgeline of the old mountain, **you have to do the opposite -- intersect the topline of the old mountain with the ridgeline of the new mountain.**"

## 2.5 Filling a mountain AREA with chains + Poisson fill
Source: https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html

Pipeline, verbatim:
1. *"I already have a routine that subsets the map and draws polygons around the identified areas ... Here the red line (somewhat relaxed) circles groups of map locations with mountain height. **I've excluded smaller areas, since they're likely too small to fit a mountain chain.**"*
2. *"My initial approach is to **find the long axis of the area and run mountain chains parallel to that axis** ... **This is very similar to the way I add hatching to an area of shadows.**"* — i.e. **he literally reuses the hatching sweep code, with mountain chains as the hatch lines.**
3. *"Let me **find the longest chord for the polygon and use that as the slope** instead"*
4. *"the mountain chains are too obviously regular, so let me **add some noise to the lines** ... Here I'm **using the same noise source for all the chains, so the perturbations are somewhat correlated.**"*
5. *"To do this I'll use **Poisson disc sampling** ... to fill the polygon with a psuedo-random locations ... And then I'll **try putting a mountain at each blue dot and if it doesn't overlap too badly with an existing mountain, I'll keep it**"*

**Poisson implementation details** (from the post he links for it, https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html):
> "a good distribution that meets this criteria called Poisson-disc sampling, and discusses an efficient algorithm for creating a Poisson-disc sample called **Bridson's algorithm**"
> "**I'll grab an implementation of Bridson's algorithm from [https://github.com/beaugunderson/poisson-disc-sampler] and use it to sample a rectangle**"
> "To make this more efficient, **I can embed a test within the algorithm so that it doesn't explore any point outside the polygon.** As long as I then **start the sampling within the polygon (which I can do by picking one of the vertices as the starting sample)** and the polygon is reasonably shaped, then the algorithm will only explore points within the polygon or one sample outside the polygon"
> (holes support) *"I need my Poisson disc sampling function to take a list of holes in the polygon and treat those areas the same as the outside of the polygon. **This is essentially just a one-line change**"*

Note the escape allowance: *"the lines are inside the polygon, and the mountain centers are on the lines, **but the mountains themselves may stray outside the polygon.** Generally I don't think this will be a problem on the map, because **there's no indications of the areas other than the mountains themselves.**"*

## 2.6 CENTERLINE ("spine") backbone — the final preferred method
Source: https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-7.html — **verbatim**:

> "A better approach might be to **draw a mountain chain down the "spine" of the region, and then fill in around it.**"
> "The spine of a polygon is usually called the "centerline." ... **The short version is that you create a Voronoi diagram based on the points in the polygon and then find the longest path through the Voronoi edges.**" (he links https://observablehq.com/@veltman/centerline-labeling)
> "in both polygons the line curves back around at the ends to be longer. **For the purposes of drawing mountain chains I prefer straighter lines, even if they're not the longest possible. To select straighter lines, I have to incorporate that in the metric for picking the path. I introduced the idea of sinuosity when placing path labels, so I'll combine that with length to pick a path**" (sinuosity ref: https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html)
> "There's something of a glitch where the line takes a sharp turn in the middle of the larger region. **In general it is difficult for the mountain ranges to follow abrupt changes of direction. Smoothing the centerline helps with this**"

**Final verdict, verbatim:** *"Placing a chain of mountains down the centerline and then filling the region sparsely with other mountains seems to work pretty well. The centerline gives the mountain area an identifiable structure, and the random mountains define the total area. At least right at the moment I like this better than filling the area completely with random mountains or filling the area with parallel mountain chains."*

And the unification (https://heredragonsabound.blogspot.com/2020/02/new-mountain-style-part-9.html): *"since the new approach draws mountain chains and then fills in around them with random mountains, **if I don't draw a mountain chain and just fill in randomly, it's equivalent to the old style of mountain fill.** So I can collapse both styles into one implementation."*

## 2.7 Anti-collinearity fixes inside chains
Source: https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-7.html — **verbatim**:

> "on the left side of the main mountain chain **the slope of the chain is almost the same as the slopes on the right side of the toplines and it creates a clumsy looking progression where all the mountain sides align** ... One way a human would avoid this problem would be not to draw adjacent mountains with the same slopes (so that they couldn't line up). **I can implement something like this by forcing the slopes of the mountains along the chain to alternate between wide and narrow** ... I was worried that strict alternation would be obvious, but it doesn't seem to be a problem."

> "Another approach ... **To detect collinear sides is pretty difficult, but it's fairly easy to tell when the peak of the front mountain is close to the right topline of the back mountain, and this is a good enough indicator. When this happens, I can move the mountain away from the topline. Moving the mountain randomly doesn't work very well; it's better to move it along the normal of the topline.**"

Also: *"force the chain to peak in the middle"* (larger mountains mid-chain) — same URL, and https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html (*"an experiment where the mountains are higher in the middle of the chain rather than entirely random"*).

---

# 3. BACK-TO-FRONT / OCCLUSION (the "painter's algorithm")

Turner never uses the phrase. The mechanics, verbatim:

**Sort key = screen Y (top → bottom = back → front).** https://heredragonsabound.blogspot.com/2016/12/two-mountains-are-better-than-one.html:
> "This requires that a **mountain cover over anything that's already there when it is drawn.** ... So the mountain on the right appears to be in front of the mountain on the left. **When drawing mountains on a map, we can draw them from top to bottom, so that the overlap properly reflects how far away the mountains are from the viewer's eye.**"

**Re-sort pass after chain+fill (because height-order and chain-order break Y-order).** https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html — **this is the exact sort key statement**:
> "One problem with filling in after the chains are drawn is that **the fill mountains aren't drawn from the top to the bottom, so they overlap incorrectly. At the end of all mountain drawing, I need to go through the list of all mountains from top to bottom moving them up to the top of the drawing. This puts them all in the correct order.**"

(In SVG that's a DOM re-append pass: iterate sorted-by-Y-ascending, `parent.appendChild(node)` each one.)

**Refined sort key = lowest point on the mountain, not the center.** https://heredragonsabound.blogspot.com/2020/02/new-mountain-style-part-9.html — **verbatim**:
> "There's also a problem with how the mountains are overlapped -- **the algorithm is overlapping them based upon the mountain centers, when it really should be the lowest point on the mountain.** This is making the mountains overlap too much."

**Occlusion = opaque fill + a mask apron below the baseline.**
- https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html: *"**Masking is fairly straightforward -- I just need to take the outline of the mountain, connect it across the bottom and fill that with the background color. It's also good to add a little buffer at the bottom of the mountain so that another mountain "behind" the front mountain doesn't peek out.**"*
- https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html: *"**Each mountain blocks out a chunk of the map below its baseline.** I added this because when tightly packed, **the ridgeline of the back mountain often peeks out below the front mountain.** But this seems to be less of a problem with this method of filling the mountain areas, so **I can probably reduce the size of the masking.**"*
- https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html: *"When you draw a mountain in front of another mountain, the back mountain shows through. **So I need to fill in the mountains so that they properly obscure anything that's "behind" them.**"*

**There is NO white halo.** The fill is **the sampled land color**, not white:
- https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html: *"**The closest I can get is to sample the color at the center bottom of the mountain and fill the mountain with that color.** Doing this makes the center bottom of the mountain match the map."*
- https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html: *"Right now about all I can do is **fill the mountain with whatever color is under the center of the mountain.**"* (note the two posts disagree: "center" vs "center bottom" — the later post, purple, says center **bottom**)

**Alpha-compositing gotcha for overlays.** https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html:
> "The mountains are added after the rest of the land is filled, and their color is set to be the color of the underlying terrain. So the mountains don't have the overlay color mixed in ... **A better solution is to mix the overlay color into the terrain itself (rather than use an SVG overlay), so that when the mountains pick up the terrain color it already has the overlay included.** ... this general problem is called **alpha compositing** ... (after figuring out the hard way that **SVG expects only integer RGB values**)"

**Z-order within a single symbol** (three separate statements, all needed):
- Shading under outline: *"**If I draw the shading last, it will go on top of the outline. I want it to be under the outline, so I need to draw it first.**"* (https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html)
- Outline last over highlight: *"The highlight is broader than the shadow, and closer to the outline, so it sometimes obscures the outline ... To fix this, **I can draw the outline last so it is "on top" of the highlight.**"* (https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html)
- **Draw order therefore: mask/fill → shading → highlight → outline.**

---

# 4. SYMBOL CONSTRUCTION

## 4.A "OLD" STYLE (2016–2017) — Bézier concave↔convex continuum

### 4.A.1 The Bézier glyph
Source: https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html — **verbatim**:

> "if we could have parameters that controlled the bend of the mountain at the bottom and at the top, we could interpolate between those shapes by changing the parameters from concave to convex and back again. **As it happens, this is essentially how Bézier curves work.** ... with a Bézier curve you have a start point, an end point and two "control points" that determine how concave or convex the curve is near the start point and end point. **Another (simplified) way to think about it is that the control points are the direction the line moves off from the start (or end) point.**"

> "**it is pretty easy ... to create a routine that draws a mountain using two Bézier curves** and interpolates in the way I've outlined above"

> "**it is nice to be able to generate mountains with rounded tops. To do that, I can insert another Bézier curve into the mountain shape, connecting the two sides with a flat hump**"

**Segmentation numbers (exact):**
> "I actually want to break the curve up into a number of different pieces, so I can do things like perturb the outline. **Breaking an arbitrary path into segments turns out to be a fairly difficult problem, but I can use the browser's built-in capabilities to draw the curve, and then measure along it to chop it up into segments. If I chop each mountain up into (say) 20 pieces, the result is mostly indistinguishable from the original curve** ... **Chopping into 8 pieces makes the segments more obvious**"
> "**since the mountain is symmetrical and has a peak in the middle, I have to be careful to use an even number of segments. Choosing an odd number of segments chops off the top of the mountain**"

**Named parameter (from https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html):** `mtnToplineSegments` — *"controls the number of segments in the topline of a mountain icon ... a mountain icon with just 2 topline segments would be a triangle -- kind of boring ... **In the end, it turned out that 7 was a pretty good value for this parameter**, and there's really no need to change it."* **[Note the tension: "even number" from 2017 vs `7` in 2018 — the 2018 topline is the whole outline, so the parity rule apparently applies to the half-curve construction only.]**

### 4.A.2 Failed and successful sequences (mountain→hill continuum)
Source: https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html — **verbatim**:
> "**the transition from tall, peaky concave mountains to broad convex mountains never looks very good. The convex mountains tend to look much bigger than their concave counterparts.**"
> "I decided that the (one?) problem is that all the mountain elements change over the sequence from mountain to low hill. **I need to keep at least some elements the same over the course of the sequence so that there's a visual consistency. I like the curved feet of the low hills, so I decided to try a sequence that maintains that element.**"
> "Another possibility is to **go from straight to curved on both ends of the mountain contour** ... This is sort of a "**melting**" sequence from high to low"

### 4.A.3 Earlier (pre-Bézier) triangle+noise construction
Source: https://heredragonsabound.blogspot.com/2016/12/the-shape-of-things-to-come.html — **verbatim**:
> "**The basic mountain shape is a triangle.**" + *"code that will make the basic triangle shape vary in both ratio and slope of the sides"*
> **Perturbation axis rule (important):** "**I think the problem is that I'm adding perturbations at right-angles to the lines. In the hand-drawn examples, the perturbations are almost always in just the height (Y axis) -- the bumps point up**"
> **Ridge/shadow line axis rule:** "**To make the shadow line wavy, I'll perturb it using noise the way I did to the mountain outline itself. But in this case, I'm perturbing in the X axis, to make the line curve back and forth, rather than up and down.**"
> **Concavity:** "the sides of the mountains are more often concave than convex ... **I can help that along by making the starting point be a gentle concave curve**"
> **Proportion:** "**it is striking how often the mountain (or mountain cluster) fits the golden ratio** ... **I'll take advantage of this to size my mountains (with some variation) around the golden ratio.**"

Perturbation magnitudes he tested: *"I'll try twice as much perturbation ... Doubling again: That's perhaps a little too jagged ... **A value somewhere between the first and second values seems about right to me.**"* → i.e. base magnitude × ~1.5.

### 4.A.4 Ridge-line perturbation scaling (prevents ridge escaping silhouette)
Source: https://heredragonsabound.blogspot.com/2016/12/how-to-decorate-mountain.html — **verbatim**:
> "**I can solve this problem by scaling the perturbation by the width of mountain. Up at the top where the mountain is narrow there will be less perturbation, and down at the bottom where the mountain is wide there will be more. Measuring the width of the mountain at every point down the line is tedious, but it turns out that it is sufficient to scale the perturbation as if the mountain were a perfect equilateral triangle.**"

→ Implementable: `perturbMag(t) = baseMag * t` where `t` ∈ [0,1] is fractional distance from peak to baseline.

### 4.A.5 "Minor ridge line" on the LIT face
Source: https://heredragonsabound.blogspot.com/2016/12/how-to-decorate-mountain.html — **verbatim**:
> "**I'll make a line from the peak of the mountain down to the middle of the lit face, and pick a spot about halfway down** ... That will be the starting point for my minor ridge line. **Then I'll pick a spot on the baseline of the mountain to create a line at about the same slope as the right side of the mountain**"
> "**I'll add some code to make the ridge line approximately as concave as the mountain side.**"
> "Since this ridge line is roughly at **45 degrees** to the viewer, I'd expect to do some perturbation in the Y axis ... **However, it turns out that adding perturbations in the Y axis looks weird ... So I only add perturbation in the X axis**"
> "**Now I'll set the color to black, use the "hand-drawn" line, and make the line grow from narrow to wide**"
> Its shading pocket: "**I can reuse the ridge line as one side of the shaded area, and then add another line that starts from the same point but gets wider near the bottom. If I apply the same perturbation to both lines** ... Then I just need to scribble in that area with some shading. **Because this area is relatively small and I don't want it too dark, I use lightweight lines.**"

### 4.A.6 "Structure lines"
Same URL — **verbatim**: *"I write a routine to **scan down the right side of the mountain looking for angles between 0 and about 90 degrees. I start the scan part-way down the mountain, because putting a horizontal structure line up near the peak is likely to run into the shading area.** ... Now I have to **(randomly) select one of the two line segments and extend it. I'll also taper the line so that it trails off.**"* Also applied to the ridge line.

### 4.A.7 Face scribbles
Source: https://heredragonsabound.blogspot.com/2016/12/how-to-decorate-mountain-part-2.html — **verbatim**:
> "**construct a bounding box for the mountain face ... And then randomly select points within the bounding box until I get one that is also inside the mountain face.** ... in my case **roughly 50% of the points are going to be inside the polygon**"
> "(ADDENDUM: ... **Now, I draw a line from the peak of the mountain to a random spot on the right side of the mountain ... I then pick a random spot on the line as a starting point for the scribble.**)"
> "**I project a line from the peak down through the point and create a box where the scribble will fall.** Projecting a line down from the peak ensures that the box for the scribble will have the right slope for it's placement on the mountains"
> "**Once I've established the box, I need to check to see if it goes outside the mountain or if it interferes with any of the existing decorations** ... When this happens, I throw the box and the point away, generate a new starting point and try again. (**the algorithm has to have a guard on it that gives up entirely after a few hundred attempts**)"
> "I'm just **taking a line and perturbing it side-to-side**"

### 4.A.8 Merging mountains (three modes)
Source: https://heredragonsabound.blogspot.com/2016/12/two-mountains-are-better-than-one.html — **verbatim**:

Mode 1 (erase overlapped line): *"**find the intersection of the left mountain's right side with the right mountain's left side (!) and then delete the left mountain's right side from that point to the end.**"* + *"if the right mountain is steeper and/or narrower than the left mountain, it might intersect the left mountain again lower down. In that case, I need to erase the line only between the two intersections"* + *"**I can walk down the left mountain's right side from the top, start erasing when I hit an intersection and stop erasing if I hit another intersection.**"* + *"**I can address this by extending the left mountain's mask downward.**"*

Mode 2 (partial erase): *"**Instead of cutting off the line at the point of intersection, I cut it off about 2/3 of the distance to the end of the mountain. I thought something more complex would be needed, but this works surprisingly well.**"*

Mode 3 (cleft/protrusion): *"the right mountain is in front of the left mountain, but **the shaded side is cut off at the point where the mountains intersect along a line parallel to the ridge line**"* + *"**It works a little better if the right mountain shading narrows to the bottom to make it look like a cleft**"*

Known edge case: *"my algorithm assumes that when two mountain sides intersect, they cross ... **there's an edge case when the intersection is the end point of a segment. In that case, the next segment can reverse direction and the lines don't end up crossing**"*

### 4.A.9 Remaining old-style details
Source: https://heredragonsabound.blogspot.com/2017/02/adding-details.html — **verbatim, all scaled by mountain size**:
> "**as the mountain gets smaller, more curve is added to the ridge line that defines the shading, so that the low hills look more rounded and soft than the high mountains.**"
> "**the magnitude of the perturbation will diminish as the mountain gets smaller.** ... **The tall mountains get lots of back-and-forth in the ridge line, and the low hills virtually none.**"
> "**let me add in a tapered foot. Low mountains get a long smoothly tapered foot while the tall mountains get little or none.**"
> "Now I will add perturbations to the mountain outline. **This adds noise in the Y axis (up and down) along the contour as well as a smaller amount of noise perpendicular to the contour.**"
> "**making the base of the mountains rounded downward to indicate depth. I've implemented that ... And then added some jagged perturbations to that, decreasing with the size of the mountain**"
> "add back in "**clefts**" ... to be on either side of the mountain"

Also `lateral breaks` / `vertical breaks` / `findPointAtX` routines named at https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html.

## 4.B "NEW" STYLE (2019–2020) — topline / ridgeline / secondaries

### 4.B.1 Element vocabulary (colors used in his own debug renders)
https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html — **verbatim**: *"**The red line is the topline, the blue line is the ridgeline, the green line is a secondary topline, and the orange line is a secondary ridgeline.**"*

### 4.B.2 TOPLINE — exact statistics from his trace of the reference map
Source: https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html — **verbatim**:
> "they split (almost exactly) into two shapes: **either a simple carat shape, or the carat shape interrupted by a short peak on one or both sides. The highest/biggest mountains are flattened at the peak. These are rare -- about 1 in 20 mountains.**"
> "**The mountains have a range of proportions (width/height) from about 2.25 to 5. The largest mountains tend to be the more square, with proportions in the range of 1.9 to 3.9**, but otherwise the distribution of proportions is pretty random."
> "**the toplines are almost all straight segments.** In the lower middle part of the map many of the mountains have the left side of the topline (the side that is lit) drawn as a curve"
> Baseline: "**many of the mountain baselines slant downward to the right** ... **most of the mountains are symmetrical.** Most of the ones that aren't symmetrical have a sub-peak on the long side that extends that side of the baseline."
> Line weight: "**On the larger mountains, there is a more emphasis in the form of darker lines at the tops of the mountains** ... note that **the line still remains quite dark even at the base of the mountain, and the thickness remains about the same.** ... **the smallest mountains are only lightly sketched in.**"
> **Chaining rule (never break):** "**Of note on this map is that the end of one topline never meets the start of another topline. When toplines touch, it is in the middle of the toplines.**" — rationale: *"If two toplines touch end to end it gives the impression of two side-by-side mountains at the same distance from the viewer. This tends to flatten out the perception of the mountains and make them seem like cutouts."*

Implementation (https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html) — **verbatim**:
> "**The tallest mountains (about 1 in 20, or 5%) have a flattened peak.** Other parameters are how symmetrical the mountains are (these are very symmetrical) and their proportion (**these are generally 3-4x longer in the horizontal direction**)."
> "My initial function **creates a carat shape with the provided possible peak locations (pretty close to the middle) and proportions.**"
> "**Next I create sub-peaks by putting a jog in the mountain's side**"
> Fixes: "**These subpeaks are symmetrical, while the subpeaks in the original mountains have about the same proportions as the mountains themselves. The mountains with subpeaks are also wider, to maintain their proportion. And there are too many mountains with subpeaks on both sides.**"
> "**There are two types of large mountains as well. They are larger than the other mountains, and have either a flat top or a sharp peak. These are constructed by adding the flat top or the sharp peak to the regular mountain shape.**"
> Size distribution: "**There are more small mountains than big ones; that's something I'll need to replicate.**"

### 4.B.3 RIDGELINE — exact geometry
Source: https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html — **verbatim**:
> "**nearly every mountain has a ridgeline; the only exceptions are the smallest faint mountains (hills).**"
> "**the ridgelines generally extend past the baselines except on the tallest mountains.** (This helps with the oblique perspective by compressing the vertical dimension of the map.)"
> "**the first segment of the ridgeline almost always comes straight down and is usually about half of the vertical extent of the ridgeline. Second, the following segments are at sharp alternating angles.** ... **At most there are four segments to each ridgeline, and the final segments are often much shorter than the first segment.**"

Restated with segment lengths (https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html) — **verbatim**:
> "**ridgelines appear on almost every mountain, come more-or-less straight downward from the peak for about half the height of the mountain and then alternate sharp angles, each segment being about a quarter to half the height of the mountain, and generally ending after crossing the baseline of the mountain.**"
> Guard: "**the ridgeline can be too close to one side or the other of the mountain. I can guard against this by putting the end of the first segment in a middle region of the mountain, even if that means it is less vertical.**"

**Implementable:**
```
seg0: from peak, ~vertical, length ≈ 0.5 * mtnHeight, endpoint constrained to middle X-band
seg1..seg3: alternating sharp L/R angles, each length ∈ [0.25, 0.50] * mtnHeight
stop when cumulative Y extent crosses the baseline; max 4 segments total
final segments often much shorter than seg0
```

### 4.B.4 SECONDARY RIDGELINES
https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html — **verbatim**:
> "**These are usually two lines, one of which comes down from the secondary peak and one which comes downward from the adjacent valley and meet down around the baseline. Note that these get reverse shaded: dark if they're on the lit side of the mountain and light if they're on the unlit side.**"
> Frequency (https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html): "**About 90% of the time these lines are drawn in, usually at about the same strength as the topline. The biggest mountains almost always have these lines; other mountains have them occasionally.**"
> *"Not all secondary peaks get these ridgelines."* (part 2)

### 4.B.5 SECONDARY TOPLINES
https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html — **verbatim**:
> "**Where the ridgelines have sharp angles there are sometimes secondary toplines that come out from the point of the angle and run parallel to the mountain topline.**"
> "**Most commonly, the secondary topline comes out from a angle in the ridgeline that points toward the unlit side and runs downward, roughly paralleling the corresponding topline segment. Less frequently they come out of a lit-pointing angle in the ridgeline and run downward to the (in this case) left. They appear on about 20% of the candidate ridgeline angles. The secondary toplines are slightly fainter than the toplines but still significantly darker than the lines used in the shadows hashing.**"

Implementation frequency (https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html) — **verbatim**:
> "**The secondary toplines generally start at the corners that are the furthest from the centerline of the ridge. Most commonly there is one secondary topline on the shadowed side of the mountain. Less frequently there is also a secondary topline on the lit side of the mountain, or a second topline on the shadowed side. All told, secondary toplines appear on about half the mountains, and never on the smallest mountains.**"
> "**Here I've made the green secondary toplines about the same slope as the red topline and long enough to sometimes cross the baseline.**"
> **Clash guard:** "a long secondary top line is being drawn across a secondary ridgeline. ... **So I'll put in a check to keep that from ever happening.**"
> **Ordering requirement for shading** (https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html): "**First, I need the secondary toplines to come all the way to the baseline (even if I don't draw them all the way). Second, I need to make sure the secondary toplines are always in order from the top of the peak downward so I can pick off the areas in the same order each time.**"

**Two discrepant numbers for secondary-topline frequency: "about 20% of the candidate ridgeline angles" (analysis, part 1) vs "about half the mountains" (implementation, part 2). Both are his; they're not contradictory (a mountain has several candidate angles).**

---

# 5. DRAWING THE LINES (the actual rendering layer)

## 5.1 The hand-drawn line code — VERBATIM, complete
Source gist linked from https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html → https://gist.github.com/srt19170/06a032e541cb4208a3e47a64f7b4687c

```javascript
//
//  Draw a line with the given curve, and then resample it
//  to a new set of points. <step> is the distance to step
//  along the line when taking a new point.
//
function drawInterpolate(svg, points, step, curve) {
	curve = curve || d3.curveCatmullRom.alpha(1.0);
	step = step || 1;
	var lineFunc = d3.line()
	    .curve(curve)
    	    .x(function(d) {return d[0]; })
	    .y(function(d) {return d[1];});
	// Draw line
	var path = svg.append('path')
	    .attr('d', lineFunc(points))
	    .style("stroke-linecap", "round")
	    .style("stroke-width", 1)
	    .style("stroke", "black");
	// Go through and find points corresponding to the line
	var results = [];
	var len = path.node().getTotalLength();
	for(var cur = 0;cur<len;cur += step) {
	    var pt = path.node().getPointAtLength(cur);
	    results.push([pt.x, pt.y]);
	};
	// Remove the line now that we've measured it.
	path.remove();
	return results;
};

//
//  "Jiggle" a series of line segments by the given magnitude.
//
function handDrawn(points, magnitude) {
	magnitude = magnitude || 0.003;

	// If we have a very short line, it sometimes resamples down to
	// nothing.  In this case, we can just return the original line.
	if (points.length < 2) return result;

	// Compute the gradients.
	var gradients = points.map(function (a, i, d) {
            if (i == 0) return [d[1][0] - d[0][0], d[1][1] - d[0][1]];
            if (i == points.length - 1)
		return [d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]];
            return [0.5 * (d[i + 1][0] - d[i - 1][0]),
                    0.5 * (d[i + 1][1] - d[i - 1][1])];
	});

	// Normalize the gradient vectors to be unit vectors.
	gradients = gradients.map(function (d) {
            var len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
	    if (len == 0) return [0, 0];
            return [d[0] / len, d[1] / len];
	});

	// Generate some perturbations.
	var perturbations = smoothLine(points.map(d3.randomNormal()), 3);

	// Add in the perturbations. We keep the first and last point
	// unchanged so that we know line segments will be able to match
	// up precisely.
	var result = points.slice(1,-1).map(function (d, i) {
    	    // Need i+1 here because we sliced off [0]
            var p = perturbations[i+1],
            g = gradients[i+1];
            return [d[0] + magnitude * g[1] * p,
                    d[1] - magnitude * g[0] * p];
	});
	// add first element and last element back
	result.unshift(points[0]);
	result.push(points[points.length-1]);
	return result;
}

//
//  This routine creates a smooth polyline of the given width
//  and color.  Points is an array of [x, y] values.
//
function drawLine(svg, points, width, color) {
	if (points.length < 2) return null;
	var lineFunc = d3.line()
	    .curve(d3.curveCatmullRom.alpha(1.0))
    	    .x( function(d) {return d[0]; })
	    .y(function(d) {return d[1];});
	var g = svg.append('g');
	return g.append('path')
	    .attr('d', lineFunc(points))
	    .style("stroke-linecap", "round")
	    .style("stroke-width", width)
	    .style("stroke", color);
};

//
//  This routine draws a polyline of the given width
//  and color, with added "jiggle".  Note that I'm using
//  hard-coded domain and magnitude values that work for me.
//
function drawLineHnd(svg, points, width, color, step, magnitude) {
	magnitude = magnitude || 0.003;
	step = step || 1;
	if (points.length < 2) return null;
	var p = drawInterpolate(svg, points, step);
	p = handDrawn(p, magnitude);
	return drawLine(svg, p, width, color);
};
```

**Hard numbers in this code: default jitter `magnitude = 0.003`, default resample `step = 1`, curve = `d3.curveCatmullRom.alpha(1.0)`, `stroke-linecap: round`, smoothing window `3` in `smoothLine(..., 3)`.**

Key rules stated in the post text (https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html):
> "**the jitter is applied in a direction normal to the gradient of the line. This makes the jitter a natural "side to side" wobble regardless of the orientation of the line.**"
> "**The fix is avoid adding jitter to the start and end points.** Occasionally this creates a little "hook" at the end of a line"
> Order matters (https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html): "**The solution is to do the curve interpolation first, and then the jitter interpolation.** ... the best approach is to **draw the original curve, and then interpolate it by measuring along the curve and sampling points. These points can then be jittered to make a new line.**"

## 5.2 Variable stroke width — exact increments
Source: https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html — **verbatim**:
> "the width of a line cannot change. So to draw a line with changing width, **you have to split the line up into pieces and draw each piece a different width. If you use a fairly small increment of change in width (around a quarter point works well for me) the line appears to be smoothly changing.**"
> "a hand-drawn line that **starts with a 3 point width and narrows to 1.5 points width at the end**"
> "**I chose to let the width of the line increase or decrease by a quarter point at random intervals** ... a hand-drawn line that **varies between 1.5 and 3 points in width**"

**These (0.25pt increment; 1.5pt→3pt range) are the only concrete stroke-width numbers in the entire blog.**

Later he switched to polygon-outline line rendering: *"it draws a line as a polygon which essentially traces around the outside of the line"* (https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html, referring to https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html).

## 5.3 Gradient / fading lines (used for topline fade-off)
Source: https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html — **verbatim**:
> "**SVG does not support gradients along a path. The workaround ... is to chop up the path into a bunch of small segments and then color each of those segments with colors from along the gradient.**" (credits Mike Bostock, https://bl.ocks.org/mbostock/4163057)
> "**To make this a gradient, I have to chop the polygon up into segments and then color each segment**"
> "**There are probably some proper ways to do gradients between two colors based upon human perception, but I'm just interpolating evenly in RGB space.**"
> Seam fixes: `shape-rendering: crispEdges` fixes gaps **but** *"The jaggedy edges on the gradients curve are caused by the crispEdges setting."* → **"An alternative fix is to draw a thin line around each segment as it is drawn."**
> *"I can work around this by interpolating the gradient region at a higher resolution."*

## 5.4 Topline drawing recipe (new style)
Source: https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html — **verbatim**, in order:
1. *"The first approximation is to **draw the topline in the base color**."*
2. Fade the shadow-side end: *"**I only want the fade on the last part of the line, so the first thing I have to do is split the line near the end to isolate the part I will fade**" → reuse the gradient-line code. "**To make this look less mechanical, I can add in some variety on the length of the fade, the width of the fade line and so on.**"*
3. Stutter/skip: *"**To account for the breaks and fade segments, I have to split the line four times.**"*
4. **Fade must be opacity, not white:** *"I've been changing the line color to white where the line fades out, but this only works on a white background. **To make this work right, I really need to use a gradient opacity.** ... **In general, it's best to do fades with opacity if you can.**"*
5. Peak emphasis: *"**I will instead overlay a darker, thicker line on top of the top part of the mountain** ... Here I'm **using a line that starts narrower than the base topline and fades in while becoming wider and darker. I've also added a small amount of random displacement at the peak end of each line, so they don't always precisely overlay the original line.**"*
6. *"I added some code to **let the emphasis line be longer on the lit side of the mountain** ... I needed to refactor the code so that **the lit side could be on the left or the right.** ... **This works by taking the baseline color and reducing the luminance.**"* ← **the only color formula given for the emphasis line: reduce luminance of the base color.**
7. *"**Some mountains have small texture markings coming down from the lit side of the topline. There are usually a couple of them in a small area, pointing somewhere between vertical and perpendicular to the topline.**"*

Ridgeline drawing (https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html): *"**they're usually about the same weight and color as the toplines. They often fade out and trail off at the end of the line. Like toplines, they are often given extra weight near the peak on the taller mountains.**"* Secondary toplines: *"**These are drawn in the same way as the toplines but fade away more quickly.**"*

Curved sides (https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html): *"**But straight sides don't look that good on my maps** ... **I can add slight curves and some more hand-drawn jitter to my mountains** ... I've kept the effect pretty subtle here"*

---

# 6. SHADING / HATCHING (the hachure engine)

## 6.1 Light direction — EXACT
- Reference map: *"**Because the light comes from the left side of the map**, at its simplest the shadow for a mountain fills the right side of the mountain between the ridgeline and the topline."* (https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html)
- **Dragons Abound's own default: "(It's on the left on the reference map, but Dragons Abound usually has it on the right.)"** (https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html)

So **default light = from the LEFT is the reference; DA's own default light is such that the shaded side is on the LEFT (light from the right)**. He explicitly refactored to support both.

## 6.2 Shading region construction (new style) — polygon boolean
Source: https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html — **verbatim**:
> "**I'll construct a polygon using the unlit topline and the ridgeline to create the shading area.**"
> "**I can do this by using a boolean polygon operation to take the difference between the shading polygon and the secondary ridgeline polygon -- essentially cutting that out of the shading polygon.**" (library: **martinez**, https://github.com/w8r/martinez)
> "**Now I need to do the opposite and add shading to the secondary ridgelines on the lit side.** ... it's probably better to go back and refactor the code so that I have them as two separate lists."
> **Multi-facet split:** "**I have to separate the single shading area into two areas along the secondary topline and rotate the hatching angle on the second surface.** ... I can try to **limit the first shading area to the first secondary topline when it is present** ... **The second shading area is the other side of the first secondary topline, and gets a hatching that is parallel to the secondary topline**"
> *"A few mountains on the reference map have a third shading area when there is a second secondary topline on the unlit side, but I'm not going to bother with that."*

**Hatch angle rules (exact):**
- Default: *"**while the hatching usually runs perpendicular to the topline, in some cases it runs parallel to the topline or at some random angle**"* (part 1)
- Facet rotation: *"**In each adjacent region the direction of the hatching for the shaded areas rotates 90 degrees.**"* (part 1)
- *"**Most mountains with only a single shadow facet use a hatching pattern perpendicular to the topline.**"* (part 1)
- Second facet: **parallel to the secondary topline** (part 4)

## 6.3 The scribble/hatch sweep algorithm — VERBATIM formulas
Source: https://heredragonsabound.blogspot.com/2016/11/scribbled-notes.html

Setup, verbatim:
> "The slope `mu` of the finder line will be specified by the user. For intersecting with the polygon, it's handy to have the finder line in two point form: `(x_s, y_s)` and `(x_e, y_e)`"
> "This can be accomplished by **finding the minimum and maximum `y` values for the end points of the line segments in the polygon and then setting `y_s = y_min` and `y_e = y_max`.**"
> "**A little algebra shows that the point `x_i` is given by the equation:**"

```
x_i = x_1 - (y_s-y_1)/mu
```

> "**The range of `x` values for sweeping the finder line can then be found by calculating `x_i` for each vertex in the polygon and keeping the minimum (`x_min`) and maximum (`x_max`) values.**"

Intersection routine, **verbatim JS**:
```javascript
function line_seg_intersect(x1, y1, x2, y2, x3, y3, x4, y4)
{
    var ua, ub, denom = (y4 - y3)*(x2 - x1) - (x4 - x3)*(y2 - y1);
    if (denom != 0) {
       ua = ((x4 - x3)*(y1 - y3) - (y4 - y3)*(x1 - x3))/denom;
       ub = ((x2 - x1)*(y1 - y3) - (y2 - y1)*(x1 - x3))/denom;
       if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) 
         return [x1 + ua*(x2 - x1), y1 + ua*(y2 - y1)];
    };
    return null;
}
```

Sweep logic, verbatim:
> "**These points are where my pencil turns around when shading by hand.** ... The scribble is created by **going back and forth between the points of intersection**"
> "**an infinite line should intersect the polygon in an even number of points**"
> "**I'll probably have to sort the points by their Y value to keep the two pairs correct as the finder line slides along.**"
> Duplicate fix: *"**sometimes this finds the same intersection twice. This happens when the finding line exactly intersects a vertex of the polygon** ... That's fixed by **checking for duplicates before adding to the list of intersections**."*
> Single-point fix: *"**The fix is to just ignore the single intersection cases** -- these points are always in a corner"*
> **Final concavity policy (this is the one that worked):** *"the alternate approach is to **restart all the paths whenever the number of paths changes.** Let me try that: **That fixed it!**"*
> Known unfixed break: *"**the problem occurred where the scribble switches from two paths to two different paths.** Normally the algorithm notices that the scribble is on new paths because the number of paths have changed. But in this case it can't tell, because the number of paths is the same."*

## 6.4 Making scribbles look hand-drawn — exact rules
Source: https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html — **verbatim**:
> **Arc per stroke:** "**To make each segment of the scribble into an arc, I will add a new point at the midpoint of the segment, and offset that midpoint a short distance along the perpendicular to the line**" ... "**every other stroke of the scribble I have to swap the offset from side to side.**" ... "**It's also a good idea to scale the offset based upon the length of the stroke, or short strokes will have a stronger curve than long strokes.**"
> **Spacing jitter (EXACT):** "**I'll do this by varying the step size as I sweep the finder line through the polygon. I randomly offset the step size by up to half the step size smaller or larger.**"
> **Angle jitter:** "**I can address that by varying the angle `mu` of the finder line as it steps through the polygon.**"
> **Inward-only area perturbation (EXACT trick):** 

```javascript
// Generate some perturbations. 

var perturbations = smoothLine(points.map(d3.randomNormal()), 3);
```
> "**The function d3.randomNormal generates numbers with a mean of 0 and a standard deviation of 1. It turns out that if you are perturbing a polyline that is in counter-clockwise orientation, the negative numbers perturb the line inward and the positive numbers perturb the line outward. So to perturb only inward, I can just use the negative numbers. (And ensure my polyline is in counter-clockwise orientation!)**"

> Perf note: "**(The densest of these takes about 3 seconds to render on my desktop machine, by the way.)**"
> Clipping: *"I'm going to apply an **SVG clipping path** to the scribble area."* — but **not** as the primary method: *"**The problem with that approach is that you lose the nice "turnarounds" at the ends of the strokes** ... You end up with something that just looks like hatching"* (https://heredragonsabound.blogspot.com/2016/12/how-to-decorate-mountain.html)

## 6.5 Contour hatching (the DEFAULT shading since 2017)
Source: https://heredragonsabound.blogspot.com/2017/02/the-sunny-side-of-mountain.html — **verbatim**:
> "**The basic approach is pretty straightforward -- rather than drawing back and forth as I do with scribbles, I just draw in one direction. On top of that, I make each line trail off as it is drawn, so that it starts thick and gets thinner. Finally, I have to do some tweaking on the lit side of the mountains, since the shadows there should be lighter there than on the other side of the mountain.**"
> **Darkest-at-ridge vs darkest-away (both supported):** "**Here I have the shadows darkest right at the ridge lines.** That might seem backward; you might think the shadows should be darkest where they are farthest away from the ridge lines: **Orienting the shadows that way makes the mountains look more rounded. I think I prefer the first version, but the program can easily generated it either way.**"
> **THE ONLY OPACITY NUMBER IN THE BLOG:** "**I'm going to start with a simple right to left gradient from 70% transparent to fully transparent**"
> **"And here it is combined with contour hatching ... Overall, I like this a lot, and it's now the default shading for the mountains."**

## 6.6 New-style hatching refinements
Source: https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html — **verbatim**:
> "**Fortunately, I've already implement a hatching fill routine, so it's pretty easy to switch to hatching**"
> Baseline: "**improve the mountain's baseline, which looks unnaturally straight. To start with I can add a slight curve** ... **Now I can perturb the line to make it look a little more natural.** ... **I want just enough perturbation to break up the straight line. This mountain style is pretty graphical, and a heavily perturbed line would look out of place.**"
> Overshoot: "**A subtle effect I can add is to sometimes start the shading line early or late, or end it early or late, so that the hatching doesn't always perfectly align with the outline.**"
> Trail-off: "**A similar subtle effect is to trail off some lines by reducing their opacity**"

## 6.7 2021 hatch-fill rewrite
Source: https://heredragonsabound.blogspot.com/2021/10/creating-pencil-effect-in-svg-part-2.html — **verbatim**:
> "**I stopped and reimplemented the code to "sweep" a polygon in a more straightforward way. There are some efficient algorithms for doing this, but I was content with a simpler implementation based on the description here.** (**The basic idea of drawing lines across a polygon at an arbitrary angle by first rotating the polygon and then drawing vertical lines is very clever!**)" → http://alienryderflex.com/polygon_hatchline_fill/
> **CSS multiply for pencil buildup:** "**SVG doesn't support multiply blend mode except in filters** ... **The good news is that CSS does support a multiply blend mode!** ... Here's what the flat fill example from above looks like when **I turn on CSS multiply blend mode on all the individual pencil strokes**"
> Stroke segmentation: "**it isn't too hard to break up the lines going across the fill area into smaller segments** ... **Because both ends of each segment have rounded ends, and one segment ends on the start point of the next segment, you get a sort of circle where they overlap. That's a little too regular to be pleasing, so let I'll make the start and end points a bit more random**"

## 6.8 `mtnShadeType` — the enumeration
Source: https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html — **verbatim**:
> "an example of this kind of parameter is "**mtnShadeType**". This parameter controls how shaded areas on a mountain icon are going to be drawn, and **it can have a variety of values: scribble, gradient, contour, flat, gradient+contour, or flat+contour.** But whatever value is used, **it needs to be the same value across all the icons on the map.**"

(Flat fill was added late: *"The Torfani map uses a flat color to fill the shaded areas of the mountains, and by default Dragons Abound uses a gradient. Oddly enough, it doesn't look like I ever implemented a flat fill for shading, but that's easy enough to add."* — https://heredragonsabound.blogspot.com/2017/10/recreating-style.html)

---

# 7. SIZE VARIATION WITH ELEVATION & SCALE FORMULAS

## 7.1 Base drawing scale and the transform
Source: https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html — **verbatim**:
> "So far I've been generating mountains at a fairly large scale -- **around 150 pixels square** -- and located at the origin of my coordinate system."
> "To scale a mountain to 1/4 size and place it at (115, 237) I just need to add an attribute"

```
transform(translate(115 237) scale(0.25))
```

> "**to the mountain. Here are some examples of mountains scaled to 1/4 size (which is about what fits into my current maps)**"

**[Note: as written this is malformed SVG — the real attribute is `transform="translate(115 237) scale(0.25)"`. Quoted verbatim as he wrote it. Also note: ~150px design space, ~0.25 map scale → mountain glyph ≈ 37px wide on the map.]**

## 7.2 Line-width compensation when scaling — EXACT
Source: https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html — **verbatim**:
> "**Here I've run into one of the problems with scaling this way: The line width also gets scaled.**"
> "**The solution is to make the lines thicker as the mountains get smaller, although it turns out that a strict scaling looks "wrong" ... At the smaller sizes, the line looks too fat. So you have to scale the scaling :-). I find an additional scaling of 1.5 to 2 looks okay**"

**Implementable:** if the symbol is drawn at design size and scaled by `s`, then set stroke width `w = w_design / s^(1/k)` — his phrasing is "an additional scaling of 1.5 to 2", i.e. he applies a *partial* compensation factor rather than the full `1/s`. Concretely: compensate the line width by `1/s` **damped**, with the extra multiplier in **[1.5, 2.0]** at small sizes.

> Aspect correction: "**Another problem I notice here is that the ratio of height to width is okay at the beginning, but too tall at the end. So I'll adjust the width to get bigger as the mountains get smaller.**"

## 7.3 Detail simplification at map scale
Source: https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html — **verbatim**:
> Problems at 1/4 scale: "**the line widths are very narrow. While this is proportional, it doesn't look "right" -- we perceive narrow lines as gray rather than black** ... Second, **the outlines are not definitive -- they now disappear in the shaded areas.** And finally, **the shaded areas themselves lose all texture -- for the most part they just appear to be mottled gray blobs.**"
> Fixes: "**I can increase the line width used to draw the mountain outline to make it more visible at the reduced scale. Here's a before/after comparison after making the lines about twice as thick**"
> "**To do that, I increase the spacing between the shading lines and make them thicker.**"
> "**I think the details and the "hand-drawn" perturbations end up creating a lot of noise when reduced in scale. After removing some of those features and simplifying** ... **I think this looks better -- cleaner and more interesting.**"

## 7.4 Aspect-ratio parameter — EXACT DEFAULT
Source: https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html — **verbatim**:
> "**"mtnRatioRange" defines the range allowed for the ratio (of height to width) of the individual mountain icons.** I don't want all the icons to be the same ratio, so this provides some variation. **By default, this is "[1.25, 1.50]" which means that all the mountains are 25% to 50% wider than they are tall. During the generation of each icon, a random number is picked in this range and that becomes the ratio for that icon.**"

**[Note his own wording is internally inconsistent: he calls it "ratio (of height to width)" but then reads [1.25,1.50] as "wider than tall" — so operationally it is width/height ∈ [1.25, 1.50].]** Compare with the new-style reference values: **width/height 2.25–5** (analysis) and **3–4x** (implementation) at https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html and .../part-2.html.

## 7.5 Max-size compression
Source: https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html — **verbatim**:
> "**sometimes the range of drawn mountain sizes is too large; the largest mountains are so big they look odd on the map** ... The easier way to address this is to **tune the parameter that controls the maximum mountain size. This compresses the range of mountain sizes that will be drawn.**"

## 7.6 Snow line — height-triggered, not proportional
Source: https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html — **verbatim**:
> "**every mountain has the same amount of "snow" regardless of height.** ... when I changed my mountain symbol approach, there were mountains of many different heights, but **they all got the same amount of snow ... even the tiniest hills have "snow". What I really want is for the snow to start at a certain height consistently across the mountains. Because I draw mountains at one scale and size them to the map in a separate step and other factors, that turned out to be a bit more challenging than I expected.**"
> "**I also switched over to a radial gradient so that the snow line curves around the mountains, but to be honest the effect is pretty subtle.**"

Also https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html: *"Dragons Abound has an option for snowy peaks, but **it works off the height of the mountains to only put it on the highest mountains.** I need to finagle it a bit to use it consistently"*

**Implementable:** snow gradient stop position must be computed in **map space** (absolute elevation), then transformed back into the symbol's local design space before emitting the SVG gradient — that is the "hard" part he alludes to.

---

# 8. HILLS vs MOUNTAINS

## 8.1 Threshold
There is **no separate hill symbol threshold documented as a number**. The heightmap has **two percentile thresholds** — `T` = mountainPercentage, `T2` = hillPercentage, `T2 < T` (https://heredragonsabound.blogspot.com/2016/10/mountains.html). At symbol level, hills are **the small end of a continuous mountain size sequence**, not a separate class — see §8.3.

## 8.2 Hills v1: semicircular arcs (D&D style)
Source: https://heredragonsabound.blogspot.com/2017/01/a-detour-into-hills.html — **verbatim**:
> "**Initially, the hill symbols were just semi-circular arcs.** That's pretty simple, but I developed them for the "D&D" map style ... **The D&D style has an SVG filter on it to make the hills look more amateur-ish by adding some noise; without that they're very regular**"

## 8.3 Hills v2: mountains reconfigured — the EXACT knob list
Source: https://heredragonsabound.blogspot.com/2017/01/a-detour-into-hills.html — **verbatim sequence of config changes**:
1. "**To start with, I reduce the size of the mountains and turn off merged mountains**"
2. "**I don't want any of the decorations (like the clefts) on the mountains, so let me turn off that**"
3. "**The outline needs to be heavier, and I don't want jagged perturbations on hills**"
4. **THE KEY ONE:** "**I really want hills to have convex sides to distinguish them more clearly from mountains. Fortunately I can do that by simply changing the sign on the side offset**"
5. "**I also like hills to be broader rather than peakier, so I'll tweak the proportion of the width to the height**"
6. "**These hills still have a noticeable peak in the center where the sides come together. To address that, I'll turn on the "round tops" option and add a flat piece at the top of the hills. The shading is also a little heavy, so I'll tweak that**"
7. "**the straight shadow line takes away from the roundness of the hill. I'd like to curve that line to suggest the hill is round.** ... **this is the same operation I apply to the sides when I make them concave (for mountains) or convex (for hills). So it's pretty easy to apply that to the shadow line.**"
8. Cast shadow: "**it's just a line from the base of the hill that tapers off to nothing**"

**So: mountains = concave sides + peaked; hills = convex sides (sign flip on side offset) + broader + round/flat top + curved shadow line + heavier outline + no jagged perturbation + no clefts + no merging.**

## 8.4 Hills v3: bell curve (the one he kept)
Source: https://heredragonsabound.blogspot.com/2017/01/still-in-hills.html — **verbatim**:
> "**I preferred hills that were with an elongated, organic shape**" (refs: Starraven's Sketchy Cartography Brushes; Dain's Tanaephis map)
> "**while the above hills flow gently into the land, my hills look more like rigid bumps**"
> "**The shape of my hills is essentially a semi-circle; I want something that is more like a bell shape. A little searching led me to this posting over at Stack Overflow that discusses how to draw a bell-like shape in SVG using Bezier curves. A little adapting of the code yielded various bell shapes**" → **http://stackoverflow.com/questions/39485232/svg-draw-dashed-bell-curve-between-2-points#39487727**
> "**The range of shapes in the middle looks about right to my eye.**"
> "**An immediate improvement I can make is to trail off the line at each end of the hill**"
> "**I can also add the usual features that make it look more hand-drawn** ... **Now I need to add in the shading, along the lines of what I did for the previous version of hills.**"
> "**In fact, these hills look so nice it's making me re-think my approach to the mountains.**" ← this directly caused the 2017/01/29 Bézier-continuum rewrite.

## 8.5 Hills as the low end of the mountain continuum
Source: https://heredragonsabound.blogspot.com/2017/02/adding-details.html — **verbatim**: *"In keeping with **my new philosophy about a seamless sequence from tallest mountain to shortest hills**, when I added in the shading, I modified the existing code so that **as the mountain gets smaller, more curve is added to the ridge line** ... **the low hills look more rounded and soft than the high mountains.**"*

New style (https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html): *"**nearly every mountain has a ridgeline; the only exceptions are the smallest faint mountains (hills).**"* and *"**secondary toplines appear on about half the mountains, and never on the smallest mountains.**"*

## 8.6 Unshaded hills option
https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html — **verbatim**: *"Another unusual feature of Tolkien's mountains is that **most of the hills are unshaded** ... I haven't done this before, but **it isn't too hard to insert an option to turn off shading on hills.** ... The mountains in this style are so heavy that **it is nice to have unshaded hills to lighten the map up a little.**"*

## 8.7 Hill fill color
https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html — **verbatim**: *"**The hills are being drawn in green.** ... The color is a **hard-coded value hold over from the Knurden-style map, where the land color is green.** It shouldn't be hard-coded in any case, so **I'll make the color derive from the land color if it isn't otherwise specified.**"* → **hill fill = land color by default.**

---

# 9. COLORS, STROKE WIDTHS, OPACITY — everything that is actually stated

**There are zero hex codes in the blog.** Complete list of stated color/width/opacity facts:

| Quantity | Value | Source |
|---|---|---|
| Mountain fill | **sampled land color at the mountain's center bottom** | https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html |
| Mountain fill (earlier statement) | "color under the **center** of the mountain" | https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html |
| Hill fill | **land color** (was hard-coded green — a bug) | https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html |
| Snow cap | **linear (later radial) gradient fading to white at top**, triggered by absolute height | https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html, https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html |
| Topline emphasis color | **"taking the baseline color and reducing the luminance"** | https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html |
| Contour lines default | **"a little darker than the base color of the mountain"** | https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html |
| Knurden shadow color | **"about 15-20% darker than the background color"** | https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html |
| Knurden highlight color | light color, **"made more yellow to suggest sunlight ... by adding some green and taking away some blue"** | same |
| Knurden highlight/shadow edges | **"a small blur"** | same |
| Shading gradient | **"right to left gradient from 70% transparent to fully transparent"** | https://heredragonsabound.blogspot.com/2017/02/the-sunny-side-of-mountain.html |
| Line width range | **1.5 pt → 3 pt**, changed in **0.25 pt** increments | https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html |
| Stroke linecap | **`round`** | gist srt19170/06a032e541cb4208a3e47a64f7b4687c |
| Scale-down width compensation | extra factor **1.5 – 2** | https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html |
| Map-scale outline | **"about twice as thick"** | https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html |
| Iskloft contour lines | **black, "about as thick as the mountain outline"**, **"usually just three per mountain"** | https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html |
| Knurden lit-side stroke | **single broad stroke going "1/2 or less the distance down that side"** | https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html |
| Secondary topline weight | **"slightly fainter than the toplines but still significantly darker than the lines used in the shadows hashing"** | https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html |
| Secondary ridgeline weight | **"about the same strength as the topline"** | https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html |
| Trail-off | **reduce opacity** (opacity, never white) | https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html and .../part-4.html |
| Pencil stroke blending | **CSS `mix-blend-mode: multiply`** on individual strokes | https://heredragonsabound.blogspot.com/2021/10/creating-pencil-effect-in-svg-part-2.html |
| Gradient interpolation | **"interpolating evenly in RGB space"** | https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html |
| Alpha composite | **"SVG expects only integer RGB values"** | https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html |

---

# 10. NAMED PARAMETERS (all that are published)

From https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html and https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html:

| Name | Type | Value / meaning |
|---|---|---|
| `mtnToplineSegments` | constant | **7** — segments in the mountain topline |
| `mtnRatioRange` | variation (sometimes choice) | **`[1.25, 1.50]`** — "25% to 50% wider than they are tall" |
| `mtnShadeType` | **choice** (map-global) | `scribble` \| `gradient` \| `contour` \| `flat` \| `gradient+contour` \| `flat+contour` |
| (routines) | — | `findPointAtX`, "lateral breaks", "vertical breaks", "clefts", "topline", "baseline" |

Parameter taxonomy he defines (same URL): **constant / variation (per-icon random draw) / choice (fixed per map)** — *"whatever value is used, it needs to be the same value across all the icons on the map"*.

Crash note (https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html): *"**The topline is the entire outline of the mountain, and there's a function that tries to clean up the topline if for some reason the topline dips below the baseline of the mountain.**"* — you need that guard.

---

# 11. PENCIL SVG FILTERS — verbatim, exact attribute values

Source: https://heredragonsabound.blogspot.com/2020/02/creating-pencil-effect-in-svg.html, filters published at https://codepen.io/srt19170/pen/oNNQmRw and https://codepen.io/srt19170/pen/XWWopOg. (Codepen blocks curl; retrieved via WebFetch.)

```xml
<filter id="roughPaper" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="128" numOctaves="1" result="noise"/>
  <feDiffuseLighting in="noise" lighting-color="white" surfaceScale="1" result="diffLight">
    <feDistantLight azimuth="45" elevation="55"/>
  </feDiffuseLighting>
  <feGaussianBlur in="diffLight" stdDeviation="0.75" result="dlblur"/>
  <feComposite operator="arithmetic" k1="1.2" k2="0" k3="0" k4="0" in="dlblur" in2="SourceGraphic" result="out"/>
</filter>

<filter id="PencilTexture" x="-2%" y="-2%" width="104%" height="104%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="3" result="noise"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="3" in="SourceGraphic" result="newSource"/>
</filter>

<filter id="pencilTexture2" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="2" numOctaves="5" stitchTiles="stitch" result="f1"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -1.5 1.5" result="f2"/>
  <feComposite operator="in" in2="f2" in="SourceGraphic" result="f3"/>
</filter>

<filter id="pencilTexture3" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="5" stitchTiles="stitch" result="f1"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -1.5 1.5" result="f2"/>
  <feComposite operator="in" in2="f2b" in="SourceGraphic" result="f3"/>
  <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="3" result="noise"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="2.5" in="f3" result="f4"/>
</filter>

<filter id="pencilTexture4" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="1" result="f1"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="5" in="SourceGraphic" in2="f1" result="f4"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="10" result="f2"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="5" in="SourceGraphic" in2="f2" result="f5"/>
  <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="100" result="f3"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="3" in="SourceGraphic" in2="f3" result="f6"/>
  <feBlend mode="multiply" in2="f4" in="f5" result="out1"/>
  <feBlend mode="multiply" in="out1" in2="f6" result="out2"/>
</filter>
```
(`in2="f2b"` in `pencilTexture3` appears to be a typo in his source — reproduced as retrieved.)

Caveats he states (https://heredragonsabound.blogspot.com/2020/02/creating-pencil-effect-in-svg.html): *"**the displacement is in absolute units, rather than relative to the line size** ... So I have to pick a value that doesn't create distortion in the thinner lines."* and *"**this is a fairly complex filter that creates three separate perturbations and merges them; this might be very slow on a big complex image like one of Dragons Abound's maps.**"*

---

# 12. OTHER STYLE PRESETS (parameter recipes)

**Iskloft** (https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html) — verbatim: *"outlines are heavy and even thickness, with fairly straight mountain sides. There is usually just a single center ridge line, and shading is provided by heavy lines ... the mountains have white at the top to indicate snow."* Knobs: base color gray; outline thicker; **shading forced on**; shade type = **contour**; contour lines **black, ≈ outline thickness**; **~3 shading lines per mountain**; **taper the shading line so it disappears part way across the shaded area**; snow forced on all mountains; most embellishments off then more perturbation added back; **ridge lines heavy, fairly straight, present on every mountain, slanting back to the shaded side**; **shaded side flipped**. Unimplemented: *"in the Iskloff mountains, the contour lines are generally at a shallower angle. ... I might think about adding it at some point."*

**Skies of Fire** (https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html) — verbatim: *"fairly broad, have rounded peaks and **contour hatching in black** for shading. The unshaded parts of the mountains are the **background color** and **don't have snow** indicated. **Ridge lines (from the peak along the shadow line) are not drawn, just indicated by the shadow line.** The mountain icons themselves are fairly small in relationship to other map elements."*

**Torfani** (https://heredragonsabound.blogspot.com/2017/10/recreating-style.html) — verbatim: *"don't have snow caps or hashing in the shadow areas, use **thinner lines**, and are **more crowded together**"*; *"making the mountains **steeper and more jagged**"*; *"the Torfani map uses a **different shade for the mountains and the mountain shadows**. I have an option to set these colors"*; *"uses a **flat color** to fill the shaded areas"*; *"the Torfani mountains have **additional details on the lit side** of the mountain that add a good amount of texture"*.

**LOTR** (https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) — verbatim: *"very bold -- **sharp peaks, thick outlines and mostly solid black shadows**. They are also arranged in **long narrow lines**."* + hills unshaded. He notes chains are hard: *"It's more difficult to get anything like the straight narrow lines of Tolkien's mountains ... **Dragons Abound actually has a way to generate mountains along fault lines, but it doesn't often produce such well-defined narrow mountains ranges. At best it's an approximate match**"*

**Knurden** (https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html) — verbatim: *"**A flattened vee with some concavity on the sides**"*; *"the Knurden mountains are very smooth and rounded, so I'll **relax the curve** I'm using to draw them. I'll also make the **proportions a little taller**"*; **new line feature added here:** *"**The lines also tend to trail in and trail out (start small or end small)** ... so this is a good opportunity to **add that to my line drawing routine**. With that in place, I can have **each line randomly trail in and out**"*; *"I make the **bottom of the mountain roughly convex** and add some variation ... **it helps sell the mountain as a 3D shape**"*; shadow construction: *"**get the shadow side of the mountain, duplicate it, and offset it into the inside of the mountain**"* then *"**the shadow line doesn't start up at the peak, so I need to shorten the top part of the line**"*; *"For the bigger mountains, I need to **add some additional lines of shadow**"*; *"**I'll add some special cases for small mountains**"*.

**Baseline-move bug worth knowing** (same URL): *"**I left the baseline (the invisible line that goes across the bottom of the mount) behind when I moved the mountains.** ... **I have some points in the baseline twice and one half of the baseline is backwards. All that confuses the fill algorithm!**"

---

# 13. WHAT IS NOT IN THE BLOG (do not expect to find it)

- **No ridge detection, no local-maxima detection, no slope threshold** for symbol placement. Placement is percentile-on-height + greedy overlap rejection. He explicitly declined the alternative: *"it's a lot simpler than trying to figure out the "spine" of a mountain range and how to place symbols along there :-)"* (https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html). He did eventually build a spine — but as a **polygon centerline via Voronoi longest path**, not from the heightmap (https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-7.html).
- **No Poisson disc for the primary mountain placement** — only for the *fill-in* mountains around chains.
- **No hex colors, no px stroke widths for mountains, no opacity values** except the single "70% transparent" shading gradient.
- **No minimum-distance number**; only "exclusion distance" as a tunable circular radius, and the **5–35% overlap** range.
- **No mountain-vs-hill numeric height threshold** at symbol level — it's a continuum.
- **No complete mountain source code is published anywhere.** The only verbatim code in the entire mountain corpus is: the noise pseudo-code, `distanceFromPointToSegment`, `line_seg_intersect`, the `x_i = x_1 - (y_s-y_1)/mu` formula, the `transform(translate(115 237) scale(0.25))` snippet, the `smoothLine(points.map(d3.randomNormal()), 3)` line, the pencil filters, and the four functions in gist `srt19170/06a032e541cb4208a3e47a64f7b4687c`. All are reproduced above in full.

---

# 14. ONE-PAGE IMPLEMENTATION ORDER

1. Heightmap: `1 - Math.abs(Noise.octave(x*4,y*4,6,0.5))`; optional fault-line ranges via `distanceFromPointToSegment` + noise-perturbed tent mask (identical perturbation applied to fault and mask).
2. Mask/threshold: `T = findThreshold(noise, mountainPct)`, `T2 = findThreshold(noise, hillPct)`, fade `Math.min(1,(noise-T2)/(T-T2))`.
3. Mountain cells = top `mountainPct` of land heights.
4. Group cells into polygons; discard polygons too small for a chain.
5. Per polygon: compute **centerline** (Voronoi longest path, scored by length × inverse sinuosity), **smooth** it, run a mountain chain along it (slide-to-touch fitting; alternate wide/narrow slopes; peak size in the middle).
6. Fill the rest of the polygon with **Bridson Poisson disc** points (polygon-clipped, holes supported); place a mountain at each; reject if overlap > `maxOverlap ∈ [0.05,0.35]`.
7. Build each symbol at **~150px design size**: topline (7 segments, carat + optional sub-peak jogs, 5% flat-top, W/H 2.25–5) → ridgeline (seg0 ≈ 0.5·H vertical into middle band; then ≤3 alternating segs of 0.25–0.5·H; cross the baseline) → secondary ridgelines (≈90%) → secondary toplines (≈50% of mountains, ≈20% of candidate angles, never on smallest; must reach baseline internally; ordered top-down; must not cross a secondary ridgeline).
8. Shading polygon = unlit topline + ridgeline; `martinez` difference out unlit secondary-ridgeline polys; union in lit ones; split at first secondary topline; hatch facet 1 perpendicular to topline, facet 2 parallel to secondary topline (90° rotation between adjacent facets).
9. Hatch via the sweep: `y_s=y_min`, `y_e=y_max`, `x_i = x_1 - (y_s-y_1)/mu` over all vertices → `[x_min,x_max]`; `line_seg_intersect` per polygon edge; dedupe; drop singletons; sort by Y; **restart all paths whenever the intersection-pair count changes**; step jitter ±50%; `mu` jitter; midpoint arc offset alternating sides scaled by stroke length; occasional early/late start/end; occasional opacity trail-off.
10. Draw per symbol in order: **fill mask (land color at center-bottom, with apron below baseline) → shading → highlight → outline**. Toplines/ridgelines via `drawLineHnd` (Catmull-Rom α=1.0, resample step 1, jitter magnitude 0.003, round caps, width varying 1.5–3 pt in 0.25 pt steps); fade line ends with **opacity gradients** (chop into segments, RGB-lerp, thin outline per segment to kill seams); overlay a darker/thicker emphasis line on the top of the peak with random displacement, longer on the lit side, color = base with reduced luminance. Suppress all fades for mountains inside a chain.
11. Scale to map with `translate(...) scale(s)`; compensate stroke width by a damped `1/s` with extra factor **1.5–2**; widen aspect as size shrinks; simplify/remove fine details at map scale; increase hatch spacing and hatch line width at map scale.
12. Reject any symbol whose **topline end points** (not bounding box) are not both on land and in the **same land mass**.
13. **Final pass: re-sort ALL mountains by lowest point (not center), ascending Y, and re-append to the DOM top→bottom.**

agentId: a642070489c9e9f24 (use SendMessage with to: 'a642070489c9e9f24', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 207885
tool_uses: 50
duration_ms: 744080</usage>

---

<!-- fuente: forests-trees-symbols.md -->

I have comprehensive coverage. Here is the report.

---

# FOREST & TREE RENDERING — Dragons Abound (Scott Turner) — Implementable Recipe

**Important caveat up front:** Turner publishes almost no code and virtually no numeric parameters in these posts. Across ~18 fetched posts I found exactly **three verbatim JS snippets** relevant to this topic (`divideLineSegment`, `isLeft`, `getProp`). Everything else is prose. Where he *names an upstream source he copied*, I fetched that source and quote it verbatim — that is the real code he runs. Where only images exist, I sampled the pixels. Each is labeled.

---

## 0. The four distinct forest systems (don't conflate them)

| System | Post | What it is |
|---|---|---|
| **Forest mass** | [2017/03/one-of-forest-masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html) | Green blob, bumpy "cloud" edge, mottled interior |
| **Individual trees ("fluffy")** | [Back In the Woods 1–7, 2018/04–05](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-1-introduction.html) | Clump-of-circles deciduous + triangle/scallop conifer |
| **Tolkien / egg** | [2018/10/lord-of-rings-map-style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) | Egg-shaped, single clump, no scalloped edge, Poisson-packed |
| **Knurden (blob + tree ring)** | [Knurden Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html), [Forests P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html) | Solid blob, full trees on front edge, half-trees on back edge |

---

## 1. INDIVIDUAL TREE SYMBOL CONSTRUCTION

### 1a. The base primitive: the "bump" / fluffy-cloud edge routine

This one routine builds **everything**: forest-mass outlines, deciduous tree clumps, interior texture bumps. Source is explicitly credited:

> "I'll start off by implementing a function to take a line segment and turn it into a curve... It's better to use a real Bézier curve to get the right rounded shape... The shape of the curve is determined by a control point for each end point... If I vary the control points separately, the curve can be asymmetric."
> — [2017/03/on-erkamans-cloud-9](https://heredragonsabound.blogspot.com/2017/03/on-erkamans-cloud-9.html)

> "In fact I can reuse the same routine I use for the forest masses. **It takes a polyline (a series of line segments) and replaces each segment with an arc.**"
> — [Back In the Woods Part 2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html)

He links [github.com/Erkaman/cloud_gen](https://github.com/Erkaman/cloud_gen). Its README, verbatim:

```
## How Does this Work?
We start with the geometry for an ellipse:
Then we replace every edge on the original ellipse with a cubic Bezier curve:
To introduce some randomness, we randomly move the control points of
the cubic bezier curves some:
and that's it!
```

**The exact control-point math (verbatim from `cloud_gen/main.cpp`) — this IS the bump algorithm:**

```cpp
// generate points on an ellipse.
for(int i = 0; i < N; i++) {
    float theta = (i / (float)N) * 2.0 * PI;
    pos[i].x = PX + RX * cos(theta + ANGULAR_SHIFT);
    pos[i].y = PY + RY * sin(theta + ANGULAR_SHIFT);
}
...
    // every edge in the ellipse is used to create a cubic bezier curve.
    // we create a hump-shaped cubic bezier curve.

    // edge direction.
    vec2 dir = vec2::normalize(v - prev);
    // edge normal.
    vec2 n = vec2::normalize(vec2(dir.y, -dir.x));

    // hump radius.
    float RAD = randFloat(MIN_HUMP_RAD, MAX_HUMP_RAD);

    // control points. a cubic bezier curve has two control points.
    // if we place the control points along the edge normal, we
    // get a hump shape.
    vec2 cp0 = prev + RAD * n;
    vec2 cp1 = v +    RAD *n;

    float UA = -HUMP_RAND;
    float UB = +HUMP_RAND;

    // but for some variation, we also randomly displace the control points
    // some.
    cp0.x += randFloat(UA, UB);
    cp0.y += randFloat(UA, UB);
    cp1.x += randFloat(UA, UB);
    cp1.x += randFloat(UA, UB);
```

⚠️ **Bug in upstream, inherit deliberately or fix:** the last two lines both perturb `cp1.x`; `cp1.y` is never jittered. Output path emission:

```cpp
str += "<path d=\"M" + to_string(v.x) + ", " + to_string(v.y);
...
str += "C " + to_string(cp0.x) + " " + to_string(cp0.y) + ", "
     +        to_string(cp1.x) + " " + to_string(cp1.y) + ", "
     +        to_string(v.x)   + " " + to_string(v.y);
...
str += "Z\n"; // close loop. path is now done.
```

**Upstream's actual tuned numbers** (`main.cpp`, TYPE 0). These are cloud-scale on a 1000×1000 canvas; ratios are the transferable part — hump radius ≈ **0.35–0.6 × ellipse RX**, N humps = 6–8:

```cpp
genCloud(int(randFloat(6,9)),          // humps.
         randFloat(75.0f,130.0f),      // ellipse width
         randFloat(50.0f,65.0f),       // ellipse height
         randFloat(29.0f,39.0f), randFloat(40.0f,48.0f), // hump radius
         randFloat(17.0f, 27.0f)       // hump rand.
    );
genCloud(int(randFloat(6,9)),          // humps.
         randFloat(40.0f,80.0f),       // ellipse width
         randFloat(20.0f,35.0f),       // ellipse height,
         randFloat(14.0f,16.0f), randFloat(22.0f,24.0f), // hump radius
         randFloat(4.0f, 9.0f)         // hump rand.
    );
```

**Turner's two divergences from upstream:**

1. He **re-flattens the Bézier back to line segments**: *"This turns a line segment into a curve, but for my purposes I need to turn it back into line segments. (One reason is that I'm going to want to connect a series of these into a single polygon, and I can't easily do that with Bézier curves.) I already have a function to chop an arbitrary SVG path into line segments"* ([cloud-9](https://heredragonsabound.blogspot.com/2017/03/on-erkamans-cloud-9.html)). Chopping method is browser-based: *"I can use the browser's built-in capabilities to draw the curve, and then measure along it to chop it up into segments"* ([2017/01/the-outline-of-solution](https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html)) — i.e. `path.getTotalLength()` / `getPointAtLength()`. Segment counts he cites for mountains: **20 pieces ≈ indistinguishable from the curve, 8 pieces = visibly faceted.**
2. **Duplicate-point rule:** *"The only tricky part here is that we have to throw out the last point in each curve so that it doesn't duplicate the first point in the next curve. **Bad things happen when you have duplicated points and try to draw an SVG curve through those points!**"*

Known artifact, accepted: *"You can see where the curve starts and ends because the line widths don't match up; this is not noticeable at map scale."*

### 1b. Deciduous tree — build order (Back In the Woods Parts 2–4)

From [Part 2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html), exact pipeline:

1. Circle from line segments. *"I'm using a function that makes a circle out of line segments. But as you can see, this routine doesn't close off the circle."* → close it.
2. *"I don't want every tree to be a perfectly circular blob, so I'll introduce some random distortion into the circle, by **adding random offsets in both x and y to every point in the circle**."*
3. Apply the bump routine to the resulting polyline. *"For this example I just reused the default forest mass bump parameters. I might want my individual trees to be more 'fluffy' than the forest masses, so I can tweak that parameter accordingly."* → **trees use a larger hump radius than forest masses.**
4. *"If I add some random variation in the number of bumps and the size of the trees I can generate a pleasing variety."*

**Multi-clump structure** — [Part 3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html):

- *"To start with, I'll just generate a tree as overlapping smaller tree shapes."*
- First attempt failed: *"the circles need to be smaller and more offset from each other."*
- *"Right now I'm just randomly offsetting them from the center point, but often that doesn't move them far. I can try adding a **minimum offset**."*
- Final rule: *"In reality, trees aren't random shapes. They're **never bigger on the top than the bottom, or diagonal**... **I'm basically stacking the clumps up in a rough pyramid.** The logic for this isn't very good, and probably wouldn't work for more than 3 clumps. But I suspect that **3 clumps** will be more than enough for this icons."*
- Render as **union outline**, not separate circles: *"Drawing the clumps individually like this doesn't look much like a tree. It looks more like a tree if I just draw the outline... I've drawn in the clump outlines **faintly** so you can still see the structure of the trees, and to give a faint indication of shading."*
- **Cost warning:** *"One drawback of this approach is that it's pretty slow. **Taking the union of two polygons (which I have to do twice on each 3 clump tree to get the outline) is expensive.**"*

**Trunk** — [Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html), the only hard numbers he gives for tree geometry:

> "most of the trunks are pretty simple: a dark line coming downward out of the tree shape, **usually about 20-25% the height of the tree shape**, and **somewhat bigger at the bottom than at where it joins the tree**."

> "I can construct a trunk as a polygon that gets **broader at the base to represent the roots**... Now I draw the trunk **from the center of the tree and somewhat longer than the radius of the tree**. **By drawing the trunk first, the clumps will conceal the upper part of the trunk.**"

Trees must become structs at this point: *"Up until this point, I've just been treating trees as an array of polygons but now I need to distinguish the tree shapes from the trunk shapes."*

Known defects he shipped: *"the 'roots' at the base of the trunk aren't always obvious, and some of the trees aren't showing any trunk at all."*

### 1c. Conifer — [Back in the Woods Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)

Conceptual model, verbatim:

> "Each branch is essentially **three points connected by two arcs**: The two points at the wide interior part of the branch connected by curves to the point of the branch. The interior points lie along a small narrow triangle and the points are farther out."

Build order:

1. **Triangle**, *"using a little bit of variance in the width of the triangle."*
2. Subdivide each side into segments = branch bases. Segments must **increase in size top→bottom**: *"The branches ought to get narrower (and consequently shorter) near the top of the tree. So I can't just break the sides up into random pieces, I need to use smaller pieces near the top. Let me take a step back and see if I can break the sides up into **increasingly larger pieces from top to bottom**."*
3. Add per-segment jitter: *"these vary somewhat in size. I'll add some variation left and right as well. That might be too much, but I can adjust the amount later."*
4. **Branch projection:** *"It looks to me like the branches are something like **2-3 times as long as they are wide**, so I'll project a point out from the two base points about that distance and insert it between the two base points."* — immediately corrected: *"My estimate of branch length looks wrong... Let me **reduce the branch length**."*
5. **Scale correction vs deciduous:** *"the conifers are at a smaller scale than the deciduous trees... let me adjust the conifer tree size to make them **at least as tall as the same deciduous tree**... Let me make the conifers **broader** as well."*
6. **Curve the branches**, *"and adjust the proportions."*
7. **Scalloped bottom** (replaces both flat base and semicircular skirt): *"instead of having a semi-circular skirt, I've got the last branch coming back up to join a straight bottom... I don't really want a semi-circular bottom to the tree, I want a **scalloped edge like a row of branches**. That's going to be ... challenging. Especially to get a **whole number of branches across the bottom**, and to make the **switch from pointing left to pointing right across the bottom**."*
8. **Reuse scallop routine for interior texture:** *"The scallop routine just connects two points with the appropriate scallops, so I can also use it to draw scallops **between the other pairs of branches** on the tree. This will add some texture to the tree, the way I added bumps to the deciduous trees."* Accepted artifact: *"The upper branches get closer and closer together, and eventually there isn't even room for a whole scallop, and I get a **little chevron** on the upper most branches that looks a little odd."*
9. **Lean:** *"I added some random offsets to the tree, so it sometimes 'leans' left or right."*

**Apex line-join fix — implementable, non-obvious:**

> "let me fix the problem with the top of the tree, where the two lines don't touch. This happens because the outline of the tree starts and stops there. It actually starts and stops at the same point, but the width of the line gets drawn to the left on the left side of the tree and to the right on the right side, so the lines only touch at the inside corner... **it is easier to fix by moving the start and end of the outline to a different point on the tree where the lines aren't parallel**."

Trunk + shadow: *"throw in the tree trunk and shadow... (These are just copied from the other tree type.)"*

### 1d. Egg-shaped tree (Tolkien + Knurden)

> "Drawing an egg shape doesn't seem to be the most straightforward thing in the world, but according to [this page](http://www.mathematische-basteleien.de/eggcurves.htm), it's a matter of **smoothly lengthening one of the axes as you go around the circle**... since I want the upper part of the circle to be the longer end, I have to **lengthen the y axis when y is less than zero**. (Remember that in SVG, the Y axis is reversed, and negative numbers go upward.)"
> — [LotR Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html)

Verbatim formulas from the cited page (ellipse `x²/9 + y²/4 = 1` → `x²/9 + y²/4*t(x) = 1`):

```
t₁(x) = 1 + 0.2x
t₂(x) = 1/(1 - 0.2x)
t₃(x) = exp(0.2x)
```
Hügelschäffer cubic: `x²/a² + y²/b²[1 + (2dx+d²)/a²] = 1`

For Tolkien style he also strips the clumping: *"Dragons Abound makes clumpy tree shapes by overlapping several circles with scalloped edges. **I can turn off the edges, and only use one circle**."* Result: *"a surprisingly big improvement, and probably sufficient."*

Knurden trees ([Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html)): *"These are really quite simple -- **rough oval shapes with a highlight and a shadow. There's no trunk but there is a cast shadow.** I have a fairly flexible tree drawing routine, but it **seems like overkill** for a simple oval shape, so I'll do this as a **separate implementation**. I already have a routine to make an egg shape, so I'll start with that... **The red dot at the bottom of the tree is the anchor reference point.**"*

### 1e. Haunted / skeletal tree — [2021/10/haunted-forests](https://heredragonsabound.blogspot.com/2021/10/haunted-forests.html)

> "there are a lot of ways to procedural generate tree skeletons. A common one is 'Lindenmayer systems'... The trees I'm going to generate are so small and simple that **an L system seems like overkill**. So I'll just roll my own."

- Trunk = **smoothly tapered line**.
- *"For tree trunks, I want the jitter to **go back and forth** (I don't want trees shaped like a big C for example) and I want the perturbations to be **pretty sharp, not smoothed out** as when I create a 'hand-drawn' line. So I had to create a **new perturbation function that alternated the direction** to perturb the line."*
- Fade into fog: *"apply a mask that fades out the tree towards the bottom... by applying a **mask filled with a linear gradient from white to black**. Note that I've **adjusted the mask so that the tree doesn't completely fade away**."*
- Branches: *"I'll **alternate sides** on the tree and make the branches **shorter as they get near the top**... To make branches, I'll **pick a point on the tree, draw a line straight up, and then rotate it either left or right**."*
- Tuning: *"I made some adjustments to try to **keep white space between the branches** and to generally **thin down the lines**."*

---

## 2. PLACEMENT ALGORITHM

### 2a. Superseded method (v1): one tree per Voronoi cell

> "To fill an area, Dragons Abound works from the underlying world locations, which are various sized triangles based upon a Voronoi mesh. This mesh is not regular, so some areas have many triangles while other areas have few. **The tightest packing Dragons Abound can do is to put a tree symbol in every triangle** and this will leave some gaps and some crowded areas... **Particularly along the edges it is important to have a tight packing** or the forest loses the sense that it's a solid mass of trees."
> — [LotR Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html)

### 2b. Current method: **Poisson-disc sampling, Bridson's algorithm**

> "**Poisson-disc sampling**, and discusses an efficient algorithm for creating a Poisson-disc sample called **Bridson's algorithm**... To start with, I'll grab an implementation of Bridson's algorithm from [here](https://github.com/beaugunderson/poisson-disc-sampler) and use it to sample a rectangle."

**This is his actual sampler, verbatim** ([beaugunderson/poisson-disc-sampler/poisson-disc-sampler.js](https://github.com/beaugunderson/poisson-disc-sampler)) — note **k = 30**, candidate annulus `[radius, 2*radius]`, `cellSize = radius * √½`:

```javascript
'use strict';

module.exports = function poissonDiscSampler(width, height, radius, rng) {
  var k = 30; // maximum number of samples before rejection
  var radius2 = radius * radius;
  var R = 3 * radius2;
  var cellSize = radius * Math.SQRT1_2;

  var gridWidth = Math.ceil(width / cellSize);
  var gridHeight = Math.ceil(height / cellSize);

  var grid = new Array(gridWidth * gridHeight);

  var queue = [];
  var queueSize = 0;

  var sampleSize = 0;

  rng = rng || Math.random;

  function far(x, y) {
    var i = x / cellSize | 0;
    var j = y / cellSize | 0;

    var i0 = Math.max(i - 2, 0);
    var j0 = Math.max(j - 2, 0);
    var i1 = Math.min(i + 3, gridWidth);
    var j1 = Math.min(j + 3, gridHeight);

    for (j = j0; j < j1; ++j) {
      var o = j * gridWidth;

      for (i = i0; i < i1; ++i) {
        var s;

        if ((s = grid[o + i])) {
          var dx = s[0] - x,
              dy = s[1] - y;

          if (dx * dx + dy * dy < radius2) {
            return false;
          }
        }
      }
    }

    return true;
  }

  function sample(x, y) {
    var s = [x, y];

    queue.push(s);

    grid[gridWidth * (y / cellSize | 0) + (x / cellSize | 0)] = s;

    sampleSize++;
    queueSize++;

    return s;
  }

  return function () {
    if (!sampleSize) {
      return sample(rng() * width, rng() * height);
    }

    // Pick a random existing sample and remove it from the queue.
    while (queueSize) {
      var i = rng() * queueSize | 0;
      var s = queue[i];

      // Make a new candidate between [radius, 2 * radius] from the existing
      // sample.
      for (var j = 0; j < k; ++j) {
        var a = 2 * Math.PI * rng();
        var r = Math.sqrt(rng() * R + radius2);
        var x = s[0] + r * Math.cos(a);
        var y = s[1] + r * Math.sin(a);

        // Reject candidates that are outside the allowed extent,
        // or closer than 2 * radius to any existing sample.
        if (x >= 0 && x < width && y >= 0 && y < height && far(x, y)) {
          return sample(x, y);
        }
      }

      queue[i] = queue[--queueSize];
      queue.length = queueSize;
    }
  };
};
```

**His polygon adaptation — three stages, verbatim:**

> "One challenge is that Bridson's algorithm provides a sampling for a rectangle, and I want a sampling for an arbitrary polygon. One way to adapt the algorithm to a polygon is to **run the algorithm on the bounding box for the polygon and ignore samples that fall outside the polygon**. This will be somewhat inefficient (in the ratio of the area of the polygon to the area of the bounding box) but should work."

> "To make this more efficient, I can **embed a test within the algorithm so that it doesn't explore any point outside the polygon**. As long as I then **start the sampling within the polygon (which I can do by picking one of the vertices as the starting sample)** and the polygon is reasonably shaped, then the algorithm will only explore points within the polygon or one sample outside the polygon, and will only return the points within the polygon."

> "I need my Poisson disc sampling function to **take a list of holes** in the polygon and treat those areas the same as the outside of the polygon. This is essentially just a **one-line change**."

Hole detection: *"To identify the holes of a polygon, I have to run through all the other polygons and check each one to see if it is inside the original polygon. (In this case, **if any point on a candidate polygon is inside the original polygon, then the whole candidate polygon is inside as well, so I can just check one point.**)"*

**Radius tuning is empirical only.** He never publishes a number:
- *"A little tweaking is required to find a spacing that provides a similar visual feeling to the Tolkien map"* (LotR)
- *"It takes a few tries to get a good sampling distance"* (Haunted Forests)
- *"I just have to tweak the distance between the bumps some to get a decent range of textures"* ([2022/06/cleanup-time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html))
- D&D style ([2020/11/d-style](https://heredragonsabound.blogspot.com/2020/11/d-style.html)) shows the tuning loop verbatim: *"The trees are a little too uniform, so I'll try adding some more variety to them and also **make them closer together**." → "Okay, **that's a little too close together**." → "That's better"*

Relative spacing rule, from [Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html): *"**For individual trees with trunks, the icons are usually spaced out more widely.**"*

### 2c. Perturbed grid — explicitly abandoned

> "the bump texture inside the forest masses is getting placed using **a sort of perturbed grid**... **The bumps tend to line up in rough columns**, and there are bumps close to the edge of the mass where they get clipped... Since then I've realized that **a Poisson disc sampling is a better approach** for filling an area in this way."
> — [Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html)

**Edge inset via polygon shrink** (same post):

> "Pulling the bumps in from the edges of the woods is more problematic. To do this requires 'shrinking' the polygon... **In no wise should you consider writing this code yourself.** In this case, I'm going to try using the [polygon-offset library from Alexander Milevski](https://github.com/w8r/polygon-offset); it is partially based upon the [Martinez library](https://github.com/w8r/martinez)."

> "Many of the failure modes have to do with **sharp vertices close together -- like the bumps on the forest masses**. So rather than shrink those outlines and let every bump invite trouble, **I'll shrink the 'unbumped' original forest outlines**. This helps reduce the number of errors, but it doesn't entirely eliminate problems. So this is an area of the code where it is helpful to **catch exceptions and route around the damage**."

### 2d. Interior texture-bump placement (rejection sampling, pre-Poisson)

> "evenly but randomly distributing shapes within a polygon is quite difficult, and computationally expensive. **Simulated annealing is a feasible approach, but I'm not going to implement simulated annealing just to draw tree bumps!** Instead, I'll try for a 'good enough' approach. I'll **randomly select the start and end points for a bump within the tree polygon until I find points whose bounding box corners lie within the polygon.** Then I'll check to see if **the corners of the bounding box are within some minimum distance of another bump.** If they are, I'll throw out the new bump and try again."
> — [Back In the Woods Part 5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html)

Count: **"filling with 5-10 bumps inside a tree shape."** Failure mode he accepts: *"In the big tree shape, you can see that the algorithm only managed to place 4 bumps, two of them are close together, and one of them goes outside the boundaries of the tree."*

### 2e. Edge-of-polygon placement (Knurden): interpolate the polygon, not the bounding box

> "To place the trees regularly around the edge of the polygon, I'm **taking the original polygon and interpolating it to create a new polygon which has a point at every place where I'm going to place a tree**."

Two failure modes he names: *"I've **cut off the original corner**. Less obvious but also problematic is that **the last segment is much shorter than the other segments**."* Requirements: *"(1) maintains all the original polygon points, and (2) equalizes the intervals between the new points. It isn't possible to do both perfectly, but a reasonable compromise is to **interpolate each line segment individually, selecting the number of pieces for the segment to get as close to the desired interval as possible**."*

> "divide the length of the segment by the desired interval, and then **round that number to the nearest integer**... (**In the worst case, the actual interval will be +/- 50% of the desired interval**, but it will usually much closer.)"

**Verbatim JS** — [Knurden Forests P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html):

```javascript
// Divides a line segment into step-sized chunks
function divideLineSegment(p1, p2, step) {
    // How many steps in this line?
    const n = Math.round(Utils.distance(p1, p2)/step);
    const dx = (p2[0]-p1[0])/n;
    const dy = (p2[1]-p1[1])/n;
    const npl = [p1];
    // We do this n-1 times so that we can use p2 as
    // the last point just to be sure it doesn't move
    // because of a rounding error.
    for(let i=1;i<n;i++) {
	npl.push([p1[0]+dx*i, p1[1]+dy*i]);
    };
    npl.push(p2);
    return npl;
};
```

> "Note the trick here that uses the last point rather than calculate it from the slope. This makes sure the point doesn't move due to a rounding error. That's important when we're trying to get things to match up precisely on the screen."

Residual gaps are a *feature*: *"Some gaps still arise where line segments are an awkward length, but **happily the effect is actually better with occasional small gaps**."*

### 2f. Exclusion constraints (rivers / coast / mountains / cities)

- **Rivers:** *"Right now this is using the river avoidance distance used by the forest mass style forests; they can come up much closer to the rivers without overlapping. **This method will require a greater avoidance distance.**"* ([Part 3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html)) → *"For this style of forest, I can't get so close to other map features -- **I have to stay away the radius of the tree icons (or even more)**."* ([Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html))
- **Coast:** *"To pull the edge of the forest back from the coastline, I **treat forest locations near the coast as a different biome**, which effectively draws the edge of the forest in some distance from the coastline."* ([Forest Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html))
- **Mountains:** naive elevation cutoff *"tends to produce little holes and clumps of forests... A more robust approach is to **check against the mountain symbols themselves and drop any forest locations that intersect with one of the mountain symbols**"* using bounding boxes *"with a good deal of margin added."*
- **Cities:** *"carve a circle of forest away around every city, with **larger cities using more forest than smaller ones**... it can look pretty artificial with a smooth and regular circle... I'll **perturb the removed area with noise** to make it less regular."* ([Sprucing Up the Forest](https://heredragonsabound.blogspot.com/2017/03/sprucing-up-forest.html))
- **Land test fix:** *"the Voronoi tiles that make up the map are considered land if **any part** of the tile is above sea level... The solution is to use a **stricter definition of land which requires the midpoint of the tile to be on land**."* ([Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html))
- **Size cutoff:** *"I took this opportunity to add a **forest size cutoff**, so that I can create maps with only the larger forests."* (LotR)

---

## 3. SIZE VARIATION — and what he does *not* do

**He does NOT vary tree size by elevation, moisture, or distance from forest edge.** I searched the entire archive; there is no such mechanism for trees. Size variation is **purely random per-tree**:

- *"If I add some random variation in the number of bumps and the size of the trees I can generate a pleasing variety."* ([Part 2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html))
- *"it might look more hand-drawn with more variation in the tree circles. **The code is currently set up to use a consistent tree size, but that's easy to change.**"* ([D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html)) — i.e. constant size is the *default*.

The only size relationships stated:
- **Conifer vs deciduous:** conifers scaled up to be *"at least as tall as the same deciduous tree"* and made *"broader as well"* ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)).
- **Interior treetops vs edge half-trees:** *"These are basically the same as the half-trees used to line the back edge of the forest, but **to my eye a little bit shorter**."* ([Knurden P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html))
- **Trunk:** 20–25% of tree height; drawn *"somewhat longer than the radius of the tree"*.

Density-by-elevation exists only for **mountains**, not trees: *"this is where I implemented your suggestion to **vary the density of mountains based on height**."* ([Sprucing Up the Forest](https://heredragonsabound.blogspot.com/2017/03/sprucing-up-forest.html))

**Density derivation is binary, not continuous.** Forest is a Whittaker-diagram biome lookup, then rasterized to a polygon; Poisson radius is a per-style constant inside that polygon:

> "biomes are formations of plants and animals that have common characteristics due to similar climates... What biome will occur in an area depends primarily on the temperature and precipitation... This can be mapped out in a '**Whittaker diagram**.' So if I want to figure out what biome is at a map location, I need to know the average annual temperature and the annual precipitation, and then I can look it up on this chart."
> — [2017/03/saving-for-rainy-day](https://heredragonsabound.blogspot.com/2017/03/saving-for-rainy-day.html)

Precipitation model: *"The atmosphere gains water vapor by evaporation over the open seas. Wind blows the atmosphere around. If there's enough water vapor in the atmosphere, it precipitates out when the atmosphere hits an updraft. In Dragons Abound, the only source of updrafts is rising land."* Two edge corrections: *"(1) Edges of the map are given a steady wind value (a 'trade wind'), and (2) Atmosphere coming in from the edge of the map is given a moderate amount of water vapor."* Plus *"at all times there is a **base chance of precipitation proportional to the amount of water vapor**."*

⚠️ **Critical:** *"there's a lot of **smoothing** going on here. Without smoothing, the biomes are very spotty, with bits of grassland inside the forests and so on. This may be realistic (or not), but it doesn't make for a very good fantasy map, which needs great forests, endless steppes and so on."*

**Deciduous/conifer split:** *"since it depends primarily on **altitude (height) and temperature**, that will be easy to add"* → *"trees in the mountains or in cold areas of the map will be conifers"* → *"it's a little artificial to have such a clean separation of the tree types like that. There should be a **transition zone with some mix of trees**."* ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html))

---

## 4. OVERLAP, SORTING, OCCLUSION

### 4a. Global painter's sort by lowest point — the key rule

> "generally speaking **when an element (like the conifer) is further down on the map, it should be on top of elements that are higher up on the map**. But since generation of mountains is separate than generation of the trees, it's hard to get this ordering correct -- I generally have all the trees on top of all the mountains or vice versa. To fix this, I have to **make a list of all the trees and mountains together, sort them by the position of the lowest point on the element, and then go through the list in that order 'popping' each element to the top**."
> — [Back in the Woods Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)

Note: **sort key is the lowest point of the symbol, not its anchor/center**, and the mechanism is DOM reordering (`appendChild` to top), not a pre-sorted emit — mountains and trees are generated in separate passes.

### 4b. Within-tree draw order

- Trunk **before** clumps (clumps occlude trunk top) — Part 4.
- Cast shadow **before** tree — *"Now I need to make the shadow gray and **put it behind the tree**"* (Knurden P4); *"The shadow is drawn first so that that forest mass covers all but the edge of the shadow"* (Sprucing Up the Forest).
- Outline **last**, on top of highlight — *"The highlight is broader than the shadow, and closer to the outline, so it sometimes obscures the outline... To fix this, **I can draw the outline last so it is 'on top' of the highlight**."* ([Knurden Mountains P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html), same shading engine as trees)

### 4c. Knurden back/front-edge decomposition — the elegant trick

> "the solid color in the center of the forest obscures the trees on the back edge of the forest and is in turn obscured by the trees on the front edge... We can't even draw the back trees and then draw the solid color on top of them, because that would **cut a straight edge across the back trees**!"

> "My breakthrough realization was that **the trees on the back edges of the forest are a lot like the partial trees in the middle of the forest**. I could draw in the solid color, and then draw **'half trees' along the back edges**, and then **full trees along the front edges**."

**Back-edge detection, verbatim:**

> "Imagine that you're walking around the polygon **clockwise**... whenever you're **walking to the right, you're on the back edge** of the polygon. (This is one reason it is useful to have your polygons consistently clockwise or counter-clockwise ordered.) So I can walk around the polygon clockwise, **dropping half trees whenever I find myself going to the right**."

**Two must-implement corrections:**

> "this will drop the trees in the **wrong drawing order**. The trees need to be drawn from back to front, and this will often drop trees from front to back. So **after creating the trees you have to reorder them from back to front before drawing them**."

> "Because the back trees are only drawn from the midpoint up, and they're drawn on the polygon, **the midpoints of those trees are on the polygon**. So I need to do the same thing with the full trees. I don't want to draw them on the polygon, but **shift them down some so that their midpoints are on the polygon as well. Otherwise the front trees will look taller than the back trees.**"

**Half-tree construction:** *"these half trees are like **shortened full trees without the bottom part of the outline**... the dark shadow on the right side of the tree goes across the bottom, which makes these look like complete short trees. So I'll **adjust the shadow so that it doesn't go across the bottom**, so the bottom part of the tree looks more cut off. And I'll **draw the top half of the outline**."*

### 4d. Bump orientation — winding must encode which side the forest is on

> "When I construct the outlines of the forest, I construct the path so that it runs clockwise. **But that doesn't tell me which side of the path the forest is on**, so the bumps sometimes go the wrong way. What I need to do is construct the path so that **the forest is always on the left (or right) side** as you go around the path clockwise (or counter-clockwise). Then my bump can consistently go away from the forest mass."
> — [2017/11/various-miscellany-part-2](https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html)

**Verbatim JS:**

```javascript
function isLeft(a, b, c) {
     return ((b.X - a.X)*(c.Y - a.Y) > (b.Y - a.Y)*(c.X - a.X));
};
```

> "This is positive when C is on one side of the line, and negative when it is on the other. (Which is which depends upon your coordinate system.)"

Symptom if you get it wrong: *"the bumps in the larger hole point inward instead of outward."* Earlier/cruder version ([Forest Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html)): *"detect when the path is going the wrong way and reverse it"* via the SO signed-area method.

### 4e. Halos / white outlines around trees — **he does not do this**

Halos in Dragons Abound apply to **labels only**: *"labels normally have a halo around them that masks out the background to make the labels more readable when they (say) cross a coast line. **Haloes aren't really feasible to hand-draw**, so I've turned them off in this map style"* ([D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html)). Tree separation is achieved by (a) the painter's sort, (b) the outline stroke around each tree drawn in the fill/dark color, (c) in Knurden, occasional gaps between edge trees.

Unresolved overlap he shipped: *"I note that the 'liut Mam' city icon is on top of some tree icons. I'm not sure that's good, but I'll leave it for now."* ([Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html))

---

## 5. CANOPY BLOBS vs INDIVIDUAL TREES; BOUNDARY GENERATION

### 5a. Forest polygon extraction ([One of the (Forest) Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html))

> "The basic idea is to look at every location on the map. **If a location is a forest, and a neighboring location is not, then the edge between those two locations should be part of the forest edge.** Identifying those edges is not too difficult, but **chaining all the edges together to create continuous paths is a bit more challenging -- particularly because you cannot count on finding the edges in any particular order.**"

> "This general problem -- finding the edges in the world where some condition changes -- comes up fairly frequently. For example, the coast is just where the height of the land changes from positive to negative. So it's useful to have a **generalized function that takes a condition and returns all the edges where that condition changes.**"

Pathological case named: *"look at the little **bowtie** in the lower middle of the map. There are a bunch of different ways to connect those line segments together into paths -- getting that right is not trivial."*

**Then smooth before bumping:** *"The edges you get when you subdivide the map on a condition tend to be pretty complex, so I already have a couple of functions to simplify paths... One **smooths out the path, eliminating most small sharp deviations**. This will probably fix most of the **loops** in the edges."*

Boundary pipeline in order: **condition-edge extraction → chain into closed paths → smooth/simplify → enforce winding (forest-on-left) → apply bump routine → fill.**

### 5b. Interior of the blob

**Mottling** ([Sprucing Up the Forest](https://heredragonsabound.blogspot.com/2017/03/sprucing-up-forest.html)):

> "The way Dragons Abound mottles the land is to **draw each of the underlying locations in a slightly different color and then blur it all together**. This won't quite work for the forest masses, because the edges don't match with the underlying locations. (The forest edges have been smoothed and then made bumpy...) A possible solution is to **fill the forest with a flat color and then mottle the interior locations**."

**Point-in-polygon performance lesson — worth copying:**

> "The straightforward solution is to take a location and check to see if it is within the SVG path... but telling if a point is inside an arbitrary polygon is non-trivial, and **having the polygon represented as an SVG path is another big complication**. The SVG path isn't a simple list of points, but actually a bunch of Bezier curves... **Unfortunately, this is really slow.** It occurs to me that at one point during the creation of the forest edge **I actually do have the edge as a list of points**, so I could use that and avoid the work of interpreting the SVG path. Now I just have to tell if the point is inside a **polygon with straight edges**. The code for that problem is a lot simpler. Amazingly, this code works first try, and is **much faster**."

Then: *"the locations around the edge of the forest often overlap the edge. The solution is to **clip them to the forest outline**"* → *"The clipping creates spots along the edges where there's no background color, so I need to **add that back in, and throw a blur filter on the mass**."*

**Edge darkening (3D):** *"draw around the edge of the forest with a **fat line a little darker than the fill color, clipping to the forest**. Only the part of the line inside the forest is visible, and I can **include that in the blur** so that it gets blended into the rest of the forest fill."*

**Cast shadow on the mass:** *"I draw the forest mass in **partially-transparent black and offset it a bit**. The shadow is drawn first so that the forest mass covers all but the edge of the shadow"* + *"a little bit of blur"*; better option *"basing the color of the shadow on the land, rather than just a neutral color."*

**SVG fill limitation, acknowledged:** *"SVG fills polygons assuming that they are solid, so it **covers over any isolated open spots** within the forest mass."* Later fixed by *"carefully constructing the forest areas and **letting SVG figure out the holes**"* — i.e. even-odd/nonzero fill-rule with subpaths — *"But there's one part I couldn't rely on SVG to calculate for me -- the 'bumps'."* ([Various Miscellany P2](https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html))

### 5c. Knurden interior decoration ([Forests P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html))

Three layers on top of the solid blob:
1. **Scattered treetops** — half-trees, slightly shorter, *"To create a good scatter of trees, I can use a **Poisson sampling**."*
2. **Light/dark patches** — *"patches of lighter and darker color, as if you're seeing the highlights and shadows of trees without the outlines. However, **the colors are not paired light + dark as they are in a tree, just scattered about**. I can add these by **reusing the Poisson sampling** to place light and dark patches. He just draws these as **short vertical lines**, so I'll do the same. **The contrast on these is not as obvious as on the tree shadows and highlights, so I'll dial that back as well.**"* Honest self-assessment: *"this sort of thing -- a small, irregular dash of color -- is where SVG is weakest. **These spots lack any sort of character.** I've tried adding a blur, but that is not an improvement."*
3. **Interior gradient** — *"a slight light to dark gradient in the direction of the lighting. This is somewhat harder to do in SVG because **gradients are based on the rectangular bounding box of the polygon**, meaning that they don't follow the contours of the polygon. So instead of having the left edge of the polygon be lighter in color, you have the left **area** of the polygon lighter in color. Which is not the same thing at all, but if the gradient isn't too obvious it still looks okay."*

**Hybrid confirmation:** the same blob+half-tree+full-tree machinery drives the "fluffy" and "fir" tree styles: *"I already had a couple of other tree styles that could be used to draw forests this way instead of the Knurden-style trees, if I just implemented the half-tree and tree highlights... This works better... partly because the **geometry of the fir tree is closer to the Knurden oval tree shape**."*

---

## 6. COLORS, STROKES, OPACITY, FILTERS

### 6a. Everything the blog states numerically (this is the complete list)

| Value | Source |
|---|---|
| Trunk length **20–25% of tree height** | [Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html) |
| Conifer branch length **2–3× branch width** (later reduced) | [Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html) |
| **5–10** texture bumps per tree | [Part 5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html) |
| Max **3** clumps per deciduous tree | [Part 3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html) |
| Shadow/shading color **15–20% darker than background** | [Knurden Mountains P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html) |
| Cast shadow **50% opacity** gray | [Knurden Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html) |
| Knurden land-texture lines **~50% opacity** | [Knurden Basic Map P3](https://heredragonsabound.blogspot.com/2020/12/knurden-style-basic-map-part-3.html) |
| Poisson `k = 30`, annulus `[r, 2r]`, `cellSize = r·√½` | beaugunderson sampler |
| Bézier→polyline: 20 segs smooth, 8 segs faceted | [Outline of a Solution](https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html) |
| Highlight tint: *"adding some green and taking away some blue"* | [Knurden Mountains P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html) |
| Conifer hue: *"their own color range on the **blue end of the green spectrum**"* | [Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html) |
| Interior forest fill: *"a **darker version of the land color**"* | [Knurden P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html) |

**No hex codes are published anywhere for trees.** All colors are derived at runtime from the map's generated palette (`colorsSatRange: [.50, .70]`, `colorsUseGrayScale: 0.10`, `colorsUseDesaturation: 0.20` are the only literal color params ever shown — [Parameter Management](https://heredragonsabound.blogspot.com/2018/04/parameter-management.html), and those are map-global, not forest).

### 6b. Hex values I sampled from his own rendered images (median-cut quantization, ≥1% coverage)

**Knurden shaded tree** ([image](https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEiNoracW54hcCDlvNUpGoNlws1SA8ASUtg22BmZ2N_kzbyci4at6wwmFna9_OpIVX2isjaN_eUTP9ocWt6qD-uUtS_jmY8rQopr9HhaPWLuJzs8bMuZ_3wCvq0EkWRiYlBjMUBTAYoamJCj/s16000/Image1.png) from Knurden Trees P4) — a clean 5-stop ramp, this is the most directly usable:

```
#d1d9bb  rgb(209,217,187)   highlight (yellowed, lightest)
#a8b489  rgb(168,180,137)   light mid
#8b986c  rgb(139,152,108)   base fill
#737e56  rgb(115,126, 86)   shadow
#5a6346  rgb( 90, 99, 70)   deep shadow
#424834  rgb( 66, 72, 52)   deepest / outline-adjacent
#161713 / #030303           outline stroke (near-black)
```
Ratio check: `#737e56` is ~17% darker than `#8b986c` — matches his stated "15–20% darker" rule exactly.

**Knurden forest (final, in situ)** ([image](https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgHh5YVI3avw2YDo976t5fmCstSRAho-auidxB_Opy0cHzEhou8YIyBtxmfJlYMV-9FAtSNTDv6tTngOyYd1XCsTc6B5wpXj-j2ExDJ9YxlLodbMFo53e6cIfMwQ7TBxvLeIJe9e_3cvjRg/s16000/Image1.png)):
```
#8fa35e  land / grass base
#3f482b  forest interior blob (darker version of land) — ~55% luminance of land
#94a771 / #899d6f   interior light/dark patch colors
#bac5c5 / #a9b7b2 / #c6d0ce / #dce4df   water bands
```

**Conifer color range** ([image](https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjtAtms8lEwfIdSs7Vh2WeaEVRnzh0TWVNC7rU-BFMf6Dym3qfmcF2hsB139xQ4yjNbvBg5smzNAufUnJDyXuG1lv2WVGYDq8McpJzAhvbnAtTNlH1HWxTTxlmxhyPrC6EOF2h-wwE86hsD/s1600/Image1.png)) — note hue shift toward blue-green vs the deciduous set:
```
#576a4b  rgb( 87,106, 75)   conifer body
#1e341a  rgb( 30, 52, 26)   conifer dark
#0d1c11  rgb( 13, 28, 17)   conifer deepest
#2f2215  rgb( 47, 34, 21)   trunk brown
```

**Deciduous trees on map** ([image](https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEguXH4qTrUM58EPRoOLCD1Sgoqi2Lh0K1yX2ZFCexmgWDKerMp3erBZGT8olb_Gjk6S9CbDST94vzz7C5YT2R4VVTKkq94-XZKLg0SBQ7IptSzjY-P4rDrnM251Poz-Gsa1EtG2nxe2F49o/s1600/Image1.png)) — desaturated palette:
```
#e4d2b6 / #dfcbab / #d3bc99 / #e8d8c0   parchment land
#727b77 / #79837f / #6e7671             muted green-gray tree body
#44453a                                  tree dark / outline
#a8a28e                                  mid tone
```

### 6c. Filters and gradients — exact techniques

**Deciduous shading — radial gradient, offset, with the radius gotcha** ([Part 6](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-6-shading.html)):

> "I'll use a **radial gradient that is light in the center and dark at the edge, but I'll offset it upwards and to the right** so that it looks like the sun is coming from that direction."

> "I'm **applying this gradient individually to each of the clumps** that make up the tree, so trees with two or three clumps start to show that structure."

> "you'll notice that the gradient gets dark about halfway across the clump and then stays the same shade the rest of the way. Why is that? **By default, the SVG radial gradient has the same radius as the size of the object it is applied to.** (How that size is calculated is something of a mystery!) Since I've **shifted the center of the gradient up and to the left, I need to stretch out the radius so it can still reach the far edge of the clump.**"

**Conifer shading — linear, tilted** ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)): *"as with peaked roofs, **SVG doesn't offer the correct gradient for shading a cone**. I have to make due with a **tilted linear gradient**."*

**Leaf texture — Perlin/`feTurbulence`** ([Part 5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html)):

> "SVG filters... include a **Perlin noise generator**... In this case, I'm going to **modify the 'film grain' texture from Inkscape** to create a texture that hopefully looks something like leaves."

> "**SVG filters are size-invariant**, so the texture doesn't look right on the big example. But on the smaller icons you can see this is pretty convincing. **Because the texture is based on noise rather than random, the eye sees little clusters and texture in the trees.**"

**Needle texture — anisotropic frequency** ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)):

> "conifers have needles, not leaves. I need a more needle-shaped noise. I can get that by **changing the frequency in just the X dimension to stretch out the noise up and down**."

i.e. `<feTurbulence baseFrequency="fx fy">` with `fx << fy`. Limitation: *"I'd like to change this texture so that it runs at a slant rather than straight up and down, but **SVG doesn't seem to have a way to rotate a filter**. So far StackOverflow doesn't know how to do it either."*

Interaction with shading: *"The bumps in the shadow areas get a little bit lost because they're close in value to the shadow but overall it's fine"*; noise + gradient together is *"Suddenly much darker."*

**Cast shadow** ([Part 6](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-6-shading.html)):

> "for a round tree the shadow is an **ellipse cast opposite the direction of the sun**. Since the sun is **up high and to the right** on Dragons Abound maps, that means the shadow will be **below and to the left** of the tree. So to start, I'll create an ellipse with the **right end near the trunk**."

> "I'm allowing a **range of starting points for the ellipse as well as the length of the ellipse. During map generation, I'll pick one set of values and use them consistently for all the trees.** You can also see that I'm using a **pretty crude approximation for an ellipse**, but at map scale this isn't visible."

> "this is actually **partially-transparent black**... Next I want to add a **small amount of blur** to the shadow."

> "**To make the shadows visible on the map, I had to make them almost completely opaque.** As a result, not much of the land color shows through. So it might be better to use a **dark version of the land color** for the shadow instead."

**Knurden shadow/highlight — clipped blur, the one real gotcha** ([Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html)):

> "I have to try to **snip out the correct part of the polygon that is the outline of the tree -- the right side of the polygon** assuming the tree is lit from the left... Now I'll modify the routine to **draw the line in a darker version of the fill color and then blur it** so it blends into the body of the tree."

> "**Problem! The blur smears outside of the tree.** In drawing the mountains this wasn't a problem because the line was inside the edge of the mountain... But the trees are so small that even a small amount of blur leaks out past the edges. **The fix is to use the tree outline as a clipping area.**"

> "The drawback is that we have to **create a clipping path for every individual tree on the map**. Programmatically this is easy enough to do, but if I do this too much I can end up handing the browser a **very big and very complex SVG**."

> "(Aside: You might think this could be handled by drawing all the trees into a layer and then applying a single mask to the whole layer. **This would fail when two trees overlapped each other.** Both trees would have to be unmasked, so the blur from one tree would leak into the other.)"

> "(As it turns out, **at map scale the blur probably isn't even necessary.** But since you can zoom DA maps to any scale, it's nice to have it.)"

Highlight = same construction, *"only on the upper part of the tree"*, *"more yellow."* Cast shadow: *"a gray ellipse at the base of the tree... **shift it down and in the opposite direction of the light**. I'll also **stretch it out** a bit... I've made the shadow color **50% opacity**, so it should take on the color of the background."*

**Haunted fog** ([Haunted Forests](https://heredragonsabound.blogspot.com/2021/10/haunted-forests.html)): fill forest shape gray → *"make the edges indistinct"* + *"somewhat translucent"* → *"a **radial gradient**, so that I can make it **heavier and darker in the center and fading out to the edges**. SVG only supports circular gradients, so the fade will not be consistent but might still look good."*

---

## 7. Minimal implementation order (derived)

1. `bezierBump(p0,p1)` — normal-offset cubic control points + jitter (§1a), flatten via `getPointAtLength`, drop last point per segment.
2. `bumpyPolyline(pts)` — map over segments, concat.
3. `circleAsSegments(n)` → per-point x/y jitter → `bumpyPolyline` → **one clump**.
4. Stack 1–3 clumps in a pyramid with minimum offset; union → tree outline; keep clump outlines faint for texture.
5. Trunk polygon: from tree center, length ≈ 1.0–1.25× radius, width flaring at base; **draw before clumps**.
6. Conifer: triangle → sides subdivided into monotonically increasing segments (+ jitter) → project branch tips at ~2× base width → curve → scallop bottom + scallop between branch pairs → move path start off the apex.
7. Poisson-disc (`k=30`) inside forest polygon with holes, seeded at a polygon vertex, in-polygon test embedded in the candidate loop.
8. Emit; then **global sort of all trees+mountains by lowest y**, re-append in order.
9. Shading: per-clump offset radial gradient (stretch `r`!) or snipped-outline + darker fill + blur + **per-tree clipPath**; `feTurbulence` leaf noise, `baseFrequency` x≪y for needles.
10. Cast shadow ellipse: one global (start-offset, length) pair per map, below-left, translucent dark-land-color, small blur, behind tree.

**Two things you'll want that he never built:** size-by-elevation/edge-distance for trees (purely random in DA), and halos around tree symbols (labels only).

agentId: ad3cd834997a23ec6 (use SendMessage with to: 'ad3cd834997a23ec6', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 195283
tool_uses: 44
duration_ms: 553183</usage>

---

<!-- fuente: rivers-lakes.md -->

# RIVERS & LAKES — Dragons Abound (Here Dragons Abound, Scott Turner) — Implementable Recipe

**Method note:** I enumerated the complete blog corpus (201 posts, Oct 2016 – Jun 2022, verified against `sitemap.xml`, the Blogger `feeds/posts/summary` API, and the archive month list — the blog ends June 2022). I fetched and full-text-searched all 201 posts plus all 412 blog comments, plus the referenced external sources. **Critical framing fact up front:** Dragons Abound is closed-source and Turner almost never publishes river/lake code — he publishes *prose descriptions plus one formula image*. Where verbatim code exists, it is either (a) his own public gist, (b) Martin O'Leary's `terrain.js`, which Dragons Abound is a **direct fork of**, or (c) the npm packages he names. I mark provenance on every code block. Do not attribute (b)/(c) to Dragons Abound itself.

---

## 0. Provenance chain (load-bearing)

> "In the late summer of 2016, Martin O'Leary made a posting on his web blog of a fantasy map generator written in Javascript... unlike most folks, I accepted Martin's invitation to grab the code and start playing with it. For the past month or so, I've continued to modify and extend Martin's map generator."
> — https://heredragonsabound.blogspot.com/2016/10/welcome.html

So the flux/downhill/sink-fill core **is** O'Leary's `terrain.js` (https://github.com/mewo2/terrain), progressively rewritten. Blog post #1 already has working rivers; there is no "how I wrote rivers" post.

---

## 1. RIVER PATH GENERATION

### 1.1 Grid

> "The basic parameter that controls the resolution of the underlying grid in Dragons Abound is cleverly called "npts" for Number of Points. For every unit area of the map (the regional maps I normally use as examples are 1 unit in area), Dragons Abound creates this many locations in the underlying grid. **Typically I use a value of 16K (16384) for npts**, which roughly means that each location in the grid corresponds to about a 70 square pixels on the screen at the default magnification."
> — https://heredragonsabound.blogspot.com/2018/12/voronoi-revisited-part-1.html

Also from that post: ~92 MB at 16K pts; ~3 KB memory per point; **each point adds two SVG elements**; the Chrome tab **crashes around 128K points** — but only because of land/ocean per-cell polygon rendering. With per-cell land/sea rendering off, 256K points renders fine.

Two-resolution scheme (important — this is why deltas were hard):

> "In order to get detailed coastlines, Dragons Abound generates land using a dense Voronoi grid. However, using a dense grid drastically slows down subsequent world generation routines (such as calculating wind, precipitation and rivers). To avoid that, **once the land has been defined, Dragons Abound saves the detailed coastlines and reduces the size of the grid.** From that point on, the coastlines define the land, so raising parts of the ocean doesn't change the land."
> — https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html

### 1.2 Precipitation → flux

> "Dragons Abound models rivers based upon flux: **the amount of water flowing through a location. Precipitation falls on the land, is partly used up by evaporation and plants, and the rest flows downhill as flux.** The width of rivers is based upon the amount of flux, so rivers get wider as they flow downhill to the sea."
> — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html

Precipitation model (drives flux; O'Leary used a flat constant):

> "Martin O'Leary's map generator just has a fixed amount of precipitation at every location. (It's only used to generate rivers.)... I decide to simulate a very simplified rainfall model: moisture enters the atmosphere by evaporating from the oceans, is blown onto land by the trade winds, and precipitates out where conditions are favorable."
> Wind rules, verbatim: "- Wind slows down when going uphill and speeds up when going downhill. - Wind turns away from obstructions."
> — https://heredragonsabound.blogspot.com/2016/10/is-it-windy-in-here.html

> "In Dragons Abound, the only source of updrafts is rising land, so most precipitation occurs on rising slopes... **(1) Edges of the map are given a steady wind value (a "trade wind"), and (2) Atmosphere coming in from the edge of the map is given a moderate amount of water vapor.** ... at all times there is a base chance of precipitation proportional to the amount of water vapor in the atmosphere."
> — https://heredragonsabound.blogspot.com/2017/03/saving-for-rainy-day.html

### 1.3 Depression filling — ALGORITHM NAME CONFIRMED

> "**The sink filling algorithm Dragons Abound uses is called the Planchon-Darboux algorithm.** It's elegant and efficient (you can read the original paper here) but for whatever reason I find it difficult to wrap my head around. And that's made more complicated because Dragons Abound changes the resolution of the underlying map after drawing the coasts, and other factors."
> — https://heredragonsabound.blogspot.com/2019/10/learning-from-azgaar-terrain-generation.html

Note: **Planchon-Darboux, not priority-flood.** And explicitly, sinks are *filled*, not converted to lakes:

> "(In "real life" a spot like that would fill up with water creating a lake, until it overflowed and the water could continue on downhill. If you want to know why Dragons Abound doesn't do that, you'll have to find that discussion in the archives :-)" — *ibid.*

### 1.4 VERBATIM ancestor code (O'Leary `terrain.js`, forked by Dragons Abound)

Source: https://github.com/mewo2/terrain/blob/master/terrain.js

**Downhill pointer per cell** (`-1` = local min, `-2` = map edge):

```js
function downhill(h) {
    if (h.downhill) return h.downhill;
    function downfrom(i) {
        if (isedge(h.mesh, i)) return -2;
        var best = -1;
        var besth = h[i];
        var nbs = neighbours(h.mesh, i);
        for (var j = 0; j < nbs.length; j++) {
            if (h[nbs[j]] < besth) {
                besth = h[nbs[j]];
                best = nbs[j];
            }
        }
        return best;
    }
    var downs = [];
    for (var i = 0; i < h.length; i++) {
        downs[i] = downfrom(i);
    }
    h.downhill = downs;
    return downs;
}
```

**Planchon-Darboux sink fill — note `epsilon = 1e-5`, `infinity = 999999`:**

```js
function fillSinks(h, epsilon) {
    epsilon = epsilon || 1e-5;
    var infinity = 999999;
    var newh = zero(h.mesh);
    for (var i = 0; i < h.length; i++) {
        if (isnearedge(h.mesh, i)) {
            newh[i] = h[i];
        } else {
            newh[i] = infinity;
        }
    }
    while (true) {
        var changed = false;
        for (var i = 0; i < h.length; i++) {
            if (newh[i] == h[i]) continue;
            var nbs = neighbours(h.mesh, i);
            for (var j = 0; j < nbs.length; j++) {
                if (h[i] >= newh[nbs[j]] + epsilon) {
                    newh[i] = h[i];
                    changed = true;
                    break;
                }
                var oh = newh[nbs[j]] + epsilon;
                if ((newh[i] > oh) && (oh > h[i])) {
                    newh[i] = oh;
                    changed = true;
                }
            }
        }
        if (!changed) return newh;
    }
}
```

**Flux accumulation — each cell seeded with `1/n`, cells processed in descending-height order, flux pushed to downhill neighbour. This is the whole drainage-accumulation algorithm:**

```js
function getFlux(h) {
    var dh = downhill(h);
    var idxs = [];
    var flux = zero(h.mesh); 
    for (var i = 0; i < h.length; i++) {
        idxs[i] = i;
        flux[i] = 1/h.length;
    }
    idxs.sort(function (a, b) {
        return h[b] - h[a];
    });
    for (var i = 0; i < h.length; i++) {
        var j = idxs[i];
        if (dh[j] >= 0) {
            flux[dh[j]] += flux[j];
        }
    }
    return flux;
}
```

**Slope** (gradient magnitude of the triangle, *not* the downhill drop — note the dead `continue`):

```js
function getSlope(h) {
    var dh = downhill(h);
    var slope = zero(h.mesh);
    for (var i = 0; i < h.length; i++) {
        var s = trislope(h, i);
        slope[i] = Math.sqrt(s[0] * s[0] + s[1] * s[1]);
        continue;
        if (dh[i] < 0) {
            slope[i] = 0;
        } else {
            slope[i] = (h[i] - h[dh[i]]) / distance(h.mesh, i, dh[i]);
        }
    }
    return slope;
}
```

**RIVER APPEARANCE THRESHOLD — the exact number.** `limit` is scaled by the land fraction, and rivers are traced as downhill links; when the downhill cell is below sea level the link stops at the **midpoint** (half-step into the ocean):

```js
function getRivers(h, limit) {
    var dh = downhill(h);
    var flux = getFlux(h);
    var links = [];
    var above = 0;
    for (var i = 0; i < h.length; i++) {
        if (h[i] > 0) above++;
    }
    limit *= above / h.length;
    for (var i = 0; i < dh.length; i++) {
        if (isnearedge(h.mesh, i)) continue;
        if (flux[i] > limit && h[i] > 0 && dh[i] >= 0) {
            var up = h.mesh.vxs[i];
            var down = h.mesh.vxs[dh[i]];
            if (h[dh[i]] > 0) {
                links.push([up, down]);
            } else {
                links.push([up, [(up[0] + down[0])/2, (up[1] + down[1])/2]]);
            }
        }
    }
    return mergeSegments(links).map(relaxPath);
}
```

Called as (this is the **exact threshold constant**):

```js
render.rivers = getRivers(render.h, 0.01);
```

Erosion (`erosionRate` is the classic stream-power form `sqrt(flux) * slope`, capped at 200, river weighted 1000×):

```js
function erosionRate(h) {
    var flux = getFlux(h);
    var slope = getSlope(h);
    var newh = zero(h.mesh);
    for (var i = 0; i < h.length; i++) {
        var river = Math.sqrt(flux[i]) * slope[i];
        var creep = slope[i] * slope[i];
        var total = 1000 * river + creep;
        total = total > 200 ? 200 : total;
        newh[i] = total;
    }
    return newh;
}

function doErosion(h, amount, n) {
    n = n || 1;
    h = fillSinks(h);
    for (var i = 0; i < n; i++) {
        h = erode(h, amount);
        h = fillSinks(h);
    }
    return h;
}
```

Segment→polyline joining (`mergeSegments`) links share endpoints and only extends a path where the adjacency count is exactly 2 — **this is what makes tributary junctions become separate paths rather than one merged polyline**. Full source in `terrain.js` lines 613–662.

### 1.5 Dragons Abound's divergences from the ancestor

- **River valleys are carved:** "When generating rivers, I push down the terrain where the river runs. This puts each river in a small valley, and when I generate a map using psuedo-3D shading, the rivers get nice shadows." — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html
- **Rivers continue under the ocean:** "there's a test that says to stop drawing the river once it reaches the ocean (actually a bit after it reaches the ocean). (Rivers actually keep flowing under the ocean. This is useful if, for example, the sea level changes.) This makes the river broaden out properly at the coast, and prevents a situation where a river can come out of the ocean to cross land again." The bugfix: "make the ocean test a little smarter by **looking backwards from the end of the river rather than forward from the start**." — https://heredragonsabound.blogspot.com/2019/10/learning-from-azgaar-terrain-generation.html
- **Rivers→paths moved earlier in the pipeline (2020 refactor):** "Currently, rivers are generated as a sort of linked list between Voronoi locations. It's only when the river is being drawn that it is converted to a path. In order to add more realistic curves to the rivers, I need to do is **convert the rivers to paths immediately after they're created** rather than right before they'd drawn, and then use these paths for the rest of the map creation." — https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html
- **Rivers know their cells (added 2019):** "the first step is to go back to when rivers are created and preserve the connection between the river and the locations it runs through." — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html
- **Which rivers reach the ocean is tracked (added 2019):** "I don't actually keep track of which rivers make it to the ocean and which end at other rivers. So let me add that info." — *ibid.*

---

## 2. WIDTH AS A FUNCTION OF FLUX — THE EXACT FORMULA

Original model: `width ∝ flux`. Turner then added slope. The formula is published as an image; I downloaded and read it. **Verbatim:**

```
                flux_loc
width_loc = ─────────────────
             slope_loc + C
```

(rendered image: `Image38.png` in https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html)

> "I'm sure there are many factors affecting how fast a river can flow, but for my purposes I'll use the slope of the underlying land. A steeper slope will mean faster moving water. The width of the river in a location is then proportional to the flux divided by the slope... **The constant C here adjusts how important the slope is in determining the width of the river -- the larger the constant, the less important the slope.** ... As C decreases, the upper parts of the river where the slope is higher (and the river flows faster) shrink in width."
> — *ibid.*

**There is no `sqrt(flux)` in Dragons Abound's width function.** `sqrt(flux)` appears only in O'Leary's *erosion* rate and territory cost. C is never given a numeric value anywhere on the blog.

Rationale: "A faster river carries away more water, so for two rivers with the same flux, the slower river will be wider." Side effect he liked: "it's possible to have a river broaden as it goes through a flat area and then narrow as the slope increases."

**Minimum width, and the zero-width start:**

> "It just starts at a minimum width, and if the river has an outline (as in this example), the outline is missing across the start of the river. (**Rivers have a minimum width to avoid having rivers that are nearly-invisible thin lines.**) ... With the new river code, though, **I can just set the initial width of the river to zero, so that the river starts with a point** ... That works, but looks a little pinched off. Let me try phasing in the river over the first part of the river ... **Now the river starts at a point and then gradually increases to the minimum width.**"
> — https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html

Branch exception (deltas): "Every river starts from nothing, so Dragons Abound always draws rivers starting from a point and growing to their initial width. What I need to do is **add a test to detect when a river is branching off of another river, and then suppress the narrow start.**" — https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html

**Noise-modulated width (2020):**
> "For various reasons having to do with the way terrain is generated and smoothed, the width of rivers tend to be smooth, slowly increasing curves... To add some interest, **I'll vary the width slightly using a noise source.** [first attempt] That's a bit too extreme a variation. After tweaking the noise parameters a bit... One minor problem is that **these width variations are always symmetric**, but if that bothers me enough I'll address it later." — https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html

---

## 3. TAPERED RENDERING — HOW THE STROKE IS ACTUALLY BUILT

There are **two eras**. Implement era 2.

### Era 1 (pre-Oct 2017): multiple stroked segments, quantized to ¼ point

> "SVG doesn't allow you to change the pen size while drawing a path, so this is actually accomplished by breaking the path down into a lot of smaller paths, each of which is drawn separately with a different pen size."
> — https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html

> "If you use a fairly small increment of change in width (**around a quarter point** works well for me) the line appears to be smoothly changing."
> — https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html

> "the width of the river gradually increases, **about a 1/4 point of width at a time**, and that looks smooth to the user. But with the switch to flux + slope based width, it's possible for the width of the river to change pretty drastically from one location to its neighbor. That's what's happening with the pill-shaped lakes in the map above. That's actually a short line of the proper width -- with rounded ends, which is why it looks like a pill. The fix... is to take that segment of the river and break it up into a bunch of smaller segments, **changing the size by a 1/4 point of width in each of the new segments**."
> — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html

Failure mode of era 1 (why he abandoned it): the curve is redrawn as many independent sub-paths, so smooth curves become visibly faceted, and abrupt width jumps produce "pill" artifacts.

### Era 2 (Oct 2017 →): **polygon outline via centerline offsetting.** This is the answer.

> "In working with Inkscape... I realized that Inkscape doesn't generally used lines (stroked paths) at all. Instead, **lines are created by using long thin polygons.** ... If you want to make a line with varying width, you can just draw the polygon appropriately. **This approach avoids the problems I have with drawing varying width lines by varying the pen size. There's no need to break the line down into segments to achieve a smooth curve -- I can use the SVG curve capabilities to draw each side of the polygon and get smooth curves that way.** The biggest drawback is that there doesn't seem to be a handy library available that implements this, so I'll have to implement it myself."
> — https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html

Algorithm, verbatim, in his own steps (*ibid.*):

> "I'm going to do something similar to the approach described here as **Method 1**. I will start by **finding the normal to each point along the path**... Then on each normal I will find **the point on either side of the path that is half the width of the line at that point**... The final step is to **draw two smooth curves through the black points, connecting at the beginning and end of the line to create a closed polygon**."

Method 1 reference = https://www.stat.auckland.ac.nz/~paul/Reports/VWline/vwline-intro/power-curve.html — "A perpendicular is calculated at each point on the line; the angle of the perpendicular is based on the slopes of the line segments either side of the point (or just the following/preceding line segment at the start/end of the line). A 'left' border is generated by connecting all left ends of the perpendiculars... **A polygon is generated by combining the left border with the reversed right border.**"

**The miter-width bug and the fix — this is the load-bearing gotcha:**

> "If the gradient is `[dx, dy]` then the normal is `[-dy, dx]`. I always forget the minus part of `-dy`."
> "**my simple-minded scheme doesn't work, because the angle of the normal changes the effective width of the line. It's necessary to adjust the width of the line based upon the angle of the miter.** While working on this problem I discovered **polyline-normals**, a Javascript package by **Matt DesLauriers** that calculates both the normals and the necessary adjustment. Dropping that in yields this: [works]"
> — *ibid.* (https://www.npmjs.com/package/polyline-normals)

VERBATIM miter math from that dependency (`polyline-miter-util/index.js`) — `halfThick / dot(miter, normalOfLineA)` is the width correction:

```js
module.exports.computeMiter = function computeMiter(tangent, miter, lineA, lineB, halfThick) {
    //get tangent line
    add(tangent, lineA, lineB)
    normalize(tangent, tangent)

    //get miter as a unit vector
    set(miter, -tangent[1], tangent[0])
    set(tmp, -lineA[1], lineA[0])

    //get the necessary length of our miter
    return halfThick / dot(miter, tmp)
}

module.exports.normal = function normal(out, dir) {
    //get perpendicular
    set(out, -dir[1], dir[0])
    return out
}

module.exports.direction = function direction(out, a, b) {
    //get unit dir of two lines
    subtract(out, a, b)
    normalize(out, out)
    return out
}
```

`polyline-normals` returns `[[[nx, ny], miterLength], ...]`; offset each point by `±halfWidth[i] * miterLength[i] * [nx, ny]`.

**Known residual artifact (accept it):**
> "This looks pretty good, but you can see that the width isn't exactly right everywhere. The difficulty is that **the width is only specified at certain spots on the curve, and the interpolation in-between those spots varies for the top and the bottom curves of the line.** For mathematical reasons, it's very difficult to make the two curves match exactly, so this problem is somewhat inherent in this approach." — *ibid.* (links to the Bézier offsetting/stroking Wikipedia section)

**End caps.** Butt end by default; the polygon path must be stitched from four separately-generated sub-paths because D3 cannot switch curve types mid-path:

> "D3... doesn't seem to have a way to switch curves in the middle of a path without sticking in an extraneous M(ove) command... So **I have to generate the paths for the two sides of the line and the two ends separately and then stitch them together manually.**"
> — https://heredragonsabound.blogspot.com/2017/10/city-symbols-part-6-fixing-some-problems.html

Round caps added 2019 (needed where tributaries meet at an angle):

> "I gave the lines flat ends -- I just draw a straight line across the width of the line at both ends... SVG/CSS offers three styles of line ends: butt, round and square. The way Dragons Abound currently does things is "butt." ... **Now I'll add an additional point at each end of the line that sticks out the width of the line.** ... I'm actually calculating from the normal to the line, and I've forgotten (as I often do) to convert properly between the normal and the perpendicular. ... **I already have a routine that takes arbitrary points and makes a quadratic arc between them. It isn't really a semi-circle but at the typical line scale it's probably close enough.**"
> — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html

(Earlier note on the correct construction: "doing that would actually cause the line to extend slightly (by the radius of the semicircle) past its endpoint. To do this correctly, **I have to back off the endpoint of the line by the radius of the semicircle and then connect it with a semicircle.**" — city-symbols-part-6.)

**Rivers only switched to this renderer in Oct 2018 — a full year late:**
> "I realized recently that **I'm still drawing rivers using SVG lines**, and changing the width of the river by adjusting the width of the line. In extreme cases this can result in some odd effects... But some time ago, I implemented a different way of drawing lines that lets me smoothly vary the width of the line any way I'd like. But for some reason I'd never switched over rivers to using the new line routines, so let me do that... the transitions are smoother and more natural in the new version. This is most noticeable in places like the fork where there are some sharp changes of direction. With the new version, I also have better control over the quality of the path drawing, so I can vary it between smooth and rough as I desire."
> — https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html

**Everything is a polyline now (25% perf win):**
> "the single most costly function was "getPointAtLength"... as the map has grown more complex, I've also been switching over to drawing Bezier curves myself, rather than relying on SVG's built-in Bezier curves. ... **When I draw a Bezier curve myself, it's just a sequence of short line segments. So everything I draw is actually just a polyline** and rather than use getPointAtLength, I can write a much simpler function that works on polylines. So I switched over to doing that, and **saved about 25% overall on the code execution time (!)**."
> — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html

---

## 4. SMOOTHING / INTERPOLATION

### 4.1 The curve — VERBATIM from Turner's own gist

Source: https://gist.github.com/srt19170/06a032e541cb4208a3e47a64f7b4687c (linked from https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html)

**The spline is `d3.curveCatmullRom.alpha(1.0)` (chordal Catmull-Rom). Not curveBasis, not curveCardinal. Default resample `step = 1`, default jitter `magnitude = 0.003`, perturbation smoothing window `3`:**

```js
//
//  Draw a line with the given curve, and then resample it
//  to a new set of points. <step> is the distance to step
//  along the line when taking a new point.
//
function drawInterpolate(svg, points, step, curve) {
	curve = curve || d3.curveCatmullRom.alpha(1.0);
	step = step || 1;
	var lineFunc = d3.line()
	    .curve(curve)
    	    .x(function(d) {return d[0]; })
	    .y(function(d) {return d[1];});
	// Draw line
	var path = svg.append('path')
	    .attr('d', lineFunc(points))
	    .style("stroke-linecap", "round")
	    .style("stroke-width", 1)
	    .style("stroke", "black");
	// Go through and find points corresponding to the line
	var results = [];
	var len = path.node().getTotalLength();
	for(var cur = 0;cur<len;cur += step) {
	    var pt = path.node().getPointAtLength(cur);
	    results.push([pt.x, pt.y]);
	};
	// Remove the line now that we've measured it.
	path.remove();
	return results;
};

//
//  "Jiggle" a series of line segments by the given magnitude.
//
function handDrawn(points, magnitude) {
	magnitude = magnitude || 0.003;

	// If we have a very short line, it sometimes resamples down to
	// nothing.  In this case, we can just return the original line.
	if (points.length < 2) return result;

	// Compute the gradients.
	var gradients = points.map(function (a, i, d) {
            if (i == 0) return [d[1][0] - d[0][0], d[1][1] - d[0][1]];
            if (i == points.length - 1)
		return [d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]];
            return [0.5 * (d[i + 1][0] - d[i - 1][0]),
                    0.5 * (d[i + 1][1] - d[i - 1][1])];
	});

	// Normalize the gradient vectors to be unit vectors.
	gradients = gradients.map(function (d) {
            var len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
	    if (len == 0) return [0, 0];
            return [d[0] / len, d[1] / len];
	});

	// Generate some perturbations.
	var perturbations = smoothLine(points.map(d3.randomNormal()), 3);

	// Add in the perturbations. We keep the first and last point
	// unchanged so that we know line segments will be able to match
	// up precisely.
	var result = points.slice(1,-1).map(function (d, i) {
    	    // Need i+1 here because we sliced off [0]
            var p = perturbations[i+1],
            g = gradients[i+1];
            return [d[0] + magnitude * g[1] * p,
                    d[1] - magnitude * g[0] * p];
	});
	// add first element and last element back
	result.unshift(points[0]);
	result.push(points[points.length-1]);
	return result;
}

//
//  This routine creates a smooth polyline of the given width
//  and color.  Points is an array of [x, y] values.
//
function drawLine(svg, points, width, color) {
	if (points.length < 2) return null;
	var lineFunc = d3.line()
	    .curve(d3.curveCatmullRom.alpha(1.0))
    	    .x( function(d) {return d[0]; })
	    .y(function(d) {return d[1];});
	var g = svg.append('g');
	return g.append('path')
	    .attr('d', lineFunc(points))
	    .style("stroke-linecap", "round")
	    .style("stroke-width", width)
	    .style("stroke", color);
};

//
//  This routine draws a polyline of the given width
//  and color, with added "jiggle".  Note that I'm using
//  hard-coded domain and magnitude values that work for me.
//
function drawLineHnd(svg, points, width, color, step, magnitude) {
	magnitude = magnitude || 0.003;
	step = step || 1;
	if (points.length < 2) return null;
	var p = drawInterpolate(svg, points, step);
	p = handDrawn(p, magnitude);
	return drawLine(svg, p, width, color);
};
```

Key structural rules stated in the post: jitter is applied **normal to the gradient** ("a natural 'side to side' wobble regardless of the orientation of the line"), and **start/end points are never jittered** so adjoining segments (tributary junctions!) still meet: "The fix is avoid adding jitter to the start and end points. Occasionally this creates a little 'hook' at the end of a line where a lot of jitter has to be eliminated."

**Order matters — curve first, then jitter:**
> "The solution is to do the curve interpolation first, and then the jitter interpolation. Unfortunately, D3js doesn't provide any (easy) way to do this. After an email exchange with Mike Bostock, it looks like the best approach is to **draw the original curve, and then interpolate it by measuring along the curve and sampling points. These points can then be jittered to make a new line.**"
> — https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html

Later replacement for `getPointAtLength` (avoids touching the DOM): feed D3 a **custom `CanvasPathInterface` context** that records `moveTo`/`lineTo`/`bezierCurveTo` and flattens them yourself — "It turns out that the D3js curves use only lines and cubic Bezier curves, and since I already have functions to interpolate those, implementing the context is pretty straightforward." — https://heredragonsabound.blogspot.com/2018/12/hand-drawn-lines-revisited.html

### 4.2 Neighbour-averaging smoother (VERBATIM, `terrain.js`) — the 0.25/0.5/0.25 kernel, endpoints pinned

```js
function relaxPath(path) {
    var newpath = [path[0]];
    for (var i = 1; i < path.length - 1; i++) {
        var newpt = [0.25 * path[i-1][0] + 0.5 * path[i][0] + 0.25 * path[i+1][0],
                     0.25 * path[i-1][1] + 0.5 * path[i][1] + 0.25 * path[i+1][1]];
        newpath.push(newpt);
    }
    newpath.push(path[path.length - 1]);
    return newpath;
}
```

Turner: "I have two ways to smooth out a path. One method works by dropping some of the points in the path, and the other works by average each point with it's neighbors. Both of these help, but **dropping points is the most important factor**." — https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html

### 4.3 Visvalingam simplification — the de-wiggler

The Voronoi wiggle problem:
> "Rivers often have stretches of wiggles... This happens because **the rivers are drawn from the center of one Voronoi polygon to the next, and three adjacent centers are almost never collinear, so rivers always have a kind of snaky path.**"
> Density is not the fix: "In this case **I quadrupled the number of underlying polygons and increased the runtime by about 10x.**"
> — https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html

> "Conveniently, there's an algorithm to do exactly this -- **Visvalingam's algorithm**... the algorithm removes the point that creates the least change in the path. You then do that repeatedly until you (say) remove 50% of the points in the path. **This has the effect of removing the highest frequency "noise" first.** Here's the river with **70% (!) of the path removed**: ... Visvalingam's algorithm is so good you have to remove a surprising amount of the path to make a noticeable difference." — *ibid.*

**CRITICAL constraint — junction points must be exempt:**
> "One of the junctions of two rivers is now wrong, and the joining river overshoots. This happens because the point where the two rivers joined has been removed. To fix this problem, **I have to modify Visvalingam's algorithm so that it doesn't try to remove any point where rivers join. I already have that fix in place for the smoothing algorithm**, so it's mostly a matter of applying the same logic." — *ibid.*

Algorithm restated: "you can visualize the areas between successive pieces of the line as triangles... The algorithm simplifies the line by **repeatedly removing the middle point of the smallest triangles.**" Removal percentages he cites: **50%** = barely visible change; **70%** = de-wiggles rivers; **85%** = smooth enough to run a text label along. — https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html

---

## 5. MEANDERING ALGORITHM

Reference implementation he adopted: Robert Hodgin's *Meander* (http://roberthodgin.com/project/meander).

> "The "TLDR" is to **move each point on the river towards the outside of the current curve and also in the direction the river is flowing at that point.** By modifying the way these two elements combine, you can create various kinds of meandering."
> — https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html

Per-point frame construction:

> "I have a routine to calculate the normals of a polyline... These vectors are normalized to a length of one and don't always point to the outside of the curve. To get to the modified bitangent, **I have to calculate the curvature of the river at each point, and then scale the vector by that curvature.** To calculate the curvature, **I use Menger's Curvature**... It's also a **signed curvature**, which means that negative curves will be inward and positive curves will be outside (or vice versa). The last thing I have to think about is **the range of the curvature**... he is limiting the curvature measure -- all of the curves below a certain radius have the same length bitangent. **This is necessary because the curvature can have a large range and we don't necessarily want to apply thousands of times more erosion force at one point in the river than in another.**" — *ibid.*

> "As it turns out, **to generate the bitangent I generate the tangent and rotate it 90 degrees**, so conveniently I already have the tangents." — *ibid.*

**Menger curvature, verbatim** from the StackOverflow answer Turner links (https://stackoverflow.com/a/41144762/318847):

```
curvature = 4*triangleArea/(sideLength1*sideLength2*sideLength3)
```

```java
/**
 * Returns twice the signed area of the triangle a-b-c.
 */
public static double area2(Point2D a, Point2D b, Point2D c) {
    return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
}

/**
 * Returns the Euclidean distance between this point and that point.
 */
public double distanceTo(Point2D that) {
    double dx = this.x - that.x;
    double dy = this.y - that.y;
    return Math.sqrt(dx*dx + dy*dy);
}
```

("Warning: `area2` returns a signed double, depending on the orientation of your points" — that sign is exactly what gives the signed curvature.)

### THE MIX RATIO — exact number, from Turner's own reply in comments

> **"With a fairly small step at each iteration, I didn't see much difference in the results, other than less bitangent requiring more iterations. So I settled on 75% bitangent and 25% tangent, and that's what you see in most of the results above."**
> — Scott Turner, comment on https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html (2020-07-07), replying to "What kind of mix did you end up with for your tangent / normal combination?"

Also stated in the post: 90% bitangent / 10% tangent "exaggerates the curves"; "as you would expect, 90% tangent adds only small curves"; "Increasing the strength of the vector also exaggerates the curves." And a geometric shortcut: "**Note that combining the tangent and the bitangent this way is equivalent to just rotating the tangent vector 45 degrees.**"

### ITERATION LOOP — exact

> "First of all, **it's an iterative process. I need to change the path of the river a little bit according to the combined vectors, then recalculate the vectors and repeat. If you try to do it all in one shot, you just get a weirdly exaggerated version of the original path.** Second, **this process will change the length of the river. If I want to keep the same uniform distance between points on the river, I'll need to resample the path or add in new points where the existing points have grown to be far apart.** Lastly, **there are some points on the river I have to keep the same -- notably the spots where two rivers join each other** -- or else I'll have problems where the rivers join."
> — *ibid.*

> **"Here it is with 10 iterations, with smoothing and re-interpolation between each iteration."** — *ibid.*

So per iteration: compute tangents → Menger signed curvature (clamped) → modified bitangent = normal × clamped curvature → `move = strength * (0.75*bitangent + 0.25*tangent)` → apply with join/mouth mask → **smooth** (0.25/0.5/0.25) → **re-interpolate to uniform spacing** → self/other-intersection checks. ×10.

### Guardrails (all five, verbatim)

1. **Taper mask at mouths and joins:** "I'll start off by avoiding meanders not just where rivers join other rivers or the ocean, but also for a distance on either side... there's an abrupt and obvious transition where meandering kicks in. **The solution is to have a "mask" that tapers in the meander**... Here the last part of the river is not meandered at all and then the next part slowly gets more meander. Now I need to apply the same masking principle to all the joins on the rivers."
2. **Self-intersection → cut the loop (oxbow):** "the river can be repaired by **removing the loop and adding a new point where the intersection occurred**. If I step through the river a segment at a time and see if the current segment intersects any of the later segments, that will provide the new intersection point as well as all the segments that can be eliminated. In the real world, when this happens the cutoff portion of the river becomes an oxbow lake. **For my purposes, I'll just eliminate the cutoff.**"
3. **Cross-river intersection → reject the iteration:** "instead I'll simply **detect when this happens and reject that meander**. A second difficulty is that there can be quite a few rivers on a map, so checking all of them for intersections after every meander iteration will likely be slow. To address this, **I'll only check to see if a river intersects with a river it joins to.**"
4. **Proximity buffer → freeze points:** "getting very close is not very realistic either, so let me adjust the code to create a buffer between the rivers. The basic idea is to **notice when part of a river is getting too close to another river and freeze that part so that it cannot be meandered further.** I can extend that same idea to self-intersections."
5. **Degenerate points:** "my calculations for curvature are broken if two adjacent points on the river are the same; that's fixed by **filtering out repeated points**."

### Where meanders are allowed (sinuosity control)

> "Dragons Abound has a measure of slope for each segment of a river, so I can try using that to control the amount of meander applied to the rivers. To start with, **I can restrict meanders to the flattest quarter of the rivers**... I've also added a parameter so that **on any map at most one river gets the full meander treatment.** A small improvement is to **use a noise map to control the amount of base meander** applied to rivers. This will result in rivers in some parts of the map remaining straight while others will develop some gentle curves." — *ibid.*

Downstream consequences he had to fix: meandered sections get a **second name** (variants of "The Meander" — "Rambles", "Cringle-Crangles" — or "The Snake River" — snake synonyms, e.g. "Anaconda"), labels are allowed to **overlap** the river and are centred mid-meander; and **forest setback had to switch from flux-lookup to actual river-path lookup**, "because the forests look at the actual water flux to decide where to avoid, but of course in creating the meanders I've moved the river to places where the flux is low and there wouldn't normally be a river."

---

## 6. RIVER MOUTHS, TRIBUTARIES, DELTAS

### 6.1 Mouth: draw long, clip, mask the coastline

> "The obvious fix would be to draw the river on top of the land outline. The problem with doing this is that **it is hard to end the river exactly where the ocean starts without leaving a gap or an overlap. So to avoid this, I have been drawing the river a little long and then drawing the ocean on top of the river.** This eliminates any potential gaps. For similar reasons, the land outline needs to be on top of both the ocean and the land."
> **"One solution is to mask out the land outline where the river crosses it. This is fairly straightforward -- I just need to draw the river a second time in black into a mask, and then apply that mask to the land outline."**
> "The transition is more abrupt than I'd like, though. **I can address that by broadening out the river where it joins the ocean.** ... It looks even better when the weight of the coastline is closer to the weight of the river border."
> **Style exception:** "this approach to drawing the river mouth turns out to be exactly backwards for a style which uses a solid black river... Masking out the coastline at a river mouth with a black river ends up creating an unnatural gap. **In this case I want to turn the mask off and leave a solid coastline.**"
> — https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html

Mouth-flare of the *outline*, plus the fudge:
> "To make these wider at the river mouth, I need to **increase the width of the black line and taper it off as it goes up-river.** ... This is not entirely straightforward because **the river actually extends into the ocean and then gets clipped to the land.** (This is done to avoid having to figure out exactly where the land ends.) But I can fudge the end a little bit to account for that... One challenge is that the thickness of the coast line can vary, and I don't know it's actual value where the river crosses it. **So I use the average thickness instead.**"
> "these problems are caused by Chrome's poor handling of clipping. There's not much I can do about it."
> — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html

### 6.2 Color gradient along the river mouth (coast-outline colour → river-outline colour)

> "SVG does not support gradients along a path. **The workaround, as described/demonstrated by Mike Bostock here, is to chop up the path into a bunch of small segments and then color each of those segments with colors from along the gradient.** If you chop up the path into sufficiently small segments, you get a smooth gradient." (link: https://bl.ocks.org/mbostock/4163057)
> "it draws a line as a polygon which essentially traces around the outside of the line. To make this a gradient, **I have to chop the polygon up into segments and then color each segment**... With five times as many segments, it looks smooth except under close examination."
> **"There are probably some proper ways to do gradients between two colors based upon human perception, but I'm just interpolating evenly in RGB space."**
> Seam artifacts: "**Setting this to "crispEdges" solved this problem**" (SVG `shape-rendering`) — but "The jaggedy edges on the gradients curve are caused by the crispEdges setting. Back to the drawing board. **An alternative fix is to draw a thin line around each segment as it is drawn.**"
> Angle limitation: "the size of the resulting segments is less than the width of the line, creating problems where the outer part of the line is much longer than the inner part. I can't think of any easy fix."
> Fix for angularity: "**I can work around this by interpolating the gradient region at a higher resolution.**"
> — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html

### 6.3 Deltas — two-post recipe

**Part 1 — building the land** (https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html):
- Raise a **semicircle** of ocean cells at the river mouth. Do *not* rely on that to make land (coastlines were frozen at higher resolution).
- Build an outline **from the whole circle**, not from the raised cells ("this outline doesn't actually correspond to the coast, because it is based on the coarser Voronoi grid. So if I try to 'add' this coastline to the existing coastline, I'll end up with holes").
- **Boolean union** the circle with the existing coastline: "Alexander Milevski has essentially solved this by implementing the **Martinez-Rueda polygon clipping algorithm** in Javascript."
- Smooth: "I'll **interpolate the new coastline for a bit more detail and then apply some smoothing**." Future idea: "Rather than use a semicircle for the delta, I could use a distorted semicircle or some other more natural shape."
- Islands: "**I can union each island with the mainland, and if the result is just one coastline (meaning the island was inside the mainland), I can delete the island.**"
- Mark new cells `land` or they render as shallow ocean. Deltas suppress city placement.

**Part 2 — the distributary network** (https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html):
- Connect the existing river to the **midpoint of the delta**, then "break that up into a few segments and add some variation."
- Project the river slightly past the shore: "**The solution is to project the river a little bit further into the ocean**" (otherwise the coastline shows through under the river's thickness).
- Branching loop: "**start at the point furthest from the coast, pick one or more random spots on existing rivers to branch from, then move a little closer to the coast and repeat.**"
- Flow split: "**Each time I split off a branch, I'll split some of the river's flow off to go with it.**"
- Plausibility constraint: "**I'll force branches to go somewhere close to the mouth of the river they are branching from. The farther back they branch, the farther away from the mouth they can go.**"
- "the very short rivers right at the coastline are a mess, so it might make sense to **end the river splitting early**."
- Branch-hits-branch: "I could **keep the short connectors as rivers but drop them from all the subsequent delta processing**."
- Bugs: a missing divisor made the new segment "narrowing down to nothing at the mouth"; the mouth-finding must use "**the first and the last intersections rather than the first two intersections**"; wrap-around coasts are undetectable so "**simply detect this case and reject this delta**" ("I've found that the 80 / 20 rule is a good guide -- I can throw out about 20% of the problem cases").
- Perf: point-in-polygon replaced with Dan Sunday's **winding number** algorithm (Vlad Lasky's JS port), "about 10% faster."

---

## 7. LAKES

**There is no dedicated lakes post.** Everything is in one section of https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html. Verbatim:

> "I'm sure I've complained before about lakes. **They're one of the hardest map elements to get right. Modeling the actual formation of lakes -- filling up depressions in the world, etc. frustrated me greatly the last time I attempted it. So my lakes are really just "stickers" overlaid on the map. The rivers just flow as they normally would underneath the sticker.** To make all the rivers coming into a lake flow out of a single exit means resculpting the ground under the sticker."

> "**The basic notion is to find the lowest point in the terrain that surrounds the lake and then modify the height of all the ground in the lake so that it all flows to that low point. That's not quite as easy as it sounds, but starting at the exit and working your way back across the lake adding small increments to the height works out.**"

Rivers through lakes:

> "A more substantial change was to allow rivers to continue to flow through lakes. **Previously I wasn't allowing this. If a river crossed a lake it was adjusted to either start in the lake or end in the lake.** The problem with allowing a river to continue across a lake is that it can leave the lake and cross back into the lake, which in some cases looks strange... If you look at these as continuous rivers, it looks odd -- the rivers flow into the lake and then out again. If you look at the area as all being part of the lake, it looks fine -- there are just a couple of islands on that edge of the lake. **Here I think it looks okay, but in general it doesn't look good. Often a river just clips the edge of a lake and that makes no sense.**"

Bug classes he names (technical glitches, no code): "**having a clipping path on the wrong SVG element, creating a slight bleed from a blur onto adjacent elements**."

Placement is random, confirmed in his Azgaar review: "As for lakes, I'm not sure what Azgaar's doing, but it looks like **they're being placed randomly (as Dragons Abound does)**. Lakes also have a different color from both rivers and oceans -- **I'd probably make them the same color as rivers.**" — https://heredragonsabound.blogspot.com/2019/08/azgarrs-fantasy-map-generator.html

Island-vs-lake classification gotcha: "it's surprisingly tricky to distinguish between islands and lakes when they run off the edge of the map." — https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html

Earlier artifact (era-1 renderer) worth knowing: what *looked* like "odd pill-shaped lakes" were actually short round-capped river segments from abrupt width changes — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html

---

## 8. COLORS, STROKE WIDTHS, OPACITY

**Blunt finding: Turner publishes essentially no hex codes.** I grepped all 201 post bodies for `#RRGGBB`/`#RGB`: the only hit in the entire blog is `#000000`, in a post about external SVG icons. He works in HSL and in relative widths. Here is everything that is concrete:

### 8.1 Water color — the HSL rule (this is his actual color model)

> "The key insight was to **select randomly in the Hue - Saturation - Luminosity (HSL) color space rather than the Red - Green - Blue (RGB) color space.** The colors that work well for oceans are all in a single stretch of the hue space, **from slightly green-blue (0.50) to slightly violet-blue (0.60)**. And the clash between ocean and land colors is not a hue problem, but occurs when there is a mismatch between the Saturation or the Luminosity of the colors. **So by choosing randomly in the hue space of 0.50 to 0.60 and matching my Saturation and Luminosity appropriately to the land color**, I end up with an ocean color that usually looks pretty good."
> — https://heredragonsabound.blogspot.com/2017/07/decorating-ocean-part-one.html

**Recipe: `hue = random(0.50, 0.60)` in normalized HSL (i.e. 180°–216°); S and L derived from the land color.** Deep water = same color with **reduced luminosity**: "generate the color of the deep water by **reducing the luminosity of the base ocean color**... it turns out to be very useful to have a utility routine for changing the luminosity of a color." Deep-water threshold is a **quantile**: "if you want about 30% of your ocean to be 'deep water', then sort all the ocean depths and pick the one that is 30% from the bottom."

Rivers default to the ocean color; lakes should match rivers; there is an option to pick up the coastal-water color instead:
> "one difference in the maps is that the Dragons Abound maps have rivers that are the ocean color, rather than white (or the coastal water color) as in the Knurden map: **Dragons Abound has an option to pick up the coastal water color** but it seems to be turned off. (Probably some change broke it and I haven't fixed it yet.) Fortunately, I can also just **force a particular color**."
> — https://heredragonsabound.blogspot.com/2020/12/knurden-style-basic-map-part-3.html

### 8.2 The river outline: two stacked strokes

> **"The river is drawn first as a solid black line and then as a narrower solid blue line on top. This creates the black borders (outline) on either side of the river."**
> — https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html

> "To make a river with a black border (like in the map above) **I draw a slightly wider river in black and then a slightly narrower river in blue on top of it.**"
> — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html

Candid note on the state of that code: "the code that creates the river borders... **doesn't actually work.** This is my face reading the code: [img] Not sure what I was thinking with this code, and I'm even more confused why it seems to work. Regardless, I fix up the problems and implement consistent river borders."

**The display-spec data structure — verbatim, from his border DSL.** This is the one place he prints a concrete `[width, color]` stack, and the mechanism is identical to the river outline (widest/darkest first, narrower/lighter on top):

```
   K(width, displaySpecification)
```

```
   K(14,[[4.4, "black"] [2.4, "powderblue"]])
```
> "The code for displaying a knot takes a display representation that is **a list (array) of widths and colors**, and by building these up properly I can **create cords with borders and highlights**"
> — https://heredragonsabound.blogspot.com/2019/06/map-borders-part-14.html

So the working ratio he actually shipped for a bordered blue line: **outer 4.4 px black, inner 2.4 px `powderblue`** → 1.0 px of black border on each side. `powderblue` = `#B0E0E6`.

### 8.3 Line widths that are actually stated, in points

- Hand-drawn demo lines: "a hand-drawn line that **starts with a 3 point width and narrows to 1.5 points** width at the end", and "a hand-drawn line that **varies between 1.5 and 3 points** in width"; random walk step "**increase or decrease by a quarter point at random intervals**." — https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html
- Width quantization for the legacy renderer: **¼ point**. — *ibid.* and https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html
- Celtic-knot border minimums: "**This is 22.5 pixels across**... The normal and round styles need a little more room to look good, **about 28 pixels**." — https://heredragonsabound.blogspot.com/2019/06/map-borders-part-14.html
- Land texture opacity (Knurden): "I also set the **opacity of the lines to roughly 50%**." — https://heredragonsabound.blogspot.com/2020/12/knurden-style-basic-map-part-3.html

### 8.4 Coastline / lake-shore multi-line "hachuring" — the pen-stack recipe

This is his answer to concentric shoreline banding, and it applies to any water body:

> "The key idea is to **repeatedly draw the coastline with different size "pens" (some very big!) and different colors, and overlap them** to create this effect... Here **the coastline is drawn first in the darkest and biggest pen, then the next lightest and next smallest pen, and so on. Slightly smaller and darker pens are interspersed to create the dark borders for each region. It culminates in a narrow white line. Half of this is then hidden underneath the rendering of the land.**"
> **"Inside the program, I have an array of lines to draw -- for each line I have the width of the line, the color of the line, and how much to relax the path."**
> — https://heredragonsabound.blogspot.com/2017/06/decorating-ocean-part-two.html

So the data structure is `[[width, color, relax], ...]`, drawn widest→narrowest. Additional rules from that post:
- Do **not** attempt polygon dilation: "expanding (or contracting) a polygon is a decidedly non-trivial problem... There's also the nasty problem of intersecting polygons, as with islands near the shore."
- **Smooth the big pens:** "when you move a large circular pen along a path you tend to get a lot of regular circles. That shows up on the map as smooth circular bumps... To address this, **I apply some smoothing to the bigger pens. I have to be careful to keep the smoothing consistent between the main pen and the outline pen, and not to smooth near the coast** (which would cause problems)."
- Variant A (banded water): vary luminosity between bands.
- Variant B (fading lines on flat water): "**all the fat regions are given the color of the sea, and the thin regions are given progressively darker colors as they approach the shore.** So we can draw it exactly as we did the original embellishment, just using a different sequence of colors."
- Variant C (full-ocean texture): "the mapmaker has repeated the coast lines until the entire sea was filled... **To do this in Dragons Abound I just need to add lots of lines.** This looks subtly better if I **vary the distance between the lines slightly**."
- Limitation: "if the sea has any kind of variable coloration (such as mottling) this will not be reproduced within the embellishment... **it's best to use this style of embellishment on a map with a flat sea color.**"
- Tolkien style = "two black wave lines"; Torfani style = "**A single, thick, light-colored line off the coast**" (https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html, https://heredragonsabound.blogspot.com/2017/10/recreating-style.html)

### 8.5 River shadow / anti-shadow (cheap 3D without a heightmap render)

> "**I could draw a dark line under the river and then blur it to create a shadow along the river**... a fairly easy improvement is to **offset the shadow in the direction of the sun, and offset an "anti-shadow" away from the sun**, so that the rivers get a bright and dark side, as with the real shading. This works very well when the map has forest masses, since the shadows from the forest mass reinforce the shadows on the river banks."
> — https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html

### 8.6 Named style presets

- **Tolkien/LOTR:** solid **black** rivers, cream background, black borders, red labels, two black ocean wave lines, no 3D shading. Mouth mask must be **off**. — https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html
- **Skies of Fire:** "their style (**black lines with water color in-between**) matches the default river style for my maps." — https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html

---

## 9. Z-ORDER (this bit people get wrong)

Ordering constraints, stated as an impossible-ordering problem solved with layers:

> "I want the mountains after the rivers and borders, and the forests before the rivers and borders, but I also need the mountains after the forests... That doesn't work: I can't draw the mountain first *and* last. **The solution in this sort of situation is to draw the mountain on a different layer.** Then I can draw the mountains first, but put its layer on top of the rest of the land so that it is displayed last."
> — https://heredragonsabound.blogspot.com/2017/04/take-me-to-rivers.html

And, from the mouth work: river drawn long → **ocean over river** → **land outline over both** → land outline masked where the river crosses. Forests are pulled back from rivers by a fixed distance ("instead of staying a certain distance away from the sea, I stay a certain distance away from river locations"), with the caveat that after 2020 the setback must use **river paths, not flux**.

---

## 10. GAPS — things the blog never gives you

1. **The numeric value of `C`** in `width = flux/(slope + C)`. Never published. `getRivers` threshold `0.01` is O'Leary's, not confirmed for DA.
2. **Any hex color for water.** The HSL hue range 0.50–0.60 is the only concrete color spec in the entire blog.
3. **Exact river stroke widths in points/px.** Only the ¼-point quantum, the 1.5–3pt demo lines, and the 4.4/2.4 `powderblue` border-stack analogue.
4. **The curvature clamp range** for meanders ("forced to a limited range" — no numbers).
5. **Meander step magnitude** ("a fairly small step at each iteration" — no number). Only the 75/25 mix and 10 iterations are numeric.
6. **Buffer distance** for the river proximity guardrail.
7. **Visvalingam removal percentage used for rivers in production** — 70% is shown as an illustration; 85% is for label paths.
8. **Lake shape generation** — never described beyond "stickers... placed randomly."
9. There is **no Chaikin, no curveBasis, no tension value** anywhere in the river pipeline. The only curve is `d3.curveCatmullRom.alpha(1.0)`; `d3.curveCardinal.tension(...)` appears only as a suggested exercise in the compass series (https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-10-triangles.html).

---

### Source index (all fetched)

Blog: [Welcome](https://heredragonsabound.blogspot.com/2016/10/welcome.html) · [Is it Windy in Here?](https://heredragonsabound.blogspot.com/2016/10/is-it-windy-in-here.html) · [This Is Where I Draw the Line](https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html) · [More Scribbles](https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html) · [Saving For a Rainy Day](https://heredragonsabound.blogspot.com/2017/03/saving-for-rainy-day.html) · [Take Me To The River(s)](https://heredragonsabound.blogspot.com/2017/04/take-me-to-rivers.html) · [Various Miscellany Part 1](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html) · [Various Miscellany Part 2](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html) · [Path Labels Part Three](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html) · [Decorating the Ocean Part One](https://heredragonsabound.blogspot.com/2017/07/decorating-ocean-part-one.html) · [Decorating the Ocean Part Two](https://heredragonsabound.blogspot.com/2017/06/decorating-ocean-part-two.html) · [A Different Way to Draw a Line](https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html) · [City Symbols Part 6](https://heredragonsabound.blogspot.com/2017/10/city-symbols-part-6-fixing-some-problems.html) · [Recreating a Style](https://heredragonsabound.blogspot.com/2017/10/recreating-style.html) · [Swamps](https://heredragonsabound.blogspot.com/2018/10/swamps.html) · [Lord of the Rings Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) · [Sprucing up the Rivers](https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html) · [Hand-drawn Lines Revisited](https://heredragonsabound.blogspot.com/2018/12/hand-drawn-lines-revisited.html) · [Voronoi Revisited Part 1](https://heredragonsabound.blogspot.com/2018/12/voronoi-revisited-part-1.html) · [Various Miscellany Part 4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html) · [Map Borders Part 14](https://heredragonsabound.blogspot.com/2019/06/map-borders-part-14.html) · [Azgaar's Fantasy Map Generator](https://heredragonsabound.blogspot.com/2019/08/azgarrs-fantasy-map-generator.html) · [Learning from Azgaar](https://heredragonsabound.blogspot.com/2019/10/learning-from-azgaar-terrain-generation.html) · [A Meandering Subject](https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html) · [Delta Drawn Part 1](https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html) · [Delta Drawn Part 2](https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html) · [Knurden Style Basic Map Part 3](https://heredragonsabound.blogspot.com/2020/12/knurden-style-basic-map-part-3.html) · [Map Compasses Part 10](https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-10-triangles.html)

External: [srt19170 line gist](https://gist.github.com/srt19170/06a032e541cb4208a3e47a64f7b4687c) · [mewo2/terrain terrain.js](https://github.com/mewo2/terrain/blob/master/terrain.js) · [polyline-normals](https://www.npmjs.com/package/polyline-normals) · [polyline-miter-util](https://github.com/mattdesl/polyline-miter-util) · [Robert Hodgin, Meander](http://roberthodgin.com/project/meander) · [Menger curvature SO answer](https://stackoverflow.com/a/41144762/318847) · [Murrell, vwline Method 1](https://www.stat.auckland.ac.nz/~paul/Reports/VWline/vwline-intro/power-curve.html) · [Bostock, gradient along path](https://bl.ocks.org/mbostock/4163057)

agentId: abd5755779149e624 (use SendMessage with to: 'abd5755779149e624', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 215751
tool_uses: 89
duration_ms: 823994</usage>

---

<!-- fuente: dragons-abound-overall.md -->

## Dragons Abound (Here Dragons Abound, Scott Turner) — Raw Technical Recipe

**Corpus coverage:** the full blog was enumerated via `sitemap.xml` + the Blogger JSON feed (`/feeds/posts/summary?max-results=500&alt=json`) — **201 posts, 2016‑10‑06 → 2022‑06‑11**, ending at "Cleanup Time". ~150 pages fetched across 4 parallel research passes plus 13 direct verification fetches by me on the load-bearing claims (river width formula, polygon-outline line rendering, mountain overlap %, meander mix, `mtn*` parameters, elliptical label arcs, Poisson trees, lakes, tree bumps, annealing energy function, forest edges, tree shading). All quotes below were confirmed against the live pages.

**Critical framing:** Dragons Abound is **closed source**. A blog-wide grep for `#RRGGBB` returns essentially nothing — **there are no published hex colors** for terrain, trees, mountains, water, or labels. Colors are generated at runtime in **HSL** from a per-map palette. Where verbatim code exists it is either (a) Turner's own gist, (b) **Martin O'Leary's `terrain.js`, which DA is a direct fork of** ("I accepted Martin's invitation to grab the code" — [Welcome](https://heredragonsabound.blogspot.com/2016/10/welcome.html)), or (c) an npm/GitHub package he names as the thing he actually dropped in. Provenance is marked on every block.

Codebase scale for effort calibration ([Various Miscellany P2, 2017‑11](https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html)): `Source lines of code: 36271 / Dead/removed: 6559 / Number of configuration parameters: ~1700`.

---

# 1. FORESTS / TREES

## 1.1 The universal primitive: the "bump" (fluffy-cloud edge)

One routine builds forest-mass outlines, deciduous tree clumps, and interior texture. From [Back In the Woods P2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html): *"In fact I can reuse the same routine I use for the forest masses. **It takes a polyline (a series of line segments) and replaces each segment with an arc.**"*

Credited source is [Erkaman/cloud_gen](https://github.com/Erkaman/cloud_gen) ([On (Erkaman's) Cloud 9](https://heredragonsabound.blogspot.com/2017/03/on-erkamans-cloud-9.html)). **The exact control-point math (verbatim, `cloud_gen/main.cpp`) — this is the bump algorithm:**

```cpp
// every edge in the ellipse is used to create a cubic bezier curve.
// we create a hump-shaped cubic bezier curve.
vec2 dir = vec2::normalize(v - prev);          // edge direction.
vec2 n = vec2::normalize(vec2(dir.y, -dir.x)); // edge normal.
float RAD = randFloat(MIN_HUMP_RAD, MAX_HUMP_RAD);  // hump radius.
// if we place the control points along the edge normal, we get a hump shape.
vec2 cp0 = prev + RAD * n;
vec2 cp1 = v +    RAD * n;
float UA = -HUMP_RAND;
float UB = +HUMP_RAND;
cp0.x += randFloat(UA, UB);
cp0.y += randFloat(UA, UB);
cp1.x += randFloat(UA, UB);
cp1.x += randFloat(UA, UB);   // <-- upstream bug: cp1.y never jittered
```

Upstream's tuned call — **N humps = 6–8, hump radius ≈ 0.35–0.6 × ellipse RX**:
```cpp
genCloud(int(randFloat(6,9)),                                   // humps
         randFloat(75.0f,130.0f), randFloat(50.0f,65.0f),       // ellipse w, h
         randFloat(29.0f,39.0f), randFloat(40.0f,48.0f),        // hump radius min,max
         randFloat(17.0f, 27.0f));                              // hump rand
```

**Turner's two divergences:**
1. He **re-flattens the Bézier back to line segments** — *"I'm going to want to connect a series of these into a single polygon, and I can't easily do that with Bézier curves"*. Flattening is done by measuring the drawn path: *"I can use the browser's built-in capabilities to draw the curve, and then measure along it to chop it up into segments"* ([The Outline of a Solution](https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html)) — i.e. `getTotalLength()`/`getPointAtLength()`. **20 pieces ≈ indistinguishable from the curve; 8 pieces = visibly faceted.**
2. **Duplicate-point rule:** *"we have to throw out the last point in each curve so that it doesn't duplicate the first point in the next curve. **Bad things happen when you have duplicated points and try to draw an SVG curve through those points!**"*

**Winding must encode which side the forest is on** ([Various Miscellany P2, 2017‑11](https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html)): *"I construct the path so that it runs clockwise. **But that doesn't tell me which side of the path the forest is on**, so the bumps sometimes go the wrong way… construct the path so that **the forest is always on the left (or right) side**."* Verbatim JS:
```javascript
function isLeft(a, b, c) {
     return ((b.X - a.X)*(c.Y - a.Y) > (b.Y - a.Y)*(c.X - a.X));
};
```

## 1.2 Deciduous tree — exact build order

[Part 2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html) (verified verbatim):
1. Circle from line segments — *"I'm using a function that makes a circle out of line segments. But… this routine doesn't close off the circle"* → close it.
2. *"I don't want every tree to be a perfectly circular blob, so I'll introduce some random distortion into the circle, by **adding random offsets in both x and y to every point in the circle**."*
3. Apply the bump routine. *"I might want my individual trees to be more 'fluffy' than the forest masses"* → **trees use a larger hump radius than forest masses.**
4. *"If I add some random variation in the number of bumps and the size of the trees I can generate a pleasing variety."*

**Multi-clump** ([Part 3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html)): *"To start with, I'll just generate a tree as overlapping smaller tree shapes"* → *"the circles need to be smaller and more offset from each other"* → *"I can try adding a **minimum offset**"* → *"They're **never bigger on the top than the bottom, or diagonal**… **I'm basically stacking the clumps up in a rough pyramid.** The logic for this isn't very good, and probably wouldn't work for more than 3 clumps. But I suspect that **3 clumps** will be more than enough."* Render as **union outline**, keeping clump outlines faint: *"It looks more like a tree if I just draw the outline… I've drawn in the clump outlines **faintly**… to give a faint indication of shading."* Cost warning: *"**Taking the union of two polygons (which I have to do twice on each 3 clump tree to get the outline) is expensive.**"*

**Trunk** ([Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html)) — the only hard geometric numbers for trees:
> *"a dark line coming downward out of the tree shape, **usually about 20‑25% the height of the tree shape**, and **somewhat bigger at the bottom than at where it joins the tree**."*
> *"I construct a trunk as a polygon that gets **broader at the base to represent the roots**… I draw the trunk **from the center of the tree and somewhat longer than the radius of the tree**. **By drawing the trunk first, the clumps will conceal the upper part of the trunk.**"*

## 1.3 Conifer ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html))

Model: *"Each branch is essentially **three points connected by two arcs**."* Build order, verbatim:
1. **Triangle**, *"using a little bit of variance in the width of the triangle."*
2. Subdivide sides into branch bases that must grow downward: *"I need to use smaller pieces near the top… break the sides up into **increasingly larger pieces from top to bottom**."*
3. Per-segment jitter left/right.
4. **Branch projection:** *"the branches are something like **2‑3 times as long as they are wide**, so I'll project a point out from the two base points about that distance and insert it between the two base points"* — then corrected: *"My estimate of branch length looks wrong… Let me **reduce the branch length**."*
5. Scale vs deciduous: conifers made *"at least as tall as the same deciduous tree"* and *"**broader** as well."*
6. Curve the branches.
7. **Scalloped bottom**, not a semicircular skirt: *"I want a **scalloped edge like a row of branches**… Especially to get a **whole number of branches across the bottom**, and to make the **switch from pointing left to pointing right across the bottom**."*
8. **Reuse the scallop routine between branch pairs** for interior texture. Accepted artifact: a *"little chevron"* on the topmost branches.
9. *"I added some random offsets to the tree, so it sometimes 'leans' left or right."*

**Apex line-join fix (non-obvious):** *"the width of the line gets drawn to the left on the left side of the tree and to the right on the right side, so the lines only touch at the inside corner… **it is easier to fix by moving the start and end of the outline to a different point on the tree where the lines aren't parallel**."*

Conifer color: *"their own color range on the **blue end of the green spectrum**."* Split rule: conifers where **altitude + temperature** dictate — *"trees in the mountains or in cold areas of the map will be conifers"* — with a wanted-but-noted-missing *"transition zone with some mix of trees."*

## 1.4 Egg / oval tree (Tolkien & Knurden)

[LotR Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html): *"it's a matter of **smoothly lengthening one of the axes as you go around the circle**… since I want the upper part of the circle to be the longer end, I have to **lengthen the y axis when y is less than zero**."* Cited source formulas (ellipse `x²/9 + y²/4 = 1` → `x²/9 + y²/4·t(x) = 1`):
```
t₁(x) = 1 + 0.2x        t₂(x) = 1/(1 - 0.2x)        t₃(x) = exp(0.2x)
Hügelschäffer:  x²/a² + y²/b²[1 + (2dx+d²)/a²] = 1
```
For Tolkien: *"Dragons Abound makes clumpy tree shapes by overlapping several circles with scalloped edges. **I can turn off the edges, and only use one circle**."*

Knurden trees ([Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html)): *"**rough oval shapes with a highlight and a shadow. There's no trunk but there is a cast shadow.**… **The red dot at the bottom of the tree is the anchor reference point.**"*

## 1.5 PLACEMENT — Poisson disc, Bridson's algorithm

Superseded v1 (one tree per Voronoi cell): *"**The tightest packing Dragons Abound can do is to put a tree symbol in every triangle** and this will leave some gaps and some crowded areas… **Particularly along the edges it is important to have a tight packing**"* ([LotR](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html)).

Current: *"**Poisson-disc sampling**, and discusses an efficient algorithm… called **Bridson's algorithm**… I'll grab an implementation of Bridson's algorithm from [beaugunderson/poisson-disc-sampler] and use it to sample a rectangle."* **This is his actual sampler, verbatim** — note **`k = 30`**, candidate annulus **`[radius, 2*radius]`**, **`cellSize = radius * Math.SQRT1_2`**:

```javascript
module.exports = function poissonDiscSampler(width, height, radius, rng) {
  var k = 30; // maximum number of samples before rejection
  var radius2 = radius * radius;
  var R = 3 * radius2;
  var cellSize = radius * Math.SQRT1_2;
  var gridWidth = Math.ceil(width / cellSize);
  var gridHeight = Math.ceil(height / cellSize);
  var grid = new Array(gridWidth * gridHeight);
  var queue = [], queueSize = 0, sampleSize = 0;
  rng = rng || Math.random;

  function far(x, y) {
    var i = x / cellSize | 0, j = y / cellSize | 0;
    var i0 = Math.max(i - 2, 0), j0 = Math.max(j - 2, 0);
    var i1 = Math.min(i + 3, gridWidth), j1 = Math.min(j + 3, gridHeight);
    for (j = j0; j < j1; ++j) {
      var o = j * gridWidth;
      for (i = i0; i < i1; ++i) {
        var s;
        if ((s = grid[o + i])) {
          var dx = s[0] - x, dy = s[1] - y;
          if (dx * dx + dy * dy < radius2) return false;
        }
      }
    }
    return true;
  }
  function sample(x, y) {
    var s = [x, y];
    queue.push(s);
    grid[gridWidth * (y / cellSize | 0) + (x / cellSize | 0)] = s;
    sampleSize++; queueSize++;
    return s;
  }
  return function () {
    if (!sampleSize) return sample(rng() * width, rng() * height);
    while (queueSize) {
      var i = rng() * queueSize | 0;
      var s = queue[i];
      // Make a new candidate between [radius, 2 * radius] from the existing sample.
      for (var j = 0; j < k; ++j) {
        var a = 2 * Math.PI * rng();
        var r = Math.sqrt(rng() * R + radius2);
        var x = s[0] + r * Math.cos(a);
        var y = s[1] + r * Math.sin(a);
        if (x >= 0 && x < width && y >= 0 && y < height && far(x, y)) return sample(x, y);
      }
      queue[i] = queue[--queueSize];
      queue.length = queueSize;
    }
  };
};
```

**Polygon adaptation, three stages, verbatim (LotR post):**
> *"One way to adapt the algorithm to a polygon is to **run the algorithm on the bounding box for the polygon and ignore samples that fall outside the polygon**. This will be somewhat inefficient (in the ratio of the area of the polygon to the area of the bounding box)."*
> *"To make this more efficient, I can **embed a test within the algorithm so that it doesn't explore any point outside the polygon**. As long as I then **start the sampling within the polygon (which I can do by picking one of the vertices as the starting sample)**… the algorithm will only explore points within the polygon or one sample outside."*
> *"I need my Poisson disc sampling function to **take a list of holes** in the polygon and treat those areas the same as the outside of the polygon. This is essentially just a **one-line change**."*

Hole detection: *"**if any point on a candidate polygon is inside the original polygon, then the whole candidate polygon is inside as well, so I can just check one point**."*

**The Poisson radius is never published — it's tuned by eye.** *"A little tweaking is required to find a spacing that provides a similar visual feeling"* (LotR); *"It takes a few tries to get a good sampling distance"* ([Haunted Forests](https://heredragonsabound.blogspot.com/2021/10/haunted-forests.html)). Relative rule ([Part 4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html)): *"**For individual trees with trunks, the icons are usually spaced out more widely.**"*

**Perturbed grid was explicitly abandoned** ([Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html)): *"the bump texture inside the forest masses is getting placed using **a sort of perturbed grid**… **The bumps tend to line up in rough columns**… Since then I've realized that **a Poisson disc sampling is a better approach**."*

**Interior texture bumps (pre-Poisson rejection sampling)** ([Part 5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html)): *"**Simulated annealing is a feasible approach, but I'm not going to implement simulated annealing just to draw tree bumps!** Instead… I'll **randomly select the start and end points for a bump within the tree polygon until I find points whose bounding box corners lie within the polygon.** Then I'll check to see if **the corners of the bounding box are within some minimum distance of another bump.** If they are, I'll throw out the new bump and try again."* Count: **5–10 bumps inside a tree shape.**

**Edge inset** ([Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html)): uses [polygon-offset (Milevski)](https://github.com/w8r/polygon-offset). *"**In no wise should you consider writing this code yourself.**"* Critical trick: *"Many of the failure modes have to do with **sharp vertices close together — like the bumps on the forest masses**. So rather than shrink those outlines… **I'll shrink the 'unbumped' original forest outlines**… it is helpful to **catch exceptions and route around the damage**."*

**Exclusion constraints:** rivers — *"I have to stay away the radius of the tree icons (or even more)"* (P4); coast — *"I **treat forest locations near the coast as a different biome**, which effectively draws the edge of the forest in some distance from the coastline"* (verified, [Forest Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html)); mountains — *"**check against the mountain symbols themselves and drop any forest locations that intersect with one of the mountain symbols**"* using bboxes *"with a good deal of margin added"*; cities — *"carve a circle of forest away around every city, with **larger cities using more forest than smaller ones**… I'll **perturb the removed area with noise**"* ([Sprucing Up the Forest](https://heredragonsabound.blogspot.com/2017/03/sprucing-up-forest.html)).

## 1.6 SIZE VARIATION — what he does NOT do

**Tree size does not vary with elevation, moisture, or distance from forest edge.** It is purely random per-tree, and constant size is the *default*: *"**The code is currently set up to use a consistent tree size, but that's easy to change.**"* ([D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html)). Density-by-elevation exists only for mountains. Forest presence itself is a **binary Whittaker-diagram biome lookup** on (temperature, precipitation), heavily smoothed: *"Without smoothing, the biomes are very spotty… it doesn't make for a very good fantasy map, which needs great forests, endless steppes"* ([Saving For a Rainy Day](https://heredragonsabound.blogspot.com/2017/03/saving-for-rainy-day.html)).

## 1.7 OVERLAP / SORTING — the painter's rule

**The single key statement** ([Part 7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html)):
> *"generally speaking **when an element (like the conifer) is further down on the map, it should be on top of elements that are higher up on the map**. But since generation of mountains is separate than generation of the trees, it's hard to get this ordering correct… To fix this, I have to **make a list of all the trees and mountains together, sort them by the position of the lowest point on the element, and then go through the list in that order 'popping' each element to the top**."*

Sort key = **the lowest point of the symbol, not its anchor/center**; mechanism is a **DOM re-append pass**, not a pre-sorted emit.

Within-symbol order: trunk before clumps; cast shadow before tree; **outline last, on top of the highlight** (*"The highlight is broader than the shadow… so it sometimes obscures the outline… I can draw the outline last"* — [Knurden Mountains P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html)).

**No halos around trees.** Halos exist for labels only — *"**Haloes aren't really feasible to hand-draw**, so I've turned them off in this map style"* ([D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html)).

## 1.8 Canopy blob vs individual trees; boundary generation

**Boundary pipeline** ([One of the (Forest) Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html), verified): condition-edge extraction → chain into closed paths → smooth/simplify → enforce winding → bump → fill.
> *"**If a location is a forest, and a neighboring location is not, then the edge between those two locations should be part of the forest edge.** Identifying those edges is not too difficult, but **chaining all the edges together to create continuous paths is a bit more challenging — particularly because you cannot count on finding the edges in any particular order.**"*
> *"it's useful to have a **generalized function that takes a condition and returns all the edges where that condition changes**"* (the coast is the same function on `height > 0`).
> *"One **smooths out the path, eliminating most small sharp deviations**. This will probably fix most of the **loops** in the edges."*

Pathological case named: *"look at the little **bowtie**… getting that right is not trivial."*

**Point-in-polygon perf lesson worth copying:** *"having the polygon represented as an SVG path is another big complication… **Unfortunately, this is really slow.** It occurs to me that at one point during the creation of the forest edge **I actually do have the edge as a list of points**… Now I just have to tell if the point is inside a **polygon with straight edges**… **much faster**."*

Interior: mottle by drawing each underlying location in a slightly different color, clip to the forest outline, add back the base fill, **blur**. Edge darkening: *"draw around the edge of the forest with a **fat line a little darker than the fill color, clipping to the forest**… include that in the blur."* Cast shadow: *"I draw the forest mass in **partially-transparent black and offset it a bit**. The shadow is drawn first so that the forest mass covers all but the edge of the shadow."*

**Knurden hybrid (blob + tree ring) — the elegant trick** ([Forests P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html)):
> *"My breakthrough realization was that **the trees on the back edges of the forest are a lot like the partial trees in the middle of the forest**. I could draw in the solid color, and then draw **'half trees' along the back edges**, and then **full trees along the front edges**."*
> **Back-edge detection:** *"Imagine that you're walking around the polygon **clockwise**… whenever you're **walking to the right, you're on the back edge**… So I can walk around the polygon clockwise, **dropping half trees whenever I find myself going to the right**."*
> **Two must-implement corrections:** *"this will drop the trees in the **wrong drawing order**… **after creating the trees you have to reorder them from back to front before drawing them**."* And: *"the midpoints of those trees are on the polygon. So I need to do the same thing with the full trees… **shift them down some so that their midpoints are on the polygon as well. Otherwise the front trees will look taller than the back trees.**"*

Edge-tree spacing uses polygon interpolation, **not** a bounding box. Verbatim DA JS:
```javascript
// Divides a line segment into step-sized chunks
function divideLineSegment(p1, p2, step) {
    // How many steps in this line?
    const n = Math.round(Utils.distance(p1, p2)/step);
    const dx = (p2[0]-p1[0])/n;
    const dy = (p2[1]-p1[1])/n;
    const npl = [p1];
    // We do this n-1 times so that we can use p2 as
    // the last point just to be sure it doesn't move
    // because of a rounding error.
    for(let i=1;i<n;i++) {
	npl.push([p1[0]+dx*i, p1[1]+dy*i]);
    };
    npl.push(p2);
    return npl;
};
```
*"**In the worst case, the actual interval will be +/- 50% of the desired interval**, but it will usually much closer."* Residual gaps are a feature: *"**happily the effect is actually better with occasional small gaps**."*

## 1.9 Tree shading / filters — exact techniques

**Deciduous — offset radial gradient, with the radius gotcha** ([Part 6](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-6-shading.html), verified):
> *"I'll use a **radial gradient that is light in the center and dark at the edge, but I'll offset it upwards and to the right**."*
> *"I'm **applying this gradient individually to each of the clumps**."*
> *"**By default, the SVG radial gradient has the same radius as the size of the object it is applied to.** (How that size is calculated is something of a mystery!) Since I've **shifted the center of the gradient up and to the left, I need to stretch out the radius so it can still reach the far edge of the clump.**"*

**Conifer — tilted linear gradient:** *"as with peaked roofs, **SVG doesn't offer the correct gradient for shading a cone**. I have to make due with a **tilted linear gradient**."*

**Leaf texture:** modified Inkscape "film grain" `feTurbulence`. *"**SVG filters are size-invariant**, so the texture doesn't look right on the big example… **Because the texture is based on noise rather than random, the eye sees little clusters and texture in the trees.**"*
**Needle texture:** *"I can get that by **changing the frequency in just the X dimension to stretch out the noise up and down**"* → `<feTurbulence baseFrequency="fx fy">` with `fx ≪ fy`. Limitation: *"**SVG doesn't seem to have a way to rotate a filter**."*

**Cast shadow:** *"for a round tree the shadow is an **ellipse cast opposite the direction of the sun**. Since the sun is **up high and to the right**… the shadow will be **below and to the left**… I'll create an ellipse with the **right end near the trunk**."* + *"I'm allowing a **range of starting points for the ellipse as well as the length**. **During map generation, I'll pick one set of values and use them consistently for all the trees.**"* + *"**To make the shadows visible on the map, I had to make them almost completely opaque.** As a result… it might be better to use a **dark version of the land color**."*

**Knurden blur-leak gotcha (real, non-obvious)** ([Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html)): *"**Problem! The blur smears outside of the tree.**… **The fix is to use the tree outline as a clipping area.**… The drawback is that we have to **create a clipping path for every individual tree on the map**."* And: *"(Aside: You might think this could be handled by drawing all the trees into a layer and then applying a single mask to the whole layer. **This would fail when two trees overlapped each other.**)"* Cast shadow: *"a gray ellipse at the base… **shift it down and in the opposite direction of the light**… I've made the shadow color **50% opacity**."*

**Haunted / skeletal tree** ([Haunted Forests](https://heredragonsabound.blogspot.com/2021/10/haunted-forests.html)): *"an L system seems like overkill. So I'll just roll my own."* Trunk = tapered line; *"I want the jitter to **go back and forth**… and I want the perturbations to be **pretty sharp, not smoothed out**… So I had to create a **new perturbation function that alternated the direction**."* Branches: *"I'll **alternate sides** on the tree and make the branches **shorter as they get near the top**… **pick a point on the tree, draw a line straight up, and then rotate it either left or right**."* Fog fade = **mask filled with a linear gradient white→black**, *"adjusted the mask so that the tree doesn't completely fade away."*

## 1.10 Forest numbers & colors (complete list)

| Value | Source |
|---|---|
| Trunk length **20–25% of tree height**, drawn from tree center, longer than tree radius | [P4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html) |
| Conifer branch length **2–3× branch width** (later reduced) | [P7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html) |
| **5–10** texture bumps per tree | [P5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html) |
| Max **3** clumps per deciduous tree | [P3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html) |
| Shadow color **15–20% darker than background** | [Knurden Mtn P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html) |
| Cast shadow **50% opacity** | [Knurden Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html) |
| Poisson `k=30`, annulus `[r,2r]`, `cellSize = r·√½` | beaugunderson sampler |
| Bézier→polyline: **20** segs smooth, **8** faceted | [Outline of a Solution](https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html) |
| Global color params (only literals published) | `colorsSatRange: [.50,.70]`, `colorsUseGrayScale: 0.10`, `colorsUseDesaturation: 0.20` — [Parameter Management](https://heredragonsabound.blogspot.com/2018/04/parameter-management.html) |

**No tree hex codes exist in the blog.** Sampled from his own rendered images (median-cut, ≥1% coverage) — the Knurden 5-stop ramp is directly usable and matches his stated 15–20% rule (`#737e56` is ~17% darker than `#8b986c`):
```
#d1d9bb  highlight      #a8b489  light mid    #8b986c  base fill
#737e56  shadow         #5a6346  deep shadow  #424834  deepest
#161713 / #030303  outline stroke
Knurden in situ:  land #8fa35e   forest blob #3f482b   patches #94a771 / #899d6f
Conifers:  #576a4b body   #1e341a dark   #0d1c11 deepest   #2f2215 trunk brown
```

---

# 2. RIVERS

## 2.1 Path generation (O'Leary `terrain.js` core, forked)

Grid: *"**Typically I use a value of 16K (16384) for npts**, which roughly means that each location in the grid corresponds to about a 70 square pixels"* ([Voronoi Revisited P1](https://heredragonsabound.blogspot.com/2018/12/voronoi-revisited-part-1.html)). Two-resolution scheme: *"**once the land has been defined, Dragons Abound saves the detailed coastlines and reduces the size of the grid.**"* ([Delta Drawn P1](https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html)).

**Sink filling is Planchon-Darboux, NOT priority-flood** — explicitly ([Learning from Azgaar](https://heredragonsabound.blogspot.com/2019/10/learning-from-azgaar-terrain-generation.html)): *"**The sink filling algorithm Dragons Abound uses is called the Planchon-Darboux algorithm.**"* And sinks are *filled*, not converted to lakes.

**Verbatim ancestor code** ([mewo2/terrain `terrain.js`](https://github.com/mewo2/terrain/blob/master/terrain.js)) — `epsilon = 1e-5`, `infinity = 999999`:
```js
function fillSinks(h, epsilon) {
    epsilon = epsilon || 1e-5;
    var infinity = 999999;
    var newh = zero(h.mesh);
    for (var i = 0; i < h.length; i++) {
        if (isnearedge(h.mesh, i)) { newh[i] = h[i]; } else { newh[i] = infinity; }
    }
    while (true) {
        var changed = false;
        for (var i = 0; i < h.length; i++) {
            if (newh[i] == h[i]) continue;
            var nbs = neighbours(h.mesh, i);
            for (var j = 0; j < nbs.length; j++) {
                if (h[i] >= newh[nbs[j]] + epsilon) { newh[i] = h[i]; changed = true; break; }
                var oh = newh[nbs[j]] + epsilon;
                if ((newh[i] > oh) && (oh > h[i])) { newh[i] = oh; changed = true; }
            }
        }
        if (!changed) return newh;
    }
}
```
**Drainage accumulation — each cell seeded `1/n`, processed in descending-height order, pushed to the downhill neighbour. This is the whole flux algorithm:**
```js
function getFlux(h) {
    var dh = downhill(h);
    var idxs = [];
    var flux = zero(h.mesh); 
    for (var i = 0; i < h.length; i++) { idxs[i] = i; flux[i] = 1/h.length; }
    idxs.sort(function (a, b) { return h[b] - h[a]; });
    for (var i = 0; i < h.length; i++) {
        var j = idxs[i];
        if (dh[j] >= 0) { flux[dh[j]] += flux[j]; }
    }
    return flux;
}
```
**River appearance threshold — `limit` scaled by land fraction; the ocean link stops at the MIDPOINT (half-step into the sea):**
```js
function getRivers(h, limit) {
    var dh = downhill(h);
    var flux = getFlux(h);
    var links = [], above = 0;
    for (var i = 0; i < h.length; i++) { if (h[i] > 0) above++; }
    limit *= above / h.length;
    for (var i = 0; i < dh.length; i++) {
        if (isnearedge(h.mesh, i)) continue;
        if (flux[i] > limit && h[i] > 0 && dh[i] >= 0) {
            var up = h.mesh.vxs[i], down = h.mesh.vxs[dh[i]];
            if (h[dh[i]] > 0) { links.push([up, down]); }
            else { links.push([up, [(up[0] + down[0])/2, (up[1] + down[1])/2]]); }
        }
    }
    return mergeSegments(links).map(relaxPath);
}
```
Called with the exact constant: `render.rivers = getRivers(render.h, 0.01);`

Erosion (classic stream-power `sqrt(flux)*slope`, capped 200, river ×1000):
```js
var river = Math.sqrt(flux[i]) * slope[i];
var creep = slope[i] * slope[i];
var total = 1000 * river + creep;
total = total > 200 ? 200 : total;
```

**DA divergences:** valleys are carved (*"I push down the terrain where the river runs"* — [VM P1](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html)); rivers **continue under the ocean** and the ocean test *"look[s] backwards from the end of the river rather than forward from the start"*; rivers are converted to **paths immediately after creation** (2020 refactor, [A Meandering Subject](https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html)).

## 2.2 WIDTH FORMULA — verified verbatim

**There is no `sqrt(flux)` in DA's width function.** The published formula (rendered as `Image38.png` on [Various Miscellany P2, 2017‑04](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html), verified by direct fetch):

```
                 flux_loc
width_loc  =  ───────────────
               slope_loc + C
```

> *"The width of the river in a location is then proportional to the flux divided by the slope… **The constant C here adjusts how important the slope is in determining the width of the river — the larger the constant, the less important the slope.** … As C decreases, the upper parts of the river where the slope is higher (and the river flows faster) shrink in width."*

Rationale: *"A faster river carries away more water, so for two rivers with the same flux, the slower river will be wider."* **C is never given a numeric value anywhere in the blog.** (`sqrt(flux)` appears only in O'Leary's *erosion* rate.)

**Minimum width and the point start** ([Sprucing Up the Rivers](https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html)): *"(**Rivers have a minimum width to avoid having rivers that are nearly-invisible thin lines.**) … **I can just set the initial width of the river to zero, so that the river starts with a point** … That works, but looks a little pinched off. Let me try phasing in the river over the first part… **Now the river starts at a point and then gradually increases to the minimum width.**"* Branch exception: *"**add a test to detect when a river is branching off of another river, and then suppress the narrow start**"* ([Delta Drawn P2](https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html)).

**Noise-modulated width (2020):** *"I'll vary the width slightly using a noise source… One minor problem is that **these width variations are always symmetric**."*

## 2.3 TAPERED RENDERING — two eras; implement era 2

**Era 1 (pre‑Oct 2017) — many stroked sub-paths, quantized to ¼ point.** *"SVG doesn't allow you to change the pen size while drawing a path, so this is actually accomplished by breaking the path down into a lot of smaller paths, each of which is drawn separately with a different pen size"* ([A Different Way to Draw a Line](https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html)). *"If you use a fairly small increment of change in width (**around a quarter point** works well for me) the line appears to be smoothly changing"* ([This Is Where I Draw the Line](https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html)). Failure mode: *"That's actually a short line of the proper width — with rounded ends, which is why it looks like a **pill**"* — fixed by *"break[ing] it up into a bunch of smaller segments, **changing the size by a 1/4 point of width in each**"* (verified).

**Era 2 (Oct 2017 →) — polygon outline via centerline offsetting. This is the answer.** ([A Different Way to Draw a Line](https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html), verified):
> *"Inkscape doesn't generally used lines (stroked paths) at all. Instead, **lines are created by using long thin polygons.** … **This approach avoids the problems I have with drawing varying width lines by varying the pen size. There's no need to break the line down into segments to achieve a smooth curve — I can use the SVG curve capabilities to draw each side of the polygon.**"*

Algorithm in his own steps, verbatim:
> *"I will start by **finding the normal to each point along the path**… Then on each normal I will find **the point on either side of the path that is half the width of the line at that point**… The final step is to **draw two smooth curves through the black points, connecting at the beginning and end of the line to create a closed polygon**."*

(Method 1 reference = [Murrell, vwline](https://www.stat.auckland.ac.nz/~paul/Reports/VWline/vwline-intro/power-curve.html): *"A 'left' border is generated by connecting all left ends of the perpendiculars… **A polygon is generated by combining the left border with the reversed right border.**"*)

**The miter bug and the fix — this is the load-bearing gotcha:**
> *"If the gradient is `[dx, dy]` then the normal is `[-dy, dx]`. I always forget the minus part of `-dy`."*
> *"**my simple-minded scheme doesn't work, because the angle of the normal changes the effective width of the line. It's necessary to adjust the width of the line based upon the angle of the miter.** While working on this problem I discovered **polyline-normals**, a Javascript package by **Matt DesLauriers** that calculates both the normals and the necessary adjustment."*

Verbatim miter math from that dependency (`polyline-miter-util`) — `halfThick / dot(miter, normalOfLineA)` is the correction:
```js
module.exports.computeMiter = function computeMiter(tangent, miter, lineA, lineB, halfThick) {
    add(tangent, lineA, lineB)         //get tangent line
    normalize(tangent, tangent)
    set(miter, -tangent[1], tangent[0])  //get miter as a unit vector
    set(tmp, -lineA[1], lineA[0])
    return halfThick / dot(miter, tmp)   //get the necessary length of our miter
}
module.exports.normal = function normal(out, dir) { set(out, -dir[1], dir[0]); return out }
```
`polyline-normals` returns `[[[nx,ny], miterLength], ...]`; offset each point by `± halfWidth[i] * miterLength[i] * [nx,ny]`.

**Accept this residual artifact:** *"the width is only specified at certain spots on the curve, and the interpolation in-between those spots varies for the top and the bottom curves of the line. For mathematical reasons, it's very difficult to make the two curves match exactly, so this problem is somewhat inherent in this approach."*

**End caps.** Butt by default; the closed path must be **stitched from four separately-generated sub-paths** because D3 can't switch curve types mid-path: *"D3… doesn't seem to have a way to switch curves in the middle of a path without sticking in an extraneous M(ove) command… So **I have to generate the paths for the two sides of the line and the two ends separately and then stitch them together manually.**"* ([City Symbols P6](https://heredragonsabound.blogspot.com/2017/10/city-symbols-part-6-fixing-some-problems.html)). Round caps (2019, verified): *"**Now I'll add an additional point at each end of the line that sticks out the width of the line.**… **I already have a routine that takes arbitrary points and makes a quadratic arc between them. It isn't really a semi-circle but at the typical line scale it's probably close enough.**"* Correct construction: *"**I have to back off the endpoint of the line by the radius of the semicircle and then connect it with a semicircle.**"*

**Rivers only switched to this renderer in Oct 2018 — a year late** ([Sprucing Up the Rivers](https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html)): *"I realized recently that **I'm still drawing rivers using SVG lines**… the transitions are smoother and more natural in the new version. This is most noticeable in places like the fork."*

**Everything is a polyline now (25% perf win)** ([VM P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html)): *"the single most costly function was 'getPointAtLength'… **When I draw a Bezier curve myself, it's just a sequence of short line segments. So everything I draw is actually just a polyline**… **saved about 25% overall on the code execution time (!)**."*

## 2.4 Smoothing / interpolation — verbatim from Turner's own gist

Source: [gist srt19170/06a032e541cb4208a3e47a64f7b4687c](https://gist.github.com/srt19170/06a032e541cb4208a3e47a64f7b4687c), linked from [This Is Where I Draw the Line](https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html). **The spline is `d3.curveCatmullRom.alpha(1.0)` (chordal). Not curveBasis, not cardinal, no tension. Defaults: `step = 1`, `magnitude = 0.003`, smoothing window `3`.** This is also the exact code used for mountain lines.

```javascript
function drawInterpolate(svg, points, step, curve) {
	curve = curve || d3.curveCatmullRom.alpha(1.0);
	step = step || 1;
	var lineFunc = d3.line().curve(curve)
	    .x(function(d) {return d[0]; }).y(function(d) {return d[1];});
	var path = svg.append('path').attr('d', lineFunc(points))
	    .style("stroke-linecap", "round").style("stroke-width", 1).style("stroke", "black");
	var results = [];
	var len = path.node().getTotalLength();
	for(var cur = 0;cur<len;cur += step) {
	    var pt = path.node().getPointAtLength(cur);
	    results.push([pt.x, pt.y]);
	};
	path.remove();
	return results;
};

function handDrawn(points, magnitude) {
	magnitude = magnitude || 0.003;
	if (points.length < 2) return result;
	var gradients = points.map(function (a, i, d) {
            if (i == 0) return [d[1][0] - d[0][0], d[1][1] - d[0][1]];
            if (i == points.length - 1)
		return [d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]];
            return [0.5 * (d[i + 1][0] - d[i - 1][0]),
                    0.5 * (d[i + 1][1] - d[i - 1][1])];
	});
	gradients = gradients.map(function (d) {
            var len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
	    if (len == 0) return [0, 0];
            return [d[0] / len, d[1] / len];
	});
	var perturbations = smoothLine(points.map(d3.randomNormal()), 3);
	var result = points.slice(1,-1).map(function (d, i) {
            var p = perturbations[i+1], g = gradients[i+1];
            return [d[0] + magnitude * g[1] * p,
                    d[1] - magnitude * g[0] * p];
	});
	result.unshift(points[0]);
	result.push(points[points.length-1]);
	return result;
}

function drawLineHnd(svg, points, width, color, step, magnitude) {
	magnitude = magnitude || 0.003;
	step = step || 1;
	if (points.length < 2) return null;
	var p = drawInterpolate(svg, points, step);
	p = handDrawn(p, magnitude);
	return drawLine(svg, p, width, color);
};
```
Rules: jitter is applied **normal to the gradient**; **start/end points are never jittered** so tributary junctions still meet (*"Occasionally this creates a little 'hook' at the end of a line"*). **Order matters — curve first, then jitter:** *"the best approach is to **draw the original curve, and then interpolate it by measuring along the curve and sampling points. These points can then be jittered**"* ([More Scribbles](https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html), after an email exchange with Mike Bostock). Later he replaced `getPointAtLength` with a **custom `CanvasPathInterface` context** that records `moveTo`/`lineTo`/`bezierCurveTo` and flattens them ([Hand-drawn Lines Revisited](https://heredragonsabound.blogspot.com/2018/12/hand-drawn-lines-revisited.html)).

**Neighbour-averaging smoother (`terrain.js`) — 0.25/0.5/0.25, endpoints pinned:**
```js
function relaxPath(path) {
    var newpath = [path[0]];
    for (var i = 1; i < path.length - 1; i++) {
        var newpt = [0.25 * path[i-1][0] + 0.5 * path[i][0] + 0.25 * path[i+1][0],
                     0.25 * path[i-1][1] + 0.5 * path[i][1] + 0.25 * path[i+1][1]];
        newpath.push(newpt);
    }
    newpath.push(path[path.length - 1]);
    return newpath;
}
```

**Visvalingam simplification — the de-wiggler.** The Voronoi wiggle problem ([A Meandering Subject](https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html)): *"**the rivers are drawn from the center of one Voronoi polygon to the next, and three adjacent centers are almost never collinear, so rivers always have a kind of snaky path.**"* Density is not the fix: *"I quadrupled the number of underlying polygons and increased the runtime by about 10x."* Instead: *"**Visvalingam's algorithm**… **This has the effect of removing the highest frequency 'noise' first.** Here's the river with **70% (!) of the path removed**."* Removal percentages: **50%** ≈ imperceptible; **70%** de-wiggles rivers; **85%** smooth enough for a text label. **CRITICAL:** *"**I have to modify Visvalingam's algorithm so that it doesn't try to remove any point where rivers join.**"*

## 2.5 Meandering — exact recipe

Reference: [Robert Hodgin's *Meander*](http://roberthodgin.com/project/meander). *"**move each point on the river towards the outside of the current curve and also in the direction the river is flowing at that point.**"*

Frame: normals from the polyline; *"**I have to calculate the curvature of the river at each point, and then scale the vector by that curvature.** To calculate the curvature, **I use Menger's Curvature**… It's also a **signed curvature**… **he is limiting the curvature measure — all of the curves below a certain radius have the same length bitangent. This is necessary because the curvature can have a large range**."* Shortcut: *"**to generate the bitangent I generate the tangent and rotate it 90 degrees**."*

Menger curvature (from the SO answer he links, [a/41144762](https://stackoverflow.com/a/41144762/318847)):
```
curvature = 4*triangleArea/(sideLength1*sideLength2*sideLength3)
// signed via:  area2(a,b,c) = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)
```

**THE MIX RATIO — from Turner's own comment reply on that post (2020‑07‑07), verified:**
> *"With a fairly small step at each iteration, I didn't see much difference in the results, other than less bitangent requiring more iterations. **So I settled on 75% bitangent and 25% tangent, and that's what you see in most of the results above.**"*

Also stated: 90/10 bitangent *"exaggerates the curves"*; 90% tangent *"adds only small curves"*; and the geometric shortcut *"**combining the tangent and the bitangent this way is equivalent to just rotating the tangent vector 45 degrees.**"*

**ITERATION LOOP — `10 iterations, with smoothing and re-interpolation between each iteration`:**
> *"**it's an iterative process… If you try to do it all in one shot, you just get a weirdly exaggerated version of the original path.** Second, **this process will change the length of the river. If I want to keep the same uniform distance between points… I'll need to resample the path**… Lastly, **there are some points on the river I have to keep the same — notably the spots where two rivers join each other.**"*

Per iteration: tangents → Menger signed curvature (clamped) → bitangent = normal × clamped curvature → `move = strength * (0.75*bitangent + 0.25*tangent)` → apply with join/mouth mask → smooth (0.25/0.5/0.25) → re-interpolate to uniform spacing → intersection checks. ×10.

**Five guardrails, verbatim:**
1. **Taper mask at mouths/joins:** *"there's an abrupt and obvious transition where meandering kicks in. **The solution is to have a 'mask' that tapers in the meander**."*
2. **Self-intersection → cut the loop:** *"**removing the loop and adding a new point where the intersection occurred**… In the real world… the cutoff portion becomes an oxbow lake. **For my purposes, I'll just eliminate the cutoff.**"*
3. **Cross-river intersection → reject that iteration**, and *"**I'll only check to see if a river intersects with a river it joins to**"* for speed.
4. **Proximity buffer → freeze points:** *"**notice when part of a river is getting too close to another river and freeze that part so that it cannot be meandered further.**"*
5. **Filter out repeated points** (curvature breaks on duplicates).

**Where meanders are allowed:** *"**I can restrict meanders to the flattest quarter of the rivers**… I've also added a parameter so that **on any map at most one river gets the full meander treatment.**… **use a noise map to control the amount of base meander**."* Downstream consequence: **forest setback had to switch from flux-lookup to actual river-path lookup**, *"because the forests look at the actual water flux to decide where to avoid, but… I've moved the river to places where the flux is low."*

## 2.6 River mouths, tributaries, deltas

**Mouth = draw long, clip, mask the coastline** ([Sprucing Up the Rivers](https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html)):
> *"**it is hard to end the river exactly where the ocean starts without leaving a gap or an overlap. So to avoid this, I have been drawing the river a little long and then drawing the ocean on top of the river.**"*
> *"**One solution is to mask out the land outline where the river crosses it… I just need to draw the river a second time in black into a mask, and then apply that mask to the land outline.**"*
> *"**I can address that by broadening out the river where it joins the ocean.**… It looks even better when the weight of the coastline is closer to the weight of the river border."*
> **Style exception:** *"Masking out the coastline at a river mouth with a black river ends up creating an unnatural gap. **In this case I want to turn the mask off.**"*

Outline flare + the fudge ([VM P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html)): *"**increase the width of the black line and taper it off as it goes up-river**… **the river actually extends into the ocean and then gets clipped to the land**… **So I use the average thickness instead.**"*

**Color gradient along the mouth** (same post): *"**SVG does not support gradients along a path. The workaround… is to chop up the path into a bunch of small segments and then color each of those segments with colors from along the gradient**"* ([Bostock](https://bl.ocks.org/mbostock/4163057)). *"**There are probably some proper ways to do gradients between two colors based upon human perception, but I'm just interpolating evenly in RGB space.**"* Seam fix: `shape-rendering:crispEdges` fixes gaps but adds jaggies → *"**An alternative fix is to draw a thin line around each segment as it is drawn.**"*

**Deltas** ([P1](https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html) / [P2](https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html)):
- Raise a **semicircle** of ocean cells; build the outline **from the whole circle**, not the raised cells (coastlines were frozen at higher resolution).
- **Boolean union** with the existing coastline via the **Martinez-Rueda** algorithm ([w8r/martinez](https://github.com/w8r/martinez)). Then *"**interpolate the new coastline for a bit more detail and then apply some smoothing**."*
- Islands: *"**union each island with the mainland, and if the result is just one coastline… delete the island.**"*
- Distributaries: connect the river to **the midpoint of the delta**; *"**start at the point furthest from the coast, pick one or more random spots on existing rivers to branch from, then move a little closer to the coast and repeat.**"* *"**Each time I split off a branch, I'll split some of the river's flow off to go with it.**"* Plausibility: *"**I'll force branches to go somewhere close to the mouth of the river they are branching from. The farther back they branch, the farther away from the mouth they can go.**"*
- Robustness: *"**simply detect this case and reject this delta**… **I've found that the 80 / 20 rule is a good guide — I can throw out about 20% of the problem cases.**"* Point-in-polygon replaced with Dan Sunday's **winding number** (Vlad Lasky port), *"about 10% faster."*

---

# 3. LAKES

**There is no dedicated lakes post.** Everything is one section of [Various Miscellany P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html) (verified):

> *"**They're one of the hardest map elements to get right. Modeling the actual formation of lakes — filling up depressions in the world, etc. frustrated me greatly the last time I attempted it. So my lakes are really just 'stickers' overlaid on the map. The rivers just flow as they normally would underneath the sticker.** To make all the rivers coming into a lake flow out of a single exit means resculpting the ground under the sticker."*
> *"**The basic notion is to find the lowest point in the terrain that surrounds the lake and then modify the height of all the ground in the lake so that it all flows to that low point. That's not quite as easy as it sounds, but starting at the exit and working your way back across the lake adding small increments to the height works out.**"*
> *"**Previously I wasn't allowing [rivers to cross lakes]. If a river crossed a lake it was adjusted to either start in the lake or end in the lake.**… **Here I think it looks okay, but in general it doesn't look good. Often a river just clips the edge of a lake and that makes no sense.**"*

Placement is random, confirmed in his Azgaar review: *"it looks like **they're being placed randomly (as Dragons Abound does)**. Lakes also have a different color from both rivers and oceans — **I'd probably make them the same color as rivers.**"* ([Azgaar's FMG](https://heredragonsabound.blogspot.com/2019/08/azgarrs-fantasy-map-generator.html)). Classification gotcha: *"it's surprisingly tricky to distinguish between islands and lakes when they run off the edge of the map"* ([Continent Maps P2](https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html)). For label purposes the **whole lake is one bounding box**, not just its shore ([Path Labels P6](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html)).

**Lake/water styling = the shared coastline "pen-stack" recipe** ([Decorating the Ocean P2](https://heredragonsabound.blogspot.com/2017/06/decorating-ocean-part-two.html)) — this is his multi-line shoreline banding, applicable to any water body:
> *"The key idea is to **repeatedly draw the coastline with different size 'pens' (some very big!) and different colors, and overlap them**… **the coastline is drawn first in the darkest and biggest pen, then the next lightest and next smallest pen, and so on. Slightly smaller and darker pens are interspersed to create the dark borders for each region. It culminates in a narrow white line. Half of this is then hidden underneath the rendering of the land.**"*
> **The data structure, verbatim:** *"**Inside the program, I have an array of lines to draw — for each line I have the width of the line, the color of the line, and how much to relax the path.**"* → `[[width, color, relax], ...]`, drawn widest → narrowest.
> Do **not** attempt polygon dilation: *"expanding (or contracting) a polygon is a decidedly non-trivial problem."*
> **Smooth the big pens:** *"when you move a large circular pen along a path you tend to get a lot of regular circles… **I apply some smoothing to the bigger pens. I have to be careful to keep the smoothing consistent between the main pen and the outline pen, and not to smooth near the coast.**"*
> Variants: banded water (vary luminosity per band); fading lines (*"**all the fat regions are given the color of the sea, and the thin regions are given progressively darker colors as they approach the shore**"*); full-ocean texture (*"**just need to add lots of lines**… **vary the distance between the lines slightly**"*).
> Limitation: *"**it's best to use this style of embellishment on a map with a flat sea color.**"*

## Water color — the HSL rule (the only concrete color spec in the blog)

[Decorating the Ocean P1](https://heredragonsabound.blogspot.com/2017/07/decorating-ocean-part-one.html):
> *"The key insight was to **select randomly in the Hue - Saturation - Luminosity (HSL) color space rather than the Red - Green - Blue (RGB) color space.** The colors that work well for oceans are all in a single stretch of the hue space, **from slightly green-blue (0.50) to slightly violet-blue (0.60)**… **So by choosing randomly in the hue space of 0.50 to 0.60 and matching my Saturation and Luminosity appropriately to the land color**, I end up with an ocean color that usually looks pretty good."*

⇒ `hue = random(0.50, 0.60)` normalized (180°–216°); S and L derived from the land color. Deep water = **reduced luminosity** of the base ocean color; the deep-water threshold is a **quantile** (*"if you want about 30% of your ocean to be 'deep water', then sort all the ocean depths and pick the one that is 30% from the bottom"*). Rivers default to the ocean color; **lakes should match rivers**.

**River outline = two stacked strokes**, verified verbatim ([VM P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html)): *"**The river is drawn first as a solid black line and then as a narrower solid blue line on top. This creates the black borders (outline) on either side of the river.**"* The one place he prints a concrete `[width, color]` stack (from his border DSL, [Map Borders P14](https://heredragonsabound.blogspot.com/2019/06/map-borders-part-14.html)) — identical mechanism:
```
K(14,[[4.4, "black"] [2.4, "powderblue"]])
```
⇒ outer **4.4 px black**, inner **2.4 px `powderblue` (#B0E0E6)** = 1.0 px of border each side.

**River shadow / anti-shadow** ([VM P1](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html)): *"**I could draw a dark line under the river and then blur it**… a fairly easy improvement is to **offset the shadow in the direction of the sun, and offset an 'anti-shadow' away from the sun**, so that the rivers get a bright and dark side."*

**Z-order** ([Take Me To The River(s)](https://heredragonsabound.blogspot.com/2017/04/take-me-to-rivers.html)): *"I want the mountains after the rivers and borders, and the forests before the rivers and borders, but I also need the mountains after the forests… That doesn't work… **The solution in this sort of situation is to draw the mountain on a different layer.**"* Full stack at a mouth: river (drawn long) → ocean over river → land outline over both → land outline masked where the river crosses.

---

# 4. LABELS / TEXT

## 4.1 Optimizer: simulated annealing (force layout was tried and rejected)

Force layout failed on local minima: *"It's pretty easy for labels to get 'trapped' in a poor location with forces pressing in from all sides"* ([Use the Force (Layout) Luke!](https://heredragonsabound.blogspot.com/2017/04/use-force-layout-luke.html)). He rewrote Evan Wang's d3 annealing plug-in: *"To be honest, the plug-in isn't very good… **So I have to rewrite most of it.**"* Timings, verified: **335 s force layout → 185 s annealing** ([Simulated Annealing](https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html)).

**Temperature is a move-RADIUS schedule, not a Metropolis-acceptance schedule** — this is the only definition given:
> *"**This temperature corresponds to how far away from the current point we can look for a better solution.** So when the temperature is high, the next point we look at can jump over nearby peaks… As the annealing process continues, this temperature is slowly lowered."*

**No cooling formula, no `exp(-ΔE/T)`, and no initial/final temperature are published anywhere in the blog.**

## 4.2 Energy functions — verbatim, per label class

**POINT labels (cities)** — *"in rough order of importance"* ([Simulated Annealing](https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html), verified):
```
1. Going outside the map area.
2. Distance of the label from its anchor point.
3. Overlap between labels.
4. Overlap between labels and map features.
5. Label placement penalty.
```
Term 5 is Imhof's quadrant preference, verified verbatim: *"Imhof defined the best locations (with respect to the anchor point) as being (in order): **to the upper right, to the lower right, to the upper left and lastly the lower left**."* ⇒ 4 ranked quadrants, **UR > LR > UL > LL**. Relative magnitudes not published.

**AREA labels (regions, oceans, bays, forests, islands)** ([Area Labels](https://heredragonsabound.blogspot.com/2017/05/area-labels.html)) — same list with #3 inserted:
```
Going outside the map area. / Distance of the label from its anchor point. /
Going outside the label area. / Overlap between labels. /
Overlap between labels and map features. / Label placement penalty.
```
The area test is deliberately cheap: *"as a simple approximation, I can try **penalizing an area label if the center of the label is outside of the area**"* — and it works because *"if the center of a label is in the areas, but some other part of the label goes outside the area, the label incurs a different penalty for crossing a coast or a border."*

**PATH labels (rivers, coasts, borders)** ([Path Labels P2](https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html)) — #2 and #5 dropped, two added:
```
Going outside the map area. / Overlap between labels. /
Overlap between labels and map features. / Offset distance. / Curviness of path.
```
- **Offset is a TARGET, not a minimum:** *"trying to minimize the offset distance… jams all the labels right up against the river. **It's better to reward a label that's close but not too close — say a half label height or so away from the river.**"* Later sampled at 3 points: *"**It now checks both corners and the midpoint of the label.**"*
- **Curviness metric = sinuosity:** *"the ratio of the length of the path between the two red dots to the straight-line distance between the two red dots. **That turns out to be sinuosity.**"*
- **Midpoint-of-path criterion** (credited to /u/Azgaar, [P6](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html)): *"I just calculate the center of the label, measure the distance from there to the midpoint of the river (path) and apply that (with some weighting) as a penalty… **I'd rather be on a straight part of the river that's further from the center than on a sinuous part of the river right near the center.**"*
- **Side flag:** *"some kinds of path labels need to be on one side of the path or the other (border labels being an example). So when I create a path label to place, **I need to note whether the offset can be positive or negative or both.**"*

**Overlap penalty is AREA-WEIGHTED** ([Labels Postscript P7](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html)): *"**The probable cause is treating all overlaps as equal.**… **I can calculate the area of overlap and weight the penalty accordingly**, so that the simulated annealing tries hard to avoid major overlaps and will trade a couple of minor overlaps for a major overlap."*

**Degenerate-plateau fix (non-obvious, important)** ([Labeling the Ocean P1](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html)): *"any spot in the ocean that doesn't overlap another label or the land gets the same score. So there's a good chance over many iterations that the label will bounce off to one of these other locations, essentially randomly. **The solution is to add a very small attraction to the label's starting point.**"*

**Region axis heuristic** ([Naming Forests](https://heredragonsabound.blogspot.com/2019/01/naming-forests.html)): *"I've added a placement criteria that tries to **maximize the closest distance between the label and the polygon defining the label area**. Although this isn't foolproof, in many cases it will effectively force the label to lie along the major axis of the region."*

## 4.3 Candidate move generation

- **Point:** *"new candidate locations are generated by **displacing the current location, or rotating the current location around the anchor point**."*
- **Area — temperature-switched two-mode generator (the single most implementable detail in the series):** *"**when the temperature is high, it tries random locations within the area. As the temperature gets lower, it switches over to small displacements.**"* Random point in polygon = **bbox rejection sampling** (he explicitly declines triangulation: *"That sounds like a lot of work"*).
- **Path — 3 free parameters:** *"to generate a new candidate label I only have to randomly come up with **a position along the path, an offset from the path, and an amount of arc**… **I need a method for finding candidate arcs that keeps them closer and closer to the current arc as the algorithm anneals.**"* Position via `getTotalLength()` + `getPointAtLength(t)`. Annealing windows: *"**I accommodate this by picking points in a window around the current position**… As the temperature drops, I make the window smaller and smaller"*; same for offset.
- **Angle as a 4th variable — the one hard angular number in the corpus** ([Naming of Places P8: The Sea](https://heredragonsabound.blogspot.com/2018/07/the-naming-of-places-part-8-sea.html)): *"**Generally speaking I will limit straight labels of this sort to the angle range of -45 degrees to 45 degrees.** Anything outside that range becomes hard to read, looks awkward, or is upside down."*
- **Max move cap:** *"**cap the maximum move for any label to a value that couldn't take it so far off the screen that it couldn't recover.**"*
- **Seeds:** area labels start at the **mapbox/polylabel visual center** (*"/u/redblobgames recently pointed me towards a small Javascript library from MapBox for finding the visual center of a polygon"*); ocean labels use a max-clearance point (§4.5).

## 4.4 Three optimizer improvements — two worth ~20% each

([Some Initial Optimizations](https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html))
1. **Return best-ever, not final:** *"**On my test maps, the best solution is about 20% better than the ending solution (!)**."*
2. **Do NOT restart from best on temperature change** — tested and rejected: *"in testing this doesn't improve the results. **In most cases, it makes them worse!** I suspect the reason is that this tends to increase the chance the algorithm will get caught in a local minima."*
3. **Score-weighted label selection** replaces round-robin sweeps: *"**weight the chance of selecting a label for a change by its score**… As labels are improved, their chances for further changes go down, so the algorithm keeps shifting its attention to the current worst labels."* → *"**about a 20% improvement over the previous best solutions.**"*

**Iteration counts — the measured convergence curve** ([Labels Postscript P7](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html)): **100** = *"pretty good"*; **1000** = *"Most of the city labels are now optimal"*; **2000** = one remaining problem; **4000** = *"fairly optimal"*; **8000** = regresses to the 2000-iteration solution. Verdict: *"**a fairly small number of iterations (~1000) produces an acceptable result with very little time spent.**"* Ceiling: *"there isn't much improvement beyond about **2500 iterations per label**."*

## 4.5 Collision avoidance

**Everything becomes a rectangle:** *"**Dragons Abound treats all the map features that have to be avoided as rectangles**… **The coast is a long wiggly line. It is turned into rectangles by breaking it up into line segments and drawing a bounding box around each segment.**"* Fencepost bug to pre-empt: *"the bounding box for the very end of the river was missing… **to turn a path into a sequence of bounding boxes I operate two elements at a time**."* **Mountains and forests are deliberately NOT obstacles** — they're handled by masking instead: *"mountains are big features, and on many maps, that would make label placement very difficult."*

**Text measurement — the three coordinate systems** ([Path Labels P3](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html)), the most load-bearing implementation detail:
> *"The **black circle** represents the coordinates of where I drew the text on the screen. With left-justified text, this is the left-most point on the text baseline. The **green circle** represents the origin of the bounding box around the text. This is below the black circle because (1) the text has a descender… and (2) **SVG seems to add some margin on the top and the bottom of text (but not on the left and right?)**. Finally, the **red circle** represents the center point of the bounding box. **I use this as the location of the label.**"*
> *"**The only way to figure out the origin (green circle) and size of the bounding box is to draw the text on the screen and use the browser to measure the text.**… **Fortunately this works the same for both regular text and text which has been placed on a path.**"*

⇒ `getBBox()` on the rendered element (named explicitly in [Towards Idiomatic Javascript](https://heredragonsabound.blogspot.com/2017/04/towards-idiomatic-javsascript.html): `let rect = world.mountains[i].node().getBBox();`). **`getComputedTextLength()` is never mentioned in the blog.**

**THE WEB-FONT MEASUREMENT TRAP — must implement** ([Various Miscellany P2, 2017‑04](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html)):
> *"**Chrome doesn't load a Web font when it is defined in CSS, but waits until it is actually used**… **When the styled font is unavailable, the browser fails back to a default system font.** So the bounding boxes shown up above are based upon displaying the label in a system font (Helvetica in this case)."*
> **Fix:** *"**It turns out that the element using the font has to be visible (that is, you can't use 'display:none') but it doesn't actually have to contain any text. So it is sufficient to stick an empty `<span>` element into the page for every possible font.** After that, the bounding boxes are calculated correctly."*

All fonts are **WOFF2** ([Continent Maps P2](https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html)). Font-metric caveat ([Map Borders P15](https://heredragonsabound.blogspot.com/2019/07/map-borders-part-15.html)): *"if the font doesn't have the proper metadata (and many free fonts you'll find don't) then this measurement is even worse. **Long story short, before I can use a font in the program I have to play with it to see how well it actually works.**"*

**Rotated bboxes for path labels** ([P1](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html)): *"**I measure the regular bounding box when the label is horizontal, and then I rotate this through the same angle as the label.**"* Angle comes from **the chord, not the tangent**: *"I calculate the normal to the line between the start and end points."* End-point search: *"I step along the path in small increments until I hit the first point that is 'l' or further away from the start point."*

**Curved bbox = offset ribbon** ([P4](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html)):
> *"**establish a normal to the line between the two endpoints on the original path and offset the new path in that direction X units**… Next, **I create another copy of the path and offset it in the same direction the maximum height of the text**… Finally, **I connect the endpoints of the two copied paths.**"*
> Residual error: *"**SVG seems to place each glyph (letter) in the text at the normal to the path at the point where the letter is drawn**, but it will at any rate be a much better approximation than the rectangular bounding box."*
> Center of it: *"**halfway between the middle points of the top and bottom sides of the bounding box.**"*

**Polygon clipping libraries + the 2.5× speedup** ([P6](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html)): Greiner-Horman (Milevski) for path-label × path-label; then *"a good one for my case is the **Sutherland-Hodgman** algorithm. The good folks at Mapbox have done a Javascript implementation."* → *"**A typical map went from 149 seconds to 59 seconds. The collision checks are only about 4% of that run-time after the switch.**"* Two library bugs to guard: *"**The code gets confused if the polygon repeats its start point at the end**"*, and a touching-corner false positive which he keeps — *"**In some ways this is a fortuitous bug**."*

**Quadtree — VERBATIM CODE, saves ~90% of scoring time** ([Some Initial Optimizations](https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html); the map had **1712 features**):
```javascript
    // Find all points in quadtree that are (possibly) within a rectangle
    function qtWithinRect(quadtree, rect) {
        var results = [];
        quadtree.visit(function(node, x0, y0, x1, y1) {
            // Does this node overlap with our rectangle?
            let x_overlap = Math.max(0, Math.min(rect[1][0],x1) - Math.max(rect[0][0],x0));
            let y_overlap = Math.max(0, Math.min(rect[1][1],y1) - Math.max(rect[0][1],y0));
            let overlaps = (x_overlap > 0) && (y_overlap > 0);
            // If this is a leaf, add it's nodes to results
            if (!node.length) {
               do {
                  results.push(node.data);
               } while (node = node.next);
            }
            return !overlaps;
        });
        return results;
    };
```
Two caveats, verbatim: *"**I'm indexing features in the quadtree by the center of the feature.** This function will find features whose centers lie within the label, but it won't necessarily find features whose centers lie outside the label, but still overlap"* → fix: *"**keep track of the size of the features as you add them to the tree and then pad the search by the dimensions of the biggest feature.**"* Second quadtree use: `findLocAt()` → `quadtree.find()`, **4672 ms → 2.7 ms**.

## 4.6 CURVED TEXT — the definitive statement

[Labeling the Ocean P1](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html), verified verbatim:
> *"**SVG provides a capability to place text along a path. The curved labels in Dragons Abound are placed on an elliptical path. The hardest part is figuring out the appropriate size of the ellipse!**"*

So: an SVG `A` (elliptical arc) baseline with `<textPath>` — **not** a circle fit through the region, **not** a spline, and (crucially) **decoupled from the underlying feature geometry**.

**Centering** ([Ocean P2](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-two.html)): *"**I'm centering the label on the arc by setting the label's anchor to the middle of the label, and then placing the label at 50% of the way along the arc.** This should be correct, but something about the combination seems to be broken. I can apply a manual adjustment… **This adjustment changes a little bit with the length of the label.**"* ⇒ `text-anchor="middle"` + `startOffset="50%"` + a length-dependent empirical fudge (value not published).

**Direction reversal requires TWO paths, not a rotation** ([P4](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html)):
> *"**When you lay out text on a path, the direction of the text matches the direction of the path. If you want the text to run the other direction, you need a path that runs in the other direction.**… **the easier solution in this case is just to create paths in both directions for the river so that I can switch labels from one to the other.**"* Also: *"**What I want to do is flip the label within the bounding box**"*, not flip the bbox.

**Ocean-label arc rules** ([Ocean P1](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html)/[P2](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-two.html)):
- Anchor = *"**the interior point of the polygon with the greatest minimum distance to an edge**"* (verified) — not centroid, not visual center. Computed by iterating all edges and taking min distance.
- Baseline angle v1 = major axis (*"**find the two points in the ocean that are the farthest apart**"*). v2 superseded it: *"**the base angle would be at right angles to the line from the label to the center of the map.**… That looks much better to my eye."*
- Sweep: *"**when labels are on the lower half of the map, I also have to reverse the 'sweep' of the elliptical arc so that it bends the other way.**"*
- Rotate the ellipse itself via the arc's `x-axis-rotation`: *"**that's built into the SVG routine for making elliptical arcs, so I just have to feed in the same angle of rotation.**"*
- Push toward the edge — the one concrete percentage: *"move the label outward along that vector some percentage of the radius of the green circle — **say 50% to place the label halfway between the center of the green circle and the edge**."*
- Bbox: *"**I'm going to use the rotated bounding box for the straight text as a better approximation**"* (the arc's own bbox is far too big).
- Trigger: *"Contiguous water that covers more than (say) **25%** of the map will get a label"*, later replaced by a min "distance to land" metric alone; corner bonus: *"**adding a bonus to spots that touch two map edges at the same time.**"*

**The architectural pivot — abandon real-path-following text** ([Coast P1](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-one.html)/[P2](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html)):
> *"**this is partly SVG's responsibility: It just doesn't do a very good job laying out text along a path.** But even when the letters don't clash, I find don't really like the look of text on an arbitrary path."*
> *"After looking over a lot of maps, I think what looks best is **a label along a gentle, symmetrical arc**… **So I'm going to abandon using the original path completely, and just try to find a suitable arc.**"*
> *"I spent a lot of time going down a dead-end path… trying to determine whether the section of path next to a label was generally convex or concave… **I didn't really need to put so much effort into trying to create a well-fitting label. That's what I have the simulated annealing algorithm for.**"*

Where real paths *are* used (river labels), smooth hard: **Visvalingam at ~85% point removal**, then neighbor-averaging. *"**To get to a path that's more suitable for drawing labels, I have to remove about 85% of the points.**"* Over-curved labels are **dropped, not fixed**: *"**I'll simply drop any labels that are too curvy.** Since rivers are often unlabeled anyway, this should look fine."*

**River-label eligibility:** *"**I'm choosing to label only the rivers that are substantially longer than the river name**… **in practice a number in the range 1.25x to 1.75x seems to give the right proportion to my eye.**"*

**Sinuosity constants:** *"the sinuosity of a semi-circle is **Pi/2, or about 1.5**. Therefore a coastline with a sinuosity close to 1.5 is shaped something like a bay, while a sinuosity close to 1 is more like a straight stretch."* Point detection: *"**a point not take up more than (say) 1/4 of its coastline**… This point has a **ratio of length to width of about 3**."*

**Verbatim arc-generation code** (the only published arc code, [Map Compasses P9](https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html)) — note he hand-rolls rather than using SVG `A`, specifically so the arc can be made subtly imperfect/hand-drawn:
```javascript
// Make a circular arc
function makeCircularArc(center, radius, start, end, num) {
    const [x, y] = center;
    const result = [];
    const step = (end-start)/num;
    for(let t=start;t<end;t += step) {
	result.push([radius*Math.cos(t)+x,radius*Math.sin(t)+y]);
    };
    result.push([radius*Math.cos(end)+x,radius*Math.sin(end)+y]);
    return result;
};

function rarc(svg, center, radius, startAngle, repeats, angle, iteration, op) {
    const arcStart = angle-0.5*op.subtend;
    const arcEnd = angle+0.5*op.subtend;
    const outsideEdge = makeCircularArc(center, radius, arcStart, arcEnd, 20);
    const insideEdge = makeCircularArc(center, radius-op.width, arcStart, arcEnd, 20);
    const polygon = outsideEdge.concat(insideEdge.reverse());
    svg.append('path').style('stroke-width', 0).style('stroke', 'none')
	.style('fill', op.color).attr('d', lineFunc(polygon));
};
```
*"This is using **20 points** on the edges; that seems to be good enough to give a smooth curve at these sizes."* Rationale: *"**while SVG will draw a perfect arc, when I use this code in DA I'll want to be able to draw a (subtly) imperfect arc to make it look hand-drawn.**"*

## 4.7 Fonts, sizes, letter-spacing

| Font | Use | Source |
|---|---|---|
| **IM Fell** family | default "old book" atmosphere, all labels | [Labels Postscript P7](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html) |
| **IM Fell DW Pica** | italic → city labels; **small caps** → feature labels | [Recreating a Style](https://heredragonsabound.blogspot.com/2017/10/recreating-style.html) |
| **IM Fell DW Pica** roman/italic | Knurden: roman → cities, italic → woods, roman ALL-CAPS → regions | [Knurden Labels P6](https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html) |
| **IM French Canon** | Skies of Fire | [Skies of Fire](https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html) |
| **Aniron** | LotR — **rejected**, *"doesn't seem to be able to accurately measure the size of the font"* | [LotR](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) |
| **Kelt** | LotR fallback — measures fine but hits a *"3 year old bug in Chrome"* (letters not filled); OK in Firefox | same |
| Handwriting / typewriter | D&D style labels / captions | [D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html) |

Small caps is faked: *"**you can fake small caps using the SVG/CSS 'font-variant' property.**"*

**The Knurden per-class spec (most complete style breakdown published)**, verbatim:
- **Cities:** IM Fell DW Pica; *"**The city labels are filled in a light reddish brown, and stroked in a dark red brown**"*; halo = *"**a narrow, somewhat transparent white blur**"*; no mask.
- **Woods:** *"**an italic version of the IM Fell font. The letters are outlined in the same dark brown but filled with white, and there does not seem to be a mask or halo. The forest labels are also fairly small, about 60% or so the size of the town labels.**"*
- **Rivers:** *"**a kind of 'negative' effect by using a transparent light color for the font and surrounding it with a dark halo.**"*
- **Oceans:** as rivers, adjusted for ocean colors.
- **Regions:** *"**like forest labels, but not italic and in all-caps.**"*

**Only ratio published: forest = ~60% of town size. No absolute px font sizes anywhere except the compass DSL** ([Map Compasses P14](https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html)):
```
<$labelFont> => "Serif" | "Lobster" | "IM Fell English";
<$labelSize> => 14 | 16 | 18;
<$labelStyle> => "normal" | "bold" | "bolder";
```
Other style presets: Skies of Fire — *"**Small caps is used for all labels except cities and rivers. Ocean and coastal labels are in a dark rust color. The larger labels have black outlines filled with brown, and the capital cities are underlined**"* (via `text-decoration`; *"I don't much like the way the underlining looks; it's too heavy and clunky"*). Torfani — *"**a dark gray color for labels**"* (DA default = black). LotR — *"**red labels**."*

**LETTER-SPACING** ([Naming Forests](https://heredragonsabound.blogspot.com/2019/01/naming-forests.html)) — the only discussion in the blog:
> *"Another style often applied to these sorts of labels is to **stretch them out so that they better span the labeled area. Dragons Abound already does this for ocean labels**, so I can easily add this style to forest labels as well."*
> *"**It might be worthwhile to check the size of the forest area versus the length of the label to determine whether (or how much) extra letter spacing to apply.** Here's an example where a forest name ('Bishop Tanpik's Forest') has been **compressed** to make it fit better while another name with more room ('Forest of Horses') remains **stretched out**."*

⇒ tracking = f(area extent ÷ natural text length), applied to ocean/region/forest labels, **can go negative**. No px/em values published.

**`font-weight` + stroke incompatibility, and the `paint-order` fix** ([Knurden Labels P6](https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html)) — a genuinely non-obvious SVG gotcha:
> *"**I discovered that setting font-weight breaks the font stroke (outline). You can make the font fatter, or you can have an outline, but you can't have both.**"*
> Failed workarounds: `-webkit-text-stroke` *"**doesn't seem to work on SVG text**"*; stacked copies at different weights (*"the difference in thickness between the heaviest and the lightest font weights is still pretty minimal"*); stacked copies at different sizes (*"**The space between characters also gets bigger**, and this throws everything off"*).
> **The fix:** *"There's a little-known attribute for SVG text called **'paint-order'**… **It turns out that when the stroke is drawn first (instead of the fill), 'font-weight' starts working!**"*

**Anchor semantics** ([Compasses P8](https://heredragonsabound.blogspot.com/2021/12/map-compasses-part-8-radial-text.html)/[P9](https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html)): *"the **lower-left-hand corner** of the text box is at the specified [x,y]"* by default; `text-anchor: middle` gives *"**the middle of the bottom of the label**"*; vertical centering needs `dominant-baseline: 'central'` — *"**This setting doesn't really do exactly what we want**… But this gets pretty close in most cases."*

**Multi-line:** *"**because SVG doesn't support multi-line text, multi-line labels are actually collections of single line labels.**"* ([Naming of Places P12](https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html))

**Fake typesetting errors** ([Labels Postscript P7](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html)): *"**SVG has the capability to rotate and offset individual letters within text**… **when you apply an offset this way in SVG, it becomes the new baseline for subsequent characters. (Rotation doesn't work this way; it only affects a single character.) So to get a typesetting error look, I need to un-apply the offset on the next character.**… **It's best to use it very sparingly and with small offsets.**"*

## 4.8 A label is THREE SVG elements

([Naming of Places P12](https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html)): *"**Each label is actually three elements: the text element, a mask element, and a halo element.**"* Curved labels add a fourth, invisible piece: *"they are set to **follow an (invisible) SVG path element**. Changing the position of these elements only slides them along the path. **To move the label to a new position requires moving the underlying path.**"*

**Masking recipe, verbatim** ([Path Labels P5](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html)):
> *"**In SVG, you can add a mask to just about anything. The mask itself is a grayscale image. Everywhere the mask is white the image shows through; everywhere the mask is black the image is blocked out.**"*
> *"**For text, you can create a useful mask by drawing the same text in black with a fatter pen — that masks out around the edges of the text to whatever distance you've chosen. Then you place the mask not on the text, but on the image you want to block out. So in my case, I need to place the mask on the image of the mountains.**"*
> *"**during label placement I can just slide the mask around with the text.**"*

Three variants (crediting Jonathon Roberts): hard mask; **blurred mask** (*"letting some of the background show through"*); **white overlay instead of a mask** — *"**This has the advantage of also popping out a label even on a plain background (where the mask has no effect).**"* Limitation: *"**SVG doesn't provide a full array of compositing functionality. If I could use a screen blend mode… it would look better over a dark background.**"* Inkscape export gotcha: *"**group all the elements in each Dragons Abound mask into a single (unnecessary) 'group' element.**"*

Non-label objects fed into the same solver: **ocean illustrations** (*"I just turn the image into a label and **make sure it has the criteria to maximize the distance to the nearest other label**"*) and **compasses** (*"**treat a map compass like a label**… as far away from other features as possible"*).

---

# 5. MOUNTAINS / HILLS

## 5.1 WHERE — there is no ridge detection

**The decisive statement** ([Mountain Placement](https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html)):
> *"Figuring out where the mountains are on the map is straightforward… **I decide what percentage of the map should be mountains (this can vary, so that map might have lots of mountains or few mountains) and declare that percentage of the highest land locations 'mountains'.**"*

**Pure percentile threshold on the heightmap. No ridge detection, no local-maxima detection, no slope threshold — ever.** He explicitly declined the alternative: *"it's a lot simpler than trying to figure out the 'spine' of a mountain range and how to place symbols along there :-)"*. (He did eventually build a spine, but as a **polygon centerline via Voronoi longest path** — §5.4 — not from the heightmap.)

Terrain generation pseudo-code, verbatim ([Mountains](https://heredragonsabound.blogspot.com/2016/10/mountains.html)):
```
// Combine 6 octaves of noise with a 50% fall off
height[x,y] = Noise.octave(x*4,y*4,6,0.5);
// Ridged noise
height[x,y] = 1 - Math.abs(Noise.noise(x*4,y*4));
// Combine 6 octaves of ridged noise with a 50% fall off
height[x,y] = 1 - Math.abs(Noise.octave(x*4,y*4,6,0.5));
```
*"Note that I'm multiplying the (x,y) coordinates by 4… **Each doubling of the coordinates effectively shifts the noise up one octave.** So in this case, I'm skipping the lowest two frequencies."*

**Dual-threshold mountain/hill mask, verbatim pseudo-code** (`T` = mountain, `T2` = hill, `T2 < T`, both by *percentile*, linear fade between them):
```
// Create the mountain mask.  Changing the frequency of the
// noise here can create different kinds of clumps
for each location "loc" on the map:
  noise[loc] = Noise.noise(x,y);
// Find the two thresholds
T = findThreshold(noise, mountainPercentage);
T2 = findThreshold(noise, hillPercentage);
// Put down the mountains/hills
for each location "loc" on the map:
  if noise[loc] > T2 then
     rawHeight = Noise.noise(x*4,y*4);
     actualHeight = rawHeight * Math.min(1, (noise[loc]-T2)/(T-T2));
     height[loc] += actualHeight;
```

**Ranges via fault lines** ([It's Not My Fault](https://heredragonsabound.blogspot.com/2016/10/its-not-my-fault.html)) — *"Randomly create a line that crosses the map and then add height to the land based upon how far away the land is from the line"*; perturb the fault with noise; build **a separate steeper/narrower "tent mask"** around it; **"you just need to make sure you use the same perturbation to both the fault line and the mountains mask."** Verbatim helper:
```javascript
function distanceFromPointToSegment(x, y, x0, y0, x1, y1, segment) {
    var d = (x1-x0)*(x1-x0)+(y1-y0)*(y1-y0);
    var t = ((x-x0)*(x1-x0)+(y-y0)*(y1-y0))/d;
    if (segment && t < 0) { return Math.sqrt((x-x0)*(x-x0)+(y-y0)*(y-y0)); };
    if (segment && t > 1) { return Math.sqrt((x-x1)*(x-x1)+(y-y1)*(y-y1)); };
    var xp = x0 + t*(x1-x0);
    var yp = y0 + t*(y1-y0);
    return Math.sqrt((x-xp)*(x-xp)+(y-yp)*(y-yp));
}; 
```

## 5.2 Symbol placement — two generations

**Gen 1 (2017), greedy exclusion-radius** ([Mountain Placement](https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html)), verbatim:
> *"**go through the map from North to South (essentially from back to front)** and when I hit a mountain location, **I check to see if there's already a mountain symbol on the map within some distance (based on the size of the symbol I would put down for this location)**… If there is, I skip putting down a mountain symbol."*
> Revision: *"**On the theory that the big mountains are more important, I rewrote the algorithm to walk through the mountains from biggest to smallest.**"*
> *"**By varying the distance to exclude other mountains, I can control whether the mountains are sparse or dense on the map.**"*
> *"**Right now, I'm calculating the exclusion distance as a circular radius around a location.**… **I'm not trying to make the mountains never overlap with each other. A certain amount of overlap is good.**"*

**Note the ordering conflict this creates:** once sorted by height, back-to-front correctness is no longer guaranteed by iteration order → §5.3.

**Gen 2 (2019–2020), overlap-percentage rejection — the only hard density number in the blog** ([New Mountain Style P5](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html), verified):
> *"The current algorithm… **looks at each mountain location on the map in height order (tallest to smallest)**, draws an appropriately sized mountain there and then **checks how much it overlaps previously drawn mountains. If it overlaps too much, it's removed.** By tweaking the allowed amount of overlap, I can get different densities of mountains. **(Usually between 5-35% overlap.)**"*

```
mountains = cells with height >= percentile(mountainPct)
sort DESC by height
for m in mountains:
    sym = makeMountain(size = f(m.height)) placed at m
    if overlapFraction(sym, alreadyPlaced) > maxOverlap:   // maxOverlap ∈ [0.05, 0.35]
        reject
    else: alreadyPlaced.push(sym)
```
Its known shortcoming: *"**it doesn't (except accidentally) give the impression of a mountain chain.** Often it produces… **rows of horizontal mountains**."*

**Coastline rejection constraint** ([VM P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html)):
> *"**making sure that the location of both the left foot and right foot of the mountain are on land.**… **I was using the bounding box, but because the baseline of the mountain is an arc, the corners of the bounding box are lower than the ends of the line that defines the top of the mountain. So I had to quit using the bounding box and instead use the end points of the topline.**"* Plus: *"**both feet [must be] in the same land mass.**"*

## 5.3 Back-to-front (painter's algorithm) — the exact sort key

He never uses the phrase. Mechanics, verbatim:
- **Base rule** ([Two Mountains Are Better Than One](https://heredragonsabound.blogspot.com/2016/12/two-mountains-are-better-than-one.html)): *"**When drawing mountains on a map, we can draw them from top to bottom, so that the overlap properly reflects how far away the mountains are from the viewer's eye.**"*
- **Mandatory re-sort pass after chain+fill** ([New Mountain Style P6](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html)): *"**the fill mountains aren't drawn from the top to the bottom, so they overlap incorrectly. At the end of all mountain drawing, I need to go through the list of all mountains from top to bottom moving them up to the top of the drawing. This puts them all in the correct order.**"* (In SVG: iterate sorted by ascending Y and `parent.appendChild(node)` each.)
- **Refined key = lowest point, not center** ([P9](https://heredragonsabound.blogspot.com/2020/02/new-mountain-style-part-9.html)): *"**the algorithm is overlapping them based upon the mountain centers, when it really should be the lowest point on the mountain. This is making the mountains overlap too much.**"* — matches the tree/mountain unified sort in §1.7.

**Occlusion = opaque fill + a mask apron BELOW the baseline. There is no white halo — the fill is the sampled land color:**
- *"**Masking is fairly straightforward — I just need to take the outline of the mountain, connect it across the bottom and fill that with the background color. It's also good to add a little buffer at the bottom of the mountain so that another mountain 'behind' the front mountain doesn't peek out.**"* ([Or Maybe Not](https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html))
- *"**Each mountain blocks out a chunk of the map below its baseline.** I added this because when tightly packed, **the ridgeline of the back mountain often peeks out below the front mountain.**"* ([P8](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html))
- *"**The closest I can get is to sample the color at the center bottom of the mountain and fill the mountain with that color.**"* ([Purple Mountain Majesties](https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html))
- **Alpha-compositing gotcha** ([VM P1](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-1.html)): the mountains sample terrain color and therefore miss any SVG overlay tint — *"**A better solution is to mix the overlay color into the terrain itself (rather than use an SVG overlay), so that when the mountains pick up the terrain color it already has the overlay included.**"* (and *"SVG expects only integer RGB values"*).

**Within-symbol z-order: mask/fill → shading → highlight → outline.** *"**If I draw the shading last, it will go on top of the outline. I want it to be under the outline, so I need to draw it first**"* ([P4](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html)); *"**I can draw the outline last so it is 'on top' of the highlight**"* ([Knurden Mtn P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html)).

## 5.4 Mountain chains (the 2019–2020 innovation)

**Core insight** ([P5](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html), verified): *"**the chaining connects a point on the topline of the front mountain to the end of the ridgeline of the previous mountain**"*, implemented as *"**drawing the mountains from back to front, and setting the origin of each mountain (which is the left end of the topline) to be the end of the previous ridgeline.**"*

Three cardinal directions, verbatim: *"**To chain to the right you connect the left end of the topline to the previous ridgeline (red). To chain straight downward, you connect the middle of the topline to to the previous ridgeline (blue). And to chain to the left you connect the right end of the topline to the previous ridgeline (green).** But you're not limited to connecting at those three points."* + *"**extrapolating along the length of the topline gives a rough approximation**"* for arbitrary angles. Upward chains invert the intersection: *"**you have to do the opposite — intersect the topline of the old mountain with the ridgeline of the new mountain**"* ([P8](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html)).

Line-following variant: *"**My solution was to place the new mountain on the line and then slide it back and forth on the line to find a spot where the end of the previous ridgeline just touches the topline of the new mountain.**"* Also: **turn off line fade inside a chain** so the toplines/ridgelines form one continuous line.

**Area fill pipeline** ([P6](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html)): polygonize mountain-height cells (*"**I've excluded smaller areas, since they're likely too small to fit a mountain chain**"*) → *"**find the long axis of the area and run mountain chains parallel to that axis**… **This is very similar to the way I add hatching to an area of shadows**"* (he literally reuses the hatch sweep with chains as hatch lines) → *"**find the longest chord for the polygon and use that as the slope**"* → *"**add some noise to the lines**… **using the same noise source for all the chains, so the perturbations are somewhat correlated**"* → **Bridson Poisson disc fill** for the remaining mountains, rejecting on overlap.

**Final preferred method — centerline "spine"** ([P7](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-7.html)):
> *"**The spine of a polygon is usually called the 'centerline.'**… **The short version is that you create a Voronoi diagram based on the points in the polygon and then find the longest path through the Voronoi edges.**"* ([observablehq.com/@veltman/centerline-labeling](https://observablehq.com/@veltman/centerline-labeling))
> *"**For the purposes of drawing mountain chains I prefer straighter lines, even if they're not the longest possible… I introduced the idea of sinuosity when placing path labels, so I'll combine that with length to pick a path.**"*
> *"**In general it is difficult for the mountain ranges to follow abrupt changes of direction. Smoothing the centerline helps.**"*
> Verdict: *"**Placing a chain of mountains down the centerline and then filling the region sparsely with other mountains seems to work pretty well.**"* And the unification: *"**if I don't draw a mountain chain and just fill in randomly, it's equivalent to the old style of mountain fill.**"*

**Anti-collinearity fixes inside chains** (P7): *"**I can implement something like this by forcing the slopes of the mountains along the chain to alternate between wide and narrow**… I was worried that strict alternation would be obvious, but it doesn't seem to be a problem."* And: *"**it's fairly easy to tell when the peak of the front mountain is close to the right topline of the back mountain**… I can move the mountain away from the topline. **Moving the mountain randomly doesn't work very well; it's better to move it along the normal of the topline.**"* Plus *"force the chain to peak in the middle."*

## 5.5 Symbol construction

### Old style (2016–2017): Bézier concave↔convex continuum
([The Outline of a Solution](https://heredragonsabound.blogspot.com/2017/01/the-outline-of-solution.html)): *"if we could have parameters that controlled the bend of the mountain at the bottom and at the top, we could interpolate between those shapes… **As it happens, this is essentially how Bézier curves work.**… **it is pretty easy… to create a routine that draws a mountain using two Bézier curves**"* + *"**it is nice to be able to generate mountains with rounded tops. To do that, I can insert another Bézier curve into the mountain shape, connecting the two sides with a flat hump.**"*

Segmentation: **20 pieces ≈ indistinguishable; 8 pieces obviously faceted**; and *"**since the mountain is symmetrical and has a peak in the middle, I have to be careful to use an even number of segments. Choosing an odd number of segments chops off the top of the mountain.**"*

Pre-Bézier construction rules still in force ([The Shape of Things to Come](https://heredragonsabound.blogspot.com/2016/12/the-shape-of-things-to-come.html)):
- *"**The basic mountain shape is a triangle.**"*
- **Perturbation axis rule:** *"**In the hand-drawn examples, the perturbations are almost always in just the height (Y axis) — the bumps point up.**"*
- **Ridge/shadow line axis rule:** *"**in this case, I'm perturbing in the X axis, to make the line curve back and forth, rather than up and down.**"*
- *"the sides of the mountains are more often concave than convex… **I can help that along by making the starting point be a gentle concave curve.**"*
- **Proportion:** *"**it is striking how often the mountain (or mountain cluster) fits the golden ratio**… **I'll take advantage of this to size my mountains (with some variation) around the golden ratio.**"*

**Ridge-perturbation scaling (prevents the ridge escaping the silhouette)** ([How to Decorate a Mountain](https://heredragonsabound.blogspot.com/2016/12/how-to-decorate-mountain.html)): *"**I can solve this problem by scaling the perturbation by the width of mountain**… **it turns out that it is sufficient to scale the perturbation as if the mountain were a perfect equilateral triangle.**"* ⇒ `perturbMag(t) = baseMag * t`, `t` = fractional distance peak→baseline.

**Minor ridge line on the LIT face** (same post): *"**I'll make a line from the peak of the mountain down to the middle of the lit face, and pick a spot about halfway down**… Then I'll pick a spot on the baseline… **at about the same slope as the right side of the mountain**"* + *"**make the ridge line approximately as concave as the mountain side**"* + *"**it turns out that adding perturbations in the Y axis looks weird… So I only add perturbation in the X axis**"* + *"**set the color to black, use the 'hand-drawn' line, and make the line grow from narrow to wide**"*.

**Merging two mountains, three modes** ([Two Mountains](https://heredragonsabound.blogspot.com/2016/12/two-mountains-are-better-than-one.html)): (1) *"**find the intersection of the left mountain's right side with the right mountain's left side (!) and then delete the left mountain's right side from that point to the end**"* — walking down and toggling erase on each intersection; (2) *"**Instead of cutting off the line at the point of intersection, I cut it off about 2/3 of the distance to the end of the mountain. I thought something more complex would be needed, but this works surprisingly well.**"*; (3) cleft — *"**the shaded side is cut off at the point where the mountains intersect along a line parallel to the ridge line**."*

### New style (2019–2020): topline / ridgeline / secondaries
Debug vocabulary ([P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html)): *"**The red line is the topline, the blue line is the ridgeline, the green line is a secondary topline, and the orange line is a secondary ridgeline.**"*

**TOPLINE — exact statistics from his trace of the reference map** ([P1](https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html)):
> *"they split (almost exactly) into two shapes: **either a simple carat shape, or the carat shape interrupted by a short peak on one or both sides. The highest/biggest mountains are flattened at the peak. These are rare — about 1 in 20 mountains.**"*
> *"**The mountains have a range of proportions (width/height) from about 2.25 to 5. The largest mountains tend to be the more square, with proportions in the range of 1.9 to 3.9.**"*
> *"**the toplines are almost all straight segments.**"* · *"**many of the mountain baselines slant downward to the right**… **most of the mountains are symmetrical.**"*
> **Never break this rule:** *"**Of note on this map is that the end of one topline never meets the start of another topline. When toplines touch, it is in the middle of the toplines.**"* — because *"If two toplines touch end to end it gives the impression of two side-by-side mountains at the same distance from the viewer. This tends to flatten out the perception."*

Implementation ([P2](https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html)): *"**The tallest mountains (about 1 in 20, or 5%) have a flattened peak.**… **these are generally 3-4x longer in the horizontal direction**"*; *"**creates a carat shape with the provided possible peak locations (pretty close to the middle) and proportions**"*; *"**Next I create sub-peaks by putting a jog in the mountain's side**"*; *"**These subpeaks are symmetrical, while the subpeaks in the original mountains have about the same proportions as the mountains themselves. The mountains with subpeaks are also wider, to maintain their proportion.**"*; *"**There are more small mountains than big ones.**"*

**RIDGELINE — exact geometry** ([P1](https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html) + [P2](https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html)):
> *"**the first segment of the ridgeline almost always comes straight down and is usually about half of the vertical extent of the ridgeline. Second, the following segments are at sharp alternating angles.**… **At most there are four segments to each ridgeline, and the final segments are often much shorter than the first segment.**"*
> *"**ridgelines appear on almost every mountain, come more-or-less straight downward from the peak for about half the height of the mountain and then alternate sharp angles, each segment being about a quarter to half the height of the mountain, and generally ending after crossing the baseline of the mountain.**"*
> *"**the ridgelines generally extend past the baselines except on the tallest mountains.** (This helps with the oblique perspective by compressing the vertical dimension of the map.)"*
> Guard: *"**put the end of the first segment in a middle region of the mountain, even if that means it is less vertical.**"*

```
seg0: from peak, ~vertical, length ≈ 0.5 * mtnHeight, endpoint constrained to a middle X-band
seg1..seg3: alternating sharp L/R angles, each ∈ [0.25, 0.50] * mtnHeight
stop after crossing the baseline; max 4 segments; final segments much shorter than seg0
```

**SECONDARY RIDGELINES:** *"**usually two lines, one of which comes down from the secondary peak and one which comes downward from the adjacent valley and meet down around the baseline. Note that these get reverse shaded: dark if they're on the lit side of the mountain and light if they're on the unlit side.**"* Frequency: *"**About 90% of the time these lines are drawn in, usually at about the same strength as the topline.**"*

**SECONDARY TOPLINES:** *"**Where the ridgelines have sharp angles there are sometimes secondary toplines that come out from the point of the angle and run parallel to the mountain topline.**… **They appear on about 20% of the candidate ridgeline angles. The secondary toplines are slightly fainter than the toplines but still significantly darker than the lines used in the shadows hashing.**"* Implementation: *"**All told, secondary toplines appear on about half the mountains, and never on the smallest mountains.**"* Two hard requirements for the shading step: *"**First, I need the secondary toplines to come all the way to the baseline (even if I don't draw them all the way). Second, I need to make sure the secondary toplines are always in order from the top of the peak downward so I can pick off the areas in the same order each time.**"*

**Topline rendering recipe** ([P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html)), in order: draw in base color → isolate and fade the shadow-side end (*"**To account for the breaks and fade segments, I have to split the line four times**"*) → **fade with opacity, never white** (*"**In general, it's best to do fades with opacity if you can**"*) → peak emphasis: *"**overlay a darker, thicker line on top of the top part of the mountain**… **a line that starts narrower than the base topline and fades in while becoming wider and darker. I've also added a small amount of random displacement at the peak end of each line, so they don't always precisely overlay the original line**"* → *"**let the emphasis line be longer on the lit side**… **This works by taking the baseline color and reducing the luminance**"* (the only color formula given) → *"**Some mountains have small texture markings coming down from the lit side of the topline… pointing somewhere between vertical and perpendicular to the topline.**"*

## 5.6 Shading / hatching

**Light direction:** reference map is lit from the **left**; *"**(It's on the left on the reference map, but Dragons Abound usually has it on the right.)**"* ([P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html)). He refactored to support both.

**Shading region = polygon boolean** ([P4](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html)): *"**I'll construct a polygon using the unlit topline and the ridgeline to create the shading area**"* → *"**use a boolean polygon operation to take the difference between the shading polygon and the secondary ridgeline polygon**"* (library: [martinez](https://github.com/w8r/martinez)) → *"**do the opposite and add shading to the secondary ridgelines on the lit side**"* → **multi-facet split:** *"**separate the single shading area into two areas along the secondary topline and rotate the hatching angle on the second surface**… **The second shading area… gets a hatching that is parallel to the secondary topline.**"*

**Hatch angle rules:** default **perpendicular to the topline**; *"**In each adjacent region the direction of the hatching for the shaded areas rotates 90 degrees**"*; second facet **parallel to the secondary topline**.

**The hatch/scribble sweep — verbatim formulas** ([Scribbled Notes](https://heredragonsabound.blogspot.com/2016/11/scribbled-notes.html)): slope `mu` given; set `y_s = y_min`, `y_e = y_max` over the polygon; sweep range from
```
x_i = x_1 - (y_s-y_1)/mu
```
computed for every vertex, keeping `x_min`, `x_max`. Intersection routine, verbatim:
```javascript
function line_seg_intersect(x1, y1, x2, y2, x3, y3, x4, y4)
{
    var ua, ub, denom = (y4 - y3)*(x2 - x1) - (x4 - x3)*(y2 - y1);
    if (denom != 0) {
       ua = ((x4 - x3)*(y1 - y3) - (y4 - y3)*(x1 - x3))/denom;
       ub = ((x2 - x1)*(y1 - y3) - (y2 - y1)*(x1 - x3))/denom;
       if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) 
         return [x1 + ua*(x2 - x1), y1 + ua*(y2 - y1)];
    };
    return null;
}
```
Sweep logic: *"**These points are where my pencil turns around when shading by hand**… The scribble is created by **going back and forth between the points of intersection**"*; *"**an infinite line should intersect the polygon in an even number of points**"*; sort by Y; dedupe (a line hitting a vertex finds the same intersection twice); *"**ignore the single intersection cases**"*; and **the concavity policy that worked**: *"**restart all the paths whenever the number of paths changes.** Let me try that: **That fixed it!**"*

**Hand-drawn scribble rules** ([More Scribbles](https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html)):
- Arc per stroke: *"**add a new point at the midpoint of the segment, and offset that midpoint a short distance along the perpendicular**… **every other stroke of the scribble I have to swap the offset from side to side**… **It's also a good idea to scale the offset based upon the length of the stroke.**"*
- **Spacing jitter, exact:** *"**I randomly offset the step size by up to half the step size smaller or larger.**"*
- Angle jitter on `mu` as it steps.
- **Inward-only perturbation trick, verbatim:** *"**if you are perturbing a polyline that is in counter-clockwise orientation, the negative numbers perturb the line inward and the positive numbers perturb the line outward. So to perturb only inward, I can just use the negative numbers.**"* (`smoothLine(points.map(d3.randomNormal()), 3)`)
- Clipping is **not** the primary method: *"**The problem with that approach is that you lose the nice 'turnarounds' at the ends of the strokes**… You end up with something that just looks like hatching."*

**Contour hatching is the DEFAULT since 2017** ([The Sunny Side of the Mountain](https://heredragonsabound.blogspot.com/2017/02/the-sunny-side-of-mountain.html)): *"**rather than drawing back and forth as I do with scribbles, I just draw in one direction. On top of that, I make each line trail off as it is drawn, so that it starts thick and gets thinner.**"* + *"**Here I have the shadows darkest right at the ridge lines**… **Orienting the shadows that way makes the mountains look more rounded.**"* + **the only opacity number in the entire blog:** *"**I'm going to start with a simple right to left gradient from 70% transparent to fully transparent**"* → *"**it's now the default shading for the mountains.**"*

**2021 rewrite** ([Pencil Effect P2](https://heredragonsabound.blogspot.com/2021/10/creating-pencil-effect-in-svg-part-2.html)): *"**The basic idea of drawing lines across a polygon at an arbitrary angle by first rotating the polygon and then drawing vertical lines is very clever!**"* ([alienryderflex.com/polygon_hatchline_fill](http://alienryderflex.com/polygon_hatchline_fill/)) + *"**SVG doesn't support multiply blend mode except in filters**… **The good news is that CSS does support a multiply blend mode!**"* → `mix-blend-mode: multiply` per stroke.

**`mtnShadeType`** ([VM P3](https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html), verified): *"**it can have a variety of values: scribble, gradient, contour, flat, gradient+contour, or flat+contour.** But whatever value is used, **it needs to be the same value across all the icons on the map.**"*

## 5.7 Size / scale

- Design size ~**150 px square**, placed by `translate(x y) scale(0.25)` — *"**mountains scaled to 1/4 size (which is about what fits into my current maps)**"* ⇒ glyph ≈ **37 px** wide on the map ([The Incredible Shrinking Mountain](https://heredragonsabound.blogspot.com/2016/12/the-incredible-shrinking-mountain.html)).
- **Line-width compensation:** *"**The line width also gets scaled.**… **The solution is to make the lines thicker as the mountains get smaller, although it turns out that a strict scaling looks 'wrong'… So you have to scale the scaling :-). I find an additional scaling of 1.5 to 2 looks okay.**"* ([Or Maybe Not](https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html))
- Detail simplification at map scale: *"**increase the line width used to draw the mountain outline**… about **twice as thick**"*; *"**increase the spacing between the shading lines and make them thicker**"*; *"the details and the 'hand-drawn' perturbations end up creating a lot of noise when reduced in scale."*
- **`mtnRatioRange` default `[1.25, 1.50]`** (verified verbatim): *"**which means that all the mountains are 25% to 50% wider than they are tall. During the generation of each icon, a random number is picked in this range**."* (His prose calls it "height to width" but reads it as wider-than-tall; operationally **width/height ∈ [1.25, 1.50]** for the old style; the new style uses **2.25–5**, typically 3–4.)
- **`mtnToplineSegments` = 7** (verified): *"**a mountain icon with just 2 topline segments would be a triangle — kind of boring**… **In the end, it turned out that 7 was a pretty good value.**"*
- Snow is **height-triggered, not proportional**: *"**What I really want is for the snow to start at a certain height consistently across the mountains. Because I draw mountains at one scale and size them to the map in a separate step… that turned out to be a bit more challenging than I expected.**"* — i.e. compute the gradient stop in map space, then transform back into the symbol's local design space.

## 5.8 Hills vs mountains

**No numeric symbol-level threshold — it's a continuum** (two *percentile* thresholds exist only at the terrain level, `T`/`T2`). Hills are mountains reconfigured; the exact knob list ([A Detour Into Hills](https://heredragonsabound.blogspot.com/2017/01/a-detour-into-hills.html), verbatim):
1. *"**reduce the size of the mountains and turn off merged mountains**"*
2. *"**I don't want any of the decorations (like the clefts)**"*
3. *"**The outline needs to be heavier, and I don't want jagged perturbations on hills**"*
4. **The key one:** *"**I really want hills to have convex sides to distinguish them more clearly from mountains. Fortunately I can do that by simply changing the sign on the side offset.**"*
5. *"**I also like hills to be broader rather than peakier, so I'll tweak the proportion of the width to the height**"*
6. *"**turn on the 'round tops' option and add a flat piece at the top**"*
7. *"**I'd like to curve that [shadow] line to suggest the hill is round**… this is the same operation I apply to the sides when I make them concave (for mountains) or convex (for hills)"*
8. Cast shadow: *"**just a line from the base of the hill that tapers off to nothing**"*

Final hill shape he kept = **a bell curve** ([Still In the Hills](https://heredragonsabound.blogspot.com/2017/01/still-in-hills.html)): *"**The shape of my hills is essentially a semi-circle; I want something that is more like a bell shape.** A little searching led me to [this SO posting] that discusses how to draw a bell-like shape in SVG using Bezier curves"* ([SO 39485232](http://stackoverflow.com/questions/39485232/svg-draw-dashed-bell-curve-between-2-points#39487727)) — *"**In fact, these hills look so nice it's making me re-think my approach to the mountains**"* (this directly caused the Bézier-continuum rewrite). Earlier v1 was *"**just semi-circular arcs**"* for the D&D style, with an SVG noise filter *"to make the hills look more amateur-ish."*

New style: *"**nearly every mountain has a ridgeline; the only exceptions are the smallest faint mountains (hills)**"* and *"secondary toplines… **never on the smallest mountains**."* Hill fill = **land color** (it was hard-coded green — a bug fixed in [Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html)).

## 5.9 Mountain colors / widths / opacity — complete list (no hex anywhere)

| Quantity | Value | Source |
|---|---|---|
| Mountain fill | **sampled land color at center bottom of the mountain** | [Purple Mountain Majesties](https://heredragonsabound.blogspot.com/2017/01/purple-mountain-majesties.html) |
| Hill fill | **land color** | [Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html) |
| Topline emphasis | *"taking the baseline color and **reducing the luminance**"* | [P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html) |
| Contour lines | *"a little **darker than the base color** of the mountain"* | [Iskloft](https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html) |
| Knurden shadow | **15–20% darker than the background** | [Knurden Mtn P2](https://heredragonsabound.blogspot.com/2020/12/knurden-style-mountains-part-2.html) |
| Knurden highlight | *"more yellow… **by adding some green and taking away some blue**"* | same |
| Shading gradient | **70% transparent → fully transparent, right to left** | [Sunny Side](https://heredragonsabound.blogspot.com/2017/02/the-sunny-side-of-mountain.html) |
| Line width | **1.5 pt → 3 pt**, in **0.25 pt** increments | [Draw the Line](https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html) |
| Stroke linecap | **`round`** | srt19170 gist |
| Scale-down width compensation | extra factor **1.5–2** | [Or Maybe Not](https://heredragonsabound.blogspot.com/2017/02/or-maybe-not-lets-try-again.html) |
| Iskloft contour lines | **black, ≈ outline thickness, usually just 3 per mountain** | [Iskloft](https://heredragonsabound.blogspot.com/2019/04/iskloft-mountain-style.html) |
| Trail-off | **opacity, never white** | [P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html)/[P4](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html) |
| Gradient interpolation | *"**interpolating evenly in RGB space**"* | [VM P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html) |

**Pencil SVG filters — verbatim, exact attribute values** ([Creating a Pencil Effect in SVG](https://heredragonsabound.blogspot.com/2020/02/creating-pencil-effect-in-svg.html); published at [codepen.io/srt19170/pen/oNNQmRw](https://codepen.io/srt19170/pen/oNNQmRw)):
```xml
<filter id="roughPaper" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="128" numOctaves="1" result="noise"/>
  <feDiffuseLighting in="noise" lighting-color="white" surfaceScale="1" result="diffLight">
    <feDistantLight azimuth="45" elevation="55"/>
  </feDiffuseLighting>
  <feGaussianBlur in="diffLight" stdDeviation="0.75" result="dlblur"/>
  <feComposite operator="arithmetic" k1="1.2" k2="0" k3="0" k4="0" in="dlblur" in2="SourceGraphic" result="out"/>
</filter>

<filter id="PencilTexture" x="-2%" y="-2%" width="104%" height="104%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="3" result="noise"/>
  <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="3" in="SourceGraphic" result="newSource"/>
</filter>

<filter id="pencilTexture2" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
  <feTurbulence type="fractalNoise" baseFrequency="2" numOctaves="5" stitchTiles="stitch" result="f1"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -1.5 1.5" result="f2"/>
  <feComposite operator="in" in2="f2" in="SourceGraphic" result="f3"/>
</filter>
```
Caveat: *"**the displacement is in absolute units, rather than relative to the line size**… So I have to pick a value that doesn't create distortion in the thinner lines."*

---

# 6. GAPS — things the blog genuinely does not contain

1. **The numeric value of `C`** in `width = flux/(slope + C)`. `getRivers(h, 0.01)` is O'Leary's threshold, not confirmed for DA.
2. **Any hex color, anywhere.** The HSL water hue range **0.50–0.60** is the only concrete color spec; everything else is relative ("15–20% darker", "reduce the luminance", "sampled land color").
3. **Poisson radius / tree spacing values** — tuned by eye only.
4. **Annealing cooling schedule, acceptance probability, and all energy-function weights.**
5. **Font sizes in px** (except the compass DSL `14 | 16 | 18`) and **letter-spacing values**.
6. **Meander step magnitude and the curvature clamp range** (only the 75/25 mix and 10 iterations are numeric).
7. **Lake shape generation** — never described beyond "stickers… placed randomly".
8. **No Chaikin, no `curveBasis`, no tension parameter** anywhere in the pipeline. The only curve in the codebase is **`d3.curveCatmullRom.alpha(1.0)`**.
9. **Tree size-by-elevation/edge-distance** and **tree halos** — never built (halos are labels-only).

**Sources:** [Here Dragons Abound](https://heredragonsabound.blogspot.com/) · [Back In the Woods P1](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-1-introduction.html)–[P2](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-2-drawing-tree.html)–[P3](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-3-tree-shapes.html)–[P4](https://heredragonsabound.blogspot.com/2018/04/back-in-woods-part-4-trunks.html)–[P5](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-5-texture.html)–[P6](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-6-shading.html)–[P7](https://heredragonsabound.blogspot.com/2018/05/back-in-woods-part-7-conifers.html) · [One of the (Forest) Masses](https://heredragonsabound.blogspot.com/2017/03/one-of-forest-masses.html) · [Sprucing Up the Forest](https://heredragonsabound.blogspot.com/2017/03/sprucing-up-forest.html) · [On (Erkaman's) Cloud 9](https://heredragonsabound.blogspot.com/2017/03/on-erkamans-cloud-9.html) · [Knurden Trees P4](https://heredragonsabound.blogspot.com/2021/01/knurden-style-trees-part-4.html) · [Knurden Forests P5](https://heredragonsabound.blogspot.com/2021/02/knurden-style-forests-part-5.html) · [Haunted Forests](https://heredragonsabound.blogspot.com/2021/10/haunted-forests.html) · [Cleanup Time](https://heredragonsabound.blogspot.com/2022/06/cleanup-time.html) · [This Is Where I Draw the Line](https://heredragonsabound.blogspot.com/2016/11/this-is-where-i-draw-line.html) · [More Scribbles](https://heredragonsabound.blogspot.com/2016/11/more-scribbles.html) · [Scribbled Notes](https://heredragonsabound.blogspot.com/2016/11/scribbled-notes.html) · [A Different Way to Draw a Line](https://heredragonsabound.blogspot.com/2017/10/a-different-way-to-draw-line.html) · [Various Miscellany P2 (2017-04)](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html) · [Various Miscellany P4](https://heredragonsabound.blogspot.com/2019/01/various-miscellany-part-4.html) · [Sprucing up the Rivers](https://heredragonsabound.blogspot.com/2018/10/sprucing-up-rivers.html) · [A Meandering Subject](https://heredragonsabound.blogspot.com/2020/07/a-meandering-subject.html) · [Delta Drawn P1](https://heredragonsabound.blogspot.com/2020/08/delta-drawn-part-1.html)/[P2](https://heredragonsabound.blogspot.com/2020/10/delta-drawn-part-2.html) · [Decorating the Ocean P1](https://heredragonsabound.blogspot.com/2017/07/decorating-ocean-part-one.html)/[P2](https://heredragonsabound.blogspot.com/2017/06/decorating-ocean-part-two.html) · [Simulated Annealing](https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html) · [Area Labels](https://heredragonsabound.blogspot.com/2017/05/area-labels.html) · [Some Initial Optimizations](https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html) · Path Labels [P1](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html) [P2](https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html) [P3](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html) [P4](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html) [P5](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html) [P6](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html) [P7](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html) · [Labeling the Ocean P1](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html)/[P2](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-two.html) · [Labeling the Coast P1](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-one.html)/[P2](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html) · [Naming Forests](https://heredragonsabound.blogspot.com/2019/01/naming-forests.html) · [Knurden Labels P6](https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html) · [Map Compasses P8](https://heredragonsabound.blogspot.com/2021/12/map-compasses-part-8-radial-text.html)/[P9](https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html)/[P14](https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html) · [Mountains](https://heredragonsabound.blogspot.com/2016/10/mountains.html) · [It's Not My Fault](https://heredragonsabound.blogspot.com/2016/10/its-not-my-fault.html) · [Mountain Placement](https://heredragonsabound.blogspot.com/2017/02/mountain-placement.html) · New Mountain Style [P1](https://heredragonsabound.blogspot.com/2019/11/new-mountains-and-new-approach-part-1.html) [P2](https://heredragonsabound.blogspot.com/2019/11/new-mountain-style-part-2.html) [P3](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-3.html) [P4](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-4.html) [P5](https://heredragonsabound.blogspot.com/2019/12/new-mountain-style-part-5.html) [P6](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-6.html) [P7](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-7.html) [P8](https://heredragonsabound.blogspot.com/2020/01/new-mountain-style-part-8.html) [P9](https://heredragonsabound.blogspot.com/2020/02/new-mountain-style-part-9.html) · [Various Miscellany P3](https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html) · [Lord of the Rings Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) · [Learning from Azgaar](https://heredragonsabound.blogspot.com/2019/10/learning-from-azgaar-terrain-generation.html) · External: [srt19170 gist](https://gist.github.com/srt19170/06a032e541cb4208a3e47a64f7b4687c) · [mewo2/terrain](https://github.com/mewo2/terrain/blob/master/terrain.js) · [beaugunderson/poisson-disc-sampler](https://github.com/beaugunderson/poisson-disc-sampler) · [polyline-normals](https://www.npmjs.com/package/polyline-normals) · [Erkaman/cloud_gen](https://github.com/Erkaman/cloud_gen) · [w8r/martinez](https://github.com/w8r/martinez) · [w8r/polygon-offset](https://github.com/w8r/polygon-offset)

agentId: afdb344b7bd4544c1 (use SendMessage with to: 'afdb344b7bd4544c1', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 230863
tool_uses: 29
duration_ms: 1461037</usage>