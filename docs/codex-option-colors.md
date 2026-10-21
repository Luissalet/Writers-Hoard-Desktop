# Colores de opciones del Codex

Una propiedad de selección múltiple conserva sus opciones `presets:string[]` y puede añadir `optionColors:Record<string,string>`. Cada clave es el valor exacto de la opción y cada color usa `#RRGGBB`. Cambiar el orden de las opciones no cambia sus colores. Quitar una opción de la lista no borra selecciones ya escritas ni su color; se puede quitar el color expresamente.

El editor de propiedades ofrece una muestra, un campo hexadecimal y Quitar por opción. Las fichas muestran chips con checkbox y tinta clara u oscura según el contraste. Se pueden seleccionar con teclado y añadir valores propios con Enter. Los valores antiguos o no incluidos en la lista permanecen visibles. La edición JSON anterior sigue disponible en Valores avanzados. El mismo tipo y sus descendientes reutilizan las opciones y colores; no existe una biblioteca independiente de listas nombradas.

Las definiciones se guardan mediante las operaciones normales de plantillas, incluida su revisión CAS. `wh_save_codex_template` describe `optionColors` en su schema. Los colores inválidos se rechazan antes de sustituir el tipo. Herencia, sincronización, retirada de tipo y JSON conservan los metadatos; no se guardan los valores calculados como caché.

`projectCodexEntry` mantiene `fields` como texto para búsquedas/CSV/consumidores existentes. La propiedad seleccionada incluye además `options:[{value,color?,ink?}]`. `codexPropertyHtml` genera chips portables con texto escapado y estilos inline para los consumidores de HTML. Los consumidores de Reader/wiki/bloques usan ese helper desde su integración normal, propiedad del coordinador1041.

Pruebas: `tests/codex-option-colors.browser.tsx`, funciones `testCodexOptionColors` y `testCodexOptionColorLayout`; esta última se ejecuta con `scripts/run-codex-properties-ui.cjs` para usar CSS real, ratón/teclado nativos y capturas1440/640.
