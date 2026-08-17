// ==========================================================
// El acercamiento ANCLADO — la rueda que no mueve lo señalado
// ==========================================================
// La cuenta que hace que la rueda del 3D se comporte como la del 2D: acercarse
// SIN que el punto que estás señalando se mueva de su píxel.
//
// Está aquí, en un fichero sin `three` y sin React, porque es la única forma de
// demostrarla. Dentro del manejador de la rueda sólo se podía comprobar a ojo
// —«parece que va bien»—, y «parece» es exactamente lo que este proyecto no
// acepta en una cámara: el banco `harness/screen-navigation.ts` proyecta el
// punto antes y después con una cámara de verdad y compara los píxeles.
//
// Trabaja sobre cualquier cosa con x, y, z: un `THREE.Vector3` encaja sin
// convertir nada, pero el banco puede pasarle objetos planos.

export interface Punto3 { x: number; y: number; z: number }

/**
 * Escala la cámara y su punto de mira respecto de `ancla` (una homotecia).
 *
 * Por qué esto y no «mover la cámara hacia el punto»: al escalar los DOS por
 * el mismo factor, el vector cámara→mira sólo cambia de módulo, así que la
 * orientación se conserva exactamente; y la cámara se mueve por la recta que
 * pasa por el ancla, así que el ancla vuelve a proyectarse en el mismo píxel.
 * Las dos condiciones juntas son la invariante «lo que señalas no se mueve», y
 * no son una aproximación afinada a ojo: salen de la geometría.
 *
 * El factor se RECORTA contra los topes de distancia en vez de recortar la
 * posición después: recortar la posición rompería la homotecia (la mira se
 * habría escalado y la cámara no) y el ancla se iría a otro píxel justo al
 * llegar al suelo de acercamiento, que es cuando más se nota.
 *
 * Devuelve si algo se movió — en el tope, el gesto está consumido y no ha
 * pasado nada, y quien llama no tiene por qué pedir un dibujo nuevo.
 */
export function anchoredDolly(
  camera: Punto3,
  target: Punto3,
  anchor: Punto3,
  factor: number,
  minDistance: number,
  maxDistance: number,
): boolean {
  if (!Number.isFinite(factor) || factor <= 0) return false;
  const dx = camera.x - target.x, dy = camera.y - target.y, dz = camera.z - target.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-9)) return false;
  const querida = dist * factor;
  const cortada = Math.min(maxDistance, Math.max(minDistance, querida));
  const k = cortada / dist;
  if (!Number.isFinite(k) || Math.abs(k - 1) <= 1e-6) return false;
  camera.x = anchor.x + (camera.x - anchor.x) * k;
  camera.y = anchor.y + (camera.y - anchor.y) * k;
  camera.z = anchor.z + (camera.z - anchor.z) * k;
  target.x = anchor.x + (target.x - anchor.x) * k;
  target.y = anchor.y + (target.y - anchor.y) * k;
  target.z = anchor.z + (target.z - anchor.z) * k;
  return true;
}

// ---------------------------------------------------------------------------
// Y EL MISMO GESTO EN EL GLOBO, QUE NO ES EL MISMO PROBLEMA
// ---------------------------------------------------------------------------
// En la esfera el punto de mira ES el centro del planeta y no se puede tocar:
// toda la órbita cuelga de él. Así que la homotecia de arriba no vale — sólo
// puede cambiar el RADIO, y cambiar el radio a secas mueve hacia el borde todo
// lo que no esté en el centro de la pantalla. Para que lo señalado se quede
// quieto hay que acercarse Y GIRAR EL GLOBO a la vez, que es lo que hace
// Google Earth y lo que todo el mundo espera de un planeta.
//
// La cuenta: el punto anclado tiene que seguir viéndose en la MISMA dirección
// en espacio de cámara (que es lo que fija el píxel del cursor). Si `u` es esa
// dirección y `w` es su versión en coordenadas del mundo, la cámara nueva está
// en `c = P - t·w` con `|c| = r'`, que es una ecuación de segundo grado en `t`.
// Lo circular es que `w` depende de la base de la cámara y la base depende de
// dónde acabe la cámara: se resuelve iterando, y converge en dos o tres vueltas
// porque el giro de una muesca de rueda es pequeño.
//
// Todo esto sin `three` a propósito: la base de la cámara se construye a mano
// con el MISMO convenio que `Matrix4.lookAt` (z = ojo − objetivo, x = arriba ×
// z, y = z × x), y el banco lo comprueba contra una `PerspectiveCamera` de
// verdad. Si three cambiara de convenio, el banco lo diría.

interface Base { x: Punto3; y: Punto3; z: Punto3 }

/** La base de una cámara que mira al origen con «arriba» = +Y. */
function cameraBasis(c: Punto3): Base | null {
  const r = Math.hypot(c.x, c.y, c.z);
  if (!(r > 1e-9)) return null;
  const z = { x: c.x / r, y: c.y / r, z: c.z / r };
  // Sobre el polo, «arriba × z» es el vector cero y la cámara no tiene rumbo:
  // `lookAt` se inventa uno y el ancla daría un salto. Ahí no se ancla nada.
  if (Math.abs(z.y) > 0.99999) return null;
  const cx = { x: z.z, y: 0, z: -z.x };            // (0,1,0) × z
  const l = Math.hypot(cx.x, cx.y, cx.z);
  if (!(l > 1e-9)) return null;
  const x = { x: cx.x / l, y: 0, z: cx.z / l };
  const y = {                                       // z × x
    x: z.y * x.z - z.z * x.y,
    y: z.z * x.x - z.x * x.z,
    z: z.x * x.y - z.y * x.x,
  };
  return { x, y, z };
}

/**
 * Acercamiento anclado sobre una esfera centrada en el origen.
 *
 * `anchor` es el punto de la superficie bajo el cursor, y (`ndcX`, `ndcY`) el
 * píxel del cursor en coordenadas normalizadas de dispositivo. La cámara se
 * MODIFICA. El punto de mira no se toca: en el globo es el centro del planeta.
 *
 * Si la cuenta no converge —la cámara sobre un polo, el ancla en el filo del
 * horizonte, un ratón que manda una rueda absurda— se hace lo de siempre: un
 * acercamiento recto por el radio. Peor gesto, pero nunca un salto.
 */
export function anchoredGlobeDolly(
  camera: Punto3,
  anchor: Punto3,
  ndcX: number,
  ndcY: number,
  fovDeg: number,
  aspect: number,
  factor: number,
  minDistance: number,
  maxDistance: number,
): boolean {
  if (!Number.isFinite(factor) || factor <= 0) return false;
  const r = Math.hypot(camera.x, camera.y, camera.z);
  if (!(r > 1e-9)) return false;
  const cortada = Math.min(maxDistance, Math.max(minDistance, r * factor));
  const k = cortada / r;
  if (!Number.isFinite(k) || Math.abs(k - 1) <= 1e-6) return false;

  /** El acercamiento recto, que es también el respaldo. */
  const recto = (): boolean => {
    camera.x *= k; camera.y *= k; camera.z *= k;
    return true;
  };

  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * (aspect > 1e-6 ? aspect : 1);
  if (!(tanV > 1e-9)) return recto();
  // La dirección del rayo del cursor EN ESPACIO DE CÁMARA. Sale de la
  // geometría de la proyección, sin matrices: en esa base el plano de imagen
  // está en z = −1 y sus medios lados son las dos tangentes del campo.
  const un = { x: ndcX * tanH, y: ndcY * tanV, z: -1 };
  const ul = Math.hypot(un.x, un.y, un.z);
  const u = { x: un.x / ul, y: un.y / ul, z: un.z / ul };

  const anchorLen2 = anchor.x * anchor.x + anchor.y * anchor.y + anchor.z * anchor.z;
  // Si el ancla no queda DENTRO de la nueva esfera de la cámara, no hay
  // posición posible: se acabaría metiendo la cámara bajo tierra.
  if (anchorLen2 >= cortada * cortada) return recto();

  let cx = camera.x * k, cy = camera.y * k, cz = camera.z * k;
  /**
   * SESENTA Y CUATRO VUELTAS, Y NO SEIS.
   *
   * El punto fijo converge LINEALMENTE, con razón medida ≈ 0,74 por vuelta: en
   * el caso del banco (ancla a un tercio del borde) seis vueltas dejaban 3e-3
   * de error en normalizadas — casi cinco píxeles de 1600, y por encima del
   * listón de la comprobación, así que se caía al respaldo y la rueda volvía a
   * ser la de antes SIN decirlo. De 3e-3 a 1e-7 hacen falta unas treinta y
   * cuatro. Se ponen sesenta y cuatro con salida temprana: cada vuelta son
   * cuatro productos escalares y una raíz, y esto corre una vez por muesca de
   * rueda, no una vez por fotograma.
   */
  for (let paso = 0; paso < 64; paso++) {
    const b = cameraBasis({ x: cx, y: cy, z: cz });
    if (!b) return recto();
    const w = {
      x: u.x * b.x.x + u.y * b.y.x + u.z * b.z.x,
      y: u.x * b.x.y + u.y * b.y.y + u.z * b.z.y,
      z: u.x * b.x.z + u.y * b.y.z + u.z * b.z.z,
    };
    const pw = anchor.x * w.x + anchor.y * w.y + anchor.z * w.z;
    const disc = pw * pw - (anchorLen2 - cortada * cortada);
    if (!(disc > 0)) return recto();
    // La raíz positiva: la cámara está FUERA de la esfera del ancla, así que
    // las dos raíces tienen signos distintos y sólo una pone al ancla delante.
    const t = pw + Math.sqrt(disc);
    if (!(t > 0) || !Number.isFinite(t)) return recto();
    const nx = anchor.x - t * w.x;
    const ny = anchor.y - t * w.y;
    const nz = anchor.z - t * w.z;
    const paso2 = Math.hypot(nx - cx, ny - cy, nz - cz);
    cx = nx; cy = ny; cz = nz;
    // Quieta: seguir iterando sólo añade ruido de coma flotante.
    if (paso2 <= cortada * 1e-12) break;
  }

  // Y se comprueba: se vuelve a proyectar el ancla con la base final y se mide
  // el error contra el píxel del cursor. Una comprobación y no una fe: si la
  // iteración se fue a un mínimo raro, esto lo caza y se cae al respaldo.
  const b = cameraBasis({ x: cx, y: cy, z: cz });
  if (!b) return recto();
  const d = { x: anchor.x - cx, y: anchor.y - cy, z: anchor.z - cz };
  const dz = d.x * b.z.x + d.y * b.z.y + d.z * b.z.z;
  if (!(dz < -1e-9)) return recto();
  const dx = d.x * b.x.x + d.y * b.x.y + d.z * b.x.z;
  const dy = d.x * b.y.x + d.y * b.y.y + d.z * b.y.z;
  const gotX = dx / (-dz) / tanH;
  const gotY = dy / (-dz) / tanV;
  // Cinco diezmilésimas de normalizada son 0,4 px en una ventana de 1600: por
  // debajo de lo que un ojo puede ver moverse, y muy por encima de lo que la
  // iteración alcanza cuando converge de verdad (1e-15 medido).
  if (Math.hypot(gotX - ndcX, gotY - ndcY) > 5e-4) return recto();

  camera.x = cx; camera.y = cy; camera.z = cz;
  return true;
}

/**
 * En el globo el norte SIEMPRE está arriba, y por eso no se dibuja brújula.
 *
 * No es una renuncia: es el resultado. El orbitador mantiene «arriba» clavado
 * en +Y, así que el eje Y de la cámara es exactamente la componente de +Y
 * perpendicular a la mirada — que es la tangente del MERIDIANO en el punto que
 * se está mirando, o sea el norte. Su proyección cae en la vertical de la
 * pantalla, y el aspecto de la ventana se cancela entre las dos tangentes del
 * campo. Dibujar una aguja que sólo puede señalar hacia arriba es decoración.
 *
 * Devuelve la dirección del norte en píxeles de lienzo (la y crece hacia
 * abajo), o null sobre el polo, donde no hay norte que señalar. El banco la
 * compara contra una cámara de verdad — si algún día se pudiera ladear la
 * cámara, esta función dejaría de devolver (0, −1) y habría que dibujarla.
 */
export function northOnGlobe(camera: Punto3): { x: number; y: number } | null {
  const b = cameraBasis(camera);
  if (!b) return null;
  // La tangente del meridiano: la componente de +Y perpendicular a la mirada.
  const dot = b.z.y;
  const t = { x: -dot * b.z.x, y: 1 - dot * b.z.y, z: -dot * b.z.z };
  const tl = Math.hypot(t.x, t.y, t.z);
  if (!(tl > 1e-9)) return null;
  const tx = (t.x * b.x.x + t.y * b.x.y + t.z * b.x.z) / tl;
  const ty = (t.x * b.y.x + t.y * b.y.y + t.z * b.y.z) / tl;
  const l = Math.hypot(tx, ty);
  if (!(l > 1e-9)) return null;
  return { x: tx / l, y: -ty / l };
}
