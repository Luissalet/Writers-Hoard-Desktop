# Panel «Consultar» (referencia del códice)

Panel lateral plegable del editor de capítulos (Escritos) que enseña las fichas del Códice cuyo **nombre o alias aparece en el capítulo abierto**, para consultarlas sin salir del manuscrito.

## Qué hace

- **Coincidencia por nombre y alias**, sin modelo de IA. Las palabras se comparan completas, sin distinguir mayúsculas ni tildes («álvaro» = «Alvaro»). «Ana» no coincide dentro de «Anabel», y si existe «Ana Ruiz», esa mención no cuenta además como «Ana» (gana el nombre más largo).
- **Alias**: se leen del campo `Aliases` / `Alias` / `Apodo(s)` / `Sobrenombres` / `Otros nombres` de la ficha (separados por coma, punto y coma o salto de línea).
- **Lo esencial**: nombre, tipo, alias que coincidió y cuántas veces, primeras líneas de la descripción (o el primer campo) y la imagen si la ficha la tiene.
- **Vista completa en el panel**: un clic o Intro sobre una fila abre la ficha (campos, etiquetas, descripción) dentro del panel. El editor no pierde el foco lógico ni la selección; `Esc` cierra la vista y devuelve el foco al editor en el mismo punto.
- **Fijar fichas**: el botón de chincheta fija una ficha a ese capítulo (o al libro entero en `BookEditor`), aunque no se mencione. Las fijadas salen primero. Se guardan como **datos del proyecto** en la tabla `referencePins` (Dexie v37, una fila por capítulo o `book:<projectId>`), por lo que viajan en la copia de seguridad/exportación y vuelven al importar. Es una tabla aparte: fijar nunca toca la fila del capítulo (ni su revisión ni el autoguardado). Las fijaciones antiguas de `localStorage` se migran una vez, al leer el capítulo o al escanear.
- **Buscador** del panel: busca cualquier ficha del Códice (todos los tipos) por nombre, alias, etiquetas, campos y texto, y además las **notas** y las **citas de la biblioteca** del proyecto, con vista previa de solo lectura.
- **Honestidad**: la etiqueta es «mencionado». Que un nombre aparezca en el texto no dice que el personaje esté presente en la escena ni que sea el punto de vista.

## Rendimiento

El cálculo se hace con un retardo de 600 ms tras la última pulsación y en tiempo ocioso del navegador, con el panel abierto; con el panel cerrado no se calcula nada.

## Teclado y accesibilidad

- `Ctrl+Alt+R` abre/cierra el panel (también desde el editor).
- `Esc`: cierra la vista completa; si no hay vista, limpia el buscador; en modo cajón, cierra el panel. En todos los casos el foco vuelve al editor.
- El botón de plegado lleva `aria-expanded`/`aria-controls`; el de fijar lleva `aria-pressed`; todos los botones tienen `aria-label`.
- El ancho se cambia con el separador (arrastrando, o con las flechas izquierda/derecha cuando tiene el foco).

## Consulta temporal y ancho de ventana

El panel va **acoplado** en la columna lateral sólo donde esa columna existe: desde 1024 px (rejilla fluida del editor) o 1440 px en modo página. Por debajo, en modo foco y en el editor de libro entero no hay columna: aparece un botón flotante «Consultar» (siempre dentro de la ventana) que abre una **consulta temporal** como cajón superpuesto, sin velo, sin quitar el foco ni la selección del texto y sin desplazar la página. `Esc` (desde el texto o el panel) cierra el cajón; en modo foco, un segundo `Esc` sale del modo foco. La consulta no se guarda; la preferencia acoplada (abierto/ancho) sí, en `localStorage` (`writers-hoard:reference:panel`). Verificado con CSS real a 940x600 y 390 px, sin scroll horizontal (`npm run test:reference:ui`). Se corrigió además la cabecera del editor, que desbordaba a 940 px (ahora admite varias líneas).

## Piezas

| Pieza | Ruta |
| --- | --- |
| Coincidencias (puro) | `src/services/codexReference/matcher.ts` |
| Fijaciones (datos del proyecto) | `src/services/codexReference/pins.ts` |
| Notas y biblioteca como fuentes | `src/services/codexReference/sources.ts` |
| Preferencias y consulta temporal | `src/engines/writings/components/referencePrefs.ts` |
| Panel | `src/engines/writings/components/ReferencePanel.tsx` (montado en la columna lateral de `WritingsView.tsx`) |
| Herramientas del puente | `src/services/aiBridge/tools/reference.ts`, `manifestReference.ts` |

## Puente / MCP

- `wh_chapter_references { writingId | projectId+scope:"book" }` (lectura): menciones y fijadas.
- `wh_pin_reference { writingId, entryId, pinned, scope? }`: fija o desfija (escribe la tabla `referencePins`, no el capítulo).
- `wh_reference_consult { open }`: abre/cierra la consulta temporal (misma que el botón flotante y `Ctrl+Alt+R`; no persiste).
- `wh_reference_prefs { open?, width? }`: lee/ajusta la preferencia acoplada y el ancho (280-560 px).
- `wh_reference_search { projectId, query }` y `wh_reference_preview { kind, id }`: búsqueda y vista previa de Códice, notas y citas.

## Pruebas

```
npm run test:reference
```

Además, `npm run test:reference:ui` monta `WritingsView`/`BookEditor` con el CSS compilado de la app y redimensiona la ventana real (1280, 1024, 940x600, 390, modo página 1440).

Lanza la prueba lógica del buscador (`tests/codex-reference-logic.ts`: alias, tildes, límites de palabra, nombres solapados como «Ana»/«Anabel»/«Ana Ruiz») y la prueba de navegador (`tests/codex-reference-panel.browser.tsx`: lista, debounce, vista previa sin perder la selección, fijaciones tras remontar, ancho persistente y cajón en ventana estrecha). El autotest del puente (`ai-bridge-selftest`) incluye comprobaciones nuevas de las dos herramientas.

## Límites conocidos

- El estado de la consulta/preferencia acoplada es por navegador/instalación (localStorage), no viaja con la copia de seguridad; sólo las fijaciones lo hacen.
- Notas y citas son de sólo lectura y no se detectan automáticamente como "mencionadas" (sólo aparecen al buscar).
- Las fijaciones de capítulos no existentes en el proyecto se descartan en la migración.
