# Panel «Consultar» (referencia del códice)

Panel lateral plegable del editor de capítulos (Escritos) que enseña las fichas del Códice cuyo **nombre o alias aparece en el capítulo abierto**, para consultarlas sin salir del manuscrito.

## Qué hace

- **Coincidencia por nombre y alias**, sin modelo de IA. Las palabras se comparan completas, sin distinguir mayúsculas ni tildes («álvaro» = «Alvaro»). «Ana» no coincide dentro de «Anabel», y si existe «Ana Ruiz», esa mención no cuenta además como «Ana» (gana el nombre más largo).
- **Alias**: se leen del campo `Aliases` / `Alias` / `Apodo(s)` / `Sobrenombres` / `Otros nombres` de la ficha (separados por coma, punto y coma o salto de línea).
- **Lo esencial**: nombre, tipo, alias que coincidió y cuántas veces, primeras líneas de la descripción (o el primer campo) y la imagen si la ficha la tiene.
- **Vista completa en el panel**: un clic o Intro sobre una fila abre la ficha (campos, etiquetas, descripción) dentro del panel. El editor no pierde el foco lógico ni la selección; `Esc` cierra la vista y devuelve el foco al editor en el mismo punto.
- **Fijar fichas**: el botón de chincheta fija una ficha a ese capítulo (aunque no se mencione). Las fijadas salen primero. Se guardan por capítulo en el almacenamiento local de la app, nunca en la fila del capítulo (no interfiere con el autoguardado).
- **Buscador** del panel: busca cualquier ficha del Códice (todos los tipos: personajes, lugares, objetos, facciones, conceptos, magia…) por nombre, alias, etiquetas, campos y texto.
- **Honestidad**: la etiqueta es «mencionado». Que un nombre aparezca en el texto no dice que el personaje esté presente en la escena ni que sea el punto de vista.

## Rendimiento

El cálculo se hace con un retardo de 600 ms tras la última pulsación y en tiempo ocioso del navegador, con el panel abierto; con el panel cerrado no se calcula nada.

## Teclado y accesibilidad

- `Ctrl+Alt+R` abre/cierra el panel (también desde el editor).
- `Esc`: cierra la vista completa; si no hay vista, limpia el buscador; en modo cajón, cierra el panel. En todos los casos el foco vuelve al editor.
- El botón de plegado lleva `aria-expanded`/`aria-controls`; el de fijar lleva `aria-pressed`; todos los botones tienen `aria-label`.
- El ancho se cambia con el separador (arrastrando, o con las flechas izquierda/derecha cuando tiene el foco).

## Ventana estrecha

Por debajo de 940 px el panel pasa a ser un **cajón superpuesto** a la derecha (con velo y `role="dialog"`). El estado abierto/cerrado y el ancho se guardan en `localStorage` (`writers-hoard:reference:panel`).

## Piezas

| Pieza | Ruta |
| --- | --- |
| Coincidencias (puro) | `src/services/codexReference/matcher.ts` |
| Fijaciones por capítulo | `src/services/codexReference/pins.ts` |
| Panel | `src/engines/writings/components/ReferencePanel.tsx` (montado en la columna lateral de `WritingsView.tsx`) |
| Herramientas del puente | `src/services/aiBridge/tools/reference.ts`, `manifestReference.ts` |

## Puente / MCP

- `wh_chapter_references { writingId }` (lectura): devuelve `mentions` (id, nombre, tipo, alias que coincidió, recuento, etiqueta `mentioned`) y `pinned`.
- `wh_pin_reference { writingId, entryId, pinned }` (escritura local): fija o desfija. Solo cambia una preferencia de lectura, no datos del proyecto; por eso las dos herramientas no declaran `engineId`.

## Pruebas

```
npm run test:reference
```

Lanza la prueba lógica del buscador (`tests/codex-reference-logic.ts`: alias, tildes, límites de palabra, nombres solapados como «Ana»/«Anabel»/«Ana Ruiz») y la prueba de navegador (`tests/codex-reference-panel.browser.tsx`: lista, debounce, vista previa sin perder la selección, fijaciones tras remontar, ancho persistente y cajón en ventana estrecha). El autotest del puente (`ai-bridge-selftest`) incluye comprobaciones nuevas de las dos herramientas.

## Límites conocidos

- Las fijaciones viven en el navegador/instalación, no viajan con copias de seguridad del proyecto.
- El buscador cubre el Códice; otras fuentes (lugares reales, notas…) no se previsualizan en este panel.
- Solo el editor de un capítulo tiene el panel; la vista de libro entero (`BookEditor`) no lo monta todavía.
