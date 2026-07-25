# Motor cartográfico y generador de ciudades

Capa nueva sobre el motor `worldgen` existente. **No toca nada de lo que ya había**:
el pipeline físico (`core/pipeline.ts`, placas, erosión, clima, hidrología, biomas)
sigue igual y sigue siendo la única fuente de verdad. Lo nuevo consume su salida.

```
src/engines/worldgen/
├── core/                  (existente)
│   ├── naming.ts          ← NUEVO  toponimia por culturas
│   └── settlements.ts     ← NUEVO  asentamientos, caminos, reinos, features con nombre
├── components/
│   ├── CartoMap.tsx       ← NUEVO  vista carta con pan/zoom y clic→ciudad
│   ├── CityPlanView.tsx   ← NUEVO  panel del plano de la ciudad
│   ├── Terrain3D.tsx      ← MODIFICADO  prop `skin`: 'carta' | 'atlas'
│   └── WorldView.tsx      ← MODIFICADO  pestaña Carta, temas, capas, export 4K
├── cartography/           ← NUEVO  el "look Wonderdraft"
│   ├── theme.ts             paletas y estilos intercambiables
│   ├── texture.ts           canvas + cachés para la app (geografía y textura 3D)
│   ├── fields.ts            distancias, relieve local, crestas, blue-noise
│   ├── contours.ts          marching squares, suavizado, texto sobre curva
│   ├── paper.ts             pergamino procedural
│   ├── symbols.ts           montañas, colinas, árboles, dunas dibujados a mano
│   ├── render.ts            orquestador (ráster + tinta)
│   ├── overlay.ts           caminos, fronteras, ciudades, rotulación
│   └── furniture.ts         rosa de los vientos, escala, marco, cartucho
└── city/                  ← NUEVO  generador tipo Watabou
    ├── geometry.ts          Voronoi por semiplanos + cutters
    ├── generate.ts          plano de la ciudad
    └── render.ts            dibujo del plano
```

## Uso mínimo

```ts
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '@/engines/worldgen/core/settlements';
import { renderCartography } from '@/engines/worldgen/cartography/render';
import { themeById } from '@/engines/worldgen/cartography/theme';

const world = generateWorld(params);                       // ya existente
const geography = buildHumanGeography(world);              // ~2 s a 1024×512
const ctx = canvas.getContext('2d')!;

renderCartography(world, ctx, {
  theme: themeById('wonder'),        // o 'antique'
  width: canvas.width,
  height: canvas.height,
  view: { x: 0, y: 0, w: world.width, h: world.height },   // recorte = zoom
  geography,
  title: world.params.seed,
  layers: { borders: true },          // ver CartoLayers
});
```

Para una ciudad:

```ts
import { generateCity } from '@/engines/worldgen/city/generate';
import { renderCity } from '@/engines/worldgen/city/render';

const plan = generateCity({
  seed: `${world.params.seed}:${settlement.id}`,
  size: settlement.rank === 'capital' ? 34 : settlement.rank === 'city' ? 22 : 12,
  walls: settlement.rank !== 'village',
  citadel: settlement.rank === 'capital' || settlement.rank === 'city',
  river: settlement.river,
  coast: settlement.port,
  farms: true,
  culture: settlement.culture,
  name: settlement.name,
  population: settlement.population,
});
renderCity(plan, ctx, { theme, width, height });
```

Es decir: **cada asentamiento del mundo ya lleva la semilla de su propia ciudad**.
Pinchar en un punto del mapa y generar su plano es una llamada, y siempre sale igual.

## Rendimiento

Luis: «el modo carta va lagueado, muy lagueado». Lo era, y por dos causas
independientes. Se perfiló antes de tocar nada (`harness/profile.ts`).

**Causa 1 — el papel era el 76% de cada redibujado.** 1971 ms de 2609, y se
regeneraba en cada paneo aunque la hoja **no depende de la vista en absoluto**.
Dos arreglos: las capas de tono (manchas, fibra, viñeta) son suaves, así que se
calculan en una retícula a 1/3 y se interpolan, mientras el grano por píxel
—un hash, la capa que el ojo lee como textura— se queda a resolución completa;
y el resultado se cachea por (semilla, tema, tamaño).

**Causa 2 — React estaba en el camino crítico.** Cada evento de rueda hacía
`setState`, y eso re-ejecutaba el componente, sus memos y sus efectos decenas de
veces por segundo. Ahora la vista viva está en un `ref`, los eventos piden un
solo `requestAnimationFrame`, y solo se confirma a estado cuando el gesto para.

Además: las curvas de nivel de costa y lagos (marching squares sobre todo el
mundo) se cachean; la colocación de símbolos se cachea por *bucket* de zoom de
cuarto de octava; y su comprobación de solape pasó de cuadrática a rejilla
espacial — con 3.000 símbolos eran 4,5 millones de comparaciones por redibujado.

| | antes | ahora |
|---|---|---|
| primer render 1600×800 | 2800 ms | 1300 ms |
| **paneo** | **2609 ms** | **~280 ms** |
| zoom, bucket nuevo | 2609 ms | ~400 ms |
| zoom, mismo bucket | 2609 ms | ~180 ms |
| durante el gesto | render completo | blit del bitmap (libre) |
| `renderPaper` | 1971 ms | 283 ms (y cacheado) |

El render asentado es progresivo: a 110 ms dibuja a 0,58× de resolución (~1/3 de
los píxeles, ~1/3 del coste) y a 420 ms de quietud real va a resolución completa.

### Dos cosas que salieron mal midiendo

- **Colocar los símbolos filtrando por vista era además un bug.** El rechazo
  blue-noise es voraz, así que descartar candidatos fuera de pantalla *antes* del
  rechazo hacía que la distribución dependiera de dónde estabas mirando: al
  panear, los símbolos se reordenaban. Ahora la colocación es global y el
  recorte ocurre al dibujar. Como el radio de exclusión es constante en píxeles
  de pantalla, el número mundial crece con el cuadrado del zoom, así que el tope
  de símbolos escala igual — con un tope fijo, una vista ampliada salía vacía.
- **Sacar los pesos bilineales a un closure por píxel duplicó el coste** (297 →
  612 ms): un millón de closures no los optimiza el JIT. Escritos en línea,
  vuelve a ~280 ms. Perfilar cada micro-optimización, no suponerla.

Conviene, aun así, mover `renderCartography` a un Web Worker con
`OffscreenCanvas` — igual que ya se hace con el pipeline. Con ~280 ms el hilo
principal se bloquea una vez por gesto, que es tolerable pero no ideal.

## La forma de los continentes

Luis: «son demasiado redondeados». Tenía razón, y la causa era exacta.

El campo de tierra era `crust = falloff(distancia_al_cratón × mod(dirección))`.
Eso es un **dominio estelar**: desde el centro, en cualquier dirección, la costa
se cruza una sola vez. Modular el radio lo vuelve abollado, pero una península
que se curva, un fiordo que corta por detrás de la costa, un istmo o una isla
desprendida son **geométricamente imposibles**. De ahí los bultos.

Se midió antes de tocar nada, con el método del compás de Richardson
(`harness/coastline.ts`): un compás de longitud ε recorre la costa y
`L(ε) ∝ ε^(1−D)`, así que la pendiente del ajuste log-log da la dimensión.

| | antes | ahora | referencia real |
|---|---|---|---|
| dimensión fractal D | **1,00** | **1,23–1,35** | Sudáfrica 1,02 · Gran Bretaña 1,25 · lagos 1,28 |
| compacidad (1 = círculo) | 0,45–0,53 | 0,07–0,29 | Gran Bretaña ≈ 0,06 |

Tres cambios, cada uno resolviendo algo distinto:

1. **Deformación del dominio** (warp de dos niveles, receta de Quílez). Se
   deforma la *posición de muestreo*, no el radio. Eso pliega el campo sobre sí
   mismo y aparecen ganchos, golfos, istmos e islas sin pedirlo. Es el cambio
   grande. El primer nivel va deliberadamente flojo: plegar a escala de todo el
   cratón deshace el continente en encaje.
2. **El espectro fija la dimensión.** Para fBm con lacunaridad 2, el exponente
   de Hurst es `H = −log₂(ganancia)` y la dimensión de una curva de nivel es
   `D = 2 − H`. La ganancia convencional de **0,5 da H = 1 y D = 1,00: una curva
   lisa**. Ese único valor por defecto era la razón de fondo. Gran Bretaña pide
   ganancia ≈ 0,59.
3. **Una orilla poco profunda.** Lo que una perturbación mueve la costa es
   `amplitud / |∇h|`. Un margen empinado no se mueve (Sudáfrica); una plataforma
   ancha y plana deja que el mismo ruido talle entradas profundas (Noruega). La
   caída del cratón se partió en un escalón firme y una plataforma larga y casi
   llana.

Parámetro nuevo: **`coastalComplexity`** (0–1, por defecto 0,68). No es un
deslizador de ruido: mueve el warp, la ganancia y el ancho de la plataforma a la
vez. 0 da márgenes sudafricanos, 1 da Noruega.

### Lección sobre el instrumento

La primera medida decía que el arreglo apenas servía (1,086 → 1,130). Era falso:
el método del compás sobre un rango de ε de una sola década **comprime la escala
3,5×**. Se calibró contra campos fBm de Hurst conocido (`harness/calib.ts`) —
sobre una curva de D=1,239 real devolvía 1,129 — y el arreglo llevaba
funcionando desde el principio. `harness/coastline.ts` ya imprime la cifra
calibrada. Sin ese paso habría estado dos rondas persiguiendo la variable
equivocada.

## Decisiones que importan

- **Umbrales por percentil, no absolutos.** Las montañas se colocan donde el
  *relieve local* está en el decil alto de la tierra, no donde la altitud supera un
  número. Un umbral absoluto o cubre de picos una meseta o deja pelado un mundo
  suave.
- **Las cordilleras se trazan, no se esparcen.** `traceRidgeChains` sigue la
  divisoria real y cuelga los símbolos de ella; el relleno aleatorio va después.
- **Las rutas se desenvuelven una sola vez.** Reenvolver cada punto por separado en
  un mapa equirectangular teletransporta un vértice al otro lado y dibuja un camino
  cruzando el océano entero.
- **Las etiquetas se encogen para caber en su región** y se prueban con su caja
  *rotada*; además se comprueba que un topónimo de mar caiga sobre agua.
- **La costa es un dominio deformado, no un radio modulado.** Ver arriba; es la
  diferencia entre un continente y un bulto.
- **En la ciudad: supresión de ángulo y cortes sin hueco.** Los dos trucos que
  separan un plano medieval de un mosaico de cuadriláteros aleatorios. Están
  comentados en `city/generate.ts`.

## Vista 3D estilizada

`Terrain3D` acepta `skin`:

- `'atlas'` — el ráster satélite de siempre, sin cambios.
- `'carta'` — la carta dibujada colgada del relieve real. Es lo que hace que el
  3D sea *el mapa*, no otra representación del mismo mundo.

Lo que cambia con `skin='carta'`:

| | atlas | carta |
|---|---|---|
| textura | ráster de biomas | `getCartoTexture()` (2048–4096, cacheada) |
| sombreado en la textura | apagado | apagado — los símbolos traen el suyo |
| sol / ambiente | 2,1 / 0,85 azulado | 1,25 / 1,55 cálido |
| niebla | `2,2…6 × sizeZ` oscura | `0,32…1,9 × sizeZ` color pergamino |
| mar y cascarón | azul / casi negro | tono `ocean.shallow` / papel del tema |
| exageración | tal cual | ×0,62 (`skinExaggeration`) |
| encima de todo | — | hoja de papel en espacio de pantalla |

Las dos decisiones no obvias:

- **La niebla es el efecto principal.** Con `far` alto no se ve nada; a
  `0,32…1,9 × sizeZ` la tierra lejana se disuelve en el color del papel y
  aparece la perspectiva aérea. Es lo que da el aire de FlowScape.
- **La exageración va amortiguada.** Los símbolos de montaña son *dibujos* de
  montañas: al estirar la malla debajo, cada símbolo se embadurna cuesta arriba.
  Una textura satélite no tiene esa estructura y aguanta cualquier exageración.
  Se amortigua en vez de limitarse, para que el deslizador siga significando lo
  que dice.

Verificado en WebGL real, no solo compilado: `node harness/shot3d.mjs
"?skin=carta&exag=17&d=95"` levanta un servidor, abre Chromium con SwiftShader y
guarda una captura. Es la única manera de juzgar un cambio en el 3D.

## En la UI

`WorldView` tiene ahora tres pestañas: **Mapa** (atlas de siempre), **Carta**
(nueva) y **Terreno** (3D, con conmutador Dibujado/Satélite).

En la pestaña Carta: selector de tema, alternadores de bosques / caminos /
ciudades / nombres / fronteras / marco, deslizador de relieve, y **pinchar
cualquier ciudad abre su plano**. En el menú de exportar hay "Carta dibujada
(4K)".

La geografía humana se calcula una sola vez por mundo, en un `setTimeout` fuera
del camino de pintado — si se calculara dentro de un render congelaría la barra
de herramientas a mitad de clic.

## Corrientes oceánicas

`core/currents.ts`. Añadido porque la latitud sola no explica por qué Bergen
tiene árboles y Labrador, a la misma latitud, tundra; ni por qué los desiertos
más secos del planeta están en costas **occidentales** tropicales.

El modelo es flujo superficial forzado por el viento, hecho incompresible y
obligado a respetar las costas: se siembra la velocidad con el viento rotado el
ángulo de Ekman, se pone a cero en tierra y se hace una **proyección de presión**
(∇²p = ∇·u con condición de Neumann en la costa). Los giros no se dibujan:
salen de exigir incompresibilidad junto a una pared.

Pero la lección importante fue otra. La primera versión derivaba la anomalía de
temperatura **solo por advección** (trazando cada parcela aguas arriba). Un A/B
honesto (`harness/currents-ab.ts`) reveló que eso movía la lluvia costera un
**1–3 %**: el campo de viento ya hacía todo el trabajo. La advección da sus
máximos en el centro del giro, no en la costa.

El mecanismo que faltaba no es advección sino **afloramiento de Ekman**: cuando
el viento sopla a lo largo de una costa hacia el ecuador, el transporte superficial
va mar adentro y sube agua fría del fondo. Es lo que hace el Benguela y el
Humboldt, 8–10 °C por debajo de su media zonal. Con ese término:

| Costa | sin corrientes | con corrientes | cambio |
|---|---|---|---|
| trópico, occidental | 888 mm | **658 mm** | **−26 %** |
| trópico, oriental | 2009 mm | 1852 mm | −8 % |
| latitudes medias | 2685 mm | 2601 mm | −3 % |

Moraleja: **medir la contribución de una función, no suponerla.** Estuvo dos
iteraciones aportando un 2 % con una física impecable pero el mecanismo
equivocado.

## Glaciares

`core/glaciers.ts`, parámetro `glaciation` (0–1, por defecto 0,55).

Los fiordos no son ruido: son hielo. Y un río no puede hacerlos, porque la
erosión fluvial se detiene al nivel del mar — el agua necesita pendiente. El
hielo fluye por su propio peso y sobreexcava cientos de metros **por debajo**
del mar. Esa diferencia es la que justifica un pase propio.

Cinco pasos: máscara de hielo a temperatura de máximo glacial (no la actual —
los fiordos se tallaron en glaciaciones), flujo de hielo por acumulación,
abrasión ∝ flujo × pendiente sin nivel base, ensanchado lateral (la V se vuelve
U) y circos en las cabeceras.

Dos errores propios que costaron una iteración cada uno:

- **Repartir la erosión por todo el manto de hielo alisó el mundo** en vez de
  crear accidentes. El interior de un manto está congelado a su lecho y no
  erosiona casi nada; el trabajo lo hacen los **glaciares de descarga**. Restar
  un umbral al flujo normalizado antes de elevarlo a una potencia es lo que
  convierte un descenso ancho y uniforme en artesas profundas y estrechas.
- **Ensanchar demasiado borra la artesa.** El radio del difuminado tiene que ser
  pequeño.

Medido por bandas de latitud (`harness/glacier-test.ts`): D en latitudes altas
1,25 sin hielo → 1,55 con él, y el trópico intacto. **A 1024 celdas un fiordo es
subcelda** (una celda son 39 km, un fiordo 3): el efecto se ve a 2048 y mejora con
la resolución.

## Familias de lenguas

`core/language.ts`. Los topónimos generados por separado son la forma más rápida
de que un mundo parezca montado en vez de habitado. Los nombres reales son
fósiles: «Kaldvik» y «Chaldwich» parecen ajenos hasta que se sabe que los dos
vienen de *kalda-wīk, «bahía fría», y que una rama palatalizó /k/ ante vocal
anterior y la otra no. El lector que nunca aprende la regla igualmente siente el
parentesco.

Así que no hay un generador por cultura, hay un **árbol genealógico**: una
protolengua con ~68 raíces con significado, un inventario de ~30 cambios
fonéticos regulares, y ramas que acumulan conjuntos distintos de esos cambios.
Cada nombre es un compuesto de raíces con glosa real, y los cognados entre reinos
vecinos salen gratis:

```
*slo «mar»  →  Slo · Sø · Slü · Slue · Srü
```

Dos cosas hubo que aprender: los cambios **condicionados casi nunca disparan**
sobre un léxico de 68 palabras (las hijas salían idénticas, hubo que añadir
reglas incondicionadas), y hace falta **reparación fonotáctica** después de cada
derivación y de cada composición, porque si no salen cosas como «Esnuququoqu» o
raíces sin vocal.

## Gazetteer

`core/gazetteer.ts` → un documento Markdown del mundo: resumen físico, el árbol
de lenguas con tabla comparativa, cada estado con capital, pueblo, lengua,
vecinos y plazas **con etimología**, la geografía nombrada, una tabla de puertos
con la corriente que los baña, y una sección de hilos narrativos.

Todo se **lee** de la simulación. Si el documento dice que una frontera sigue una
cordillera, la sigue. Los hilos incluyen cosas como «X e Y son el mismo nombre:
ambos significan pino puerto, uno en Faunian y otro en Okkic; los dos pueblos
niegan el parentesco» — que es exactamente lo que un motor así debería poder
decirle a quien escribe.

## Ecología: 32 biomas

`core/biomes.ts`. Una rejilla de Whittaker sobre (temperatura, precipitación) es el
esqueleto correcto, pero por sí sola produce un mundo de franjas de latitud. Cuatro
cosas rompen eso, y las cuatro son lo que el ojo lee como ecología de verdad:

- **Bandas de altitud.** Una montaña no es un bioma. Subiéndola se pasa por bosque
  montano, luego pradera alpina sobre el límite del arbolado, luego roca desnuda,
  luego hielo — la misma secuencia que se recorrería de aquí al polo, comprimida en
  unos kilómetros. El límite del arbolado es un contorno de temperatura, así que se
  modela como función de la latitud: ~3,9 km en el ecuador, nivel del mar hacia 70°.
- **Corredores ribereños.** Un río grande lleva su propio bosque a través de país
  demasiado seco para sostenerlo. El Nilo es un hilo verde cruzando el Sáhara, y ese
  hilo es lo más legible de cualquier mapa de Egipto. Solo se pinta **donde el
  entorno es demasiado seco**; en cualquier otro sitio es invisible, y pintarlo
  igualmente engordaría cada río en una línea verde.
- **Sustrato.** El desierto no es un bioma, son tres: mar de arena donde el suelo es
  llano, hamada de piedra donde el viento lo ha pelado, y *badlands* donde hay
  relieve que labrar. Mismo clima, país completamente distinto. Los ergs de verdad
  son minoría —solo un quinto del Sáhara es duna— así que la prueba es estricta y va
  enmascarada por ruido a parches, lo que los convierte en regiones discretas en vez
  de un lavado uniforme.
- **Abrigo.** El manglar y la marisma salada necesitan calor **y** humedad **y** una
  costa a la que no llegue el oleaje. Son la razón de que un delta no parezca playa.

De 18 biomas a 32: manglar, marisma salada, marisma, turbera, estepa, chaparral,
bosque monzónico, bosque nuboso, bosque montano, pradera alpina, erg, hamada,
badlands y bosque de galería. Los índices se **añadieron al final** para que los
existentes no se movieran.

Una trampa que costó un mundo sin desiertos: al partir `Desert` en erg/hamada/
badlands, el `Biome.Desert` original dejó de asignarse, y el conjunto que usaba el
nombrador de geografía solo conocía ese id. Los desiertos perdieron sus nombres sin
que nada fallara. Cualquier conjunto de biomas que decida algo aguas abajo tiene que
cubrir **todo** lo que el clasificador puede emitir.

## Accidentes geográficos con nombre

`core/landforms.ts`. Lo que un lector usa para orientarse no son los continentes,
son las formas pequeñas: el cabo que dobla, la bahía en la que se refugia, el
estrecho por el que le cobran peaje, el istmo por el que tiene que pasar la
calzada, el puerto de montaña que decide dónde va la frontera. Todo eso ya estaba
en el campo de elevación; nadie se lo había preguntado.

Cada detector responde a una pregunta sobre la **forma**, nunca sobre la altura:

| Accidente | Prueba |
|---|---|
| Cabo | tierra casi rodeada de mar, a dos escalas (6 y 16 celdas) |
| Bahía | mar casi rodeado de tierra; con paredes altas y en latitud alta → fiordo |
| Estrecho | agua estrangulada por tierra en dos direcciones opuestas **y abierta en las perpendiculares** |
| Istmo | la misma prueba con tierra y mar intercambiados |
| Península | región de tierra cuyo entorno es mayormente mar, unida a algo que no lo es |
| Delta | río grande llegando a una costa demasiado llana para un solo cauce |
| Paso | una silla de montar: sube en dos direcciones opuestas y baja en las otras dos |
| Valle | tramo de río con terreno alto en ambas orillas; muy alto y estrecho → garganta |

Truco compartido: para saber «qué fracción de mar hay alrededor» se **difumina la
máscara mar/tierra**. Un box blur de radio R *es* la media local de radio R, y
cuesta cuatro pasadas sobre la rejilla en vez de un muestreo de disco por celda.

Tres cosas se aprendieron midiendo, no razonando:

1. **`elevación <= 0` no es «mar».** Los lagos endorreicos por debajo del nivel del
   mar son, geométricamente, la bahía perfecta — y ahí aparecían las etiquetas de
   bahía. Hay que quedarse solo con las masas de agua conectadas al océano.
2. **Las escalas absolutas engañan.** Una celda mide ~40 km en un mundo por
   defecto, así que «el terreno a ambos lados del paso» son dos celdas, no diez.
   Muestreando a diez celdas el detector encontró **dos** sillas de montar en todo
   el planeta.
3. **«Sube en todos los puntos de la recta» es demasiado estricto.** Por una
   cresta el terreno sube y luego pasa. Con `min(cerca, lejos)` salían cero pasos;
   con `max(cerca, lejos)` («sube en algún punto dentro de N celdas») salen catorce.

El *naming* reutiliza la maquinaria de lenguas: cada accidente recibe un nombre
acuñado en la lengua de su zona, con raíces sesgadas por tipo (un cabo se llama
por rocas y riscos, un paso por puertas y montes) y con la preposición castellana
variada de forma determinista — Cabo/Punta, Bahía/Ensenada/Golfo,
Estrecho/Paso/Canal, Paso/Puerto/Collado, Fiordo/Ría.

En el rotulado hicieron falta dos excepciones: estos topónimos **no se encogen**
para caber dentro del accidente (un cabo de siete celdas no puede contener
«Cabo Tormentas»: encogerlo daba tipografía de cuatro píxeles, y por eso en la
primera versión se colocaban todos y no se veía ninguno), y los de tierra **no
pasan el test de huella** — el nombre de un cabo va sobre el agua de al lado, que
es la convención.

## Ruinas

`core/ruins.ts`. Una ruina no es un adorno colocado al azar. Una ruina es un sitio
que **valió la pena** y que hoy no usa nadie, y eso sale del mapa gratis, porque el
generador de asentamientos ya puntúa emplazamientos. Donde puntuó alto y luego no
construyó, ahí estuvo algo:

- un puerto natural magnífico sin puerto
- un paso de montaña sin guarnición
- una confluencia de ríos sin puente
- una cumbre con vistas desde la que nadie vigila
- un manantial en el desierto del que nadie bebe
- una veta mineral sobre un límite de placas convergente

El **tipo** se deduce del emplazamiento, no de un dado: los pasos tienen fuertes,
las cumbres torres, las confluencias puentes, los desiertos templos, la veta minas.
El **estado** se deduce del clima: la selva se lo come, el desierto lo entierra,
la marisma lo ahoga, y solo el páramo frío y seco deja algo en pie.

El filtro que las convierte en ruinas: `puntuación_del_sitio × lo_desusado_que_está`,
donde lo desusado es la distancia al asentamiento vivo más cercano, ponderada por
su rango. Un puerto excelente con una capital encima puntúa cero.

Dos correcciones que hubo que medir:

- **Un ranking global daba un planeta de torres en colinas.** Las cumbres y los
  puertos producen miles de candidatos y los pasos catorce, así que el ranking
  global elegía 16 cumbres y 13 puertos y nada más. Se coge **el mejor de cada tipo
  por turnos**: cuesta algo de calidad media y compra que no haya dos ruinas ahí
  por el mismo motivo. Con eso salen los once tipos.
- **Las cumbres y las vetas son las mismas celdas.** Compiten por el mismo sitio y
  el filtro de separación se quedaba con la que llegara primero: 153 atalayas y dos
  minas. Regla: terreno alto sobre un límite convergente es **territorio minero**,
  no de atalayas.

Los símbolos se dibujan **rotos** — un hueco en la muralla, una torre partida, un
arco que falta en el puente. Esa asimetría es toda la señal: una torrecita
impecable se lee como castillo vivo, y no hay tinta gris que lo arregle.

## Pintar el mundo

`core/edits.ts` + `core/paintSession.ts` + `components/PaintPanel.tsx`.

El motor guarda un mundo como semilla + parámetros y lo regenera cuando hace
falta, que es lo que hace baratísima una biblioteca de mundos. Pintar amenaza eso
de frente: una pincelada no se reconstruye desde una semilla. Solución: un mundo
pintado se guarda como **semilla + parámetros + lista ordenada de ediciones**.
Cada edición es JSON pequeño, aplicarlas a un mundo recién generado es
determinista, y deshacer es un `pop`. Siete pinceladas ocupan 586 bytes.

Ocho herramientas: costa (tierra/mar), relieve (levantar, hundir, suavizar,
aplanar, rugosear), bioma (los 32), río, marca (poblado o ruina), rótulo y goma.

Lo que hay que acertar es la **consecuencia**. Levantar terreno no es cambiar un
color: mueve la costa, lo que cambia qué es costero, lo que cambia el bioma, lo
que cambia lo que el renderizador dibuja ahí. Así que tras cualquier edición de
terreno se recalculan los campos derivados baratos y se vuelve a clasificar el
bioma — el terreno pintado hereda ecología sensata gratis — y una pincelada de
bioma explícita manda por encima. El clima **no** se recalcula: una pincelada local
no mueve el chorro polar, y dos segundos por trazo haría la herramienta inusable.

Cinco errores que costaron su tiempo:

1. **Las cachés de cartografía estaban indexadas por el objeto mundo**, y las
   ediciones lo mutan en sitio. La isla pintada aparecía desnuda: sin tinta de
   costa, sin tinte de bioma, sin símbolos. Se arregla con un contador `revision`
   en `WorldData` que toda caché comprueba, y que también entra en las dependencias
   del efecto de React que redibuja.
2. **La máscara del trazo es el MÁXIMO de las caídas por muestra, no la suma.** Esa
   diferencia es la que hay entre un pincel y una mancha: sumando, la pintura sale
   más oscura donde el puntero fue más despacio.
3. **Pintar costa es un `max` contra una cúpula, no una interpolación hacia un
   objetivo.** La versión con interpolación se leía plausible y no funcionaba: sobre
   4 km de fondo oceánico, una pasada a fuerza completa dejaba el lecho a −330 m y
   creaba veintiuna celdas de tierra de un trazo del ancho de un país. Como `max`
   además es idempotente y respeta el terreno más alto que ya hubiera.
4. **La cúpula necesita ruido.** Una cúpula limpia le da a la isla pintada la
   silueta de una moneda, y ninguna tinta buena disimula eso.
5. **Aplicar cada trazo por separado era más rápido y estaba mal de dos maneras a
   la vez**: una edición de terreno posterior volvía a clasificar biomas y borraba
   los que ya se habían pintado, y cualquier río de la lista volvía a excavar su
   cauce en cada aplicación. Ahora siempre se **rejuega** desde una copia prístina
   de los tres campos que una edición puede tocar. Es asumible porque lo caro no
   son los trazos —son locales— sino la única pasada global; medido: **155 ms por
   pincelada, y no crece** con 60 pinceladas previas.

La geografía humana se reconstruye tras cada trazo, y ahí las marcas pintadas se
**fusionan antes de reinos y calzadas**: una villa puesta a mano entra en la red de
caminos, pertenece a un reino y se le puede generar su plano urbano como a
cualquier otra. Si se fusionaran al final se quedaría huérfana en el mapa y se
notaría.

Verificado en navegador real (`harness/paint-ui-run.mjs`, esbuild + Playwright
sobre los componentes de verdad): un arrastre sobre océano abierto crea 1177
celdas de tierra, deshacer devuelve el mundo exactamente a 152 449, y un clic
coloca un poblado que aparece nombrado en la lengua de la zona.

> Nota metodológica: la primera versión de ese test calculaba pantalla → mundo por
> su cuenta, se equivocaba (el mapa no muestra el mundo entero a zoom 1), apuntaba
> el pincel a tierra firme y concluía que el pincel apenas funcionaba. Ahora busca
> océano **muestreando los píxeles renderizados**. Es la misma lección que el método
> del divisor: calibra el instrumento antes de dejarle dirigir el trabajo.

## Ciudades: la red de calles

`city/generate.ts`. Las calles de una ciudad no son líneas dibujadas por encima.
Son **los huecos entre sus manzanas**, lo que significa que la red de calles ya
existe en el momento en que existen las parcelas: es el grafo de aristas de la
subdivisión. Enrutar por él (A\*) es lo que hace que una avenida **rodee** una
manzana como lo haría una de verdad, en vez de atravesar seis casas camino del
mercado. `weldVertices` ya hace que las parcelas vecinas compartan los objetos
vértice, así que el grafo se indexa por identidad y no necesita emparejar nada.

Tres términos en el coste hacen el resto:

- una arista que **ya lleva** una avenida cuesta 0,45 → las rutas siguientes se
  unen a la avenida existente en vez de abrir otra paralela dos manzanas más
  allá. Ese único término convierte N caminos independientes en una **red**.
- cruzar el río cuesta ×3,2 → se vadea donde la ciudad es estrecha, que es donde
  van los puentes de verdad.
- el patio del castillo cuesta ∞.

Después de las avenidas puerta → mercado se enrutan **calles secundarias** desde
los barrios más alejados hasta la red; sin ellas la ciudad tiene cuatro grandes
avenidas y un montón de patios sellados. En una ciudad grande (≥ 24 distritos) la
ronda interior del muro asciende a avenida: es como se mueve la guarnición entre
puertas sin cruzar la plaza.

**Puentes**: solo donde una calle cruza el agua de verdad, calculando la
intersección de las polilíneas. Colocarlos aparte de las calles es como los mapas
generados acaban con un puente que da a un muro ciego.

**El frente marítimo es una calle, no una losa.** Modelado como polígono relleno
dibujaba una barra marrón que cruzaba el puerto y salía por el otro lado de la
ciudad; como cinta a lo largo de la orilla se lee de inmediato como la vía a la
que dan los almacenes, y no puede escaparse de los colores de la capa de calles.
Los muelles salen de ella, cortos: a `radio×0,28` llegaban a un tercio de la
bahía y parecían escolleras.

**La muralla no entra en el mar**: se recorta al arco seco y termina en la orilla
por los dos lados. Y los distritos se recortan a la línea de costa —después de
enrutar el grafo, para no sustituir los vértices soldados de los que depende— así
que el tinte del barrio, sus patios y sus manzanas paran en el agua.

### Lo que reportó el usuario

> «me he fijado que las ciudades suelen tener la plaza del mercado siempre encima
> del río»

Cierto, y la causa era una colisión de definiciones: el río se generaba pasando
**exactamente por el centro** y el mercado se elegía como **el distrito más
central**. Las dos reglas eran razonables por separado y juntas garantizaban el
error en todos los mapas con río. Ahora el cauce se desplaza del centro un
22–52 % del radio, y el mercado (y la ciudadela) exigen un distrito **seco**: es
un veto duro, no una penalización, porque una plaza un poco menos céntrica sale
gratis y un mercado bajo medio metro de agua no.

### Cupos de barrios

Sacar cada barrio de una bolsa ponderada es correcto para los comunes y falso
para los singulares: una ciudad de veinte distritos salía con **tres catedrales**
o con ninguna, porque el 4 % de veinte es una moneda al aire y nadie le había
dicho al generador que una catedral es *la* catedral. Los barrios raros tienen
cupo (catedral 1, parque ≈ n/14, cuartel ≈ n/12) y el exceso pasa a artesanos.

Dos correcciones de dibujo del mismo tipo: el recinto catedralicio se generaba
como claustro **sin abadía dentro** (un cerco vacío), y el alcázar subdividía su
polígono en dos triángulos enormes que se leían como una pajarita. Ahora la
catedral lleva su cruz —nave y crucero— y el castillo es un patio con crujías
adosadas al muro y una torre del homenaje rectangular.

### Nota de método

Miré una captura reducida y juzgué que las avenidas eran «bandas enormes» del
ancho de una manzana; ajusté los anchos dos veces siguiendo esa impresión. Luego
**medí los píxeles contiguos** perpendiculares al eje de cada calle
(`harness/city-debug.ts`) usando la transformada real del renderizador —no una
estimada— y salieron 11 px de avenida contra 7,6 px de calle sobre 1100 px: la
jerarquía era correcta desde el principio y lo ancho que yo veía eran plazas y
patios. Tercera vez en este proyecto que el ojo pierde contra el instrumento, y
la primera versión de la sonda también mentía porque adivinaba la escala.

## Pendiente

- Exportar a SVG además de PNG.
- Vegetación instanciada en 3D y líneas de nivel en el shader del terreno
  (recetas en `research-3d.md`, §3 y §2.5c).
- Mover los textos nuevos de la UI a `i18n` — están como literales en castellano
  para no tocar el sistema de traducciones a ciegas.
- Renderizado en Web Worker: hoy el trazo se aplica en el hilo principal (155 ms).
- Más temas cartográficos y ornamento oceánico.
