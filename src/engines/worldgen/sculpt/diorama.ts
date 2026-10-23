// ============================================
// Sculpt — the tabletop model ("Maqueta")
// ============================================
// The whole world on the plane, presented as an object: a block cut out of
// the planet and set on a table. Three things make the eye read it as a model
// rather than as a sheet floating in a void:
//
//   1. THE CUT. Four walls run from the ground (or the sea surface) down to a
//      common base, and show what a cut would show: the water column where the
//      edge falls in the sea, a band of soil under the surface, rock strata
//      below that waver along the cut, and a darker plinth at the foot.
//   2. THE TABLE. A plane under the block, lit like a studio floor, that fades
//      into the backdrop so it has no edge of its own.
//   3. THE SHADOW. A soft contact shadow under the block, nudged away from
//      the sun, which is what sets the block down instead of hanging it.
//
// The walls keep their heights in km and are raised in the vertex shader, so
// the exaggeration slider costs a uniform, not a rebuild. Rebuild only when
// the ground changes (the same moments the scatter is resown).
//
// Deterministic: no clocks and no random numbers; the strata wobble is a sum
// of sines of the position along the cut.

import * as THREE from 'three';

export type StageStyle = 'maqueta' | 'paisaje';
/** How the block looks: cut rock, stacked paper or an engraving. */
export type BlockLook = 'roca' | 'papel' | 'grabado';
export const STAGE_STYLES: StageStyle[] = ['maqueta', 'paisaje'];

export interface DioramaOptions {
  sizeX: number;
  sizeZ: number;
}

export interface DioramaGround {
  /** Elevation in km at a point of the world, u east, v south, both 0–1. */
  heightAt(u: number, v: number): number;
  /** Cells across and down, to choose how finely the cut follows the ground. */
  width: number;
  height: number;
}

export interface Diorama {
  group: THREE.Group;
  /**
   * Re-read the ground along the four edges. With a frame (centre u, v and a
   * size in uv) the block is that window of the world: a single island on the
   * table rather than the whole planet.
   */
  setGround(ground: DioramaGround, frame?: { u: number; v: number; su: number; sv: number }): void;
  update(o: {
    visible: boolean;
    yMul: number;
    /** Direction TO the sun, normalized. */
    sun: THREE.Vector3;
    /** 0 night … 1 noon: how strongly the sun lights the cut and casts the shadow. */
    light: number;
    /** How the block looks (default rock). */
    look?: BlockLook;
    /** Paper sheets: the thickness of one, in km (0 = the ground as it is). */
    terrace?: number;
  }): void;
  /** The colour the backdrop and the far table fade to. */
  readonly backdrop: THREE.Color;
  /** Read back for tests: lowest edge ground, base depth and samples per side. */
  stats(): { samples: number; minKm: number; baseY: number };
  dispose(): void;
}

/** How deep the block reaches below its lowest edge, as a share of its width. */
const BASE_DEPTH = 0.035;
/**
 * The backdrop: a warm dark room, so the colours of the map carry the scene.
 * Display values, as the shaders here write them; the scene background gets
 * the same colour converted, since three.js treats a background as linear.
 */
const BACKDROP_DISPLAY: [number, number, number] = [0.118, 0.106, 0.094];
const BACKDROP = new THREE.Color().setRGB(...BACKDROP_DISPLAY, THREE.SRGBColorSpace);

const WALL_VERT = /* glsl */`
in float aKm;      // ground under this column, km
in float aBottom;  // 1 on the base edge, 0 on the top edge
in float aAlong;   // distance along the cut, scene units
in float aFace;    // 0 north, 1 east, 2 south, 3 west
uniform float uYMul;
uniform float uTerrace; // paper sheets: the ground is lifted to the sheet it stands on (km; 0 = none)
uniform float uBase;
uniform float uDeep;   // the deepest the cut shows the sea floor, scene units (negative)
out float vY;
out float vGround;
out float vTop;
out float vAlong;
out float vFace;
void main() {
  float km = uTerrace > 0.0 && aKm > 0.0 ? ceil(aKm / uTerrace) * uTerrace : aKm;
  float ground = max(km * uYMul, uDeep);
  float top = max(ground, 0.0);
  float y = mix(top, uBase, aBottom);
  vY = y; vGround = ground; vTop = top; vAlong = aAlong; vFace = aFace;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
}
`;

const WALL_FRAG = /* glsl */`
precision highp float;
in float vY;
in float vGround;
in float vTop;
in float vAlong;
in float vFace;
uniform float uBase;
uniform float uScale;   // scene units per km of the cut's own scale (not exaggerated)
uniform vec3 uSun;
uniform float uLight;
uniform float uLook;    // 0 cut rock, 1 stacked paper, 2 engraving
uniform float uSheet;   // paper: one sheet's thickness, scene units
out vec4 outColor;

float hash1(float n) { return fract(sin(n * 91.345) * 47453.5453); }

// Five sediments, warm to cool, and a hash picks one per band so the layers
// do not repeat in an obvious period.
vec3 stratum(float k) {
  float h = hash1(k);
  vec3 a = vec3(0.64, 0.52, 0.39);
  vec3 b = vec3(0.55, 0.45, 0.35);
  vec3 c = vec3(0.70, 0.60, 0.46);
  vec3 d = vec3(0.47, 0.39, 0.32);
  vec3 e = vec3(0.60, 0.50, 0.41);
  vec3 col = h < 0.2 ? a : h < 0.4 ? b : h < 0.6 ? c : h < 0.8 ? d : e;
  return col * (0.94 + 0.12 * hash1(k + 17.0));
}

// Stacked paper: sheets of one thickness, cream above the sea, kraft under the
// ground below it, blue under the water, with a fine shadowed seam between two.
vec3 paperCut(float span) {
  float sheet = max(uSheet, span * 0.012);
  float k = floor(vY / sheet);
  float f = fract(vY / sheet);
  float w = max(fwidth(vY / sheet), 1e-4);
  vec3 col;
  if (vY > vGround + 1e-4) {
    float depth = clamp((vTop - vY) / max(vTop - vGround, 1e-3), 0.0, 1.0);
    col = mix(vec3(0.62, 0.78, 0.84), vec3(0.24, 0.42, 0.60), depth);
  } else if (vY > 0.0) {
    col = vec3(0.93, 0.90, 0.82);
  } else {
    col = vec3(0.70, 0.58, 0.43);
  }
  col *= 0.96 + 0.06 * hash1(k + 3.0);
  // The seam: a dark hairline where one sheet lies on the next, with its shadow just under it.
  float seam = 1.0 - smoothstep(0.0, w * 1.4, f);
  float under = 1.0 - smoothstep(0.0, 0.35, f);
  col *= 1.0 - 0.38 * seam - 0.10 * under;
  // The board it is glued to.
  float foot = vY - uBase;
  if (foot < span * 0.05) col = vec3(0.24, 0.23, 0.22) * (0.9 + 0.1 * smoothstep(0.0, span * 0.05, foot));
  return col;
}

// An engraving: parchment, ink lines along the beds and hatching that grows
// denser with depth; the water column is hatched blue-grey.
vec3 engravedCut(float span) {
  vec3 paper = vec3(0.89, 0.84, 0.71);
  vec3 ink = vec3(0.24, 0.19, 0.15);
  float pitch = span * 0.022;
  float t = vY / pitch;
  float w = max(fwidth(t), 1e-4);
  float line = 1.0 - smoothstep(w * 0.6, w * 1.8, abs(fract(t) - 0.5) * 2.0 - 0.75);
  vec3 col = paper;
  if (vY > vGround + 1e-4) {
    float depth = clamp((vTop - vY) / max(vTop - vGround, 1e-3), 0.0, 1.0);
    col = mix(paper, vec3(0.70, 0.76, 0.78), 0.55);
    col = mix(col, vec3(0.20, 0.27, 0.33), line * (0.25 + 0.55 * depth));
  } else {
    float band = span * 0.085;
    float wob = sin(vAlong * 0.21 + vFace * 1.7) * 0.35 + sin(vAlong * 0.057 + vFace) * 0.65;
    float level = (vY - uBase) + wob * band * 0.55 + (vGround - uBase) * 0.18;
    float k = floor(level / band);
    float lb = level / band;
    float wb = max(fwidth(lb), 1e-4);
    float bed = 1.0 - smoothstep(0.0, wb * 1.6, min(fract(lb), 1.0 - fract(lb)));
    // Diagonal hatching inside each bed, the direction flipping bed to bed.
    float dir = mod(k, 2.0) < 1.0 ? 1.0 : -1.0;
    float d = (vAlong * dir + vY) / pitch;
    float wd = max(fwidth(d), 1e-4);
    float hatch = 1.0 - smoothstep(wd * 0.6, wd * 1.8, abs(fract(d) - 0.5) * 2.0 - 0.7);
    float density = 0.25 + 0.5 * hash1(k + 9.0) + 0.35 * clamp((vGround - vY) / max(span, 1e-3), 0.0, 1.0);
    col = mix(col, ink, hatch * density * 0.55);
    col = mix(col, ink, bed * 0.85);
    // The ground's own edge: a firm outline along the top.
    float lip = 1.0 - smoothstep(0.0, span * 0.012, vGround - vY);
    col = mix(col, ink, lip * 0.8);
  }
  // The plinth: cross-hatched.
  float foot = vY - uBase;
  if (foot < span * 0.06) col = mix(col, ink, 0.45 + 0.3 * line);
  return col;
}

void main() {
  float span = max(vTop - uBase, 1e-3);
  vec3 col;
  if (uLook > 1.5) {
    col = engravedCut(span);
    vec3 n = vFace < 0.5 ? vec3(0.0, 0.0, -1.0) : vFace < 1.5 ? vec3(1.0, 0.0, 0.0) : vFace < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(-1.0, 0.0, 0.0);
    float lambert = max(dot(n, normalize(uSun)), 0.0);
    outColor = vec4(col * mix(0.82, 1.0, lambert) * mix(0.7, 1.0, uLight), 1.0);
    return;
  }
  if (uLook > 0.5) {
    col = paperCut(span);
    vec3 n = vFace < 0.5 ? vec3(0.0, 0.0, -1.0) : vFace < 1.5 ? vec3(1.0, 0.0, 0.0) : vFace < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(-1.0, 0.0, 0.0);
    float lambert = max(dot(n, normalize(uSun)), 0.0);
    outColor = vec4(col * mix(0.66, 1.0, lambert) * mix(0.65, 1.0, uLight), 1.0);
    return;
  }
  if (vY > vGround + 1e-4) {
    // The water column: clear at the surface, deep blue towards the seabed.
    float depth = clamp((vTop - vY) / max(vTop - vGround, 1e-3), 0.0, 1.0);
    vec3 shallow = vec3(0.36, 0.60, 0.70);
    vec3 deep = vec3(0.10, 0.25, 0.40);
    col = mix(shallow, deep, pow(depth, 0.7));
    // A bright meniscus right under the surface.
    col += vec3(0.10, 0.12, 0.12) * (1.0 - smoothstep(0.0, span * 0.03, vTop - vY));
  } else {
    float below = vGround - vY;
    float soil = span * 0.05;
    if (below < soil) {
      // Topsoil: dark and a little olive, with a lighter lip where it meets the grass.
      col = mix(vec3(0.33, 0.27, 0.19), vec3(0.27, 0.21, 0.15), below / soil);
      col = mix(col, vec3(0.42, 0.40, 0.24), 1.0 - smoothstep(0.0, soil * 0.18, below));
    } else {
      // Strata: bands of a fixed thickness that waver along the cut and dip a
      // little with the ground above, as real beds follow the land they formed under.
      float band = span * 0.085;
      float wob = sin(vAlong * 0.21 + vFace * 1.7) * 0.35 + sin(vAlong * 0.057 + vFace) * 0.65;
      float level = (vY - uBase) + wob * band * 0.55 + (vGround - uBase) * 0.18;
      float k = floor(level / band);
      col = stratum(k + vFace * 0.0);
      // A fine dark seam between beds.
      float f = fract(level / band);
      col *= 0.82 + 0.18 * smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.94, 1.0, f));
    }
    // The plinth: the foot of the block is darker, as a cut stone base.
    float foot = vY - uBase;
    col = mix(col * 0.55, col, smoothstep(span * 0.02, span * 0.09, foot));
  }
  // Each face lit by the sun at its own angle, with a floor so the shaded
  // side still reads as rock and not as a hole.
  vec3 n = vFace < 0.5 ? vec3(0.0, 0.0, -1.0) : vFace < 1.5 ? vec3(1.0, 0.0, 0.0) : vFace < 2.5 ? vec3(0.0, 0.0, 1.0) : vec3(-1.0, 0.0, 0.0);
  float lambert = max(dot(n, normalize(uSun)), 0.0);
  float shade = mix(0.58, 1.0, lambert) * mix(0.65, 1.0, uLight);
  // A little ambient occlusion under the overhang of the ground.
  shade *= mix(0.86, 1.0, smoothstep(0.0, span * 0.04, vTop - vY + span * 0.01));
  outColor = vec4(col * shade, 1.0);
}
`;

const TABLE_VERT = /* glsl */`
out vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TABLE_FRAG = /* glsl */`
precision highp float;
in vec2 vXZ;
uniform vec2 uHalf;      // half size of the block
uniform vec2 uCenter;    // where the block stands on the table
uniform vec2 uShadowOff; // shadow offset, away from the sun
uniform float uSoft;     // shadow softness, scene units
uniform float uShadow;   // shadow strength
uniform vec3 uTable;
uniform vec3 uBackdrop;
out vec4 outColor;

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  // The table: a pool of light under the model, fading into the room.
  vec2 p = vXZ - uCenter;
  float r = length(p / (uHalf * 2.6));
  vec3 col = mix(uTable, uBackdrop, smoothstep(0.35, 1.0, r));
  // Contact shadow, tight under the block, and a wide soft one cast off the sun.
  float dContact = sdBox(p, uHalf);
  float contact = 1.0 - smoothstep(0.0, uSoft * 0.35, dContact);
  float dCast = sdBox(p - uShadowOff, uHalf);
  float thrown = 1.0 - smoothstep(-uSoft * 0.2, uSoft, dCast);
  float dark = max(contact * 0.55, thrown * uShadow);
  col *= 1.0 - dark;
  outColor = vec4(col, 1.0);
}
`;

export function createDiorama(o: DioramaOptions): Diorama {
  const group = new THREE.Group();
  group.name = 'diorama';
  group.visible = false;
  // The part of the world the block stands for (uv); the whole world unless framed.
  let rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
  let framed = false;

  const wallUniforms = {
    uYMul: { value: 1 },
    uTerrace: { value: 0 },
    uLook: { value: 0 },
    uSheet: { value: 0 },
    uBase: { value: -5 },
    uDeep: { value: -1e6 },
    uScale: { value: 1 },
    uSun: { value: new THREE.Vector3(-0.55, 0.72, 0.42) },
    uLight: { value: 1 },
  };
  const wallMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: wallUniforms,
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: THREE.FrontSide,
  });
  let wallGeo = new THREE.BufferGeometry();
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.frustumCulled = false;
  walls.name = 'diorama-walls';
  group.add(walls);

  // The underside, so a low camera never sees into the block.
  const bottomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.16, 0.13, 0.11, THREE.SRGBColorSpace) });
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(o.sizeX, o.sizeZ), bottomMat);
  bottom.rotation.x = Math.PI / 2;
  bottom.name = 'diorama-bottom';
  group.add(bottom);

  const tableUniforms = {
    uHalf: { value: new THREE.Vector2(o.sizeX / 2, o.sizeZ / 2) },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uShadowOff: { value: new THREE.Vector2(0, 0) },
    uSoft: { value: o.sizeX * 0.08 },
    uShadow: { value: 0.45 },
    uTable: { value: new THREE.Color(0.34, 0.305, 0.265) },
    uBackdrop: { value: new THREE.Color(...BACKDROP_DISPLAY) },
  };
  const tableMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: tableUniforms,
    vertexShader: TABLE_VERT,
    fragmentShader: TABLE_FRAG,
    depthWrite: true,
  });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(o.sizeX * 30, o.sizeX * 30), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.name = 'diorama-table';
  table.frustumCulled = false;
  group.add(table);

  let samples = 0;
  let minKm = 0;
  let baseY = -5;

  const ret: Diorama = {
    group,
    backdrop: BACKDROP,
    setGround(ground, frame) {
      framed = !!frame;
      rect = frame
        ? { u0: frame.u - frame.su / 2, v0: frame.v - frame.sv / 2, u1: frame.u + frame.su / 2, v1: frame.v + frame.sv / 2 }
        : { u0: 0, v0: 0, u1: 1, v1: 1 };
      const { u0, v0, u1, v1 } = rect;
      const fu = u1 - u0, fv = v1 - v0;
      const X = (u: number) => (u - 0.5) * o.sizeX, Z = (v: number) => (v - 0.5) * o.sizeZ;
      // One column per cell along each side, capped so a huge world stays cheap.
      const nx = Math.max(32, Math.min(1024, Math.round(ground.width * fu)));
      const nz = Math.max(16, Math.min(1024, Math.round(ground.height * fv)));
      const pos: number[] = [], km: number[] = [], bottomFlag: number[] = [], along: number[] = [], face: number[] = [];
      const index: number[] = [];
      let low = Infinity;
      let run = 0;
      // Each side walks so that its outward face is front-facing (counter-clockwise seen from outside).
      const side = (f: number, n: number, at: (t: number) => { x: number; z: number; u: number; v: number }) => {
        const start = pos.length / 3;
        let last: { x: number; z: number } | null = null;
        for (let i = 0; i <= n; i++) {
          const p = at(i / n);
          const e = ground.heightAt(Math.min(0.999999, Math.max(0, p.u)), Math.min(0.999999, Math.max(0, p.v)));
          if (e < low) low = e;
          if (last) run += Math.hypot(p.x - last.x, p.z - last.z);
          last = p;
          for (const b of [0, 1]) {
            pos.push(p.x, 0, p.z); km.push(e); bottomFlag.push(b); along.push(run); face.push(f);
          }
        }
        for (let i = 0; i < n; i++) {
          const a = start + i * 2, c = a + 2;
          // a = top i, a+1 = bottom i, c = top i+1, c+1 = bottom i+1
          index.push(a, a + 1, c, c, a + 1, c + 1);
        }
      };
      // North wall, seen from the north: walk east to west.
      side(0, nx, (t) => { const u = u1 - t * fu; return { x: X(u), z: Z(v0), u, v: v0 }; });
      // East wall, outward east: walk from south to north.
      side(1, nz, (t) => { const v = v1 - t * fv; return { x: X(u1), z: Z(v), u: u1, v }; });
      // South wall, seen from the south: walk west to east.
      side(2, nx, (t) => { const u = u0 + t * fu; return { x: X(u), z: Z(v1), u, v: v1 }; });
      // West wall, seen from the west: walk north to south.
      side(3, nz, (t) => { const v = v0 + t * fv; return { x: X(u0), z: Z(v), u: u0, v }; });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aKm', new THREE.Float32BufferAttribute(km, 1));
      geo.setAttribute('aBottom', new THREE.Float32BufferAttribute(bottomFlag, 1));
      geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
      geo.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
      geo.setIndex(index);
      wallGeo.dispose();
      wallGeo = geo;
      walls.geometry = geo;
      samples = nx;
      minKm = Number.isFinite(low) ? low : 0;
      // The underside and the table's light and shadow follow the block.
      const cx = X((u0 + u1) / 2), cz = Z((v0 + v1) / 2);
      bottom.scale.set(fu, fv, 1);
      bottom.position.x = cx; bottom.position.z = cz;
      tableUniforms.uHalf.value.set(o.sizeX * fu / 2, o.sizeZ * fv / 2);
      tableUniforms.uCenter.value.set(cx, cz);
      tableUniforms.uSoft.value = o.sizeX * fu * 0.08;
    },
    update(u) {
      group.visible = u.visible;
      if (!u.visible) return;
      // The base sits a fixed share of the block's width below the lowest point
      // the cut shows, or below the sea when the edges are all land.
      const widthX = o.sizeX * (rect.u1 - rect.u0);
      // The water column is cut at a share of the block's width: an island's block is narrow, and
      // the open ocean round it, exaggerated with the land, would stand as a tall blue tower.
      // (Only for a window of the world: the whole world's block is as it always was.)
      const deep = framed ? -widthX * 0.06 : -1e6;
      wallUniforms.uDeep.value = deep;
      baseY = Math.min(0, Math.max(minKm * u.yMul, deep)) - widthX * BASE_DEPTH;
      wallUniforms.uYMul.value = u.yMul;
      wallUniforms.uBase.value = baseY;
      wallUniforms.uLook.value = u.look === 'papel' ? 1 : u.look === 'grabado' ? 2 : 0;
      wallUniforms.uTerrace.value = u.terrace ?? 0;
      wallUniforms.uSheet.value = (u.terrace ?? 0) * u.yMul;
      wallUniforms.uSun.value.copy(u.sun);
      wallUniforms.uLight.value = u.light;
      bottom.position.y = baseY;
      bottomMat.color.setRGB(...(u.look === 'grabado' ? [0.5, 0.44, 0.34] : u.look === 'papel' ? [0.2, 0.19, 0.18] : [0.16, 0.13, 0.11]) as [number, number, number], THREE.SRGBColorSpace);
      table.position.y = baseY - 0.02;
      // The shadow falls away from the sun, further the lower it is.
      const s = u.sun;
      const reach = Math.min(widthX * 0.06, (Math.abs(baseY) + widthX * 0.01) * 1.2 / Math.max(0.25, s.y));
      const flat = Math.hypot(s.x, s.z) || 1;
      tableUniforms.uShadowOff.value.set(-s.x / flat * reach, -s.z / flat * reach);
      tableUniforms.uShadow.value = 0.18 + 0.32 * u.light;
    },
    stats() { return { samples, minKm, baseY }; },
    dispose() {
      wallGeo.dispose(); wallMat.dispose();
      bottom.geometry.dispose(); bottomMat.dispose();
      table.geometry.dispose(); tableMat.dispose();
    },
  };
  return ret;
}
