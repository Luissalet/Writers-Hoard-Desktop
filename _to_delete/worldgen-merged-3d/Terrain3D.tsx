// ============================================
// World Generator — 3D terrain view (three.js)
// ============================================
// One height grid, three bodies: a flat map slab, a full globe, or a
// Discworld-style disc (north pole at the centre, the south rim around the
// edge — matching the 2D polar-disc projection). Geometry is built from a
// generalized surface mapping with numeric normals, textured with the
// unshaded atlas render; real-time lights do the shading. Lazy-loaded so
// three.js stays out of the main bundle.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldData } from '../core/types';
import { renderComposite } from '../core/render';
import { getCartoTexture } from '../cartography/texture';
import { THEME_WONDER, type CartoTheme } from '../cartography/theme';
import type { HumanGeography } from '../core/settlements';
import type { WorldWaypoint } from '../types';

export type Shape3D = 'plane' | 'globe' | 'disc';
export type SkinMode = 'atlas' | 'carta';

const SIZE_X = 240;               // plane width in scene units
const CHUNK = 128;                // cells per chunk side
const Y_PER_KM = 0.24;            // km → units, × exaggeration × unit
const GLOBE_RELIEF = 0.55;        // globes read better slightly flatter

interface Terrain3DProps {
  world: WorldData;
  waypoints: WorldWaypoint[];
  flyTarget: { u: number; v: number; token: number } | null;
  exaggeration: number;
  shape: Shape3D;
  /** 'atlas' = the satellite-style raster; 'carta' = the hand-drawn map draped
   *  over the relief, which is the whole point of this view. */
  skin?: SkinMode;
  theme?: CartoTheme;
  geography?: HumanGeography;
  onPickWaypoint?: (id: string) => void;
}

interface ChunkMeta {
  mesh: THREE.Mesh;
  gx0: number;
  gy0: number;
  nx: number;
  ny: number;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  material: THREE.MeshLambertMaterial;
  terrainGroup: THREE.Group;
  markerGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  mapCanvas: HTMLCanvasElement;
  chunks: ChunkMeta[];
  currentShape: Shape3D;
  appliedExag: number;
  fog: THREE.Fog;
  buildShape: (shape: Shape3D, exag: number) => void;
  updateHeights: (exag: number) => void;
  fly: { active: boolean; t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3 };
  raf: number;
  disposed: boolean;
}

export default function Terrain3D({
  world, waypoints, flyTarget, exaggeration, shape,
  skin = 'atlas', theme = THEME_WONDER, geography, onPickWaypoint,
}: Terrain3DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<SceneRefs | null>(null);
  const exagRef = useRef(exaggeration);
  const shapeRef = useRef(shape);
  const pickRef = useRef(onPickWaypoint);
  useEffect(() => {
    pickRef.current = onPickWaypoint;
  });

  const W = world.width, H = world.height;
  const unit = SIZE_X / W;
  const sizeZ = H * unit;
  const R_GLOBE = SIZE_X / (2 * Math.PI); // circumference = map width
  const R_DISC = sizeZ * 0.8;

  // ---- scene lifecycle (per world) ----------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // High-resolution worlds get a downsampled MESH (the texture stays full
    // resolution) — 2560×1280 would otherwise mean ~3.3M vertices.
    const step = Math.max(1, Math.ceil(W / 1792));
    const Wm = Math.floor(W / step);
    const Hm = Math.floor(H / step);
    const unitM = SIZE_X / Wm;
    const sizeZm = Hm * unitM;
    let elev3d: Float32Array;
    if (step === 1) {
      elev3d = world.elevation;
    } else {
      // Max-pool so mountain crests survive the downsample.
      elev3d = new Float32Array(Wm * Hm);
      for (let y = 0; y < Hm; y++) {
        for (let x = 0; x < Wm; x++) {
          let m = -Infinity;
          for (let dy = 0; dy < step; dy++) {
            const sy = Math.min(H - 1, y * step + dy);
            for (let dx = 0; dx < step; dx++) {
              const sx = Math.min(W - 1, x * step + dx);
              const e = world.elevation[sy * W + sx];
              if (e > m) m = e;
            }
          }
          elev3d[y * Wm + x] = m;
        }
      }
    }

    // Logarithmic depth: the scene spans ~0.5 to ~1700 units and the sea
    // surface sits ~0.03 above flat coastal terrain — a linear depth buffer
    // z-fights exactly there (speckled coasts).
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    // On the drawn skin the void is warm paper, and the fog is the aerial
    // perspective that does most of the painterly work: distant land drifts
    // toward the sheet colour instead of toward black.
    const voidColor = skin === 'carta'
      ? new THREE.Color(theme.paper.grain)
      : new THREE.Color(0x0a0e16);
    scene.background = voidColor;
    const fog = skin === 'carta'
      ? new THREE.Fog(voidColor.getHex(), sizeZ * 0.32, sizeZ * 1.9)
      : new THREE.Fog(0x0a0e16, sizeZ * 2.2, sizeZ * 6);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, sizeZ * 14);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Lights — sun from the NW to match the 2D hillshade.
    // The drawn skin already carries its own light-from-the-upper-left shading
    // inside every symbol, so the scene light is dialled back to shaping duty
    // only — a full-strength sun would crush the ink it is lighting.
    const sun = new THREE.DirectionalLight(
      skin === 'carta' ? 0xfff4e2 : 0xfff2dd,
      skin === 'carta' ? 1.25 : 2.1,
    );
    sun.position.set(-SIZE_X * 0.35, sizeZ * 1.2, -sizeZ * 0.5);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(
      skin === 'carta' ? 0xe8dcc0 : 0xbfd0e0,
      skin === 'carta' ? 1.55 : 0.85,
    );
    scene.add(ambient);

    // ---- texture ----------------------------------------------------------
    // Both skins are drawn WITHOUT baked relief shading: the scene's own lights
    // supply the form, and a second NW hillshade in the texture would shade
    // every slope twice.
    const mapCanvas = document.createElement('canvas');
    if (skin === 'carta') {
      const carto = getCartoTexture(world, theme, geography, Math.min(4096, Math.max(2048, W)));
      mapCanvas.width = carto.width;
      mapCanvas.height = carto.height;
      mapCanvas.getContext('2d')!.drawImage(carto, 0, 0);
    } else {
      const rgba = renderComposite(world, 'atlas', true, { shade: false });
      mapCanvas.width = W;
      mapCanvas.height = H;
      mapCanvas.getContext('2d')!.putImageData(new ImageData(rgba, W, H), 0, 0);
    }
    const TW = mapCanvas.width, TH = mapCanvas.height;
    const setupTexture = (tex: THREE.CanvasTexture): THREE.CanvasTexture => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.wrapS = THREE.RepeatWrapping; // seam-friendly for globe/disc
      tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    };
    const texture = setupTexture(new THREE.CanvasTexture(mapCanvas));
    const material = new THREE.MeshLambertMaterial({ map: texture });

    // Polar-softened texture variants: near a pinch point every texture
    // column fans into a radial sliver, so distinct column colors paint a
    // pinwheel. Blending the last rows toward their row-average color turns
    // the cap into one clean tone. Built lazily, cached per variant.
    const makeSoftPolarCanvas = (softenSouth: boolean): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = TW; c.height = TH;
      const cctx = c.getContext('2d')!;
      cctx.drawImage(mapCanvas, 0, 0);
      const img = cctx.getImageData(0, 0, TW, TH);
      const d = img.data;
      const B = Math.max(8, Math.round(TH * 0.045));
      const softenRow = (row: number, wRow: number) => {
        const off = row * TW * 4;
        let r = 0, g = 0, b = 0;
        for (let x = 0; x < TW; x++) {
          r += d[off + x * 4];
          g += d[off + x * 4 + 1];
          b += d[off + x * 4 + 2];
        }
        r /= TW; g /= TW; b /= TW;
        for (let x = 0; x < TW; x++) {
          const o = off + x * 4;
          d[o] = d[o] * (1 - wRow) + r * wRow;
          d[o + 1] = d[o + 1] * (1 - wRow) + g * wRow;
          d[o + 2] = d[o + 2] * (1 - wRow) + b * wRow;
        }
      };
      for (let k = 0; k < B; k++) {
        const wRow = Math.pow(1 - k / B, 1.4);
        softenRow(k, wRow);
        if (softenSouth) softenRow(TH - 1 - k, wRow);
      }
      cctx.putImageData(img, 0, 0);
      return c;
    };
    let softBothTex: THREE.CanvasTexture | null = null;   // globe
    let softNorthTex: THREE.CanvasTexture | null = null;  // disc (centre only)
    const textureForShape = (shp: Shape3D): THREE.CanvasTexture => {
      if (shp === 'plane') return texture;
      if (shp === 'globe') {
        if (!softBothTex) softBothTex = setupTexture(new THREE.CanvasTexture(makeSoftPolarCanvas(true)));
        return softBothTex;
      }
      if (!softNorthTex) softNorthTex = setupTexture(new THREE.CanvasTexture(makeSoftPolarCanvas(false)));
      return softNorthTex;
    };

    const terrainGroup = new THREE.Group();
    scene.add(terrainGroup);
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    // ---- precomputed angle tables (fast surface evaluation) ----------------
    // Longitude runs CLOCKWISE seen from +Y (sin negated): that keeps the
    // grid parameterization's handedness equal to the flat map's, so the
    // shared triangle winding stays front-facing — and east correctly
    // appears to the right when you look at the globe from outside.
    const cosLon = new Float64Array(Wm + 2);
    const sinLon = new Float64Array(Wm + 2);
    for (let gx = 0; gx <= Wm + 1; gx++) {
      const lon = (gx / Wm) * Math.PI * 2;
      cosLon[gx] = Math.cos(lon);
      sinLon[gx] = -Math.sin(lon);
    }
    const cosLat = new Float64Array(Hm + 1);
    const sinLat = new Float64Array(Hm + 1);
    for (let gy = 0; gy <= Hm; gy++) {
      const lat = Math.PI / 2 - (gy / Hm) * Math.PI;
      cosLat[gy] = Math.cos(lat);
      sinLat[gy] = Math.sin(lat);
    }

    const elevAt = (gx: number, gy: number): number => {
      const x = ((gx % Wm) + Wm) % Wm;
      const y = gy < 0 ? 0 : gy >= Hm ? Hm - 1 : gy;
      return elev3d[y * Wm + x];
    };

    // Where all map columns converge to a point (sphere poles, disc centre),
    // per-column elevation differences crumple the cap into a spiky "tent".
    // Blend elevation toward the polar mean across the last ~5% of rows so
    // the pole converges to one clean radius.
    const POLE_ROWS = Math.max(6, Math.round(Hm * 0.05));
    let poleElevN = 0, poleElevS = 0;
    for (let x = 0; x < Wm; x++) {
      poleElevN += elev3d[x];
      poleElevS += elev3d[(Hm - 1) * Wm + x];
    }
    poleElevN /= Wm;
    poleElevS /= Wm;

    /** Surface position for grid coords (gx may reach Wm, gy may reach Hm). */
    const P = (gx: number, gy: number, shp: Shape3D, exag: number, out: number[]): void => {
      const yMul = elevKmToY(exag);
      let e = elevAt(gx, gy);
      if (shp !== 'plane') {
        const gyc = gy < 0 ? 0 : gy > Hm ? Hm : gy;
        if (gyc < POLE_ROWS) {
          // North pole: pinches on both the globe and the disc centre.
          const w = Math.pow(1 - gyc / POLE_ROWS, 2);
          e += (poleElevN - e) * w;
        } else if (shp === 'globe' && gyc > Hm - POLE_ROWS) {
          // South pole pinches only on the globe (the disc rim is a full ring).
          const w = Math.pow(1 - (Hm - gyc) / POLE_ROWS, 2);
          e += (poleElevS - e) * w;
        }
      }
      if (shp === 'plane') {
        out[0] = gx * unitM - SIZE_X / 2;
        out[1] = e * yMul;
        out[2] = gy * unitM - sizeZm / 2;
      } else if (shp === 'globe') {
        const gxa = ((gx % Wm) + Wm) % Wm;
        const gya = gy < 0 ? 0 : gy > Hm ? Hm : gy;
        const r = R_GLOBE + e * yMul * GLOBE_RELIEF;
        const cl = cosLat[gya];
        out[0] = r * cl * cosLon[gxa];
        out[1] = r * sinLat[gya];
        out[2] = r * cl * sinLon[gxa];
      } else {
        const gxa = ((gx % Wm) + Wm) % Wm;
        const gya = gy < 0 ? 0 : gy > Hm ? Hm : gy;
        const rho = (gya / Hm) * R_DISC;
        out[0] = rho * cosLon[gxa];
        out[1] = e * yMul;
        out[2] = rho * sinLon[gxa];
      }
    };

    // Scratch vectors for fillChunk (allocation-free hot loop).
    const pA = [0, 0, 0], pB = [0, 0, 0], pC = [0, 0, 0], pD = [0, 0, 0], pS = [0, 0, 0];

    const fillChunk = (ch: ChunkMeta, shp: Shape3D, exag: number): void => {
      const pos = ch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const nor = ch.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const nArr = nor.array as Float32Array;
      for (let j = 0; j < ch.ny; j++) {
        for (let i2 = 0; i2 < ch.nx; i2++) {
          const gx = ch.gx0 + i2;
          const gy = ch.gy0 + j;
          const k = j * ch.nx + i2;
          P(gx, gy, shp, exag, pS);
          arr[k * 3] = pS[0];
          arr[k * 3 + 1] = pS[1];
          arr[k * 3 + 2] = pS[2];
          // Numeric normal from central differences on the surface.
          P(gx + 1, gy, shp, exag, pA);
          P(gx - 1, gy, shp, exag, pB);
          P(gx, gy + 1, shp, exag, pC);
          P(gx, gy - 1, shp, exag, pD);
          const tux = pA[0] - pB[0], tuy = pA[1] - pB[1], tuz = pA[2] - pB[2];
          const tvx = pC[0] - pD[0], tvy = pC[1] - pD[1], tvz = pC[2] - pD[2];
          let nx = tvy * tuz - tvz * tuy;
          let ny = tvz * tux - tvx * tuz;
          let nz = tvx * tuy - tvy * tux;
          // Orient along the local "up" (radial on the globe, +Y otherwise).
          let ux = 0, uy = 1, uz = 0;
          if (shp === 'globe') {
            const il = 1 / (Math.hypot(pS[0], pS[1], pS[2]) || 1);
            ux = pS[0] * il; uy = pS[1] * il; uz = pS[2] * il;
          }
          if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const len = Math.hypot(nx, ny, nz);
          if (len < 1e-12) { nx = ux; ny = uy; nz = uz; }
          else { nx /= len; ny /= len; nz /= len; }
          nArr[k * 3] = nx;
          nArr[k * 3 + 1] = ny;
          nArr[k * 3 + 2] = nz;
        }
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      ch.mesh.geometry.computeBoundingSphere();
    };

    const disposeTerrain = (): void => {
      for (const child of [...terrainGroup.children]) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        // Shared terrain material is disposed at teardown; water/base own theirs.
        if (mesh.material !== material) (mesh.material as THREE.Material).dispose();
        terrainGroup.remove(child);
      }
      refsObj.chunks = [];
    };

    const buildShape = (shp: Shape3D, exag: number): void => {
      disposeTerrain();
      refsObj.currentShape = shp;
      material.map = textureForShape(shp);
      material.needsUpdate = true;

      // -- terrain chunks --
      const chunksX = Math.ceil(Wm / CHUNK);
      const chunksY = Math.ceil(Hm / CHUNK);
      for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) {
          const gx0 = cx * CHUNK;
          const gy0 = cy * CHUNK;
          const nx = Math.min(CHUNK, Wm - gx0) + 1;
          const ny = Math.min(CHUNK, Hm - gy0) + 1;
          const geo = new THREE.BufferGeometry();
          const count = nx * ny;
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
          const uvs = new Float32Array(count * 2);
          for (let j = 0; j < ny; j++) {
            for (let i2 = 0; i2 < nx; i2++) {
              const k = j * nx + i2;
              uvs[k * 2] = (gx0 + i2) / Wm;
              uvs[k * 2 + 1] = (gy0 + j) / Hm;
            }
          }
          geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
          const index: number[] = [];
          for (let j = 0; j < ny - 1; j++) {
            for (let i2 = 0; i2 < nx - 1; i2++) {
              const a = j * nx + i2, b = a + 1, c = a + nx, d = c + 1;
              index.push(a, c, b, b, c, d);
            }
          }
          geo.setIndex(index);
          const mesh = new THREE.Mesh(geo, material);
          terrainGroup.add(mesh);
          const meta: ChunkMeta = { mesh, gx0, gy0, nx, ny };
          refsObj.chunks.push(meta);
          fillChunk(meta, shp, exag);
        }
      }

      // -- water + base --
      // The sea has to be the theme's own shallow tone, or the drawn coast rings
      // stop at a differently coloured ocean.
      const waterColor = skin === 'carta' ? new THREE.Color(theme.ocean.shallow).getHex() : undefined;
      const waterMat = new THREE.MeshPhongMaterial({
        color: waterColor ?? 0x2e6f8e,
        transparent: true,
        opacity: shp === 'globe' ? 0.78 : 0.72,
        shininess: 42,
        specular: new THREE.Color(0x22333f),
        depthWrite: false,
      });
      // Globes and discs face the light from every angle — lift the ambient
      // so the night side stays readable.
      ambient.intensity = shp === 'plane' ? 0.85 : 1.05;
      sun.intensity = shp === 'plane' ? 2.1 : 1.8;
      if (shp === 'plane') {
        const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, sizeZm), waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.035;
        terrainGroup.add(water);
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(SIZE_X, 2, sizeZm),
          new THREE.MeshLambertMaterial({ color: skin === 'carta' ? new THREE.Color(theme.paper.grain).getHex() : 0x14141d }),
        );
        slab.position.y = -1.35;
        terrainGroup.add(slab);
      } else if (shp === 'globe') {
        const water = new THREE.Mesh(new THREE.SphereGeometry(R_GLOBE + 0.035, 96, 64), waterMat);
        terrainGroup.add(water);
      } else {
        const water = new THREE.Mesh(new THREE.CircleGeometry(R_DISC, 128), waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.035;
        terrainGroup.add(water);
        // The disc rides on a dark pedestal. (Elephants and turtle sold
        // separately.)
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(R_DISC + 0.6, R_DISC * 0.92, 3.2, 128),
          new THREE.MeshLambertMaterial({ color: skin === 'carta' ? new THREE.Color(theme.paper.grain).getHex() : 0x14141d }),
        );
        base.position.y = -1.65;
        terrainGroup.add(base);
      }

      // -- environment per shape --
      scene.fog = shp === 'plane' ? fog : null;

      // -- camera + controls presets --
      controls.minPolarAngle = 0;
      if (shp === 'plane') {
        camera.position.set(0, sizeZ * 0.85, sizeZ * 1.15);
        controls.target.set(0, 0, 0);
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.minDistance = 3;
        controls.maxDistance = sizeZ * 4;
        controls.enablePan = true;
      } else if (shp === 'globe') {
        camera.position.set(R_GLOBE * 1.1, R_GLOBE * 1.15, R_GLOBE * 2.3);
        controls.target.set(0, 0, 0);
        controls.minPolarAngle = 0.06;
        controls.maxPolarAngle = Math.PI - 0.06;
        controls.minDistance = R_GLOBE * 1.15;
        controls.maxDistance = R_GLOBE * 7;
        controls.enablePan = false;
      } else {
        camera.position.set(0, R_DISC * 1.25, R_DISC * 1.6);
        controls.target.set(0, 0, 0);
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.minDistance = 4;
        controls.maxDistance = R_DISC * 6;
        controls.enablePan = true;
      }
      refsObj.fly.active = false;
      controls.update();
    };

    const updateHeights = (exag: number): void => {
      for (const ch of refsObj.chunks) fillChunk(ch, refsObj.currentShape, exag);
    };

    const refsObj: SceneRefs = {
      renderer, scene, camera, controls, material, terrainGroup, markerGroup,
      raycaster: new THREE.Raycaster(),
      mapCanvas,
      chunks: [],
      currentShape: shapeRef.current,
      appliedExag: exagRef.current,
      fog,
      buildShape,
      updateHeights,
      fly: { active: false, t: 0, fromT: new THREE.Vector3(), toT: new THREE.Vector3(), fromC: new THREE.Vector3(), toC: new THREE.Vector3() },
      raf: 0,
      disposed: false,
    };
    refs.current = refsObj;

    buildShape(shapeRef.current, skinExaggeration(exagRef.current, skin));

    // ---- sizing --------------------------------------------------------------
    const fit = () => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);

    // ---- picking --------------------------------------------------------------
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      refsObj.raycaster.setFromCamera(ndc, camera);
      const hits = refsObj.raycaster.intersectObjects(markerGroup.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData.waypointId) {
            pickRef.current?.(obj.userData.waypointId as string);
            return;
          }
          obj = obj.parent;
        }
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    // ---- minimap ------------------------------------------------------------------
    let minimapTick = 0;
    const drawMinimap = () => {
      if (minimapTick++ % 5 !== 0) return;
      const mc = minimapRef.current;
      if (!mc) return;
      const mctx = mc.getContext('2d')!;
      mctx.clearRect(0, 0, mc.width, mc.height);
      mctx.drawImage(mapCanvas, 0, 0, mc.width, mc.height);
      // Where is the camera looking, in map coords?
      let u = 0.5, v = 0.5;
      if (refsObj.currentShape === 'plane') {
        u = (controls.target.x + SIZE_X / 2) / SIZE_X;
        v = (controls.target.z + sizeZ / 2) / sizeZ;
      } else if (refsObj.currentShape === 'disc') {
        const rho = Math.hypot(controls.target.x, controls.target.z) / R_DISC;
        const a = Math.atan2(-controls.target.z, controls.target.x);
        u = ((a / (2 * Math.PI)) % 1 + 1) % 1;
        v = Math.min(1, rho);
      } else {
        const d = camera.position.clone().normalize();
        const lat = Math.asin(Math.max(-1, Math.min(1, d.y)));
        const lon = Math.atan2(-d.z, d.x);
        u = ((lon / (2 * Math.PI)) % 1 + 1) % 1;
        v = 0.5 - lat / Math.PI;
      }
      mctx.beginPath();
      mctx.arc(u * mc.width, v * mc.height, 3.5, 0, Math.PI * 2);
      mctx.fillStyle = 'rgba(228, 168, 83, 0.95)';
      mctx.fill();
      mctx.lineWidth = 1.5;
      mctx.strokeStyle = 'rgba(7,7,13,0.9)';
      mctx.stroke();
    };

    // ---- render loop ------------------------------------------------------------
    const clock = new THREE.Clock();
    const loop = () => {
      if (refsObj.disposed) return;
      refsObj.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      if (refsObj.fly.active) {
        refsObj.fly.t = Math.min(1, refsObj.fly.t + dt / 0.9);
        const s = easeInOut(refsObj.fly.t);
        controls.target.lerpVectors(refsObj.fly.fromT, refsObj.fly.toT, s);
        camera.position.lerpVectors(refsObj.fly.fromC, refsObj.fly.toC, s);
        if (refsObj.fly.t >= 1) refsObj.fly.active = false;
      }
      controls.update();
      renderer.render(scene, camera);
      drawMinimap();
    };
    loop();

    return () => {
      refsObj.disposed = true;
      cancelAnimationFrame(refsObj.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      disposeTerrain();
      disposeMarkers(markerGroup);
      material.dispose();
      texture.dispose();
      softBothTex?.dispose();
      softNorthTex?.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, skin, theme, geography]);

  // ---- shape switching ---------------------------------------------------------
  useEffect(() => {
    shapeRef.current = shape;
    const r = refs.current;
    if (!r || r.currentShape === shape) return;
    r.buildShape(shape, skinExaggeration(exagRef.current, skin));
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, skinExaggeration(exagRef.current, skin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // ---- exaggeration updates -------------------------------------------------------
  useEffect(() => {
    exagRef.current = exaggeration;
    const r = refs.current;
    // Skip when the meshes already carry this exaggeration (initial mount,
    // StrictMode re-run) — a full height pass over ~1M vertices is not free.
    if (!r || r.appliedExag === exaggeration) return;
    r.appliedExag = exaggeration;
    const eff = skinExaggeration(exaggeration, skin);
    r.updateHeights(eff);
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, eff);
  }, [exaggeration, skin, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC]);

  // ---- waypoint markers --------------------------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, skinExaggeration(exagRef.current, skin));
  }, [waypoints, world, unit, sizeZ, R_GLOBE, R_DISC, skin]);

  // ---- fly-to -------------------------------------------------------------------
  useEffect(() => {
    if (!flyTarget) return;
    const r = refs.current;
    if (!r) return;
    startFly(r, world, flyTarget.u, flyTarget.v, unit, sizeZ, R_GLOBE, R_DISC, skinExaggeration(exagRef.current, skin));
  }, [flyTarget, world, unit, sizeZ, R_GLOBE, R_DISC, skin]);

  // ---- minimap click → jump ------------------------------------------------------
  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = refs.current;
    const mc = minimapRef.current;
    if (!r || !mc) return;
    const rect = mc.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    startFly(r, world, u, v, unit, sizeZ, R_GLOBE, R_DISC, skinExaggeration(exagRef.current, skin));
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {skin === 'carta' && (
        // Screen-space sheet: a vignette plus a faint tooth, laid over the
        // finished frame. Doing it here rather than in the shader means it does
        // not follow the terrain in perspective — which is correct, because the
        // paper is in front of the scene, not part of it.
        <div
          className="absolute inset-0 z-[5] pointer-events-none mix-blend-multiply"
          style={{
            backgroundImage:
              `radial-gradient(120% 90% at 50% 45%, rgba(255,255,255,0) 45%, ${theme.paper.stain}66 100%),`
              + `url("data:image/svg+xml;utf8,${encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">'
                + '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/>'
                + '<feColorMatrix type="saturate" values="0"/></filter>'
                + '<rect width="140" height="140" filter="url(#n)" opacity="0.16"/></svg>',
              )}")`,
            backgroundSize: 'cover, 140px 140px',
          }}
        />
      )}
      <canvas
        ref={minimapRef}
        width={192}
        height={96}
        onClick={handleMinimapClick}
        className="absolute bottom-3 left-3 z-10 rounded-lg border border-border shadow-lg shadow-black/40 cursor-pointer opacity-90 hover:opacity-100 transition"
        style={{ width: 192, height: 96 }}
        title={t('worldgen.threeD.minimapHint')}
      />
      <div className="absolute top-3 left-3 z-10 text-[10px] text-text-dim bg-deep/60 rounded px-1.5 py-0.5 pointer-events-none">
        {t('worldgen.threeD.hint')}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** 1 km of elevation → scene units. Resolution-independent: exaggeration
 *  means the same thing whether the world grid is 768 or 2560 wide. */
function elevKmToY(exag: number): number {
  return (SIZE_X / 1024) * exag * Y_PER_KM;
}

/**
 * The drawn skin cannot take the same vertical scale as the satellite raster.
 * Its mountain symbols are pictures of mountains; stretch the mesh under them
 * and each symbol smears up the slope it is sitting on. A satellite texture has
 * no such structure to distort, so it tolerates any exaggeration.
 *
 * Damping rather than clamping keeps the slider honest — it still does what it
 * says, just over a range the texture survives.
 */
export function skinExaggeration(exag: number, skin: SkinMode): number {
  return skin === 'carta' ? exag * 0.62 : exag;
}

/** Surface point + local up for normalized map coords, per shape. */
function surfacePoint(
  world: WorldData,
  shape: Shape3D,
  u: number,
  v: number,
  unit: number,
  sizeZ: number,
  rGlobe: number,
  rDisc: number,
  exag: number,
): { pos: THREE.Vector3; up: THREE.Vector3 } {
  const { width: W, height: H, elevation } = world;
  const gx = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
  const gy = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  const e = Math.max(0, elevation[gy * W + gx]);
  const yMul = elevKmToY(exag);
  if (shape === 'plane') {
    return {
      pos: new THREE.Vector3(u * W * unit - (W * unit) / 2, e * yMul, v * sizeZ - sizeZ / 2),
      up: new THREE.Vector3(0, 1, 0),
    };
  }
  if (shape === 'globe') {
    const lon = u * Math.PI * 2;
    const lat = Math.PI / 2 - v * Math.PI;
    // sin(lon) negated — must match the geometry's longitude direction.
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      -Math.cos(lat) * Math.sin(lon),
    );
    const r = rGlobe + e * yMul * GLOBE_RELIEF;
    return { pos: dir.clone().multiplyScalar(r), up: dir };
  }
  const a = u * Math.PI * 2;
  const rho = v * rDisc;
  return {
    pos: new THREE.Vector3(rho * Math.cos(a), e * yMul, -rho * Math.sin(a)),
    up: new THREE.Vector3(0, 1, 0),
  };
}

function startFly(
  r: SceneRefs,
  world: WorldData,
  u: number,
  v: number,
  unit: number,
  sizeZ: number,
  rGlobe: number,
  rDisc: number,
  exag: number,
): void {
  const shape = r.currentShape;
  const { pos, up } = surfacePoint(world, shape, u, v, unit, sizeZ, rGlobe, rDisc, exag);
  r.fly.fromT.copy(r.controls.target);
  r.fly.fromC.copy(r.camera.position);
  if (shape === 'globe') {
    // Orbit stays centred on the planet; swing the camera over the point.
    r.fly.toT.set(0, 0, 0);
    r.fly.toC.copy(up).multiplyScalar(rGlobe * 2.0);
  } else {
    r.fly.toT.copy(pos);
    r.fly.toC.copy(pos).add(new THREE.Vector3(6, 16, 24));
  }
  r.fly.t = 0;
  r.fly.active = true;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function disposeMarkers(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
      else if (mat) disposeMaterial(mat);
    });
    group.remove(child);
  }
}

function disposeMaterial(m: THREE.Material): void {
  const anyM = m as THREE.Material & { map?: THREE.Texture | null };
  if (anyM.map) anyM.map.dispose();
  m.dispose();
}

const UP_Y = new THREE.Vector3(0, 1, 0);

function placeMarkers(
  r: SceneRefs,
  world: WorldData,
  waypoints: WorldWaypoint[],
  unit: number,
  sizeZ: number,
  rGlobe: number,
  rDisc: number,
  exag: number,
): void {
  disposeMarkers(r.markerGroup);
  const shape = r.currentShape;
  for (const wp of waypoints) {
    const group = new THREE.Group();
    group.userData.waypointId = wp.id;
    const color = new THREE.Color(wp.color);

    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.6, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    pin.rotation.x = Math.PI; // point down (local -Y at the surface)
    pin.position.y = 1.3;
    group.add(pin);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 12, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    knob.position.y = 2.9;
    group.add(knob);

    const label = makeLabelSprite(wp.name, wp.color, shape === 'globe');
    label.position.y = 4.6;
    group.add(label);

    const { pos, up } = surfacePoint(world, shape, wp.u, wp.v, unit, sizeZ, rGlobe, rDisc, exag);
    group.position.copy(pos);
    if (shape === 'globe') {
      group.quaternion.setFromUnitVectors(UP_Y, up);
    }
    r.markerGroup.add(group);
  }
}

function makeLabelSprite(text: string, accent: string, depthTest: boolean): THREE.Sprite {
  const pad = 10;
  const font = '600 26px "Source Sans 3", sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const tw = Math.ceil(measure.measureText(text).width);
  const canvas = document.createElement('canvas');
  canvas.width = tw + pad * 2;
  canvas.height = 44;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(7, 7, 13, 0.78)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 9);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = '#e8e5e0';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.055;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}
