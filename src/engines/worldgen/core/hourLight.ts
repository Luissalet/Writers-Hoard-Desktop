// ============================================
// The hour on a flat map
// ============================================
// A map seen at an hour of the day: the pale pink of dawn, plain daylight at
// noon, the gold of the afternoon, the red of dusk and the blue of night. A
// wash of colour multiplied over the map (and, at night, a lantern's warm glow
// round the party on its way), shared by the 2D map, the journey's playback and
// the exported pictures.

/** The named hours offered in the map's light menu, in clock hours. */
export const MAP_HOURS = { dawn: 6.25, morning: 9, noon: 13, afternoon: 16.5, dusk: 19.5, night: 23 } as const;
export type MapHourName = keyof typeof MAP_HOURS;

interface Key { h: number; rgb: [number, number, number]; a: number; glow: number }
// The wash at each key hour: a colour multiplied over the map, how strongly, and the lantern's glow.
const KEYS: Key[] = [
  { h: 0, rgb: [38, 52, 108], a: 0.62, glow: 1 },
  { h: 4.6, rgb: [38, 52, 108], a: 0.62, glow: 1 },
  { h: 6.25, rgb: [232, 150, 150], a: 0.34, glow: 0.3 },
  { h: 8, rgb: [255, 232, 200], a: 0.14, glow: 0 },
  { h: 11, rgb: [255, 255, 255], a: 0, glow: 0 },
  { h: 14.5, rgb: [255, 255, 255], a: 0, glow: 0 },
  { h: 17.5, rgb: [255, 214, 150], a: 0.2, glow: 0 },
  { h: 19.5, rgb: [226, 112, 82], a: 0.4, glow: 0.4 },
  { h: 21.2, rgb: [38, 52, 108], a: 0.62, glow: 1 },
  { h: 24, rgb: [38, 52, 108], a: 0.62, glow: 1 },
];

export interface HourWash { rgb: [number, number, number]; alpha: number; glow: number }

/** The wash for a clock hour (any number; it wraps round the day). */
export function hourWash(hour: number): HourWash {
  const h = ((hour % 24) + 24) % 24;
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1].h < h) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = b.h > a.h ? Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h))) : 0;
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    rgb: [Math.round(mix(a.rgb[0], b.rgb[0])), Math.round(mix(a.rgb[1], b.rgb[1])), Math.round(mix(a.rgb[2], b.rgb[2]))],
    alpha: mix(a.a, b.a),
    glow: mix(a.glow, b.glow),
  };
}

/**
 * The clock hour of a party on the move, from the playback's day (a fraction
 * of a day after setting off): the moving share of each day runs from the
 * hour it sets off, the rest is the night's halt.
 */
export function partyHour(day: number, setOffHour = 7, movingShare = 0.6, hoursMoving = 11): number {
  const f = ((day % 1) + 1) % 1;
  if (f < movingShare) return setOffHour + (f / movingShare) * hoursMoving;
  const nightStart = setOffHour + hoursMoving;
  return (nightStart + ((f - movingShare) / (1 - movingShare)) * (24 - hoursMoving)) % 24;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Lay the hour over what is already drawn in a rectangle, and the lantern's
 * glow round each of `lights` (screen points) when it is dark enough.
 */
export function drawHourLight(ctx: Ctx, x: number, y: number, w: number, h: number, hour: number, lights: { x: number; y: number }[] = [], lightRadius = 60): HourWash {
  const wash = hourWash(hour);
  if (wash.alpha <= 0.005) return wash;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = wash.alpha;
  ctx.fillStyle = `rgb(${wash.rgb[0]},${wash.rgb[1]},${wash.rgb[2]})`;
  ctx.fillRect(x, y, w, h);
  if (wash.glow > 0.05) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = wash.glow;
    for (const p of lights) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, lightRadius);
      g.addColorStop(0, 'rgba(255,196,110,0.75)');
      g.addColorStop(0.45, 'rgba(255,160,70,0.28)');
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - lightRadius, p.y - lightRadius, lightRadius * 2, lightRadius * 2);
    }
  }
  ctx.restore();
  return wash;
}
