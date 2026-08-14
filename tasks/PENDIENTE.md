# World Generator — lo que queda

Consolidado a 2026-08-12 (octava pasada), deduplicado contra las anteriores.
Lo que ya se hizo no aparece; `tasks/todo-2d-cohesion.md` conserva el histórico
completo, incluida la lista de lo que ESTA pasada cerró.

Todo lo de aquí está **medido o confirmado**, con el número o la línea que lo
demuestra. Nada es una sospecha.

---

## 1 · Defectos confirmados, sin arreglar

### 1.1b El último caso de la tanda entera del banco es INTERMITENTE
Tras el `forceContextLoss` la corrida completa dio 17/17 una vez; en otra,
`worldview-carta` (el caso 17 de 17, tras ~25 min de SwiftShader) volvió a
morir sin raíz — y EN SOLITARIO pasa SIEMPRE. Es presión del proceso GPU del
contenedor del banco, no de la aplicación; en una máquina real no hay 17
montajes WebGL seguidos del mismo proceso. Se vigila, no se persigue.

---

## 2 · El 3D: maquinaria escrita y APAGADA (sigue)

Sin cambios en la pasada 8. La decisión del zoom liso (Luis, 2026-08-11) y el
contrato `consumeOnly` siguen como estaban; lo apagado sigue apagado A
PROPÓSITO (`setSubCellRelief`, `setDetailPatch`/`setDetailAlbedo`,
`setAlbedoWindow`, `KIND_WIND`). Encenderlo es un proyecto CON PASADA VISUAL
PROPIA (bancos que miren PNGs), no un cableado a ciegas.

**Novedad que le llega de fuera:** con el canon persistido (§2b), el
`consumeOnly` del 3D ya no depende de que el 2D haya generado EN ESTA SESIÓN:
`requestTile` siembra el worker desde Dexie antes de pedir, así que el 3D es
nítido en cualquier sesión allí donde el lector haya estado alguna vez.

---

## 2b · El «detalle regional»: CERRADO EL COSTE POR SESIÓN, quedan los bucles

**La palanca está echada (pasada 8).** El canon persiste en Dexie
(`canonTiles`, v25; formato `region/canonStore.ts` — cuantización por campo +
gzip, el molde de `worldSnapshots`): se paga UNA vez por mundo, no una por
sesión. Medido en el banco (mundo 512, supertesela 2176², el peor caso):

    generar 154–160 s · sembrar+entintar 9,0 s (17×)
    composite: generar 61 s · responder de la residencia 3,4 s (18×)
    en el mundo real (2048, superteselas de 8 MB): decode ~0,3 s por supertesela

Las DOS vías emiten y consumen: las teselas hondas (`renderTile`) y el
composite regional (`generate` con `canonKey`) — que además instala en la
caché de sesión, así que abrir el 2D regional calienta las teselas y el 3D.
Píxeles byte a byte entre sesión generadora y sembrada (la sesión que genera
pinta ya del canon cuantizado: `quantizeCanonTile`). Invalidación por
`(seed, params del mundo, params humanos, versión de formato, lista de
ediciones FILTRADA a lo que alcanza la supertesela)` — un trazo en la otra
punta del mundo no invalida; una mudanza (geografía global) sí. Fuera del
respaldo, LRU 320 MB, se borra con su mundo. Bancos:
`harness/canon-persist.ts`, `canon-seed-flow.ts`, `canon-composite-flow.ts`.

**OJO al desglose de la pasada 7** («cauces 12,6 · agua 7,9 · …»): estaba
medido con las marcas de `onProgress`, que cierran el intervalo de la fase
ANTERIOR — el mismo desplazamiento de una fase contra el que ya avisa la
lección de perfilado. El reparto real (reloj rodeando llamadas,
`harness/region-profile.ts`, sábana 353k celdas): **elevación 24 % · erosión
22 % · caminos 15 % · hidrología 11 % · vegetación 10 %**. Los tres gordos
están afinados (campos gruesos, fbm partido, puertas por amplitud); apretarlos
más cambia el terreno → sólo con una tanda propia que mire PNGs. El «canon a
medio refinamiento primero» sigue sin explorar.

---

## 3 · Deuda funcional

- **El agua del plano y la del ráster satélite siguen sin ser la misma línea**
  (~100 m medidos en `sat-compare` a z17). Paliado: `townPlan` ya recibe la
  geografía y `cityParamsFor` entrega el litoral real como semejanza; el plano
  manda casas, el terreno manda agua (decisión en `townPlan.ts`). Cerrar el
  hueco del todo pediría que el plano consumiera la isolínea del canon.
- **`SculptView` sigue sin cubrir**: es el repuesto de `World3D` cuando el
  renderizador revienta, y llegar ahí exige un navegador sin WebGL.

Cerrado en la pasada 8 (detalle en §6): caminos tras mudanza (y el colapso de
cadenas de llaves), localizador Ctrl+F, Inicio en carta y globo, comarcas
guardadas dibujadas de verdad (2D y Carta), el anillo del pincel arreglado EN
LA RAÍZ con migración de listas guardadas.

---

## 4 · Sin explorar

- La **hoja de comarca** (`RegionSheetView`) — sólo la hemos visto arrancar.
- El **atlas y el gazetteer** — nombres, etimologías, la lengua del mundo.
- El **planificador de viajes** — rutas, estaciones, modos de transporte.
- Los **enlaces al manuscrito** — el mapa de calor de dónde ocurre el libro.
- La vista **paleo** — el mundo en otras eras.
- El resto de la aplicación: 21 motores y sólo hemos tocado uno.

---

## 5 · Salud del proceso

- **El banco de arranque** (`harness/views-smoke-run.mjs`) cubre 17 vistas con
  doble montaje. Correrlo antes de dar nada por bueno. (Pasada 8: la raíz del
  repo se resuelve desde el propio fichero — la ruta cableada
  `/home/claude/wg` lo ataba a un contenedor muerto.)
- `harness/city-quality.ts`: **32/32 EN VERDE** (re-corrido en la pasada 8; la
  ciudad no se tocó). Si un cambio de ciudad lo pone rojo, se explica o se
  revierte.
- Bancos nuevos de esta pasada: `canon-persist` (formato, ida y vuelta,
  estabilidad), `canon-seed-flow` (protocolo entero de teselas),
  `canon-composite-flow` (protocolo del composite), `stamp-convention`
  (centrado, migración v1→v2, cohesión mundo↔canon), `moved-roads` (mudanza →
  caminos, colapso de cadenas), `region-marks` (la marca de comarca, PNG
  mirado).
- `playwright-core` no está en `package.json` A PROPÓSITO (es del contenedor);
  en un contenedor nuevo: `npm i --no-save playwright-core`.

---

## 6 · Cerrado en esta pasada (2026-08-12), para el histórico

**El canon persistido (§2b arriba, la palanca):** `region/canonStore.ts`
(formato puro: MAGIC WGC1, elevación i16 al metro con predicado tierra/mar
exacto — el nudge de `packElevation` —, flow/wet/slope u16, water/biome/cover
u8 tal cual, vectoriales en la cabecera JSON; gzip por `CompressionStream`) ·
`canonSnapshots.ts` (la puerta Dexie: `canonTiles` v25, LRU 320 MB por
`savedAt`, fila validada por clave de invalidación con ediciones filtradas por
`strokeTouchesSheet`; `bindCanonWorld` desde `useWorldGeneration.remember`) ·
protocolo `seedCanon`/`canonBuilt` con `persistCanon` en el configure (los
bancos no pagan encode) · `workerCore` con COLA (los mensajes corren en orden
de llegada aunque haya awaits; `cancel` fuera de la cola, mejor que antes) ·
el lote sembrado SIEMPRE cabe (límites estirados al lote; una supertesela de
mundo 512 pesa 90 MB contra 96 de presupuesto) · `canonBuilt` viaja ANTES que
su `tile`/`done` (el manejador del cliente sigue atado) · guard de
`editsHash` (no se guarda suelo que el lector ya pintó encima) · `declined`
tacha el registro de siembra (un worker que evictó re-siembra al siguiente
intento) · el composite (`generate` + `canonKey`) responde de la residencia,
instala para las teselas, y emite.

**El anillo del pincel, EN LA RAÍZ (B6):** `stampDisc` medía contra el ÍNDICE
de celda; ahora mide CENTROS (`gx+0,5−cx`). `STAMP_OFFSET_CELLS` eliminada
(anillo y previsualización dicen la verdad sin corregirse), el anillo GPU del
3D queda correcto solo, y el canon re-rasteriza el trazo EN EL MISMO SITIO que
el mundo (antes divergían media celda de mundo ≈ 10 km: la mitad del convenio
de cada malla). Migración v1→v2 en `serializeEdits`/`deserializeEdits`
(`{"v":2,edits:[…]}`): los puntos de trazo guardados suben +0,5 al
deserializar y el suelo de un mundo pintado NO SE MUEVE (banco: bit a bit);
los `pts` de río/realmArea/road son geometría de curva y no migran — el cauce
excavado de un río v1 se recoloca media celda para ALINEARSE con su propia
tinta, que era la única pareja anillo/tinta sin compensar.

**Caminos tras mudanza:** `buildHumanGeography` enruta contra las posiciones
YA MUDADAS (fuera del flag `corrections`, que es lo que hace que llegue a la
vía real — la base se construye con `corrections=false`); el listado conserva
el origen y `patchGeography` sigue mudando por llave. Y el hallazgo de al
lado: el segundo arrastre de un objeto emitía su `move` con la llave del
DIBUJO (el destino), creando cadenas `{origen→d1, d1→d2}` que sólo el 2D (con
su `movedAt`) sabía seguir — carta, globo y atlas se quedaban en d1 desde la
segunda mudanza. Ahora `applyEdits` COLAPSA la cadena a la llave de origen
(los mundos guardados con cadenas se curan al abrir), y el 2D dibuja las
listas patcheadas tal cual (su `movedAt` queda sólo para los rótulos
pintados, la única lista que no pasa por la geografía). Banco: `moved-roads`
(mudanza doble con la llave del dibujo → UNA entrada, caminos al destino
final, 0 al solar antiguo).

**Localizador y tecla Inicio:** `LocatorPanel` (Ctrl+F o la lupa, en las TRES
vistas): busca en el atlas entero MÁS los rótulos pintados (que no entran en
`buildAtlas` y eran inencontrables), vuela la cámara compartida SIN cambiar
de vista, y aterriza a ≤240 km si venías de más lejos. Inicio ya existía en
el 2D (con pila de historial); ahora también carta y globo (encuadre entero,
`WorldView` se calla cuando el 2D está delante para no volar dos veces).

**Comarcas guardadas dibujadas de verdad:** en el 2D, lavado interior +
soportes de esquina de plano sobre el marco a trazos (la activa en dorado); y
en la CARTA por fin existen — `CartoAnnotations.regions` con la marca en
tinta sepia de la plancha (lavado, marco, esquinas, cartela con el título,
rombo si diminuta). Banco visual `region-marks` con PNG MIRADO.

**Sanidad de proceso:** el corredor del banco de arranque resuelve la raíz
desde su propio fichero · `deserializeEdits` filtra elementos malformados sin
perder la lista entera · perfilado del §2b re-medido con el reloj correcto.

---

## 6b · Misma pasada, segunda tanda (Luis despierto, 2026-08-12)

Luis probó la app: 3D pixelado sin ciudad, 2D borroso sin subir de calidad, la
etiqueta desaparece al acercarse. Diagnóstico: TODO consistente con «el canon
no llega en su máquina» — el 3D frío se queda en el respaldo z8 por diseño, y
el 2D cede los rótulos a teselas que no han llegado. Hecho:

- **La cesión de rótulos exige ENTREGA**: `deepMarks` requiere el plan de
  teselas completo (`exact ≥ needed`); mientras el canon se genera, el mundo
  sigue rotulando — la etiqueta ya no desaparece durante la espera.
- **Rótulos que crecen con el zoom** (mundo y canon): +2 px por duplicación de
  px/celda desde 2, tope 19 px.
- **`MIN_3D_SPAN_KM` 25 → 10**: a 10 km el plan pide z15–z16 (2,4–5 m/px) y
  los planos de ciudad se leen calle a calle — bajo consume, gratis donde hay
  canon residente o persistido.
- **HUD DE DEPURACIÓN TEMPORAL** (`DEBUG_HUD = true` en Map2D y World3D, con
  `tileStats` en region/client): vano, nivel pedido vs techo, entregadas del
  plan, canon armado o no, si el mundo divide la retícula, forja
  sí/degradada/no, y contadores de sesión (pedidas/entregadas/declinadas/
  errores/sembradas/guardadas). QUITAR tras el diagnóstico. La lectura clave:
  «declinadas» creciendo en 3D = canon inexistente aún; «canon 2D: SIN
  ARMAR» = el 2D ni siquiera pide hondas; «NO divide» = mundo sin canon
  posible a ese ancho.
- **Tanda C** (tras la primera captura del HUD: entregadas 0/40 con guardadas
  3): la chuleta de gestos ya no es un rótulo permanente — botón «?» en 2D y
  3D (tapaba el HUD y media esquina); contador «EN VUELO» en ambos HUD
  (pedidas−entregadas−declinadas−errores: distingue «generando con el plan en
  cola» de «cola atascada»); y `withDeadline` en TODOS los awaits de
  persistencia de la cola del worker (encode 15 s, decode 10 s) — un stream
  que nunca resuelve ya no puede dejar la sesión muda para siempre, que es
  exactamente la firma de esa captura si no avanza.

## 6c · Deep dive de la vía de teselas (misma noche, tras la 2.ª captura)

La 2.ª captura del HUD lo entregó todo: canon armado · geo full · 2048×1024
divide · forja sí · errores 0 · **EN VUELO 1 clavado** con entregadas 0/35 y
guardadas 13. Dos enfermedades, no una (lección #34):

1. **El puente de la Forja sólo vigila la PRIMERA respuesta** de cada proceso
   (`FORGE_FIRST_REPLY_MS`): un hijo que muere DESPUÉS de contestar algo deja
   su petición en vuelo para siempre y la sesión «ocupada» eternamente, sin
   degradación ni error — la firma exacta de la captura. Cura: **vigilante
   por petición** en el cliente (`requestDeadlines`: tesela 120 s total;
   sábana 180 s de inactividad rearmada por cada `progress`/`canonBuilt`) —
   al vencer, la sesión se TERMINA y la petición se resuelve re-pedible;
   `tileStats.timeouts` lo cuenta y el HUD enseña la EDAD de la más vieja.
2. **La afinidad de sesión era una fila india**: una sesión por mundo → una
   supertesela cada 30-60 s con todos los cores parados. Cura: bajo Forja
   sana el pool abre **varias sesiones del mismo mundo** (los procesos son
   suyos; con web workers se espera como siempre), y el **calentador**
   (`warmCanon`, disparado por Map2D delante de cada pedido hondo) lanza UNA
   petición `generate`+`canonKey` por supertesela del plan — paralelo real
   sin duplicar trabajo, con Dexie de bus entre sesiones (siembra).
3. **La clave de invalidación podía no coincidir entre sesiones**
   (`JSON.stringify` depende del orden de claves; generado vs decodificado
   de instantánea): 13 guardadas y 0 sembradas. Cura: `stableStringify`
   (claves ordenadas, recursivo) en `rowKey`.
4. Menores: `evict()` del almacén sólo corre la pasada completa con >120
   filas (materializaba todos los MB en cada guardado); los relojes del
   vigilante van por globales pelados (los bancos corren fuera del
   navegador); `warmCanon` acepta fábrica para bancos.

Banco nuevo: `harness/canon-pool-parallel.ts` (workers de mentira): 4 teselas
→ 4 sesiones y muro de UNA (302 ms vs ~1200) · el modo serie de contraste ·
la sesión muda cae por plazo, cuenta como caducada, se retira, y la siguiente
abre fresca y entrega · el calentador deduplica (2 generaciones para 4
pedidas). Hallazgo de contrato que el banco destapó: cuatro `acquire` en el
MISMO tick siempre han podido abrir hasta el tope — el modo serie protege el
régimen, no el primer tick.

QUEDA: que Luis pruebe — esperado: primer paseo por suelo nuevo en ~1
generación de tiempo (paralela) en vez de N en serie; «caducadas» > 0 si
había sesiones muertas (se auto-retiran); «sembradas» > 0 al reabrir sobre
suelo visitado. El HUD de depuración sigue puesto hasta ese veredicto.

## 6d · La causa raíz del «sigue borroso» (3.ª captura de Luis)

La 3.ª captura (guardadas 41 · sembradas 0 · declinadas 0 · errores 0 ·
caducadas 0 · EN VUELO 3 sano · **0/50 clavado**) descartó el atasco y señaló
al ALMACÉN: **`bindCanonWorld` sólo se enseñaba sobre el mundo EDITADO**
(`remember`), pero las teselas hondas y el calentador viajan con el PRÍSTINO
del `canonSource` — otro objeto. Para el almacén, un mundo sin vínculo no
persiste ni siembra NADA: los 41 `canonBuilt` se tiraron a la basura, cada
`load` devolvió null, y sin bus de Dexie el multi-sesión de §6c degeneró en
duplicación (cada sesión regenerando lo que su vecina acababa de pagar) con
los warms del paseo encolados delante de las teselas de pantalla.

Curas (tanda E):
- `bindCanonWorld(canonSource.world, world.id)` al construir el prístino, y
  **respaldo por semilla** en el almacén (`seed:width×height` → worldId, tope
  64): cualquier objeto-mundo derivado resuelve; una colisión entre mundos
  duplicados comparte caché de un canon IDÉNTICO — correcto también.
- El calentador RETIRA los warms que el plan ya no pisa (encolados: gratis;
  en sesión: cuesta esa sesión, y gana igualmente — cuarenta warms viejos
  eran minutos de cola por delante de la pantalla) y los limpia en newEpoch.
- HUD: línea «almacén ligado / SIN LIGAR» para confirmar el vínculo en la
  próxima captura.

Banco `canon-pool-parallel` ampliado (10 checks EN VERDE): retirada de warms
obsoletos incluida. Esperado en la máquina de Luis tras esto: «sembradas»
por fin > 0, warms convertidos en siembras de ~0,3 s, y el plan del 2D
convergiendo en ~1 generación por supertesela NUEVA (paralela) — y al
reabrir la app, nitidez en segundos sobre suelo visitado.

## 6e · La 4.ª captura: promesas colgadas ANTES del post (tanda F)

Tras la E, «almacén ligado» y «sembradas 50» ✓ — pero pedidas 336 =
entregadas 336, EN VUELO 0 y **0/54 clavado**: las teselas del plan ya NI SE
PEDÍAN. La cadena `seedCanonFor → post` podía rechazar antes de postear (la
mitad de la siembra corría fuera de su try), el vigilante se armaba EN el
post (nunca llegó a existir), y el marcador de en-vuelo del almacén de
pantalla quedaba huérfano — el mapa no re-pide un id que cree en vuelo.
Curas (tanda F):
- **El plazo nace CON la petición** (cubre adquisición + siembra + post) y el
  post lo rearma para el tramo de trabajo; al vencer, settled + sesión fuera
  + marcador limpio → el mapa re-pide. Autocuración total del ciclo.
- **La siembra jamás puede costar la tesela**: cuerpo entero de
  `seedCanonFor` bajo try (devuelve null), y el `.then(post)` lleva
  `.catch(→ post())` — pase lo que pase, el post sale.
- Telemetría: `tileStats.seedErrors` + `console.warn` de la causa exacta (una
  vez por sesión) + «SIEMBRA-ERR n (mira la consola)» en el HUD.

Pool re-verificado 10/10; conformance 1.825. Esperado: aunque la causa exacta
del rechazo siga ahí, el flujo ya no puede clavarse — y el HUD la delatará.

- **Y TRAZA COMPLETA EN CONSOLA** (lo pidió Luis): `DEBUG_TRACE` en
  region/client — cada tesela cuenta su vida (`[teselas +t]` nace → sesión y
  ms de cola → siembra con HIT/miss POR SUPERTESELA → «→ worker» → entregada/
  DECLINADA/ERROR/CADUCADA con segundos), las sábanas del calentador igual, y
  el almacén canta cada save y el PORQUÉ exacto de cada load fallido (sin
  vínculo / sin fila / versión / CLAVE DISTINTA con ambas claves). Apagar
  `DEBUG_TRACE` y `DEBUG_HUD` juntos cuando el diagnóstico cierre.

## 6f · El log lo desenmascara: `createImageBitmap` rechazaba en silencio (tanda G)

El volcado de consola de Luis (5.ª entrega: pedidas 377 ≈ entregadas 376,
EN VUELO 1, cero errores, **0/28 clavado**) contenía la huella decisiva:

    +55.4s  tile-821 nace z12(1745,477) … ✓ entregada 0.1s
    +55.5s  tile-850 nace z12(1745,477)   ← EL MISMO SUELO, 100 ms después,
                                            con sus 27 hermanas aún en vuelo

Sólo un `resolve(null)` deja esa huella: un descarte por época habría
cancelado y renacido a las 28 juntas, y una excepción en el handler habría
salido como `Uncaught` en el log (no hay ninguno) dejando el marcador clavado
sin re-pedido. Conclusión: en la vía de la Forja (rgba crudo cruzando la
frontera de proceso), **`createImageBitmap(img)` rechazaba en su máquina para
CADA tesela** — el cliente cantaba «✓ entregada» (el contador sube antes de
fabricar), la promesa se resolvía null sin decir palabra, el almacén de
pantalla no retenía nada y el plan quedaba 0/N para siempre con el suelo
borroso. Aquí nunca lo vimos porque los Web Workers entregan `reply.bitmap`
directo: la rama rgba no se ejercitaba en NINGÚN banco ni en el smoke.

Curas (tanda G):
- **Fabricación por lienzo, sin rama de rechazo**: `new ImageData(rgba)` +
  `putImageData` sobre un `OffscreenCanvas` (o canvas del documento si no
  hay) — síncrono, sin GPU de por medio, y `drawImage` compone lienzos igual
  que bitmaps. `RenderedTile.bitmap` admite ahora las tres formas; el
  `DisplayTileStore` ya las admitía (`TileBitmap`) y su `close()` es opcional.
- **Todo fallo residual CANTA**: try/catch con `traceTiles('FABRICACIÓN
  falló: <causa> rgba N bytes, esperados M')`, contador `tileStats.fabErrors`
  y «FÁBRICA-ERR n (mira la consola)» en los HUD del 2D y del 3D. El
  resolve(null) mudo que había aquí costó tres capturas y un volcado
  encontrar.
- **Banco nuevo `tile-fabrication`** (la rama por fin pisada, en node con los
  ImageData/OffscreenCanvas de @napi-rs/canvas — los mismos huesos que usa la
  Forja real): píxeles crudos entran → lienzo con esos píxeles byte a byte;
  rgba mutilado → null contado y cantado; respuesta sin píxeles → ídem.

Esto cura de una vez el «borroso que no sube» del 2D, el 3D pixelado sin
ciudad (su zoomStore consume la misma vía rgba) y la carta honda: TODA tesela
de la Forja se perdía en la fabricación desde el principio. Verificado: tsc 0
· eslint 0 · conformance 1.825 · tile-fabrication, canon-pool-parallel,
canon-seed-flow, canon-composite-flow, canon-persist y region-marks EN VERDE
· views-smoke. Esperado en su máquina: nitidez al fin; si algo residual
fallara, el HUD dirá FÁBRICA-ERR y la traza el porqué exacto.

---

## 6g · Novena pasada (2026-08-12, con el volcado de consola de Luis): la cola, no la fábrica — y los lugares al grifo

Luis: «al acercarse el mundo es borroso y no parece entregar las teselas» +
«no he pedido abadías, casas, monasterios… el generador de sitios random
debería ser un pincel o un "generar en esta zona", y el mundo entero un tick
desactivado». Su HUD: pedidas 871 · entregadas 392 · declinadas 475 ·
FÁBRICA-ERR 475 · 0/45 eterno en z13. Su volcado: el mismo suelo z13(3490,955)
naciendo CINCO veces en cuatro segundos, entregado cada vez.

### Lo que el volcado y el banco nuevo demostraron (por orden de caza)
- **FÁBRICA-ERR 475 era el CONTADOR mintiendo**, no la fábrica: cada
  declinación `consumeOnly` del 3D (sanas por diseño, canon frío) caía además
  por la rama «SIN PÍXELES» y sumaba `fabErrors`. El «(mira la consola)» no
  enseñaba nada porque no había nada. Curado: la declinación resuelve null
  ANTES de las ramas de píxeles (client.ts).
- **El hueco eterno con la cámara quieta** (lección #39): una tesela resuelta
  vacía jamás se re-pedía — `lastWant` de Map2D se soltaba, pero el `lastAsk`
  por nivel del almacén devolvía el mismo ask y cortaba el re-pedido. Banco:
  60 nacimientos y 0/60 durante cuatro minutos de reposo. Curado en el
  almacén: el asentamiento vacío (y el rechazo tardío) borra `lastAsk` del
  nivel — el hueco se re-pide solo, también quieto.
- **La espiral del plazo** (lección #40): el canon frío se fraguaba EN
  SILENCIO dentro del dibujado; >120 s → CADUCADA → sesión retirada A MEDIA
  GENERACIÓN (con su caché) → la siguiente tesela repetía la misma fragua
  desde cero. Banco: 163 caducadas. Curado en tres piezas: workerCore fragua
  las superteselas que faltan ANTES del lienzo con un `progress` por
  supertesela; el cliente REARMA el plazo con cada progreso; y `queuePulse`
  rearma a TODA la cola con cada sesión liberada y cada progreso (el fondo de
  una FIFO no oye nada en minutos). Tras las tres: caducadas 0 y 60/60
  entregadas con reposo mudo.
- **El libro de siembras mentía tras un desalojo**: la LRU del worker tiraba
  una supertesela y `session.seeded` seguía dándola por residente — la
  siguiente tesela REGENERABA (decenas de segundos) en vez de re-sembrar de
  Dexie (~300 ms). Curado con el bus de desalojos: el worker adjunta
  `evictedCanon` (diferencia de claves desde la última respuesta) a cada
  tesela y el cliente tacha esas claves.
- **Banco nuevo `tile-retention`** (`node harness/tile-retention-run.mjs`):
  monta el Map2D REAL en Chromium, baja con la rueda hasta z13 y mide el bucle
  exacto del volcado (renacida-tras-entrega), el reposo mudo y el plan
  completo. El calzo de CSS de los bancos de vistas ahora es compartido
  (`harness/calzo.mjs`) — sin él el lienzo nace 1280×3925 y la rueda gira
  fuera de la ventana. `probe-supertesela.ts` deja medido el coste real: una
  supertesela 2176² ≈ 40 s en contenedor (mundo 256 y 512 igual: la retícula
  es constante).

### Los lugares aleatorios, al grifo (decisión de Luis)
- **Por defecto NO se siembra nada**: ni granjas, ni aldeas, ni abadías,
  molinos, torres, ventas, minas. Ni en mundos nuevos ni en los viejos. Los
  pueblos del MUNDO (capitales, villas — la geografía humana), los caminos
  del mundo y los hitos naturales (Salto/Fuente/Peña…) NO son sembrado y se
  quedan.
- **El tick del menú lateral** («Generar lugares aleatorios», icono casa):
  escribe una edición `placesEverywhere` — viaja con la lista (se guarda, se
  deshace con Ctrl+Z, invalida el canon por el hash de ediciones, sin
  segundo canal de persistencia). Encenderlo reproduce EXACTAMENTE el país de
  siempre (banco C: lugar a lugar).
- **El pincel «Lugares»** (grupo del pincel, con radio y Ctrl-negativo
  universal): pinceladas `placesZone` add/remove en celdas del mundo —
  «generar en esta zona» y «vaciar esta zona». Sólo invalidan las
  superteselas que pisan (relevantEdits los filtra por trazo).
- **Plomería**: `RegionParams.sites: 'auto' | 'everywhere'` — 'everywhere'
  es el defecto de los BANCOS (nada viejo cambia de suelo); la aplicación usa
  'auto' en todas sus vías (canonParams fuerza 'auto'; la hoja libre y la de
  comarca pasan la política EXPLÍCITA porque viajan con el mundo editado y no
  pueden mandar `edits` sin aplicarlos dos veces). La política es identidad
  de caché DE VERDAD (la política entera hasheada, no sólo el modo — el banco
  cazó a la caché de hojas devolviendo la hoja de otra política bajo la misma
  revisión).
- **Banco nuevo `places-policy`** (9 varas, todas en verde): everywhere
  siembra · auto-sin-ediciones cero + mundo intacto + hitos intactos · grifo
  == everywhere lugar a lugar · zona add sólo dentro · zona remove vacía y el
  resto ni se entera.

### Verificación de la pasada
tsc 0 · eslint 0 · conformance 2.047 claves · city-quality 32/32 ·
canon-persist · canon-seed-flow · places-policy 9/9 · tile-retention VERDE
(60/60, reposo mudo, 0 caducadas) — y el resto de la tanda + smoke al cierre.

### Deuda nueva y vigilancias
- El DEBUG (traza `[teselas]`, HUD, contadores) SIGUE PUESTO a propósito:
  Luis aún no ha confirmado nitidez en su máquina. Quitar cuando confirme
  (client.ts `DEBUG_TRACE`, HUD de Map2D/World3D).
- La cola de teselas es FIFO sin prioridad por nivel visible: en un pool
  lento (contenedor), el plan hondo espera detrás de ancestros ya obsoletos.
  En su máquina (Forja, supers de 2-5 s) no se nota; si algún día molesta, la
  prioridad va en `acquireSessionWhenFree`, no en otra guarda más (lección
  #35). [Pasada 10: la cola honda vive ahora en el `tileService` (corta,
  descartable); la del pool ya no puede crecer. La prioridad, si hiciera
  falta, iría en la cola del servicio.]
- El tick regenera el canon entero al cambiar (correcto: el suelo cambia de
  verdad — granjas, cercas, sendas). La primera pasada tras encenderlo/
  apagarlo re-fragua como un primer paseo; con el almacén de Dexie los dos
  estados quedan cacheados por separado y alternar es barato después.

---

## 6h · Décima pasada (2026-08-13): el mundo entero al grifo, y la reestructura F1

El segundo parte de Luis: un mundo NUEVO nació con ciudades y caminos («cuando
te dije que todo lo que no fuese geografía debe de ser una opción»), la ciudad
salía duplicada y en otro color al acercar, y el encargo grande: «investiga en
profundidad cómo se hacen este tipo de aplicaciones de mapas… y si es
necesario reestructura. Esto ya se ha resuelto en otras apps».

### El grifo manda también EN EL MUNDO
- `HumanGeographyParams.sites?: 'auto'|'everywhere'` (fuera de
  `DEFAULT_HUMAN_PARAMS` a propósito: el rowKey del canon no se mueve).
  `buildHumanGeography` con 'auto' filtra el sembrado GENERADO — ciudades,
  calzadas, ruinas — por `world.painted.sitesPolicy`; lo PINTADO jamás se
  filtra. La puerta de la app es `getGeography`/`rebuildGeography` (texture.ts,
  `sites:'auto'` + política en `geoKey`); los bancos que llaman
  `buildHumanGeography` a pelo conservan el país de siempre.
- Los hitos naturales NOMBRADOS (Fuente de…, Salto de…) también piden permiso
  («lo mismo con fuentes, puentes»): el accidente es geografía, su nombre es
  contenido inventado (generate.ts, filtro sobre `buildLandmarks`).
- La ciudad duplicada blanca/marrón: `regionalSpatialEntities` en WorldView
  dedupe por `worldId === undefined` — el pueblo del MUNDO no vuelve a
  entrar como lugar regional.
- Banco `places-policy` ampliado a 16 varas: G (mundo desnudo = 0 ciudades /
  0 calzadas / 0 ruinas), H (grifo abierto == legado ciudad a ciudad,
  calzada a calzada, ruina a ruina), B corregida (hitos nombrados callan con
  el grifo cerrado — la vara vieja esperaba lo contrario a lo decidido),
  C ampliada (los hitos vuelven todos con el grifo abierto).

### La investigación y el rediseño (tasks/ARQUITECTURA-TESELAS.md)
Referencias leídas de verdad: mod_tile/renderd y Tirex (OSM), MapLibre GL
(life-of-a-tile), Leaflet (keepBuffer/fallback), Paper (chunk streaming). El
diagnóstico: la pirámide estaba bien; el TRANSPORTE (promesa+plazo+cancelación
por tesela contra sesiones con estado casadas por identidad de objeto) era
exactamente lo que las referencias no hacen. El plan por fases quedó escrito
en el documento; **F1 está HECHA y medida**:

- **`region/tileService.ts`** — el embudo único (2D, carta, 3D): disco →
  cola corta y descartable → pool. Techo de vuelo = `sessionCapacity` del
  pool; cancelar EN COLA descarta (null re-pedible), cancelar EN VUELO deja
  aterrizar, entrega y guarda (regla renderd: lo empezado ya está pagado);
  dedupe por contenido con copia para la segunda vista (dos almacenes no
  pueden compartir un ImageBitmap que uno cerrará). 15 varas en
  `harness/tile-service.ts` (workers de mentira, png de verdad).
- **`renderedSnapshots.ts` + Dexie `renderedTiles` (v26)** — la tesela
  ENTINTADA persistida con clave de contenido (versión de tinta + versión de
  canon + semilla + dims + params + humanos + ediciones relevantes POR
  HUELLA — `relevantEditsForSheets`, las mismas reglas que el canon — +
  estilo + z/x/y). Sólo suelo hondo; presupuesto 128 MB LRU; una fila por
  suelo+estilo (editar sobrescribe, no acumula).
- **El 3D con identidad de contenido**: props nuevas `canonWorld`/`canonEdits`
  hasta `zoomInputs`; sus hondas comparten encargos y disco con el 2D y el
  `consumeOnly` se responde del almacén sin tocar worker.
- **MEDIDO** (banco de retención, mundo 512, Chromium real): bajada a z16 =
  672 pedidas → 87 despachadas, 208 descartadas en cola, 12/12 entregadas,
  0 renacidas, 0 caducadas, reposo mudo, 1 cambio de generación. SEGUNDA
  VISITA (recarga = sesión nueva, mismo IndexedDB): las 35/35 hondas
  guardadas sirvieron del disco — 0 fraguas para suelo ya visto.

### Google Maps de verdad: la tinta, medida
`harness/tile-ink.ts` (nuevo): por DIFERENCIA de píxeles, sin adivinar
colores. Calzadas en campo abierto (la 1.ª versión medía en el casco urbano,
donde tejados y mancha pintan ENCIMA en ambas pasadas y la diferencia se
anula): z10 225px · z12 129px · z14 256px · z16 512px. Ciudad contra mundo
desnudo: z10 4.580px · z12 60.863px · z14/16 ~65.000px · plano de calles
presente a z16 (2,4 m/px). Y el desnudo, desnudo: 0 ciudades · 0 caminos.

### Bancos puestos al día con el mundo desnudo
`views-smoke`, `tile-retention` y `edit-vocab` abren el grifo en su
`preparar` (en edit-vocab DENTRO de la PaintSession: la lista serializada
debe reabrirlo sola al regenerar de la semilla). `tile-retention` registra
también el almacén de entintadas, pasa `canonEdits` de verdad (serializado,
como WorldView), y su corredor tiene fase de SEGUNDA VISITA con vara propia
(disco a cero = ROJO DEL DISCO). `consume-only-probe` se esperaba las
respuestas en el mismo tick y el núcleo encadena una cola async desde la
pasada 9 — ahora espera por sondeo (declinada 3,8 ms · genera 21,8 s ·
residente 1,9 s: CONTRATO CUMPLIDO).

### Pool: la fila india, curada de raíz
`acquireSessionWhenFree` (rama busy-match con paralelo): si el pool está
lleno de sesiones de OTRO mundo ociosas, desaloja la más vieja y abre una
fresca — las 404 peticiones por una sola sesión del log no pueden repetirse.
Y con la cola corta del servicio delante, al pool ya sólo llegan ≤techo.

### Verificación de la pasada
tsc 0 · eslint 0 · conformance 2.047 claves · tile-service 15/15 ·
places-policy 16/16 · edit-vocab todo sí · canon-persist/seed/composite/pool
VERDES · consume-only-probe CUMPLIDO · tile-ink 14/14 · tile-retention VERDE
×2 (con segunda visita VERDE DEL DISCO) · views-smoke 17/17.

---

## 6i · Décima pasada, segunda tanda (2026-08-13, con el parte y el log de Luis en vivo)

Luis probó la entrega y encontró DOS ROTURAS MÍAS, con captura y log
(«zoom a un río pixelado», HUD 0/60 · EN VUELO 0 · disco 0/0, y «había mapas
con ciudades y caminos ya. Los has borrado»):

### 1 · El grifo aplicado hacia atrás borró contenido existente (lección #43)
La primera codificación (ausencia de edición = cerrado) vació los mundos que
Luis ya tenía. Corregido en la raíz semántica: **ausencia = LEGADO (abierto)**
— `sitesPolicyFrom` sin ediciones de lugares devuelve everywhere:true, el
respaldo de `buildHumanGeography` sin `painted` también, y el atajo
«abierto y sin zonas = sin filtro» garantiza el país legado POR EL MISMO
CAMINO de siempre (bit a bit). El desnudo de los mundos NUEVOS/regenerados es
un asiento explícito: WorldView escribe `placesEverywhere:false` como primera
edición al estrenar semilla (visible en el tick, reversible con Ctrl+Z).
Los canonTiles viejos de Luis (generados abiertos) vuelven a ser coherentes
con su clave. Varas nuevas en `places-policy` (21): **F — RESTAURACIÓN**
(mundo sin ediciones == legado ciudad a ciudad, calzada a calzada), G con
cierre explícito, B1/B2 divididas, D con el asiento de nacimiento.

### 2 · El 0/60 del río pixelado: tres culpas del transporte (lección #44)
Del log (1.804 pedidas · 873 despachadas · 320 descartadas · 24 contextos):
- **La cola del servicio descartaba EL CENTRO**: FIFO + descarte por cabeza
  + `want` del centro afuera = lo más cercano moría primero y los restos del
  nivel abandonado despachaban antes que el plan mirado. Ahora la cola es un
  escalafón POR OLAS (el molde exacto de renderd, verificado en su
  `request_queue.c`: cola llena = descartar, drenado por prioridad estricta):
  se despacha la ola más nueva en su orden, el desborde se come la más vieja,
  techo 192. Varas G/H del banco del servicio (20/20).
- **El desalojo del pool thrasheaba**: mi cura de la fila india desalojaba
  CUALQUIER ociosa que no coincidiera, y con dos familias vivas (hondas con
  el mundo del canon; miniatura/sábanas con el editado) cada ráfaga mataba
  las sesiones calientes de la otra — 24 contextos en 2 min, cada uno
  re-clonando un 2048 y re-sembrando 8 s de Dexie. Regla nueva: **sólo se
  desaloja lo ocioso Y FRÍO** (`sessionHeat.coldMs`, 10 s; en las DOS ramas)
  y el aparcamiento re-comprueba con reloj (`waitForFree`) — inagotable
  aunque se pierda un aviso. Vara 6 del banco del pool (13/13).
- **Una ola de nulos congelaba el mapa**: null borra `lastAsk` para re-pedir,
  pero sólo re-pide quien DIBUJA, y con la cámara quieta sólo dibuja
  `onArrive` — que un null no dispara. El 0/60 con EN VUELO 0 de la captura.
  Ahora el almacén programa un empujón coalescido (400 ms) tras cada null.
- **Y el disco apagado en mundos sin ediciones**: las hondas viajaban con
  `edits: undefined` (canonSource sin trazos) → clave por revisión (`s:r3`
  del log), sin compartir, sin persistir (disco 0/0 · guardadas 0). Ahora
  `edits: canonEdits ?? ''` en los tres consumidores: un mundo sin trazos es
  contenido direccionable igual.

### La disciplina que faltaba en los bancos
El caso de Luis era un mundo LEGADO SIN EDICIONES de 2048 con miniatura y
sábanas vivas — ninguna de mis pruebas lo cubría (todas usaban mundos con
grifo explícito y canonEdits servido). Las varas nuevas (F de restauración,
G/H de olas, 6 de calor) codifican exactamente ese caso. `confirmarVista`
del smoke pasó de dormir-y-afirmar a esperar-hasta (12 s de techo): con el
legado restaurado la carta vuelve a montar un mundo habitado y rozaba el
presupuesto en SwiftShader.

---

## 6j · EL DERRIBO (2026-08-14): fuera el pool de sesiones, entra LA GRANJA

El tercer parte de Luis en 24 h: Atlas clavado en 0/28 con EN VUELO 0 «la
más vieja 18 s», declinadas 432, disco 0/863 — y en el log, la pieza final:
**`RangeError: Array buffer allocation failed`** — el renderer SIN MEMORIA.
Su orden, literal: «HAY MILES DE APLICACIONES DE MAPAS, HAZ QUE FUNCIONE
ESTA» · «Manda a tomar por culo el sistema actual y haz uno que funcione» ·
«Nuestra prioridad es que funcione, no conservar la arquitectura si NO
funciona». Ejecutado (lección #45): F2 del documento, por demolición.

### Lo que murió (client.ts)
`WorkerSession` y el casamiento por identidad · `acquireSessionWhenFree`
(las 4 ramas con predicados que podían no darse nunca) · el desalojo (con y
sin calor: `sessionHeat` queda como símbolo hueco) · `waitForFree`/waiters/
`notifyFree` · los plazos POR PETICIÓN con `armDeadline`/`armIdle` · el
pulso de cola (`queuePulse`/`pulseQueue`) — la maquinaria que mantenía vivo
el cuelgue que decía curar: los 20 huecos de vuelo del servicio clavados en
acquire, re-armados eternamente por el progreso de las sábanas (caducadas 0
con todo muerto) · `spawnSession`/`terminateSession`/`pruneSessions` · el
calentador entero (`warmCanon` → no-op documentado; su llamada en Map2D,
fuera): la granja reparte sola y el canon persiste en Dexie.

### Lo que vive (la granja, en el mismo client.ts)
- **Obreros fijos, jamás desalojados**: nacen perezosos hasta el techo y
  sólo mueren MUDOS (vigía). Reconfigurarse ≠ morir: un envío de contexto,
  y el libro de siembras se vacía con él.
- **`tomar` sin predicados imposibles** — (1) libre CON el contexto
  (afinidad); (2) hueco bajo el techo (un fresco cuesta el mismo configure y
  CONSERVA la residencia de la otra familia); (3) cualquier libre,
  reconfigurado; (4) aparcado re-intentable drenado al liberar Y por reloj
  (500 ms). Cada rama termina.
- **UN vigía por SILENCIO DE OBRERO** (paso adaptativo: min(presupuestos)/3,
  250 ms–5 s). Cada mensaje es latido; el mudo se retira y su trabajo
  resuelve null re-pedible (tesela) o rechaza (sábana). Ningún otro reloj.
- **Techo 8 con Forja** (min(cores, 8)): veinte obreros eran veinte clones
  de un 2048 en ráfaga A TRAVÉS del renderer — el funeral de la memoria.
  Ocho fraguas paralelas llenan cualquier plan con tránsito acotado.
- Sondas: obrero libre con el contexto residente, y nada más. Sheets: mismo
  camino con presupuesto de sábana. `parallelWorldSessions` queda como campo
  ignorado (la granja siempre es paralela).

### Medido (todo tras el derribo)
- Banco de la granja (ex canon-pool-parallel) 9/9: 4 teselas = 4 obreros a
  un solo reloj · el mudo cae por el vigía en 501 ms y el siguiente trabajo
  abre fresco · **dos familias alternando 24 teselas = 4 configures, 0
  terminates** (el thrash es imposible por construcción).
- tile-service 20/20 · canon-seed/composite VERDES · consume-only CUMPLIDO.
- Retención (Chromium, granja real): 9/9 entregadas · 0 renacidas · 0
  caducadas · **0 descartes de cola en las DOS visitas** (la granja da
  abasto) · reposo mudo · segunda visita del disco VERDE.
- views-smoke 17/17 · tsc 0 · eslint 0.

### Y LA MEMORIA: las cachés de RAM sobraban desde F1
El `RangeError: Array buffer allocation failed` de su log saltó pidiendo
3,6 MB — el renderer ya no tenía sitio. Lo que se apilaba en el HILO
PRINCIPAL: 256 MB de sábanas `RegionData` + 512 mapas de bits de 256²
(~134 MB) + el mundo + los rásters del atlas, encima de los clones de mundo
de 24-58 contextos naciendo y muriendo. Con canon en Dexie (pasada 8) y
tinta en Dexie (pasada 10) esas cachés gigantes ya no ahorran minutos:
- caché de sábanas **256 MB → 64 MB** (6 entradas),
- almacén de pantalla **512 → 224** teselas (~59 MB): volver sobre tus pasos
  lo paga ahora el disco en milisegundos, no la RAM,
- y la **dedupe global de lecturas de canon** (`loadCanonDedup`): un plan de
  28 teselas pedía las mismas 4-12 superteselas ~100 veces a IndexedDB, que
  las serializa — de ahí el «siembra … 8279 ms» de su log y 2,2 MB copiados
  por cada una. Ahora son 4-12 lecturas y el resto se cuelga de la promesa.

### El caso de Luis, EN BANCO (lo que faltaba)
`tile-retention` acepta `BANCO_ANCHO` y `BANCO_LEGADO`: con **2048 + legado
sin ediciones** — su escenario exacto, el del 0/28 — la bajada entrega
**24/24 a z14** (más hondo que su z11) con 0 caducadas, 0 renacidas y reposo
mudo; la segunda visita, **32/32 a z11** con el disco sirviendo. Ese banco es
ahora la vara de «el 2D funciona», y corre con un mundo del tamaño del suyo.

### Señales del tercer parte aún abiertas (vigilar en su máquina)
- declinadas 432: el 3D consumiendo canon frío en bucle con el empujón de
  400 ms del almacén — con la granja + disco debería colapsar (el 3D ya se
  sirve de `renderedTiles`); si su próximo log sigue enseñando cientos de
  declinadas, el empujón necesita retroceso exponencial.
- disco 0/863 de aquel log era el `edits: undefined` (curado en 6i §disco);
  con la granja el HUD debe cantar aciertos en suelo revisitado.
