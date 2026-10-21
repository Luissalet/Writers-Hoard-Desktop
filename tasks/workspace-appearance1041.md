# Apariencia offline del espacio de trabajo — 1041

## Criterio de éxito
- [x] Mantener carbón/oro y fuentes actuales sin perfil guardado.
- [x] Apariencia de Base y sobreescrituras independientes por era/panel, sin ajustes globales ni tablas nuevas.
- [x] Tema claro/oscuro, fondo/acento, seis pilas locales para interfaz y prosa del editor, opción de conservar ajuste de lectura.
- [x] Imagen local PNG/JPEG/WebP incrustada (hasta 8 MB), selección/eliminación, grano raster local ajustable.
- [x] Modo rendimiento: superficies opacas, sin backdrop/filter blur ni decoración de fondo; conserva opciones.
- [x] UI contextual desplegable, guardado explícito, errores y borradores conservados por ámbito.
- [x] Get/save/reset MCP registrados por root; mismo store, revisión CAS y validación que la UI.
- [x] JSON clone y ZIP nativo conservan perfiles e imagen, validadores puros en import/export coordinados con SDK.
- [x] Pruebas aisladas, lint de área, typecheck renderer y capturas reales 1440/640.

## Diseño y datos
`Project.workspaceAppearance` y `WorldEra.workspaceAppearance` contienen `{revision, values}`. Una escritura relee el proyecto en transacción y sólo mezcla los campos propios; la revisión propia rechaza envíos antiguos. Reset guarda un perfil vacío con revisión incrementada: un guardado obsoleto no resucita opciones borradas. La personalización de era incrementa también su revisión de definición para invalidar formularios antiguos; renombrar una era conserva apariencia y estado SDK, propiedad de sus servicios respectivos.

Los campos de era ausentes heredan Base; el `theme` de era existente se conserva como ajuste heredado compatible. El tipo/fondo de mapas, contenido, marcas semánticas y paletas del lector siguen sus ámbitos. Las fuentes descargadas no forman parte de esta función. La prosa editable usa un selector distinto de la interfaz; la prosa del Reader no recibe su sobreescritura.

Los tokens derivados eligen tinta y ajustan acento/semánticos para mantener 4,5:1 sobre fondo, superficie y elevado. También se redefinen los aliases de compatibilidad en el panel: una variable CSS heredada desde raíz no reevalúa automáticamente su referencia al cambiar el token hijo. El fondo local y el grano son discretos, tras el contenido. El grano procede de un canvas raster determinista, sin servicio ni recurso externo.

## Verificación
- `electron tests/workspace-appearance.runner.cjs`: 5 grupos PASS. Mismo CSS de producto compilado con Tailwind más appearance.css; Electron oculto, perfil temporal y datos sintéticos. Selección real mediante File y evento del input; no navegador del usuario.
- `electron scripts/run-focused-browser-tests.cjs tests/workspace-appearance.browser.tsx testWorkspaceAppearanceScopeUi 120000`: PASS. ProjectWorkspace real, dos paneles y componente de documento sintético. Base clara/era oscura independientes; cambiar ida/vuelta conserva formulario rechazado y fuente sin guardar.
- `electron scripts/run-focused-browser-tests.cjs tests/workspace-appearance.browser.tsx testWorkspaceAppearance 120000`: 4 grupos PASS sobre el estado final, incluyendo CAS concurrente, traslado JSON, createProjectZipArchive/importProjectZip reales, despacho registrado get/save/reset y 243 comprobaciones de contraste (9 tintas × 3 superficies × 9 fondos).
- `eslint src/services/workspaceAppearance src/components/project/workspace/ProjectWorkspace.tsx src/services/worldEras/store.ts`: PASS.
- `tsc -b --noEmit`: PASS sobre el estado final, incluida la opción `proseFont=reading`.

Capturas de confirmación abiertas: `C:/Users/luism/AppData/Local/Temp/wh-workspace-appearance-ui-pAYVQh/appearance-{light,dark-image,performance}-{1440,640}.png`. La pasada posterior que amplió ZIP nativo generó seis PNG idénticos por SHA256 en `wh-workspace-appearance-ui-hBL21h`; no fue otra ronda de cambios visuales. Los últimos cambios añaden validación de metadatos, aliases/estados semánticos y la opción de recuperar la fuente de lectura; no cambian el aspecto capturado del formulario y documento sintético.

Hay avisos del arnés: import.meta.glob en bundle IIFE de tests (el bootstrap de extensiones no se ejecuta); React act en observador de resize; y el error de era ausente provocado deliberadamente por el test MCP. No se afirma consola global limpia. No se ha probado cada motor ni el rendimiento cuantitativo de una GPU; el modo elimina efectos CSS por propiedad verificable, no promete FPS.

## Entrega
Superficie congelada sin commits ni push. Revisión independiente, DESIGN.md consolidado, integración y cierre Ágora corresponden a root. Ningún dato real, servidor/modelo, GPU, navegador de Luis o dependencia compartida se ha utilizado para QA.
