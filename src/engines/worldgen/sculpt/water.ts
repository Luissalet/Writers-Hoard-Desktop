// ============================================
// Sculpt — el agua
// ============================================
// Lo que había era un `MeshBasicMaterial` azul al 50 % de opacidad. Basic
// significa SIN LUZ: ignora el sol, ignora la cámara, ignora el fondo. Un mar
// así no puede reflejar, no puede brillar y no puede tener orilla — es una
// lámina de celofán sobre el relieve. Y terminaba exactamente en el borde del
// mundo, así que el océano tenía un canto recto a doscientos cuarenta unidades.
//
// Esto es un shader de verdad. Las cuatro cosas que hacen que el ojo lea «agua»
// y no «plástico azul», por orden de cuánto aportan:
//
//   1. FRESNEL. Mirando a plomo se ve el fondo; mirando de canto se ve el
//      cielo. Ese cambio con el ángulo es la firma óptica del agua y no la
//      tiene ningún otro material. Sin él, todo lo demás da igual.
//   2. LA ORILLA. Espuma donde el terreno cruza el nivel del mar, con el ancho
//      medido EN PANTALLA. Es lo que ata el agua a la tierra; sin ella la
//      costa es un corte de tijera entre dos colores.
//   3. EL DESTELLO. Un sol especular sobre el oleaje: el reguero de luz que
//      dice a la vez dónde está el sol y que la superficie se mueve.
//   4. LA LEJANÍA. El plano se extiende hasta el far y se funde al color del
//      horizonte, así que el océano no se acaba: se aleja.
//
// TODO DETERMINISTA. `time` entra por parámetro y la semilla es una cadena; no
// hay `Math.random` ni `Date.now` en este archivo, y el ruido del oleaje es un
// picado entero, bit a bit igual en cualquier driver.

import * as THREE from 'three';
import { GLOBE_RELIEF } from './scene3d';
import { EARTH_KM } from '../core/camera';

export interface WaterOptions {
  /** Semilla del mundo, para que el oleaje sea determinista. */
  seed: string;
  /** Lado del plano de mundo en unidades de escena (hoy SIZE_X = 240). */
  sizeX: number;
  sizeZ: number;
  /** Radio del globo (hoy 240/2π). */
  radius: number;
}

/**
 * El cielo que el agua refleja. NUEVO respecto al contrato original y OPCIONAL:
 * sin él la lejanía y el reflejo se apañan con `horizon` a secas y se pierde el
 * degradado cénit→horizonte del reflejo. Se construye entero con
 * `sky.waterSky()`.
 */
export interface WaterSkyInput {
  zenith: THREE.Color;
  horizonWarm: THREE.Color;
  sunColor: THREE.Color;
  intensity: number;
}

export interface Water {
  plane: THREE.Mesh;
  globe: THREE.Mesh;
  update(o: {
    camera: THREE.PerspectiveCamera;
    sun: THREE.Vector3;
    /** Segundos desde el montaje. Determinista: se lo paso yo. */
    time: number;
    /**
     * Color del horizonte hacia el que fundir en la lejanía.
     *
     * LA DIRECCIÓN VA APLANADA: `sky.horizonColor(new Vector3(fwd.x, 0, fwd.z))`.
     * Con la dirección de vista tal cual, una cámara que mira un poco hacia
     * abajo —o sea, casi siempre— pide el cielo POR DEBAJO del horizonte, que
     * es más oscuro, y entonces la lejanía del mar y el reflejo del oleaje se
     * van a gris. Medido: en la pose de costa del banco, el mar entero salía
     * moteado de gris plomo en vez de azul.
     */
    horizon: THREE.Color;
    /** Textura R32F de altura del mundo, para la orilla y la profundidad. */
    heightTex: THREE.DataTexture | null;
    gridW: number; gridH: number;
    /** Unidades de escena por km de altura, para leer la profundidad. */
    yMul: number;
    /** Nivel del mar en las unidades del grid. */
    seaLevel: number;
    /** OPCIONAL. Ver `WaterSkyInput`. */
    sky?: WaterSkyInput;
  }): void;
  dispose(): void;
}

/**
 * La semilla, de cadena a entero.
 *
 * Mismo FNV-1a de 32 bits que usa el resto del motor. El oleaje se desplaza a
 * partir de este número, así que dos mundos distintos no tienen el mar en la
 * misma fase — y el mismo mundo lo tiene siempre igual, que es la mitad del
 * trato.
 */
function seedToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const VERT = /* glsl */`
precision highp float;

out vec3 vWorld;

void main() {
  // La posición del MUNDO, no la de vista: la profundidad del fondo, el oleaje
  // y la bruma se calculan todos en coordenadas de mundo, y el plano se
  // recoloca bajo la cámara cada fotograma (ver update), así que cualquier
  // cosa atada al espacio local se movería con él.
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler2D;

uniform sampler2D uHeight;
uniform float uHasHeight;
uniform vec2  uGrid;
uniform float uSea;        // nivel del mar, en km (unidades del grid)
uniform float uSizeX;
uniform float uSizeZ;
uniform float uShape;      // 0 plano, 1 globo
uniform vec3  uSun;        // dirección AL sol
uniform vec3  uCam;
uniform float uTime;
uniform float uPhase;      // desplazamiento del oleaje sacado de la semilla
uniform vec3  uFog;        // el color al que funde la lejanía
uniform vec3  uSkyZenith;
uniform vec3  uSkyWarm;
uniform vec3  uSunColor;
uniform float uSunPower;
uniform float uFogDist;
uniform float uKmPerUnit;  // km de suelo por unidad de escena
uniform float uSteep;      // pendiente máxima del oleaje

in vec3 vWorld;
out vec4 outColor;

// ---------------------------------------------------------------------------
// El fondo
// ---------------------------------------------------------------------------
// LA MISMA RECONSTRUCCIÓN QUE EL TERRENO, pesos suavizados incluidos (ver
// baseHeightAt en scene3d.ts). No es un detalle: si el agua reconstruyera el
// campo de otra manera, su cero y el cero del terreno cruzarían en sitios
// distintos y la espuma quedaría un poco tierra adentro o un poco mar adentro,
// que es peor que no tener espuma. R32F no se puede filtrar en hardware, así
// que la bilineal va a mano — cuatro fetches y no puede fallar.
float floorKmAt(vec2 uv) {
  vec2 t = uv * uGrid - 0.5;
  vec2 f = fract(t);
  f = f * f * (3.0 - 2.0 * f);
  ivec2 i = ivec2(floor(t));
  int gw = int(uGrid.x);
  int gh = int(uGrid.y);
  int ax = ((i.x % gw) + gw) % gw;
  int bx = (((i.x + 1) % gw) + gw) % gw;
  int ay = clamp(i.y, 0, gh - 1);
  int by = clamp(i.y + 1, 0, gh - 1);
  float h00 = texelFetch(uHeight, ivec2(ax, ay), 0).r;
  float h10 = texelFetch(uHeight, ivec2(bx, ay), 0).r;
  float h01 = texelFetch(uHeight, ivec2(ax, by), 0).r;
  float h11 = texelFetch(uHeight, ivec2(bx, by), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// ---------------------------------------------------------------------------
// El oleaje
// ---------------------------------------------------------------------------
// Ruido de valor CON DERIVADA ANALÍTICA. La alternativa —diferencias centradas
// para sacar la normal— cuesta cuatro evaluaciones por octava en vez de una:
// dieciséis fetches de ruido por píxel contra cuatro, sobre cada píxel de mar
// de la pantalla. Y la derivada sale exacta en vez de aproximada, así que el
// destello no tiembla.
float wHash(ivec2 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}

/** .x el valor, .yz el gradiente. Interpolación quíntica: la cúbica deja la
 *  SEGUNDA derivada a saltos y eso se ve como aristas en el reflejo especular,
 *  que es justo lo que más amplifica las discontinuidades. */
vec3 noised(vec2 x) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = wHash(i);
  float b = wHash(i + ivec2(1, 0));
  float c = wHash(i + ivec2(0, 1));
  float d = wHash(i + ivec2(1, 1));
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
              du.x * (k1 + k3 * u.y),
              du.y * (k2 + k3 * u.x));
}

/**
 * La pendiente del oleaje en el plano tangente, y de paso el valor de la
 * octava más gruesa (que la espuma usa para romper el borde).
 *
 * LA FRECUENCIA SIGUE AL PÍXEL, no al mundo. El encuadre de esta vista va de
 * 0,25 km a 40.000: cinco órdenes de magnitud. Un oleaje de tamaño fijo en el
 * mundo es invisible en un extremo y monstruoso en el otro; no hay número que
 * valga para los dos. Así que la onda más larga mide unos noventa píxeles
 * SIEMPRE (sesenta, medidos) — cuantizada a octavas enteras, porque una frecuencia que resbala de
 * forma continua con el zoom hace que el mar repte al acercarse, mientras que
 * duplicarla deja cada octava sobre las posiciones que ya tenía. Misma
 * disciplina que el relieve inventado del terreno, y por la misma razón.
 *
 * EL PESO DE CADA OCTAVA ES FUNCIÓN DE SU TAMAÑO EN PANTALLA, no de su índice
 * en el bucle. Esa es la diferencia entre este código y el primero que escribí,
 * y se veía: con pesos 0,58^k, cada vez que el nivel de detalle subía un
 * escalón todas las octavas cambiaban de peso de golpe y aparecían DOS RAYAS
 * HORIZONTALES cruzando el mar de lado a lado — medidas en la pose regional del
 * banco, a 255 y 465 píxeles. Aquí s = k - fade recorre los mismos valores
 * antes y después del escalón, así que el conjunto de (frecuencia, peso) es
 * idéntico y la costura no puede existir. Cuesta una octava más: cinco
 * evaluaciones de ruido en vez de cuatro.
 */
vec2 waveField(vec2 p, float px, out float coarse) {
  // TOPE A LA FRECUENCIA. p son coordenadas de mundo absolutas, y p*f con f
  // sin límite se va a millones: un float de 32 bits tiene 24 bits de mantisa,
  // así que a partir de ~1e6 el fract del ruido se queda sin dígitos y la
  // ola degenera en bandas. El tope está en una milésima de celda de mundo —
  // por debajo de eso ya no es oleaje, es espuma, y la pinta la orilla.
  float lodMax = log2(1.0 / max(1e-6, (uSizeX / max(1.0, uGrid.x)) * 0.002));
  float lod = min(log2(1.0 / max(1e-7, px * 60.0)), lodMax);
  float base = floor(lod);
  float fade = lod - base;

  vec2 g = vec2(0.0);
  float wsum = 0.0;
  coarse = 0.5;
  for (int k = 0; k < 5; k++) {
    // s dice cuánto mide esta octava EN PANTALLA: su onda son 90*2^-s píxeles.
    float s = float(k) - fade;
    float w = pow(0.62, s)
      * smoothstep(-1.0, 0.05, s)
      * (1.0 - smoothstep(2.95, 4.0, s));
    if (w <= 0.002) continue;
    // El índice ABSOLUTO de la octava. El giro y el arrastre cuelgan de él y no
    // de k: si colgaran de k, al cruzar un escalón la misma banda de frecuencia
    // cambiaría de dirección y el mar daría un tirón al hacer zoom.
    float n = base + float(k);
    float fr = exp2(n);
    float ang = n * 0.6435;
    float ca = cos(ang), sa = sin(ang);
    mat2 R = mat2(ca, sa, -sa, ca);
    vec2 drift = vec2(cos(n * 2.399), sin(n * 2.399));
    // El arrastre va en el espacio de MUESTREO, no en el del mundo: así la
    // velocidad aparente en pantalla es la misma a cualquier altura de cámara,
    // que es lo único que el lector puede juzgar. Y como el muestreo de cada
    // octava está a su escala, la marejada larga corre y el rizo fino apenas,
    // que es lo que hace un mar de verdad.
    vec3 nz = noised((R * p) * fr + drift * (uTime * 0.085 + uPhase * 37.0));
    // SIN el factor de frecuencia. La pendiente que aporta una octava es
    // amplitud x frecuencia, y la amplitud de un oleaje cae como 1/frecuencia:
    // el producto es constante. Multiplicar por fr aquí es el error clásico y
    // convierte el mar en papel de lija en cuanto se acerca la cámara.
    g += (nz.yz * R) * w;
    // La octava media, para la espuma: la primera se apaga cuando fade->1 y el
    // borde de la orilla se quedaría sin ondular justo al cambiar de nivel.
    if (k == 2) coarse = nz.x;
    wsum += w;
  }
  return g / max(1e-4, wsum);
}

/** El cielo que se refleja, del mismo modelo que dibuja el cielo de verdad. */
vec3 skyAt(vec3 rd, vec3 up) {
  float d = clamp(dot(rd, up), 0.0, 1.0);
  float t = pow(1.0 - d, 2.6);
  vec3 c = mix(uSkyZenith, uFog, t);
  // El lado cálido: mirando a contraluz el reflejo tiene que traer el naranja
  // del horizonte o el atardecer se queda sólo en el cielo y el mar lo
  // desmiente.
  float cs = max(dot(rd, uSun), 0.0);
  return mix(c, uSkyWarm, pow(cs, 4.0) * 0.6);
}

void main() {
  vec3 V = normalize(uCam - vWorld);
  vec3 up, east, north;
  if (uShape < 0.5) {
    up = vec3(0.0, 1.0, 0.0);
    east = vec3(1.0, 0.0, 0.0);
    north = vec3(0.0, 0.0, 1.0);
  } else {
    up = normalize(vWorld);
    float lon = atan(vWorld.z, vWorld.x);
    east = vec3(-sin(lon), 0.0, cos(lon));
    north = normalize(cross(east, up));
  }

  // ---- TODAS LAS DERIVADAS, ANTES DE CUALQUIER RAMA ----------------------
  // dFdx, dFdy y fwidth tienen resultado INDEFINIDO en flujo de control
  // no uniforme: se calculan a partir del cuadrado de 2x2 píxeles, y si alguno
  // de los cuatro ya ha salido por un return, lo que devuelven es el registro
  // que ese píxel tuviera. Con la salida temprana de más abajo eso pondría una
  // franja de un par de píxeles con la escala del oleaje y el ancho de la
  // espuma equivocados justo en la línea del horizonte. Se calculan aquí, con
  // los cuatro píxeles todavía vivos, y luego ya se puede ramificar.
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  float px = max(1e-7, (length(dpx) + length(dpy)) * 0.5);

  // ---- dónde está esto en el mundo ---------------------------------------
  vec2 uv;
  // Cuánto se sale de la huella del mundo, en unidades de escena. Cero dentro.
  float outside = 0.0;
  if (uShape < 0.5) {
    uv = vec2(vWorld.x / uSizeX + 0.5, vWorld.z / uSizeZ + 0.5);
    vec2 q = clamp(uv, 0.0, 1.0);
    outside = length((uv - q) * vec2(uSizeX, uSizeZ));
    // Fuera NO se envuelve la lectura: repetiría la costa del otro extremo en
    // mar abierto. Se lee el BORDE y se lleva a mar abierto con una rampa —
    // ver más abajo, es lo que quita el marco oscuro alrededor del mapa.
    uv = q;
  } else {
    float r = max(1e-5, length(vWorld));
    float lat = asin(clamp(vWorld.y / r, -1.0, 1.0));
    uv = vec2(atan(vWorld.z, vWorld.x) / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
  }

  // Profundidad en km. La lectura se hace SIEMPRE (no dentro de un if) para
  // que su fwidth siga siendo uniforme.
  float floorKm = uHasHeight > 0.5 ? floorKmAt(uv) : -2.0;
  // EL MAR NO SE ACABA EN EL BORDE DEL MUNDO. Fuera de la huella la
  // profundidad sale del borde y se funde a mar abierto en un ancho del 8 % del
  // mundo. Con un valor fijo fuera, la vista de mapa dibujaba un marco azul
  // oscuro alrededor de la lámina — el mismo defecto que tenía el plano de 240
  // unidades, sólo que más lejos.
  // 1,6 km, no 4: medido contra el mar del propio mundo en la vista de mapa. A
  // 4 km el exterior salía casi negro y dibujaba un marco alrededor de la
  // lámina; 1,6 es del orden de la plataforma media y el borde desaparece.
  float openKm = 1.6;
  float edgeMix = smoothstep(0.0, uSizeX * 0.08, outside);
  float dKm = mix(uSea - floorKm, openKm, edgeMix);
  // Y fuera del mundo nunca hay orilla: la profundidad no puede bajar de cero
  // o aparecerían espumas en mitad del océano al prolongar una costa.
  if (outside > 0.0) dKm = max(dKm, mix(0.0, 0.4, edgeMix));
  float dw = fwidth(dKm);

  // ---- la bruma, y la salida temprana ------------------------------------
  // El plano llega hasta el far, así que junto al horizonte un solo píxel cubre
  // kilómetros y la w de la interpolación se dispara: las uv del fondo pierden
  // precisión y el mar se llena de puntitos. Ahí la bruma ya vale uno, el color
  // es constante, y salir antes ahorra a la vez el ruido y el trabajo.
  float haze;
  if (uShape < 0.5) {
    // Distancia HORIZONTAL, no en línea recta. Es la que mide el aire que
    // atraviesa la mirada: desde muy alto mirando a plomo el camino es corto y
    // el mapa tiene que quedar limpio; mirando al horizonte es infinito. Con la
    // distancia recta, una vista cenital del planeta entero saldría lavada.
    float dxz = length(vWorld.xz - uCam.xz);
    haze = 1.0 - exp(-pow(dxz / max(1e-3, uFogDist), 1.3));
  } else {
    // En el globo no hay horizonte: la bruma es el limbo, donde la mirada
    // atraviesa la atmósfera de canto. Y sólo del lado del día: un halo
    // completo alrededor de un planeta medio a oscuras se nota enseguida.
    float lit = smoothstep(-0.30, 0.35, dot(up, uSun));
    haze = pow(1.0 - clamp(dot(up, V), 0.0, 1.0), 3.5) * 0.8 * (0.12 + 0.88 * lit);
  }
  vec3 fogCol = uShape > 0.5
    ? uSkyWarm
    : mix(uFog, uSkyWarm, pow(max(dot(-V, uSun), 0.0), 3.0) * 0.55);
  if (haze > 0.995) {
    outColor = vec4(fogCol, 1.0);
    return;
  }

  // ---- el oleaje ----------------------------------------------------------
  // A vista de mapa el oleaje no es oleaje: es grano sobre el mapa. Se apaga
  // cuando un píxel pasa de unos kilómetros de suelo, que es cuando una onda
  // entera dejaría de caber en él.
  //
  // EL EJE MENOR, no la media. Mirando de canto, la derivada vertical de la
  // posición se dispara —un píxel abarca decenas de unidades en profundidad— y
  // con la media este umbral se cruzaba a media distancia aunque el zoom fuera
  // de comarca: en la pose de costa aparecía una RAYA HORIZONTAL a diecisiete
  // unidades donde el oleaje se apagaba de golpe. El eje menor mide el zoom y
  // no el escorzo, que es lo que este umbral quiere saber.
  float kmPerPx = min(length(dpx), length(dpy)) * uKmPerUnit;
  float waveGate = 1.0 - smoothstep(3.0, 18.0, kmPerPx);
  vec2 wp = vec2(dot(vWorld, east), dot(vWorld, north));
  float coarse = 0.5;
  vec2 slope = waveField(wp, px, coarse) * uSteep * waveGate;
  // Cerca de la orilla el agua se encrespa: la ola siente el fondo. Sale gratis
  // porque la profundidad ya está calculada para el color.
  slope *= 1.0 + (1.0 - smoothstep(0.0, 0.35, dKm)) * 0.8;
  vec3 N = normalize(up - east * slope.x - north * slope.y);

  // ---- color del cuerpo de agua ------------------------------------------
  // LA RAMPA ARRANCA PLANA (d*d*(3-2d)), igual que la del terreno: el fondo
  // cambia decenas de metros entre celdas vecinas y una curva con pendiente en
  // el cero convierte ese ruido batimétrico en moteado. Los extremos son los
  // mismos azules que pinta el terreno bajo el agua, para que la plataforma no
  // discuta consigo misma allí donde el agua es casi transparente.
  float d = clamp(dKm / 2.4, 0.0, 1.0);
  float t = d * d * (3.0 - 2.0 * d);
  vec3 body = mix(vec3(0.330, 0.640, 0.700), vec3(0.055, 0.155, 0.265), t);
  // Y la transparencia sigue a la profundidad: en el bajío se ve el fondo (es
  // lo que hace que una playa parezca una playa), en el abismo no. El mínimo
  // NO es cero: con 0,14 el bajío mostraba casi sólo el fondo, que el terreno
  // pinta ya bastante oscuro, y la orilla salía como una franja marino en vez
  // de como una playa. A 0,32 el agua tiñe y el fondo se sigue viendo.
  float bodyA = mix(0.32, 0.90, t);

  // ---- Fresnel: el reflejo ------------------------------------------------
  // Schlick con F0 = 0,02, que es el agua de verdad. De frente refleja un 2 %
  // y se ve el fondo; a quince grados sobre la superficie refleja la mitad; en
  // el horizonte, todo. Ese barrido es la razón de que el mar sea azul cerca y
  // blanco lejos, y no hay que pintarlo: sale solo.
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 refl = skyAt(reflect(-V, N), up);

  // EL CUERPO DE AGUA TAMBIÉN SE APAGA DE NOCHE.
  //
  // El color del agua no es pintura: es luz del sol que ha entrado, ha rebotado
  // en las partículas y ha vuelto a salir. Sin sol no hay nada que salir. La
  // primera versión no lo hacía y el resultado era un mar turquesa de mediodía
  // bajo un cielo estrellado — lo más falso de todo el fotograma, porque el
  // reflejo SÍ estaba oscuro y los dos se desmentían el uno al otro. La curva
  // va con exponente 0,65 para que el crepúsculo no se hunda de golpe.
  float lightAmt = 0.12 + 0.88 * pow(clamp(uSunPower, 0.0, 1.0), 0.65);
  body *= lightAmt;

  vec3 col = mix(body, refl, F);

  // ---- el destello del sol -----------------------------------------------
  // Dos lóbulos: uno ancho que da el brillo general de la superficie y uno
  // estrecho que es el reguero de chispas. El estrecho solo, sobre una normal
  // con oleaje, sale como sal esparcida; el ancho solo parece plástico.
  float sunUp = smoothstep(-0.02, 0.10, uSun.y);
  float m = max(dot(reflect(-V, N), uSun), 0.0);
  float glint = (pow(m, 60.0) * 0.16 + pow(m, 600.0) * 1.10) * sunUp * uSunPower;
  // Y se comprime antes de sumar. Sin esto el reguero salía como manchas de
  // blanco puro recortadas — «cromo mojado» — porque el lóbulo estrecho pasa
  // holgadamente de uno y el buffer es de ocho bits: todo lo que pase se
  // aplasta al mismo valor y el degradado de la chispa desaparece. La
  // compresión deja el pico justo por debajo de saturar y conserva la forma.
  glint = glint / (1.0 + glint * 0.75);
  col += uSunColor * glint;

  // ---- la orilla ----------------------------------------------------------
  // EL ANCHO SE MIDE EN PANTALLA. Una costa tendida y un acantilado reparten el
  // mismo metro de profundidad sobre cien píxeles o sobre uno; una orla medida
  // en kilómetros es invisible en la primera y un borde duro en el segundo.
  // fwidth da el ancho en el que la profundidad cambia un píxel, así que la
  // espuma mide lo mismo en pantalla a cualquier altura de cámara — y está
  // antialiasada por construcción.
  float foam = 0.0;
  if (uHasHeight > 0.5 && outside <= 0.0) {
    float w = max(dw * 2.4, 1e-5);
    // El borde se rompe con la octava gruesa del propio oleaje: una orla de
    // ancho constante alrededor de un continente es un trazo de rotulador.
    float edge = dKm + (coarse - 0.5) * w * 1.7;
    float lip = 1.0 - smoothstep(0.0, w, max(edge, 0.0));
    // Y una segunda banda, más ancha y a rayas, que es la resaca.
    float surf = 1.0 - smoothstep(0.0, w * 5.0, max(edge, 0.0));
    float stripes = smoothstep(0.42, 0.80, coarse);
    foam = clamp(max(lip, surf * stripes * 0.75), 0.0, 1.0);
    // A vista de mapa se queda en un tercio: sigue siendo la línea de costa,
    // pero deja de ser el elemento más brillante de un planeta entero.
    foam *= mix(0.34, 1.0, waveGate);
  }
  // La espuma es agua con aire: refleja, no emite. De noche tiene que apagarse
  // con todo lo demás o queda un collar fosforescente alrededor de cada isla.
  col = mix(col, vec3(0.93, 0.96, 0.98) * lightAmt, foam);

  float alpha = clamp(bodyA + F * 0.85 + glint + foam, 0.0, 1.0);

  // ---- y la lejanía -------------------------------------------------------
  col = mix(col, fogCol, haze);
  alpha = mix(alpha, 1.0, haze);
  outColor = vec4(col, alpha);
}
`;

interface WaterUniforms {
  [name: string]: THREE.IUniform;
}

function makeUniforms(o: WaterOptions, shape: number, phase: number): WaterUniforms {
  return {
    uHeight: { value: null },
    uHasHeight: { value: 0 },
    uGrid: { value: new THREE.Vector2(1, 1) },
    uSea: { value: 0 },
    uSizeX: { value: o.sizeX },
    uSizeZ: { value: o.sizeZ },
    uShape: { value: shape },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uPhase: { value: phase },
    uFog: { value: new THREE.Color(0.5, 0.6, 0.7) },
    uSkyZenith: { value: new THREE.Color(0.2, 0.4, 0.7) },
    uSkyWarm: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSunPower: { value: 1 },
    uFogDist: { value: o.sizeX },
    uKmPerUnit: { value: EARTH_KM / o.sizeX },
    // Pendiente máxima del oleaje. 0,55 (unos 29 grados) era demasiado: en una
    // vista rasante bastaba una cara de ola para que el Fresnel saltara a uno y
    // el mar se llenaba de manchas blancas del tamaño de una nube. 0,34 deja el
    // brillo donde tiene que estar —el reguero del sol— y el resto azul.
    uSteep: { value: 0.34 },
  };
}

function makeMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // SE MANTIENEN LOS DOS, y no por inercia.
    //
    // `depthWrite:false` porque el agua es transparente en el bajío: si
    // escribiera profundidad, el trozo de mar que se dibuja antes taparía al
    // que se dibuja después y el orden de los triángulos decidiría el color.
    //
    // `polygonOffset` con sesgo CONSTANTE (factor a cero) porque la plataforma
    // continental está a un pelo del nivel del mar y empata en el z-buffer con
    // el plano de agua: sin el sesgo, sobre esas llanuras sumergidas enormes
    // parpadea agua y fondo. El factor multiplicaría la pendiente de
    // profundidad del polígono, que en un plano visto casi de canto es enorme,
    // y ahogaría montañas legítimamente emergidas.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
}

export function createWater(o: WaterOptions): Water {
  const phase = seedToInt(o.seed);

  // Un cuadrado de lado UNO, escalado cada fotograma. La extensión del océano
  // depende del far, y el far lo recalcula la vista en cada `draw` a partir de
  // la distancia al objetivo: una geometría de tamaño fijo o se queda corta al
  // alejarse (canto visible) o desperdicia mundo al acercarse.
  const planeGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const planeUniforms = makeUniforms(o, 0, phase);
  const planeMat = makeMaterial(planeUniforms);
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 1;
  // La geometría se recoloca bajo la cámara, así que su esfera envolvente
  // miente hasta que three la recalcula; y siempre está delante, por
  // construcción.
  plane.frustumCulled = false;

  // 96x64 como el que había: el mar del globo se ve en silueta contra el
  // espacio y ahí sí se nota el polígono. La normal es por píxel, así que los
  // segmentos sólo pagan la silueta.
  const globeGeo = new THREE.SphereGeometry(o.radius, 96, 64);
  const globeUniforms = makeUniforms(o, 1, phase);
  const globeMat = makeMaterial(globeUniforms);
  const globe = new THREE.Mesh(globeGeo, globeMat);
  globe.renderOrder = 1;

  const tmp = new THREE.Vector3();
  // Fuera del bucle: `update` corre sesenta veces por segundo y un literal de
  // array dentro reserva memoria en cada fotograma, que es basura para el
  // recolector justo en el hilo que dibuja.
  const BOTH = [planeUniforms, globeUniforms];

  return {
    plane,
    globe,

    update(u) {
      const seaY = u.seaLevel * u.yMul;
      const cam = u.camera;
      cam.updateMatrixWorld();

      // EL PLANO SIGUE A LA CÁMARA. El océano tiene que llegar al horizonte a
      // cualquier altura, y el horizonte de un plano infinito está a distancia
      // infinita: lo único que lo acota es el far. Medio lado >= far garantiza
      // que el recorte del far cae siempre sobre agua ya fundida al horizonte,
      // donde no puede verse un canto. Antes el plano medía el mundo (240x120)
      // y el océano se acababa en línea recta a la vista de todos.
      const side = Math.max(u.camera.far * 2.4, o.sizeX * 3);
      plane.position.set(cam.position.x, seaY, cam.position.z);
      plane.scale.set(side, side, 1);
      plane.updateMatrix();
      plane.updateMatrixWorld(true);

      // En el globo el nivel del mar sube o baja el radio con el mismo factor
      // de relieve que usa el terreno, o el agua y la costa no coincidirían.
      const r = 1 + (u.seaLevel * u.yMul * GLOBE_RELIEF) / Math.max(1e-6, o.radius);
      globe.scale.setScalar(r);

      tmp.copy(u.sun);
      if (tmp.lengthSq() < 1e-12) tmp.set(0, 1, 0); else tmp.normalize();

      // La bruma, en unidades de escena.
      //
      // Escala con la ALTURA sobre el agua, no con la distancia de la mirada:
      // el aire que atraviesa un rayo hasta un punto a x metros por delante es
      // proporcional a x mientras la cámara vuele bajo, y a x/altura cuando
      // vuele por encima de la capa. Con suelo, para que una cámara pegada al
      // mar no tiña de horizonte hasta lo que tiene delante.
      //
      // El 6 está MEDIDO sobre el banco: con el 4 que tenía al principio, la
      // pose de costa (cámara a 1,6 unidades) fundía al horizonte al 63 % a
      // catorce unidades y el mar entero salía lechoso — todo lo que había
      // entre la orilla y el horizonte era bruma. Con 6 y un suelo de 0,06 de
      // mundo, esa misma pose funde un 7 % a las doce unidades que hay hasta la
      // costa y el 95 % ya casi en el horizonte, que es donde tiene que estar.
      const height = Math.max(0.05, Math.abs(cam.position.y - seaY));
      const fogDist = Math.min(
        6 * Math.max(height, o.sizeX * 0.06),
        o.sizeX * 8,
      );

      const sky = u.sky;
      for (const un of BOTH) {
        un.uHeight.value = u.heightTex;
        un.uHasHeight.value = u.heightTex ? 1 : 0;
        (un.uGrid.value as THREE.Vector2).set(u.gridW, u.gridH);
        un.uSea.value = u.seaLevel;
        (un.uSun.value as THREE.Vector3).copy(tmp);
        (un.uCam.value as THREE.Vector3).copy(cam.position);
        un.uTime.value = u.time;
        (un.uFog.value as THREE.Color).copy(u.horizon);
        // Sin paquete de cielo se deriva algo plausible del horizonte: el cénit
        // es el horizonte oscurecido y azuleado, y el lado del sol el horizonte
        // tal cual. Funciona, pero pierde el degradado del reflejo — por eso
        // `sky` existe.
        if (sky) {
          (un.uSkyZenith.value as THREE.Color).copy(sky.zenith);
          (un.uSkyWarm.value as THREE.Color).copy(sky.horizonWarm);
          (un.uSunColor.value as THREE.Color).copy(sky.sunColor);
          un.uSunPower.value = sky.intensity;
        } else {
          (un.uSkyZenith.value as THREE.Color).setRGB(
            u.horizon.r * 0.34, u.horizon.g * 0.45, u.horizon.b * 0.68,
          );
          (un.uSkyWarm.value as THREE.Color).copy(u.horizon);
          (un.uSunColor.value as THREE.Color).setRGB(1, 0.97, 0.9);
          un.uSunPower.value = 1;
        }
        un.uFogDist.value = fogDist;
      }
    },

    dispose() {
      planeGeo.dispose();
      planeMat.dispose();
      globeGeo.dispose();
      globeMat.dispose();
    },
  };
}
