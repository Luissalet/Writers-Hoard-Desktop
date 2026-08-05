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
