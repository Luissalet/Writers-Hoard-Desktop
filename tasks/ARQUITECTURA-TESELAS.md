# Arquitectura de teselas — el rediseño «como las apps que ya lo resolvieron»

2026-08-13. Encargo de Luis, literal: «Si está mal pensado (llevas muchísimas
sesiones ya fallando) quiero que investigues en profundidad cómo se hacen este
tipo de aplicaciones de mapas con mucha calma y si es necesario reestructures»
· «Haz la sesión más gorda del mundo… esto ya se ha resuelto en otras apps» ·
«Tiene que ser literalmente un google maps».

## 1 · Lo que hacen las referencias (investigado, no recordado)

**mod_tile + renderd / Tirex** (el servidor de teselas de OpenStreetMap):
- El servidor **sirve del almacén primero**. Si la tesela no existe, la encola
  y el cliente se queda con el MEJOR RESPALDO mientras tanto. Si existe pero
  está caducada, **se sirve la vieja INMEDIATAMENTE** y se encola el
  re-render en una cola de fondo («serve stale, render dirty»).
- Las colas de render al vuelo están **limitadas a 32 metateselas** — cortas A
  PROPÓSITO para minimizar latencia; lo que no cabe SE DESCARTA y el cliente
  simplemente conserva el respaldo. Nada de plazos por petición que matan
  trabajadores: el descarte es silencioso y barato porque el visor nunca
  espera a nadie.
- Colas separadas por prioridad: al-vuelo (falta) > caducada > fondo/bulk.
- **Metateselas 8×8**: el render se amortiza en bloques, no por tesela.

**MapLibre GL** (el visor):
- Un `TileManager` por fuente calcula por fotograma las teselas IDEALES de la
  cámara (`coveringTiles`) y **retiene padres/hijos** mientras las ideales
  llegan — borroso-luego-nítido, jamás en blanco.
- Caché en dos niveles: activas (en uso + ancestros de transición) y una LRU
  de inactivas. Peticiones raster con **límite de vuelo**; los workers hacen
  trabajo SIN ESTADO por tesela y devuelven transferibles.

**Minecraft/Paper** (generación cara, como la nuestra):
- La generación corre en hilos de fondo con **prioridad por distancia al
  jugador**, y lo generado SE PERSISTE — se paga una vez en la vida del mundo.

## 2 · El diagnóstico del nuestro

La pirámide (z/x/y, respaldo de padres, canon persistido) está bien y coincide
con las referencias. Lo torcido es el TRANSPORTE, que es exactamente lo que
las referencias NO hacen:

- Peticiones con promesa+cancelación+plazo por tesela contra **sesiones CON
  ESTADO casadas por identidad de objeto** (mundo+geografía+revisión). Cada
  fase de la app (generar, geografía por pasadas, comarcas) deja sesiones
  huérfanas; el pool se llena de muertos; el log de Luis del 2026-08-13:
  **las 404 peticiones de la sesión entera por UNA sola sesión**
  (region-context-21) — la fila india.
- Cinco capas de maquinaria compensatoria (vigilantes que matan sesiones,
  rearmes, pulso de cola, calentadores, libro de siembras con bus de
  desalojos) que existen sólo porque el dato no está listo cuando la vista
  pregunta y el canal es frágil. renderd no tiene NINGUNA: sirve lo que hay,
  encola corto, descarta el resto.
- Lo entintado NO se guarda: cada sesión de la app re-pinta teselas que ya se
  pintaron ayer. En renderd el almacén de render ES el producto.

## 3 · El rediseño

### 3.1 Un servicio de teselas sin estado: `tileService`
La vista deja de hablar con sesiones. Habla con UN módulo con este contrato:

```
want(mundoRef, claves[], centro)   // el plan vigente, re-declarado por asentamiento
take(clave) → bitmap | null        // de la RAM; null = usa el respaldo de padres
onArrive(cb)                       // «ha llegado algo: repinta»
```

- `want` DIFERENCIA contra el plan anterior: lo nuevo se encola con prioridad
  por distancia al centro; lo que ya no está en el plan se degrada o se
  descarta de la cola (jamás se «cancela» un render en curso: se recoge y se
  guarda — ya está pagado).
- **Cola corta y descartable** (regla renderd): techo pequeño de render al
  vuelo; si el plan cambia más rápido de lo que se rinde, la cola se queda
  con lo último querido y punto. Sin plazos por petición: la supervisión es
  POR WORKER (un worker sin latido en 120 s se reemplaza), no por tesela.

### 3.2 Tres niveles de almacén (los tres content-addressed)
1. **RAM**: el `DisplayTileStore` de siempre (activas + LRU + respaldo de
   padres). Se queda tal cual — es el trozo que ya coincidía con MapLibre.
2. **Dexie `renderedTiles` (NUEVO)**: la tesela ENTINTADA (png/webp ~20-80 KB)
   con clave de contenido: `versión:semilla:params-hash:edits-relevantes-hash
   :estilo:z/x/y`. Revisitar suelo = ~5-15 ms por tesela, ENTRE SESIONES —
   la sensación Google Maps de verdad. Presupuesto LRU en bytes.
3. **Dexie `canonTiles`** (ya existe, pasada 8): la metatesela de datos. El
   único coste de minutos, pagado una vez por mundo y zona.

La invalidación no existe como operación: la clave ES el contenido (mismo
truco que el rowKey del canon — las ediciones relevantes por huella de
tesela). Una edición cambia el hash y las filas viejas simplemente dejan de
consultarse y caen por LRU.

### 3.3 La granja: workers idénticos casados por CONTENIDO, no por objeto
- Un worker carga un mundo por su **hash de contenido** (semilla+params+
  ediciones), no por identidad de objeto+revisión. Cualquier worker con el
  hash correcto sirve cualquier petición de ese mundo; cargar el mundo en un
  worker es un trabajo más de la cola. Se acabaron: el emparejamiento por
  identidad, el desalojo-al-tope que nunca corría (la fila india), y las
  reconfiguraciones porque una pasada de geografía cambió la identidad del
  objeto sin cambiar el contenido.
- La geografía viaja como hasta ahora (cuesta 19 s construirla) pero keyed
  por el mismo hash.

### 3.4 Lo que DESAPARECE con la reestructura
`requestTile` con promesa/cancel/abandono por tesela · el vigilante que mata
sesiones · `queuePulse` · `warmCanon` (el servicio pre-busca vecinos él solo,
es el `keepBuffer` de Leaflet) · `seedCanonFor` + libro de siembras + bus de
desalojos (el servicio tiene UN canon residente compartido de verdad, no uno
por sesión). Unas ~800 líneas de tejido cicatricial cuya razón de existir
desaparece.

## 4 · Fases (cada una verde antes de la siguiente)

- **F1 — HECHA (2026-08-13). El almacén de entintadas + la cola corta.**
  - `region/tileService.ts`: el embudo único de los tres consumidores (2D,
    carta, 3D). Disco primero → cola corta y descartable → pool. Techo de
    vuelo = sesiones del pool; lo cancelado EN COLA se descarta (null
    re-pedible); lo cancelado EN VUELO aterriza, se entrega y se guarda
    (regla renderd: un render en curso ya está pagado). Dedupe por contenido:
    dos vistas que quieren la misma tesela pagan UN render (la segunda recibe
    copia — dos vistas no pueden compartir un ImageBitmap que una cerrará).
  - `renderedSnapshots.ts` + tabla Dexie `renderedTiles` (v26): la tesela
    entintada (webp ~20-80 KB) con clave de contenido — versiones + semilla +
    params + ediciones RELEVANTES por huella (mismas reglas que el canon:
    `relevantEditsForSheets`) + estilo + z/x/y. Sólo suelo HONDO (el caro);
    lo somero se re-pinta en ms y lleva revisión de sesión.
  - El 3D pide las hondas con la identidad de CONTENIDO (canonWorld +
    canonEdits vía props nuevas), no con el objeto editado: comparte encargos
    y disco con el 2D, y su consumeOnly se responde del almacén sin worker.
  - MEDIDO (banco de retención, mundo 512, Chromium):
    · bajada a z16: 672 pedidas → 87 despachadas · 208 descartadas en cola ·
      12/12 entregadas · 0 renacidas · 0 caducadas · reposo mudo.
    · SEGUNDA VISITA (recarga de página = sesión nueva, mismo IndexedDB):
      35/35 teselas hondas guardadas sirvieron del disco, 0 fraguas para el
      suelo ya visto. `harness/tile-service.ts` (nuevo): 15 varas del embudo.
- **F2 — la granja por hash de contenido** y el desguace del tejido
  cicatricial (plazos, pulsos, siembras, calentadores). Con la cola corta de
  F1 delante, la cola honda del pool ya no puede formarse — el desguace es
  quitar andamios que ya no cargan peso. Bancos: pool paralelo N sesiones
  sirviendo un plan (medido), retención, ink, smoke, canon-*.
- **F3 — limpieza**: DEBUG fuera cuando Luis confirme, PENDIENTE/lecciones.

## 5 · Qué NO cambia
El generador (mundo, canon, ciudades), la pirámide y sus claves, el canon
persistido de la pasada 8, el respaldo de padres del `DisplayTileStore`, el
contrato consumeOnly del 3D (pasa a preguntar al servicio, que responde de
RAM/Dexie sin generar — más simple aún), y el modelo semilla+params+ediciones.

## 6 · Contrato final del mapa 2D (2026-08-14)

La cámara es la única autoridad. En cada asentamiento produce un plan completo
de cobertura; `DisplayTileStore.wantPlan` sustituye el plan anterior de una vez,
mantiene los bitmaps residentes como respaldo y cancela cualquier trabajo
pendiente que ya no pertenezca a la vista, aunque fuese de otro nivel de zoom.
Esto evita que una rueda rápida deje z7, z8, z9… bloqueando el z que el lector
mira ahora.

El almacén de pantalla tiene el mismo ciclo de vida que el efecto de React que
lo crea. Es una condición obligatoria bajo StrictMode: el desmontaje de prueba
ya no puede desechar un objeto memoizado que el segundo montaje reutilizaría.

La clave de fuente es estable y por contenido:
`mundo + parámetros + revisión + geografía + depth + ediciones`. Se usa tanto
para asignar workers como para las claves primarias de `canonTiles` y
`renderedTiles`. Versiones distintas pueden coexistir hasta el LRU; una respuesta
tardía nunca pisa el mapa vigente.

La preparación canon ocurre antes de adquirir un worker. Un registro global de
*single-flight* da un único dueño a cada metatesela faltante y entrega sus bytes
a todos los demás trabajos que la necesitan. Así los trabajadores no pasan
segundos reservados esperando IndexedDB ni recalculan la misma sábana en
paralelo.

La composición sigue una propiedad de capa explícita:

- **Teselas:** terreno, costa, agua, ríos y campos; nunca carreteras ni ciudades
  principales.
- **Pantalla:** carreteras, ciudades principales, rótulos e interacción, siempre
  en coordenadas mundiales con la misma transformación de cámara.
- **Respaldo:** raster/ventana nítida para el terreno y río vectorial para el
  agua lineal. La tesela exacta tapa el respaldo cuando llega.
- **Detalle:** edificios, aldeas y topónimos menores del canon sólo se añaden con
  geografía `full`, deduplicando los pueblos ya presentes en la capa principal.

`WorldView` ya no arranca un generador regional oculto después de asentar la
cámara. En 2D sólo la pirámide solicita terreno detallado; lugares y detalle
viajan en sus mismas respuestas.

## 7 · Continuidad de LOD y arranque no bloqueante (2026-08-14)

Toda costa visible deriva ahora de `region/coastField.ts`. El atlas lejano, las
teselas satélite someras y el canon regional comparten el mismo contorno cero,
la misma convención de centro de celda y una deformación física fija de 1,8 km.
El relieve fino puede erosionar y sombrear, pero vuelve a fijar el signo de cada
celda contra ese contorno; las ediciones de elevación del lector son la única
excepción. El color de bioma/cobertura tampoco puede escoger mar para un píxel
que el contorno ya declaró tierra. La regresión de imagen mide 0,07 % de
desacuerdo atlas z5→satélite z6 y 0,06 % satélite z8→canon z9.

Las fronteras de cobertura usan un campo mundial continuo en todos los niveles,
sin interruptores por zoom. La tinta de copas pregunta a esa misma máscara
orgánica incluso fuera de la celda forestal original; por eso un bosque puede
formar dedos y claros y cruzar una costura sin revelar el cuadrado canon.

`settlementCellCenter` es el ancla única de una población. Marcador, carretera,
mancha urbana, lugar regional y plano de calles coinciden en `(x+0.5,y+0.5)`.
Antes, la tesela buscaba edificios en la esquina de la celda mientras la capa
viva dibujaba la ciudad en el centro: a z17 la separación era de miles de
píxeles. Las teselas profundas siguen dibujando techos y, cuando la resolución
lo permite, el plano urbano completo sin necesitar clic ni hover.

La geografía humana completa ya no se calcula en `requestIdleCallback`: ese
callback seguía ejecutando 13 s síncronos en el hilo de la interfaz. Un worker
deduplicado por identidad de contenido construye la base, transfiere
`realmOf` y `WorldView` adopta el resultado sólo si mundo y revisión siguen
vigentes. `LanguageFamily` contiene funciones ortográficas no clonables, de
modo que el worker envía los datos pesados y el cliente reconstruye esa familia
determinista desde semilla y número de lenguas. Durante el primer cálculo se
mantiene el mapa provisional y se muestra `worldgen-map-loading`; las entradas
posteriores cobran la base de memoria.

## 8 · Jerarquía hidrológica entre niveles (2026-08-14)

La geometría por sí sola no identifica un río. El `flow` de un río mundial es
una magnitud global, normalizada contra todo el planeta; el `flow` de un cauce
canon se normaliza dentro de su propia metatesela. No son intercambiables. La
implementación antigua convertía aproximadamente el primero en acumulación
local y después dibujaba sólo desde esa cuenca parcial: al cruzar al canon, un
río de 2.220 m podía quedar en unos 20 m y volver a cambiar en la metatesela
siguiente.

`region/riverScale.ts` es ahora la única ley física de anchura. La vista somera
la usa directamente; el canon transporta `worldFlow` y una `sourceRiverKey`
derivada del contenido de la polilínea. `sourceRiverKey` no es un índice: borrar
otro río no puede renumerarla. Los cauces inventados localmente omiten ambos
campos y conservan su ley por cuenca.

La identidad del tronco no se deduce por solape. Cada `CarvedRiver` se incorpora
al canon como stream autoritativo con su polilínea, clave y caudal originales;
los cauces D8 locales nunca reciben esos campos. Así un arroyo que toca o corre
junto al río principal no puede heredar dos kilómetros de anchura. Cuando una
vista necesita ambos, la tinta ordena estrechos primero y anchos después para
que ningún afluente pinte una raya sobre el cauce principal.

El formato canon y la caché de entintado llevan versiones nuevas. La regresión
`harness/river-hierarchy.ts` verifica la relación principal/arroyo a 1.000,
100 y 10 m/px, la identidad en una metatesela real, la igualdad exacta de
caudal/anchura a ambos lados del hand-off y la ausencia de contagio en
confluencias.

## 9 · Geometría autoritativa y carga estable de ríos (2026-08-14)

El solape hidrológico descrito arriba resultó insuficiente como fuente de
identidad: un cauce local corto podía coincidir por casualidad con varias
muestras del tronco y reclamar su clave antes que el trazado correcto. Tener el
caudal correcto sobre la polilínea equivocada seguía produciendo, al terminar
la carga, una raya corta y arbitraria. El canon ya no infiere el tronco. Recibe
directamente cada polilínea de `CarvedRiver`, con sus puntos, clave y caudal
mundiales intactos; la extracción D8 sólo genera tributarios locales sin
identidad mundial. La composición conserva esos puntos sin volver a suavizarlos.

En el mapa equirectangular, los troncos mundiales pertenecen a una única capa
vectorial de pantalla dibujada después del terreno. Ni la tesela somera ni el
ancestro de respaldo los hornean en sus bitmaps; al ampliar, por tanto, ningún
raster pequeño puede convertirse en una mancha azul borrosa. Las teselas
profundas conservan el detalle hidrológico local, pero omiten el tronco que ya
posee la pantalla. El mismo vector permanece visible antes, durante y después
de entregar las teselas exactas, de modo que el cambio de LOD sólo sustituye el
terreno bajo el río y nunca su recorrido.

Las proyecciones no equirectangulares, que todavía no usan la pirámide profunda,
mantienen su raster proyectado. `harness/map2d-layer-contract.ts` fija esta
separación de responsabilidades y `harness/river-hierarchy.ts` exige igualdad
punto por punto entre el río tallado mundial y el tronco recibido por el canon.

## 10 · Forma fluvial y huella urbana (2026-08-14)

La anchura visible del tronco mundial ya no reutiliza el caudal de la
desembocadura en todos sus puntos. `world.flow` aporta el caudal de cada celda
y `riverScale.ts` lo convierte con una curva convexa de 24 a 700 m. Esta ley es
física y compartida por la capa mundial y el canon. Sólo cuando esa medida cae
por debajo del píxel se aplica una línea cartográfica mínima, también
jerarquizada por caudal.

En primer plano el agua no se dibuja como un `stroke` de anchura constante. Se
muestrea la polilínea en distancia real y se construyen dos orillas
independientes, moduladas por una señal determinista en metros. La silueta, por
tanto, es orgánica pero no cambia ni se desplaza al variar el zoom o al cruzar
una tesela. En la costura cilíndrica la separación se decide comparando las
longitudes de las celdas fuente; nunca se intenta deducir después de proyectar
a píxeles.

La acumulación D8 del canon describe sólo drenaje regional. El tronco mundial
ya viaja como vector autoritativo y no vuelve a inyectarse en esa acumulación:
hacerlo creaba un segundo río cardinal y corredores húmedos falsos. Un pequeño
microgradiente global deshace empates de elevación; además, una confluencia se
cierra antes de leer la cuenca del receptor y los cursos con rayas cardinales
kilométricas se descartan. Los arroyos subpíxel tampoco reciben un mínimo de
1,1 px, por lo que no forman un entramado azul artificial a media distancia.

La base del plano urbano se integra con el terreno existente. El mapa conserva
tejados, calles, plazas, bloques y muralla, pero desactiva el relleno opaco del
suelo y los tintes Voronoi de barrio. La tierra cultivada o despejada alrededor
de un asentamiento sigue perteneciendo al canon y no a una mancha decorativa.

Las regresiones fijan las cuatro propiedades: anchura física y orillas
deterministas, ausencia de costura planetaria, ausencia de rayas D8 largas y
cero píxeles de pergamino opaco alrededor de la ciudad.

## 11 · Ciudad y geografía comparten suelo (2026-08-14)

El plano urbano ya no recibe sólo las etiquetas `port` y `river`. El atlas
transforma al sistema local de la ciudad el litoral, el eje fluvial, su anchura
física, la pendiente y los rumbos de las carreteras. Todas esas medidas parten
de `settlementCellCenter`; la antigua mezcla de `(x,y)` con `(x+0.5,y+0.5)`
desplazaba el cauce varios kilómetros en la ficha aunque coincidiera en el mapa.
Un indicador fluvial tampoco puede apropiarse del primer río de una celda
vecina: el cauce publicado debe alcanzar realmente la hoja urbana.

La posición del casco es una decisión geográfica. Un cauce modesto o con accesos
desde las dos orillas puede producir una ciudad de cruce; el generador conserva
ambas márgenes y crea puentes exactamente donde las calles lo atraviesan. Un
río ancho con acceso unilateral desplaza el centro urbano a la margen servida,
recorta allí las parcelas antes de calcular la muralla y detiene en la orilla
cualquier carretera que, sin puente, se convertiría en una calzada sobre el
agua. En un estuario, la costa elimina además la alternativa que caería en mar.

La composición de primer plano expresa la misma topología. La tesela dibuja
terreno y tejido urbano; la capa vectorial autoritativa repinta el río por
encima de edificios, murallas y carreteras ordinarias incluso durante la carga;
un pase final y exclusivo devuelve sólo puentes y embarcaderos por encima del
agua. `townPlan` comparte caché por revisión y por objeto de geografía, por lo
que mapa y modal generan byte a byte el mismo plano y ninguna reconstrucción
humana deja una ciudad obsoleta en teselas posteriores.

`harness/city-ground-context.ts` fija este contrato sobre mundos reales y
sintéticos: coordenadas de ancla, selección de margen, ausencia de edificios,
caminos y muralla en el canal, puentes sobre el agua, costa edificable, igualdad
mapa/modal e invalidación de caché. El banco histórico `city-quality.ts` conserva
además sus 32 controles de conectividad, fachadas, escalas, puertas y agua.

## Fuentes
- mod_tile/renderd: github.com/openstreetmap/mod_tile (colas al vuelo de 32
  metateselas, servir-caducado-y-encolar, metateselas 8×8, colas por
  prioridad) · wiki.openstreetmap.org/wiki/Mod_tile
- Tirex: github.com/openstreetmap/tirex (maestro + gestor de backends +
  cola central con metateselas en disco)
- MapLibre GL: github.com/maplibre/maplibre-gl-js
  developer-guides/life-of-a-tile.md (coveringTiles, retención
  padre/hijo, workers por tesela, límite de vuelo) ·
  deepwiki.com/maplibre/maplibre-gl-js/2.4-tile-management (caché activa +
  LRU inactiva, OverscaledTileID, dispatcher)
- Leaflet: leafletjs.com/reference.html (GridLayer keepBuffer, retención al
  cruzar niveles) · plugin tilelayer.fallback (padres cuando el hijo falta)
- Generación cara con prioridad por distancia y persistencia:
  papermc-paper.mintlify.app/optimization/chunk-loading
