# La piel del 3D deja de ser una foto del planeta

2026-08-04. Petición de Luis: «queremos hacer la resolución de la textura del
mundo en 3D dinámica. No sé qué approach hacer: si que los biomas y ríos sean
SVG, lo mismo que 2D, upscaling…».

## Lo que era

El 3D drapeaba **una sola textura de todo el mundo** (`renderComposite(world,
'atlas')`, 2048 px de ancho) sobre el relieve. Un téxel son 19,6 km de suelo,
siempre, mire donde mire la cámara. Acercarse no revela nada porque no hay nada
dentro: revela el mismo téxel más grande. Eso es lo que se veía como «biomas y
ríos pixeladísimos sobre la topología», y no era la malla — la malla ya se
estira sobre lo visible desde el rework de «un mundo, una cámara, un zoom».

## Por qué no SVG y por qué no ampliar

**SVG**: los biomas no son polígonos, son un campo por celda con frontera
difuminada por ruido y sombreado por píxel. Vectorizar 32 biomas sobre una
retícula de 2048×1024 son cientos de miles de caminos, y sigue sin traer
relieve, ni copas, ni surcos. Los ríos SÍ son polilíneas — y ya se dibujan como
tales dentro de la tesela (`drawWorldRivers`). WebGL además no muestrea un SVG:
habría que rasterizarlo, que es exactamente lo que hace la tesela.

**Ampliar (bicúbica, lanczos, etc.)**: no inventa nada. Quita el canto de los
cuadrados y deja puré. Esto ya está medido en este proyecto: la energía de
detalle del 2D cuando ampliaba el ráster del mundo era **0,000** a z12/z15/z18.

**Lo mismo que el 2D**: el 2D ya tiene una pirámide de teselas satélite z2–z18,
con worker, caché, respaldo por ancestro e invariante de solape verificada
(`harness/sat-overlap.ts`). Reusarla es la única de las tres que trae detalle
REAL y no cuesta un motor nuevo. Es lo que se ha hecho.

## Lo que se ha hecho

Una **segunda piel** que cubre sólo lo que la cámara encuadra, fundida encima de
la de mundo entero, alimentada por la pirámide del 2D.

- `sculpt/scene3d.ts`
  - uniformes `uZoom` / `uZoomOn` / `uZoomMin` / `uZoomSize` / `uZoomFade` y
    `setZoomSkin(tex, ventana, fundido)`. Se salta el mar cuando el mar lo
    pinta la altura (`uSmoothSea`): esa rampa sale de la misma superficie que
    ilumina el fotograma y la costa de la tesela sale de una bilineal recta —
    dejarlas discutir pone una orla de un píxel en cada orilla.
  - `focusWindow()`: **dónde está mirando**, que no es lo mismo que **qué
    alcanza a ver**. Medido: una cámara inclinada a 700 km de altura tiene una
    caja visible de 0,32 de mundo (13 000 km) y un encuadre de 0,03. Repartir
    2048 píxeles de textura entre el suelo y el horizonte es dárselos al
    horizonte. Devuelve un RECTÁNGULO, no un cuadrado: un cuadrado en uv es un
    2:1 en el suelo y la pantalla es 1,5:1 — los dos lados por separado son
    medio nivel de pirámide gratis.
- `cartography/zoomSkin.ts` (nuevo). `planZoomSkin` / `zoomSkinCovers`. La
  aritmética compartida por la vista y por los bancos.
- `components/World3D.tsx`. Un `DisplayTileStore` propio, el bloque compuesto al
  posarse la cámara (150 ms) y al llegar teselas, y el resultado en el HUD.

### Las tres decisiones que lo sostienen

1. **La piel de mundo entero NO se quita.** Se queda debajo, y la de cerca se
   funde encima con borde suave. Sustituirla es lo que se intentó la vez que no
   salió: en cuanto la malla se sale de la ventana, el muestreo se pega al borde
   y embarra medio planeta. Además el lienzo de la piel de cerca **se rellena
   primero con ese mismo ráster ampliado** y luego se le pegan las teselas
   encima, así que su peor caso es la imagen de hoy y nunca un agujero.
2. **El bloque va snapeado a la rejilla de teselas.** No cubre «la ventana»:
   cubre un número entero de teselas enteras que la contienen. Cada tesela cae
   en un píxel entero y a su tamaño natural — un mosaico, no un remuestreo — y
   el cuadrado de mundo que representa es un borde de tesela, que `tileView` ya
   define exacto. **No queda ningún origen fraccionario en toda la cadena.**
3. **La ventana que manda es la que `setWindow` DEVUELVE**, no la que se pide:
   recorta v fuera de los polos y pone suelo al tamaño.

### El techo, y por qué

`ZOOM_SKIN_MAX_Z = SAT_DEEP_Z - 1 = 8`. z8 es el último nivel que sale del
ráster del mundo amplificado por píxel; z9 ya se dibuja sobre el canon de 153 m
y eso significa generar superteselas de 156 km disparadas desde una rueda del
ratón. **Esta vista no genera nada.** Decidido con Luis.

## Medidas

### El desfase (`harness/zoom-align.tsx` + `zoom-align-run.mjs`)

LA PREGUNTA QUE COSTÓ CUATRO INTENTOS REVERTIDOS, por fin con un número. Las
dos texturas pintan la MISMA función del suelo — una rampa lineal en
coordenadas de mundo — así que si el mapeo es correcto los dos fotogramas son
idénticos, y si no, la diferencia de color ES el desfase. La iluminación no
estorba porque es afín por píxel: dos fotogramas de calibración (albedo negro,
albedo blanco) la despejan exactamente.

| caso | desfase medio (celdas de mundo) |
|---|---|
| plano · medio | 0,0069 |
| plano · muy cerca | 0,0017 |
| plano · COSTURA | 0,0039 |
| plano · COSTURA cerca | 0,0016 |
| plano · junto al polo | 0,0026 |
| globo · medio | 0,0097 |
| globo · COSTURA | 0,0042 |
| globo · muy cerca | 0,0015 |
| globo · junto al polo | 0,0026 |

Sobre un mundo de 2048 una celda son 19,6 km: eso es entre **30 y 190 metros**
de discrepancia. El suelo de la medida (cuantización de 8 bits al leer) está en
el mismo orden. **Cero, hasta donde llega la medida.**

### La escalera (`harness/zoom-plan.ts`, mundo 2048)

La piel de mundo entero: 19 568 m/px, siempre.

| encuadre | z | bloque | imagen | m/px | mejora | teselas |
|---|---|---|---|---|---|---|
| ≥ 12 000 km | — | — | — | 19 568 | 1× | 0 (apagada) |
| 8 000 km | z4 | 8×5 | 2048×1280 | 9 784 | 2× | 40 |
| 5 000 km | z5 | 9×6 | 2304×1536 | 4 892 | 4× | 54 |
| 3 000 km | z5 | 6×4 | 1536×1024 | 4 892 | 4× | 24 |
| 2 000 km | z6 | 7×6 | 1792×1536 | 2 446 | 8× | 42 |
| 1 500 km | z6 | 6×4 | 1536×1024 | 2 446 | 8× | 24 |
| 1 200 km | z7 | 9×6 | 2304×1536 | 1 223 | 16× | 54 |
| 900 km | z7 | 7×5 | 1792×1280 | 1 223 | 16× | 35 |
| 600 km | z8 | 9×6 | 2304×1536 | 611 | 32× | 54 |
| 400 km | z8 | 6×5 | 1536×1280 | 611 | 32× | 30 |

Monótona, acotada (≤ 54 teselas, ≤ 2304 px) y con margen de deriva en todos los
peldaños. `MIN_3D_SPAN_KM` sigue en 1200 km — pero eso limita la CAJA VISIBLE,
no el encuadre, así que la vista llega de hecho a encuadres de 400–600 km.

### El detalle que gana (`harness/zoom-skin.ts` + `zoom-skin-view.tsx`)

Teselas de verdad (`renderSatelliteShallowTile`) sobre relieve de verdad, misma
pose, dos fotogramas. Medido dentro de la máscara donde la piel de cerca actúa:
energía de detalle **3,75 → 4,96 (+32 %)**, 94,7 % de los píxeles cambiados,
1223 m/px frente a 39 136. Capturas en `harness/out/zoom3d/3d-{antes,ahora}.png`.

### El cableado (`harness/world3d-zoom.tsx`)

Monta el componente real: dibuja a 12–14 ms, cero errores de consola o de
página, y a vista de planeta la piel de cerca está **apagada** — la mitad
correcta de la decisión. La otra mitad no se puede llegar a medir desde aquí sin
doblar la guarda de «mundo nuevo, cámara nueva», y doblar el producto para que
quepa en el banco no se hace.

## Coste

Un bloque frío de 54 teselas a z7/z8 son ~8 s de worker medidos en el
contenedor (~150 ms por tesela, camino amplificado). **No bloquea nada**: la
imagen de mundo entero está desde el primer fotograma, las teselas se piden
desde el centro hacia fuera y cada una que llega repinta el mosaico. Por debajo
de z6 el pintor cae al camino barato del atlas y el bloque cuesta calderilla.

## Lo siguiente, si se quiere

1. **Compartir el almacén de teselas con el 2D.** Hoy el 3D tiene el suyo: se
   comparte el worker y su caché de canon, pero no los mapas de bits, así que un
   trozo que el 2D acaba de dibujar se vuelve a dibujar aquí.
2. **Bajar `MIN_3D_SPAN_KM`.** La textura ya aguanta; lo que no aguanta es el
   RELIEVE, que sigue teniendo una muestra cada 20 km. Sería una foto nítida
   sobre una colina lisa. Va con la decisión sobre el canon (ver el techo).
3. **Cancelar teselas en vuelo al cambiar de plan.** `DisplayTileStore` no lo
   expone y lo usa el 2D; hoy un paseo rápido deja cola.
