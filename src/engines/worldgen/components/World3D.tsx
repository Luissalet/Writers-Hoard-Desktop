import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Globe, Layers, Loader2, Sun, Sliders, FlipHorizontal, FlipVertical, Footprints,
} from 'lucide-react';
// `translate` is the non-reactive twin of the hook's `t`: the render uses the
// hook, and the callbacks and effects below use this one, so that a translation
// never becomes a dependency of the draw loop or of the WebGL setup.
import { useTranslation, t as translate } from '@/i18n/useTranslation';
import {
  drawArrivalMark, drawScreenCompass, drawScreenScaleBar, northOnScreen,
} from '../cartography/screenFurniture';
import type { WorldData } from '../core/types';
import { BIOME_COUNT } from '../core/types';
import { BIOME_COLORS, renderBase } from '../core/render';
import { SculptGesture, tipOf } from '../sculpt/ops';
import {
  clampCameraToSurface,
  SculptSurface,
  focusWindow,
  pickCell,
  visibleWindow,
  SIZE_X,
  R_GLOBE,
  type SculptShape,
} from '../sculpt/scene3d';
import { createSky, type Sky } from '../sculpt/sky';
import { lakeHeightAtUV } from '../core/lakeSurface';
import { createWater, type Water } from '../sculpt/water';
import { createScatter, type Scatter } from '../sculpt/scatter';
import type { Pt, Stroke, TerrainOp, WorldEdit } from '../core/edits';
import {
  commitPaintStroke, isSculptMode, isWaypointTool, negativeOf, pickGeneratedAt,
} from '../core/paintCommit';
import type { HumanGeography, Settlement } from '../core/settlements';
import { getCartoTexture } from '../cartography/texture';
import type { CartoTheme } from '../cartography/theme';
import { DisplayTileStore } from '../cartography/tileStore';
import { flightProgress } from '../cartography/frameClock';
import type { TileKey } from '../cartography/tiles';
import {
  planZoomSkin, samePlan, zoomSkinCovers, MAX_ZOOM_SKIN_SPAN,
  type SkinWindow, type ZoomSkinPlan,
} from '../cartography/zoomSkin';
import { tileStats, oldestInFlightMs } from '../region/client';
import { serveTile } from '../region/tileService';
import { mapSourceKey, worldContentKey, worldFamilyKey, geographyContentKey } from '../region/contentIdentity';
import { drawRoadNetwork, roadOverlayAlpha } from '../cartography/roadOverlay';
import { drawRealmBorders, realmBorders } from '../cartography/realmOverlay';
import { drawTownStains } from '../cartography/townStains';
import {
  drawWorldRivers, MAX_SAT_TILE_Z, SAT_DEEP_Z, satelliteDeepSupported, satPxPerCanonCell,
} from '../region/satelliteTile';
import { DEEP_TILE_Z, deepTileSupported } from '../region/deepTile';
import type { WorldViewport, WorldWaypoint } from '../types';
import { CURVES, TIPS, type PaintTool } from './PaintPanel';
import SculptView from './SculptView';
import {
  resolveWorldLandmarks,
  type WorldSpatialEntity,
} from '../core/spatialEntities';
import { semanticZoomProfile } from '../core/semanticZoom';
import {
  EARTH_KM, FLIGHT_MS, MIN_3D_SPAN_KM, MIN_SPAN_KM, type FlyMark, type FlyTarget,
} from '../core/camera';
import { anchoredDolly, anchoredGlobeDolly } from '../core/zoomAnchor';

/**
 * The world, in three dimensions. The main view.
 *
 * There used to be two of these: a "terrain" view that could show a finished map
 * and could not be touched, and a "sculpt" view that could be touched and showed
 * grey clay. That split was a mistake in the same way a modal dialogue is a
 * mistake — it made the reader choose, before doing anything, between seeing the
 * world and changing it. This is one view: the map is on the ground, the brush
 * works on it, and the skin is a toggle rather than a mode.
 *
 * What makes it possible is that the geometry never changes. The grid is built
 * once, the height comes from a texture the vertex shader reads, and the grid is
 * stretched over the square of the world the camera can currently see — so the
 * same million triangles buy a hundred times the detail when you lean in, and a
 * brush stroke is a rectangle of texture rather than a mesh rebuild. See
 * `sculpt/scene3d.ts`.
 *
 * Conventions are the ones a sculptor's hands already know:
 *
 *   left drag          the brush, or turning the world when no brush is out
 *   middle / right     turn and move the camera
 *   wheel              closer and further
 *   Ctrl + wheel       brush size          (also [ and ])
 *   Shift + wheel      brush strength
 *   Shift held         smooth, whatever the brush was
 *   Ctrl held          the brush inverted
 *   F                  put what is under the pointer at the centre of the turn
 *   X / Y              symmetry
 *   G                  plane or globe
 *   Ctrl+Z / Ctrl+Y    undo, redo
 */

/** What is painted on the ground. */
export type Skin3D = 'satelite' | 'dibujado' | 'arcilla';
export type Shape3D = SculptShape;

interface World3DProps {
  world: WorldData;
  geography?: HumanGeography | null;
  /** El mundo PRÍSTINO del canon y sus ediciones serializadas — la identidad
   *  de CONTENIDO de las teselas hondas. Con ellos, una tesela que el 2D ya
   *  entintó se comparte (mismo encargo del servicio) o llega del almacén de
   *  entintadas; sin ellos, el 3D pedía por la identidad del objeto editado y
   *  ni el canon residente ni el disco le servían de nada. */
  canonWorld?: WorldData | null;
  canonEdits?: string;
  theme: CartoTheme;
  waypoints: WorldWaypoint[];
  showWaypoints: boolean;
  showSettlements: boolean;
  showLandmarks: boolean;
  showRivers?: boolean;
  showRoads?: boolean;
  showBorders?: boolean;
  selectedSpatialKey?: string | null;
  onSelectSpatialEntity?: (entity: WorldSpatialEntity | null) => void;
  /** Extra close-range entities supplied by the regional LOD controller. */
  regionalEntities?: WorldSpatialEntity[];
  // NO HAY `regionDetail` AQUÍ, y es deliberado. La comarca de ~150 m es del
  // mapa 2D; esta vista dibuja la topografía a grandes rasgos y nada más.
  // Ver el comentario largo en WorldView, sobre el efecto que la pide.
  viewport?: WorldViewport;
  onViewportChange?: (viewport: WorldViewport) => void;
  skin: Skin3D;
  shape: Shape3D;
  onShape: (s: Shape3D) => void;
  exaggeration: number;
  tool: PaintTool;
  /** So the wheel and the bracket keys can change the brush the panel owns. */
  onTool?: (patch: Partial<PaintTool>) => void;
  onEdit: (edit: WorldEdit) => void;
  /** Several edits as ONE undo step — a symmetric stroke is four of them. */
  onEdits?: (edits: WorldEdit[]) => void;
  revision: number;
  flyTarget: FlyTarget | null;
  /** La chincheta de llegada. Se dibuja como una diana con su nombre y no se
   *  descarta nunca por amontonamiento: es lo que el lector fue a buscar. */
  flyMark?: FlyMark | null;
  onPickSettlement?: (s: Settlement) => void;
  onPickWaypoint?: (id: string) => void;
  /** The Punto tool with Chincheta selected. Normalized, which is how a pin is
   *  stored, and deliberately NOT an edit — see `isWaypointTool`. */
  onPlaceWaypoint?: (u: number, v: number) => void;
  onRemoveWaypoint?: (id: string) => void;
  /** Double-click: descend a league toward that ground (the parent flies). */
  onZoomTo?: (x: number, y: number) => void;
}

/**
 * Densidad de malla, en vértices a lo ancho del cuadrado visible.
 *
 * Eran 256/384/512, y a vista de mundo entero sobre una rejilla de 2048 eso
 * son CINCO CELDAS POR TRIÁNGULO: cuatro de cada cinco cordilleras que el
 * generador calculó no llegaban a existir como geometría. Eso es lo que se
 * ve como «vergonzosamente pixelado», y no era una limitación del motor sino
 * un presupuesto que se gastaba en otra parte — en el parche regional que
 * esta vista ya no monta.
 *
 * La rejilla es estática y el desplazamiento va en el vertex shader, así que
 * subirla no cuesta CPU por frame: cuesta memoria de vídeo una vez. A 1536
 * son 2,36 M de vértices (~47 MB entre posiciones, uv e índices de 32 bits),
 * calderilla para cualquier tarjeta de este siglo, y deja el mundo entero a
 * ~1,3 celdas por triángulo — por debajo de una celda, que es el punto donde
 * la geometría ya no puede perder nada de lo que el generador calculó.
 */
// De vuelta a lo que había.
//
// La subí a 2048 para que la malla pudiera llevar el relieve inventado. Ese
// relieve está apagado, así que lo único que compraba la densidad extra era
// muestrear MÁS FINO un campo que no tiene más que dar — y los ríos del mundo
// están tallados con un cauce de una celda de ancho, así que una malla más
// fina que la celda convierte esa muesca en una hilera de hoyuelos: las
// cuentas oscuras que se ven siguiendo los valles.
const MESH_STEPS = [512, 1024, 1536];

/*
 * La piel del 3D es UNA textura del mundo entero, y a mil doscientos kilómetros
 * de encuadre eso son veinte kilómetros de suelo por téxel: es la queja de Luis
 * («los biomas y los ríos se ven pixeladísimos sobre la topología») y sigue sin
 * resolver. Intenté renderizar la pintura para la ventana de la cámara y el
 * agua pintada dejó de caer sobre el cauce excavado en el terreno, de una forma
 * que no supe encontrar razonando y que no puedo mirar desde donde trabajo.
 * Quitado del todo antes que dejado a medias. Ver tasks/todo-2d-satelite.md.
 */
const VIEWPORT_REPORT_MS = 180;

/* El suelo de acercamiento de esta vista —MIN_3D_SPAN_KM— y toda su historia
 * (1200 → 150 → 25 → 10 → 2 km, con el porqué de cada bajada) viven ahora en
 * `core/camera.ts`, al lado del contrato de cámara compartida del que salen.
 * Se mudó el 2026-08-15 por una razón práctica: una constante dentro de un
 * `.tsx` no se puede medir sin montar React, y ésta ES una medida — el banco
 * `harness/descent-3d.ts` la compara contra lo que la piel puede servir.
 */

/** HUD de depuración de la piel (TEMPORAL — Luis, 2026-08-12): añade a la
 *  línea de la piel el techo del plan, el estado del contrato consume y los
 *  contadores de sesión de la vía de teselas. Quitar tras el diagnóstico. */
const DEBUG_HUD = false;

/**
 * Y UN SUELO DISTINTO PARA EL ENCUADRE HEREDADO.
 *
 * Son dos cosas que antes eran un solo número, y por eso bajarlo se había
 * revertido. Una es hasta dónde puede acercarse el lector con la rueda: eso es
 * suyo, y ahora llega diez veces más cerca. La otra es a qué distancia ABRE la
 * vista cuando adopta el encuadre compartido — y si vienes del 2D mirando una
 * calle, abrir ahí te pone el morro en la hierba de un terreno que sólo tiene
 * una muestra cada veinte kilómetros. Acercarse a mirar es una decisión; que te
 * dejen caer ahí, no.
 *
 * 150 desde que el suelo del lector bajó a 25 (decisión de Luis, 2026-08-11):
 * venir del 2D mirando una comarca abre EN esa comarca, no a 1200 km — pero
 * nunca más cerca de lo que un posado deliberado enseña con dignidad.
 */
const ADOPT_MIN_SPAN_KM = 150;

/**
 * EL PASEO: LA CÁMARA A LA ALTURA DE LOS OJOS.
 *
 * Todo lo demás de esta vista orbita un punto del suelo, que es la postura
 * correcta para mirar una cordillera y la equivocada para estar EN un sitio.
 * Con el cielo y el mar de verdad ya puestos, lo que faltaba para que una
 * costa se lea como una costa es ponerse a su altura.
 *
 * No hay controles nuevos: se reaprovecha el orbitador poniéndole el punto de
 * mira a un palmo delante de la cámara. Girar deja de rodear el paisaje y pasa
 * a ser mirar alrededor, que es exactamente el gesto que se quiere, y toda la
 * maquinaria de amortiguado, de límites y de posado sigue siendo la misma. Un
 * `FirstPersonControls` habría sido un segundo sistema de cámara conviviendo
 * con el primero, y dos cámaras en una vista es de donde salen los saltos.
 *
 * 1,7 m de estatura. En las unidades de esta escena eso es ridículamente poco
 * —el mundo entero mide 240 y una celda son veinte kilómetros—, así que la
 * altura de los ojos se toma como una fracción del plano cercano de la cámara:
 * lo bastante alta para no meterse dentro del terreno y lo bastante baja para
 * que el horizonte quede donde lo pone un ojo humano.
 */
const WALK_EYE = 0.06;
/** A qué distancia se pone el punto de mira. Corto, para que girar sea mirar. */
const WALK_LOOK = 0.9;

/**
 * LO MÁS HONDO QUE ESTA VISTA LE PIDE A LA PIRÁMIDE.
 *
 * z8 es el último nivel que sale del ráster del MUNDO amplificado por píxel; a
 * partir de z9 la tesela se dibuja sobre el canon de 153 m. La decisión de
 * producto, tomada por Luis (2026-08-11): **el 3D CONSUME, no genera** —
 * «hasta que lo optimicemos de verdad». Así que el techo sube hasta donde la
 * pirámide de este mundo llega, pero cada petición honda viaja con
 * `consumeOnly`: el worker sólo entinta teselas cuyo canon YA es residente
 * (lo generó el 2D, o una pasada anterior), y DECLINA las demás en
 * microsegundos en vez de pagar superteselas de 156 km disparadas desde una
 * rueda del ratón. Frío, la piel se queda exactamente como con el techo z8
 * (el mosaico rellena con los padres); caliente — vienes del 2D mirando esa
 * misma comarca — el bloque sube nítido a canon sin coste de generación.
 */
const zoomSkinMaxZ = (world: WorldData, skin: string): number => {
  let top = SAT_DEEP_Z - 1;
  for (let z = SAT_DEEP_Z; z <= MAX_SAT_TILE_Z; z++) {
    const ok = skin === 'dibujado' ? deepTileSupported(world, z) : satelliteDeepSupported(world, z);
    if (!ok) break;
    top = z;
  }
  return top;
};

/** Cuánto tiene que estarse quieta la cámara antes de recomponer la piel de
 *  cerca. Por debajo de esto se recompone durante el gesto y se nota. */
const ZOOM_SKIN_SETTLE_MS = 150;

/** Cuánto espera el afinado antes de intentar el nivel siguiente, y con qué
 *  presupuesto. Un nivel más son cuatro veces las teselas, así que este techo
 *  —y no el de la primera pasada— es el que decide cuánto trabajo puede pedir
 *  la vista de una sola parada de cámara. */
const ZOOM_SKIN_REFINE_MS = 400;
const ZOOM_SKIN_REFINE_TILES = 160;
const ZOOM_SKIN_REFINE_PX = 4096;

/** El fundido del borde, en fracción de la imagen compuesta. NO es el mismo
 *  número que decide cuándo rehacerla: ver `zoomSkinCovers`, que explica por
 *  qué confundirlos rehace el bloque en cada gesto. */
const ZOOM_SKIN_FADE = 0.05;

/**
 * EL OLEAJE NECESITA FOTOGRAMAS, Y ESO SE PAGA. La decisión, y por qué ésta.
 *
 * El pulso de esta vista sólo dibuja cuando alguien lo pide (`st.need`), y así
 * ha sido siempre: es lo que hace que un mundo quieto cueste CERO. El mar del
 * shader nuevo se mueve con `uTime`, así que sin fotogramas es una foto de un
 * mar — bonita, pero muerta.
 *
 * Las dos salidas obvias son malas:
 *   · Ensuciar la escena en cada tic: sesenta fotogramas por segundo para
 *     siempre. En una vista que se deja abierta mientras se escribe la
 *     gacetilla al lado, eso es la GPU al ralentí durante horas, el ventilador
 *     y la batería, a cambio de un rizado que nadie está mirando.
 *   · Animar sólo mientras la cámara se mueve: el mar se congela EN CUANTO
 *     sueltas el ratón, que es justo el instante en el que el lector se queda
 *     mirando el atardecer. La cosa que hace falta que esté viva es la que se
 *     apaga.
 *
 * Se toma el punto medio, con dos topes medidos:
 *   1. Cualquier señal de que hay alguien —la cámara se mueve, el puntero se
 *      mueve por encima, cambia la hora o la piel— abre una ventana de
 *      SEA_AWAKE_MS. Dentro de ella el mar pide fotogramas él solo; fuera, el
 *      pulso vuelve a cero absoluto. Un lector que se levanta de la silla deja
 *      de gastar seis segundos después, y el fotograma congelado sigue siendo
 *      un fotograma con oleaje dentro.
 *   2. Dentro de la ventana se pide a ~30 Hz, no a 60. El arrastre del oleaje
 *      es lentísimo (0,085 de espacio de muestreo por segundo): a treinta se ve
 *      igual de fluido y cuesta la mitad.
 *   3. Y sólo si el oleaje SE VE. `water.ts` lo apaga entre 3 y 18 km por
 *      píxel; por encima de eso el mar es una lámina lisa y despertar el bucle
 *      no cambiaría un solo píxel. A vista de mapa o de globo, cero fotogramas.
 *
 * `time` se acumula por delta con tope de 0,1 s por fotograma, no se lee del
 * reloj de pared: si se leyera, volver después de un minuto quieto reharía el
 * mar entero de golpe, y un salto así se ve más que la propia animación.
 */
const SEA_AWAKE_MS = 6000;
const SEA_FRAME_MS = 33;
/** Por encima de esto un píxel se come una ola entera. Mismo umbral que el
 *  `waveGate` de water.ts, que es quien de verdad lo apaga en el shader. */
const SEA_KM_PER_PX = 18;

/**
 * LA HORA DEL DÍA, que es lo que el mando del sol quería decir desde el principio.
 *
 * Antes había un azimut de 0 a 360 y una elevación clavada en 38°, escrita en la
 * llamada. Con el fondo gris eso bastaba, porque el sol no existía más que como
 * dirección de sombreado; con un cielo detrás, un mando que gira la luz sin
 * moverla de altura es un sol que el lector VE quieto en el cénit mientras las
 * sombras dan la vuelta al mundo. No hay forma de creérselo.
 *
 * El modelo es el de un sitio de latitud media en equinoccio, que es el que hace
 * falta para que amanecer, mediodía, atardecer y noche estén todos a mano:
 *
 *   ángulo horario  H = (hora - 12) x 15°     — cero al mediodía
 *   sen(elevación)  = 0,87 x cos(H)           — 60° de altura al mediodía
 *   azimut          = 90° + H                 — sale por el este (+x), cruza
 *                                               por el sur (+z), se pone al
 *                                               oeste (-x)
 *
 * A las 6:00 y a las 18:00 el sol queda EXACTAMENTE en el horizonte, que es
 * donde la clave de atardecer del cielo (h = 0,03) da toda la estampa; de 18:00
 * a 19:50 se recorre entero el crepúsculo hasta la noche cerrada.
 *
 * Y el valor por defecto son las 15:00 porque ahí este modelo da az 135°,
 * el 38,0° de elevación — o sea, a cinco grados de azimut del sol que esta vista
 * llevaba clavado (140°, 38°). El fotograma de siempre sigue siendo el fotograma
 * de partida; lo que cambia es que ahora se puede mover.
 */
const SUN_SIN_MAX = 0.87;
const DEG = Math.PI / 180;
function sunAt(hour: number): { az: number; el: number } {
  const H = (hour - 12) * 15;
  const s = Math.max(-1, Math.min(1, SUN_SIN_MAX * Math.cos(H * DEG)));
  return { az: 90 + H, el: Math.asin(s) / DEG };
}

/** La hora, como la lee un reloj. */
function hourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Which brush Ctrl turns each one into. */
const INVERSE: Partial<Record<TerrainOp, TerrainOp>> = {
  raise: 'lower',
  lower: 'raise',
  smooth: 'sharpen',
  sharpen: 'smooth',
  roughen: 'smooth',
  gully: 'smooth',
};

const OP_KEY: Record<TerrainOp, string> = {
  raise: 'worldgen.threeD.op.raise',
  lower: 'worldgen.threeD.op.lower',
  smooth: 'worldgen.threeD.op.smooth',
  sharpen: 'worldgen.threeD.op.sharpen',
  flatten: 'worldgen.threeD.op.flatten',
  terrace: 'worldgen.threeD.op.terrace',
  roughen: 'worldgen.threeD.op.roughen',
  gully: 'worldgen.threeD.op.gully',
  grab: 'worldgen.threeD.op.grab',
};

const OPS: TerrainOp[] = [
  'raise', 'lower', 'smooth', 'sharpen', 'flatten', 'terrace', 'roughen', 'gully', 'grab',
];

/**
 * One HUD style, used by everything that floats over the map.
 *
 * The old chips were `bg-black/45` with `text-white/70` at ten pixels, which over
 * a bright map is somewhere between hard and impossible to read — a control hint
 * you have to squint at is a control hint that does not exist. Near-opaque
 * ground, a light hairline to separate it from whatever is behind, and text at
 * full white.
 */
const HUD = 'rounded-md border border-white/20 bg-[#0b0e14]/92 shadow-lg shadow-black/50 backdrop-blur-sm';
const HUD_TEXT = 'text-[11px] leading-snug text-white';

const RANK_ORDER: Record<string, number> = { capital: 0, city: 1, town: 2, village: 3 };

/** Vector de trabajo del bucle de dibujo. Fuera del bucle porque `draw` corre
 *  sesenta veces por segundo y un `new THREE.Vector3` por fotograma es basura
 *  para el recolector justo en el hilo que está dibujando. Se usa y se consume
 *  dentro del mismo bloque síncrono, así que compartirlo no puede cruzarse. */
const FWD = new THREE.Vector3();

interface ScreenMark {
  x: number;
  y: number;
  kind: 'settlement' | 'waypoint' | 'spatial' | 'fly';
  rank: number;
  label: string;
  color: string;
  settlement?: Settlement;
  waypointId?: string;
  spatial?: WorldSpatialEntity;
  /** Where the name ended up, filled in by the draw. A name is a far bigger
   *  target than a four-pixel dot, and the reader is aiming at the place. */
  hit?: { x0: number; y0: number; x1: number; y1: number };
}

export default function World3D({
  world, geography, canonWorld, canonEdits, theme, waypoints, showWaypoints, showSettlements,
  showLandmarks, showRivers = true, showRoads = true, showBorders = false,
  selectedSpatialKey, onSelectSpatialEntity, regionalEntities = [],
  viewport, onViewportChange,
  skin, shape, onShape, exaggeration, tool, onTool, onEdit, onEdits, revision,
  flyTarget, flyMark = null, onPickSettlement, onPickWaypoint, onPlaceWaypoint, onRemoveWaypoint,
  onZoomTo,
}: World3DProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [mesh, setMesh] = useState(1);
  const [quality, setQuality] = useState<'auto' | 'low' | 'high'>('auto');
  const [cavity, setCavity] = useState(0.5);
  const [headlight, setHeadlight] = useState(false);
  const [shadow, setShadow] = useState(0.55);
  const [contour, setContour] = useState(0);
  /** Ver `sunAt`: las 15:00 reproducen el sol fijo que esta vista tenía. */
  const [hour, setHour] = useState(15);
  /** A CERO por defecto (Luis, 2026-08-11): el ruido de detalle por píxel es
   *  exactamente lo que él describe como «picos y poros» al acercarse. El
   *  suelo de cerca es LISO por decisión; quien quiera el grano inventado
   *  tiene el mando «Detalle de cerca» y se lo sube. */
  const [detailAmt, setDetailAmt] = useState(0);
  /**
   * El paseo, con su espejo en un ref.
   *
   * El estado lo pinta el botón; el ref lo lee `stabilizeCamera`, que corre
   * dentro del bucle de dibujo y no puede depender de que React haya vuelto a
   * renderizar. Es el mismo patrón que `shapeRef` justo aquí al lado, y por la
   * misma razón: un fotograma no espera a nadie.
   */
  const [walking, setWalking] = useState(false);
  /** Vuelve a sembrar la vegetación. Lo pone el efecto de montaje y lo llaman
   *  los tres sitios que rehacen el terreno. */
  const sembrarRef = useRef<(() => void) | null>(null);
  const walkRef = useRef(false);
  walkRef.current = walking;
  // El paseo es del PLANO. En el globo el lector está fuera del planeta, así
  // que no hay suelo sobre el que estar de pie; pasar a globo lo apaga en vez
  // de dejar un botón encendido que no hace nada.
  useEffect(() => { if (shape === 'globe') setWalking(false); }, [shape]);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [panel, setPanel] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  /**
   * GENERACIÓN DE ESCENA, no un booleano. Cada montaje de la escena (el primero
   * y cada cambio de `world`, que la rehace entera) la sube en uno. Con un
   * `true` fijo, regenerar el mundo con el 3D abierto dejaba sin re-ejecutar
   * todos los efectos que sólo dependen de `ready`: la escena nueva nacía sin
   * reloj de rescate (el viejo lo limpia el desmontaje), sin `onZoomArrive`
   * (la piel de cerca no volvía a componer), sin forma, cámara, calidad,
   * malla ni sol aplicados. 0 = aún no hay escena.
   */
  const [ready, setReady] = useState(0);
  const [readout, setReadout] = useState('');
  const [hovering, setHovering] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  /** Qué está pintando el suelo: el ráster de mundo entero, o la pirámide de
   *  teselas sobre la ventana de la cámara y a cuántos metros por píxel. Va en
   *  el HUD porque «se ve borroso» y «todavía no ha llegado» se parecen mucho
   *  desde fuera, y porque es el número que decide si merece la pena acercarse
   *  más. */
  const [skinInfo, setSkinInfo] = useState('');
  /** La chuleta de navegación, detrás del «?» (Luis, 2026-08-12). */
  const [hintsOpen, setHintsOpen] = useState(false);
  /** What the modifier keys are doing to the brush right now. */
  const [modifier, setModifier] = useState<'' | 'smooth' | 'invert'>('');
  const landmarks = useMemo(
    () => resolveWorldLandmarks(world),
    // Edits mutate the same cached object and revision is the React signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, revision],
  );
  const spatialEntities = useMemo(
    () => [...landmarks, ...regionalEntities],
    [landmarks, regionalEntities],
  );

  const R = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    surface: SculptSurface;
    sky: Sky;
    water: Water;
    scatter: Scatter;
    /** La dirección AL sol, la misma que `surface.setSun` construye. */
    sun: THREE.Vector3;
    /** Segundos de oleaje acumulados. No es el reloj de pared: ver el pulso. */
    time: number;
    /** Hasta cuándo el mar tiene derecho a pedir fotogramas él solo. */
    wakeUntil: number;
    /** Si a este encuadre el oleaje se ve; si no, animarlo no cambia un píxel. */
    waves: boolean;
    /** Kilómetros de suelo del ENCUADRE (no de lo visible). Ver el contrato. */
    focusKm: number;
    albedo: THREE.CanvasTexture | null;
    raf: number;
    timer: number;
    need: boolean;
    rafAlive: boolean;
    booked: number;
    cost: number;
    frameAvg: number;
    /** Media del INTERVALO real entre fotogramas encadenados (0 = sin muestra).
     *  `cost`/`frameAvg` cronometran sólo el JavaScript de `draw()`; con
     *  SwiftShader el rasterizado vive en el proceso GPU y el intervalo real
     *  medido fue de 2,0–5,8 s en plano y 15,3 s en globo mientras `frameAvg`
     *  decía 13–15 ms. El vigilante, la escalera de calidad y el amortiguado
     *  comen de ESTE número, no de aquél. */
    frameGapAvg: number;
    /** Arranque del dibujo anterior, para medir el intervalo. */
    lastT0: number;
    /** ¿El dibujo anterior terminó pidiendo otro? Sólo entonces el hueco hasta
     *  este dibujo es un fotograma y no tiempo parado. */
    chained: boolean;
    qualityFrames: number;
    pixelRatio: number;
    hudAt: number;
    lastDraw: number;
    uploadedRev: number;
    skinnedRev: number;
    skinnedKey: string;
    /** El lienzo de la piel de mundo entero. La piel de cerca se rellena
     *  PRIMERO con este trozo ampliado y luego se le pegan las teselas
     *  encima, así que su peor caso es la imagen de siempre y nunca un
     *  agujero negro esperando a que llegue una tesela. */
    albedoCanvas: HTMLCanvasElement | null;
    /** La misma piel SIN ríos: el relleno de la piel de cerca parte de aquí y
     *  los ríos se dibujan a la resolución del bloque, con anchura de suelo.
     *  Nulo en carta y arcilla (la carta trae los suyos; la arcilla no lleva). */
    albedoBase: HTMLCanvasElement | null;
    /** La piel de cerca: qué bloque de teselas cubre, para qué mundo, y en qué
     *  lienzo. `zoomWant` es la última ventana que la malla pidió, que se
     *  compara con el plan para decidir si hay que rehacerlo. */
    zoomPlan: ZoomSkinPlan | null;
    zoomGen: string;
    zoomCanvas: HTMLCanvasElement | null;
    zoomTex: THREE.CanvasTexture | null;
    zoomTimer: number;
    zoomArriveTimer: number;
    zoomRefineTimer: number;
    zoomWant: SkinWindow | null;
    zoomStore: DisplayTileStore;
    zoomInputs: {
      world: WorldData;
      geography: HumanGeography | null;
      canonWorld: WorldData | null;
      canonEdits: string | undefined;
      skin: Skin3D;
      theme: CartoTheme;
      revision: number;
      showRivers: boolean;
      showRoads: boolean;
      showBorders: boolean;
    };
    onZoomArrive: () => void;
    composeZoom: (plan: ZoomSkinPlan) => void;
    /** The world this camera was last framed for. A different one is a
     *  different planet, and its framing has to start over. */
    posedWorld: WorldData | null;
    unshadedAtlas: Uint8ClampedArray | null;
    poseKey: string;
    viewportKey: string;
    viewportAt: number;
    viewportTimer: number;
    pendingViewport: WorldViewport | null;
    marks: ScreenMark[];
    fly: { active: boolean; t: number; startedAt: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromC: THREE.Vector3; toC: THREE.Vector3 };
  } | null>(null);

  const gesture = useRef<SculptGesture | null>(null);
  /** Cells the pointer has passed through, for the brushes that are not sculpts. */
  const trail = useRef<Pt[] | null>(null);
  const cursor = useRef<Pt | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean; button: number } | null>(null);
  const altRef = useRef(false);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const mirrorRef = useRef({ x: mirrorX, y: mirrorY });
  mirrorRef.current = { x: mirrorX, y: mirrorY };
  const keys = useRef({ shift: false, ctrl: false });
  const over = useRef(false);
  const propsRef = useRef({
    geography,
    waypoints,
    showWaypoints,
    showSettlements,
    showLandmarks,
    // La chincheta viaja por el ref, como todo lo que el fotograma lee sin
    // querer reconstruirse: `projectMarks` la mira dentro del dibujo.
    flyMark,
    spatialEntities,
    selectedSpatialKey,
    onSelectSpatialEntity,
    onViewportChange,
    onPickSettlement,
    onPickWaypoint,
    onPlaceWaypoint,
    onRemoveWaypoint,
    onZoomTo,
  });
  propsRef.current = {
    geography,
    waypoints,
    showWaypoints,
    showSettlements,
    showLandmarks,
    flyMark,
    spatialEntities,
    selectedSpatialKey,
    onSelectSpatialEntity,
    onViewportChange,
    onPickSettlement,
    onPickWaypoint,
    onPlaceWaypoint,
    onRemoveWaypoint,
    onZoomTo,
  };

  /** Every brush takes the left button; only two of them move ground. */
  const brushing = tool.mode !== 'off';
  const brushingRef = useRef(brushing);
  brushingRef.current = brushing;
  const sculpting = isSculptMode(tool.mode);
  const sculptingRef = useRef(sculpting);
  sculptingRef.current = sculpting;

  // ---- scene ---------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    const initialPixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
    renderer.setPixelRatio(initialPixelRatio);
    renderer.setSize(Math.max(2, host.clientWidth), Math.max(2, host.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setFailed(translate('worldgen.threeD.contextLost'));
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    // SIN `scene.background`. Era `0x0e1116`: un rectángulo gris, y un
    // rectángulo gris no tiene horizonte. Sin horizonte el ojo no tiene contra
    // qué medir la distancia y todo queda a la misma profundidad, que es la
    // profundidad de una maqueta. Ahora el fondo es el cielo de `sculpt/sky.ts`
    // —un triángulo a pantalla completa, dibujado el primero y sin profundidad—
    // así que el buffer de color siempre acaba cubierto y nadie ve el negro del
    // clear.
    const scene = new THREE.Scene();

    // A narrow field of view: perspective distorts the very thing you are
    // judging — whether a slope is steeper than the one beside it.
    //
    // El near arranca en 0,25 y no en 0,02. El buffer de profundidad reparte
    // su precisión por el COCIENTE far/near, no por la diferencia: 0,02 a
    // 6000 son trescientos mil a uno, y con eso la plataforma continental
    // —que está a un pelo del nivel del mar— y el plano de agua caen en el
    // mismo valor de profundidad y parpadean uno contra otro. Eso es el
    // z-fighting del agua. A 0,25 el cociente baja a veinticuatro mil a uno,
    // doce veces más precisión, y además el `draw` reajusta ambos planos a la
    // distancia real de la cámara en cada frame (ver más abajo).
    const camera = new THREE.PerspectiveCamera(32, 1, 0.25, 6000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.zoomSpeed = 0.9;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // The pump only draws when something asks it to, and a wheel handled by
    // OrbitControls asks nobody: the camera moved and the picture did not, so
    // zooming looked frozen until the reader happened to move the mouse as well.
    // Marking the frame dirty is enough — the rescue clock picks it up next tick.
    controls.addEventListener('change', () => {
      if (!R.current) return;
      R.current.need = true;
      // Y el mar se despierta: ver SEA_AWAKE_MS. Mover la cámara es la señal
      // más fiable de que hay alguien delante de la pantalla.
      R.current.wakeUntil = performance.now() + SEA_AWAKE_MS;
    });

    const palette: [number, number, number][] = [];
    for (let i = 0; i < BIOME_COUNT; i++) {
      const c = BIOME_COLORS[i] ?? [128, 128, 128];
      palette.push([c[0] / 255, c[1] / 255, c[2] / 255]);
    }

    let surface: SculptSurface;
    try {
      surface = new SculptSurface({
        worldWidth: world.width, worldHeight: world.height, mesh: MESH_STEPS[1], palette,
      });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      // Fuera el oyente ANTES de perder el contexto: `forceContextLoss`
      // dispara `webglcontextlost` y su `setFailed` taparía la causa real con
      // «contexto perdido». Y el lienzo fuera del host, como en el desmontaje.
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      renderer.dispose();
      // Igual que en el desmontaje: sin esto el contexto WebGL del intento
      // fallido sigue reteniendo memoria del proceso GPU.
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      return;
    }
    surface.uploadAll(world.elevation, world.biome);
    scene.add(surface.mesh);
    /**
     * SEMBRAR VA CON SUBIR EL TERRENO.
     *
     * Los cuatro sitios que llaman a `uploadAll` son exactamente los cuatro en
     * los que el suelo ha cambiado: el montaje, el fin de una pincelada, el
     * deshacer y el cambio de mundo. Si la siembra no fuera con ellos, un
     * bosque se quedaría flotando sobre el valle que el lector acaba de excavar.
     *
     * `temperature` va porque el límite del arbolado del atlas ya está ajustado
     * por altitud, y sin él un mundo cálido saca bosque por encima de donde el
     * mapa ya pinta nieve. `heightAt` va contra la SUPERFICIE y no contra la
     * retícula: con un parche canónico atado el terreno sube hasta un kilómetro
     * y las plantas quedarían enterradas.
     */
    const sembrar = () => {
      const st = R.current;
      const sf = st ? st.surface : surface;
      const sc = st ? st.scatter : scatter;
      sc.setWorld({
        elevation: world.elevation, biome: world.biome,
        width: world.width, height: world.height,
        yMul: sf.yMul, seaLevel: 0,
        temperature: world.temperature,
        heightAt: (u: number, v: number) => sf.heightAtUV(u, v),
      });
    };
    // La PRIMERA siembra no se hace aquí: `scatter` se crea más abajo, después
    // del agua, y llamarla ya daba `Cannot access 'scatter' before
    // initialization` — el banco del componente real lo cazó en la primera
    // pasada. Se guarda el cierre y se dispara en cuanto el módulo existe.
    sembrarRef.current = sembrar;

    // EL CIELO Y EL AGUA, que antes eran un color de fondo y un plano azul al
    // 50 % de opacidad.
    //
    // Lo que se va: un `MeshBasicMaterial` —Basic significa SIN LUZ: ignoraba
    // el sol, la cámara y el fondo— sobre un plano del tamaño exacto del mundo,
    // así que el océano se acababa en un canto recto a ciento veinte unidades
    // del centro, a la vista de todos. Lo que llega: dos módulos con su propio
    // shader, ya medidos por separado (`harness/out/sky-water/*.png`), que se
    // encargan de Fresnel, orilla, destello y lejanía.
    //
    // El agua sigue a la cámara y se escala con el far en cada `update`, así que
    // aquí no lleva tamaño: se le dice de qué mundo es (la semilla decide la
    // fase del oleaje, para que dos mundos no tengan el mar en el mismo sitio) y
    // el resto lo hace ella.
    const sky = createSky({ renderer });
    scene.add(sky.mesh);
    const sizeZ = SIZE_X * (world.height / world.width);
    const water = createWater({
      seed: world.params.seed, sizeX: SIZE_X, sizeZ, radius: R_GLOBE,
    });
    water.globe.visible = false;
    scene.add(water.plane);
    scene.add(water.globe);
    scene.add(water.lakePlane, water.lakeGlobe);
    water.setWorld(world);

    /**
     * Y LO QUE CRECE ENCIMA.
     *
     * Se añade a la escena sin más: el módulo se coloca solo entre el terreno y
     * el agua, y a encuadre de planeta no dibuja ni una instancia — el color
     * del atlas ya lleva los bosques, y una mota de tres píxeles por árbol es
     * grano sucio, no un bosque.
     */
    const scatter = createScatter({
      seed: world.params.seed, sizeX: SIZE_X, sizeZ, radius: R_GLOBE,
    });
    scene.add(scatter.group);
    sembrar();

    // El almacén de teselas: mismo tipo, mismo protocolo y mismo worker que usa
    // el 2D. Nace aquí para que su vida sea la de la escena.
    const zoomStore = new DisplayTileStore(
      (key: TileKey) => {
        const q = R.current?.zoomInputs;
        if (!q || !q.geography || q.skin === 'arcilla') return Promise.resolve(null);
        const carta = q.skin === 'dibujado';
        // Handed back whole, so the store can cancel a tile the camera has
        // already turned away from instead of queueing behind it.
        // Por el SERVICIO (ARQUITECTURA-TESELAS §3.1), y las hondas con la
        // identidad de CONTENIDO (mundo prístino del canon + ediciones), la
        // misma que usa el 2D: una tesela que el 2D ya entintó se comparte o
        // llega del almacén de entintadas en milisegundos — antes el 3D pedía
        // por el objeto editado y ni el canon caliente ni el disco le valían.
        const deep = key.z >= (carta ? DEEP_TILE_Z : SAT_DEEP_Z)
          && !!q.canonWorld && q.geography.depth === 'full';
        const req = serveTile(deep ? q.canonWorld! : q.world, q.geography, key, {
          ink: carta ? 'carta' : 'satellite',
          themeId: carta ? q.theme.id : 'satellite',
          layers: { rivers: q.showRivers, roads: q.showRoads, borders: q.showBorders, fields: true },
          density: 1,
          reliefAmount: 1,
          // `?? ''`: hondo sin ediciones sigue siendo contenido direccionable
          // (ver la nota gemela en Map2D — el `s:r3` del log de Luis).
          edits: deep ? (q.canonEdits ?? '') : undefined,
          // EL 3D CONSUME (decisión de Luis, 2026-08-11): una tesela honda
          // sólo se entinta si su canon ya es residente en el worker; si no,
          // el worker la declina al instante. Ninguna rueda de ratón paga
          // superteselas de 156 km desde esta vista. (El almacén de
          // entintadas responde ANTES de este contrato: un disco que acierta
          // no molesta al worker.)
          consumeOnly: true,
        });
        return {
          promise: req.promise.then((res) => res?.bitmap ?? null).catch(() => null),
          cancel: req.cancel,
        };
      },
      () => R.current?.onZoomArrive(),
      // LA RESERVA TIENE QUE PASAR DEL BLOQUE MÁS GRANDE POSIBLE. Si no, el
      // afinado desaloja teselas que todavía necesita y se queda pidiendo las
      // mismas para siempre. El techo del afinado son 160; esto le deja sitio
      // a ése y a los dos niveles anteriores, que es lo que hace que volver
      // sobre tus pasos sea instantáneo.
      400,
    );

    const st = {
      renderer, scene, camera, controls, surface, sky, water, scatter,
      // La misma que `setSun(az, el)` arma; el efecto de la hora la rellena
      // antes del primer dibujo. Aquí, mediodía largo, por si acaso.
      sun: new THREE.Vector3(0, 1, 0),
      time: 0, wakeUntil: 0, waves: false, focusKm: EARTH_KM,
      albedo: null as THREE.CanvasTexture | null,
      raf: 0, timer: 0, need: true, rafAlive: true, booked: 0, cost: 16,
      frameAvg: 16, frameGapAvg: 0, lastT0: 0, chained: false,
      qualityFrames: 0, pixelRatio: initialPixelRatio, hudAt: 0, lastDraw: 0,
      uploadedRev: revision, skinnedRev: -1, skinnedKey: '', poseKey: '', viewportKey: '',
      albedoCanvas: null as HTMLCanvasElement | null,
      albedoBase: null as HTMLCanvasElement | null,
      zoomPlan: null as ZoomSkinPlan | null,
      zoomGen: '', zoomCanvas: null as HTMLCanvasElement | null,
      zoomTex: null as THREE.CanvasTexture | null, zoomTimer: 0, zoomArriveTimer: 0, zoomRefineTimer: 0,
      zoomWant: null as SkinWindow | null,
      zoomStore,
      zoomInputs: {
        world, geography: geography ?? null,
        canonWorld: canonWorld ?? null, canonEdits, skin, theme, revision,
        showRivers, showRoads, showBorders,
      },
      onZoomArrive: () => undefined,
      composeZoom: (() => undefined) as (plan: ZoomSkinPlan) => void,
      unshadedAtlas: null,
      posedWorld: null as WorldData | null,
      viewportAt: 0, viewportTimer: 0, pendingViewport: null,
      marks: [] as ScreenMark[],
      fly: {
        active: false, t: 0, startedAt: 0,
        fromT: new THREE.Vector3(), toT: new THREE.Vector3(),
        fromC: new THREE.Vector3(), toC: new THREE.Vector3(),
      },
    };
    R.current = st;
    setReady((n) => n + 1);

    const resize = () => {
      const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      st.need = true;
      st.poseKey = '';
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    return () => {
      ro.disconnect();
      window.clearInterval(st.timer);
      window.clearTimeout(st.viewportTimer);
      window.clearTimeout(st.zoomTimer);
      window.clearTimeout(st.zoomArriveTimer);
      window.clearTimeout(st.zoomRefineTimer);
      if (st.raf) cancelAnimationFrame(st.raf);
      controls.dispose();
      surface.dispose();
      zoomStore.dispose();
      st.albedo?.dispose();
      st.zoomTex?.dispose();
      sky.dispose();
      water.dispose();
      scatter.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
      /**
       * Y SOLTAR EL CONTEXTO DE VERDAD. `dispose()` libera los recursos de
       * three, pero el contexto WebGL vive hasta que el recolector pase por el
       * lienzo — y con SwiftShader eso es memoria del proceso GPU retenida
       * mientras la siguiente vista intenta abrir SU contexto: el banco de
       * arranque midió `getContext('2d')` devolviendo null en Map2D justo
       * después de desmontar el 3D (el hallazgo «forceContextLoss que falta»
       * anotado en el corredor). Perderlo aquí devuelve la memoria ya.
       */
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      R.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---- where things are, in the scene and on the screen --------------------
  const sizeZ = SIZE_X * (world.height / world.width);

  /** Scene position of a world cell, matching the shader's `placeAt` exactly. */
  const scenePos = useCallback((cx: number, cy: number, out: THREE.Vector3): THREE.Vector3 => {
    const st = R.current;
    if (!st) return out.set(0, 0, 0);
    const e = st.surface.heightAtCell(cx, cy);
    const yMul = st.surface.yMul;
    if (shapeRef.current === 'plane') {
      return out.set(
        (cx / world.width - 0.5) * SIZE_X,
        e * yMul,
        (cy / world.height - 0.5) * sizeZ,
      );
    }
    const lon = (cx / world.width - 0.5) * Math.PI * 2;
    const lat = (0.5 - cy / world.height) * Math.PI;
    const r = R_GLOBE + e * yMul * 0.55;
    return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
  }, [world.width, world.height, sizeZ]);

  const stabilizeCamera = useCallback((): boolean => {
    const st = R.current;
    if (!st) return false;
    /**
     * Separación mínima sobre el suelo. Eran veinte kilómetros, que con el
     * suelo de acercamiento en mil doscientos no se notaba nunca; con el suelo
     * en ciento cincuenta es lo que impide rasar el terreno. Luego seis.
     *
     * Y ahora ESCALA, que es lo único que cambia: los seis kilómetros eran una
     * constante (0,035 unidades) puesta cuando el suelo del vano estaba en 10
     * km, y con el suelo en 0,25 km habrían dejado la cámara a seis kilómetros
     * de altura mirando un pueblo de 250 metros — o sea, habrían anulado el
     * descenso entero sin fallar por ningún lado. Con `min(0,035, dist)` el
     * comportamiento por encima del suelo viejo es EXACTAMENTE el de antes
     * (allí `near·4` ya valía `dist` y mandaba él), y por debajo la misma
     * geometría, escalada.
     *
     * Lo que NO cambia hoy, a propósito: el ángulo. `near·4 = dist` obliga a
     * mirar desde unos 58° sobre el horizonte en cuanto te acercas, así que la
     * órbita no rasa aunque la piel ya lo permita. Bajar ese ángulo es un
     * cambio de tacto en una vista que Luis ya dio por buena, y para ir a ras
     * de suelo está el PASEO. Queda anotado, no hecho.
     */
    const orbitDist = st.camera.position.distanceTo(st.controls.target);
    const clearance = Math.max(st.camera.near * 4, Math.min(0.035, orbitDist));
    /**
     * EN PASEO MANDA LA ESTATURA, NO LA ÓRBITA.
     *
     * La cámara se pega al suelo a la altura de los ojos y el punto de mira se
     * pone delante, a la misma altura, así que el orbitador gira la vista en
     * vez de rodear el paisaje. Se hace ANTES del posado normal y se sale: el
     * posado normal sube la cámara para que no rase el terreno, que es justo
     * lo contrario de lo que aquí se quiere.
     */
    if (walkRef.current && shapeRef.current === 'plane') {
      const c = st.camera.position;
      const u = c.x / SIZE_X + 0.5, v = c.z / sizeZ + 0.5;
      const eye = Math.max(0, Math.max(st.surface.heightAtUV(u, v), lakeHeightAtUV(st.zoomInputs.world, u, v)) * st.surface.yMul) + WALK_EYE;
      const moved = Math.abs(c.y - eye) > 1e-4;
      c.y = eye;
      // El punto de mira, delante y a los ojos. Se conserva el RUMBO que tenía
      // el orbitador: si se recolocara a ciegas, cada fotograma daría un tirón
      // hacia el norte y no se podría mirar a ningún otro sitio.
      const t = st.controls.target;
      let dx = t.x - c.x, dz = t.z - c.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-5) { dx = 0; dz = -1; } else { dx /= l; dz /= l; }
      const pitch = l > 1e-5 ? (t.y - c.y) / l : 0;
      t.set(c.x + dx * WALK_LOOK, c.y + pitch * WALK_LOOK, c.z + dz * WALK_LOOK);
      return moved;
    }
    if (shapeRef.current === 'plane') {
      const targetU = st.controls.target.x / SIZE_X + 0.5;
      const targetV = st.controls.target.z / sizeZ + 0.5;
      const targetGround = Math.max(
        0,
        Math.max(st.surface.heightAtUV(targetU, targetV), lakeHeightAtUV(st.zoomInputs.world, targetU, targetV)) * st.surface.yMul,
      );
      let changed = false;
      const targetShift = targetGround - st.controls.target.y;
      if (Math.abs(targetShift) > 1e-4) {
        st.controls.target.y += targetShift;
        st.camera.position.y += targetShift;
        changed = true;
      }
      const cameraU = st.camera.position.x / SIZE_X + 0.5;
      const cameraV = st.camera.position.z / sizeZ + 0.5;
      return clampCameraToSurface(
        st.camera.position,
        'plane',
        Math.max(st.surface.heightAtUV(cameraU, cameraV), lakeHeightAtUV(st.zoomInputs.world, cameraU, cameraV)),
        st.surface.yMul,
        clearance,
      ) || changed;
    }

    const radius = st.camera.position.length();
    if (radius < 1e-7) {
      return clampCameraToSurface(
        st.camera.position,
        'globe',
        0,
        st.surface.yMul,
        clearance,
      );
    }
    const latitude = Math.asin(Math.min(1, Math.max(-1, st.camera.position.y / radius)));
    const u = Math.atan2(st.camera.position.z, st.camera.position.x) / (Math.PI * 2) + 0.5;
    const v = 0.5 - latitude / Math.PI;
    return clampCameraToSurface(
      st.camera.position,
      'globe',
      Math.max(st.surface.heightAtUV(u, v), lakeHeightAtUV(st.zoomInputs.world, u, v)),
      st.surface.yMul,
      clearance,
    );
  }, [sizeZ]);

  /**
   * The dots and their labels, projected for this frame.
   *
   * Deliberately NOT three.js sprites. A sprite per settlement is a texture per
   * settlement, rebuilt every time a name changes and re-uploaded every time the
   * exaggeration slider moves; and sprite text is a picture of text, so it goes
   * soft the moment you lean in — which is exactly when you are reading it. On a
   * 2D canvas over the frame the labels are real text at device resolution, and
   * they cost one projection each.
   */
  const projectMarks = useCallback((): ScreenMark[] => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return [];
    const {
      geography: geo,
      waypoints: wps,
      showWaypoints: sw,
      showSettlements: ss,
      showLandmarks: sl,
      spatialEntities: entities,
    } = propsRef.current;
    const w = host.clientWidth, h = host.clientHeight;
    const out: ScreenMark[] = [];
    const p = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const marca = propsRef.current.flyMark;

    /** Project, cull, and place. Returns null when the point is not on screen. */
    const place = (cx: number, cy: number): { x: number; y: number } | null => {
      scenePos(cx, cy, p);
      if (shapeRef.current === 'globe') {
        // The far side of a planet is behind the planet.
        camDir.copy(st.camera.position).sub(p);
        if (p.dot(camDir) <= 0) return null;
      }
      p.project(st.camera);
      if (p.z > 1 || p.x < -1.08 || p.x > 1.08 || p.y < -1.08 || p.y > 1.08) return null;
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };

    /**
     * La chincheta va la PRIMERA, y es lo único de aquí que no se gana el
     * sitio: el descarte por amontonamiento (`fits`, en el dibujo) recorre
     * esta lista en orden y el primero que pasa se queda el hueco. Si la
     * llegada se colocara al final, buscar un sitio en una comarca poblada te
     * llevaría hasta él para tapar su nombre con el de un pueblo vecino.
     */
    if (marca) {
      const at = place(marca.x, marca.y);
      if (at) {
        out.push({
          x: at.x, y: at.y, kind: 'fly', rank: -2,
          label: marca.name, color: '#ffd479',
        });
      }
    }
    if (ss && geo) {
      // How much of the world is on screen decides how much of the gazetteer
      // is worth drawing: every village at full zoom is a grey smear, and only
      // the capitals at close range is a map with nothing on it.
      const win = st.surface.uvWindow.size;
      const profile = semanticZoomProfile(win * 40075);
      const maxRank = profile.settlementRank;
      const ranked = geo.settlements
        .filter((s) => (RANK_ORDER[s.rank] ?? 3) <= maxRank)
        .sort((a, b) => (RANK_ORDER[a.rank] ?? 3) - (RANK_ORDER[b.rank] ?? 3))
        .slice(0, Math.min(96, profile.labelBudget));
      for (const s of ranked) {
        const at = place(s.x, s.y);
        if (!at) continue;
        out.push({
          x: at.x, y: at.y, kind: 'settlement',
          rank: RANK_ORDER[s.rank] ?? 3,
          label: s.name, color: '#f2e3c4', settlement: s,
        });
      }
    }
    if (sl) {
      const profile = semanticZoomProfile(st.surface.uvWindow.size * 40075);
      const ranked = entities
        .filter((entity) => !entity.hidden)
        .filter((entity) => entity.source !== 'regional' || profile.showRegionalTerrain)
        .filter((entity) => profile.showMinorLandmarks || entity.importance >= 0.26)
        .sort((a, b) => b.importance - a.importance)
        .slice(0, Math.min(120, profile.labelBudget));
      for (const entity of ranked) {
        const at = place(entity.x, entity.y);
        if (!at) continue;
        out.push({
          x: at.x,
          y: at.y,
          kind: 'spatial',
          rank: entity.source === 'regional' ? 3 : 2,
          label: entity.name,
          color: entity.style.color ?? '#e4a853',
          spatial: entity,
        });
      }
    }
    if (sw) {
      for (const wp of wps) {
        const at = place(wp.u * world.width, wp.v * world.height);
        if (!at) continue;
        out.push({
          x: at.x, y: at.y, kind: 'waypoint', rank: -1,
          label: wp.name, color: wp.color, waypointId: wp.id,
        });
      }
    }
    // Arrival and authored pins reserve their names before generated places.
    return out.sort((a, b) => a.rank - b.rank);
  }, [scenePos, world.width, world.height]);

  const drawOverlay = useCallback((marks: ScreenMark[]) => {
    const oc = overlayRef.current;
    const host = hostRef.current;
    if (!oc || !host) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
    if (oc.width !== Math.round(w * dpr) || oc.height !== Math.round(h * dpr)) {
      oc.width = Math.round(w * dpr);
      oc.height = Math.round(h * dpr);
      oc.style.width = `${w}px`;
      oc.style.height = `${h}px`;
    }
    const ctx = oc.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    /**
     * Labels that would collide are not drawn.
     *
     * Without this the far view is a hedge of overlapping names — thirty of them
     * across a continent, each one making the next unreadable, which is worse
     * than showing five. Biggest place first (the list is already rank-sorted),
     * so what survives a crowd is what a real map would have kept.
     */
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const fits = (x0: number, y0: number, x1: number, y1: number): boolean => {
      if (x0 < 3 || y0 < 3 || x1 > w - 3 || y1 > h - 3) return false;
      for (const r of taken) {
        if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return false;
      }
      taken.push({ x0, y0, x1, y1 });
      return true;
    };

    for (const m of marks) {
      if (m.kind === 'fly') {
        const r1 = drawArrivalMark(ctx, m.x, m.y, m.color);
        // El nombre RESERVA su hueco (`fits`) pero se dibuja pase lo que pase:
        // es lo que el lector tecleó para llegar aquí.
        ctx.font = '600 12px "Source Sans 3", system-ui, sans-serif';
        const tw = ctx.measureText(m.label).width;
        const lx = Math.max(5, Math.min(w - tw - 5, m.x + r1 + 6));
        fits(lx - 2, m.y - 9, lx + tw + 2, m.y + 9);
        label(ctx, m.label, lx, m.y, 12, m.color);
        m.hit = { x0: m.x - r1, y0: m.y - r1, x1: lx + tw + 3, y1: m.y + r1 };
        continue;
      }
      if (m.kind === 'waypoint') {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - 5, m.y - 13);
        ctx.lineTo(m.x + 5, m.y - 13);
        ctx.closePath();
        ctx.fillStyle = m.color;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(6,8,13,0.9)';
        ctx.stroke();
        // A pin the reader placed always keeps its name: they put it there.
        ctx.font = '500 11px "Source Sans 3", system-ui, sans-serif';
        const pw = ctx.measureText(m.label).width;
        const lx = Math.max(5, Math.min(w - pw - 5, m.x - pw / 2));
        for (const ly of [m.y - 22, m.y + 18]) {
          if (fits(lx - 2, ly - 8, lx + pw + 2, ly + 8)) {
            label(ctx, m.label, lx, ly, 11, m.color);
            break;
          }
        }
        continue;
      }
      if (m.kind === 'spatial' && m.spatial) {
        const entity = m.spatial;
        const selected = entity.key === propsRef.current.selectedSpatialKey;
        const symbolScale = Math.min(2.4, Math.max(0.65, entity.style.size ?? 1));
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.scale(symbolScale, symbolScale);
        ctx.beginPath();
        if ((entity.style.icon ?? entity.type) === 'volcano') {
          ctx.moveTo(0, -6);
          ctx.lineTo(5.5, 4);
          ctx.lineTo(-5.5, 4);
          ctx.closePath();
        } else if ((entity.style.icon ?? entity.type) === 'cave') {
          ctx.arc(0, 2, 5, Math.PI, 0);
          ctx.closePath();
        } else {
          ctx.moveTo(0, -5);
          ctx.lineTo(5, 0);
          ctx.lineTo(0, 5);
          ctx.lineTo(-5, 0);
          ctx.closePath();
        }
        ctx.fillStyle = entity.style.color ?? (
          entity.type === 'volcano' ? '#a94b3f' : '#e4a853'
        );
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = selected ? '#fff1bd' : 'rgba(6,8,13,0.92)';
        ctx.stroke();
        ctx.restore();
        if (selected) {
          ctx.beginPath();
          ctx.arc(m.x, m.y, 9 * symbolScale, 0, Math.PI * 2);
          ctx.strokeStyle = '#f5c66a';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const alwaysLabel = entity.style.labelVisible
          || selected
          || entity.source !== 'regional'
          || R.current!.surface.uvWindow.size < 0.035;
        m.hit = {
          x0: m.x - 10 * symbolScale,
          y0: m.y - 10 * symbolScale,
          x1: m.x + 10 * symbolScale,
          y1: m.y + 10 * symbolScale,
        };
        if (alwaysLabel) {
          ctx.font = '600 11px "Source Sans 3", system-ui, sans-serif';
          const tw = ctx.measureText(m.label).width;
          const lx = m.x + 8 * symbolScale + tw + 3 < w ? m.x + 8 * symbolScale : m.x - 8 * symbolScale - tw;
          if (fits(lx - 2, m.y - 8, lx + tw + 2, m.y + 8)) {
            label(ctx, m.label, lx, m.y, 11, entity.style.color ?? '#f6efe0');
            m.hit = { x0: m.x - 8, y0: m.y - 10, x1: lx + tw + 3, y1: m.y + 10 };
          }
        }
        continue;
      }
      const big = m.rank <= 1;
      const r = m.rank === 0 ? 5 : m.rank === 1 ? 4 : m.rank === 2 ? 3 : 2.2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fillStyle = m.rank === 0 ? '#ffd479' : '#f4ead4';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(6,8,13,0.92)';
      ctx.stroke();
      if (m.rank === 0) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,212,121,0.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      const size = big ? 12 : 11;
      ctx.font = `${size >= 12 ? 600 : 500} ${size}px "Source Sans 3", system-ui, sans-serif`;
      const tw = ctx.measureText(m.label).width;
      const lx = m.x + r + 5 + tw + 3 < w ? m.x + r + 5 : m.x - r - 5 - tw;
      m.hit = undefined;
      if (fits(lx - 2, m.y - size * 0.7, lx + tw + 2, m.y + size * 0.7)) {
        label(ctx, m.label, lx, m.y, size, '#f6efe0');
        m.hit = { x0: lx - 3, y0: m.y - size, x1: lx + tw + 3, y1: m.y + size };
      }
    }

    // The stroke IN FLIGHT for the brushes that are not sculpts. The sculpt
    // pair previews itself by actually moving the ground; biome and river had
    // NOTHING between button-down and the committed result. One translucent
    // polyline, projected the same way the marks were, closes that gap.
    const st = R.current;
    const tr = trail.current;
    const bt = toolRef.current;
    if (st && tr && tr.length > 0 && (bt.mode === 'biome' || bt.mode === 'river')) {
      const pv = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      const place2 = (cx: number, cy: number): { x: number; y: number } | null => {
        scenePos(cx, cy, pv);
        if (shapeRef.current === 'globe') {
          camDir.copy(st.camera.position).sub(pv);
          if (pv.dot(camDir) <= 0) return null;
        }
        pv.project(st.camera);
        if (pv.z > 1) return null;
        return { x: (pv.x * 0.5 + 0.5) * w, y: (-pv.y * 0.5 + 0.5) * h };
      };
      const a0 = place2(tr[0].x, tr[0].y);
      const a1 = place2(tr[0].x + 1, tr[0].y);
      const pxPerCell = a0 && a1 ? Math.max(0.5, Math.hypot(a1.x - a0.x, a1.y - a0.y)) : 4;
      const tint = bt.mode === 'biome'
        ? `rgba(${(BIOME_COLORS[bt.biome] ?? [120, 160, 90]).join(',')},0.5)`
        : 'rgba(64,124,196,0.55)';
      const wCells = bt.mode === 'river' ? Math.max(0.8, bt.riverWidth) : bt.radius * 2;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tint;
      ctx.fillStyle = tint;
      ctx.lineWidth = Math.max(2, wCells * pxPerCell);
      ctx.beginPath();
      let started = false;
      for (const q of tr) {
        const s2 = place2(q.x, q.y);
        if (!s2) { started = false; continue; }
        if (!started) { ctx.moveTo(s2.x, s2.y); started = true; } else ctx.lineTo(s2.x, s2.y);
      }
      ctx.stroke();
      if (tr.length === 1) {
        const s2 = place2(tr[0].x, tr[0].y);
        if (s2) {
          ctx.beginPath();
          ctx.arc(s2.x, s2.y, Math.max(1.5, (wCells / 2) * pxPerCell), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // ---- la escala y la brújula ---------------------------------------------
    /**
     * EL 3D NO DECÍA A QUÉ ESCALA ESTABA, NI POR DÓNDE CAÍA EL NORTE.
     *
     * El 2D lleva su barra de escala desde la pasada de cohesión; ésta la vista
     * PRINCIPAL (Luis, en mayúsculas: «el mapa 3D es el que más importa») y no
     * tenía ninguna de las dos. Sin escala, un valle y un continente son la
     * misma mancha verde con un río; y sin norte, en cuanto orbitas medio giro
     * ya no sabes si ese río va al mar del sur o baja de las montañas del
     * norte — un problema que el 2D no tiene porque allí el norte es arriba
     * SIEMPRE, y por eso nadie había echado de menos la brújula.
     *
     * Van sobre la capa de rótulos, en la esquina de abajo a la derecha: la de
     * abajo a la izquierda la ocupan el reloj de fotograma y el «?», y la de
     * arriba a la derecha los mandos de piel y forma. El levantón de 52 px deja
     * libre el mando de exageración, que lo pone WorldView encima de esta vista.
     */
    const stF = R.current;
    if (stF) {
      const kmPorPx = stF.focusKm / Math.max(1, w);
      drawScreenScaleBar(ctx, {
        kmPerPx: kmPorPx,
        align: 'right',
        edge: w - 12,
        bottom: h - 52,
        format: (km) => (km >= 1
          ? translate('worldgen.paint.units.km')
            .replace('{n}', String(km >= 1000 ? Math.round(km) : km))
          : translate('worldgen.paint.units.m')
            .replace('{n}', String(Math.round(km * 1000)))),
      });
      /**
       * La aguja es sólo del PLANO, y en el globo NO es que falte.
       *
       * En la esfera el norte del punto que se está mirando es la tangente de
       * su meridiano, y esa tangente es exactamente el eje Y de la cámara —
       * porque el orbitador mantiene «arriba» clavado en +Y. Su proyección
       * cae siempre en la vertical de la pantalla (el aspecto de la ventana se
       * cancela entre las dos tangentes del campo). Es decir: **en el globo el
       * norte está SIEMPRE arriba**, igual que en el 2D, y una aguja que sólo
       * puede señalar hacia arriba es decoración que tapa mapa. Demostrado en
       * `northOnGlobe` y medido contra una cámara de verdad en el banco.
       */
      if (shapeRef.current === 'plane') {
        const norte = northOnScreen(
          stF.controls.target.x - stF.camera.position.x,
          stF.controls.target.z - stF.camera.position.z,
        );
        if (norte) {
          drawScreenCompass(ctx, {
            x: w - 30, y: h - 100, r: 13,
            northX: norte.x, northY: norte.y,
            letter: translate('worldgen.threeD.compass.n'),
          });
        }
      }
    }
  }, [scenePos]);

  const flushViewport = useCallback(() => {
    const st = R.current;
    if (!st || !st.pendingViewport) return;
    const next = st.pendingViewport;
    st.pendingViewport = null;
    st.viewportAt = performance.now();
    st.viewportTimer = 0;
    propsRef.current.onViewportChange?.(next);
  }, []);

  const queueViewport = useCallback((next: WorldViewport) => {
    const st = R.current;
    if (!st) return;
    st.pendingViewport = next;
    const wait = VIEWPORT_REPORT_MS - (performance.now() - st.viewportAt);
    if (wait <= 0) {
      if (st.viewportTimer) window.clearTimeout(st.viewportTimer);
      flushViewport();
    } else if (!st.viewportTimer) {
      st.viewportTimer = window.setTimeout(flushViewport, wait);
    }
  }, [flushViewport]);

  // ---- the frame pump ------------------------------------------------------
  //
  // A window whose only content is a static canvas can stop being composited,
  // and then `requestAnimationFrame` never fires again — which wedged this view
  // shut once already, with a frozen picture and a brush that changed the data
  // without changing the image. The pump runs whenever the controls report
  // change and idles otherwise, with a rescue clock behind it.
  const drawRef = useRef<() => void>(() => {});
  const request = useCallback(() => {
    const st = R.current;
    if (!st) return;
    st.need = true;
    if (document.hidden) return;
    if (!st.rafAlive || st.raf) return;
    st.booked = performance.now();
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      drawRef.current();
    });
  }, []);

  // ---- la piel de cerca ------------------------------------------------------
  //
  // LA PIEL DE ARRIBA ES UNA SOLA IMAGEN DEL MUNDO ENTERO. Da igual lo buena
  // que sea: tiene un téxel por celda, o sea veinte kilómetros de suelo, y
  // acercarse no revela nada porque no hay nada más dentro. Eso es lo que se ve
  // como biomas y ríos pixelados en cuanto la cámara baja.
  //
  // Debajo de esta línea el 3D deja de tener una textura y pasa a tener la
  // MISMA PIRÁMIDE DE TESELAS QUE EL 2D. Mismo worker, misma caché, misma
  // tinta: lo que el lector acaba de mirar en el mapa plano ya está caliente
  // cuando lo mira en relieve, y una ventana de mil doscientos kilómetros pasa
  // de 2048 píxeles para todo el planeta a 2048 píxeles para lo que se está
  // mirando — unos seiscientos metros por píxel, que es exactamente lo que mide
  // un píxel de pantalla ahí.
  //
  // Tres decisiones sostienen esto, y las tres vienen de haberlo roto antes:
  //
  //   · LA DE MUNDO ENTERO NO SE QUITA. Se queda debajo, y la de cerca se funde
  //     encima con un borde suave. Sustituirla es lo que se intentó la vez que
  //     no salió: en cuanto la malla se sale de la ventana el muestreo se pega
  //     al borde y embarra medio planeta. Así, el peor caso es la imagen de
  //     siempre.
  //   · EL BLOQUE VA SNAPEADO A LA REJILLA DE TESELAS (`planZoomSkin`). La
  //     imagen no cubre "la ventana": cubre un número entero de teselas enteras
  //     que la contienen. Así cada tesela cae en un píxel entero y a su tamaño,
  //     el mosaico no se remuestrea nunca, y el cuadrado de mundo que representa
  //     es un borde de tesela, que `tileView` ya define exacto. No queda ningún
  //     origen fraccionario en toda la cadena.
  //   · LA VENTANA QUE MANDA ES LA QUE `setWindow` DEVUELVE, no la que se le
  //     pide: recorta v fuera de los polos y pone suelo al tamaño. Alinear
  //     contra la petición es un desfase que sólo se nota de cerca.
  //
  // Medido en `harness/zoom-align.tsx`: el desfase entre esta pintura y la de
  // mundo entero es de 0,003–0,013 celdas de mundo en plano, globo, junto al
  // polo y cruzando la costura — o sea cero, hasta donde llega la medida.
  // Lo que la pirámide necesita saber de las props vive en el estado del
  // renderizador, no en un cierre: el almacén de teselas nace con la escena y
  // muere con ella, y las peticiones que salgan de él tienen que ver el mundo
  // de AHORA, no el del fotograma en que se creó.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.zoomInputs = {
      world, geography: geography ?? null,
      canonWorld: canonWorld ?? null, canonEdits, skin, theme, revision,
      showRivers, showRoads, showBorders,
    };
  }, [world, geography, canonWorld, canonEdits, skin, theme, revision, ready, showRivers, showRoads, showBorders]);

  const composeZoomSkin = useCallback((plan: ZoomSkinPlan) => {
    const st = R.current;
    if (!st) return;
    const w = st.zoomInputs.world;
    let canvas = st.zoomCanvas;
    if (!canvas || canvas.width !== plan.width || canvas.height !== plan.height) {
      canvas = document.createElement('canvas');
      canvas.width = plan.width;
      canvas.height = plan.height;
      st.zoomCanvas = canvas;
      st.zoomTex?.dispose();
      st.zoomTex = null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. EL SUELO: la piel de mundo entero, ampliada a este trozo. Es la imagen
    //    de hoy, y es lo que garantiza que ninguna tesela que tarde deje un
    //    agujero negro sobre el relieve. Por trozos, porque la ventana puede
    //    cruzar la costura y el lienzo de origen no se envuelve solo.
    //    SIN RÍOS cuando hay versión sin ellos (`albedoBase`): un río cocido a
    //    resolución de mundo y ampliado ×8 es la cinta gorda que Luis
    //    fotografió; aquí se rellena la base limpia y los ríos se dibujan
    //    después A LA RESOLUCIÓN DEL BLOQUE, con su anchura de suelo.
    const base = st.albedoBase ?? st.albedoCanvas;
    if (base) {
      const kx = base.width / w.width;
      const ky = base.height / w.height;
      let x = plan.view.x;
      const end = plan.view.x + plan.view.w;
      while (x < end - 1e-6) {
        const wrapped = ((x % w.width) + w.width) % w.width;
        const run = Math.min(end - x, w.width - wrapped);
        ctx.drawImage(
          base,
          wrapped * kx, plan.view.y * ky, run * kx, plan.view.h * ky,
          ((x - plan.view.x) / plan.view.w) * plan.width, 0,
          (run / plan.view.w) * plan.width, plan.height,
        );
        x += run;
      }
    }

    // 1b. LOS RÍOS DEL RELLENO, a anchura honesta. Sólo para la piel satélite
    //     (la carta lleva los suyos dibujados en su propia lámina): la MISMA
    //     rutina que usan las teselas someras, así el relleno y las teselas
    //     que van llegando encima hablan un único idioma y el ancho del río no
    //     depende de a qué distancia esté la cámara.
    if (st.albedoBase && st.zoomInputs.skin !== 'dibujado' && st.zoomInputs.showRivers) {
      drawWorldRivers(w, ctx, plan.view, plan.width);
    }

    // 2. LAS TESELAS ENCIMA: exactas donde las hay, el cuarto de un ancestro
    //    escalado donde todavía no. Nunca bloquea, nunca deja hueco.
    const got = st.zoomStore.draw(
      ctx, w, plan.z, plan.view, { x: 0, y: 0, w: plan.width, h: plan.height },
    );
    /**
     * EL SUELO DE NITIDEZ BAJO «CONSUME». Un plan hondo con el canon frío se
     * declina ENTERO (contrato consumeOnly) y este lienzo se quedaría en el
     * albedo ampliado — peor que el techo z8 que había antes, que es
     * exactamente lo que Luis fotografió: mancha borrosa con un río gordo.
     * El último nivel SOMERO (z8 en satélite, z9 en carta) no toca canon y
     * nunca se declina: se pide SIEMPRE como respaldo del mismo encuadre — se
     * pide PRIMERO, para que el pool fabrique antes lo que seguro se va a ver
     * — y el paseo por antepasados de `draw` lo funde bajo las teselas hondas
     * que sí lleguen. Ambos niveles se declaran en un solo plan atómico para
     * que ninguno cancele o invalide la deduplicación del otro.
     */
    const floorZ = (st.zoomInputs.skin === 'dibujado' ? DEEP_TILE_Z : SAT_DEEP_Z) - 1;
    st.zoomStore.wantPlan(w, plan.z > floorZ
      ? [{ z: floorZ, view: plan.view }, { z: plan.z, view: plan.view }]
      : [{ z: plan.z, view: plan.view }]);

    const mPerPx = (plan.view.w * (EARTH_KM / w.width) * 1000) / plan.width;
    const done = got.exact >= got.needed;

    // 2b. LAS CIUDADES DEL RELLENO. «Coloca las ciudades» (Luis, 2026-08-11):
    //     a 25 km una casa mide menos de un píxel, así que en el suelo del 3D
    //     la ciudad es su MANCHA — la misma mancha parda que inkan las teselas
    //     hondas, pero dibujada aquí desde la geografía, en el hilo principal
    //     y EN FRÍO, para que el consumo (que declina el canon frío) nunca
    //     deje el suelo sin pueblos. Va ENCIMA de las teselas y no en el
    //     relleno porque el respaldo somero z8 (que se pide SIEMPRE, ver
    //     arriba) tapa el bloque entero en cuanto llega y se llevaría por
    //     delante cualquier mancha pintada debajo. Sólo se retira cuando
    //     TODAS las teselas del plan son exactas y de un nivel que ya trae su
    //     propia mancha o sus tejados: ≤160 m/px, la MISMA puerta que abre
    //     `drawBuildings` en la tesela honda — así el relevo es un cambio de
    //     pincel, no una aparición.
    const geo = st.zoomInputs.geography;
    if (geo && st.zoomInputs.skin !== 'dibujado') {
      const inked = done && plan.z >= SAT_DEEP_Z && satelliteDeepSupported(w, plan.z);
      if (!(inked && mPerPx <= 160)) {
        drawTownStains(ctx, geo.settlements, {
          worldWidth: w.width, worldHeight: w.height,
          view: plan.view, width: plan.width, height: plan.height,
          metresPerCell: (EARTH_KM / w.width) * 1000,
        });
      }
      // 2c. LOS CAMINOS, la misma capa y el mismo fundido que el 2D
      //     (`roadOverlayAlpha`): enteros hasta que las teselas inken calzadas
      //     reales, y sólo si el plan está entero — bajo consumo un canon frío
      //     declina las hondas, y sin la condición `done` el fundido borraría
      //     los caminos justo cuando no hay tesela que los traiga. Por copias
      //     este–oeste, como toda capa lineal: la ventana puede cruzar la
      //     costura y `unwrapRoad` deja cada camino en la copia [0, W).
      const roadAlpha = roadOverlayAlpha(inked ? satPxPerCanonCell(w, plan.z) : 0);
      if (st.zoomInputs.showRoads && roadAlpha > 0.01 && geo.roads.length) {
        const s = plan.width / plan.view.w;
        const k0 = Math.floor(plan.view.x / w.width);
        const k1 = Math.floor((plan.view.x + plan.view.w) / w.width);
        for (let k = k0; k <= k1; k++) {
          const ox = (k * w.width - plan.view.x) * s;
          const oy = -plan.view.y * s;
          drawRoadNetwork(ctx, geo.roads, {
            worldWidth: w.width, worldHeight: w.height,
            toScreen: (u, v) => [ox + u * w.width * s, oy + v * w.height * s],
            width: plan.width, height: plan.height,
            pxPerCell: s, alpha: roadAlpha,
            linear: { ox, oy, scale: s },
          });
        }
      }
    }

    if (geo && st.zoomInputs.showBorders && geo.realms.length) {
      const segments = realmBorders(w, geo);
      const scale = plan.width / plan.view.w;
      for (let k = Math.floor(plan.view.x / w.width); k <= Math.floor((plan.view.x + plan.view.w) / w.width); k++) {
        const ox = (k * w.width - plan.view.x) * scale;
        const oy = -plan.view.y * scale;
        drawRealmBorders(ctx, segments, {
          worldWidth: w.width, worldHeight: w.height,
          toScreen: (u, v) => [ox + u * w.width * scale, oy + v * w.height * scale],
          width: plan.width, height: plan.height, pxPerCell: scale,
          view: { ...plan.view, x: plan.view.x - k * w.width },
          linear: { ox, oy, scale },
        });
      }
    }

    let tex = st.zoomTex;
    if (!tex) {
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      // v = 0 es la fila norte, igual que en la piel de mundo entero.
      tex.flipY = false;
      // La ventana NO se envuelve: el shader ya la recorta y no muestrea fuera.
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = Math.min(8, st.renderer.capabilities.getMaxAnisotropy());
      st.zoomTex = tex;
    } else {
      tex.needsUpdate = true;
    }
    st.zoomPlan = plan;
    st.surface.setZoomSkin(tex, plan.window, ZOOM_SKIN_FADE);
    setSkinInfo(translate('worldgen.threeD.skinInfo')
      .replace('{z}', String(plan.z))
      .replace('{nx}', String(plan.nx))
      .replace('{ny}', String(plan.ny))
      + (mPerPx >= 1000 ? `${(mPerPx / 1000).toFixed(1)} km/px` : `${Math.round(mPerPx)} m/px`)
      + (done ? '' : ` · ${got.exact}/${got.needed}`)
      // DEBUG (temporal, Luis 2026-08-12): el techo del plan, el contrato, y
      // los contadores de sesión — «declinadas» creciendo = el canon de este
      // suelo no existe aún (el 2D no lo generó y el almacén no lo tiene).
      + (DEBUG_HUD
        ? ` · DEBUG techo z${zoomSkinMaxZ(st.zoomInputs.world, st.zoomInputs.skin)}`
        + ` · consume · vano ${Math.round(st.focusKm)} km (mín ${MIN_3D_SPAN_KM})`
        + ` · sesión: ${tileStats.delivered} entregadas · ${tileStats.declined} declinadas`
        + ` · ${Math.max(0, tileStats.asked - tileStats.delivered - tileStats.declined
          - tileStats.errors - tileStats.timeouts)} en vuelo${oldestInFlightMs() > 3000
          ? ` (${Math.round(oldestInFlightMs() / 1000)} s)` : ''}`
        + ` · ${tileStats.seeded} sembradas · ${tileStats.errors} errores · ${tileStats.timeouts} caducadas`
        + (tileStats.fabErrors ? ` · FÁBRICA-ERR ${tileStats.fabErrors}` : '')
        : ''));
    request();

    // AFINADO ENCADENADO. Cuando el bloque está entero, se intenta el nivel
    // siguiente sobre el mismo encuadre: la imagen se va poniendo nítida
    // mientras la miras, como cualquier mapa deslizante, en vez de quedarse en
    // el nivel más hondo que cupo de una sentada. Sólo cuando ya no falta
    // ninguna tesela, para que refinar nunca compita con terminar lo que hay.
    if (done && plan.z < zoomSkinMaxZ(st.zoomInputs.world, st.zoomInputs.skin) && !st.zoomRefineTimer) {
      st.zoomRefineTimer = window.setTimeout(() => {
        st.zoomRefineTimer = 0;
        const want = st.zoomWant;
        const cur = st.zoomPlan;
        if (!want || !cur || cur.z !== plan.z) return;
        const deeper = planZoomSkin(st.zoomInputs.world, want, {
          maxZ: cur.z + 1,
          // Un nivel más hondo son cuatro veces las teselas: el presupuesto del
          // afinado es más ancho que el de la primera pasada a propósito, y es
          // el que pone el techo de verdad.
          maxTiles: ZOOM_SKIN_REFINE_TILES,
          maxPx: ZOOM_SKIN_REFINE_PX,
          // Margen mínimo: si la cámara se mueve, la siguiente posada replanea
          // desde cero de todas formas, y aquí cada punto de margen cuesta una
          // fila entera de teselas.
          margin: 0.03,
        });
        // Por `st`, no por el nombre: llamarse a sí misma desde dentro de su
        // propio `useCallback` es una referencia al binding que se está
        // definiendo, y el linter de hooks tiene razón en no quererla.
        if (deeper && deeper.z > cur.z) st.composeZoom(deeper);
      }, ZOOM_SKIN_REFINE_MS);
    }
  }, [request]);

  /**
   * Decide si la piel de cerca sigue valiendo, y si no, la rehace cuando la
   * cámara se pare.
   *
   * Se llama desde el propio bucle de dibujo con la ventana que la malla
   * ACABA de recibir, así que las dos no pueden desincronizarse. Rehacerla
   * cuesta pegar teselas ya hechas — milisegundos — pero la cámara se mueve
   * sesenta veces por segundo y el gesto es lo único que no puede esperar, así
   * que se hace al posarse y no antes.
   */
  const scheduleZoomSkin = useCallback((mesh: SkinWindow) => {
    const st = R.current;
    if (!st) return;
    const q = st.zoomInputs;
    const off = () => {
      window.clearTimeout(st.zoomTimer);
      window.clearTimeout(st.zoomRefineTimer);
      st.zoomTimer = 0;
      st.zoomRefineTimer = 0;
      if (st.zoomPlan || st.surface.hasZoomSkin) {
        st.zoomPlan = null;
        st.surface.setZoomSkin(null);
        setSkinInfo('');
        request();
      }
    };
    // A vista de planeta la piel de mundo entero YA es más fina que la
    // pantalla: pedir teselas ahí es gastar por nada.
    if (!q.geography || q.skin === 'arcilla' || !(mesh.uSize <= MAX_ZOOM_SKIN_SPAN)) {
      off();
      return;
    }
    const gen = `${mapSourceKey(q.world, q.geography, q.canonEdits ?? '')}:${q.revision}:${q.skin}:${q.theme.id}:${q.showRivers}:${q.showRoads}:${q.showBorders}`;
    if (gen !== st.zoomGen) {
      st.zoomGen = gen;
      st.zoomStore.setGeneration(gen, worldFamilyKey(q.world));
      st.zoomPlan = null;
      st.surface.setZoomSkin(null);
    }
    st.zoomWant = mesh;
    if (st.zoomPlan && zoomSkinCovers(st.zoomPlan, mesh)) return;
    window.clearTimeout(st.zoomTimer);
    window.clearTimeout(st.zoomRefineTimer);
    st.zoomRefineTimer = 0;
    st.zoomTimer = window.setTimeout(() => {
      st.zoomTimer = 0;
      const want = st.zoomWant;
      if (!want) return;
      const plan = planZoomSkin(st.zoomInputs.world, want, {
        maxZ: zoomSkinMaxZ(st.zoomInputs.world, st.zoomInputs.skin),
      });
      if (!plan) { off(); return; }
      // Rehacer el bloque que ya está puesto no cambia un píxel, y con la
      // prueba de tamaño de `zoomSkinCovers` eso pasaría en cada posada.
      if (samePlan(plan, st.zoomPlan)) return;
      composeZoomSkin(plan);
    }, ZOOM_SKIN_SETTLE_MS);
  }, [composeZoomSkin, request]);

  // Las teselas llegan en ráfagas; recomponer es pegar imágenes ya hechas, así
  // que se agrupan en un fotograma y ya está.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.composeZoom = composeZoomSkin;
    st.onZoomArrive = () => {
      if (!st.zoomPlan || st.zoomArriveTimer) return;
      // EL RITMO DEPENDE DEL TAMAÑO DEL LIENZO. Recomponer sube la textura
      // entera a la tarjeta: a 45 ms sobre un bloque afinado de once megapíxeles
      // eso son cuarenta megas cada dos fotogramas, que es más tráfico del que
      // cuesta dibujar la escena. Un bloque pequeño se refresca casi al vuelo;
      // uno grande, unas cuantas veces mientras se llena.
      const px = (st.zoomCanvas?.width ?? 0) * (st.zoomCanvas?.height ?? 0);
      st.zoomArriveTimer = window.setTimeout(() => {
        st.zoomArriveTimer = 0;
        if (st.zoomPlan) composeZoomSkin(st.zoomPlan);
      }, Math.min(1200, 60 + px / 12000));
    };
  }, [composeZoomSkin, ready]);

  // Una pincelada, otra piel o un mundo nuevo invalidan lo compuesto sin que la
  // cámara se mueva, así que el bucle de dibujo no se entera solo.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.zoomPlan = null;
    st.surface.setZoomSkin(null);
    scheduleZoomSkin(focusWindow(
      st.camera, st.controls.target, shapeRef.current,
      world.width, world.height, st.surface.uvWindow,
    ));
  }, [world, revision, skin, theme, geography, ready, scheduleZoomSkin, showRivers, showRoads, showBorders]);

  const draw = useCallback(() => {
    const st = R.current;
    if (!st) return;
    if (document.hidden) { st.need = true; return; }
    st.need = false;
    const t0 = performance.now();

    // EL FOTOGRAMA DE VERDAD. El intervalo entre dos dibujos ENCADENADOS (el
    // anterior terminó pidiendo otro) es lo que dura un fotograma en esta
    // máquina, rasterizado incluido — que `cost`, más abajo, no ve. El hueco
    // entre dos ráfagas separadas es tiempo parado y no se muestrea.
    if (st.chained && st.lastT0 > 0) {
      const gap = t0 - st.lastT0;
      st.frameGapAvg = st.frameGapAvg > 0 ? st.frameGapAvg * 0.8 + gap * 0.2 : gap;
    }
    st.lastT0 = t0;

    // El reloj del oleaje. POR DELTA Y CON TOPE, no leído del reloj de pared:
    // el mar se congela cuando nadie mira (ver SEA_AWAKE_MS), y con un reloj
    // absoluto volver un minuto después rehacía el mar entero de un salto —
    // un salto que se ve muchísimo más que la propia animación. Con el tope de
    // 0,1 s por fotograma, la pausa más larga cuesta una décima de ola.
    st.time += st.lastDraw ? Math.min(0.1, Math.max(0, (t0 - st.lastDraw) / 1000)) : 0;

    if (st.fly.active) {
      st.fly.t = flightProgress(st.fly.startedAt, t0, FLIGHT_MS);
      const s = st.fly.t < 0.5 ? 2 * st.fly.t * st.fly.t : 1 - Math.pow(-2 * st.fly.t + 2, 2) / 2;
      st.controls.target.lerpVectors(st.fly.fromT, st.fly.toT, s);
      st.camera.position.lerpVectors(st.fly.fromC, st.fly.toC, s);
      if (st.fly.t >= 1) st.fly.active = false;
      st.need = true;
    }
    const moving = st.controls.update();
    if (stabilizeCamera()) st.need = true;

    // ---- profundidad, ajustada a lo que se está mirando ---------------------
    // Un near y un far fijos tienen que cubrir a la vez el planeta entero y una
    // sierra vista desde encima, y el buffer de profundidad no da para las dos
    // cosas. Aquí se recalculan cada frame a partir de la distancia real al
    // objetivo: el near a una centésima de esa distancia (bastante margen para
    // que nada se recorte por delante) y el far justo lo que hace falta para
    // que el mundo quepa. El cociente se queda en el orden de mil a uno pase lo
    // que pase, y a esa precisión el agua y la plataforma continental dejan de
    // discutir a cualquier altura.
    {
      const dist = st.camera.position.distanceTo(st.controls.target);
      // El suelo del near baja con la distancia: 0,05 fijo estaba pensado para
      // encuadres de ≥150 km; con el suelo del lector en 25 km la cámara llega
      // a ~0,15 unidades del objetivo y un near de 0,05 recortaba el terreno
      // que tienes delante. Nunca por encima del 25 % de la distancia, nunca
      // por debajo del 1 % — y el buffer logarítmico absorbe el cociente.
      const near = Math.max(Math.min(0.05, dist * 0.25), Math.min(dist * 0.01, 2));
      const far = Math.max(dist * 4 + SIZE_X * 1.5, SIZE_X * 3);
      if (Math.abs(st.camera.near - near) > near * 0.05
        || Math.abs(st.camera.far - far) > far * 0.05) {
        st.camera.near = near;
        st.camera.far = far;
        st.camera.updateProjectionMatrix();
      }
    }

    // The UV window: the grid is stretched over what the camera can see, so the
    // triangles are spent where the reader is looking instead of on the far side
    // of the world. Recomputed only when the camera actually moved.
    const c = st.camera;
    const key = `${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)},`
      + `${st.controls.target.x.toFixed(2)},${st.controls.target.y.toFixed(2)},${st.controls.target.z.toFixed(2)}`;
    if (key !== st.poseKey) {
      st.poseKey = key;
      const nextWindow = visibleWindow(c, shapeRef.current, world.width, world.height);
      // LA VENTANA QUE MANDA ES LA QUE DEVUELVE, no la que se pide: recorta v
      // fuera de los polos y pone suelo al tamaño. Todo lo que tenga que caer
      // sobre la malla —la piel de cerca, la primera— tiene que usar el retorno.
      const meshWindow = st.surface.setWindow(nextWindow);
      // La malla se estira sobre TODO lo visible; la piel de cerca cubre lo que
      // se está MIRANDO. No son lo mismo en cuanto la cámara se inclina, y
      // repartir dos mil píxeles de textura entre el suelo y el horizonte es
      // dárselos al horizonte. Ver `focusWindow`.
      const focus = focusWindow(
        c, st.controls.target, shapeRef.current, world.width, world.height, meshWindow,
      );
      scheduleZoomSkin(focus);
      st.surface.setCamera(c.position);
      const cpq = st.surface.cellsPerQuad(MESH_STEPS[mesh]);
      const km = Math.round((40075 / world.width) * cpq);
      if (t0 - st.hudAt > 220) {
        /**
         * Y CUÁNTAS PLANTAS, CON SU COSTE.
         *
         * Sin este número, un fotograma que se va de 14 a 3 100 ms al añadir la
         * vegetación no se puede atribuir: podría ser la siembra, el dibujo, o
         * la varianza del rasterizador por software del banco. Un contador que
         * dice CUÁNTAS instancias hay y CUÁNTO costó sembrarlas separa las tres
         * cosas en un vistazo, y es lo primero que se mira cuando alguien dice
         * que el 3D va lento.
         */
        const veg = st.scatter.stats();
        setDetail((cpq < 1
          ? translate('worldgen.threeD.trianglesPerCell').replace('{n}', (1 / cpq).toFixed(1))
          : translate('worldgen.threeD.cellsPerTriangle')
            .replace('{n}', cpq.toFixed(1))
            .replace('{km}', String(km)))
          + (veg.instances > 0
            ? ` · ${translate('worldgen.threeD.plants')
              .replace('{n}', String(veg.instances))
              .replace('{ms}', veg.ms.toFixed(1))}`
            : ''));
      }
      // ---- EL CONTRATO DE LA CÁMARA COMPARTIDA -----------------------------
      //
      // Lo que se manda es el ENCUADRE, no lo que se alcanza a ver. Son dos
      // números distintos y se estaba mandando el que no era:
      //
      //   · `visibleWindow` es la caja que ENVUELVE todo lo que hay en pantalla,
      //     con un 35 % de margen encima. Una cámara inclinada mete el horizonte
      //     dentro, así que esa caja incluye tierra a la que el lector no está
      //     mirando y que ocupa doce píxeles de alto. Medido en la misma pose:
      //     0,324 de mundo.
      //   · `focusWindow` es el trozo que cabe en la pantalla a la distancia del
      //     objetivo de la órbita, o sea lo que el lector diría que está
      //     mirando. En esa misma pose: 0,067 x 0,152.
      //
      // Mandar el primero significaba que inclinar el 3D y pasarse al 2D te
      // sacaba unas CINCO VECES más lejos de lo que esperabas, y como la cámara
      // es compartida, al volver ya no estabas donde lo dejaste. Este contrato
      // dice ahora «a esto estoy mirando», que es lo que las dos vistas
      // necesitan compartir y lo que la piel de cerca ya usaba desde el
      // principio (mismo `focus`, dos líneas más arriba: una sola verdad).
      //
      // El lado largo, y no el ancho a secas: `spanKm` es horizontal por
      // contrato, pero una vista inclinada abarca más suelo A LO LARGO de la
      // mirada que a lo ancho, y quedarse con el ancho encuadraría MENOS de lo
      // que se estaba viendo. Errar por encima es recuperable; errar por debajo
      // es perderse.
      const focusKm = Math.max(
        focus.uSize * EARTH_KM,
        focus.vSize * EARTH_KM * (world.height / world.width),
      );
      st.focusKm = focusKm;
      const viewportKey = `${focus.u.toFixed(5)}:${focus.v.toFixed(5)}:${focusKm.toFixed(2)}`;
      if (viewportKey !== st.viewportKey) {
        st.viewportKey = viewportKey;
        queueViewport({
          u: ((focus.u % 1) + 1) % 1,
          v: focus.v,
          spanKm: Math.max(MIN_SPAN_KM, focusKm),
        });
      }
    }

    // ---- el cielo, el mar, y el aire que hay entre medias -------------------
    //
    // Los tres se ponen al día JUNTOS y en este orden, justo antes de dibujar,
    // porque los tres cuelgan del mismo sol: el cielo resuelve su tabla de color
    // a partir de la altura del sol, y el agua y la niebla del terreno le
    // preguntan al cielo YA RESUELTO de qué color es el horizonte. Al revés —o
    // un fotograma tarde— el mar reflejaría el cielo del fotograma anterior, que
    // al girar deprisa se ve como un horizonte que resbala sobre el suelo.
    //
    // `spanKm` sale de la ventana de la MALLA (todo lo visible) y no del
    // encuadre: lo único que el cielo hace con él es decidir si el lector tiene
    // delante un horizonte o un planeta entero, y para eso lo que cuenta es lo
    // que se alcanza a ver.
    const spanKm = st.surface.uvWindow.size * EARTH_KM;
    st.sky.update({ camera: c, sun: st.sun, shape: shapeRef.current, spanKm });
    // ¿Hay oleaje que animar en este encuadre? El shader del agua lo apaga entre
    // 3 y 18 km por píxel; por encima de eso el mar es una lámina lisa y pedir
    // fotogramas para moverla es gastar batería en no cambiar nada. En el globo,
    // nunca: se ve el planeta entero de una vez.
    //
    // SE MIDE CON EL ENCUADRE, NO CON `spanKm`. `visibleWindow` devuelve el
    // mundo ENTERO en cuanto un rayo de esquina se escapa por encima del
    // horizonte — que es exactamente lo que pasa con la cámara a ras de mar,
    // o sea justo donde el oleaje es la mitad del fotograma. Con spanKm este
    // gate daba 36 km/px en la pose de costa y apagaba la animación en la única
    // pose donde importa.
    const px = Math.max(1, hostRef.current?.clientWidth ?? 1);
    st.waves = shapeRef.current === 'plane' && st.focusKm / px < SEA_KM_PER_PX;

    // LA DIRECCIÓN VA APLANADA, y esto es un fallo medido, no una precaución.
    // Con la dirección de la vista tal cual, una cámara que mira un poco hacia
    // abajo —o sea, casi siempre— le pide al cielo el color que hay POR DEBAJO
    // del horizonte, que está oscurecido un 28 % a propósito; y entonces la
    // lejanía del mar y el reflejo del oleaje se van a gris: el mar entero
    // moteado de plomo bajo un cielo naranja. Y hay que aplanar CON GUARDIA:
    // mirando a plomo —la vista de mapa, o el polar mínimo de la órbita— el
    // aplanado da el vector cero, y normalizar eso son tres NaN que se propagan
    // al color del horizonte y de ahí a media pantalla.
    c.getWorldDirection(FWD);
    FWD.y = 0;
    if (FWD.lengthSq() < 1e-9) FWD.set(0, 0, 1); else FWD.normalize();
    const horizon = st.sky.horizonColor(FWD);
    const skyForWater = st.sky.waterSky();

    // La luz del terreno, del mismo cielo que se está pintando.
    const light = st.sky.sunLight();
    st.surface.setSunLight(light.color, light.intensity, light.ambient);

    // La distancia de la niebla. ES LA MISMA CUENTA QUE EL AGUA SE HACE POR
    // DENTRO (ver `update` en water.ts): escala con la ALTURA sobre el agua y no
    // con la distancia de la mirada, con suelo en el 6 % del mundo para que una
    // cámara pegada al mar no tiña de horizonte lo que tiene delante, y techo en
    // ocho mundos. Se copia a mano porque el agua no la expone; si los dos
    // números se separan, la costa lejana se parte en dos a lo largo de la
    // orilla, la mitad fundida al cielo y la mitad todavía saturada.
    const seaY = 0;   // el nivel del mar de esta vista, en unidades de escena
    const camH = Math.max(0.05, Math.abs(c.position.y - seaY));
    const fogDist = Math.min(6 * Math.max(camH, SIZE_X * 0.06), SIZE_X * 8);
    st.surface.setFog(
      horizon, skyForWater.horizonWarm, fogDist, shapeRef.current === 'plane',
    );

    st.water.setWorld(st.zoomInputs.world);
    st.water.update({
      camera: c,
      sun: st.sun,
      time: st.time,
      horizon,
      // El MISMO R32F que desplaza la malla: la orilla del agua y la costa del
      // terreno salen del mismo campo, así que la espuma no puede quedar ni un
      // téxel tierra adentro.
      heightTex: st.surface.heightTexture,
      gridW: world.width,
      gridH: world.height,
      yMul: st.surface.yMul,
      seaLevel: 0,
      sky: skyForWater,
    });

    /**
     * LA VEGETACIÓN, CON EL MISMO AIRE QUE TODO LO DEMÁS.
     *
     * Después del cielo, porque la luz y el horizonte salen de él, y con la
     * ventana de la MALLA — que es el suelo que de verdad se está dibujando —
     * en vez de con el encuadre. `heightAt` va contra la superficie y no contra
     * la retícula: cuando hay un parche canónico atado, el terreno sube hasta
     * un kilómetro y las plantas se quedarían enterradas.
     */
    st.scatter.update({
      camera: c,
      sun: st.sun,
      shape: shapeRef.current,
      spanKm,
      window: st.surface.uvWindow,
      time: st.time,
      horizon,
      sun3: light,
      horizonWarm: skyForWater.horizonWarm,
    });

    /**
     * GIRAR EL GLOBO DE CERCA NO PUEDE IR TAN RÁPIDO COMO DE LEJOS.
     *
     * `OrbitControls` gira en ÁNGULO: un mismo arrastre son los mismos grados
     * de latitud tanto si estás a un radio de distancia como si tienes el morro
     * en la corteza. Pero el suelo que barren esos grados no es el mismo — a
     * ras de superficie unos pocos grados son medio continente — así que de
     * cerca la cámara se dispara y no hay forma de mirar un sitio concreto.
     * Reportado por el lector, y es la queja correcta.
     *
     * La velocidad pasa a escalar con la ALTURA sobre la superficie, que es lo
     * que traduce grados a kilómetros de suelo. Suelo en 0,12 para que quien se
     * pega del todo pueda seguir moviéndose, y techo en 1 para no acelerar
     * nunca por encima de lo que había — desde lejos el comportamiento es
     * exactamente el de antes.
     *
     * El plano no lo necesita: allí el arrastre ya es panorámica y traslación,
     * que son lineales en la distancia por construcción.
     */
    if (shapeRef.current === 'globe') {
      const dist = c.position.length();
      const alto = Math.max(0, dist - R_GLOBE) / R_GLOBE;
      st.controls.rotateSpeed = Math.max(0.12, Math.min(1, alto * 1.1));
    } else if (st.controls.rotateSpeed !== 1) {
      st.controls.rotateSpeed = 1;
    }

    st.renderer.render(st.scene, st.camera);
    st.marks = projectMarks();
    drawOverlay(st.marks);

    const cost = performance.now() - t0;
    st.cost = cost;
    st.frameAvg = st.frameAvg * 0.9 + cost * 0.1;
    // EL NÚMERO QUE MANDA: el intervalo real entre fotogramas si hay muestra,
    // el coste de JS sólo como arranque. El HUD decía «13–15 ms» en una máquina
    // que entregaba un fotograma cada 15 s (medido con SwiftShader en globo), y
    // los tres mecanismos de abajo hacían lo contrario de lo que debían:
    // la escalera SUBÍA el pixelRatio a 0,07 fps y el amortiguado no se
    // apagaba nunca.
    const frameMs = st.frameGapAvg > 0 ? st.frameGapAvg : st.frameAvg;
    st.qualityFrames += 1;
    st.lastDraw = performance.now();
    if (t0 - st.hudAt > 220) {
      st.hudAt = t0;
      setMs(Math.round(frameMs));
    }
    // Las 24 muestras que pide la escalera son 0,4 s a 60 fps — y DOCE MINUTOS
    // en una máquina de 30 s por fotograma, que es justo la que más necesita
    // bajar. Con tres fotogramas por encima de dos segundos la evidencia sobra
    // (PENDIENTE §1.2): el intervalo real ya viene de dibujos encadenados, así
    // que no puede ser una pausa del usuario disfrazada de fotograma lento.
    const settled = st.qualityFrames >= 24
      || (st.frameGapAvg > 2000 && st.qualityFrames >= 3);
    if (qualityRef.current === 'auto' && settled) {
      const maxDpr = Math.min(2, window.devicePixelRatio || 1);
      if (frameMs > 30) {
        if (st.pixelRatio > 0.85) {
          st.pixelRatio = Math.max(0.85, st.pixelRatio - 0.15);
          st.renderer.setPixelRatio(st.pixelRatio);
        }
        st.qualityFrames = 0;
      } else if (frameMs < 17 && st.qualityFrames >= 110) {
        if (st.pixelRatio < maxDpr) {
          st.pixelRatio = Math.min(maxDpr, st.pixelRatio + 0.15);
          st.renderer.setPixelRatio(st.pixelRatio);
        }
        st.qualityFrames = 0;
      }
    }
    // Damping is a per-FRAME decay, so it silently assumes sixty of them a
    // second. Below a usable frame rate the camera goes where it is put.
    // Se decide con el fotograma REAL: con `cost` (sólo JS, 13–15 ms medidos a
    // 0,07 fps) esta condición no se desactivaba jamás.
    st.controls.enableDamping = frameMs < 40;
    if (moving) st.need = true;
    // Para el muestreo del intervalo: ¿este dibujo terminó pidiendo otro?
    st.chained = st.need;
  }, [
    world.width,
    world.height,
    mesh,
    projectMarks,
    drawOverlay,
    queueViewport,
    scheduleZoomSkin,
    stabilizeCamera,
  ]);
  drawRef.current = draw;

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.timer = window.setInterval(() => {
      // Background throttling is expected. It must not activate the GPU
      // rescue path or contaminate automatic quality measurements.
      if (document.hidden) return;
      const now = performance.now();
      // A frame that has not arrived is only evidence of a dead clock if the
      // main thread was FREE to deliver it — and a frame here can legitimately
      // cost half a second, so the deadline scales with what one actually costs.
      // CON EL FOTOGRAMA REAL, no con el coste de JS: el plazo antiguo era
      // max(500, cost·4) = 500 ms frente a un fotograma legítimo de 15 s
      // (SwiftShader, medido), y mataba relojes sanos — 1 cancelación medida
      // en globo. Además, cada disparo alimenta la media: si este plazo era
      // corto, el siguiente es proporcionalmente más largo y el vigilante
      // converge solo en dos o tres intentos en vez de matar para siempre.
      if (st.raf && now - st.booked > Math.max(500, st.frameGapAvg * 4, st.cost * 4)) {
        st.frameGapAvg = Math.max(st.frameGapAvg, now - st.booked);
        st.rafAlive = false;
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
      // EL LATIDO DEL MAR, y las tres condiciones que impiden que se convierta
      // en un bucle de sesenta hercios para siempre (ver SEA_AWAKE_MS):
      // que haya alguien delante (ventana de seis segundos desde la última
      // señal), que haya oleaje visible a este encuadre, y como mucho a 30 Hz.
      // Fuera de eso esto no toca `need` y el pulso vuelve a costar cero.
      if (st.waves && now < st.wakeUntil && now - st.lastDraw >= SEA_FRAME_MS) {
        st.need = true;
      }
      if (!st.need) return;
      if (st.rafAlive) { request(); return; }
      if (now - st.lastDraw < Math.max(16, st.frameGapAvg, st.cost)) return;
      drawRef.current();
      // EL CANARIO QUE RESUCITA EL RELOJ. `rafAlive = false` era una condena
      // perpetua: sólo se asignaba `false`, `request()` quedaba cortocircuitado
      // y la vista dibujaba desde este setInterval de por vida aunque el
      // compositor volviera (pestaña visible otra vez, GPU liberada). Tras cada
      // dibujo de rescate se deja UN rAF armado: si el compositor lo entrega,
      // el reloj estaba vivo y se restaura la vía normal; si no, el vigilante
      // de arriba lo recoge con su plazo adaptativo.
      if (!st.raf) {
        st.booked = now;
        st.raf = requestAnimationFrame(() => {
          st.raf = 0;
          st.rafAlive = true;
          if (st.need) drawRef.current();
        });
      }
    }, 16);
    const visibilityChanged = () => {
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
      st.chained = false;
      st.lastT0 = 0;
      st.rafAlive = true;
      if (!document.hidden) request();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      window.clearInterval(st.timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [ready, request]);

  // ---- shape ---------------------------------------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setShape(shape);
    // Exactamente el mismo interruptor que había: el plano lleva la lámina que
    // sigue a la cámara hasta el far, el globo lleva la esfera. El cielo no se
    // conmuta — él mismo mira `shape` y pinta horizonte o espacio.
    st.water.plane.visible = shape === 'plane';
    st.water.globe.visible = shape === 'globe';
    // How far back the whole thing fits. The bounding extent and the NARROWER of
    // the two field angles give the distance that cannot crop, whatever the
    // shape of the panel.
    const halfV = (st.camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * Math.max(0.2, st.camera.aspect));
    if (shape === 'plane') {
      // 52° above the ground: high enough to read the whole sheet, low enough
      // that relief still has a silhouette. Looking straight down is the 2D
      // view, and the 2D view is what this one exists to stop being.
      const a = (52 * Math.PI) / 180;
      const relief = 9 * (0.24 * exaggeration * (SIZE_X / world.width));
      const dV = (sizeZ * Math.sin(a) * 0.5 + relief) / Math.tan(halfV);
      const dH = SIZE_X * 0.5 / Math.tan(halfH);
      const d = Math.max(dV, dH) * 1.06;
      st.controls.target.set(0, 0, 0);
      st.camera.position.set(0, Math.sin(a) * d, Math.cos(a) * d);
      // El suelo de acercamiento, traducido de kilómetros a distancia de
      // cámara con la misma trigonometría que usa `distFor` para volar.
      st.controls.minDistance = (MIN_3D_SPAN_KM / EARTH_KM) * SIZE_X
        / (2 * Math.tan(halfV) * Math.max(0.5, st.camera.aspect || 1.7));
      st.controls.maxDistance = d * 2.2;
      st.controls.maxPolarAngle = (85 * Math.PI) / 180;
      st.controls.enablePan = true;
      st.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      /**
       * Y EN PASEO, OTROS LÍMITES.
       *
       * El punto de mira está a `WALK_LOOK` de la cámara, así que la distancia
       * del orbitador se clava ahí: la rueda deja de acercar —no hay nada a lo
       * que acercarse cuando el objetivo va contigo— y `onWheel` la usa para
       * andar. El ángulo polar se abre hasta casi el suelo porque mirarse los
       * pies es un gesto legítimo cuando estás de pie, y los 85° de la órbita
       * existían para no cruzar el terreno, que aquí lo impide la estatura.
       */
      if (walkRef.current) {
        st.controls.minDistance = WALK_LOOK;
        st.controls.maxDistance = WALK_LOOK;
        st.controls.maxPolarAngle = (172 * Math.PI) / 180;
        st.controls.enablePan = false;
      }
    } else {
      const d = (R_GLOBE * 1.1) / Math.sin(Math.max(0.08, Math.min(halfV, halfH)));
      st.controls.target.set(0, 0, 0);
      st.camera.position.set(d * 0.42, d * 0.38, d * 0.82);
      st.controls.minDistance = R_GLOBE * 1.02;
      st.controls.maxDistance = d * 3;
      st.controls.maxPolarAngle = Math.PI;
      st.controls.enablePan = false;
      // Panning a globe about a fixed centre does nothing useful, so the right
      // button turns it instead of pretending.
      st.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    }
    // A REGENERATED WORLD GETS A FRESH CAMERA.
    //
    // The shared viewport is the whole point of "one world, one camera" — but
    // it describes a planet that no longer exists the moment the reader presses
    // Generar. Adopting it there is how you get a brand new world opened with
    // the lens against the ground.
    const freshWorld = st.posedWorld !== world;
    st.posedWorld = world;
    const initialViewport = freshWorld ? null : viewportRef.current;
    if (initialViewport && initialViewport.spanKm < 36000) {
      const focus = new THREE.Vector3();
      scenePos(
        initialViewport.u * world.width,
        initialViewport.v * world.height,
        focus,
      );
      // La cámara compartida trae el encuadre de donde venga el lector, y si
      // venía del 2D a treinta kilómetros esta vista abría con el morro
      // metido en un téxel: ahí no hay datos, sólo magnificación — y era el
      // primer eslabón del atasco que Luis describió (arrancas cerca, se pide
      // comarca, te alejas y ya no levanta cabeza). El encuadre se respeta,
      // pero nunca por debajo del suelo honrado de esta vista.
      const fraction = Math.min(1, Math.max(
        ADOPT_MIN_SPAN_KM / EARTH_KM,
        initialViewport.spanKm / EARTH_KM,
      ));
      if (shape === 'plane') {
        const distance = Math.max(2.5, SIZE_X * fraction * 1.25);
        st.controls.target.copy(focus);
        st.camera.position.copy(focus).add(new THREE.Vector3(
          0,
          distance * 0.72,
          distance * 0.62,
        ));
      } else {
        st.controls.target.set(0, 0, 0);
        // GEOMETRÍA DEL CASQUETE, NO UNA RECTA A OJO. La fórmula antigua
        // (1,02 + fraction·2,4) topaba en 3,42·R, por debajo del encaje
        // R/sin16° = 3,63·R: con el encuadre por defecto (spanKm = 20 000,
        // fraction = 0,5) daba 2,22·R y el planeta desbordaba el marco por los
        // cuatro lados — y como la vista arranca en plano y la adopción llega
        // al segundo posado, eso era exactamente lo que se veía al pulsar
        // «Globo». Aquí: β es el semiarco de suelo pedido, y la distancia es
        // la que hace que ese casquete llene el marco — cos β + 1,1·sin β /
        // sin(halfMin) —, que en β = 90° es EXACTAMENTE el posado por defecto
        // (3,99·R), así que encuadre compartido y mundo recién hecho aterrizan
        // en el mismo sitio cuando piden lo mismo.
        const halfMin = Math.max(0.08, Math.min(halfV, halfH));
        const beta = Math.min(Math.PI / 2, Math.PI * fraction);
        const d = R_GLOBE * Math.max(
          1.08,
          Math.cos(beta) + (1.1 * Math.sin(beta)) / Math.sin(halfMin),
        );
        st.camera.position.copy(focus).normalize().multiplyScalar(d);
      }
    }
    st.fly.active = false;
    st.controls.update();
    stabilizeCamera();
    st.poseKey = '';
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, ready, world.height, world.width, request, stabilizeCamera]);

  // ---- the skin ------------------------------------------------------------
  //
  // Rebuilt when the reader changes it, when the theme changes, and when the
  // world does — a painted island whose raster is a revision behind is an island
  // that is there in the relief and missing from the ground.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    const rev = revision;
    const key = `${worldContentKey(world)}:${skin}:${theme.id}:${geography ? geographyContentKey(geography) : 'bare'}:${showRivers}:${showRoads}:${showBorders}`;
    if (st.skinnedKey === key && st.skinnedRev === rev) return;
    st.skinnedKey = key;
    st.skinnedRev = rev;

    if (skin === 'arcilla') {
      st.surface.setAlbedo(null);
      st.surface.setShading(true, cavity, headlight, shadow);
      st.albedo?.dispose();
      st.albedo = null;
      st.albedoCanvas = null;
      st.albedoBase = null;
      request();
      return;
    }

    let canvas: HTMLCanvasElement;
    if (skin === 'dibujado') {
      canvas = getCartoTexture(world, theme, geography ?? undefined,
        Math.min(4096, Math.max(2048, world.width)),
        { rivers: showRivers, roads: showRoads, borders: showBorders });
      // La carta trae sus ríos dibujados en su propia lámina: el relleno de la
      // piel de cerca usa la misma imagen y no necesita base aparte.
      st.albedoBase = null;
    } else {
      // Unshaded on purpose: the scene supplies the form, and a second NW
      // hillshade baked into the raster would shade every slope twice.
      // SIN el tampón de ríos de renderComposite: aquello estampa alfa POR
      // CELDA, así que un río medía una celda de gordo (19,6 km en un mundo
      // de 2048) hiciera lo que hiciera la cámara — la cinta gorda de las
      // capturas de Luis. La base limpia se guarda para el relleno de la piel
      // de cerca, y la textura del mundo lleva los ríos dibujados por la MISMA
      // rutina de anchura-de-suelo que usan las teselas someras del satélite:
      // un solo idioma de río a todas las distancias.
      const rgba = renderBase(world, 'atlas', { shade: false });
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = world.width;
      baseCanvas.height = world.height;
      baseCanvas.getContext('2d')!.putImageData(new ImageData(rgba, world.width, world.height), 0, 0);
      st.albedoBase = baseCanvas;
      canvas = document.createElement('canvas');
      canvas.width = world.width;
      canvas.height = world.height;
      const cctx = canvas.getContext('2d');
      if (cctx) {
        cctx.drawImage(baseCanvas, 0, 0);
        // wrap=false: este ráster ya cubre el cilindro entero; re-ramificar
        // por ventana empujaría los ríos orientales fuera del borde izquierdo.
        if (showRivers) drawWorldRivers(world, cctx, { x: 0, y: 0, w: world.width, h: world.height }, world.width, false);
        if (showBorders && geography) drawRealmBorders(cctx, realmBorders(world, geography), {
          worldWidth: world.width, worldHeight: world.height,
          toScreen: (u, v) => [u * world.width, v * world.height],
          width: world.width, height: world.height, pxPerCell: 1,
          view: { x: 0, y: 0, w: world.width, h: world.height },
          linear: { ox: 0, oy: 0, scale: 1 },
        });
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // v = 0 is the north row of the raster, which is only true if three.js does
    // not flip it on upload.
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, st.renderer.capabilities.getMaxAnisotropy());
    st.albedo?.dispose();
    st.albedo = tex;
    st.albedoCanvas = canvas;
    // La piel de satélite deja que el shader pinte el mar; la carta dibujada
    // conserva el suyo, que es parte del dibujo.
    st.surface.setAlbedo(tex, true, skin !== 'dibujado');
    st.surface.setShading(false, cavity, headlight, shadow);
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, theme, geography, world, revision, ready, request, showRivers, showRoads, showBorders]);

  // ---- everything else the look depends on ---------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setExaggeration(exaggeration);
    st.surface.setShading(skin === 'arcilla', cavity, headlight, shadow);
    st.surface.setContour(contour);
    // UNA SOLA FUENTE PARA EL SOL. El terreno lo quiere en grados (para su
    // sombreado y su sombra arrojada) y el cielo y el agua en vector; los dos
    // salen de la misma hora y con la misma trigonometría que `setSun` usa por
    // dentro, así que no pueden discrepar — que es como se consigue un sol
    // dibujado en un sitio y unas sombras tiradas desde otro.
    const s = sunAt(hour);
    st.surface.setSun(s.az, s.el);
    const a = s.az * DEG, e = s.el * DEG;
    st.sun.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    st.surface.setMirror(mirrorX, mirrorY);
    st.surface.setDetail(detailAmt);
    stabilizeCamera();
    st.poseKey = '';
    // Mover la hora es tocar el mundo: el mar tiene derecho a moverse un rato.
    st.wakeUntil = performance.now() + SEA_AWAKE_MS;
    request();
  }, [
    exaggeration,
    skin,
    cavity,
    headlight,
    shadow,
    contour,
    hour,
    mirrorX,
    mirrorY,
    detailAmt,
    ready,
    request,
    stabilizeCamera,
  ]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setMesh(MESH_STEPS[mesh]);
    st.poseKey = '';
    request();
  }, [mesh, ready, request]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    const nativeDpr = Math.min(2, window.devicePixelRatio || 1);
    if (quality === 'low') {
      st.pixelRatio = Math.min(1, nativeDpr);
      st.renderer.setPixelRatio(st.pixelRatio);
      setMesh(0);
    } else if (quality === 'high') {
      st.pixelRatio = nativeDpr;
      st.renderer.setPixelRatio(st.pixelRatio);
      setMesh(2);
    } else {
      st.pixelRatio = Math.min(1.5, nativeDpr);
      st.renderer.setPixelRatio(st.pixelRatio);
      setMesh(1);
      st.frameAvg = 16;
      // La media del intervalo real también se vacía: con otro pixelRatio es
      // otra máquina, y la escalera automática decide sobre lo que mida ahora.
      st.frameGapAvg = 0;
      st.chained = false;
      st.qualityFrames = 0;
    }
    request();
  }, [quality, ready, request]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    if (st.uploadedRev !== revision) {
      st.surface.uploadAll(world.elevation, world.biome);
      sembrarRef.current?.();
      st.uploadedRev = revision;
    }
    request();
  }, [revision, world, ready, request]);

  // El parche canónico de cerca queda DESARMADO en esta vista, una vez y para
  // siempre. `SculptSurface` conserva la capacidad (la usa el editor de
  // esculpido), pero aquí `uDetailOn` vale cero desde el primer frame: nada
  // que subir, nada que tirar, y el fragment shader se salta las ramas caras
  // del parche en cada píxel de cada frame.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.surface.setDetailPatch(null);
    st.surface.setDetailAlbedo(null);
  }, [ready]);

  // Markers move when the gazetteer or the pins do, with no camera movement to
  // trigger a frame.
  useEffect(() => {
    request();
  }, [
    geography,
    waypoints,
    showWaypoints,
    showSettlements,
    showLandmarks,
    // La marca de llegada también manda dibujar: sin esto, quitarla con
    // Esc no borraba la diana hasta que la cámara se moviera sola.
    flyMark,
    spatialEntities,
    selectedSpatialKey,
    request,
  ]);

  // ---- fly to a point ------------------------------------------------------
  useEffect(() => {
    const st = R.current;
    if (!st || !flyTarget) return;
    const target = new THREE.Vector3();
    scenePos(flyTarget.u * world.width, flyTarget.v * world.height, target);
    st.fly.fromT.copy(st.controls.target);
    st.fly.fromC.copy(st.camera.position);
    // When the request names a span, come close enough that the visible ground
    // is roughly that wide — the shared-camera meaning of "zoom to". Without
    // one, keep the historical framing distances.
    const halfV = Math.tan((st.camera.fov * Math.PI) / 360);
    const aspect = Math.max(0.5, st.camera.aspect || 1.7);
    const distFor = (spanKm: number) => {
      const ground = (Math.max(MIN_SPAN_KM, spanKm) / EARTH_KM) * SIZE_X;
      return ground / (2 * halfV * aspect);
    };
    if (shapeRef.current === 'globe') {
      // A globe turns about its own centre; framing means looking at the point
      // from outside it, not moving the centre off the origin.
      st.fly.toT.set(0, 0, 0);
      const r = flyTarget.spanKm
        ? Math.min(R_GLOBE * 2.0, R_GLOBE * 1.02 + distFor(flyTarget.spanKm))
        : R_GLOBE * 2.0;
      st.fly.toC.copy(target).normalize().multiplyScalar(r);
    } else {
      st.fly.toT.copy(target);
      const d = flyTarget.spanKm
        ? Math.max(st.controls.minDistance * 1.1, Math.min(sizeZ * 0.16, distFor(flyTarget.spanKm) / 0.95))
        : Math.max(6, sizeZ * 0.16);
      st.fly.toC.copy(target).add(new THREE.Vector3(0, d * 0.72, d * 0.62));
    }
    st.fly.t = 0;
    st.fly.startedAt = performance.now();
    st.fly.active = true;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget, request]);

  // ---- picking -------------------------------------------------------------
  const cellUnder = useCallback((clientX: number, clientY: number): Pt | null => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return null;
    const r = host.getBoundingClientRect();
    const origin = st.camera.position.clone();
    const dir = new THREE.Vector3(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
      0.5,
    ).unproject(st.camera).sub(origin).normalize();
    return pickCell(st.surface, origin, dir, shapeRef.current, world.width, world.height);
  }, [world.width, world.height]);

  /** The dot under the pointer, if any, from the marks this frame already drew. */
  const markUnder = useCallback((clientX: number, clientY: number): ScreenMark | null => {
    const st = R.current;
    const host = hostRef.current;
    if (!st || !host) return null;
    const r = host.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    let best: ScreenMark | null = null;
    let bestD = 16 * 16;
    for (const m of st.marks) {
      // The name counts as part of the target: it is what the reader can see
      // and what they are actually pointing at.
      if (m.hit && px >= m.hit.x0 && px <= m.hit.x1 && py >= m.hit.y0 && py <= m.hit.y1) return m;
      const d = (m.x - px) * (m.x - px) + (m.y - py) * (m.y - py);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }, []);

  /**
   * What the next stroke will actually do.
   *
   * Modifier keys beat the panel, which is the convention everywhere: Shift is
   * smooth no matter what was selected, Ctrl is the same brush the other way
   * round. Resolved once when the button goes down and held for the whole
   * stroke, so letting go of Shift halfway does not change the brush under the
   * reader's hand.
   */
  const resolveBrush = useCallback((shift: boolean, ctrl: boolean) => {
    const t = toolRef.current;
    if (shift) return { kind: 'terrain' as const, op: 'smooth' as TerrainOp };
    if (t.mode === 'land') {
      const op = ctrl ? (t.landOp === 'land' ? 'sea' : 'land') : t.landOp;
      return { kind: 'land' as const, op };
    }
    const op = ctrl ? (INVERSE[t.terrainOp] ?? t.terrainOp) : t.terrainOp;
    return { kind: 'terrain' as const, op };
  }, []);

  const uploadDirty = useCallback((d: { x0: number; y0: number; x1: number; y1: number }) => {
    const st = R.current;
    if (!st || d.x1 < d.x0) return;
    st.surface.patch(world.elevation, null, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
  }, [world.elevation]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    if (!st) return;
    // Ctrl, not Alt: one key means "the other way round" for every tool, and it
    // is already what the sculpt preview reads while a stroke is in flight.
    altRef.current = e.ctrlKey || e.metaKey;
    press.current = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    if (e.button !== 0 || !brushingRef.current) return;
    const p = cellUnder(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const t = toolRef.current;
    if (sculptingRef.current) {
      const b = resolveBrush(e.shiftKey, e.ctrlKey || e.metaKey);
      gesture.current = new SculptGesture(
        world.elevation, world.width, world.height, world.params.seed,
        {
          kind: b.kind, op: b.op,
          radius: t.radius, strength: t.strength, softness: t.softness,
          curve: t.curve, tip: t.tip, angle: t.angle,
          jitter: t.jitter, aspect: t.aspect, taper: t.taper,
          mirrorX: mirrorRef.current.x, mirrorY: mirrorRef.current.y,
        },
      );
      uploadDirty(gesture.current.extend(p));
    } else {
      // Everything else — biome, river, road, a town, a name — is just the list
      // of cells the pointer crossed, and becomes an edit when the button comes
      // back up. There is nothing to preview because the raster underneath is
      // rebuilt from the edit, not from the gesture.
      trail.current = [p];
    }
    cursor.current = p;
    request();
  }, [cellUnder, resolveBrush, uploadDirty, world, request]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    if (!st) return;
    // La otra señal de que hay alguien delante, además de mover la cámara: la
    // mano sobre la vista. Mirar el atardecer sin tocar nada mantiene el mar
    // vivo mientras el puntero se pasea, y lo apaga seis segundos después de
    // que la mano se vaya. Ver SEA_AWAKE_MS.
    st.wakeUntil = performance.now() + SEA_AWAKE_MS;
    if (press.current && !press.current.moved
        && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 4) {
      press.current.moved = true;
    }

    // With no brush out, the pointer is a pointer: what it is over matters more
    // than where it is on the ground, and a height query per mouse move is not
    // free.
    if (!brushingRef.current) {
      const m = markUnder(e.clientX, e.clientY);
      setHovering(m ? m.label : null);
      if (!press.current) {
        const p = cellUnder(e.clientX, e.clientY);
        setReadout(p ? describe(world, p, translate) : '');
      }
      return;
    }

    const p = cellUnder(e.clientX, e.clientY);
    cursor.current = p;
    const brush = toolRef.current;
    if (p) {
      st.surface.setBrush(p.x, p.y, brush.radius, brush.softness, true, tipOf(brush as unknown as Stroke));
      setReadout(describe(world, p, translate));
    } else {
      st.surface.setBrush(0, 0, 1, brush.softness, false);
      setReadout('');
    }
    const g = gesture.current;
    if (g && p) uploadDirty(g.extend(p));
    const tr = trail.current;
    if (tr && p) {
      const last = tr[tr.length - 1];
      // One point per half-cell is plenty, and it keeps the serialized edit
      // small enough to store a hundred strokes.
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) tr.push(p);
    }
    request();
  }, [cellUnder, markUnder, uploadDirty, world, request]);

  const finish = useCallback((e: React.PointerEvent) => {
    const st = R.current;
    const g = gesture.current;
    const tr = trail.current;
    gesture.current = null;
    trail.current = null;
    const p = press.current;
    press.current = null;

    if (g && g.points) {
      // The live pass is a preview. It is rolled back and the stroke committed
      // as edits, which the session replays from the pristine snapshot — so what
      // ends up in the world is exactly what regenerating from the seed and the
      // edit list would produce, never what the preview happened to do.
      g.rollback();
      st?.surface.uploadAll(world.elevation, world.biome);
      sembrarRef.current?.();
      const edits: WorldEdit[] = g.edits().map((ed) => (ed.kind === 'land'
        ? { kind: 'land', op: ed.op as 'land' | 'sea', stroke: ed.stroke }
        : { kind: 'terrain', op: ed.op as TerrainOp, stroke: ed.stroke }));
      if (edits.length) {
        if (onEdits) onEdits(edits);
        else for (const ed of edits) onEdit(ed);
      }
      request();
      return;
    }

    if (tr && tr.length && isWaypointTool(toolRef.current)) {
      if (altRef.current) {
        const hit = markUnder(e.clientX, e.clientY);
        if (hit?.kind === 'waypoint' && hit.waypointId) {
          propsRef.current.onRemoveWaypoint?.(hit.waypointId);
        }
      } else {
        const at = tr[tr.length - 1];
        propsRef.current.onPlaceWaypoint?.(
          (((at.x / world.width) % 1) + 1) % 1,
          Math.min(1, Math.max(0, at.y / world.height)),
        );
      }
      request();
      return;
    }

    // The Camino tool is two clicks on two towns with an A* between them, and
    // the routing lives in the parent. A click made a one-point trail,
    // `commitPaintStroke` returns null for one point, and the guard below then
    // swallowed the click before it could ever reach the town picker — so the
    // advertised gesture did nothing at all in the two views that carry the
    // brush. A drag still lays a road by hand.
    if (tr && tr.length && toolRef.current.mode === 'road' && !altRef.current
      && p && !p.moved && propsRef.current.onPickSettlement) {
      const mark = markUnder(e.clientX, e.clientY);
      const geo0 = propsRef.current.geography;
      const tol = Math.max(4, (st ? st.surface.uvWindow.size : 1) * world.width * 0.018);
      const s = mark?.settlement
        ?? (geo0 ? pickSettlementNear(geo0, world.width, tr[0].x, tr[0].y, tol) : null);
      if (s) {
        propsRef.current.onPickSettlement(s);
        request();
        return;
      }
    }

    if (tr && tr.length) {
      const spec = altRef.current ? negativeOf(toolRef.current) : toolRef.current;
      // Same rule as the 2D: what the view can see decides the reach, and
      // `paintCommit` clamps it. The globe measures it from the window on the
      // sphere rather than from a pixel scale, but it is the same quantity.
      const reachCells = st ? st.surface.uvWindow.size * world.width * 0.02 : 8;
      const edit = commitPaintStroke(spec, tr, {
        negative: altRef.current,
        reachCells,
        pickGenerated: (x, y) => pickGeneratedAt(
          world, propsRef.current.geography, x, y, reachCells,
        ),
      });
      if (edit) onEdit(edit);
      request();
      return;
    }

    // No brush: a click that did not turn the world is a click on something.
    if (!p || p.moved || p.button !== 0 || brushingRef.current) return;
    const mark = markUnder(e.clientX, e.clientY);
    if (mark?.kind === 'waypoint' && mark.waypointId) {
      propsRef.current.onPickWaypoint?.(mark.waypointId);
      return;
    }
    if (mark?.kind === 'spatial' && mark.spatial) {
      propsRef.current.onSelectSpatialEntity?.(mark.spatial);
      return;
    }
    if (mark?.settlement) {
      propsRef.current.onPickSettlement?.(mark.settlement);
      return;
    }
    // Missed the dot but landed near a town anyway — the reader pointed at the
    // place, not at the four pixels that represent it.
    const geo = propsRef.current.geography;
    const pick = propsRef.current.onPickSettlement;
    if (!geo || !pick) {
      propsRef.current.onSelectSpatialEntity?.(null);
      return;
    }
    const cell = cellUnder(e.clientX, e.clientY);
    if (!cell) return;
    const st2 = R.current;
    const tol = Math.max(4, (st2 ? st2.surface.uvWindow.size : 1) * world.width * 0.018);
    const s = pickSettlementNear(geo, world.width, cell.x, cell.y, tol);
    if (s) pick(s);
    else propsRef.current.onSelectSpatialEntity?.(null);
  }, [onEdit, onEdits, world, markUnder, cellUnder, request]);

  const cancel = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    trail.current = null;
    press.current = null;
    if (!g) return;
    g.rollback();
    R.current?.surface.uploadAll(world.elevation, world.biome);
    sembrarRef.current?.();
    request();
  }, [world, request]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (brushingRef.current) return;
    const open = propsRef.current.onZoomTo;
    if (!open) return;
    const p = cellUnder(e.clientX, e.clientY);
    if (p) open(p.x, p.y);
  }, [cellUnder]);

  // The hand turns the world with the left button; a brush needs it.
  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.controls.mouseButtons.LEFT = brushing
      ? (null as unknown as THREE.MOUSE)
      : THREE.MOUSE.ROTATE;
  }, [brushing, ready]);

  // ---- wheel: zoom, or the brush ------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      /**
       * EN PASEO, LA RUEDA ANDA.
       *
       * El orbitador tiene la distancia clavada en `WALK_LOOK`, así que su
       * acercamiento no puede hacer nada: se le quita el evento y se mueven la
       * cámara y su punto de mira JUNTOS a lo largo del rumbo. El paso escala
       * con la altura sobre el suelo, que es lo que hace que andar por un valle
       * y sobrevolar una cordillera se sientan igual de manejables.
       */
      if (walkRef.current && !brushingRef.current && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
        const st = R.current;
        if (!st || shapeRef.current !== 'plane') return;
        e.preventDefault();
        e.stopPropagation();
        const c = st.camera.position, t = st.controls.target;
        let dx = t.x - c.x, dz = t.z - c.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const u = c.x / SIZE_X + 0.5, v = c.z / sizeZ + 0.5;
        const alto = Math.max(0.02, c.y - st.surface.heightAtUV(u, v) * st.surface.yMul);
        const paso = Math.max(0.05, Math.min(6, alto * 6)) * (e.deltaY > 0 ? -1 : 1);
        c.x += dx * paso; c.z += dz * paso;
        t.x += dx * paso; t.z += dz * paso;
        st.need = true;
        return;
      }
      /**
       * LA RUEDA VA AL CURSOR, COMO EN EL 2D.
       *
       * El orbitador se acerca a SU PUNTO DE MIRA, y el punto de mira es el
       * centro de la pantalla: para mirar de cerca la esquina del encuadre
       * había que acercarse al centro y arrastrar, acercarse y arrastrar. El
       * 2D no hace eso —su rueda ancla la celda que está bajo el ratón— y que
       * el mismo verbo signifique dos cosas distintas en dos vistas de la
       * MISMA cámara es de lo que más hacía que el 3D se sintiera prestado.
       * La tecla de enfoque de más abajo ya existía para paliarlo, con esta
       * misma frase escrita en su comentario: «la razón más común de que una
       * vista 3D se sienta rota». Era una tirita sobre el gesto equivocado.
       *
       * Son DOS cuentas distintas porque son dos problemas distintos, y las
       * dos viven en `core/zoomAnchor.ts` con su banco:
       *
       *  · EN EL PLANO, una homotecia de centro P (el punto del terreno bajo
       *    el cursor): la cámara y el punto de mira se escalan los dos por el
       *    mismo factor respecto de P. Se conserva la dirección cámara→mira
       *    (misma orientación) y la cámara se mueve por la recta que pasa por
       *    P, así que P vuelve al mismo píxel. No es una aproximación afinada
       *    a ojo: es la invariante «lo que señalas no se mueve», la del 2D.
       *
       *  · EN EL GLOBO no se puede: el punto de mira ES el centro del planeta
       *    y de él cuelga la órbita entera. Sólo se puede cambiar el radio, y
       *    eso solo empuja hacia el borde todo lo que no esté en el centro.
       *    Hay que acercarse Y GIRAR el globo a la vez — `anchoredGlobeDolly`.
       *
       * P se saca del RAYO y no de `scenePos(celda)` en el plano: la celda que
       * devuelve `pickCell` viene envuelta a [0, ancho) y el plano se repite al
       * este y al oeste, así que a un lado de la costura `scenePos` habría
       * devuelto un punto a un mundo entero de distancia y la rueda habría
       * teletransportado al lector. En el globo no hay copias y `scenePos` es
       * exactamente el punto que hace falta.
       */
      if (!(e.ctrlKey || e.metaKey || e.shiftKey) && !brushingRef.current) {
        const st = R.current;
        const host2 = hostRef.current;
        const celda = st && host2 ? cellUnder(e.clientX, e.clientY) : null;
        if (st && host2 && celda) {
          const caja = host2.getBoundingClientRect();
          const ndcX = ((e.clientX - caja.left) / caja.width) * 2 - 1;
          const ndcY = -((e.clientY - caja.top) / caja.height) * 2 + 1;
          // Misma base que el orbitador (0,95 por muesca) para que las dos
          // ramas —plano y globo— se sientan iguales en la mano. El tope de
          // cuatro muescas por evento es por los ratones de rueda libre y los
          // paneles táctiles, que mandan deltas de miles: sin él, un golpe de
          // dedo te saca del planeta.
          const factor = Math.pow(0.95, Math.max(-4, Math.min(4, -e.deltaY / 100)));
          // Los topes de acercamiento siguen siendo los del orbitador:
          // `minDistance` ES el suelo de MIN_3D_SPAN_KM traducido a distancia
          // de cámara, en `applyShape`.
          let movido = false;
          let anclado = false;
          if (shapeRef.current === 'plane') {
            const dir = new THREE.Vector3(ndcX, ndcY, 0.5)
              .unproject(st.camera).sub(st.camera.position).normalize();
            // Mirando al horizonte el rayo no corta el suelo en ningún sitio
            // útil: el reparto de `t` se dispara y P se iría al infinito. Ahí
            // no hay nada que anclar y el gesto vuelve al orbitador.
            const sueloY = st.surface.heightAtCell(celda.x, celda.y) * st.surface.yMul;
            const tHit = dir.y < -1e-3 ? (sueloY - st.camera.position.y) / dir.y : -1;
            if (tHit > 0 && Number.isFinite(tHit)) {
              const P = dir.clone().multiplyScalar(tHit).add(st.camera.position);
              anclado = true;
              movido = anchoredDolly(
                st.camera.position, st.controls.target, P, factor,
                st.controls.minDistance, st.controls.maxDistance,
              );
            }
          } else {
            const P = new THREE.Vector3();
            scenePos(celda.x, celda.y, P);
            anclado = true;
            movido = anchoredGlobeDolly(
              st.camera.position, P, ndcX, ndcY,
              st.camera.fov, st.camera.aspect, factor,
              st.controls.minDistance, st.controls.maxDistance,
            );
          }
          if (anclado) {
            // El gesto está consumido aunque no se haya movido nada: en el
            // suelo de acercamiento, dejárselo al orbitador sería acercarse
            // por el centro justo cuando el lector mira un detalle.
            e.preventDefault();
            e.stopPropagation();
            if (movido) {
              // Un vuelo en curso y una rueda son dos manos en el mismo
              // volante: gana la del lector, como en la tecla de enfoque.
              st.fly.active = false;
              st.need = true;
            }
            return;
          }
        }
      }
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;   // let OrbitControls dolly
      if (!brushingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const t = toolRef.current;
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        const s = Math.min(1, Math.max(0.02, t.strength * Math.pow(1.0016, -e.deltaY)));
        onTool?.({ strength: s });
      } else {
        const r = Math.min(240, Math.max(1, t.radius * Math.pow(1.0022, -e.deltaY)));
        onTool?.({ radius: r });
        const c = cursor.current;
        if (c) R.current?.surface.setBrush(c.x, c.y, r, t.softness, true);
      }
      request();
    };
    host.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
    // `sizeZ` entra en la lista porque el paseo lo usa para leer la altura del
    // suelo bajo la cámara: es constante para un mundo dado, pero cambia con
    // la proporción de la retícula, y un oyente de rueda con el valor viejo
    // andaría sobre la altura equivocada.
  }, [cellUnder, onTool, request, scenePos, sizeZ]);

  // ---- keys ----------------------------------------------------------------
  useEffect(() => {
    const focus = () => {
      const st = R.current;
      const c = cursor.current;
      if (!st || !c) return;
      // Put what is under the pointer at the centre of the turn, keeping the
      // distance. Without this, zooming in on a corner of the world orbits
      // around somewhere you are not looking, which is the single most common
      // reason a 3D view feels broken.
      const target = new THREE.Vector3();
      scenePos(c.x, c.y, target);
      if (shapeRef.current === 'plane') {
        const off = st.camera.position.clone().sub(st.controls.target);
        st.controls.target.copy(target);
        st.camera.position.copy(target).add(off);
      } else {
        const d = st.camera.position.length();
        st.camera.position.copy(target).normalize().multiplyScalar(d);
      }
      st.fly.active = false;
      st.controls.update();
      st.poseKey = '';
      request();
    };

    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.shiftKey !== keys.current.shift || (e.ctrlKey || e.metaKey) !== keys.current.ctrl) {
        keys.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        setModifier(e.shiftKey ? 'smooth' : keys.current.ctrl ? 'invert' : '');
      }
      if (e.ctrlKey || e.metaKey) {
        // The world's own undo, so a sculpt step and a map step are one history.
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); window.dispatchEvent(new Event('wg-undo')); }
        if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); window.dispatchEvent(new Event('wg-redo')); }
        return;
      }
      if (!over.current) return;
      const t = toolRef.current;
      switch (e.key) {
        case '[': onTool?.({ radius: Math.max(1, t.radius * 0.85) }); break;
        case ']': onTool?.({ radius: Math.min(240, t.radius * 1.18) }); break;
        case 'x': case 'X': setMirrorX((v) => !v); break;
        case 'y': case 'Y': setMirrorY((v) => !v); break;
        case 'f': case 'F': focus(); break;
        case 's': case 'S': setShadow((v) => (v > 0.02 ? 0 : 0.55)); break;
        case 'g': case 'G': onShape(shapeRef.current === 'plane' ? 'globe' : 'plane'); break;
        default: return;
      }
      request();
    };
    const up = (e: KeyboardEvent) => {
      keys.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      setModifier(e.shiftKey ? 'smooth' : keys.current.ctrl ? 'invert' : '');
    };
    const blur = () => { keys.current = { shift: false, ctrl: false }; setModifier(''); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [onTool, onShape, scenePos, request]);

  useEffect(() => {
    if (!failed) return;
    const st = R.current;
    if (!st) return;
    st.need = false;
    st.pendingViewport = null;
    if (st.timer) window.clearInterval(st.timer);
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.viewportTimer) window.clearTimeout(st.viewportTimer);
    st.timer = 0;
    st.raf = 0;
    st.viewportTimer = 0;
  }, [failed]);

  if (failed) {
    // Not a dead end: the 2D heightmap view is a complete sculpting tool and it
    // runs on anything.
    return (
      <div className="absolute inset-0">
        <SculptView world={world} tool={tool} onEdit={onEdit} revision={revision} />
        <div className={`absolute left-2 top-2 max-w-sm px-2.5 py-1.5 ${HUD} ${HUD_TEXT} pointer-events-none`}>
          {t('worldgen.threeD.fallback')} ({failed})
        </div>
      </div>
    );
  }

  const brush = tool;
  const activeOp = brush.mode === 'terrain'
    ? (modifier === 'invert' ? (INVERSE[brush.terrainOp] ?? brush.terrainOp) : brush.terrainOp)
    : null;
  const activeLand = brush.mode === 'land'
    ? (modifier === 'invert' ? (brush.landOp === 'land' ? 'sea' : 'land') : brush.landOp)
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden select-none">
      <div
        ref={hostRef}
        className={`absolute inset-0 ${
          brushing ? 'cursor-crosshair' : hovering ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onPointerEnter={() => { over.current = true; }}
        onPointerLeave={() => {
          over.current = false;
          cursor.current = null;
          press.current = null;
          R.current?.surface.setBrush(0, 0, 1, brush.softness, false);
          setReadout('');
          setHovering(null);
          request();
        }}
      />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />

      {/* shape, symmetry, look */}
      <div className="absolute right-2 top-2 flex flex-col gap-1.5 items-end">
        <div className={`flex gap-1 p-1 ${HUD}`}>
          <Chip on={shape === 'plane'} onClick={() => onShape('plane')} icon={Layers}
            label={t('worldgen.threeD.shape.plane')} title={`${t('worldgen.threeD.shape.plane')} (G)`} />
          <Chip on={shape === 'globe'} onClick={() => onShape('globe')} icon={Globe}
            label={t('worldgen.threeD.shape.globe')} title={`${t('worldgen.threeD.shape.globe')} (G)`} />
          <Chip
            on={walking}
            onClick={() => setWalking((v) => !v)}
            icon={Footprints}
            title={t('worldgen.threeD.walk')}
          />
          <span className="w-px my-1 bg-white/20" />
          <Chip on={mirrorX} onClick={() => setMirrorX((v) => !v)} icon={FlipHorizontal} title={t('worldgen.threeD.symmetryX')} />
          <Chip on={mirrorY} onClick={() => setMirrorY((v) => !v)} icon={FlipVertical} title={t('worldgen.threeD.symmetryY')} />
          <span className="w-px my-1 bg-white/20" />
          <Chip on={panel} onClick={() => setPanel((v) => !v)} icon={Sliders} title={t('worldgen.threeD.appearance')} />
        </div>

        {panel && (
          <div className={`w-64 p-2.5 flex flex-col gap-2 ${HUD} ${HUD_TEXT}`}>
            <Slider label={t('worldgen.threeD.closeDetail')} value={detailAmt} min={0} max={1} step={0.05}
              onChange={setDetailAmt} format={(v) => (v < 0.03 ? t('worldgen.threeD.sliderOff') : `${Math.round(v * 100)}%`)} />
            <Slider label={t('worldgen.threeD.cavity')} value={cavity} min={0} max={1.4} step={0.05}
              onChange={setCavity} format={(v) => v.toFixed(2)} />
            <Slider label={t('worldgen.threeD.shadows')} value={shadow} min={0} max={1} step={0.05}
              onChange={setShadow}
              format={(v) => (v < 0.03 ? t('worldgen.threeD.sliderOff') : v.toFixed(2))}
              disabled={shape === 'globe' || headlight} />
            {/* LA HORA SUSTITUYE AL AZIMUT, y el cambio es de fondo.
                El mando de antes giraba la luz sin moverla de altura: con un
                fondo gris eso valía, porque el sol no existía más que como
                dirección de sombreado. Con un cielo detrás es un sol que se ve
                clavado en el cénit mientras las sombras dan la vuelta al mundo.
                La hora mueve azimut Y elevación a la vez, así que amanecer,
                mediodía, atardecer y noche son sitios a los que se puede ir —
                y de paso mueve el cielo, el color del agua y la niebla, que
                cuelgan del mismo vector.
                Lo que se pierde: elegir a mano de qué cuarto viene la luz para
                leer el relieve. Se recupera girando el mundo, que es la misma
                operación y además mueve las sombras — cosa que el azimut solo
                nunca hizo. Y para leer forma sin sol está la luz frontal, que
                sigue ahí y sigue siendo blanca a cualquier hora.
                NO se desactiva con la luz frontal: ésa es la linterna del
                lector, y la hora sigue mandando sobre el cielo y el mar. */}
            <Slider label={t('worldgen.threeD.hour')} value={hour} min={0} max={24} step={0.25}
              onChange={setHour} format={hourLabel} title={t('worldgen.threeD.hourHint')} />
            <Slider label={t('worldgen.threeD.contours')} value={contour} min={0} max={1} step={0.05}
              onChange={setContour} format={(v) => (v < 0.03 ? t('worldgen.threeD.sliderOff') : `${Math.round(v * 1000)} m`)} />
            <label className="flex items-center justify-between">
              {t('worldgen.threeD.quality')}
              <span className="flex gap-1">
                {([
                  ['low', t('worldgen.threeD.quality.low')],
                  ['auto', t('worldgen.threeD.quality.auto')],
                  ['high', t('worldgen.threeD.quality.high')],
                ] as const).map(([id, labelText]) => (
                  <button key={id} onClick={() => setQuality(id)}
                    className={`px-1.5 py-0.5 rounded ${quality === id ? 'bg-amber-400/40 text-white' : 'text-white/70 hover:bg-white/15'}`}>
                    {labelText}
                  </button>
                ))}
              </span>
            </label>
            <Toggle on={headlight} onClick={() => setHeadlight((v) => !v)} label={t('worldgen.threeD.headlight')} icon={Sun} />
            <p className="text-white/60 leading-snug pt-0.5">
              {quality === 'auto' ? `${t('worldgen.threeD.quality.auto')} · ${ms} ms · ` : ''}{detail}
              {skinInfo ? <><br />{skinInfo}</> : null}
            </p>
          </div>
        )}
      </div>

      {/* the brush strip: what the left button is about to do */}
      {sculpting && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex flex-col items-center gap-1">
          <div className={`flex gap-0.5 p-1 ${HUD}`}>
            {brush.mode === 'terrain'
              ? OPS.map((op) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ terrainOp: op })}
                  title={t(OP_KEY[op])}
                  className={`px-2 py-1 rounded text-[11px] transition ${
                    activeOp === op
                      ? (modifier ? 'bg-sky-400/45 text-white' : 'bg-amber-400/40 text-white')
                      : 'text-white/75 hover:text-white hover:bg-white/15'
                  }`}
                >
                  {t(OP_KEY[op])}
                </button>
              ))
              : ([
                ['land', t('worldgen.threeD.land')],
                ['sea', t('worldgen.threeD.sea')],
              ] as const).map(([op, label]) => (
                <button
                  key={op}
                  onClick={() => onTool?.({ landOp: op })}
                  className={`px-2 py-1 rounded text-[11px] transition ${
                    activeLand === op
                      ? (modifier ? 'bg-sky-400/45 text-white' : 'bg-amber-400/40 text-white')
                      : 'text-white/75 hover:text-white hover:bg-white/15'
                  }`}
                >
                  {label}
                </button>
              ))}
            {modifier === 'smooth' && (
              <span className="px-2 py-1 rounded text-[11px] bg-sky-400/45 text-white">{t('worldgen.threeD.op.smooth')}</span>
            )}
          </div>
          {/* The head and its falloff, where the hand already is. Both write to
              the tool the panel owns, so the strip and the box are one control
              seen twice and cannot drift apart. */}
          <div className={`flex items-center gap-0.5 p-0.5 ${HUD}`}>
            {TIPS.map((k) => (
              <button key={k.id} onClick={() => onTool?.({ tip: k.id })} title={t(k.hint)}
                className={`p-1 rounded ${brush.tip === k.id ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white'}`}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">{k.draw}</svg>
              </button>
            ))}
            <span className="w-px h-4 bg-white/20 mx-0.5" />
            {CURVES.map((c) => (
              <button key={c.id} onClick={() => onTool?.({ curve: c.id })}
                title={t('worldgen.threeD.falloff')
                  .replace('{curve}', t(c.label).toLowerCase())
                  .replace('{hint}', t(c.hint))}
                className={`px-1.5 py-0.5 rounded text-[10px] ${brush.curve === c.id ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white'}`}>
                {t(c.label)}
              </button>
            ))}
            <span className="px-1.5 py-0.5 text-[10px] text-white/75 tabular-nums">
              {t('worldgen.threeD.brushReadout')
                .replace('{radius}', brush.radius.toFixed(0))
                .replace('{strength}', (brush.strength * 100).toFixed(0))}
            </span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-white/80 text-xs">
          <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('worldgen.threeD.busy')}</span>
        </div>
      )}

      <div className="absolute left-2 bottom-2 flex flex-col gap-1 items-start pointer-events-none max-w-[70%]">
        {(hovering || readout) && (
          <span className={`px-2 py-1 ${HUD} ${HUD_TEXT} tabular-nums`}>
            {hovering ? <strong className="font-semibold text-amber-200">{hovering}</strong> : readout}
          </span>
        )}
        <div className="flex gap-1.5 items-center">
          <span className={`px-2 py-1 ${HUD} ${HUD_TEXT} tabular-nums`}>{ms ? `${ms} ms` : '—'}</span>
          {/* La chuleta de navegación va detrás del «?»; los avisos de pincel
              siguen solos, que acompañan al gesto (Luis, 2026-08-12). */}
          {!brushing ? (
            <>
              <button
                onClick={() => setHintsOpen((o) => !o)}
                title={t('worldgen.hints.button')}
                className={`pointer-events-auto w-6 h-6 rounded-full border text-[12px] font-semibold shadow-lg shadow-black/50 backdrop-blur-sm transition ${
                  hintsOpen
                    ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                    : 'bg-[#0b0e14]/92 border-white/20 text-white/70 hover:text-white'
                }`}
              >?</button>
              {hintsOpen && (
                <span className={`px-2 py-1 ${HUD} ${HUD_TEXT}`}>
                  {t('worldgen.threeD.hint.navigate')}
                </span>
              )}
            </>
          ) : (
            <span className={`px-2 py-1 ${HUD} ${HUD_TEXT}`}>
              {sculpting
                ? (modifier === 'smooth' ? t('worldgen.threeD.hint.smoothModifier')
                  : modifier === 'invert' ? t('worldgen.threeD.hint.invertModifier')
                    : t('worldgen.threeD.hint.sculpt'))
                : t('worldgen.threeD.hint.paint')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A label with a dark halo, so it reads over ice and over ocean alike. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `${size >= 12 ? 600 : 500} ${size}px "Source Sans 3", system-ui, sans-serif`;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6,8,13,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Height and position of a cell, in the words a reader uses.
 *  `t` comes in from the caller: this lives outside the component, so the hook
 *  is not in scope here. */
function describe(world: WorldData, p: Pt, t: (key: string) => string): string {
  const xi = ((Math.round(p.x) % world.width) + world.width) % world.width;
  const yi = Math.min(world.height - 1, Math.max(0, Math.round(p.y)));
  const km = world.elevation[yi * world.width + xi];
  const lat = 90 - (yi / world.height) * 180;
  const lon = (xi / world.width) * 360 - 180;
  return `${km >= 0 ? `${Math.round(km * 1000)} m` : `${Math.round(-km * 1000)} m ${t('worldgen.threeD.belowSea')}`}`
    + ` · ${Math.abs(lat).toFixed(1)}°${t(lat >= 0 ? 'worldgen.threeD.compass.n' : 'worldgen.threeD.compass.s')}`
    + ` ${Math.abs(lon).toFixed(1)}°${t(lon >= 0 ? 'worldgen.threeD.compass.e' : 'worldgen.threeD.compass.w')}`;
}

/**
 * Nearest settlement to a cell, biased toward the bigger place.
 *
 * The same rule the carta uses, in cells rather than in normalized coordinates,
 * because that is what a ray against a height field gives back.
 */
function pickSettlementNear(
  geo: HumanGeography, worldWidth: number, x: number, y: number, maxCells: number,
): Settlement | null {
  let best: Settlement | null = null;
  let bestD = maxCells * maxCells;
  for (const s of geo.settlements) {
    let dx = Math.abs(s.x - x);
    if (dx > worldWidth / 2) dx = worldWidth - dx;
    const dy = s.y - y;
    const bonus = s.rank === 'capital' ? 0.45 : s.rank === 'city' ? 0.65 : s.rank === 'town' ? 0.85 : 1;
    const d = (dx * dx + dy * dy) * bonus;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function Chip({ on, onClick, icon: Icon, label: text, title }: {
  on: boolean; onClick: () => void; icon: typeof Globe; label?: string; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition ${
        on ? 'bg-amber-400/40 text-white' : 'text-white/75 hover:text-white hover:bg-white/15'
      }`}
    >
      <Icon size={12} />
      {text}
    </button>
  );
}

function Toggle({ on, onClick, label: text, icon: Icon, title }: {
  on: boolean; onClick: () => void; label: string; icon?: typeof Globe; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] transition ${
        on ? 'bg-amber-400/40 text-white' : 'text-white/75 hover:text-white hover:bg-white/15'
      }`}
    >
      {Icon && <Icon size={12} />}
      {text}
    </button>
  );
}

function Slider({ label: text, value, min, max, step, onChange, format, disabled, title }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; disabled?: boolean;
  title?: string;
}) {
  return (
    <label title={title} className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="w-28 shrink-0">{text}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-amber-400"
      />
      <span className="w-10 text-right tabular-nums text-white/80">{format(value)}</span>
    </label>
  );
}
