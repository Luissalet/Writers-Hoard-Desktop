// ============================================
// Cartography — story events as marks on a map
// ============================================
// A coloured disc per event (hollow while only planned) with its chapter in
// it and its title beside it. Shared by the atlas, the Carta and exports.

import { STORY_COLORS, type StoryEvent } from '../core/storyEvents';

export interface StoryMark extends Pick<StoryEvent, 'id' | 'x' | 'y' | 'type' | 'title' | 'chapter' | 'status'> {
  selected?: boolean;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draw one event at a screen point; `scale` grows the mark for large exports. */
export function drawStoryMark(ctx: Ctx, mark: StoryMark, x: number, y: number, scale = 1): void {
  const r = 7.5 * scale;
  const color = STORY_COLORS[mark.type] ?? '#4a4a4a';
  ctx.save();
  if (mark.selected) {
    ctx.beginPath(); ctx.arc(x, y, r + 5 * scale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,214,140,0.95)'; ctx.lineWidth = 2 * scale; ctx.setLineDash([3 * scale, 2 * scale]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (mark.status === 'planned') {
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
    ctx.lineWidth = 2.5 * scale; ctx.strokeStyle = color; ctx.setLineDash([3 * scale, 2 * scale]); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1.5 * scale; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(9 * scale)}px "Source Sans 3", sans-serif`;
  ctx.fillStyle = mark.status === 'planned' ? color : '#fff';
  ctx.fillText(mark.chapter === undefined ? '•' : String(mark.chapter), x, y + 0.5 * scale);
  if (mark.title) {
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(11 * scale)}px "Source Sans 3", sans-serif`;
    ctx.lineWidth = 3 * scale; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,250,238,0.92)';
    ctx.strokeText(mark.title, x + r + 4 * scale, y);
    ctx.fillStyle = '#2a1d10';
    ctx.fillText(mark.title, x + r + 4 * scale, y);
  }
  ctx.restore();
}
