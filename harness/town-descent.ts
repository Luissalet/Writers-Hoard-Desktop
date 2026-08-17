// ==========================================================================
// Banco: BAJAR A UN PUEBLO — ¿aterriza la cámara donde está el pueblo?
// ==========================================================================
// Luis, 2026-08-16: «cuando pulso la ciudad, se centra en un sitio diferente».
// La captura enseñaba la diana SIEMPRE al noroeste del punto de la ciudad, y
// eso no es un desajuste cualquiera: el noroeste es exactamente donde cae la
// ESQUINA de una celda respecto a su CENTRO.
//
//   npx tsx harness/town-descent.ts
//
// El gesto volaba a `s.x, s.y` a secas mientras todo lo que DIBUJA el pueblo
// —el punto del mapa, su blanco de pinchado, la tesela que decide si lo pinta,
// el plano de la ciudad— usa `settlementCellCenter`, que es la celda +0,5.
// Media celda no se ve a vista de continente, y por eso el fallo sobrevivió a
// todos los bancos verdes: el vuelo pide entre 0,5 y 2 km de vano, y ahí media
// celda son VARIAS PANTALLAS.
//
// La vara no es «se parece»: es que el punto al que vuela la cámara y el punto
// donde el mapa dibuja el pueblo sean EL MISMO NÚMERO, para las ciudades de un
// mundo de verdad y no para un caso de laboratorio.

import { getWorld } from './world-cache';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import {
  townFrame, alreadyAtTown, planRadiusMetres, planSizeFor,
} from '../src/engines/worldgen/region/townPlan';
import { settlementCellCenter } from '../src/engines/worldgen/core/settlements';
import { EARTH_KM, MIN_SPAN_KM, clampSpanKm } from '../src/engines/worldgen/core/camera';

let fallos = 0;
const vara = (nombre: string, ok: boolean, detalle: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${nombre} — ${detalle}`);
  if (!ok) fallos++;
};

const world = getWorld();
const geo = await getGeography(world, 'full');
const kmPorCelda = EARTH_KM / world.width;
const PANTALLA_PX = 1400;

console.log(`mundo ${world.width}x${world.height} · ${geo.settlements.length} poblaciones · `
  + `una celda son ${kmPorCelda.toFixed(1)} km\n`);

/** LA CUENTA VIEJA, textualmente: la esquina de la celda. */
const viejo = (s: { x: number; y: number }) => ({ u: s.x / world.width, v: s.y / world.height });

// ── 1 · El vuelo aterriza EXACTAMENTE donde se dibuja el pueblo ────────────
{
  let peor = 0, peorNombre = '';
  for (const s of geo.settlements) {
    const f = townFrame(s, world);
    const c = settlementCellCenter(s);
    // El mismo número, no «parecido»: los dos salen de `settlementCellCenter`.
    const d = Math.max(Math.abs(f.u * world.width - c.x), Math.abs(f.v * world.height - c.y));
    if (d > peor) { peor = d; peorNombre = s.name; }
  }
  vara('el vuelo apunta al mismo punto que el mapa dibuja',
    peor === 0, `desfase máximo ${peor} celdas en ${geo.settlements.length} poblaciones`
      + (peor ? ` (peor: ${peorNombre})` : ''));
}
{
  let peor = 0;
  for (const s of geo.settlements) {
    const f = townFrame(s, world);
    const c = settlementCellCenter(s);
    peor = Math.max(peor, Math.abs(f.mark.x - c.x), Math.abs(f.mark.y - c.y));
  }
  vara('y la diana cae sobre el punto, no al lado',
    peor === 0, `desfase máximo ${peor} celdas`);
}

// ── 2 · El banco reproduce el fallo que Luis fotografió ────────────────────
{
  const s = geo.settlements.find((x) => x.rank === 'capital') ?? geo.settlements[0];
  const f = townFrame(s, world);
  const v = viejo(s);
  const errKm = Math.hypot((f.u - v.u) * EARTH_KM, (f.v - v.v) * EARTH_KM * (world.height / world.width));
  const vano = clampSpanKm(f.spanKm);
  const pantallas = errKm / vano;
  vara('con la cuenta vieja el pueblo se salía de la pantalla al llegar',
    pantallas > 1,
    `${s.name}: ${errKm.toFixed(1)} km de error con un vano de ${vano.toFixed(2)} km `
      + `= ${pantallas.toFixed(1)} pantallas (${(errKm * 1000 / (vano * 1000 / PANTALLA_PX)).toFixed(0)} px)`);
  // Y LA FIRMA: el error apuntaba siempre al NOROESTE, que es lo que se ve en
  // la captura. Si algún día esto deja de ser verdad, el fallo era otro.
  vara('y el error apuntaba al NOROESTE, la firma de la captura',
    v.u < f.u && v.v < f.v,
    `la esquina cae ${((f.u - v.u) * EARTH_KM).toFixed(1)} km al oeste y `
      + `${((f.v - v.v) * EARTH_KM * (world.height / world.width)).toFixed(1)} km al norte del centro`);
}

// ── 3 · «Ya estás ahí» tiene que poder ser cierto ──────────────────────────
{
  let nunca = 0;
  for (const s of geo.settlements) {
    const f = townFrame(s, world);
    if (!alreadyAtTown(f, { u: f.u, v: f.v, spanKm: f.spanKm }, world)) nunca++;
  }
  vara('llegar al pueblo cuenta como estar en él (o el segundo clic no llega nunca)',
    nunca === 0, `${geo.settlements.length - nunca} de ${geo.settlements.length}`);
  // Con la cuenta vieja, un pueblo cuyo radio no llega a media celda JAMÁS
  // contaba como «ya estás ahí»: es el mismo fallo, en su otra cara.
  let rotos = 0;
  for (const s of geo.settlements) {
    const f = townFrame(s, world);
    const v = viejo(s);
    if (!alreadyAtTown(f, { u: v.u, v: v.v, spanKm: f.spanKm }, world)) rotos++;
  }
  vara('el banco reproduce también la otra cara del fallo',
    rotos > geo.settlements.length * 0.5,
    `${rotos} de ${geo.settlements.length} pueblos nunca contaban como alcanzados`);
}

// ── 4 · Y el pueblo de al lado NO cuenta como éste ─────────────────────────
//
// Contra el vecino MÁS CERCANO de cada uno, no contra «los que estén a menos de
// cuatro radios»: con radios de menos de un kilómetro y pueblos a veinte, ese
// filtro dejaba la vara en CERO PARES — verde sin haber comprobado nada, que es
// la peor clase de verde que hay.
{
  let confusos = 0, minKm = Infinity;
  for (const s of geo.settlements) {
    const f = townFrame(s, world);
    let vecino = null as null | { u: number; v: number }, mejor = Infinity;
    for (const o of geo.settlements) {
      if (o === s) continue;
      const g = townFrame(o, world);
      const km = Math.hypot((g.u - f.u) * EARTH_KM,
        (g.v - f.v) * EARTH_KM * (world.height / world.width));
      if (km < mejor) { mejor = km; vecino = { u: g.u, v: g.v }; }
    }
    if (!vecino) continue;
    minKm = Math.min(minKm, mejor);
    if (alreadyAtTown(f, { ...vecino, spanKm: f.spanKm }, world)) confusos++;
  }
  vara('estar sobre el pueblo VECINO no cuenta como estar en éste',
    confusos === 0,
    `${confusos} confusiones en ${geo.settlements.length} vecinos más cercanos `
      + `(el par más apretado, a ${minKm.toFixed(1)} km)`);
}

// ── 5 · El vano pedido es el del pueblo, y cabe en el contrato ─────────────
{
  const rangos = ['capital', 'city', 'town', 'village'] as const;
  const linea = rangos.map((r) => {
    const km = Math.max(0.5, planRadiusMetres(planSizeFor(r)) * 3 / 1000);
    return `${r} ${km.toFixed(2)}`;
  }).join(' · ');
  const menor = Math.min(...rangos.map((r) => Math.max(0.5, planRadiusMetres(planSizeFor(r)) * 3 / 1000)));
  vara('el vano sale del TAMAÑO del pueblo y respeta el suelo del contrato',
    menor >= MIN_SPAN_KM, `${linea} km · suelo ${MIN_SPAN_KM}`);
}

console.log(fallos ? `\n${fallos} varas ROJAS` : '\nTODO VERDE');
process.exit(fallos ? 1 : 0);
