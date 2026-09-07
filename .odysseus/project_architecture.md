# Arquitectura del flujo creativo

## Entrada y navegación

`MainLayout` monta `QuickNoteHost` y `PendingWritesHost`. `TopBar` abre captura mediante `engines/notes/quickCapture.ts`. `CreativeLaunchpad` ofrece captura, laboratorio, organización, Tablero y Worldgen desde `ProjectCockpit`.

`Dashboard` filtra proyectos por título/descripción y reanuda el último motor habilitado. `projectIntelligence` recuerda rutas e incluye tableros, nodos, arcos, relaciones, esquemas y semillas en trabajo reciente. `ProjectDetail` aísla la instancia de motor por proyecto y motor.

## Persistencia creativa

`Project.creativePossibilities` contiene las posibilidades del laboratorio. `services/creativePossibilities.ts` mezcla elementos por identificador y fecha en una transacción del proyecto. `PersistentCreativeLab` integra campos diferidos y el registro de escrituras pendientes. La exportación ZIP conserva estas posibilidades como parte del proyecto.

Los editores de biografía, arco, semilla, relación, escena y storyboard se identifican por entidad para separar borradores.

`hooks/localDraftStore.ts` mantiene diarios locales de borradores de Mapas y Atlas por proyecto, compartidos entre instancias y con reintentos de almacenamiento registrados. Las eliminaciones limpian únicamente borradores afectados tras confirmar persistencia. `deleteProject` limpia los diarios del proyecto eliminado.

`makeEntityHook` y `makeReadOnlyHook` distinguen carga inicial, error y último contenido válido. Las respuestas y refrescos se acotan al propietario vigente. `ReadErrorNotice` ofrece reintento sin desmontar editores ya cargados. `useProjects` expone fallos de biblioteca/proyecto y evita respuestas obsoletas.

`pendingWrites.discardPendingOwner` descarta el estado de guardado de un propietario tras una eliminación o descarte explícito. El Diario mantiene el editor montado durante el autoguardado y drena las ediciones que llegan mientras escribe.

## Sistema visual

Tokens de `src/index.css`: fondo `#17191a`, superficie `#202223`, elevada `#2a2d2e`, texto principal `#eeeae2`, acento `#d5b575`. Foco visible común; navegación lateral compacta por debajo de 800 px. Los alias de variables heredadas resuelven a los tokens actuales.

## Verificación

`npm run verify:quick`: tipos renderer/Electron, lint y conformidad de motores/locales.
`npm run test:critical`: regresiones integradas en Electron y arranque real.
`npm run test:engines`: monta los motores registrados en un perfil temporal; workers dormidos para validar render y ciclo de vida.
`npm run build:desktop`: renderer y bundles Electron.
`scripts/run-focused-browser-tests.cjs`: ejecuta una función exportada desde tests en un perfil temporal, con UTF-8 y temporizadores sin ralentización de ventanas ocultas.

## Persistencia y cálculo de mundos

`GeneratedWorld` añade campos opcionales `originWorldId` y `journeys`, sin tabla nueva. `recipe.ts` prepara y confirma regeneraciones en transacciones de mundos y waypoints; preserva el terreno anterior hasta guardar y rechaza cambios concurrentes. Las regiones se reescalan al conservar coordenadas y las alternativas mantienen su procedencia.

`WorldParams.drainageVersion` y `hydrologyVersion` reproducen versiones antiguas como 1; nuevas recetas y regeneraciones explícitas usan 2. `useWorldGeneration` espera la adopción asíncrona del resultado antes de publicarlo y aplica caché LRU de 256 MiB/máximo tres mundos, conservando siempre un mundo actual. `core/worldStore.ts` valida tamaño y estructura antes de reservar datos; su formato 3 conserva cotas de lagos y admite lectura del formato 2.

`useWorldEnvironment` confirma el recálculo ambiental mediante comparación de receta e historial antes de adoptar su resultado. Los marcadores `recalculate` se preparan en worker al reabrir. La caché de derivaciones conserva dos estados por mundo con presupuesto global de 192 MiB y excepción para un estado grande. La restauración reutiliza matrices; no modifica las del punto de historial. `geographyClient` comparte el trabajo entre consumidores y termina el worker cuando el último cancela.

`journeyCreative.ts` usa las tablas existentes `projects`, `generatedWorlds`, `notes`, `scenes` y `entityLinks`: crea idea/escena y procedencia en una transacción. La procedencia registra mundo, receta, paradas y condiciones de la etapa; los reintentos reconocen el vínculo para no duplicar contenido. `journey.worker.ts` publica la ruta principal antes de sus comparaciones.

`journeyWorkerPayload` proyecta la geografía a `TravelGeography` serializable: caminos, posiciones, refugios y reinos. Las funciones lingüísticas permanecen en el hilo principal. La suite crítica ejecuta los workers de viajes y paleogeografía reales mediante Vite sobre un mundo generado.

`npm run test:worldgen` ejecuta el estudio en Electron; `test:critical` lo incorpora como fase separada. `scripts/benchmark-worldgen.mjs` compara el núcleo con un commit base, verifica hashes de compatibilidad y exporta mediciones JSON. Evidencia y límites físicos: `tasks/estudio-worldgen-2026-09-07.md`.

`npm run test:worldgen:large` genera un mundo de 2048 y su geografía completa, comprueba igualdad de campos tras deshacer/rehacer/reabrir y contabiliza matrices retenidas. El ejecutor focal admite un tercer argumento de tiempo máximo; conserva 60 segundos por defecto.
