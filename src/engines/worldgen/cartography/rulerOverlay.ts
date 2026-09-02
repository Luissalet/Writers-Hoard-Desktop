// ============================================
// Cartography — The ruler's ink on the screen
// ============================================
// Screen furniture, like the scale bar: CSS pixels, redrawn every frame, the
// same on any ground. Pure — receives screen coordinates and the labels already
// composed in the reader's language, never the world or `t()`. The map decides
// where each vertex falls (and in which copy of a wrapping sheet); this file
// only knows how a measured line looks.
//
// It borrows the move tool's amber, deliberately: both are "a line the reader
// is holding", and a second colour for a second kind of held line would be one
// more thing to learn for nothing.

type Ctx = CanvasRenderingContext2D;

const INK = '#ffd479';
const HALO = 'rgba(8,10,16,0.8)';
const PILL = 'rgba(6,8,13,0.86)';
const TEXT = '#ffe9c2';

export interface RulerScreenLeg {
  x0: number; y0: number; x1: number; y1: number;
  /** The distance, formatted. Printed at the midpoint. */
  label: string;
}

export interface RulerOverlay {
  /** The legs between clicked points, in screen pixels. */
  legs: RulerScreenLeg[];
  /** The clicked points themselves, first one marked. */
  vertices: { x: number; y: number }[];
  /** The line from the last vertex to the pointer, with its live distance. */
  band?: RulerScreenLeg;
}

function pill(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.font = '600 11px "Source Sans 3", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = PILL;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 9, w, 18, 4);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.fillText(text, x, y);
}

/** Draw the measured polyline, its vertices and the rubber band. */
export function drawRuler(ctx: Ctx, o: RulerOverlay): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Halo first, then ink: the line has to read over snow and over the sea.
  for (const pass of [0, 1] as const) {
    ctx.lineWidth = pass === 0 ? 4 : 1.8;
    ctx.strokeStyle = pass === 0 ? HALO : INK;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const l of o.legs) { ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x1, l.y1); }
    ctx.stroke();
    if (o.band) {
      // Butt caps: round ones grow every dash by half the halo's width and
      // close the gaps, and a dashed line with no gaps is a solid one.
      ctx.lineCap = 'butt';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(o.band.x0, o.band.y0);
      ctx.lineTo(o.band.x1, o.band.y1);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    }
  }
  for (let k = 0; k < o.vertices.length; k++) {
    const v = o.vertices[k];
    const first = k === 0;
    ctx.beginPath();
    ctx.arc(v.x, v.y, first ? 5 : 3.6, 0, Math.PI * 2);
    ctx.fillStyle = first ? INK : PILL;
    ctx.fill();
    ctx.lineWidth = first ? 2 : 1.4;
    ctx.strokeStyle = first ? HALO : INK;
    ctx.stroke();
  }
  // Labels last, over the ink, at the middle of each leg — and the band's at
  // the pointer's end, offset so the hand does not cover it.
  for (const l of o.legs) {
    if (Math.hypot(l.x1 - l.x0, l.y1 - l.y0) < 36) continue;
    pill(ctx, l.label, (l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2);
  }
  if (o.band && o.band.label) pill(ctx, o.band.label, o.band.x1 + 16, o.band.y1 - 16);
  ctx.restore();
}
