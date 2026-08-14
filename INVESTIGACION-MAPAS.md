# Cómo funcionan de verdad las aplicaciones de mapas tipo Google Maps

**Investigación profunda: código real, algoritmos, fórmulas y números.**
Fecha: 14 de agosto de 2026 · Para: el proyecto *The world generator*

---

## Cómo se ha hecho esta investigación

Nada de lo que hay aquí sale de la memoria del modelo. Se ha leído **código fuente real**, clonado y verificado:

| Motor | Commit | Fecha | Papel |
|---|---|---|---|
| **Leaflet** (v2) | `c96f31a` | 2026-07-27 | El slippy map mínimo: DOM + CSS transforms |
| **MapLibre GL JS** | `06cac16` | 2026-08-13 | El heredero abierto de Mapbox GL: GPU, vectorial, la arquitectura "Google Maps moderno" |
| **OpenLayers** | `91db49d` | 2026-08-13 | El único de los tres que pinta teselas en **Canvas 2D** — el pariente más cercano a tu app |

Más investigación documental sobre Google Maps (docs oficiales, ingeniería inversa histórica), Bing Tile System, OSM, MVT, tippecanoe, van Wijk & Nuij, renderd/mod_tile, MBTiles/PMTiles, Cesium, geometry clipmaps.

**Marcas usadas en el texto:**

- ⭐ = directamente transferible a tu app (mundo plano, Canvas 2D, teselas propias en workers, IndexedDB).
- `ruta:línea` = cita verificable en el commit indicado.
- [CONFIRMADO] / [REPORTADO] / [GENERAL] en la parte documental = doc oficial / blog solvente / conocimiento general.

---

## Índice

0. [Las 14 ideas que gobiernan un mapa](#0)
1. [La matemática: pirámide, proyección, coordenadas](#1)
2. [La cámara: el Transform como única fuente de verdad](#2)
3. [Zoom con ancla: la fórmula](#3)
4. [Gestos: rueda, trackpad, pinch, arrastre, inercia](#4)
5. [Animaciones de cámara: easeTo y flyTo (van Wijk & Nuij)](#5)
6. [El bucle: render bajo demanda](#6)
7. [Ciclo de vida de la tesela: cobertura, cola, prioridad](#7)
8. [Cómo no parpadear nunca](#8)
9. [Nitidez: DPR, snapping, overzoom](#9)
10. [Raster vs vector, y el modelo de datos por tesela](#10)
11. [El render: orden, recorte, coordenadas locales](#11)
12. [Etiquetas: SDF, colisión, cross-tile, throttle](#12)
13. [Workers: protocolo, cuántos, qué corre dónde](#13)
14. [El servidor: metatiles, colas, dirty, TTL](#14)
15. [Almacén: MBTiles, PMTiles, IndexedDB, la explosión 4^z](#15)
16. [Generalización por zoom](#16)
17. [Terreno y 3D](#17)
18. [Los tres motores, cara a cara](#18)
19. [Qué significa esto para *The world generator*](#19)
20. [Tabla maestra de constantes](#20)
21. [Fuentes](#21)

---

<a name="0"></a>
## 0 · Las 14 ideas que gobiernan un mapa

Si sólo lees una página, que sea ésta. Todo lo demás son los detalles.

1. **Un mapa es una función pura de un estado diminuto.** Centro + zoom (+ bearing/pitch si hay 3D). Todo lo demás —qué teselas, qué matrices, qué etiquetas— se **deriva**. Los tres motores lo hacen así. Cualquier estado duplicado es un bug esperando.

2. **El zoom es logarítmico y el mundo es exponencial.** `worldSize = tileSize · 2^zoom`. Un zoom fraccional no es un caso raro: es el caso normal, y el nivel de teselas es un **redondeo** de él.

3. **Zoom con ancla = una sola primitiva.** `setLocationAtPoint(latlng, punto)`: "quiero que esta coordenada quede bajo este píxel". Rueda, pinch, doble clic, easeTo y flyTo la comparten. Si la implementas una vez y bien, los cinco gestos salen gratis.

4. **Los gestos producen deltas; el frame los aplica.** MapLibre acumula `panDelta/zoomDelta/bearingDelta` de todos los handlers activos y aplica **un solo** cambio de transform por rAF. Aplicar cada evento por separado es lo que produce el temblor.

5. **La inercia es física de tres líneas.** Velocidad media de una ventana corta (50–160 ms) → deceleración constante → distancia = v·t/2. Y se lanza como una **animación normal e interrumpible**, no como un modo especial.

6. **El bucle duerme.** Ninguno de los tres tiene un rAF permanente. Hay flags "sucio" (estilo, fuentes, placement, fades) y cuando todos están limpios el mapa emite `idle` y deja de pedir frames.

7. **La cobertura es un descenso de quadtree**, no un doble bucle: desde la raíz, test contra el frustum, si el nodo cumple el zoom deseado se emite, si no se apilan los 4 hijos. En 2D sin pitch degenera en un rectángulo de teselas, pero la estructura es la misma.

8. **La cola se ordena por distancia al centro de pantalla y se descarta sin piedad.** El centro primero. Y lo que ya no se quiere **se tira** (renderd: `noReqDroped++`; OpenLayers: prioridad `DROP = Infinity`). Una cola que no descarta castiga siempre lo que el usuario está mirando.

9. **Nunca enseñes un hueco.** Ésta es la idea más valiosa del documento y tiene tres capas: (a) retener **padres e hijos ya cargados** como sustitutos mientras llega la tesela ideal; (b) retener la **versión anterior** de la misma tesela cuando cambia el contenido (stale/interim); (c) **fundir** (cross-fade) en vez de sustituir de golpe.

10. **El texto es un sistema aparte.** No pertenece a ninguna tesela: se coloca en **coordenadas de pantalla**, con un índice de colisión, con prioridad por orden de capa, con presupuesto por frame (2 ms) y con un **índice cross-tile** que identifica "la misma etiqueta" entre niveles para que no parpadee al cambiar de zoom.

11. **Coordenadas locales + una matriz por tesela.** La geometría se guarda en enteros pequeños relativos a la tesela (0..8192) y toda la magnitud grande vive en una matriz calculada en doble precisión. Es lo que elimina el jitter a zoom alto.

12. **Pinta por capa, dentro por tesela.** Nunca "tesela completa de una vez". Es lo que garantiza que una carretera quede sobre el relleno de la tesela vecina.

13. **Invalidar es marcar, no borrar.** mod_tile retrasa el `mtime` del fichero. Sirve lo viejo, re-renderiza en segundo plano, sustituye cuando llega. Stale-while-revalidate implementado en 2007, antes de que existiera la cabecera.

14. **Cada nivel de zoom cuadruplica el mundo.** `4^z`. El último nivel es el 75 % del total. Por eso nadie pre-renderiza más allá de z14-15: en z15 sólo ~1/4 de las teselas se ha pedido alguna vez.

---

<a name="1"></a>
## 1 · La matemática: pirámide, proyección, coordenadas

### 1.1 El canon: world coordinates (Google)

La doc oficial del Maps JavaScript API define el sistema que copió todo el mundo [CONFIRMADO]:

```
world coordinate  : el mundo entero como un plano de 256×256 unidades EN FLOTANTE
                    (origen NO, x→este, y→sur)
pixelCoordinate   = worldCoordinate · 2^zoom
tileCoordinate    = floor(pixelCoordinate / 256)
```

Tres detalles que importan:

- El mundo base es **flotante**, no entero: la precisión no depende del zoom. El zoom sólo multiplica.
- El mapa se recorta a ±85.0511287798° de latitud **para que sea cuadrado** — así la lógica de teselas es uniforme y `2^z × 2^z` teselas cubren todo.
- Cada +1 de zoom duplica en x e y → **cuadruplica** el número de teselas.

### 1.2 Las fórmulas completas (Bing Tile System, el documento canónico)

Microsoft publicó la referencia matemática más completa y limpia [CONFIRMADO]:

```
groundResolution(lat, level) = cos(lat·π/180) · 2π · 6378137 / (256 · 2^level)   [m/px]
mapScale(lat, level, dpi)    = 1 : groundResolution · dpi / 0.0254

sinLat = sin(lat·π/180)
pixelX = ((lon + 180) / 360) · 256 · 2^level
pixelY = (0.5 − ln((1 + sinLat)/(1 − sinLat)) / (4π)) · 256 · 2^level
tileX  = floor(pixelX / 256)
tileY  = floor(pixelY / 256)
```

Y la versión OSM, equivalente [CONFIRMADO]:

```
n     = 2^zoom
xtile = n · (lon_deg + 180) / 360
ytile = n · (1 − ln(tan(lat_rad) + sec(lat_rad)) / π) / 2

lon_deg = xtile/n · 360 − 180
lat_rad = arctan(sinh(π · (1 − 2·ytile/n)))
```

**XYZ vs TMS**: la convención XYZ (Google, OSM, Bing) tiene `y=0` arriba. TMS cuenta desde abajo: `y_tms = 2^z − 1 − y_xyz`. Es la fuente de bugs número uno al mezclar formatos, y MBTiles usa TMS internamente (§15).

### 1.3 ⭐ Quadkeys: la clave de caché perfecta

Bing formaliza lo que Google hacía en 2005 con letras `q/r/t/s` [CONFIRMADO]:

```
Entrelazar los bits de tileX y tileY (Y aporta peso 2, X peso 1) y leer en base 4.
Ejemplo: tile (3,5) nivel 3 → X=011₂, Y=101₂ → 100111₂ → "213"
Dígitos: 0=NO, 1=NE, 2=SO, 3=SE

for i = nivel..1:
    digit = '0'; mask = 1 << (i−1)
    if (tileX & mask) digit += 1
    if (tileY & mask) digit += 2
    append(digit)
```

Tres propiedades que lo hacen la clave ideal:

1. **Longitud del quadkey = nivel de detalle.**
2. **El quadkey de una tesela es prefijo del de todas sus descendientes.** "¿Es X ancestro de Y?" = comparación de prefijo. Sin aritmética.
3. **Localidad espacial**: teselas vecinas tienen quadkeys vecinos → un índice B-tree (o un `IDBKeyRange` de IndexedDB) trae una región entera con **un solo rango**, no con N gets.

⭐ Lo mismo consigue mod_tile con su hashing intercalado x/y de directorios (§14.1) y PMTiles con la curva de Hilbert (§15.2). Tres sistemas independientes llegaron a la misma conclusión: **ordena el almacén por una curva de relleno de espacio**.

### 1.4 ⭐ Mundos planos: CRS.Simple y proyecciones de píxeles

Ésta es la parte que te toca directamente. **Ninguno de los tres motores asume la Tierra.**

**Leaflet — `CRS.Simple`** (`src/geo/crs/SimpleCRS.js:15-34`):

```js
export class SimpleCRS extends CRS {
    static projection = LonLat;                              // identidad: lng→x, lat→y
    static transformation = new Transformation(1, 0, -1, 0); // sólo invierte Y
    static scale(zoom) { return 2 ** zoom; }                 // ¡SIN el factor 256!
    static zoom(scale) { return Math.log(scale) / Math.LN2; }
    static distance(a, b) { /* euclídea */ }
    static infinite = true;
}
```

Frente a EPSG:3857: `infinite = true` hace que `getProjectedBounds()` devuelva `null` y que `GridLayer._isValidTile` no recorte nada (`GridLayer.js:712-717`); sin `wrapLng` no hay antimeridiano; `scale = 2^z` en vez de `256·2^z`.

**OpenLayers — proyección de píxeles** (`proj/Projection.js:62-137`). Una proyección es sólo `{code, units, extent, global}`; `units` admite `'pixels'` y `'tile-pixels'`. Receta oficial:

```js
const projection = new Projection({ code: 'mi-mundo', units: 'pixels', extent: [0, 0, 1024, 968] });
```

Con `global: false` no hay wrapping. La resolución pasa a significar "píxeles del mundo por píxel de pantalla": 1 = 1:1, 0.5 = ampliado 2×.

Y la plantilla exacta la da su propio código de Zoomify (`source/Zoomify.js:132-199`), la fuente para pirámides de imagen arbitrarias:

```js
const imageExtent = options.extent || [0, -imageHeight, imageWidth, 0];  // y negativa: origen arriba-izq
const tileGrid = new TileGrid({ tileSize, extent: imageExtent, resolutions });
```

⭐ **Tu pirámide.** Para un mundo de fantasía la elección canónica es:

```
mundo   : plano de W×H unidades, origen esquina superior-izquierda, y hacia abajo
scale(z): T · 2^z    (T = tamaño de tesela; con T=256, z0 = el mundo en una tesela si W=H=256)
pixel   = world · 2^z
tile    = floor(pixel / T)
clave   = quadkey  (o z/x/y, pero quadkey te da ancestro-por-prefijo gratis)
```

Sin proyección, sin clamp de latitud, sin wrapping. Todo lo que en un mapa terrestre es corrección de esfericidad, en tu mundo es **una línea que se borra** (lo verás otra vez en el shader de hillshade, §17.2).

### 1.5 OpenLayers y el modelo de resolución (el más general de los tres)

OpenLayers no guarda zoom: guarda **resolución** (unidades de proyección por píxel). El zoom es una vista logarítmica derivada (`View.js:1334-1370`):

```
zoom       = minZoom + log(maxResolution / resolution) / log(zoomFactor)
resolution = maxResolution / zoomFactor^(zoom − minZoom)          // zoomFactor por defecto 2
```

Con un array `resolutions` arbitrario, el factor se calcula por tramo. ⭐ **Consecuencia importante para ti**: nada obliga a que los niveles sean potencias de 2. Si has exportado niveles a 1×, 0.6×, 0.35×… el mismo motor funciona; sólo las relaciones padre/hijo pasan de aritmética de bits a comparación de extents (`TileGrid.js:261-393`). Es más caro pero funciona. Los niveles diádicos son una **optimización**, no un requisito.

---

<a name="2"></a>
## 2 · La cámara: el Transform como única fuente de verdad

### 2.1 MapLibre: un objeto, setters que invalidan, matrices derivadas

`TransformHelper` (`src/geo/transform_helper.ts:104-186`) guarda el estado completo:

```
_center (LngLat), _zoom, _bearingInRadians, _pitchInRadians, _rollInRadians,
_fovInRadians (default 0.6435 rad ≈ 36.87°), _edgeInsets (padding), _width/_height,
_tileSize = 512 (constante), minZoom=0, maxZoom=22, minPitch=0, maxPitch=60
```

⭐ **La regla de oro**: cada setter valida, clampa, marca `_unmodified = false` y llama a `_calcMatrices()`. **No existe estado derivado obsoleto.** Las matrices por tesela se cachean por clave y la caché entera se invalida en cada `_calcMatrices` (`mercator_transform.ts:710-714`).

Escalas:

```
zoomScale(z) = 2^z          scaleZoom(s) = log2(s)         (util.ts:510,515)
worldSize    = tileSize · 2^zoom                            (transform_helper.ts:301-303)
cameraToCenterDistance = 0.5/tan(fov/2) · height            (transform_helper.ts:571-572)
```

La matriz se construye de una pieza (`mercator_transform.ts:630-660`):

```ts
mat4.perspective(m, fov, w/h, nearZ, farZ);
m[8] = -offset.x * 2 / width;  m[9] = offset.y * 2 / height;   // centro desplazado por padding
mat4.scale(m, m, [1, -1, 1]);
mat4.translate(m, m, [0, 0, -cameraToCenterDistance]);
mat4.rotateZ(m, m, -roll); mat4.rotateX(m, m, pitch); mat4.rotateZ(m, m, -bearing);
mat4.translate(m, m, [-x, -y, 0]);        // x,y = centro en píxeles de mundo
```

`nearZ = height/50`, `farZ` por trigonometría hasta el horizonte × 1.01.

**Unproject de un punto de pantalla** — no es una inversa mágica, es un **rayo** (`mercator_transform.ts:362-391`): se transforman `(px,py,0,1)` y `(px,py,1,1)` por `_pixelMatrixInverse`, se dividen por w, y se interseca la recta con el plano z objetivo:

```ts
const t = z0 === z1 ? 0 : (targetZ - z0) / (z1 - z0);
return new MercatorCoordinate(lerp(x0,x1,t)/worldSize, lerp(y0,y1,t)/worldSize, targetZ);
```

⭐ En 2D sin pitch esto degenera a una división, pero **mantén la firma**: el día que quieras inclinar la cámara (tu meta 3D) ya tienes el punto de entrada correcto.

### 2.2 Leaflet: la cadena de coordenadas explicada

Leaflet es más pedagógico porque no tiene matrices. Tres espacios (`src/map/Map.js`):

```
LatLng --project(z)--> punto de MUNDO en px --(−pixelOrigin)--> punto de CAPA --(+panePos)--> punto de CONTENEDOR
```

```js
// src/map/Map.js:1519-1522
_getNewPixelOrigin(center, zoom) {
    const viewHalf = this.getSize()._divideBy(2);
    return this.project(center, zoom)._subtract(viewHalf)._add(this._getMapPanePos())._round();
}
```

El `pixelOrigin` es la esquina superior-izquierda del viewport en píxeles de mundo, **compensada por la posición actual del pane**. Así todo lo ya posicionado sigue siendo válido aunque el pane esté desplazado.

⭐ **El truco central de Leaflet, y la razón de que un pan cueste 0 en JS**: el pan no repinta nada. Mueve un div.

```js
// src/map/Map.js:1281-1283
_rawPanBy(offset) { setPosition(this._mapPane, this._getMapPanePos().subtract(offset)); }
// src/dom/DomUtil.js:54-69 → el.style.transform = translate3d(x px, y px, 0) [scale(s)]
```

Teselas, marcadores y overlays son hijos de ese pane y los compone la GPU. El precio: hay que resetear el pane a (0,0) cuando el desplazamiento acumulado supera `transform3DLimit = 8388608` (2²³, precisión float32 del compositor, `Map.js:124, 1366-1373`).

### 2.3 El padding / edge insets

Detalle pequeño con consecuencias grandes: el "centro" no tiene por qué ser el centro geométrico del canvas. MapLibre calcula `centerPoint` desde los `edgeInsets` (`src/geo/edge_insets.ts:70-76`) y lo inyecta como proyección descentrada en `m[8]/m[9]`. ⭐ Es lo que permite tener un panel lateral abierto y que "centrar en la ciudad X" la ponga en el centro **del área visible**, no debajo del panel.

---

<a name="3"></a>
## 3 · Zoom con ancla: la fórmula

El gesto más importante del mapa y el que casi todo el mundo implementa con una aproximación. Hay dos formulaciones equivalentes.

### 3.1 Formulación geométrica (Leaflet)

```js
// src/map/Map.js:256-265
setZoomAround(latlng, zoom, options) {
    const scale = this.getZoomScale(zoom),               // 2^(nuevo−viejo)
    viewHalf = this.getSize().divideBy(2),
    containerPoint = latlng instanceof Point ? latlng : this.latLngToContainerPoint(latlng),
    centerOffset = containerPoint.subtract(viewHalf).multiplyBy(1 - 1 / scale),
    newCenter = this.containerPointToLatLng(viewHalf.add(centerOffset));
    return this.setView(newCenter, zoom, {zoom: options});
}
```

⭐ **La fórmula, en una línea:**

```
nuevoCentro_px = viewHalf + (cursor − viewHalf) · (1 − 1/scale)
```

Derivación: para que el punto bajo el cursor no se mueva, el centro debe desplazarse **hacia** el cursor una fracción `(1 − 1/scale)` del vector centro→cursor. Con `scale = 2` (un nivel de acercamiento) esa fracción es 1/2; con `scale = 1/2` (alejar) es −1, el centro se aleja del cursor el doble.

### 3.2 Formulación por diferencia de rayos (MapLibre) — la que escala a 3D

```ts
// src/geo/projection/mercator_transform.ts:319-331
const a = this.screenPointToMercatorCoordinateAtZ(point, z);            // qué hay hoy bajo el cursor
const b = this.screenPointToMercatorCoordinateAtZ(this.centerPoint, 0); // qué hay bajo el centro
const loc = MercatorCoordinate.fromLngLat(lnglat);
const newCenter = new MercatorCoordinate(loc.x - (a.x - b.x), loc.y - (a.y - b.y));
this.setCenter(newCenter.toLngLat());
```

Es "coloca esta coordenada bajo este píxel", resuelto por **diferencia de dos rayos** — el error de la inversa se cancela, y funciona con pitch, bearing y padding sin cambiar una línea.

⭐ **El patrón completo de zoom anclado**, que MapLibre usa en rueda, pinch, doble clic, easeTo y flyTo:

```
1. preZoomAroundLoc = screenPointToLocation(around)   // ANTES de tocar nada
2. setZoom(zoom + Δ)                                   // recalcula matrices
3. setLocationAtPoint(preZoomAroundLoc, around)        // reancla
```

Y el pan comparte la misma primitiva (`mercator_camera_helper.ts:36-51`):

```ts
handleMapControlsPan(deltas, tr, preZoomAroundLoc) {
    if (deltas.around.distSqr(tr.centerPoint) < 1.0e-2) return;
    tr.setLocationAtPoint(preZoomAroundLoc, deltas.around);
}
```

### 3.3 OpenLayers: la versión con resolución

```js
// View.js:909-923 (calculateCenterZoom)
x = anchor[0] - resolution * (anchor[0] - currentCenter[0]) / currentResolution;
```

La misma identidad expresada en resoluciones. Se aplica **en cada frame** de una animación con `anchor`, lo que hace que el zoom animado con rueda mantenga el punto clavado durante los 250 ms de la transición, no sólo al final.

> **Veredicto ⭐**: implementa la versión de MapLibre (`setLocationAtPoint` + el patrón de 3 pasos). Es una función, y de ella cuelgan todos los gestos y todas las animaciones. La versión de Leaflet es más fácil de entender y perfectamente válida en 2D puro, pero tendrás que reescribirla el día que inclines la cámara.

---

<a name="4"></a>
## 4 · Gestos: rueda, trackpad, pinch, arrastre, inercia

### 4.1 La arquitectura correcta: handlers puros + un cambio por frame

MapLibre resuelve esto mejor que nadie (`src/ui/handler_manager.ts`). Los handlers **no tocan el mapa**: reciben eventos DOM y devuelven deltas (`HandlerResult`: `panDelta, zoomDelta, bearingDelta, pitchDelta, rollDelta, around, pinchAround`, líneas 94-125).

- `handleEvent` (408-486) recorre los handlers en orden de registro; cada uno declara con qué otros puede coexistir (`touchPan` permite `touchZoom` y `touchRotate` → pan + pinch + rotación simultáneos), y un handler activo **resetea** a los no permitidos.
- Los resultados se apilan en `_changes` y se pide **un** render frame.
- `_applyChanges` (518-540) **suma** todos los deltas acumulados desde el último frame (pan vectorial, zoom/bearing/pitch escalares; `around` = el último) y aplica **un solo** cambio de transform.

⭐ Esto es lo que separa un mapa que se siente sólido de uno que tiembla. Si aplicas cada `wheel`/`pointermove` según llega, estás haciendo N cambios de estado y N recálculos de matriz por frame, con redondeos distintos.

### 4.2 Rueda vs trackpad: el problema real

Los tres motores dedican código serio a **distinguir una rueda de ratón (eventos discretos, gruesos) de un trackpad (eventos continuos, finos)**, porque exigen respuestas opuestas: la rueda necesita suavizado, el trackpad necesita respuesta inmediata.

**MapLibre** (`src/ui/handler/scroll_zoom.ts:170-210`):

```
deltaMode DOM_DELTA_LINE ⇒ ×40
si  value % 4.000244140625 === 0     ⇒ RUEDA   (la constante mágica, línea 14)
si  |value| < 4                      ⇒ TRACKPAD
ambiguo: si timeDelta > 400 ms ⇒ esperar 40 ms; si sigue solo ⇒ RUEDA
         si repite y |timeDelta·value| < 200 ⇒ TRACKPAD
```

Consumo del delta con **sigmoide** (líneas 292-300):

```
rate  = rueda ? 1/450 : 1/100
scale = 2 / (1 + exp(−|Δ · rate|))        // cap 2× por frame
```

Y sólo en modo rueda, un suavizado de 200 ms con un bezier **regenerado en cada tic** para que la velocidad sea continua entre tics (`_smoothOutEasing`, 372-394).

**OpenLayers** (`interaction/MouseWheelZoom.js`):

```js
// 293-301: el modo se decide UNA VEZ por interacción (o tras 400 ms de silencio)
if (!this.mode_ || now - this.startTime_ > this.trackpadEventGap_) {
  this.mode_ = Math.abs(delta) < 4 ? 'trackpad' : 'wheel';
}
```

Y un detalle valioso: el **pinch de trackpad** llega como `wheel` con `ctrlKey` sintético; se distingue del Ctrl físico con listeners de teclado (193-217) y se multiplica el delta ×3 — con este comentario en el código (línea 49): *"5 = google maps. 3 = apple maps, MapLibre"*.

**Leaflet** (`src/map/handler/ScrollWheelZoomHandler.js`) hace lo más simple y funciona sorprendentemente bien: acumula deltas durante `wheelDebounceTime = 40 ms` y aplica una sigmoide que satura en ±4 niveles:

```js
// líneas 69-73
const d2 = this._delta / (this._map.options.wheelPxPerZoomLevel * 4),      // 60 px = 1 nivel
d3 = 4 * Math.log(2 / (1 + Math.exp(-Math.abs(d2)))) / Math.LN2,
d4 = snap ? Math.ceil(d3 / snap) * snap : d3,                              // ceil: siempre ≥1 escalón
delta = map._limitZoom(zoom + (this._delta > 0 ? d4 : -d4)) - zoom;
```

⭐ **Receta mínima para ti**: normaliza `deltaMode` (LINE ×40, PAGE ×300), clasifica por `|delta| < 4`, acumula, aplica sigmoide con `rate` distinto por modo, ancla al cursor. Y si quieres snap a niveles enteros, usa `ceil` al múltiplo (garantiza que un tic siempre mueva) — no `round`.

### 4.3 Pinch

Álgebra idéntica en los tres:

```
escala = distancia(dedo1, dedo2) / distanciaInicial
zoom   = zoomInicial + log2(escala)
ancla  = punto medio de los dedos (recalculado cada frame)
```

Leaflet lo expresa despejando el centro (`PinchZoomHandler.js:76-93`):

```js
scale = p1.distanceTo(p2) / this._startDist;
this._zoom = map.getScaleZoom(scale, this._startZoom);
const delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
this._center = map.unproject(map.project(this._pinchStartLatLng, this._zoom).subtract(delta), this._zoom);
```

Umbrales de MapLibre para decidir **qué gesto es** cuando hay dos dedos (`two_fingers_touch.ts`):

| Gesto | Umbral de activación |
|---|---|
| Zoom | `\|log2(dist/distInicial)\| ≥ 0.1` |
| Rotación | 25 px de **arco** sobre la circunferencia entre dedos |
| Pitch ("shove") | ambos dedos verticales y en el mismo sentido, ventana de 100 ms, umbral 2 px; `pitchDelta = Δy · (−0.5)°/px` |

⭐ Durante el pinch el zoom es **fraccional y continuo**; el snap a nivel entero (si lo hay) ocurre **al soltar**. Leaflet: `_animateZoom(center, _limitZoom(zoom), true, zoomSnap)`. OpenLayers: `endInteraction(400, direction)` con la dirección del último gesto para elegir hacia dónde snapear.

### 4.4 Inercia: las tres implementaciones, la misma física

**Leaflet** (`DragHandler.js:197-208`) — ventana de **50 ms**:

```js
const direction = this._lastPos.subtract(this._positions[0]),
duration = (this._lastTime - this._times[0]) / 1000,
ease = options.easeLinearity,                             // 0.2
speedVector = direction.multiplyBy(ease / duration),
speed = speedVector.distanceTo([0, 0]),
limitedSpeed = Math.min(options.inertiaMaxSpeed, speed),
decelerationDuration = limitedSpeed / (options.inertiaDeceleration * ease);  // 3400 px/s²
let offset = limitedSpeedVector.multiplyBy(-decelerationDuration / 2).round();
```

Física: `t = v/(a·ease)`, `d = v·t/2` (área del triángulo de deceleración lineal).

**MapLibre** (`handler_inertia.ts`) — buffer de **160 ms**, ventana de velocidad de **60 ms**, y lo calcula **por eje** (pan, zoom, bearing, pitch tienen deceleraciones distintas):

```ts
// calculateEasing, 213-225
const speed = clamp(amount * linearity / (duration/1000), -maxSpeed, maxSpeed);
const duration2 = Math.abs(speed) / (deceleration * linearity);
return {easing, duration: duration2*1000, amount: speed * (duration2/2)};
```

| Eje | linearity | deceleration | maxSpeed |
|---|---|---|---|
| pan | 0.3 | 2500 px/s² | 1400 px/s |
| zoom | 0.3 | 20 | 1400 |
| bearing | 0.3 | 1000 | 360°/s |
| pitch | 0.3 | 1000 | 90°/s |

**OpenLayers** (`Kinetic.js:76-116`) — decaimiento **exponencial**, no lineal:

```js
// sólo los puntos de los últimos delay=100 ms; exige ≥2 puntos y ≥1000/60 ms
this.angle_ = Math.atan2(dy, dx);
this.initialVelocity_ = Math.sqrt(dx*dx + dy*dy) / duration;   // px/ms
return this.initialVelocity_ > this.minVelocity_;              // 0.05 px/ms
// distancia total = (minVelocity − initialVelocity) / decay,  decay = −0.005
//                 = (v0 − 0.05) × 200 px
```

⭐ **Dos detalles que valen más que la fórmula:**

1. **Si el último punto muestreado es más viejo que la ventana, NO hay inercia.** El usuario se paró antes de soltar; lanzarlo sería antinatural. OpenLayers lo comprueba explícitamente.
2. **La inercia se encola como una animación normal de la cámara**, no como un modo especial:
   ```js
   // DragPan.js:155-156
   view.animateInternal({ center: view.getConstrainedCenter(dest), duration: 500, easing: easeOut });
   ```
   Por eso es interrumpible gratis: el siguiente `pointerdown` hace `cancelAnimations()` y ya está. MapLibre hace lo mismo con `easeTo`.

### 4.5 Bordes elásticos: la goma

OpenLayers tiene el mejor sistema de los tres: constraints que se comportan distinto **durante** el gesto y **al soltar**.

```js
// resolutionconstraint.js:48-63 — límites de zoom, logarítmico, sólo si isMoving
result = Math.min(resolution, maxResolution);
const ratio = 50;
result *= Math.log(1 + ratio*Math.max(0, resolution/maxResolution - 1))/ratio + 1;
if (minResolution) { result = Math.max(result, minResolution);
  result /= Math.log(1 + ratio*Math.max(0, minResolution/resolution - 1))/ratio + 1; }
return clamp(result, minResolution/2, maxResolution*2);       // nunca rebasa 2×
```

```js
// centerconstraint.js:57-66 — bordes del mundo, ~30 px de goma
const ratio = 30 * resolution;
x += -ratio*Math.log(1 + Math.max(0, minX - center[0])/ratio)
   +  ratio*Math.log(1 + Math.max(0, center[0] - maxX)/ratio);
```

Al soltar, `endInteraction → resolveConstraints(200ms, easeOut)` evalúa las constraints con `isMoving = false` y **anima de vuelta** si el valor cambió (`View.js:1839-1948`). Ése es el rebote.

Leaflet tiene el equivalente simple con `maxBoundsViscosity` (0 = puedes salir y te devuelve al soltar; 1 = pared sólida) aplicado en el hook `predrag` (`DragHandler.js:93-167`).

⭐ Para un mundo finito de fantasía **necesitas esto**. Un mapa que se para en seco en el borde se siente roto; uno que deja asomarse y devuelve suavemente se siente caro. Son 15 líneas.

---

<a name="5"></a>
## 5 · Animaciones de cámara: easeTo y flyTo

### 5.1 El motor de animación

MapLibre (`camera.ts:1218-1248`): guarda `{frame, finish, options}`, y cada rAF calcula `t = min((now−start)/duration, 1)`, llama a `frame(easing(t))` y reencola. `duration = 0` ⇒ síncrono. Easing por defecto: `bezier(0.25, 0.1, 0.25, 1)`.

OpenLayers va más lejos y tiene **keyframes encadenados** (`View.js:596-716`): cada objeto de opciones se convierte en una `Animation` cuyo `start` es el `start + duration` de la anterior, y cuyo source es el **target** de la anterior — no el estado renderizado. Eso permite encolar `animate({center: A}, {zoom: 5}, {rotation: 0})` sin saltos. Y en `progress === 1` asigna el target exacto (sin drift acumulado).

### 5.2 easeTo y el problema del "pan que se dispara"

Interpolar centro y zoom linealmente produce un movimiento feo: al acercarse, el mundo se agranda y el mismo desplazamiento en coordenadas de mundo se convierte en un desplazamiento enorme en pantalla. MapLibre lo compensa (`mercator_camera_helper.ts:102-131`):

```ts
const scale = zoomScale(tr.zoom - startZoom);
const base = endZoom > startZoom ? Math.min(2, finalScale) : Math.max(0.5, finalScale);
const speedup = Math.pow(base, 1 - k);                     // ← la corrección
const newCenter = unproject(from.add(delta.mult(k * speedup)).mult(scale));
tr.setLocationAtPoint(newCenter, pointAtOffset);
```

⭐ El `speedup` hace que la **velocidad aparente en pantalla** sea aproximadamente constante. Es la diferencia entre "se mueve" y "se mueve bien".

### 5.3 flyTo: van Wijk & Nuij al completo

El paper "Smooth and efficient zooming and panning" (InfoVis 2003) demuestra que, si mides el coste perceptual del movimiento (flujo óptico), la trayectoria óptima entre dos vistas **no es la línea recta**: es alejarse, desplazarse y volver a acercarse. Los tres motores del mundo lo implementan igual porque hay solución cerrada.

**Implementación de Leaflet** (`Map.js:373-449`), que es la más legible:

```js
// w0 = ancho visible inicial en px; w1 = ancho final expresado en escala inicial;
// u1 = distancia entre centros proyectados; rho = 1.42
function r(i) {
    const s1 = i ? -1 : 1, s2 = i ? w1 : w0,
    t1 = w1 * w1 - w0 * w0 + s1 * rho2 * rho2 * u1 * u1,
    b1 = 2 * s2 * rho2 * u1, b = t1 / b1,
    sq = Math.sqrt(b * b + 1) - b;
    return sq < 0.000000015 ? -18 : Math.log(sq);      // guard anti −Infinity
}
const r0 = r(0);
function w(s) { return w0 * (cosh(r0) / cosh(r0 + rho * s)); }
function u(s) { return w0 * (cosh(r0) * tanh(r0 + rho * s) - sinh(r0)) / rho2; }
const S = (r(1) - r0) / rho;
const duration = options.duration ? 1000*options.duration : 1000 * S * 0.8;
// por frame: s = easeOut(t)·S con easeOut(t) = 1 − (1−t)^1.5
//   centro = from + (to−from)·u(s)/u1
//   zoom   = getScaleZoom(w0 / w(s), startZoom)
```

MapLibre añade tres refinamientos (`camera.ts:1016-1187`):

- `rho = Math.min(rho, Math.sqrt(wMax / u1 * 2))` — limita el zoom-out para no rebasar `minZoom`.
- **Casos degenerados** explícitos: si `|u1| < 2e-6` o `S` no es finito, delega en `easeTo` (mismo centro) o hace zoom puro `w(s) = e^{±ρs}`.
- `speed = 1.2` y `maxDuration`: si la duración calculada lo supera, `duration = 0` (salto instantáneo). Ojo, **no lo recorta** — salta.

Referencia externa: `d3.interpolateZoom` usa `ρ = √2 ≈ 1.414` y `duration = S · 1000 · ρ / √2`. El experimento con usuarios del paper dio el óptimo en ρ ≈ 1.42, que es lo que usan Leaflet y MapLibre.

⭐ Para tu app esto es puro regalo: son 25 líneas, no dependen de nada, y convierten "ir a la ciudad de Valdoria" en un movimiento cinematográfico en vez de un teletransporte. Funciona idéntico en un mundo plano (w = ancho visible en unidades de mundo, u = distancia entre centros).

---

<a name="6"></a>
## 6 · El bucle: render bajo demanda

**Ninguno de los tres tiene un requestAnimationFrame permanente.** Es la decisión de arquitectura que más batería y más CPU ahorra, y la más fácil de estropear.

### 6.1 MapLibre: flags sucios + `idle`

```ts
// src/ui/map.ts:4341-4351, al final de _render()
const somethingDirty = this._sourcesDirty || this._styleDirty || this._placementDirty;
if (somethingDirty || this._repaint) { this.triggerRepaint(); }
else if (!this.isMoving() && this.loaded()) { this.fire('idle'); }   // el mapa se DUERME
```

`triggerRepaint()` (4434-4453) sólo programa un rAF si no hay ninguno pendiente. Todo converge en `_update()` (4204-4212: `_styleDirty ||= updateStyle; _sourcesDirty = true; triggerRepaint()`).

**Qué despierta al mapa:**

| Evento | Camino |
|---|---|
| Llega una tesela / cambian datos | `map.on('data', e => this._update(e.dataType === 'style'))` |
| Gesto | `HandlerManager._requestFrame` → `triggerRepaint` + tarea en `_renderTaskQueue` |
| Animación de cámara | `_requestRenderFrame(cb)` = `_update()` + encolar cb |
| Cambio de estilo, resize | `_update(true)` |

**Qué lo mantiene despierto:** transiciones de paint (`style.hasTransitions()`), fades raster (`hasRasterTransition` comprueba `fadeEndTime >= now`), placement de símbolos pendiente, teselas en fade.

### 6.2 OpenLayers: el mismo patrón, más explícito

`Map.render()` agenda **un** rAF (`animationDelayKey_`). Lo disparan cambios de view, cargas de teselas, etc. Y al final de `renderFrame_` (1748-1751): si `frameState.animate` quedó `true` (fades, teselas stale, declutter pendiente), se reagenda solo.

Detalle fino: `handlePostRender` (que procesa la cola de teselas y expira la caché) se difiere con `setTimeout(0)` **para no competir con el frame**.

### 6.3 Leaflet: eventos puros

Sin bucle. rAF sólo mientras algo se anima: `PosAnimation._animate` (pan/inercia), el frame-loop de `flyTo`, el fade de teselas `_updateOpacity` (auto-encadenado mientras alguna tesela tenga `fade < 1`). El zoom animado ni siquiera usa rAF: lo interpola el **compositor CSS** y JS espera un `transitionend` (con `setTimeout(250)` de respaldo).

⭐ **Para tu app**: si tu HUD muestra `0/60 fps` cuando la cámara está quieta, eso **es correcto** — significa que el bucle duerme. El bug que hay que vigilar es el contrario: quedarse dormido cuando aún faltaba trabajo. La lección #44 de tu memoria (`una ola entera de nulos con cámara quieta era un 0/60 CONGELADO — null borra lastAsk pero sólo re-pide quien dibuja, y sólo dibuja onArrive`) es exactamente ese fallo, y la cura que aplicaste (`nudge` de 400 ms) es el equivalente de `frameState.animate = true`. La forma canónica de blindarlo: **toda condición que deje trabajo pendiente debe marcar un flag sucio, y el único sitio que decide dormir es el final del render**, comprobando todos los flags.

---

<a name="7"></a>
## 7 · Ciclo de vida de la tesela: cobertura, cola, prioridad

Aquí está el corazón de un mapa. Cinco preguntas, en orden:
**¿qué teselas quiero? → ¿en qué orden las pido? → ¿cuántas a la vez? → ¿qué enseño mientras? → ¿qué tiro?**

### 7.1 ¿Qué nivel? El redondeo del zoom fraccional

| Motor | Regla | Cita |
|---|---|---|
| Leaflet | `tileZoom = Math.round(zoom)`, luego clamp a `[minNativeZoom, maxNativeZoom]` | `GridLayer.js:547`, `_clampZoom` 532-544 |
| MapLibre | `z = (roundZoom ? round : floor)(zoom + log2(transform.tileSize / source.tileSize))` | `covering_tiles.ts:163-169` |
| OpenLayers | `getZForResolution(resolution, zDirection)` con política configurable | `TileGrid.js:652-659` |

El término `log2(transformTileSize / sourceTileSize)` de MapLibre es importante: con teselas de 512 px el transform trabaja en 512 y una fuente de 256 carga a **z+1**. Es el mismo mecanismo que el `zoomOffset` de Leaflet para retina (`detectRetina`: `tileSize /= 2, zoomOffset++, maxZoom−1`).

⭐ **La política de OpenLayers merece copiarse** porque es la única de las tres que te deja elegir (`array.js:86-141`):

```
zDirection =  0  →  nivel más cercano (empate: el más fino)
zDirection =  1  →  último nivel con resolución ≥ la de la vista ⇒ teselas AMPLIADAS
                    (menos teselas, algo borroso; ideal en móvil o durante gestos)
zDirection = -1  →  primer nivel con resolución ≤ la de la vista ⇒ teselas REDUCIDAS
                    (más nítido, hasta 4× más teselas)
zDirection = fn  →  umbral propio; el docstring propone el punto medio geométrico:
                    value − low · sqrt(high/low)
```

Con `round` (Leaflet) el cambio de nivel ocurre en `.5`, es decir, escalas de tesela en `[√2/2, √2]` = entre 71 % y 141 %. Con `floor` (MapLibre vector) las teselas se escalan siempre entre 100 % y 200 % — nunca se reducen, lo que evita el aliasing de minificación pero pide más teselas.

### 7.2 ¿Qué teselas? De rectángulo a quadtree

**Leaflet, la versión 2D pura** (`GridLayer.js:888-893`):

```js
_pxBoundsToTileRange(bounds) {
    const tileSize = this.getTileSize();
    return new Bounds(
        bounds.min.unscaleBy(tileSize).floor(),
        bounds.max.unscaleBy(tileSize).ceil().subtract([1, 1]));
}
```

Y los `pixelBounds` se calculan **en píxeles del tileZoom**, no del zoom real: `halfSize = size/(scale·2)` con `scale = getZoomScale(mapZoom, tileZoom)` (`_getTiledPixelBounds`, 625-633). Durante una animación usa `max(_animateToZoom, zoom)` para **precargar el destino**.

**MapLibre, la versión general** (`covering_tiles.ts:217-326`) — descenso de quadtree con pila explícita:

```
raíces: z0 (con wraps −3..+3 si renderWorldCopies)
por nodo:
  AABB de la tesela vs frustum:
     None → podar
     Full → los hijos heredan fullyVisible y se SALTAN el test    ← optimización clave
  zoom deseado para ESTE nodo (sólo si hay terreno o pitch > umbral):
     thisTileDesiredZ = zoomCentro
        + scaleZoom(distanciaCentro3D / distanciaTesela3D / max(0.5, cos(fov/2)))
        + pitchTileLoadingBehavior · scaleZoom(cos(pitchTesela)) / 2
        − scaleZoom(max(1, tileCount / tileCountPitch0 / 3.0)) / 2
  si it.zoom >= z → EMITIR (guardando distanceSq al centro de PANTALLA)
  si no           → apilar los 4 hijos
al final: result.sort((a,b) => a.distanceSq − b.distanceSq)
```

⭐ En 2D sin pitch todo el bloque de "zoom variable" se desactiva (`allowVariableZoom` sólo con terreno o pitch alto) y el test de frustum degenera en intersección de rectángulos — pero **la estructura de quadtree con pila y `fullyVisible` heredado sigue siendo mejor que el doble bucle**, porque te da culling jerárquico gratis y es la misma función que necesitarás el día del 3D.

**El margen**: Leaflet expande el rango en `keepBuffer = 2` filas/columnas, pero **no pide** las del buffer — sólo **retiene** las que ya existen (`GridLayer.js:648-650`). Es una zona de amortiguación contra el pan, no un prefetch.

### 7.3 ¿En qué orden? La función de prioridad

**Leaflet** — una línea, y es la correcta:

```js
// src/layer/tile/GridLayer.js:686-687
// sort tile queue to load tiles in order of their distance to center
queue.sort((a, b) => a.distanceTo(tileCenter) - b.distanceTo(tileCenter));
```

**MapLibre** — el sort de `coveringTiles` por `distanceSq` al centro de pantalla (`covering_tiles.ts:325`), y el orden de petición **es** el orden del array.

**OpenLayers** — la más elaborada, un heap con función de prioridad explícita (`TileQueue.js:141-169`):

```js
if (!frameState || !(tileSourceKey in frameState.wantedTiles)) return DROP;
if (!frameState.wantedTiles[tileSourceKey][tile.getKey()]) return DROP;   // ya no se quiere → FUERA
const deltaX = tileCenter[0] - center[0], deltaY = tileCenter[1] - center[1];
return 65536 * Math.log(tileResolution)
     + Math.sqrt(deltaX*deltaX + deltaY*deltaY) / tileResolution;
```

Léelo así: **el primer término separa por bandas de nivel** (resolución menor = más fino = antes), el segundo ordena **dentro** de la banda por distancia al centro **en píxeles**. El 65536 está elegido para que las bandas no se solapen hasta ~45.426 px del foco (lo dice el comentario del código).

Y `DROP = Infinity` no es un valor grande: `PriorityQueue.reprioritize()` **elimina** del heap las entradas con esa prioridad y re-heapifica (`structs/PriorityQueue.js:242-262`). Cada frame se reescribe `frameState.wantedTiles`, así que **la cola se re-prioriza y se limpia con la cámara**.

⭐ **Ésta es exactamente la lección #44 de tu memoria** ("una cola sin prioridad castiga lo que el lector mira"), y tu solución de olas es una variante razonable. La diferencia entre tu escalafón por olas y el modelo de OpenLayers: tú ordenas por *cuándo se pidió* (ola) y dentro por distancia; OpenLayers ordena por *nivel* y dentro por distancia, y **recalcula la prioridad de todo el heap cada frame** en vez de conservar el orden de inserción. El modelo de OpenLayers es más robusto ante un pan largo (una tesela pedida hace 3 olas pero que ahora está en el centro sube sola); el tuyo es más barato. Si alguna vez el escalafón por olas se te queda corto, la evolución natural es: **una sola cola, prioridad recalculada por frame, y `DROP` para lo que salió del viewport**.

### 7.4 ¿Cuántas a la vez? Los límites reales

| Motor | Límite | Cita |
|---|---|---|
| **OpenLayers** quieto | 16 en vuelo, 16 nuevas/frame | `Map.js:145, 295-296` |
| **OpenLayers** en movimiento | **8 en vuelo, 2 nuevas por frame** | `Map.js:1293-1297` |
| **OpenLayers** frame pasado de presupuesto | **0 y 0** | idem |
| **MapLibre** (sólo imágenes) | 16 globales, **8 mientras `map.isMoving()`** | `config.ts:24-25`, `map.ts:798` |
| **Cesium** (3D) | 50 globales, 18 por servidor | `RequestScheduler.js` |
| **renderd** (servidor) | cola de render 64, colas de petición 256, dirty 8000, 4 hilos | `render_config.h` |

El código de OpenLayers, que es el más explícito:

```js
// Map.js:1293-1297
let maxTotalLoading = this.maxTilesLoading_;   // 16
let maxNewLoads = maxTotalLoading;
if (animatingOrInteracting) {
  const lowOnFrameBudget = Date.now() - frameState.time > 8;   // ms
  maxTotalLoading = lowOnFrameBudget ? 0 : 8;
  maxNewLoads   = lowOnFrameBudget ? 0 : 2;
}
```

⭐ **Regla de oro**: quieto = agresivo; en movimiento = conservador; frame que ya se pasó de 8 ms = **no lances nada**. Es exactamente la política que quieres para un pool de workers que compite con el hilo de dibujo.

### 7.5 ¿Qué tiro? Caché LRU dimensionada por viewport

**MapLibre** (`tile_manager.ts:455-466`):

```ts
const widthInTiles  = Math.ceil(transform.width  / this._source.tileSize) + 1;
const heightInTiles = Math.ceil(transform.height / this._source.tileSize) + 1;
const approxTilesInView = widthInTiles * heightInTiles;
const viewDependentMaxSize = Math.floor(approxTilesInView * 5);   // MAX_TILE_CACHE_ZOOM_LEVELS
const maxSize = min(this._maxTileCacheSize ?? ∞, viewDependentMaxSize);
```

Es decir: **una pantalla de teselas × 5 niveles de zoom**. En una ventana de 1600×900 con teselas de 512: `(4+1)·(2+1)·5 = 75` teselas. Nada de números mágicos absolutos.

Dos estructuras separadas: `_inViewTiles` (mapa fuerte, lo que se está usando) y `_outOfViewCache` (el LRU). Cuando una tesela deja de retenerse pasa del primero al segundo; cuando vuelve a hacer falta, `getAndRemove` la resucita (resetea fades, re-arma el timer de expiración, reasigna wrap) antes de crear una nueva.

Curiosidad honesta del propio código: `TileCache` es **FIFO por inserción**, no LRU con touch-on-get — *"addition is the only operation that counts as usage"* (`tile_cache.ts:10-13`). Y la clave se guarda **con wrap = 0** para reusar la misma tesela entre copias del mundo.

**OpenLayers**: LRU real (lista doblemente enlazada + hash) con `highWaterMark = 512` por renderer, agrandado dinámicamente a `2 × nº de teselas deseadas` (`renderer/canvas/TileLayer.js:940-945`). Y el detalle valioso: **`expireCache()` sólo corre como postRenderFunction cuando el frame quedó completo** (915-930) — nunca expulsa mientras aún faltan teselas por llegar.

### 7.6 Cancelación: qué pasa con lo que está en vuelo

| Motor | Mecanismo |
|---|---|
| Leaflet | `tile.setAttribute('src','')` — el navegador **aborta** la petición; se anulan `onload/onerror` con `falseFn` y se emite `tileabort` (`TileLayer.js:250-273`) |
| MapLibre | `AbortController.abort()` en la fuente + `MessageType.abortTile` al worker; el `catch` ve `tile.aborted` y deja estado `'unloaded'` sin error |
| OpenLayers | La tesela vuelve a `IDLE` y la prioridad `DROP` la saca del heap |
| renderd | Lo que ya está renderizando **se termina** (lo empezado ya está pagado); lo que está en cola se descarta |

⭐ La política de renderd —**cancelar en cola = descartar; cancelar en vuelo = aterrizar, entregar y guardar**— es la que ya tienes implementada en `tileService.ts` según tu memoria, y es la correcta. Un render a medio hacer que se tira es trabajo puro perdido; guardarlo convierte un movimiento errático del usuario en caché caliente.

---

<a name="8"></a>
## 8 · Cómo no parpadear nunca

La sección más importante para la calidad percibida. Hay **cuatro** mecanismos distintos y complementarios; los motores serios implementan los cuatro.

### 8.1 Mecanismo 1: sustitutos por jerarquía (padres e hijos ya cargados)

Cuando la tesela ideal aún no está, se busca **quién puede tapar ese hueco** entre lo que ya hay en memoria.

**Leaflet** (`GridLayer.js:431-437`):

```js
for (const tile of Object.values(this._tiles)) {
    if (tile.current && !tile.active) {
        const coords = tile.coords;
        if (!this._retainParent(coords.x, coords.y, coords.z, coords.z - 5)) {
            this._retainChildren(coords.x, coords.y, coords.z, coords.z + 2);
        }
    }
}
```

Profundidades exactas: **ancestros hasta z−5**, y si no hay ninguno activo, **descendientes hasta z+2**. Primero el padre (uno solo tapa todo el hueco, aunque borroso); si no hay, los hijos (hasta 16 teselas para cubrir, pero nítidos).

**MapLibre** (`tile_manager.ts:639-689`), con más matices:

```
1. cada ideal se retiene y se pide
2. las que no tienen datos: buscar HIJOS cargados hasta idealZ + 3 (maxOverzooming),
   quedándose con la generación más alta y comprobando cobertura completa (4^n hijos)
3. las que siguen incompletas: subir por PADRES desde z−1 hasta max(z − 10, minzoom)
   (maxUnderzooming); el primero con datos gana y corta (break)
4. rutas ya visitadas se marcan para no repetirlas
5. si cancelPendingTileRequestsWhileZooming (default true), un padre EN VUELO
   no solicitado previamente NO se retiene → su petición se aborta
```

⭐ Números para copiar: **hijos hasta +3, padres hasta −10**. La asimetría tiene sentido: un padre 10 niveles arriba se ve borrosísimo pero **existe casi seguro** (los niveles bajos siempre están en caché) y es 1 sola tesela; un hijo 4 niveles abajo requeriría 256 teselas para cubrir el hueco.

### 8.2 Mecanismo 2: sustitutos por versión (la misma tesela, contenido anterior)

Éste es distinto y **es el que tu app necesita más**, porque tu contenido cambia (ediciones, pinceladas, regeneración) mientras la geografía z/x/y no.

**OpenLayers** lo llamaba históricamente *interim tiles*. ⚠️ **Aviso de versión**: `Tile.getInterimTile`/`interimTile` **ya no existen** en el commit actual (se eliminaron con la reforma de caché de v10). El reemplazo funcional, con el mismo objetivo, son las **stale keys** (`renderer/Layer.js:40-83` + `renderer/canvas/TileLayer.js:518-540`):

```
1. la clave de caché de una tesela incluye la "key" del source (versión del contenido)
2. cuando esa key cambia, la anterior se guarda en staleKeys_ (hasta cacheSize·0.5)
3. las teselas viejas siguen en la LRU bajo su clave antigua
4. findStaleTile_(tileCoord): busca en caché la misma z/x/y con alguna key vieja LOADED
5. si la encuentra: se pinta ESA, y frameState.animate = true
```

```js
// renderer/canvas/TileLayer.js:728-734
const hasStaleTile = this.findStaleTile_(tileCoord, tilesByZ);
if (hasStaleTile) { removeTileFromLookup(tilesByZ, tile, z); frameState.animate = true; continue; }
```

⭐ **Traducción directa a tu arquitectura**: tu clave de contenido en `renderedTiles` (versiones + semilla + dims + params + humanos + ediciones relevantes) **ya es** la "source key" de OpenLayers. Lo que te falta —si es que falta— es el paso 4: cuando una tesela con la clave de contenido nueva aún no está, **buscar en Dexie/memoria la misma z/x/y con una clave de contenido ANTERIOR y pintarla mientras**. Es el equivalente exacto de "servir lo viejo" de mod_tile (§14.3), y elimina el parpadeo tras cada pincelada sin tocar el resto del pipeline.

El orden de preferencia que usa OpenLayers, y que deberías copiar, es:

```
1. tesela ideal, versión actual        (lo que quieres)
2. tesela ideal, versión ANTERIOR      (stale)      ← contenido correcto en geometría, algo viejo
3. HIJOS cargados de z+1               (nítidos, pueden no cubrir)
4. PADRES cargados z−1 … minZoom       (borrosos, cubren siempre)
5. nada (fondo)                        ← esto no debería verse nunca
```

### 8.3 Mecanismo 3: cross-fade (fundir, no sustituir)

Aunque tengas el sustituto correcto, el cambio de golpe se ve. Los tres funden.

**Leaflet** — fade por tesela en JS (`GridLayer.js:314-347`):

```js
fade = Math.min(1, (now − tile.loaded) / 200);      // 200 ms
```
Con un detalle importante: la tesela sólo se marca `active` (y por tanto sólo se considera sustituible y podable) **cuando el fade llega a 1**. Poda diferida 250 ms después del `load` completo.

**MapLibre raster** — la receta más elaborada (`tile_manager_raster.ts` + `draw_raster.ts`). Cada tesela se dibuja con **dos texturas**: la propia y la del padre/hijo compañero, con las UV reescaladas:

```ts
// draw_raster.ts:170-174
const parentScaleBy  = 2^(parentZ − tileZ);
const parentTopLeft  = [(x·parentScaleBy) % 1, (y·parentScaleBy) % 1];
// → uniforms u_scale_parent, u_tl_parent
```

Y las opacidades por reloj (192-211):

```ts
const timeSinceTile   = (now − tile.timeAdded)       / fadeDuration;   // 300 ms
const timeSinceParent = (now − parentTile.timeAdded) / fadeDuration;
const opacity1 = clamp(timeSinceTile, 0, 1);
const opacity2 = clamp(1 − timeSinceParent, 0, 1);
const tileOpacity = doFadeIn ? opacity1 : opacity2;
// shader: color = mix(color0, color1, u_fade_t)
```

La planificación decide los roles según el movimiento: al **acercar**, la ideal entra y el ancestro (hasta 5 niveles arriba) sale; al **alejar**, los hijos salen y la ideal entra; al hacer **pan lateral**, las ideales de borde hacen self-fade-in.

**OpenLayers en Canvas 2D** — la versión que te sirve tal cual (`renderer/canvas/TileLayer.js:798-900, 1033-1037`): alpha de transición 250 ms con `easeIn` por tesela (`Tile.js:203-221`), `globalAlpha = opacidadCapa × alphaTransición`, y **las teselas en fade se pintan en una segunda pasada encima del fallback ya completo** — así el fundido se lee como "enfoque progresivo" y nunca destapa el fondo gris.

⭐ En Canvas 2D el equivalente del blend de dos texturas de MapLibre es trivial: dibuja primero el sustituto (padre recortado, o versión vieja) a `globalAlpha = 1`, y encima la nueva a `globalAlpha = t`. Nunca al revés, nunca borrando primero.

### 8.4 Mecanismo 4: no dibujar dos veces (recorte por cobertura)

Si tienes padre e hijos en pantalla a la vez, hay que decidir quién manda en cada píxel — si no, el borde del padre se ve por debajo o el alpha se dobla.

**MapLibre** usa el **stencil buffer**: asigna un ID único por tesela visible, pinta la máscara, y luego dibuja con `EQUAL` contra el ID propio (`painter.ts:300-360, 407-410`). Las teselas llegan en orden z ascendente, así que un hijo sobrescribe el ID del padre en su zona. Para raster hay una variante sin pasada de máscara: ordenar por z descendente, `GEQUAL` + `REPLACE` — los hijos pintan primero y escriben su ID, el padre falla el test donde ya pintó un hijo.

**OpenLayers, en Canvas 2D** — la solución sin GPU, y por tanto la tuya (`TileLayer.js:795-900`):

```
1. niveles ordenados ascendentemente; el bucle va del más FINO al más grueso
2. cada tesela pintada acumula su rectángulo en clips[] / clipZs[]
3. una tesela de nivel más grueso (fallback) sólo pinta las regiones NO cubiertas:
   subtractExtents(rectActual, cubierto) → se dibuja en sub-rectángulos
4. drawTile con clipRects recorta también el rectángulo FUENTE proporcionalmente
```

⭐ Traducción a tu Canvas: pinta primero la generación más fina, lleva una lista de rectángulos cubiertos, y para cada fallback dibuja sólo la diferencia (o usa `ctx.save(); ctx.beginPath(); ctx.rect(...); ctx.clip()` con la región complementaria). Sin esto, el fallback borroso se ve asomar por las juntas.

---

<a name="9"></a>
## 9 · Nitidez: DPR, snapping, overzoom

Este apartado es directamente el problema que tienes abierto ("Luis no ha confirmado nitidez aún").

### 9.1 devicePixelRatio: dónde entra y dónde NO

Regla de los tres motores: **el DPR vive en el framebuffer, no en el transform.**

```ts
// MapLibre, map.ts:4066-4070 y painter.ts:188-191
canvas.width = Math.floor(pixelRatio * width);    // píxeles físicos
canvas.style.width = width + 'px';                // píxeles CSS
// el transform sigue trabajando en px LÓGICOS
```

Con salvaguarda: si `pixelRatio · dimensión` excede `gl.MAX_RENDERBUFFER_SIZE`, se clampa (`_getClampedPixelRatio`, 1605-1640).

OpenLayers hace lo mismo: el canvas de cada capa mide `round(getWidth(extent)/resolution · pixelRatio)` y compone con `1/pixelRatio` en el `pixelTransform` (`renderer/canvas/Layer.js:293-339`).

Y en Leaflet el equivalente para teselas es `detectRetina`: pedir teselas del zoom **z+1** a media talla (`TileLayer.js:113-125`).

⭐ **Las tres formas de conseguir nitidez con DPR alto, y sus costes:**

| Estrategia | Coste | Cuándo |
|---|---|---|
| Framebuffer ×DPR, teselas 1× | ×DPR² píxeles a componer, misma red/CPU de teselas | Vectorial (se re-rasteriza nítido) |
| Teselas @2x (mismo z, doble resolución) | ×4 bytes por tesela | Raster, la solución de Mapbox/Google (`{ratio}` → `@2x`) |
| Teselas de z+1 a media talla | ×4 teselas | Leaflet retina; barato de implementar, caro en peticiones |

Si tus teselas las renderizas tú, la opción 2 es la buena: **renderiza el metatile a `tileSize · dpr` píxeles** y píntalo a `tileSize` CSS. La 3 duplica el número de encargos, que es justo lo que tu cola no necesita.

### 9.2 ⭐ El snap a píxel: la joya escondida

MapLibre tiene una matriz específica **sólo para raster estático** (`mercator_transform.ts:688-700`):

```ts
const xShift = (width % 2) / 2, yShift = (height % 2) / 2,
    angleCos = Math.cos(bearing), angleSin = Math.sin(-bearing),
    dx = x - Math.round(x) + angleCos * xShift + angleSin * yShift,
    dy = y - Math.round(y) + angleCos * yShift + angleSin * xShift;
mat4.translate(alignedM, alignedM, [dx > 0.5 ? dx - 1 : dx, dy > 0.5 ? dy - 1 : dy, 0]);
```

Redondea la traslación del mundo al píxel entero, compensa viewports de dimensión impar con medio píxel, y **rota el desplazamiento por el bearing** para que 0/90/180/270° queden nítidos. Y se usa **sólo cuando `!painter.options.moving`** (`draw_raster.ts:101`): en movimiento importa más la exactitud subpíxel que el snap.

**OpenLayers, en Canvas 2D**, resuelve el mismo problema y además el de las **costuras** (`TileLayer.js:838-845`):

```js
const nextX = Math.round(origin[0] - (xIndex - 1) * dx);
const x     = Math.round(origin[0] - xIndex * dx);
const w = nextX - x;                                    // ← el ancho es la DIFERENCIA de redondeos
```

⭐ **Esto es oro puro para ti.** Si redondeas posición y tamaño por separado, aparecen líneas de 1 px entre teselas (o solapes). Definiendo el ancho como la **diferencia entre dos posiciones redondeadas consecutivas**, las teselas comparten el borde exacto por construcción, aunque `dx` sea fraccional. Es la solución al artefacto de "rejilla visible" que sufre todo mapa Canvas 2D casero.

Además: `ctx.imageSmoothingEnabled = false` cuando la fuente no interpola (`TileLayer.js:789-791`).

### 9.3 Overzoom: escalar en vez de pedir

Cuando el zoom supera el máximo nivel disponible, se escala:

- **Leaflet**: `_clampZoom` limita a `maxNativeZoom` y el escalado lo hace la fórmula CSS de niveles (`scale = 2^(zoom − tileZoom)`).
- **MapLibre**: el `OverscaledTileID` (`overscaledZ` > `canonical.z`) es una identidad distinta para la misma URL. Con `reparseOverscaled: true` el worker **re-parsea la geometría con el zoom real**, así los anchos de línea y los tamaños de texto son los correctos del zoom de cámara aunque la geometría venga del padre.
- **OpenLayers**: `canvasScale = (tileResolution / viewResolution) · pixelRatio / tilePixelRatio` aplicado como parámetros de `drawImage`.

⭐ Distinción que conviene tener clara en tu arquitectura: **overzoom de píxeles** (escalar un bitmap, se ve borroso) vs **overzoom de contenido** (re-renderizar el mismo trozo de mundo a más resolución, se ve nítido). Tus teselas las generas tú, así que puedes hacer lo segundo hasta donde quieras — el límite no es el dato, es el coste. Un `maxNativeZoom` explícito y un escalado limpio por encima es una decisión de producto perfectamente legítima (y lo que hace todo el mundo).

### 9.4 Lista de comprobación de nitidez

Si una tesela se ve borrosa, la causa está en esta lista, en este orden:

1. **El bitmap se generó a 1× y se pinta en un canvas ×DPR.** → renderiza a `tileSize · dpr`.
2. **`drawImage` con escala no entera y `imageSmoothingEnabled = true`.** → snap (§9.2) o desactivar el suavizado.
3. **Posición fraccional del canvas o del contenedor CSS** (un `translate3d(0.5px, ...)` en cualquier ancestro arruina toda la capa). → redondear la posición del pane cuando la cámara está quieta.
4. **Se está mostrando un padre escalado y no la tesela ideal** (§8.1): es correcto pero temporal — si persiste, la tesela ideal nunca llegó (mira la cola).
5. **El nivel elegido es más grueso que la vista** (`zDirection = 1`). → cambiar a `0` o `-1`.
6. **Doble resampleo**: se rasteriza a un tamaño, se guarda en WebP con pérdida, y se reescala al pintar. → guarda al tamaño exacto de presentación, y en tu caso vigila el `q0.95` del WebP: para líneas finas y texto, el 5 % que se tira son justo los bordes.

---

<a name="10"></a>
## 10 · Raster vs vector, y el modelo de datos por tesela

### 10.1 La historia, porque explica el presente

| Fecha | Hito | Fuente |
|---|---|---|
| 2005 | Google Maps: rejilla de `<img>` movida con DOM, URLs fijas `mt.google.com/mt?v=.1&x=&y=&zoom=`, satélite con quadtree de letras `t/q/r/s` (herencia Keyhole) | [REPORTADO] Joel Webber, "Mapping Google" |
| dic 2010 | Google Maps 5 Android: teselas **vectoriales** + caché offline proactiva. Cifras oficiales: **"100 veces menos datos"** para todos los niveles de zoom, **"~70 % menos de datos de red"** en total | [CONFIRMADO] blog Google Mobile |
| oct 2011 | MapsGL en escritorio (WebGL, opt-in) | [CONFIRMADO] Google Lat Long |
| may 2013 | "El nuevo Google Maps" en I/O: *"Every click draws a new map"* | [CONFIRMADO] blog oficial |
| jun 2022 | WebGL vector maps GA en el JS API: tilt, heading, `isFractionalZoomEnabled` | [CONFIRMADO] blog Maps Platform |

Lo que gana el cliente vectorial, según la propia gente de Google (Antin Harasymiv, Google Design): zoom "smooth & snap" en vez de "scale & snap"; **etiquetas nítidas e independientes de la tesela** (no se estiran ni se duplican); rotación; tilt; restyle por usuario; zoom continuo.

⭐ **Nota importante para tu caso**: tu app es un híbrido. El *contenido* es vectorial (lo generas), pero el *transporte* es raster (rasterizas a tesela y guardas WebP). Eso es exactamente el modelo de OSM/renderd, y es una decisión perfectamente defendible: te da control artístico total (tu render no está limitado por lo que un shader puede expresar) a cambio de perder el restyle instantáneo y la nitidez infinita. Google eligió lo contrario porque su render *debe* ser un estilo configurable por cliente. **Tú no tienes ese requisito** — tienes el requisito opuesto: parecerte a Campaign Cartographer, que es un estilo pictórico difícil de expresar en un shader.

### 10.2 La spec MVT, por si algún día transportas vectorial

Aunque no la uses tal cual, su codificación es un modelo excelente [CONFIRMADO — vector-tile-spec 2.1]:

```
Protobuf. Tile → Layers. Cada Layer: name, extent (4096 por convención),
features, y tablas keys/values DEDUPLICADAS (los atributos son pares de índices).

Geometría = secuencia de enteros:
  CommandInteger: id = cmd & 0x7 ; count = cmd >> 3
    MoveTo = 1 (2 params), LineTo = 2 (2 params), ClosePath = 7 (0 params)
  ParameterInteger (zigzag): encode = (v << 1) ^ (v >> 31)
                             decode = (p >> 1) ^ (−(p & 1))
  Los parámetros son DELTAS respecto al cursor.

Ejemplo oficial: punto (25,17) → [9, 50, 34]
  9 = MoveTo count 1 → (1<<3)|1 ; 50 = zigzag(25) ; 34 = zigzag(17)

Winding: anillo exterior = área POSITIVA (shoelace, y hacia abajo → horario);
         anillo interior (agujero) = área negativa; ClosePath cierra cada anillo.
```

Tres ideas transferibles aunque guardes raster: **deltas + zigzag + varint** para cualquier serialización de geometría propia (típicamente 3-5× más compacto que floats), **deduplicación de claves/valores** por tesela, y **extent entero** en vez de floats.

### 10.3 ⭐ EXTENT y la eliminación del jitter

MapLibre documenta el porqué de su número en el propio fichero (`src/data/extent.ts:1-13`):

```
/* Vertex buffer store positions as signed 16 bit integers.
 * One bit is lost for signedness to support tile buffers.
 * One bit is lost because the line vertex buffer used to pack 1 bit of other data into the int.
 * One bit is lost to support features extending past the extent on the right edge of the tile.
 * This leaves us with 2^13 = 8192 */
export const EXTENT = 8192;
```

Y ésta es la idea que más rendimiento y más precisión da por línea de código:

```
geometría  = enteros pequeños relativos a SU tesela  (0..8192, exactos en float32)
posición   = una MATRIZ por tesela, calculada en float64 y bajada a float32 una sola vez
```

```ts
// src/geo/projection/mercator_utils.ts:76-86
const scale = worldSize / zoomScale(canonical.z);
const unwrappedX = canonical.x + Math.pow(2, canonical.z) * unwrappedTileID.wrap;
mat4.translate(worldMatrix, worldMatrix, [unwrappedX * scale, canonical.y * scale, 0]);
mat4.scale(worldMatrix, worldMatrix, [scale / EXTENT, scale / EXTENT, 1]);
```

**Por qué importa**: a zoom 22 la coordenada mundial de un vértice necesita ~25 bits de mantisa; float32 tiene 24 → el vértice salta varios metros y "tiembla" al mover la cámara. Con coordenadas locales el error de la matriz es un **sesgo constante por tesela**, no un temblor por vértice.

⭐ **Traducción exacta a Canvas 2D**: guarda la geometría de cada tesela en enteros locales y aplica **un `ctx.setTransform()` por tesela** (calculado con `number`, que en JS es float64), en vez de proyectar cada punto a coordenadas de mundo antes de dibujar. Menos aritmética por punto, y precisión perfecta.

---

<a name="11"></a>
## 11 · El render: orden, recorte, coordenadas locales

### 11.1 ⭐ Capa-mayor, no tesela-mayor

Confirmado leyendo `src/render/painter.ts:517-729`: el bucle externo es **por capa de estilo**, y es *dentro* de cada función de dibujo donde se itera por tesela (`draw_fill.ts:138-184`: `for (const coord of coords) { program.draw(...) }`).

Pasadas por frame (`painter.ts:570-655`):

```
1. offscreen  — capas con framebuffer propio (heatmap, hillshade prepare) primero,
                para no rebindear framebuffers a mitad
2. clear color + depth + stencil, sky
3. opaque     — capas de ARRIBA a ABAJO, sólo rellenos opacos sin patrón,
                con depth ReadWrite → el early-z evita overdraw
4. translucent— capas de ABAJO a ARRIBA, todo lo demás
5. atmósfera / debug
```

**La consecuencia visual**, y es el motivo de la decisión: una carretera de la capa N queda **siempre** por encima del landuse de la capa N−1, aunque estén en teselas distintas. Si pintaras "tesela completa a la vez", el landuse de la tesela derecha taparía la carretera de la tesela izquierda en la junta.

⭐ **Es la decisión de arquitectura nº 1 de un renderer Canvas 2D propio.** Si tu render de tesela produce un bitmap ya compuesto (que es tu caso: rasterizas la tesela entera), este problema **no lo tienes en el pintado** — pero lo tienes **dentro del render de cada tesela**, y es exactamente el motivo de los metatiles (§14.2): una etiqueta o un río que cruza el borde necesita ver a sus vecinos para componerse bien.

### 11.2 Depth y sublayers

Detalle fino que evita el z-fighting entre elementos de la misma capa (`painter.ts:178-179, 496-500`):

```
numSublayers = 3 (overzoom) + 10 (underzoom) + 1 = 14
depth = 1 − ((1 + currentLayer) · numSublayers + n) · (1/2^16)
```

Cada capa reserva 14 ranuras de profundidad, una por posible desfase de nivel de tesela. Así una tesela padre y una hija de la misma capa nunca compiten por el mismo valor de z.

### 11.3 Los buckets: geometría → arrays tipados

El patrón general de MapLibre (todo en worker):

```
MVT → por capa de estilo, un Bucket → populate(features) filtra y evalúa sort-key
    → addFeature convierte a StructArrays (arrays tipados con layout de vértice)
    → serialize() hace _trim() y mete el ArrayBuffer en la lista de TRANSFERABLES
    → postMessage zero-copy → upload() crea VertexBuffer/IndexBuffer
```

**Rellenos** (`fill_bucket.ts:174-197`): `classifyRings(geometry, EARCUT_MAX_RINGS=500)` agrupa anillos en polígonos {exterior + agujeros} por orientación/área, y **earcut** triangula. Además una segunda pareja de arrays para el **contorno antialiasado** dibujado con `gl.LINES`.

**Líneas** (`line_bucket.ts:273-570`) — el algoritmo completo de extrusión, que resumo porque es el más reutilizable:

```
por vértice:
  prevNormal, nextNormal = perpendiculares unitarias de cada segmento
  joinNormal   = unit(prev + next)                  ← la bisectriz
  cosHalfAngle = joinNormal · nextNormal
  miterLength  = 1 / cosHalfAngle                   ← ∞ si los segmentos son antiparalelos

degradaciones (líneas 397-421):
  round → miter  si miterLength < roundLimit ;  → fakeround si ≤ 2
  miter → bevel  si miterLength > miterLimit
  bevel → flipbevel si miterLength > 2       (el extrude máximo codificable es 128/63 ≈ 2)

emisión:
  miter     → 2 vértices con joinNormal · miterLength
  bevel     → cierra el segmento previo con offset −sqrt(miterLength²−1) y abre el siguiente
  fakeround → n = round(ángulo / 20°) vértices interpolando normales (slerp polinómico)
  caps: butt / square (offset ±1) / round (flag que el fragment shader lee como semicírculo)

esquinas agudas (>75°): insertar vértices extra a 15 px de la esquina para que
  el tramo inclinado del patrón de guiones sea corto

empaquetado (551-570): (x<<1)+flagRound, (y<<1)+flagUp, round(63·extrudeX)+128, ...,
  dir (2 bits) | linesofar (14 bits repartidos en dos atributos)
```

El **ancho real se aplica en el vertex shader** multiplicando la normal por `line-width/2` en píxeles → ancho constante en pantalla a cualquier zoom **sin reteselar**.

⭐ En Canvas 2D nativo `ctx.lineJoin`/`lineCap` te dan esto gratis. **Pero** si quieres guiones que "fluyan" a lo largo del río (la distancia acumulada `linesofar`), anchos que varíen por feature, o líneas con textura, este es el algoritmo. Y el concepto de `MAX_LINE_DISTANCE = 32768` con **reseteo y re-emisión del vértice** (costura invisible) es el truco para que la distancia acumulada quepa en pocos bits.

### 11.4 Segmentos: el límite de 65535

```js
// src/data/segment.ts:132-136
/* The maximum size of a vertex array. This limit is imposed by WebGL's 16 bit
 * addressing of vertex buffers. */
SegmentVector.MAX_VERTEX_ARRAY_LENGTH = Math.pow(2, 16) - 1;   // 65535
```

`prepareSegment(n)` devuelve el último segmento si caben `n` vértices más **y** coincide el sortKey; si no, abre uno nuevo sobre el **mismo** buffer. Resultado: 1 bucket = 1 VBO + 1 IBO + N segmentos = N draw calls, pero sin cambiar de buffer ni de programa.

### 11.5 Data-driven sin reteselar

`ProgramConfiguration` (`src/data/program_configuration.ts`) distingue tres casos por propiedad de pintado:

| Caso | Implementación |
|---|---|
| Constante | uniform |
| Expresión por feature | un **atributo por vértice** con el valor evaluado (colores empaquetados 4×uint8 → 2 floats) |
| Composite (zoom + feature) | **dos** atributos (valor a zoom min y max) + uniform `u_*_t` de interpolación, actualizado por frame **sin tocar buffers** |

Y el **feature-state**: `FeaturePositionMap` mapea `featureId → rangos de vértices`; al cambiar el estado de una feature (hover, selección) se re-evalúa **sólo** su rango y se re-sube ese trozo del buffer. **Repintado sin reteselar.**

⭐ El concepto transferible aunque no uses GPU: **separa la geometría de los arrays de estilo por feature, y guarda un mapa `featureId → rango`**. Es lo que te permite resaltar una provincia al pasar el ratón sin regenerar la tesela.

---

<a name="12"></a>
## 12 · Etiquetas: SDF, colisión, cross-tile, throttle

El texto es el subsistema más difícil de un mapa y el que más separa a los buenos de los malos. Nada de lo que sigue depende de WebGL salvo el shader SDF.

### 12.1 Glifos SDF: por qué

Un atlas SDF (signed distance field) guarda, por píxel, la **distancia con signo al borde del glifo** en vez del glifo rasterizado. Con eso, un único atlas sirve a **cualquier tamaño**, con **halo gratis** y rotación continua.

```glsl
// src/shaders/glsl/symbol_sdf.fragment.glsl:24, 33-43
float EDGE_GAMMA = 0.105 / u_device_pixel_ratio;
highp float gamma = EDGE_GAMMA / (fontScale * u_gamma_scale);
lowp float dist = texture(u_texture, tex).a;
highp float alpha = smoothstep(inner_edge - gamma_scaled, inner_edge + gamma_scaled, dist);
// inner_edge = (256−64)/256 = 0.75 ; SDF_PX = 8 ; fontScale = size/24
// halo: umbral desplazado hacia fuera → halo_edge = (6 − halo_width/fontScale)/8
//       y se recorta el interior con  min(smoothstep(halo…), 1 − alpha_texto)
```

Fuentes de glifos (`glyph_manager.ts`): **rangos PBF de 256 codepoints** del servidor (`{fontstack}/{range·256}-{range·256+255}.pbf`), o **TinySDF local** para CJK y como fallback si falla la red (`fontSize: 48, buffer: 6, radius: 16, cutoff: 0.25`, dibujado a 2×). Empaquetado por tesela con **potpack** (shelf packing), `padding = 1 px`.

⭐ En Canvas 2D no necesitas SDF: `ctx.fillText` + `strokeText` te dan texto con halo. Lo que **sí** necesitas del modelo es lo demás: métricas por glifo, atlas, y sobre todo lo que viene ahora.

### 12.2 Colocación: el índice de colisión

`CollisionIndex` (`src/symbol/collision_index.ts`) trabaja en **coordenadas de pantalla proyectadas**, no de tesela. Piezas:

- **Rejilla espacial de celdas de 25 px** (`grid_index.ts:86-87`) con listas de cajas y círculos. Consultar = comparar sólo con lo que comparte celda.
- **`viewportPadding = 100 px`** alrededor de la pantalla: las apariciones y desapariciones ocurren fuera de la vista.
- **Dos fases**: `placeCollisionBox` (test) e `insertCollisionBox` (commit), para colocar pares icono+texto **atómicamente**.
- **Cajas** para símbolos puntuales; **círculos** para texto sobre línea (una caja rotada aproxima fatal una curva): se cubre el camino con círculos de diámetro = altura del texto, interpolados cada `radius · 2.5`.
- Descartes: fuera del grid, ocluido, o `perspectiveRatio < 0.6` (etiquetas cerca del horizonte).

Y OpenLayers demuestra que **esto se hace igual de bien en Canvas 2D sin GPU** (`render/canvas/Executor.js:981-1045`):

```js
if (declutterMode !== 'declutter' || !declutterTree.collides(dimensions.declutterBox)) {
  if (declutterMode !== 'none') declutterTree.insert(dimensions.declutterBox);
  this.replayImageOrLabelArgs_(args);      // se pinta
}   // si colisiona: se salta entera; NO hay recolocación
```

Con un **RBush (branching 9) creado por frame** (`layer/BaseVector.js:236-251`), coordenadas en píxeles CSS del viewport, y tres modos: `'declutter'` (testea y ocupa), `'obstacle'` (siempre se pinta y ocupa — echa a otros), `'none'` (se pinta y no ocupa). Icono+texto atómicos con `declutterImageWithText`.

### 12.3 Prioridad: el orden es la prioridad

No hay puntuaciones. Gana el primero en colocarse, y el orden es:

- **MapLibre**: capas de **arriba abajo** (`pauseable_placement.ts:80, 101-125`: `_currentPlacementIndex = order.length − 1; ... --`), dentro de cada capa las teselas por z y los símbolos por orden de datos o `symbol-sort-key`.
- **OpenLayers**: capas de arriba abajo (`Composite.js:232-238`) y zIndex **descendente** dentro del grupo cuando hay declutter (`ExecutorGroup.js:413-414`).

⭐ Es un algoritmo **greedy**, y es lo correcto: es estable (mismo input → mismo output), es O(n log n), y coincide con la intuición cartográfica (lo más importante va arriba en el estilo y se coloca primero). No intentes optimización global.

### 12.4 El presupuesto: 2 ms por frame

```js
// src/style/pauseable_placement.ts:97-99
shouldPausePlacement: (now() - startTime) > 2      // milisegundos
```

Si el placement se pasa de 2 ms, **se pausa y continúa el frame siguiente**, mientras se sigue renderizando con el placement anterior. Nunca bloquea el frame.

### 12.5 ⭐ Cada cuánto se recalcula: el "throttle" que no es un timer

Éste es un hallazgo bonito. No hay `setTimeout`. `Style._updatePlacement` (`style.ts:1812-1879`) crea un placement nuevo sólo si el anterior terminó **y** dejó de ser reciente:

```ts
// placement.ts:1268-1278
stillRecent = commitTime + fadeDuration * durationAdjustment > now
// zoomAdjustment = max(0, (zoomAnterior − zoom) / 1.5)   ← acelera al alejar rápido
```

Con `fadeDuration = 300 ms` (default, `map.ts:540`) el placement corre **como mucho cada ~300 ms**. Con `fadeDuration = 0` pasa a ser síncrono y cada frame.

### 12.6 ⭐⭐ El índice cross-tile: la pieza que nadie implementa y todos necesitan

Problema: al cambiar de nivel de zoom, "Valdoria" de la tesela z14 y "Valdoria" de la tesela z15 son objetos distintos. Si no las identificas, la etiqueta hace fade-out y fade-in → **parpadeo en cada cambio de nivel**.

Solución de MapLibre (`src/symbol/cross_tile_symbol_index.ts`), y es sorprendentemente simple:

```
identidad = clave del texto (symbolInstance.key) + ancla CUANTIZADA a rejilla de ~4 px

roundingFactor = 512 / EXTENT / 2                        (línea 26)

al añadir un bucket nuevo (249-306):
  para cada índice de OTRO zoom presente (hijos por isChildOf, y el padre por scaledTo):
     convertir el ancla nueva AL MARCO de la tesela vieja:
        zDifference = z − localZ
        scale  = roundingFactor / 2^zDifference
        xWorld = (x·EXTENT + anchorX) · scale
        dx     = floor(xWorld − localX·EXTENT·roundingFactor)
     match si |dx| ≤ tolerance && |dy| ≤ tolerance
        tolerance = 1 celda si el índice es de MENOR z  (≈ 12×12 px)
                  = 2^(zViejo − zNuevo) si es de MAYOR z
  hay match → HEREDA el crossTileID (y con él, su opacidad ya fundida)
  no hay    → crossTileID nuevo
(cada crossTileID sólo puede reclamarse una vez por nivel de zoom)
```

Y las opacidades se **conservan entre placements** (`placement.ts:29-34, 957`):

```ts
const increment = prevPlacement ? prevPlacement.symbolFadeChange(now) : 1;
this.opacity = Math.max(0, Math.min(1,
    prevState.opacity + (prevState.placed ? increment : -increment)));
```

Las opacidades del placement previo se copian al nuevo **incluso para símbolos que ya no se colocan**, hasta que su fade-out termina. Entre commits, el shader interpola con `u_fade_change = (now − commitTime)/fadeDuration` — por eso el fundido es suave aunque el placement corra 3 veces por segundo.

⭐ **Receta portable completa** (funciona igual en Canvas 2D):

```
1. estado persistente por etiqueta: { opacity, targetPlaced }
2. identidad estable = hash(texto) + ancla cuantizada a una rejilla de píxeles de MUNDO
3. placement throttled (cada ~300 ms) con presupuesto (2 ms) y pausable
4. por frame: opacity += ±Δt/fadeDuration, dibujar con globalAlpha = opacity
5. al entrar un nivel nuevo: heredar identidad → heredar opacidad → cero parpadeo
```

### 12.7 Etiquetas sobre líneas curvas

Y el truco que hace que un río lleve su nombre siguiendo la curva (`src/symbol/projection.ts:216-329`, `placeGlyphAlongLine` 790-906):

```
CADA FRAME, para cada etiqueta de línea visible:
  1. proyectar el ancla; culling barato (+256 px de margen) → si fuera, ocultar de golpe
  2. por glifo: usando su glyphOffset (distancia al ancla en unidades de fuente × escala),
     CAMINAR por los vértices de la línea YA PROYECTADOS al plano de pantalla,
     acumulando longitudes hasta consumir el offset
  3. interpolar el punto y el ángulo:  angle = atan2(Δy, Δx)  del segmento
  4. escribir posición+ángulo por glifo en un buffer dinámico
  5. keepUpright: si la mayoría quedarían boca abajo, recolocar con flip; si no cabe, ocultar
  (las proyecciones de vértices se cachean por símbolo)
```

⭐ **Detalle clave**: se camina la distancia **en píxeles de pantalla**, no en unidades de mundo. Así el espaciado entre letras es visualmente uniforme incluso con perspectiva. En Canvas 2D esto es literalmente `translate(punto) + rotate(ángulo) + fillText(letra)` por glifo, con la polilínea proyectada una sola vez por frame.

---

<a name="13"></a>
## 13 · Workers: protocolo, cuántos, qué corre dónde

### 13.1 ⭐ Cuántos workers: la respuesta te va a sorprender

```ts
// src/util/worker_pool.ts:58-60
// Based on results from A/B testing: https://github.com/maplibre/maplibre-gl-js/pull/2354
const availableLogicalProcessors = Math.floor(browser.hardwareConcurrency / 2);
WorkerPool.workerCount = isSafari(globalThis)
    ? Math.max(Math.min(availableLogicalProcessors, 3), 1)
    : 1;
```

**Un solo worker** en todos los navegadores salvo Safari (donde son 1-3). La fórmula famosa `hardwareConcurrency − 1` **ya no existe**: la quitaron tras A/B testing real.

La lección no es "usa 1 worker" (tu carga es distinta: renderizar teselas pictóricas es mucho más pesado que parsear MVT). La lección es: **mide antes de escalar el pool**. Más workers significa más contención de memoria, más copias del estado del mundo, más presión de GC, y en tu caso —según tu propia memoria de la pasada 10— *"24 contextos en 2 min, cada uno re-clonando un 2048 y re-sembrando 8 s de Dexie"*. Ese síntoma es exactamente el coste oculto del paralelismo mal dimensionado.

### 13.2 El protocolo

`Actor` (`src/util/actor.ts`):

```
sendAsync(message, abortController):
   id aleatorio base36 → resolveRejects[id] = {resolve, reject}
   serialize(data, buffers) acumula TRANSFERABLES
   postMessage(msg, {transfer: buffers})            ← zero-copy de ArrayBuffers

cancelación: {type: '<cancel>', id} → el receptor borra la tarea de la cola
             si aún no corrió, o aborta su AbortController si ya está en marcha

en el WORKER: las tareas se ENCOLAN y se drenan de una en una vía ThrottledInvoker
   (un MessageChannel: port1.postMessage → macrotask), para que los <cancel>
   puedan intercalarse entre tareas largas          ← el detalle importante

respuesta: {type: '<response>', id, data | error}
```

⭐ Ese detalle de drenar la cola **una tarea por macrotask** es lo que hace que la cancelación funcione de verdad. Si el worker procesa su cola en un bucle síncrono, un `<cancel>` que llega a mitad no se lee hasta que todo terminó.

### 13.3 Qué corre dónde

| Hilo principal | Worker |
|---|---|
| Transform / cámara | Fetch del PBF y parse MVT |
| TileManager (qué teselas pedir y retener) | Buckets: filtro, evaluación de layout, earcut, extrusión de líneas |
| GlyphManager, ImageManager | Shaping de texto + quads de símbolos |
| Upload a GPU y todo el render | Empaquetado de GlyphAtlas / ImageAtlas por tesela |
| **Placement y colisiones** (CollisionIndex, CrossTileIndex) | FeatureIndex para queries (se transfiere) |
| Reproyección de etiquetas de línea por frame | GeoJSON → teselas (geojson-vt / supercluster) |
| Evaluación de paint por frame | Plugin de texto RTL |

⭐ Fíjate en dónde está el **placement**: en el hilo principal. Tiene que estarlo, porque depende de la cámara del frame actual y afecta a todas las teselas a la vez. Es una decisión de diseño, no una limitación: lo que va al worker es lo **independiente por tesela**; lo que depende de la vista global se queda.

### 13.4 El ciclo de una tesela vector

```
loadTile:  getArrayBuffer (abortable)
        → early-out por etag
        → new VectorTile(new PbfReader(rawData))
        → si se pidió un z mayor que el max del source: _getOverzoomTile (LRU de 1000)
        → WorkerTile.parse:
             crear FeatureIndex + CollisionBoxArray
             por source-layer: instanciar buckets y populate()
             juntar dependencias (glifos, iconos, patrones, dashes)
             pedirlas AL HILO PRINCIPAL vía actor (cancelando las de un parse anterior)
             con las respuestas: construir GlyphAtlas + ImageAtlas EN EL WORKER
             performSymbolLayout
        → devolver {buckets no vacíos, featureIndex, collisionBoxArray,
                    glyphAtlasImage, imageAtlas, rawTileData.slice(0)}

reloadTile: re-parsea el MVT YA CACHEADO en el worker, SIN red   ← cambio de estilo
```

⭐ Ese `reloadTile` es la respuesta a "cambiar el estilo sin volver a descargar". El equivalente en tu app: **guardar el resultado del cálculo geométrico por tesela separado del bitmap entintado**, para que un cambio de paleta o de estilo re-entinte sin recalcular la geografía. Según tu memoria ya distingues canon (contenido) de tesela entintada (presentación) — esto es la misma idea, y es la correcta.

---

<a name="14"></a>
## 14 · El servidor: metatiles, colas, dirty, TTL

Aunque tu app no tenga servidor, **renderd/mod_tile es la mejor descripción publicada de un sistema que produce teselas bajo demanda con recursos limitados** — que es exactamente lo que hace tu `tileService`. Todo verificado en código fuente.

### 14.1 La arquitectura

```
Apache (mod_tile) → socket UNIX → renderd → Mapnik → PostGIS
```

mod_tile **nunca renderiza**: traduce `z/x/y` a una ruta de metatesela en disco y, si falta o está vieja, encola en renderd. Protocolo binario con comandos numerados [CONFIRMADO]:

```
cmdRender     = 1   render sincrónico normal
cmdRenderPrio = 5   prioridad alta (tesela AUSENTE, usuario esperando)
cmdRenderBulk = 6   lote / pre-render
cmdRenderLow  = 7   prioridad baja
cmdDirty            re-render de fondo, SIN respuesta al cliente
```

Rutas en disco con **hashing intercalado**:

```
/[base]/[TileSet]/[Z]/[xxxxyyyy]/[xxxxyyyy]/[xxxxyyyy]/[xxxxyyyy]/[xxxxyyyy].meta
   cada componente = 4 bits altos de x + 4 bits bajos de y
   5 componentes × 8 bits = 20 bits de x + 20 de y  →  explica MAX_ZOOM = 20
```

Es una curva de Morton por bloques: agrupa cuadrados de 16×16 teselas en el mismo directorio. **Localidad espacial en el árbol de ficheros**, la misma idea que los quadkeys y que Hilbert en PMTiles.

### 14.2 ⭐ Metateselas 8×8

`METATILE = 8` → **64 teselas por fichero** (`includes/render_config.h`). El fichero:

```c
#define META_MAGIC "META"
struct entry { int offset; int size; };
struct meta_layout {
    char magic[4];  int count;      // 64
    int x, y, z;                    // los x,y menores del metatile
    struct entry index[];           // 64 entradas
    // luego los blobs
};
// cabecera 20 B + índice 512 B = 532 B antes de los datos
```

**Por qué metateselas** — tres razones, y las tres aplican a tu app:

1. **Amortizar el coste fijo del render.** Una sola consulta a la base de datos y una sola pasada de Mapnik cubren 2048×2048 px. En tu caso: una sola consulta al mundo, un solo montaje de contexto, una sola resolución de qué features caen ahí.
2. **Coherencia de etiquetas y de features que cruzan el borde.** Mapnik resuelve las colisiones sobre el lienzo completo, así una etiqueta de calle no se duplica ni se corta arbitrariamente cada 256 px. Se renderiza además con un **buffer** alrededor del propio metatile.
3. **Menos ficheros** (menos inodos en disco; menos registros en IndexedDB, que también tiene coste por registro, no sólo por byte).

⭐ **Contrapartida honesta**: un metatile 8×8 tarda ~64× más en aparecer que una tesela suelta. Por eso la recomendación práctica es **híbrida**: metatiles pequeños (2×2 o 4×4) en el camino interactivo, 8×8 en el camino bulk/prefetch.

### 14.3 ⭐⭐ Dirty + servir lo viejo (el patrón más valioso del documento)

**La invalidación es un `utime()`, no un `unlink()`.** [CONFIRMADO — wiki OSM + `mod_tile.c`]

- Cuando se actualiza el *planet timestamp*, **todas** las teselas quedan automáticamente dirty (se comparan mtimes) y se re-renderizan según se visitan.
- Para actualizaciones diferenciales no se expira todo: se **retrasa el mtime de los `.meta` afectados a una fecha muy en el pasado**. El dato viejo sigue ahí y sigue siendo servible.
- Estados: `tileMissing`, `tileOld`, `tileVeryOld` (umbral `VERYOLD_THRESHOLD` = 1 año), `tileCurrent`.

La matriz de decisión:

```
estado        carga baja                        carga alta
------------  --------------------------------  ------------------------------
Missing       render síncrono (cmdRenderPrio),   encolar + error
              el cliente espera (timeout 3 s)
Old           encolar re-render + SERVIR VIEJO   encolar cmdDirty + SERVIR VIEJO
VeryOld       cmdRenderPrio + servir viejo       cmdRenderPrio + servir viejo
Current       servir directo                     servir directo
```

⭐ **La asimetría es la lección**: una tesela **ausente** es un fallo duro (hay que esperar o fallar); una tesela **vieja nunca lo es** — siempre hay algo que enseñar. Nunca se bloquea a un usuario por datos desactualizados.

Y el bug real que lo ilustra [CONFIRMADO — openstreetmap/operations#1096, junio 2024]: teselas dirty que no pudieron re-renderizarse al vuelo se estaban sirviendo con `max-age=604800` (7 días) en lugar de los 15 minutos de `ModTileCacheDurationDirty`. **Lección**: el camino degradado es donde se cuelan los bugs de caché. Si sirves algo viejo porque el render falló, marca también su caducidad como corta.

### 14.4 Colas: límites y descarte

```c
// render_config.h (rama con METATILE)
QUEUE_MAX     = 64      // cola de render
REQ_LIMIT     = 256     // tope de las colas de petición
DIRTY_LIMIT   = 8000    // tope de la cola dirty
NUM_THREADS   = 4
REQUEST_TIMEOUT = 3 s
MAX_LOAD_OLD     = 16   // por encima: no re-renderizar teselas viejas al vuelo
MAX_LOAD_MISSING = 50   // por encima: no renderizar ni las ausentes
```

```c
// src/request_queue.c — el descarte
// "The queue is severely backlogged. Drop request"
queue->stats.noReqDroped++;
return cmdNotDone;
```

⭐ Tres ideas: (1) **colas separadas por prioridad**, no una con pesos; (2) **colas interactivas cortas** (latencia acotada) y **cola de fondo larga** (throughput); (3) bajo saturación **se tira la petición**, no se hace crecer la cola. Y una cuarta, específica de tu caso: **degradación por escalones** según carga — en el navegador el equivalente de `load average` es el presupuesto de frame (el `>8 ms` de OpenLayers, §7.4).

### 14.5 El TTL adaptativo (aplicable a cuánto tiempo confías en una tesela cacheada)

```c
// mod_tile.c, add_expiry()
if (state == tileOld || state == tileVeryOld) {
    holdoff = (cache_duration_dirty / 2.0) * (rand() / (RAND_MAX + 1.0));
    maxAge  = cache_duration_dirty + holdoff;
} else {
    minCache     = mincachetime[z];                                   // suelo POR ZOOM
    lastModified = (request_time − mtime) * cache_duration_last_modified_factor;
    holdoff      = (3*60*60) * (rand() / (RAND_MAX + 1.0));           // jitter hasta 3 h
    maxAge = MIN(MAX(minCache, lastModified) + holdoff, cache_duration_max);
}
```

Valores reales de tile.openstreetmap.org:

```
ModTileCacheDurationMax          604800   (7 días, techo)
ModTileCacheDurationDirty        900      (15 min)
ModTileCacheDurationMinimum      10800    (3 h)
ModTileCacheDurationMediumZoom   13 86400   → z≤13: mínimo 1 día
ModTileCacheDurationLowZoom       9 518400  → z≤9 : mínimo 6 días
ModTileCacheLastModifiedFactor   0.20
```

Tres ideas ⭐: **jitter obligatorio** (evita la estampida sincronizada de revalidaciones); **TTL proporcional a la estabilidad observada** (lo que lleva mucho sin cambiar, probablemente no cambie); **suelo por zoom** — los niveles bajos son casi estáticos y se piden muchísimo.

### 14.6 Las cabeceras reales, y stale-while-revalidate

```http
Cache-Control: max-age=604800, stale-while-revalidate=604800, stale-if-error=604800
Expires: Sat, 15 Jun 2024 10:40:33 GMT
Age: 0
X-Cache: MISS
X-Served-By: cache-muc13944-MUC        ← Fastly
X-Tilerender: nidhogg.openstreetmap.org ← qué máquina la renderizó
```

RFC 5861 [CONFIRMADO]:

- **`stale-while-revalidate`**: la caché *puede* servir la respuesta caducada hasta N segundos y *debería* revalidarla en paralelo **sin bloquear**.
- **`stale-if-error`**: servir caducado cuando el origen devuelve 500/502/503/504.

Es §14.3 replicado en el borde. Y la invalidación por lista: `osm2pgsql --expire-tiles` emite **una línea `ZOOM/X/Y` por tesela tocada** (append, el consumidor vacía el fichero), que se alimenta a `render_list`. Novedad reciente (`diff_expire`): la expiración se basa en la **diferencia simétrica** entre geometría vieja y nueva, no en su unión — muchas menos teselas invalidadas al mover un nodo de una vía larga.

⭐ **Traducción directa a tu app**: cada edición del mundo debe emitir una lista de teselas afectadas (diferencia simétrica), calculada a **un solo zoom alto** y derivada hacia abajo por división entera (`x >>= 1, y >>= 1`), en vez de calcularla nivel por nivel.

---

<a name="15"></a>
## 15 · Almacén: MBTiles, PMTiles, IndexedDB, la explosión 4^z

### 15.1 La explosión 4^z, con números

```
teselas(z)   = 4^z
acumulado(z) = (4^(z+1) − 1) / 3
```

| z | teselas | acumulado | @20 KB/tesela |
|---|---|---|---|
| 0 | 1 | 1 | 20 KB |
| 5 | 1.024 | 1.365 | 20 MB |
| 8 | 65.536 | 87.381 | 1,2 GB |
| 10 | 1.048.576 | 1.398.101 | 20 GB |
| 12 | 16.777.216 | 22.369.621 | 320 GB |
| 14 | 268.435.456 | 357.913.941 | 5 TB |
| 16 | 4.294.967.296 | 5.726.623.061 | 80 TB |
| 18 | 68.719.476.736 | 91.625.968.981 | 1,2 PB |
| 20 | 1.099.511.627.776 | 1.466.015.503.701 | 20 PB |

Dos propiedades que hay que interiorizar:

1. **El último nivel es el 75 % del total.** Pre-generar "todo hasta zN" cuesta 1,33× lo que cuesta zN solo. Corolario alegre: **pre-generar los niveles bajos es prácticamente gratis**.
2. En z15, según OSM, **sólo ~1/4 de las teselas se ha pedido alguna vez** [CONFIRMADO — help.openstreetmap.org]. El 75 % del trabajo sería basura.

Y el dato que cierra el argumento: un nodo de render de OSM lleva **1,92 TB de SSD para las teselas** [CONFIRMADO] — muy por debajo de los 20 TB que costaría z15 completo. Sólo se materializa el working set. (El CDN sirvió ~1,5 PB/mes y ~118.000 millones de peticiones/mes en abril de 2026 [CONFIRMADO, cifra de la wiki OSM].)

⭐ **La estratificación real**, que es la que deberías copiar:

```
z0..z~8-10   pre-generación exhaustiva al crear el mundo (barato: ~87.000 teselas hasta z8)
z~11-13      selectiva: sólo regiones "interesantes" (donde hay ciudades/el jugador ha estado)
z14+         100 % bajo demanda, con caché agresivo tras el primer render
siempre      re-render dirigido por la lista de expiración, NUNCA barrido completo
```

### 15.2 MBTiles vs PMTiles

**MBTiles** [CONFIRMADO — spec 1.3]:

```sql
CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
CREATE TABLE metadata (name text, value text);
-- OJO: tile_row es TMS → "11/327/791" se guarda como row 1256, porque 1256 = 2^11 − 1 − 791
```

Se permiten **vistas** que produzcan un resultado compatible — así se implementa la deduplicación (tablas `map` + `images` unidas por una vista `tiles`).

**PMTiles v3** [CONFIRMADO — spec Protomaps]:

```
Cabecera de 127 bytes (little-endian): magic "PMTiles", version 0x03,
  offsets y lengths de {root dir, metadata, leaf dirs, tile data},
  counts {addressed tiles, tile entries, tile contents},
  flags {clustered, compresión interna, compresión de tesela, tipo}, min/max zoom, bounds/center

Entrada de directorio: TileID (posición en la curva de HILBERT a través de los zooms),
                       Offset, Length, RunLength (0 ⇒ apunta a un directorio hoja)
Codificación: varints, TileIDs con delta, offset = 0 si es contiguo al anterior
RESTRICCIÓN: el directorio raíz DEBE caber en los primeros 16.384 bytes
```

Resultado: **una sola petición HTTP Range de 16 KiB** trae cabecera + raíz; la segunda trae la tesela. Un mapa entero servido desde un fichero estático en un CDN, **sin servidor**.

| | MBTiles | PMTiles v3 |
|---|---|---|
| Contenedor | SQLite | fichero plano |
| Orden físico | el que decida SQLite | curva de Hilbert (clustered) |
| Acceso remoto | no (hay que bajarlo entero o poner servidor) | **sí**, HTTP Range sobre S3/CDN |
| Peticiones por tesela | n/a | 2 (3 si hay hoja) |
| Dedup | vistas map/images | nativa: **RunLength** |
| Actualización parcial | trivial (UPDATE/INSERT) | prácticamente inmutable |
| Y-flip | TMS | TileID Hilbert, sin flip |

**Veredicto**: MBTiles = formato **de trabajo**; PMTiles = formato **de distribución**.

⭐ **Para ti, dos usos concretos:**

1. **Exportar un mundo** → PMTiles. Fichero único, compartible, abrible con cualquier visor, servible desde cualquier hosting estático. Es la respuesta natural a "quiero enseñar mi mundo a alguien".
2. **RunLength / deduplicación por hash de contenido** → aplícalo YA en IndexedDB. Un mundo de fantasía tiene océano y vacío uniforme a espuertas. Dos tablas: `tiles: clave → contentHash` y `blobs: contentHash → blob`. En un mundo con mucho mar puede recortar el almacén un orden de magnitud, y de paso resuelve el caso "la misma tesela con dos claves de contenido distintas produce el mismo bitmap".

### 15.3 IndexedDB: lo que aplica y lo que no

| Del mundo servidor | ¿Aplica a IndexedDB? |
|---|---|
| Colas con prioridad y descarte | **Sí, tal cual** |
| Metateselas | **Sí** (menos registros, coherencia de etiquetas) |
| Dirty + servir viejo | **Sí, es lo más valioso** |
| Localidad espacial en el orden de claves | **Sí**: clave `[z, hilbertIndex]` → una región con un solo `IDBKeyRange` |
| Dedup por hash de contenido | **Sí** |
| TTL con jitter | Sí, si revalidas |
| Socket UNIX, demonio separado | No: tienes `postMessage` + `Transferable` |
| Umbrales de load average | No: usa presupuesto de frame / `requestIdleCallback` |
| Cabeceras HTTP, ETag, 304 | No: **tú eres el origen** — se colapsa en `renderedAt` + `dirty` |
| Formato .meta con offsets | No: IndexedDB ya te da acceso por clave |
| Barridos completos (`render_list -z 0 -Z 15`) | No, pero **sí el contrato de la lista de expiración** |

Y dos avisos operativos:

- **El navegador evacúa toda la base, no entradas sueltas.** Asume que puedes perderlo todo y que regenerar debe ser posible. `navigator.storage.persist()` + `estimate()`.
- **LRU con cota dura propia**, priorizando por (zoom bajo, visitas recientes). No confíes en la evacuación del navegador para gestionar tu presupuesto.

---

<a name="16"></a>
## 16 · Generalización por zoom

Un mapa no es el mismo dato a distintas escalas: es **datos distintos**. tippecanoe es la mejor documentación pública de cómo se decide qué sobrevive [CONFIRMADO — README de felt/tippecanoe].

**El presupuesto por tesela**: 500 KB comprimidos y 200.000 features (`-M` / `-O`).

**Las estrategias, con nombre**, cuando una tesela se pasa:

| Opción | Qué hace |
|---|---|
| `--drop-densest-as-needed` | aumenta el espaciado mínimo entre features (descarta lo más denso) |
| `--drop-fraction-as-needed` | descarta una fracción dinámica por nivel |
| `--drop-smallest-as-needed` | descarta las features más pequeñas |
| `--coalesce-densest-as-needed` | **fusiona** features densas con vecinas en vez de borrarlas |
| `--coalesce-smallest-as-needed` | idem con las pequeñas |

**Puntos entre zooms**: tasa de descarte por defecto `-r 2.5` (deja 1/2,5 de los puntos por cada nivel por encima del base). **Gamma** `-g`: *"un gamma de 2 reduce el número de puntos separados por menos de un píxel a la raíz cuadrada de su número original"*.

**Micropolígonos**: los polígonos de menos de **4 subpíxeles cuadrados** se eliminan con *probability diffusion* — se conserva una **muestra estadística** para mantener la textura de área. ⭐ Este matiz es precioso: no se borra el archipiélago entero, se borra una parte proporcional para que la mancha siga leyéndose.

**Simplificación**: Douglas-Peucker con tolerancia ligada a la resolución de la tesela (`-d 12` → rejilla 2^12 = 4096, el extent MVT).

**Buffers**: 5 "píxeles de pantalla" por defecto (1 px = 1/256 del ancho de tesela).

⭐ **Traducción a un mundo de fantasía**, que es donde esto se vuelve interesante de verdad:

```
z bajos   : sólo continentes, mares, cordilleras principales, reinos, 5-10 topónimos
z medios  : ríos principales, ciudades y villas, caminos principales, bosques como manchas
z altos   : arroyos, aldeas, ruinas, hitos, caminos menores, árboles individuales
regla     : cada feature tiene un minZoom derivado de su IMPORTANCIA (población,
            caudal, longitud, rango jerárquico), no un umbral fijo
presupuesto: si una tesela se pasa de N features, sube el umbral de importancia
             hasta que quepa — y REGÍSTRALO (no truncar en silencio)
etiquetas : minZoom propio, distinto del de la geometría (una ciudad puede dibujarse
            a z8 y no llevar nombre hasta z10)
```

La regla de oro de tippecanoe que más se olvida: **la densidad percibida debe ser constante entre niveles**. Si en z6 se ven 40 topónimos por pantalla, en z10 deben verse ~40, no 400.

---

<a name="17"></a>
## 17 · Terreno y 3D

Puente entre tu mapa 2D por teselas y la meta FlowScape.

### 17.1 Altura codificada en RGB

Dos estándares de facto [CONFIRMADO]:

```
Mapbox Terrain-RGB:  height = −10000 + (R·65536 + G·256 + B) · 0.1
   → precisión 0,1 m constante; datos hasta z15 (256 px) / z14 (512 px)

Terrarium / AWS:     height = (R·256 + G + B/256) − 32768
   → 16 bits enteros + 8 de fracción → precisión 0,0039 m; rango ±32.768
   → tamaños publicados: 256, 260, 512 y 516 px  ← los "+4" son BUFFER de 2 px por lado
```

**Nunca JPEG/WebP con pérdida**: el canal bajo es ruido de alta frecuencia y la compresión lo destruye → terreno con "olas" de artefactos. PNG obligatorio.

MapLibre los lee nativamente (`encoding: "mapbox" | "terrarium" | "custom"` con `redFactor/greenFactor/blueFactor/baseShift`).

⭐ **El problema de los bordes, que es la trampa nº 1.** Un kernel 3×3 en el borde de la tesela necesita píxeles del vecino. MapLibre almacena cada DEM con **1 px de padding en los 4 lados**, lo rellena provisionalmente **duplicando el píxel interior** (comentario en el código: *"avoid flashing seams between tiles"*) y lo sustituye por datos reales con `backfillBorder(borderTile, dx, dy)` **cuando llega el vecino** (`src/data/dem_data.ts`). Dos soluciones válidas: servir teselas con buffer (Terrarium 260/516) o implementar el backfill. Sin ninguna: costuras de 1 px **cambiantes** en cada arista.

### 17.2 Hillshade en GPU: dos pasadas

**Pasada "prepare"** (DEM → textura de derivadas, cacheable):

```glsl
float getElevation(vec2 coord, float bias) {
  vec4 data = texture(u_image, coord) * 255.0;
  data.a = -1.0;                                    // truco: el dot resta baseShift
  return dot(data, u_unpack) / 4.0;
}
vec2 deriv = vec2(
  (c + f + f + i) - (a + d + d + g),                // Sobel/Horn 3×3
  (g + h + h + i) - (a + b + b + c)
) / pow(2.0, (u_zoom - u_maxzoom) * exaggeration + 19.2562 - u_zoom);
```

Se empaqueta en R y G. ⭐ Esta separación es lo que permite **cambiar la dirección de la luz sin volver a tocar el DEM**.

**Pasada de render**:

```glsl
float scaleFactor = cos(radians(...));               // ← corrección de latitud Mercator
float slope  = atan(1.25 * length(deriv) / scaleFactor);
float aspect = deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : PI/2.0 * sign(deriv.y);
float base = 1.875 - intensity * 1.75;
float scaledSlope = ((pow(base, slope) - 1.0) / (pow(base, maxValue) - 1.0)) * maxValue;
float accent = cos(scaledSlope);
float shade  = abs(mod((aspect + azimuth) / PI + 0.5, 2.0) - 1.0);
// tres colores independientes: shadow, highlight, accent
```

⭐ **En un mundo plano, `scaleFactor = 1.0` — esa línea se borra.** Y el detalle de diseño que hace que parezca cartografía y no un render: **tres colores separados** (sombra, luz, y un *accent* que realza todas las pendientes independientemente del azimut).

Defaults: `illumination-direction 335°`, `illumination-altitude 45°`, `exaggeration 0.43` (⚠️ **es la intensidad del efecto, rango [0,1]** — no confundir con `terrain.exaggeration`, que es el multiplicador geométrico, rango [0,∞), default 1).

### 17.3 Terreno 3D en MapLibre: el modelo que te sirve

```ts
const delta = EXTENT / meshSize;          // meshSize = 128
for (let y = 0; y <= meshSize; y++)
  for (let x = 0; x <= meshSize; x++)
    vertexArray.emplaceBack(x * delta, y * delta, 0);
```

⭐ **Una sola malla compartida por TODAS las teselas** (`(128+1)² = 16.641` vértices, índices compartidos). No se genera geometría por tesela: sólo cambian la textura DEM y la matriz. La altura se aplica en el **vertex shader** por vertex texture fetch.

**Faldones**: los vértices de faldón se marcan con el valor `z` del atributo de posición (`z=0` malla normal, `z=1` faldón) y el shader los desplaza hacia abajo. Tapan las grietas verticales entre teselas de LOD distinto.

**⭐⭐ Drapeado por render-to-texture**: MapLibre **no reescribe su renderer 2D para 3D**. Renderiza las capas 2D a un framebuffer por tesela y usa ese FBO como textura sobre la malla. `qualityFactor` de 2× (potencia de 2) *"to not see pixels in the render-to-texture tiles"*. Caché de las 150 teselas RTT más recientes.

**Esto es la respuesta a tu meta 3D**: tus teselas 2D ya renderizadas **son** la textura drapeada. La vista 3D hereda automáticamente todo el estilo, las etiquetas y las capas de la 2D. Y según tu memoria (pasada 10) ya vas por ahí: *"El 3D pide por CONTENIDO (props canonWorld/canonEdits) y comparte disco y encargos con el 2D"*. Es exactamente el modelo correcto.

**Picking sin raycast**: dos framebuffers del tamaño del viewport, uno de profundidad y uno de coordenadas que codifica **x/y dentro de la tesela en RGB e identidad de tesela en el alfa** (`tileID = coordsIndex[255 − rgba[3]]`). Se lee 1 píxel y tienes la posición mundial con elevación. Límite: 255 teselas indexables por frame.

### 17.4 Cesium: SSE, la fórmula verificada

```js
// Cesium3DTile.getScreenSpaceError() + PerspectiveFrustum.sseDenominator
sseDenominator = 2.0 * Math.tan(0.5 * fovY);
error = (geometricError * screenHeight) / (distance * sseDenominator);
// ⇒  sse = (geometricError · screenHeight) / (2 · distance · tan(fovY/2))
error -= CesiumMath.fog(distance, density) * factor;   // la niebla RELAJA el SSE
error /= frameState.pixelRatio;
```

**Defaults confirmados en el código**: `maximumScreenSpaceError = 2` px para **terreno** (`QuadtreePrimitive`), **16** px para **3D Tiles** (`Cesium3DTileset`). La asimetría tiene sentido: el terreno se ve continuo y el ojo compara con el vecino; un modelo suelto no.

**quantized-mesh**: TIN por tesela con vértices cuantizados a **0..32767**, delta + zigzag, normales oct-encoded a 16 bits, listas de índices de arista (`westIndices`, `southIndices`…) *"to enable skirts to hide cracks between adjacent levels of detail"*, y water mask (**1 byte si la tesela es uniforme**, rejilla 256×256 si es mixta). ⭐ El truco de cuantizar la altura **relativa a min/max de la tesela** es elegante: una llanura obtiene precisión milimétrica y una montaña centimétrica, automáticamente.

**3D Tiles 1.1**: `geometricError` en metros por nodo, `refine: "ADD" | "REPLACE"` (heredado del padre si se omite), bounding volumes (`box` OBB de 12 números, `region`, `sphere`), e `implicitTiling` con `subdivisionScheme: QUADTREE | OCTREE` + bitstreams de disponibilidad — que sustituye el JSON explícito por una regla de direccionamiento. Google sirve sus Photorealistic 3D Tiles en este estándar.

**Prioridad de carga** (`Cesium3DTile.updatePriority()`) — un truco de implementación bonito: **un solo número en base 10 con dígitos reservados por criterio**, lo que da orden lexicográfico sin comparadores anidados:

```
preloadFlight(1) | foveatedDefer(1) | foveated(4) | progressiveResolution(1) | sorting(4) . depth
```

Foveación: `_foveatedFactor = 1 − |dot(camera.direction, dirAlPuntoMásCercano)|`, se aplaza si supera `foveatedConeSize · (1 − cos(fov/2))` con `foveatedConeSize = 0.3` (sólo el 30 % central tiene prioridad plena). ⭐ Y la regla que más ancho de banda ahorra: **no se piden teselas periféricas mientras la cámara se mueve** (`timeSinceMoved < foveatedTimeDelay`).

Límites: 50 peticiones concurrentes globales, 18 por servidor, prioridad **recalculada cada frame**.

### 17.5 Geometry clipmaps: la alternativa

Losasso & Hoppe 2004 (+ GPU Gems 2 cap. 2): **anillos anidados de malla regular centrados en el observador**, con `n = 2^k − 1` (típicamente 255) muestras por nivel, cada nivel 2× más grueso.

- `(x,y)` constantes en el vertex buffer, reutilizadas por todos los niveles con escala+traslación; `z` en una **textura float por nivel**.
- Anillo descompuesto en 12 bloques de 64×64 + 4 regiones fix-up + 1 tira en L rotable + tira degenerada contra T-junctions.
- **Actualización toroidal**: direccionamiento envolvente, así al moverse sólo hay que actualizar una región en L (que con el wraparound se vuelve un "+").
- **Morphing** en una banda de anchura `n/10`: `z = (1−α)·z_fino + α·z_grueso`, "manteniendo una malla estanca" — **sin faldones y sin popping**.

| Criterio | Clipmaps | Quadtree de teselas |
|---|---|---|
| Coste CPU/frame | casi nulo | traversal + culling + scheduler |
| Draw calls | pocos y **constantes** | proporcionales a teselas visibles |
| Grietas entre LOD | **ninguna** (malla estanca + morph) | necesita faldones o stitching |
| Popping | eliminado | visible salvo blend |
| Adaptación al relieve | **nula** | buena (TIN) / media (rejilla) |
| Culling selectivo | malo (360° siempre poblado) | excelente |
| Vista cenital global | mala | **excelente** |
| **Textura drapeada por tesela** | **difícil** (geometría ≠ teselación de textura) | **trivial (1:1)** |
| Complejidad | media-alta | media |

⭐ **Veredicto para tu caso: quadtree**, por una razón que decide sola: **ya tienes teselas 2D en quadtree y quieres drapearlas**. Con clipmaps la geometría son anillos que no coinciden con ninguna teselación → necesitarías un atlas de textura virtual, que es justo el problema que el quadtree ya resuelve. Además, en un mapa navegable el coste dominante es la **textura**, no la geometría — y los clipmaps optimizan justo lo que no te duele.

**Excepción, y es la que apunta a FlowScape**: si el modo 3D es "entrar en una zona concreta" (un valle, una isla) con cámara baja y sin navegación global, una malla única sobre un heightmap recortado (o un clipmap) es más simple y más rápida. → **Arquitectura híbrida**: modo mapa = quadtree drapeado; modo escena = ventana de alta resolución con malla única y morphing, que es donde van el agua animada y la vegetación instanciada.

### 17.6 Niebla: no es decoración, es presupuesto

Cesium documenta la niebla como herramienta de rendimiento [CONFIRMADO]: *"rendering less geometry and dispatching less terrain requests"*. `density` 2.0e-4, `screenSpaceErrorFactor` 2.0 (**multiplica el SSE permitido** en la zona con niebla → menos detalle al horizonte), y las teselas enteramente dentro de la niebla **ni se renderizan ni se piden**.

⭐ En vistas rasantes el número de teselas visibles crece **cuadráticamente** con la distancia al horizonte. La niebla es el único mando que acota esa explosión sin recortar el campo de visión — y en un mundo de fantasía además encaja estéticamente.

---

<a name="18"></a>
## 18 · Los tres motores, cara a cara

| Dimensión | **Leaflet** (c96f31a) | **MapLibre GL JS** (06cac16) | **OpenLayers** (91db49d) |
|---|---|---|---|
| Estado de cámara | `_zoom`, `_lastCenter`, `_pixelOrigin` + posición DOM del pane | `TransformHelper`: center, zoom, bearing, pitch, roll, fov, padding | `View`: center, **resolution**, rotation |
| Zoom | número (fraccional permitido) | número | derivado de la resolución (`log`) |
| Niveles no diádicos | no | no | **sí** (array de resoluciones) |
| Presentación | **DOM**: `<img>` movidos con `translate3d` | **WebGL** | **Canvas 2D** (+ WebGL opcional) |
| Coste de un pan | 1 mutación de `transform` (GPU compone) | 1 cambio de transform + repintado GPU | repintado del canvas de capa (drawImage baratos) |
| Zoom animado | **transición CSS** (0.25 s cubic-bezier), JS espera `transitionend` | interpolación por rAF | interpolación por rAF |
| Bucle | eventos; rAF sólo en animaciones | render-on-demand con flags dirty + `idle` | render-on-demand, `frameState.animate` |
| Selección de teselas | rango rectangular en px del tileZoom | **descenso de quadtree** con frustum | rango del extent en el tilegrid |
| Prioridad de cola | sort por distancia al centro | sort por `distanceSq` al centro | **heap con prioridad recalculada por frame + DROP** |
| Límite de carga | ninguno explícito (lo limita el navegador) | 16/8 sólo para imágenes | **16 quieto / 8 en movimiento / 2 nuevas por frame / 0 si el frame va justo** |
| Sustitutos | padres ≤5, hijos ≤2 | hijos ≤3, padres ≤10 | **stale keys** (versión anterior) → hijos z+1 → padres |
| Anti-parpadeo extra | fade 200 ms por tesela | cross-fade de 2 texturas con UV reescaladas | fade 250 ms + 2ª pasada sobre el fallback + `subtractExtents` |
| Caché | los niveles vivos + `keepBuffer` 2 | LRU = (pantalla en teselas) × 5 | LRU 512, ampliado a 2× lo deseado |
| Etiquetas | ninguna (son marcadores DOM) | **SDF + CollisionIndex + cross-tile + fades** | **declutter con RBush por frame** |
| Workers | no | 1 (3 en Safari) | no (salvo el renderer worker experimental) |
| Terreno 3D | no | sí (RTT drapeado sobre malla por tesela) | no |
| Mundos planos | `CRS.Simple` | posible pero a contracorriente | **`units: 'pixels'` + Zoomify/IIIF: el camino oficial** |
| Líneas de código a leer para entenderlo | ~3.000 | ~40.000 | ~25.000 |

**Para qué sirve cada uno como referencia:**

- **Leaflet** es el mejor libro de texto. `GridLayer.js` en 900 líneas contiene el 80 % de lo que hay que saber sobre gestión de teselas, y las fórmulas están desnudas.
- **MapLibre** es la referencia de arquitectura: transform único, handlers puros con deltas por frame, cobertura por quadtree, retención con números medidos, y **todo el subsistema de etiquetas**, que no tiene rival.
- **OpenLayers** es tu pariente directo: es el único que **pinta teselas en Canvas 2D**, y por tanto el único cuyas soluciones a snapping, costuras, recorte de fallbacks, declutter sin GPU, cola con prioridad y proyecciones de píxeles se copian **sin traducir**.

---

<a name="19"></a>
## 19 · Qué significa esto para *The world generator*

Esta sección cruza lo investigado con lo que la memoria del proyecto dice de tu arquitectura actual (pasada 10: `region/tileService.ts` como embudo único, `renderedSnapshots.ts` + Dexie `renderedTiles` v26 con clave de contenido, escalafón por olas, pool con calor, canon persistido, 2D + carta + 3D compartiendo disco y encargos).

### 19.1 Lo que ya tienes bien, y con qué se corresponde

| Lo tuyo | El canon |
|---|---|
| `tileService` como **embudo único** de 2D/carta/3D | mod_tile: un único punto que traduce petición → disco → cola |
| **DISCO primero**, luego cola, luego pool | mod_tile sirve del `.meta` antes de encolar en renderd |
| **Cola corta y descartable** delante del pool | `QUEUE_MAX 64` / `REQ_LIMIT 256` + `noReqDroped` |
| **Cancelar en cola = descartar; en vuelo = aterrizar, entregar y guardar** | renderd exactamente igual: lo empezado ya está pagado |
| **Clave de contenido** (versiones + semilla + params + ediciones relevantes) | La "source key" de OpenLayers y el cache-busting por hash |
| **Escalafón por olas** (despacha la nueva, descarta la vieja) | La intención de `getTilePriority` de OpenLayers |
| El 3D **pide por contenido** y comparte disco con el 2D | El RTT drapeado de MapLibre: la textura 3D **es** el render 2D |
| Canon (contenido) separado de tesela entintada (presentación) | `reloadTile` de MapLibre: re-parsear sin volver a descargar |
| Persistencia inyectada, dedupe por contenido, segunda vista recibe copia | El patrón de `TileCache.getAndRemove` + dedupe estructural |

La conclusión honesta: **la arquitectura F1 que montaste está alineada con el estado del arte**. No hay nada en la investigación que diga "esto está mal planteado". Lo que sí hay son piezas concretas que faltan o que se pueden endurecer.

### 19.2 Las cinco cosas que la investigación dice que te faltan

Ordenadas por relación valor/esfuerzo.

**1. Sustitución por versión anterior (stale tiles) — ALTO valor, BAJO esfuerzo**

Tienes sustitución por jerarquía (padres/hijos) implícita en el render. Lo que el patrón de OpenLayers y de mod_tile añade es el escalón que **falta justo donde tu app duele más**: cuando una pincelada cambia la clave de contenido, hay un intervalo en que la tesela nueva no existe y la vieja **sí, en Dexie**, con la clave anterior.

```
al pedir la tesela (z,x,y) con contentKey K:
  1. ¿hay (z,x,y,K) en memoria/disco?         → pintar
  2. ¿hay (z,x,y, K_anterior) en disco?       → PINTAR ESA, marcar dirty, encolar K
  3. ¿hay padre cargado?                      → pintar escalado
  4. ¿hay hijos que cubran?                   → pintarlos
  5. nada                                     ← esto no debería verse nunca
```

Necesitas guardar un `staleKeys` corto (OpenLayers: `cacheSize · 0.5`) o simplemente conservar la fila anterior en `renderedTiles` una generación más. El cross-fade de 250 ms encima y el parpadeo post-pincelada desaparece.

**2. Prioridad recalculada por frame + DROP — MEDIO valor, MEDIO esfuerzo**

Tu escalafón por olas ordena por *cuándo se pidió*. El modelo de OpenLayers ordena por *dónde está ahora respecto a la cámara actual*, y lo recalcula cada frame:

```js
if (!wantedTiles[key]) return DROP;                    // ya no se quiere → fuera del heap
return 65536 * Math.log(tileResolution) + distanciaAlFoco / tileResolution;
```

Ventaja concreta: durante un pan largo, una tesela pedida hace tres olas pero que **ahora** está en el centro sube sola, sin que tengas que reordenar olas. Y `DROP` limpia el heap sin lógica de expiración de olas. Si el escalafón por olas te está funcionando, no corras; pero si vuelve a dar guerra, ésta es la evolución, no un parche.

**3. Presupuesto de frame en el despacho — ALTO valor, BAJO esfuerzo**

Tienes un techo de vuelo (`sessionCapacity`). Lo que falta es la modulación por estado:

```
cámara quieta        → hasta N en vuelo, N nuevos por tick
cámara en movimiento → N/2 en vuelo, 2 nuevos por tick
frame que ya gastó >8 ms → 0 y 0
```

Son cinco líneas en el despachador y es lo que separa un pan fluido de un pan con tirones. Y encaja con lo que ya sabes por la pasada 10: el pool compite con el hilo que dibuja.

**4. Snap a píxel entero en reposo + anchos por diferencia de redondeos — ALTO valor para "nitidez", BAJO esfuerzo**

Esto ataca directamente el punto que tienes abierto. Dos cambios en el pintado:

```js
// posición y tamaño de cada tesela, en el canvas
const nextX = Math.round(origin.x - (xIndex - 1) * dx);
const x     = Math.round(origin.x - xIndex * dx);
const w     = nextX - x;                    // ← NUNCA Math.round(dx)
```

Y activar el snap **sólo cuando la cámara está quieta** (MapLibre: `!painter.options.moving`), porque en movimiento la exactitud subpíxel importa más. Añade `imageSmoothingEnabled = false` cuando la escala sea 1:1 exacta.

**5. Índice cross-tile de etiquetas — MEDIO valor hoy, ALTO cuando el mapa esté denso**

Si tus topónimos se dibujan dentro de la tesela entintada, hoy no lo necesitas (el problema no existe: la etiqueta es píxeles). Si algún día las etiquetas pasan a ser una capa vectorial encima —que es lo que quieres para que se lean bien a cualquier zoom y no se corten en las juntas, como hace Google desde 2013— entonces necesitas las cinco piezas de §12.6: estado persistente por etiqueta, identidad cuantizada, placement throttled con presupuesto, fade por frame, y herencia de identidad entre niveles.

### 19.3 Decisiones de diseño que la investigación resuelve

**¿Metateselas, sí o no?** Sí, y por la razón que no es la obvia. El ahorro de invocaciones importa, pero lo decisivo es la **coherencia en los bordes**: un río, una cordillera o un topónimo que cruza el límite de tesela se compone bien si el render ve el metatile completo con buffer, y mal si ve 256×256 aislados. Es literalmente la razón por la que OSM renderiza 8×8. **Recomendación**: 2×2 o 4×4 en el camino interactivo (la latencia de primera tesela manda), 8×8 en el camino de pre-generación. Y siempre con buffer alrededor.

**¿Hasta qué zoom pre-generar al crear un mundo?** La tabla de §15.1 responde: hasta z8 son ~87.000 teselas acumuladas (contando desde z0), y el 75 % de eso es sólo el último nivel. Pre-generar z0..z6 (5.461 teselas) es prácticamente gratis y hace que el mundo se sienta instantáneo en la vista general. De z9-10 en adelante, bajo demanda.

**¿Niveles diádicos?** Sí. OpenLayers demuestra que se puede vivir sin ellos, pero pierdes la aritmética de bits para padres/hijos (que es la base de toda la sustitución jerárquica y de los quadkeys). El coste de mantener 2× es bajo; el beneficio estructural es alto.

**¿Qué clave usar en Dexie?** Hoy usas una clave de contenido. Añádele **orden espacial**: una clave compuesta `[z, mortonIndex]` (o `[contentHash, z, morton]`) te permite traer una región entera con **un solo `IDBKeyRange`** en vez de N gets — que es exactamente lo que necesitas al pre-cargar una zona o al montar una vista nueva. Es lo que hacen mod_tile con sus directorios intercalados y PMTiles con Hilbert.

**¿Deduplicar blobs?** Sí, y en un mundo de fantasía el ahorro es mayor que en la Tierra: mar abierto, desiertos, zonas sin explorar. Dos tablas (`tiles: clave → contentHash`, `blobs: contentHash → blob`) y de paso resuelves que dos claves de contenido distintas que producen el mismo bitmap no ocupen dos veces.

**¿Exportar mundos?** PMTiles. Fichero único, sin servidor, abrible desde cualquier hosting estático o visor compatible.

**¿WebP q0.95?** Cuidado. Para arte pictórico está bien; para **líneas finas, texto y bordes duros** (que es lo que define el estilo Campaign Cartographer) ese 5 % que se tira son justo los bordes. Merece una prueba A/B a q1.0 o PNG en los niveles altos, midiendo tamaño real: en teselas con mucho color plano la diferencia puede ser menor de lo que parece.

### 19.4 El camino al 3D, en orden

Basado en §17, y encaja con lo que ya tienes:

```
1. DEM por tesela desde tu heightmap: PNG Terrarium CON buffer de 1-2 px por lado.
   (height = (R·256 + G + B/256) − 32768 ; nunca formato con pérdida)
2. Hillshade 2D (prepare + render, sin el término de latitud) → mejora la vista 2D
   AHORA, sin tocar el 3D, y valida que el DEM es correcto.
3. Malla regular COMPARTIDA por todas las teselas (129×129) + faldones marcados
   con un flag en el atributo de posición.
4. Drapeado por render-to-texture: tus teselas 2D entintadas SON la textura.
   qualityFactor 2×, caché de ~150 teselas RTT.
5. SSE para decidir el nivel: sse = geometricError · screenHeight / (2·d·tan(fov/2)),
   umbral 2 px para el terreno, 16 px para props/vegetación.
6. Máscara de agua por tesela (1 byte si es uniforme, rejilla si es mixta).
7. Vegetación instanciada con siembra determinista por tileID (mismo PRNG → mismas
   plantas siempre, sin almacenar nada) y refinamiento tipo ADD (los hijos AÑADEN
   detalle, no reemplazan).
8. Niebla como presupuesto: relaja el SSE en la distancia y cullea lo que esté
   totalmente dentro.
```

Y el picking sin raycast (framebuffer de coordenadas: RGB = posición en tesela, alfa = índice de tesela) es media tarde de trabajo y te resuelve "¿qué hay bajo el cursor?" con elevación incluida.

### 19.5 Las tres frases que resumen la sección

1. **Tu arquitectura F1 es correcta**; lo que falta son escalones concretos del anti-parpadeo (stale por versión) y del despacho (presupuesto de frame), no un rediseño.
2. **La nitidez casi seguro es aritmética de píxeles, no de resolución**: snap en reposo, anchos por diferencia de redondeos, render a `tileSize · dpr`, y vigilar el doble resampleo.
3. **El 3D no necesita un renderer nuevo**: necesita un DEM con buffer, una malla compartida con faldones, y drapear encima las teselas que ya generas.

---

<a name="20"></a>
## 20 · Tabla maestra de constantes

Todas verificadas en el código o en la spec citada. Úsala como punto de partida — están calibradas por millones de usuarios.

### Cámara y gestos

| Constante | Valor | Origen |
|---|---|---|
| tileSize del transform | 512 (MapLibre) / 256 (Leaflet, OL) | `transform_helper.ts:158` |
| fov por defecto | 0.6435 rad = 36.87° ⇒ camDist = 1.5·height | `transform_helper.ts:179` |
| maxZoom / maxPitch | 22 / 60° | `transform_helper.ts:162-165` |
| Latitud máxima Mercator | 85.0511287798° | Bing/Leaflet |
| Umbral de zoom animable (Leaflet) | Δzoom ≤ 4 | `Map.js:107` |
| Reset del pane (float32) | 8388608 px = 2²³ | `Map.js:124` |
| Rueda: debounce | 40 ms | `ScrollWheelZoomHandler.js:21` |
| Rueda: px por nivel | 60 | idem `:27` |
| Rueda: detección trackpad | `\|delta\| < 4`; rueda si `delta % 4.000244140625 === 0` | `scroll_zoom.ts:14`, `MouseWheelZoom.js:300` |
| Rueda: deltaMode LINE / PAGE | ×40 / ×300 | `MouseWheelZoom.js:37,43` |
| Rueda: rate rueda / trackpad | 1/450 / 1/100, cap 2× por frame | `scroll_zoom.ts:18-23` |
| Rueda: suavizado | 200 ms, bezier regenerado por tic | `scroll_zoom.ts:318,372-394` |
| Trackpad pinch multiplier | ×3 (comentario: "5 = google maps, 3 = apple maps") | `MouseWheelZoom.js:49` |
| Gap para redecidir modo | 400 ms | `MouseWheelZoom.js:152` |
| Pinch: umbral de zoom | \|log2(dist/dist0)\| ≥ 0.1 | `two_fingers_touch.ts:142` |
| Pinch: umbral de rotación | 25 px de arco | idem `:216` |
| Pinch: pitch | 2 px, −0.5°/px, ventana 100 ms | idem `:336` |
| Tap: intervalo / distancia | 500 ms / 30 px | `tap_recognizer.ts:12-14` |
| Doble clic | ±1 zoom, 300 ms (ML) / 250 ms (OL) | `click_zoom.ts:31-35` |
| Click vs drag | 3 px | `Draggable.js:31` |
| Inercia: ventana | 50 ms (Leaflet) / 160+60 ms (ML) / 100 ms (OL) | — |
| Inercia pan: deceleración | 3400 px/s² (Leaflet) / 2500 (ML) / decay −0.005 exp (OL) | — |
| Inercia: linearity | 0.2 (Leaflet) / 0.3 (ML) | — |
| Inercia: velocidad mínima | 0.05 px/ms (OL) | `defaults.js:69` |
| Inercia: duración de la animación | v/(a·linearity) / 500 ms fijo (OL) | — |
| Goma de resolución | ratio 50, clamp [min/2, max·2] | `resolutionconstraint.js:50,62` |
| Goma de centro | 30 px × resolución | `centerconstraint.js:59` |
| Vuelta elástica | 200 ms, easeOut | `View.js:1840` |
| Snap de rotación a norte | 5° (OL) / 7° (ML) | — |
| flyTo: ρ | 1.42 (Leaflet, ML) / √2 (d3) | `Map.js:393` |
| flyTo: duración | S·0.8 s (Leaflet) / S/(speed=1.2) (ML) | `Map.js:424` |
| Easing por defecto | bezier(0.25,0.1,0.25,1) (ML) / `1−(1−t)^(1/linearity)` (Leaflet) / `3t²−2t³` (OL) | — |

### Teselas

| Constante | Valor | Origen |
|---|---|---|
| Nivel desde zoom fraccional | `round` (Leaflet) / `floor` o `round` (ML) / configurable (OL) | — |
| Buffer de retención | `keepBuffer = 2` filas/columnas | `GridLayer.js:152` |
| Throttle de update en pan | 200 ms (5000 con reduced-motion) | `GridLayer.js:104` |
| Sustitutos: ancestros | z−5 (Leaflet) / z−10 (MapLibre) | `GridLayer.js:434`, `tile_manager.ts:94` |
| Sustitutos: descendientes | z+2 (Leaflet) / z+3 (MapLibre) | `GridLayer.js:435`, `tile_manager.ts:95` |
| Fade de tesela | 200 ms (Leaflet) / 250 ms easeIn (OL) / 300 ms (ML raster) | — |
| Poda diferida | 250 ms tras `load` | `GridLayer.js:871` |
| Ancestros para cross-fade | 5 niveles | `tile_manager.ts:121` |
| LRU | (⌈w/ts⌉+1)(⌈h/ts⌉+1)×5 (ML) / 512 → 2× lo deseado (OL) | `tile_manager.ts:455-466` |
| Peticiones concurrentes | 16 / 8 en movimiento (ML img, OL) | `config.ts:24-25`, `Map.js:1293` |
| Nuevas por frame en movimiento | 2 | `Map.js:1296` |
| Presupuesto de frame para lanzar | 8 ms | `Map.js:1294` |
| Backoff de tesela expirada | 1000·2^(n−1) ms | `tile.ts:507` |
| Clock skew | 30.000 ms | `tile.ts:36` |
| Redondeo de coords de tesela | 5 decimales | `TileGrid.js:26` |
| Prioridad (OL) | `65536·log(res) + dist/res`; `DROP = Infinity` | `TileQueue.js:141-169` |

### Render y etiquetas

| Constante | Valor | Origen |
|---|---|---|
| EXTENT | 8192 (MapLibre) / 4096 (spec MVT) | `data/extent.ts:13` |
| Rango de coords cargadas | ±16383 (15 bits) | `load_geometry.ts:12-14` |
| Máx. vértices por segmento | 65535 | `segment.ts:136` |
| Máx. anillos por earcut | 500 | `fill_bucket.ts:8` |
| Escala de extrusión de línea | 63 (normal en 1 byte) | `line_bucket.ts:45` |
| Esquina "sharp" | 75°, offset 15 px | `line_bucket.ts:58-59` |
| Grados por triángulo (fakeround) | 20° | `line_bucket.ts:62` |
| Máx. distancia acumulada de línea | 32768 unidades de tesela | `line_bucket.ts:65-73` |
| Sublayers de depth | 14 = 3 + 10 + 1 | `painter.ts:178` |
| Stencil IDs | 1..255 | `painter.ts:307-310` |
| Rango de glifos por PBF | 256 codepoints | `glyph_manager.ts:116` |
| TinySDF | 48 px, buffer 6, radius 16, cutoff 0.25, ×2 | `glyph_manager.ts:222-232` |
| SDF shader | `SDF_PX = 8`, `inner_edge = 0.75`, `EDGE_GAMMA = 0.105/dpr` | `symbol_sdf.fragment.glsl` |
| ONE_EM | 24 | `symbol/one_em.ts` |
| Padding del índice de colisión | 100 px | `collision_index.ts:29` |
| Celda del grid de colisión | 25 px | `collision_index.ts:86-87` |
| Corte por perspectiva | ratio < 0.6 | `collision_index.ts:100` |
| Círculos de colisión | diámetro = altura del texto (mín 10), paso 2.5·r | `collision_feature.ts:57` |
| Presupuesto de placement | **2 ms por frame** | `pauseable_placement.ts:98` |
| Periodo de placement | ~300 ms (= `fadeDuration`) | `map.ts:540` |
| Rejilla cross-tile | 512/EXTENT/2 ≈ 4 px; tolerancia 1 celda (≈12×12 px) | `cross_tile_symbol_index.ts:26,102` |
| KDBush si | >128 símbolos con la misma clave | idem `:28` |
| Culling de etiquetas de línea | 256 px de margen | `projection.ts:233` |
| Workers | 1 (Safari: clamp(⌊cores/2⌋,1,3)) | `worker_pool.ts:58-60` |
| RBush del declutter | branching 9, uno por frame | `BaseVector.js:245` |

### Servidor, almacén y 3D

| Constante | Valor | Origen |
|---|---|---|
| Metatile | 8×8 = 64 teselas; cabecera 532 B | `render_config.h`, `metatile.h` |
| renderd: colas | render 64, petición 256, dirty 8000 | `render_config.h` |
| renderd: hilos / timeout | 4 / 3 s | idem |
| renderd: umbrales de carga | old 16, missing 50 | idem |
| TTL: techo / dirty / suelo | 7 días / 15 min / 3 h | `tile.conf.erb` |
| TTL: factor de last-modified | 0.20; jitter hasta 3 h | `mod_tile.c` |
| TTL por zoom | z≤9 ≥ 6 días; z≤13 ≥ 1 día | `tile.conf.erb` |
| stale-while-revalidate / -if-error | 604800 s cada uno | cabeceras reales OSM |
| MVT: extent por defecto | 4096 | spec 2.1 |
| tippecanoe: presupuesto | 500 KB / 200.000 features por tesela | README |
| tippecanoe: descarte de puntos | `-r 2.5`; micropolígonos < 4 subpíxeles² | README |
| tippecanoe: buffer | 5 px (1 px = 1/256 de tesela) | README |
| PMTiles: cabecera / raíz | 127 B / ≤16.384 B | spec v3 |
| Terrain-RGB | `−10000 + (R·65536+G·256+B)·0.1`, 0.1 m | docs Mapbox |
| Terrarium | `(R·256+G+B/256) − 32768`, 0.0039 m | tilezen/joerd |
| Hillshade defaults | dirección 335°, altitud 45°, exageración 0.43 | style-spec |
| Malla de terreno (ML) | 129×129 compartida; RTT ×2; caché 150 | `render/terrain.ts` |
| SSE | `geometricError·screenHeight / (2·d·tan(fov/2))` | `Cesium3DTile.js` |
| maxSSE | **2 px terreno**, **16 px 3D Tiles** | `QuadtreePrimitive.js`, `Cesium3DTileset` |
| Cesium: peticiones | 50 globales, 18 por servidor | `RequestScheduler.js` |
| Foveación | cono 0.3; no pedir periféricas mientras la cámara se mueve | `Cesium3DTile.js` |
| Niebla | density 2.0e-4, factor de SSE 2.0 | `Fog` |
| quantized-mesh | vértices 0..32767, normales oct 16 bits, water mask 1 B si uniforme | spec |
| Clipmaps | n = 2^k−1 (255), 12 bloques de 64², banda de morph n/10 | GPU Gems 2 |

---

---

## Anexo · Verificación

Antes de cerrar el documento se comprobó una muestra de citas contra los clones y se ejecutaron las fórmulas numéricamente.

**Citas verificadas en código** (todas correctas, fichero y línea): `SimpleCRS.scale = 2**zoom`; retención `z−5` / `z+2` de Leaflet; el `sort` por distancia al centro y su comentario literal; `setZoomAround` completo; `rho = 1.42`; `tileZoom = Math.round(zoom)`; `keepBuffer 2`, `updateInterval 200`, `zoomAnimationThreshold 4`, `wheelDebounceTime 40`, `wheelPxPerZoomLevel 60`. En MapLibre: el comentario íntegro de `EXTENT = 8192`; `maxUnderzooming = 10` / `maxOverzooming = 3`; `updateCacheSize`; `setLocationAtPoint`; `(now() − startTime) > 2` en `pauseable_placement.ts:98`; `workerCount` con su comentario de A/B testing; `MAX_PARALLEL_IMAGE_REQUESTS 16/8`; `wheelZoomDelta = 4.000244140625` y los rates 1/450 y 1/100; `roundingFactor = 512 / EXTENT / 2`; el `sort` por `distanceSq`; `viewportPadding = 100` y las dos `GridIndex(..., 25)`; `fadeDuration: 300`; `stillRecent` / `zoomAdjustment`. En OpenLayers: `getTilePriority` con su comentario del factor 65536; el presupuesto `> 8 ms → 0/0` y `8/2` en movimiento; `maxTilesLoading = 16`; `new Kinetic(-0.005, 0.05, 100)`; el smooth de resolución con `ratio = 50`; la goma de centro `30 · resolution`; el cálculo de anchos por diferencia de redondeos; `declutterTree.collides/insert`; `Math.abs(delta) < 4`, `trackpadEventGap_ = 400` y el multiplicador ×3 con su comentario; `findStaleTile_` y `staleKeys`; `DECIMALS = 5`.

**Confirmado por ausencia**: `getInterimTile` **ya no existe** en el árbol de OpenLayers — el documento lo refleja (§8.2).

**Fórmulas ejecutadas y correctas**: acumulado `(4^(z+1)−1)/3` (z5 = 1.365, z8 = 87.381) y la propiedad del 75 %; `groundResolution(0°, z0) = 156543.03392804097`; quadkey de (3,5,3) = `"213"` y la propiedad de prefijo padre→hijo; codificación MVT del punto (25,17) → `[9, 50, 34]`; flip TMS `2^11 − 1 − 791 = 1256`; **el zoom con ancla deja el punto fijo con `scale = 2` y con `scale = 0.5`** (comprobado numéricamente, error < 1e-9); Terrarium y Terrain-RGB con sus precisiones (1/256 y 0.1); el SSE decrece con la distancia; LRU de MapLibre para 1600×900 con teselas de 512 = **75 teselas**; inercia de Leaflet a 1200 px/s = 1,76 s y 1.059 px; inercia de OpenLayers a 1,2 px/ms = 230 px; `flyTo` de zoom puro 1000→250 → S = 0,976 → 781 ms.

**Discrepancias anotadas por las sondas** (no resueltas, tenlas en cuenta si vas a la fuente): el README de mod_tile habla de colas de 32 metateselas mientras `render_config.h` dice 64/256 (README probablemente desactualizado); el docstring de `coveringTiles` dice "distancia a la cámara" pero el código ordena por distancia al **centro de pantalla**; el docstring de Leaflet dice `inertiaDeceleration = 3000` y el valor real es **3400**; `TileCache` de MapLibre es FIFO por inserción pese al nombre LRU (lo admite su propio comentario); `hillshade-method` existe en el style-spec pero no se pudo leer la lista de valores del enum.

---

<a name="21"></a>
## 21 · Fuentes

### Código fuente leído directamente

- Leaflet — https://github.com/Leaflet/Leaflet — commit `c96f31a` (2026-07-27)
- MapLibre GL JS — https://github.com/maplibre/maplibre-gl-js — commit `06cac16` (2026-08-13)
- OpenLayers — https://github.com/openlayers/openlayers — commit `91db49d` (2026-08-13)
- mod_tile / renderd — https://github.com/openstreetmap/mod_tile (`render_config.h`, `metatile.h`, `request_queue.c`, `mod_tile.c`)
- CesiumJS — `Cesium3DTile.js`, `QuadtreePrimitive.js`, `Cesium3DTilesetTraversal.js`, `PerspectiveFrustum.js`, `RequestScheduler.js`

### Especificaciones

- Bing Maps Tile System — https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system
- OSM Slippy map tilenames — https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
- Mapbox Vector Tile spec 2.1 — https://github.com/mapbox/vector-tile-spec/blob/master/2.1/README.md
- MBTiles 1.3 — https://github.com/mapbox/mbtiles-spec/blob/master/1.3/spec.md
- PMTiles v3 — https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
- quantized-mesh — https://github.com/CesiumGS/quantized-mesh
- 3D Tiles (OGC 22-025r4) — https://docs.ogc.org/cs/22-025r4/22-025r4.html · https://github.com/CesiumGS/3d-tiles
- RFC 5861 (stale-while-revalidate) — https://www.rfc-editor.org/rfc/rfc5861.html
- MapLibre Style Spec — https://maplibre.org/maplibre-style-spec/

### Documentación oficial

- Google Maps JS API — coordenadas: https://developers.google.com/maps/documentation/javascript/coordinates
- Google Maps JS API — mapas vectoriales: https://developers.google.com/maps/documentation/javascript/vector-map
- Google Maps JS API — interacción y zoom máximo: `.../interaction`, `.../maxzoom`
- WebGL maps GA — https://mapsplatform.google.com/resources/blog/webgl-powered-maps-features-now-generally-available/
- Google Maps 5 para Android (vectorial + offline, 2010) — https://googlemobile.blogspot.com/2010/12/next-generation-of-mobile-maps.html
- MapsGL (2011) — https://maps.googleblog.com/2011/10/step-inside-map-with-google-mapsgl.html
- "Meet the new Google Maps" (2013) — https://maps.googleblog.com/2013/05/meet-new-google-maps-map-for-every.html
- Mapas offline — https://support.google.com/maps/answer/6291838
- S2 Geometry — http://s2geometry.io/ · https://opensource.googleblog.com/2017/12/announcing-s2-library-geometry-on-sphere.html
- Photorealistic 3D Tiles — https://developers.google.com/maps/documentation/tile/3d-tiles
- Mapbox Terrain-RGB / Terrain-DEM — https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
- Terrarium (tilezen/joerd) — https://github.com/tilezen/joerd/blob/master/docs/formats.md
- osm2pgsql `--expire-tiles` — https://osm2pgsql.org/doc/manual.html
- switch2osm — https://switch2osm.org/serving-tiles/
- OSM Tile CDN (cifras) — https://wiki.openstreetmap.org/wiki/Servers/Tile_CDN
- Tirex — https://wiki.openstreetmap.org/wiki/Tirex
- tippecanoe — https://github.com/felt/tippecanoe/blob/main/README.md
- planetiler — https://github.com/onthegomap/planetiler · martin — https://github.com/maplibre/martin

### Papers e historia

- van Wijk & Nuij, "Smooth and efficient zooming and panning" (InfoVis 2003) — matemática verificada contra https://github.com/d3/d3-interpolate/blob/main/src/zoom.js y https://d3js.org/d3-interpolate/zoom
- Losasso & Hoppe, "Geometry Clipmaps" (SIGGRAPH 2004) — https://hhoppe.com/proj/geomclipmap/
- Asirvatham & Hoppe, GPU Gems 2 cap. 2 — https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry
- Tanner, Migdal & Jones, "The Clipmap: A Virtual Mipmap" (SIGGRAPH 1998) — https://history.siggraph.org/learning/the-clipmap-a-virtual-mipmap-by-tanner-migdal-and-jones/
- Bigtable (OSDI 2006), sección Google Earth — https://www.cs.princeton.edu/courses/archive/spring13/cos598C/bigtable-osdi06.pdf
- Joel Webber, "Mapping Google" (2005, republicado) — https://medium.com/as-simple-as-possible-but-no-simpler/mapping-google-14e38b591f01
- Antin Harasymiv (Google Design), cómo funcionan las teselas — https://medium.com/google-design/google-maps-cb0326d165f5
- Cesium: horizon culling — https://cesium.com/blog/2013/04/25/horizon-culling/
- OSM operations #1096 (el bug de TTL en el camino degradado) — https://github.com/openstreetmap/operations/issues/1096

### No accesibles durante la investigación

- `win.tue.nl/~vanwijk/zoompan.pdf` (robots) — la matemática se verificó contra la implementación de d3 y las de Leaflet/MapLibre.
- `realityprime.com` "How Google Earth [Really] Works" (403, también en archive.org) — la genealogía SGI→Keyhole→Google Earth queda marcada como [GENERAL].
- Post original de Joel Webber en blogspot vía archive.org (403) — se usó la republicación del autor.

---

*Documento generado el 14 de agosto de 2026 a partir de la lectura directa de tres motores de mapas de código abierto y de fuentes primarias. Nada se ha implementado: es investigación.*
