import type { Ctx } from './symbols';
import type { CultureId } from '../core/naming';
import type { WorldSpatialStyle } from '../core/spatialEntities';
import { buildingPalette, placeParts } from '../core/placeStyle';

/** Own construction vocabulary shared by maps and sculpt/places; no image assets. */
export function drawPlaceBuilding(ctx: Ctx, style: WorldSpatialStyle, culture: CultureId | undefined, radius: number, rank = 'town'): boolean {
  // An icon that is a lower-case kind word ("volcano", "tower") is a kind, not a glyph: the caller draws its own mark for it.
  // A short code or a capitalised word the author typed ("X", "HQ", "Inn") is still lettered.
  if (style.icon && style.icon !== 'auto' && (!style.model || style.model === 'auto') && !(/^[a-z][a-z0-9_-]{2,}$/.test(style.icon) && !['fort', 'city', 'town', 'place'].includes(style.icon))) {
    ctx.save(); ctx.strokeStyle = style.color ?? '#493e30'; ctx.fillStyle = style.color ?? '#eee1c6'; ctx.lineWidth = Math.max(.7, radius * .2);
    ctx.beginPath();
    if (style.icon === 'fort') ctx.rect(-radius, -radius, radius * 2, radius * 2);
    else if (['city', 'town', 'place'].includes(style.icon)) ctx.arc(0, 0, radius * (style.icon === 'place' ? .55 : .9), 0, Math.PI * 2);
    else { ctx.font = `${radius * 2.2}px "Segoe UI Symbol", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(style.icon.slice(0, 16), 0, 0); ctx.restore(); return true; }
    ctx.fill(); ctx.stroke();
    if (style.icon === 'city') { ctx.beginPath(); ctx.arc(0, 0, radius * .35, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
    ctx.restore(); return true;
  }
  if ((!style.model || style.model === 'auto') && (!style.buildingStyle || style.buildingStyle === 'auto')) return false;
  const model = style.model && style.model !== 'auto' ? style.model : rank === 'capital' || rank === 'city' ? 'keep' : 'house';
  const palette = buildingPalette(style, culture);
  const parts = placeParts(model, palette).sort((a, b) => a.z - b.z || a.y - b.y);
  const project = (x: number, y: number, z: number): [number, number] => [(x + z * .45) * radius, (-y + z * .25) * radius];
  const poly = (points: [number, number, number][], fill: string) => {
    ctx.beginPath(); points.forEach(([x, y, z], i) => { const p = project(x, y, z); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); });
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
  };
  ctx.save(); ctx.strokeStyle = palette.trim; ctx.lineWidth = Math.max(.55, radius * .10); ctx.lineJoin = 'round';
  for (const p of parts) {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    const y0 = p.y - p.h / 2, y1 = p.y + p.h / 2;
    if (p.shape === 'roof') {
      poly([[x0,p.y,z1],[x1,p.y,z1],[p.x,p.y+p.h,z1]], palette.wall);
      poly([[x0,p.y,z0],[x0,p.y,z1],[p.x,p.y+p.h,z1],[p.x,p.y+p.h,z0]], palette.roof);
      poly([[p.x,p.y+p.h,z0],[p.x,p.y+p.h,z1],[x1,p.y,z1],[x1,p.y,z0]], palette.roof);
    } else if (p.shape === 'blade') {
      const a = p.angle ?? 0, dx = Math.cos(a) * p.h * .7, dy = Math.sin(a) * p.h * .7;
      const q0 = project(p.x-dx, p.y-dy, p.z), q1 = project(p.x+dx, p.y+dy, p.z);
      ctx.beginPath(); ctx.moveTo(...q0); ctx.lineTo(...q1); ctx.lineWidth = Math.max(.7, radius * .15); ctx.stroke();
    } else {
      poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], palette.wall);
      poly([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], palette.wall);
      poly([[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], palette.wall);
      ctx.fillStyle = palette.trim; const [wx, wy] = project(p.x, p.y, z1 + .01); ctx.fillRect(wx - radius * .07, wy - radius * .1, radius * .14, radius * .25);
    }
  }
  ctx.restore(); return true;
}
