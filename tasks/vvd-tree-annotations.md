# Anotaciones en árboles de relaciones

- [x] Texto libre multilínea y dibujos vectoriales independientes de personas/relaciones.
- [x] Reutilizar captura/simplificación del Tablero y selección/arrastre de ReactFlow; inspector y controles ES/EN.
- [x] Validación acotada, borradores, variantes, undo/redo, CAS y SVG seguro con límites correctos.
- [x] Pruebas de persistencia/gestos/exportación y revisión visual con CSS real.

Ampliación autorizada al verificar la misma referencia primaria:

- [x] Puntos de unión visuales conectables, separados de personas y de la genealogía canónica; insertar uno conserva identidad/tipo/etiqueta de la relación.
- [x] Icono opcional de relación del catálogo Lucide existente, preservado en documento y SVG.
- [x] Validar referencias/rutas/ciclos y comprobar persistencia, variantes y conexiones a puntos.

Referencia primaria: https://vvd.crisp.help/en/article/relation-trees-1v7xebv/ y sesión autenticada. La autoría no modifica la genealogía canónica ni convierte anotaciones en relaciones.

## Entrega y revisión

`RelationTreeDocument.annotations` guarda texto multilínea (contenido, tamaño de letra, color, posición y caja) o trazos (puntos normalizados, grosor, color y caja). El lápiz reutiliza `FreehandOverlay`; la simplificación iterativa del Tablero se extrajo sin cambiar su API a `src/utils/freehand.ts`, evitando arrastrar módulos de UI al modelo de datos. Cada trazo es una acción completa de undo/redo. Texto y dibujo se seleccionan/arrastran o editan desde el inspector. El inspector de selección queda visible al plegar el formulario de creación. Terminar y Escape cancelan una captura pendiente y devuelven foco al control de dibujo.

Límites: 500 anotaciones; texto de 20 000 caracteres; 12 000 puntos simplificados por trazo; cajas/coordenadas finitas y acotadas; colores hexadecimales. El borrador admite ediciones intermedias recuperables, pero guardado/exportación validan. SVG usa texto escapado y elimina controles XML inválidos; no emite recursos ni contenido activo del autor. Sus límites incluyen anotaciones/puntos fuera del conjunto de personas y conserva cajas, trazos, líneas multilínea, iconos y anclajes.

`junctions` guarda puntos visuales separados; `edge.via` ordena sus rutas. El mismo registro de relación conserva su identidad/extremos lógicos/tipo/etiqueta, mientras ReactFlow genera segmentos de vista seleccionables. Los anclajes de los segmentos intermedios siguen la dirección de la ruta. Un punto admite varios ramales del tipo elegido; el validador de ascendencia existente recibe el grafo expandido y rechaza ciclos también a través de puntos. Quitar uno endereza las relaciones que pasaban por él y quita sus ramales, con confirmación y undo. Un punto nunca añade una persona al Codex ni una fila a genealogyLinks.

Hay doce iconos de relación de Lucide, renderizados con el catálogo `ProjectIcon` existente. `relationIconData.ts` contiene sus geometrías locales con atribución ISC para SVG sin red; `scripts/generate-tree-icons.mjs` las regenera desde la dependencia instalada. Ningún texto del autor se interpreta como un nombre de elemento/atributo SVG.

Autoría de anotaciones y puntos usa la revisión y la transacción existentes del árbol. Variantes conservan copias independientes; fallos/conflictos mantienen el borrador y permiten una variante. El clonador del proyecto remapea puntos, rutas y extremos de ramales; las geometrías de anotaciones son autocontenidas. El archivo recuperable compartido conserva el documento completo.

## Verificación final

- `node scripts/run-relation-trees-tests.mjs`: 8 grupos puros, incluidos rutas/ramales, ciclos por puntos, geometría, Unicode, límites y SVG sin inyección.
- `tests/relation-trees.browser.tsx testRelationTrees`: 10 grupos en Electron oculto. Añade texto, edita/guarda/reabre, cancela/elimina/deshace, recupera un borrador de anotación y resuelve conflicto como variante; inserta/mueve puntos, elige icono/anclajes, conecta ramal y comprueba un clon JSON real con IDs remapeados.
- `scripts/run-tree-annotations-qa.cjs`: CSS actual y red desactivada; lápiz mediante eventos nativos, persistencia, arrastre real de trazo, undo completo y Escape a mitad de gesto. Capturas escritorio/estrecho inspeccionadas, incluido Fit View en720px, sin desbordamiento horizontal: `.impeccable/review/tree-annotations-{desktop,narrow}.png`. Origen: `C:\Users\luism\AppData\Local\Temp\wh-tree-annotations-L4yzvp`.
- Regresión `testBoardFreehand`: 3 grupos, tras extraer la geometría común. ESLint de los módulos modificados sin errores. Typecheck del renderer completo pasó; la puerta global final corresponde al coordinador.

La creación desde una flecha y la recolocación de un extremo por arrastre son gestos distintos en VVD. Writer ofrece esas acciones finales con añadir/conectar y los selectores de extremos/anclajes del inspector; no se atribuye una interacción idéntica.
