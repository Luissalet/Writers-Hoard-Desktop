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

## Notas de rendimiento

| Operación | 1024×512 | Coste |
|---|---|---|
| `computeFields` (una vez por mundo) | ~0,4 s | cacheado en `WeakMap` |
| `buildHumanGeography` | ~2 s | cachear junto al mundo |
| `renderCartography` 1600×800 | ~3 s | el pergamino es la mitad |
| `renderCartography` 2400×1200 | ~5 s | export |
| `generateCity` + `renderCity` | ~0,3 s | instantáneo |

El pase ráster (pergamino, mar, anillos de costa, tintes, relieve) domina. Si hace
falta interactividad al hacer pan/zoom, la vía es cachear el ráster por
`(seed, theme, view, size)` y redibujar solo la tinta vectorial.

Conviene ejecutar `renderCartography` en un Web Worker con `OffscreenCanvas`, igual
que ya se hace con el pipeline.

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

## Pendiente

- Etiquetas de bahías, estrechos y cabos (la extracción está, falta el naming).
- Exportar a SVG además de PNG.
- Vegetación instanciada en 3D y líneas de nivel en el shader del terreno
  (recetas en `research-3d.md`, §3 y §2.5c).
- Mover los textos nuevos de la UI a `i18n` — están como literales en castellano
  para no tocar el sistema de traducciones a ciegas.
