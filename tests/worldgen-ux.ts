// ============================================
// Worldgen 2D — the ruler, the legend, the keyboard camera
// ============================================
// Pure arithmetic first, then one real canvas: a bench that mounts is not a
// bench that draws (lesson #31), so the overlay is painted onto a 2D canvas and
// its pixels are read back. No WebGL, no world generation, no React.

import { EARTH_KM } from '@/engines/worldgen/core/camera';
import {
  cellBearingDeg, cellDistanceKm, cellToLonLat, compassPoint, formatLatLon,
  measurePolyline, wrappedDx,
} from '@/engines/worldgen/core/measure';
import { straightLineEstimates } from '@/engines/worldgen/core/travel';
import {
  KEY_PAN_FRACTION, KEY_PAN_LEAP, KEY_ZOOM_STEP, keyboardNudge,
} from '@/engines/worldgen/core/keyNav';
import { legendFor } from '@/engines/worldgen/cartography/legend';
import {
  ELEV_STOPS, RAIN_STOPS, TEMP_STOPS, flowColor, rampColor,
} from '@/engines/worldgen/core/render';
import { drawRuler } from '@/engines/worldgen/cartography/rulerOverlay';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Relative closeness, for kilometres that come out of trigonometry. */
function near(actual: number, expected: number, tolerance: number, what: string): void {
  const err = Math.abs(actual - expected) / Math.max(1e-9, Math.abs(expected));
  assert(err <= tolerance, `${what}: expected ${expected}, got ${actual} (rel. error ${err.toExponential(2)})`);
}

const W = 64, H = 32;

export function testWorldgenRuler(): string {
  // A quarter of a turn along the equator is a quarter of the planet.
  near(cellDistanceKm({ x: 32, y: 16 }, { x: 48, y: 16 }, W, H), EARTH_KM / 4, 1e-6, 'equator quarter turn');
  // Antipodes on the equator: half the planet, and not more.
  near(cellDistanceKm({ x: 0, y: 16 }, { x: 32, y: 16 }, W, H), EARTH_KM / 2, 1e-6, 'antipodes');
  // Pole to equator along a meridian.
  near(cellDistanceKm({ x: 10, y: 0 }, { x: 10, y: 16 }, W, H), EARTH_KM / 4, 1e-6, 'pole to equator');
  // THE SEAM: x = 1 and x = W − 1 are two cells apart, not sixty-two.
  near(cellDistanceKm({ x: 1, y: 16 }, { x: 63, y: 16 }, W, H), EARTH_KM * 2 / 64, 1e-6, 'across the seam');
  assert(wrappedDx({ x: 1, y: 0 }, { x: 63, y: 0 }, W) === -2, 'wrappedDx did not fold the seam westward');
  assert(wrappedDx({ x: 63, y: 0 }, { x: 1, y: 0 }, W) === 2, 'wrappedDx did not fold the seam eastward');
  // Street zoom: two points a hundredth of a cell apart still measure (acos would not).
  const tiny = cellDistanceKm({ x: 32, y: 16 }, { x: 32.01, y: 16 }, W, H);
  near(tiny, EARTH_KM * 0.01 / 64, 1e-4, 'sub-cell distance');
  // A point is zero from itself.
  assert(cellDistanceKm({ x: 5, y: 5 }, { x: 5, y: 5 }, W, H) === 0, 'zero-length leg is not zero');

  // Bearings: north is 0, east is 90, and the compass spells them in the reader's letters.
  near(cellBearingDeg({ x: 32, y: 16 }, { x: 32, y: 8 }, W, H), 0, 1e-9, 'bearing north');
  near(cellBearingDeg({ x: 32, y: 16 }, { x: 40, y: 16 }, W, H), 90, 1e-9, 'bearing east');
  near(cellBearingDeg({ x: 32, y: 16 }, { x: 32, y: 24 }, W, H), 180, 1e-9, 'bearing south');
  near(cellBearingDeg({ x: 32, y: 16 }, { x: 24, y: 16 }, W, H), 270, 1e-9, 'bearing west');
  assert(compassPoint(0) === 'N' && compassPoint(90) === 'E' && compassPoint(180) === 'S', 'cardinal points');
  assert(compassPoint(270) === 'W' && compassPoint(270, 'NESO') === 'O', 'west is W in English and O in Spanish');
  assert(compassPoint(45) === 'NE' && compassPoint(292.5, 'NESO') === 'ONO', 'intercardinal points');
  assert(compassPoint(359) === 'N' && compassPoint(-90) === 'W', 'compass wraps at both ends');

  // Coordinates: the graticule's convention — prime meridian and equator through the middle.
  assert(formatLatLon(cellToLonLat({ x: 32, y: 16 }, W, H)) === '0.0° N · 0.0° E', 'origin of the sheet');
  assert(formatLatLon(cellToLonLat({ x: 0, y: 0 }, W, H)) === '90.0° N · 180.0° W', 'top-left corner');
  assert(formatLatLon(cellToLonLat({ x: 48, y: 24 }, W, H)) === '45.0° S · 90.0° E', 'south-east quadrant');
  assert(formatLatLon(cellToLonLat({ x: 48, y: 24 }, W, H), 'NESO', ',') === '45,0° S · 90,0° E', 'Spanish letters and comma');
  assert(formatLatLon(cellToLonLat({ x: 16, y: 8 }, W, H), 'NESO', ',') === '45,0° N · 90,0° O', 'oeste is O');

  // A polyline is the sum of its legs, and each leg knows its own bearing.
  const reading = measurePolyline([{ x: 32, y: 16 }, { x: 48, y: 16 }, { x: 48, y: 8 }], W, H);
  assert(reading.legs.length === 2, 'three points make two legs');
  near(reading.totalKm, reading.legs[0].km + reading.legs[1].km, 1e-12, 'total is the sum of the legs');
  near(reading.legs[0].km, EARTH_KM / 4, 1e-6, 'first leg');
  near(reading.legs[1].bearing, 0, 1e-9, 'second leg heads north');
  assert(measurePolyline([], W, H).totalKm === 0 && measurePolyline([{ x: 1, y: 1 }], W, H).legs.length === 0,
    'nothing to measure measures nothing');

  // The crow-flies estimates come from the planner's own road paces.
  const est = straightLineEstimates(100);
  assert(est.map((e) => e.mode).join(',') === 'foot,horse,cart,ship', 'estimate modes and order');
  near(est[0].hours, 100 / 4.0, 1e-12, 'foot at 4 km/h on a road');
  near(est[1].hours, 100 / 7.0, 1e-12, 'horse at 7 km/h on a road');
  near(est[2].hours, 100 / 3.6, 1e-12, 'cart at 3.6 km/h on a road');
  near(est[3].hours, 100 / 8.0, 1e-12, 'ship at 8 km/h');
  assert(est.every((e) => e.hoursPerDay === 11), 'summer allows eleven hours a day');
  assert(straightLineEstimates(100, 'winter').every((e) => e.hoursPerDay === 7), 'winter allows seven');
  assert(straightLineEstimates(0).every((e) => e.hours === 0), 'no distance, no time');
  assert(straightLineEstimates(-5).every((e) => e.hours === 0), 'a negative distance is clamped');
  return 'Worldgen ruler: great-circle distance, seam, bearings, coordinates, crow-flies paces';
}

export function testWorldgenLegend(): string {
  const t = (key: string): string => `<${key}>`;
  const css = (c: [number, number, number]) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

  const elevation = legendFor('elevation', t);
  assert(elevation, 'elevation has a legend');
  assert(elevation.stops.length === ELEV_STOPS.length, 'elevation legend carries every stop of the ramp');
  ELEV_STOPS.forEach(([value], i) => {
    assert(elevation.stops[i].value === value, `elevation stop ${i} value`);
    // What the legend shows is what the render paints — the same function.
    assert(elevation.stops[i].color === css(rampColor(value, ELEV_STOPS)), `elevation stop ${i} colour`);
  });
  // Thousands are grouped with a THIN space (U+2009), the way an atlas prints them.
  assert(elevation.stops[0].label === '0 m' && elevation.stops[elevation.stops.length - 1].label === '4\u2009200 m',
    `elevation labels in metres with thin-space thousands: ${elevation.stops.map((s) => s.label).join('|')}`);
  assert(elevation.ticks.length === 3 && elevation.ticks[0] === elevation.stops[0]
    && elevation.ticks[2] === elevation.stops[elevation.stops.length - 1], 'three ticks, first and last at the ends');
  assert(elevation.gradient.startsWith('linear-gradient(to right, rgb(') && elevation.gradient.includes(' 100.0%)'),
    `gradient runs the whole bar: ${elevation.gradient}`);
  for (let i = 1; i < elevation.stops.length; i++) {
    assert(elevation.stops[i].value > elevation.stops[i - 1].value, 'legend stops ascend');
  }
  assert(elevation.titleKey === 'worldgen.legend.elevation', 'elevation title key');

  const temperature = legendFor('temperature', t);
  assert(temperature && temperature.stops.length === TEMP_STOPS.length, 'temperature legend');
  assert(temperature.stops[0].label === '−30 °C' && temperature.stops[temperature.stops.length - 1].label === '30 °C',
    `temperature labels: ${temperature.stops.map((s) => s.label).join('|')}`);
  assert(temperature.stops[0].color === css(rampColor(-30, TEMP_STOPS)), 'coldest colour is the render\'s');

  const rain = legendFor('precipitation', t);
  assert(rain && rain.stops.length === RAIN_STOPS.length, 'precipitation legend');
  assert(rain.stops[rain.stops.length - 1].label === '3\u2009300 mm', `rain labels: ${rain.stops.map((s) => s.label).join('|')}`);
  assert(rain.stops[3].color === css(rampColor(RAIN_STOPS[3][0], RAIN_STOPS)), 'rain stop colour is the render\'s');

  const flow = legendFor('flow', t);
  assert(flow && flow.stops.length === 2, 'flow legend has two ends');
  assert(flow.stops[0].color === css(flowColor(0)) && flow.stops[1].color === css(flowColor(1)),
    'flow ends are the render\'s dark and bright');
  assert(flow.stops[0].label === '<worldgen.legend.flow.low>' && flow.stops[1].label === '<worldgen.legend.flow.high>',
    'flow labels go through the catalogue');
  assert(flow.ticks.length === 2, 'a two-stop ramp ticks both ends');

  assert(legendFor('atlas', t) === null, 'the atlas is a picture, not a ramp');
  assert(legendFor('plates', t) === null, 'plates are categorical');
  return 'Worldgen legend: built from the render\'s own ramps, labelled with units';
}

export function testWorldgenKeyboardCamera(): string {
  const cw = 800, ch = 500;
  const step = Math.min(cw, ch) * KEY_PAN_FRACTION;
  const left = keyboardNudge('ArrowLeft', false, cw, ch);
  assert(left && left.dx === step && left.dy === 0 && left.zoom === 1, 'ArrowLeft slides the sheet east (origin grows)');
  const right = keyboardNudge('ArrowRight', false, cw, ch);
  assert(right && right.dx === -step && right.dy === 0, 'ArrowRight is the mirror of ArrowLeft');
  const up = keyboardNudge('ArrowUp', false, cw, ch);
  assert(up && up.dy === step && up.dx === 0, 'ArrowUp slides the sheet down');
  const down = keyboardNudge('ArrowDown', false, cw, ch);
  assert(down && down.dy === -step, 'ArrowDown is the mirror of ArrowUp');
  const leap = keyboardNudge('ArrowLeft', true, cw, ch);
  assert(leap && leap.dx === step * KEY_PAN_LEAP, 'Shift makes the arrow a leap');
  for (const key of ['+', '=', 'Add']) {
    const z = keyboardNudge(key, false, cw, ch);
    assert(z && z.zoom === KEY_ZOOM_STEP && z.dx === 0 && z.dy === 0, `${key} zooms in without panning`);
  }
  for (const key of ['-', '_', 'Subtract']) {
    const z = keyboardNudge(key, false, cw, ch);
    assert(z && Math.abs(z.zoom * KEY_ZOOM_STEP - 1) < 1e-12, `${key} zooms out by the inverse step`);
  }
  for (const key of ['a', 'Enter', 'Home', 'Backspace', 'Escape', ' ']) {
    assert(keyboardNudge(key, false, cw, ch) === null, `${key} is not a camera key`);
  }
  // A degenerate canvas still nudges by a pixel rather than by nothing.
  const tiny = keyboardNudge('ArrowUp', false, 0, 0);
  assert(tiny && tiny.dy > 0, 'a zero-sized canvas still moves');
  return 'Worldgen keyboard camera: arrows pan, Shift leaps, +/- zoom about the middle';
}

/**
 * The overlay actually paints: amber ink along the leg, a marked first vertex,
 * a label pill at the middle, and the rubber band's label beside the pointer.
 */
export function testWorldgenRulerOverlayDraws(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 120;
  const ctx = canvas.getContext('2d');
  assert(ctx, 'no 2D context');
  drawRuler(ctx, {
    legs: [{ x0: 20, y0: 60, x1: 220, y1: 60, label: '1 234 km' }],
    vertices: [{ x: 20, y: 60 }, { x: 220, y: 60 }],
    band: { x0: 220, y0: 60, x1: 200, y1: 100, label: '12 km' },
  });
  const px = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data;
  const inked = (x: number, y: number) => px(x, y)[3] > 200;
  // Ink on the leg away from the label, none well above it.
  assert(inked(60, 60), 'the leg is not painted');
  const [r, g, b] = px(60, 60);
  assert(r > 200 && g > 150 && b < 160, `leg ink is not amber: rgb(${r},${g},${b})`);
  assert(!inked(60, 30), 'ink where there is no line');
  // The first vertex is a filled amber disc; the second is a dark disc with an amber rim.
  const [vr, vg, vb] = px(20, 60);
  assert(vr > 200 && vg > 150 && vb < 160, 'first vertex is not marked in ink');
  const [sr, sg, sb] = px(220, 60);
  assert(sr < 60 && sg < 60 && sb < 60, 'later vertex should be dark inside');
  // The label pill sits over the middle of the leg: a dark box with light text.
  let dark = 0, light = 0;
  for (let x = 100; x <= 140; x += 2) {
    for (let y = 52; y <= 68; y += 2) {
      const [pr, pg, pb, pa] = px(x, y);
      if (pa < 200) continue;
      if (pr < 40 && pg < 40 && pb < 60) dark++;
      else if (pr > 200 && pg > 200) light++;
    }
  }
  assert(dark > 40 && light > 3, `label pill not drawn at the leg's middle (dark ${dark}, light ${light})`);
  // The band is dashed: along it, some samples are inked and some are not.
  let bandInk = 0, bandGap = 0;
  for (let k = 0; k <= 20; k++) {
    const x = Math.round(220 - k), y = Math.round(60 + k * 2);
    if (inked(x, y)) bandInk++; else bandGap++;
  }
  assert(bandInk > 0 && bandGap > 0, `band is not dashed (ink ${bandInk}, gaps ${bandGap})`);
  return 'Worldgen ruler overlay paints legs, vertices, labels and a dashed band';
}

/**
 * The gestures as the reader makes them, on the real map.
 *
 * A 128-cell world is forged on the main thread (well under a second), `Map2D`
 * is mounted with the ruler out and no geography (so no tile pyramid and no
 * workers), and the pointer and keyboard are driven with real events. The
 * catalogue may not yet carry the ruler's keys, so the text checks stay on
 * what does not depend on it: the readout's coordinates, the ink on the
 * canvas, and the viewport the map reports back.
 */
export async function testWorldgenRulerOnMap(): Promise<string> {
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: Map2D } = await import('@/engines/worldgen/components/Map2D');

  // The map sizes itself from `absolute inset-0`, and the harness page has no
  // Tailwind: without these three rules the canvas is born 1 px tall and every
  // check below passes on nothing (lesson #31).
  const style = document.createElement('style');
  style.textContent = '.absolute{position:absolute}.inset-0{top:0;right:0;bottom:0;left:0}.block{display:block}';
  document.head.appendChild(style);
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:640px;height:400px;overflow:hidden;';
  document.body.appendChild(host);
  const root = createRoot(host);
  const reported: { u: number; v: number; spanKm: number }[] = [];
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'ruler-on-map' });
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  // React commits and flushes passive effects on its own scheduler, not on
  // the frame: poll for the condition instead of counting frames.
  const waitFor = async (cond: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 5000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await frame();
    }
  };
  const mount = (measuring: boolean, viewMode: 'atlas' | 'elevation') => {
    root.render(createElement(Map2D, {
      world, viewMode, projection: 'equirect',
      showRivers: true, showLandmarks: true, showWaypoints: true, showGrid: false,
      waypoints: [], selectedWaypointId: null, onSelectWaypoint: () => {},
      geography: null, measuring,
      onViewportChange: (vp) => { reported.push(vp); },
    }));
  };
  try {
    mount(true, 'elevation');
    await waitFor(() => (host.querySelector('canvas')?.clientWidth ?? 0) >= 600, 'the map canvas to be sized');
    const canvas = host.querySelector('canvas');
    assert(canvas, 'Map2D did not mount a canvas');
    assert(canvas.clientWidth >= 600 && canvas.clientHeight >= 380, `canvas is ${canvas.clientWidth}×${canvas.clientHeight}`);

    // The legend is on in a ramp view, with its three ticks.
    const legend = host.querySelector('[data-testid="worldgen-legend"]');
    assert(legend, 'no legend in the elevation view');
    assert(legend.querySelectorAll('span').length === 3, 'legend does not print three ticks');
    assert(host.querySelector('[data-testid="worldgen-ruler"]'), 'ruler readout missing with the ruler out');

    // Synthetic pointers are not "active" pointers: capture would throw.
    canvas.setPointerCapture = () => {};
    const rect = canvas.getBoundingClientRect();
    const click = (x: number, y: number) => {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
          button: 0, buttons: type === 'pointerdown' ? 1 : 0,
          clientX: rect.left + x, clientY: rect.top + y,
        }));
      }
    };
    // Two clicks on the sheet, a third of the width apart, on the same row.
    const y = rect.height / 2;
    const xa = rect.width * 0.35, xb = rect.width * 0.65;
    click(xa, y);
    await waitFor(() => !!host.querySelector('[data-testid="worldgen-ruler"]')?.textContent?.includes('°'), 'the first point');
    click(xb, y);
    await frame();
    await frame();
    const readout = host.querySelector('[data-testid="worldgen-ruler"]');
    assert(readout && readout.textContent && readout.textContent.includes('°'),
      `readout does not show the last point's coordinates: ${readout?.textContent}`);
    // And the ink is on the canvas, between the two clicks, away from the pill.
    const ctx = canvas.getContext('2d');
    assert(ctx, 'no 2D context on the mounted map');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const at = (x: number, yy: number) => ctx.getImageData(Math.round(x * dpr), Math.round(yy * dpr), 1, 1).data;
    // The most amber of the three rows around the line: a 1.8 px stroke on a
    // half-pixel boundary is anti-aliased over its own dark halo.
    const inkAt = (x: number): boolean => [-1, 0, 1].some((d) => {
      const [r, g, b] = at(x, y + d);
      return r > 170 && g > 130 && b < 150 && r - b > 60;
    });
    assert(inkAt(xa + (xb - xa) * 0.15), `no amber ink between the two points: rgb(${Array.from(at(xa + (xb - xa) * 0.15, y)).join(',')})`);

    // Backspace takes the last point back; the readout drops to one point.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await waitFor(() => !inkAt(xa + (xb - xa) * 0.15), 'the leg to go');

    // The keyboard camera: the click focused the canvas, so ArrowLeft looks west.
    assert(document.activeElement === canvas, 'the click did not hand the keyboard to the map');
    // No gesture yet, so nothing reported: the fitted view is centred at u = 0.5.
    const before = reported.length;
    const u0 = (reported[before - 1] ?? { u: 0.5 }).u;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert(reported.length > before, 'ArrowLeft did not report a camera move');
    const u1 = reported[reported.length - 1].u;
    assert(u1 < u0, `ArrowLeft should look west (u ${u0} → ${u1})`);
    const span0 = reported[reported.length - 1].spanKm;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
    const span1 = reported[reported.length - 1].spanKm;
    assert(span1 < span0, `+ should zoom in (span ${span0} → ${span1})`);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }));
    const span2 = reported[reported.length - 1].spanKm;
    assert(Math.abs(span2 - span0) < 1e-6 * span0, `- should undo + exactly (span ${span0} → ${span2})`);

    // Putting the ruler away clears the measure and the readout; the atlas view has no legend.
    mount(false, 'atlas');
    await waitFor(() => !host.querySelector('[data-testid="worldgen-legend"]'), 'the legend to leave with the atlas view');
    assert(!host.querySelector('[data-testid="worldgen-ruler"]'), 'readout survived putting the ruler away');
    assert(!host.querySelector('[data-testid="worldgen-legend"]'), 'the atlas view must not print a legend');
  } finally {
    root.unmount();
    host.remove();
    style.remove();
  }
  return 'Worldgen ruler and keyboard camera on the mounted 2D map';
}
