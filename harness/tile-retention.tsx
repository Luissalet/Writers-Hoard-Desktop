// ============================================================================
// BANCO DE RETENCIÓN DE TESELAS (2D hondo)
// ============================================================================
// Reproduce la captura de Luis del 2026-08-12 (vano 41 km, «pide z13», HUD
// «entregadas 0/45» eterno): su volcado de consola enseñó el MISMO suelo
// z13(3490,955) naciendo CINCO veces en cuatro segundos, cada vez entregado
// en menos de un segundo y cada vez perdido — 66 de 72 coordenadas renacidas.
// Una tesela entregada que no se queda es un almacén que alguien vacía o una
// promesa que alguien cancela; este banco monta el Map2D DE VERDAD, baja con
// la rueda hasta suelo hondo y cuenta nacimientos por coordenada, con el
// `setGeneration` del almacén intervenido para retratar al que vacía.
//
// Lecciones que paga: #21 («medir el renderizador no es medir la vista») y
// #26 («contar cosas no es medirlas») — de ahí que la vara sea «ninguna
// coordenada renace más de dos veces Y el reposo queda mudo», no un ok:true.
import { createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Map2D from '../src/engines/worldgen/components/Map2D';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '../src/engines/worldgen/core/types';
import { applyEdits, serializeEdits, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';
import { DisplayTileStore } from '../src/engines/worldgen/cartography/tileStore';
import { registerCanonPersistence, bindCanonWorld } from '../src/engines/worldgen/canonSnapshots';
import { registerRenderedTilePersistence } from '../src/engines/worldgen/renderedSnapshots';
import { tileStats } from '../src/engines/worldgen/region/client';
import { tileServiceStats } from '../src/engines/worldgen/region/tileService';
import { satelliteDeepSupported, MAX_SAT_TILE_Z, SAT_DEEP_Z } from '../src/engines/worldgen/region/satelliteTile';

// ---------------------------------------------------------------------------
// El registro: la vida de cada petición, contada desde la traza que el
// cliente ya emite (DEBUG_TRACE), y cada cambio de generación del almacén.
// ---------------------------------------------------------------------------
interface Nacimiento { t: number; z: number; tx: number; ty: number; id: string }
const nacimientos: Nacimiento[] = [];
const entregas: { t: number; id: string }[] = [];
const declinadas: { t: number; id: string }[] = [];
const genCambios: { t: number; de: string; a: string; pila: string }[] = [];
const T0 = Date.now();
const ahora = () => (Date.now() - T0) / 1000;

const logOriginal = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const [cab, id, resto] = args;
  if (typeof cab === 'string' && cab.startsWith('[teselas') && typeof id === 'string') {
    const cuerpo = typeof resto === 'string' ? resto : '';
    const nace = cuerpo.match(/^nace z(\d+)\((\d+),(\d+)\)/);
    if (nace && id.startsWith('tile-')) {
      nacimientos.push({
        t: ahora(), id, z: Number(nace[1]), tx: Number(nace[2]), ty: Number(nace[3]),
      });
    } else if (cuerpo.startsWith('✓ entregada')) {
      entregas.push({ t: ahora(), id });
    } else if (cuerpo.startsWith('DECLINADA')) {
      declinadas.push({ t: ahora(), id });
    } else if (id === 'servicio' && args[3] === 'disco ✓') {
      // Una tesela servida del ALMACÉN DE ENTINTADAS no pasa por el pool y no
      // canta «nace»/«entregada» — pero es suelo que llega igual, y sin este
      // par sintético la segunda visita del corredor va a ciegas (nivelActual
      // -1, bajada de 232 s esperando nacimientos que el disco hizo
      // innecesarios). La clave de contenido termina en `:z/tx/ty`.
      const disco = cuerpo.match(/:(\d+)\/(\d+)\/(\d+)$/);
      if (disco) {
        const idSint = `disco-${cuerpo}`;
        nacimientos.push({
          t: ahora(), id: idSint,
          z: Number(disco[1]), tx: Number(disco[2]), ty: Number(disco[3]),
        });
        entregas.push({ t: ahora(), id: idSint });
      }
    }
  }
  logOriginal(...args);
};

// El almacén de pantalla, intervenido: cada vez que la generación CAMBIA (lo
// único que vacía teselas y cancela vuelos fuera de dispose), quede quién y
// con qué cadena. La pila es lo que señala al culpable en el informe.
type ConGeneracion = { generation?: string };
const setGenOriginal = DisplayTileStore.prototype.setGeneration;
DisplayTileStore.prototype.setGeneration = function setGenEspiado(gen: string) {
  const previa = (this as unknown as ConGeneracion).generation;
  if (previa !== undefined && previa !== gen) {
    genCambios.push({
      t: ahora(),
      de: previa,
      a: gen,
      pila: (new Error().stack ?? '').split('\n').slice(2, 5).join(' | '),
    });
  }
  return setGenOriginal.call(this, gen);
};

// ---------------------------------------------------------------------------
// El escenario
// ---------------------------------------------------------------------------
let mundo: WorldData;
let geografia: HumanGeography;
let edicionesCanon = '';
let raiz: ReturnType<typeof createRoot> | null = null;

function nivelHondoDisponible(w: WorldData): number {
  for (let z = MAX_SAT_TILE_Z; z >= SAT_DEEP_Z; z--) {
    if (satelliteDeepSupported(w, z)) return z;
  }
  return -1;
}

function Banco({ u, v, spanKm }: { u: number; v: number; spanKm: number }) {
  const [viewport, setViewport] = useState({ u, v, spanKm });
  return createElement(Map2D, {
    world: mundo,
    viewMode: 'atlas' as const,
    projection: 'equirect' as const,
    showRivers: true,
    showLandmarks: false,
    showWaypoints: false,
    showGrid: false,
    waypoints: [],
    selectedWaypointId: null,
    onSelectWaypoint: () => undefined,
    geography: geografia,
    showSettlements: true,
    showRoads: true,
    showBorders: false,
    showFeatures: true,
    viewport,
    onViewportChange: setViewport,
    revision: 0,
    canonWorld: mundo,
    canonEdits: edicionesCanon,
  });
}

async function preparar(width: number, legado = false) {
  const t0 = performance.now();
  registerCanonPersistence();
  // El almacén de ENTINTADAS también (F1): este banco corre en Chromium con
  // IndexedDB de verdad, así que la vía disco→servicio queda bajo prueba —
  // el parte final canta cuántas teselas sirvió el disco.
  registerRenderedTilePersistence();
  logOriginal(`[banco] generando mundo ${width}…`);
  mundo = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco-retencion', width });
  bindCanonWorld(mundo, 'banco-retencion');
  // EL GRIFO ABIERTO: desde la pasada 10 un mundo nace desnudo, y este paseo
  // retrata «suelo firme con caminos y casas» — la captura original de Luis.
  // Las MISMAS ediciones viajan serializadas como canonEdits (abajo), que es
  // exactamente lo que hace WorldView: sin ellas, el worker replicaría un
  // canon desnudo bajo una geografía habitada.
  // LEGADO = el caso de Luis: un mundo SIN ediciones (el grifo abierto por
  // ausencia) y `canonEdits` vacío, como lo manda WorldView. Es la
  // combinación que su HUD retrataba con 0/28 y disco 0/863.
  if (legado) {
    edicionesCanon = '';
  } else {
    const grifo: WorldEdit[] = [{ kind: 'placesEverywhere', enabled: true }];
    applyEdits(mundo, grifo);
    edicionesCanon = serializeEdits(grifo);
  }
  logOriginal('[banco] geografía full…');
  geografia = getGeography(mundo, 'full');
  logOriginal('[banco] montando Map2D…');
  // El centro del paseo: la capital — suelo firme con caminos y casas, que es
  // exactamente el paisaje de la captura.
  const capital = [...geografia.settlements].sort((a, b) => b.population - a.population)[0];
  const u = capital ? capital.x / mundo.width : 0.5;
  const v = capital ? capital.y / mundo.height : 0.5;
  const host = document.createElement('div');
  host.id = 'escenario';
  host.style.cssText = 'position:relative;width:1280px;height:760px;overflow:hidden;background:#0b0e14';
  document.body.appendChild(host);
  raiz = createRoot(host);
  // Match the real app. This is the lifecycle probe that caught a memoized
  // DisplayTileStore being disposed by StrictMode and then silently reused.
  raiz.render(createElement(StrictMode, null,
    createElement(Banco, { u, v, spanKm: 1600 })));
  // El latido: si el hilo principal se atasca, esto calla — y el corredor
  // sabe distinguir «página muerta» de «Playwright esperando a un selector».
  window.setInterval(() => logOriginal(`[banco] latido +${ahora().toFixed(1)}s`), 2000);
  return {
    ancho: mundo.width,
    alto: mundo.height,
    topZ: nivelHondoDisponible(mundo),
    capital: { u, v },
    poblaciones: geografia.settlements.length,
    segundos: Math.round((performance.now() - t0) / 100) / 10,
  };
}

/** El nivel más hondo que ha nacido en los últimos `ventanaS` segundos. */
function nivelActual(ventanaS = 2): number {
  const desde = ahora() - ventanaS;
  let z = -1;
  for (let i = nacimientos.length - 1; i >= 0; i--) {
    const n = nacimientos[i];
    if (n.t < desde) break;
    if (n.z > z) z = n.z;
  }
  return z;
}

/** Nacimientos y entregas por coordenada de un nivel: la materia del veredicto. */
function porCoordenada(nivel: number) {
  const nacePorId = new Map<string, Nacimiento>();
  for (const n of nacimientos) nacePorId.set(n.id, n);
  const out = new Map<string, { naceT: number[]; entregaT: number[] }>();
  for (const n of nacimientos) {
    if (n.z !== nivel) continue;
    const clave = `${n.z}/${n.tx}/${n.ty}`;
    const e = out.get(clave) ?? { naceT: [], entregaT: [] };
    e.naceT.push(n.t);
    out.set(clave, e);
  }
  for (const d of entregas) {
    const n = nacePorId.get(d.id);
    if (!n || n.z !== nivel) continue;
    out.get(`${n.z}/${n.tx}/${n.ty}`)?.entregaT.push(d.t);
  }
  return out;
}

/** Para el reposo adaptativo del corredor: cuántas coordenadas del nivel ya
 *  tienen entrega, y cuándo nació el último del nivel. */
function progreso(nivel: number) {
  const mapa = porCoordenada(nivel);
  let entregadas = 0;
  let ultimoNaceT = 0;
  for (const e of mapa.values()) {
    if (e.entregaT.length) entregadas++;
    for (const t of e.naceT) if (t > ultimoNaceT) ultimoNaceT = t;
  }
  return { coords: mapa.size, entregadas, ultimoNaceT, t: ahora() };
}

function informe(nivel: number, reposoDesdeT: number) {
  const t = ahora();
  const mapa = porCoordenada(nivel);
  let renacidas = 0;
  let maxNacimientos = 0;
  let peor = '';
  let entregadasNivel = 0;
  // EL BUCLE DE LA CAPTURA, medido con exactitud: una coordenada que vuelve a
  // nacer DESPUÉS de su primera entrega es una tesela entregada que alguien
  // tiró — el z13(3490,955) del log de Luis, cinco vidas en cuatro segundos.
  const renacidasTrasEntrega: string[] = [];
  for (const [clave, e] of mapa) {
    if (e.naceT.length > 1) renacidas++;
    if (e.naceT.length > maxNacimientos) { maxNacimientos = e.naceT.length; peor = clave; }
    if (e.entregaT.length) {
      entregadasNivel++;
      const primera = Math.min(...e.entregaT);
      if (e.naceT.some((nt) => nt > primera + 0.05)) renacidasTrasEntrega.push(clave);
    }
  }
  const nacimientosEnReposo = nacimientos.filter((n) => n.t >= reposoDesdeT && n.z === nivel).length;
  const genEnReposo = genCambios.filter((c) => c.t >= reposoDesdeT);
  return {
    t,
    nivel,
    coords: mapa.size,
    nacidosTotal: [...mapa.values()].reduce((s, e) => s + e.naceT.length, 0),
    entregadasNivel,
    renacidas,
    maxNacimientos,
    peor,
    renacidasTrasEntrega: renacidasTrasEntrega.slice(0, 12),
    renacidasTrasEntregaTotal: renacidasTrasEntrega.length,
    nacimientosEnReposo,
    genCambiosTotal: genCambios.length,
    genEnReposo: genEnReposo.length,
    genUltimos: genCambios.slice(-6),
    declinadas: declinadas.length,
    stats: { ...tileStats },
    servicio: { ...tileServiceStats },
  };
}

declare global {
  interface Window {
    __banco?: {
      listo: boolean;
      preparar: (width: number) => Promise<unknown>;
      nivelActual: (ventanaS?: number) => number;
      progreso: (nivel: number) => unknown;
      informe: (nivel: number, reposoDesdeT: number) => unknown;
      ahora: () => number;
      error?: string;
    };
  }
}

window.__banco = { listo: true, preparar, nivelActual, progreso, informe, ahora };
