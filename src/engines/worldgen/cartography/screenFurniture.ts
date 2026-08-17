// ==========================================================
// El mobiliario DE PANTALLA: la escala y la brújula del HUD
// ==========================================================
// `furniture.ts` dibuja la rosa de los vientos, la barra de escala y la
// retícula de la CARTA — el mapa que se exporta, con su papel y su marco. Y el
// 2D se hizo la suya por dentro, a mano, en la pasada de cohesión. El 3D no
// tenía ninguna: nada en pantalla decía si estabas mirando quinientos
// kilómetros de suelo o cinco, y sin escala un valle y un continente son la
// misma mancha verde con un río.
//
// Esto vive fuera de `furniture.ts` porque es otro trabajo: aquello es tinta
// sobre pergamino a resolución de impresión y con su tema, y esto es una chapa
// legible sobre cualquier terreno, en píxeles de CSS, redibujada en cada
// fotograma. Compartir el fichero habría acabado con un `if (pantalla)` dentro
// de cada función.
//
// Las dos rutinas son PURAS: reciben un contexto y números —ni el mundo, ni la
// cámara, ni `t()`—. El rótulo lo compone quien llama, que es quien tiene el
// idioma; así este fichero no arrastra el i18n hasta el lienzo.
//
// La paleta y el paso 1-2-5 son LOS MISMOS que los de la barra que el 2D ya
// dibuja dentro de `Map2D.tsx`: son el mismo instrumento en dos vistas de la
// misma cámara, y si divergen el lector lo lee como dos aplicaciones.

type Ctx = CanvasRenderingContext2D;

const FONDO = 'rgba(7,7,13,0.55)';
const TINTA = '#f0ece4';
const TRAZO = 'rgba(240,236,228,0.9)';

/**
 * La longitud «bonita» más larga que quepa: 1, 2 o 5 por una potencia de diez.
 *
 * Una barra que dijera «137 km» obliga a dividir mentalmente para leer
 * cualquier OTRA distancia del mapa, que son casi todas. Es la escalera que
 * usan todos los mapas del mundo y la razón de que se lean de un vistazo.
 */
export function niceScaleKm(maxKm: number): number {
  if (!(maxKm > 0) || !Number.isFinite(maxKm)) return 0;
  const potencia = Math.pow(10, Math.floor(Math.log10(maxKm)));
  for (const paso of [5, 2, 1]) {
    if (paso * potencia <= maxKm) return paso * potencia;
  }
  return potencia;
}

export interface ScaleBarOptions {
  /** Kilómetros por píxel de pantalla en el punto que se está mirando. */
  kmPerPx: number;
  /**
   * De qué borde cuelga la chapa. El 2D la ancla a la IZQUIERDA abajo, que es
   * donde tiene sitio; el 3D a la derecha, porque su esquina de abajo a la
   * izquierda la ocupan el reloj de fotograma y el «?». Anclada a la derecha
   * además no da tirones: la barra cambia de anchura en cada muesca de la
   * rueda y es el número el que se queda quieto.
   */
  align: 'left' | 'right';
  /** El borde de la chapa por el lado del anclaje, en píxeles de CSS. */
  edge: number;
  /** Línea de base de la chapa, en píxeles de CSS desde arriba. */
  bottom: number;
  /** Lo más ancha que se le permite ser a la regla. */
  maxPx?: number;
  /** El rótulo, ya en el idioma del lector. */
  format: (km: number) => string;
}

/** La barra de escala del HUD. Devuelve lo que ocupó, para apilarle cosas. */
export function drawScreenScaleBar(ctx: Ctx, o: ScaleBarOptions): { width: number; height: number } | null {
  const maxPx = o.maxPx ?? 150;
  if (!(o.kmPerPx > 0) || !Number.isFinite(o.kmPerPx)) return null;
  const km = niceScaleKm(maxPx * o.kmPerPx);
  if (km <= 0) return null;
  const ancho = km / o.kmPerPx;
  // Una regla de doce píxeles no mide nada; sólo tapa mapa.
  if (!(ancho >= 24) || !Number.isFinite(ancho)) return null;

  const texto = o.format(km);
  ctx.save();
  ctx.font = '600 10px "Source Sans 3", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const anchoTexto = ctx.measureText(texto).width;
  const pad = 6;
  const alto = 24;
  const caja = Math.max(ancho, anchoTexto) + pad * 2;
  const x0 = o.align === 'left' ? o.edge : o.edge - caja;
  const y0 = o.bottom - alto;

  ctx.fillStyle = FONDO;
  ctx.beginPath();
  ctx.roundRect(x0, y0, caja, alto, 4);
  ctx.fill();

  const bx0 = x0 + pad;
  const by = y0 + alto - 6;
  ctx.strokeStyle = TRAZO;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx0, by - 6); ctx.lineTo(bx0, by);
  ctx.lineTo(bx0 + ancho, by); ctx.lineTo(bx0 + ancho, by - 6);
  ctx.stroke();
  // La mitad marcada: sin ella hay que medir a ojo cualquier distancia que no
  // sea justo la de la barra.
  ctx.beginPath();
  ctx.moveTo(bx0 + ancho / 2, by); ctx.lineTo(bx0 + ancho / 2, by - 3);
  ctx.stroke();

  ctx.fillStyle = TINTA;
  ctx.fillText(texto, bx0, by - 8);
  ctx.restore();
  return { width: caja, height: alto };
}

/**
 * La DIANA de llegada: aquí es donde has aterrizado.
 *
 * Una diana y no una chincheta, y el motivo es de lectura y no de gusto: tiene
 * que distinguirse de un punto de interés (triángulo o disco del color que el
 * lector le puso) y de una capital (disco ámbar con halo), que son las dos
 * cosas a las que más se va a parecer en pantalla. Dos anillos y cuatro marcas
 * de tic no se parecen a nada más del mapa, y el hueco del centro deja ver
 * exactamente lo que se ha ido a mirar en vez de taparlo.
 *
 * Está aquí, y no dentro de cada vista, porque el 2D y el 3D la dibujan los
 * dos: escrita dos veces se separan a la primera corrección —una con el halo
 * más grueso que la otra— y el lector lo lee como dos marcas distintas.
 * Devuelve el radio exterior para que quien llama coloque el rótulo.
 */
export function drawArrivalMark(
  ctx: Ctx, x: number, y: number, color = '#ffd479', scale = 1,
): number {
  // `scale` existe por la CARTA: el 2D y el 3D dibujan su capa en píxeles de
  // CSS, pero la carta escribe directamente en píxeles de dispositivo (su
  // lienzo no lleva `setTransform(dpr)`, para que la letra salga fina). Sin el
  // factor, la misma diana medía la mitad en la carta de una pantalla HiDPI.
  const r0 = 6.5 * scale, r1 = 11.5 * scale;
  ctx.save();
  // El halo oscuro primero, y por debajo: sobre nieve o sobre una playa, un
  // anillo ámbar a pelo desaparece.
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = 'rgba(6,8,13,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.6 * scale;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    ctx.moveTo(x + dx * r0, y + dy * r0);
    ctx.lineTo(x + dx * (r1 + 3.5 * scale), y + dy * (r1 + 3.5 * scale));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2.6 * scale, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  return r1;
}

/**
 * Hacia dónde cae el NORTE en la pantalla, dada la mirada proyectada al suelo.
 *
 * El norte del mundo es −z: `v = z/sizeZ + 0,5`, así que v = 0 —el borde de
 * arriba del mapa— cae en z negativa. Con la mirada `f = (fx, fz)` normalizada
 * al plano del suelo, la derecha de la cámara es r = f × arriba = (−fz, 0, fx),
 * así que el norte N = (0, 0, −1) se proyecta en (N·r, N·f) = (−fx, −fz); y
 * como la y del LIENZO crece hacia abajo, la vertical cambia de signo.
 *
 * Es una cuenta de tres líneas que se equivoca de signo con una facilidad
 * pasmosa y que, equivocada, no se nota: una brújula al revés sigue pareciendo
 * una brújula. Por eso vive fuera del componente, donde el banco la prueba en
 * los cuatro rumbos que se pueden comprobar a mano.
 */
export function northOnScreen(forwardX: number, forwardZ: number): { x: number; y: number } | null {
  const l = Math.hypot(forwardX, forwardZ);
  if (!(l > 1e-6) || !Number.isFinite(l)) return null;
  return { x: -forwardX / l, y: forwardZ / l };
}

export interface CompassOptions {
  /** Centro de la aguja, en píxeles de CSS. */
  x: number;
  y: number;
  r: number;
  /**
   * Hacia dónde cae el NORTE en la pantalla, en píxeles de lienzo (la y crece
   * hacia abajo). No hace falta que venga normalizado.
   *
   * Se pide el vector ya resuelto, y no la cámara: quien llama es el único que
   * sabe si su mundo es un plano o una esfera, y esta aguja no tiene por qué
   * aprenderse las dos.
   */
  northX: number;
  northY: number;
  /** La letra del norte. Viene de fuera porque el idioma es de quien llama. */
  letter: string;
}

/**
 * Una aguja, no una rosa de ocho puntas.
 *
 * La de la carta tiene ocho porque es un adorno de mapa antiguo con sitio de
 * sobra. Ésta compite con el terreno por veinte píxeles y sólo contesta una
 * pregunta —«¿por dónde cae el norte?»—: cuanto menos dibujo, más rápido se
 * contesta. La media aguja de vuelta se pinta más tenue porque una aguja
 * simétrica se lee del revés la mitad de las veces.
 */
export function drawScreenCompass(ctx: Ctx, o: CompassOptions): void {
  const l = Math.hypot(o.northX, o.northY);
  if (!(l > 1e-6) || !Number.isFinite(l)) return;
  const nx = o.northX / l, ny = o.northY / l;
  const px = -ny, py = nx;

  ctx.save();
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
  ctx.fillStyle = FONDO;
  ctx.fill();

  const punta = o.r * 0.74, base = o.r * 0.30;
  ctx.beginPath();
  ctx.moveTo(o.x + nx * punta, o.y + ny * punta);
  ctx.lineTo(o.x + px * base, o.y + py * base);
  ctx.lineTo(o.x - px * base, o.y - py * base);
  ctx.closePath();
  ctx.fillStyle = '#e4a853';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(o.x - nx * punta * 0.7, o.y - ny * punta * 0.7);
  ctx.lineTo(o.x + px * base * 0.8, o.y + py * base * 0.8);
  ctx.lineTo(o.x - px * base * 0.8, o.y - py * base * 0.8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(240,236,228,0.42)';
  ctx.fill();

  // La letra va FUERA del disco —dentro tapa la aguja— y por eso lleva su
  // propio halo: sin él es tinta blanca sobre lo que haya debajo, y lo que
  // había debajo en la sonda era nieve. Mirado en `harness/out/screen-
  // furniture.png`: sobre la franja blanca no se veía ninguna de las ocho.
  ctx.font = '700 9px "Source Sans 3", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lx = o.x + nx * (o.r + 7.5), ly = o.y + ny * (o.r + 7.5);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6,8,13,0.85)';
  ctx.strokeText(o.letter, lx, ly);
  ctx.fillStyle = TINTA;
  ctx.fillText(o.letter, lx, ly);
  ctx.restore();
}
