// ============================================
// Banco — el fantasma, el fundido y el snap a píxel (§19.2, remates 1 y 4)
// ============================================
// Dos remates del 2D que sólo se ven en movimiento, así que hay que medirlos
// aquí o no se miden: que una pincelada YA NO deje al lector mirando el cuarto
// borroso de un antepasado (la generación anterior se queda debajo y la nueva
// se funde encima en 250 ms) y que con la cámara quieta el destino vaya a
// píxel entero, sin costuras y sin el medio píxel de solape que emborronaba.
//
// El almacén recibe un RELOJ FALSO: el fundido es una función del tiempo, y sin
// poder mover el tiempo a mano el banco tendría que dormir un cuarto de segundo
// por vara y mediría con la precisión del planificador del sistema operativo.
//
// Y la vara que importa de verdad es la que distingue el camino bueno del
// RESPALDO: que otro planeta NO deje fantasma. Un fantasma de más no falla por
// ningún lado — enseña el mar de otro mundo bajo el continente nuevo y nadie
// tira una excepción.

import {
  DisplayTileStore, FADE_MS, type TileBitmap,
} from '../src/engines/worldgen/cartography/tileStore';
import { tileId, type TileKey } from '../src/engines/worldgen/cartography/tiles';

let fallos = 0;
const vara = (nombre: string, ok: boolean, detalle: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${nombre} — ${detalle}`);
  if (!ok) fallos++;
};

// ── El reloj, los mapas de bits y el lienzo, todos de mentira ──────────────
let reloj = 100_000;
const ahora = () => reloj;

interface Falsa { nombre: string; cerrada: boolean; close(): void }
const nacidas: Falsa[] = [];
function bitmap(nombre: string): TileBitmap {
  const b: Falsa = { nombre, cerrada: false, close() { this.cerrada = true; } };
  nacidas.push(b);
  return b as unknown as TileBitmap;
}
const cerradas = () => nacidas.filter((b) => b.cerrada).length;

interface Trazo { nombre: string; alfa: number; dx: number; dy: number; dw: number; dh: number }
let trazos: Trazo[] = [];
const lienzo = {
  globalAlpha: 1,
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'low',
  drawImage(
    img: unknown, a: number, b: number, c: number, d: number,
    e?: number, f?: number, g?: number, h?: number,
  ) {
    const nombre = (img as Falsa).nombre;
    const r = e === undefined
      ? { dx: a, dy: b, dw: c, dh: d }
      : { dx: e, dy: f as number, dw: g as number, dh: h as number };
    trazos.push({ nombre, alfa: lienzo.globalAlpha, ...r });
  },
};
const ctx = lienzo as unknown as CanvasRenderingContext2D;
const pintar = (): Trazo[] => { const t = trazos; trazos = []; return t; };

// ── El taller: un almacén con su cola de peticiones a mano ─────────────────
const mundo = { width: 256, height: 128 };
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Taller {
  almacen: DisplayTileStore;
  cola: Map<string, (b: TileBitmap | null) => void>;
  llegadas: () => number;
}
function taller(capacidad = 320): Taller {
  const cola = new Map<string, (b: TileBitmap | null) => void>();
  let llegadas = 0;
  const almacen = new DisplayTileStore(
    (key: TileKey) => new Promise<TileBitmap | null>((res) => { cola.set(tileId(key), res); }),
    () => { llegadas++; },
    capacidad,
    ahora,
  );
  return { almacen, cola, llegadas: () => llegadas };
}
/** Resolver todo lo pedido con una tinta con nombre. */
async function servir(t: Taller, tinta: string): Promise<number> {
  const ids = [...t.cola.keys()];
  for (const id of ids) { t.cola.get(id)?.(bitmap(`${tinta}:${id}`)); t.cola.delete(id); }
  await tick();
  return ids.length;
}

// ══════════════════════════════════════════════════════════════════════════
// 1 · UNA PINCELADA YA NO DEJA HUECO: la generación anterior se queda debajo
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 3;
  const vista = { x: 3.3, y: 0, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 101, h: 50 };
  const t = taller();
  t.almacen.setGeneration('mundo:r0', 'mundo');
  t.almacen.want(mundo, z, vista);
  const n = await servir(t, 'vieja');
  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const antes = pintar();
  vara('la generación viva se dibuja entera',
    antes.length === n && antes.every((x) => x.nombre.startsWith('vieja:')),
    `${antes.length} de ${n} teselas`);

  // La pincelada: mismo suelo, otra tinta.
  t.almacen.setGeneration('mundo:r1', 'mundo');
  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const conFantasma = pintar();
  vara('tras la pincelada el suelo sigue tapado por la tinta anterior',
    conFantasma.length === n && conFantasma.every((x) => x.nombre.startsWith('vieja:')),
    `${conFantasma.length} trazos, todos de la generación anterior`);
  vara('el fantasma no se cierra mientras se está viendo',
    cerradas() === 0, `${cerradas()} de ${nacidas.length} mapas de bits cerrados`);

  // Y el aviso sigue diciendo la verdad: el fantasma NO es tinta exacta.
  const cuenta = t.almacen.draw(ctx, mundo, z, vista, pantalla);
  pintar();
  vara('el fantasma no cuenta como tesela exacta',
    cuenta.exact === 0 && cuenta.needed === n,
    `exactas ${cuenta.exact} de ${cuenta.needed}`);
  t.almacen.dispose();
}

// ══════════════════════════════════════════════════════════════════════════
// 2 · OTRO PLANETA NO DEJA FANTASMA — la vara que distingue el respaldo
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 3;
  const vista = { x: 3.3, y: 0, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 101, h: 50 };
  const t = taller();
  t.almacen.setGeneration('a:r0', 'planetaA');
  t.almacen.want(mundo, z, vista);
  await servir(t, 'planetaA');
  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  pintar();
  const antesDeCerrar = cerradas();
  t.almacen.setGeneration('b:r0', 'planetaB');
  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const tras = pintar();
  vara('otro planeta no deja fantasma',
    tras.length === 0, `${tras.length} trazos (debían ser 0)`);
  vara('y sus mapas de bits se cierran en el acto',
    cerradas() > antesDeCerrar, `${cerradas() - antesDeCerrar} cerrados al cambiar de mundo`);

  // Y el que NO pasa familia se comporta como antes de que esto existiera.
  const v = taller();
  v.almacen.setGeneration('sinFamilia:1');
  v.almacen.want(mundo, z, vista);
  await servir(v, 'sola');
  v.almacen.setGeneration('sinFamilia:2');
  v.almacen.draw(ctx, mundo, z, vista, pantalla);
  const sin = pintar();
  vara('sin familia, el comportamiento es el de siempre (vaciar)',
    sin.length === 0, `${sin.length} trazos (debían ser 0)`);
  t.almacen.dispose(); v.almacen.dispose();
}

// ══════════════════════════════════════════════════════════════════════════
// 3 · EL FUNDIDO: de 0 a 1 en 250 ms, y el fantasma DEBAJO mientras dura
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 3;
  const vista = { x: 3.3, y: 0, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 101, h: 50 };
  const t = taller();
  t.almacen.setGeneration('m:r0', 'm');
  t.almacen.want(mundo, z, vista);
  const n = await servir(t, 'vieja');
  t.almacen.draw(ctx, mundo, z, vista, pantalla); pintar();

  t.almacen.setGeneration('m:r1', 'm');
  t.almacen.want(mundo, z, vista);
  const nacimiento = reloj;
  await servir(t, 'nueva');

  const alfaDe = (ms: number) => {
    reloj = nacimiento + ms;
    t.almacen.draw(ctx, mundo, z, vista, pantalla);
    const tr = pintar();
    const nuevas = tr.filter((x) => x.nombre.startsWith('nueva:'));
    const viejas = tr.filter((x) => x.nombre.startsWith('vieja:'));
    return { alfa: nuevas[0]?.alfa ?? -1, nuevas: nuevas.length, viejas: viejas.length };
  };

  const a0 = alfaDe(0);
  vara('al nacer, la tesela nueva entra transparente sobre su fantasma',
    a0.alfa === 0 && a0.nuevas === n && a0.viejas === n,
    `alfa ${a0.alfa} · ${a0.nuevas} nuevas sobre ${a0.viejas} fantasmas`);
  const aMitad = alfaDe(FADE_MS / 2);
  vara('a mitad de camino el alfa va por la mitad',
    Math.abs(aMitad.alfa - 0.5) < 1e-9 && aMitad.viejas === n,
    `alfa ${aMitad.alfa} con ${aMitad.viejas} fantasmas debajo`);
  const aFinal = alfaDe(FADE_MS);
  vara('a los 250 ms la tesela nueva es opaca y el fantasma ya no se pinta',
    aFinal.alfa === 1 && aFinal.viejas === 0 && aFinal.nuevas === n,
    `alfa ${aFinal.alfa} · fantasmas dibujados ${aFinal.viejas}`);
  vara('el lienzo se devuelve con el alfa que traía',
    lienzo.globalAlpha === 1, `globalAlpha ${lienzo.globalAlpha}`);
  vara('y los fantasmas se sueltan y se cierran cuando ya no tapan nada',
    nacidas.filter((b) => b.nombre.startsWith('vieja:') && !b.cerrada).length === 0,
    `${nacidas.filter((b) => b.nombre.startsWith('vieja:') && b.cerrada).length} cerrados`);
  t.almacen.dispose();
}

// ══════════════════════════════════════════════════════════════════════════
// 4 · EL PRESUPUESTO DEL FANTASMA — 96, y lo que sobra se cierra en el acto
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 6;                          // 4 celdas por tesela: 128 en la vista
  const vista = { x: 0, y: 0, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 800, h: 400 };
  const t = taller(512);
  t.almacen.setGeneration('g:r0', 'g');
  t.almacen.want(mundo, z, vista);
  const n = await servir(t, 'muchas');
  t.almacen.draw(ctx, mundo, z, vista, pantalla); pintar();
  const cerradasAntes = cerradas();
  t.almacen.setGeneration('g:r1', 'g');
  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const tr = pintar();
  vara('el fantasma no se queda con toda la generación',
    n > 96 && tr.length === 96,
    `${tr.length} fantasmas de ${n} teselas (tope 96)`);
  vara('y lo que no cabe se cierra ahí mismo, sin fuga',
    cerradas() - cerradasAntes === n - 96,
    `${cerradas() - cerradasAntes} cerrados de ${n - 96} sobrantes`);
  t.almacen.dispose();
}

// ══════════════════════════════════════════════════════════════════════════
// 5 · EL SNAP A PÍXEL: el primer cuadro no, del segundo en adelante sí
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 3;
  const vista = { x: 3.3, y: 0.7, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 101, h: 50 };
  const t = taller();
  t.almacen.setGeneration('s:r0', 's');
  t.almacen.want(mundo, z, vista);
  await servir(t, 'tinta');

  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const enMovimiento = pintar();
  const entero = (v: number) => Number.isInteger(v);
  vara('el primer cuadro de una posición nueva NO se redondea',
    enMovimiento.some((x) => !entero(x.dx)) && enMovimiento.every((x) => x.dw > 50.9),
    `dx ${enMovimiento.map((x) => x.dx.toFixed(2)).join(' ')} · anchos con el medio píxel de solape`);

  t.almacen.draw(ctx, mundo, z, vista, pantalla);
  const enReposo = pintar();
  vara('el segundo cuadro idéntico va a píxel entero',
    enReposo.length > 0 && enReposo.every((x) => entero(x.dx) && entero(x.dy) && entero(x.dw) && entero(x.dh)),
    `dx ${enReposo.map((x) => x.dx).join(' ')} · dw ${enReposo.map((x) => x.dw).join(' ')}`);

  // Sin costura Y sin solape: el borde derecho de una es el izquierdo de la
  // siguiente, exactamente. Es lo que el `+ 0.5` venía tapando.
  // (La vista cruza dos filas de teselas: se comprueba fila a fila y columna a
  // columna, no sobre la lista revuelta — el primer intento mezcló las dos
  // filas y la vara salió roja midiendo humo.)
  const fila = enReposo.filter((x) => x.dy === Math.min(...enReposo.map((y) => y.dy)))
    .sort((a, b) => a.dx - b.dx);
  const columna = enReposo.filter((x) => x.dx === fila[0].dx).sort((a, b) => a.dy - b.dy);
  const pegados = (l: Trazo[], eje: 'x' | 'y') => l.every((x, i) => i === 0
    || (eje === 'x' ? l[i - 1].dx + l[i - 1].dw === x.dx : l[i - 1].dy + l[i - 1].dh === x.dy));
  vara('los bordes casan exactamente, sin costura ni solape',
    fila.length > 1 && columna.length > 1 && pegados(fila, 'x') && pegados(columna, 'y'),
    `${fila.map((x) => `[${x.dx},${x.dx + x.dw})`).join(' ')} · filas `
      + `${columna.map((x) => `[${x.dy},${x.dy + x.dh})`).join(' ')}`);

  // Y en cuanto la vista se mueve, se deja de redondear.
  const movida = { ...vista, x: vista.x + 0.01 };
  t.almacen.draw(ctx, mundo, z, movida, pantalla);
  const otraVez = pintar();
  vara('mover la vista un pelo vuelve a soltar el redondeo',
    otraVez.some((x) => !entero(x.dx)),
    `dx ${otraVez.map((x) => x.dx.toFixed(3)).join(' ')}`);
  t.almacen.dispose();
}

// ══════════════════════════════════════════════════════════════════════════
// 6 · DISPOSE no deja ni un mapa de bits ni un temporizador vivos
// ══════════════════════════════════════════════════════════════════════════
{
  const z = 3;
  const vista = { x: 3.3, y: 0, w: 64, h: 32 };
  const pantalla = { x: 0, y: 0, w: 101, h: 50 };
  const t = taller();
  t.almacen.setGeneration('d:r0', 'd');
  t.almacen.want(mundo, z, vista);
  await servir(t, 'porCerrar');
  t.almacen.draw(ctx, mundo, z, vista, pantalla); pintar();
  t.almacen.setGeneration('d:r1', 'd');     // deja fantasmas vivos
  t.almacen.want(mundo, z, vista);
  await servir(t, 'porCerrar2');
  reloj += 1;
  t.almacen.draw(ctx, mundo, z, vista, pantalla); pintar();   // fundido en marcha
  const llegadasAntes = t.llegadas();
  t.almacen.dispose();
  vara('dispose cierra vivos Y fantasmas',
    nacidas.filter((b) => b.nombre.startsWith('porCerrar') && !b.cerrada).length === 0,
    `${nacidas.filter((b) => b.nombre.startsWith('porCerrar')).length} mapas de bits, todos cerrados`);
  await new Promise((r) => setTimeout(r, 60));
  vara('y el temporizador del fundido no repinta un componente desmontado',
    t.llegadas() === llegadasAntes,
    `llegadas ${t.llegadas()} (eran ${llegadasAntes})`);
}

console.log(fallos ? `\n${fallos} varas ROJAS` : `\nTODO VERDE (${nacidas.length} mapas de bits, ${cerradas()} cerrados)`);
process.exit(fallos ? 1 : 0);
