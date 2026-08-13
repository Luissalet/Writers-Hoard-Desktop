// ============================================
// Sculpt — el cielo
// ============================================
// Lo que faltaba para que la vista dejara de leerse como «un modelo de relieve
// sombreado sobre una mesa oscura» y pasara a leerse como un SITIO. Hasta ahora
// el fondo era `scene.background = 0x0e1116`: un rectángulo gris. Un rectángulo
// gris no tiene horizonte, y sin horizonte el ojo no tiene contra qué medir la
// distancia — todo queda a la misma profundidad, que es la profundidad de una
// maqueta.
//
// UN TRIÁNGULO A PANTALLA COMPLETA, NO UNA CÚPULA. Tres razones medidas:
//
//   · El far del `draw` de World3D se recalcula CADA FOTOGRAMA
//     (`max(dist*4 + SIZE_X*1.5, SIZE_X*3)`, entre 720 y varios miles). Una
//     cúpula tiene radio fijo: o se queda dentro del near cuando la cámara baja
//     o la corta el far cuando sube. Un triángulo se dibuja en coordenadas de
//     recorte y no puede recortarse nunca.
//   · Una cúpula con degradado interpolado por vértice pone bandas de Mach
//     visibles alrededor del sol salvo que se tesele mucho; por píxel no hay
//     interpolación que pueda equivocarse.
//   · Coste: UN triángulo. La geometría de la cúpula que haría falta para que
//     el disco solar no saliera poligonal son miles.
//
// Se dibuja el PRIMERO (renderOrder muy negativo) sin test ni escritura de
// profundidad, así que es literalmente el fondo: todo lo demás lo tapa por el
// camino normal del z-buffer, sin pases extra ni render targets.
//
// EL MODELO DE COLOR VIVE EN LA CPU. El shader no sabe nada de la altura del
// sol: recibe tres colores ya resueltos (cénit, horizonte, resplandor) y los
// interpola. Así `horizonColor()` puede devolver EXACTAMENTE lo que el shader
// pinta en esa dirección — que es todo el motivo de que exista: la niebla del
// terreno y la lejanía del mar tienen que fundir al cielo que hay, no a un azul
// parecido afinado por separado.

import * as THREE from 'three';
import { R_GLOBE } from './scene3d';

export interface SkyOptions { renderer: THREE.WebGLRenderer }

/**
 * Lo que el agua necesita para reflejar EL cielo y no uno parecido.
 *
 * NUEVO respecto al contrato original (ver el informe): `water.update({ sky })`
 * lo acepta como campo opcional. Todo lo que lleva sale de métodos que el
 * contrato del cielo ya tenía; `waterSky()` sólo evita escribirlo a mano.
 */
export interface WaterSky {
  /** El cielo mirando hacia arriba. */
  zenith: THREE.Color;
  /** El cielo en el horizonte, en la dirección del sol: el lado cálido. */
  horizonWarm: THREE.Color;
  /** Color de la luz del sol, para el destello sobre el oleaje. */
  sunColor: THREE.Color;
  intensity: number;
}

export interface Sky {
  mesh: THREE.Object3D;
  /** Llamado una vez por fotograma, antes de renderizar. */
  update(o: {
    camera: THREE.PerspectiveCamera;
    /** Dirección AL sol, normalizada. */
    sun: THREE.Vector3;
    /** 0 = plano, 1 = globo. */
    shape: 'plane' | 'globe';
    /** Ancho del encuadre en km, para saber si el lector ve horizonte o planeta. */
    spanKm: number;
  }): void;
  /**
   * El color al que la niebla debe fundir, en la dirección de la vista.
   *
   * Es el cielo COMPLETO en esa dirección (degradado + dispersión), sin el
   * disco del sol ni las estrellas — o una montaña lejana se fundiría a un
   * punto blanco cada vez que quedara delante del sol. Pasarle (0,1,0) da el
   * cénit; pasarle la dirección al sol da el horizonte cálido.
   */
  horizonColor(dir: THREE.Vector3): THREE.Color;
  /** La luz del sol en este momento: color e intensidad, para que el terreno la use. */
  sunLight(): { color: THREE.Color; intensity: number; ambient: THREE.Color };
  /** Atajo: el paquete que `water.update({ sky })` quiere. NUEVO, opcional. */
  waterSky(): WaterSky;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// La paleta, por altura del sol
// ---------------------------------------------------------------------------
// Cinco claves y una interpolación lineal entre ellas. No es dispersión de
// Rayleigh: es una tabla, que es lo que se puede AFINAR mirando el fotograma.
// Un modelo físico da un cielo correcto y feo si no se le pone tono, y esta
// vista compite con FlowScape, no con un simulador atmosférico.
//
// Los valores están en el espacio en el que escribe el renderer (sRGB de
// pantalla, sin conversión: `ShaderMaterial` sin `<colorspace_fragment>` no la
// lleva, igual que el shader del terreno, cuya paleta son bytes/255).
interface SkyKey {
  /** Seno de la elevación del sol: sun.y. */
  h: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** El halo alrededor del sol. Se SUMA, así que puede pasar de uno. */
  glow: [number, number, number];
  /** Color e intensidad de la luz directa que le toca al terreno. */
  sun: [number, number, number];
  power: number;
}

const KEYS: SkyKey[] = [
  // Noche cerrada. Nada de negro puro: un cielo negro se lee como un agujero,
  // y el azul de Prusia es lo que hace que las estrellas parezcan lejos.
  { h: -0.40, zenith: [0.012, 0.018, 0.042], horizon: [0.035, 0.048, 0.090],
    glow: [0.00, 0.00, 0.00], sun: [0.32, 0.40, 0.62], power: 0.055 },
  // Crepúsculo náutico: el sol ya no está, pero el aire alto sigue iluminado.
  { h: -0.13, zenith: [0.030, 0.048, 0.115], horizon: [0.115, 0.105, 0.185],
    glow: [0.28, 0.14, 0.16], sun: [0.45, 0.42, 0.60], power: 0.10 },
  // El sol EN el horizonte. La clave que hace toda la estampa de atardecer.
  { h: 0.03, zenith: [0.105, 0.180, 0.400], horizon: [0.560, 0.430, 0.420],
    glow: [1.00, 0.46, 0.20], sun: [1.00, 0.58, 0.31], power: 0.42 },
  // Media mañana.
  { h: 0.30, zenith: [0.175, 0.345, 0.680], horizon: [0.700, 0.760, 0.850],
    glow: [1.00, 0.82, 0.58], sun: [1.00, 0.93, 0.82], power: 0.92 },
  // Mediodía.
  { h: 0.80, zenith: [0.195, 0.400, 0.790], horizon: [0.745, 0.840, 0.930],
    glow: [1.00, 0.95, 0.86], sun: [1.00, 0.97, 0.93], power: 1.00 },
];

/** El espacio: ni negro ni azul, un gris muy oscuro con una gota de añil. */
const SPACE: [number, number, number] = [0.008, 0.010, 0.020];
/** El anillo de aire sobre el limbo del planeta. */
const ATMO: [number, number, number] = [0.32, 0.55, 0.95];

function mix3(
  a: [number, number, number], b: [number, number, number], t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** La tabla, resuelta para esta altura del sol. Determinista y sin estado. */
function resolveKeys(sunY: number): SkyKey {
  const h = Math.max(-1, Math.min(1, sunY));
  let i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  // Suavizada, no lineal: con la lineal, el instante en que el sol cruza una
  // clave es un cambio de PENDIENTE del color, y al mover el mando del sol se
  // ve como un tirón. Con smoothstep la derivada llega a cero en cada clave.
  const t = smoothstep(a.h, b.h, h);
  return {
    h,
    zenith: mix3(a.zenith, b.zenith, t),
    horizon: mix3(a.horizon, b.horizon, t),
    glow: mix3(a.glow, b.glow, t),
    sun: mix3(a.sun, b.sun, t),
    power: a.power + (b.power - a.power) * t,
  };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
precision highp float;

// La matriz que devuelve un punto del plano near al mundo. Con una proyección
// en perspectiva estándar, la w del resultado es CONSTANTE sobre todo el
// triángulo (sale 1/f para cualquier x,y), así que el rayo interpolado entre
// vértices es exacto y no hace falta normalizar aquí.
uniform mat4 uInvViewProj;

out vec3 vRay;

void main() {
  // Un triángulo que cubre [-1,1]^2 de sobra. Z EN CERO, no en uno: con z=w se
  // queda justo sobre el plano far y basta un ULP para que el recorte lo tire
  // entero — pantalla negra intermitente. Como no hay test de profundidad, el
  // valor da igual mientras esté dentro.
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vec4 h = uInvViewProj * vec4(position.xy, -1.0, 1.0);
  vRay = h.xyz / h.w - cameraPosition;
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform vec3  uSun;        // dirección AL sol
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGlow;
uniform vec3  uSunDisc;    // color del disco
uniform vec3  uSpace;
uniform vec3  uAtmo;
uniform float uNight;      // 1 cuando el sol está debajo del horizonte
uniform float uShape;      // 0 plano, 1 globo
uniform float uRadius;     // radio del planeta, para el limbo
uniform float uWide;       // 0 = de cerca, 1 = el planeta entero en el encuadre

in vec3 vRay;
out vec4 outColor;

// El mismo picado entero que tipLattice en scene3d.ts: multiplicación de 32
// bits y desplazamientos. NO un hash de sin() — sin() tiene precisión distinta
// en cada driver, y entonces «el mismo mundo» tendría otras estrellas en otra
// máquina. Esto es bit a bit igual en todas partes.
float ihash(ivec3 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + uint(c.z) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}

/**
 * El campo de estrellas.
 *
 * Una rejilla cúbica de paso 1/N sobre la esfera unidad: la celda que contiene
 * al rayo lleva UNA estrella, y sólo se prueba esa celda — 4 picados por píxel
 * en vez de los 108 que costaría mirar el vecindario 3x3x3.
 *
 * Eso obliga a meter la estrella dentro del 40 % central de la celda (j entre
 * 0,3 y 0,7): si pudiera caer pegada a una cara, los píxeles del otro lado
 * probarían otra celda y la estrella saldría cortada por la mitad. Con el radio
 * del núcleo en 0,14 celdas y el centro a 0,3 como poco, ninguna estrella toca
 * su frontera.
 *
 * N=70 son ~62.000 celdas sobre la esfera; con una de cada siete ocupada salen
 * unas 8.800 estrellas, del orden de lo que se ve a ojo desnudo. Sin time en
 * la firma no hay parpadeo posible: el cielo es el mismo fotograma tras
 * fotograma, que es lo que se quiere en una captura de pantalla.
 */
float starField(vec3 d) {
  const float N = 70.0;
  vec3 p = d * N;
  ivec3 c = ivec3(floor(p));
  float present = ihash(c + ivec3(3, 5, 7));
  if (present < 0.86) return 0.0;
  vec3 j = vec3(ihash(c), ihash(c + ivec3(7, 3, 11)), ihash(c + ivec3(13, 17, 5)));
  vec3 sp = vec3(c) + 0.3 + 0.4 * j;
  float ang = length(normalize(sp) - d) * N;
  // Invertida a propósito: smoothstep con edge0 > edge1 tiene resultado
  // INDEFINIDO por especificacion, aunque todo driver conocido haga la
  // cuenta de siempre. No merece la pena apostar el cielo a eso.
  float core = 1.0 - smoothstep(0.015, 0.14, ang);
  // Ley de magnitudes en una línea: muy pocas brillantes, muchas al límite.
  float mag = pow(ihash(c + ivec3(31, 29, 23)), 3.0);
  return core * (0.10 + 0.90 * mag);
}

/** El cielo, sin disco solar ni estrellas. Gemelo exacto de domeColor en TS. */
vec3 dome(vec3 d) {
  float up = clamp(d.y, -1.0, 1.0);
  // El exponente comprime el degradado contra el horizonte, que es donde el
  // camino óptico se dispara. Con un lerp recto el cielo sale de acuarela.
  float t = pow(1.0 - clamp(up, 0.0, 1.0), 2.6);
  vec3 col = mix(uZenith, uHorizon, t);

  // Dispersión hacia el sol: un halo ancho por todo el cielo más uno estrecho
  // pegado al disco, y ambos concentrados cerca del horizonte, que es donde el
  // aire que atraviesa la luz es kilómetros y no metros.
  float cs = clamp(dot(d, uSun), -1.0, 1.0);
  float halo = pow(max(cs, 0.0), 5.0) * 0.55 + pow(max(cs, 0.0), 40.0) * 0.35;
  float low = pow(1.0 - min(abs(up), 1.0), 3.0);
  // A vista de planeta la bruma de horizonte se recorta: con el encuadre entero
  // por delante, un lavado cálido sobre medio mundo se come el mapa.
  col += uGlow * halo * (0.22 + 0.90 * low) * (1.0 - 0.55 * uWide);

  // Por debajo del horizonte NO se pone negro: se oscurece un 28 %. El mar lo
  // tapa casi siempre, y cuando no (globo, agua apagada) un salto duro en la
  // línea del horizonte se ve desde la otra punta de la sala.
  col = mix(uHorizon * 0.72, col, smoothstep(-0.12, 0.0, up));
  return col;
}

/** El disco y su aureola. Separado de dome porque la niebla NO debe fundir
 *  a él: una montaña lejana delante del sol quedaría como una mancha blanca. */
vec3 sunDisc(vec3 d) {
  float cs = clamp(dot(d, uSun), -1.0, 1.0);
  // 0,53° es el tamaño real. A 32° de campo y 760 px eso son 12 px: se ve, pero
  // como un punto duro. 0,95° lo hace legible sin que parezca una luna.
  float disc = smoothstep(cos(radians(1.25)), cos(radians(0.95)), cs);
  float aureole = pow(max(cs, 0.0), 900.0) * 0.55 + pow(max(cs, 0.0), 120.0) * 0.18;
  return uSunDisc * (disc + aureole);
}

void main() {
  vec3 d = normalize(vRay);
  vec3 col;

  if (uShape > 0.5) {
    // ---- EL GLOBO: el lector está FUERA. No hay cielo, hay espacio ---------
    //
    // Y el planeta se recorta contra él con un filo de aire. Ese filo es lo
    // único que distingue «un planeta» de «una bola de textura»: sin él, el
    // borde del globo es un corte de tijera.
    vec3 o = cameraPosition;
    float b = -dot(o, d);
    // Punto de máxima aproximación al centro del planeta (delante de la cámara).
    vec3 near = o + d * max(b, 0.0);
    float m = length(near) / max(1e-4, uRadius);
    // La capa: del limbo hacia fuera un 9 % del radio. limb la concentra en
    // el borde para que no sea una neblina sobre todo el disco.
    float shell = 1.0 - smoothstep(1.0, 1.09, m);
    float limb = smoothstep(0.80, 1.0, m) * shell;
    // Y sólo brilla el lado ILUMINADO: un anillo completo alrededor de un
    // planeta medio a oscuras es el error clásico y se nota enseguida.
    float lit = smoothstep(-0.35, 0.30, dot(normalize(near), uSun));
    // Dispersión hacia delante: el creciente se ensancha cuando se mira a
    // contraluz, que es cuando la atmósfera de verdad se ve mejor.
    float fwd = 0.55 + 0.85 * pow(max(dot(d, uSun), 0.0), 3.0);

    col = uSpace;
    col += starField(d) * vec3(0.92, 0.94, 1.0);
    col += sunDisc(d);
    // El aire tapa las estrellas que quedan detrás de él, y además emite. Las
    // dos cosas: primero se funde (las estrellas desaparecen tras el creciente)
    // y luego se suma (el creciente brilla).
    float air = clamp(limb * lit * fwd, 0.0, 1.0);
    col = mix(col, uAtmo * 0.55, air);
    col += uAtmo * air * 0.45;
  } else {
    // ---- EL PLANO: hay horizonte ------------------------------------------
    col = dome(d);
    col += sunDisc(d) * smoothstep(-0.06, 0.02, d.y);
    // Las estrellas sólo de noche, y sólo lejos del horizonte: la extinción
    // atmosférica se las come antes de llegar abajo, y fingirla es gratis.
    float vis = uNight * smoothstep(0.0, 0.28, d.y);
    col += starField(d) * vis * vec3(0.92, 0.94, 1.0);
  }

  outColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

export function createSky(o: SkyOptions): Sky {
  void o.renderer; // no hace falta nada del renderer; el campo queda por contrato

  const geometry = new THREE.BufferGeometry();
  // UN triángulo, no dos: el cuadrado de dos triángulos tiene una diagonal por
  // la que los derivadas de pantalla (dFdx/dFdy) se rompen, y aunque aquí no se
  // usen, el triángulo grande además ahorra la mitad de los quads del borde.
  geometry.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3,
  ));

  const uniforms = {
    uInvViewProj: { value: new THREE.Matrix4() },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunDisc: { value: new THREE.Color() },
    uSpace: { value: new THREE.Color(SPACE[0], SPACE[1], SPACE[2]) },
    uAtmo: { value: new THREE.Color(ATMO[0], ATMO[1], ATMO[2]) },
    uNight: { value: 0 },
    uShape: { value: 0 },
    uRadius: { value: R_GLOBE },
    uWide: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    // Ni test ni escritura: esto ES el fondo. Con renderOrder muy negativo sale
    // el primero de la lista opaca, y todo lo que venga detrás lo tapa por el
    // z-buffer normal, sin segundo pase ni render target.
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10000;
  // Obligatorio: la geometría vive en coordenadas de recorte, así que su esfera
  // envolvente no significa nada y el frustum culling la tiraría casi siempre.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  // Estado del último `update`, para que `horizonColor` y `sunLight` respondan
  // con lo que se está PINTANDO y no con otra evaluación de la tabla.
  let keys = resolveKeys(0.6);
  let night = 0;
  let wide = 0;
  let globe = false;
  const sun = new THREE.Vector3(0, 1, 0);

  const tmpColor = new THREE.Color();
  const tmpDir = new THREE.Vector3();
  // Reservados una vez. Estos dos métodos se llaman en cada fotograma desde el
  // bucle de dibujo, y tres THREE.Color nuevos por fotograma son basura que el
  // recolector acaba pagando justo cuando la cámara se está moviendo.
  const outSun = new THREE.Color();
  const outAmb = new THREE.Color();
  const outZenith = new THREE.Color();
  const outWarm = new THREE.Color();
  const outWaterSun = new THREE.Color();
  const flatSun = new THREE.Vector3();

  /** Gemelo en CPU de `dome()`. Cualquier cambio va en los dos o la niebla
   *  deja de coincidir con el cielo, que es el fallo que este par evita. */
  function domeColor(dir: THREE.Vector3, out: THREE.Color): THREE.Color {
    tmpDir.copy(dir);
    const len = tmpDir.length();
    if (len < 1e-9) tmpDir.set(0, 1, 0); else tmpDir.multiplyScalar(1 / len);
    const up = Math.max(-1, Math.min(1, tmpDir.y));
    const t = Math.pow(1 - clamp01(up), 2.6);
    const z = keys.zenith;
    const hz = keys.horizon;
    let r = z[0] + (hz[0] - z[0]) * t;
    let g = z[1] + (hz[1] - z[1]) * t;
    let b = z[2] + (hz[2] - z[2]) * t;
    const cs = Math.max(-1, Math.min(1, tmpDir.dot(sun)));
    const cp = Math.max(0, cs);
    const halo = Math.pow(cp, 5) * 0.55 + Math.pow(cp, 40) * 0.35;
    const low = Math.pow(1 - Math.min(Math.abs(up), 1), 3);
    const k = halo * (0.22 + 0.9 * low) * (1 - 0.55 * wide);
    r += keys.glow[0] * k;
    g += keys.glow[1] * k;
    b += keys.glow[2] * k;
    const below = smoothstep(-0.12, 0, up);
    r = hz[0] * 0.72 + (r - hz[0] * 0.72) * below;
    g = hz[1] * 0.72 + (g - hz[1] * 0.72) * below;
    b = hz[2] * 0.72 + (b - hz[2] * 0.72) * below;
    return out.setRGB(r, g, b);
  }

  return {
    mesh,

    update(u) {
      const { camera } = u;
      sun.copy(u.sun);
      if (sun.lengthSq() < 1e-12) sun.set(0, 1, 0); else sun.normalize();
      globe = u.shape === 'globe';
      keys = resolveKeys(sun.y);
      // 1 cuando el sol ya no ilumina nada, y con la misma rampa que la
      // intensidad: si no, salen estrellas sobre un cielo todavía azul.
      night = 1 - smoothstep(-0.16, 0.02, sun.y);
      // Encuadre: por debajo de 3.000 km hay horizonte de verdad; por encima de
      // 20.000 el lector está mirando un mapa y la bruma sólo estorba.
      wide = smoothstep(3000, 20000, u.spanKm);

      // La cámara puede haberse movido después del último render (OrbitControls
      // escribe `position` y no toca la matriz), así que se fuerza aquí. Sin
      // esto el cielo va un fotograma por detrás del terreno y al girar rápido
      // el horizonte «resbala» sobre el suelo.
      camera.updateMatrixWorld();
      (uniforms.uInvViewProj.value as THREE.Matrix4)
        .multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);

      (uniforms.uSun.value as THREE.Vector3).copy(sun);
      (uniforms.uZenith.value as THREE.Color).setRGB(keys.zenith[0], keys.zenith[1], keys.zenith[2]);
      (uniforms.uHorizon.value as THREE.Color).setRGB(keys.horizon[0], keys.horizon[1], keys.horizon[2]);
      (uniforms.uGlow.value as THREE.Color).setRGB(keys.glow[0], keys.glow[1], keys.glow[2]);
      // El disco es la luz del sol, pero nunca apagado del todo: aunque esté
      // rasante sigue siendo la cosa más brillante del encuadre.
      (uniforms.uSunDisc.value as THREE.Color).setRGB(
        keys.sun[0] * (0.55 + 0.45 * keys.power),
        keys.sun[1] * (0.55 + 0.45 * keys.power),
        keys.sun[2] * (0.55 + 0.45 * keys.power),
      );
      uniforms.uNight.value = night;
      uniforms.uShape.value = globe ? 1 : 0;
      uniforms.uWide.value = wide;
    },

    horizonColor(dir) {
      if (globe) {
        // En el globo no hay horizonte: lo que rodea al planeta es espacio con
        // una pizca del anillo de aire. Fundir a eso deja la silueta limpia.
        return tmpColor.setRGB(
          SPACE[0] + ATMO[0] * 0.10,
          SPACE[1] + ATMO[1] * 0.10,
          SPACE[2] + ATMO[2] * 0.10,
        );
      }
      return domeColor(dir, tmpColor);
    },

    sunLight() {
      outSun.setRGB(keys.sun[0], keys.sun[1], keys.sun[2]);
      // El relleno: mitad cénit, mitad horizonte, que es de donde viene de
      // verdad la luz indirecta de una ladera en sombra.
      outAmb.setRGB(
        (keys.zenith[0] + keys.horizon[0]) * 0.5,
        (keys.zenith[1] + keys.horizon[1]) * 0.5,
        (keys.zenith[2] + keys.horizon[2]) * 0.5,
      );
      return { color: outSun, intensity: keys.power, ambient: outAmb };
    },

    waterSky() {
      domeColor(UP, outZenith);
      // El horizonte del LADO DEL SOL: la dirección al sol aplastada contra el
      // plano del horizonte. Es el color contra el que se recorta el mar en la
      // lejanía cuando se mira a contraluz, y el único sitio donde un fundido
      // al horizonte «medio» se notaría como una costura.
      flatSun.set(sun.x, 0, sun.z);
      if (flatSun.lengthSq() < 1e-9) flatSun.set(0, 0, 1);
      domeColor(flatSun.normalize(), outWarm);
      outWaterSun.setRGB(keys.sun[0], keys.sun[1], keys.sun[2]);
      return {
        zenith: outZenith,
        horizonWarm: outWarm,
        sunColor: outWaterSun,
        intensity: keys.power,
      };
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
