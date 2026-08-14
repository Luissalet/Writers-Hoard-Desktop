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
