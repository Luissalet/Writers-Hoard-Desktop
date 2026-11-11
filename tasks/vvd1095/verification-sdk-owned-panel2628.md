# Abrir un bloque propio de Codex o Escritura al lado

En una ficha de Codex que estás editando o un capítulo de Escritura, añade un bloque de fuente de tipo **Propio**, por ejemplo **Bloque de iniciativa**. En el bloque, pulsa **Abrir bloque al lado**. El panel vuelve a mostrar ese mismo bloque y otra apertura selecciona la pestaña que ya existe. El editor y su prosa quedan abiertos. Los cambios se reflejan en ambos lados; el panel tiene su propio Deshacer y Rehacer. Guarda la ficha o deja terminar el guardado normal del capítulo para conservar la edición.

Si queda un borrador en el panel, no se cierra la ficha o pestaña hasta guardarlo o descartarlo. Cuando se retira el editor dueño, cambia el permiso o desaparece el bloque, el panel deja de estar disponible. Al recargar no se restaura esta pestaña temporal. La edición guardada sí se puede abrir de nuevo desde su dueño.

Para autores, el contexto del bloque indica blockPresentation: 'inline' | 'panel'; el estado vive siempre en el mismo átomo. El puente wh_local_tool_block_open recibe {projectId, eraId?, owner:{kind,documentId}, blockId} y devuelve {available,applied}. Sólo abre un montaje activo e inequívoco, no escribe ni cambia el permiso. Una ficha distinta con el mismo ID de bloque o un montaje de otra era no sirven de sustituto.

Source 64a83acb, 21 rutas. Brave 3: r1 ejercitó las dos vistas, Deshacer/Rehacer, dueño oculto de capítulo y reapertura; detectó pérdida al cancelar una ficha. En r4, Cancelar y X conservaron el borrador y sólo permitieron retirar tras descartarlo. También comprobó que no hay promoción, duplicación o pin y que el capítulo frío conserva el valor del mismo bloque. Native r4: 16 llamadas MCP, 20 RPC, 16 IPC; dos claves auténticas, dos respuestas 401 al revocarlas sin nuevo IPC, EOF 0 y perfil retirado. Focal r3: cinco grupos; agregado r9: 19, incluye los cinco. Quick r4 y build r7 terminaron correctamente. Entre r4 y r9 sólo cambió la prueba agregada; el producto es idéntico.

Este contrato cubre el bloque propio del editor vivo, no un panel de edición independiente del documento dueño. No amplía ToolDock, los bloques de mundo ni los documentos embebidos. La referencia SDK describe la misma instancia en presentación inline y panel; su ciclo tras cerrar el dueño no se ha podido verificar con datos sintéticos. No se declara paridad global.

[Contrato del SDK](../../docs/local-tool-sdk.md#document-hosts-and-inline-blocks-d2). La ficha y el capítulo pueden tener bloques propios distintos; este panel se refiere al montaje exacto que lo abrió.
