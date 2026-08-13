// ============================================================================
// BANCO DE ARRANQUE DE TODAS LAS VISTAS
// ============================================================================
// Qué contesta este fichero: para CADA vista y CADA panel del motor de mundos,
// ¿monta, DIBUJA algo verosímil, con el lienzo del tamaño que pidió, sin
// quejarse, y aguanta un segundo montaje?
//
// Por qué existe, con nombres y apellidos (tasks/lessons.md #18, #21, #31, #32,
// y sobre todo #26): esta casa ha entregado ya tres bancos que daban verde sin
// medir nada. El peor montaba `World3D` de verdad, devolvía `ok:true`, no daba
// errores, contaba dos lienzos y leía el HUD — y no estaba dibujando NADA: el
// componente se coloca con clases de Tailwind, la página del banco no llevaba
// Tailwind, el contenedor medía cero de alto y el lienzo nacía de 1100x8. Por
// eso aquí:
//
//   1. La página trae un calzo de CSS escrito a mano (ver views-smoke-run.mjs)
//      y el corredor COMPRUEBA que el lienzo mide lo que se le pidió. Un lienzo
//      de 1100x8 se pone rojo por sí solo.
//   2. La tinta se mide sobre la captura del elemento, no sobre un `ok:true`.
//   3. Cada montaje se hace en una raíz de React NUEVA y se desmonta de verdad.
//      Un almacén de módulo que sobrevive al componente sólo se nota en el
//      segundo pase.
//
// Este fichero sólo pone el escenario y el mando a distancia; TODOS los juicios
// —tinta mínima, tamaño del lienzo, errores— viven en el corredor, donde pueden
// ponerse rojos.
import { createElement, useEffect, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import World3D from '../src/engines/worldgen/components/World3D';
import Map2D from '../src/engines/worldgen/components/Map2D';
import CartoMap from '../src/engines/worldgen/components/CartoMap';
import CityPlanView from '../src/engines/worldgen/components/CityPlanView';
import RegionSheetView from '../src/engines/worldgen/components/RegionSheetView';
import AtlasPanel from '../src/engines/worldgen/components/AtlasPanel';
import WaypointsPanel from '../src/engines/worldgen/components/WaypointsPanel';
import SavedRegionsPanel from '../src/engines/worldgen/components/SavedRegionsPanel';
import SpatialEntityInspector from '../src/engines/worldgen/components/SpatialEntityInspector';
import ParamsPanel from '../src/engines/worldgen/components/ParamsPanel';
import PaintPanel, { DEFAULT_PAINT_TOOL, type PaintTool } from '../src/engines/worldgen/components/PaintPanel';
import FiltersPanel from '../src/engines/worldgen/components/FiltersPanel';
import JourneyPanel from '../src/engines/worldgen/components/JourneyPanel';
import WorldView from '../src/engines/worldgen/components/WorldView';

import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '../src/engines/worldgen/core/types';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import type { HumanGeography, Settlement } from '../src/engines/worldgen/core/settlements';
import { THEMES } from '../src/engines/worldgen/cartography/theme';
import { DEFAULT_LAYERS } from '../src/engines/worldgen/cartography/render';
import { DEFAULT_REGION_PARAMS } from '../src/engines/worldgen/region/types';
import { resolveWorldLandmarks } from '../src/engines/worldgen/core/spatialEntities';
import type { GeneratedWorld, SavedWorldRegion, WorldWaypoint } from '../src/engines/worldgen/types';
import { t as traducir } from '../src/i18n/useTranslation';

// ---------------------------------------------------------------------------
// El parte de averías
// ---------------------------------------------------------------------------
// `console.error` se intercepta AQUÍ además de escucharlo desde Playwright
// porque React entrega ahí sus avisos de claves, de props y de efectos, y con
// `pageerror` sólo se ve lo que revienta el hilo. Se guarda a qué caso y a qué
// pase pertenece cada queja: un error que sólo aparece en el segundo montaje es
// justo el fallo de orden de efectos que este banco busca.
const quejas: { caso: string; pase: number; texto: string }[] = [];
let casoActual = 'arranque';
let paseActual = 0;
const errorOriginal = console.error.bind(console);
console.error = (...args: unknown[]) => {
  quejas.push({ caso: casoActual, pase: paseActual, texto: args.map(String).join(' ').slice(0, 400) });
  errorOriginal(...args);
};
const warnOriginal = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const texto = args.map(String).join(' ');
  // Los avisos de React sobre efectos y actualizaciones fuera de `act` también
  // cuentan: son exactamente el ruido bajo el que se esconde un desmontaje mal
  // hecho. Los de three.js sobre extensiones de SwiftShader, no: eso es el
  // contenedor, no la aplicación.
  if (/THREE\.|WebGL|EXT_|OES_|swiftshader/i.test(texto)) { warnOriginal(...args); return; }
  quejas.push({ caso: casoActual, pase: paseActual, texto: `WARN ${texto.slice(0, 380)}` });
  warnOriginal(...args);
};

// ---------------------------------------------------------------------------
// Utilidades del escenario
// ---------------------------------------------------------------------------
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dos fotogramas: el primero aplica el layout, el segundo deja pintar.
 *
 * CON TOPE, y el tope importa: montado el 3D, un fotograma del navegador cuesta
 * entre 2 y 15 SEGUNDOS con SwiftShader (medido), así que esperar dos de verdad
 * añadía medio minuto a cada montaje y a cada desmontaje. Pasado el tope se
 * sigue: lo que viene detrás es una espera explícita mucho más larga.
 */
const dosFotogramas = () => new Promise<void>((r) => {
  const tope = setTimeout(() => r(), 1500);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(tope); r(); }));
});

interface Caso {
  id: string;
  titulo: string;
  /** `lienzo` mide píxeles; `dom` mide nodos de texto. Ambos miden tinta. */
  tipo: 'lienzo' | 'dom';
  /** Tamaño del hueco que la aplicación le da a esta vista. */
  w: number;
  h: number;
  /** Cuánto tarda en asentarse. Medido, no adivinado — ver la tabla final. */
  esperaMs: number;
  /**
   * Modal de pantalla completa.
   *
   * `CityPlanView` se coloca con `fixed inset-0`, o sea contra la VENTANA, no
   * contra el hueco que le den. Medirlo dentro de un escenario de 1180x760 daba
   * «lienzo 1022x783 en hueco 1180x760» — un rojo del banco, no del programa.
   * Para estos casos el escenario ES la ventana, que es lo que el componente
   * cree que tiene.
   */
  modal?: boolean;
  nodo: () => ReactElement;
  /** Gesto opcional entre el montaje y la medida (cambiar de vista, abrir un
   *  panel). Es lo que convierte «monta» en «el lector llega hasta aquí». */
  despues?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// El mundo: uno solo, real, para todas las vistas
// ---------------------------------------------------------------------------
// La geografía se pide por `getGeography(world, 'full')` y NO por
// `buildHumanGeography` a pelo. Es deliberado y es la lección #21: `WorldView`
// pide la geografía por esa caché y con esa profundidad, y un banco que se
// salta el camino de la aplicación mide otro programa. Con profundidad
// 'places' —la que usa el 3D suelto— `roads` viene vacío y la capa de caminos
// del 2D dibujaría nada mientras el banco daba verde.
let mundo: WorldData;
let geografia: HumanGeography;
let capital: Settlement;
let puerto: Settlement;

function fabricarChinchetas(): WorldWaypoint[] {
  const ahora = Date.now();
  return geografia.settlements.slice(0, 3).map((s, i) => ({
    id: `wp-${i}`,
    projectId: 'banco',
    worldId: 'mundo-banco',
    name: `Alto de ${s.name}`,
    description: i === 0 ? 'Donde el camino cruza el vado.' : undefined,
    color: ['#e4a853', '#c4463a', '#4a9e6d'][i],
    u: s.x / mundo.width,
    v: s.y / mundo.height,
    createdAt: ahora,
    updatedAt: ahora,
  }));
}

function fabricarComarcas(): SavedWorldRegion[] {
  const ahora = Date.now();
  return [capital, puerto].map((s, i) => ({
    id: `reg-${i}`,
    title: `Comarca de ${s.name}`,
    x: s.x,
    y: s.y,
    spanKm: i === 0 ? 240 : 480,
    params: { ...DEFAULT_REGION_PARAMS },
    createdAt: ahora,
    updatedAt: ahora,
  }));
}

// ---------------------------------------------------------------------------
// Envoltorios con estado
// ---------------------------------------------------------------------------
// Varios paneles son controlados: sin un padre que les devuelva lo que emiten,
// un banco los mide MUERTOS —el pincel no cambia de herramienta, la ficha no
// cambia de nombre— y eso es medir la mitad del componente.

function PanelPincel() {
  const [tool, setTool] = useState<PaintTool>(DEFAULT_PAINT_TOOL);
  return createElement(PaintPanel, {
    tool,
    onChange: setTool,
    strokeCount: 0,
    canUndo: false,
    canRedo: false,
    onUndo: () => undefined,
    onRedo: () => undefined,
    onClear: () => undefined,
    onExport: () => undefined,
    cellKm: Math.round(40075 / mundo.width),
    realms: geografia.realms.map((r) => ({ id: r.id, name: r.name, hue: r.hue })),
    busy: false,
  });
}

function PanelParametros({ Comp }: { Comp: typeof ParamsPanel | typeof FiltersPanel }) {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  return createElement(Comp as typeof ParamsPanel, {
    params,
    onChange: setParams,
    onGenerate: () => undefined,
    onRandomSeed: () => undefined,
    generating: false,
    hasWorld: true,
  });
}

function PanelChinchetas() {
  const [lista] = useState(fabricarChinchetas);
  const [sel, setSel] = useState<string | null>(lista[0]?.id ?? null);
  return createElement(WaypointsPanel, {
    waypoints: lista,
    selectedId: sel,
    selected: lista.find((w) => w.id === sel) ?? null,
    onSelect: setSel,
    onEdit: async () => undefined,
    onDelete: async () => undefined,
    placing: false,
    onTogglePlacing: () => undefined,
    onFlyTo: () => undefined,
    disabled: false,
  });
}

function PanelComarcas() {
  const [lista] = useState(fabricarComarcas);
  return createElement(SavedRegionsPanel, {
    regions: lista,
    onOpen: () => undefined,
    onCreateHere: () => undefined,
    onRename: () => undefined,
    onDelete: () => undefined,
  });
}

function PanelIndice() {
  const [sel, setSel] = useState<string | null>(null);
  return createElement(AtlasPanel, {
    world: mundo,
    geography: geografia,
    links: [],
    selectedKey: sel,
    onSelect: setSel,
    onRename: () => undefined,
    onDelete: () => undefined,
    onFlyTo: () => undefined,
  });
}

function PanelViaje() {
  const [pick, setPick] = useState<'from' | 'to' | 'via' | null>(null);
  return createElement(JourneyPanel, {
    world: mundo,
    geography: geografia,
    from: capital,
    to: puerto,
    picking: pick,
    onPick: setPick,
    via: [],
    onClearVia: () => undefined,
    onSwap: () => undefined,
    onClear: () => undefined,
    onRoute: () => undefined,
    paleo: null,
    onPaleo: () => undefined,
  });
}

function FichaDeSitio() {
  // Una entidad REAL del mundo, resuelta por el mismo camino que usa
  // `WorldView` (`resolveWorldLandmarks`), no un objeto inventado a mano: la
  // ficha lee `kind`, `type`, `extent` e `importance` para decidir qué mandos
  // enseña, y con un maniquí se mide una ficha que nadie ve nunca.
  const entidad = resolveWorldLandmarks(mundo, { includeHidden: true })[0];
  return createElement(SpatialEntityInspector, {
    projectId: 'banco',
    worldId: 'mundo-banco',
    entity: entidad,
    onRename: () => undefined,
    onRemove: () => undefined,
    onRestore: () => undefined,
    onMove: () => undefined,
    onStyle: () => undefined,
    onOpenRegion: () => undefined,
    onReveal2D: () => undefined,
    onReveal3D: () => undefined,
  });
}

function Mundo3D({ shape }: { shape: 'plane' | 'globe' }) {
  const [forma, setForma] = useState<'plane' | 'globe'>(shape);
  // La forma vigente, escrita en el escenario. Es lo que permite al gesto del
  // globo comprobar que el clic SIRVIÓ de algo: sin esto, un botón que no
  // cambia nada dejaría al banco midiendo el plano y dándolo por globo.
  useEffect(() => { document.getElementById('escenario')?.setAttribute('data-forma', forma); }, [forma]);
  return createElement(World3D, {
    world: mundo,
    geography: geografia,
    theme: THEMES[0],
    waypoints: fabricarChinchetas(),
    showWaypoints: true,
    showSettlements: true,
    showLandmarks: true,
    skin: 'satelite' as const,
    shape: forma,
    onShape: setForma,
    viewport: { u: 0.5, v: 0.5, spanKm: 20000 },
    exaggeration: 20,
    tool: DEFAULT_PAINT_TOOL,
    onEdit: () => undefined,
    revision: 0,
    flyTarget: null,
  });
}

function Satelite() {
  const [viewport, setViewport] = useState({ u: 0.5, v: 0.5, spanKm: 20000 });
  return createElement(Map2D, {
    world: mundo,
    viewMode: 'atlas' as const,
    projection: 'equirect' as const,
    showRivers: true,
    showLandmarks: true,
    showWaypoints: true,
    showGrid: false,
    waypoints: fabricarChinchetas(),
    selectedWaypointId: null,
    onSelectWaypoint: () => undefined,
    geography: geografia,
    showSettlements: true,
    showRoads: true,
    showBorders: true,
    showFeatures: true,
    viewport,
    onViewportChange: setViewport,
    revision: 0,
    savedRegions: fabricarComarcas(),
  });
}

function Lamina() {
  const [viewport, setViewport] = useState({ u: 0.5, v: 0.5, spanKm: 20000 });
  return createElement(CartoMap, {
    world: mundo,
    theme: THEMES[0],
    geography: geografia,
    layers: DEFAULT_LAYERS,
    density: 1,
    reliefAmount: 1,
    title: 'Mundo del banco',
    subtitle: 'hoja de pruebas',
    viewport,
    onViewportChange: setViewport,
  });
}

function PlanoDeCiudad() {
  return createElement(CityPlanView, {
    world: mundo,
    settlement: capital,
    geography: geografia,
    theme: THEMES[0],
    onClose: () => undefined,
    onRename: () => undefined,
    onDelete: () => undefined,
    onPopulation: () => undefined,
  });
}

function HojaDeComarca() {
  return createElement(RegionSheetView, {
    world: mundo,
    geography: geografia,
    theme: THEMES[0],
    at: { x: capital.x, y: capital.y },
    revision: 0,
    onClose: () => undefined,
    onSelectSpatialEntity: () => undefined,
    onEditEntity: () => undefined,
    onSaveRegion: () => undefined,
    onFlyHere: () => undefined,
    onPickSettlement: () => undefined,
  });
}

/**
 * La cáscara entera, con su barra, su panel lateral y su interruptor de vista.
 *
 * `WorldView` NO recibe el mundo ya hecho: recibe la fila de la base de datos y
 * lo genera él, por su worker, como en la aplicación. Es a propósito — el
 * arranque en frío de la vista (worker, snapshot en IndexedDB, primer dibujo)
 * es justo lo que ningún banco de esta casa había ejercitado nunca.
 */
function Cascara({ vista }: { vista: '3d' | 'map' | 'carta' }) {
  const fila: GeneratedWorld = {
    id: 'mundo-banco',
    projectId: 'banco',
    title: 'Mundo del banco',
    params: { ...DEFAULT_PARAMS, seed: 'banco-vistas', width: 256 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  useEffect(() => {
    // El interruptor de vista se acciona como lo accionaría el lector: por su
    // botón. Llamar a `setView` desde fuera probaría un `WorldView` que no
    // existe.
    if (vista === '3d') return;
    // La etiqueta se pide al MISMO traductor que usa la pestaña. Buscar el
    // literal 'Mapa' a mano ataría el banco al castellano y lo dejaría en
    // silencio el día que alguien cambie la traducción — un banco que no
    // encuentra el botón y no se queja es un banco verde que no probó nada.
    const etiqueta = traducir(vista === 'map' ? 'worldgen.view.map' : 'worldgen.view.carta');
    const reloj = setInterval(() => {
      const shell = document.querySelector('[data-testid="worldgen-view"]');
      const boton = [...(shell?.querySelectorAll('button') ?? [])]
        .find((b) => (b.textContent ?? '').trim() === etiqueta) as HTMLButtonElement | undefined;
      if (boton && !boton.disabled) {
        boton.click();
        clearInterval(reloj);
      }
    }, 400);
    return () => clearInterval(reloj);
  }, [vista]);
  return createElement(WorldView, {
    projectId: 'banco',
    world: fila,
    onSaveParams: () => undefined,
    onSaveEdits: () => undefined,
    onSaveRegions: () => undefined,
    onThumbnail: () => undefined,
    focusWaypoint: null,
  });
}

/**
 * ¿Está de verdad puesta la vista que se pidió?
 *
 * Sin esto los tres casos de la cáscara medían tinta y daban verde aunque el
 * clic en la pestaña no hubiese hecho nada: las tres capturas se parecerían —
 * y de hecho las tres dan ~73 % de tinta— porque la barra, el panel lateral y
 * el marco ocupan lo mismo en las tres. Se busca un elemento que SÓLO existe
 * en esa vista, no una clase de color.
 */
async function confirmarVista(vista: '3d' | 'map' | 'carta') {
  const stage = document.getElementById('escenario');
  if (vista === 'map') {
    // Los dos desplegables (modo y proyección) los pinta `WorldView` sólo
    // cuando `view === 'map'`.
    if ((stage?.querySelectorAll('select').length ?? 0) < 2) throw new Error('no llegó al satélite: faltan los desplegables de modo y proyección');
    return;
  }
  if (vista === 'carta') {
    // El botón de encuadre de `CartoMap`, que no existe en ninguna otra vista.
    const hay = [...(stage?.querySelectorAll('button') ?? [])]
      .some((b) => b.getAttribute('title') === 'Encuadrar el mundo');
    if (!hay) throw new Error('no llegó a la carta: falta el botón de encuadre de CartoMap');
    return;
  }
  const chip = traducir('worldgen.threeD.shape.plane');
  const hay = [...(stage?.querySelectorAll('button') ?? [])]
    .some((b) => (b.textContent ?? '').trim() === chip);
  if (!hay) throw new Error('no llegó al 3D: falta el mando de forma de World3D');
}

// ---------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------
const PANEL_W = 336; // 21rem, el ancho real del panel lateral en `WorldView`.
const PANEL_H = 720;
const VISTA_W = 1180;
const VISTA_H = 760;
const CASCARA_W = 1560;
const CASCARA_H = 920;

function catalogo(): Caso[] {
  return [
    { id: 'world3d-plano', titulo: 'World3D · plano', tipo: 'lienzo', w: VISTA_W, h: VISTA_H, esperaMs: 7000, nodo: () => createElement(Mundo3D, { shape: 'plane' }) },
    {
      id: 'world3d-globo',
      titulo: 'World3D · globo',
      tipo: 'lienzo',
      w: VISTA_W,
      h: VISTA_H,
      esperaMs: 7000,
      // SE LLEGA AL GLOBO COMO LLEGA EL LECTOR: montando el plano y pulsando
      // «Globo». No es ceremonia — `WorldView` arranca SIEMPRE en 'plane'
      // (`useState<Shape3D>('plane')`), así que montar directamente en globo
      // prueba un camino que la aplicación no recorre nunca, y encima da otro
      // encuadre: el posado inicial y el posado al CAMBIAR de forma son dos
      // ramas distintas del mismo efecto. Lección #21.
      nodo: () => createElement(Mundo3D, { shape: 'plane' }),
      despues: async () => {
        const etiqueta = traducir('worldgen.threeD.shape.globe');
        const chip = [...document.querySelectorAll('#escenario button')]
          .find((b) => (b.textContent ?? '').trim() === etiqueta) as HTMLButtonElement | undefined;
        if (!chip) throw new Error(`no hay botón «${etiqueta}» en el HUD del 3D`);
        chip.click();
        // Un fotograma del globo cuesta ~15 s con SwiftShader: sin esta espera
        // se capturaría el plano todavía en pantalla y el banco daría verde
        // por la vista equivocada.
        await espera(30000);
        if (document.getElementById('escenario')?.getAttribute('data-forma') !== 'globe') {
          throw new Error('el botón «Globo» no cambió la forma');
        }
      },
    },
    { id: 'map2d', titulo: 'Map2D · satélite', tipo: 'lienzo', w: VISTA_W, h: VISTA_H, esperaMs: 4500, nodo: () => createElement(Satelite) },
    { id: 'cartomap', titulo: 'CartoMap · lámina', tipo: 'lienzo', w: VISTA_W, h: VISTA_H, esperaMs: 6000, nodo: () => createElement(Lamina) },
    { id: 'cityplan', titulo: 'CityPlanView · plano', tipo: 'lienzo', w: window.innerWidth, h: window.innerHeight, modal: true, esperaMs: 5000, nodo: () => createElement(PlanoDeCiudad) },
    { id: 'regionsheet', titulo: 'RegionSheetView · comarca', tipo: 'lienzo', w: VISTA_W, h: VISTA_H, esperaMs: 12000, nodo: () => createElement(HojaDeComarca) },
    {
      id: 'atlas',
      titulo: 'AtlasPanel · índice',
      tipo: 'dom',
      w: PANEL_W,
      h: PANEL_H,
      esperaMs: 1200,
      nodo: () => createElement(PanelIndice),
      // EL ÍNDICE RECIÉN ABIERTO NO ENSEÑA NADA DEL MUNDO: una caja de
      // búsqueda, «pincha un lugar de la carta» y «aún no hay nada enlazado».
      // Tres textos. Medirlo así sería medir un cartel, no un índice: se hace
      // lo que haría el lector —buscar— y se abre la ficha del primer
      // resultado. Si `buildAtlas` devolviera un mundo sin sitios, o la
      // búsqueda no filtrara, esto se pone rojo; el montaje pelado no.
      despues: async () => {
        const caja = document.querySelector('#escenario input') as HTMLInputElement | null;
        if (!caja) throw new Error('el índice no tiene caja de búsqueda');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(caja, 'a');
        caja.dispatchEvent(new Event('input', { bubbles: true }));
        await espera(400);
        const primero = document.querySelector('#escenario button') as HTMLButtonElement | null;
        if (!primero) throw new Error('la búsqueda del índice no devolvió ningún sitio');
        primero.click();
        await espera(400);
      },
    },
    { id: 'waypoints', titulo: 'WaypointsPanel', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 900, nodo: () => createElement(PanelChinchetas) },
    { id: 'savedregions', titulo: 'SavedRegionsPanel', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 900, nodo: () => createElement(PanelComarcas) },
    { id: 'places', titulo: 'SpatialEntityInspector', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 1500, nodo: () => createElement(FichaDeSitio) },
    { id: 'params', titulo: 'ParamsPanel', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 900, nodo: () => createElement(PanelParametros, { Comp: ParamsPanel }) },
    { id: 'paint', titulo: 'PaintPanel · pincel', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 900, nodo: () => createElement(PanelPincel) },
    { id: 'filters', titulo: 'FiltersPanel · mundo', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 900, nodo: () => createElement(PanelParametros, { Comp: FiltersPanel }) },
    { id: 'journey', titulo: 'JourneyPanel · viaje', tipo: 'dom', w: PANEL_W, h: PANEL_H, esperaMs: 2500, nodo: () => createElement(PanelViaje) },
    { id: 'worldview-3d', titulo: 'WorldView · 3D', tipo: 'lienzo', w: CASCARA_W, h: CASCARA_H, esperaMs: 16000, nodo: () => createElement(Cascara, { vista: '3d' }), despues: () => confirmarVista('3d') },
    { id: 'worldview-map', titulo: 'WorldView → satélite', tipo: 'lienzo', w: CASCARA_W, h: CASCARA_H, esperaMs: 18000, nodo: () => createElement(Cascara, { vista: 'map' }), despues: () => confirmarVista('map') },
    { id: 'worldview-carta', titulo: 'WorldView → carta', tipo: 'lienzo', w: CASCARA_W, h: CASCARA_H, esperaMs: 20000, nodo: () => createElement(Cascara, { vista: 'carta' }), despues: () => confirmarVista('carta') },
  ];
}

// ---------------------------------------------------------------------------
// El mando a distancia
// ---------------------------------------------------------------------------
let raiz: Root | null = null;
let anfitrion: HTMLDivElement | null = null;
let casos: Caso[] = [];

declare global {
  interface Window {
    __humo?: {
      listo: boolean;
      preparar: () => Promise<{ ancho: number; alto: number; poblaciones: number; reinos: number; ruinas: number; caminos: number; segundos: number }>;
      casos: () => { id: string; titulo: string; tipo: string; w: number; h: number; esperaMs: number; modal: boolean }[];
      montar: (id: string, pase: number) => Promise<void>;
      desmontar: () => Promise<void>;
      quejas: () => { caso: string; pase: number; texto: string }[];
      error?: string;
    };
  }
}

async function preparar() {
  const t0 = performance.now();
  mundo = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco-vistas', width: 256 });
  geografia = getGeography(mundo, 'full');
  const porRango = [...geografia.settlements].sort((a, b) => b.population - a.population);
  capital = porRango[0];
  puerto = porRango.find((s) => s.port) ?? porRango[1] ?? porRango[0];
  casos = catalogo();
  return {
    ancho: mundo.width,
    alto: mundo.height,
    poblaciones: geografia.settlements.length,
    reinos: geografia.realms.length,
    ruinas: geografia.ruins.length,
    caminos: geografia.roads.length,
    segundos: Math.round((performance.now() - t0) / 100) / 10,
  };
}

async function montar(id: string, pase: number) {
  const caso = casos.find((c) => c.id === id);
  if (!caso) throw new Error(`caso desconocido: ${id}`);
  casoActual = id;
  paseActual = pase;
  await desmontar();
  anfitrion = document.createElement('div');
  anfitrion.id = 'escenario';
  // EL HUECO. Se le da un tamaño EXPLÍCITO y `position:relative`, porque casi
  // todas estas vistas se colocan con `absolute inset-0` y sin un ancestro
  // posicionado con altura se quedan de cero — que es exactamente la trampa del
  // lienzo 1100x8. El corredor comprueba después que el lienzo mide esto.
  anfitrion.style.cssText = caso.modal
    ? 'position:fixed;inset:0;overflow:hidden;background:#0b0e14'
    : `position:relative;width:${caso.w}px;height:${caso.h}px;overflow:hidden;background:#0b0e14`;
  document.body.appendChild(anfitrion);
  raiz = createRoot(anfitrion);
  raiz.render(caso.nodo());
  await dosFotogramas();
  await espera(caso.esperaMs);
  if (caso.despues) await caso.despues();
  await dosFotogramas();
}

async function desmontar() {
  if (raiz) { raiz.unmount(); raiz = null; }
  if (anfitrion) { anfitrion.remove(); anfitrion = null; }
  await dosFotogramas();
}

window.__humo = {
  listo: false,
  preparar,
  casos: () => casos.map((c) => ({ id: c.id, titulo: c.titulo, tipo: c.tipo, w: c.w, h: c.h, esperaMs: c.esperaMs, modal: !!c.modal })),
  montar,
  desmontar,
  quejas: () => quejas,
};
window.__humo.listo = true;
