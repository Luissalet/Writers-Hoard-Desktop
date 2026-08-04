# El 2D como Google Maps — pirámide de teselas satélite

Encargo de Luis (2026-08-03): «el approach que busco es 3D topología a grandes
rasgos, 2D definición de caminos/ciudades/cuevas, Carta bonita para exportar.
El 2D no funciona: hago zoom y el nivel máximo es esta mierda pixelada».
Aclarado después: «literalmente tiene que ser Google Maps pero para el mundo
inventado — de nivel calle a nivel continente».

## La causa, medida

Dos fallos que se sumaban.

1. **Techo de cámara.** `Map2D` tenía `Math.min(28, …)` sobre la escala en tres
   sitios. 28 píxeles de pantalla por celda de mundo de 39 km son ~0,7 km/px, o
   sea ~1000 km de ancho de ventana. Ese era el zoom máximo. Por debajo no se
   podía bajar aunque hubiera datos.
2. **No había datos debajo.** Toda la vista salía de un único ráster del mundo
   (una celda ≈ 20–39 km) ampliado. `renderAtlasWindow` lo remuestreaba a
   resolución de pantalla, que suaviza pero no añade nada. Medido con la
   Laplaciana media de luminancia sobre el mismo suelo: **0,000** a z12, z15 y
   z18 — literalmente un rectángulo de un solo color. Los ríos, además, se
   estampaban una celda por punto: de ahí los escalones de la captura.

El motor ya tenía la respuesta y el 2D no la usaba: la **retícula canon** de
153 m/celda que alimentan la Carta (z10–z12) y el primer plano del 3D.

## Lo construido

- **`region/satelliteInk.ts`** — el pintor. Toma una ventana del canon y la
  pinta como suelo visto desde arriba: color por COBERTURA (bosque, monte bajo,
  brezal, labrantío, pedrera…) inclinado hacia el bioma del mundo, sombreado por
  píxel, costa sub-celda, y de cerca copas de árbol con su sombra, surcos por
  parcela, roca, setos, tejados. Cada elección estocástica va contra la retícula
  global.
- **`region/satelliteTile.ts`** — la escalera entera. z2–z8 el mundo amplificado
  con el mismo ruido que usa el canon; z9–z18 el canon. La entrega está donde una
  celda canon es un píxel, así que ninguno de los dos lados se amplía más allá de
  su propia verdad.
- **Protocolo y worker** — `renderTile` lleva `ink: 'carta' | 'satellite'`. Mismo
  worker, mismo mundo clonado, misma caché de canon: una tesela satélite y una de
  Carta sobre la misma ladera comparten lo caro y sólo cambian la pintura.
- **`Map2D`** — `DisplayTileStore` (respaldo de ancestro, LRU, dedup), techo de
  escala calculado desde el nivel más profundo disponible, rótulos en vivo de los
  lugares que devuelven las teselas profundas, y el ráster de siempre debajo como
  respaldo que nunca desaparece.
- **`core/camera.ts`** — `MIN_SPAN_KM` de 3 km a 0,4 km.

## Resultado medido

| ancho de ventana | m/px | antes | ahora |
|---|---|---|---|
| 600 km | 682 | borrones de 39 km | costa y relieve reales |
| 90 km | 102 | **un rectángulo verde** | comarca completa |
| 12 km | 13,6 | **un rectángulo verde** | bosques, campos, caminos, arroyos |
| 1,6 km | 1,8 | **un rectángulo verde** | árboles uno a uno y tejados |

Energía de detalle (Laplaciana media): 0,000 → 7,0 (z12), 10,6 (z15), 6,9 (z18).
Coste por tesela con el canon caliente: 95–215 ms. Frío, lo que cuesta una
supertesela canon (156 km de suelo), amortizada entre todas las teselas encima.

## Trampas que costaron una iteración cada una

1. **Tamaños en fracción de celda.** Copas, tejados y anchos de vía escritos como
   fracción de celda dan árboles de 40 m a nivel calle e invisibles un nivel más
   arriba. Un árbol mide metros. **Regla: el detalle del relieve va relativo a la
   celda; los objetos van en metros, siempre.**
2. **Ruido anclado a la ventana.** El hash sumaba el origen de la ventana y luego
   escalaba por la frecuencia. Como `gx0 + floor(x·f) ≠ floor((gx0+x)·f)` para
   `f ≠ 1`, cada tesela se inventaba su terreno: dos ventanas sobre el mismo suelo
   discrepaban en el **66 %** de los píxeles, hasta 130 niveles. Ese era el
   verdadero origen de las juntas visibles. Arreglado con un único objeto
   `Lattice`: nadie más en el fichero ve `gx0`. Tras el arreglo, 0,000 de media.
3. **Umbralizar el amplificador.** `buildElevation` es medio paisaje: el canon
   corre relleno de depresiones, drenaje e inundación desde el océano DESPUÉS, y
   eso es lo que convierte relieve inventado en costa. Umbralado en crudo hunde
   una llanura litoral que el mundo pone a +5 m: 45 % de la tesela bajo el agua y
   37 cruces de la línea de costa en una sola fila. Pasar un filtro paso bajo sólo
   cambió estática por manchas de leopardo. La respuesta era otra: **el mundo dice
   dónde está el mar; la amplificación sólo desplaza el contorno.**
4. **Muestreo por celda más cercana.** Deja cuadros de 153 m visibles por mucho
   que se deforme la búsqueda. Selección estocástica con pesos bilineales — pero
   con **ruido suave, no blanco**: con ruido blanco, a 611 m/px la transición es
   una banda de estática de televisión de 64 px.
5. **Surcos por celda.** Reintroducían exactamente la cuadrícula que el dither
   acababa de disolver. El canon ya genera `fields` con polígonos: los surcos
   siguen a la parcela y a su eje largo.
6. **El compuesto regional encima.** `regionDetail` (1024 celdas) se pintaba sobre
   las teselas nítidas al 0,82–0,96 de opacidad, justo en los zooms que esto venía
   a arreglar. Apagado cuando la pirámide dibuja.
7. **Tejados sobre el agua.** El reparto llega a cientos de metros del centro y
   cruzaba la orilla. Ahora comprueba el suelo.

## Verificación

- `harness/sat-overlap.ts` — la invariante: dos ventanas solapadas pintan idéntica
  la franja común. 0,000 de media; el 0,012 % restante es antialias de trazos
  cortados en el borde.
- `harness/satellite-tiles.ts` — escalera completa con tiempos, energía de detalle,
  y mosaicos 2×2 por nivel sobre llanura y sobre sierra.
- `harness/sat-worker.ts` — el pegamento: teselas satélite a través del núcleo de
  worker real, con el protocolo real. Comprueba también que el camino de la Carta
  sigue intacto.
- `harness/sat-compare.ts` — antes y ahora, mismo encuadre.

## Pendiente

- **Nivel calle de verdad**: a z17–z18 hay tejados repartidos, no el plano de la
  ciudad. `city/generate.ts` ya produce calles, manzanas, muralla, puentes y
  muelles; falta anclarlo al suelo y recortarlo por tesela.
- El primer llenado a z9–z10 pide varias superteselas canon; con la Forja van en
  paralelo, pero conviene medirlo en tu máquina.
- La inspección al pasar el ratón y el pincel siguen leyendo la celda de mundo.
  A 0,6 m/px eso es una brocha de 39 km: hay que llevarlos al canon.
- El 3D sigue con la resolución de antes. Es la siguiente tanda.

---

# Población de las ciudades (misma sesión)

Encargo de Luis: «al editar el tamaño es un tamaño totalmente arbitrario máximo,
debería poder llegar a digamos 1 millón; y cuando cambio población no se
actualiza ni guarda los cambios, debería cambiar el número dinámicamente y tener
un botón save».

## Lo que pasaba

El panel del plano tenía un control «Tamaño» de 5 a 44. Ese número es el recuento
de manzanas del dibujo, no una propiedad del lugar, y su techo era arbitrario. La
población no era editable en absoluto: `plan.population` venía del asentamiento y
el deslizador no la tocaba. Y nada se guardaba — `overrides` y `variant` eran
estado local del modal, así que al cerrar se perdía todo.

## Lo que hay ahora

- El control es **Habitantes**, de 50 a 1 000 000, con deslizador logarítmico y
  campo numérico. El número se mueve al instante.
- El **plano crece con la población**, por una curva anclada: a la población
  generada devuelve exactamente el tamaño generado, así que una ciudad que nadie
  ha tocado dibuja el mismo plano de antes (verificado: idéntico byte a byte).
  El exponente es 0,58 porque las ciudades grandes son más DENSAS.
- **Botón Guardar**, activo sólo si hay cambios. Persiste como una edición más
  (`kind: 'populate'`), con la misma clave que un renombrado, así que sobrevive a
  una pincelada, a cerrar y abrir, y a regenerar el mundo desde su semilla.
- El plano se reconstruye 260 ms después de soltar, no en cada píxel del
  deslizador: un plano de 220 manzanas cuesta 1,6 s y regenerarlo por fotograma
  haría que el control pareciese roto. Mientras tanto pone «redibujando…».

## Medido

| habitantes | tamaño | manzanas | edificios | coste |
|---|---|---|---|---|
| 500 | 5 | 40 | 16 | 2 ms |
| 5 000 | 10 | 80 | 251 | 12 ms |
| 20 000 | 23 | 184 | 586 | 32 ms |
| 100 000 | 58 | 464 | 3 956 | 161 ms |
| 400 000 | 129 | 1 032 | 20 862 | 695 ms |
| 1 000 000 | 220 | 1 760 | 50 142 | 1,6 s |

Banco: `harness/city-pop.ts`.

---

# Coherencia entre el canon y el mundo (misma sesión)

Luis, sobre la Carta: «el detalle regional es inconexo con el global, mira cómo
la geografía pequeña generada pasa del río y las marcas de bioma existentes» y
«el segundo nivel está bien pero el tercero ya rompe los ríos».

## Qué era y qué no

- **Los ríos SÍ llegan.** Primera medida: cero arroyos troncales en tres teselas.
  Falsa alarma — las tres teselas no tenían ningún río del mundo encima (un río
  cruza pocas de las 65 536 teselas canon de un mundo). Eligiendo teselas por
  las que un río pasa de verdad: 27, 58 y 77 troncales, 5–19 con nombre. La
  maquinaria de `carveWorldRivers` funciona.
- **Los biomas casi coincidían.** Primera medida: 33–42 % de discrepancia. Era
  **mi medida la que estaba mal**: comparaba el bioma redondeando `wx − 0,5`
  cuando la convención del motor (`patchNearest`) centra la celda k en el entero
  `wx`. Media celda de desfase son veinte kilómetros, y fabricaba una
  discrepancia que no existía. Con la convención correcta: **3,4–7,8 %**.
- **La costa sí estaba suelta.** 24,4 % de discrepancia de agua en una tesela
  litoral, toda ella a menos de 50 m del nivel del mar — o sea justo donde está
  la orilla, que es exactamente donde se nota. Un estuario ancho del mapa global
  podía evaporarse al bajar de nivel.

## Lo cambiado

- **`region/generate.ts` · `anchorCoastline`.** La misma regla que ya llevan las
  teselas someras: el mundo decide mar o tierra, la amplificación decide por
  dónde pasa exactamente la línea. «Exactamente» acotado a media celda de mundo
  del contorno cero, medido por el gradiente local (`|h| / |∇h|` es la distancia
  al contorno). Fuera de esa banda el signo se fija con el empujón más pequeño
  que lo fija, así que el relieve del resto queda intacto y no aparece ninguna
  meseta plana en el borde. Tierra adentro no hace absolutamente nada.
  **Medido en la misma tesela: 24,4 % → 3,0 %.**
- **`region/cover.ts` · la deformación del muestreo de bioma** de 0,71 celdas de
  mundo (28 km) a 0,31 (12 km). Sigue deshaciendo los cuadros de 39 km — a 153 m
  por celda canon, 12 km son ochenta celdas de frontera orgánica, y la tinta
  satélite disuelve lo que quede a escala de píxel — pero ya no reubica una
  selva. **Medido: 8,6–15,9 % → 3,4–7,8 %.**

Efecto secundario medido: el salto entre teselas contiguas cayó al nivel del
salto interno (z12 4,51 vs 4,04 · z16 4,91 vs 4,84 · z18 3,01 vs 3,64). Es
decir, cruzar una junta ya cuesta lo mismo que dar un paso dentro de una tesela.

## Lección

**Antes de cambiar el motor porque una medida dice que está mal, comprobar la
medida contra la convención del motor.** Un desfase de media celda me hizo
diagnosticar un problema de biomas que no existía, y estuve a punto de reescribir
la clasificación entera por ello. La pista estaba delante: «el 100 % de la
discrepancia pega a una frontera» era sospechoso — resultó que el 94–100 % de
TODA la tierra está a menos de una celda de una frontera, así que ese 100 % no
significaba nada. Una proporción sin su base no es una medida.

---

# Ciudades: forma, catedral, y el plano sobre el mapa (misma sesión)

Encargo de Luis: «lo ideal sería que las ciudades creadas apareciesen con su
forma y tamaño en el mapa»; «estabiliza la generación, cuando paso el slider
empieza a recalcularse a lo loco»; «las formas de las ciudades siempre son
circulares en vez de variar (irregulares, adaptadas a orillas de río, costas,
montañas)»; «las catedrales están consistentemente en los bordes de la ciudad,
lo cual no tiene sentido».

## El deslizador

El culpable era **Relieve**, no el de población. `reliefAmount` es dependencia
directa del efecto de reconstrucción desde cero de `CartoMap`, que limpia los
temporizadores de reposo y renderiza la lámina entera **de forma síncrona y a
resolución completa** — y además entra en la clave de generación del almacén de
teselas, así que cada paso intermedio vacía y re-rasteriza todas las teselas
residentes. Arrastrar de 0,3 a 2,0 a paso 0,1 son dieciocho renders completos y
dieciocho vaciados. Ahora hay valor arrastrado y valor asentado: el mango se
mueve al instante, el mapa 240 ms después de soltar.

## Por qué todas las ciudades eran redondas

`spiralSites` emite puntos con radio creciente monótono, así que el array **es**
un orden por distancia al centro; y la pertenencia era `i < nInner`, o sea «los
nInner puntos más cercanos al centro». La unión de las celdas de Voronoi de los
N puntos más cercanos de una espiral radialmente uniforme **es un disco**. La
relajación de Lloyd lo igualaba más y `smoothPoly(…, 0,32)` redondeaba lo que
quedara. Nada preguntaba nunca hacia dónde estaba nada.

Ahora la pertenencia es una **carrera contra un campo de crecimiento**: un punto
entra si está cerca del centro *en proporción a lo que la ciudad crece hacia
ahí*. Y lo que crece hacia dónde lo dicen la geografía real y tres armónicos
angulares:

- **río**: crece a lo largo (×1,28 en el eje, ×0,80 en cruz) y la otra orilla se
  queda en un barrio (×0,55) — que es lo que hay al otro lado de un puente;
- **costa**: no crece dentro del mar, punto; y se estira a lo largo de la orilla
  (×1,28), que es lo que hacen los puertos;
- **cuesta**: subir es caro (hasta ×0,5 en la dirección de máxima pendiente);
- **lóbulos**: tres armónicos, sin ningún eje de simetría.

Los rumbos vienen del mundo (`cityBearings` en `cartography/texture.ts`): la
dirección al mar más cercano, el rumbo local del río que pasa, y el gradiente de
elevación. Antes eran booleanos y el generador se inventaba un rumbo al azar —
por eso ninguna ciudad estaba nunca adaptada a su suelo, y por eso no se podía
poner en el mapa sin que su agua apuntase a donde el mapa dice que no.

Medido sobre 40 ciudades: alargamiento del contorno **1,11 → 1,30 de mediana,
hasta 1,87** (1,00 es un círculo perfecto), y eso sin contar los lóbulos, que el
alargamiento no mide.

## La catedral

`'cathedral'` **no está en `WARD_WEIGHTS`**, así que `pickWard` no puede
repartirla nunca, así que el ordenador por cupos —que sí pesa la centralidad— no
ve jamás un cubo de catedrales: es código muerto. Todas las catedrales salían
del recurso de emergencia, que elegía **por área y nada más**. Y la manzana más
grande de estos planos está sistemáticamente en el borde: la relajación de Lloyd
iguala el centro y deja grandes las celdas de fuera. De ahí que la catedral
acabara siempre contra la muralla.

Ahora manda la centralidad, el área sólo desempata entre manzanas igual de
céntricas, y tocar la plaza del mercado da un plus. Medido sobre 40 ciudades:
**distancia media al centro 0,13 radios, cero de 40 en el borde.**

## El plano sobre el mapa (`region/townPlan.ts`)

Una unidad de ciudad son cuatro metros — la escala que el propio generador
documenta. El origen del plano es la posición del asentamiento y sus ejes ya son
los del mundo, porque los rumbos con los que se construyó salieron del ráster en
esos mismos ejes: **no hay rotación que adivinar**. Los planos se cachean por
mundo (son función pura del id y la semilla).

Aparece desde 5 m/px: a esa resolución una ciudad amurallada de 600 m son 120
píxeles y ya se leen la muralla, las manzanas y la plaza. Por debajo de 2,5 m/px
se dibujan los tejados uno a uno, en cuatro tonos elegidos por la posición del
propio edificio — un marrón plano convertía cada manzana en una mancha de barro.
Y la dispersión de tejados inventados del pintor se apaga para los asentamientos
del mundo cuando su plano de verdad se está dibujando encima.

## Pendiente

- La inspección al pasar el ratón y el pincel siguen leyendo la celda de MUNDO.
- El 3D.

---

# Pincel y sonda al canon · resolución del 3D (misma sesión)

## El pincel medía 39 km

`tool.radius` iba en CELDAS DE MUNDO, con el deslizador de 0,125 a 60. En un
mundo de 1024 eso son 4,9 km de mínimo, y el 2D ahora dibuja a 0,6 m/px: ocho
pantallas de brocha. Las celdas son un detalle de implementación del ráster; lo
que el lector elige es cuánto suelo cubre. Ahora el control va en **metros y
kilómetros, logarítmico, de 150 m a 2500 km**. Por debajo de una celda el trazo
apenas marca el ráster mundial y **el canon lo rasteriza bien a ~153 m** — que
es lo que ya hacía `canonEdits.ts`, sólo que no había forma de pedirlo.

## La inspección respondía por la celda del mundo

Veinte o cuarenta kilómetros de suelo promediados en un número, mientras la
misma pantalla dibuja un seto. Nueva petición `probe` al worker: devuelve altura,
cobertura, pendiente y encharcamiento del canon bajo el cursor. **Nunca genera**
— responde sólo desde teselas canon ya residentes y calla si no las hay, así que
no puede convertir un hover en una espera de nueve segundos, y cuando el lector
está mirando suelo canon el canon bajo el cursor está por definición cargado.

También hay aviso cuando el terreno se está rehaciendo (`terreno · 12/30`): una
pincelada vacía el almacén de teselas —el canon hay que reconstruirlo con ella—
y sin decirlo eso se lee como «la pintura no ha hecho nada».

## El 3D

Tres cosas, y la tercera era la que Luis señaló.

1. **Malla** de [512, 1024, 1536] a **[768, 1536, 2048]**. Es estática y el
   desplazamiento va en el vertex shader: no cuesta CPU por fotograma, cuesta
   memoria de vídeo una vez (~84 MB a 2048).
2. **Suelo de zoom** de 1200 km a **150 km** de ancho. El suelo existía porque
   por debajo no había nada que enseñar; ahora sí lo hay.
3. **Relieve por debajo de la celda del mundo** (`subCellRelief` en el shader
   compartido). El campo de alturas tiene una muestra cada veinte kilómetros:
   entre dos muestras no hay NADA, y por fina que sea la malla lo único que
   puede hacer es interpolar. Se inventa fractal, con la amplitud gobernada por
   lo escarpado que ya es el sitio, apagado en el mar, y limitado en banda por
   el tamaño de la ventana. Va dentro de `heightAtDisp`, que es por donde pasan
   los vértices Y las normales, así que la luz no puede discrepar de la forma.
4. **La pintura, que era lo peor.** La piel del 3D es UNA textura del mundo
   entero: 2048 téxeles sea cual sea el encuadre. A 150 km de ancho, **ocho
   téxeles en pantalla**. De ahí «los biomas y los ríos se ven pixeladísimos
   sobre la topología» — nunca fue la malla. Ahora, cuando la ventana baja de
   una cuarta parte del mundo, se renderiza una pintura **para esa ventana**,
   por píxel, con el mismo muestreo que usa el 2D, y con los ríos como
   polilíneas en vez de una celda estampada por punto. 320 ms después de que la
   cámara pare.

### Verificación del 3D
TypeScript no sabe nada de GLSL, y un error ahí no da un fallo de compilación:
da un rectángulo negro. `harness/shader3d.tsx` + `shader3d-run.mjs` montan la
superficie real en Chromium con SwiftShader, compilan los dos shaders y
renderizan dos veces —con y sin el relieve inventado— comparando los píxeles.
Resultado: **compila, cero errores de GL, y el 16,5 % de los píxeles con terreno
cambian al encenderlo**. O sea que no es un no-op. Lo que ese banco NO puede
decir es si queda bonito: eso lo dice Luis.

---

# Tres retrocesos que metí en el 3D, y su arreglo (misma sesión)

Luis, tras probarlo: «cuando regenero un mapa pone la cámara pegada a la
superficie en vez de arriba viendo todo»; «sigues teselando de cerca, cosa que
dijimos que ya no queríamos porque salía mal, sólo un montón de ruido terrible,
el closeup lo dejamos para el 2D»; «al acercarme la textura de los ríos se mueve».

Los tres eran míos, del mismo lote.

1. **El relieve inventado, fuera.** Funciona —el banco mide que cambia el 16 %
   de los píxeles con terreno— pero lo que produce de cerca es GRANO: una manta
   de bultos verdes que no es ladera. Y la regla ya estaba puesta hace tiempo:
   el primer plano es del 2D, que tiene canon de verdad a 153 m. `uAmpDetail`
   queda en **0**. La maquinaria se conserva escrita y medida, por si el editor
   de esculpido la quiere; la vista del mundo no la enciende.

2. **El suelo de zoom, de vuelta a 1200 km.** Bajarlo a 150 no sólo dejaba ver
   el grano: es también lo que impedía que la vista abriese con el morro en la
   hierba cuando la cámara compartida trae un encuadre de treinta kilómetros —
   y el comentario del propio código lo avisaba. Además, **un mundo regenerado
   estrena cámara**: el viewport compartido describe un planeta que ya no
   existe, y adoptarlo era lo que dejaba la cámara pegada al suelo al generar.

3. **Los ríos que se movían.** La textura del mundo entero llevaba los ríos
   estampados una celda por punto (de ahí las cadenas de cuentas), y la textura
   de cerca los dibuja como polilíneas. Son dos dibujos distintos del mismo río:
   al cruzar el umbral, saltaban. Ahora **las dos rasterizan las mismas
   polilíneas**, así que el cambio sólo altera lo nítidos que están. Hizo falta
   un parámetro `wrap` en `drawWorldRivers`: tomar la rama envolvente más
   cercana es correcto para una tesela y **falso** para un ráster que ya cubre
   el cilindro entero, donde empujaría todos los ríos del este fuera del borde
   izquierdo.

Lo que SÍ se queda del lote: la malla más densa (no cuesta por fotograma) y —lo
que de verdad arreglaba la queja original— **la pintura renderizada para la
ventana de la cámara**, que a 1200 km de encuadre pasa de 19,6 km por téxel a
1,17 km. Diecisiete veces más resolución de pintura, sin añadir un solo bulto
inventado.

## Lección
Cuando el usuario ya ha puesto una regla de arquitectura («el primer plano es
del 2D»), una mejora técnica que la cruza no es una mejora. Medí que el relieve
sub-celda hacía algo y lo di por bueno; lo que no medí es si eso era lo que
había que hacer. **Un banco puede decirte que funciona y no puede decirte que
convenga.**

## Y los ríos seguían desplazándose: era el ancho

No era la textura ni el mipmap. `drawWorldRivers` calculaba el grosor en
**celdas de mundo multiplicadas por la escala de salida** — lo cual parece
físico y no lo es, porque esa escala depende de cuánto suelo cubre el ráster. El
3D cambia de ventana con la distancia de la cámara, así que el mismo río pasaba
de dos píxeles a ciento sesenta y tres: de 20 km de ancho a 100. Cambiar de
grosor y de forma al acercarse es exactamente lo que se ve como que el río se
mueve.

Ahora el grosor es una **anchura en el suelo** (0,12 + 2,1·caudal, en km), y
donde eso cae por debajo de un píxel se dibuja un pelo, que es lo único honrado
a esa distancia. Medido en `harness/river-width.ts` sobre el río mayor:

| encuadre | resolución | ancho dibujado |
|---|---|---|
| 5004 km | 9,77 km/px | 19,6 km (suelo de un píxel) |
| 1251 km | 2,44 km/px | 2,44 km |
| 313 km | 0,61 km/px | 3,05 km |

El error venía de lejos y también afectaba al 2D: 0,35 celdas de mínimo son
catorce kilómetros de arroyo en un mundo de 1024.

Y la malla vuelve a [512, 1024, 1536]: la subí para que llevara el relieve
inventado, que está apagado, y lo único que compraba era muestrear más fino un
campo que no da más — los ríos del mundo están tallados con un cauce de una
celda, así que una malla más fina que la celda convierte esa muesca en una
hilera de hoyuelos. Son las cuentas oscuras que se veían siguiendo los valles.

## Revertido: la piel del 3D vuelve a como estaba

Toqué la pintura del 3D tres veces en una sesión y las tres rompieron algo que
Luis vio al primer arranque: ruido de cerca, la cámara contra el suelo al
regenerar, y el agua pintada cayendo fuera del cauce excavado en el terreno —
y esta última **no supe encontrarla**. El mapeo de la ventana de albedo es
consistente sobre el papel (lo comprobé término a término contra
`renderAtlasWindow` y contra `baseHeightAt`), lo cual sólo significa que la
causa está en otro sitio, y desde donde trabajo no tengo forma de MIRAR esta
vista: el banco de shaders dice si compila y si cambia píxeles, no dónde cae un
río sobre una ladera.

Así que la piel vuelve entera a `renderComposite(world, 'atlas', true)` del
mundo completo, la malla a [512, 1024, 1536], el suelo de zoom a 1200 km y el
relieve inventado a cero. Del lote sólo sobrevive **la cámara nueva al
regenerar un mundo**, que era un fallo aparte y está aislado.

**El problema original sigue abierto**: una textura de 2048 para el planeta
entero son veinte kilómetros de suelo por téxel a 1200 km de encuadre, y por eso
los biomas y los ríos se ven pixelados sobre la topografía. La dirección correcta
sigue siendo renderizar la pintura para la ventana de la cámara. Lo que falta no
es idea: es **poder verlo**. Antes de volver a intentarlo hay que montar un banco
que renderice esta vista de verdad (World3D, no sólo la superficie) y compare la
posición del cauce en la geometría con la del río en la textura — igual que
`sat-overlap.ts` hace para las teselas.

**Lección**: tres intentos a ciegas sobre la misma cosa no son tres intentos, son
uno mal planteado. Cuando no puedo ver el resultado, lo que hay que construir
primero es la forma de verlo.
