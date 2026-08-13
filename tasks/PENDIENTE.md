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
  #35).
- El tick regenera el canon entero al cambiar (correcto: el suelo cambia de
  verdad — granjas, cercas, sendas). La primera pasada tras encenderlo/
  apagarlo re-fragua como un primer paseo; con el almacén de Dexie los dos
  estados quedan cacheados por separado y alternar es barato después.
