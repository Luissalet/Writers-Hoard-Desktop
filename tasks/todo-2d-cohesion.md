# Modo 2D — cohesión y funcionalidad

Auditoría completa (76 hallazgos, 12 graves verificados a mano) entregada
en el chat el 2026-08-04. Aquí queda el estado de ejecución.
---

# ESTADO — 2026-08-04, fin de sesión

## Entregado y verificado (tsc + eslint + conformance + dos bancos)

**Tanda 1**
- A1 el 2D pide la geografía completa, en DOS pasadas (0,4 s los puntos, +3,3 s
  calzadas/mares/ruinas en un hueco ocioso). Medido: `places` → 0 caminos,
  `full` → 91 caminos, 163 accidentes, 29 ruinas, y la caché no degrada.
- A2 los rótulos pintados se dibujan donde los pintas · A3 los puntos naturales
  (volcán, cueva, cascada, garganta, fuente) los lee `resolveWorldLandmarks`
- A4 el trazo en vivo del 2D lleva cabeza, caída, afilado, sesgo y espejo
- A5 mares, cordilleras, llanuras y ruinas en el 2D · A6 fronteras
  (`cartography/realmOverlay.ts`, 9 939 segmentos extraídos una vez, 5 ms a
  escala planetaria, 0 dentro de un mismo reino)
- B1-B5 un solo registro `painted` de lo dibujado; los tres tests de impacto
  leen de ahí · botón derecho ya no abre planos bajo el menú del navegador
- C1 `MIN_SPAN_KM` 3 → 0,25 km · C2 el doble clic no aleja (4 001 spans probados)
- Guardia en `conformance` para que A1 no pueda volver en silencio

**Tanda 2**
- C3 el 2D adopta el viewport compartido · C4 vuelve a acotar al bajar el techo
- D1 `journeyPick` se limpia al salir de Viaje · D2 el pincel sobrevive a mirar
  otra pestaña · D3 las pestañas devuelven a la vista de la que veníais
- D4 regenerar limpia viaje, ruta, paleo, índice, ciudad y comarca
- D6 el contador del Pincel cuenta ediciones · el botón de chincheta ya puede
  cancelar (`pinning` era demostrablemente siempre falso)
- E1 la pirámide ya no desaparece al apretar el pincel
- E2 histéresis de zoom semántico (`nextSemanticTier` no la llamaba nadie)
- E3 las ciudades ya no se dibujan dos veces en hondo · E5 el compuesto regional
  sólo en modo atlas + equirect · E6 retícula por tier + escala gráfica
- E7 el sobrevuelo ya no dice «Océano» a un manglar · E8 las chinchetas pasan
  por el desatascador y `textBaseline` se fija una vez por fotograma

**Tanda 3**
- F1 la sonda reserva la sesión del worker y sólo recupera su propio manejador
  (era lo que podía dejar la pirámide sin cargar para el resto de la sesión)
- F2 un trazo en vivo pertenece a un objeto-mundo: se deshace al desmontar y no
  puede escribirse sobre otro mundo
- F3 las claves de caché identifican el OBJETO mundo, no la semilla · F4 la
  identidad de la geografía entra en la clave de teselas
- F5 la rama envuelta se mide contra el CENTRO de la vista
- F6 Ctrl+Z no toca el mundo dentro de un campo de texto, y 2D y 3D comparten
  keymap · Espacio se suelta al perder el foco
- F7 `pointercancel` limpia el arrastre · F8 el lienzo ya no se repinta entero
  al mover el ratón · E4 los nombres profundos son LRU y con guarda de generación

**Tanda 4 (parcial)**
- G2 las tres pistas ya no prometen «ver en 3D» ni «bajar a la comarca»
- G1a `COVER_LABEL_ES` ya no cambia el idioma del sobrevuelo con el zoom
  (20 claves `worldgen.cover.*` nuevas en los dos catálogos)

## Pendiente

- **G1b el barrido de idioma grande**: ~230 cadenas en duro en PaintPanel (~146),
  World3D (~40), WorldView (~41), CartoMap y los seis paneles sin
  `useTranslation`. Mecánico, mucho fichero, ningún riesgo de comportamiento.
- F9 `want()` en cada fotograma y el `cancel` de `requestTile` que se tira
- F10 fugas menores del `tileStore` · F11 el ancla del pincel sin `spec.inverse`
- F12 el radio oculto de los borradores de Punto y Camino
- B6 el anillo del pincel media celda al sur-este · D5 el chip para quitar el
  nivel paleo · E9/E10 los interruptores que no llegan a las teselas profundas
- D3b el Índice y Viaje siguen forzando la Carta porque `annotations` sólo se
  le pasa a ella (dibujar la ruta en el 2D quitaría el forzado)


---

# SEGUNDA PASADA — 2026-08-04, misma sesión

Auditoría adversarial de lo que la primera pasada cambió, más una pasada de
funcionalidad. **Ocho de los hallazgos graves eran regresiones mías.** Eso es lo
que vale de haber vuelto a mirar.

## Regresiones propias, corregidas y medidas
- [x] 🔴 **El registro `painted` mataba TODO clic en poblaciones bajo ~850 km.**
  Salté el bloque entero cuando las teselas profundas dibujan la ciudad — y ese
  bloque es donde se empujan los impactos. Resultado: el plano de ciudad, el
  pincel Camino y el selector de Viaje, muertos justo en los zooms donde se
  trabaja. Ahora se salta sólo el PUNTO; el impacto y el anillo de la punta
  pendiente se empujan siempre.
- [x] 🔴 **Quitar `!stroke.current` dejó el pincel MÁS ciego, no menos.** La
  pirámide se dibuja DESPUÉS de la ventana nítida, así que tapaba la única
  superficie que `patchLive` actualiza. El orden es condicional ahora
  (`blitSharp` antes o después según haya gesto vivo).
- [x] 🔴 **La sonda reservaba la sesión del worker y no despertaba la cola.**
  Faltaba `notifyFree()`: una tesela pedida durante los 400 ms de una sonda se
  quedaba esperando una notificación que ya no podía llegar.
- [x] 🔴 **`worldId(geography)` en la clave de teselas** tiraba la pirámide
  entera cuando aterrizaba la segunda pasada de geografía. Ahora la clave son los
  recuentos de lo que las teselas entintan.
- [x] 🔴 **`geoBusy` colgado y la pasada honda bloqueada por el pincel** — justo
  la pasada que produce los caminos que el pincel Camino necesita.
- [x] 🔴 **`abandonLive` tiraba el trazo de bioma en vez de deshacerlo.**
- [x] 🟠 **Las fronteras costaban 15 ms/fotograma en la vista por defecto.** El
  recorte estaba desactivado justo ahí (`view.w ≈ 1,02·W`). Ventana por copia +
  camino afín para equirect + fusión de tiradas colineales: **15 → 6 ms**, y
  9 939 → 5 781 segmentos dibujando la misma línea.
- [x] 🟠 El tier avanzaba un escalón por FOTOGRAMA (salto a punto fijo ahora);
  `paintable` seguía atado a la pestaña (el botón de chincheta decía «Cancelar» y
  no ponía nada); el orden de impacto pasó de distancia² a distancia lineal y
  cambiaba de ganador; la adopción de cámara guardaba lo pedido y no lo logrado;
  `realmBorders` recorría 2 M celdas desde un rAF; `regionalResolution` fijado a
  768 subía 1,44× el coste regional.
- [x] El banco no veía nada de esto: sólo muestreaba spans, nunca la vista
  ajustada. **Añadido el caso, y es el que fallaba.**

## Funcionalidad nueva
- [x] **Regenerar pide confirmación** y copia las ediciones al portapapeles antes
  de borrarlas. Un clic destruía horas de trabajo sin aviso ni deshacer.
- [x] **El sobrevuelo dice qué es lo que hay debajo**: nombre, rango, habitantes,
  reino, puerto o río — en vez del suelo. Y el reino aparece en la lectura de
  terreno, que era lo que faltaba para que las fronteras significaran algo.
- [x] **Ruinas, mares con nombre y tus propios rótulos responden al puntero.**

## Idioma — barrido completo
- [x] 453 claves nuevas, **1 618 en el catálogo**, es/en sin divergencia, cero
  claves sin resolver en todo el motor. `PaintPanel` (162), los siete paneles
  (177), `World3D` (43), `WorldView` + `Map2D` (71).

## Sigue pendiente
- F9 `want()` en cada fotograma y el `cancel` de `requestTile` que se tira
- F10 fugas del `tileStore` · F11 ancla del pincel sin `spec.inverse` · F12 el
  radio oculto de los borradores · B6 el anillo media celda al sur-este
- `tilesInView` devuelve la `tx` ya envuelta, así que las dos columnas de costura
  colapsan y el contador «terreno · n/m» cuenta de más
- Exportar PNG sigue capturando el ráster del mundo, no el mapa que estás viendo
- Nada se puede MOVER arrastrándolo; `AppliedEdits.moves` sólo lo lee
  `spatialEntities`
- Los nombres de río no salen en el 2D (`f.kind === 'river'` se salta)
- Índice y Viaje siguen forzando la Carta porque `annotations` sólo se le pasa a ella
- Tablas de etiquetas en `core/` (`MODE_ES`, `RUIN_KIND_ES`, `LINK_KIND_ES`…) sin traducir

## TERCERA TANDA — lo pendiente, hecho

- [x] **Exportar el mapa que estás mirando.** `Map2D` expone un renderizador por
  `exportRef`; el menú ofrece resolución de pantalla y doble. Antes exportaba el
  ráster del planeta entero sin ciudades, caminos, fronteras, nombres ni satélite.
- [x] **`exportCarta` ya no congela la pestaña en silencio**: cede un fotograma,
  enseña que está trabajando y avisa si falla.
- [x] **El pincel, en el 2D**: Ctrl+rueda cambia el tamaño, Alt toma el bioma de
  debajo, y la pista de abajo lo dice.
- [x] **Ancho de río en metros** (20 m – 5 km) en vez de en celdas de 39 km. La
  unidad guardada sigue siendo celdas, así que lo ya pintado se reproduce igual.
- [x] **El radio oculto de los borradores**: Ctrl+clic con Camino borraba todo
  camino en ~350 km. Ahora 2 celdas, independiente del pincel.
- [x] **El canal de teselas**: las peticiones se cancelan al salir de la ventana,
  al cambiar de generación y al desmontar; épocas para que una promesa caduca no
  borre el marcador de la nueva ni pise un bitmap sin cerrarlo; `dispose()` para
  las llegadas tardías; y `want()` deja de pedir en cada fotograma de un arrastre.
- [x] **Las dos columnas de costura ya no colapsan**: `tilesInView` devuelve la
  columna sin envolver junto al identificador envuelto, así que cada aparición se
  coloca y el contador «terreno · n/m» deja de contar de más.
- [x] **La franja basta al redimensionar en alto**: faltaba `vh` en la prueba de
  obsolescencia de la ventana nítida.
- [x] **Nombres de reino y de río en el mapa.**
- [x] El ancla del pincel ya no cae a la celda (0,0) en el margen de una
  proyección curva.

### Sigue pendiente
- Mover cosas arrastrándolas (`AppliedEdits.moves` sólo lo lee `spatialEntities`)
- Índice y Viaje fuerzan la Carta porque `annotations` sólo se le pasa a ella
- Localizador / tecla Inicio / pila de vistas anteriores
- Las comarcas guardadas no se dibujan sobre el mapa
- `eraseRivers` sigue con el radio derivado del ancho de río
- Tablas de etiquetas en `core/` (`MODE_ES`, `RUIN_KIND_ES`, `LINK_KIND_ES`…)
- El anillo del pincel miente media celda (B6)

---

# PASADA 4 — 2026-08-05 · la herramienta de fronteras, y otra ronda de repaso

## Lo que pediste
Que los países lleven un color suave — el de su frontera — y poder redibujar
fronteras: a mano con pincel, adaptándose a la geografía, y con herramientas de
dibujo tipo GIMP (rectas, curvas).

## Entregado (tsc + eslint + conformance + tres bancos, todo en verde)

**La herramienta**
- Modo `Frontera` en el pincel, con selector de país (muestrario del color de
  cada uno), cuatro formas de trazar y tres bordes donde parar el cubo.
- `edits.ts`: `realm` (pincel), `realmFill` (cubo), `realmArea` (lazo).
  `AppliedEdits.realmCells` es `Int16Array`: −2 sin tocar, −1 sin dueño, ≥0
  índice de reino. Se asigna en orden de lista, como el bioma.
- Cubo adaptativo: relleno 4-conexo por tierra, el mar siempre corta, y además
  `río` (caudal > 0,45) o `sierra` (pendiente > 0,28) si los pides.
- Lazo recto y lazo curvo (Chaikin ×2), con vista previa, cierre por primer
  vértice / doble clic / Intro, Retroceso quita esquina, Esc cancela.
- Tinte del país al 16 %, plano, en su propio tono, reproyectado igual que el
  suelo. Línea a trazos encima.
- Banco nuevo: `harness/realm-brush.ts`.

**Fallos reales encontrados y corregidos en esta pasada**
1. La frontera pintada NO llegaba a la pantalla: el parche barato — lo único que
   corre tras soltar el pincel — devolvía el mapa del generador. (lección #23)
2. La línea desaparecía al acercarte: el recorte descartaba el tramo que cruza
   la ventana. Tinta a 200 km: 0,062 % → 0,344 %. (lección #24)
3. La capa de fronteras estaba apagada por defecto y nada la encendía. Ahora la
   enciende la propia herramienta, y el interruptor ya no comparte icono con el
   retículo. (lección #25)
4. El tinte no se reproyectaba: en acimutal el suelo era un disco y el color un
   rectángulo 2:1. En mercator, un país a 45° N teñido ~1 500 km al norte.
5. La ventana de recorte de la línea mezclaba unidades (filas proyectadas contra
   celdas del mundo): 0 tramos dibujados en acimutal.
6. El cubo se quedaba en el 4 % de la retícula — menos que un país corriente — y
   al truncar en profundidad dejaba un tentáculo con agujeros junto al cursor.
   Ahora 15 %, y en anchura.
7. El clic del cubo se redondeaba mientras todo lo demás se trunca: a zoom local
   empezabas en la celda de al lado, y en costa eso es el mar y no pasaba nada.
8. Con fuerza ≤ 0,35 el pincel de fronteras no pintaba nada, en silencio.
9. Renombrar un país no hacía nada en ningún sitio: el Índice escribía
   `realm:<id>:0,0` y los dos lectores buscaban `realm:<id>`.
10. Deshacer dejaba a los pueblos con la bandera del país borrado: el parche
    escribía dentro de los objetos de la geografía base.
11. `Frontera` estaba disponible en el globo 3D, donde el commit no la conoce:
    puntero, anillo, arrastre y clic tragado. Ahora baja al salir del 2D.
12. El índice de país no se acotaba al regenerar con menos capitales: el panel
    mostraba «—» y cada trazo se descartaba sin decir nada.

**Repaso general del 2D en la misma pasada**
13. Espacio / botón central / Mayús no movían el mapa con un pincel fuera, y al
    soltar el clic abría el plano de una ciudad. Dos textos lo prometían.
14. `roadFrom` sobrevivía a regenerar: el segundo clic trazaba hacia coordenadas
    del mundo muerto.
15. Dos juegos distintos de aldeas dibujados a la vez entre 100 y 700 km.
16. La pirámide de teselas se tiraba entera al renombrar un pueblo: `canonSource`
    era un objeto nuevo en cada edición. Ahora la identidad sigue a la lista de
    ediciones serializada.
17. El alcance de Ctrl+clic era de ~78 km a cualquier zoom: borrabas un pueblo a
    60 km fuera de pantalla. Ahora lo fija la pantalla y las 2 celdas son techo.
18. Rótulo con el cuadro vacío se tragaba cada clic sin decir por qué. Ahora la
    barra de abajo lo dice.
19. En mundos de 3072 la cámara llegaba a dos niveles que la canon no soporta:
    suelo inventado, sin costa ni caminos ni nombres.
20. `setGeneration` limpiaba `lastAsk` antes de su propio return, así que la
    deduplicación de peticiones de tesela no llegó a funcionar nunca.
21. La pista del pincel prometía Alt y Ctrl+rueda en modos que no los tienen.
22. Cuatro escrituras distintas de un mismo color de reino.

## Sigue pendiente (de pasadas anteriores)
- Arrastrar objetos para moverlos (`AppliedEdits.moves` tiene un solo consumidor)
- Índice/Viaje fuerzan la Carta porque `annotations` sólo llega a `CartoMap`
- Localizador / tecla Inicio / pila de vistas
- Las comarcas guardadas no se dibujan en el mapa
- Radio de `eraseRivers` derivado del ancho del río (~235 km por defecto)
- Tablas de etiquetas en `core/` (`MODE_ES`, `RUIN_KIND_ES`, `LINK_KIND_ES`)
- El anillo del pincel miente media celda (B6)
- `kind` de accidente impreso en crudo en el globo emergente
- `pickGeneratedAt` usa `extent` de un río (nº de celdas) como radio: devuelve un
  continente a 32 celdas del clic, y deja `eraseMarkers` inalcanzable
- La capa de caminos sigue sin la vía afín rápida que sí tiene la de fronteras

## NADIE HA EJECUTADO NADA DE ESTO EN LA APLICACIÓN
Tres bancos en verde y los tres cerrojos del proyecto pasando no son un arranque.

---

# PASADA 5 — 2026-08-05 · ciudades, carta dibujada y los pendientes del 2D

## CIUDADES (tandas 0, A, B, C, D + un solo dibujante + banco)

**Jerarquía nueva**: distrito → manzana → parcela → casa. La celda de Voronoi se
parte en manzanas con callejones que van de calle a calle, y cada manzana se
construye por su perímetro: parcelas de frente estrecho, casa delante, corral
detrás, con un paso de carro que atraviesa la hilera. Medidas en metros: un
artesano tiene 5,5–8,3 m de fachada; un patricio 11–18; un arrabal 3,6–5,4 con
medianeras pegadas. Mediana de casa 68 m², dentro de la horquilla 40–120.

**Plazas** como objeto: empedrado, monumento (pozo, cruz, picota, fuente),
soportales y manzanas que le dan fachada. Secundarias: atrio, plaza del puerto,
ensanche de puerta, plazuela de cruce. Un pueblo de 18 distritos saca 4.

**Puertas donde llega el camino**: `roadBearings` del atlas coloca la puerta en
el vértice de muralla que mejor case (3° y 2° de error medidos), y el camino
sale por su rumbo en vez de pasearse. 0 de 38 caminos huérfanos.

**Muralla como fábrica**: grosor, adarve, dos caras, almenas, torres elegidas por
esquina (24 → 14 en el mismo pueblo), casas-puerta orientadas, barbacana, foso.

**Agua con forma**: litoral real del mundo (marching squares sobre la isolínea
cero, 73/73 puertos), dársena con dos puntas, río trazando el cauce de verdad
con anchura sacada del caudal (59–109 m medidos).

**Nombres propios** acuñados en la lengua de la cultura del sitio: 13 distritos
nombrados en un pueblo de 18, ~37 en una metrópoli.

**Edificios con oficio**: 14 tipos, tejados a dos aguas con caballete orientado
a su calle, tonos por material (teja, paja, plomo, sillería, tabla).

**Un solo dibujante**: `drawCityBody` con niveles de detalle; `townPlan.ts` pasó
de 233 a 169 líneas y ya dibuja patios, plazas y muralla sobre el satélite.

**Fallo grave encontrado y corregido**: el arco de muralla en la costa tomaba el
PRIMER tramo seco, no el más largo — 2 de 14 semillas costeras salían sin
muralla, sin puertas y sin caminos.

## CARTA DIBUJADA (objetivo Wonderdraft / CC3)

Tipografía con serifa de verdad (las dos familias caían en DejaVu Sans);
símbolos de relieve con perspectiva aérea, inclinación al valle, solape y
degradado hacia el papel; sombreado en dos escalas con smoothstep; hachurado de
pendiente; rótulos que siguen la costa y la sierra con espaciado que se abre;
isóbata de plataforma, punteado de mar abierto, orilla de lago con peso; orla
ajedrezada, cartela biselada, rosa de los vientos. La pasada de rótulos bajó de
27,2 a 14,1 ms por fotograma.

## LOS PENDIENTES DEL 2D

Arrastrar para mover objetos (ciudades, ruinas, accidentes, chinchetas, con
fantasma y línea al origen, Esc cancela); tecla Inicio, pila de vistas con
Retroceso y localizador; comarcas guardadas dibujadas sobre el mapa; el anillo
del pincel mentía media celda (medido: centroide desviado +0,500,+0,500);
Índice y Viaje ya no fuerzan la Carta; el `kind` en crudo del globo emergente
pasa por catálogo.

## RONDA DE CIERRE — 2026-08-05, tarde

Dos de los seis rojos, cerrados, y con la causa encontrada instrumentando en vez
de parcheando (lección #27 aplicada a sí misma):

**La salida rodada: 60,0 % → 90,4 %.** La sonda midió el pueblo con el mismo
dominio que el banco y encontró **242 bolsas de suelo selladas**, la mayor de
3 600 m² — no eran corrales de casa sino interiores de manzana enteros, en
barrios de artesanos, mercaderes y puerta. La causa: el paso de carro se abría
en UNA sola tira, la más larga, así que el corral colgaba de un único frente, y
si ese frente daba a un callejón cerrado la bolsa entera quedaba muerta. Un paso
por cada frente — que además es lo normal en una manzana de perímetro — lo
llevó a 93,3 % de suelo alcanzado y 90,4 % de casas con fachada.

**Las avenidas estranguladas: 40 de 42 → ninguna.** La calzada se suaviza con dos
pasadas de Chaikin y la curva recortada se mete por dentro de la manzana que
bordeaba; ahí las casas se levantaban encima. Se tala el corredor al final, con
DOS varas: por el centro al ancho completo (casa plantada en la calzada, se cae
entera) y por la esquina sólo al ancho de rodada (un pico sobre el arcén es una
fachada irregular, que es lo normal; un pico en la rodada es la calle cortada).
Con una sola vara por esquina la avenida se iba a 27,8 m de mediana y se llevaba
el 17 % del caserío. Con las dos: p05 9,2 m, mediana 14,0 m, −8 % de casas.

## SIGUE ABIERTO — MEDIDO, NO ADIVINADO

`harness/city-quality.ts` (32 comprobaciones) deja **4 en rojo**:

1. Fachada al 90,4 %, con el listón en 92 %. Peor ciudad 85,8 %.
2. 3 de 38 puertas no se alcanzan en carro desde el mercado (eran 5).
3. Dos vértices de calle dentro del mar (a 13,3 y 9,1 m de la orilla).
4. Dos puertas al agua: 0,5 m de tierra hasta el mar en una, y 14,9 m al eje de
   un río de 38,1 m en otra.

Y lo que ya estaba (embarcaderos de astilla, el agua del plano contra la del
ráster). Lo de más abajo es el estado anterior, que se deja por trazabilidad:

1. **Sólo el 60,0 % de las casas tiene salida rodada** (era 50,8 %; el
   retranqueo al trazado y el paso de carro lo subieron 9 puntos). El reparto
   delata dónde: arrabal 38 %, artesanos 51 %, plaza 100 %. Ensanchar los
   callejones NO movió el número, así que la hipótesis del ancho es falsa y hace
   falta una investigación dedicada, no otro parche a ojo.
2. **40 de 42 avenidas se estrangulan** por debajo del ancho de un carro en
   algún punto, con mediana sana de 9,2 m.
3. **5 de 38 puertas no se alcanzan en carro desde el mercado.**
4. Dos vértices de calle dentro del mar y dos puertas al agua (0,5 m de tierra;
   14,9 m al eje de un río de 38 m).
5. `plan.piers` mide 4×14 unidades: se lee como una astilla a escala de lámina.
6. El agua del plano y la del ráster satélite discrepan ~100 m y se cruzan en el
   muelle; por eso `townPlan.ts` pasa `water: false`.

Y de las notas de los agentes, sin tocar todavía:
- `moves` no lo honran `buildHumanGeography` ni `patchGeography`: un pueblo
  movido en el 2D sigue en su sitio en la Carta, el 3D y el atlas
- los rótulos pintados no tienen identidad, así que no se pueden arrastrar
- borrar un pueblo pintado a mano no surte efecto en la vía barata
- `cityParamsFor` necesita la geografía en `townPlan.ts:53` o las teselas salen
  con 0 rumbos de camino
- `pickGeneratedAt` usa la longitud del cauce de un río como radio de alcance
- `eraseRivers` sigue barriendo ~235 km

## NADIE HA EJECUTADO LA PASADA 5 EN LA APLICACIÓN
tsc, eslint y conformance en verde (1731 claves), y los bancos de ciudad, carta
y fronteras pasando. Eso no es un arranque.

---

# PASADA 6 — 2026-08-10 · el 3D, tipo FlowScape

La tercera pata del trípode del proyecto, que seguía intacta.

## PRIMERO, EL INSTRUMENTO

De los seis bancos 3D, **tres estaban muertos** (importaban un componente que ya
no existe, o un `three.module.js` que no está) y **el único que monta el
`World3D` real no compilaba**. Arreglado — y al arreglarlo apareció algo peor:
montaba, no se quejaba y devolvía `ok: true` **sin dibujar nada**. El componente
se coloca con clases de Tailwind (`absolute inset-0`) y la página del banco no
lleva Tailwind, así que el contenedor medía cero, el lienzo nacía de 1100×8 y la
captura era negra con una tira de terreno arriba. Seis utilidades de CSS
declaradas a mano y el banco pasó a ver lo que ve el lector.

## CIELO Y AIRE  (`sculpt/sky.ts`, 527 líneas)

Antes: `scene.background = 0x0e1116`, un rectángulo gris. Sin niebla de ningún
tipo. Ahora: triángulo a pantalla completa (no cúpula — el `far` se recalcula
cada fotograma entre 720 y varios miles, y una cúpula de radio fijo o entra en
el `near` o la corta el `far`), degradado que responde a la altura del sol con
cinco claves resueltas en CPU, disco solar con aureola, dispersión cálida en el
horizonte, ~8.800 estrellas de picado entero, y anillo atmosférico en el limbo
del globo. `horizonColor()` es el gemelo exacto en CPU del shader.

## AGUA  (`sculpt/water.ts`, 668 líneas)

Antes: `MeshBasicMaterial` azul al 50 % — sin luz, literalmente, porque la escena
no tiene ni una sola `THREE.Light` — que terminaba en el borde del mapa. Ahora:
Fresnel sobre el reflejo del propio cielo, destello solar en dos lóbulos con
compresión, oleaje de cinco octavas con derivada analítica y frecuencia atada al
píxel, color por profundidad con la MISMA reconstrucción suavizada que usa el
terreno (para que las dos orillas crucen el cero en el mismo sitio), espuma con
ancho medido en pantalla, y el plano sigue a la cámara: el océano ya no se acaba.

## LO QUE HIZO FALTA PARA QUE ESO SIGNIFICARA ALGO

- **Niebla atmosférica en el terreno.** Sin ella, al atardecer el mar estaba
  naranja hasta el horizonte y las islas lejanas seguían verde saturado. La
  distancia de niebla es LA MISMA CUENTA que se hace el agua por dentro; si los
  dos números se separan, la costa lejana se parte a lo largo de la orilla.
- **Luz del sol con color e intensidad.** El terreno se iluminaba con constantes
  y de noche salía a pleno mediodía. Hay control de hora del día.

Coste medido: **+3,6 % sobre el terreno solo** (rasterizador por software; sólo
la proporción es trasladable).

## PASEO — LA CÁMARA A LA ALTURA DE LOS OJOS

Sin un segundo sistema de cámara: se reaprovecha el orbitador poniéndole el
punto de mira a un palmo delante, así que girar deja de rodear el paisaje y pasa
a ser mirar alrededor. La rueda anda, con paso proporcional a la altura sobre el
suelo. Se apaga solo al pasar a globo. `maxPolarAngle` se abre a 172°.

## VEGETACIÓN  (`sculpt/scatter.ts`, ~1.360 líneas)

Antes: cero instancias, cero billboards, cero puntos — los bosques eran un color
en una textura. Ahora: siembra determinista por rejilla jitterada sobre la
ventana visible, filtrada por bioma, pendiente, altura y límite del arbolado
(que sale de `world.temperature`, ya ajustada por altitud). Cinco especies.

- Tope 20.000 instancias × 12 triángulos = 240 k, menos que la malla del terreno
  en su ajuste más bajo (524 k). Pico observado 10.940.
- Siembra 2–10 ms, **4 de 200 fotogramas** en un paseo que gira un tercio de
  vuelta y se aleja 4×. Media 0,15 ms/fotograma.
- Dibujo ≈ 12 % del terreno. Una sola llamada opaca.
- Tamaño pleno por debajo de 900 km; desaparece hacia 3.400. **Cero instancias a
  encuadre de planeta**, donde el color del atlas ya lleva los bosques.
- Determinismo comprobado: 0 píxeles distintos tras irse y volver.

Y un **contador propio en el HUD** (`{n} plantas · {ms} ms de siembra`), porque
sin él un fotograma que se va de 14 a 3.688 ms no se puede atribuir. Con él se
atribuyó en un vistazo: cero instancias en esa pose, luego no era la vegetación
— eran 41,3 triángulos por celda contra 4,0, o sea otra pose.

## FALLOS ENCONTRADOS Y CORREGIDOS EN EL CABLEADO

- `Cannot access 'scatter' before initialization`: sembraba antes de crear el
  módulo. Lo cazó el banco del componente real en la primera pasada.
- Tres declaraciones sin usar en `scatter.ts` que el `tsconfig` del proyecto
  rechaza y mi comprobación en la nube no: el `tsconfig` de aquí es más estricto.

## SIGUE ABIERTO EN EL 3D

- `setSubCellRelief` sigue apagado (relieve inventado; en su día «daba ruido»).
- `setDetailPatch`/`setDetailAlbedo` siguen llamándose una vez con `null`: un
  tercio de los dos shaders está compilado y es inalcanzable.
- `ZOOM_SKIN_MAX_Z = SAT_DEEP_Z − 1`. El propio comentario dice que, ahora que
  el suelo de encuadre bajó a 150 km, éste es lo primero que hay que subir — y
  que entonces hay que decidir qué hacer con la generación de canon.
- El balanceo de la vegetación (`KIND_WIND`) está decidido y sin cablear: pide un
  atributo más por instancia.
- Sin nubes, sin sombras proyectadas por las plantas, sin estaciones.

## NADIE HA EJECUTADO LA PASADA 6 EN LA APLICACIÓN
tsc, eslint y conformance en verde (1.735 claves). Los bancos de cielo/agua,
vegetación y el del componente real, dibujando. Eso no es un arranque.

---

# PASADA 7 — 2026-08-11 («super tanda»: pendiente entero + cohesión decidida)

Luis contestó las dos decisiones abiertas: **cohesión** (5.1) y **el 3D
consume** (5.2). Esta pasada ejecutó la lista completa de `PENDIENTE.md`
(las cinco averías confirmadas, la deuda funcional, los rojos de ciudad) y las
dos decisiones. Verificación: tsc -b, eslint --max-warnings=0, conformance
(1.821 claves, es/en sin divergencia), city-quality **32/32 EN VERDE (primera
vez)**, road-overlay intacto (misma tinta por nivel, costura 1,0 celdas),
road-affine-bench (tinta idéntica byte a byte), consume-only-probe (declinar
0,3 ms / generar 31,9 s / residente 3,0 s), views-smoke completo antes y
después (el después, corriendo al escribir esto; el map2d rojo del antes era
el defecto 1.2, ya guardado).

## El reloj del 3D decía 13 ms en una máquina de 15 s (1.1)
`draw()` cronometraba SU JavaScript; el fotograma real (rasterizado incluido)
sólo se ve entre dos dibujos ENCADENADOS. Ahora `frameGapAvg` muestrea eso, y
de él comen los tres mecanismos que antes hacían lo contrario de lo que debían:
- el HUD dice el intervalo real (el banco lo enseña: «31641 ms» en SwiftShader);
- el vigilante usa plazo `max(500, gap·4, cost·4)` Y cada disparo realimenta la
  media (backoff geométrico: converge en 2-3 intentos en vez de matar el reloj
  a los 500 ms — antes 1 cancelación medida en globo y `rafAlive` nunca volvía);
- tras cada dibujo de rescate queda UN rAF canario armado: si el compositor lo
  entrega, el reloj estaba vivo y `rafAlive` vuelve a `true` (antes era condena
  perpetua: la vista dibujaba desde el setInterval de por vida);
- la escalera de calidad decide con el número real (antes SUBÍA pixelRatio a
  0,07 fps) y el amortiguado se apaga de verdad por debajo de fotograma útil.

## Las otras cuatro averías de la lista
- **1.2** los tres `getContext('2d')!` sin guarda de Map2D (:753, :1352, :4342)
  ya no pueden comerse el fotograma: tesela en blanco o fotograma saltado, y
  el bucle reintenta. Reproducción guardada: views-smoke world3d-globo map2d.
- **1.3** la adopción del globo usa geometría de casquete: β = semiarco pedido,
  d = R·(cos β + 1,1·sin β / sin(halfMin)). En β=90° da EXACTAMENTE el posado
  por defecto (3,99·R), así que pulsar «Globo» con el encuadre por defecto ya
  no recorta el planeta por los cuatro lados (antes: tope 3,42·R < encaje 3,63).
- **1.4** `HumanGeography.depth` existe y la barra de estado no enseña ceros
  falsos: a `places` dice asentamientos y reinos, sin «0 ruinas» inventado.
- **1.5** `worldgen.cityPlan.atlasRoads.one/.many` («1 camino»).

## La deuda funcional, saldada
- `moves` lo honran `patchGeography` Y `buildHumanGeography` (pueblos, ruinas
  y accidentes; la llave es el ORIGEN, el dibujo el destino; lo movido no se
  ahoga por la costa de nadie). Los caminos siguen llegando al solar antiguo
  hasta el pase completo — decisión documentada, apuntada en PENDIENTE.
- Los rótulos pintados tienen identidad (`label:x,y`, EditTarget nuevo) y se
  arrastran como todo lo demás; la mudanza se dibuja en el 2D y en la carta.
- Borrar/renombrar/mover un pueblo PINTADO surte efecto en la vía barata (el
  bucle de marcadores de `patchGeography` ignoraba gone/ren/pops/moves).
- `pickGeneratedAt` ya no usa `extent` como radio: puntería (`tol`) para todo,
  y `eraseMarkers` vuelve a ser alcanzable (antes un continente respondía a 32
  celdas del clic).
- `eraseRivers`: alcance de puntería + ancho/2 (antes ~235 km por defecto).
- `cityParamsFor` recibe la geografía en `townPlan` (0 rumbos → puertas donde
  no llega camino, y DOS planos distintos del mismo pueblo según la vista).

## Caminos: vía afín + desenrollado memorizado
La misma `linear` que fronteras (sólo equirect; toda otra proyección curva) y
`unwrapRoad` memorizado por objeto camino. Medido en `road-affine-bench`:
geometría 1,53 → 1,17 ms por copia y ~7.700 asignaciones de `Pt` menos por
fotograma; el fotograma completo apenas se mueve (7,6 → 7,2 ms) porque el
grueso es el TRAZADO de Skia — dejado por escrito para que nadie vuelva ahí a
buscar milisegundos de stroke. Tinta comprobada idéntica byte a byte.

## Ciudad: 32/32 en verde (primera vez)
Las sondas nuevas hicieron el diagnóstico (lección #29: dominio e instrumento):
- las tres puertas ciegas eran DOS enfermedades: dos puertas dibujadas sobre la
  escotadura CÓNCAVA de la muralla (el suavizado corta la esquina y el punto
  cae a 4-7 u del vértice soldado, sobre labranza: el disco de la puerta era
  una isla de 315 celdas) — arreglo: una puerta exige suelo urbano detrás
  (contains o ≤2,2 u de un distrito interior); y una puerta cuyo único camino
  al mercado atravesaba el patio del castillo (peso infinito: «BFS puro llega,
  BFS finito no») — arreglo: la ciudadela nunca se sienta sobre un vértice
  ancla de puerta.
- el patio de armas era la mayor bolsa sellada de todas las ciudades grandes
  (5.000-11.800 m²; fachada castle 81 %): la crujía que mira al mercado se
  parte en dos con hueco de carro (1,5 u) — la puerta del bailey, sin sorteo.
- toda parcela entra en la red de calles (antes sólo el 35 % más lejano; las
  bolsas de 300-7.100 m² eran interiores de distrito sin calle), y la que NO
  puede enrutarse (su único paso cruza el MAR, peso infinito) se poda de la
  ciudad ANTES de la muralla — era la cuña al otro lado de la desembocadura.
- puertas con margen de agua (1,5 u de tierra al mar; fuera del semiancho del
  cauce + 1 u) — antes «seca por signo» a 0,5 m del mar y a 14,9 m del eje de
  un río de 38 m.
- las calles se proyectan a tierra (0,6 u) tras el recorte del litoral: el
  grafo se enruta sobre formas SIN recortar y dos vértices caían a 13,3 y
  9,1 m mar adentro.
- muelles con medidas de muelle (0,85-1,4 × MAIN_STREET × 0,07-0,14 · r, mismo
  número de sorteos: el determinismo del contrato no se baraja).
- **fachada 90,4 % → 92,4 %** (peor ciudad 85,8 → 89,6), todas las puertas en
  carro desde el mercado (38/38), cero agua en calles/puertas/edificios,
  determinismo 542 kB idénticos.

## 5.1 Cohesión (decidida): el pueblo es un grabado de la plancha de la carta
`cityInk(tema)` teñía sólo el soporte y dejaba tejados terracota sobre
pergamino (lección #28). Ahora CON tema todo pasa por el tema: tejados y
fábrica llevados a la familia sepia por LUMINANCIA (rampa tinta→papel, 28 % del
matiz original superviviente — grabado coloreado a mano; una iglesia de plomo
sigue más fría que una teja), lavados de barrio mezclados con el grano del
papel, sombra = tinta del tema. SIN tema, la canónica a color intacta — es la
del satélite, donde el suelo es fotográfico. Mirado en PNG con `wonder` y
`antique` al lado de la carta: misma plancha. La hoja de comarca ya hablaba el
tema (mismo ink/paper por diseño); el modal del pueblo era el desertor.

## 5.2 El 3D consume (decidido): techo subido con contrato medido
`ZOOM_SKIN_MAX_Z` deja de ser z8 fijo: sube hasta el fondo que la pirámide del
mundo soporte, y CADA petición honda viaja con `consumeOnly` de punta a punta
(workerProtocol → workerCore → client → tienda del 3D). El worker declina en
0,3 ms una tesela cuyo canon no es residente (generarla habrían sido 31,9 s —
eso costaba la rueda del ratón) y entinta en 3,0 s la que ya tiene canon
(sonda `consume-only-probe`, las tres preguntas medidas). Frío = la piel de
siempre (el mosaico rellena con los padres); caliente = nítido a canon justo
donde el lector ya miró el 2D. La maquinaria de shaders (setDetailPatch,
setSubCellRelief, setAlbedoWindow, KIND_WIND) SIGUE apagada a propósito:
encenderla es un proyecto con pasada visual propia, no un cableado a ciegas.

## Idioma: el motor ya no lleva tablas `_ES`
`MODE_ES/SEASON_ES` → `MODE_KEY/SEASON_KEY` (travel), `LINK_KIND_ES/RELATION_ES`
→ claves (atlas, con `describePlace(t)` de frase entera — lección #8),
`RUIN_KIND_ES/RUIN_SITE_ES` → claves (ruins); el gazetteer conserva SU prosa
castellana por diseño con tablas propias junto al resto de su prosa.
`describeDuration(t)` con separador decimal del catálogo, forma corta por clave
(la celda de la tabla hacía cirugía de cadenas en castellano). Catálogo de
biomas COMPLETO: 44/44 en `core/biomeKeys.ts` (la tabla local de Map2D se quedó
en 17 y el sobrevuelo caía al castellano del gazetteer en una UI inglesa;
PaintPanel igual). 1.735 → **1.821 claves**, conformance verde.

## Nota de infraestructura
`world3d-zoom-run.mjs` no resolvía el alias `@/` (a diferencia de
views-smoke-run): añadido el mismo resolutor. En este contenedor el banco no
completa el paseo (31,6 s/fotograma), pero monta, dibuja, el HUD dice el
intervalo real y no hay pageerrors — captura mirada.

---

# PASADA 8 — 2026-08-12 («repasito»: el PENDIENTE accionable entero)

Detalle y números en `tasks/PENDIENTE.md` §6 (reescrito). Titulares:

- **El canon PERSISTE** (Dexie `canonTiles` v25, formato `canonStore.ts`):
  sembrar+entintar 9 s donde generar costaba 154–160 (banco, peor caso);
  composite 18×; píxeles byte a byte entre sesiones (la generadora pinta ya
  del canon cuantizado). Las dos vías (teselas y composite) emiten y
  consumen; el 3D `consumeOnly` hereda el suelo en cualquier sesión.
- **B6 en la raíz**: `stampDisc` mide centros; migración v1→v2 de las listas
  guardadas (el suelo no se mueve — banco bit a bit); mundo↔canon alineados
  (antes el mismo trazo caía media celda de mundo más allá en el canon).
- **Caminos tras mudanza** (§3 de la 7): el router ve las posiciones mudadas
  fuera del flag; y el colapso de cadenas de llaves en `applyEdits` (lección
  #35) — carta/globo/atlas ya no divergen del 2D en la segunda mudanza.
- **Localizador** (Ctrl+F, tres vistas, atlas + rótulos pintados, vuela sin
  cambiar de vista) · **Inicio** en carta y globo · **comarcas guardadas**
  con lavado + esquinas + cartela en el 2D Y en la Carta (`region-marks.png`
  mirado).
- Perfilado del §2b re-medido con el reloj correcto: el desglose de la 7
  estaba desplazado una fase (marcas de progreso); el reparto real es
  elevación 24 · erosión 22 · caminos 15 · hidrología 11 · vegetación 10 (%).
- Bancos nuevos: canon-persist · canon-seed-flow · canon-composite-flow ·
  stamp-convention · moved-roads · region-marks. El corredor del banco de
  arranque ya no lleva la raíz de un contenedor muerto cableada.
