import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Globe, Layers, Loader2, Sun, Sliders, FlipHorizontal, FlipVertical,
} from 'lucide-react';
import type { WorldData } from '../core/types';
import { BIOME_COUNT } from '../core/types';
import { BIOME_COLORS, renderComposite } from '../core/render';
import { SculptGesture } from '../sculpt/ops';
import {
  SculptSurface, pickCell, visibleWindow, SIZE_X, R_GLOBE, type SculptShape,
} from '../sculpt/scene3d';
import type { Pt, TerrainOp, WorldEdit } from '../core/edits';
import { commitPaintStroke, isSculptMode, negativeOf, pickGeneratedAt } from '../core/paintCommit';
import type { HumanGeography, Settlement } from '../core/settlements';
import { getCartoTexture } from '../cartography/texture';
import type { CartoTheme } from '../cartography/theme';
import type { WorldWaypoint } from '../types';
import { CURVES, TIPS, type PaintTool } from './PaintPanel';
import SculptView from './SculptView';

/**
 * The world, in three dimensions. The main view.
 *
 * There used to be two of these: a "terrain" view that could show a finished map
 * and could not be touched, and a "sculpt" view that could be touched and showed
 * grey clay. That split was a mistake in the same way a modal dialogue is a
 * mistake — it made the reader choose, before doing anything, between seeing the
 * world and changing it. This is one view: the map is on the ground, the brush
 * works on it, and the skin is a toggle rather than a mode.
 *
 * What makes it possible is that the geometry never changes. The grid is built
 * once, the height comes from a texture the vertex shader reads, and the grid is
 * stretched over the square of the world the camera can currently see — so the
 * same million triangles buy a hundred times the detail when you lean in, and a
 * brush stroke is a rectangle of texture rather than a mesh rebuild. See
 * `sculpt/scene3d.ts`.
 *
 * Conventions are the ones a sculptor's hands already know:
 *
 *   left drag          the brush, or turning the world when no brush is out
 *   middle / right     turn and move the camera
 *   wheel              closer and further
 *   Ctrl + wheel       brush size          (also [ and ])
 *   Shift + wheel      brush strength
 *   Shift held         smooth, whatever the brush was
 *   Ctrl held          the brush inverted
 *   F                  put what is under the pointer at the centre of the turn
 *   X / Y              symmetry
 *   G                  plane or globe
 *   Ctrl+Z / Ctrl+Y    undo, redo
 */

/** What is painted on the ground. */
export type Skin3D = 'satelite' | 'dibujado' | 'arcilla';
export type Shape3D = SculptShape;

interface World3DProps {
  world: WorldData;
  geography?: HumanGeography | null;
  theme: CartoTheme;
  waypoints: WorldWaypoint[];
  showWaypoints: boolean;
  showSettlements: boolean;
  skin: Skin3D;
  shape: Shape3D;
  onShape: (s: Shape3D) => void;
  exaggeration: number;
  tool: PaintTool;
  /** So the wheel and the bracket keys can change the brush the panel owns. */
  onTool?: (patch: Partial<PaintTool>) => void;
  onEdit: (edit: WorldEdit) => void;
  /** Several edits as ONE undo step — a symmetric stroke is four of them. */
  onEdits?: (edits: WorldEdit[]) => void;
  revision: number;
  flyTarget: { u: number; v: number; token: number } | null;
  onPickSettlement?: (s: Settlement) => void;
  onPickWaypoint?: (id: string) => void;
  onOpenRegion?: (x: number, y: number) => void;
}

/** Mesh density presets, in vertices across the visible square. */
const MESH_STEPS = [384, 640, 1024, 1536];

/** Which brush Ctrl turns each one into. */
const INVERSE: Partial<Record<TerrainOp, TerrainOp>> = {
  raise: 'lower',
  lower: 'raise',
  smooth: 'sharpen',
  sharpen: 'smooth',
  roughen: 'smooth',
  gully: 'smooth',
};

const OP_LABEL: Record<TerrainOp, string> = {
  raise: 'Levantar',
  lower: 'Hundir',
  smooth: 'Suavizar',
  sharpen: 'Afilar',
  flatten: 'Aplanar',
  terrace: 'Escalonar',
  roughen: 'Rugosear',
  gully: 'Barrancos',
  grab: 'Agarrar',
};

const OPS: TerrainOp[] = [
  'raise', 'lower', 'smooth', 'sharpen', 'flatten', 'terrace', 'roughen', 'gully', 'grab',
];

/**
 * One HUD style, used by everything that floats over the map.
 *
 * The old chips were `bg-black/45` with `text-white/70` at ten pixels, which over
 * a bright map is somewhere between hard and impossible to read — a control hint
 * you have to squint at is a control hint that does not exist. Near-opaque
 * ground, a light hairline to separate it from whatever is behind, and text at
 * full white.
 */
const HUD = 'rounded-md border border-white/20 bg-[#0b0e14]/92 shadow-lg shadow-black/50 backdrop-blur-sm';
const HUD_TEXT = 'text-[11px] leading-snug text-white';

const RANK_ORDER: Record<string, number> = { capital: 0, city: 1, town: 2, village: 3 };

interface ScreenMark {
  x: number;
  y: number;
  kind: 'settlement' | 'waypoint';
  rank: number;
  label: string;
  color: string;
  settlement?: Settlement;
  waypointId?: string;
  /** Where the name ended up, filled in by the draw. A name is a far bigger
   *  target than a four-pixel dot, and the reader is aiming at the place. */
  hit?: { x0: number; y0: number; x1: number; y1: number };
}

export default function World3D({
  world, geography, theme, waypoints, showWaypoints, showSettlements,
  skin, shape, onShape, exaggeration, tool, onTool, onEdit, onEdits, revision,
  flyTarget, onPickSettlement, onPickWaypoint, onOpenRegion,
}: World3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [mesh, setMesh] = useState(1);
  const [cavity, setCavity] = useState(0.5);
  const [headlight, setHeadlight] = useState(false);
  const [shadow, setShadow] = useState(0.55);
  const [contour, setContour] = useState(0);
  const [sunAz, setSunAz] = useState(140);
  const [detailAmt, setDetailAmt] = useState(0.55);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [panel, setPanel] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [ready, setReady] = useState(false);
  const [readout, setReadout] = useState('');
  const [hovering, setHovering] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  /** What the modifier keys are doing to the brush right now. */
  const [modifier, setModifier] = useState<'' | 'smooth' | 'invert'>('');

  const R = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    surface: SculptSurface;
    sea: THREE.Mesh;
    seaGlobe: THREE.Mesh;
    albedo: THREE.CanvasTexture | null;
    raf: number;
    timer: number;
    need: boolean;
    rafAlive: boolean;
    booked: number;
    cost: number;
    lastDraw: number;
    uploadedRev: number;
    skinnedRev: number;
    skinnedKey: string;
    poseKey: string;
    marks: ScreenMark[];
    fly: { active: boolean; t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3 };
  } | null>(null);

  const gesture = useRef<SculptGesture | null>(null);
  /** Cells the pointer has passed through, for the brushes that are not sculpts. */
  const trail = useRef<Pt[] | null>(null);
  const cursor = useRef<Pt | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean; button: number } | null>(null);
  const altRef = useRef(false);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const mirrorRef = useRef({ x: mirrorX, y: mirrorY });
  mirrorRef.current = { x: mirrorX, y: mirrorY };
  const keys = useRef({ shift: false, ctrl: false });
  const over = useRef(false);
  const propsRef = useRef({ geography, waypoints, showWaypoints, showSettlements, onPickSettlement, onPickWaypoint, onOpenRegion });
  propsRef.current = { geography, waypoints, showWaypoints, showSettlements, onPickSettlement, onPickWaypoint, onOpenRegion };

  /** Every brush takes the left button; only two of them move ground. */
  const brushing = tool.mode !== 'off';
  const brushingRef = useRef(brushing);
  brushingRef.current = brushing;
  const sculpting = isSculptMode(tool.mode);
  const sculptingRef = useRef(sculpting);
  sculptingRef.current = sculpting;

  // ---- scene ---------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(2, host.clientWidth), Math.max(2, host.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);

    // A narrow field of view: perspective distorts the very thing you are
    // judging — whether a slope is steeper than the one beside it.
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 6000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.zoomSpeed = 0.9;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // The pump only draws when something asks it to, and a wheel handled by
    // OrbitControls asks nobody: the camera moved and the picture did not, so
    // zooming looked frozen until the reader happened to move the mouse as well.
    // Marking the frame dirty is enough — the rescue clock picks it up next tick.
    controls.addEventListener('change', () => { if (R.current) R.current.need = true; });

    const palette: [number, number, number][] = [];
    for (let i = 0; i < BIOME_COUNT; i++) {
      const c = BIOME_COLORS[i] ?? [128, 128, 128];
      palette.push([c[0] / 255, c[1] / 255, c[2] / 255]);
    }

    let surface: SculptSurface;
    try {
      surface = new SculptSurface({
        worldWidth: world.width, worldHeight: world.height, mesh: MESH_STEPS[1], palette,
      });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      renderer.dispose();
      return;
    }
    surface.uploadAll(world.elevation, world.biome);
    scene.add(surface.mesh);

    // The sea is a real surface, not a colour below zero: you need to see the
    // land go under it while you are pushing it down.
    const seaMat = new THREE.MeshBasicMaterial({
      color: 0x3f6f96, transparent: true, opacity: 0.5, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sizeZ = SIZE_X * (world.height / world.width);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, sizeZ), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.renderOrder = 1;
    scene.add(sea);
    const seaGlobe = new THREE.Mesh(new THREE.SphereGeometry(R_GLOBE, 96, 64), seaMat);
    seaGlobe.visible = false;
    seaGlobe.renderOrder = 1;
    scene.add(seaGlobe);

    const st = {
      renderer, scene, camera, controls, surface, sea, seaGlobe,
      albedo: null as THREE.CanvasTexture | null,
      raf: 0, timer: 0, need: true, rafAlive: true, booked: 0, cost: 16, lastDraw: 0,
      uploadedRev: revision, skinnedRev: -1, skinnedKey: '', poseKey: '',
      marks: [] as ScreenMark[],
      fly: {
        active: false, t: 0,
        fromT: new THREE.Vector3(), toT: new THREE.Vector3(),
        fromC: new THREE.Vector3(), toC: new THREE.Vector3(),
      },
    };
    R.current = st;
    setReady(true);

    const resize = () => {
      const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      st.need = true;
      st.poseKey = '';
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    return () => {
      ro.disconnect();
      window.clearInterval(st.timer);
      if (st.raf) cancelAnimationFrame(st.raf);
      controls.dispose();
      surface.dispose();
      st.albedo?.dispose();
      seaMat.dispose();
      sea.geometry.dispose();
      seaGlobe.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      R.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---- where things are, in the scene and on the screen --------------------
  const sizeZ = SIZE_X * (world.height / world.width);

  /** Scene position of a world cell, matching the shader's `placeAt` exactly. */
  const scenePos = useCallback((cx: number, cy: number, out: THREE.Vector3): THREE.Vector3 => {
    const st = R.current;
    if (!st) return out.set(0, 0, 0);
    const e = st.surface.heightAtCell(cx, cy);
    const yMul = st.surface.yMul;
    if (shapeRef.current === 'plane') {
      return out.set(
        (cx / world.width - 0.5) * SIZE_X,
        e * yMul,
        (cy / world.height - 0.5) * sizeZ,
      );
    }
    const lon = (cx / world.width - 0.5) * Math.PI * 2;
    const lat = (0.5 - cy / world.height) * Math.PI;
    const r = R_GLOBE + e * yMul * 0.55;
    return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
  }, [world.width, world.height, sizeZ]);

  /**
   * The dots and their labels, projected for this frame.
   *
   * Deliberately NOT three.js sprites. A sprite per settlement is a texture per
   * settlement, rebuilt every time a name changes and re-uploaded every time the
   * exaggeration slider moves; and sprite text is a picture of text, so it goes
   * soft the moment you lean in — which is exactly when you are reading it. On a
   * 2D canvas over the frame the labels are real text at device resolution, and
   * they cost one projection each.
   */
  const projectMarks = useCallback((): ScreenMark[] => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return [];
    const { geography: geo, waypoints: wps, showWaypoints: sw, showSettlements: ss } = propsRef.current;
    const w = host.clientWidth, h = host.clientHeight;
    const out: ScreenMark[] = [];
    const p = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    /** Project, cull, and place. Returns null when the point is not on screen. */
    const place = (cx: number, cy: number): { x: number; y: number } | null => {
      scenePos(cx, cy, p);
      if (shapeRef.current === 'globe') {
        // The far side of a planet is behind the planet.
        camDir.copy(st.camera.position).sub(p);
        if (p.dot(camDir) <= 0) return null;
      }
      p.project(st.camera);
      if (p.z > 1 || p.x < -1.08 || p.x > 1.08 || p.y < -1.08 || p.y > 1.08) return null;
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };

    if (ss && geo) {
      // How much of the world is on screen decides how much of the gazetteer
      // is worth drawing: every village at full zoom is a grey smear, and only
      // the capitals at close range is a map with nothing on it.
      const win = st.surface.uvWindow.size;
      const maxRank = win > 0.55 ? 1 : win > 0.22 ? 2 : 3;
      const ranked = geo.settlements
        .filter((s) => (RANK_ORDER[s.rank] ?? 3) <= maxRank)
        .sort((a, b) => (RANK_ORDER[a.rank] ?? 3) - (RANK_ORDER[b.rank] ?? 3))
        .slice(0, 160);
      for (const s of ranked) {
        const at = place(s.x, s.y);
        if (!at) continue;
        out.push({
          x: at.x, y: at.y, kind: 'settlement',
          rank: RANK_ORDER[s.rank] ?? 3,
          label: s.name, color: '#f2e3c4', settlement: s,
        });
      }
    }
    if (sw) {
      for (const wp of wps) {
        const at = place(wp.u * world.width, wp.v * world.height);
        if (!at) continue;
        out.push({
          x: at.x, y: at.y, kind: 'waypoint', rank: -1,
          label: wp.name, color: wp.color, waypointId: wp.id,
        });
      }
    }
    return out;
  }, [scenePos, world.width, world.height]);

  const drawOverlay = useCallback((marks: ScreenMark[]) => {
    const oc = overlayRef.current;
    const host = hostRef.current;
    if (!oc || !host) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
    if (oc.width !== Math.round(w * dpr) || oc.height !== Math.round(h * dpr)) {
      oc.width = Math.round(w * dpr);
      oc.height = Math.round(h * dpr);
      oc.style.width = `${w}px`;
      oc.style.height = `${h}px`;
    }
    const ctx = oc.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';

    /**
     * Labels that would collide are not drawn.
     *
     * Without this the far view is a hedge of overlapping names — thirty of them
     * across a continent, each one making the next unreadable, which is worse
     * than showing five. Biggest place first (the list is already rank-sorted),
     * so what survives a crowd is what a real map would have kept.
     */
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const fits = (x0: number, y0: number, x1: number, y1: number): boolean => {
      for (const r of taken) {
        if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return false;
      }
      taken.push({ x0, y0, x1, y1 });
      return true;
    };

    for (const m of marks) {
      if (m.kind === 'waypoint') {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - 5, m.y - 13);
        ctx.lineTo(m.x + 5, m.y - 13);
        ctx.closePath();
        ctx.fillStyle = m.color;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(6,8,13,0.9)';
        ctx.stroke();
        // A pin the reader placed always keeps its name: they put it there.
        ctx.font = '500 11px "Source Sans 3", system-ui, sans-serif';
        const pw = ctx.measureText(m.label).width;
        fits(m.x - pw / 2, m.y - 30, m.x + pw / 2, m.y - 16);
        label(ctx, m.label, m.x, m.y - 22, 11, m.color);
        continue;
      }
      const big = m.rank <= 1;
      const r = m.rank === 0 ? 5 : m.rank === 1 ? 4 : m.rank === 2 ? 3 : 2.2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fillStyle = m.rank === 0 ? '#ffd479' : '#f4ead4';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(6,8,13,0.92)';
      ctx.stroke();
      if (m.rank === 0) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,212,121,0.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      const size = big ? 12 : 11;
      ctx.font = `${size >= 12 ? 600 : 500} ${size}px "Source Sans 3", system-ui, sans-serif`;
      const tw = ctx.measureText(m.label).width;
      const lx = m.x + r + 5;
      m.hit = undefined;
      if (fits(lx - 2, m.y - size * 0.7, lx + tw + 2, m.y + size * 0.7)) {
        label(ctx, m.label, lx, m.y, size, '#f6efe0');
        m.hit = { x0: lx - 3, y0: m.y - size, x1: lx + tw + 3, y1: m.y + size };
      }
    }
  }, []);

  // ---- the frame pump ------------------------------------------------------
  //
  // A window whose only content is a static canvas can stop being composited,
  // and then `requestAnimationFrame` never fires again — which wedged this view
  // shut once already, with a frozen picture and a brush that changed the data
  // without changing the image. The pump runs whenever the controls report
  // change and idles otherwise, with a rescue clock behind it.
  const drawRef = useRef<() => void>(() => {});
  const request = useCallback(() => {
    const st = R.current;
    if (!st) return;
    st.need = true;
    if (!st.rafAlive || st.raf) return;
    st.booked = performance.now();
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      drawRef.current();
    });
  }, []);

  const draw = useCallback(() => {
    const st = R.current;
    if (!st) return;
    st.need = false;
    const t0 = performance.now();

    if (st.fly.active) {
      st.fly.t = Math.min(1, st.fly.t + 1 / 42);
      const s = st.fly.t < 0.5 ? 2 * st.fly.t * st.fly.t : 1 - Math.pow(-2 * st.fly.t + 2, 2) / 2;
      st.controls.target.lerpVectors(st.fly.fromT, st.fly.toT, s);
      st.camera.position.lerpVectors(st.fly.fromC, st.fly.toC, s);
      if (st.fly.t >= 1) st.fly.active = false;
      st.need = true;
    }
    const moving = st.controls.update();

    // The UV window: the grid is stretched over what the camera can see, so the
    // triangles are spent where the reader is looking instead of on the far side
    // of the world. Recomputed only when the camera actually moved.
    const c = st.camera;
    const key = `${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)},`
      + `${st.controls.target.x.toFixed(2)},${st.controls.target.y.toFixed(2)},${st.controls.target.z.toFixed(2)}`;
    if (key !== st.poseKey) {
      st.poseKey = key;
      st.surface.setWindow(visibleWindow(c, shapeRef.current, world.width, world.height));
      st.surface.setCamera(c.position);
      const cpq = st.surface.cellsPerQuad(MESH_STEPS[mesh]);
      const km = Math.round((40075 / world.width) * cpq);
      setDetail(cpq < 1
        ? `${(1 / cpq).toFixed(1)} triángulos por celda`
        : `${cpq.toFixed(1)} celdas por triángulo · ~${km} km`);
    }

    st.renderer.render(st.scene, st.camera);
    st.marks = projectMarks();
    drawOverlay(st.marks);

    const cost = performance.now() - t0;
    st.cost = cost;
    st.lastDraw = performance.now();
    setMs(Math.round(cost));
    // Damping is a per-FRAME decay, so it silently assumes sixty of them a
    // second. Below a usable frame rate the camera goes where it is put.
    st.controls.enableDamping = cost < 40;
    if (moving) st.need = true;
  }, [world.width, world.height, mesh, projectMarks, drawOverlay]);
  drawRef.current = draw;

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.timer = window.setInterval(() => {
      const now = performance.now();
      // A frame that has not arrived is only evidence of a dead clock if the
      // main thread was FREE to deliver it — and a frame here can legitimately
      // cost half a second, so the deadline scales with what one actually costs.
      if (st.raf && now - st.booked > Math.max(500, st.cost * 4)) {
        st.rafAlive = false;
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
      if (!st.need) return;
      if (st.rafAlive) { request(); return; }
      if (now - st.lastDraw < Math.max(16, st.cost)) return;
      drawRef.current();
    }, 16);
    return () => window.clearInterval(st.timer);
  }, [ready, request]);

  // ---- shape ---------------------------------------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setShape(shape);
    st.sea.visible = shape === 'plane';
    st.seaGlobe.visible = shape === 'globe';
    // How far back the whole thing fits. The bounding extent and the NARROWER of
    // the two field angles give the distance that cannot crop, whatever the
    // shape of the panel.
    const halfV = (st.camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * Math.max(0.2, st.camera.aspect));
    if (shape === 'plane') {
      // 52° above the ground: high enough to read the whole sheet, low enough
      // that relief still has a silhouette. Looking straight down is the 2D
      // view, and the 2D view is what this one exists to stop being.
      const a = (52 * Math.PI) / 180;
      const relief = 9 * (0.24 * exaggeration * (SIZE_X / world.width));
      const dV = (sizeZ * Math.sin(a) * 0.5 + relief) / Math.tan(halfV);
      const dH = SIZE_X * 0.5 / Math.tan(halfH);
      const d = Math.max(dV, dH) * 1.06;
      st.controls.target.set(0, 0, 0);
      st.camera.position.set(0, Math.sin(a) * d, Math.cos(a) * d);
      st.controls.minDistance = 0.6;
      st.controls.maxDistance = d * 2.2;
      st.controls.maxPolarAngle = Math.PI * 0.499;
      st.controls.enablePan = true;
      st.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    } else {
      const d = (R_GLOBE * 1.1) / Math.sin(Math.max(0.08, Math.min(halfV, halfH)));
      st.controls.target.set(0, 0, 0);
      st.camera.position.set(d * 0.42, d * 0.38, d * 0.82);
      st.controls.minDistance = R_GLOBE * 1.02;
      st.controls.maxDistance = d * 3;
      st.controls.maxPolarAngle = Math.PI;
      st.controls.enablePan = false;
      // Panning a globe about a fixed centre does nothing useful, so the right
      // button turns it instead of pretending.
      st.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    }
    st.fly.active = false;
    st.controls.update();
    st.poseKey = '';
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, ready, world.height, world.width, request]);

  // ---- the skin ------------------------------------------------------------
  //
  // Rebuilt when the reader changes it, when the theme changes, and when the
  // world does — a painted island whose raster is a revision behind is an island
  // that is there in the relief and missing from the ground.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    const rev = revision;
    const key = `${skin}:${theme.id}:${geography ? 'geo' : 'bare'}`;
    if (st.skinnedKey === key && st.skinnedRev === rev) return;
    st.skinnedKey = key;
    st.skinnedRev = rev;

    if (skin === 'arcilla') {
      st.surface.setAlbedo(null);
      st.surface.setShading(true, cavity, headlight, shadow);
      st.albedo?.dispose();
      st.albedo = null;
      request();
      return;
    }

    let canvas: HTMLCanvasElement;
    if (skin === 'dibujado') {
      canvas = getCartoTexture(world, theme, geography ?? undefined,
        Math.min(4096, Math.max(2048, world.width)));
    } else {
      // Unshaded on purpose: the scene supplies the form, and a second NW
      // hillshade baked into the raster would shade every slope twice.
      const rgba = renderComposite(world, 'atlas', true, { shade: false });
      canvas = document.createElement('canvas');
      canvas.width = world.width;
      canvas.height = world.height;
      canvas.getContext('2d')!.putImageData(new ImageData(rgba, world.width, world.height), 0, 0);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // v = 0 is the north row of the raster, which is only true if three.js does
    // not flip it on upload.
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, st.renderer.capabilities.getMaxAnisotropy());
    st.albedo?.dispose();
    st.albedo = tex;
    st.surface.setAlbedo(tex, true);
    st.surface.setShading(false, cavity, headlight, shadow);
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, theme, geography, world, revision, ready, request]);

  // ---- everything else the look depends on ---------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setExaggeration(exaggeration);
    st.surface.setShading(skin === 'arcilla', cavity, headlight, shadow);
    st.surface.setContour(contour);
    st.surface.setSun(sunAz, 38);
    st.surface.setMirror(mirrorX, mirrorY);
    st.surface.setDetail(detailAmt);
    request();
  }, [exaggeration, skin, cavity, headlight, shadow, contour, sunAz, mirrorX, mirrorY, detailAmt, ready, request]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setMesh(MESH_STEPS[mesh]);
    st.poseKey = '';
    request();
  }, [mesh, ready, request]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    if (st.uploadedRev !== revision) {
      st.surface.uploadAll(world.elevation, world.biome);
      st.uploadedRev = revision;
    }
    request();
  }, [revision, world, ready, request]);

  // Markers move when the gazetteer or the pins do, with no camera movement to
  // trigger a frame.
  useEffect(() => { request(); }, [geography, waypoints, showWaypoints, showSettlements, request]);

  // ---- fly to a point ------------------------------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st || !flyTarget) return;
    const target = new THREE.Vector3();
    scenePos(flyTarget.u * world.width, flyTarget.v * world.height, target);
    st.fly.fromT.copy(st.controls.target);
    st.fly.fromC.copy(st.camera.position);
    if (shapeRef.current === 'globe') {
      // A globe turns about its own centre; framing means looking at the point
      // from outside it, not moving the centre off the origin.
      st.fly.toT.set(0, 0, 0);
      st.fly.toC.copy(target).normalize().multiplyScalar(R_GLOBE * 2.0);
    } else {
      st.fly.toT.copy(target);
      const d = Math.max(6, sizeZ * 0.16);
      st.fly.toC.copy(target).add(new THREE.Vector3(0, d * 0.72, d * 0.62));
    }
    st.fly.t = 0;
    st.fly.active = true;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget, request]);

  // ---- picking -------------------------------------------------------------
  const cellUnder = useCallback((clientX: number, clientY: number): Pt | null => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return null;
    const r = host.getBoundingClientRect();
    const origin = st.camera.position.clone();
    const dir = new THREE.Vector3(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
      0.5,
    ).unproject(st.camera).sub(origin).normalize();
    return pickCell(st.surface, origin, dir, shapeRef.current, world.width, world.height);
  }, [world.width, world.height]);

  /** The dot under the pointer, if any, from the marks this frame already drew. */
  const markUnder = useCallback((clientX: number, clientY: number): ScreenMark | null => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return null;
    const r = host.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    let best: ScreenMark | null = null;
    let bestD = 16 * 16;
    for (const m of st.marks) {
      // The name counts as part of the target: it is what the reader can see
      // and what they are actually pointing at.
      if (m.hit && px >= m.hit.x0 && px <= m.hit.x1 && py >= m.hit.y0 && py <= m.hit.y1) return m;
      const d = (m.x - px) * (m.x - px) + (m.y - py) * (m.y - py);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }, []);

  /**
   * What the next stroke will actually do.
   *
   * Modifier keys beat the panel, which is the convention everywhere: Shift is
   * smooth no matter what was selected, Ctrl is the same brush the other way
   * round. Resolved once when the button goes down and held for the whole
   * stroke, so letting go of Shift halfway does not change the brush under the
   * reader's hand.
   */
  const resolveBrush = useCallback((shift: boolean, ctrl: boolean) => {
    const t = toolRef.current;
    if (shift) return { kind: 'terrain' as const, op: 'smooth' as TerrainOp };
    if (t.mode === 'land') {
      const op = ctrl ? (t.landOp === 'land' ? 'sea' : 'land') : t.landOp;
      return { kind: 'land' as const, op };
    }
    const op = ctrl ? (INVERSE[t.terrainOp] ?? t.terrainOp) : t.terrainOp;
    return { kind: 'terrain' as const, op };
  }, []);

  const uploadDirty = useCallback((d: { x0: number; y0: number; x1: number; y1: number }) => {
    const st = R.current;
    if (!st || d.x1 < d.x0) return;
    st.surface.patch(world.elevation, null, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
  }, [world.elevation]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    if (!st) return;
    // Ctrl, not Alt: one key means "the other way round" for every tool, and it
    // is already what the sculpt preview reads while a stroke is in flight.
    altRef.current = e.ctrlKey || e.metaKey;
    press.current = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    if (e.button !== 0 || !brushingRef.current) return;
    const p = cellUnder(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const t = toolRef.current;
    if (sculptingRef.current) {
      const b = resolveBrush(e.shiftKey, e.ctrlKey || e.metaKey);
      gesture.current = new SculptGesture(
        world.elevation, world.width, world.height, world.params.seed,
        {
          kind: b.kind, op: b.op,
          radius: t.radius, strength: t.strength, softness: t.softness,
          curve: t.curve, tip: t.tip, angle: t.angle,
          jitter: t.jitter, aspect: t.aspect, taper: t.taper,
          mirrorX: mirrorRef.current.x, mirrorY: mirrorRef.current.y,
        },
      );
      uploadDirty(gesture.current.extend(p));
    } else {
      // Everything else — biome, river, road, a town, a name — is just the list
      // of cells the pointer crossed, and becomes an edit when the button comes
      // back up. There is nothing to preview because the raster underneath is
      // rebuilt from the edit, not from the gesture.
      trail.current = [p];
    }
    cursor.current = p;
    request();
  }, [cellUnder, resolveBrush, uploadDirty, world, request]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    if (!st) return;
    if (press.current && !press.current.moved
        && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 4) {
      press.current.moved = true;
    }

    // With no brush out, the pointer is a pointer: what it is over matters more
    // than where it is on the ground, and a height query per mouse move is not
    // free.
    if (!brushingRef.current) {
      const m = markUnder(e.clientX, e.clientY);
      setHovering(m ? m.label : null);
      if (!press.current) {
        const p = cellUnder(e.clientX, e.clientY);
        setReadout(p ? describe(world, p) : '');
      }
      return;
    }

    const p = cellUnder(e.clientX, e.clientY);
    cursor.current = p;
    const t = toolRef.current;
    if (p) {
      st.surface.setBrush(p.x, p.y, t.radius, t.softness, true);
      setReadout(describe(world, p));
    } else {
      st.surface.setBrush(0, 0, 1, t.softness, false);
      setReadout('');
    }
    const g = gesture.current;
    if (g && p) uploadDirty(g.extend(p));
    const tr = trail.current;
    if (tr && p) {
      const last = tr[tr.length - 1];
      // One point per half-cell is plenty, and it keeps the serialized edit
      // small enough to store a hundred strokes.
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) tr.push(p);
    }
    request();
  }, [cellUnder, markUnder, uploadDirty, world, request]);

  const finish = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    const g = gesture.current;
    const tr = trail.current;
    gesture.current = null;
    trail.current = null;
    const p = press.current;
    press.current = null;

    if (g && g.points) {
      // The live pass is a preview. It is rolled back and the stroke committed
      // as edits, which the session replays from the pristine snapshot — so what
      // ends up in the world is exactly what regenerating from the seed and the
      // edit list would produce, never what the preview happened to do.
      g.rollback();
      st?.surface.uploadAll(world.elevation, world.biome);
      const edits: WorldEdit[] = g.edits().map((ed) => (ed.kind === 'land'
        ? { kind: 'land', op: ed.op as 'land' | 'sea', stroke: ed.stroke }
        : { kind: 'terrain', op: ed.op as TerrainOp, stroke: ed.stroke }));
      if (edits.length) {
        if (onEdits) onEdits(edits);
        else for (const ed of edits) onEdit(ed);
      }
      request();
      return;
    }

    if (tr && tr.length) {
      const spec = altRef.current ? negativeOf(toolRef.current) : toolRef.current;
      const edit = commitPaintStroke(spec, tr, {
        negative: altRef.current,
        pickGenerated: (x, y) => pickGeneratedAt(
          world, propsRef.current.geography, x, y,
          Math.max(3, st ? st.surface.uvWindow.size * world.width * 0.02 : 8),
        ),
      });
      if (edit) onEdit(edit);
      request();
      return;
    }

    // No brush: a click that did not turn the world is a click on something.
    if (!p || p.moved || p.button !== 0 || brushingRef.current) return;
    const mark = markUnder(e.clientX, e.clientY);
    if (mark?.kind === 'waypoint' && mark.waypointId) {
      propsRef.current.onPickWaypoint?.(mark.waypointId);
      return;
    }
    if (mark?.settlement) {
      propsRef.current.onPickSettlement?.(mark.settlement);
      return;
    }
    // Missed the dot but landed near a town anyway — the reader pointed at the
    // place, not at the four pixels that represent it.
    const geo = propsRef.current.geography;
    const pick = propsRef.current.onPickSettlement;
    if (!geo || !pick) return;
    const cell = cellUnder(e.clientX, e.clientY);
    if (!cell) return;
    const st2 = R.current;
    const tol = Math.max(4, (st2 ? st2.surface.uvWindow.size : 1) * world.width * 0.018);
    const s = pickSettlementNear(geo, world.width, cell.x, cell.y, tol);
    if (s) pick(s);
  }, [onEdit, onEdits, world, markUnder, cellUnder, request]);

  const cancel = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    trail.current = null;
    press.current = null;
    if (!g) return;
    g.rollback();
    R.current?.surface.uploadAll(world.elevation, world.biome);
    request();
  }, [world, request]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (brushingRef.current) return;
    const open = propsRef.current.onOpenRegion;
    if (!open) return;
    const p = cellUnder(e.clientX, e.clientY);
    if (p) open(p.x, p.y);
  }, [cellUnder]);

  // The hand turns the world with the left button; a brush needs it.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.controls.mouseButtons.LEFT = brushing
      ? (null as unknown as THREE.MOUSE)
      : THREE.MOUSE.ROTATE;
  }, [brushing, ready]);

  // ---- wheel: zoom, or the brush ------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;   // let OrbitControls dolly
      if (!brushingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const t = toolRef.current;
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        const s = Math.min(1, Math.max(0.02, t.strength * Math.pow(1.0016, -e.deltaY)));
        onTool?.({ strength: s });
      } else {
        const r = Math.min(240, Math.max(1, t.radius * Math.pow(1.0022, -e.deltaY)));
        onTool?.({ radius: r });
        const c = cursor.current;
        if (c) R.current?.surface.setBrush(c.x, c.y, r, t.softness, true);
      }
      request();
    };
    host.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
  }, [onTool, request]);

  // ---- keys ----------------------------------------------------------------
  useEffect(() => {
    const focus = () => {
      const st = R.current;
      const c = cursor.current;
      if (!st || !c) return;
      // Put what is under the pointer at the centre of the turn, keeping the
      // distance. Without this, zooming in on a corner of the world orbits
      // around somewhere you are not looking, which is the single most common
      // reason a 3D view feels broken.
      const target = new THREE.Vector3();
      scenePos(c.x, c.y, target);
      if (shapeRef.current === 'plane') {
        const off = st.camera.position.clone().sub(st.controls.target);
        st.controls.target.copy(target);
        st.camera.position.copy(target).add(off);
      } else {
        const d = st.camera.position.length();
        st.camera.position.copy(target).normalize().multiplyScalar(d);
      }
      st.fly.active = false;
      st.controls.update();
      st.poseKey = '';
      request();
    };

    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.shiftKey !== keys.current.shift || (e.ctrlKey || e.metaKey) !== keys.current.ctrl) {
        keys.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        setModifier(e.shiftKey ? 'smooth' : keys.current.ctrl ? 'invert' : '');
      }
      if (e.ctrlKey || e.metaKey) {
        // The world's own undo, so a sculpt step and a map step are one history.
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); window.dispatchEvent(new Event('wg-undo')); }
        if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); window.dispatchEvent(new Event('wg-redo')); }
        return;
      }
      if (!over.current) return;
      const t = toolRef.current;
      switch (e.key) {
        case '[': onTool?.({ radius: Math.max(1, t.radius * 0.85) }); break;
        case ']': onTool?.({ radius: Math.min(240, t.radius * 1.18) }); break;
        case 'x': case 'X': setMirrorX((v) => !v); break;
        case 'y': case 'Y': setMirrorY((v) => !v); break;
        case 'f': case 'F': focus(); break;
        case 's': case 'S': setShadow((v) => (v > 0.02 ? 0 : 0.55)); break;
        case 'g': case 'G': onShape(shapeRef.current === 'plane' ? 'globe' : 'plane'); break;
        default: return;
      }
      request();
    };
    const up = (e: KeyboardEvent) => {
      keys.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      setModifier(e.shiftKey ? 'smooth' : keys.current.ctrl ? 'invert' : '');
    };
    const blur = () => { keys.current = { shift: false, ctrl: false }; setModifier(''); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [onTool, onShape, scenePos, request]);

  if (failed) {
    // Not a dead end: the 2D heightmap view is a complete sculpting tool and it
    // runs on anything.
    return (
      <div className="absolute inset-0">
        <SculptView world={world} tool={tool} onEdit={onEdit} revision={revision} />
        <div className={`absolute left-2 top-2 max-w-sm px-2.5 py-1.5 ${HUD} ${HUD_TEXT} pointer-events-none`}>
          Esta máquina no ha podido abrir un contexto 3D, así que se esculpe sobre el mapa de
          alturas. Se pinta igual y las ediciones son las mismas. ({failed})
        </div>
      </div>
    );
  }

  const t = tool;
  const activeOp = t.mode === 'terrain'
    ? (modifier === 'invert' ? (INVERSE[t.terrainOp] ?? t.terrainOp) : t.terrainOp)
    : null;
  const activeLand = t.mode === 'land'
    ? (modifier === 'invert' ? (t.landOp === 'land' ? 'sea' : 'land') : t.landOp)
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden select-none">
      <div
        ref={hostRef}
        className={`absolute inset-0 ${
          brushing ? 'cursor-crosshair' : hovering ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onPointerEnter={() => { over.current = true; }}
        onPointerLeave={() => {
          over.current = false;
          cursor.current = null;
          press.current = null;
          R.current?.surface.setBrush(0, 0, 1, t.softness, false);
          setReadout('');
          setHovering(null);
          request();
        }}
      />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />

      {/* shape, symmetry, look */}
      <div className="absolute right-2 top-2 flex flex-col gap-1.5 items-end">
        <div className={`flex gap-1 p-1 ${HUD}`}>
          <Chip on={shape === 'plane'} onClick={() => onShape('plane')} icon={Layers} label="Plano" title="Plano (G)" />
          <Chip on={shape === 'globe'} onClick={() => onShape('globe')} icon={Globe} label="Globo" title="Globo (G)" />
          <span className="w-px my-1 bg-white/20" />
          <Chip on={mirrorX} onClick={() => setMirrorX((v) => !v)} icon={FlipHorizontal} title="Simetría este–oeste (X)" />
          <Chip on={mirrorY} onClick={() => setMirrorY((v) => !v)} icon={FlipVertical} title="Simetría norte–sur (Y)" />
          <span className="w-px my-1 bg-white/20" />
          <Chip on={panel} onClick={() => setPanel((v) => !v)} icon={Sliders} title="Aspecto" />
        </div>

        {panel && (
          <div className={`w-64 p-2.5 flex flex-col gap-2 ${HUD} ${HUD_TEXT}`}>
            <Slider label="Detalle de cerca" value={detailAmt} min={0} max={1} step={0.05}
              onChange={setDetailAmt} format={(v) => (v < 0.03 ? 'no' : `${Math.round(v * 100)}%`)} />
            <Slider label="Cavidad" value={cavity} min={0} max={1.4} step={0.05}
              onChange={setCavity} format={(v) => v.toFixed(2)} />
            <Slider label="Sombras" value={shadow} min={0} max={1} step={0.05}
              onChange={setShadow}
              format={(v) => (v < 0.03 ? 'no' : v.toFixed(2))}
              disabled={shape === 'globe' || headlight} />
            <Slider label="Sol" value={sunAz} min={0} max={360} step={5}
              onChange={setSunAz} format={(v) => `${v}°`} disabled={headlight} />
            <Slider label="Curvas de nivel" value={contour} min={0} max={1} step={0.05}
              onChange={setContour} format={(v) => (v < 0.03 ? 'no' : `${Math.round(v * 1000)} m`)} />
            <label className="flex items-center justify-between">
              Malla
              <span className="flex gap-1">
                {MESH_STEPS.map((n, i) => (
                  <button key={n} onClick={() => setMesh(i)}
                    className={`px-1.5 py-0.5 rounded tabular-nums ${mesh === i ? 'bg-amber-400/40 text-white' : 'text-white/70 hover:bg-white/15'}`}>
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <Toggle on={headlight} onClick={() => setHeadlight((v) => !v)} label="Luz frontal" icon={Sun} />
            <p className="text-white/60 leading-snug pt-0.5">{detail}</p>
          </div>
        )}
      </div>

      {/* the brush strip: what the left button is about to do */}
      {sculpting && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex flex-col items-center gap-1">
          <div className={`flex gap-0.5 p-1 ${HUD}`}>
            {t.mode === 'terrain'
              ? OPS.map((op) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ terrainOp: op })}
                  title={OP_LABEL[op]}
                  className={`px-2 py-1 rounded text-[11px] transition ${
                    activeOp === op
                      ? (modifier ? 'bg-sky-400/45 text-white' : 'bg-amber-400/40 text-white')
                      : 'text-white/75 hover:text-white hover:bg-white/15'
                  }`}
                >
                  {OP_LABEL[op]}
                </button>
              ))
              : ([['land', 'Tierra'], ['sea', 'Mar']] as const).map(([op, label]) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ landOp: op })}
                  className={`px-2 py-1 rounded text-[11px] transition ${
                    activeLand === op
                      ? (modifier ? 'bg-sky-400/45 text-white' : 'bg-amber-400/40 text-white')
                      : 'text-white/75 hover:text-white hover:bg-white/15'
                  }`}
                >
                  {label}
                </button>
              ))}
            {modifier === 'smooth' && (
              <span className="px-2 py-1 rounded text-[11px] bg-sky-400/45 text-white">Suavizar</span>
            )}
          </div>
          {/* The head and its falloff, where the hand already is. Both write to
              the tool the panel owns, so the strip and the box are one control
              seen twice and cannot drift apart. */}
          <div className={`flex items-center gap-0.5 p-0.5 ${HUD}`}>
            {TIPS.map((k) => (
              <button key={k.id} onClick={() => onTool?.({ tip: k.id })} title={k.hint}
                className={`p-1 rounded ${t.tip === k.id ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white'}`}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">{k.draw}</svg>
              </button>
            ))}
            <span className="w-px h-4 bg-white/20 mx-0.5" />
            {CURVES.map((c) => (
              <button key={c.id} onClick={() => onTool?.({ curve: c.id })}
                title={`Caída ${c.label.toLowerCase()} — ${c.hint}`}
                className={`px-1.5 py-0.5 rounded text-[10px] ${t.curve === c.id ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white'}`}>
                {c.label}
              </button>
            ))}
            <span className="px-1.5 py-0.5 text-[10px] text-white/75 tabular-nums">
              ⌀{t.radius.toFixed(0)} · fuerza {(t.strength * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-white/80 text-xs">
          <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> levantando el terreno…</span>
        </div>
      )}

      <div className="absolute left-2 bottom-2 flex flex-col gap-1 items-start pointer-events-none max-w-[70%]">
        {(hovering || readout) && (
          <span className={`px-2 py-1 ${HUD} ${HUD_TEXT} tabular-nums`}>
            {hovering ? <strong className="font-semibold text-amber-200">{hovering}</strong> : readout}
          </span>
        )}
        <div className="flex gap-1.5 items-center">
          <span className={`px-2 py-1 ${HUD} ${HUD_TEXT} tabular-nums`}>{ms ? `${ms} ms` : '—'}</span>
          <span className={`px-2 py-1 ${HUD} ${HUD_TEXT}`}>
            {!brushing
              ? 'arrastra para girar · rueda para acercar · clic en una ciudad abre su plano · doble clic baja a la comarca · F centra'
              : sculpting
                ? (modifier === 'smooth' ? 'Mayús: suavizar'
                  : modifier === 'invert' ? 'Ctrl: al revés'
                    : 'arrastra para esculpir · Mayús suaviza · Ctrl invierte · botón derecho mueve · Ctrl+rueda tamaño')
                : 'arrastra para pintar · botón derecho mueve la cámara · Ctrl+rueda tamaño'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A label with a dark halo, so it reads over ice and over ocean alike. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `${size >= 12 ? 600 : 500} ${size}px "Source Sans 3", system-ui, sans-serif`;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6,8,13,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Height and position of a cell, in the words a reader uses. */
function describe(world: WorldData, p: Pt): string {
  const xi = ((Math.round(p.x) % world.width) + world.width) % world.width;
  const yi = Math.min(world.height - 1, Math.max(0, Math.round(p.y)));
  const km = world.elevation[yi * world.width + xi];
  const lat = 90 - (yi / world.height) * 180;
  const lon = (xi / world.width) * 360 - 180;
  return `${km >= 0 ? `${Math.round(km * 1000)} m` : `${Math.round(-km * 1000)} m bajo el mar`}`
    + ` · ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}`;
}

/**
 * Nearest settlement to a cell, biased toward the bigger place.
 *
 * The same rule the carta uses, in cells rather than in normalized coordinates,
 * because that is what a ray against a height field gives back.
 */
function pickSettlementNear(
  geo: HumanGeography, worldWidth: number, x: number, y: number, maxCells: number,
): Settlement | null {
  let best: Settlement | null = null;
  let bestD = maxCells * maxCells;
  for (const s of geo.settlements) {
    let dx = Math.abs(s.x - x);
    if (dx > worldWidth / 2) dx = worldWidth - dx;
    const dy = s.y - y;
    const bonus = s.rank === 'capital' ? 0.45 : s.rank === 'city' ? 0.65 : s.rank === 'town' ? 0.85 : 1;
    const d = (dx * dx + dy * dy) * bonus;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function Chip({ on, onClick, icon: Icon, label: text, title }: {
  on: boolean; onClick: () => void; icon: typeof Globe; label?: string; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition ${
        on ? 'bg-amber-400/40 text-white' : 'text-white/75 hover:text-white hover:bg-white/15'
      }`}
    >
      <Icon size={12} />
      {text}
    </button>
  );
}

function Toggle({ on, onClick, label: text, icon: Icon, title }: {
  on: boolean; onClick: () => void; label: string; icon?: typeof Globe; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] transition ${
        on ? 'bg-amber-400/40 text-white' : 'text-white/75 hover:text-white hover:bg-white/15'
      }`}
    >
      {Icon && <Icon size={12} />}
      {text}
    </button>
  );
}

function Slider({ label: text, value, min, max, step, onChange, format, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="w-28 shrink-0">{text}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-amber-400"
      />
      <span className="w-10 text-right tabular-nums text-white/80">{format(value)}</span>
    </label>
  );
}
