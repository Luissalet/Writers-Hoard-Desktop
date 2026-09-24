# Contract W-A — expose the image runtime we already ship

Pinned runtime: stable-diffusion.cpp `master-709-92a3b73`
= commit `92a3b73cdba6d17efa30689e43857a30582c8b33`.

## Step 0 — establish the real server field names (done)

Source of truth, read at that exact commit:

- `examples/server/api.md` — the native `sdcpp` request schema.
- `examples/common/common.cpp` `SDGenerationParams::from_json_str` — the
  parser that actually decides which keys have an effect.
- `examples/server/routes_sdcpp.cpp` — how img_gen requests are parsed.
- `examples/server/async_jobs.cpp` — what `embed_image_metadata` does.
- `src/stable-diffusion.cpp` — the sampler / scheduler / hires-upscaler name
  tables the server validates against.

## Plan

- [x] W-A1 Confirm every server field name against the parser, not the CLI.
- [x] W-A2 Widen `AiImageRequest` + `buildSdJobPayload` (additive).
- [x] W-A2b Fix the LoRA path: this build does NOT parse `<lora:…>` from a
      server request. Move to the structured `lora[]` field.
- [x] W-A3 `embed_image_metadata: true` + `src/services/imageMetadata.ts`.
- [x] W-A4 Widen `ImageGenerationInfo` so a row can reproduce its image.
- [x] W-A5 Catalogue: FLUX.1-Kontext-dev Q4 + ControlNet / ESRGAN companions,
      each pinned by size and SHA-256.
- [x] Launch side: `--control-net`, `--hires-upscalers-dir`.
- [x] Tests in `tests/ai-runtime.ts` (the harness this repo actually runs).
- [x] `npx tsc --noEmit` (renderer + electron) and the linter.

## Review

See the closing report. Shipped only fields confirmed in the parser;
PhotoMaker and `upscale_repeats` were confirmed inert on the server and were
deliberately left out.

## What shipped, and what did not

Confirmed in `SDGenerationParams::from_json_str` and shipped:
`ref_images`, `increase_ref_index`, `auto_resize_ref_image`, `control_image`,
`control_strength`, `mask_image`, `hires.*`, `lora[].path` / `[].multiplier`,
`embed_image_metadata`, `sample_params.sample_method` / `.scheduler`.

Confirmed inert on the server and therefore NOT shipped:
- PhotoMaker identity images — no request field exists; `pm_id_images` is
  filled only by `examples/cli/main.cpp`.
- `upscale_repeats` — parsed into the struct, then read only by the CLI.
  ESRGAN is reachable through `hires.upscaler` instead.
- A per-request ControlNet model — `--control-net` is a context option, so it
  is a launch argument and a change restarts the server.

The renderer-facing IPC for installing companions is deliberately not wired:
`electron/ai/ipc.ts` belongs to the studio work, not to this contract. The
main-process entry points are `downloadSdCompanion`, `cancelSdCompanionDownload`,
`deleteSdCompanion` and `installedSdCompanions`.

---

# Contract S1 — the studio foundations (branch `st-foundations`)

Same pinned runtime: stable-diffusion.cpp `master-709-92a3b73`
= commit `92a3b73cdba6d17efa30689e43857a30582c8b33`.

## Step 0 — re-establish the field names from the parser, not the docs

Everything below was taken from source fetched at the pinned SHA:

- `examples/common/common.cpp` — `SDGenerationParams::from_json_str`, the
  parser that decides which keys have an effect. THE authority.
- `examples/server/routes_sdcpp.cpp` — `make_img_gen_defaults_json`, the
  server's own statement of the same schema. Independent cross-check.
- `examples/common/common.h` — the `SDGenerationParams` struct.
- `include/stable-diffusion.h` — the enums.
- `src/stable-diffusion.cpp` — `sample_method_to_str`, `scheduler_to_str`,
  `hires_upscaler_to_str`.
- `src/core/util.cpp`, `src/runtime/guidance.cpp` — the `extra_sample_args`
  key=value grammar and the APG keys.
- `thirdparty/stb_image_write.h` — the PNG `tEXt` keyword.

`examples/server/api.md` exists at this commit and agrees with the parser on
every field this contract touches. It is still not the authority, and the
reason is visible in it: `sample_params.extra_sample_args` is read by
`from_json_str` and documented nowhere in `api.md`. The docs are incomplete
rather than wrong, which is exactly the failure mode that costs a feature
rather than causing a bug — so the parser stays the source of truth.

## Plan

- [x] S1-1 Widen the payload to everything `from_json_str` reads.
- [x] S1-2 The Recipe: versioned, hashable, replayable, stored at Dexie v30.
- [x] S1-3 PNG round trip, ours beside A1111's, plus recovery from a foreign file.
- [x] S1-4 Verify multi-LoRA (already correct) and kill the stale comments.
- [x] S1-5 Runtime profiles: one launch identity, one hash, a visible cost.
- [x] S1-6 Companion IPC across handler, allowlist, preload and renderer types.
- [x] Tests in `tests/ai-runtime.ts`, `tests/critical.browser.ts`.
- [x] `tsc` (electron + renderer) and eslint clean on every touched file.

## Review

Shipped, each verified against the source above:
`clip_skip`, `sample_params.{eta, flow_shift, shifted_timestep, custom_sigmas,
extra_sample_args}`, `guidance.{img_cfg, slg{...}}`,
`hires.{target_width, target_height, custom_sigmas}`, `vae_tiling_params`,
`cache_mode`, `cache_option`.

Deliberately NOT shipped, because the strings do not occur anywhere in the
runtime's source at this commit and the server would have accepted them and
done nothing: `ad_model` / `ad_prompt` / `ad_negative_prompt` / `extra_ad_args`
(there is no ADetailer pass), `ip_adapter_image` / `ip_adapter_strength` (no
IP-Adapter), `guidance_schedule`. PhotoMaker and PuLID have struct fields but
`from_json_str` never reads them — they are launch-time only.

Corrections to the capability matrix this contract was written from:
18 samplers, not 21. 12 schedulers, not 16. `hires` takes `target_width` /
`target_height`, not `target_w` / `target_h`. `eta` and `flow_shift` live
inside `sample_params`, not at the top level. `extra_sample_args` is a
key=value STRING, not an object.

Latent bug found and fixed on the way: the upscalers folder was not part of the
server's launch identity, so an ESRGAN installed while the server was running
never got `--hires-upscalers-dir` until an unrelated change restarted it — and
every hires pass naming that model was refused in the meantime.

Not done, and why: `sd-cli -M metadata`. `electron/ai/sdRuntimeManifest.ts`
declares only `serverBinary`; no CLI binary name is pinned for any platform and
guessing one would be inventing a file name. It is also unnecessary — 
`readPngMetadata` + `readSdcppRecord` + `recoverRecipe` read a foreign PNG in
pure TypeScript, with no process to spawn and no runtime install required.

---

# Auditoría integral — 2026-09-06

## Plan

- [x] A1 Mapear arquitectura, superficies críticas y estado de verificaciones.
- [x] A2 Auditar lógica, persistencia, IPC, seguridad y manejo de errores.
- [x] A3 Auditar interfaz, accesibilidad, rendimiento percibido e i18n.
- [x] A4 Reproducir y validar los defectos de mayor impacto.
- [x] A5 Priorizar bugs y proponer features con coste/beneficio.

## Review

Auditoría de solo lectura completada. No se modificó código funcional.

Puertas ejecutadas:

- `npm run verify:quick`: OK (renderer, Electron, lint y conformidad).
- `npm run test:critical`: OK (146 pruebas).
- `npm run audit:security`: FALLA por dos vulnerabilidades moderadas
  (`@tiptap/core` y `@humanfs/node`).
- Arranque y recorrido visual en navegador: OK, con warning reproducido de
  cobertura de backup para `imageRecipes`.

Hallazgos principales:

- P0: la migración v24 elimina las tablas Yarn/Brainstorm sin migrar sus filas
  a Board.
- P1: `saveGenerated` descarta la receta exacta devuelta por el runtime y nunca
  escribe `imageRecipes`; además esa tabla no entra en los backups.
- P1: la importación genérica acepta filas de otro `projectId` y puede pisar
  datos de un proyecto ajeno al ZIP.
- P1: deshacer una conversión borra también todo el trabajo posterior.
- P1: Google Docs puede sobrescribir una edición concurrente sin conservarla.
- P1: el modal común no implementa el contrato accesible de un diálogo y el
  token `text-dim` no cumple contraste AA.
- P2: autosaves asíncronos no observados, cachés Worldgen huérfanas, backups no
  transaccionales, movimiento no reducible y listas/medios sin límites.

Prioridad sugerida: migración y backups → escrituras con conflicto/undo →
dependencias de seguridad → diálogo/accesibilidad → escalabilidad de medios.

---

# Informe de remediación integral para Claude — 2026-09-06

## Plan

- [x] C1 Consolidar todos los hallazgos verificados en un único briefing ejecutable.
- [x] C2 Definir fases, dependencias, alcance y criterios de aceptación por problema.
- [x] C3 Incluir estrategia de pruebas, migración segura, rollback y límites de implementación.
- [x] C4 Revisar referencias de código y evitar instrucciones ambiguas o destructivas.
- [x] C5 Entregar el informe Markdown y registrar su revisión final.

## Review

Creado `docs/INFORME_REMEDIACION_INTEGRAL_CLAUDE.md`: briefing autónomo en
español con estado inicial, definición global de terminado, siete fases
ordenadas por riesgo, criterios de aceptación, matriz completa de defectos,
features derivadas, estrategia de pruebas, gates y restricciones de seguridad.

Revisión cruzada completada para datos/lógica, Electron/seguridad y UI/UX. Se
añadieron las precisiones detectadas: hash semántico de recetas, estados
discriminados de snapshots y Google Docs, recibos legacy conservadores,
carreras de stores, migración v21 por proyecto, política de `Origin: null`,
preflight CORS, clasificación de overlays, contraste computado y protocolo
reproducible de rendimiento. No se modificó código funcional.

Añadido también el baseline ejecutivo de salud de interfaz (10/20), su desglose
por áreas y el objetivo verificable de repetir la misma rúbrica tras las fases
de accesibilidad y rendimiento.

Validación documental:

- Todas las rutas de código primarias citadas existen.
- `git diff --check`: sin errores.
- Los archivos ajenos en `_stage/` se conservaron intactos.

---

# Ampliación del informe — features de usuario — 2026-09-06

## Plan

- [x] F1 Inventariar las capacidades actuales para evitar propuestas duplicadas.
- [x] F2 Mantener protocolo de entrega, compatibilidad, recuperación y release.
- [x] F3 Sustituir la dirección comercial por exploración y desarrollo creativo.
- [x] F4 Definir MVP, valor, dependencias y criterios de éxito por feature creativa.
- [x] F5 Revisar la ampliación y registrar el resultado.
- [x] F6 Incorporar Judge y la biblioteca de referencias propuesta por el usuario.
- [x] F7 Añadir modos creativos derivados de Judge y Table Read sin crear módulos redundantes.

## Review

La primera ampliación se descartó tras la corrección del usuario: orientaba el
producto hacia publicación, pitches, envíos y feedback comercial. Esos bloques
se retiraron, junto con el contexto competitivo que los motivaba.

La Fase 8 ahora define Writers Hoard como laboratorio para capturar, expandir,
conectar, tensionar, ramificar y desarrollar ideas antes de promoverlas a canon.
Incluye Mesa de ideas, ramas «qué pasaría si», mapa causal, cámara de presión de
personajes, reglas del mundo, conocimiento/secretos, continuidad, motivos,
lentes narrativas, variantes de escena, arqueología de ideas y universo
compartido. Se documentaron primitivas comunes para evitar nuevos silos:
kernel de ramas, relaciones causales, eje narrativo, procedencia e identidad de
serie. El Centro de salud y el protocolo de entrega/recuperación permanecen.

La corrección de dirección quedó registrada en `tasks/lessons.md` como regla
#66. No se modificó código funcional ni archivos bajo `src/`.

Añadida como prioridad A0 la feature **Judge**: botón en el sidepanel de
Writings, biblioteca personal de documentos/lentes, crítica grounded contra
referencias y otros capítulos, citas dobles, detección de resultados obsoletos,
privacidad local/remote opt-in, resultados navegables y aplicación mediante
diff + snapshot. El mismo núcleo queda previsto para el copiloto interno y los
agentes externos, sin exponerles acceso general a archivos privados.

Judge se amplió como una única superficie con los modos `Judge`, `Questions`,
`Reader` y `Story State`, más Lens Duel y Devil's Advocate. Question Garden se
plantea como vista derivada sobre Board/Notes y Table Read como extensión de la
lectura crítica para Dialog Scene, evitando siete módulos o almacenes nuevos.

---

# Implementación integral de remediación y laboratorio creativo — 2026-09-07

## Plan maestro

- [x] I0 Congelar el baseline: estado del repositorio, `verify:quick`, pruebas
  críticas, auditoría de dependencias y reproducciones deterministas de cada P0/P1.
- [x] I1 Blindar migraciones e importación: rescatar Yarn/Brainstorm en v24,
  corregir v21 por proyecto y rechazar cualquier fila ZIP fuera de alcance.
- [x] I2 Hacer reversibles las mutaciones destructivas: recibos versionados para
  conversiones, protección del trabajo posterior y rollback atómico/idempotente.
- [x] I3 Unificar escritura segura: versión esperada, snapshots obligatorios,
  conflictos de Google Docs, autosave observable, flush/cierre y anti-race en hooks/stores.
- [x] I4 Completar recuperación: recetas de imagen persistentes y con hash
  semántico, backups coherentes y completos, settings permitidos y limpieza Worldgen.
- [x] I5 Cerrar seguridad de escritorio: dependencias, autenticación del servidor
  local de medios y una única cola cancelable para HTTP/IPC y procesos hijos.
- [x] I6 Sanear la interfaz: diálogo accesible común, contraste AA, foco,
  semántica, teclado, movimiento reducido, idioma/formato y estados de error.
- [x] I7 Acotar rendimiento: importación multimedia con cola/cancelación,
  colecciones grandes, imágenes y limpieza visual verificadas con fixtures.
- [x] I8 Entregar salud y recuperación visibles: papelera/historial, conflictos,
  procedencia, backups, migraciones y Centro de salud accionable.
- [x] I9 Construir Judge como primer corte vertical: biblioteca local de
  referencias, lentes, contexto entre capítulos, cuatro modos, citas, vigencia,
  diff + snapshot y núcleo compartido con herramientas externas.
- [x] I10 Construir las primitivas y experiencias creativas restantes por cortes
  verticales: Mesa de ideas, ramas, causalidad, presión, reglas, secretos,
  continuidad, motivos, radiografía, escenas, arqueología y universo compartido.
- [x] I11 Ejecutar gates finales: typechecks, lint, conformance, seguridad,
  pruebas críticas/regresión, build desktop, presupuesto, arranque real y QA visual.
- [x] I12 Actualizar grafo del proyecto y documentar cambios, riesgos residuales,
  migración/rollback y evidencia en esta sección.

## Reglas de ejecución

- Ninguna migración destructiva avanza sin fixture desde la versión anterior y
  comprobación de conteos, relaciones, ids y repetición segura.
- Ninguna escritura remota o restauración puede pisar datos si el estado leído
  ya no coincide; conflicto y recuperación son resultados normales, no errores ocultos.
- Cada fase se integra sólo cuando pasa sus pruebas enfocadas y el gate rápido.
- La UI conserva el estudio creativo actual y evita lenguaje o flujos comerciales.
- Los archivos ajenos del usuario y los artefactos de `_stage/` quedan fuera de alcance.

## Review

Implementación integral completada sobre el producto real, no como prototipo
aislado. Se conservaron y probaron explícitamente los enlaces de Recortes; el
fixture crítico mantiene intacta la URL con query, caracteres escapados y hash.

Entregado:

- Migraciones v21/v24 seguras, importación ZIP limitada por proyecto, restores
  transaccionales y comprobación común de propiedad, claves y referencias.
- Mutaciones protegidas por recibos, versión esperada, snapshots, conflictos
  recuperables, autosaves observables y drenaje al cerrar.
- Recetas de imagen reproducibles, procedencia, backup completo, servidor local
  autenticado, CORS exacto y cola única cancelable para descargas HTTP/IPC.
- Modal accesible, contraste y foco corregidos, movimiento reducido, navegación
  por teclado, estados vacíos/error y Centro de salud y recuperación accionable.
- Judge integrado en el lateral de Writings con biblioteca privada PDF/MD/TXT,
  lentes reutilizables, citas, vigencia, historial y los modos Judge, Questions,
  Reader sin capítulos futuros y Story State; Lens Duel comparte el mismo núcleo.
- Laboratorio creativo integrado en Cockpit: Mesa de ideas, consecuencias,
  presión de personajes, ramas, estado narrativo, motivos y arqueología, variantes
  de escena, Narrative X-ray y universo compartido con canon de saga y overrides.
- Lectura crítica en voz alta para capítulos y lectura de mesa para Dialog Scene,
  con segmentación, velocidad, voces por personaje, navegación y notas ancladas.

QA final:

- `npm run test:critical`: 191 PASS, incluido canon compartido en backup.
- Runners focales: Read Aloud 3 PASS, Scene Lab 5 PASS, Narrative X-ray 4 PASS,
  Character Pressure 1 PASS y Creative Lab 5 PASS.
- `npm run verify:quick`: renderer, Electron, lint y conformidad OK; 23 motores,
  51 tablas de motor y 4637 claves de idioma.
- `npm run audit:security`: 0 vulnerabilidades.
- `npm run build:desktop`: OK; recursos tipográficos ausentes ya no se declaran
  ni producen errores en Chromium o avisos de Vite.
- QA real en Chromium a 1440×1000 y 1024×768: los nueve apartados creativos,
  Judge, biblioteca, los cuatro modos y Read Aloud sin errores de consola ni
  overflow de documento. Se corrigieron durante esta pasada claves React
  duplicadas, el acceso a lectura en capítulos locales y el indicador `1.0×`.
- `git diff --check`: OK.
- Grafo canónico del repositorio actualizado a 23 motores, esquema v34 y 71
  tablas tipadas, con Judge, laboratorio creativo, universo compartido,
  lectura/mesa y recuperación reflejados en `docs/PROJECT_KNOWLEDGE.md`.

Riesgo residual no bloqueante: el presupuesto informa de un chunk 3D de 710,2
kB frente a la nota de 700 kB y 7,4 MB de JavaScript total frente a 4,1 MB. El
gate es informativo y pasa; reducir ese coste exige un corte específico de
rendimiento, no compromete la corrección ni la entrega actual.

---

# A4 — Cámara de presión de personajes — 2026-09-07

## Plan

- [x] Definir un contrato puro sobre filas existentes de Codex, Relationships y Character Arc.
- [x] Generar preguntas, fricciones, alianzas y decisiones de forma determinista y no prescriptiva.
- [x] Construir una UI autocontenida y accesible para 2–4 personajes y los cinco vectores de presión.
- [x] Exponer promociones únicamente como borradores con procedencia mediante callbacks del host.
- [x] Verificar no-mutación, determinismo, validación, callbacks, typecheck, lint y detector visual.

## Review

Integrada en Creative Development Lab. Lee únicamente personajes, relaciones y
arcos existentes; formula fricciones y preguntas deterministas sin dictar una
solución ni mutar canon. Las salidas solo pueden pasar al host como borradores
con fuentes y procedencia. Runner Electron focal: 1 PASS; también verificada en
la aplicación real y en el gate global.

---

# B4 — Laboratorio de escenas — 2026-09-07

## Plan

- [x] Definir variantes efímeras y trazables sobre una escena real, sin tabla ni copia persistente paralela.
- [x] Permitir cambiar exactamente una variable declarada: POV, objetivo, lugar, entrada, información, coste, resultado o tono.
- [x] Comparar intención, tensión, voz y texto, conservando una referencia visible al original.
- [x] Exponer una preview estructural con procedencia y promover sólo por callback hacia el kernel de ramas.
- [x] Entregar UI accesible ES/EN, tests focales, runner, typecheck, lint y detector visual.

## Review

El laboratorio es un componente autocontenido: recibe escenas y anclas ya
proyectadas, mantiene todas las tomas en memoria y sólo emite una preview por
callback. Su adaptador opcional crea una `creativeBranch`, añade un único delta
de beat/evento y enlaza la escena real mediante `entityLinks`, todo en la misma
transacción; nunca escribe prosa ni promueve la rama al canon.

Evidencia: el runner Electron focal entrega 5 PASS, incluida una carrera de
preview obsoleta que revierte rama y procedencia completas. El ESLint focal no
reporta infracciones y el detector Impeccable devuelve `[]`. El typecheck global
pasó durante el desarrollo de B4; su repetición final queda temporalmente roja
por un import sin usar en `SharedUniverseLab.tsx`, ajeno a este corte.

---

# A3 — Mapa causal y de consecuencias — 2026-09-07

## Plan

- [x] Tipar la relación causal sobre `entityLinks`, con certeza y estado de canon, sin tabla nueva.
- [x] Derivar un grafo común desde enlaces causales, Board, Seeds y conexiones explícitas de Timeline.
- [x] Detectar saltos sin causa, consecuencias colgantes, coincidencias acumuladas y costes que desaparecen.
- [x] Construir una UI autocontenida que abra entidades reales y emita toda mutación mediante callbacks.
- [x] Verificar análisis, adaptadores, semántica accesible, typecheck, lint y detector visual.

## Review

La causalidad vive como metadatos versionados sobre `entityLinks`; no se creó
tabla ni copia de entidades. El read model fusiona esos enlaces con aristas
causales de Board, pares Seed/Payoff y conexiones de Timeline cuyo rótulo es
causal explícito. Cronología desconocida se omite en vez de inventar hechos.

La UI es un componente sin router ni acceso a Dexie. Cada entidad es un botón
nativo que entrega su referencia real al host; cambios de canon/necesidad,
causas posibles, coincidencias deliberadas y conversiones salen por callbacks.
Los estados canon, hipótesis, descartado y no evaluado tienen semántica visible.

Evidencia: `test:critical` completo, 181 pruebas, PASS; las cuatro pruebas A3
cubren persistencia, adaptadores, recorrido/diagnósticos y HTML accesible.
`typecheck:renderer` pasó antes de que el corte A2 concurrente introdujera sus
errores en `BranchLab.tsx`; ESLint focal PASS y detector Impeccable `[]`.

---

# B2/B5 — Constelación de motivos y arqueología de ideas — 2026-09-07

## Plan

- [x] Definir un read model puro, determinista y limitado al proyecto sobre
  entidades etiquetadas, anotaciones, enlaces, recibos, snapshots y procedencia creativa.
- [x] Derivar apariciones, ecos y vacíos de motivos sin interpretar texto ni
  convertir coincidencias automáticas en hechos.
- [x] Reconstruir recorridos de procedencia solo desde evidencia persistida,
  diferenciando transformaciones, revisiones, deshacer y referencias rotas.
- [x] Construir una UI autocontenida y accesible con copy inyectable, filtros y
  callbacks que abran las fuentes canónicas.
- [x] Verificar alcance, determinismo, deduplicación, estados vacíos, navegación,
  typecheck, lint focal y detector Impeccable.

## Review

Integrado como «Motivos y rastros». La constelación nace solo de etiquetas y
enlaces explícitos; la arqueología reconstruye el camino desde snapshots,
recibos y procedencia persistida, mostrando huecos o referencias rotas sin
inventar interpretaciones. Navega siempre a la fuente real y comparte filtros
ES/EN. Las pruebas críticas de Story Lenses pasan dentro de los 191 PASS y la
vista vacía/no vacía se validó en el Cockpit real.

# Mejora creativa integral — 2026-09-07

## Worldgen — estudio y reestructuración autorizados

### Continuación: geografía coherente y edición del mundo

- [x] Recalcular clima, corrientes, ríos, lagos y biomas del relieve esculpido con acción en segundo plano, persistencia y deshacer.
- [x] Incorporar lluvia absoluta y evaporación al caudal y selección de ríos, contrastando escenarios secos/húmedos.
- [x] Transportar y representar superficies físicas de lagos en 3D, incluida reapertura de snapshots.
- [x] Desarrollar un viaje o una noche como idea o escena vinculada al mundo, conservando el borrador y confirmando guardado.
- [x] Calcular rutas, comparaciones y descripción paleogeográfica fuera del hilo de interacción, con cancelación y descarte de respuestas obsoletas.
- [x] Corregir la jerarquía/colisión de nombres y medir optimizaciones del coste de generación completa.
- [x] Corregir el cierre encontrado al deshacer un recálculo en el mundo real de 2048; verificar consumo de memoria, ausencia de reconstrucción síncrona y ciclos de deshacer/rehacer/reapertura.
- [x] Integrar controles claros, comprobar mundos de prueba, regresiones, compilación y actualizar referencias.

Plan contrastado con la corrección del usuario: implementar las necesidades identificadas, dividir núcleo físico, agua 3D y recálculo/experiencia, comprobar resultados y recuperación antes del cierre.

### Revisión final de la continuación Worldgen

Implementados los ocho puntos anteriores. La comprobación real descubrió y corrigió dos defectos adicionales: deshacer el último recálculo podía reconstruir geografía completa en la interfaz con copias masivas del mundo; el worker de viajes recibía funciones de idiomas no serializables. Las regresiones nuevas cubren ambos límites y el transporte real.

Verificación final: `verify:quick` correcto (tipos renderer/Electron, lint sin excepciones, 23 motores, 51 tablas, 4718 claves y cero avisos de conformidad); `test:critical`: **310 comprobaciones**, con **70 grupos Worldgen** y workers reales de región, viajes y paleogeografía. `build:desktop`: correcto, 3119 módulos y bundles Electron. La comprobación de tamaño cumple el límite de entrada; permanecen avisos informativos de tamaño global y del módulo 3D del proyecto, sin fallo de compilación. `git diff --check` sin errores.

`test:worldgen:large` supera cinco ciclos sobre mundo real de 2048, incluida igualdad completa de campos, terreno esculpido y recarga del historial; 32,59 s totales y parche de geografía máximo 0,6 ms. Las matrices retenidas permanecen en 270,1 MiB con un punto del historial y 354,2 MiB con dos, sin crecimiento por repetir los ciclos. No es una medida de RSS ni del pico total del proceso. Evidencia exacta en [worldgen-large-lifecycle-2026-09-07.json](worldgen-large-lifecycle-2026-09-07.json). La prueba de reservas independiente hace ocho ciclos sin clonar matrices ambientales.

Recorrido final de interfaz en el proyecto sintético: abrir `j_zdm1cq` de 2048 con 606 ríos/119 hitos; deshacer hasta 419/113 y lista vacía; rehacer hasta 606/119, salir y volver conservando el resultado. Elegir Tengoro → Teeno calcula un recorrido real; desarrollar la noche 16 crea «QA — La noche del altar», y «Open ideas» muestra la idea guardada con el mundo fuente. Revisadas distribución de escritorio y 760 px; tamaño habitual restaurado y consola sin errores. Referencias `.odysseus` actualizadas conforme a la habilidad de grafo; la ruta antigua de memoria no existe en este entorno Windows.

Montaje final de motores repetido tras todas las correcciones: **23/23** en perfil aislado, sin generación ni IA en esa prueba transversal.

Medición comparada de generación completa: 16,2 % menos tiempo a 1024 y 9,0 % a 2048, sin reducir detalle y conservando hashes. El estudio describe el modelo anual aproximado, las pruebas y cada cambio implementado; no deja tareas identificadas de esta continuación Worldgen sin ejecutar.

- [x] Medir generación y render; comprobar apertura y navegación; evaluar calidad y capacidades con mundos y rutas reproducibles.
- [x] Definir responsabilidades entre generación, datos persistidos, presentación y herramientas creativas; documentar defectos y decisiones.
- [x] Implementar mejoras del núcleo/rendimiento y rutas sustentadas por pruebas.
- [x] Mejorar el flujo de creación, edición/regeneración y espacio cartográfico con fallos recuperables.
- [x] Verificar calidad visual, medidas antes/después, regresiones y compilación; registrar entregado y límites; actualizar arquitectura.

Plan verificado contra la petición: investigar e implementar cambios profundos donde exista evidencia, con foco en construir mundos útiles para ideas e historias. Trabajo repartido entre núcleo, cartografía, rutas y experiencia de creación, sin bloquear la implementación con otra solicitud de permiso.

### Revisión Worldgen

Implementados drenaje compatible/versionado, correcciones regionales y capas, cachés y miniaturas eficientes, rutas geográficas coherentes, pintura continua por la costura, alternativas, sustitución atómica y política de lugares, e itinerarios guardados con recuperación y eliminación confirmada. Estudio y límites en [estudio-worldgen-2026-09-07.md](estudio-worldgen-2026-09-07.md); medición reproducible en [worldgen-benchmark-2026-09-07.json](worldgen-benchmark-2026-09-07.json).

Verificación final: `verify:quick` correcto (tipos renderer/Electron, lint sin excepciones; 23 motores, 51 tablas, 4714 claves). `test:critical`: **274 comprobaciones**, incluida fase Worldgen de **36 grupos** y arranque real de renderer/worker. `build:desktop` correcto: 3103 módulos y bundles Electron. `git diff --check` y detector acotado a cuatro componentes de Worldgen sin hallazgos. El montaje 23/23 de motores de la entrega anterior sigue siendo la cobertura transversal; esta entrega amplía las pruebas funcionales de Worldgen.

Interfaz real en proyecto sintético: abrir original estándar; crear alternativa Archipelago/Fast con semilla propia; regenerarla mediante confirmación a `creative-archipelago-qa-v2`; salir y volver comprobando receta persistida (69 ríos, 56 hitos); recuperar original intacto (419 ríos, 113 hitos). Inspección a 1280 y 760 px, mapa expandible y herramientas recuperables, tamaño restaurado y consola sin errores. Las recargas del servidor durante compilación/pruebas reiniciaron selección temporal, por lo que la comprobación final se realizó con esas tareas terminadas.

El mapa y la miniatura de 2048 pasan de 98,3→50,4 ms y 133,3→7,43 ms en medianas locales; generación completa ~14,6 s sin mejora estable demostrada. Quedan necesidades físicas y artísticas explícitas en el estudio. Actualizadas las referencias `.odysseus` conforme a la habilidad de grafo; la antigua ruta `/sessions/.../.auto-memory` no existe en este entorno Windows.

## Continuación autorizada — flujos y recuperación

- [x] Escritos y auditoría de personajes: errores de lectura visibles con reintento, sin falsos vacíos.
- [x] Anotaciones y Galería: recuperar material por texto, filtros y estados sin resultados útiles.
- [x] Relaciones: todas las relaciones por par, alta desde matriz y edición recuperable.
- [x] Mapas, Atlas y Cronología: preservar borradores y validar operaciones de organización.
- [x] Esquema y escenas: plantillas atómicas y navegación al material enlazado.
- [x] Integrar pruebas, revisar en interfaz y separar claramente entregado de pendiente en documentación.

Plan contrastado con los fallos pendientes y la petición de continuar: cambios acotados por motor, conservar el sistema visual y los datos; validación con fallos de almacenamiento y recorridos completos. No requiere nueva aprobación.

### Revisión de la continuación

Implementados los seis puntos y ampliados los recorridos: Nota → laboratorio con fuente seleccionada; Diario autoguarda sin cerrar/bloquear y conserva lo escrito durante una escritura anterior; Códice mezcla cambios no conflictivos y permite resolver cada conflicto sin sobrescribir otros campos; Semillas navega a fuentes, Biografía busca material y Estadísticas valida y reintenta sin duplicar objetivos. Borradores locales de Mapas/Atlas sobreviven reapertura y se limpian por entidad/proyecto solo tras eliminar con éxito.

Verificación: `verify:quick` correcto, 23 motores, 51 tablas y 4702 claves; `test:critical` completo: 244 comprobaciones; `test:engines`: 23/23; `build:desktop` correcto con 3097 módulos y bundles Electron. Vista real del laboratorio a 1280 y 760 px, sin errores en apertura limpia; recorrido nota → posibilidad → salir/volver confirmado. Relaciones y objetivos revisados también a 480 px. Perfiles de prueba aislados. Separados [hechos](mejoras-realizadas-2026-09-07.md) y [pendientes](mejoras-pendientes.md); referencias de arquitectura actualizadas. El recuento de 210 de la revisión inferior corresponde a la primera entrega.

El ejecutor focal declara UTF-8 para evitar fallos de arranque con expresiones Unicode. Las ventanas de prueba desactivan la ralentización de temporizadores en segundo plano; la suite crítica conserva el límite de 90 segundos y ahora informa progreso y tiempos para localizar fallos.

Objetivo: facilitar capturar ideas, desarrollarlas, conectarlas y organizar un proyecto creativo; conservar datos, motores y preferencias existentes.

## Plan
- [x] Auditar los 23 motores, shell, inicio, captura/organización, Tablero y Worldgen con evidencias concretas.
- [x] Afinar el sistema visual existente: superficies cálidas legibles, jerarquía, navegación y espacio útil de trabajo.
- [x] Mejorar el acceso a captura y el centro del proyecto alrededor del proceso creativo.
- [x] Corregir interacciones/persistencia del Tablero vigente y facilitar construir conexiones.
- [x] Mejorar controles y fiabilidad de Worldgen sin perder mundos ni ediciones.
- [x] Verificar con typecheck, lint, conformance, pruebas críticas y navegación/capturas en perfil aislado.
- [x] Documentar resultados, limitaciones y actualizar conocimiento de arquitectura.

## Verificación del plan
La petición autoriza las mejoras; se conserva la arquitectura Electron/React, el esquema de datos y la identidad oscura/cálida. Trabajo paralelo acotado por motor; integración y revisión visual centralizadas. Prioridad a fallos reproducibles y flujos completos frente a sumar herramientas desconectadas.

## Revisión
Centro creativo y captura accesibles desde el proyecto, laboratorio persistente y exportable, navegación con propietario explícito y aislamiento de borradores. Tablero: enlaces, flechas, etiquetas, curvas, bloqueos, cámara y guardado ordenado; captura y ramificación con deshacer. Worldgen: cancelación, caché sin doble pintura, guardado del último trazo, presets y rutas al mundo correcto. Formularios de varios motores conservan su contenido ante fallos de escritura.

Verificado: `verify:quick` (TypeScript renderer/Electron, lint sin excepciones y conformance: 23 motores, 51 tablas de motor, 4677 claves de traducción), `test:critical` (210 comprobaciones), `test:engines` (23/23 montajes en perfil aislado; workers dormidos, no prueba IA/generación) y `build:desktop`. Pruebas manuales del Tablero: arrastre entre conectores, editar/seleccionar etiqueta, borrar/deshacer, recargar conservando conexiones/cámara, ramificar y abrir nodo exacto. Captura rápida confirmada en proyecto aislado. Worldgen generó realmente un mundo estándar con 419 ríos y 113 hitos, sin errores de consola. Centro creativo comprobado a 1280 y 760 px; tamaño de navegador restaurado.

Auditoría por motor y necesidades aún abiertas: [auditoria-creativa-2026-09-07.md](auditoria-creativa-2026-09-07.md). No se ha ejecutado una sesión productiva completa en cada motor ni generación de imagen con modelo real. Compilación de escritorio realizada; sin empaquetar/publicar instalador. Referencia de arquitectura y motores en `.odysseus/`; la ruta antigua de memoria indicada por la habilidad no existe en este entorno Windows.

## Release pública de escritorio — 2026-09-07

Plan verificado con la petición: conservar el diseño y código privado, integrar chrome de ventana, reutilizar Icon.png, publicar únicamente instaladores y documentación bajo Luissalet (clave bookhoard).

- [x] Integrar barra de ventana, controles y tema; aplicar icono real.
- [x] Preparar empaquetado Windows y evaluar Linux con dependencias nativas correctas.
- [x] Verificar tipos, lint, pruebas críticas, build y arranque empaquetado aislado.
- [x] Crear repositorio público separado con README detallado y publicar artefactos verificados.
- [x] Registrar resultados, limitaciones y arquitectura.
- [x] Añadido al alcance: aviso de nueva versión, descarga/instalación explícitas y enlace alternativo a Releases; verificar estados y reconstruir ambos paquetes antes de publicar.
- [x] Corrección visual del usuario: una sola marca en la barra lateral; barra nativa sin texto repetido y cabecera Inicio. Lección registrada.

### Revisión de la release pública

Publicada v0.1.0 como prerelease en https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.0 con identidad API Luissalet y SSH bookhoard. Repositorio público independiente: README detallado, notas e icono; comprobado que Writers-Hoard-Desktop sigue privado. Se distribuyen instalador Windows x64, AppImage Linux x64, metadatos de actualización, blockmap Windows y SHA256SUMS.txt. Los seis hashes remotos de GitHub coinciden con los archivos locales.

Chrome de ventana integrado con la paleta, menú accesible y controles nativos; marca única e icono original junto al nombre en sidebar. Ventana y ejecutable usan el icono original. Actualizador con estado recuperable, aviso en barra, comprobaciones al inicio/cada seis horas, descarga e instalación explícitas, respeto al guardado pendiente y descarga alternativa desde GitHub. Verificada la consulta real a la release publicada: «You have the latest version», 0.1.0.

Verificación: audit sin vulnerabilidades; verify:quick (tipos, lint cero deuda, conformance 23 motores/51 tablas/4738 claves), 311 comprobaciones críticas incluidas transiciones de actualizador y restricciones IPC. Compilación final y lint de las correcciones visuales; smoke de paquete Windows final, icono/menú/maximizar y panel de actualizaciones en interfaz nativa con perfil aislado. La salida de consola cerrada del primer launcher de prueba provocó EPIPE; relanzado con stdio independiente, arranque y consulta correctos. Sin cambios de datos del usuario.

Linux construido con dependencias nativas Linux en Docker; smoke del AppRun extraído del artefacto final, no root y sandbox activado, en Debian 12/Xvfb. Canvas, FFmpeg y yt-dlp verificados. gallery-dl requiere glibc >=2.38 y se comprobó en Ubuntu 24.04; limitación documentada. Windows sin firma digital, indicado en README/notas. Auditoría de paquetes sin mapas de fuentes ni carpetas fuente propias; metadatos SHA-512 comprobados contra binarios y nombres públicos exactos. Presupuesto de entrada aprobado; tamaño total/lazy conserva avisos no bloqueantes existentes.

Habilidad update-project-graph revisada: cambios de presentación, IPC y empaquetado sin cambios de esquema, rutas, motores, stores o servicios; sin disparadores para reescanear el grafo. Lecciones de marca y ubicación de icono registradas. Contenedores Linux detenidos y conservados para reproducir.

## Investigación Jasper y Writesonic — 2026-09-07
- [ ] Contrastar capacidades actuales en documentación oficial.
- [ ] Revisar funciones implementadas de Writer’s Hoard y distinguir planes.
- [ ] Documentar diferencias, ventajas aplicables y prioridades con fuentes.

Plan revisado: comparación de producto para creación literaria; investigación y documentación, sin implementación de funciones.

### Revisión final de investigación Jasper/Writesonic
- [x] Contrastar capacidades actuales en documentación oficial.
- [x] Revisar código conectado y separar capacidades presentes de propuestas.
- [x] Incorporar periodismo, ensayo y otros autores al alcance.
- [x] Documentar diferencias y prioridades en tasks/comparativa-jasper-writesonic-2026-09-07.md.

Investigación documental completada. Sin cambios de aplicación ni evaluación comparativa de textos generados. Se priorizan fuentes y trazabilidad, contexto/voz editorial, flujos, revisión y publicación. Las casillas iniciales quedan sustituidas por esta revisión final.

### Alcance seleccionado tras la comparativa
- [x] Ajustar la propuesta: investigación y trazabilidad; contexto, voz y criterios; flujos individuales de escritura.
- [x] Excluir trabajo con editores y publicación digital; adaptar a motores existentes, almacenamiento local y núcleo compartido copiloto/MCP.
Revisión: actualizado el informe competitivo. Selección de alcance documentada; funciones aún sin implementar.

## Implementación de herramientas de escritura — 2026-09-07

Alcance verificado con la petición: investigación/trazabilidad, voz y contexto, procesos individuales; sin equipos, CMS ni marketing. Extensiones de superficies existentes, conservar datos y cambios previos. Proyecto como propietario de perfiles/procesos; citas como propietarias de evidencias. Reutilizar gateway IA, herramientas y exportaciones existentes.

- [x] Perfil editorial persistente por proyecto, editable, propuesta desde muestras y aplicación explícita en copiloto/análisis/revisión.
- [x] Evidencias vinculadas a fuentes con fragmentos, procedencia y estado de revisión humana.
- [x] Recorridos de periodismo, ensayo y narrativa con pasos editables, asistencia contextual y promoción segura a escritos.
- [x] Montar en herramientas de proyecto y exponer contexto al núcleo MCP/copiloto.
- [x] Comprobar aislamiento, persistencia, conflictos, citas y recorridos de interfaz; ejecutar verificaciones del proyecto.
- [x] Registrar resultados y actualizar conocimiento de arquitectura.

Plan de verificación: pruebas focales de comportamiento con IndexedDB aislada; pruebas de tipos/lint/conformance, suite crítica, compilación y recorrido real de interfaz. No inferir calidad de IA desde mocks ni alterar recortes del usuario.

### Revisión de implementación

Entrega detallada en `tasks/herramientas-escritura-implementadas-2026-09-07.md`. Verificado: verify:quick (23 motores, 51 tablas de motor, 4738 claves), 325 pruebas críticas, 3 recorridos editoriales de formulario, renderer completo a 1280/760 px y build:desktop. Detector de los componentes sin hallazgos. Regresión de selección de herramientas corregida; fixtures antiguos crean su proyecto y fijan la cronología de instantáneas para evitar empates por milisegundo. Referencia de arquitectura actualizada. Sin cambios en recortes del usuario, sin publicar instalador y sin evaluar calidad con un modelo real. Búsqueda web autónoma/OCR/transcripción no forman parte de esta primera entrega.

## Publicación 0.1.1 — Windows y Linux

Plan verificado: generar nueva prerelease en Luissalet/Writers-Hoard-Releases con paquetes actuales Windows x64/Linux x64, conservar release anterior y código privado. Usuario autoriza build y subida; se mantiene distribución preliminar sin firma Windows de la release existente.
- [x] Versionar 0.1.1, comprobar dependencias y recompilar renderer/Electron.
- [x] Empaquetar Windows y Linux con dependencias nativas correctas.
- [x] Verificar arranque de paquetes, contenido y metadatos/hashes.
- [x] Subir artefactos a release nueva y verificar los archivos remotos.

### Revisión de publicación 0.1.1

Publicada prerelease https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.1 con seis archivos: Windows x64 NSIS y blockmap, Linux x64 AppImage, latest.yml, latest-linux.yml y SHA256SUMS.txt. Los seis SHA256 remotos coinciden con los archivos locales de `release/publish-0.1.1`; nombres, tamaños y SHA512 de metadatos comprobados. Release anterior conservada. Código privado no subido.

Audit sin vulnerabilidades, renderer/Electron recompilados a 0.1.1 y presupuesto de entrada aprobado. Suite de implementación previa: 325 comprobaciones. Windows: arranque empaquetado aislado, versión y funciones nuevas presentes, sin carpetas fuente ni mapas propios. Linux: dependencias nativas y binarios fijados verificados, AppRun final bajo usuario no root/Xvfb con sandbox, canvas/FFmpeg/yt-dlp correctos. La limitación conocida gallery-dl/GLIBC >=2.38 y la ausencia de firma Windows están en las notas de la release. Contenedores de build/verificación detenidos tras finalizar. No cambios en src en esta publicación; arquitectura permanece vigente.
## Anuncio de LinkedIn — 2026-09-08

Plan: texto personal y concreto, capacidades reales de narrativa y periodismo, imágenes de ejemplo sin publicar en LinkedIn.
- [ ] Preparar capturas y material visual.
- [ ] Redactar el post y revisar capacidades y enlace de descarga.

### Revisión del anuncio
- [x] Escritura y fuentes capturadas con contenido de ejemplo y revisadas visualmente; mapa Aetheria exportado por la aplicación como tercera imagen.
- [x] Post personal con capacidades existentes y enlace a la versión preliminar 0.1.1.
- [x] Imágenes preparadas en release/linkedin-0.1.1/imagenes-linkedin.zip. Sin publicación en redes ni cambios en src.

## Suscripciones y conexión desde asistentes — 2026-09-08

Plan verificado con la petición: trasladar las conexiones Claude/Codex por suscripción de Faustus a Writers Hoard de escritorio y ampliar la sección existente del puente con pasos por cliente e instrucciones copiables. Conservar el diseño, API/modelos locales, núcleo de herramientas y permisos.
- [x] Integrar proveedores por suscripción, autenticación y ejecución cancelable.
- [x] Añadir controles de suscripción y selección de modelos.
- [x] Añadir configuración por cliente y briefing para agentes externos.
- [x] Verificar tipos, lint, pruebas críticas, compilación y recorrido de interfaz; documentar límites reales.

### Revisión de suscripciones y conexión externa

Claude/Codex usan clientes oficiales con autenticación de suscripción comprobada, sin copiar credenciales ni alternativa API. Copiloto mediante propuestas estructuradas validadas y ejecutor compartido. Inicio de sesión Windows con ejecutable resuelto, cancelación de procesos y cierre global; instrucciones de terminal en otros sistemas. Interfaz bilingüe para importar/verificar/modelos/predeterminada/quitar conexión y configuración Claude Desktop/Codex/Gemini CLI más mensaje de inicio sin secretos. Chats web requieren integración aparte, no basta un prompt.

Verificado: verify:quick sin errores, 325 pruebas críticas, test:subscriptions (protocolo, autenticación/cancelación, interfaz y guía), build:desktop y bundle:budget. Revisadas capturas reales de componentes/CSS a 1280 y 760 px con datos aislados. Ambos clientes instalados confirmaron suscripción y completaron respuestas reales y el ciclo propuesta de herramienta + resultado sintético + respuesta; sin leer proyectos personales. README, guías y PROJECT_KNOWLEDGE actualizados. Sin publicar instalador ni modificar configuraciones de asistentes externos.

## Publicación 0.1.2 — 2026-09-08

Usuario autoriza publicar siguiendo docs/RELEASES.md: nueva prerelease Windows/Linux, seis adjuntos, código privado y versiones anteriores conservadas.
- [x] Versionar y preparar notas de novedades/requisitos.
- [x] Verificar y empaquetar Windows/Linux con dependencias de cada plataforma.
- [x] Probar paquetes finales y comprobar metadatos y hashes.
- [x] Subir borrador, verificar adjuntos remotos y publicar.

### Revisión de publicación 0.1.2

Publicada https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.2 como prerelease Windows x64/Linux x64. Seis adjuntos: instalador NSIS, blockmap, AppImage, dos YAML y SHA256SUMS. npm ci y binarios por plataforma, verify:release aprobado (0 vulnerabilidades, 325 pruebas críticas y pruebas nuevas de suscripciones), arranque Windows empaquetado y Linux no root con sandbox. Archivos de aplicación versión 0.1.2, funciones nuevas incluidas, sin fuentes/mapas propios. Los seis adjuntos descargados del borrador coinciden byte a byte con los locales; metadatos, tamaños y hashes verificados antes de publicar. Versiones 0.1.0/0.1.1 conservadas, código privado no enviado al repositorio público, contenedores de build detenidos. Limitaciones de firma Windows y gallery-dl Linux documentadas en notas.


## Modo concentración a pantalla completa + ocultar barra lateral — 2026-09-23

Petición de usuarios: al escribir capítulos, una «pantalla completa» como la de Word para concentrarse,
y un botón para esconder/mostrar la barra lateral.

- [x] Barra lateral: tercer estado «oculta» (`sidebarHidden` en appStore, persistido en `ui_sidebar`),
      `Sidebar` a anchura 0 e `inert`, botón PanelLeft en `TopBar`, atajo Mod+Shift+B (fila en shortcuts.ts).
- [x] Modo concentración: pantalla completa real con la Fullscreen API (sin IPC nuevo; Electron pone la
      ventana a pantalla completa), cabecera que se esconde y aparece al llevar el ratón arriba (como Word),
      pastilla de estado abajo a la derecha (palabras, páginas, sprint, autoguardado), Esc y
      `fullscreenchange` salen a la vez, atajo Mod+Shift+F.
- [x] Puertas: tsc, lint, conformance, 325 tests críticos; prueba en vivo en la app (CDP).
- [x] Review aquí + memoria del proyecto.

### Review

**Qué hay.** `src/engines/writings/components/FocusChrome.tsx` (nuevo): la fila de controles del editor
en una tira fija arriba, visible 2,8 s al entrar (con la pista «borde superior · Esc · Ctrl Mayús F») y
después solo con el puntero en los 8 px del borde o con foco dentro — todo CSS (`group-hover/chrome`,
`group-focus-within/chrome`), sin listener de `mousemove`. `WritingsView`: `headerRow` y `metaRow` son
constantes JSX que se colocan en el cuerpo o en la tira/pastilla según `focusMode`; el efecto
`[focusMode]` pide `requestFullscreen` al entrar, escucha `fullscreenchange` (si el documento deja la
pantalla completa por cualquier vía, el modo se apaga) y en la limpieza sale de la pantalla completa.
`SprintControl` gana `menuPlacement="above"` para que sus opciones no se abran fuera de pantalla desde la
pastilla. `appStore`: `sidebarHidden` + `toggleSidebarHidden`/`setSidebarHidden`/`loadSidebar`, persistido
junto a `sidebarOpen` en la clave `ui_sidebar`; `MainLayout` lo carga y ata Mod+Shift+B a la ventana.

**Verificado en vivo (dev-desktop con CDP, `_stage/cdp.mjs` con los comandos nuevos `tap`, `hover`,
`press` — clic y teclas de confianza, porque `el.click()` desde `Runtime.evaluate` no es gesto de
usuario y `requestFullscreen` lo rechaza):** botón y atajo ocultan/muestran la barra (anchura 0, `inert`,
etiqueta «Show the sidebar (Ctrl Shift B)»); persiste tras recargar. Modo concentración: la ventana pasa a
1920×1080 (`document.fullscreenElement` puesto), la tira asoma y se esconde (top −49, opacidad 0), vuelve
al pasar el puntero por y=3 y se va al bajar; Esc deja pantalla completa y overlay a la vez; Ctrl+Mayús+F
entra y sale. La pastilla muestra sprint · 1.375 palabras · 5 páginas · capítulo · estado.

**Trampas.** `scripts/add-locale-keys.mjs` fallaba con un espacio en la ruta (`.pathname` deja `%20`):
ahora usa `fileURLToPath`. Vite recarga `WritingsView` al editarlo y eso cierra el editor y la pantalla
completa: cualquier prueba en vivo se rehace desde abrir el capítulo.

**Abierto.** F11 (rol `togglefullscreen` del menú) durante el modo concentración no se ha probado por
CDP (el acelerador lo maneja Electron, no el renderer); por diseño `fullscreenchange` debería apagar el
modo. El libro entero (`BookEditor`) no tiene modo concentración.

---

# Full audit — 2026-09-24 (branch `claude/funny-ritchie-o15l6v`)

Baseline on entry: both typechecks, shipping lint and conformance pass;
`npm audit` reports js-yaml (high) and joi (low) in the dev tree.

## Plan

- [x] Parallel audit + fix, one area per agent, disjoint files:
  - [x] Electron main process (security, IPC validation, media server, AI runtime)
  - [x] Data layer: `src/db`, backup/restore, pending writes, search, replace
  - [x] AI services: aiBridge, aiRuntime, copilot, judge, project tools
  - [x] Writings engine + editor components (the manuscript core)
  - [x] Small engines (annotations → video-planner, not the four big ones)
  - [x] Board, image-studio, real-atlas, scrapper
  - [x] Worldgen (crash/leak/correctness only)
  - [x] Shell: components, pages, stores, hooks, i18n, accessibility
- [x] Dependency audit fix (lockfile only)
- [x] Features chosen against the product's core job (lesson #66, #76)
- [x] Re-run verify:quick + the runnable test suites
- [x] Review section below

## Review

Eight audit passes, one area each, then four features. Every fix was
reproduced before it was changed; most have a focused test that fails
against the old code.

Features: arc beats ↔ scenes, Recortes preservation (badges, link-only
filter, batch archive, CSV export), Codex draft recovery, and
`Modal dismissible` adopted by every editor that lost input on Escape.

Verified on the merged tree (after origin/main e6b4e71): verify:quick,
npm audit (0), test:critical 325/325, read-aloud 3/3, subscription
protocol/backend/UI/bridge, engine smoke 23/23, build:desktop,
bundle:budget (advisory notes only: World3D chunk 714 kB / 700, total
renderer JS 7.7 MB / 4.1 MB). New focused suites: data-layer-regressions,
character-arc-scene-links, scrapper-preservation, worldgen-3d-regenerate,
shell-ui-regressions, modal-dirty-guards, codex-draft-recovery.

Caught in review: the read-aloud optimisation left the panel's open
buttons permanently disabled (lesson #78).

Left open (reported, not fixed): ComfyUI ignores controlImage; no UI
calls sd:downloadCompanion; Markdown export drops strikethrough and
multi-line code; find/replace with an empty replacement can remove a
whole paragraph; a clipping deleted mid-download leaves its file;
Worldgen's CartoMap frame and dead-context scene are not cancelled.
