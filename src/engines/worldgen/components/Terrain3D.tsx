// ============================================
// World Generator — 3D terrain view (three.js)
// ============================================
// Chunked displaced-plane meshes textured with the (unshaded) atlas render —
// real-time lights do the shading. Orbit/pan/zoom camera, translucent ocean
// plane, waypoint markers with labels, a click-to-jump minimap, and smooth
// fly-to animation. This module is lazy-loaded so three.js stays out of the
// main bundle.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldData } from '../core/types';
import { renderComposite } from '../core/render';
import type { WorldWaypoint } from '../types';

const SIZE_X = 240;               // world width in scene units
const CHUNK = 128;                // cells per chunk side
const Y_FACTOR = 0.055;           // km → scene-units per unit of exaggeration

interface Terrain3DProps {
  world: WorldData;
  waypoints: WorldWaypoint[];
  flyTarget: { u: number; v: number; token: number } | null;
  exaggeration: number;
  onPickWaypoint?: (id: string) => void;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  chunks: { mesh: THREE.Mesh; gx0: number; gy0: number; nx: number; ny: number }[];
  markerGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  mapCanvas: HTMLCanvasElement;
  fly: { active: boolean; t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3 };
  raf: number;
  disposed: boolean;
}

export default function Terrain3D({ world, waypoints, flyTarget, exaggeration, onPickWaypoint }: Terrain3DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<SceneRefs | null>(null);
  const exagRef = useRef(exaggeration);
  const pickRef = useRef(onPickWaypoint);
  pickRef.current = onPickWaypoint;

  const W = world.width, H = world.height;
  const unit = SIZE_X / W;
  const sizeZ = H * unit;

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
    scene.fog = new THREE.Fog(0x0a0e16, sizeZ * 2.2, sizeZ * 6);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.2, sizeZ * 12);
    camera.position.set(0, sizeZ * 0.85, sizeZ * 1.15);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 3;
    controls.maxDistance = sizeZ * 4;
    controls.target.set(0, 0, 0);

    // Lights — sun from the NW to match the 2D hillshade.
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
    sun.position.set(-SIZE_X * 0.35, sizeZ * 1.2, -sizeZ * 0.5);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xbfd0e0, 0.85));

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
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const material = new THREE.MeshLambertMaterial({ map: texture });

    // ---- terrain chunks ----------------------------------------------------
    const { elevation } = world;
    const yScale = () => unit * exagRef.current * (Y_FACTOR / 0.055) * 0.055 / unit; // see setHeights
    void yScale;

    const chunks: SceneRefs['chunks'] = [];
    const chunksX = Math.ceil(W / CHUNK);
    const chunksY = Math.ceil(H / CHUNK);

    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const gx0 = cx * CHUNK;
        const gy0 = cy * CHUNK;
        const nx = Math.min(CHUNK, W - gx0) + 1;   // vertices
        const ny = Math.min(CHUNK, H - gy0) + 1;
        const geo = new THREE.BufferGeometry();
        const verts = new Float32Array(nx * ny * 3);
        const uvs = new Float32Array(nx * ny * 2);
        const norms = new Float32Array(nx * ny * 3);
        const index: number[] = [];
        for (let j = 0; j < ny; j++) {
          for (let i2 = 0; i2 < nx; i2++) {
            const gx = Math.min(W - 1, gx0 + i2);
            const gy = Math.min(H - 1, gy0 + j);
            const k = j * nx + i2;
            verts[k * 3] = (gx0 + i2) * unit - SIZE_X / 2;
            verts[k * 3 + 1] = 0; // filled by setHeights
            verts[k * 3 + 2] = (gy0 + j) * unit - sizeZ / 2;
            uvs[k * 2] = (gx + 0.5) / W;
            uvs[k * 2 + 1] = (gy + 0.5) / H;
          }
        }
        for (let j = 0; j < ny - 1; j++) {
          for (let i2 = 0; i2 < nx - 1; i2++) {
            const a = j * nx + i2, b = a + 1, c = a + nx, d = c + 1;
            index.push(a, c, b, b, c, d);
          }
        }
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
        geo.setIndex(index);
        const mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = true;
        scene.add(mesh);
        chunks.push({ mesh, gx0, gy0, nx, ny });
      }
    }

    const setHeights = (exag: number) => {
      const ys = unit * 0.055 * exag / 0.055; // = unit * exag; kept explicit
      void ys;
      const yMul = elevKmToY(exag, unit);
      for (const ch of chunks) {
        const pos = ch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const nor = ch.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const nArr = nor.array as Float32Array;
        for (let j = 0; j < ch.ny; j++) {
          for (let i2 = 0; i2 < ch.nx; i2++) {
            const gx = Math.min(W - 1, ch.gx0 + i2);
            const gy = Math.min(H - 1, ch.gy0 + j);
            const k = j * ch.nx + i2;
            arr[k * 3 + 1] = elevation[gy * W + gx] * yMul;
            // Analytic normal from the height grid (x wraps, y clamps) —
            // computed globally so chunk borders never show seams.
            const xl = gx > 0 ? gx - 1 : W - 1;
            const xr = gx < W - 1 ? gx + 1 : 0;
            const yu = Math.max(0, gy - 1);
            const yd = Math.min(H - 1, gy + 1);
            const dydx = (elevation[gy * W + xr] - elevation[gy * W + xl]) * yMul / (2 * unit);
            const dydz = (elevation[yd * W + gx] - elevation[yu * W + gx]) * yMul / (2 * unit);
            const inv = 1 / Math.sqrt(dydx * dydx + dydz * dydz + 1);
            nArr[k * 3] = -dydx * inv;
            nArr[k * 3 + 1] = inv;
            nArr[k * 3 + 2] = -dydz * inv;
          }
        }
        pos.needsUpdate = true;
        nor.needsUpdate = true;
        ch.mesh.geometry.computeBoundingSphere();
      }
    };
    setHeights(exagRef.current);

    // ---- water --------------------------------------------------------------
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE_X, sizeZ),
      new THREE.MeshPhongMaterial({
        color: 0x2e6f8e,
        transparent: true,
        opacity: 0.72,
        shininess: 90,
        specular: new THREE.Color(0x334455),
        depthWrite: false,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.02;
    scene.add(water);

    // Base slab so the map has a visible edge.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(SIZE_X, 2, sizeZ),
      new THREE.MeshLambertMaterial({ color: 0x14141d }),
    );
    slab.position.y = -1.35;
    scene.add(slab);

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    const refsObj: SceneRefs = {
      renderer, scene, camera, controls, chunks, markerGroup,
      raycaster: new THREE.Raycaster(),
      mapCanvas,
      fly: { active: false, t: 0, fromT: new THREE.Vector3(), toT: new THREE.Vector3(), fromC: new THREE.Vector3(), toC: new THREE.Vector3() },
      raf: 0,
      disposed: false,
    };
    refs.current = refsObj;
    (refsObj as unknown as { setHeights: (e: number) => void }).setHeights = setHeights;

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
    let minimapDirty = 0;
    const drawMinimap = () => {
      // Redraw at ~12fps — it's just an overlay.
      if (minimapDirty++ % 5 !== 0) return;
      const mc = minimapRef.current;
      if (!mc) return;
      const mctx = mc.getContext('2d')!;
      mctx.clearRect(0, 0, mc.width, mc.height);
      mctx.drawImage(mapCanvas, 0, 0, mc.width, mc.height);
      // camera target marker
      const u = (controls.target.x + SIZE_X / 2) / SIZE_X;
      const v = (controls.target.z + sizeZ / 2) / sizeZ;
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
      for (const ch of chunks) ch.mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      water.geometry.dispose();
      (water.material as THREE.Material).dispose();
      slab.geometry.dispose();
      (slab.material as THREE.Material).dispose();
      disposeMarkers(markerGroup);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---- exaggeration updates --------------------------------------------------
  useEffect(() => {
    exagRef.current = exaggeration;
    const r = refs.current as (SceneRefs & { setHeights?: (e: number) => void }) | null;
    r?.setHeights?.(exaggeration);
    // Waypoint markers ride on the surface — refresh their heights too.
    if (r) placeMarkers(r, world, waypoints, unit, sizeZ, exaggeration);
  }, [exaggeration, world, waypoints, unit, sizeZ]);

  // ---- waypoint markers --------------------------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    placeMarkers(r, world, waypoints, unit, sizeZ, exagRef.current);
  }, [waypoints, world, unit, sizeZ]);

  // ---- fly-to -------------------------------------------------------------------
  useEffect(() => {
    if (!flyTarget) return;
    const r = refs.current;
    if (!r) return;
    const x = flyTarget.u * SIZE_X - SIZE_X / 2;
    const z = flyTarget.v * sizeZ - sizeZ / 2;
    const y = sampleElevY(world, flyTarget.u, flyTarget.v, exagRef.current, unit);
    r.fly.fromT.copy(r.controls.target);
    r.fly.toT.set(x, y, z);
    r.fly.fromC.copy(r.camera.position);
    r.fly.toC.set(x + 6, y + 16, z + 24);
    r.fly.t = 0;
    r.fly.active = true;
  }, [flyTarget, world, unit, sizeZ]);

  // ---- minimap click → jump ------------------------------------------------------
  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = refs.current;
    const mc = minimapRef.current;
    if (!r || !mc) return;
    const rect = mc.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const x = u * SIZE_X - SIZE_X / 2;
    const z = v * sizeZ - sizeZ / 2;
    const y = sampleElevY(world, u, v, exagRef.current, unit);
    r.fly.fromT.copy(r.controls.target);
    r.fly.toT.set(x, y, z);
    r.fly.fromC.copy(r.camera.position);
    const off = r.camera.position.clone().sub(r.controls.target);
    if (off.length() > sizeZ * 0.8) off.setLength(sizeZ * 0.5);
    r.fly.toC.copy(r.fly.toT).add(off);
    r.fly.t = 0;
    r.fly.active = true;
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
  // 1 km of elevation → this many scene units. `unit` keeps it resolution-
  // independent (same visual height whatever the grid width).
  return unit * exag * 0.24;
}

function sampleElevY(world: WorldData, u: number, v: number, exag: number, unit: number): number {
  const { width: W, height: H, elevation } = world;
  const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  return Math.max(0, elevation[y * W + x]) * elevKmToY(exag, unit);
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

function placeMarkers(
  r: SceneRefs,
  world: WorldData,
  waypoints: WorldWaypoint[],
  unit: number,
  sizeZ: number,
  exag: number,
): void {
  disposeMarkers(r.markerGroup);
  for (const wp of waypoints) {
    const group = new THREE.Group();
    group.userData.waypointId = wp.id;
    const color = new THREE.Color(wp.color);

    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.6, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    pin.rotation.x = Math.PI; // point down
    pin.position.y = 1.3;
    group.add(pin);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 12, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    knob.position.y = 2.9;
    group.add(knob);

    // Text label sprite
    const label = makeLabelSprite(wp.name, wp.color);
    label.position.y = 4.6;
    group.add(label);

    const x = wp.u * (unit * world.width) - (unit * world.width) / 2;
    const z = wp.v * sizeZ - sizeZ / 2;
    const y = sampleElevY(world, wp.u, wp.v, exag, unit);
    group.position.set(x, y, z);
    r.markerGroup.add(group);
  }
}

function makeLabelSprite(text: string, accent: string): THREE.Sprite {
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
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.055;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}
