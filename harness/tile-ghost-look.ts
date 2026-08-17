// ============================================
// Sonda VISUAL — el fantasma y el snap a píxel, en una imagen
// ============================================
// Los números de `tile-ghost-fade.ts` dicen que el alfa va de 0 a 1 y que los
// bordes casan. No dicen qué VE el lector, y en este proyecto eso se mira:
// `city-look` enseñó en un cuadro lo que 61 varas verdes callaban.
//
//  1 · TRAS UNA PINCELADA. «Antes» y «ahora» no se simulan: `setGeneration`
//      SIN familia ES el comportamiento viejo y CON familia es el nuevo. La
//      misma rutina da los dos cuadros, así que la comparación no puede
//      inclinarse a favor del cambio. Ojo a lo que enseña el «antes»: vaciar
//      se lleva TAMBIÉN los antepasados, así que ni siquiera queda el cuarto
//      borroso de uno — queda el raster del mundo entero que `Map2D` blitea
//      debajo, ampliado unas treinta veces. Ese es el borrón de verdad.
//  2 · EL SNAP, BARRIDO Y SIN MAQUILLAR. La ganancia NO es uniforme y decirlo
//      es parte del trabajo: a 1:1 (la tesela ocupa sus 256 px) redondear
//      convierte un remuestreo bilineal en una copia y el gradiente sube ~20 %;
//      en las escalas intermedias el filtro de minificación manda y la
//      diferencia es ruido; por debajo de ~0,6 el gradiente BAJA, que en una
//      reducción fuerte no es perder detalle sino perder moaré. `levelFor`
//      deja la tesela entre 128 y 256 px, así que el caso bueno es el borde
//      de nivel — donde el mapa se queda cada vez que la rueda hace tope.
//
//   npm i --no-save @napi-rs/canvas   (sólo en un contenedor nuevo)

import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import {
  DisplayTileStore, FADE_MS, type TileBitmap,
} from '../src/engines/worldgen/cartography/tileStore';
import { TILE_PX, tileId, type TileKey } from '../src/engines/worldgen/cartography/tiles';

mkdirSync('harness/out', { recursive: true });

const mundo = { width: 256, height: 128 };
let reloj = 1_000;

/**
 * Una tesela de mentira, pero con la geometría de una de verdad: todo se dibuja
 * en COORDENADAS DE SUELO, así que un nivel más arriba tiene la mitad de
 * píxeles para el mismo terreno y sale legítimamente más basto. El primer
 * intento pintaba el mismo patrón en píxeles a cualquier nivel: el antepasado
 * salía idéntico al hijo y la sonda «demostraba» que el fantasma no aporta.
 */
function tesela(key: TileKey, tinta: 'vieja' | 'nueva'): TileBitmap {
  const c = createCanvas(TILE_PX, TILE_PX);
  const g = c.getContext('2d');
  const celdas = mundo.width / (1 << key.z);        // celdas de suelo por tesela
  const k = TILE_PX / celdas;                       // píxeles por celda
  const x0 = key.tx * celdas, y0 = key.ty * celdas;
  const aPx = (x: number) => (x - x0) * k;
  const aPy = (y: number) => (y - y0) * k;

  g.fillStyle = tinta === 'vieja' ? '#cfd8c8' : '#d8cec0';
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  // Parcelas de cuarto de celda: el detalle fino que un antepasado no tiene.
  g.strokeStyle = tinta === 'vieja' ? '#7d8b72' : '#8b7d62';
  g.lineWidth = 1;
  for (let x = Math.floor(x0 * 4) / 4; x <= x0 + celdas; x += 0.25) {
    g.beginPath(); g.moveTo(Math.round(aPx(x)) + 0.5, 0);
    g.lineTo(Math.round(aPx(x)) + 0.5, TILE_PX); g.stroke();
  }
  for (let y = Math.floor(y0 * 4) / 4; y <= y0 + celdas; y += 0.25) {
    g.beginPath(); g.moveTo(0, Math.round(aPy(y)) + 0.5);
    g.lineTo(TILE_PX, Math.round(aPy(y)) + 0.5); g.stroke();
  }
  // La misma costa del mundo, en coordenadas de suelo: casa entre niveles.
  g.strokeStyle = tinta === 'vieja' ? '#2f4a6a' : '#8a3a22';
  g.lineWidth = Math.max(1, k / 8);
  g.beginPath();
  for (let x = x0 - 1; x <= x0 + celdas + 1; x += 0.05) {
    const y = 5 + 2.4 * Math.sin(x / 2.2) + 0.6 * Math.sin(x * 1.7);
    if (x === x0 - 1) g.moveTo(aPx(x), aPy(y)); else g.lineTo(aPx(x), aPy(y));
  }
  g.stroke();
  g.fillStyle = '#1d2418';
  g.font = 'bold 20px sans-serif';
  g.fillText(`z${key.z}`, 8, 24);
  return c as unknown as TileBitmap;
}

const cola = new Map<string, (b: TileBitmap | null) => void>();
function almacen(familia?: string) {
  cola.clear();
  const st = new DisplayTileStore(
    (key: TileKey) => new Promise<TileBitmap | null>((res) => { cola.set(tileId(key), res); }),
    () => undefined, 512, () => reloj,
  );
  st.setGeneration('r0', familia);
  return st;
}
async function servir(tinta: 'vieja' | 'nueva') {
  for (const [id, res] of [...cola]) {
    const [z, tx, ty] = id.split('/').map(Number);
    res(tesela({ z, tx, ty }, tinta));
  }
  cola.clear();
  await new Promise((r) => setTimeout(r, 0));
}

// ── Panel 1 · qué se ve justo después de una pincelada ─────────────────────
const ANCHO = 380, ALTO = 240;
const Z = 5;
const CELDAS = mundo.width / (1 << Z);                  // 8
const PPC = TILE_PX / CELDAS;                           // 1:1 — 32 px por celda
const vista = { x: 3.37, y: 0.71, w: ANCHO / PPC, h: ALTO / PPC };
const pantalla = { x: 0, y: 0, w: ANCHO, h: ALTO };

/**
 * EL RASTER DEL MUNDO, que es lo que hay DEBAJO de las teselas en `Map2D`.
 * Sin él, «antes» salía en negro y la comparación no era con la realidad sino
 * con la nada: en el motor, cuando el almacén se vacía el lector no ve papel,
 * ve el raster del mundo entero ampliado ~30 veces. Eso es el borrón.
 */
const raster = createCanvas(mundo.width, mundo.height);
{
  const g = raster.getContext('2d');
  g.fillStyle = '#cfd8c8'; g.fillRect(0, 0, mundo.width, mundo.height);
  g.strokeStyle = '#2f4a6a'; g.lineWidth = 0.6;
  g.beginPath();
  for (let x = 0; x <= mundo.width; x += 0.25) {
    const y = 5 + 2.4 * Math.sin(x / 2.2) + 0.6 * Math.sin(x * 1.7);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}
function fondo(g: CanvasRenderingContext2D, v: { x: number; y: number; w: number; h: number }) {
  (g as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = true;
  g.drawImage(raster as unknown as CanvasImageSource,
    v.x, v.y, v.w, v.h, 0, 0, ANCHO, ALTO);
}

const cuadros: { titulo: string; canvas: ReturnType<typeof createCanvas> }[] = [];
async function trasPincelada(titulo: string, familia: string | undefined, avance: number) {
  const st = almacen(familia);
  // El nivel y sus dos antepasados residentes: sin antepasado, el «antes»
  // saldría en blanco y estaríamos comparando contra nada.
  st.wantPlan(mundo, [{ z: Z - 2, view: vista }, { z: Z - 1, view: vista }, { z: Z, view: vista }]);
  await servir('vieja');
  const c = createCanvas(ANCHO, ALTO);
  const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  fondo(g, vista);
  st.draw(g, mundo, Z, vista, pantalla);
  st.setGeneration('r1', familia);                       // LA PINCELADA
  if (avance > 0) {
    st.wantPlan(mundo, [{ z: Z, view: vista }]);
    const nacimiento = reloj;
    await servir('nueva');
    reloj = nacimiento + FADE_MS * avance;
  }
  // CADA CUADRO SE REPINTA DESDE EL FONDO, como en el motor. El primer intento
  // dibujaba encima del cuadro anterior: «antes» y «ahora» salían idénticos
  // porque lo que se veía era la pintura vieja del lienzo, no lo que el almacén
  // servía. Una sonda visual que no limpia su lienzo no mide nada.
  fondo(g, vista);
  st.draw(g, mundo, Z, vista, pantalla);
  st.dispose();
  cuadros.push({ titulo, canvas: c });
}
await trasPincelada('ANTES · el almacén se vacía: queda el raster del mundo ×30', undefined, 0);
await trasPincelada('AHORA · la tinta anterior mientras llega la nueva', 'mismoMundo', 0);
await trasPincelada('AHORA · a mitad del fundido (125 ms)', 'mismoMundo', 0.5);
await trasPincelada('AHORA · fundido terminado (250 ms)', 'mismoMundo', 1);

// ── Panel 2 · el snap, barrido de escalas + recorte a 1:1 ──────────────────
function gradiente(c: ReturnType<typeof createCanvas>, w: number, h: number): number {
  const d = c.getContext('2d').getImageData(20, 20, w - 40, h - 40).data;
  const ww = w - 40; let s = 0, n = 0;
  for (let y = 0; y < h - 40; y++) {
    for (let x = 1; x < ww; x++) { const i = (y * ww + x) * 4; s += Math.abs(d[i] - d[i - 4]); n++; }
  }
  return s / n;
}
async function aEscala(escala: number) {
  const ppc = (TILE_PX * escala) / CELDAS;
  const v = { x: 3.37, y: 0.71, w: ANCHO / ppc, h: ALTO / ppc };
  const st = almacen('mismoMundo');
  st.want(mundo, Z, v);
  await servir('vieja');
  const pinta = (quieta: boolean) => {
    const c = createCanvas(ANCHO, ALTO);
    const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    st.draw(g, mundo, Z, v, pantalla);
    if (quieta) { fondo(g, v); st.draw(g, mundo, Z, v, pantalla); }
    return c;
  };
  const mov = pinta(false), rep = pinta(true);
  st.dispose();
  return { escala, mov, rep, gMov: gradiente(mov, ANCHO, ALTO), gRep: gradiente(rep, ANCHO, ALTO) };
}
const barrido = [];
for (const e of [1.0, 0.98, 0.9, 0.75, 0.6, 0.5]) barrido.push(await aEscala(e));
const unoAuno = barrido[0];

// ── La lámina ──────────────────────────────────────────────────────────────
const PAD = 16, TIT = 24, LUPA = 6;
const REC = { x: 120, y: 70, w: 56, h: 38 };
const W = PAD + (ANCHO + PAD) * 4;
const H = PAD + TIT + ALTO + PAD * 2 + TIT + Math.max(REC.h * LUPA + TIT, 150) + PAD;
const lam = createCanvas(W, H);
const L = lam.getContext('2d');
L.fillStyle = '#191919'; L.fillRect(0, 0, W, H);
L.font = 'bold 13px sans-serif';
cuadros.forEach((q, i) => {
  const x = PAD + (ANCHO + PAD) * i;
  L.fillStyle = i === 0 ? '#e08b6a' : '#9fc98a';
  L.fillText(q.titulo, x, PAD + 15);
  L.drawImage(q.canvas, x, PAD + TIT);
});

const y2 = PAD + TIT + ALTO + PAD * 2;
L.fillStyle = '#dcdcdc';
L.fillText('EL SNAP A PÍXEL · recorte ×6 a 1:1 (la tesela ocupa sus 256 px)', PAD, y2);
[['en movimiento · destino fraccionario', unoAuno.mov, '#e08b6a'],
  ['en reposo · píxel entero', unoAuno.rep, '#9fc98a']].forEach(([t, c, col], i) => {
  const x = PAD + (REC.w * LUPA + PAD) * i;
  L.fillStyle = col as string;
  L.fillText(t as string, x, y2 + TIT - 4);
  L.imageSmoothingEnabled = false;
  L.drawImage(c as ReturnType<typeof createCanvas>, REC.x, REC.y, REC.w, REC.h,
    x, y2 + TIT, REC.w * LUPA, REC.h * LUPA);
});

const xT = PAD + (REC.w * LUPA + PAD) * 2 + PAD;
L.fillStyle = '#dcdcdc';
L.fillText('LA GANANCIA NO ES UNIFORME — gradiente medio del cuadro', xT, y2 + TIT - 4);
L.font = '13px monospace';
L.fillText('escala   movimiento   reposo    delta', xT, y2 + TIT + 20);
barrido.forEach((b, i) => {
  const d = (b.gRep / b.gMov - 1) * 100;
  L.fillStyle = d > 5 ? '#9fc98a' : d < -5 ? '#8ab4d8' : '#9a9a9a';
  L.fillText(`${b.escala.toFixed(2)}      ${b.gMov.toFixed(2)}       ${b.gRep.toFixed(2)}    `
    + `${d >= 0 ? '+' : ''}${d.toFixed(1)} %`, xT, y2 + TIT + 40 + i * 18);
});
L.fillStyle = '#9a9a9a'; L.font = '12px sans-serif';
L.fillText('verde: más nítido · azul: menos gradiente = menos moaré en reducción fuerte',
  xT, y2 + TIT + 40 + barrido.length * 18 + 16);
L.fillText('gris: el filtro de minificación manda y redondear no cambia nada',
  xT, y2 + TIT + 40 + barrido.length * 18 + 32);

writeFileSync('harness/out/tile-ghost-look.png', lam.toBuffer('image/png'));
console.log('harness/out/tile-ghost-look.png');
for (const b of barrido) {
  console.log(`escala ${b.escala.toFixed(2)} · movimiento ${b.gMov.toFixed(2)} · reposo `
    + `${b.gRep.toFixed(2)} · ${((b.gRep / b.gMov - 1) * 100).toFixed(1)} %`);
}
