// ============================================
// Natural landmarks — one glyph for the 2D map and the 3D view
// ============================================
// A volcano, a cave, a waterfall, a gorge and a hot spring are drawn as small
// pictures centred on the origin, about ten units across. Both views scale and
// translate before calling, so the same mark reads the same at any distance.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const NATURAL_LANDMARKS = ['volcano', 'cave', 'waterfall', 'gorge', 'hotspring'] as const;
export type NaturalLandmark = typeof NATURAL_LANDMARKS[number];

export function isNaturalLandmark(type: string | undefined): type is NaturalLandmark {
  return !!type && (NATURAL_LANDMARKS as readonly string[]).includes(type);
}

/** Draw the glyph at (0, 0). Returns false for a type that has no glyph. */
export function drawLandmarkGlyph(ctx: Ctx, type: string): boolean {
  const x = 0, y = 0;
  ctx.lineWidth = 1.2;
  switch (type) {
    case 'volcano': {
      ctx.beginPath();
      ctx.moveTo(x, y - 5.5);
      ctx.lineTo(x + 5, y + 4);
      ctx.lineTo(x - 5, y + 4);
      ctx.closePath();
      ctx.fillStyle = '#8a3a30';
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,7,13,0.8)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 5, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#e4a853';
      ctx.fill();
      return true;
    }
    case 'cave': {
      ctx.beginPath();
      ctx.arc(x, y + 2, 5, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#2a2a3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,229,224,0.7)';
      ctx.stroke();
      return true;
    }
    case 'waterfall': {
      ctx.strokeStyle = '#7fc0dd';
      ctx.lineWidth = 1.6;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 2.4, y - 4);
        ctx.lineTo(x + k * 2.4, y + 3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x - 4.5, y + 4.5);
      ctx.quadraticCurveTo(x, y + 6.5, x + 4.5, y + 4.5);
      ctx.stroke();
      return true;
    }
    case 'gorge': {
      ctx.strokeStyle = '#a06a3c';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 3.5);
      ctx.lineTo(x - 1.5, y + 3.5);
      ctx.moveTo(x + 5, y - 3.5);
      ctx.lineTo(x + 1.5, y + 3.5);
      ctx.stroke();
      return true;
    }
    case 'hotspring': {
      ctx.beginPath();
      ctx.arc(x, y + 1.5, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#d585a8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,7,13,0.8)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,229,224,0.85)';
      ctx.lineWidth = 1.1;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 2.2, y - 1.5);
        ctx.quadraticCurveTo(x + k * 2.2 + 1, y - 3.5, x + k * 2.2, y - 5.5);
        ctx.stroke();
      }
      return true;
    }
  }
  return false;
}
