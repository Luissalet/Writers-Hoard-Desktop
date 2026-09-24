import { drawOverlay, textOnPath, type OverlayOptions } from '@/engines/worldgen/cartography/overlay';
import { renderCartography } from '@/engines/worldgen/cartography/render';
import { THEME_ANTIQUE, THEME_WONDER } from '@/engines/worldgen/cartography/theme';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { applyWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { buildHumanGeography, type HumanGeography } from '@/engines/worldgen/core/settlements';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CartoMap from '@/engines/worldgen/components/CartoMap';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function inkCanvas(width = 640, height = 320) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const draws: Array<{ text: string; size: number; left: number; top: number; right: number; bottom: number }> = [];
  const instrumented = new Proxy(ctx, { get(target, key) {
    if (key === 'fillText') return (text: string, x: number, y: number) => {
      const m = target.measureText(text), size = Number(target.font.match(/([\d.]+)px/)?.[1] ?? 14);
      const left = x - m.actualBoundingBoxLeft, right = x + m.actualBoundingBoxRight;
      const top = y - m.actualBoundingBoxAscent, bottom = y + m.actualBoundingBoxDescent;
      const transform = target.getTransform();
      const points = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([px, py]) => transform.transformPoint({ x: px, y: py }));
      draws.push({ text, size, left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) });
      target.fillText(text, x, y);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
  return { canvas, ctx, instrumented, draws };
}
function options(world: WorldData, width = 640, height = 320): OverlayOptions {
  return { theme: THEME_ANTIQUE, scale: width / world.width, width, height, worldWidth: world.width,
    view: { x: 0, y: 0, w: world.width, h: world.height }, layers: { roads: false, borders: false, settlements: true, labels: true } };
}

export function testCartographicLabelBounds(): string {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'label-bounds' });
  world.elevation.fill(2); world.lake.fill(0);
  world.painted = { labels: [
    { x: 32, y: 16, text: 'MI MUNDO', style: 'region', size: 18 },
    { x: 63.5, y: 5, text: 'QUEDARSE EN EL MAPA', style: 'note', size: 13 },
  ], moves: {} } as WorldData['painted'];
  const geo = { features: [
    { kind: 'continent', name: 'ZZZZZZ', x: 32, y: 16, extent: 40, importance: 1, angle: 0 },
    { kind: 'cape', name: 'Cabo que se cortaba al salir del mapa', x: 0.1, y: 3, extent: 6, importance: 0.8, angle: 0 },
  ], settlements: [], roads: [], realms: [], ruins: [] } as unknown as HumanGeography;
  const out = inkCanvas();
  const space = drawOverlay(out.instrumented, world, geo, options(world));
  assert(out.draws.some(d => d.text === 'M'), 'Authored label disappeared');
  assert(!out.draws.some(d => d.text === 'Z'), 'Generated region overwrote authored text');
  assert(out.draws.some(d => d.text === 'Q'), 'Authored edge label was hidden rather than fitted');
  assert(out.draws.every(d => d.left >= 0 && d.top >= 0 && d.right <= 640 && d.bottom <= 320), 'A label paints clipped glyphs beyond the sheet');
  assert(!space.fits({ x: 310, y: 150, w: 20, h: 20 }), 'Deep/local labels can overwrite principal lettering');

  // Move the viewport across longitude zero; one full name, no clipped copy.
  delete world.painted;
  geo.features = [{ kind: 'isle', name: 'Isla de la Costura', x: 0, y: 16, extent: 12, importance: 1, angle: 0 }];
  const seam = inkCanvas();
  drawOverlay(seam.instrumented, world, geo, { ...options(world), scale: 32, view: { x: 54, y: 11, w: 20, h: 10 } });
  assert(seam.draws.length > 5 && seam.draws.every(d => d.left >= 0 && d.right <= 640), 'Longitude seam splits or loses the name');

  const curved = inkCanvas(); curved.instrumented.font = '24px sans-serif'; curved.instrumented.textAlign = 'center'; curved.instrumented.textBaseline = 'middle';
  let bounds: { h: number } | null = null;
  textOnPath(curved.instrumented, 'I🗺I', [{ x: 20, y: 80 }, { x: 250, y: 80 }], 1, 12, { onBox: b => { bounds = b; } });
  assert(curved.draws.some(d => d.text === '🗺') && curved.draws.length === 3, 'Curved names split Unicode glyphs');
  assert(bounds && (bounds as { h: number }).h >= 48, 'Curved label bounds ignore tall narrow glyphs or their offset');
  return 'Map lettering keeps authored names first, fits edge/seam text, shares collision space and measures curved Unicode labels';
}

export function testCartographicPresetLabels(): string[] {
  const results: string[] = [];
  for (const presetId of ['archipelago', 'pangaea', 'iceAge']) {
    const preset = WORLD_PRESETS.find(p => p.id === presetId)!;
    const world = generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width: 128, seed: `letters-${presetId}` }, preset));
    const geo = buildHumanGeography(world);
    for (const width of [420, 960]) {
      const height = width / 2, out = inkCanvas(width, height);
      drawOverlay(out.instrumented, world, geo, options(world, width, height));
      assert(out.draws.length > 8, `${presetId}/${width} lost all map lettering`);
      assert(out.draws.every(d => d.left >= -1 && d.top >= -1 && d.right <= width + 1 && d.bottom <= height + 1), `${presetId}/${width} has clipped text`);
      assert(out.draws.every(d => d.size <= 24), `${presetId}/${width} oversized label`);
    }
    results.push(`${presetId}: generated lettering stays readable and bounded at compact and desktop scales`);
  }
  return results;
}

export async function testCartoMapTypeScale(): Promise<string> {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'letter-dpr' });
  world.elevation.fill(2); world.lake.fill(0);
  const geo = { features: [{ kind: 'continent', name: 'MUNDO', x: 32, y: 16, extent: 48, importance: 1, angle: 0 }],
    settlements: [], roads: [], realms: [], ruins: [] } as unknown as HumanGeography;
  const host = document.createElement('div'); host.id = 'carto-type-qa'; host.style.cssText = 'position:relative;width:480px;height:240px';
  const style = document.createElement('style'); style.textContent = '#carto-type-qa>div{position:absolute;inset:0}';
  document.head.append(style); document.body.append(host);
  const root = createRoot(host), original = CanvasRenderingContext2D.prototype.fillText;
  const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const observed: Array<{ cssSize: number; ratio: number }> = [];
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
    if (this.canvas === host.querySelector('canvas') && text === 'M') {
      const ratio = this.canvas.width / 480;
      observed.push({ cssSize: Number(this.font.match(/([\d.]+)px/)?.[1]) / ratio, ratio });
    }
    if (maxWidth === undefined) original.call(this, text, x, y); else original.call(this, text, x, y, maxWidth);
  };
  const waitFor = async (test: () => boolean) => {
    const end = Date.now() + 5000;
    while (!test() && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 40)); });
    assert(test(), 'Carta did not render both full and progressive text passes');
  };
  try {
    for (const dpr of [1, 2]) {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
      observed.length = 0;
      await act(async () => root.render(createElement(CartoMap, { world, geography: geo, theme: THEME_ANTIQUE,
        layers: { labels: true, settlements: false, forests: false, relief: false, frame: false, compass: false, scaleBar: false }, density: 0, reliefAmount: 0 })));
      await waitFor(() => observed.some(o => Math.abs(o.ratio - dpr) < 0.01));
      const target = host.firstElementChild!;
      await act(async () => target.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, clientX: 240, clientY: 120, bubbles: true, cancelable: true })));
      await waitFor(() => observed.some(o => o.ratio < dpr * 0.9));
      assert(observed.every(o => Math.abs(o.cssSize - 24) < 0.05), `DPR${dpr} changes lettering size between passes: ${JSON.stringify(observed)}`);
      await act(async () => root.render(null));
    }
  } finally {
    await act(async () => root.unmount()); host.remove(); style.remove();
    CanvasRenderingContext2D.prototype.fillText = original;
    if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
  }
  return 'Carta keeps identical CSS lettering size during wheel/interim/quick/full rendering on DPR1 and DPR2';
}

/**
 * Cerrar la carta dentro del fotograma que `render` cede antes de bloquear no
 * puede costar el render completo: antes corría igualmente (segundos de hilo
 * principal a tamaño real) para pintar un lienzo ya desmontado. Y cancelar ese
 * fotograma no puede dejar echado el cerrojo `rendering`: bajo StrictMode el
 * desmontaje es simulado y el remontaje tiene que seguir dibujando.
 */
export async function testCartoMapUnmountCancelsRender(): Promise<string> {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'carta-unmount' });
  const host = document.createElement('div'); host.id = 'carto-unmount-qa'; host.style.cssText = 'position:relative;width:480px;height:240px';
  const style = document.createElement('style'); style.textContent = '#carto-unmount-qa>div{position:absolute;inset:0}';
  document.head.append(style); document.body.append(host);
  const props = (density: number) => ({ world, theme: THEME_ANTIQUE, density, reliefAmount: 0,
    layers: { labels: false, settlements: false, forests: false, relief: false, frame: false, compass: false, scaleBar: false } });
  const drawn = () => (host.querySelector('canvas')?.width ?? 0) >= 400;
  const waitFor = async (test: () => boolean, message: string) => {
    const end = Date.now() + 5000;
    while (!test() && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 40)); });
    assert(test(), message);
  };
  const nativeCreate = document.createElement;
  let root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(CartoMap, props(0)))));
    await waitFor(drawn, 'StrictMode remount left the carta without a finished render');
    // A prop change books the yielded frame; the view closes before it fires.
    act(() => root.render(createElement(StrictMode, null, createElement(CartoMap, props(1)))));
    let sheets = 0;
    document.createElement = function (this: Document, tag: string, options?: ElementCreationOptions) {
      if (String(tag).toLowerCase() === 'canvas') sheets++;
      return nativeCreate.call(this, tag, options);
    } as typeof document.createElement;
    act(() => root.unmount());
    await new Promise(r => setTimeout(r, 250));
    assert(sheets === 0, `closing the carta inside its yielded frame still ran the full render (${sheets} sheets painted)`);
    document.createElement = nativeCreate;
    root = createRoot(host);
    await act(async () => root.render(createElement(CartoMap, props(0))));
    await waitFor(drawn, 'the carta did not render again after a cancelled frame');
  } finally {
    document.createElement = nativeCreate;
    await act(async () => root.unmount()); host.remove(); style.remove();
  }
  return 'Carta: closing inside the yielded frame cancels the full render; StrictMode remount still draws';
}

/** Optional QA artifact, run outside the critical suite: real seeds side by side
 * against the previous overlay with the same terrain, geography and camera. */
export function renderCartographicLabelGallery(previous: typeof drawOverlay): Array<{ name: string; image: string; before: number; after: number }> {
  return ['archipelago', 'pangaea', 'iceAge'].map((presetId, index) => {
    const world = generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width: 128, seed: `letters-${presetId}` }, WORLD_PRESETS.find(p => p.id === presetId)!));
    const geo = buildHumanGeography(world), theme = index % 2 ? THEME_ANTIQUE : THEME_WONDER;
    const combined = inkCanvas(1440, 390), counts: number[] = [];
    for (const [side, overlay] of [previous, drawOverlay].entries()) {
      const out = inkCanvas(720, 360);
      renderCartography(world, out.ctx, { theme, width: 720, height: 360, layers: { labels: false, settlements: false, frame: false, compass: false, scaleBar: false }, geography: geo });
      overlay(out.instrumented, world, geo, { ...options(world, 720, 360), theme: side === 0 && theme === THEME_WONDER ? { ...theme, type: { ...theme.type, oceanColor: '#e8dcbe' } } : theme });
      counts.push(out.draws.length);
      combined.ctx.drawImage(out.canvas, side * 720, 30);
      combined.ctx.font = '16px sans-serif'; combined.ctx.fillStyle = '#e8dcc9';
      combined.ctx.fillText(`${presetId} · ${side ? 'Ahora' : 'Antes'}`, side * 720 + 12, 21);
    }
    return { name: presetId, image: combined.canvas.toDataURL('image/png'), before: counts[0], after: counts[1] };
  });
}
