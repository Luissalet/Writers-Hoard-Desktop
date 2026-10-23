// ============================================
// Cartography — the party's trail and towns as dots, in the reader's view
// ============================================
// The trail is the story's way so far: the events that have happened, in
// chapter order, joined by a dotted line in the map's ink with the chapter
// number where each chapter begins. Towns as dots: a town the story has only
// heard of is a small ink dot on the paper, with no name.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TrailPoint { x: number; y: number; chapter?: number }

const INK = 'rgba(70,46,24,0.92)';

/**
 * `x0` is the screen x of world column 0, `k` pixels per cell, `sy` maps rows;
 * the trail is unwrapped from its start so it never crosses the whole sheet,
 * and drawn once per world copy that can show.
 */
export function drawTrail(ctx: Ctx, trail: readonly TrailPoint[], x0: number, sy: (wy: number) => number, k: number, W: number, scale = 1): void {
  if (trail.length < 2) return;
  const pts: { x: number; y: number; chapter?: number; first: boolean }[] = [];
  let prev = trail[0].x, lastChapter: number | undefined | null = null;
  for (const p of trail) {
    let x = p.x;
    while (x - prev > W / 2) x -= W;
    while (x - prev < -W / 2) x += W;
    prev = x;
    pts.push({ x, y: p.y, chapter: p.chapter, first: p.chapter !== lastChapter });
    lastChapter = p.chapter;
  }
  const span = W * k, cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const off of [-span, 0, span]) {
    const screen = pts.map((p) => ({ ...p, sx: x0 + (p.x + 0.5) * k + off, sy: sy(p.y + 0.5) }));
    if (screen.every((p) => p.sx < -40 || p.sx > cw + 40) || screen.every((p) => p.sy < -40 || p.sy > ch + 40)) continue;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([2 * scale, 5 * scale]);
    ctx.beginPath();
    screen.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.round(10 * scale)}px "Source Sans 3", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of screen) {
      // Every stop is a small ring; the first of a chapter carries its number.
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, (p.first ? 3.2 : 2.2) * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#ece3c8';
      ctx.fill();
      ctx.lineWidth = 1.4 * scale;
      ctx.strokeStyle = INK;
      ctx.stroke();
      if (p.first && typeof p.chapter === 'number') {
        const tx = p.sx, ty = p.sy - 10 * scale;
        ctx.lineWidth = 3 * scale;
        ctx.strokeStyle = 'rgba(236,227,200,0.95)';
        ctx.strokeText(String(p.chapter), tx, ty);
        ctx.fillStyle = INK;
        ctx.fillText(String(p.chapter), tx, ty);
      }
    }
  }
  ctx.restore();
}

/** Towns heard of: a dot each, no name. */
export function drawTownDots(ctx: Ctx, dots: readonly { x: number; y: number }[], x0: number, sy: (wy: number) => number, k: number, W: number, scale = 1): void {
  if (!dots.length) return;
  const span = W * k, cw = ctx.canvas.width, ch = ctx.canvas.height;
  const r = Math.max(1.8, Math.min(3.2, k * 0.4)) * scale;
  ctx.save();
  ctx.fillStyle = INK;
  for (const d of dots) for (const off of [-span, 0, span]) {
    const x = x0 + (d.x + 0.5) * k + off, y = sy(d.y + 0.5);
    if (x < -6 || x > cw + 6 || y < -6 || y > ch + 6) continue;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
