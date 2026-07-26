import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Globe, Layers, Loader2, Sun, Sliders, FlipHorizontal, FlipVertical,
} from 'lucide-react';
import type { WorldData } from '../core/types';
import { BIOME_COUNT } from '../core/types';
import { BIOME_COLORS } from '../core/render';
import { SculptGesture, type Falloff } from '../sculpt/ops';
import {
  SculptSurface, pickCell, visibleWindow, SIZE_X, R_GLOBE, type SculptShape,
} from '../sculpt/scene3d';
import type { Pt, TerrainOp, WorldEdit } from '../core/edits';
import type { PaintTool } from './PaintPanel';
import SculptView from './SculptView';

/**
 * Sculpt mode, in three dimensions, on a plane or on the globe.
 *
 * The first version of this view was a shaded heightmap seen from above, and that
 * was a misreading of what was asked for: "like sculpt mode in Blender". You
 * cannot judge a mountain you are pushing up if you are looking straight down at
 * it — the whole point of sculpting is that you turn the thing around.
 *
 * The globe is not a second view but the same one with the displacement pointing
 * outward, and it exists for a reason the plane cannot cover: a world wraps, and
 * on a plane the seam and the poles are exactly where you cannot see what you are
 * doing. Sculpting a coastline that crosses the antimeridian is a thing you do
 * once on a plane before deciding the tool is lying to you.
 *
 * The conventions are ZBrush's and Blender's, deliberately, because they are the
 * ones a sculptor's hands already know:
 *
 *   left drag          the brush
 *   middle / right     turn and move the camera
 *   wheel              closer and further
 *   Ctrl + wheel       brush size          (also [ and ])
 *   Shift + wheel      brush strength
 *   Shift held         smooth, whatever the brush was
 *   Ctrl held          the brush inverted
 *   F                  put what is under the pointer at the centre of the turn
 *   X / Y              symmetry
 *   C / S              clay, cast shadows
 *   Ctrl+Z / Ctrl+Y    undo, redo
 */

interface Sculpt3DProps {
  world: WorldData;
  tool: PaintTool;
  onEdit: (edit: WorldEdit) => void;
  /** Several edits as ONE undo step — a symmetric stroke is four of them. */
  onEdits?: (edits: WorldEdit[]) => void;
  /** So the wheel and the bracket keys can change the brush the panel owns. */
  onTool?: (patch: Partial<PaintTool>) => void;
  revision: number;
  onHover?: (info: { x: number; y: number; elevation: number } | null) => void;
}

/** Mesh density presets, in vertices across the visible square. */
const MESH_STEPS = [384, 640, 1024, 1536];

/** Which brush Ctrl turns each one into. */
const INVERSE: Partial<Record<TerrainOp, TerrainOp>> = {
  raise: 'lower',
  lower: 'raise',
  smooth: 'sharpen',
  sharpen: 'smooth',
  // Detail brushes invert to "take the detail back out", which is what the
  // modifier means everywhere else. Flatten, terrace and grab have no opposite
  // worth inventing, so Ctrl leaves them alone.
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

const CURVES: { id: Falloff; label: string }[] = [
  { id: 'smooth', label: 'Suave' },
  { id: 'sharp', label: 'Agudo' },
  { id: 'linear', label: 'Recto' },
  { id: 'flat', label: 'Plano' },
];

export default function Sculpt3D({
  world, tool, onEdit, onEdits, onTool, revision, onHover,
}: Sculpt3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<SculptShape>('plane');
  const [exag, setExag] = useState(30);
  // 640 across is 820 000 triangles, which every machine that can run this app can
  // draw. The reader can push it to 1536 (4.7 M) from the panel; the silhouette is
  // the only thing that changes, because the shading already carries full detail.
  const [mesh, setMesh] = useState(1);
  const [clay, setClay] = useState(true);
  const [cavity, setCavity] = useState(0.55);
  const [headlight, setHeadlight] = useState(false);
  const [shadow, setShadow] = useState(0.7);
  const [contour, setContour] = useState(0);
  const [sunAz, setSunAz] = useState(140);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [curve, setCurve] = useState<Falloff>('smooth');
  const [panel, setPanel] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [ready, setReady] = useState(false);
  const [readout, setReadout] = useState<string>('');
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
    raf: number;
    timer: number;
    need: boolean;
    rafAlive: boolean;
    booked: number;
    /** What the last frame cost, and when it finished. */
    cost: number;
    lastDraw: number;
    uploadedRev: number;
    /** Camera pose the UV window was last computed for. */
    poseKey: string;
  } | null>(null);

  const gesture = useRef<SculptGesture | null>(null);
  const cursor = useRef<Pt | null>(null);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const mirrorRef = useRef({ x: mirrorX, y: mirrorY });
  mirrorRef.current = { x: mirrorX, y: mirrorY };
  const keys = useRef({ shift: false, ctrl: false });
  /**
   * Whether the pointer is over this view.
   *
   * The single-letter shortcuts are bound to the window, because a canvas that has
   * to be clicked before it listens is a canvas that ignores the first thing you
   * press. Requiring the pointer to be over the view is the rule that keeps `x`
   * from toggling symmetry while the reader is somewhere else entirely.
   */
  const over = useRef(false);

  /**
   * Only the two brushes that move ground work here.
   *
   * Markers, labels, rivers and biome paint are all edits that want to be placed
   * on a MAP — you put a town where the map says a town goes, not where a lit
   * three-quarter view of a mountain happens to show. Rather than half-implement
   * them, the left button goes back to turning the world and the hint says where
   * they live.
   */
  const sculptable = tool.mode === 'terrain' || tool.mode === 'land';
  const sculptableRef = useRef(sculptable);
  sculptableRef.current = sculptable;

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
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);

    // A narrow field of view. Sculptors work close to orthographic because
    // perspective distorts the very thing you are judging — whether a slope is
    // steeper than the one beside it.
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 6000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.zoomSpeed = 0.9;
    // Left drag is the BRUSH; the camera lives on the other two buttons. That is
    // Blender's split and it is the only one that lets you sculpt without a
    // modifier key in your way. `LEFT` is switched to ROTATE below whenever no
    // brush is selected, so the hand tool still turns the world.
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

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

    // The sea is a real surface, not a colour below zero: you need to see the land
    // go under it while you are pushing it down. One for each shape.
    const seaMat = new THREE.MeshBasicMaterial({
      color: 0x3f6f96, transparent: true, opacity: 0.5, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const sizeZ = SIZE_X * (world.height / world.width);
    // Exactly the world, not a horizon. A sea that runs off past the sheet reads
    // as an ocean planet with an island in it, and the reader loses track of where
    // the map actually ends — which on a wrapping world is the one thing they need
    // to keep hold of.
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
      raf: 0, timer: 0, need: true, rafAlive: true, booked: 0, cost: 16, lastDraw: 0,
      uploadedRev: revision, poseKey: '',
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
      seaMat.dispose();
      sea.geometry.dispose();
      seaGlobe.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      R.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---- the frame pump ------------------------------------------------------
  //
  // Same design as the 2D view, and for the same reason: a window whose only
  // content is a static canvas can stop being composited, and then
  // `requestAnimationFrame` never fires again — which wedged the sculpt view shut
  // once already, with a frozen picture, a dead wheel and a brush that changed the
  // data without changing the image. Orbit damping needs continuous frames while
  // the camera is moving, so the pump runs whenever the controls report change and
  // idles otherwise.
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
    const moving = st.controls.update();

    // The UV window: the grid is stretched over what the camera can see, so the
    // triangles are spent where the reader is looking instead of on the far side
    // of the world. Recomputed only when the camera actually moved — it costs four
    // ray casts, but it also rewrites a uniform, and rewriting uniforms on an idle
    // frame is how you end up with a view that never stops redrawing.
    const c = st.camera;
    const key = `${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)},`
      + `${st.controls.target.x.toFixed(2)},${st.controls.target.y.toFixed(2)},${st.controls.target.z.toFixed(2)}`;
    if (key !== st.poseKey) {
      st.poseKey = key;
      st.surface.setWindow(visibleWindow(c, shapeRef.current, world.width, world.height));
      st.surface.setCamera(c.position);
      const cpq = st.surface.cellsPerQuad(MESH_STEPS[mesh]);
      setDetail(cpq < 1
        ? `${(1 / cpq).toFixed(1)} triángulos por celda`
        : `${cpq.toFixed(1)} celdas por triángulo`);
    }

    st.renderer.render(st.scene, st.camera);
    const cost = performance.now() - t0;
    st.cost = cost;
    st.lastDraw = performance.now();
    setMs(Math.round(cost));
    // Damping is a per-FRAME decay, so it silently assumes sixty of them a second.
    // On a machine drawing two frames a second it turns every flick of the mouse
    // into half a minute of the world still drifting, which reads as the view
    // being stuck rather than as it being slow. Below a usable frame rate the
    // camera goes where it is put.
    st.controls.enableDamping = cost < 40;
    if (moving) st.need = true;
  }, [world.width, world.height, mesh]);
  drawRef.current = draw;

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.timer = window.setInterval(() => {
      const now = performance.now();
      // A frame that has not arrived is only evidence of a dead clock if the main
      // thread was FREE to deliver it.
      //
      // The 2D view uses a flat 120 ms here and gets away with it because its
      // draws take ten. This one can legitimately spend half a second on a frame,
      // and a fixed deadline turns every slow frame into "rAF is broken" — after
      // which the rescue timer draws every 16 ms, each draw taking 600, and the
      // browser never gets the main thread back long enough to put a picture on
      // the screen. The view does not go slow, it goes dead. So the deadline
      // scales with what a frame actually costs here.
      if (st.raf && now - st.booked > Math.max(500, st.cost * 4)) {
        st.rafAlive = false;
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
      if (!st.need) return;
      if (st.rafAlive) { request(); return; }
      // On the fallback clock, never spend more than about half the time drawing:
      // the other half is what the compositor needs to show the result.
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
    const sizeZ = SIZE_X * (world.height / world.width);
    // How far back the whole thing fits.
    //
    // Guessing this from the world's depth was wrong in the way that is easy to
    // miss in a screenshot and impossible to miss in the hand: the far edge fell
    // outside the frustum, so the view opened on a horizon and half the map was
    // behind the reader. The bounding sphere and the NARROWER of the two field
    // angles give the distance that cannot crop, whatever the panel's shape.
    const halfV = (st.camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * Math.max(0.2, st.camera.aspect));
    if (shape === 'plane') {
      // 52° above the ground: high enough to read the whole sheet, low enough that
      // relief still has a silhouette. Looking straight down is the 2D view, and
      // the 2D view is what this one exists to stop being.
      const a = (52 * Math.PI) / 180;
      // Fit the SHEET, not a sphere around it. A bounding sphere round a 2:1 map
      // is mostly empty air and puts the camera almost twice as far back as it
      // needs to be — the world came out a postage stamp in the middle of a black
      // panel. Tilting foreshortens the depth by sin(a), and the tallest ground
      // adds to the vertical extent, so both go into the fit.
      const relief = 9 * (0.24 * exag * (SIZE_X / world.width));
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
      // A sphere is its own bounding sphere, so here the simple fit is exact.
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
    st.controls.update();
    st.poseKey = '';
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, ready, world.height, world.width, request]);

  // ---- everything the look depends on --------------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setExaggeration(exag);
    st.surface.setShading(clay, cavity, headlight, shadow);
    st.surface.setContour(contour);
    st.surface.setSun(sunAz, 38);
    st.surface.setMirror(mirrorX, mirrorY);
    request();
  }, [exag, clay, cavity, headlight, shadow, contour, sunAz, mirrorX, mirrorY, ready, request]);

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

  /**
   * What the next stroke will actually do.
   *
   * Modifier keys beat the panel, which is the convention everywhere: Shift is
   * smooth no matter what you had selected, Ctrl is the same brush the other way
   * round. Resolved once when the button goes down and held for the whole stroke,
   * so letting go of Shift halfway does not change the brush under your hand.
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
    if (e.button !== 0 || !sculptableRef.current) return;
    const p = cellUnder(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const t = toolRef.current;
    const b = resolveBrush(e.shiftKey, e.ctrlKey || e.metaKey);
    gesture.current = new SculptGesture(
      world.elevation, world.width, world.height, world.params.seed,
      {
        kind: b.kind, op: b.op,
        radius: t.radius, strength: t.strength, softness: t.softness,
        curve: curveRef.current,
        mirrorX: mirrorRef.current.x, mirrorY: mirrorRef.current.y,
      },
    );
    uploadDirty(gesture.current.extend(p));
    cursor.current = p;
    request();
  }, [cellUnder, resolveBrush, uploadDirty, world, request]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    if (!st) return;
    const p = cellUnder(e.clientX, e.clientY);
    cursor.current = p;
    const t = toolRef.current;
    if (p) {
      st.surface.setBrush(p.x, p.y, t.radius, t.softness, sculptableRef.current);
      const xi = ((Math.round(p.x) % world.width) + world.width) % world.width;
      const yi = Math.min(world.height - 1, Math.max(0, Math.round(p.y)));
      const km = world.elevation[yi * world.width + xi];
      const lat = 90 - (yi / world.height) * 180;
      const lon = (xi / world.width) * 360 - 180;
      setReadout(`${km >= 0 ? `${Math.round(km * 1000)} m` : `${Math.round(-km * 1000)} m bajo el mar`}`
        + ` · ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}`);
      onHover?.({ x: xi, y: yi, elevation: km });
    } else {
      st.surface.setBrush(0, 0, 1, t.softness, false);
      setReadout('');
    }
    const g = gesture.current;
    if (g && p) uploadDirty(g.extend(p));
    request();
  }, [cellUnder, uploadDirty, world, onHover, request]);

  const finish = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !g.points) return;
    // The live pass is a preview. It is rolled back and the stroke is committed as
    // edits, which the session replays from the pristine snapshot — so what ends
    // up in the world is exactly what regenerating from the seed and the edit list
    // would produce, and never what the preview happened to do. The two now share
    // one implementation and agree cell for cell; rolling back anyway means that if
    // they ever stop agreeing, the authoritative one wins.
    g.rollback();
    R.current?.surface.uploadAll(world.elevation, world.biome);
    const edits: WorldEdit[] = g.edits().map((e) => (e.kind === 'land'
      ? { kind: 'land', op: e.op as 'land' | 'sea', stroke: e.stroke }
      : { kind: 'terrain', op: e.op as TerrainOp, stroke: e.stroke }));
    if (!edits.length) return;
    if (onEdits) onEdits(edits);
    else for (const ed of edits) onEdit(ed);
    request();
  }, [onEdit, onEdits, world, request]);

  const cancel = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    g.rollback();
    R.current?.surface.uploadAll(world.elevation, world.biome);
    request();
  }, [world, request]);

  // ---- wheel: zoom, or the brush ------------------------------------------
  //
  // Bound natively rather than through React so `preventDefault` works and the
  // page behind cannot scroll. Ctrl and Shift take the wheel away from the camera
  // and give it to the brush, which is what every sculpting program does and what
  // keeps the reader's other hand off the panel.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;   // let OrbitControls dolly
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
        if (c) R.current?.surface.setBrush(c.x, c.y, r, t.softness, sculptableRef.current);
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
      // distance. Without this, zooming in on a corner of the world orbits around
      // somewhere you are not looking, which is the single most common reason a 3D
      // view feels broken.
      const e = st.surface.heightAtCell(c.x, c.y);
      const target = new THREE.Vector3();
      if (shapeRef.current === 'plane') {
        const sizeZ = SIZE_X * (world.height / world.width);
        target.set((c.x / world.width - 0.5) * SIZE_X, e * st.surface.yMul,
          (c.y / world.height - 0.5) * sizeZ);
      } else {
        const lon = (c.x / world.width - 0.5) * Math.PI * 2;
        const lat = (0.5 - c.y / world.height) * Math.PI;
        const r = R_GLOBE + e * st.surface.yMul * 0.55;
        target.set(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
      }
      if (shapeRef.current === 'plane') {
        const off = st.camera.position.clone().sub(st.controls.target);
        st.controls.target.copy(target);
        st.camera.position.copy(target).add(off);
      } else {
        // The globe turns about its own centre; framing means looking at the point
        // from outside it, not moving the centre off the origin.
        const d = st.camera.position.length();
        st.camera.position.copy(target).normalize().multiplyScalar(d);
      }
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
        case 'c': case 'C': setClay((v) => !v); break;
        case 's': case 'S': setShadow((v) => (v > 0.02 ? 0 : 0.7)); break;
        case 'g': case 'G': setShape((s) => (s === 'plane' ? 'globe' : 'plane')); break;
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
  }, [onTool, request, world.width, world.height]);

  // The hand tool turns the world with the left button; a brush needs it.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.controls.mouseButtons.LEFT = sculptable
      ? (null as unknown as THREE.MOUSE)
      : THREE.MOUSE.ROTATE;
  }, [sculptable, ready]);

  if (failed) {
    // Not a dead end: the 2D heightmap view is a complete sculpting tool and it
    // runs on anything.
    return (
      <div className="absolute inset-0">
        <SculptView world={world} tool={tool} onEdit={onEdit} revision={revision} onHover={onHover} />
        <div className="absolute left-2 top-2 max-w-sm px-2 py-1 rounded bg-black/60 text-[10px] text-amber-200/90 pointer-events-none leading-snug">
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
        className={`absolute inset-0 ${sculptable ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onPointerEnter={() => { over.current = true; }}
        onPointerLeave={() => {
          over.current = false;
          cursor.current = null;
          R.current?.surface.setBrush(0, 0, 1, t.softness, false);
          setReadout('');
          onHover?.(null);
          request();
        }}
      />

      {/* shape, symmetry, look */}
      <div className="absolute right-2 top-2 flex flex-col gap-1.5 items-end">
        <div className="flex gap-1 rounded bg-black/60 p-1 backdrop-blur">
          <Chip on={shape === 'plane'} onClick={() => setShape('plane')} icon={Layers} label="Plano" title="Plano (G)" />
          <Chip on={shape === 'globe'} onClick={() => setShape('globe')} icon={Globe} label="Globo" title="Globo (G)" />
          <span className="w-px my-1 bg-white/15" />
          <Chip on={mirrorX} onClick={() => setMirrorX((v) => !v)} icon={FlipHorizontal} title="Simetría este–oeste (X)" />
          <Chip on={mirrorY} onClick={() => setMirrorY((v) => !v)} icon={FlipVertical} title="Simetría norte–sur (Y)" />
          <span className="w-px my-1 bg-white/15" />
          <Chip on={panel} onClick={() => setPanel((v) => !v)} icon={Sliders} title="Aspecto" />
        </div>

        {panel && (
          <div className="w-60 rounded bg-black/75 backdrop-blur p-2.5 flex flex-col gap-2 text-[10px] text-white/70">
            <Slider label="Relieve" value={exag} min={4} max={120} step={1}
              onChange={setExag} format={(v) => `×${v}`} />
            <Slider label="Cavidad" value={cavity} min={0} max={1.4} step={0.05}
              onChange={setCavity} format={(v) => v.toFixed(2)} />
            <Slider label="Sombras" value={shadow} min={0} max={1} step={0.05}
              onChange={setShadow}
              format={(v) => (v < 0.03 ? 'no' : v.toFixed(2))}
              disabled={shape === 'globe' || headlight} />
            <Slider label="Sol" value={sunAz} min={0} max={360} step={5}
              onChange={setSunAz} format={(v) => `${v}°`} disabled={headlight} />
            <Slider label="Curvas" value={contour} min={0} max={1} step={0.05}
              onChange={setContour} format={(v) => (v < 0.03 ? 'no' : `${Math.round(v * 1000)} m`)} />
            <label className="flex items-center justify-between">
              Malla
              <span className="flex gap-1">
                {MESH_STEPS.map((n, i) => (
                  <button key={n} onClick={() => setMesh(i)}
                    className={`px-1.5 py-0.5 rounded tabular-nums ${mesh === i ? 'bg-amber-400/30 text-white' : 'hover:bg-white/10'}`}>
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <div className="flex gap-1">
              <Toggle on={clay} onClick={() => setClay((v) => !v)} label="Arcilla" title="Arcilla o los colores del mundo (C)" />
              <Toggle on={headlight} onClick={() => setHeadlight((v) => !v)} label="Luz frontal" icon={Sun} />
            </div>
            <p className="text-white/35 leading-snug pt-0.5">{detail}</p>
          </div>
        )}
      </div>

      {/* the brush strip: what the left button is about to do */}
      {sculptable && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex flex-col items-center gap-1">
          <div className="flex gap-0.5 rounded bg-black/60 p-1 backdrop-blur">
            {t.mode === 'terrain'
              ? OPS.map((op) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ terrainOp: op })}
                  title={OP_LABEL[op]}
                  className={`px-2 py-1 rounded text-[10px] transition ${
                    activeOp === op
                      ? (modifier ? 'bg-sky-400/35 text-white' : 'bg-amber-400/30 text-white')
                      : 'text-white/55 hover:text-white/90 hover:bg-white/10'
                  }`}
                >
                  {OP_LABEL[op]}
                </button>
              ))
              // The coast brush has two states and they are the two the reader
              // switches between constantly, so they belong under the thumb too.
              : ([['land', 'Tierra'], ['sea', 'Mar']] as const).map(([op, label]) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ landOp: op })}
                  className={`px-2 py-1 rounded text-[10px] transition ${
                    activeLand === op
                      ? (modifier ? 'bg-sky-400/35 text-white' : 'bg-amber-400/30 text-white')
                      : 'text-white/55 hover:text-white/90 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            {modifier === 'smooth' && (
              <span className="px-2 py-1 rounded text-[10px] bg-sky-400/35 text-white">Suavizar</span>
            )}
          </div>
          <div className="flex gap-0.5 rounded bg-black/50 p-0.5 backdrop-blur">
            {CURVES.map((c) => (
              <button key={c.id} onClick={() => setCurve(c.id)}
                title={`Borde ${c.label.toLowerCase()}`}
                className={`px-1.5 py-0.5 rounded text-[9px] ${curve === c.id ? 'bg-white/20 text-white' : 'text-white/45 hover:text-white/80'}`}>
                {c.label}
              </button>
            ))}
            <span className="px-1.5 py-0.5 text-[9px] text-white/40 tabular-nums">
              ⌀{t.radius.toFixed(0)} · fuerza {(t.strength * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-white/60 text-xs">
          <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> levantando el terreno…</span>
        </div>
      )}

      <div className="absolute left-2 bottom-2 flex flex-col gap-1 items-start pointer-events-none">
        {readout && (
          <span className="px-2 py-0.5 rounded bg-black/50 text-[10px] text-white/85 tabular-nums">{readout}</span>
        )}
        <div className="flex gap-2">
          <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/80 tabular-nums">
            {ms ? `${ms} ms` : '—'}
          </span>
          <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/70">
            {!sculptable
              ? (t.mode === 'off'
                ? 'arrastra para girar · rueda para acercar · F para centrar'
                : `«${t.mode}» se pinta sobre la carta; aquí se esculpe el relieve y la costa`)
              : modifier === 'smooth' ? 'Mayús: suavizar'
                : modifier === 'invert' ? 'Ctrl: al revés'
                  : 'arrastra para esculpir · Mayús suaviza · Ctrl invierte · botón central gira · Ctrl+rueda tamaño'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({ on, onClick, icon: Icon, label, title }: {
  on: boolean; onClick: () => void; icon: typeof Globe; label?: string; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition ${
        on ? 'bg-amber-400/25 text-white' : 'text-white/60 hover:text-white/90 hover:bg-white/10'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

function Toggle({ on, onClick, label, icon: Icon, title }: {
  on: boolean; onClick: () => void; label: string; icon?: typeof Globe; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[10px] transition ${
        on ? 'bg-amber-400/25 text-white' : 'text-white/55 hover:text-white/85 hover:bg-white/10'
      }`}
    >
      {Icon ? <Icon size={11} /> : null} {label}
    </button>
  );
}

function Slider({ label, value, min, max, step, onChange, format, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-35' : ''}`}>
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-amber-400"
      />
      <span className="w-10 text-right tabular-nums">{format(value)}</span>
    </label>
  );
}
