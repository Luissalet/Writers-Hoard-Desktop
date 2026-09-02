// ============================================
// Cartography — The legend of the thematic views
// ============================================
// Altura, Temperatura, Lluvia and Caudal paint the world as a colour ramp, and
// nothing on screen said what the colours meant: the reader learnt that red is
// hot by hovering until the readout said 30 °C. A map with a ramp and no key
// is a picture.
//
// The legend is built FROM THE RENDER'S OWN STOPS (`core/render.ts` exports
// them), never from a copy kept here: two tables of the same colours drift at
// the first retouch, and a legend that is nearly the map is worse than none.
// Pure data out — the map decides where to put it and what font to use.

import type { ViewMode } from '../core/types';
import { ELEV_STOPS, RAIN_STOPS, TEMP_STOPS, flowColor, rampColor } from '../core/render';

export interface LegendStop {
  /** The value in the ramp's own unit (m, °C, mm, or 0–1 for flow). */
  value: number;
  /** The colour the render paints that value, as CSS. */
  color: string;
  /** What to print under it, unit included. */
  label: string;
}

export interface LegendSpec {
  mode: ViewMode;
  /** Catalogue key of the heading. */
  titleKey: string;
  /** Every stop of the ramp, ascending. */
  stops: LegendStop[];
  /** The three labels worth printing on a short bar: first, middle, last. */
  ticks: LegendStop[];
  /** `linear-gradient(to right, …)` through the stops, positioned by value. */
  gradient: string;
}

type Stops = [number, [number, number, number]][];

const css = (c: [number, number, number]): string =>
  `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** Thousands grouped with a THIN space (U+2009), the way an atlas prints "1 600 m". */
const thousands = (n: number): string => {
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `−${grouped}` : grouped;
};

function fromRamp(mode: ViewMode, titleKey: string, ramp: Stops, label: (v: number) => string): LegendSpec {
  const stops = ramp.map(([value]) => ({
    value,
    // Through `rampColor`, not `ramp[i][1]` directly: the legend must show what
    // the render shows, and `rampColor` is what the render calls.
    color: css(rampColor(value, ramp)),
    label: label(value),
  }));
  return finish(mode, titleKey, stops);
}

function finish(mode: ViewMode, titleKey: string, stops: LegendStop[]): LegendSpec {
  const min = stops[0].value, max = stops[stops.length - 1].value;
  const span = Math.max(1e-9, max - min);
  const gradient = `linear-gradient(to right, ${stops
    .map((s) => `${s.color} ${(((s.value - min) / span) * 100).toFixed(1)}%`)
    .join(', ')})`;
  // The middle tick is the STOP nearest the middle of the bar, so its label
  // sits under a colour the ramp actually has a name for.
  let mid = 0, best = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = Math.abs((stops[i].value - min) / span - 0.5);
    if (d < best) { best = d; mid = i; }
  }
  const ticks = stops.length > 2 ? [stops[0], stops[mid], stops[stops.length - 1]] : stops.slice();
  return { mode, titleKey, stops, ticks, gradient };
}

/**
 * The legend for a view mode, or null where the view has no ramp to explain
 * (the atlas is a picture of the ground; the plates are a categorical wash).
 *
 * `t` translates the flow legend's two words; every other label is a number
 * with a unit shared by both languages.
 */
export function legendFor(mode: ViewMode, t: (key: string) => string): LegendSpec | null {
  switch (mode) {
    case 'elevation':
      // The ramp is in kilometres; the reader thinks in metres.
      return fromRamp(mode, 'worldgen.legend.elevation', ELEV_STOPS, (km) => `${thousands(km * 1000)} m`);
    case 'temperature':
      return fromRamp(mode, 'worldgen.legend.temperature', TEMP_STOPS, (c) => `${thousands(c)} °C`);
    case 'precipitation':
      return fromRamp(mode, 'worldgen.legend.precipitation', RAIN_STOPS, (mm) => `${thousands(mm)} mm`);
    case 'flow':
      return finish(mode, 'worldgen.legend.flow', [
        { value: 0, color: css(flowColor(0)), label: t('worldgen.legend.flow.low') },
        { value: 1, color: css(flowColor(1)), label: t('worldgen.legend.flow.high') },
      ]);
    default:
      return null;
  }
}
