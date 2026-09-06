# Writer's Hoard — informe integral de remediación para Claude

Fecha de la auditoría: 6 de septiembre de 2026  
Repositorio: `Writers hoard desktop`  
Objetivo: corregir todos los defectos confirmados, cerrar los riesgos de pérdida de datos y convertir las mejoras propuestas en una hoja de ruta implementable y verificable.

## Instrucción principal

Actúa como responsable técnico del proyecto. No te limites a comentar los hallazgos: impleméntalos por fases, añade las pruebas que demuestren cada corrección y mantén el proyecto utilizable al finalizar cada fase.

Antes de modificar nada:

1. Lee `AGENTS.md`, `tasks/lessons.md`, `tasks/todo.md` y la documentación relevante de `docs/`.
2. Inspecciona el código actual. Las rutas y líneas de este informe corresponden al estado auditado y pueden haberse movido.
3. Conserva cualquier cambio o archivo ajeno que ya exista en el árbol de trabajo.
4. Escribe un plan verificable en `tasks/todo.md` y ejecuta una fase cada vez.
5. Para cada comportamiento determinista, crea primero una reproducción automatizada que falle por la causa descrita. Para contraste, rendimiento dependiente del hardware y revisión visual, registra un baseline reproducible, el entorno y evidencia antes/después.
6. No des por terminada una fase con typecheck solamente: demuestra el comportamiento con pruebas y, cuando afecte a la interfaz, con recorrido real de la aplicación.

No conviertas todo esto en un refactor masivo. La prioridad es proteger los datos y reducir riesgo. Reutiliza los patrones existentes de transacciones, confirmaciones, `closeGuard`, registro de backups, permisos IPC e internacionalización.

## Estado inicial verificado

En el momento de la auditoría:

- `npm run verify:quick`: correcto.
- `npm run test:critical`: correcto, 146 pruebas.
- `npm run audit:security`: falla por dos vulnerabilidades moderadas.
- La aplicación arranca y la interfaz principal es funcional.
- La consola avisa de que `imageRecipes` no está cubierta por backups.
- El modal de “Nuevo proyecto” reproduce los problemas de foco y semántica descritos más adelante.
- El documento raíz conserva `lang="en"` aunque la interfaz visible esté en español.

La base es sólida: React/Electron están tipados, la suite crítica es amplia, el registro modular de motores funciona y Electron ya usa `sandbox`, aislamiento de contexto, Node desactivado, permisos IPC cerrados por defecto y `safeStorage`. No debilites esas protecciones.

## Salud inicial de la interfaz

Puntuación de referencia de la auditoría: **10/20 — aceptable, pero necesita remediación antes de considerarse una interfaz madura y accesible**.

| Área | Puntuación | Diagnóstico inicial |
|---|---:|---|
| Accesibilidad | 1/4 | Los flujos visuales funcionan, pero faltan semántica de diálogo, gestión de foco, controles de teclado y contraste AA. |
| Rendimiento percibido | 2/4 | La escala actual es utilizable; listas grandes, miniaturas e importaciones masivas pueden bloquear el renderer. |
| Adaptabilidad | 1/4 | La aplicación de escritorio parte de un mínimo de anchura amplio y la experiencia web/zoom alto tiene poca cobertura. |
| Tema y consistencia visual | 3/4 | La identidad oscura/dorada es coherente y específica del producto; fallan algunos tokens, estados nativos y detalles de contraste. |
| Integridad de implementación UI | 3/4 | Hay buenas primitivas y un sistema de motores consistente, pero conviven modales, overlays y controles ad hoc. |
| **Total** | **10/20** | **Base reconocible y funcional, con deuda estructural de accesibilidad, escalabilidad y consistencia.** |

Esta puntuación es un baseline razonado, no una métrica automática ni un sustituto de los gates. Conserva la misma rúbrica y vuelve a puntuar al terminar las Fases 5 y 6, acompañando cada cambio de nota con evidencia: resultados de axe, ratios de contraste, recorrido de teclado, zoom 200 %, ambos idiomas, reduced motion y mediciones de rendimiento.

Objetivo de salida: ninguna categoría por debajo de 3/4, total mínimo de 17/20 y cero defectos P0/P1 abiertos en la interfaz. No subas una puntuación por haber cambiado código; súbela únicamente cuando la evidencia y los criterios de aceptación correspondientes estén cumplidos.

## Definición de terminado global

El trabajo completo solo termina cuando:

- no queda ninguna ruta conocida que pueda borrar o sobrescribir trabajo del usuario sin recuperación;
- una migración desde una base v23 con datos reales conserva todo lo representable;
- importar un ZIP no puede escribir fuera del proyecto declarado;
- backups y restauraciones son coherentes, verificables y cubren toda tabla de usuario;
- todas las escrituras asíncronas críticas informan éxito o error y participan en el cierre seguro;
- `npm run audit:security`, `npm run verify:quick`, `npm run test:critical`, `npm run build:desktop` y `npm run bundle:budget` pasan;
- los flujos principales superan una revisión real de teclado, foco, contraste, movimiento reducido, español e inglés;
- las pruebas de estrés acordadas para colecciones e imágenes cumplen sus presupuestos;
- `tasks/todo.md` documenta resultados, límites y cualquier deuda que no sea posible resolver con evidencia.

## Prioridad y orden obligatorio

| Fase | Objetivo | Motivo |
|---|---|---|
| 0 | Congelar reproducciones y red de seguridad | Evita “arreglos” que oculten o cambien el fallo |
| 1 | Migraciones, importación y undo destructivo | Son los riesgos de pérdida irreversible |
| 2 | Primitiva común de escritura, snapshot y cierre | Google Docs, autosave y Board dependen de ella |
| 3 | Backup coherente, recetas y ciclo de vida de datos | Convierte el sistema local-first en recuperable |
| 4 | Seguridad de dependencias y servidor local | Cierra el gate de release y la superficie HTTP |
| 5 | Accesibilidad e i18n estructurales | Primero primitivas comunes, luego consumidores |
| 6 | Escalabilidad de medios y colecciones | Evita bloqueos y picos de memoria en uso real |
| 7 | Features de recuperación y salud | Hacen visibles las nuevas garantías técnicas |
| 8 | Features para escritores | Amplían el producto sobre una base ya estable |

## Protocolo de entrega y recuperación

- Divide el trabajo en cambios pequeños: una fase o subfase coherente por PR/commit lógico, cada uno con pruebas y rollback propios. No mezcles una migración de datos con un rediseño visual o una feature editorial.
- Mantén una matriz de compatibilidad viva: bases Dexie v21, v23, v24, v29 y actual; ZIP legacy y actual; proyecto vacío y grande; desarrollo y aplicación empaquetada; renderer web y Windows desktop cuando corresponda.
- Antes de toda migración o reemplazo arriesgado crea una copia recuperable y valida que realmente pueda abrirse. Usa feature flags solo para permitir retirada segura, nunca para mantener dos modelos de datos indefinidamente.
- Documenta el procedimiento de rollback de cada cambio persistente. Si el nuevo código ya escribió un formato incompatible, volver al binario anterior no cuenta como rollback.
- Antes de release, instala la build empaquetada sobre una versión anterior con datos reales, migra, reinicia, recorre las áreas críticas, restaura un backup y confirma que no quedan procesos externos.
- Mantén un registro de decisiones para cambios de propiedad, identidad cross-project, filesystem, protocolos Electron y compatibilidad de backup. El constructor no debe inventar estas decisiones durante la implementación.

---

## Fase 0 — Reproducciones y red de seguridad

Añade fixtures y pruebas rojas independientes para estos escenarios:

1. Upgrade v23→actual con datos en Yarn Board y Brainstorm.
2. ZIP de proyecto A que contiene una fila con `projectId` e ID pertenecientes a B.
3. Sincronización de Google Docs iniciada sobre A mientras el usuario guarda B antes de aplicar el remoto.
4. Commit debounced que rechaza y commit todavía pendiente durante el cierre.
5. Carga de scope A que resuelve después de cambiar a scope vacío y después de cambiar a B.
6. Conversión seguida de edición/versionado del escrito y posterior “Deshacer”.
7. Dos descargas simultáneas, una por HTTP y otra por IPC.
8. Apertura de un diálogo y recorrido completo con teclado.
9. Hash de receta ante cambios de modelo/LoRA/input y ante metadatos de fila.
10. Stores de IA/Image Runtime cuyas promesas resuelven en orden inverso.
11. Migración v21 con enlaces solo en uno de dos proyectos.

No cambies los resultados esperados para hacer pasar el comportamiento actual. Los tests deben expresar el invariante deseado.

### Gate de la fase

- Cada comportamiento determinista tiene una prueba que falla por la causa correcta; los riesgos visuales y de rendimiento tienen baseline, protocolo y evidencia reproducibles.
- El resto de `test:critical` continúa pasando.
- Los fixtures no contienen datos privados ni dependen de red.

---

## Fase 1 — Pérdida de datos e importaciones

### 1.1 P0 — La migración v24 elimina Yarn Board y Brainstorm sin migrarlos

**Evidencia**

- `src/db/index.ts`, definición y upgrade de v24, aproximadamente líneas 728–772.
- Se declaran como `null` `yarnBoards`, `yarnNodes`, `yarnEdges`, `brainstormBoards`, `brainstormItems` y `brainstormConnections`.
- El callback solo reescribe IDs de motores y referencias; no copia filas a `boards`, `boardNodes` ni `boardEdges`.
- La suite actual solo cubre de forma específica v29→v30.

**Corrección requerida**

- Rediseña la transición histórica para que una instalación que todavía esté en v23 conserve las tablas legacy durante la versión que copia sus datos.
- Crea `boards`, `boardNodes` y `boardEdges`, transforma todas las filas con un mapeo determinista y retira las tablas antiguas únicamente en la siguiente versión de esquema.
- No intentes leer una tabla en el mismo upgrade que ya la declara `null`: Dexie aplica primero el cambio de esquema.
- Conserva IDs cuando no haya colisión. Si es necesario generar IDs, crea y prueba un mapa estable para actualizar todas las referencias.
- Migra texto, coordenadas, orden, estilo, tipos de nodo, conexiones, proyecto propietario y cualquier metadato representable.
- La migración debe ser idempotente ante una ejecución interrumpida; usa `bulkPut` cuando corresponda.
- Conserva la reescritura de `enabledEngines`, `engineOrder`, anotaciones y referencias.
- Documenta con claridad que las bases que ya atravesaron la v24 y perdieron esas tablas no pueden reconstruirse sin una copia previa. No inventes datos ni simules recuperación.

**Criterios de aceptación**

- Un fixture v23 con ambos motores llega a la versión actual con el mismo número de tableros, tarjetas y conexiones.
- Se conservan contenido, coordenadas, relaciones e identidad de proyecto.
- Las tablas antiguas solo desaparecen después de copiar con éxito.
- Un fallo inyectado no deja una migración parcial.
- Se prueban al menos rutas v23→actual, v24→actual, v29→actual y base nueva→actual.

### 1.2 P1 — Un ZIP puede sobrescribir datos de otro proyecto

**Evidencia**

- `src/engines/_shared/backupRegistry.ts`, `makeSimpleBackupStrategy.preflightImport` e importación por `bulkPut`, aproximadamente líneas 300–320.
- `src/services/zipBackup.ts`, confirmación de colisión, aproximadamente líneas 721–760.
- Se valida que el contenido sea un array, pero no que cada fila pertenezca al proyecto importado.

**Corrección requerida**

- Ejecuta un preflight completo antes de la primera escritura.
- Valida que toda fila project-scoped tenga el `projectId` declarado por el archivo.
- Valida referencias padre-hijo, IDs de tablero/mundo/hilo y enlaces entre entidades. Ninguna relación puede escapar al conjunto importado salvo las excepciones globales documentadas.
- Aplica el contrato a estrategias simples y personalizadas.
- Ante una discrepancia, rechaza el archivo entero y no modifiques ninguna tabla.
- No “repares” silenciosamente un `projectId` ajeno: eso puede apropiarse de datos o esconder un ZIP manipulado.
- Mantén toda restauración dentro de una transacción con rollback total.

**Criterios de aceptación**

- Un ZIP malicioso o corrupto no cambia ni un byte lógico del proyecto ajeno.
- Una referencia externa invalida la importación completa.
- Un ZIP válido y un ZIP antiguo soportado siguen haciendo round-trip.
- El error explica qué sección falló sin exponer contenido sensible.

### 1.3 P1 — “Deshacer conversión” borra el trabajo posterior

**Evidencia**

- `src/services/projectTools.ts`, `undoConversion`, aproximadamente líneas 846–855.
- `src/components/project/ProjectToolsPanel.tsx`, acción de undo, aproximadamente líneas 267–273.
- Se borran el escrito de destino, snapshots y enlaces sin comprobar si el usuario trabajó después sobre él.

**Corrección requerida**

- Amplía el recibo de conversión con una huella/versionado del destino en el momento de crearlo.
- Si el destino sigue intacto, el undo puede retirar la conversión de forma transaccional.
- Si cambió, no borres nada. Ofrece una alternativa segura: conservar el escrito, desvincularlo, archivarlo o moverlo a una papelera recuperable.
- Los recibos legacy no tienen huella. Nunca deben autorizar un borrado físico: solo conservar, desvincular, archivar o ejecutar una acción explícita y recuperable.
- Evita borrados físicos de snapshots con valor para el usuario.
- Haz la operación idempotente y deja un resultado auditable.

**Criterios de aceptación**

- Undo sobre una conversión intacta funciona.
- Undo sobre un destino editado no destruye contenido ni historial.
- Cancelar no cambia ningún dato.
- Un fallo a mitad de operación revierte todo.

### 1.4 P3 — La migración v21 activa Scrapper en proyectos sin enlaces

**Evidencia**

- `src/db/index.ts`, aproximadamente líneas 695–700, calcula `hadLinks` globalmente.
- Si un solo proyecto tenía enlaces legacy, todos los proyectos reciben Scrapper.

**Corrección requerida**

- Agrupa la existencia de enlaces por `projectId` y modifica solo el proyecto correspondiente.
- Añade un fixture con proyecto A con enlaces y proyecto B sin ellos; solo A debe recibir Scrapper.

---

## Fase 2 — Escritura segura, conflictos y cierre

### 2.1 Primitiva común de escritura versionada

Crea una abstracción pequeña y compartida para las operaciones críticas:

- lectura actual dentro de una transacción corta;
- `expectedVersion` o huella equivalente;
- snapshot obligatorio del estado actual antes de reemplazarlo;
- resultado de snapshot discriminado (`created`, `already-covered`, `skipped-empty`, `error`) o una variante estricta `ensureSnapshot`;
- escritura y snapshot atómicos;
- error explícito si no hay cuota o falla el snapshot;
- resultado tipado: guardado, conflicto, cancelado o error;
- registro central de promesas de guardado pendientes.

No mantengas una transacción IndexedDB abierta mientras esperas red o interacción humana. Descarga y confirma primero; abre después una transacción breve para comparar y escribir.

### 2.2 P1 — Google Docs pisa ediciones concurrentes

**Evidencia**

- `src/services/googleDocs.ts`, `applyGoogleDocSync` y `syncGoogleDoc`, aproximadamente líneas 187–239.
- `src/engines/writings/snapshots.ts`, `takeSnapshot`, aproximadamente líneas 142–180.
- El snapshot parte del objeto antiguo del caller, el update sucede fuera de una transacción y un snapshot fallido no bloquea el overwrite.

**Corrección requerida**

- Al aplicar el remoto, vuelve a leer el escrito actual.
- Compara con la versión que inició la sincronización.
- Si cambió localmente, devuelve conflicto y presenta diff con “mantener local”, “usar remoto” o “fusionar”.
- Snapshot del estado actual y reemplazo remoto deben ser atómicos.
- Si el snapshot falla, aborta. Nunca sobrescribas sin red de recuperación.
- Cambia `hasDocChanged`: una caída de red o un error de autenticación no equivalen a “sin cambios”. Devuelve un estado discriminado o propaga el error para que la UI muestre “no se pudo comprobar”.

**Criterios de aceptación**

- A→edición local B→respuesta remota C produce conflicto; B no desaparece.
- La ruta feliz conserva un snapshot correcto y C.
- Error de snapshot deja el escrito intacto.
- Error de red al comprobar cambios nunca se presenta como sincronizado o sin cambios.
- Las pruebas no dependen de Google real.

### 2.3 P1 — Autosave asíncrono no observado

**Evidencia**

- `src/engines/_shared/useDebouncedField.ts`, aproximadamente líneas 44–111.
- Callers como `src/engines/outline/components/OutlineEngine.tsx`, aproximadamente líneas 99–102.
- El contrato tipa el commit como síncrono, limpia `dirty` antes de conocer el resultado y descarta promesas.

**Corrección requerida**

- Cambia el contrato a `void | Promise<void>` y espera el resultado.
- Mantén `dirty` hasta confirmar éxito.
- Conserva el valor y muestra error recuperable ante rechazo.
- Evita commits fuera de orden mediante secuencia, cancelación o serialización.
- Registra cada guardado pendiente en el coordinador global y permite retry.
- Audita todos los callers descubiertos por TypeScript; no dejes `void commitAsync()` en persistencia crítica.

### 2.4 P2 — Board no puede garantizar el flush al cerrar

**Evidencia**

- `src/engines/board/hooks.ts`, aproximadamente líneas 277–286.
- `beforeunload` y cleanup hacen `void flush()`; el runtime puede terminar antes.

**Corrección requerida**

- Integra el guardado del Board en el mismo registro de escrituras pendientes y `closeGuard`.
- Al cerrar dentro de la ventana de debounce, espera el flush, deja cancelar el cierre o muestra error.
- Define un timeout razonable; nunca bloquees el cierre indefinidamente.

### 2.5 P2 — Resultados antiguos reaparecen tras vaciar/cambiar scope

**Evidencia**

- `src/engines/_shared/makeEntityHook.ts`, aproximadamente líneas 78–97.
- `src/engines/_shared/makeReadOnlyHook.ts`, aproximadamente líneas 82–104.
- `src/engines/_shared/makeGraphHook.ts`, aproximadamente líneas 90–114.
- `src/hooks/useProjects.ts`, aproximadamente líneas 84–97.

**Corrección requerida**

- Invalida la secuencia antes de cualquier retorno por scope vacío.
- Solo publica un resultado si sigue correspondiendo al scope y secuencia actuales.
- Al cambiar A→B, no expongas temporalmente filas de A como si pertenecieran a B: limpia al inicio o devuelve el scope asociado y bloquea consumidores hasta que coincida.
- Cubre desmontaje, A→vacío y A→B.

### 2.6 P2 — Stores asíncronos publican resultados fuera de orden

**Evidencia**

- `src/stores/aiRuntimeStore.ts`, cargas aproximadamente líneas 66–74 y 123–172.
- `src/stores/aiStore.ts`, `saveSettings` y check de conexión aproximadamente líneas 138–169.
- `src/stores/imageRuntimeStore.ts`, refresh y pushes aproximadamente líneas 50–54 y 125–131.

**Corrección requerida**

- Añade identidad de petición/secuencia o cancelación a cada carga; solo la última petición relevante puede publicar.
- Serializa o fusiona `saveSettings` para que dos cambios concurrentes no partan del mismo snapshot y se borren entre sí en memoria.
- Un check de conexión solo puede publicar si la URL/proveedor comprobado sigue siendo el activo.
- Un refresh pendiente de Image Runtime no puede pisar un estado push más reciente.
- Prueba todos los casos con promesas diferidas y resolución deliberadamente invertida.

### Gate de la fase

- Existe un indicador global accesible de “Guardando / Guardado / Error”.
- Un rechazo conserva el estado dirty y ofrece retry.
- El cierre espera o se cancela de forma explícita.
- Cerrar justo después de mover una tarjeta conserva su posición al reabrir.
- Ninguna promesa vieja puede repoblar un scope distinto.
- Ninguna respuesta antigua puede pisar la configuración, conexión o estado runtime más reciente.

---

## Fase 3 — Backups, recetas y ciclo de vida

### 3.1 P1 — Las recetas exactas de Image Studio no se persisten

**Evidencia**

- `AiGeneratedImage.recipe` existe en `src/services/aiRuntime/types.ts`.
- `ImageGenerationInfo.recipeId` y `recipeHash` existen en `src/types/index.ts`.
- La tabla `imageRecipes` existe en `src/db/index.ts` v30.
- `src/engines/image-studio/operations.ts`, `saveGenerated`, guarda la imagen y sus parámetros, pero no escribe `image.recipe` ni enlaza `recipeId`/`recipeHash`.
- `src/engines/image-studio/index.ts` declara backup para `visualRefs`, no para `imageRecipes`.

**Corrección requerida**

- Corrige primero `recipeHash`: `canonicalJson(..., true)` elimina hoy `id`, `createdAt` y `hash` de forma recursiva, por lo que cambiar `model.id`, un `lora.id` o un asset `id` puede conservar indebidamente el hash; al mismo tiempo, metadatos raíz como `projectId`, `imageId` o `updatedAt` pueden contaminarlo si se pasa una fila Dexie.
- Proyecta explícitamente los campos semánticos de `Recipe`, excluye solo metadatos de fila en la raíz y conserva todos los IDs anidados. Prueba que cambiar modelo, LoRA o input cambia el hash y que cambiar metadatos de fila no lo hace.
- En la misma transacción que guarda la imagen, persiste la receta devuelta por el runtime.
- Calcula/verifica el hash con `recipeHash` de `src/services/aiRuntime/recipe.ts`.
- Enlaza la fila de galería mediante `recipeId` y `recipeHash`.
- Incluye `imageRecipes` en exportación, validación, importación, reemplazo y borrado del proyecto.
- Conserva compatibilidad con imágenes antiguas que solo tengan `generation` legacy.
- Conecta la recuperación desde PNG y la reproducción usando la receta exacta, sin degradarla a los campos legacy.

**Criterios de aceptación**

- Generar→guardar crea imagen y receta enlazadas atómicamente.
- Exportar→borrar→importar conserva el mismo hash y una receta reproducible.
- Una imagen sin receta sigue abriendo mediante fallback legacy.
- Un fallo de cuota no deja una imagen huérfana ni una receta huérfana.

### 3.2 P2 — El backup no es un punto coherente en el tiempo

**Evidencia**

- `src/services/zipBackup.ts`, lecturas aproximadamente líneas 263–286.
- `src/services/autoBackup.ts`, lecturas aproximadamente líneas 382–413.
- Las tablas se leen secuencialmente sin una única revisión de lectura.

**Corrección requerida**

- Captura todas las filas de usuario dentro de una única transacción de solo lectura.
- Copia los datos rápidamente y realiza serialización, compresión y checksums fuera de la transacción.
- Añade un manifiesto versionado con tablas, conteos, checksums, versión de esquema y exclusiones explícitas.
- El check de cobertura debe inspeccionar todas las tablas reales, incluidas las que no pertenezcan a un motor. Las cachés pueden excluirse solo con una razón declarada.
- Ejecuta una validación/dry-run antes de presentar un backup como correcto.

### 3.3 P2 — El ZIP “completo” omite settings del proyecto

**Evidencia**

- `src/services/zipBackup.ts`, `createProjectZipArchive`, aproximadamente líneas 300–320.
- Restore elimina settings project-scoped aproximadamente en líneas 678–683, pero la exportación no los incluye.
- `src/services/deleteSafetyNet.ts` presenta el ZIP previo al borrado como copia completa.

**Corrección requerida**

- Define una allowlist explícita de settings pertenecientes al proyecto.
- Incluye historial de sprints, búsquedas guardadas, posición de lectura, privacidad y preferencias que sean realmente project-scoped.
- Nunca exportes tokens, claves, secretos ni configuración global.
- Actualiza el test que actualmente consagra la omisión para que exija round-trip.

### 3.4 P2 — Cachés Worldgen huérfanas

**Evidencia**

- `src/db/operations.ts`, borrado de proyecto, aproximadamente líneas 132–172.
- `src/services/zipBackup.ts`, replace/restore, aproximadamente líneas 638–684.
- Se limpian `worldSnapshots` o `canonTiles` de forma parcial; `renderedTiles` queda fuera de alguna ruta.

**Corrección requerida**

- Resuelve primero los `worldId` del proyecto.
- En delete y replace, limpia `worldSnapshots`, `canonTiles` y `renderedTiles` de esos mundos dentro del ciclo transaccional correcto.
- No toques cachés de otros proyectos.
- Conserva estas tablas fuera del ZIP si siguen siendo regenerables, pero decláralas como exclusiones conscientes en el manifiesto.

### 3.5 Fundación para un centro de backups verificable

Expón desde el servicio, sin construir todavía una interfaz avanzada:

- fecha, proyecto, tamaño y versión;
- cobertura, conteos, checksum e integridad;
- resultado del preflight/dry-run;
- exclusiones regenerables y errores estructurados.

La UI mínima solo debe comunicar éxito o fallo real. La experiencia completa se construye en la Fase 7. No prometas “backup correcto” si el manifiesto, checksum o dry-run fallan.

---

## Fase 4 — Seguridad y Electron

### 4.1 P1 — Dependencias con vulnerabilidades conocidas

**Estado auditado**

- `@tiptap/core@3.20.0`: vulnerabilidad moderada en `mergeAttributes`; corrección disponible en `>=3.30.4`. Aviso: <https://github.com/advisories/GHSA-p498-v437-472g>
- `@humanfs/node@0.16.7`, transitiva de ESLint: vulnerabilidad moderada relacionada con enlaces simbólicos; corrección en `>=0.16.8`. Aviso: <https://github.com/advisories/GHSA-cp6q-959q-f8rh>

**Corrección requerida**

- Actualiza toda la familia `@tiptap/*` en bloque a una versión alineada y compatible; no mezcles minors.
- Actualiza ESLint o su árbol transitivo hasta resolver `@humanfs/node`.
- Regenera el lockfile sin `force` ni upgrades mayores indiscriminados.
- Prueba edición, guardado, pegado de HTML sanitizado y reapertura.

### 4.2 P1 — El servidor HTTP local de medios confía en Origin ausente/null

**Evidencia**

- `electron/media/server.ts`, validación de origen aproximadamente líneas 45–48.
- El servidor no exige una credencial por sesión.

**Corrección requerida**

- Genera un token criptográficamente aleatorio por arranque.
- Prefiere una API estrecha de preload que realice la petición o inyecte la cabecera sin ofrecer un getter general del token. Si la arquitectura obliga a manejarlo en renderer, mantenlo solo en memoria y no expongas una API que permita persistirlo o registrarlo.
- Exígelo en una cabecera privada en todas las rutas operativas `/api`.
- Incluye esa cabecera en `Access-Control-Allow-Headers` y prueba el preflight sin ejecutar operaciones.
- Mantén bind exclusivo a loopback y una allowlist exacta de orígenes como segunda defensa. La opción preferida es servir el renderer empaquetado desde un protocolo propio seguro y permitir ese origen exacto.
- Si se conserva `file://`, acepta `Origin` ausente o `null` únicamente con token válido. Nunca lo consideres confiable por sí mismo.
- Nunca pongas el token en URL, logs, disco ni mensajes de error.

### 4.3 P1 — HTTP evita la cola única de yt-dlp/FFmpeg

**Evidencia**

- `electron/media/server.ts` llama directamente a `downloadMedia`.
- La ruta IPC en `electron/main.ts` sí usa una cola de concurrencia 1.
- `src/services/mediaDownloader.ts` usa la ruta HTTP.

**Corrección requerida**

- Extrae una única cola/servicio compartido por HTTP e IPC.
- Mantén concurrencia 1, cancelación, prioridad reducida y tree-kill al cerrar.
- Los errores deben liberar la cola y los trabajos pendientes deben poder cancelarse.

### Criterios de aceptación de seguridad

- `npm audit --audit-level=moderate` pasa.
- Toda la familia `@tiptap/*` queda alineada; `npm ls` no muestra paquetes `invalid` ni conflictos de peer dependencies.
- Peticiones sin token, con token incorrecto u origen no permitido responden 401/403 y no lanzan procesos. Un origen ausente o `null` sin token válido también se rechaza.
- Desarrollo y app empaquetada descargan con token válido.
- Una descarga HTTP y otra IPC simultáneas comparten la misma cola: solo una crea procesos y la otra espera. Cancelar una pendiente no crea procesos y un error libera el siguiente turno.
- Cerrar la app no deja procesos descendientes.
- Se conservan `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, navegación estricta, allowlist IPC, esquemas externos restringidos y `safeStorage`.

---

## Fase 5 — Accesibilidad, UX e internacionalización

### 5.1 P1 — Crear un único diálogo accesible

**Evidencia**

- `src/components/common/Modal.tsx` carece de `role="dialog"`, `aria-modal`, asociación de título, foco inicial, focus trap, restauración e inertización del fondo.
- Hay aproximadamente 19 overlays `fixed inset-0` con implementaciones propias. Clasifica primero cada uno: un modo fullscreen como Reading View o Teleprompter no es necesariamente un diálogo.
- Ejemplos: `FactEditor.tsx`, `BeatEditor.tsx`, `SegmentEditor.tsx`, `GalleryLightbox.tsx`.

**Contrato requerido**

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` o `aria-label`.
- Foco inicial dentro; Cancelar por defecto en confirmaciones destructivas.
- `Tab` y `Shift+Tab` ciclan dentro.
- Fondo sin foco ni interacción mientras está abierto.
- Escape, backdrop y X siguen una política explícita.
- El foco vuelve exactamente al invocador.
- X tiene `type="button"` y nombre traducido.
- Estado busy evita doble submit y se anuncia.
- Contenido desplazable con overscroll contenido.
- Dirty guard para `EditProjectModal`, `PublishingProfileModal` y cualquier editor con borrador.

Migra como mínimo `FactEditor`, `BeatEditor`, `SegmentEditor`, `GalleryLightbox`, `GoalSetter` e `ImportCollectionModal`. Después clasifica los overlays restantes y elimina la semántica ad hoc solo en los que sean realmente modales.

### 5.2 P1 — Contraste insuficiente

**Evidencia**

- `src/index.css`: `--color-text-dim: #5a5665`.
- Contraste medido: 2.64:1 sobre `surface`, 2.42:1 sobre `elevated`, 2.83:1 sobre `deep`.
- El token se usa cientos de veces, a menudo en texto de 9–11 px.

**Corrección requerida**

- Ajusta tokens, no cientos de componentes individualmente.
- Texto normal ≥4.5:1; texto grande, controles, bordes significativos y foco ≥3:1.
- Ningún `outline-none` sin foco visible equivalente.
- Selección, error y éxito no dependen solo del color.
- Añade una comprobación automática para combinaciones críticas de tokens y verifica estilos computados representativos con opacidad, gradientes y estados reales.
- Declara `color-scheme: dark` y un `theme-color` coherente para que los controles y superficies nativas respeten el tema oscuro.

### 5.3 Navegación y controles semánticos

- Convierte Sidebar de botones con `navigate()` a enlaces/`NavLink` con `aria-current`; prueba Ctrl+clic y clic central en la versión web.
- Conserva nombre accesible traducido al colapsar.
- Añade “Saltar al contenido” y destino enfocable en `<main>`.
- Garantiza un único `h1` lógico por ruta y un foco predecible después de navegar.
- Convierte `FactCard` y las imágenes clicables de Gallery en controles de teclado reales; `FactCard` debe exponer `aria-expanded` y `aria-controls`.
- Da etiquetas a `NewItemForm`, `HexInput`, botones de icono y Settings. Todo botón reutilizable que no envíe un formulario debe declarar `type="button"`.
- Implementa teclado y semántica slider en `SaturationCanvas` y `HueSlider`; anuncia presets con `aria-pressed`.
- Anuncia estados async y resultados de búsqueda mediante `role="status"` o `aria-live="polite"` sin producir ruido excesivo.
- Las acciones actualmente invisibles con `opacity-0` deben aparecer con `focus-within` y bajo `@media (hover: none)`.

### 5.4 Movimiento reducido

- Crea una única preferencia utilizable desde CSS y Framer Motion: el sistema es el valor por defecto y un override explícito del usuario puede persistirse.
- Detén `float`, `pulse-gold` y loops decorativos bajo `reduce`.
- Bajo `reduce`, elimina movimiento espacial y loops; permite solo fades opcionales de ≤100 ms. Los indicadores de progreso esenciales conservan estado accesible aunque dejen de girar.
- Elimina todos los `transition-all` y enumera propiedades.
- Permite cambiar la preferencia del sistema sin reiniciar.

### 5.5 Idioma y formato regional

**Evidencia**

- `src/stores/localeStore.ts` fuerza español al inicio, no consulta `navigator.languages` y no sincroniza `<html lang>`.
- Worldgen contiene `toLocaleString('es-ES')`/`'es'` fijos.
- Quedan literales como “Lie”, “Quick picks”, “Adjust Image”, “dibujando…”, “Guardar”, “Close” y “source/s”.

**Corrección requerida**

- Si no hay preferencia guardada, deriva idioma de `navigator.languages` con fallback documentado.
- Evita flash de idioma incorrecto.
- Sincroniza `document.documentElement.lang` en cada cambio.
- Lleva todo copy traducible visible, `title`, `aria-label`, placeholder y estado a locales. Mantén una allowlist revisada para marcas, acrónimos, código y contenido del usuario; usa `translate="no"` cuando proceda.
- Usa `Intl.NumberFormat`, `Intl.DateTimeFormat` e `Intl.PluralRules` con el locale activo para datos estructurados, nunca para reescribir fechas ficticias o texto libre del autor.
- Mantén paridad total de claves español/inglés y añade una prueba que recorra registros dinámicos de engines, tipos y catálogos, no solo llamadas literales a `t()`.

### Gate de la fase

- Cero violaciones críticas de axe en rutas y diálogos principales.
- Flujo principal completo solo con teclado.
- Cero controles interactivos invisibles al foco.
- Cero texto activo renderizado por debajo de AA; documenta las exclusiones legítimas de controles deshabilitados y decoración.
- Cero animaciones no esenciales activas con reduced motion.
- Cero copy traducible conocido fuera de i18n; marcas, acrónimos, código y contenido del usuario quedan en la allowlist revisada.
- Revisión visual en español/inglés, Sidebar abierta/cerrada, zoom 100 %/200 % y movimiento normal/reducido.

---

## Fase 6 — Rendimiento y escalabilidad

### 6.1 Importación multimedia acotada y decisión sobre almacenamiento

**Problema**

- `src/components/gallery/InspirationGallery.tsx` lee un lote completo en paralelo como Data URL.
- Base64 aumenta el tamaño y mantiene originales grandes en memoria.
- Las imágenes viven en Dexie; moverlas a disco podría mejorar cuota y rendimiento, pero afectaría backup y portabilidad y requiere evidencia antes de decidir.

**Corrección inmediata requerida**

- Importa con cola de concurrencia limitada, progreso, pausa/cancelación, error aislado y retry.
- Comprime, procesa y libera cada buffer antes de avanzar; no mantengas en memoria todos los originales del lote.
- Fija en Fase 0 el entorno y un presupuesto numérico de memoria comparando lotes equivalentes de 20 y 100 imágenes. Separa memoria transitoria de buffers y memoria necesaria para resultados persistentes.

**Feature arquitectónica condicionada**

- Antes de mover bytes fuera de Dexie, escribe un ADR con benchmark de cuota, memoria, backup, portabilidad y recuperación.
- Solo si la evidencia lo justifica, crea una biblioteca gestionada en disco por Electron con metadatos y rutas relativas en Dexie, deduplicación SHA-256, miniaturas y migración reversible de Data URLs antiguas.
- Una transacción Dexie no puede dar atomicidad conjunta con filesystem. Si se aprueba el cambio, usa assets inmutables/content-addressed; el backup captura referencia y hash, comprueba que cada archivo existe y falla/reintenta si cambia. Reabre los tests y el manifiesto de la Fase 3.
- No ejecutes esta migración como efecto colateral del arreglo de concurrencia.

**Criterios de aceptación**

- Un lote de 100 imágenes no usa `Promise.all` para convertir todos los archivos a Data URL.
- El pico transitorio respeta el presupuesto fijado antes de implementar y no crece linealmente entre los lotes de 20 y 100 por conservar originales pendientes.
- Fallar un archivo no cancela el lote completo.
- Si se aprueba la biblioteca en disco, backup/restore y exportación portable resuelven correctamente todos los assets asociados.

### 6.2 Colecciones grandes

**Evidencia**

- `src/components/codex/CodexEntryList.tsx` filtra y remonta toda la colección en cada pulsación y carga todos los avatares.
- No hay virtualización o paginación común.

**Corrección requerida**

- Usa `useDeferredValue` o estrategia equivalente.
- Virtualiza o pagina Codex y reutiliza el patrón en escritos y pickers grandes.
- Mantén navegación por teclado, foco y selección con windowing.
- Añade dimensiones/aspect ratio y lazy loading bajo el fold a imágenes.
- Usa alt significativo cuando la imagen transmite información.

**Presupuestos de aceptación**

- Define antes de optimizar un protocolo estable: build de producción, hardware, viewport, fixture, calentamiento, cinco repeticiones y reporte de mediana/p95.
- Fixture de 5.000 entradas: p95 de tareas de escritura/búsqueda inferior a 50 ms y respuesta visual p95 inferior a 100 ms en el equipo de referencia.
- Presupuesto de ≤100 nodos de item montados por viewport más overscan, no como constante global de todo el DOM.
- Prueba adicional con 1.000 miniaturas y CLS ≤0.1 durante el flujo medido.

### 6.3 Limpieza visual de bajo riesgo

- Define `width`/`height` o proporción reservada para las imágenes relevantes.
- Corrige lightbox: diálogo, Escape, foco, alt y botón Close traducido.
- Sustituye `...` por `…` en copy visible.
- Cambia el título HTML `writers-hoard` por el nombre de producto correcto y elimina el favicon de Vite.
- No rediseñes la identidad oscura/dorada: es coherente y propia del producto.

---

## Fase 7 — Features a construir sobre la base corregida

### 7.1 Historial, papelera y recuperación

- Papelera temporal para conversiones, proyectos y entidades con eliminación diferida.
- Vista del recibo de conversión y cambios posteriores.
- Restauración selectiva sin sobrescribir la versión viva.

### 7.2 Experiencia avanzada de guardado y conflictos

- Construye sobre el registro y estado mínimo de la Fase 2; no los dupliques.
- Añade historial de errores, detalle por operación y acciones de retry.
- Enriquece los conflictos con diff y opciones local/remoto/fusionar.
- Reutiliza la misma experiencia para Google Docs, editores, autosave, Board e importaciones.

### 7.3 Explorador de procedencia de imágenes

- Mostrar receta, hash, modelo, LoRAs, seed, inputs y cadena de pasos.
- Comparar dos recetas campo a campo.
- Regenerar cuando estén disponibles todos los assets.
- Detectar y explicar modelos/LoRAs ausentes.
- Recuperar receta desde PNG y enlazarla a la galería.

### 7.4 Perfil de accesibilidad

- Movimiento reducido, contraste reforzado y escala de texto.
- Inicialización desde preferencias del sistema.
- Preview inmediato y persistencia local.

### 7.5 Centro de migraciones

- Fixtures por cada versión destructiva.
- Copia automática antes de upgrade.
- Informe de migración con conteos y errores.
- Rollback o recuperación guiada cuando sea técnicamente posible.

### 7.6 Centro de backups y recuperación

- Muestra fecha, proyecto, tamaño, versión, cobertura, checksums y resultado del dry-run.
- Permite restaurar después de un preflight con resumen exacto de cambios.
- Explica exclusiones regenerables y bloquea archivos corruptos.
- Incluye diagnóstico y reparación guiada de filas huérfanas y scopes cruzados.

### 7.7 Centro de salud de la aplicación

Amplía la vista `health` que ya existe en Project Cockpit; no construyas un segundo diagnóstico aislado. Debe reunir en una sola superficie local:

- integridad de la base y referencias huérfanas;
- fecha, antigüedad y validez del último backup;
- escrituras pendientes, fallidas y recuperaciones disponibles;
- espacio libre, cuota de almacenamiento y cachés regenerables huérfanas;
- estado de runtimes de IA, modelos y descargas interrumpidas;
- versión de esquema, última migración y cualquier recuperación incompleta.

Presenta primero el estado general y las acciones concretas; los detalles técnicos quedan desplegables. Cada reparación debe ofrecer preview, alcance, resultado y, cuando sea posible, undo. Todo se calcula localmente: no añadas telemetría externa ni conviertas la salud en una puntuación alarmista.

**Criterios de aceptación**

- Un estado sano se entiende de un vistazo y no exige mantenimiento al usuario.
- Cada problema enlaza a la entidad o acción exacta que lo resuelve.
- Las comprobaciones costosas son cancelables y no bloquean el renderer.
- Un fallo de diagnóstico se muestra como “no comprobado”, nunca como “correcto”.
- La pantalla funciona sin IA, cuenta con teclado y lector de pantalla y no expone rutas, tokens ni contenido sensible.

---

## Fase 8 — Laboratorio creativo: explorar y desarrollar ideas

Esta fase es el corazón creativo del producto. Writers Hoard debe ayudar a pasar de una chispa a varias posibilidades, tensionarlas, entender sus consecuencias y elegir qué se convierte en canon. No es un CRM editorial ni un embudo de publicación. No empieces todas las iniciativas a la vez: entrega cortes verticales en el orden de dependencias descrito abajo, valida cómo cambian la exploración real y solo entonces amplía. Las estimaciones son relativas: **S** 2–5 días, **M** 1–3 semanas, **L** 3–6 semanas y **XL** una iniciativa de varias fases.

```text
capturar → expandir → conectar → tensionar → ramificar → comparar → elegir canon → desarrollar
```

### Principios de producto

- Extiende Writings, Cockpit, Proofreader, Codex, Timeline y Board antes de crear otro motor.
- Una vista derivada referencia la entidad original; no copia contenido que luego pueda divergir.
- Todo flujo central funciona localmente. La IA es opcional, explica sus fuentes y nunca reescribe contenido sin confirmación.
- Primero abre posibilidades; después ayuda a converger. Nunca decide qué idea es “mejor”.
- Las métricas literarias describen tensiones y diferencias; no califican la calidad ni imponen una fórmula narrativa.
- Una posibilidad descartada puede archivarse o recuperarse sin contaminar el canon activo.
- Toda promoción a canon muestra qué cambia y puede deshacerse.
- La complejidad avanzada aparece de forma progresiva. Un proyecto nuevo debe poder ignorar estas features.
- Datos derivados, embeddings y vistas generadas son reconstruibles; si se excluyen del backup, el manifiesto lo declara.

### Priorización

| Nivel | Feature | Valor principal | Reutiliza | Esfuerzo |
|---|---|---|---|---:|
| A0 | Judge: referencias y crítica contextual | Contrastar lo escrito con métodos elegidos y el resto de la obra | Writings, search, citations, copilot, assets | M–L |
| A1 | Mesa de ideas | Expandir una chispa sin perder su origen | Notes, Board, Codex, Gallery | M |
| A2 | Ramas “qué pasaría si” | Probar alternativas sin alterar el canon | Outline, Timeline, snapshots | L |
| A3 | Mapa causal y de consecuencias | Expandir repercusiones y encontrar cadenas débiles | links, Seeds, Timeline, Spine, Board | M |
| A4 | Cámara de presión de personajes | Encontrar conflicto a partir de fuerzas internas | Codex, Relationships, Character Arc | M |
| A5 | Laboratorio de reglas del mundo | Explorar reglas, costes, límites y excepciones | Codex, Worldgen, Timeline | M/L |
| A6 | Mapa de conocimiento y secretos | Controlar quién sabe qué y cuándo | Timeline, Scene Cast, Codex | L |
| B1 | Continuidad factual | Desarrollar estados físicos y relacionales en el tiempo | Codex, Timeline, scenes | L |
| B2 | Constelación de motivos y temas | Observar resonancias sin imponer significado | annotations, search, Board | M |
| B3 | Radiografía narrativa | Explorar voz, ritmo, energía y threads | Spine, Board, Dialog, Stats | M–L |
| B4 | Laboratorio de escenas | Comparar versiones de una misma situación | Scenes, Writings, snapshots | M–L |
| B5 | Arqueología de ideas | Ver cómo una idea evolucionó hasta el canon | receipts, links, snapshots, Notes | L |
| B6 | Lectura crítica en voz alta | Escuchar ritmo y voz mientras se desarrolla | Writings, reader, annotations | M |
| C1 | Universo compartido | Explorar canon entre varios proyectos | Projects, Codex, Timeline, Relationships | L–XL |

### Fundaciones compartidas y orden viable

No implementes cada feature con su propio modelo. Resuelve primero estas primitivas:

```text
ingesta + revisión grounded ──→ A0 Judge
relaciones causales tipadas ──→ A3
kernel único de ramas ────────→ A2 ──→ B4 ──→ Timeline alternativa avanzada
eje narrativo común ──────────→ A6 ──→ B1 ──→ B2 / B3
ledger de procedencia ────────→ B5
identidad de serie ───────────→ C1
backup íntegro ───────────────→ checkpoints selectivos
```

- **Relaciones causales:** vocabulario mínimo `causa`, `consecuencia`, `obstáculo`, `habilita`, `contradice`, `coste` e `hipótesis`, con certeza y estado canónico. A3 visualiza y analiza el mismo grafo.
- **Revisión grounded:** una única tubería de ingesta, recuperación, citas y permisos sirve al botón Judge, al copiloto interno y a agentes externos. No construyas tres analizadores distintos.
- **Kernel de ramas:** entidad raíz, revisión/hash base, deltas, estado activa/archivada/promovida, preview de promoción, conflictos y recibo reversible. Outline y Timeline consumen la misma primitiva.
- **Eje narrativo:** referencias explícitas a beat, escena o evento y una regla de comparación común. No infieras orden desde fechas ficticias en texto libre.
- **Procedencia:** para prometer recuperación hace falta un ledger con tombstones o payload mínimo restaurable; receipts y snapshots actuales no cubren todo.
- **Serie:** identidad cross-project, overrides, resolvers, borrado y backup del conjunto deben cerrarse en ADR antes del esquema.

Orden recomendado: A0 Judge con un formato y un scope pequeño → modo Baraja dentro de A1 → Mesa de ideas → A3 inicialmente read-only → A4 como plantilla → kernel de ramas y A2 → eje narrativo → A5/A6 → features B → universo compartido.

### A0 — Judge: biblioteca de referencia y crítica contextual

**Trabajo del usuario:** subir documentación que considere valiosa —por ejemplo *Anatomy of Film Perfection*— y usarla como lente explícita para criticar una selección, escena, capítulo o manuscrito. Judge también puede contrastar el texto con otros capítulos y con el canon del proyecto.

#### Superficie principal

- Añade un botón **Judge** al sidepanel de Writings; no lo escondas en Settings ni abras un flujo separado del texto.
- Al pulsarlo, el usuario elige alcance: selección, escena/capítulo actual o conjunto de escritos. El MVP usa capítulo actual por defecto.
- Elige una o varias lentes de referencia y qué contexto interno permitir: capítulos anteriores, capítulos seleccionados, Codex, Outline y Timeline.
- Modos simples: `Referencia`, `Continuidad interna` o `Ambas`. La interfaz muestra siempre qué fuentes están activas.
- El análisis aparece en el mismo sidepanel como hallazgos navegables; no sustituye el documento por un chat genérico.

#### Una sola superficie, cuatro modos

El sidepanel no debe convertirse en una colección de botones inconexos. Usa una única superficie con cuatro modos que comparten alcance, fuentes, permisos, anchors e historial:

| Modo | Trabajo creativo | Regla esencial |
|---|---|---|
| **Judge** | Criticar mediante lentes documentales y continuidad interna | Toda observación lleva evidencia y nunca puntúa la “calidad” |
| **Questions** | Interrogar decisiones mediante preguntas socráticas | No propone soluciones ni reescribe; abre posibilidades |
| **Reader** | Examinar qué sabe, recuerda, sospecha o espera el lector en ese punto | El contexto excluye técnicamente capítulos posteriores |
| **Story State** | Inspeccionar el estado del mundo en una escena/beat | Distingue dato confirmado, hipótesis, contradicción y dato ausente |

Cambiar de modo conserva el fragmento o capítulo seleccionado y no dispara un análisis hasta una acción explícita.

##### Questions — Socratic Judge

- Formula preguntas específicas y grounded: “¿Qué hace posible esta confianza si el capítulo 3 estableció lo contrario?”.
- Puede usar una lente, el contexto del proyecto o ambos, pero cita siempre la evidencia que originó la pregunta.
- No incluye botón de “aplicar corrección”. Sus salidas pueden guardarse en Mesa de ideas o en Question Garden.
- Ofrece profundidad corta/media/intensa sin cambiar el tono del autor ni convertir la sesión en interrogatorio infinito.

##### Reader — Reader's Mind

- Construye el contexto únicamente con texto y revelaciones anteriores al punto elegido. El filtro se aplica antes de recuperar fragmentos o llamar al modelo, no solo dentro del prompt.
- Separa `el lector sabe`, `puede sospechar`, `se le prometió` y `permanece abierto`.
- Muestra cuándo apareció por última vez una pista, personaje o pregunta, sin asumir que frecuencia equivale a importancia.
- El usuario puede marcar una inferencia como demasiado obvia, deliberadamente ambigua o incorrecta.
- Requiere el eje narrativo común; ante orden incompleto muestra alcance parcial y nunca consulta el futuro para “mejorar” la respuesta.

##### Story State — depurador narrativo

Al seleccionar una escena, beat o evento muestra una instantánea consultable de:

- ubicación de cada personaje relevante;
- hechos físicos/biográficos vigentes, heridas, posesiones y recursos;
- conocimiento, creencias, secretos y mentiras por actor;
- estado de relaciones y arcos;
- reglas del mundo y excepciones activas;
- seeds, promesas y preguntas todavía abiertas;
- qué conoce el lector en ese mismo punto.

Story State depende de A6, B1 y del eje narrativo. No rellena huecos con invenciones: `sin dato`, `no aplicable` y `contradicción` son estados diferentes y visibles. Desde cualquier fila se abre la fuente o se crea una hipótesis en Mesa de ideas.

#### Modos auxiliares dentro de la misma experiencia

- **Lens Duel:** si hay dos o más lentes, ejecuta cada una por separado y coloca sus observaciones lado a lado. Destaca acuerdos y desacuerdos sin fusionar criterios ni elegir ganador.
- **Devil's Advocate:** acción sobre un hallazgo que construye la mejor defensa posible de la decisión original, señala qué tendría que sostenerla y qué riesgo permanecería. No borra ni resuelve la crítica.
- **Question Garden:** vista derivada de preguntas guardadas desde Judge, Mesa de ideas, Board y Notes. Estados creativos: `abierta`, `explorando`, `respondida` y `ambigüedad deliberada`; nunca usa lenguaje de tickets, vencimientos o productividad. Reutiliza el rol `question` de Board y enlaces existentes antes de añadir almacenamiento.

Cada hallazgo debe contener:

1. pasaje exacto del escrito y ancla para volver a él;
2. observación o pregunta crítica, sin nota numérica de “calidad”;
3. principio de la lente y cita verificable con documento, página/sección;
4. cuando corresponda, pasaje de otro capítulo o entidad del proyecto que sustenta la contradicción;
5. nivel de confianza y límites del contexto revisado;
6. acciones: ir al pasaje, crear anotación, convertir en hipótesis/tarea de desarrollo, descartar como intencional o pedir una alternativa;
7. cualquier cambio sugerido como diff revisable, nunca aplicado automáticamente.

#### Biblioteca de referencias

- Biblioteca personal reutilizable entre proyectos, con asociación explícita a cada proyecto. Un archivo se guarda una vez y se enlaza; no se duplica por obra.
- MVP: PDF con capa de texto, Markdown y TXT. DOCX/EPUB y OCR para escaneos llegan después de medir necesidad.
- Conserva original gestionado, SHA-256, versión, metadatos, páginas/secciones y estado de indexación.
- Permite seleccionar capítulos o rangos del documento para una lente; un libro entero no tiene por qué gobernar todos los análisis.
- Puede extraer una guía de criterios, pero el usuario revisa, edita y aprueba cada criterio antes de activarlo. El documento original sigue siendo la autoridad.
- Dos lentes que discrepan se muestran por separado; no mezcles sus reglas silenciosamente.
- Borrar o reemplazar un documento invalida su índice. Los análisis anteriores marcan la fuente como ausente o versionada, sin fingir que siguen siendo reproducibles.

#### Contexto de otros capítulos

- Indexa los escritos localmente y recupera solo los fragmentos relevantes, con identidad de capítulo y ancla estable.
- Un hallazgo de continuidad cita el pasaje actual y el pasaje previo que entra en conflicto.
- El usuario puede limitar el contexto a capítulos anteriores para evitar que Judge use información que el lector todavía no conoce.
- Cada ejecución fija la revisión/hash del texto objetivo y de las fuentes consultadas. Si alguno cambia, el resultado muestra `Desactualizado` y ofrece volver a analizar.

#### Arquitectura y privacidad

- Reutiliza el mismo núcleo de herramientas, permisos y auditoría del copiloto interno y del MCP externo, de acuerdo con `tasks/lessons.md` #23.
- Ese núcleo debe permitir listar lentes autorizadas, recuperar evidencia citada, ejecutar una revisión contra una revisión concreta del escrito y devolver hallazgos estructurados. No entregues a un agente una ruta de archivo ni acceso libre a toda la biblioteca.
- La ingesta, el índice léxico y la selección de fragmentos funcionan localmente. La búsqueda semántica local puede añadirse como mejora, no como requisito del MVP.
- Con modelo local, ningún texto sale del equipo. Con modelo remoto, exige opt-in por ejecución o política explícita, muestra un resumen de lo que se enviará y limita el payload a los fragmentos necesarios.
- No envíes el libro de referencia completo ni el manuscrito completo por comodidad. No registres contenido en logs.
- Los documentos son material privado del usuario: no se comparten, publican ni reutilizan para otros proyectos sin una asociación consciente.
- Separa propiedad global del documento y vínculo project-scoped. Borrar un proyecto retira su vínculo, no una referencia usada por otras obras; borrar la referencia muestra primero todos los proyectos y análisis afectados.
- El backup del proyecto incluye manifiesto, hash y lentes asociadas. Incluir el archivo original es una opción explícita por tamaño y derechos; si no se incluye, restore marca la fuente como pendiente de relink. Un backup completo de la aplicación sí debe poder preservar la biblioteca personal.
- Los capítulos de Google Docs se analizan desde la copia local disponible. Judge no inicia una descarga o autenticación externa silenciosa para ampliar contexto.
- Las sugerencias que modifiquen Writings usan snapshots, escritura versionada y el sistema de conflictos de la Fase 2.

#### Estados de UX

- Sin referencias: Judge puede ejecutar continuidad interna y ofrece añadir una lente sin bloquear el panel.
- Indexando: progreso por documento, cancelación y uso parcial solo cuando los anchors estén listos.
- Listo: muestra lente, versión, alcance y contexto antes de ejecutar.
- Analizando: cancelable y sin bloquear la edición.
- Resultado: agrupado por lente y tipo, con salto al pasaje.
- Desactualizado: conserva el resultado como historial, pero no lo presenta como vigente.
- Error o fuente ilegible: explica si falta texto, OCR, permisos o modelo; nunca equivale a “sin problemas”.

#### Criterios de aceptación

- Cada afirmación atribuida a una referencia enlaza a una página/sección real; una cita no encontrada invalida ese hallazgo.
- Cada contradicción interna enlaza a ambos pasajes.
- Cambiar el capítulo o la referencia marca la ejecución como desactualizada.
- Descartar como intencional conserva la decisión y evita repetir el mismo ruido mientras las evidencias no cambien.
- Ninguna corrección se aplica sin preview y confirmación; antes de escribir se crea snapshot.
- El flujo funciona con un documento, varias lentes contradictorias y sin documentación externa.
- Borrar proyecto, borrar referencia, backup y restore mantienen ownership e índices coherentes; el índice derivado puede regenerarse.
- La ruta remota revela y registra localmente qué fragmentos fueron enviados, sin guardar secretos ni el texto completo en logs.
- Cambiar entre Judge, Questions, Reader y Story State conserva alcance y fuentes sin crear conversaciones duplicadas.
- Questions no devuelve texto sustitutivo; Reader no puede recuperar contenido posterior al punto elegido.
- Lens Duel conserva la identidad y citas de cada lente; Devil's Advocate no marca una crítica como resuelta.
- Story State diferencia con claridad dato confirmado, hipótesis, contradicción y ausencia de información.
- Question Garden enlaza a fuentes canónicas y no materializa copias de capítulos, entidades o hallazgos.

### A1 — Mesa de ideas

**Problema:** una nota aislada captura una chispa, pero no ayuda a descubrir en qué puede convertirse ni conserva las rutas descartadas.

**MVP:** selecciona una o varias notas, entidades, imágenes o semillas y abre una sesión/vista temporal sobre esas fuentes, no otro almacén paralelo de tarjetas. Ofrece operaciones creativas explícitas: combinar, invertir una premisa, retirar un elemento, cambiar escala, mover época/lugar, cambiar POV, elevar el coste o preguntar “¿qué tendría que ser verdad?”. Solo las posibilidades todavía no promovidas necesitan estado efímero propio; al promoverlas se convierten en Note, Board, Codex, Seed, Outline o Timeline y conservan sus fuentes.

Incluye como modo ligero una **Baraja de restricciones** que combine material real y poco usado. Permite bloquear elementos y volver a tirar los demás con verbos como “combina”, “quita”, “invierte”, “hazlo inevitable” o “cambia quién paga”. No es una feature ni una base de datos aparte.

**Límites:** las operaciones deterministas funcionan sin IA. Si la IA expande una tarjeta, se guarda prompt, fuentes y modelo; nada entra en el canon hasta una acción expresa.

**Éxito:** el usuario puede generar, agrupar, comparar, archivar y promover posibilidades sin duplicar a mano los materiales originales.

### A2 — Ramas de “qué pasaría si”

**Problema:** probar otro giro, orden o desenlace obliga hoy a alterar la estructura vigente o duplicar el proyecto entero.

**MVP:** sobre el kernel compartido, ramifica Outline o Timeline desde un beat/evento, edita solo la alternativa y compara deltas explícitos sobre beats, eventos y conexiones. La rama muestra siempre dónde se separa del canon y puede archivarse o promoverse mediante preview reversible.

**Evolución avanzada:** una línea alternativa puede integrar Real Atlas y Worldgen. Empieza únicamente con eventos/conexiones; recalcular edades exige B1, conocimiento exige A6, alianzas exigen relaciones temporalizadas y viajes exigen sistemas espaciales compatibles. Esa simulación completa es XL y no debe prometerse en el MVP.

**Límites:** empieza con una rama activa y estructura, no con copias completas de la prosa. Usa lenguaje narrativo, no conceptos de Git.

**Éxito:** explorar y descartar una alternativa no modifica ninguna entidad canónica; promoverla enumera exactamente qué cambiará.

### A3 — Mapa causal y de consecuencias

**Problema:** una idea parece buena de forma aislada, pero sus repercusiones sobre personajes, mundo, causalidad y escenas quedan escondidas.

**MVP:** desde cualquier entidad o decisión, construye una vista derivada con consecuencias directas, indirectas, costes, oportunidades, contradicciones y elementos sin resolver. Sobre el mismo grafo, representa cadenas `porque → por tanto → pero` y señala saltos sin causa, consecuencias que no llegan, coincidencias acumuladas y costes que desaparecen. Reutiliza backlinks, relaciones, Seeds, Timeline, Narrative Spine y Board; cada nodo abre la fuente real.

**Interacción clave:** el usuario puede formular hipótesis, marcar una consecuencia como necesaria/posible/descartada, añadir una causa posible, declarar una coincidencia deliberada y convertir un hueco en beat, evento, regla, seed o pregunta abierta.

**Éxito:** no duplica contenido, diferencia hechos de hipótesis y permite volver desde cada consecuencia a la decisión que la originó.

### A4 — Cámara de presión de personajes

**Problema:** las fichas describen personajes, pero cuesta descubrir qué decisiones tomarían al chocar sus deseos, miedos, límites y relaciones.

**MVP:** una plantilla de exploración lanzada desde Codex, Relationships o Character Arc combina 2–4 personajes con una situación, recurso escaso, límite temporal, secreto o coste. Cruza objetivo, necesidad, miedo, poder, deuda y relación para plantear puntos de fricción, alianzas probables y decisiones difíciles. No crea otro modelo de personajes, relaciones o arcos. Los resultados son preguntas y posibilidades, no “la respuesta correcta”.

**Éxito:** cualquier posibilidad puede convertirse en beat, escena, cambio de relación o nota conservando su procedencia; cerrar la sesión no altera perfiles ni canon.

### A5 — Laboratorio de reglas del mundo

**Problema:** magia, tecnología, política, geografía o instituciones se describen, pero sus límites y efectos secundarios no se exploran sistemáticamente.

**MVP M:** una plantilla tipada de entradas Codex —no un repositorio paralelo— con condición, efecto, coste, límite, excepción conocida y evidencia en la historia. Permite someter una regla a escenarios: uso extremo, abuso, fallo, interacción con otra regla y consecuencias sociales/económicas/geográficas. Vincula resultados a Worldgen, Timeline y Board.

**Evolución L:** solo si se necesita consultar reglas automáticamente, crea un modelo real de condiciones y excepciones. No presentes esa versión como vista derivada de Worldgen: sería una nueva fuente de verdad y requiere migración, backup y editor propios.

**Éxito:** distingue regla canónica, hipótesis y excepción; detecta contradicciones sin impedir que el autor las marque como deliberadas.

### A6 — Mapa de conocimiento, secretos y revelaciones

**Problema:** Timeline sabe cuándo ocurre algo, pero no quién conoce cada dato ni cómo una revelación cambia las decisiones disponibles.

**MVP:** sobre el eje narrativo común, declara información/secreto, personajes que la conocen, origen, confianza, momento de adquisición y momento de revelación. Ofrece vista por escena y personaje, y señala usos prematuros o conocimiento imposible. Diseña A6 y B1 sobre tipos compatibles de afirmación, pero mantén separados el hecho del mundo y la creencia de cada actor.

**Éxito:** la entrada es rápida desde Scene/Codex, admite mentira, sospecha, conocimiento parcial y narrador no fiable, y cada alerta puede marcarse como intencional.

### B1 — Libro mayor de continuidad factual

Registra hechos físicos, biográficos o relacionales con sujeto, tipo, valor validado, vigencia sobre el eje narrativo y fuente enlazada: edad, lesión, posesión, relación o ubicación. No conviertas todo en un EAV sin tipos. Los secretos, sospechas, mentiras y conocimiento parcial pertenecen exclusivamente a A6; B1 puede consultarlos, no duplicarlos. Comprueba contradicciones bajo demanda y permite marcar narrador no fiable, POV o excepción intencional. El MVP empieza con hechos manuales; la extracción por IA llega después y siempre exige aprobación.

### B2 — Constelación de motivos y temas

Vista derivada —o preset guardado de Board— que agrupa imágenes, frases, objetos, lugares, colores, símbolos y situaciones mediante tags, anotaciones y vínculos existentes. Solo añade un tipo de vínculo si falta una relación semántica real. Muestra apariciones, transformaciones, ecos y zonas donde un motivo desaparece. El autor decide qué conexión tiene sentido: las coincidencias automáticas son sugerencias con evidencia, nunca una interpretación definitiva.

### B3 — Radiografía narrativa

Une tres lentes sin duplicar datos:

- **Laboratorio de voces:** compara personajes por longitud de frase, preguntas, vocabulario distintivo y muletillas, siempre con ejemplos y aviso de muestra insuficiente.
- **Ritmo y energía:** objetivo, conflicto, giro, resultado y energía opcional por escena, ponderados por palabras; no existe una “curva correcta”.
- **Story Map:** preset generado de Board —no otro contenedor— con capítulos, beats, escenas, arcos, semillas y payoffs; cada tarjeta abre la fuente canónica.

El usuario activa solo las lentes que le interesan y puede editar etiquetas/escalas.

### B4 — Laboratorio de escenas

Crea ejecuciones locales ligeras de una misma escena dentro de la rama activa, cambiando una variable declarada: POV, objetivo, lugar, orden de entrada, información disponible, coste, resultado o tono. Compara texto, intención, tensión y voz. Si una variante cambia consecuencias estructurales, se eleva al flujo A2 en vez de mantener una segunda implementación de ramas. Vive fuera del canon hasta que se promueve con preview.

### B5 — Arqueología de ideas

El MVP es una vista derivada del rastro disponible —receipts, enlaces, fuentes de Mesa de ideas y snapshots— desde captura hasta canon: Note/Scrapper/Gallery → Mesa de ideas → Board/Seed/Codex → Outline/Timeline → Scene/Writing. No crea otro log de eventos ni promete recuperar algo cuyo contenido ya no existe. Para recuperar bifurcaciones borradas, añade después el ledger de procedencia con tombstones/payload mínimo; no simules recuperación desde enlaces rotos.

### B6 — Lectura crítica en voz alta

TTS del sistema segmentado por oración, con resaltado, velocidad, pausa, salto, reanudación y “crear nota aquí”. No dependas de que los eventos `boundary` sean uniformes entre sistemas. Permite escuchar capítulo, selección, escena o cola. Indica qué voz/proveedor se usa; si no puede verificarse como local, solicita consentimiento. La posición y las notas se anclan con precisión y el flujo funciona con teclado.

Incluye un modo **Table Read** para Dialog Scene y guiones: asignación persistente de voz por personaje, tratamiento diferenciado de acotaciones, pausa entre parlamentos y salto directo al bloque que está sonando. Las voces son una preferencia de interpretación, no parte del canon del personaje. Durante la reproducción se puede crear una anotación o pregunta en el instante exacto sin detener y perder la posición.

### C1 — Universo compartido y canon entre proyectos

Agrupa proyectos en una serie y comparte de forma explícita personajes, lugares, reglas y eventos. Cada libro puede añadir estado local sin copiar la identidad base. Debe mostrar siempre origen, override y alcance.

Antes de implementar, resuelve mediante ADR: propiedad, IDs cross-project, borrado, backup/restauración del conjunto y promoción de un dato local al canon. Nunca fusiones entidades por nombre ni borres en cascada de forma implícita.

### Infraestructura habilitadora, no features separadas

- **Descubrimiento semántico local:** permite encontrar “la escena donde duda de su mentor” aunque no coincidan palabras literales. Desde cada resultado se puede abrir Mesa de ideas, crear una hipótesis/vínculo y conservar procedencia. Usa embeddings locales, índice regenerable y límites de CPU/disco; la búsqueda léxica sigue funcionando sin modelo.
- **Checkpoints selectivos:** proporcionan la seguridad para experimentar y promover ramas. Pertenecen a versionado/recuperación, no al modelo creativo: calculan el cierre de dependencias necesario, comparan y restauran selecciones coherentes después de un preview y un checkpoint de seguridad. No permiten restaurar una tabla aislada si deja referencias rotas.

### Gate de producto para cada feature

Antes de construir una feature A/B/C:

1. Escribe el trabajo del usuario, el flujo principal y el antiobjetivo.
2. Confirma qué datos son canónicos y cuáles derivados.
3. Prototipa los estados vacío, normal, grande, error, offline y recuperación.
4. Define una medida de éxito observable sin telemetría obligatoria.
5. Verifica teclado, español/inglés, backup, borrado de proyecto y cierre con escrituras pendientes.
6. Prueba que desactivar IA no inutiliza el flujo base.
7. Lanza primero con complejidad progresiva y una ruta de retirada segura.

---

## Matriz completa de defectos que no deben quedar fuera

Esta lista sirve como control de cobertura. Algunos puntos ya se integran en las fases anteriores.

### P0

- Migración v24 destructiva de Yarn Board/Brainstorm.

### P1

- Recetas de imagen no persistidas ni respaldadas.
- Hash de receta ignora IDs semánticos anidados y puede incluir metadatos de fila.
- Importación capaz de cruzar `projectId`.
- Undo de conversión destructivo.
- Google Docs con overwrite concurrente.
- Vulnerabilidades de Tiptap y `@humanfs/node`.
- Modal base sin contrato accesible.
- Contraste insuficiente del token `text-dim`.
- Servidor local de medios sin autenticación por sesión.
- Ruta HTTP de descargas fuera de la cola única.
- Autosave asíncrono sin espera ni propagación de error.
- Sidebar sin enlaces, `aria-current` o nombres accesibles persistentes.
- Color picker no utilizable con teclado.
- Controles principales no semánticos o sin etiqueta.

### P2

- Resultados stale al vaciar/cambiar scope.
- Cachés Worldgen huérfanas.
- Flush de Board no esperado al cerrar.
- Backup no consistente en el tiempo.
- Settings de proyecto omitidos del ZIP completo.
- Pérdida silenciosa de borradores al cerrar modales.
- Acciones solo visibles con hover.
- Ausencia de reduced motion.
- Locale inicial y `<html lang>` incorrectos.
- Formato regional fijado a español.
- Literales UI fuera de i18n.
- Stores de IA e Image Runtime publican cargas/configuración fuera de orden.
- Google Docs convierte errores de comprobación en “sin cambios”.
- Codex sin virtualización.
- Importación de imágenes sin límites de memoria/concurrencia.

### P3

- Gallery/lightbox sin semántica y teclado completos.
- Imágenes sin dimensiones, lazy loading o alt adecuado.
- Falta skip link.
- Uso de `transition-all`.
- Copy con tres puntos ASCII.
- Título y favicon provisionales.
- Migración v21 activa Scrapper globalmente en vez de por proyecto.

---

## Estrategia de pruebas mínima

### Datos y migraciones

- Abrir fixtures reales desde cada versión relevante, no solo construir una base nueva.
- Comparar conteos y contenido antes/después.
- Inyectar fallo dentro de la migración y comprobar atomicidad.
- Probar IDs colisionados, filas huérfanas y proyecto cruzado.
- Verificar v21 con proyectos con/sin enlaces y v23 con ambos motores legacy.

### Backup

- Round-trip completo con todas las tablas de usuario.
- Checksum alterado y manifest incompleto deben fallar antes de escribir.
- Edición concurrente durante captura no puede producir mezcla de revisiones.
- Restauración fallida deja el estado anterior intacto.

### Persistencia

- Cuota agotada, rechazo de IndexedDB, cierre durante debounce y commits fuera de orden.
- Google Docs con red lenta y edición local concurrente.
- Google Docs con error de autenticación/red al comprobar cambios.
- Undo con destino intacto, editado y ya ausente.
- Promesas diferidas en hooks y stores, resueltas en orden inverso.
- Hash de receta sensible a IDs de modelo/LoRA/input e insensible a metadatos de fila.

### Electron y medios

- Token válido, inválido, ausente y token de un arranque anterior.
- Origin válido, inválido, ausente y `null`.
- Dos trabajos simultáneos, cancelación, error y cierre de app.
- Verificar que no quedan procesos descendientes.

### UI

- Pruebas de foco: entrada, trap, Escape, backdrop, restauración y dirty guard.
- Axe en rutas principales.
- Prueba solo teclado con Sidebar colapsada.
- Contraste automático de tokens críticos.
- Español/inglés y cambio en caliente.
- Reduced motion cambiado en caliente.

### Rendimiento

- 5.000 entidades, 1.000 miniaturas y lote de 100 imágenes.
- Registrar duración de tareas largas, número de nodos DOM y pico de memoria.
- Evitar snapshots subjetivos sin números.

## Gates por fase

Después de cada fase:

```text
npm run verify:quick
npm run test:critical
```

Cuando se modifiquen dependencias o seguridad:

```text
npm run audit:security
```

Antes de cerrar el trabajo completo:

```text
npm run verify:release
```

Además, abre la aplicación de escritorio real cuando cambien preload, IPC, proceso principal, arranque, registro de motores o navegación. Vite solo recarga el renderer; los cambios de preload requieren reiniciar Electron.

## Restricciones de implementación

- No uses `window.confirm`, `window.alert` ni `window.prompt`; usa el diálogo React común.
- No abras permisos IPC amplios ni expongas Node al renderer.
- No guardes secretos o tokens de sesión en Dexie, archivos, URLs o logs.
- No exportes credenciales en backups.
- No confíes solo en `Origin` para proteger un servidor local.
- No mantengas red o compresión dentro de transacciones IndexedDB largas.
- No borres tablas legacy antes de leerlas y migrarlas.
- No reescribas silenciosamente filas cross-project durante importación.
- No marques un campo como guardado antes de resolver su promesa.
- No uses un evento `beforeunload` como garantía de persistencia asíncrona.
- No inventes recuperación para datos que una versión ya eliminó.
- No sustituyas la identidad visual del producto por un rediseño genérico.

## Entregables esperados de Claude

Por cada fase entrega:

1. Causa raíz y decisión técnica.
2. Archivos modificados.
3. Pruebas añadidas y escenario que cubren.
4. Resultado de los gates.
5. Riesgos residuales y compatibilidad.
6. Capturas o evidencia de la aplicación real cuando corresponda.
7. Actualización de `tasks/todo.md` con revisión final.

Si una fase descubre que el diseño propuesto no encaja con el código actual, detente, documenta la evidencia y replantea esa fase. No continúes acumulando cambios sobre una premisa falsa.
