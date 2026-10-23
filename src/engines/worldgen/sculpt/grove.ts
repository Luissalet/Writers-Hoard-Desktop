// ============================================
// Sculpt — the tabletop model's standing trees
// ============================================
// On the painted skin the forests are painted on the ground as crowds of little
// trees. Seen as a tabletop model, a painted tree lying flat is a sticker; what
// a model maker does is stand them up: little cones and crowns glued on the
// relief, a few thousand of them, sized for the model and not for the world (a
// tree to scale would be a millionth of the block).
//
// So this is not the scatter (sculpt/scatter.ts), which sows true-to-frame
// plants for the close landscape and switches itself off at the scale of a
// whole land. The grove only exists on the tabletop model: one deterministic
// sowing over the block's window, refreshed when the ground or the window
// changes, never per frame.
//
// The forests and the kinds of tree are the painted skin's own table
// (cartography/paintedGround.ts), so the trees that stand up are the ones that
// were painted: conifers in the boreal and montane belts, broad crowns in the
// temperate woods, round dark jungle, purple fungal stalks, grey dead trunks.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FORESTS, PALETTES, type TreeKind } from '../cartography/paintedGround';

export interface GroveGround {
  /** Elevation in km at a point of the world, u east, v south, both 0–1. */
  heightAt(u: number, v: number): number;
  biome: Uint8Array;
  width: number;
  height: number;
  seed: string;
}

export interface GroveFrame { u: number; v: number; su: number; sv: number }

export interface Grove {
  group: THREE.Group;
  /** Sow again over the block: the whole world, or a framed window of it. */
  setGround(ground: GroveGround, frame: GroveFrame | null): void;
  update(o: {
    visible: boolean;
    /** Scene units per km of height. */
    yMul: number;
    /** Paper sheets: the trees stand on the sheet their ground is lifted to (km; 0 = none). */
    terrace: number;
    /** Direction TO the sun, normalized. */
    sun: THREE.Vector3;
    sunColor: THREE.Color;
    sunIntensity: number;
    ambient: THREE.Color;
  }): void;
  stats(): { trees: number; kinds: number };
  dispose(): void;
}

const TREE_VERT = /* glsl */`
out vec3 vN;
out vec3 vCol;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TREE_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uBark;
uniform float uTrunk;
in vec3 vN;
in vec3 vCol;
out vec4 outColor;
void main() {
  vec3 n = normalize(vN);
  float lam = max(dot(n, uSun), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 base = uTrunk > 0.5 ? uBark : vCol;
  outColor = vec4(base * (uAmb * (0.42 + 0.3 * sky) + uSunCol * 0.78 * lam), 1.0);
}
`;

const KINDS: TreeKind[] = ['conifer', 'broad', 'jungle', 'fungal', 'dead'];
/** Sites across the block: enough for a forest to read, few enough to stay a model. */
const SITES_WHOLE = 210;
const SITES_FRAMED = 150;
/** The most trees a block carries. */
const MAX_TREES = 9000;

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

/** One tree of each kind, one unit tall, its foot at the origin: trunk and crown as two geometries. */
function treeParts(kind: TreeKind): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunkOf = (h: number, r: number) => { const g = new THREE.CylinderGeometry(r * 0.75, r, h, 5, 1, false); g.translate(0, h / 2, 0); return g; };
  if (kind === 'conifer') {
    const a = new THREE.ConeGeometry(0.30, 0.55, 7); a.translate(0, 0.42, 0);
    const b = new THREE.ConeGeometry(0.22, 0.45, 7); b.translate(0, 0.72, 0);
    const crown = mergeGeometries([a.toNonIndexed(), b.toNonIndexed()])!; a.dispose(); b.dispose();
    return { trunk: trunkOf(0.22, 0.05), crown };
  }
  if (kind === 'dead') {
    const t = trunkOf(0.8, 0.05);
    const branch = new THREE.CylinderGeometry(0.02, 0.03, 0.34, 4); branch.rotateZ(0.8); branch.translate(0.1, 0.62, 0);
    const branch2 = new THREE.CylinderGeometry(0.02, 0.03, 0.28, 4); branch2.rotateZ(-0.9); branch2.translate(-0.09, 0.5, 0);
    const crown = mergeGeometries([branch.toNonIndexed(), branch2.toNonIndexed()])!; branch.dispose(); branch2.dispose();
    return { trunk: t, crown };
  }
  if (kind === 'fungal') {
    const cap = new THREE.SphereGeometry(0.34, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.55, 1); cap.translate(0, 0.62, 0);
    return { trunk: trunkOf(0.66, 0.07), crown: cap };
  }
  // Broad and jungle: a lumpy round crown on a short trunk; jungle is wider and darker.
  const crown = new THREE.IcosahedronGeometry(kind === 'jungle' ? 0.36 : 0.32, 1);
  const pos = crown.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 23 + z * 17) * Math.cos(y * 19);
    pos.setXYZ(i, x * k, y * k * 0.86, z * k);
  }
  crown.computeVertexNormals();
  crown.translate(0, kind === 'jungle' ? 0.58 : 0.6, 0);
  return { trunk: trunkOf(0.34, 0.05), crown };
}

export function createGrove(o: { sizeX: number; sizeZ: number }): Grove {
  const group = new THREE.Group();
  group.name = 'tabletop trees';
  group.visible = false;
  // Their own small lamp, in a shader: three's lights are global to the scene,
  // and a light added here would also light the place models a second time.
  const uniforms = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(1, 1, 1) },
  };
  const material = (trunk: boolean) => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...uniforms, uTrunk: { value: trunk ? 1 : 0 }, uBark: { value: new THREE.Color(0.36, 0.27, 0.19) } },
    vertexShader: TREE_VERT,
    fragmentShader: TREE_FRAG,
  });
  const trunkMat = material(true);
  const crownMat = material(false);
  const meshes = new Map<TreeKind, { trunk: THREE.InstancedMesh; crown: THREE.InstancedMesh }>();
  // Per kind: where each tree stands (scene x, z), its ground in km, its height and turn.
  let sown = new Map<TreeKind, { x: Float32Array; z: Float32Array; km: Float32Array; h: Float32Array; turn: Float32Array; tint: Float32Array; n: number }>();
  let placedFor = '';
  let trees = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  const clear = () => {
    for (const { trunk, crown } of meshes.values()) {
      group.remove(trunk, crown);
      trunk.geometry.dispose(); crown.geometry.dispose();
      trunk.dispose(); crown.dispose();
    }
    meshes.clear();
  };

  return {
    group,
    setGround(ground, frame) {
      clear();
      sown = new Map();
      placedFor = '';
      trees = 0;
      const u0 = frame ? frame.u - frame.su / 2 : 0, v0 = frame ? frame.v - frame.sv / 2 : 0;
      const fu = frame ? frame.su : 1, fv = frame ? frame.sv : 1;
      const widthX = o.sizeX * fu, depthZ = o.sizeZ * fv;
      const across = frame ? SITES_FRAMED : SITES_WHOLE;
      const step = widthX / across;
      const down = Math.max(1, Math.round(depthZ / step));
      const seed = seedOf(ground.seed);
      const { width: W, height: H, biome } = ground;
      const lists = new Map<TreeKind, { x: number[]; z: number[]; km: number[]; h: number[]; turn: number[]; tint: number[] }>();
      // Too many sites for the cap: every k-th one over the whole block, so no edge is left bare.
      const stride = Math.max(1, Math.ceil((across * down * 0.45) / MAX_TREES));
      for (let j = 0; j < down && trees < MAX_TREES; j++) {
        for (let i = 0; i < across && trees < MAX_TREES; i++) {
          if (stride > 1 && ((j * across + i) * 2654435761 >>> 0) % stride !== 0) continue;
          const jx = hash2(i, j, seed + 5), jz = hash2(i, j, seed + 11);
          const u = u0 + ((i + 0.1 + 0.8 * jx) / across) * fu;
          const v = v0 + ((j + 0.1 + 0.8 * jz) / down) * fv;
          if (v <= 0 || v >= 1) continue;
          const uw = ((u % 1) + 1) % 1;
          const cx = Math.min(W - 1, Math.floor(uw * W)), cy = Math.min(H - 1, Math.floor(v * H));
          const f = FORESTS[biome[cy * W + cx]];
          if (!f) continue;
          // Sparse ground (savanna, scrub) keeps its few trees; a closed forest stands thick but not shoulder to shoulder.
          if (hash2(i, j, seed) > Math.min(0.62, f.density * 0.66)) continue;
          const km = ground.heightAt(Math.min(0.999999, uw), Math.min(0.999999, Math.max(0, v)));
          if (km <= 0.01) continue;
          const kind = f.mixed && hash2(i, j, seed + 41) < 0.4 ? f.mixed : f.kind;
          let list = lists.get(kind);
          if (!list) { list = { x: [], z: [], km: [], h: [], turn: [], tint: [] }; lists.set(kind, list); }
          list.x.push((u - 0.5) * o.sizeX);
          list.z.push((v - 0.5) * o.sizeZ);
          list.km.push(km);
          list.h.push(step * 1.55 * (f.size ?? 1) * (0.78 + 0.44 * hash2(j, i, seed + 77)));
          list.turn.push(hash2(i + 3, j + 7, seed) * Math.PI * 2);
          list.tint.push(Math.floor(hash2(i - 1, j + 2, seed + 53) * 3));
          trees++;
        }
      }
      for (const kind of KINDS) {
        const list = lists.get(kind);
        if (!list || !list.x.length) continue;
        const n = list.x.length;
        sown.set(kind, { x: Float32Array.from(list.x), z: Float32Array.from(list.z), km: Float32Array.from(list.km), h: Float32Array.from(list.h), turn: Float32Array.from(list.turn), tint: Float32Array.from(list.tint), n });
        const parts = treeParts(kind);
        const trunk = new THREE.InstancedMesh(parts.trunk, trunkMat, n);
        const crown = new THREE.InstancedMesh(parts.crown, crownMat, n);
        trunk.frustumCulled = false; crown.frustumCulled = false;
        trunk.name = `tabletop-trunks-${kind}`; crown.name = `tabletop-crowns-${kind}`;
        const color = new THREE.Color();
        for (let k = 0; k < n; k++) {
          const [r, g, b] = PALETTES[kind][list.tint[k]];
          // Display values, as the shaders of this scene write them.
          color.setRGB(r / 255, g / 255, b / 255);
          crown.setColorAt(k, color);
        }
        if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
        meshes.set(kind, { trunk, crown });
        group.add(trunk, crown);
      }
    },
    update(u) {
      group.visible = u.visible && trees > 0;
      if (!group.visible) return;
      uniforms.uSun.value.copy(u.sun).normalize();
      const power = Math.max(0, Math.min(1, u.sunIntensity));
      uniforms.uSunCol.value.copy(u.sunColor).multiplyScalar(power);
      // The ambient as the terrain takes it: normalized to a luminance of one, dimmed with the day.
      const lum = Math.max(1e-3, 0.2126 * u.ambient.r + 0.7152 * u.ambient.g + 0.0722 * u.ambient.b);
      uniforms.uAmb.value.copy(u.ambient).multiplyScalar((0.12 + 0.88 * Math.pow(power, 0.65)) / lum);
      const key = `${u.yMul}:${u.terrace}`;
      if (key === placedFor) return;
      placedFor = key;
      for (const [kind, s] of sown) {
        const mesh = meshes.get(kind)!;
        for (let k = 0; k < s.n; k++) {
          let km = s.km[k];
          if (u.terrace > 0 && km > 0) km = Math.ceil(km / u.terrace) * u.terrace;
          p.set(s.x[k], km * u.yMul, s.z[k]);
          q.setFromAxisAngle(up, s.turn[k]);
          sc.setScalar(s.h[k]);
          m.compose(p, q, sc);
          mesh.trunk.setMatrixAt(k, m);
          mesh.crown.setMatrixAt(k, m);
        }
        mesh.trunk.instanceMatrix.needsUpdate = true;
        mesh.crown.instanceMatrix.needsUpdate = true;
      }
    },
    stats() { return { trees, kinds: meshes.size }; },
    dispose() {
      clear();
      trunkMat.dispose(); crownMat.dispose();
    },
  };
}
