// Calibrating the instanced symbol layer against the canvas2D symbols.
//
// The layer has been sitting switched off with the note "size and mip
// calibration is not right (peaks come out too heavy)". "Too heavy" was an
// impression from a picture, and an impression from a picture is exactly what
// sent the avenue widths through two wrong fixes. So this measures instead:
// each symbol is drawn both ways at the same nominal height and compared on the
// three numbers that decide whether they are interchangeable —
//
//   INK      how much of the box is covered. A heavier symbol covers more.
//   BOX      the drawn extent, in units of the requested height.
//   ANCHOR   where the baseline sits relative to the ink.
//
// If those three match, the atlas is a drop-in and the layer can be turned on.
// If they do not, the numbers say by how much and in which direction.
import { createCanvas } from '@napi-rs/canvas';
import { createRng } from '../src/engines/worldgen/core/rng';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import {
  drawBroadleaf, drawCactus, drawConifer, drawDune, drawMarsh, drawMountain, drawPalm,
  type Ctx,
} from '../src/engines/worldgen/cartography/symbols';
import { drawAtlasCell, inkRect } from '../src/engines/worldgen/cartography/glsymbols';

const theme = themeById('wonder');
const KINDS = ['mountain', 'hill', 'conifer', 'broadleaf', 'palm', 'cactus', 'dune', 'marsh'] as const;
type Kind = (typeof KINDS)[number];

interface Metrics { ink: number; w: number; h: number; anchorY: number; }

/** Draw one symbol into a big transparent box and measure what it left. */
function measure(kind: Kind, variant: number, size: number, atlasStyle: boolean): Metrics {
  const BOX = 512;
  const canvas = createCanvas(BOX, BOX);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  const baselineY = BOX * 0.82;
  ctx.save();
  ctx.translate(BOX / 2, baselineY);
  const rng = createRng('calib', `${kind}:${variant}`);

  if (atlasStyle) {
    // The REAL atlas cell, then the REAL instance rect. Nothing re-implemented:
    // that is what made the first pass produce a correction table for a function
    // that did not exist.
    const CELL = 128;
    const cellCanvas = createCanvas(CELL, CELL);
    const cctx = cellCanvas.getContext('2d') as unknown as Ctx;
    cctx.save();
    cctx.translate(CELL / 2, CELL * 0.92);
    drawAtlasCell(cctx, kind, createRng('calib', `atlas:${kind}:${variant}`), theme,
      CELL, CELL * 0.78, 0);
    cctx.restore();

    const rect = inkRect({ x: 0, y: 0, w: 0, h: size, kind, variant: 0, snow: 0, alpha: 1 });
    ctx.drawImage(cellCanvas as unknown as CanvasImageSource,
      -rect.w / 2, -rect.h * 0.92, rect.w, rect.h);
  } else if (kind === 'mountain' || kind === 'hill') {
    const isHill = kind === 'hill';
    const ratio = isHill ? 1.7 + rng() * 0.8 : 2.3 + rng() * 2.2;
    drawMountain(ctx, createRng('calib', `${kind}:${variant}`), theme,
      { w: size * ratio * 0.55, h: size, snow: 0, fill: theme.land.base }, isHill);
  } else {
    drawKind(kind, ctx, createRng('calib', `${kind}:${variant}`), size);
  }
  ctx.restore();

  const d = canvas.getContext('2d').getImageData(0, 0, BOX, BOX).data;
  let ink = 0, x0 = BOX, x1 = -1, y0 = BOX, y1 = -1;
  for (let y = 0; y < BOX; y++) {
    for (let x = 0; x < BOX; x++) {
      if (d[(y * BOX + x) * 4 + 3] < 24) continue;
      ink++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { ink: 0, w: 0, h: 0, anchorY: 0 };
  return {
    ink: ink / (size * size),
    w: (x1 - x0 + 1) / size,
    h: (y1 - y0 + 1) / size,
    anchorY: (baselineY - y1) / size,
  };
}

function drawKind(kind: Kind, ctx: Ctx, rng: () => number, h: number): void {
  switch (kind) {
    case 'conifer': drawConifer(ctx, rng, theme, h); break;
    case 'broadleaf': drawBroadleaf(ctx, rng, theme, h); break;
    case 'palm': drawPalm(ctx, rng, theme, h); break;
    case 'cactus': drawCactus(ctx, rng, theme, h); break;
    case 'dune': drawDune(ctx, rng, theme, h); break;
    case 'marsh': drawMarsh(ctx, rng, theme, h); break;
    default: break;
  }
}

const SIZE = 96;
console.log(`comparando el símbolo del atlas con el de canvas2D a ${SIZE} px de alto\n`);
console.log(`${'símbolo'.padEnd(11)} ${'tinta'.padStart(14)} ${'ancho'.padStart(13)} ${'alto'.padStart(13)}  veredicto`);

const rows: { kind: Kind; inkRatio: number; wRatio: number; hRatio: number }[] = [];
for (const kind of KINDS) {
  let a = { ink: 0, w: 0, h: 0, anchorY: 0 };
  let b = { ink: 0, w: 0, h: 0, anchorY: 0 };
  const N = 6;
  for (let v = 0; v < N; v++) {
    const m1 = measure(kind, v, SIZE, false);
    const m2 = measure(kind, v, SIZE, true);
    a.ink += m1.ink / N; a.w += m1.w / N; a.h += m1.h / N; a.anchorY += m1.anchorY / N;
    b.ink += m2.ink / N; b.w += m2.w / N; b.h += m2.h / N; b.anchorY += m2.anchorY / N;
  }
  const inkRatio = a.ink > 0 ? b.ink / a.ink : 0;
  const wRatio = a.w > 0 ? b.w / a.w : 0;
  const hRatio = a.h > 0 ? b.h / a.h : 0;
  rows.push({ kind, inkRatio, wRatio, hRatio });
  const worst = Math.max(Math.abs(inkRatio - 1), Math.abs(wRatio - 1), Math.abs(hRatio - 1));
  console.log(
    `${kind.padEnd(11)} `
    + `${a.ink.toFixed(2)}→${b.ink.toFixed(2)} ×${inkRatio.toFixed(2)}`.padStart(15)
    + `${a.w.toFixed(2)}→${b.w.toFixed(2)} ×${wRatio.toFixed(2)}`.padStart(14)
    + `${a.h.toFixed(2)}→${b.h.toFixed(2)} ×${hRatio.toFixed(2)}`.padStart(14)
    + `  ${worst < 0.08 ? 'igual' : worst < 0.2 ? 'cerca' : 'DISTINTO'}`,
  );
}

const bad = rows.filter((r) => Math.max(
  Math.abs(r.inkRatio - 1), Math.abs(r.wRatio - 1), Math.abs(r.hRatio - 1)) >= 0.2);
console.log(`\n${bad.length === 0
  ? 'Todos los símbolos coinciden: el atlas es intercambiable con el trazado directo.'
  : `${bad.length} de ${rows.length} no coinciden: ${bad.map((r) => r.kind).join(', ')}.`}`);
// La duna son dos trazos de un píxel sobre un 3 % de su caja: que la tinta salga
// un 22 % mayor es un píxel de más al remuestrear, no un error de escala — la
// caja coincide al 2 %. Se deja anotado en vez de perseguirlo.
console.log('Corrección sugerida por símbolo (multiplicar el alto pedido por):');
for (const r of rows) {
  const k = r.hRatio > 0 ? 1 / r.hRatio : 1;
  console.log(`  ${r.kind.padEnd(11)} ×${k.toFixed(3)}`);
}
