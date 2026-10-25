# Verificación: luz guardada por mapa

## Uso y contrato

En Generador de Mundos, el selector **Luz** conserva la elección al salir, reabrir o recargar. `mapHour` es opcional: `off`, `dawn`, `morning`, `noon`, `afternoon`, `dusk`, `night` o `journey`. Los nombres mantienen sus horas propias 6.25/9/13/16.5/19.5/23; `noon` sigue siendo 13. Leer un mundo antiguo sin campo resuelve `off` sin repararlo ni escribirlo. Elegir de día guarda `off` explícito y no equivale a restaurar aquella ausencia.

La elección entra inmediatamente en el guardado pendiente, fuera del autosave de otros ajustes. Una sola operación mantiene el control ocupado hasta confirmar su revisión. Proyecto, mapa, época y dueño del montaje quedan capturados; salir no redirige una continuación a otro mundo ni revive el montaje anterior. Un fallo de almacenamiento conserva Reintentar explícito con su destino/revisión. Ante conflicto CAS de cualquier ajuste de presentación, se adopta el ganador, se descarta sólo la intención propia y se pide volver a elegir, sin reintento automático ni borrar fallos ajenos.

`wh_get_world_presentation` devuelve guardado, efectivo y revisión; `wh_set_world_presentation` admite el campo y `expectedRevision` existentes. Una época heredada escribe en Base sin crear variante; una variante propia conserva su ámbito. El recibo de Deshacer recuerda el destino aun después de un fork y restaura la preimagen, incluida ausencia, sólo donde permanece su valor; conserva cambios posteriores ajenos.

`wh_render_world_map` sin `hour` usa la luz guardada. Un `hour` explícito numérico 0–24, incluidos 0 y 24, o uno de los nombres prevalece. `off` y `journey` sin reproducción no añaden lavado. Viaje guarda sólo el modo: los fotogramas no escriben ticks ni sincronizan un reloj de ejecución entre montajes. JSON/ZIP, duplicado e historia/archivo conservan la presentación mediante sus vías existentes; su prueba corresponde a la matriz de autor, no a Brave. No se añade ABI host de lenses, herramienta de itinerarios, lavado 3D/Carta ni archivo recuperable de un mundo Base eliminado.

## Evidencia atribuida

El RED material inicial usa WorldView y Canvas2D reales: Noche cambia el mapa y desaparece al remontar. El mismo archivo completo pasa después del cambio; la matriz ampliada del autor cubre ocho grupos CSS y dos Native. JSON/ZIP/Duplicate comparan documentos Base/época propios completos salvo IDs, propietarios y fechas remapeados; archivo/historia corresponde a reset/restore de variante de época, no a recuperar Base eliminado. Los primeros timeouts y fallos de fixture se conservan en implementation/REPORT.md.

El peer independiente registra cuatro grupos CSS PASS sobre snapshot, IndexedDB, WorldView y dispatcher reales: ámbito/Deshacer/render0–24, conflicto/owner, fallo de almacenamiento/Retry y single-flight/ack. Sus seis intentos y el diagnóstico de thumbnail incumbente siguen separados. La revisión formal fresca leyó la entrega39 antes de repetir CSS4 y Native2: ambas primeras ejecuciones reales PASS y voto approve39 confirmado sobre el commit exacto. El primer incidente de su guarda ocurrió antes de iniciar pruebas y permanece registrado.

Native cubre executor real→IPC→renderer→auditoría→RPC Deshacer en Base; épocas se acreditan en dispatcher del peer. El segundo grupo calcula Journey con la Worker productiva, reproduce, pausa y llega dentro del step nativo, sin cambiar presentación, revisión o itinerarios por fotogramas; journey sobrevive al ocultar/reabrir. ROOT-worker-plan-r3.md describe la compilación temporal a .js y una única resolución de URL en el renderer emitido: constructor y mensajes Worker intactos. Autor, ROOT y revisión formal pasaron Native2. El protocolo anterior fallido queda conservado. No se acredita la Worker geográfica del harness ni consola limpia. El transporte original4 es una regresión separada, sin nueva prueba stdio o segunda clave.

ROOT Brave real, tras recargar código actual: Noche→salida inmediata→reabrir/frío con lavado azul y persistencia journey/off. Después calculó ruta39km, Play con avance real, Pause en Noche3 y llegada mediante End; restauró off y retiró el recorrido transitorio. ROOT-brave.md y ROOT-brave-trip.md conservan las observaciones. Browser no demuestra conteos DB; PNG terminó sin error visible pero no se confirmó descarga/píxeles. El intento inicial con código anterior sigue separado.

Acabado independiente ship sin fixes tras abrir cuatro PNG Electron EN/ES1280/390 y una imagen Brave1920. No certifica transitorios, Brave390 o móvil. Detector único: nueve avisos heredados de10/11px. El documenter conserva los bytes históricos; su r1 con dos cambios incidentales de espacios fue rechazado y r2 los restaura.

## Recibos confirmados

| Registro | Resultado y recibo en `_stage/map-lens-next-gap/` |
| --- | --- |
| Fuente | `cac4062894efd45bc88c7fbccc2ad5a3cdd853b3`; doce rutas, Luissalet, ROOT-source-commit.json |
| Revisión | CAS39 exacta, approve y readback; formal-review/REVIEW.md, ROOT-formal-read.json |
| ROOT | Doce comprobaciones exit0, crítica396; primeros diez sobre producto7/originales idénticos, CSS8/Native2 finales sobre freeze12; ROOT-source-gates.json |
| Main | FF exacto bajo lock/HEAD fresco, diez comprobaciones exit0, merge liberado; ROOT-main-gates.json |
| Manual | +430UTF16, CAS y documento entero/otros párrafos/estilos exactos; ROOT-manual-receipt.json |
| Continuidad | MEMORY conserva prefijo íntegro y grafo sólo nodo propio; ROOT-continuity-receipt.json |

La documentación final y el cierre exclusivo de research1506 quedan confirmados después en ROOT-delivery-final.json. Tarea1095/WT, SDK y comparación global siguen abiertos/parciales. Sin push.
