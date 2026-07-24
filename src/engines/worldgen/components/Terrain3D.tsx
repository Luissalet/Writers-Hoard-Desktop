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
import type { WorldWaypoint } from '../types';

export type Shape3D = 'plane' | 'globe' | 'disc';

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
  fog: THREE.Fog;
  buildShape: (shape: Shape3D, exag: number) => void;
  updateHeights: (exag: number) => void;
  fly: { active: boolean; t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3 };
  raf: number;
  disposed: boolean;
}

export default function Terrain3D({ world, waypoints, flyTarget, exaggeration, shape, onPickWaypoint }: Terrain3DProps) {
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e16);
    const fog = new THREE.Fog(0x0a0e16, sizeZ * 2.2, sizeZ * 6);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.2, sizeZ * 14);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Lights — sun from the NW to match the 2D hillshade.
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
    sun.position.set(-SIZE_X * 0.35, sizeZ * 1.2, -sizeZ * 0.5);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(0xbfd0e0, 0.85);
    scene.add(ambient);

    // ---- texture: unshaded atlas + rivers ---------------------------------
    const rgba = renderComposite(world, 'atlas', true, { shade: false });
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = W;
    mapCanvas.height = H;
    mapCanvas.getContext('2d')!.putImageData(new ImageData(rgba, W, H), 0, 0);
    const texture = new THREE.CanvasTexture(mapCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.wrapS = THREE.RepeatWrapping; // seam-friendly for globe/disc
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshLambertMaterial({ map: texture });

    const terrainGroup = new THREE.Group();
    scene.add(terrainGroup);
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    // ---- precomputed angle tables (fast surface evaluation) ----------------
    // Longitude runs CLOCKWISE seen from +Y (sin negated): that keeps the
    // grid parameterization's handedness equal to the flat map's, so the
    // shared triangle winding stays front-facing — and east correctly
    // appears to the right when you look at the globe from outside.
    const cosLon = new Float64Array(W + 2);
    const sinLon = new Float64Array(W + 2);
    for (let gx = 0; gx <= W + 1; gx++) {
      const lon = (gx / W) * Math.PI * 2;
      cosLon[gx] = Math.cos(lon);
      sinLon[gx] = -Math.sin(lon);
    }
    const cosLat = new Float64Array(H + 1);
    const sinLat = new Float64Array(H + 1);
    for (let gy = 0; gy <= H; gy++) {
      const lat = Math.PI / 2 - (gy / H) * Math.PI;
      cosLat[gy] = Math.cos(lat);
      sinLat[gy] = Math.sin(lat);
    }

    const { elevation } = world;
    const elevAt = (gx: number, gy: number): number => {
      const x = ((gx % W) + W) % W;
      const y = gy < 0 ? 0 : gy >= H ? H - 1 : gy;
      return elevation[y * W + x];
    };

    /** Surface position for grid coords (gx may reach W, gy may reach H). */
    const P = (gx: number, gy: number, shp: Shape3D, exag: number, out: number[]): void => {
      const yMul = unit * exag * Y_PER_KM;
      const e = elevAt(gx, gy);
      if (shp === 'plane') {
        out[0] = gx * unit - SIZE_X / 2;
        out[1] = e * yMul;
        out[2] = gy * unit - sizeZ / 2;
      } else if (shp === 'globe') {
        const gxa = ((gx % W) + W) % W;
        const gya = gy < 0 ? 0 : gy > H ? H : gy;
        const r = R_GLOBE + e * yMul * GLOBE_RELIEF;
        const cl = cosLat[gya];
        out[0] = r * cl * cosLon[gxa];
        out[1] = r * sinLat[gya];
        out[2] = r * cl * sinLon[gxa];
      } else {
        const gxa = ((gx % W) + W) % W;
        const gya = gy < 0 ? 0 : gy > H ? H : gy;
        const rho = (gya / H) * R_DISC;
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

      // -- terrain chunks --
      const chunksX = Math.ceil(W / CHUNK);
      const chunksY = Math.ceil(H / CHUNK);
      for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) {
          const gx0 = cx * CHUNK;
          const gy0 = cy * CHUNK;
          const nx = Math.min(CHUNK, W - gx0) + 1;
          const ny = Math.min(CHUNK, H - gy0) + 1;
          const geo = new THREE.BufferGeometry();
          const count = nx * ny;
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
          const uvs = new Float32Array(count * 2);
          for (let j = 0; j < ny; j++) {
            for (let i2 = 0; i2 < nx; i2++) {
              const k = j * nx + i2;
              uvs[k * 2] = (gx0 + i2) / W;
              uvs[k * 2 + 1] = (gy0 + j) / H;
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
      const waterMat = new THREE.MeshPhongMaterial({
        color: 0x2e6f8e,
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
        const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, sizeZ), waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.02;
        terrainGroup.add(water);
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(SIZE_X, 2, sizeZ),
          new THREE.MeshLambertMaterial({ color: 0x14141d }),
        );
        slab.position.y = -1.35;
        terrainGroup.add(slab);
      } else if (shp === 'globe') {
        const water = new THREE.Mesh(new THREE.SphereGeometry(R_GLOBE + 0.02, 96, 64), waterMat);
        terrainGroup.add(water);
      } else {
        const water = new THREE.Mesh(new THREE.CircleGeometry(R_DISC, 128), waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.02;
        terrainGroup.add(water);
        // The disc rides on a dark pedestal. (Elephants and turtle sold
        // separately.)
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(R_DISC + 0.6, R_DISC * 0.92, 3.2, 128),
          new THREE.MeshLambertMaterial({ color: 0x14141d }),
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
      fog,
      buildShape,
      updateHeights,
      fly: { active: false, t: 0, fromT: new THREE.Vector3(), toT: new THREE.Vector3(), fromC: new THREE.Vector3(), toC: new THREE.Vector3() },
      raf: 0,
      disposed: false,
    };
    refs.current = refsObj;

    buildShape(shapeRef.current, exagRef.current);

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
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---- shape switching ---------------------------------------------------------
  useEffect(() => {
    shapeRef.current = shape;
    const r = refs.current;
    if (!r || r.currentShape === shape) return;
    r.buildShape(shape, exagRef.current);
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, exagRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // ---- exaggeration updates -------------------------------------------------------
  useEffect(() => {
    exagRef.current = exaggeration;
    const r = refs.current;
    if (!r) return;
    r.updateHeights(exaggeration);
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, exaggeration);
  }, [exaggeration, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC]);

  // ---- waypoint markers --------------------------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    placeMarkers(r, world, waypoints, unit, sizeZ, R_GLOBE, R_DISC, exagRef.current);
  }, [waypoints, world, unit, sizeZ, R_GLOBE, R_DISC]);

  // ---- fly-to -------------------------------------------------------------------
  useEffect(() => {
    if (!flyTarget) return;
    const r = refs.current;
    if (!r) return;
    startFly(r, world, flyTarget.u, flyTarget.v, unit, sizeZ, R_GLOBE, R_DISC, exagRef.current);
  }, [flyTarget, world, unit, sizeZ, R_GLOBE, R_DISC]);

  // ---- minimap click → jump ------------------------------------------------------
  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = refs.current;
    const mc = minimapRef.current;
    if (!r || !mc) return;
    const rect = mc.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    startFly(r, world, u, v, unit, sizeZ, R_GLOBE, R_DISC, exagRef.current);
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
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

function elevKmToY(exag: number, unit: number): number {
  return unit * exag * Y_PER_KM;
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
  const yMul = elevKmToY(exag, unit);
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
