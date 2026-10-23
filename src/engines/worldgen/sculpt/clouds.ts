// ============================================
// Sculpt — clouds over the plane
// ============================================
// Clouds for the tabletop model and for the landscape seen whole: soft heaps of
// puffs floating above the highest ground, gathered where the world is wet
// (the precipitation field decides which candidate spots keep a cloud), lit
// from the top by the same sun as the ground, and casting a soft shadow on it.
//
// Billboards, not volumes: each puff is a camera-facing quad whose fragment
// draws a lumpy disc, so a cloud of eight puffs costs eight quads and one draw
// call for all of them. Alpha-blended after the opaque scene, depth-tested so a
// mountain can stand in front of a cloud, and never writing depth.
//
// The shadows are drawn by the terrain shader (SculptSurface.setCloudShadows):
// each cloud hands it a disc on the ground, pushed away from the sun by the
// cloud's height, and the ground darkens softly inside it.
//
// Deterministic: the puffs come from a hash of the world's seed; they drift
// only with the scene's own clock, which advances while the sea animates.

import * as THREE from 'three';

export interface CloudGround {
  heightAt(u: number, v: number): number;
  precipitation: Float32Array;
  width: number;
  height: number;
  seed: string;
}

export interface CloudFrame { u: number; v: number; su: number; sv: number }

export interface Clouds {
  group: THREE.Object3D;
  setGround(ground: CloudGround, frame: CloudFrame | null): void;
  update(o: {
    visible: boolean;
    /** 0–1: fades the clouds out as the landscape closes in. */
    fade: number;
    yMul: number;
    sun: THREE.Vector3;
    sunColor: THREE.Color;
    sunIntensity: number;
    ambient: THREE.Color;
    time: number;
  }): void;
  /** The ground discs of the cloud shadows, (x, z, radius, strength) in scene units; empty when hidden. */
  shadows(): Float32Array;
  stats(): { clouds: number; puffs: number };
  dispose(): void;
}

/** At most this many clouds (the terrain shader takes one shadow per cloud). */
export const MAX_CLOUDS = 40;
const PUFFS_PER_CLOUD = 9;

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

const VERT = /* glsl */`
in vec3 aCenter;    // the puff's centre, scene units (y above the ground's top)
in float aSize;     // its radius, scene units
in float aSeed;
uniform float uLift;   // the clouds' floor above sea level, scene units
uniform float uDrift;  // how far the wind has carried them, scene units
uniform vec4 uRect;    // x0, z0, x1, z1 of the block (or the world)
out vec2 vQ;
out float vSeed;
out float vEdge;
void main() {
  vec3 c = aCenter;
  float w = uRect.z - uRect.x;
  // Carried east by the wind, and brought round at the far edge.
  c.x = uRect.x + mod(c.x - uRect.x + uDrift, w);
  c.y += uLift;
  // Fade where a puff is about to wrap, so none pops from one edge to the other.
  float fromEdge = min(c.x - uRect.x, uRect.z - c.x) / max(1e-4, w);
  vEdge = smoothstep(0.0, 0.05, fromEdge);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * aSize;
  vQ = position.xy;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;
in vec2 vQ;
in float vSeed;
in float vEdge;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uFade;
out vec4 outColor;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vQ;
  float r = length(q);
  // A lumpy rim: the edge wanders with an angle-dependent noise of its own.
  float ang = atan(q.y, q.x);
  float rim = 0.78 + 0.16 * noise(vec2(ang * 2.2 + vSeed * 31.0, vSeed * 7.0)) + 0.06 * noise(q * 6.0 + vSeed * 13.0);
  float a = 1.0 - smoothstep(rim * 0.55, rim, r);
  if (a <= 0.003) discard;
  a *= 0.72 * vEdge * uFade;
  // Lit from above: bright tops, a grey belly.
  float top = clamp(0.55 + 0.6 * q.y, 0.0, 1.0);
  vec3 lit = uSunCol * 0.95 + uAmb * 0.55;
  vec3 belly = uAmb * 0.72;
  vec3 col = mix(belly, lit, top) * (0.94 + 0.08 * noise(q * 3.0 + vSeed * 5.0));
  outColor = vec4(min(col, vec3(1.0)), a);
}
`;

export function createClouds(o: { sizeX: number; sizeZ: number }): Clouds {
  const quad = new THREE.PlaneGeometry(2, 2);
  const freshGeometry = () => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    return g;
  };
  let geometry = freshGeometry();
  const uniforms = {
    uLift: { value: 0 },
    uDrift: { value: 0 },
    uRect: { value: new THREE.Vector4(-o.sizeX / 2, -o.sizeZ / 2, o.sizeX / 2, o.sizeZ / 2) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  let clouds: { x: number; z: number; r: number; dens: number }[] = [];
  let puffs = 0;
  let rect = { x0: -o.sizeX / 2, z0: -o.sizeZ / 2, x1: o.sizeX / 2, z1: o.sizeZ / 2 };
  let topKm = 0;
  let lift = 0;
  let drift = 0;
  let shadowDiscs = new Float32Array(0);
  const sunFlat = new THREE.Vector2();

  return {
    group: mesh,
    setGround(ground, frame) {
      const u0 = frame ? frame.u - frame.su / 2 : 0, v0 = frame ? frame.v - frame.sv / 2 : 0;
      const fu = frame ? frame.su : 1, fv = frame ? frame.sv : 1;
      rect = { x0: (u0 - 0.5) * o.sizeX, z0: (v0 - 0.5) * o.sizeZ, x1: (u0 + fu - 0.5) * o.sizeX, z1: (v0 + fv - 0.5) * o.sizeZ };
      const widthX = rect.x1 - rect.x0, depthZ = rect.z1 - rect.z0;
      const seed = seedOf(ground.seed) ^ 0x5bd1e995;
      const { width: W, height: H, precipitation } = ground;
      // The highest ground under the block, for the clouds' floor.
      topKm = 0;
      const probe = 64;
      for (let j = 0; j <= probe; j++) for (let i = 0; i <= probe; i++) {
        const u = u0 + (i / probe) * fu, v = Math.min(0.999999, Math.max(0, v0 + (j / probe) * fv));
        topKm = Math.max(topKm, ground.heightAt(((u % 1) + 1) % 1, v));
      }
      // Candidates on a jittered grid; the wet keep theirs, the dry mostly do not.
      clouds = [];
      const across = 9, down = Math.max(3, Math.round(across * depthZ / widthX));
      for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) {
        if (clouds.length >= MAX_CLOUDS) break;
        const fx = (i + 0.15 + 0.7 * hash2(i, j, seed + 1)) / across, fz = (j + 0.15 + 0.7 * hash2(i, j, seed + 2)) / down;
        const u = u0 + fx * fu, v = Math.min(0.999, Math.max(0.001, v0 + fz * fv));
        const cx = Math.min(W - 1, Math.floor((((u % 1) + 1) % 1) * W)), cy = Math.min(H - 1, Math.floor(v * H));
        const rain = precipitation[cy * W + cx] ?? 0;
        const keep = Math.min(0.75, Math.max(0.1, rain / 1900));
        if (hash2(i, j, seed + 3) > keep) continue;
        clouds.push({ x: rect.x0 + fx * widthX, z: rect.z0 + fz * depthZ, r: widthX * (0.022 + 0.024 * hash2(i, j, seed + 4)), dens: 0.5 + 0.5 * keep });
      }
      // The puffs: a flattened heap round each cloud's centre, the middle ones higher.
      const centers: number[] = [], sizes: number[] = [], seeds: number[] = [];
      clouds.forEach((c, k) => {
        for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
          const a = hash2(k, p, seed + 7) * Math.PI * 2, d = Math.sqrt(hash2(k, p, seed + 8)) * c.r;
          const px = c.x + Math.cos(a) * d * 1.3, pz = c.z + Math.sin(a) * d * 0.8;
          const middle = 1 - d / c.r;
          centers.push(px, c.r * (0.15 + 0.45 * middle), pz);
          sizes.push(c.r * (0.42 + 0.3 * middle + 0.12 * hash2(k, p, seed + 9)));
          seeds.push(hash2(k, p, seed + 10));
        }
      });
      puffs = sizes.length;
      // A new geometry each sowing, and the old one's buffers let go.
      const old = geometry;
      geometry = freshGeometry();
      mesh.geometry = geometry;
      old.dispose();
      geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
      geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
      geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
      geometry.instanceCount = puffs;
      uniforms.uRect.value.set(rect.x0, rect.z0, rect.x1, rect.z1);
      shadowDiscs = new Float32Array(clouds.length * 4);
    },
    update(u) {
      mesh.visible = u.visible && puffs > 0 && u.fade > 0.01;
      if (!mesh.visible) return;
      const widthX = rect.x1 - rect.x0;
      // Above the highest ground of the block, by a share of its width.
      lift = Math.max(topKm * u.yMul, 0) + widthX * 0.035;
      uniforms.uLift.value = lift;
      // A slow wind: a tenth of the block every minute of the scene's clock.
      drift = (u.time * widthX * 0.1 / 60) % widthX;
      uniforms.uDrift.value = drift;
      uniforms.uFade.value = u.fade;
      const power = Math.max(0, Math.min(1, u.sunIntensity));
      uniforms.uSunCol.value.copy(u.sunColor).multiplyScalar(power);
      const lum = Math.max(1e-3, 0.2126 * u.ambient.r + 0.7152 * u.ambient.g + 0.0722 * u.ambient.b);
      uniforms.uAmb.value.copy(u.ambient).multiplyScalar((0.18 + 0.82 * Math.pow(power, 0.65)) / lum);
      // Each cloud's shadow, thrown down and away from the sun by its height.
      const s = u.sun;
      sunFlat.set(s.x, s.z);
      const k = lift / Math.max(0.25, s.y);
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        let x = rect.x0 + ((((c.x - rect.x0 + drift) % widthX) + widthX) % widthX);
        const fromEdge = Math.min(x - rect.x0, rect.x1 - x) / Math.max(1e-6, widthX);
        x -= sunFlat.x * k;
        const z = c.z - sunFlat.y * k;
        shadowDiscs[i * 4] = x; shadowDiscs[i * 4 + 1] = z; shadowDiscs[i * 4 + 2] = c.r * 1.25;
        // Fading where the cloud is about to come round the far edge, as its puffs do.
        const edge = Math.max(0, Math.min(1, fromEdge / 0.05));
        shadowDiscs[i * 4 + 3] = 0.3 * c.dens * power * u.fade * edge * edge * (3 - 2 * edge);
      }
    },
    shadows() { return mesh.visible ? shadowDiscs : new Float32Array(0); },
    stats() { return { clouds: clouds.length, puffs }; },
    dispose() { geometry.dispose(); quad.dispose(); material.dispose(); },
  };
}
