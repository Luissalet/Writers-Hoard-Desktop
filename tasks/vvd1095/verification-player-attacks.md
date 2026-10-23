# Verificación: ataques manuales de jugador 5e

## Estado de la entrega

La fuente final `112f1fc3e108cd83d73ed9c8ad9accf7ad2d60f3` está aprobada por una lectura y un voto independientes nuevos en CAS 18, según el recibo de raíz. CAS 17 aprobó antes `971870a47f68d3d0584a416e61f1e066c35dac27`; ese hecho histórico se conserva. La enmienda quitó únicamente dos bytes EOF de la prueba del autor, con el mismo código/criterios y los otros diez hashes exactos, pero no heredó el voto anterior. La raíz integró FF exacto ese commit bajo el lock de merge y completó verify/build de main y la actualización del manual Google con sus recibos propios, detallados al final. El cierre técnico de 32 grupos no los sustituye, ni se reutilizan los recibos de grafo o Assets. La tarea 1095 sigue abierta.

Este documento describe una entrega acotada de filas manuales del preset `5e-character`. No declara paridad de todas las reglas, ficha completa o herramientas de VVD, ni actualiza el ejecutable instalado o el host stdio ya cargado.

## Referencia real y comparación

La raíz probó en Brave el documento real `5eCharacterSheet 0.1.11`, separado del `Stat Block 0.1.2`: nombre `QA Spear`, bonificación `+4` y campo libre combinado de daño/tipo `1d6+2 piercing` persistieron al salir y volver. No observó controles separados de tirada por fila ni un selector tipado de daño; las tiradas propias de Writer son una capacidad adicional, no una conducta atribuida a esa referencia. Evidencia de raíz: `_stage/live-next/player-5e-reference.md` y captura `vvd-player-5e-attack.png`.

Las propiedades personales también se compararon: Age 37 y Height 1.72m persistieron en el panel visible de la referencia después de cambiar a Calendar y regresar. En Writer, Añadir propiedad ya permitía Age numérica en Rasgos y Height de texto en Identidad, guardarlas, reabrirlas y mostrarlas en Papel. No se necesitó código nuevo para esas propiedades. La primera lectura DOM de campos ocultos en la referencia no se aceptó como prueba; una observación visible posterior corrigió ese sondeo. Este resultado no acredita otros campos o automatizaciones no recorridos.

## Flujo nativo de Writer

En Inventario y rasgos, Añadir ataque crea una fila configurada expresamente; una fila existente puede marcarse como ataque sin convertir las demás. `fiveEAttack` es opcional, manual y exclusivo de jugador 5e:

```ts
{ version: 1, bonus: 4, damageType: 'piercing' }
```

Nombre, sección, notas, cantidad y expresión de dados conservan sus campos originales. La expresión existente es el daño. `fiveESpell` puede coexistir con nivel y Preparado intactos; quitar la configuración de ataque elimina sólo `fiveEAttack`. Abrir o validar una ficha antigua no rellena ese objeto, ni activa un perfil automático de clase. Los presets de criatura y otros sistemas conservan su flujo anterior.

Tirar ataque suma la bonificación manual a un d20. Tirar daño utiliza la gramática de expresiones existente; una expresión inválida no añade historial. Ninguna acción asume CA u objetivo, adjudica crítico/pifia o gasta cantidad, puntos de golpe o espacios de conjuro. La suma rehúsa desbordar un entero seguro. Ambas acciones añaden historial al borrador normal; Guardar ficha lo conserva.

Las etiquetas nuevas distinguen acción y fila: `Attack · QA Spear` / `Damage · QA Spear · piercing` mediante MCP, y `Ataque` / `Daño` desde la interfaz española. Si los textos completos válidos exceden el límite existente de etiqueta, se abrevia sólo ese contexto derivado con elipsis, sin cortar pares Unicode ni modificar la fila. No se reescriben las etiquetas de tiradas ya guardadas. Dos acciones con la misma expresión y total continúan identificándose por su acción.

Descartar cambios y Recargar ficha guardada reutilizan el diálogo existente con su título y acción propios. Cancelar mantiene el borrador; recargar después de un conflicto conserva la última ficha guardada. El borrado real mantiene su confirmación de eliminación.

## Papel, lectura y conservación de datos

El anexo Ataques muestra nombre, bonificación, dados, tipo y notas después de todo el contenido previo y de la altura de tinta existente. Las tablas anteriores y los trazos conservan coordenadas. La fila original sigue en su apartado de filas o conjuros; la repetición en el anexo es deliberada para conservar anclajes. Los textos se escapan.

Preview y la proyección normal de lectura/exportación reciben la misma hoja y papel, sin controles de tirada ni escrituras de montaje. JSON de hoja, clon JSON de proyecto, Duplicar nativo, ZIP y archivo/restauración conservan datos de ataque y conjuro, historial y tinta por sus rutas existentes. Las eras y Base reutilizan el contrato de hoja, no un almacén paralelo.

## Puente nativo

No hay herramienta nueva. `wh_sheet_update` edita o elimina la metadata opcional en la hoja completa usando su revisión actual. `wh_sheet_5e_action` amplía el enum existente:

```json
{
  "projectId": "<proyecto>",
  "sheetId": "<hoja>",
  "revision": 3,
  "action": "roll-attack",
  "rowId": "<fila>"
}
```

Para daño se usa `roll-damage`; `eraId` sigue siendo opcional y explícito. CAS, auditoría y recibo de Deshacer son los existentes. Revisión vieja, fila sin configurar, preset ajeno o daño inválido rechazan sin escritura. Deshacer rehúsa sobrescribir cambios posteriores; un rollback externo no deja válido un recibo de una mutación abortada. La prueba usa executor, dispatcher y `__undo` nativos. El host stdio antiguo conserva su limitación de código cargado; no es una prueba de transporte externo de esta fuente final.

## Pruebas y revisión independiente

La revisión técnica de `codex-writer1095-final-review` declara APTO sobre freeze de 11 rutas, con hashes iguales antes y después. Inventario: **32 grupos distintos PASS**, desglosados en 10 del autor, 5 propios independientes y 17 legacy. La tanda final repitió 21 (10 + 5 + RPG 6); los otros 11 legacy se conservaron por fuente funcional intacta. Las repeticiones no son grupos adicionales ni una suite global nueva.

- Autor: Engine real, opt-in, guardar/desmontar/reabrir, dos tiradas, clear y descarte; executor/dispatcher/Undo; validación de metadata y presets; anclajes de papel/tinta y escape; kernel determinista, signo/cero/desbordamiento, eras/CAS/rollback, JSON/clon/Duplicar/ZIP/archivo y lectura/exportación; idioma español, conflicto/Recargar/Eliminar y contexto Unicode.
- Revisor: identidad de acciones con expresión/total iguales; CAS concurrente con un ganador y otra hoja intacta; hidratación de lectura con retirada viva del anexo; Engine español y cancelación/confirmación de descarte/borrado; nombre y tipo de longitud máxima aceptados sin perder datos fuente.
- Legacy: controles de clase 3, corrección de sección impresa 4, profundidad 5e 4 y RPG 6. El arnés nativo específico de profundidad UI no se ejecutó con el runner focal genérico y no se le atribuye cobertura.

Pruebas guardadas en [`player-attacks.browser.tsx`](../../tests/player-attacks.browser.tsx) y [`review-player-attacks.browser.tsx`](../../tests/review-player-attacks.browser.tsx). Recibos locales: `_stage/player-attacks-next/RESULT.md`, `review-independent.md`, `review-final-receipt.json` y hashes antes/después. TypeScript app, lint y detector corresponden al autor; el revisor no se atribuye esas ejecuciones. Avisos legacy `act`, `import.meta` del bundle focal y advertencias del SDK de audio concurrente se conservaron y no se certificó ese frente por esta revisión.

Se conservan los RED originales y su atribución: ausencia inicial de campos/acción/validación/anexo; identidad de historial y contexto máximo detectados independientemente; Unicode de etiqueta detectado por el autor; diálogo de descarte detectado por raíz y reproducido en Engine real. El primer fixture de papel sin `surface`/`width`, las etiquetas incorrectas del arnés y sus esperas de carga se documentan como errores de prueba corregidos, no defectos del producto.

## Browser normal de raíz

En Brave sobre la QA de Writer, raíz creó una ficha de jugador separada y guardó `QA Spear`, bono 4, daño `1d6+2`, tipo `piercing`, cantidad 1 y notas propias. Seleccionar Nora y volver conservó los campos. Marcó además como conjuro, nivel 1/Preparado, quitó sólo la configuración de ataque y descartó para recuperar la ficha guardada, sin perder otros campos.

Tras la recarga final, ataque 11 con dado 7 y daño 4 con dado 2 mostraron las etiquetas contextuales y se guardaron. Las dos tiradas anteriores con etiquetas antiguas permanecieron. No se presenta ese azar observado como total determinista. Cantidad 1→2, Cancelar descarte conserva 2 y confirmar restaura 1. Papel muestra el anexo completo después de las filas y el historial previos.

Evidencia inspeccionada por raíz: `_stage/player-attacks-next/REFERENCE-root.md`, `writer-attack-history-final.png` y `writer-attack-paper-final.png`. Es Browser normal de raíz, separado de Electron focal y del transporte MCP externo. No se atribuye prueba física de tinta, impresión o todas las combinaciones de reglas.

## Recibos finales de esta entrega

La raíz integró exactamente `112f1fc3e108cd83d73ed9c8ad9accf7ad2d60f3` mediante FF bajo el lock de merge, después de la aprobación independiente nueva CAS 18. La aprobación CAS 17 de `971870a` permanece como antecedente de la enmienda sólo EOF y no se reutilizó para votar la fuente final. `review-formal-r18-receipt.json` registra revisión y voto 18 sobre `112f1fc`.

Main completó `verify:quick`: tipos de renderer/Electron, shipping lint con cero fingerprints y conformance de 34 motores, 64 tablas, 6515 claves, 22 archivos de idioma y cero avisos. Vite terminó en 36.92 segundos, el empaquetado Electron pasó y los dos controles plain-Node pasaron con 937 herramientas y límites/schema de Reveal conservados. Logs de esta fuente: `_stage/player-attacks-next/main-verify.log`, `main-build.log`, `main-electron.log` y `main-manifest.log`. La raíz confirmó sesión 30517 exit0, main limpio y lock liberado. No son las compilaciones anteriores de grafo o Assets ni una suite global nueva.

El manual Google se actualizó con 412 unidades UTF-16 bajo `requiredRevision` y posterior relectura. El recibo `_stage/player-attacks-next/manual-receipt.json` identifica la fuente final y registra 198 párrafos, los otros 197 textos sin cambios y todos los estilos de párrafo preservados. Esa escritura pertenece a raíz; este pase sólo actualiza documentación del repositorio.

Esta entrega de ataques queda integrada y documentada. Los niveles/espacialización y pan del SDK siguen como frentes separados en curso; este recibo no certifica su fuente WIP. Los recuentos de matrices y entregas anteriores siguen siendo históricos; 1095 continúa. Se mantienen los límites de referencia, reglas manuales, transportes y cobertura descritos arriba.

## Contraste adicional del perfil de clase existente, 23 de octubre

Root probó en Brave la ficha5e0.1.11 de referencia: Fighter3/CON10 calcula máximo22; conservar7actuales y subir a4 calcula28 y mantiene7 al volver a abrir. En Writer, la previsualización del perfil optativo2014 ya ofrecía esos mismos22/28, aplicados expresamente con sus casillas, sin curar al cambiar de nivel. Tras guardar, seleccionar Nora y regresar a Jugar, la QA conservó Fighter4, competencia+2 y7/28. `QA Spear`/+4/`1d6+2`/piercing/cantidad1 permaneció intacta. Capturas inspeccionadas en `_stage/live-next/writer-five-e-class-level4-hp7.png` y `writer-five-e-class-hp-preserved.png`; la segunda se mostró a Luis.

Este contraste no requirió código nuevo ni acredita multiclase o rasgos automáticos de subclase. La observación del bloque5e separado de referencia mostró una descripción de acción libre; no se deduce que todos sus recorridos carezcan de campos estructurados. Los niveles/pan del SDK se integraron después en `fcf94f6`, según su recibo propio; la frase de cierre anterior describe el momento de la entrega de ataques.
