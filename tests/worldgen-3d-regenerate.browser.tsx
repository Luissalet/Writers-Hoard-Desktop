import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import World3D from '@/engines/worldgen/components/World3D';
import { DEFAULT_PAINT_TOOL } from '@/engines/worldgen/components/PaintPanel';
import { THEMES } from '@/engines/worldgen/cartography/theme';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { deserializeEdits, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A single malformed stroke must cost that stroke, never the whole history. */
function testMalformedEditsAreSkippedIndividually(): string {
  const good = (x: number): WorldEdit => ({
    kind: 'terrain', op: 'raise', stroke: { pts: [{ x, y: 2 }, { x: x + 1, y: 3 }], radius: 2, strength: 0.5 },
  } as unknown as WorldEdit);
  const broken = [
    { kind: 'terrain', op: 'raise', stroke: { radius: 2, strength: 0.5 } },
    { kind: 'biome', biome: 3, stroke: { pts: 'nope', radius: 1 } },
    { kind: 'river', width: 1 },
    null,
  ];
  const v2 = JSON.stringify({ v: 2, edits: [good(1), broken[0], good(5), broken[1], broken[2], good(9)] });
  const fromV2 = deserializeEdits(v2);
  assert(fromV2.length === 3, `v2: three good strokes survive one bad neighbour (got ${fromV2.length})`);
  assert(deserializeEdits(serializeEdits(fromV2)).length === 3, 'v2: the kept list saves and reopens intact');
  const v1 = JSON.stringify([good(1), broken[0], good(5), broken[3], good(9)]);
  const fromV1 = deserializeEdits(v1);
  assert(fromV1.length === 3, `v1: three good strokes survive one bad neighbour (got ${fromV1.length})`);
  const first = fromV1[0] as Extract<WorldEdit, { stroke: unknown }>;
  assert(first.stroke.pts[0].x === 1.5, 'v1: surviving strokes still migrate by half a cell');
  return 'Worldgen: malformed edits are dropped one by one; the rest of the history survives save/reopen';
}

/**
 * Regenerating while the 3D view is open swaps the `world` prop under a
 * mounted World3D. The scene is rebuilt, and every effect keyed on the scene
 * must re-run against it: rescue clock, framing, zoom composition, look.
 */
async function testWorld3DSurvivesWorldSwap(): Promise<string> {
  const live = new Map<number, number>();
  const nativeSet = window.setInterval, nativeClear = window.clearInterval;
  const cameras: THREE.PerspectiveCamera[] = [];
  const nativeUpdate = THREE.PerspectiveCamera.prototype.updateProjectionMatrix;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = nativeSet(fn, ms, ...args);
    live.set(id, ms ?? 0);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) live.delete(id);
    nativeClear(id);
  }) as typeof window.clearInterval;
  THREE.PerspectiveCamera.prototype.updateProjectionMatrix = function (this: THREE.PerspectiveCamera) {
    if (!cameras.includes(this)) cameras.push(this);
    return nativeUpdate.call(this);
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const a = generateWorld({ ...DEFAULT_PARAMS, seed: 'regen-a', width: 256 });
    const b = generateWorld({ ...DEFAULT_PARAMS, seed: 'regen-b', width: 256 });
    const view = (world: WorldData) => (
      <World3D world={world} theme={THEMES[0]} waypoints={[]} showWaypoints={false} showSettlements={false}
        showLandmarks={false} skin="arcilla" shape="globe" onShape={() => {}} exaggeration={20}
        tool={DEFAULT_PAINT_TOOL} onEdit={() => {}} revision={0} flyTarget={null} />
    );
    const rescueClocks = () => [...live.values()].filter((ms) => ms === 16).length;
    // World3D's camera is the only 32° one; the others belong to helpers.
    const pose = () => cameras.filter((c) => c.fov === 32).at(-1)?.position.toArray().map((v) => v.toFixed(2)).join(',');

    await act(async () => { root.render(view(a)); });
    await wait(1500);
    assert(host.querySelectorAll('canvas').length >= 2 && rescueClocks() === 1,
      'World3D must mount with WebGL (SwiftShader) and one rescue clock');
    const freshPose = pose();
    assert(freshPose, 'the 3D camera must be framed on mount');

    await act(async () => { root.render(view(b)); });
    await wait(1500);
    assert(rescueClocks() === 1, `a regenerated world must keep exactly one rescue clock (got ${rescueClocks()})`);
    assert(pose() === freshPose, `a regenerated world must be framed like a fresh mount (${pose()} vs ${freshPose})`);

    await act(async () => { root.unmount(); });
    assert(rescueClocks() === 0, 'unmount must stop the rescue clock');
    return 'Worldgen: World3D rebuilt under a regenerated world keeps its clock and gets a fresh camera';
  } finally {
    window.setInterval = nativeSet;
    window.clearInterval = nativeClear;
    THREE.PerspectiveCamera.prototype.updateProjectionMatrix = nativeUpdate;
    host.remove();
  }
}

/**
 * Un contexto WebGL perdido desmonta la escena en el acto. Antes sólo se paraba
 * el reloj: la escena vieja seguía viva hasta cambiar de mundo, y cualquier
 * cambio de props (marcadores, relieve, geografía) volvía a encolar fotogramas
 * — y teselas — sobre un contexto muerto.
 */
async function testWorld3DStopsAfterContextLoss(): Promise<string> {
  const live = new Map<number, number>();
  const nativeSet = window.setInterval, nativeClear = window.clearInterval;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = nativeSet(fn, ms, ...args);
    live.set(id, ms ?? 0);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) live.delete(id);
    nativeClear(id);
  }) as typeof window.clearInterval;
  const nativeUpdate = OrbitControls.prototype.update;
  const nativeDispose = THREE.BufferGeometry.prototype.dispose;
  let frames = 0;
  let disposed = 0;
  THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
    disposed++;
    return nativeDispose.call(this);
  };
  OrbitControls.prototype.update = function (this: OrbitControls, ...args: Parameters<OrbitControls['update']>) {
    frames++;
    return nativeUpdate.apply(this, args);
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'context-loss', width: 256 });
    const view = (exaggeration: number, showSettlements: boolean) => (
      <World3D world={world} theme={THEMES[0]} waypoints={[]} showWaypoints={false} showSettlements={showSettlements}
        showLandmarks={false} skin="arcilla" shape="globe" onShape={() => {}} exaggeration={exaggeration}
        tool={DEFAULT_PAINT_TOOL} onEdit={() => {}} revision={0} flyTarget={null} />
    );
    const rescueClocks = () => [...live.values()].filter((ms) => ms === 16).length;
    await act(async () => { root.render(view(20, false)); });
    await wait(1500);
    const canvas = [...host.querySelectorAll('canvas')].find((c) => c.getContext('webgl2') || c.getContext('webgl'));
    assert(canvas && rescueClocks() === 1 && frames > 0, 'World3D must mount with WebGL (SwiftShader), one rescue clock and drawn frames');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!;
    disposed = 0;
    await act(async () => {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      else canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await wait(200);
    });
    assert(gl.isContextLost() || !canvas.isConnected, 'the WebGL context must be lost for this test');
    assert(!canvas.isConnected, 'the dead WebGL canvas must leave the DOM');
    assert(disposed > 0, 'a lost context must dispose the old scene now, not at unmount or world change');
    // (Sin mirar los relojes aquí: el relevo 2D, SculptView, trae el suyo.)
    frames = 0;
    await act(async () => { root.render(view(35, true)); });
    await wait(600);
    assert(frames === 0, `prop changes after context loss must not draw on the dead scene (${frames} frames)`);
    await act(async () => { root.unmount(); });
    assert(rescueClocks() === 0, 'unmount after context loss leaves no clock');
    return 'Worldgen: World3D tears its scene down on WebGL context loss; later prop changes draw nothing';
  } finally {
    window.setInterval = nativeSet;
    window.clearInterval = nativeClear;
    OrbitControls.prototype.update = nativeUpdate;
    THREE.BufferGeometry.prototype.dispose = nativeDispose;
    host.remove();
  }
}

export async function testWorldgen3DRegenerate(): Promise<string[]> {
  return [testMalformedEditsAreSkippedIndividually(), await testWorld3DSurvivesWorldSwap(), await testWorld3DStopsAfterContextLoss()];
}
